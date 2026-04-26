/**
 * Directory Routes
 *
 * Public endpoint for querying the provider directory.
 * Returns all active (and optionally unverified) systems with their
 * locations and providers in FHIR, JSON/YAML, or HL7v2 format.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FhirStore, SystemStatus, Schedule, Bundle, FhirResource } from '../types/fhir';

const SHOW_UNVERIFIED = process.env.DIRECTORY_SHOW_UNVERIFIED === 'true';

/** Minimal provider info extracted from a Schedule's actor + specialty. */
interface DirectoryProvider {
  name: string;
  specialty?: string;
  scheduleId: string;
}

/** Nested directory entry for JSON/YAML output. */
interface DirectoryEntry {
  system: {
    name: string;
    url?: string;
    status: SystemStatus;
  };
  locations: Array<{
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    providers: DirectoryProvider[];
  }>;
  /** Providers not tied to a specific location. */
  providers: DirectoryProvider[];
}

export async function directoryRoutes(fastify: FastifyInstance, store: FhirStore) {

  /**
   * GET /Directory — Public. Query the provider directory.
   */
  fastify.get<{
    Querystring: {
      zip?: string;
      specialty?: string;
      name?: string;
      status?: string;
      _format?: string;
    };
  }>('/Directory', {
    schema: {
      description: 'Public provider directory. Returns systems, locations, and providers. Supports FHIR JSON, plain JSON/YAML, and HL7v2 MFN formats.',
      tags: ['Directory'],
      querystring: {
        type: 'object',
        properties: {
          zip: { type: 'string', description: 'Filter by zip code' },
          specialty: { type: 'string', description: 'Filter by provider specialty' },
          name: { type: 'string', description: 'Filter by provider or system name' },
          status: { type: 'string', enum: ['active', 'unverified', 'all'], description: 'Filter by system status (default: based on DIRECTORY_SHOW_UNVERIFIED)' },
          _format: { type: 'string', enum: ['fhir', 'json', 'yaml', 'hl7'], description: 'Response format' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { zip?: string; specialty?: string; name?: string; status?: string; _format?: string } }>, reply) => {
    const { zip, specialty, name, status, _format } = request.query;

    // Determine which systems to include
    let statusFilter: SystemStatus | undefined;
    if (status === 'all') {
      statusFilter = undefined;
    } else if (status === 'unverified') {
      statusFilter = 'unverified';
    } else if (status === 'active') {
      statusFilter = 'active';
    } else {
      // Default: show active, optionally include unverified
      statusFilter = SHOW_UNVERIFIED ? undefined : 'active';
    }

    const systems = await store.getSystems(statusFilter ? { status: statusFilter } : undefined);
    // Filter out expired systems regardless
    const liveSystems = systems.filter(s => s.status !== 'expired');

    // Build directory entries
    const entries: DirectoryEntry[] = [];

    for (const sys of liveSystems) {
      if (name && !sys.name.toLowerCase().includes(name.toLowerCase())) continue;

      const locations = await store.getLocations({ systemId: sys.id, zip });
      const schedules = await store.getSchedules({ active: true, system_id: sys.id });

      // Filter by specialty if requested
      const matchingSchedules = specialty
        ? schedules.filter(s => {
            const specText = JSON.stringify(s.specialty || []).toLowerCase();
            const svcText = JSON.stringify(s.serviceType || []).toLowerCase();
            return specText.includes(specialty.toLowerCase()) || svcText.includes(specialty.toLowerCase());
          })
        : schedules;

      // Also filter by name if requested (check provider names in actor)
      const filteredSchedules = name
        ? matchingSchedules.filter(s =>
            s.actor?.some(a => a.display?.toLowerCase().includes(name.toLowerCase())) || true
          )
        : matchingSchedules;

      // Group schedules by location_id
      const schedulesByLocation = new Map<string | null, Schedule[]>();
      for (const sched of filteredSchedules) {
        const locId = (sched as Schedule & { location_id?: string }).location_id || null;
        if (!schedulesByLocation.has(locId)) schedulesByLocation.set(locId, []);
        schedulesByLocation.get(locId)!.push(sched);
      }

      const locationEntries = locations.map(loc => ({
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        zip: loc.zip,
        phone: loc.phone,
        providers: (schedulesByLocation.get(loc.id) || []).map(s => scheduleToProvider(s)),
      }));

      const unlocatedProviders = (schedulesByLocation.get(null) || []).map(s => scheduleToProvider(s));

      if (locationEntries.length > 0 || unlocatedProviders.length > 0 || filteredSchedules.length > 0) {
        entries.push({
          system: { name: sys.name, url: sys.url, status: sys.status },
          locations: locationEntries,
          providers: unlocatedProviders,
        });
      }
    }

    // Determine response format
    const accept = (request.headers.accept || '').toLowerCase();
    const format = _format || (
      accept.includes('fhir+json') ? 'fhir' :
      accept.includes('yaml') ? 'yaml' :
      accept.includes('hl7') ? 'hl7' : 'json'
    );

    if (format === 'fhir') {
      return reply.header('Content-Type', 'application/fhir+json').send(toFhirBundle(entries));
    }

    if (format === 'yaml') {
      const yamlStr = toYaml(entries);
      return reply.header('Content-Type', 'text/yaml').send(yamlStr);
    }

    if (format === 'hl7') {
      const hl7Str = toHL7MFN(entries);
      return reply.header('Content-Type', 'x-application/hl7-v2+er7').send(hl7Str);
    }

    // Default: JSON
    return { directory: entries, total: entries.length };
  });
}

function scheduleToProvider(schedule: Schedule): DirectoryProvider {
  const actor = schedule.actor?.[0];
  const specialty = schedule.specialty?.[0]?.text
    || schedule.serviceType?.[0]?.text
    || schedule.specialty?.[0]?.coding?.[0]?.display
    || undefined;

  return {
    name: actor?.display || actor?.reference || 'Unknown',
    specialty,
    scheduleId: schedule.id || '',
  };
}

/**
 * Convert directory entries to a FHIR Bundle of Organization + Location + PractitionerRole.
 */
function toFhirBundle(entries: DirectoryEntry[]): Bundle {
  const bundleEntries: Array<{ fullUrl: string; resource: FhirResource & Record<string, unknown> }> = [];

  for (const entry of entries) {
    const orgId = `org-${entry.system.name.replace(/\s+/g, '-').toLowerCase()}`;

    // Organization
    bundleEntries.push({
      fullUrl: `Organization/${orgId}`,
      resource: {
        resourceType: 'Organization',
        id: orgId,
        name: entry.system.name,
        active: entry.system.status === 'active',
        extension: entry.system.url ? [{
          url: 'http://fhirtogether.org/StructureDefinition/system-url',
          valueUrl: entry.system.url,
        }] : undefined,
        identifier: [{
          system: 'http://fhirtogether.org/system-status',
          value: entry.system.status,
        }],
      },
    });

    // Locations
    for (const loc of entry.locations) {
      const locId = `loc-${loc.name.replace(/\s+/g, '-').toLowerCase()}`;
      bundleEntries.push({
        fullUrl: `Location/${locId}`,
        resource: {
          resourceType: 'Location',
          id: locId,
          name: loc.name,
          managingOrganization: { reference: `Organization/${orgId}` },
          address: loc.address ? {
            line: [loc.address],
            city: loc.city,
            state: loc.state,
            postalCode: loc.zip,
          } : undefined,
          telecom: loc.phone ? [{ system: 'phone', value: loc.phone }] : undefined,
        },
      });

      // PractitionerRoles for this location
      for (const prov of loc.providers) {
        bundleEntries.push({
          fullUrl: `PractitionerRole/${prov.scheduleId}`,
          resource: {
            resourceType: 'PractitionerRole',
            id: prov.scheduleId,
            active: true,
            practitioner: { display: prov.name },
            organization: { reference: `Organization/${orgId}` },
            location: [{ reference: `Location/${locId}` }],
            specialty: prov.specialty ? [{ text: prov.specialty }] : undefined,
          },
        });
      }
    }

    // Un-located providers
    for (const prov of entry.providers) {
      bundleEntries.push({
        fullUrl: `PractitionerRole/${prov.scheduleId}`,
        resource: {
          resourceType: 'PractitionerRole',
          id: prov.scheduleId,
          active: true,
          practitioner: { display: prov.name },
          organization: { reference: `Organization/${orgId}` },
          specialty: prov.specialty ? [{ text: prov.specialty }] : undefined,
        },
      });
    }
  }

  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: bundleEntries.length,
    entry: bundleEntries,
  };
}

/**
 * Convert directory entries to YAML.
 * Hand-rolled to avoid a YAML library dependency.
 */
function toYaml(entries: DirectoryEntry[]): string {
  const lines: string[] = ['directory:'];

  for (const entry of entries) {
    lines.push(`  - system:`);
    lines.push(`      name: "${entry.system.name}"`);
    if (entry.system.url) lines.push(`      url: "${entry.system.url}"`);
    lines.push(`      status: ${entry.system.status}`);

    if (entry.locations.length > 0) {
      lines.push(`    locations:`);
      for (const loc of entry.locations) {
        lines.push(`      - name: "${loc.name}"`);
        if (loc.address) lines.push(`        address: "${loc.address}"`);
        if (loc.city) lines.push(`        city: "${loc.city}"`);
        if (loc.state) lines.push(`        state: "${loc.state}"`);
        if (loc.zip) lines.push(`        zip: "${loc.zip}"`);
        if (loc.phone) lines.push(`        phone: "${loc.phone}"`);
        if (loc.providers.length > 0) {
          lines.push(`        providers:`);
          for (const prov of loc.providers) {
            lines.push(`          - name: "${prov.name}"`);
            if (prov.specialty) lines.push(`            specialty: "${prov.specialty}"`);
            lines.push(`            scheduleId: "${prov.scheduleId}"`);
          }
        }
      }
    }

    if (entry.providers.length > 0) {
      lines.push(`    providers:`);
      for (const prov of entry.providers) {
        lines.push(`      - name: "${prov.name}"`);
        if (prov.specialty) lines.push(`        specialty: "${prov.specialty}"`);
        lines.push(`        scheduleId: "${prov.scheduleId}"`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Convert directory entries to HL7v2 MFN^M02 message.
 * MSH identifies the gateway; STF/PRA/ORG segments list providers.
 */
function toHL7MFN(entries: DirectoryEntry[]): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  const segments: string[] = [];

  // MSH
  segments.push(
    `MSH|^~\\&|FHIRTOGETHER|SCHEDULING_GATEWAY|||${ts}||MFN^M02|MFN-${Date.now()}|P|2.3`
  );

  // MFI — Master File Identification
  segments.push(`MFI|PRA^Practitioner Master File|PRA|UPD|||AL`);

  let setId = 0;
  for (const entry of entries) {
    for (const loc of entry.locations) {
      for (const prov of loc.providers) {
        setId++;
        // MFE — Master File Entry
        segments.push(`MFE|MAD|${prov.scheduleId}|||${prov.scheduleId}`);
        // STF — Staff Identification
        const nameParts = prov.name.replace(/^Dr\.\s*/, '').split(/\s+/);
        const familyName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : prov.name;
        const givenName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
        segments.push(`STF|${setId}|${prov.scheduleId}|${familyName}^${givenName}||||A`);
        // PRA — Practitioner Detail
        const group = `${entry.system.name}${entry.system.url ? '^' + entry.system.url : ''}`;
        segments.push(`PRA||${group}||${entry.system.status === 'active' ? 'Y' : 'N'}|${prov.specialty || ''}`);
        // ORG — Organization Unit (location info)
        segments.push(`ORG|${setId}||${loc.name}^${loc.address || ''}^${loc.city || ''}^${loc.state || ''}^${loc.zip || ''}`);
      }
    }

    // Un-located providers
    for (const prov of entry.providers) {
      setId++;
      segments.push(`MFE|MAD|${prov.scheduleId}|||${prov.scheduleId}`);
      const nameParts = prov.name.replace(/^Dr\.\s*/, '').split(/\s+/);
      const familyName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : prov.name;
      const givenName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
      segments.push(`STF|${setId}|${prov.scheduleId}|${familyName}^${givenName}||||A`);
      const group = `${entry.system.name}${entry.system.url ? '^' + entry.system.url : ''}`;
      segments.push(`PRA||${group}||${entry.system.status === 'active' ? 'Y' : 'N'}|${prov.specialty || ''}`);
    }
  }

  return segments.join('\r') + '\r';
}
