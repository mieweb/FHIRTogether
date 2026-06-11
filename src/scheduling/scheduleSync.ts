/**
 * Schedule synchronization parser.
 *
 * Converts a remote FHIR R4 collection Bundle (e.g. WebChart's
 * `/rest/schedules` response) into self-contained Schedule resources that can
 * be persisted in the local store and re-rendered after a reload.
 *
 * The source Bundle carries Practitioner and Location resources alongside the
 * Schedules; their display names are folded into each Schedule's `actor`
 * references so the persisted Schedule stands on its own (the local store does
 * not keep separate Practitioner/Location rows).
 */

import { Schedule } from '../types/fhir';
import { AvailabilityTemplate } from './slotExpander';

/** Marker extension url stamped on every synced schedule (source endpoint). */
export const SYNC_SOURCE_EXTENSION_URL =
  'https://fhirtogether.org/fhir/StructureDefinition/synced-from';

/** FHIR availableTime extension url (days + start/end time). */
const AVAILABLE_TIME_EXTENSION_URL =
  'http://hl7.org/fhir/StructureDefinition/availableTime';

/** Suffix of WebChart's slot-length extension url (minutes per slot). */
const SLOT_LENGTH_EXTENSION_SUFFIX = 'schedule-portal-time-slots';

interface BundleEntry {
  resource?: Record<string, unknown>;
}

interface FhirBundle {
  resourceType?: string;
  type?: string;
  entry?: BundleEntry[];
}

/** Build a "Family, Given1 Given2" display name from a Practitioner resource. */
function practitionerName(resource: Record<string, unknown>): string {
  const names = resource.name as Array<{ family?: string; given?: string[] }> | undefined;
  const name = Array.isArray(names) ? names[0] : undefined;
  if (!name) return resource.id ? `Practitioner/${resource.id}` : 'Unknown';
  const given = Array.isArray(name.given) ? name.given.filter(Boolean).join(' ').trim() : '';
  const family = (name.family || '').trim();
  if (family && given) return `${family}, ${given}`;
  return family || given || (resource.id ? `Practitioner/${resource.id}` : 'Unknown');
}

/** Extract the trailing id from a "Type/id" reference. */
function refId(reference: unknown): string | undefined {
  return typeof reference === 'string' ? reference.split('/').pop() : undefined;
}

export interface ParsedSyncResult {
  schedules: Schedule[];
}

/**
 * Parse a FHIR collection Bundle into persistable Schedule resources.
 *
 * @param bundle    The parsed remote Bundle (resourceType "Bundle", type "collection").
 * @param sourceUrl The endpoint the bundle came from (stamped as a marker extension).
 * @throws Error when the payload is not a collection Bundle.
 */
export function parseScheduleBundle(bundle: unknown, sourceUrl: string): ParsedSyncResult {
  const b = bundle as FhirBundle;
  if (!b || b.resourceType !== 'Bundle') {
    throw new Error('Response is not a FHIR Bundle.');
  }
  if (b.type !== 'collection') {
    throw new Error(`Expected Bundle.type "collection" but received "${b.type ?? 'undefined'}".`);
  }

  const entries = Array.isArray(b.entry) ? b.entry : [];

  // Cross-reference maps for resolving actor display names.
  const practitioners: Record<string, string> = {};
  const locations: Record<string, string> = {};
  for (const entry of entries) {
    const resource = entry?.resource;
    if (!resource || resource.id == null) continue;
    if (resource.resourceType === 'Practitioner') {
      practitioners[String(resource.id)] = practitionerName(resource);
    } else if (resource.resourceType === 'Location') {
      locations[String(resource.id)] = (resource.name as string) || `Location/${resource.id}`;
    }
  }

  const schedules: Schedule[] = [];
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Schedule') continue;

    const actorIn = Array.isArray(resource.actor)
      ? (resource.actor as Array<Record<string, unknown>>)
      : [];

    // Enrich actor references with resolved display names so the persisted
    // Schedule is self-contained after Practitioner/Location entries are gone.
    const actor = actorIn.map((a) => {
      const reference = typeof a.reference === 'string' ? a.reference : undefined;
      const id = refId(reference);
      let display = typeof a.display === 'string' ? a.display : undefined;
      if (!display && id && reference?.startsWith('Practitioner/')) {
        display = practitioners[id];
      }
      if (!display && id && reference?.startsWith('Location/')) {
        display = locations[id];
      }
      return display ? { reference, display } : { reference };
    });

    const extension: Array<Record<string, unknown>> = Array.isArray(resource.extension)
      ? (resource.extension as Array<Record<string, unknown>>).filter(
          (e) => e && e.url !== SYNC_SOURCE_EXTENSION_URL
        )
      : [];
    // Stamp the source endpoint so the grid can identify synced schedules.
    extension.push({ url: SYNC_SOURCE_EXTENSION_URL, valueString: sourceUrl });

    const schedule: Schedule = {
      resourceType: 'Schedule',
      id: resource.id != null ? String(resource.id) : undefined,
      active: resource.active === undefined ? true : Boolean(resource.active),
      actor: actor as Schedule['actor'],
      serviceType: Array.isArray(resource.serviceType)
        ? (resource.serviceType as Schedule['serviceType'])
        : undefined,
      planningHorizon: (resource.planningHorizon as Schedule['planningHorizon']) || undefined,
      comment: typeof resource.comment === 'string' ? resource.comment : undefined,
      extension,
    };

    schedules.push(schedule);
  }

  return { schedules };
}

/** Helper used by tests/callers: does this schedule carry the sync marker? */
export function isSyncedSchedule(schedule: { extension?: Array<Record<string, unknown>> }): boolean {
  return Array.isArray(schedule.extension)
    && schedule.extension.some((e) => e?.url === SYNC_SOURCE_EXTENSION_URL);
}

/** Format a Date as a local "YYYY-MM-DD" string. */
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface SlotTemplateResult {
  /** The expandable template, or null when no bookable window could be derived. */
  template: AvailabilityTemplate | null;
  /** Human-readable reason when no template/slots could be produced. */
  note?: string;
}

/**
 * Convert a synced Schedule's `availableTime` + slot-length extensions into an
 * AvailabilityTemplate suitable for {@link expandSlots}.
 *
 * The weekly availability is projected *forward from today* through the
 * schedule's `planningHorizon.end`. WebChart horizons are often historical
 * single-day windows, so a schedule whose horizon already ended yields no
 * slots — surfaced via the returned `note`.
 */
export function buildSlotTemplate(
  schedule: Schedule,
  today: string = toDateString(new Date()),
): SlotTemplateResult {
  const ext = Array.isArray(schedule.extension) ? schedule.extension : [];

  const availExt = ext.find((e) => e?.url === AVAILABLE_TIME_EXTENSION_URL);
  const availArr = availExt?.availableTime as
    | Array<{ daysOfWeek?: string[]; availableStartTime?: string; availableEndTime?: string }>
    | undefined;
  const avail = Array.isArray(availArr) ? availArr[0] : undefined;
  if (!avail || !avail.availableStartTime || !avail.availableEndTime) {
    return { template: null, note: 'no availableTime defined' };
  }

  const slotExt = ext.find(
    (e) => typeof e?.url === 'string' && (e.url as string).endsWith(SLOT_LENGTH_EXTENSION_SUFFIX),
  );
  const slotMinutes =
    slotExt && typeof slotExt.valueInteger === 'number' && (slotExt.valueInteger as number) > 0
      ? (slotExt.valueInteger as number)
      : 30;

  const weekdays =
    Array.isArray(avail.daysOfWeek) && avail.daysOfWeek.length > 0
      ? avail.daysOfWeek
      : ['mon', 'tue', 'wed', 'thu', 'fri'];

  const ph = schedule.planningHorizon || {};
  const horizonStart = typeof ph.start === 'string' ? ph.start.slice(0, 10) : '';
  const horizonEnd = typeof ph.end === 'string' ? ph.end.slice(0, 10) : '';

  // Project forward: never generate slots before today.
  const startDate = horizonStart && horizonStart > today ? horizonStart : today;
  const endDate = horizonEnd;

  if (!endDate) {
    return { template: null, note: 'no planningHorizon end date' };
  }
  if (endDate < startDate) {
    return { template: null, note: `planning horizon ended ${endDate} (in the past)` };
  }

  const template: AvailabilityTemplate = {
    startDate,
    endDate,
    weekdays,
    blocks: [
      {
        start: avail.availableStartTime.slice(0, 5),
        end: avail.availableEndTime.slice(0, 5),
        duration: slotMinutes,
      },
    ],
  };
  return { template };
}

export { AVAILABLE_TIME_EXTENSION_URL };
