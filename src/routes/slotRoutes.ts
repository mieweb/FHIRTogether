import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore, Slot, FhirSlotQuery, Bundle } from '../types/fhir';

interface SlotParams {
  id: string;
}

interface SlotHoldParams {
  id: string;
  token?: string;
}

interface HoldRequestBody {
  durationMinutes?: number;
  sessionId: string;
}

/**
 * Parse FHIR date search parameter prefixes (eq, ne, gt, lt, ge, le)
 * Returns the prefix and the date value separately
 */
function parseFhirDatePrefix(value: string): { prefix: string; value: string } {
  const prefixes = ['eq', 'ne', 'gt', 'lt', 'ge', 'le'];
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return { prefix, value: value.slice(prefix.length) };
    }
  }
  return { prefix: 'eq', value };
}

export async function slotRoutes(fastify: FastifyInstance, store: FhirStore) {
  // GET /Slot - Search for slots
  fastify.get<{ Querystring: FhirSlotQuery }>(
    '/Slot',
    {
      schema: {
        description: 'Search for available or busy slots',
        tags: ['Slot'],
        querystring: {
          type: 'object', additionalProperties: true,
          properties: {
            schedule: { type: 'string', description: 'Schedule reference' },
            status: { type: 'string', enum: ['busy', 'free', 'busy-unavailable', 'busy-tentative'] },
            start: { type: 'string', description: 'Start time filter (supports FHIR prefixes: eq, ne, gt, lt, ge, le)' },
            end: { type: 'string', description: 'End time filter (supports FHIR prefixes: eq, ne, gt, lt, ge, le)' },
            _count: { type: 'number', description: 'Max results to return' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'FHIR Bundle with Slot resources',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FhirSlotQuery }>, reply: FastifyReply) => {
      // Parse FHIR date prefixes and normalize the query
      const normalizedQuery = { ...request.query };
      if (normalizedQuery.start) {
        normalizedQuery.start = parseFhirDatePrefix(normalizedQuery.start).value;
      }
      if (normalizedQuery.end) {
        normalizedQuery.end = parseFhirDatePrefix(normalizedQuery.end).value;
      }

      const slots = await store.getSlots(normalizedQuery);
      
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        total: slots.length,
        entry: slots.map(slot => ({
          fullUrl: `${request.protocol}://${request.hostname}/Slot/${slot.id}`,
          resource: slot,
        })),
      };

      return reply.send(bundle);
    }
  );

  // GET /Slot/:id - Get specific slot
  fastify.get<{ Params: SlotParams }>(
    '/Slot/:id',
    {
      schema: {
        description: 'Get a specific slot by ID',
        tags: ['Slot'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Slot resource',
          },
          404: {
            type: 'object', additionalProperties: true,
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SlotParams }>, reply: FastifyReply) => {
      const slot = await store.getSlotById(request.params.id);
      
      if (!slot) {
        return reply.code(404).send({ error: 'Slot not found' });
      }

      return reply.send(slot);
    }
  );

  // POST /Slot - Create a new slot
  fastify.post<{ Body: Slot }>(
    '/Slot',
    {
      schema: {
        description: 'Create a new slot',
        tags: ['Slot'],
        body: {
          type: 'object', additionalProperties: true,
          required: ['schedule', 'status', 'start', 'end'],
          properties: {
            resourceType: { type: 'string', const: 'Slot' },
            schedule: {
              type: 'object', additionalProperties: true,
              required: ['reference'],
              properties: {
                reference: { type: 'string' },
                display: { type: 'string' },
              },
            },
            status: { type: 'string', enum: ['busy', 'free', 'busy-unavailable', 'busy-tentative'] },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            comment: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object', additionalProperties: true,
            description: 'Created Slot resource',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: Slot }>, reply: FastifyReply) => {
      const slot = await store.createSlot(request.body);
      return reply.code(201).send(slot);
    }
  );

  // PUT /Slot/:id - Update a slot
  fastify.put<{ Params: SlotParams; Body: Partial<Slot> }>(
    '/Slot/:id',
    {
      schema: {
        description: 'Update an existing slot',
        tags: ['Slot'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object', additionalProperties: true,
          properties: {
            status: { type: 'string' },
            comment: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Updated Slot resource',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SlotParams; Body: Partial<Slot> }>, reply: FastifyReply) => {
      const slot = await store.updateSlot(request.params.id, request.body);
      return reply.send(slot);
    }
  );

  // DELETE /Slot/:id - Delete a slot (test mode only)
  fastify.delete<{ Params: SlotParams }>(
    '/Slot/:id',
    {
      schema: {
        description: 'Delete a slot (test mode only)',
        tags: ['Slot'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          204: {
            type: 'null',
            description: 'Slot deleted successfully',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SlotParams }>, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({ error: 'Test endpoints disabled' });
      }
      
      await store.deleteSlot(request.params.id);
      return reply.code(204).send();
    }
  );

  // DELETE /Slot - Delete all slots (test mode only)
  fastify.delete(
    '/Slot',
    {
      schema: {
        description: 'Delete all slots (test mode only)',
        tags: ['Slot'],
        response: {
          204: {
            type: 'null',
            description: 'All slots deleted successfully',
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({ error: 'Test endpoints disabled' });
      }
      
      await store.deleteAllSlots();
      return reply.code(204).send();
    }
  );

  // ==================== SLOT HOLD OPERATIONS ====================

  // POST /Slot/:id/$hold - Acquire hold on a slot
  fastify.post<{ Params: SlotHoldParams; Body: HoldRequestBody }>(
    '/Slot/:id/$hold',
    {
      schema: {
        description: 'Acquire a temporary hold on a slot to prevent double-booking',
        tags: ['Slot'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object', additionalProperties: true,
          required: ['sessionId'],
          properties: {
            durationMinutes: { type: 'number', default: 5, description: 'How long to hold the slot (1-30 minutes)' },
            sessionId: { type: 'string', description: 'Unique session identifier for the client' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Slot hold information',
            properties: {
              holdToken: { type: 'string' },
              slotId: { type: 'string' },
              expiresAt: { type: 'string' },
              status: { type: 'string' },
            },
          },
          409: {
            type: 'object', additionalProperties: true,
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SlotHoldParams; Body: HoldRequestBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { durationMinutes = 5, sessionId } = request.body;

      // Validate duration (1-30 minutes)
      const validDuration = Math.min(30, Math.max(1, durationMinutes));

      try {
        const hold = await store.holdSlot(id, sessionId, validDuration);
        return reply.send({
          holdToken: hold.holdToken,
          slotId: hold.slotId,
          expiresAt: hold.expiresAt,
          status: 'held',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to hold slot';
        if (message.includes('already held') || message.includes('not available')) {
          return reply.code(409).send({ error: message });
        }
        if (message.includes('not found')) {
          return reply.code(404).send({ error: message });
        }
        throw err;
      }
    }
  );

  // GET /Slot/:id/$hold - Check if slot is held
  fastify.get<{ Params: SlotHoldParams }>(
    '/Slot/:id/$hold',
    {
      schema: {
        description: 'Check if a slot currently has an active hold',
        tags: ['Slot'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Active hold information',
          },
          404: {
            type: 'object', additionalProperties: true,
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SlotHoldParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      
      const hold = await store.getActiveHold(id);
      
      if (!hold) {
        return reply.code(404).send({ error: 'No active hold on this slot' });
      }

      return reply.send({
        slotId: hold.slotId,
        expiresAt: hold.expiresAt,
        status: 'held',
      });
    }
  );

  // DELETE /Slot/:id/$hold/:token - Release a hold
  fastify.delete<{ Params: SlotHoldParams }>(
    '/Slot/:id/$hold/:token',
    {
      schema: {
        description: 'Release a slot hold',
        tags: ['Slot'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id', 'token'],
          properties: {
            id: { type: 'string' },
            token: { type: 'string' },
          },
        },
        response: {
          204: {
            type: 'null',
            description: 'Hold released successfully',
          },
          404: {
            type: 'object', additionalProperties: true,
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SlotHoldParams }>, reply: FastifyReply) => {
      const { token } = request.params;
      
      if (!token) {
        return reply.code(400).send({ error: 'Hold token required' });
      }

      await store.releaseHold(token);
      return reply.code(204).send();
    }
  );
}
