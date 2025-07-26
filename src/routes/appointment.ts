/**
 * Appointment Resource Routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStore } from '../store/factory';
import { createBundle, createOperationOutcome, parseSearchParams } from '../utils/fhir';
import { Appointment, FhirAppointmentQuery } from '../types/fhir';

export async function appointmentRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /Appointment - Search appointments
  fastify.get('/Appointment', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          actor: { type: 'string' },
          identifier: { type: 'string' },
          patient: { type: 'string' },
          practitioner: { type: 'string' },
          status: { type: 'string' },
          serviceType: { type: 'string' },
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
      
      const query: FhirAppointmentQuery = {
        ...searchParams,
        ...paginationParams
      };

      const store = getStore();
      const appointments = await store.getAppointments(query);
      
      const bundle = createBundle(appointments, 'searchset');
      
      reply.code(200).send(bundle);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // GET /Appointment/{id} - Get appointment by ID
  fastify.get('/Appointment/:id', {
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
      const appointment = await store.getAppointmentById(id);

      if (!appointment) {
        const outcome = createOperationOutcome('error', 'not-found', `Appointment ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      reply.code(200).send(appointment);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // POST /Appointment - Book new appointment
  fastify.post('/Appointment', {
    schema: {
      body: {
        type: 'object',
        required: ['resourceType', 'status', 'participant'],
        properties: {
          resourceType: { type: 'string', enum: ['Appointment'] },
          id: { type: 'string' },
          status: { type: 'string' },
          serviceCategory: { type: 'array' },
          serviceType: { type: 'array' },
          specialty: { type: 'array' },
          appointmentType: { type: 'object' },
          reasonCode: { type: 'array' },
          reasonReference: { type: 'array' },
          priority: { type: 'number' },
          description: { type: 'string' },
          slot: { type: 'array' },
          comment: { type: 'string' },
          patientInstruction: { type: 'string' },
          basedOn: { type: 'array' },
          participant: { type: 'array' },
          requestedPeriod: { type: 'array' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Appointment }>, reply: FastifyReply) => {
    try {
      const appointment = request.body;
      const store = getStore();
      
      // Validate that referenced slots are available
      if (appointment.slot) {
        for (const slotRef of appointment.slot) {
          const slotId = slotRef.reference?.split('/')[1];
          if (slotId) {
            const slot = await store.getSlotById(slotId);
            if (!slot) {
              const outcome = createOperationOutcome('error', 'not-found', `Referenced slot ${slotId} not found`);
              reply.code(400).send(outcome);
              return;
            }
            if (slot.status !== 'free') {
              const outcome = createOperationOutcome('error', 'conflict', `Slot ${slotId} is not available`);
              reply.code(409).send(outcome);
              return;
            }
          }
        }
      }

      const createdAppointment = await store.createAppointment(appointment);
      reply.code(201).send(createdAppointment);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // PUT /Appointment/{id} - Update appointment
  fastify.put('/Appointment/:id', {
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
        required: ['resourceType', 'status', 'participant'],
        properties: {
          resourceType: { type: 'string', enum: ['Appointment'] },
          id: { type: 'string' },
          status: { type: 'string' },
          serviceCategory: { type: 'array' },
          serviceType: { type: 'array' },
          specialty: { type: 'array' },
          appointmentType: { type: 'object' },
          reasonCode: { type: 'array' },
          reasonReference: { type: 'array' },
          priority: { type: 'number' },
          description: { type: 'string' },
          slot: { type: 'array' },
          comment: { type: 'string' },
          patientInstruction: { type: 'string' },
          basedOn: { type: 'array' },
          participant: { type: 'array' },
          requestedPeriod: { type: 'array' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Appointment }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const appointment = request.body;
      const store = getStore();
      
      const existingAppointment = await store.getAppointmentById(id);
      if (!existingAppointment) {
        const outcome = createOperationOutcome('error', 'not-found', `Appointment ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      const updatedAppointment = await store.updateAppointment(id, appointment);
      reply.code(200).send(updatedAppointment);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });

  // DELETE /Appointment/{id} - Cancel appointment
  fastify.delete('/Appointment/:id', {
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
      const deleted = await store.deleteAppointment(id);

      if (!deleted) {
        const outcome = createOperationOutcome('error', 'not-found', `Appointment ${id} not found`);
        reply.code(404).send(outcome);
        return;
      }

      reply.code(204).send();
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', (error as Error).message);
      reply.code(500).send(outcome);
    }
  });
}