/**
 * Location Routes
 *
 * REST endpoints for managing locations under an authenticated system.
 * Locations are auto-created from AIL segments in HL7, or manually via these endpoints.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FhirStore, Bundle, FhirResource } from '../types/fhir';

export async function locationRoutes(fastify: FastifyInstance, store: FhirStore) {

  /**
   * POST /Location — Create a location under the authenticated system.
   */
  fastify.post<{
    Body: { name: string; address?: string; city?: string; state?: string; zip?: string; phone?: string };
  }>('/Location', {
    schema: {
      description: 'Create a new location under the authenticated system.',
      tags: ['Location'],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
          phone: { type: 'string' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request, reply) => {
    if (!request.system) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const location = await store.createLocation({
      systemId: request.system.id,
      name: request.body.name,
      address: request.body.address,
      city: request.body.city,
      state: request.body.state,
      zip: request.body.zip,
      phone: request.body.phone,
    });

    return reply.status(201).send(location);
  });

  /**
   * GET /Location — List locations for the authenticated system.
   */
  fastify.get<{
    Querystring: { zip?: string; _count?: string };
  }>('/Location', {
    schema: {
      description: 'List locations for the authenticated system (or all locations for admin).',
      tags: ['Location'],
      querystring: {
        type: 'object',
        properties: {
          zip: { type: 'string' },
          _count: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { zip?: string; _count?: string } }>) => {
    const systemId = request.system?.id;

    const locations = await store.getLocations({
      systemId: request.isAdmin ? undefined : systemId,
      zip: request.query.zip,
      _count: request.query._count ? parseInt(request.query._count, 10) : undefined,
    });

    // Return as FHIR-style Bundle
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: locations.length,
      entry: locations.map(loc => ({
        fullUrl: `Location/${loc.id}`,
        resource: {
          resourceType: 'Location',
          id: loc.id,
          name: loc.name,
          address: loc.address ? {
            line: [loc.address],
            city: loc.city,
            state: loc.state,
            postalCode: loc.zip,
          } : undefined,
          telecom: loc.phone ? [{ system: 'phone', value: loc.phone }] : undefined,
        } as FhirResource,
      })),
    };

    return bundle;
  });

  /**
   * GET /Location/:id — Get a specific location.
   */
  fastify.get<{
    Params: { id: string };
  }>('/Location/:id', {
    schema: {
      description: 'Get a specific location (must belong to the authenticated system).',
      tags: ['Location'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request, reply) => {
    const location = await store.getLocationById(request.params.id);
    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    // Scope check: must belong to the authenticated system (unless admin)
    if (!request.isAdmin && request.system && location.systemId !== request.system.id) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    return location;
  });

  /**
   * PUT /Location/:id — Update a location.
   */
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; address?: string; city?: string; state?: string; zip?: string; phone?: string };
  }>('/Location/:id', {
    schema: {
      description: 'Update a location (must belong to the authenticated system).',
      tags: ['Location'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
          phone: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request, reply) => {
    const location = await store.getLocationById(request.params.id);
    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    if (!request.isAdmin && request.system && location.systemId !== request.system.id) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    const updated = await store.updateLocation(request.params.id, request.body);
    return updated;
  });

  /**
   * DELETE /Location/:id — Delete a location (cascades to schedules at that location).
   */
  fastify.delete<{
    Params: { id: string };
  }>('/Location/:id', {
    schema: {
      description: 'Delete a location. Schedules at this location will have their location_id set to NULL.',
      tags: ['Location'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const location = await store.getLocationById(request.params.id);
    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    if (!request.isAdmin && request.system && location.systemId !== request.system.id) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    await store.deleteLocation(request.params.id);
    return reply.status(204).send();
  });
}
