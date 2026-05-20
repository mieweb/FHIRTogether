import {
  FhirStore,
  Schedule,
  Slot,
  Appointment,
  SlotHold,
  SynapseSystem,
  SynapseLocation,
  SynapseSystemQuery,
  SynapseLocationQuery,
  MSHLookupResult,
  SystemStatus,
  HL7MessageLogEntry,
  HL7MessageLogQuery,
  FhirSlotQuery,
  FhirScheduleQuery,
  FhirAppointmentQuery,
} from '../types/fhir';
import { sha256Hex, randomHex, timingSafeEqualHex } from '../util/hash';
import { SCHEMA_VERSION, SchemaStatus } from './sqliteStore';

// Minimal D1 type — avoid depending on @cloudflare/workers-types at build time
// so this file is consumable from Node-only builds for testing too.
interface D1Result<T = unknown> { results: T[]; success: boolean; meta: { changes?: number; last_row_id?: number } }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta: { changes?: number; last_row_id?: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** A row returned from D1 queries — values are SQLite primitives */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** SQL parameter values for parameterized queries */
type SqlParam = string | number | boolean | null | undefined;

/**
 * Format a Date as a naive ISO 8601 string without timezone suffix.
 * e.g. "2026-02-17T08:00:00"
 *
 * Stored datetimes are treated as local wall-clock time.
 */
function toNaiveISO(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export interface D1StoreOptions {
  dateOffsetProvider?: () => number;
}

export class D1Store implements FhirStore {
  private readonly db: D1Database;
  private readonly dateOffsetProvider: () => number;

  constructor(db: D1Database, options: D1StoreOptions = {}) {
    this.db = db;
    this.dateOffsetProvider = options.dateOffsetProvider ?? (() => 0);
  }

  async initialize(): Promise<SchemaStatus> {
    try {
      const row = await this.db.prepare('SELECT value FROM _meta WHERE key = ?').bind('schema_version').first<{ value: string }>();
      const current = row ? parseInt(row.value, 10) : 0;
      return {
        current,
        expected: SCHEMA_VERSION,
        match: current === SCHEMA_VERSION,
        migrated: false, // D1 never migrates inline
      };
    } catch {
      // _meta table doesn't exist → migrations have not been applied
      console.warn('⚠️  D1 schema not found. Run `wrangler d1 migrations apply` to initialize the database.');
      return { current: 0, expected: SCHEMA_VERSION, match: false, migrated: false };
    }
  }

  async close(): Promise<void> {
    // No-op on D1 — the binding lives for the lifetime of the Worker.
  }

  // ==================== SYNAPSE SYSTEM OPERATIONS ====================

  async createSystem(system: Omit<SynapseSystem, 'id' | 'createdAt' | 'lastActivityAt'> & { apiKeyHash?: string; mshSecretHash?: string; challengeToken?: string }): Promise<SynapseSystem> {
    const id = this.generateId();
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      INSERT INTO systems (id, name, url, api_key_hash, msh_application, msh_facility, msh_secret_hash, challenge_token, status, last_activity_at, created_at, ttl_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      system.name,
      system.url || null,
      system.apiKeyHash || null,
      system.mshApplication || null,
      system.mshFacility || null,
      system.mshSecretHash || null,
      system.challengeToken || null,
      system.status,
      now,
      now,
      system.ttlDays,
    ).run();

    return { id, name: system.name, url: system.url, mshApplication: system.mshApplication, mshFacility: system.mshFacility, status: system.status, lastActivityAt: now, createdAt: now, ttlDays: system.ttlDays };
  }

  async findOrCreateSystemByMSH(application: string, facility: string, secret: string): Promise<MSHLookupResult> {
    const existing = await this.getSystemByMsh(application, facility);

    if (existing) {
      // Verify secret matches
      const secretHash = await sha256Hex(secret);
      const row = await this.db.prepare('SELECT msh_secret_hash FROM systems WHERE id = ?').bind(existing.id).first<{ msh_secret_hash: string }>();
      const storedHash = row?.msh_secret_hash;

      if (!storedHash) {
        // First time setting a secret for this system (e.g., legacy system)
        await this.db.prepare('UPDATE systems SET msh_secret_hash = ? WHERE id = ?').bind(secretHash, existing.id).run();
        await this.updateSystemActivity(existing.id);
        // Issue a fresh API key on every successful HL7 auth (MSH-8 verified)
        const apiKey = await this.issueApiKey(existing.id);
        return { system: existing, isNew: false, secretMatch: true, apiKey };
      }

      const match = timingSafeEqualHex(secretHash, storedHash);
      if (match) {
        await this.updateSystemActivity(existing.id);
        // Issue a fresh API key on every successful HL7 auth (MSH-8 verified)
        const apiKey = await this.issueApiKey(existing.id);
        return { system: existing, isNew: false, secretMatch: match, apiKey };
      }
      return { system: existing, isNew: false, secretMatch: match };
    }

    // Create new system — generate API key at creation time
    const secretHash = secret ? await sha256Hex(secret) : undefined;
    const apiKey = randomHex(32);
    const apiKeyHash = await sha256Hex(apiKey);
    const defaultTtl = parseInt(process.env.SYSTEM_TTL_DAYS || '7', 10);
    const system = await this.createSystem({
      name: `${application}@${facility}`,
      status: 'unverified' as SystemStatus,
      ttlDays: defaultTtl,
      mshApplication: application,
      mshFacility: facility,
      mshSecretHash: secretHash,
      apiKeyHash,
    });

    return { system, isNew: true, secretMatch: true, apiKey };
  }

  /**
   * Generate a new API key for a system and store the hash.
   * Returns the raw key (only time it's available in plaintext).
   */
  private async issueApiKey(systemId: string): Promise<string> {
    const apiKey = randomHex(32);
    const hash = await sha256Hex(apiKey);
    await this.db.prepare('UPDATE systems SET api_key_hash = ? WHERE id = ?').bind(hash, systemId).run();
    return apiKey;
  }

  async getSystemById(id: string): Promise<SynapseSystem | undefined> {
    const row = await this.db.prepare('SELECT * FROM systems WHERE id = ?').bind(id).first<DbRow>();
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystemByUrl(url: string): Promise<SynapseSystem | undefined> {
    const row = await this.db.prepare('SELECT * FROM systems WHERE url = ?').bind(url).first<DbRow>();
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystemByMsh(application: string, facility: string): Promise<SynapseSystem | undefined> {
    const row = await this.db.prepare('SELECT * FROM systems WHERE msh_application = ? AND msh_facility = ?').bind(application, facility).first<DbRow>();
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystemByApiKeyHash(hash: string): Promise<SynapseSystem | undefined> {
    const row = await this.db.prepare('SELECT * FROM systems WHERE api_key_hash = ?').bind(hash).first<DbRow>();
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystems(query?: SynapseSystemQuery): Promise<SynapseSystem[]> {
    let sql = 'SELECT * FROM systems WHERE 1=1';
    const params: SqlParam[] = [];

    if (query?.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    sql += ' ORDER BY name ASC';

    if (query?._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = (await this.db.prepare(sql).bind(...params).all<DbRow>()).results;
    return rows.map(row => this.rowToSystem(row));
  }

  async updateSystem(id: string, updates: Partial<Pick<SynapseSystem, 'name' | 'url' | 'status' | 'ttlDays'>> & { apiKeyHash?: string; challengeToken?: string }): Promise<SynapseSystem> {
    const existing = await this.getSystemById(id);
    if (!existing) throw new Error(`System ${id} not found`);

    const setClauses: string[] = [];
    const params: SqlParam[] = [];

    if (updates.name !== undefined) { setClauses.push('name = ?'); params.push(updates.name); }
    if (updates.url !== undefined) { setClauses.push('url = ?'); params.push(updates.url); }
    if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
    if (updates.ttlDays !== undefined) { setClauses.push('ttl_days = ?'); params.push(updates.ttlDays); }
    if (updates.apiKeyHash !== undefined) { setClauses.push('api_key_hash = ?'); params.push(updates.apiKeyHash); }
    if (updates.challengeToken !== undefined) { setClauses.push('challenge_token = ?'); params.push(updates.challengeToken); }

    if (setClauses.length === 0) return existing;

    params.push(id);
    await this.db.prepare(`UPDATE systems SET ${setClauses.join(', ')} WHERE id = ?`).bind(...params).run();

    return (await this.getSystemById(id))!;
  }

  async updateSystemActivity(id: string): Promise<void> {
    const now = toNaiveISO(new Date());
    await this.db.prepare('UPDATE systems SET last_activity_at = ? WHERE id = ?').bind(now, id).run();
  }

  async deleteSystem(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM systems WHERE id = ?').bind(id).run();
  }

  async getSystemChallengeToken(id: string): Promise<string | undefined> {
    const row = await this.db.prepare('SELECT challenge_token FROM systems WHERE id = ?').bind(id).first<{ challenge_token: string | null }>();
    return row?.challenge_token || undefined;
  }

  async evaporateExpiredSystems(): Promise<{ count: number; systems: Array<{ id: string; name: string; mshApplication?: string; mshFacility?: string }> }> {
    // Find expired systems: last_activity_at + ttl_days < now
    const rows = (await this.db.prepare(`
      SELECT id, name, msh_application, msh_facility FROM systems
      WHERE status != 'expired'
        AND datetime(last_activity_at, '+' || ttl_days || ' days') < datetime('now', 'localtime')
    `).bind().all<{ id: string; name: string; msh_application: string | null; msh_facility: string | null }>()).results;

    if (rows.length > 0) {
      const deleteStmts = rows.map(row =>
        this.db.prepare('DELETE FROM systems WHERE id = ?').bind(row.id)
      );
      await this.db.batch(deleteStmts);
    }

    return {
      count: rows.length,
      systems: rows.map(r => ({ id: r.id, name: r.name, mshApplication: r.msh_application || undefined, mshFacility: r.msh_facility || undefined })),
    };
  }

  // ==================== SYNAPSE LOCATION OPERATIONS ====================

  async createLocation(location: Omit<SynapseLocation, 'id' | 'createdAt'>): Promise<SynapseLocation> {
    const id = this.generateId();
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      INSERT INTO locations (id, system_id, name, address, city, state, zip, phone, hl7_location_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      location.systemId,
      location.name,
      location.address || null,
      location.city || null,
      location.state || null,
      location.zip || null,
      location.phone || null,
      location.hl7LocationId || null,
      now,
    ).run();

    return { ...location, id, createdAt: now };
  }

  async findOrCreateLocationByHL7(systemId: string, hl7LocationId: string, name: string, address?: string): Promise<SynapseLocation> {
    // Look up by system + HL7 location ID
    const existing = await this.db.prepare(
      'SELECT * FROM locations WHERE system_id = ? AND hl7_location_id = ?'
    ).bind(systemId, hl7LocationId).first<DbRow>();

    if (existing) return this.rowToLocation(existing);

    return this.createLocation({
      systemId,
      name,
      hl7LocationId,
      address,
    });
  }

  async getLocations(query?: SynapseLocationQuery): Promise<SynapseLocation[]> {
    let sql = 'SELECT * FROM locations WHERE 1=1';
    const params: SqlParam[] = [];

    if (query?.systemId) {
      sql += ' AND system_id = ?';
      params.push(query.systemId);
    }

    if (query?.zip) {
      sql += ' AND zip = ?';
      params.push(query.zip);
    }

    sql += ' ORDER BY name ASC';

    if (query?._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = (await this.db.prepare(sql).bind(...params).all<DbRow>()).results;
    return rows.map(row => this.rowToLocation(row));
  }

  async getLocationById(id: string): Promise<SynapseLocation | undefined> {
    const row = await this.db.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first<DbRow>();
    return row ? this.rowToLocation(row) : undefined;
  }

  async updateLocation(id: string, updates: Partial<Omit<SynapseLocation, 'id' | 'systemId' | 'createdAt'>>): Promise<SynapseLocation> {
    const existing = await this.getLocationById(id);
    if (!existing) throw new Error(`Location ${id} not found`);

    const setClauses: string[] = [];
    const params: SqlParam[] = [];

    if (updates.name !== undefined) { setClauses.push('name = ?'); params.push(updates.name); }
    if (updates.address !== undefined) { setClauses.push('address = ?'); params.push(updates.address); }
    if (updates.city !== undefined) { setClauses.push('city = ?'); params.push(updates.city); }
    if (updates.state !== undefined) { setClauses.push('state = ?'); params.push(updates.state); }
    if (updates.zip !== undefined) { setClauses.push('zip = ?'); params.push(updates.zip); }
    if (updates.phone !== undefined) { setClauses.push('phone = ?'); params.push(updates.phone); }

    if (setClauses.length === 0) return existing;

    params.push(id);
    await this.db.prepare(`UPDATE locations SET ${setClauses.join(', ')} WHERE id = ?`).bind(...params).run();

    return (await this.getLocationById(id))!;
  }

  async deleteLocation(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM locations WHERE id = ?').bind(id).run();
  }

  // ==================== SCHEDULE OPERATIONS ====================

  async createSchedule(schedule: Schedule & { system_id?: string; location_id?: string; availability_template?: string }): Promise<Schedule> {
    const id = schedule.id || this.generateId();
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      INSERT INTO schedules (
        id, active, service_category, service_type, specialty, actor,
        planning_horizon_start, planning_horizon_end, comment, meta_last_updated,
        system_id, location_id, availability_template
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      schedule.active ? 1 : 0,
      JSON.stringify(schedule.serviceCategory || []),
      JSON.stringify(schedule.serviceType || []),
      JSON.stringify(schedule.specialty || []),
      JSON.stringify(schedule.actor),
      schedule.planningHorizon?.start || null,
      schedule.planningHorizon?.end || null,
      schedule.comment || null,
      now,
      schedule.system_id || null,
      schedule.location_id || null,
      schedule.availability_template || null,
    ).run();

    return { ...schedule, id, meta: { lastUpdated: now } };
  }

  async getSchedules(query: FhirScheduleQuery & { system_id?: string }): Promise<Schedule[]> {
    let sql = 'SELECT s.*, sys.name AS system_name FROM schedules s LEFT JOIN systems sys ON s.system_id = sys.id WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.active !== undefined) {
      sql += ' AND s.active = ?';
      params.push(query.active ? 1 : 0);
    }

    if (query.actor) {
      sql += ' AND s.actor LIKE ?';
      params.push(`%${query.actor}%`);
    }

    if (query.date) {
      sql += ' AND (s.planning_horizon_start <= ? AND s.planning_horizon_end >= ?)';
      params.push(query.date, query.date);
    }

    if (query.system_id) {
      sql += ' AND s.system_id = ?';
      params.push(query.system_id);
    }

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = (await this.db.prepare(sql).bind(...params).all<DbRow>()).results;
    return rows.map((row) => this.rowToSchedule(row));
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    const row = await this.db.prepare('SELECT * FROM schedules WHERE id = ?').bind(id).first<DbRow>();
    return row ? this.rowToSchedule(row) : null;
  }

  async updateSchedule(id: string, schedule: Partial<Schedule>): Promise<Schedule> {
    const existing = await this.getScheduleById(id);
    if (!existing) throw new Error(`Schedule ${id} not found`);

    const updated = { ...existing, ...schedule, id };
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      UPDATE schedules SET
        active = ?, service_category = ?, service_type = ?, specialty = ?,
        actor = ?, planning_horizon_start = ?, planning_horizon_end = ?,
        comment = ?, meta_last_updated = ?
      WHERE id = ?
    `).bind(
      updated.active ? 1 : 0,
      JSON.stringify(updated.serviceCategory || []),
      JSON.stringify(updated.serviceType || []),
      JSON.stringify(updated.specialty || []),
      JSON.stringify(updated.actor),
      updated.planningHorizon?.start || null,
      updated.planningHorizon?.end || null,
      updated.comment || null,
      now,
      id
    ).run();

    return { ...updated, meta: { lastUpdated: now } };
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM schedules WHERE id = ?').bind(id).run();
  }

  async deleteAllSchedules(): Promise<void> {
    await this.db.prepare('DELETE FROM schedules').bind().run();
  }

  async setAvailabilityTemplate(scheduleId: string, template: string | null): Promise<void> {
    await this.db.prepare('UPDATE schedules SET availability_template = ? WHERE id = ?').bind(template, scheduleId).run();
  }

  async getAvailabilityTemplate(scheduleId: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT availability_template FROM schedules WHERE id = ?').bind(scheduleId).first<{ availability_template: string | null }>();
    return row?.availability_template ?? null;
  }

  // ==================== SLOT OPERATIONS ====================

  async createSlot(slot: Slot): Promise<Slot> {
    const id = slot.id || this.generateId();
    const now = toNaiveISO(new Date());

    const scheduleId = this.extractId(slot.schedule.reference);

    await this.db.prepare(`
      INSERT INTO slots (
        id, schedule_id, status, start, end, service_category, service_type,
        specialty, appointment_type, overbooked, comment, meta_last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      scheduleId,
      slot.status,
      slot.start,
      slot.end,
      JSON.stringify(slot.serviceCategory || []),
      JSON.stringify(slot.serviceType || []),
      JSON.stringify(slot.specialty || []),
      JSON.stringify(slot.appointmentType),
      slot.overbooked ? 1 : 0,
      slot.comment || null,
      now
    ).run();

    return { ...slot, id, meta: { lastUpdated: now } };
  }

  /**
   * Un-shift a date by the offset so it matches raw DB values.
   * shiftDate adds offsetDays on read; this subtracts them for queries.
   */
  private unshiftDate(isoDate: string): string {
    const offsetDays = this.dateOffsetProvider();
    if (offsetDays === 0) return isoDate;
    const date = new Date(isoDate);
    date.setDate(date.getDate() - offsetDays);
    return date.toISOString();
  }

  async getSlots(query: FhirSlotQuery): Promise<Slot[]> {
    let sql = 'SELECT * FROM slots WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.schedule) {
      const scheduleId = this.extractId(query.schedule);
      sql += ' AND schedule_id = ?';
      params.push(scheduleId);
    }

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.start) {
      sql += ' AND start >= ?';
      params.push(this.unshiftDate(query.start));
    }

    if (query.end) {
      sql += ' AND end <= ?';
      params.push(this.unshiftDate(query.end));
    }

    sql += ' ORDER BY start ASC';

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = (await this.db.prepare(sql).bind(...params).all<DbRow>()).results;
    return rows.map((row) => this.rowToSlot(row));
  }

  async getSlotById(id: string): Promise<Slot | null> {
    const row = await this.db.prepare('SELECT * FROM slots WHERE id = ?').bind(id).first<DbRow>();
    return row ? this.rowToSlot(row) : null;
  }

  async updateSlot(id: string, slot: Partial<Slot>): Promise<Slot> {
    const existing = await this.getSlotById(id);
    if (!existing) throw new Error(`Slot ${id} not found`);

    const updated = { ...existing, ...slot, id };
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      UPDATE slots SET
        status = ?, start = ?, end = ?, service_category = ?, service_type = ?,
        specialty = ?, appointment_type = ?, overbooked = ?, comment = ?,
        meta_last_updated = ?
      WHERE id = ?
    `).bind(
      updated.status,
      updated.start,
      updated.end,
      JSON.stringify(updated.serviceCategory || []),
      JSON.stringify(updated.serviceType || []),
      JSON.stringify(updated.specialty || []),
      JSON.stringify(updated.appointmentType),
      updated.overbooked ? 1 : 0,
      updated.comment || null,
      now,
      id
    ).run();

    return { ...updated, meta: { lastUpdated: now } };
  }

  async deleteSlot(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM slots WHERE id = ?').bind(id).run();
  }

  async deleteAllSlots(): Promise<void> {
    await this.db.prepare('DELETE FROM slots').bind().run();
  }

  async createSlots(slots: Omit<Slot, 'id' | 'meta'>[]): Promise<{ count: number }> {
    const now = toNaiveISO(new Date());

    const stmts = slots.map((slot) => {
      const id = this.generateId();
      const scheduleId = this.extractId(slot.schedule.reference);
      return this.db.prepare(`
        INSERT INTO slots (
          id, schedule_id, status, start, end, service_category, service_type,
          specialty, appointment_type, overbooked, comment, meta_last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        scheduleId,
        slot.status,
        slot.start,
        slot.end,
        JSON.stringify(slot.serviceCategory || []),
        JSON.stringify(slot.serviceType || []),
        JSON.stringify(slot.specialty || []),
        JSON.stringify(slot.appointmentType),
        slot.overbooked ? 1 : 0,
        slot.comment || null,
        now,
      );
    });

    await this.db.batch(stmts);
    return { count: slots.length };
  }

  async deleteSlotsBySchedule(scheduleId: string, statusFilter?: string): Promise<number> {
    let sql = 'DELETE FROM slots WHERE schedule_id = ?';
    const params: SqlParam[] = [scheduleId];
    if (statusFilter) {
      sql += ' AND status = ?';
      params.push(statusFilter);
    }
    const result = await this.db.prepare(sql).bind(...params).run();
    return result.meta.changes ?? 0;
  }

  // ==================== APPOINTMENT OPERATIONS ====================

  async createAppointment(appointment: Appointment): Promise<Appointment> {
    const id = appointment.id || this.generateId();
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      INSERT INTO appointments (
        id, status, identifier, cancelation_reason, service_category, service_type,
        specialty, appointment_type, reason_code, priority, description,
        slot_refs, start, end, created, comment, patient_instruction,
        participant, meta_last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      appointment.status,
      JSON.stringify(appointment.identifier || []),
      JSON.stringify(appointment.cancelationReason),
      JSON.stringify(appointment.serviceCategory || []),
      JSON.stringify(appointment.serviceType || []),
      JSON.stringify(appointment.specialty || []),
      JSON.stringify(appointment.appointmentType),
      JSON.stringify(appointment.reasonCode || []),
      appointment.priority || null,
      appointment.description || null,
      JSON.stringify(appointment.slot || []),
      appointment.start || null,
      appointment.end || null,
      appointment.created || now,
      appointment.comment || null,
      appointment.patientInstruction || null,
      JSON.stringify(appointment.participant),
      now
    ).run();

    // Update slot status to busy
    if (appointment.slot && appointment.slot.length > 0) {
      for (const slotRef of appointment.slot) {
        const slotId = this.extractId(slotRef.reference);
        await this.updateSlot(slotId, { status: 'busy' });
      }
    }

    return { ...appointment, id, meta: { lastUpdated: now } };
  }

  async getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]> {
    let sql = 'SELECT * FROM appointments WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.date) {
      sql += ' AND start >= ? AND start < ?';
      const startDate = query.date;
      const endDate = new Date(query.date + 'T00:00:00');
      endDate.setDate(endDate.getDate() + 1);
      params.push(startDate, endDate.toISOString().split('T')[0]);
    }

    if (query.patient) {
      sql += ' AND participant LIKE ?';
      params.push(`%${query.patient}%`);
    }

    if (query.actor) {
      // Filter by any participant actor reference (provider, patient, etc.)
      sql += ' AND participant LIKE ?';
      params.push(`%${query.actor}%`);
    }

    if (query.identifier) {
      sql += ' AND identifier LIKE ?';
      params.push(`%${query.identifier}%`);
    }

    sql += ' ORDER BY start ASC';

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = (await this.db.prepare(sql).bind(...params).all<DbRow>()).results;
    return rows.map((row) => this.rowToAppointment(row));
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    const row = await this.db.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first<DbRow>();
    return row ? this.rowToAppointment(row) : null;
  }

  async getAppointmentByIdentifier(system: string, value: string): Promise<Appointment | null> {
    // Search through appointments to find one with matching identifier
    const rows = (await this.db.prepare('SELECT * FROM appointments').bind().all<DbRow>()).results;
    for (const row of rows) {
      const identifiers = this.parseJson(row.identifier) as Array<{ system?: string; value: string }> | undefined;
      if (identifiers) {
        const match = identifiers.find(
          (id) => id.system === system && id.value === value
        );
        if (match) {
          return this.rowToAppointment(row);
        }
      }
    }
    return null;
  }

  async updateAppointment(id: string, appointment: Partial<Appointment>): Promise<Appointment> {
    const existing = await this.getAppointmentById(id);
    if (!existing) throw new Error(`Appointment ${id} not found`);

    const updated = { ...existing, ...appointment, id };
    const now = toNaiveISO(new Date());

    await this.db.prepare(`
      UPDATE appointments SET
        status = ?, cancelation_reason = ?, description = ?, start = ?,
        end = ?, comment = ?, participant = ?, identifier = ?,
        meta_last_updated = ?
      WHERE id = ?
    `).bind(
      updated.status,
      JSON.stringify(updated.cancelationReason),
      updated.description || null,
      updated.start || null,
      updated.end || null,
      updated.comment || null,
      JSON.stringify(updated.participant),
      JSON.stringify(updated.identifier || null),
      now,
      id
    ).run();

    return { ...updated, meta: { lastUpdated: now } };
  }

  async deleteAppointment(id: string): Promise<void> {
    const appointment = await this.getAppointmentById(id);

    // Free up slots
    if (appointment?.slot) {
      for (const slotRef of appointment.slot) {
        const slotId = this.extractId(slotRef.reference);
        await this.updateSlot(slotId, { status: 'free' });
      }
    }

    await this.db.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
  }

  async deleteAllAppointments(): Promise<void> {
    await this.db.prepare('DELETE FROM appointments').bind().run();
  }

  // ==================== SLOT HOLD OPERATIONS ====================

  async holdSlot(slotId: string, sessionId: string, durationMinutes: number): Promise<SlotHold> {
    // First, clean up expired holds
    await this.cleanupExpiredHolds();

    // Check if slot exists and is free
    const slot = await this.getSlotById(slotId);
    if (!slot) {
      throw new Error(`Slot ${slotId} not found`);
    }
    if (slot.status !== 'free') {
      throw new Error(`Slot ${slotId} is not available`);
    }

    // Check if there's already an active hold on this slot
    const existingHold = await this.getActiveHold(slotId);
    if (existingHold) {
      // If the hold is from the same session, extend it
      if (existingHold.sessionId === sessionId) {
        const newExpiry = toNaiveISO(new Date(Date.now() + durationMinutes * 60 * 1000));
        await this.db.prepare('UPDATE slot_holds SET expires_at = ? WHERE id = ?').bind(newExpiry, existingHold.id).run();
        return { ...existingHold, expiresAt: newExpiry };
      }
      throw new Error(`Slot ${slotId} is already held by another user`);
    }

    // Create new hold
    const id = this.generateId();
    const holdToken = `hold-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = toNaiveISO(new Date());
    const expiresAt = toNaiveISO(new Date(Date.now() + durationMinutes * 60 * 1000));

    await this.db.prepare(`
      INSERT INTO slot_holds (id, slot_id, hold_token, session_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, slotId, holdToken, sessionId, expiresAt, now).run();

    return {
      id,
      slotId,
      holdToken,
      sessionId,
      expiresAt,
      createdAt: now,
    };
  }

  async releaseHold(holdToken: string): Promise<void> {
    await this.db.prepare('DELETE FROM slot_holds WHERE hold_token = ?').bind(holdToken).run();
  }

  async getActiveHold(slotId: string): Promise<SlotHold | null> {
    const now = toNaiveISO(new Date());
    const row = await this.db.prepare(
      'SELECT * FROM slot_holds WHERE slot_id = ? AND expires_at > ?'
    ).bind(slotId, now).first<DbRow>();

    return row ? this.rowToSlotHold(row) : null;
  }

  async getHoldByToken(holdToken: string): Promise<SlotHold | null> {
    const row = await this.db.prepare(
      'SELECT * FROM slot_holds WHERE hold_token = ?'
    ).bind(holdToken).first<DbRow>();

    return row ? this.rowToSlotHold(row) : null;
  }

  async cleanupExpiredHolds(): Promise<number> {
    const now = toNaiveISO(new Date());
    const result = await this.db.prepare('DELETE FROM slot_holds WHERE expires_at <= ?').bind(now).run();
    return result.meta.changes ?? 0;
  }

  async clearAllHolds(): Promise<number> {
    const result = await this.db.prepare('DELETE FROM slot_holds').bind().run();
    return result.meta.changes ?? 0;
  }

  // ==================== HL7 MESSAGE LOG OPERATIONS ====================

  async logHL7Message(entry: Omit<HL7MessageLogEntry, 'id'>): Promise<HL7MessageLogEntry> {
    const id = this.generateId();
    await this.db.prepare(`
      INSERT INTO hl7_message_log (id, received_at, source, remote_address, message_type, trigger_event, control_id, raw_message, ack_response, ack_code, processing_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      entry.receivedAt,
      entry.source,
      entry.remoteAddress || null,
      entry.messageType || null,
      entry.triggerEvent || null,
      entry.controlId || null,
      entry.rawMessage,
      entry.ackResponse || null,
      entry.ackCode || null,
      entry.processingMs ?? null,
    ).run();
    return { id, ...entry };
  }

  async getHL7MessageLog(query?: HL7MessageLogQuery): Promise<HL7MessageLogEntry[]> {
    const conditions: string[] = [];
    const params: SqlParam[] = [];

    if (query?.source) {
      conditions.push('source = ?');
      params.push(query.source);
    }
    if (query?.messageType) {
      conditions.push('message_type = ?');
      params.push(query.messageType);
    }
    if (query?.ackCode) {
      conditions.push('ack_code = ?');
      params.push(query.ackCode);
    }
    if (query?.since) {
      conditions.push('received_at >= ?');
      params.push(query.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query?._count ?? 100;

    const rows = (await this.db.prepare(
      `SELECT * FROM hl7_message_log ${where} ORDER BY received_at DESC LIMIT ?`
    ).bind(...params, limit).all<DbRow>()).results;

    return rows.map(row => this.rowToHL7LogEntry(row));
  }

  async cleanupHL7MessageLog(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = toNaiveISO(cutoff);
    const result = await this.db.prepare('DELETE FROM hl7_message_log WHERE received_at < ?').bind(cutoffStr).run();
    return result.meta.changes ?? 0;
  }

  // ==================== HELPER METHODS ====================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractId(reference: string): string {
    return reference.split('/').pop() || reference;
  }

  private rowToSchedule(row: DbRow): Schedule {
    const schedule: Schedule = {
      resourceType: 'Schedule',
      id: row.id,
      active: row.active === 1,
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      actor: this.parseJson(row.actor),
      planningHorizon: row.planning_horizon_start ? {
        start: row.planning_horizon_start,
        end: row.planning_horizon_end,
      } : undefined,
      comment: row.comment,
      meta: { lastUpdated: row.meta_last_updated },
    };

    // Build FHIR extensions array
    const extensions: { url: string; valueString?: string }[] = [];

    if (row.system_name) {
      extensions.push({
        url: 'https://fhirtogether.org/fhir/StructureDefinition/system-name',
        valueString: row.system_name,
      });
    }

    if (row.availability_template) {
      extensions.push({
        url: 'https://fhirtogether.org/StructureDefinition/availability-template',
        valueString: row.availability_template,
      });
    }

    if (extensions.length > 0) {
      (schedule as Schedule & { extension?: unknown[] }).extension = extensions;
    }

    return schedule;
  }

  private rowToSlot(row: DbRow): Slot {
    return {
      resourceType: 'Slot',
      id: row.id,
      schedule: { reference: `Schedule/${row.schedule_id}` },
      status: row.status,
      start: row.start,
      end: row.end,
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      appointmentType: this.parseJson(row.appointment_type),
      overbooked: row.overbooked === 1,
      comment: row.comment,
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToAppointment(row: DbRow): Appointment {
    return {
      resourceType: 'Appointment',
      id: row.id,
      status: row.status,
      identifier: this.parseJson(row.identifier),
      cancelationReason: this.parseJson(row.cancelation_reason),
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      appointmentType: this.parseJson(row.appointment_type),
      reasonCode: this.parseJson(row.reason_code),
      priority: row.priority,
      description: row.description,
      slot: this.parseJson(row.slot_refs),
      start: row.start,
      end: row.end,
      created: row.created,
      comment: row.comment,
      patientInstruction: row.patient_instruction,
      participant: this.parseJson(row.participant),
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToSlotHold(row: DbRow): SlotHold {
    return {
      id: row.id,
      slotId: row.slot_id,
      holdToken: row.hold_token,
      sessionId: row.session_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private rowToHL7LogEntry(row: DbRow): HL7MessageLogEntry {
    return {
      id: row.id,
      receivedAt: row.received_at,
      source: row.source,
      remoteAddress: row.remote_address || undefined,
      messageType: row.message_type || undefined,
      triggerEvent: row.trigger_event || undefined,
      controlId: row.control_id || undefined,
      rawMessage: row.raw_message,
      ackResponse: row.ack_response || undefined,
      ackCode: row.ack_code || undefined,
      processingMs: row.processing_ms ?? undefined,
    };
  }

  private rowToSystem(row: DbRow): SynapseSystem {
    return {
      id: row.id,
      name: row.name,
      url: row.url || undefined,
      mshApplication: row.msh_application || undefined,
      mshFacility: row.msh_facility || undefined,
      status: row.status as SystemStatus,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      ttlDays: row.ttl_days,
    };
  }

  private rowToLocation(row: DbRow): SynapseLocation {
    return {
      id: row.id,
      systemId: row.system_id,
      name: row.name,
      address: row.address || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      zip: row.zip || undefined,
      phone: row.phone || undefined,
      hl7LocationId: row.hl7_location_id || undefined,
      createdAt: row.created_at,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseJson(value: string | null): any {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
