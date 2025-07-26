/**
 * HL7v2 SIU Message Processing
 * Handles parsing and conversion of HL7v2 SIU messages to FHIR resources
 */

import { Schedule, Slot, CodeableConcept } from '../types/fhir';
import { v4 as uuidv4 } from 'uuid';

export interface HL7v2Message {
  message: string;
  sourceSystem?: string;
}

export interface SIUMessageData {
  messageType: string;
  scheduleId?: string;
  providerId?: string;
  startDateTime?: string;
  endDateTime?: string;
  duration?: number;
  appointmentType?: string;
  status?: string;
}

/**
 * Parse HL7v2 SIU message
 */
export function parseSIUMessage(hl7Message: string): SIUMessageData {
  const lines = hl7Message.split('\r');
  const segments: Record<string, string[]> = {};

  // Parse segments
  for (const line of lines) {
    if (line.trim()) {
      const fields = line.split('|');
      const segmentType = fields[0];
      segments[segmentType] = fields;
    }
  }

  const msh = segments['MSH'] || [];
  const sch = segments['SCH'] || [];
  const pid = segments['PID'] || [];
  const pv1 = segments['PV1'] || [];

  // Extract message type from MSH segment
  const messageType = msh[8] || '';

  const result: SIUMessageData = {
    messageType,
    scheduleId: sch[1] || uuidv4(),
    providerId: sch[6] || 'unknown-provider',
    startDateTime: parseHL7DateTime(sch[11]),
    endDateTime: parseHL7DateTime(sch[12]),
    duration: parseInt(sch[9] || '30', 10),
    appointmentType: sch[7] || 'ROUTINE',
    status: sch[25] || 'PENDING'
  };

  return result;
}

/**
 * Convert HL7v2 datetime to FHIR datetime
 */
function parseHL7DateTime(hl7DateTime?: string): string | undefined {
  if (!hl7DateTime) return undefined;

  // HL7 format: YYYYMMDDHHMMSS
  if (hl7DateTime.length >= 8) {
    const year = hl7DateTime.substring(0, 4);
    const month = hl7DateTime.substring(4, 6);
    const day = hl7DateTime.substring(6, 8);
    const hour = hl7DateTime.substring(8, 10) || '00';
    const minute = hl7DateTime.substring(10, 12) || '00';
    const second = hl7DateTime.substring(12, 14) || '00';

    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    return date.toISOString();
  }

  return undefined;
}

/**
 * Convert SIU message data to FHIR Schedule
 */
export function siuToSchedule(siuData: SIUMessageData): Schedule {
  const schedule: Schedule = {
    resourceType: 'Schedule',
    id: siuData.scheduleId,
    active: true,
    actor: [{
      reference: `Practitioner/${siuData.providerId}`,
      display: `Provider ${siuData.providerId}`
    }],
    serviceCategory: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/service-category',
        code: 'gp',
        display: 'General Practice'
      }]
    }],
    serviceType: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/service-type',
        code: '124',
        display: siuData.appointmentType || 'General Practice'
      }]
    }],
    planningHorizon: {
      start: siuData.startDateTime,
      end: siuData.endDateTime
    },
    comment: `Schedule from SIU message ${siuData.messageType}`
  };

  return schedule;
}

/**
 * Convert SIU message data to FHIR Slot
 */
export function siuToSlot(siuData: SIUMessageData): Slot {
  let status: Slot['status'] = 'free';
  
  // Map HL7v2 status to FHIR status
  switch (siuData.status?.toUpperCase()) {
    case 'BOOKED':
    case 'CONFIRMED':
      status = 'busy';
      break;
    case 'CANCELLED':
    case 'DELETED':
      status = 'busy-unavailable';
      break;
    case 'TENTATIVE':
      status = 'busy-tentative';
      break;
    default:
      status = 'free';
  }

  const endDateTime = siuData.endDateTime || 
    (siuData.startDateTime ? 
      new Date(new Date(siuData.startDateTime).getTime() + (siuData.duration || 30) * 60000).toISOString() 
      : undefined);

  const slot: Slot = {
    resourceType: 'Slot',
    id: `slot-${siuData.scheduleId}-${Date.now()}`,
    schedule: {
      reference: `Schedule/${siuData.scheduleId}`
    },
    status,
    start: siuData.startDateTime || new Date().toISOString(),
    end: endDateTime || new Date(Date.now() + 30 * 60000).toISOString(),
    serviceType: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/service-type',
        code: '124',
        display: siuData.appointmentType || 'General Practice'
      }]
    }],
    comment: `Slot from SIU message ${siuData.messageType}`
  };

  return slot;
}

/**
 * Determine FHIR operations from SIU message type
 */
export function getSIUOperations(messageType: string): {
  operation: 'create' | 'update' | 'delete';
  resourceTypes: ('Schedule' | 'Slot')[];
} {
  switch (messageType.toUpperCase()) {
    case 'SIU^S12': // New appointment booking
      return { operation: 'create', resourceTypes: ['Schedule', 'Slot'] };
    case 'SIU^S13': // Appointment rescheduling
      return { operation: 'update', resourceTypes: ['Slot'] };
    case 'SIU^S15': // Appointment cancellation
      return { operation: 'delete', resourceTypes: ['Slot'] };
    default:
      return { operation: 'create', resourceTypes: ['Schedule', 'Slot'] };
  }
}