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

/** Marker extension url stamped on every synced schedule (source endpoint). */
export const SYNC_SOURCE_EXTENSION_URL =
  'https://fhirtogether.org/fhir/StructureDefinition/synced-from';

/** FHIR availableTime extension url (days + start/end time). */
const AVAILABLE_TIME_EXTENSION_URL =
  'http://hl7.org/fhir/StructureDefinition/availableTime';

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

export { AVAILABLE_TIME_EXTENSION_URL };
