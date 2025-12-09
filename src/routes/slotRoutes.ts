import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore, Slot, FhirSlotQuery, Bundle } from '../types/fhir';

interface SlotParams {
  id: string;
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
            start: { type: 'string', format: 'date-time', description: 'Start time filter' },
            end: { type: 'string', format: 'date-time', description: 'End time filter' },
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
      const slots = await store.getSlots(request.query);
      
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({ error: 'Test endpoints disabled' });
      }
      
      await store.deleteAllSlots();
      return reply.code(204).send();
    }
  );
}
