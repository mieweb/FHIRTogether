import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Appointment, Schedule, Slot, Bundle } from '../types';

type ViewMode = 'day' | 'week';

interface AppointmentListProps {
  /** Base URL of the FHIR server */
  fhirBaseUrl: string;
  /** Pre-select a provider by schedule ID (from URL parameter) */
  initialScheduleId?: string;
  /** Initial date to display (ISO date string, e.g. '2026-04-28') */
  initialDate?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format time for display (e.g., "2:30 PM")
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date header (e.g., "Tuesday, February 17")
 */
function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format short date (e.g., "Mon 2/17")
 */
function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
}

/**
 * Format duration between two ISO strings
 */
function formatDuration(start: string, end: string): string {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

/**
 * Get the local date string (YYYY-MM-DD) for a date.
 * Uses local time components to stay consistent with naive (no-timezone) datetimes.
 */
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the Monday of the week containing the given date
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = start of week
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Get array of 7 date strings for the week containing the given date
 */
function getWeekDates(date: Date): string[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toDateString(d);
  });
}

/**
 * Get patient display name from appointment participants.
 * PHI is redacted by the API — patient display names are stripped.
 * The provider view shows blocked time, not patient identities.
 */
function getPatientDisplay(appointment: Appointment): string {
  const patient = appointment.participant?.find(
    (p) => p.actor?.reference?.includes('Patient/')
  );
  return patient?.actor?.display || 'Blocked';
}

/**
 * Get location display name from appointment participants
 */
function getLocationDisplay(appointment: Appointment): string | null {
  const location = appointment.participant?.find(
    (p) => p.actor?.reference?.includes('Location/')
  );
  return location?.actor?.display || null;
}

/**
 * Get provider display name from schedule
 */
function getProviderName(schedule: Schedule): string {
  const firstActor = schedule.actor?.[0];
  return firstActor?.display || firstActor?.reference?.split('/').pop() || 'Provider';
}

/**
 * Status badge color mapping
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'booked': return '#2563eb';
    case 'arrived': return '#059669';
    case 'fulfilled': return '#16a34a';
    case 'cancelled': return '#dc2626';
    case 'noshow': return '#ea580c';
    case 'pending': return '#d97706';
    case 'proposed': return '#7c3aed';
    case 'checked-in': return '#0891b2';
    default: return '#6b7280';
  }
}

/**
 * Slot status badge color mapping
 */
function getSlotStatusColor(status: string): string {
  switch (status) {
    case 'free': return '#059669';
    case 'busy': return '#dc2626';
    case 'busy-unavailable': return '#6b7280';
    case 'busy-tentative': return '#d97706';
    default: return '#9ca3af';
  }
}

/**
 * Slot status display label
 */
function getSlotStatusLabel(status: string): string {
  switch (status) {
    case 'free': return 'Free';
    case 'busy': return 'Busy';
    case 'busy-unavailable': return 'Blocked';
    case 'busy-tentative': return 'Tentative';
    default: return status;
  }
}

/** Unified timeline entry — either an appointment or a slot */
type TimelineEntry =
  | { kind: 'appointment'; data: Appointment }
  | { kind: 'slot'; data: Slot };

/**
 * Group timeline entries by date, sorted by start time
 */
function groupByDate(entries: TimelineEntry[]): Record<string, TimelineEntry[]> {
  const groups: Record<string, TimelineEntry[]> = {};
  for (const entry of entries) {
    const startTime = entry.kind === 'appointment' ? entry.data.start : entry.data.start;
    if (!startTime) continue;
    const dateKey = startTime.split('T')[0];
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(entry);
  }
  // Sort each group by start time
  for (const group of Object.values(groups)) {
    group.sort((a, b) => {
      const aStart = a.kind === 'appointment' ? a.data.start! : a.data.start;
      const bStart = b.kind === 'appointment' ? b.data.start! : b.data.start;
      return new Date(aStart).getTime() - new Date(bStart).getTime();
    });
  }
  return groups;
}

export function AppointmentList({ fhirBaseUrl, initialScheduleId, initialDate, className = '' }: AppointmentListProps) {
  const [providers, setProviders] = useState<Schedule[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Schedule | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialDate) {
      const d = new Date(initialDate + 'T00:00:00');
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  });

  const headers = useMemo(() => ({ 'Content-Type': 'application/json' }), []);

  // Fetch providers on mount
  useEffect(() => {
    async function fetchProviders() {
      setProvidersLoading(true);
      try {
        const res = await fetch(`${fhirBaseUrl}/Schedule?active=true`, { headers });
        if (!res.ok) throw new Error(`Failed to fetch providers: ${res.statusText}`);
        const bundle: Bundle<Schedule> = await res.json();
        const list = bundle.entry?.map((e) => e.resource) || [];
        setProviders(list);
        // Pre-select provider from URL parameter, or fall back to first
        const match = initialScheduleId
          ? list.find((p) => p.id === initialScheduleId)
          : null;
        if (match) {
          setSelectedProvider(match);
        } else if (list.length > 0) {
          setSelectedProvider(list[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load providers');
      } finally {
        setProvidersLoading(false);
      }
    }
    fetchProviders();
  }, [fhirBaseUrl, headers, initialScheduleId]);

  // Compute the date range for fetching
  const dateRange = useMemo(() => {
    if (viewMode === 'day') {
      const dateStr = toDateString(currentDate);
      return { start: dateStr, end: dateStr };
    }
    const weekDates = getWeekDates(currentDate);
    return { start: weekDates[0], end: weekDates[6] };
  }, [viewMode, currentDate]);

  // Fetch appointments and slots when provider or date range changes
  useEffect(() => {
    if (!selectedProvider) return;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const practitionerRef = selectedProvider!.actor?.[0]?.reference || `Schedule/${selectedProvider!.id}`;
        const scheduleId = selectedProvider!.id!;
        
        // Fetch appointments day-by-day
        const startDate = new Date(dateRange.start + 'T00:00:00');
        const endDate = new Date(dateRange.end + 'T23:59:59');
        const allAppointments: Appointment[] = [];
        const current = new Date(startDate);
        
        while (current <= endDate) {
          const dateStr = toDateString(current);
          const params = new URLSearchParams({ date: dateStr, actor: practitionerRef });
          const res = await fetch(`${fhirBaseUrl}/Appointment?${params}`, { headers });
          if (res.ok) {
            const bundle: Bundle<Appointment> = await res.json();
            const dayAppts = bundle.entry?.map((e) => e.resource) || [];
            allAppointments.push(...dayAppts);
          }
          current.setDate(current.getDate() + 1);
        }
        setAppointments(allAppointments);

        // Fetch all slots (any status) for this schedule in the date range
        const slotParams = new URLSearchParams({
          schedule: `Schedule/${scheduleId}`,
          start: `${dateRange.start}T00:00:00`,
          end: `${dateRange.end}T23:59:59`,
        });
        const slotRes = await fetch(`${fhirBaseUrl}/Slot?${slotParams}`, { headers });
        if (slotRes.ok) {
          const slotBundle: Bundle<Slot> = await slotRes.json();
          setSlots(slotBundle.entry?.map((e) => e.resource) || []);
        } else {
          setSlots([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [selectedProvider, dateRange, fhirBaseUrl, headers]);

  // Merge appointments and slots into a unified timeline
  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];
    for (const appt of appointments) {
      entries.push({ kind: 'appointment', data: appt });
    }
    for (const slot of slots) {
      entries.push({ kind: 'slot', data: slot });
    }
    return entries;
  }, [appointments, slots]);

  const groupedTimeline = useMemo(() => groupByDate(timeline), [timeline]);

  // Slot summary counts per day
  const slotSummary = useMemo(() => {
    const summary: Record<string, { free: number; busy: number; blocked: number }> = {};
    for (const slot of slots) {
      const dateKey = slot.start.split('T')[0];
      if (!summary[dateKey]) summary[dateKey] = { free: 0, busy: 0, blocked: 0 };
      if (slot.status === 'free') summary[dateKey].free++;
      else if (slot.status === 'busy' || slot.status === 'busy-tentative') summary[dateKey].busy++;
      else if (slot.status === 'busy-unavailable') summary[dateKey].blocked++;
    }
    return summary;
  }, [slots]);
  
  // Dates to display (either single day or week)
  const displayDates = useMemo(() => {
    if (viewMode === 'day') return [toDateString(currentDate)];
    return getWeekDates(currentDate);
  }, [viewMode, currentDate]);

  const navigateBack = useCallback(() => {
    const newDate = new Date(currentDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() - 1);
    } else {
      newDate.setDate(newDate.getDate() - 7);
    }
    setCurrentDate(newDate);
  }, [currentDate, viewMode]);

  const navigateForward = useCallback(() => {
    const newDate = new Date(currentDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + 1);
    } else {
      newDate.setDate(newDate.getDate() + 7);
    }
    setCurrentDate(newDate);
  }, [currentDate, viewMode]);

  const navigateToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const dateLabel = useMemo(() => {
    if (viewMode === 'day') {
      return formatDateHeader(toDateString(currentDate));
    }
    const weekDates = getWeekDates(currentDate);
    const startLabel = formatShortDate(weekDates[0]);
    const endLabel = formatShortDate(weekDates[6]);
    return `${startLabel} — ${endLabel}`;
  }, [viewMode, currentDate]);

  const totalCount = appointments.length;
  const totalSlots = slots.length;
  const freeSlots = slots.filter((s) => s.status === 'free').length;

  if (providersLoading) {
    return (
      <div className={`fs-scheduler-widget fs-appointment-list ${className}`}>
        <div className="fs-loading">
          <div className="fs-loading-spinner">
            <svg className="fs-spinner" viewBox="0 0 50 50" aria-label="Loading providers">
              <circle className="fs-spinner-track" cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
              <circle className="fs-spinner-head" cx="25" cy="25" r="20" fill="none" strokeWidth="4" strokeDasharray="80, 200" strokeLinecap="round" />
            </svg>
            <span className="fs-loading-text">Loading providers...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fs-scheduler-widget fs-appointment-list ${className}`}>
      {/* Header */}
      <header className="fs-apptlist-header">
        <h2 className="fs-section-title">Appointments</h2>
      </header>

      {/* Provider selector */}
      <section className="fs-apptlist-provider-select" aria-label="Select provider">
        <label htmlFor="apptlist-provider" className="fs-apptlist-label">Provider</label>
        <select
          id="apptlist-provider"
          className="fs-apptlist-select"
          value={selectedProvider?.id || ''}
          onChange={(e) => {
            const provider = providers.find((p) => p.id === e.target.value);
            setSelectedProvider(provider || null);
          }}
          aria-label="Select a provider to view appointments"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {getProviderName(p)}
            </option>
          ))}
        </select>
      </section>

      {/* Date navigation + view toggle */}
      <section className="fs-apptlist-controls" aria-label="Date navigation">
        <div className="fs-apptlist-nav">
          <button
            type="button"
            className="fs-month-nav-btn"
            onClick={navigateBack}
            aria-label={viewMode === 'day' ? 'Previous day' : 'Previous week'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            className="fs-apptlist-today-btn"
            onClick={navigateToday}
            aria-label="Go to today"
          >
            Today
          </button>

          <span className="fs-apptlist-date-label">{dateLabel}</span>

          <button
            type="button"
            className="fs-month-nav-btn"
            onClick={navigateForward}
            aria-label={viewMode === 'day' ? 'Next day' : 'Next week'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="fs-view-toggle" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'day'}
            className={`fs-view-toggle-btn ${viewMode === 'day' ? 'fs-active' : ''}`}
            onClick={() => setViewMode('day')}
          >
            Day
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'week'}
            className={`fs-view-toggle-btn ${viewMode === 'week' ? 'fs-active' : ''}`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="fs-apptlist-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="fs-loading">
          <div className="fs-loading-spinner">
            <svg className="fs-spinner" viewBox="0 0 50 50" aria-label="Loading appointments">
              <circle className="fs-spinner-track" cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
              <circle className="fs-spinner-head" cx="25" cy="25" r="20" fill="none" strokeWidth="4" strokeDasharray="80, 200" strokeLinecap="round" />
            </svg>
            <span className="fs-loading-text">Loading appointments...</span>
          </div>
        </div>
      )}

      {/* Appointments */}
      {!loading && !error && (
        <section className="fs-apptlist-content" aria-label="Schedule timeline">
          <p className="fs-apptlist-summary">
            {totalCount === 0 && totalSlots === 0
              ? 'No appointments or slots'
              : `${totalCount} appointment${totalCount !== 1 ? 's' : ''}${totalSlots > 0 ? ` · ${freeSlots} free / ${totalSlots} slots` : ''}`}
          </p>

          {displayDates.map((dateStr) => {
            const dayEntries = groupedTimeline[dateStr] || [];
            const daySummary = slotSummary[dateStr];
            const showDateHeader = viewMode === 'week';

            return (
              <div key={dateStr} className="fs-apptlist-day">
                {showDateHeader && (
                  <h3 className="fs-apptlist-day-header">
                    {formatDateHeader(dateStr)}
                    <span className="fs-apptlist-day-count">
                      {dayEntries.length > 0 ? `${dayEntries.length} item${dayEntries.length !== 1 ? 's' : ''}` : 'None'}
                    </span>
                  </h3>
                )}

                {/* Slot availability summary bar */}
                {daySummary && (
                  <div className="fs-slot-summary" aria-label="Slot availability summary">
                    {daySummary.free > 0 && (
                      <span className="fs-slot-badge fs-slot-free">{daySummary.free} Free</span>
                    )}
                    {daySummary.busy > 0 && (
                      <span className="fs-slot-badge fs-slot-busy">{daySummary.busy} Busy</span>
                    )}
                    {daySummary.blocked > 0 && (
                      <span className="fs-slot-badge fs-slot-blocked">{daySummary.blocked} Blocked</span>
                    )}
                  </div>
                )}

                {dayEntries.length === 0 && viewMode === 'day' && (
                  <div className="fs-apptlist-empty">
                    <p>No appointments or slots on this day.</p>
                  </div>
                )}

                {dayEntries.map((entry) => {
                  if (entry.kind === 'appointment') {
                    const appt = entry.data;
                    return (
                      <article
                        key={`appt-${appt.id}`}
                        className="fs-apptlist-card"
                        aria-label={`Appointment at ${formatTime(appt.start!)}`}
                      >
                        <div className="fs-apptlist-card-time">
                          <span className="fs-apptlist-time-start">{formatTime(appt.start!)}</span>
                          <span className="fs-apptlist-time-end">{formatTime(appt.end!)}</span>
                          <span className="fs-apptlist-duration">{formatDuration(appt.start!, appt.end!)}</span>
                        </div>
                        <div className="fs-apptlist-card-details">
                          <div className="fs-apptlist-card-header">
                            <span className="fs-apptlist-patient">{getPatientDisplay(appt)}</span>
                            <span
                              className="fs-apptlist-status"
                              style={{ backgroundColor: getStatusColor(appt.status) }}
                            >
                              {appt.status}
                            </span>
                          </div>
                          {appt.description && (
                            <p className="fs-apptlist-type">{appt.description}</p>
                          )}
                          {appt.appointmentType?.text && (
                            <p className="fs-apptlist-type">{appt.appointmentType.text}</p>
                          )}
                          {getLocationDisplay(appt) && (
                            <p className="fs-apptlist-location">{getLocationDisplay(appt)}</p>
                          )}
                        </div>
                      </article>
                    );
                  }
                  // Slot entry
                  const slot = entry.data;
                  return (
                    <article
                      key={`slot-${slot.id}`}
                      className={`fs-apptlist-card fs-slot-card fs-slot-card-${slot.status}`}
                      aria-label={`${getSlotStatusLabel(slot.status)} slot at ${formatTime(slot.start)}`}
                    >
                      <div className="fs-apptlist-card-time">
                        <span className="fs-apptlist-time-start">{formatTime(slot.start)}</span>
                        <span className="fs-apptlist-time-end">{formatTime(slot.end)}</span>
                        <span className="fs-apptlist-duration">{formatDuration(slot.start, slot.end)}</span>
                      </div>
                      <div className="fs-apptlist-card-details">
                        <div className="fs-apptlist-card-header">
                          <span className="fs-apptlist-patient fs-slot-label">
                            {getSlotStatusLabel(slot.status)}
                          </span>
                          <span
                            className="fs-apptlist-status"
                            style={{ backgroundColor: getSlotStatusColor(slot.status) }}
                          >
                            {slot.status}
                          </span>
                        </div>
                        {slot.comment && (
                          <p className="fs-apptlist-type">{slot.comment}</p>
                        )}
                        {slot.serviceType?.[0]?.text && (
                          <p className="fs-apptlist-type">{slot.serviceType[0].text}</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
