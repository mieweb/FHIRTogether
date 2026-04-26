/**
 * SMART Scheduling Links Routes
 *
 * Implements the SMART Scheduling Links specification for bulk publication
 * of scheduling data. This enables interoperability with the SMART Scheduling
 * Links ecosystem and compatibility with the Inferno test suite.
 *
 * Spec: https://github.com/smart-on-fhir/smart-scheduling-links/blob/master/specification.md
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore, SynapseLocation } from '../types/fhir';

/** Configuration for SMART Scheduling Links feature */
export interface SmartSchedulingConfig {
  enabled: boolean;
  /** Base URL for the FHIR server (used to construct manifest URLs) */
  baseUrl: string;
  /** Optional booking link template. Use {slotId} as placeholder. */
  bookingLinkTemplate?: string;
  /** Optional state/jurisdiction filter for manifest extensions */
  jurisdictions?: string[];
}

/** Build config from environment variables */
export function getSmartSchedulingConfig(): SmartSchedulingConfig {
  return {
    enabled: process.env.SMART_SCHEDULING_ENABLED !== 'false',
    baseUrl: process.env.SMART_SCHEDULING_BASE_URL || process.env.BASE_URL || '',
    bookingLinkTemplate: process.env.SMART_SCHEDULING_BOOKING_LINK_TEMPLATE,
    jurisdictions: process.env.SMART_SCHEDULING_JURISDICTIONS
      ? process.env.SMART_SCHEDULING_JURISDICTIONS.split(',').map(s => s.trim()).filter(Boolean)
      : undefined,
  };
}

/** Convert a SynapseLocation to a FHIR Location resource for SMART Scheduling Links */
function toFhirLocation(loc: SynapseLocation, baseUrl: string): Record<string, unknown> {
  const telecom: Array<{ system: string; value: string }> = [];
  if (loc.phone) telecom.push({ system: 'phone', value: loc.phone });
  // Spec requires at least one telecom entry; add a URL fallback
  telecom.push({ system: 'url', value: `${baseUrl}/$bulk-publish` });

  const address: Record<string, unknown> = {};
  if (loc.address) address.line = [loc.address];
  if (loc.city) address.city = loc.city;
  if (loc.state) address.state = loc.state;
  if (loc.zip) address.postalCode = loc.zip;

  return {
    resourceType: 'Location',
    id: loc.id,
    name: loc.name,
    telecom,
    ...(Object.keys(address).length > 0 ? { address } : {}),
  };
}

/** Generate an NDJSON string from an array of objects */
function toNdjson(resources: Record<string, unknown>[]): string {
  return resources.map(r => JSON.stringify(r)).join('\n');
}

export async function smartSchedulingRoutes(
  fastify: FastifyInstance,
  store: FhirStore,
  config?: SmartSchedulingConfig,
) {
  const cfg = config || getSmartSchedulingConfig();

  if (!cfg.enabled) return;

  /**
   * GET /$bulk-publish — Bulk Publication Manifest
   *
   * Returns a JSON manifest describing available Location, Schedule, and Slot
   * NDJSON files per the SMART Scheduling Links specification.
   */
  fastify.get(
    '/$bulk-publish',
    {
      schema: {
        description: 'SMART Scheduling Links Bulk Publication Manifest. Returns a JSON manifest with links to NDJSON files for Location, Schedule, and Slot resources.',
        tags: ['SMART Scheduling Links'],
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            description: 'Bulk Publication Manifest',
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const baseUrl = cfg.baseUrl || `${request.protocol}://${request.hostname}`;

      const output: Array<{ type: string; url: string; extension?: Record<string, unknown> }> = [];

      const stateExt = (cfg.jurisdictions && cfg.jurisdictions.length > 0)
        ? { state: cfg.jurisdictions }
        : undefined;

      output.push({
        type: 'Location',
        url: `${baseUrl}/$bulk-publish/locations.ndjson`,
        ...(stateExt ? { extension: stateExt } : {}),
      });

      output.push({
        type: 'Schedule',
        url: `${baseUrl}/$bulk-publish/schedules.ndjson`,
        ...(stateExt ? { extension: stateExt } : {}),
      });

      output.push({
        type: 'Slot',
        url: `${baseUrl}/$bulk-publish/slots.ndjson`,
        ...(stateExt ? { extension: stateExt } : {}),
      });

      const manifest = {
        transactionTime: new Date().toISOString(),
        request: `${baseUrl}/$bulk-publish`,
        output,
        error: [],
      };

      reply.header('Content-Type', 'application/json');
      reply.header('Cache-Control', 'max-age=300');
      return reply.send(manifest);
    },
  );

  /**
   * GET /$bulk-publish/locations.ndjson — Location NDJSON file
   */
  fastify.get(
    '/$bulk-publish/locations.ndjson',
    {
      schema: {
        description: 'NDJSON file of FHIR Location resources for SMART Scheduling Links.',
        tags: ['SMART Scheduling Links'],
        response: {
          200: { type: 'string' },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const locations = await store.getLocations();
      const fhirLocations = locations.map(l => toFhirLocation(l, cfg.baseUrl || `${_request.protocol}://${_request.hostname}`));
      reply.header('Content-Type', 'application/fhir+ndjson');
      reply.header('Cache-Control', 'max-age=300');
      return reply.send(toNdjson(fhirLocations));
    },
  );

  /**
   * GET /$bulk-publish/schedules.ndjson — Schedule NDJSON file
   */
  fastify.get(
    '/$bulk-publish/schedules.ndjson',
    {
      schema: {
        description: 'NDJSON file of FHIR Schedule resources for SMART Scheduling Links.',
        tags: ['SMART Scheduling Links'],
        response: {
          200: { type: 'string' },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const schedules = await store.getSchedules({});

      // Map schedules to SMART Scheduling Links format
      // Each schedule must reference a Location via actor
      const ndjsonLines = schedules.map(schedule => {
        const resource: Record<string, unknown> = {
          resourceType: 'Schedule',
          id: schedule.id,
          actor: schedule.actor,
        };
        if (schedule.serviceType) resource.serviceType = schedule.serviceType;
        if (schedule.serviceCategory) resource.serviceCategory = schedule.serviceCategory;
        return resource;
      });

      reply.header('Content-Type', 'application/fhir+ndjson');
      reply.header('Cache-Control', 'max-age=300');
      return reply.send(toNdjson(ndjsonLines));
    },
  );

  /**
   * GET /$bulk-publish/slots.ndjson — Slot NDJSON file
   */
  fastify.get(
    '/$bulk-publish/slots.ndjson',
    {
      schema: {
        description: 'NDJSON file of FHIR Slot resources for SMART Scheduling Links.',
        tags: ['SMART Scheduling Links'],
        response: {
          200: { type: 'string' },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const slots = await store.getSlots({});

      const ndjsonLines = slots.map(slot => {
        // SMART Scheduling Links spec only recognizes "free" and "busy"
        const status = slot.status === 'free' ? 'free' : 'busy';
        const resource: Record<string, unknown> = {
          resourceType: 'Slot',
          id: slot.id,
          schedule: slot.schedule,
          status,
          start: slot.start,
          end: slot.end,
        };

        // Add booking deep link extension if configured
        if (cfg.bookingLinkTemplate) {
          const bookingUrl = cfg.bookingLinkTemplate.replace('{slotId}', slot.id || '');
          resource.extension = [{
            url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/booking-deep-link',
            valueUrl: bookingUrl,
          }];
        }

        return resource;
      });

      reply.header('Content-Type', 'application/fhir+ndjson');
      reply.header('Cache-Control', 'max-age=300');
      return reply.send(toNdjson(ndjsonLines));
    },
  );
}
