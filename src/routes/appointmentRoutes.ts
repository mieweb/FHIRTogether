import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore, Appointment, FhirAppointmentQuery, Bundle } from '../types/fhir';

interface AppointmentParams {
  id: string;
}

export async function appointmentRoutes(fastify: FastifyInstance, store: FhirStore) {
  // GET /Appointment - Search for appointments
  fastify.get<{ Querystring: FhirAppointmentQuery }>(
    '/Appointment',
    {
      schema: {
        description: 'Search for appointments',
        tags: ['Appointment'],
        querystring: {
          type: 'object', additionalProperties: true,
          properties: {
            date: { type: 'string', format: 'date', description: 'Appointment date' },
            status: { type: 'string', description: 'Appointment status' },
            patient: { type: 'string', description: 'Patient reference' },
            actor: { type: 'string', description: 'Any participant actor' },
            _count: { type: 'number', description: 'Max results to return' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'FHIR Bundle with Appointment resources',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FhirAppointmentQuery }>, reply: FastifyReply) => {
      const appointments = await store.getAppointments(request.query);
      
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        total: appointments.length,
        entry: appointments.map(appointment => ({
          fullUrl: `${request.protocol}://${request.hostname}/Appointment/${appointment.id}`,
          resource: appointment,
        })),
      };

      return reply.send(bundle);
    }
  );

  // GET /Appointment/:id - Get specific appointment
  fastify.get<{ Params: AppointmentParams }>(
    '/Appointment/:id',
    {
      schema: {
        description: 'Get a specific appointment by ID',
        tags: ['Appointment'],
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
            description: 'Appointment resource',
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
    async (request: FastifyRequest<{ Params: AppointmentParams }>, reply: FastifyReply) => {
      const appointment = await store.getAppointmentById(request.params.id);
      
      if (!appointment) {
        return reply.code(404).send({ error: 'Appointment not found' });
      }

      return reply.send(appointment);
    }
  );

  // POST /Appointment - Create a new appointment (book)
  fastify.post<{ Body: Appointment }>(
    '/Appointment',
    {
      schema: {
        description: 'Book a new appointment',
        tags: ['Appointment'],
        body: {
          type: 'object', additionalProperties: true,
          required: ['status', 'participant'],
          properties: {
            resourceType: { type: 'string', const: 'Appointment' },
            status: { type: 'string', enum: ['proposed', 'pending', 'booked', 'arrived', 'fulfilled', 'cancelled', 'noshow'] },
            description: { type: 'string' },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            comment: { type: 'string' },
            participant: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: true,
                required: ['status'],
                properties: {
                  actor: {
                    type: 'object', additionalProperties: true,
                    properties: {
                      reference: { type: 'string' },
                      display: { type: 'string' },
                    },
                  },
                  status: { type: 'string', enum: ['accepted', 'declined', 'tentative', 'needs-action'] },
                },
              },
            },
            slot: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: true,
                required: ['reference'],
                properties: {
                  reference: { type: 'string' },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: 'object', additionalProperties: true,
            description: 'Created Appointment resource',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: Appointment }>, reply: FastifyReply) => {
      const appointment = await store.createAppointment(request.body);
      return reply.code(201).send(appointment);
    }
  );

  // PUT /Appointment/:id - Update an appointment
  fastify.put<{ Params: AppointmentParams; Body: Partial<Appointment> }>(
    '/Appointment/:id',
    {
      schema: {
        description: 'Update an existing appointment',
        tags: ['Appointment'],
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
            description: { type: 'string' },
            comment: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object', additionalProperties: true,
            description: 'Updated Appointment resource',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: AppointmentParams; Body: Partial<Appointment> }>, reply: FastifyReply) => {
      const appointment = await store.updateAppointment(request.params.id, request.body);
      return reply.send(appointment);
    }
  );

  // DELETE /Appointment/:id - Cancel an appointment
  fastify.delete<{ Params: AppointmentParams }>(
    '/Appointment/:id',
    {
      schema: {
        description: 'Cancel/delete an appointment',
        tags: ['Appointment'],
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
            description: 'Appointment cancelled successfully',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: AppointmentParams }>, reply: FastifyReply) => {
      await store.deleteAppointment(request.params.id);
      return reply.code(204).send();
    }
  );

  // DELETE /Appointment - Delete all appointments (test mode only)
  fastify.delete(
    '/Appointment',
    {
      schema: {
        description: 'Delete all appointments (test mode only)',
        tags: ['Appointment'],
        response: {
          204: {
            type: 'null',
            description: 'All appointments deleted successfully',
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return reply.code(403).send({ error: 'Test endpoints disabled' });
      }
      
      await store.deleteAllAppointments();
      return reply.code(204).send();
    }
  );
}
