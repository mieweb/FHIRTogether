/**
 * Slot Resource Routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStore } from '../store/factory';
import { createBundle, createOperationOutcome, parseSearchParams } from '../utils/fhir';
import { Slot, FhirSlotQuery } from '../types/fhir';

export async function slotRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /Slot - Search slots
  fastify.get('/Slot', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          schedule: { type: 'string' },
          status: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          serviceType: { type: 'string' },
          specialty: { type: 'string' },
          _count: { type: 'number' },
          _offset: { type: 'number' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            resourceType: { type: 'string' },
            type: { type: 'string' },
            total: { type: 'number' },
            entry: { type: 'array' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { searchParams, paginationParams } = parseSearchParams(request.query as Record<string, any>);
      
      const query: FhirSlotQuery = {
        ...searchParams,
        ...paginationParams
      };

      const store = getStore();
      const slots = await store.getSlots(query);
      
      const bundle = createBundle(slots, 'searchset');
      
      reply.code(200).send(bundle);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // GET /Slot/{id} - Get slot by ID
  fastify.get('/Slot/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const store = getStore();
      const slot = await store.getSlotById(id);

      if (!slot) {
        const outcome = createOperationOutcome('error', 'not-found', `Slot ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      reply.code(200).send(slot);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // POST /Slot - Create new slot (block time)
  fastify.post('/Slot', {
    schema: {
      body: {
        type: 'object',
        required: ['resourceType', 'schedule', 'status', 'start', 'end'],
        properties: {
          resourceType: { type: 'string', enum: ['Slot'] },
          id: { type: 'string' },
          schedule: { type: 'object' },
          status: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          serviceCategory: { type: 'array' },
          serviceType: { type: 'array' },
          specialty: { type: 'array' },
          appointmentType: { type: 'object' },
          overbooked: { type: 'boolean' },
          comment: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Slot }>, reply: FastifyReply) => {
    try {
      const slot = request.body;
      const store = getStore();
      const createdSlot = await store.createSlot(slot);

      reply.code(201).send(createdSlot);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // PUT /Slot/{id} - Update slot
  fastify.put('/Slot/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['resourceType', 'schedule', 'status', 'start', 'end'],
        properties: {
          resourceType: { type: 'string', enum: ['Slot'] },
          id: { type: 'string' },
          schedule: { type: 'object' },
          status: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          serviceCategory: { type: 'array' },
          serviceType: { type: 'array' },
          specialty: { type: 'array' },
          appointmentType: { type: 'object' },
          overbooked: { type: 'boolean' },
          comment: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Slot }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const slot = request.body;
      const store = getStore();
      
      const existingSlot = await store.getSlotById(id);
      if (!existingSlot) {
        const outcome = createOperationOutcome('error', 'not-found', `Slot ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      const updatedSlot = await store.updateSlot(id, slot);
      reply.code(200).send(updatedSlot);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // DELETE /Slot/{id} - Delete slot (test mode only)
  fastify.delete('/Slot/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      if (process.env.ENABLE_TEST_MODE !== 'true') {
        const outcome = createOperationOutcome('error', 'forbidden', 'Delete operations only allowed in test mode');
        reply.code(403).send(outcome);
        return;
      }

      const { id } = request.params;
      const store = getStore();
      const deleted = await store.deleteSlot(id);

      if (!deleted) {
        const outcome = createOperationOutcome('error', 'not-found', `Slot ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      reply.code(204).send();
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // DELETE /Slot - Delete all slots (test mode only)
  fastify.delete('/Slot', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (process.env.ENABLE_TEST_MODE !== 'true') {
        const outcome = createOperationOutcome('error', 'forbidden', 'Delete operations only allowed in test mode');
        reply.code(403).send(outcome);
        return;
      }

      const store = getStore();
      await store.deleteAllSlots();

      reply.code(204).send();
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });
}