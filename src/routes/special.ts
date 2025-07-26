/**
 * HL7v2 and Test Mode Routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStore } from '../store/factory';
import { createOperationOutcome } from '../utils/fhir';
import { parseSIUMessage, siuToSchedule, siuToSlot, getSIUOperations, HL7v2Message } from '../utils/hl7v2';

export async function specialRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /$hl7v2-ingest - Ingest HL7v2 SIU messages
  fastify.post('/$hl7v2-ingest', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          sourceSystem: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            resourceType: { type: 'string' },
            status: { type: 'string' },
            results: { type: 'object' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: HL7v2Message }>, reply: FastifyReply) => {
    try {
      const { message, sourceSystem } = request.body;
      
      // Parse the HL7v2 message
      const siuData = parseSIUMessage(message);
      const operations = getSIUOperations(siuData.messageType);
      
      const store = getStore();
      const results: any = {
        messageType: siuData.messageType,
        operation: operations.operation,
        processedResources: []
      };

      switch (operations.operation) {
        case 'create':
          if (operations.resourceTypes.includes('Schedule')) {
            const schedule = siuToSchedule(siuData);
            const createdSchedule = await store.createSchedule(schedule);
            results.processedResources.push({
              resourceType: 'Schedule',
              id: createdSchedule.id,
              action: 'created'
            });
          }

          if (operations.resourceTypes.includes('Slot')) {
            const slot = siuToSlot(siuData);
            const createdSlot = await store.createSlot(slot);
            results.processedResources.push({
              resourceType: 'Slot',
              id: createdSlot.id,
              action: 'created'
            });
          }
          break;

        case 'update':
          if (operations.resourceTypes.includes('Slot')) {
            const slot = siuToSlot(siuData);
            if (slot.id) {
              const updatedSlot = await store.updateSlot(slot.id, slot);
              results.processedResources.push({
                resourceType: 'Slot',
                id: updatedSlot.id,
                action: 'updated'
              });
            }
          }
          break;

        case 'delete':
          if (operations.resourceTypes.includes('Slot')) {
            const slot = siuToSlot(siuData);
            if (slot.id) {
              const deleted = await store.deleteSlot(slot.id);
              results.processedResources.push({
                resourceType: 'Slot',
                id: slot.id,
                action: deleted ? 'deleted' : 'not-found'
              });
            }
          }
          break;
      }

      const response = {
        resourceType: 'OperationOutcome',
        status: 'success',
        results
      };

      reply.code(200).send(response);
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', `HL7v2 processing failed: ${(error as Error).message}`);
      reply.code(500).send(outcome);
    }
  });

  // POST /$simulate-week - Generate random provider availability
  fastify.post('/$simulate-week', {
    schema: {
      body: {
        type: 'object',
        required: ['providerId'],
        properties: {
          providerId: { type: 'string' },
          serviceTypes: { type: 'array' },
          startDate: { type: 'string' },
          endDate: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            resourceType: { type: 'string' },
            status: { type: 'string' },
            simulatedWeek: { type: 'object' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { providerId: string; serviceTypes?: string[]; startDate?: string; endDate?: string } }>, reply: FastifyReply) => {
    try {
      if (process.env.ENABLE_TEST_MODE !== 'true') {
        const outcome = createOperationOutcome('error', 'forbidden', 'Simulation operations only allowed in test mode');
        reply.code(403).send(outcome);
        return;
      }

      const { providerId } = request.body;
      const store = getStore();
      
      const simulatedWeek = await store.simulateWeek(providerId);

      const response = {
        resourceType: 'OperationOutcome',
        status: 'success',
        simulatedWeek: {
          providerId,
          schedulesCreated: simulatedWeek.schedules.length,
          slotsCreated: simulatedWeek.slots.length,
          scheduleIds: simulatedWeek.schedules.map(s => s.id),
          sampleSlots: simulatedWeek.slots.slice(0, 5).map(slot => ({
            id: slot.id,
            start: slot.start,
            end: slot.end,
            status: slot.status
          }))
        }
      };

      reply.code(200).type('application/json').send(JSON.stringify(response));
    } catch (error) {
      const outcome = createOperationOutcome('error', 'processing', `Simulation failed: ${(error as Error).message}`);
      reply.code(500).send(outcome);
    }
  });

  // GET /metadata - FHIR capability statement
  fastify.get('/metadata', async (request: FastifyRequest, reply: FastifyReply) => {
    const capabilityStatement = {
      resourceType: 'CapabilityStatement',
      id: 'fhirtogether-scheduling-synapse',
      name: 'FHIRTogether Scheduling Synapse',
      title: 'FHIRTogether Scheduling Synapse',
      status: 'active',
      date: new Date().toISOString(),
      publisher: 'mieweb',
      description: 'FHIR-compliant gateway and test server for schedule and appointment availability',
      kind: 'instance',
      software: {
        name: 'FHIRTogether Scheduling Synapse',
        version: '1.0.0'
      },
      implementation: {
        description: 'TypeScript + Fastify FHIR scheduling server'
      },
      fhirVersion: '4.0.1',
      format: ['application/fhir+json', 'application/json'],
      rest: [{
        mode: 'server',
        resource: [
          {
            type: 'Schedule',
            interaction: [
              { code: 'read' },
              { code: 'create' },
              { code: 'update' },
              { code: 'delete' },
              { code: 'search-type' }
            ],
            searchParam: [
              { name: 'actor', type: 'reference' },
              { name: 'date', type: 'date' },
              { name: 'identifier', type: 'token' },
              { name: 'active', type: 'token' },
              { name: 'service-type', type: 'token' },
              { name: 'specialty', type: 'token' }
            ]
          },
          {
            type: 'Slot',
            interaction: [
              { code: 'read' },
              { code: 'create' },
              { code: 'update' },
              { code: 'delete' },
              { code: 'search-type' }
            ],
            searchParam: [
              { name: 'schedule', type: 'reference' },
              { name: 'status', type: 'token' },
              { name: 'start', type: 'date' },
              { name: 'end', type: 'date' },
              { name: 'service-type', type: 'token' },
              { name: 'specialty', type: 'token' }
            ]
          },
          {
            type: 'Appointment',
            interaction: [
              { code: 'read' },
              { code: 'create' },
              { code: 'update' },
              { code: 'delete' },
              { code: 'search-type' }
            ],
            searchParam: [
              { name: 'date', type: 'date' },
              { name: 'actor', type: 'reference' },
              { name: 'identifier', type: 'token' },
              { name: 'patient', type: 'reference' },
              { name: 'practitioner', type: 'reference' },
              { name: 'status', type: 'token' },
              { name: 'service-type', type: 'token' }
            ]
          }
        ]
      }]
    };

    reply.code(200).send(capabilityStatement);
  });

  // GET /health - Health check endpoint
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const health = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      backend: process.env.STORE_BACKEND || 'simulator',
      testMode: process.env.ENABLE_TEST_MODE === 'true'
    };

    reply.code(200).send(health);
  });
}