/**
 * WebChartStore — FhirStore implementation backed by WebChart's proprietary API.
 *
 * Endpoints used:
 *   GET  db/schedules         — provider schedule blocks
 *   GET  db/appointments      — booked appointments
 *   GET  db/apt_types         — appointment type definitions
 *   GET  db/multi_resource_apt — appointment ↔ resource junction
 *   POST appointments         — create / update / cancel appointments
 *
 * Slot availability is computed: schedule blocks minus booked appointments.
 */

import {
  FhirStore,
  StoreCapabilities,
  Schedule,
  Slot,
  Appointment,
  FhirSlotQuery,
  FhirScheduleQuery,
  FhirAppointmentQuery,
} from '../types/fhir';
import { WebChartApi, WebChartConfig } from './adapters/webchartApi';

export { WebChartConfig } from './adapters/webchartApi';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Map WebChart `filler_status_code` to FHIR appointment status. */
function wcStatusToFhir(row: any): Appointment['status'] {
  if (Number(row.canceled) > 0) return 'cancelled';
  const s = (row.filler_status_code || '').toLowerCase();
  const map: Record<string, Appointment['status']> = {
    pending: 'pending',
    booked: 'booked',
    started: 'arrived',
    complete: 'fulfilled',
    noshow: 'noshow',
    cancelled: 'cancelled',
    waitlist: 'waitlist',
    blocked: 'entered-in-error',
  };
  return map[s] || 'booked';
}

/** Convert a WebChart schedule row to FHIR Schedule. */
function rowToSchedule(row: any): Schedule {
  return {
    resourceType: 'Schedule',
    id: String(row.id),
    active: true,
    actor: [{
      reference: `Practitioner/${row.resource_id}`,
      display: row.user_name || row.resource_name || `User ${row.resource_id}`,
    }],
    planningHorizon: {
      start: row.startdate || row.start_time,
      end: row.enddate || row.end_time,
    },
    comment: row.comment || undefined,
    meta: { lastUpdated: new Date().toISOString() },
  };
}

/** Convert a WebChart appointment row to FHIR Appointment. */
function rowToAppointment(row: any, resources?: any[]): Appointment {
  const participants: Appointment['participant'] = [];

  // Patient participant
  if (row.pat_id) {
    participants.push({
      actor: { reference: `Patient/${row.pat_id}` },
      status: 'accepted',
    });
  }

  // Provider/resource participants (from multi_resource_apt join)
  if (resources && resources.length > 0) {
    for (const r of resources) {
      participants.push({
        actor: {
          reference: `Practitioner/${r.res_id}`,
          display: r.resource_name || `Resource ${r.res_id}`,
        },
        status: 'accepted',
      });
    }
  }

  return {
    resourceType: 'Appointment',
    id: String(row.id),
    identifier: row.external_id ? [{ system: 'urn:fhirtogether:booking-reference', value: row.external_id }] : undefined,
    status: wcStatusToFhir(row),
    description: row.reason || undefined,
    start: row.startdate,
    end: row.enddate,
    created: row.createdate || undefined,
    comment: row.comment || undefined,
    patientInstruction: row.patient_instructions || undefined,
    participant: participants.length > 0 ? participants : [{ status: 'needs-action' }],
    meta: { lastUpdated: new Date().toISOString() },
  };
}

// ─── WebChartStore ──────────────────────────────────────────────────────────

export class WebChartStore implements FhirStore {
  readonly name = 'webchart';

  readonly capabilities: StoreCapabilities = {
    scheduleWrite: false,
    slotWrite: false,
    bulkDelete: false,
    appointmentIdentifierLookup: true,   // WebChart supports external_id lookup
  };

  private api: WebChartApi;
  private defaultLocation: string;
  private timezone?: string;
  /** Cache of resource_id → display name from the users table */
  private userNameCache = new Map<string, string>();

  constructor(config: WebChartConfig & { timezone?: string }) {
    this.api = new WebChartApi(config);
    this.defaultLocation = config.defaultLocation || '0';
    this.timezone = config.timezone;
  }

  /**
   * Look up a user's display name by user_id (= resource_id on schedules).
   * Fetches from the WebChart users table and caches the result.
   */
  private async lookupUserName(userId: string): Promise<string> {
    if (this.userNameCache.has(userId)) return this.userNameCache.get(userId)!;
    try {
      const result = await this.api.get('db/users', { user_id: userId, limit: '1' });
      const rows = result?.db || result || [];
      if (rows.length > 0) {
        const row = rows[0];
        const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || `User ${userId}`;
        this.userNameCache.set(userId, name);
        return name;
      }
    } catch (_) {
      // Non-critical — fall back to generic name
    }
    const fallback = `User ${userId}`;
    this.userNameCache.set(userId, fallback);
    return fallback;
  }

  /**
   * Convert a clinic-local date/time to a UTC Date.
   * If no timezone is configured, falls back to system-local behaviour.
   */
  private clinicLocalToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
    if (!this.timezone) {
      return new Date(year, month - 1, day, hour, minute, 0, 0);
    }
    // Start with a naive UTC timestamp matching the desired local values
    const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

    // Ask Intl what that UTC instant looks like in the clinic timezone
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: this.timezone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      }).formatToParts(new Date(naive))
        .filter(p => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(p.type))
        .map(p => [p.type, parseInt(p.value, 10)])
    ) as Record<string, number>;

    const tzMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offsetMs = tzMs - naive;

    return new Date(naive - offsetMs);
  }

  /**
   * Convert a UTC Date to a WebChart-compatible local time string
   * ("YYYY-MM-DD HH:mm:ss") in the clinic timezone.
   * Falls back to system-local when no timezone is configured.
   */
  private utcToWcDate(utcDate: Date): string {
    if (!this.timezone) {
      // Legacy: strip the trailing Z from the ISO string and hope server TZ matches
      return utcDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '').substring(0, 19);
    }

    const parts: Record<string, string> = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(utcDate)) {
      parts[type] = value;
    }

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  /**
   * Parse hours and minutes from a WebChart date string (clinic-local time).
   * Avoids Date constructor to prevent system-timezone side-effects.
   */
  private static parseLocalTime(dateStr: string): { hour: number; minute: number } {
    const m = dateStr.match(/(\d{2}):(\d{2})/);
    if (m) return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
    // Fallback (shouldn't happen for well-formed WebChart dates)
    const d = new Date(dateStr);
    return { hour: d.getHours(), minute: d.getMinutes() };
  }

  /**
   * Parse a WebChart date string (clinic-local) to a UTC Date.
   * WebChart dates look like "2026-04-08 08:00:00".
   */
  private wcDateToUtc(wcDate: string): Date {
    if (!this.timezone) return new Date(wcDate);
    const m = wcDate.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/);
    if (!m) return new Date(wcDate);
    return this.clinicLocalToUtc(
      parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10)
    );
  }

  async initialize(): Promise<void> {
    // Verify credentials on startup
    await this.api.login();
  }

  async close(): Promise<void> {
    // No persistent connections to close
  }

  // ==================== SCHEDULE OPERATIONS ====================

  async getSchedules(query: FhirScheduleQuery): Promise<Schedule[]> {
    const params: Record<string, string> = {};

    if (query.actor) {
      // actor could be "Practitioner/123" or just "123" or a name
      // In WebChart, resource_id on schedules is the provider's user_id,
      // NOT user_id (which is the admin who created the schedule).
      const actorId = query.actor.replace(/^Practitioner\//, '');
      if (/^\d+$/.test(actorId)) {
        params.resource_id = actorId;
      } else {
        params.LIKE_user_name = `%${actorId}%`;
      }
    }

    // Cap results to avoid loading the entire history
    // WebChart doesn't support date comparison operators (GE_, LE_, etc.)
    params.limit = String(query._count || 200);

    const result = await this.api.get('db/schedules', Object.keys(params).length > 0 ? params : undefined);
    const rows = result?.db || result || [];

    if (!Array.isArray(rows)) return [];
    const schedules = rows.map(rowToSchedule);

    // Enrich schedules with real provider names from the users table
    for (const schedule of schedules) {
      const practitioner = schedule.actor?.find(a => a.reference?.startsWith('Practitioner/'));
      if (practitioner) {
        const userId = practitioner.reference!.replace('Practitioner/', '');
        practitioner.display = await this.lookupUserName(userId);
      }
    }

    return schedules;
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    const result = await this.api.get('db/schedules', { id });
    const rows = result?.db || result || [];
    if (rows.length === 0) return null;

    const schedule = rowToSchedule(rows[0]);
    // Enrich with real provider name
    const practitioner = schedule.actor?.find(a => a.reference?.startsWith('Practitioner/'));
    if (practitioner) {
      const userId = practitioner.reference!.replace('Practitioner/', '');
      practitioner.display = await this.lookupUserName(userId);
    }
    return schedule;
  }

  async createSchedule(_schedule: Schedule): Promise<Schedule> {
    // Schedules are managed in WebChart UI, not via API
    throw new Error('Creating schedules is not supported via WebChart API — manage schedules in the WebChart UI');
  }

  async updateSchedule(_id: string, _schedule: Partial<Schedule>): Promise<Schedule> {
    throw new Error('Updating schedules is not supported via WebChart API — manage schedules in the WebChart UI');
  }

  async deleteSchedule(_id: string): Promise<void> {
    throw new Error('Deleting schedules is not supported via WebChart API — manage schedules in the WebChart UI');
  }

  async deleteAllSchedules(): Promise<void> {
    throw new Error('Deleting schedules is not supported via WebChart API — manage schedules in the WebChart UI');
  }

  // ==================== SLOT OPERATIONS ====================
  //
  // WebChart does NOT have a slots table. Slots are computed:
  //   available = schedule blocks - booked appointments
  //

  async getSlots(query: FhirSlotQuery): Promise<Slot[]> {
    // Determine date range
    const now = new Date();
    const startDate = query.start || now.toISOString();
    let endDate = query.end || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // When end is a date-only string (YYYY-MM-DD), extend to end-of-day
    // so that a query like start=2026-03-24 & end=2026-03-24 covers the full day
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      endDate = new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    // 1. Get schedule blocks for the date range
    const schedParams: Record<string, string> = {
      limit: '200',
    };
    if (query.schedule) {
      const scheduleId = query.schedule.replace(/^Schedule\//, '');
      schedParams.id = scheduleId;
    }
    const schedResult = await this.api.get('db/schedules', Object.keys(schedParams).length > 0 ? schedParams : undefined);
    const schedRows = schedResult?.db || schedResult || [];

    if (!Array.isArray(schedRows) || schedRows.length === 0) return [];

    // 2. Get existing appointments in the same range (non-canceled)
    //    WebChart doesn't support GE_/LE_ operators, so cap with limit and filter client-side
    const aptParams: Record<string, string> = {
      canceled: '0',
      limit: '500',
    };
    const aptResult = await this.api.get('db/appointments', aptParams);
    const allAptRows = aptResult?.db || aptResult || [];

    // Client-side date filter for relevant appointments
    const rangeStartMs = new Date(startDate).getTime();
    const rangeEndMs = new Date(endDate).getTime();
    const aptRows = Array.isArray(allAptRows) ? allAptRows.filter((apt: any) => {
      // WebChart dates are clinic-local; convert to UTC for range comparison
      const aptStart = this.wcDateToUtc(apt.startdate).getTime();
      return aptStart >= rangeStartMs && aptStart <= rangeEndMs;
    }) : [];

    // 3. Generate slots from schedule blocks, marking those overlapping with appointments as 'busy'.
    //    WebChart schedules may be recurring templates with old dates.
    //    For recurring schedules (recurrence > 0), project the template times onto each
    //    day in the query range that matches rc_dow (day-of-week bitmask: Mon=2..Sat=64, Sun=1).
    const slots: Slot[] = [];
    const slotDurationMs = 30 * 60 * 1000; // 30-minute default slots
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    // Day-of-week bitmask mapping: JS getDay() → WebChart rc_dow bit
    // JS: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
    // WC: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64
    const jsDayToWcBit = [1, 2, 4, 8, 16, 32, 64];

    for (const sched of schedRows) {
      const templateStartStr = sched.startdate || sched.start_time;
      const templateEndStr = sched.enddate || sched.end_time;
      const templateStart = new Date(templateStartStr);
      const templateEnd = new Date(templateEndStr);
      const recurrence = Number(sched.recurrence || 0);
      const rcDow = Number(sched.rc_dow || 0);

      // Parse template hours/minutes directly from the string to avoid
      // system-timezone interpretation. WebChart stores clinic-local times.
      const { hour: startHour, minute: startMin } = WebChartStore.parseLocalTime(templateStartStr);
      const { hour: endHour, minute: endMin } = WebChartStore.parseLocalTime(templateEndStr);

      // Collect day blocks to generate slots for
      const dayBlocks: Array<{ start: Date; end: Date }> = [];

      if (recurrence > 0 && rcDow > 0) {
        // Recurring schedule — project template hours onto each matching day in range.
        // Iterate over calendar dates using UTC date arithmetic (timezone-neutral).
        const cursorStart = this.timezone
          ? this.clinicLocalToUtc(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + 1, rangeStart.getUTCDate(), 0, 0)
          : new Date(rangeStart);
        const cursor = new Date(cursorStart);
        if (this.timezone) {
          // Already a midnight-equivalent; just use Date.UTC arithmetic below
        } else {
          cursor.setHours(0, 0, 0, 0);
        }

        while (cursor <= rangeEnd) {
          // Get the calendar day in the appropriate reference frame
          const year = this.timezone ? cursor.getUTCFullYear() : cursor.getFullYear();
          const month = this.timezone ? cursor.getUTCMonth() + 1 : cursor.getMonth() + 1;
          const day = this.timezone ? cursor.getUTCDate() : cursor.getDate();
          const jsDay = this.timezone ? cursor.getUTCDay() : cursor.getDay();

          const dayBit = jsDayToWcBit[jsDay];
          if (rcDow & dayBit) {
            const blockStart = this.clinicLocalToUtc(year, month, day, startHour, startMin);
            const blockEnd = this.clinicLocalToUtc(year, month, day, endHour, endMin);

            if (blockEnd > rangeStart && blockStart < rangeEnd) {
              dayBlocks.push({ start: blockStart, end: blockEnd });
            }
          }

          // Advance by one calendar day
          if (this.timezone) {
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          } else {
            cursor.setDate(cursor.getDate() + 1);
          }
        }
      } else {
        // Non-recurring — use the original date range if it overlaps
        if (templateEnd > rangeStart && templateStart < rangeEnd) {
          dayBlocks.push({
            start: new Date(Math.max(templateStart.getTime(), rangeStart.getTime())),
            end: new Date(Math.min(templateEnd.getTime(), rangeEnd.getTime())),
          });
        }
      }

      // Generate slots for each day block
      for (const block of dayBlocks) {
        let cursor = block.start.getTime();
        while (cursor + slotDurationMs <= block.end.getTime()) {
          const slotStart = new Date(cursor);
          const slotEnd = new Date(cursor + slotDurationMs);

          // Check if any appointment overlaps this slot
          const isBusy = Array.isArray(aptRows) && aptRows.some((apt: any) => {
            if (Number(apt.canceled) > 0) return false;
            // WebChart dates are clinic-local; convert to UTC for comparison
            const aptStartTime = this.wcDateToUtc(apt.startdate).getTime();
            const aptEndTime = this.wcDateToUtc(apt.enddate).getTime();
            return aptStartTime < slotEnd.getTime() && aptEndTime > slotStart.getTime();
          });

          const status = isBusy ? 'busy' : 'free';

          // If query filters by status and this slot doesn't match, skip it
          if (query.status && status !== query.status) {
            cursor += slotDurationMs;
            continue;
          }

          slots.push({
            resourceType: 'Slot',
            id: `wc-${sched.id}-${cursor}`,
            schedule: { reference: `Schedule/${sched.id}` },
            status,
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            meta: { lastUpdated: new Date().toISOString() },
          });

          cursor += slotDurationMs;
        }
      }
    }

    // Apply count limit
    if (query._count && slots.length > query._count) {
      return slots.slice(0, query._count);
    }

    return slots;
  }

  async getSlotById(id: string): Promise<Slot | null> {
    // Slots are virtual — reconstruct from the ID pattern "wc-{schedId}-{timestamp}"
    const match = id.match(/^wc-(\d+)-(\d+)$/);
    if (!match) return null;

    const [, schedId, timestamp] = match;
    const slotDurationMs = 30 * 60 * 1000;
    const slotStart = new Date(Number(timestamp));
    const slotEnd = new Date(Number(timestamp) + slotDurationMs);

    return {
      resourceType: 'Slot',
      id,
      schedule: { reference: `Schedule/${schedId}` },
      status: 'free', // Assume free — actual status checked during booking
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      meta: { lastUpdated: new Date().toISOString() },
    };
  }

  async createSlot(slot: Slot): Promise<Slot> {
    // No-op: slots are computed from schedules in WebChart
    return { ...slot, id: slot.id || generateId(), meta: { lastUpdated: new Date().toISOString() } };
  }

  async updateSlot(id: string, slot: Partial<Slot>): Promise<Slot> {
    // No-op: slots are virtual in WebChart — appointment creation/cancellation
    // implicitly manages slot availability
    const existing = await this.getSlotById(id);
    return { ...(existing || { resourceType: 'Slot', schedule: { reference: '' }, start: '', end: '' } as Slot), ...slot, id, meta: { lastUpdated: new Date().toISOString() } };
  }

  async deleteSlot(_id: string): Promise<void> {
    // No-op: slots are virtual in WebChart
  }

  async deleteAllSlots(): Promise<void> {
    // No-op: slots are virtual in WebChart
  }

  // ==================== APPOINTMENT OPERATIONS ====================

  async getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]> {
    const params: Record<string, string> = {};

    if (query.status) {
      // Map FHIR status back to WebChart fields
      if (query.status === 'cancelled') {
        // Don't set canceled param — get all, then filter
      } else {
        params.canceled = '0';
        if (query.status !== 'booked') {
          params.filler_status_code = query.status;
        }
      }
    } else {
      params.canceled = '0';
    }

    if (query.patient) {
      const patId = query.patient.replace(/^Patient\//, '');
      params.pat_id = patId;
    }

    // Default: cap results to avoid loading entire history.
    // WebChart doesn't support date comparison operators.
    if (!query._count) {
      params.limit = '200';
    } else {
      params.limit = String(query._count);
    }

    const result = await this.api.get('db/appointments', Object.keys(params).length > 0 ? params : undefined);
    const rows = result?.db || result || [];

    if (!Array.isArray(rows)) return [];

    // Skip the per-appointment resource lookup for list queries to avoid
    // N+1 HTTP calls. The appointment row itself has enough info.
    const appointments: Appointment[] = rows.map(row => rowToAppointment(row));

    // Post-filter by status if needed
    if (query.status) {
      return appointments.filter(a => a.status === query.status);
    }

    return appointments;
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    const result = await this.api.get('db/appointments', { id });
    const rows = result?.db || result || [];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    let resources: any[] = [];
    try {
      const resResult = await this.api.get('db/multi_resource_apt', { apt_id: id });
      resources = resResult?.db || resResult || [];
    } catch {
      // Non-critical
    }

    return rowToAppointment(rows[0], resources);
  }

  async createAppointment(appointment: Appointment): Promise<Appointment> {
    // Extract patient ID from participant — must be numeric for WebChart
    const patientParticipant = appointment.participant.find(
      p => p.actor?.reference?.startsWith('Patient/')
    );
    const rawPatId = patientParticipant?.actor?.reference?.replace('Patient/', '') || '0';
    // Only use numeric patient IDs; unverified callers get pat_id = 0
    const patId = /^\d+$/.test(rawPatId) ? rawPatId : '0';

    // Extract provider resource ID from participant
    const providerParticipant = appointment.participant.find(
      p => p.actor?.reference?.startsWith('Practitioner/')
    );
    const resourceId = providerParticipant?.actor?.reference?.replace('Practitioner/', '');

    // Convert ISO timestamps to WebChart format (YYYY-MM-DD HH:mm:ss)
    // using clinic timezone when available
    const toWcDate = (iso: string) => this.utcToWcDate(new Date(iso));

    // Build WebChart appointment payload
    const startMs = new Date(appointment.start!).getTime();
    const endMs = new Date(appointment.end!).getTime();
    const durationMin = Math.round((endMs - startMs) / 60000);

    const wcAppointment: Record<string, unknown> = {
      pat_id: patId,
      startdate: toWcDate(appointment.start!),
      enddate: toWcDate(appointment.end!),
      pat_duration: durationMin,
      location: this.defaultLocation,
      filler_status_code: 'BOOKED',
      reason: appointment.description || appointment.reasonCode?.[0]?.text || '',
      comment: appointment.comment || '',
      patient_instructions: appointment.patientInstruction || '',
    };

    // Store booking reference as external_id
    const bookingRef = appointment.identifier?.find(
      i => i.system === 'urn:fhirtogether:booking-reference'
    );
    if (bookingRef) {
      wcAppointment.external_id = bookingRef.value;
    }

    // Add contact info from the patient participant display name and patientInstruction
    const callerName = patientParticipant?.actor?.display;
    if (callerName) {
      wcAppointment.contact = callerName;
    }
    // Extract phone from patientInstruction (format: "Self-reported contact: Phone: XXXXX, DOB: XXXXX")
    const phoneMatch = appointment.patientInstruction?.match(/Phone:\s*(\S+)/);
    if (phoneMatch) {
      wcAppointment.contact_number = phoneMatch[1].replace(/,\s*$/, '');
    }

    // Use generic db/appointments handler (no special permissions required).
    // Provider linkage is done separately via db/multi_resource_apt below.
    const result = await this.api.post('db/appointments', wcAppointment);

    // Extract the created appointment ID from the response
    const aptId = result?.id || result?.apt_id || result?.db?.[0]?.id || generateId();

    // Link provider/resource via multi_resource_apt (separate from the appointment insert)
    if (resourceId) {
      try {
        const numericAptId = Number(aptId);
        if (!isNaN(numericAptId) && numericAptId > 0) {
          await this.api.post('db/multi_resource_apt', {
            apt_id: numericAptId,
            res_id: Number(resourceId),
          });
        }
      } catch (resErr) {
        // Non-critical — appointment was created, just the provider link failed
      }
    }

    return {
      ...appointment,
      id: String(aptId),
      status: 'booked',
      created: new Date().toISOString(),
      meta: { lastUpdated: new Date().toISOString() },
    };
  }

  async updateAppointment(id: string, appointment: Partial<Appointment>): Promise<Appointment> {
    const existing = await this.getAppointmentById(id);
    if (!existing) throw new Error(`Appointment ${id} not found`);

    const updatePayload: Record<string, unknown> = {
      apt_id: Number(id),
    };

    if (appointment.start) updatePayload.startdate = appointment.start;
    if (appointment.end) updatePayload.enddate = appointment.end;
    if (appointment.description) updatePayload.reason = appointment.description;
    if (appointment.comment) updatePayload.comment = appointment.comment;

    // Handle cancellation
    if (appointment.status === 'cancelled') {
      updatePayload.canceled = '1';
      updatePayload.cancel_code = appointment.cancelationReason?.text || 'CANCEL';
      updatePayload.cancel_date = new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    await this.api.post('db/appointments', updatePayload);

    const updated = { ...existing, ...appointment, id };
    updated.meta = { lastUpdated: new Date().toISOString() };
    return updated;
  }

  async deleteAppointment(id: string): Promise<void> {
    // In WebChart, appointments are canceled, not deleted
    await this.updateAppointment(id, {
      status: 'cancelled',
      cancelationReason: { text: 'Deleted via API' },
    });
  }

  async deleteAllAppointments(): Promise<void> {
    throw new Error('Bulk deletion is not supported via WebChart API');
  }

  async getAppointmentByIdentifier(system: string, value: string): Promise<Appointment | null> {
    // WebChart stores booking references in external_id — query directly
    if (system === 'urn:fhirtogether:booking-reference') {
      const result = await this.api.get('db/appointments', { external_id: value });
      const rows = result?.db || result || [];
      if (!Array.isArray(rows) || rows.length === 0) return null;

      let resources: any[] = [];
      try {
        const resResult = await this.api.get('db/multi_resource_apt', { apt_id: rows[0].id || rows[0].apt_id });
        resources = resResult?.db || resResult || [];
      } catch {
        // Non-critical
      }

      return rowToAppointment(rows[0], resources);
    }

    // Fallback: scan
    const appointments = await this.getAppointments({ _count: 200 });
    return appointments.find(appt =>
      appt.identifier?.some(id => id.system === system && id.value === value)
    ) || null;
  }
}
