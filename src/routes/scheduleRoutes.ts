import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore, Schedule, FhirScheduleQuery, Bundle } from '../types/fhir';
import { parseSlotYAML, validateTemplate, expandSlots, AvailabilityTemplate } from '../scheduling';

interface ScheduleParams {
  id: string;
}

export async function scheduleRoutes(fastify: FastifyInstance, store: FhirStore) {
  // GET /Schedule - Search for schedules
  fastify.get<{ Querystring: FhirScheduleQuery }>(
    '/Schedule',
    {
      schema: {
        description: 'Search for provider schedules',
        tags: ['Schedule'],
        querystring: {
          type: 'object', additionalProperties: true,
          properties: {
            actor: { type: 'string', description: 'Actor (provider) reference' },
            active: { type: 'boolean', description: 'Is schedule active' },
            date: { type: 'string', format: 'date', description: 'Date within planning horizon' },
            _count: { type: 'number', description: 'Max results to return' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'FHIR Bundle with Schedule resources',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FhirScheduleQuery }>, reply: FastifyReply) => {
      const schedules = await store.getSchedules(request.query);
      
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        total: schedules.length,
        entry: schedules.map(schedule => ({
          fullUrl: `${request.protocol}://${request.hostname}/Schedule/${schedule.id}`,
          resource: schedule,
        })),
      };

      return reply.send(bundle);
    }
  );

  // GET /Schedule/:id - Get specific schedule
  fastify.get<{ Params: ScheduleParams }>(
    '/Schedule/:id',
    {
      schema: {
        description: 'Get a specific schedule by ID',
        tags: ['Schedule'],
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
            description: 'Schedule resource',
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
    async (request: FastifyRequest<{ Params: ScheduleParams }>, reply: FastifyReply) => {
      const schedule = await store.getScheduleById(request.params.id);
      
      if (!schedule) {
        return reply.code(404).send({ error: 'Schedule not found' });
      }

      return reply.send(schedule);
    }
  );

  // POST /Schedule - Create a new schedule
  fastify.post<{ Body: Schedule }>(
    '/Schedule',
    {
      schema: {
        description: 'Create a new schedule',
        tags: ['Schedule'],
        body: {
          type: 'object', additionalProperties: true,
          required: ['actor'],
          properties: {
            resourceType: { type: 'string', const: 'Schedule' },
            active: { type: 'boolean' },
            actor: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: true,
                required: ['reference'],
                properties: {
                  reference: { type: 'string' },
                  display: { type: 'string' },
                },
              },
            },
            planningHorizon: {
              type: 'object', additionalProperties: true,
              properties: {
                start: { type: 'string', format: 'date-time' },
                end: { type: 'string', format: 'date-time' },
              },
            },
            comment: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object', additionalProperties: true,
            description: 'Created Schedule resource',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: Schedule }>, reply: FastifyReply) => {
      const schedule = await store.createSchedule(request.body);
      return reply.code(201).send(schedule);
    }
  );

  // PUT /Schedule/:id - Update a schedule
  fastify.put<{ Params: ScheduleParams; Body: Partial<Schedule> }>(
    '/Schedule/:id',
    {
      schema: {
        description: 'Update an existing schedule',
        tags: ['Schedule'],
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
            active: { type: 'boolean' },
            comment: { type: 'string' },
            planningHorizon: {
              type: 'object', additionalProperties: true,
              properties: {
                start: { type: 'string', format: 'date-time' },
                end: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Updated Schedule resource',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScheduleParams; Body: Partial<Schedule> }>, reply: FastifyReply) => {
      const schedule = await store.updateSchedule(request.params.id, request.body);
      return reply.send(schedule);
    }
  );

  // DELETE /Schedule/:id - Delete a schedule (test mode only)
  fastify.delete<{ Params: ScheduleParams }>(
    '/Schedule/:id',
    {
      schema: {
        description: 'Delete a schedule (test mode only)',
        tags: ['Schedule'],
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
            description: 'Schedule deleted successfully',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScheduleParams }>, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({ error: 'Test endpoints disabled' });
      }
      
      await store.deleteSchedule(request.params.id);
      return reply.code(204).send();
    }
  );

  // DELETE /Schedule - Delete all schedules (test mode only)
  fastify.delete(
    '/Schedule',
    {
      schema: {
        description: 'Delete all schedules (test mode only)',
        tags: ['Schedule'],
        response: {
          204: {
            type: 'null',
            description: 'All schedules deleted successfully',
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({ error: 'Test endpoints disabled' });
      }
      
      await store.deleteAllSchedules();
      return reply.code(204).send();
    }
  );

  // POST /Schedule/:id/$generate-slots — Generate slots from availability template
  fastify.post<{ Params: ScheduleParams; Body: { yaml?: string; template?: AvailabilityTemplate }; Querystring: { mode?: string } }>(
    '/Schedule/:id/\\$generate-slots',
    {
      schema: {
        description: 'Generate Slot resources from a YAML availability template or JSON template. ' +
          'Mode "replace" (default) deletes existing free slots first; "incremental" keeps them.',
        tags: ['Schedule'],
        params: {
          type: 'object', additionalProperties: true,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        querystring: {
          type: 'object', additionalProperties: true,
          properties: {
            mode: { type: 'string', enum: ['replace', 'incremental'], description: 'replace (default) or incremental' },
          },
        },
        body: {
          type: 'object', additionalProperties: true,
          properties: {
            yaml: { type: 'string', description: 'YAML availability template text' },
            template: { type: 'object', additionalProperties: true, description: 'JSON availability template' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Result with slot count and warnings',
          },
          400: {
            type: 'object', additionalProperties: true,
            properties: { error: { type: 'string' }, details: { type: 'array' } },
          },
          404: {
            type: 'object', additionalProperties: true,
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      // Verify schedule exists
      const schedule = await store.getScheduleById(request.params.id);
      if (!schedule) {
        return reply.code(404).send({ error: 'Schedule not found' });
      }

      // Parse template from YAML text or JSON body
      let template: AvailabilityTemplate;
      const body = request.body || {};

      if (body.yaml) {
        try {
          template = parseSlotYAML(body.yaml);
        } catch (err) {
          return reply.code(400).send({ error: 'Invalid YAML', details: [(err as Error).message] });
        }
      } else if (body.template) {
        template = body.template;
      } else {
        return reply.code(400).send({ error: 'Request must include "yaml" (string) or "template" (object)' });
      }

      // Validate
      const errors = validateTemplate(template);
      if (errors.length > 0) {
        return reply.code(400).send({ error: 'Invalid availability template', details: errors });
      }

      // Expand into Slot resources
      const scheduleRef = `Schedule/${request.params.id}`;
      const { slots, warnings } = expandSlots(template, scheduleRef);

      // Replace mode: delete existing free slots in this schedule first
      const mode = request.query.mode || 'replace';
      let deletedCount = 0;
      if (mode === 'replace') {
        deletedCount = await store.deleteSlotsBySchedule(request.params.id, 'free');
      }

      // Bulk insert
      const { count } = await store.createSlots(slots);

      // Store the template on the schedule for future reference
      const templateJson = JSON.stringify(template);
      await store.setAvailabilityTemplate(request.params.id, templateJson);

      return reply.send({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'information',
          code: 'informational',
          diagnostics: `Generated ${count} slots for ${scheduleRef}` +
            (deletedCount > 0 ? ` (replaced ${deletedCount} existing free slots)` : ''),
        }],
        extension: [{
          url: 'https://fhirtogether.org/StructureDefinition/generate-slots-result',
          extension: [
            { url: 'slotsCreated', valueInteger: count },
            { url: 'slotsDeleted', valueInteger: deletedCount },
            { url: 'mode', valueString: mode },
            ...(warnings.length > 0 ? [{ url: 'warnings', valueString: warnings.join('; ') }] : []),
          ],
        }],
      });
    }
  );
}
