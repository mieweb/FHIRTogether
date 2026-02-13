/**
 * HL7 Routes
 * 
 * HTTP endpoints for receiving HL7v2 messages over HTTPS.
 * Supports raw HL7 message submission and returns ACK responses.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FhirStore } from '../types/fhir';
import {
  parseSIUMessage,
  parseRawMessage,
  buildACKMessage,
  createACKResponse,
  wrapMLLP,
} from '../hl7/parser';
import { siuToFhirResources } from '../hl7/converter';

/**
 * Find an existing appointment by its placer appointment ID.
 * Uses an indexed query on the identifier column instead of a full table scan.
 * Returns the first match or null if no appointment carries that identifier.
 */
async function findAppointmentByPlacerId(
  store: FhirStore,
  placerApptId: string,
): Promise<import('../types/fhir').Appointment | null> {
  const matches = await store.getAppointments({ identifier: placerApptId, _count: 1 });
  return matches[0] ?? null;
}

/**
 * HL7 message request body interface
 */
interface HL7MessageRequest {
  message: string;
  wrapMLLP?: boolean;
}

/**
 * Register HL7 routes
 */
export async function hl7Routes(fastify: FastifyInstance, store: FhirStore) {
  /**
   * POST /hl7/siu - Receive SIU scheduling message
   * 
   * Accepts HL7v2 SIU messages and converts them to FHIR resources.
   * Returns ACK message.
   */
  fastify.post<{
    Body: HL7MessageRequest | string;
  }>('/hl7/siu', {
    schema: {
      description: 'Receive HL7v2 SIU scheduling message. Accepts raw HL7 text (text/plain, x-application/hl7-v2+er7) or JSON wrapper (application/json). Returns raw HL7 ACK for text requests, or JSON-wrapped ACK for JSON requests.',
      tags: ['HL7'],
      consumes: ['text/plain', 'x-application/hl7-v2+er7', 'application/json'],
      body: {
        oneOf: [
          {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Raw HL7 message' },
              wrapMLLP: { type: 'boolean', description: 'Whether to wrap response in MLLP framing' },
            },
            required: ['message'],
          },
          {
            type: 'string',
            description: 'Raw HL7 message as plain text',
          },
        ],
      },
      produces: ['x-application/hl7-v2+er7', 'text/plain', 'application/json'],
      response: {
        200: {
          description: 'HL7 ACK message (AA - Application Accepted). Raw HL7 for text requests, JSON for JSON requests.',
          oneOf: [
            { type: 'string' },
            { type: 'object', properties: { message: { type: 'string' } } },
          ],
        },
        400: {
          description: 'HL7 ACK message (AR - Application Rejected, message format error)',
          oneOf: [
            { type: 'string' },
            { type: 'object', properties: { message: { type: 'string' } } },
          ],
        },
        500: {
          description: 'HL7 ACK message (AE - Application Error, processing failure)',
          oneOf: [
            { type: 'string' },
            { type: 'object', properties: { message: { type: 'string' } } },
          ],
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: HL7MessageRequest | string }>, reply: FastifyReply) => {
    // Determine if request was JSON to return appropriate response format
    const contentType = request.headers['content-type'] || '';
    const isJsonRequest = contentType.includes('application/json');
    
    // Helper to send ACK response in the appropriate format
    const sendAck = (ackMessage: string, status: number = 200) => {
      if (isJsonRequest) {
        return reply
          .status(status)
          .header('Content-Type', 'application/json')
          .send({ message: ackMessage });
      }
      return reply
        .status(status)
        .header('Content-Type', 'x-application/hl7-v2+er7')
        .send(ackMessage);
    };
    
    try {
      // Extract raw message from body
      let rawMessage: string;
      let wrapResponse = false;
      
      if (typeof request.body === 'string') {
        rawMessage = request.body;
      } else {
        rawMessage = request.body.message;
        wrapResponse = request.body.wrapMLLP || false;
      }
      
      // Normalize literal \n and \r sequences to actual control characters
      // This handles messages sent as plain text with escaped newlines
      rawMessage = rawMessage
        .replace(/\\r\\n/g, '\r\n')
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n');
      
      // Parse the raw message first to validate and get control ID
      const parsed = parseRawMessage(rawMessage);
      
      // Verify it's a SIU message
      if (parsed.messageType !== 'SIU') {
        const ack = createACKResponse(
          {
            segmentType: 'MSH',
            encodingCharacters: '^~\\&',
            sendingApplication: 'UNKNOWN',
            sendingFacility: 'UNKNOWN',
            receivingApplication: 'FHIRTOGETHER',
            receivingFacility: 'SCHEDULING_GATEWAY',
            dateTimeOfMessage: '',
            messageType: { messageCode: parsed.messageType || 'UNK', triggerEvent: '' },
            messageControlId: parsed.controlId || 'UNKNOWN',
            processingId: 'P',
            versionId: '2.3',
          },
          'AE',
          `Unsupported message type: ${parsed.messageType}. Expected SIU.`,
          { code: '200', text: 'Unsupported message type', severity: 'E' }
        );
        
        let ackMessage = buildACKMessage(ack);
        if (wrapResponse) {
          ackMessage = wrapMLLP(ackMessage);
        }
        
        return sendAck(ackMessage, 400);
      }
      
      // Parse the full SIU message
      const siuMessage = parseSIUMessage(rawMessage);
      
      // Convert to FHIR resources
      const fhirResult = siuToFhirResources(siuMessage);
      
      // Process based on action type
      try {
        // Ensure schedule exists
        const existingSchedules = await store.getSchedules({
          actor: `Practitioner/${fhirResult.schedule.id?.replace('schedule-', '')}`,
        });
        
        let scheduleId: string;
        if (existingSchedules.length === 0) {
          const createdSchedule = await store.createSchedule(fhirResult.schedule);
          scheduleId = createdSchedule.id!;
        } else {
          scheduleId = existingSchedules[0].id!;
        }
        
        // Deduplicate by placer appointment ID — update if we've seen this ID before
        const placerApptId = siuMessage.sch.placerAppointmentId?.idNumber;
        const existingAppointment = placerApptId
          ? await findAppointmentByPlacerId(store, placerApptId)
          : null;
        
        if (existingAppointment) {
          // Update the existing appointment rather than creating a duplicate
          await store.updateAppointment(
            existingAppointment.id!,
            fhirResult.appointment
          );
        } else {
          // No match found — create new appointment
          await store.createAppointment(fhirResult.appointment);
          
          // Create slot if provided
          if (fhirResult.slot) {
            fhirResult.slot.schedule.reference = `Schedule/${scheduleId}`;
            await store.createSlot(fhirResult.slot);
          }
        }
        
        // Create success ACK (AA - Application Accepted)
        const ack = createACKResponse(siuMessage.msh, 'AA', 'Message processed successfully');
        let ackMessage = buildACKMessage(ack);
        if (wrapResponse) {
          ackMessage = wrapMLLP(ackMessage);
        }
        
        return sendAck(ackMessage, 200);
        
      } catch (storeError) {
        // Database/store error
        const ack = createACKResponse(
          siuMessage.msh,
          'AE',
          `Error processing message: ${storeError instanceof Error ? storeError.message : 'Unknown error'}`,
          { code: '207', text: 'Application internal error', severity: 'E' }
        );
        
        let ackMessage = buildACKMessage(ack);
        if (wrapResponse) {
          ackMessage = wrapMLLP(ackMessage);
        }
        
        // AE - Application Error (processing failure, can retry)
        return sendAck(ackMessage, 500);
      }
      
    } catch (parseError) {
      // Parse error
      fastify.log.error({ error: parseError }, 'Error parsing HL7 message');
      
      const ack = createACKResponse(
        {
          segmentType: 'MSH',
          encodingCharacters: '^~\\&',
          sendingApplication: 'UNKNOWN',
          sendingFacility: 'UNKNOWN',
          receivingApplication: 'FHIRTOGETHER',
          receivingFacility: 'SCHEDULING_GATEWAY',
          dateTimeOfMessage: '',
          messageType: { messageCode: 'UNK', triggerEvent: '' },
          messageControlId: 'UNKNOWN',
          processingId: 'P',
          versionId: '2.3',
        },
        'AR',
        `Error parsing message: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        { code: '100', text: 'Segment sequence error', severity: 'E' }
      );
      
      // AR - Application Rejected (message format error, don't retry)
      return sendAck(buildACKMessage(ack), 400);
    }
  });

  /**
   * POST /hl7/raw - Receive any HL7 message (raw endpoint)
   * 
   * Accepts raw HL7 messages with content-type: x-application/hl7-v2+er7
   */
  fastify.post('/hl7/raw', {
    schema: {
      description: 'Receive raw HL7v2 message',
      tags: ['HL7'],
      consumes: ['x-application/hl7-v2+er7', 'text/plain', 'application/json'],
      response: {
        200: {
          description: 'ACK response',
          type: 'string',
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let rawMessage: string;
      
      // Handle different content types
      const contentType = request.headers['content-type'] || '';
      
      if (contentType.includes('hl7') || contentType.includes('text/plain')) {
        rawMessage = request.body as string;
      } else if (typeof request.body === 'object' && request.body !== null) {
        rawMessage = (request.body as any).message || JSON.stringify(request.body);
      } else {
        rawMessage = String(request.body);
      }
      
      const parsed = parseRawMessage(rawMessage);
      
      // Route to appropriate handler based on message type
      if (parsed.messageType === 'SIU') {
        // Redirect internally to SIU handler
        const result = await fastify.inject({
          method: 'POST',
          url: '/hl7/siu',
          payload: { message: rawMessage },
        });
        
        const body = JSON.parse(result.body);
        reply.header('Content-Type', 'x-application/hl7-v2+er7');
        return reply.status(result.statusCode).send(body.ack);
      }
      
      // Unsupported message type
      const ack = createACKResponse(
        {
          segmentType: 'MSH',
          encodingCharacters: '^~\\&',
          sendingApplication: 'UNKNOWN',
          sendingFacility: 'UNKNOWN',
          receivingApplication: 'FHIRTOGETHER',
          receivingFacility: 'SCHEDULING_GATEWAY',
          dateTimeOfMessage: '',
          messageType: { messageCode: parsed.messageType || 'UNK', triggerEvent: parsed.triggerEvent || '' },
          messageControlId: parsed.controlId || 'UNKNOWN',
          processingId: 'P',
          versionId: '2.3',
        },
        'AE',
        `Unsupported message type: ${parsed.messageType}`,
        { code: '200', text: 'Unsupported message type', severity: 'E' }
      );
      
      reply.header('Content-Type', 'x-application/hl7-v2+er7');
      return reply.status(400).send(buildACKMessage(ack));
      
    } catch (error) {
      fastify.log.error({ error }, 'Error processing raw HL7 message');
      
      const ack = createACKResponse(
        {
          segmentType: 'MSH',
          encodingCharacters: '^~\\&',
          sendingApplication: 'UNKNOWN',
          sendingFacility: 'UNKNOWN',
          receivingApplication: 'FHIRTOGETHER',
          receivingFacility: 'SCHEDULING_GATEWAY',
          dateTimeOfMessage: '',
          messageType: { messageCode: 'UNK', triggerEvent: '' },
          messageControlId: 'UNKNOWN',
          processingId: 'P',
          versionId: '2.3',
        },
        'AR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { code: '100', text: 'Segment sequence error', severity: 'E' }
      );
      
      reply.header('Content-Type', 'x-application/hl7-v2+er7');
      return reply.status(400).send(buildACKMessage(ack));
    }
  });

  /**
   * GET /hl7/status - Health check for HL7 endpoint
   */
  fastify.get('/hl7/status', {
    schema: {
      description: 'HL7 endpoint status',
      tags: ['HL7'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            supportedMessages: { type: 'array', items: { type: 'string' } },
            endpoints: { type: 'object' },
          },
        },
      },
    },
  }, async () => {
    return {
      status: 'healthy',
      supportedMessages: ['SIU^S12', 'SIU^S13', 'SIU^S14', 'SIU^S15', 'SIU^S17', 'SIU^S26'],
      endpoints: {
        https: '/hl7/siu',
        raw: '/hl7/raw',
        socket: `Port ${process.env.HL7_SOCKET_PORT || '2575'}`,
      },
    };
  });
}
