/**
 * Schedule Resource Routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStore } from '../store/factory';
import { createBundle, createOperationOutcome, parseSearchParams } from '../utils/fhir';
import { Schedule, FhirScheduleQuery } from '../types/fhir';

export async function scheduleRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /Schedule - Search schedules
  fastify.get('/Schedule', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          actor: { type: 'string' },
          date: { type: 'string' },
          identifier: { type: 'string' },
          active: { type: 'boolean' },
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
      
      const query: FhirScheduleQuery = {
        ...searchParams,
        ...paginationParams
      };

      const store = getStore();
      const schedules = await store.getSchedules(query);
      
      const bundle = createBundle(schedules, 'searchset');
      
      reply.code(200).send(bundle);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // GET /Schedule/{id} - Get schedule by ID
  fastify.get('/Schedule/:id', {
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
      const schedule = await store.getScheduleById(id);

      if (!schedule) {
        const outcome = createOperationOutcome('error', 'not-found', `Schedule ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      reply.code(200).send(schedule);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // POST /Schedule - Create new schedule
  fastify.post('/Schedule', {
    schema: {
      body: {
        type: 'object',
        required: ['resourceType', 'actor'],
        properties: {
          resourceType: { type: 'string', enum: ['Schedule'] },
          id: { type: 'string' },
          active: { type: 'boolean' },
          actor: { type: 'array' },
          serviceCategory: { type: 'array' },
          serviceType: { type: 'array' },
          specialty: { type: 'array' },
          planningHorizon: { type: 'object' },
          comment: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Schedule }>, reply: FastifyReply) => {
    try {
      const schedule = request.body;
      const store = getStore();
      const createdSchedule = await store.createSchedule(schedule);

      reply.code(201).send(createdSchedule);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // PUT /Schedule/{id} - Update schedule
  fastify.put('/Schedule/:id', {
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
        required: ['resourceType', 'actor'],
        properties: {
          resourceType: { type: 'string', enum: ['Schedule'] },
          id: { type: 'string' },
          active: { type: 'boolean' },
          actor: { type: 'array' },
          serviceCategory: { type: 'array' },
          serviceType: { type: 'array' },
          specialty: { type: 'array' },
          planningHorizon: { type: 'object' },
          comment: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Schedule }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const schedule = request.body;
      const store = getStore();
      
      const existingSchedule = await store.getScheduleById(id);
      if (!existingSchedule) {
        const outcome = createOperationOutcome('error', 'not-found', `Schedule ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      const updatedSchedule = await store.updateSchedule(id, schedule);
      reply.code(200).send(updatedSchedule);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // DELETE /Schedule/{id} - Delete schedule (test mode only)
  fastify.delete('/Schedule/:id', {
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
      const deleted = await store.deleteSchedule(id);

      if (!deleted) {
        const outcome = createOperationOutcome('error', 'not-found', `Schedule ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      reply.code(204).send();
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // DELETE /Schedule - Delete all schedules (test mode only)
  fastify.delete('/Schedule', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (process.env.ENABLE_TEST_MODE !== 'true') {
        const outcome = createOperationOutcome('error', 'forbidden', 'Delete operations only allowed in test mode');
        reply.code(403).send(outcome);
        return;
      }

      const store = getStore();
      await store.deleteAllSchedules();

      reply.code(204).send();
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });
}