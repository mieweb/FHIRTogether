import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore, Schedule, Slot, Appointment, Bundle } from '../types/fhir';

/**
 * Import data payload structure
 * Accepts either:
 * - FHIR Bundles for each resource type
 * - Arrays of raw FHIR resources
 */
interface ImportPayload {
  schedules?: Schedule[] | Bundle;
  slots?: Slot[] | Bundle;
  appointments?: Appointment[] | Bundle;
  /** If true, clears existing data before import */
  clearExisting?: boolean;
}

interface ImportResult {
  success: boolean;
  imported: {
    schedules: number;
    slots: number;
    appointments: number;
  };
  errors?: string[];
}

/**
 * Extract resources from either a Bundle or an array of resources
 */
function extractResources<T>(data: T[] | Bundle | undefined, resourceType: string): T[] {
  if (!data) return [];

  // Check if it's a Bundle
  if ('resourceType' in data && data.resourceType === 'Bundle' && 'entry' in data) {
    return (data.entry || [])
      .map((entry: any) => entry.resource)
      .filter((resource: any) => resource && resource.resourceType === resourceType);
  }

  // Otherwise treat as array
  if (Array.isArray(data)) {
    return data.filter((resource: any) =>
      !resource.resourceType || resource.resourceType === resourceType
    );
  }

  return [];
}

/**
 * Convert database error messages to user-friendly messages
 */
function formatImportError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  
  // SQLite UNIQUE constraint violation
  if (msg.includes('UNIQUE constraint failed')) {
    return 'already exists (check "Clear existing data" to replace)';
  }
  
  // Foreign key constraint (e.g., slot references non-existent schedule)
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return 'references a resource that does not exist';
  }
  
  return msg;
}

export async function importRoutes(fastify: FastifyInstance, store: FhirStore) {
  // POST /Import - Import scheduling data from JSON
  fastify.post<{ Body: ImportPayload }>(
    '/Import',
    {
      schema: {
        description: 'Import scheduling data from JSON. Accepts FHIR Bundles or arrays of resources.',
        tags: ['Import'],
        body: {
          type: 'object',
          additionalProperties: true,
          properties: {
            schedules: {
              oneOf: [
                { type: 'array', items: { type: 'object', additionalProperties: true } },
                { type: 'object', additionalProperties: true, description: 'FHIR Bundle' },
              ],
              description: 'Schedule resources to import (array or Bundle)',
            },
            slots: {
              oneOf: [
                { type: 'array', items: { type: 'object', additionalProperties: true } },
                { type: 'object', additionalProperties: true, description: 'FHIR Bundle' },
              ],
              description: 'Slot resources to import (array or Bundle)',
            },
            appointments: {
              oneOf: [
                { type: 'array', items: { type: 'object', additionalProperties: true } },
                { type: 'object', additionalProperties: true, description: 'FHIR Bundle' },
              ],
              description: 'Appointment resources to import (array or Bundle)',
            },
            clearExisting: {
              type: 'boolean',
              description: 'If true, clears existing data before import',
              default: false,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            description: 'Import result',
            properties: {
              success: { type: 'boolean' },
              imported: {
                type: 'object',
                properties: {
                  schedules: { type: 'number' },
                  slots: { type: 'number' },
                  appointments: { type: 'number' },
                },
              },
              errors: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          400: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ImportPayload }>, reply: FastifyReply) => {
      const { schedules, slots, appointments, clearExisting } = request.body;
      const errors: string[] = [];
      const imported = { schedules: 0, slots: 0, appointments: 0 };

      try {
        // Extract resources from bundles or arrays
        const scheduleList = extractResources<Schedule>(schedules, 'Schedule');
        const slotList = extractResources<Slot>(slots, 'Slot');
        const appointmentList = extractResources<Appointment>(appointments, 'Appointment');

        // Clear existing data if requested
        if (clearExisting) {
          await store.deleteAllAppointments();
          await store.deleteAllSlots();
          await store.deleteAllSchedules();
          fastify.log.info('Cleared existing data for import');
        }

        // Import schedules
        for (const schedule of scheduleList) {
          try {
            await store.createSchedule(schedule);
            imported.schedules++;
          } catch (err) {
            errors.push(`Schedule "${schedule.id || 'unknown'}" ${formatImportError(err)}`);
          }
        }

        // Import slots
        for (const slot of slotList) {
          try {
            await store.createSlot(slot);
            imported.slots++;
          } catch (err) {
            errors.push(`Slot "${slot.id || 'unknown'}" ${formatImportError(err)}`);
          }
        }

        // Import appointments
        for (const appointment of appointmentList) {
          try {
            await store.createAppointment(appointment);
            imported.appointments++;
          } catch (err) {
            errors.push(`Appointment "${appointment.id || 'unknown'}" ${formatImportError(err)}`);
          }
        }

        const result: ImportResult = {
          success: errors.length === 0,
          imported,
          errors: errors.length > 0 ? errors : undefined,
        };

        fastify.log.info(
          { imported, errorCount: errors.length },
          'Import completed'
        );

        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        fastify.log.error({ err }, 'Import error');
        return reply.code(400).send({ error: message });
      }
    }
  );

  // DELETE /Import - Clear all scheduling data (test mode only)
  fastify.delete(
    '/Import',
    {
      schema: {
        description: 'Clear all scheduling data (test mode only)',
        tags: ['Import'],
        response: {
          204: {
            type: 'null',
            description: 'All data cleared successfully',
          },
          403: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({
          error: 'Test endpoints not enabled. Set ENABLE_TEST_ENDPOINTS=true',
        });
      }

      await store.deleteAllAppointments();
      await store.deleteAllSlots();
      await store.deleteAllSchedules();

      fastify.log.info('Cleared all scheduling data');
      return reply.code(204).send();
    }
  );

  // GET /Import/template - Get a template for import data
  fastify.get(
    '/Import/template',
    {
      schema: {
        description: 'Get a template showing the expected import format',
        tags: ['Import'],
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            description: 'Import template with example data',
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const template = {
        description: 'Import template for FHIRTogether scheduling data',
        note: 'All fields are optional except where marked required',
        clearExisting: false,
        schedules: [
          {
            resourceType: 'Schedule',
            id: 'schedule-example',
            active: true,
            actor: [
              {
                reference: 'Practitioner/practitioner-example',
                display: 'Dr. Jane Doe',
              },
            ],
            serviceType: [{ text: 'General Practice' }],
            planningHorizon: {
              start: new Date().toISOString(),
              end: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
            },
            comment: 'Schedule for Dr. Jane Doe',
          },
        ],
        slots: [
          {
            resourceType: 'Slot',
            id: 'slot-example',
            schedule: { reference: 'Schedule/schedule-example' },
            status: 'free',
            start: new Date().toISOString(),
            end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          },
        ],
        appointments: [
          {
            resourceType: 'Appointment',
            id: 'appointment-example',
            status: 'booked',
            slot: [{ reference: 'Slot/slot-example' }],
            start: new Date().toISOString(),
            end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            participant: [
              {
                actor: { reference: 'Patient/patient-example', display: 'John Smith' },
                status: 'accepted',
              },
              {
                actor: { reference: 'Practitioner/practitioner-example', display: 'Dr. Jane Doe' },
                status: 'accepted',
              },
            ],
            description: 'General checkup',
          },
        ],
      };

      return reply.send(template);
    }
  );
}
