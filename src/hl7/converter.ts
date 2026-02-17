/**
 * HL7 to FHIR Converter
 * 
 * Converts SIU HL7v2 messages to FHIR R4 resources
 * (Appointment, Slot, Schedule) and vice versa.
 */

import {
  SIUMessage,
  SIUEventType,
  PIDSegment,
  SCHSegment,
  PV1Segment,
  AIPSegment,
  AILSegment,
  XPN,
} from './types';
import { parseHL7DateTime } from './parser';
import {
  Appointment,
  Slot,
  Schedule,
  Reference,
  CodeableConcept,
  Identifier,
} from '../types/fhir';

/**
 * Format a Date as a naive ISO 8601 string without timezone suffix.
 * Stored datetimes are treated as local wall-clock time.
 */
function toNaiveISO(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/**
 * Mapping from SIU event types to FHIR Appointment status
 */
const SIU_EVENT_TO_FHIR_STATUS: Record<SIUEventType, Appointment['status']> = {
  'S12': 'booked',      // New appointment
  'S13': 'booked',      // Reschedule (same status, different time)
  'S14': 'booked',      // Modification
  'S15': 'cancelled',   // Cancellation
  'S17': 'cancelled',   // Deletion
  'S26': 'noshow',      // No-show
};

/**
 * Mapping from FHIR Appointment status to appropriate SIU event type
 */
const FHIR_STATUS_TO_SIU_EVENT: Partial<Record<Appointment['status'], SIUEventType>> = {
  'booked': 'S12',
  'cancelled': 'S15',
  'noshow': 'S26',
};

/**
 * Convert XPN (person name) to display string
 */
function xpnToDisplay(xpn: XPN | undefined): string {
  if (!xpn) return '';
  
  const parts = [
    xpn.prefix,
    xpn.givenName,
    xpn.middleInitialOrName,
    xpn.familyName,
    xpn.suffix,
    xpn.degree,
  ].filter(p => p && p.trim());
  
  return parts.join(' ');
}

/**
 * Convert PID segment to FHIR Patient reference
 */
function pidToPatientReference(pid: PIDSegment): Reference {
  const patientId = pid.patientIdentifierList[0]?.idNumber || pid.patientId?.idNumber || 'unknown';
  const display = xpnToDisplay(pid.patientName);
  
  return {
    reference: `Patient/${patientId}`,
    display: display || undefined,
  };
}

/**
 * Convert AIP segment to FHIR Practitioner reference
 */
function aipToPractitionerReference(aip: AIPSegment): Reference {
  const practitionerId = aip.personnelResourceId?.id || 'unknown';
  const display = xpnToDisplay(aip.personnelResourceId);
  
  return {
    reference: `Practitioner/${practitionerId}`,
    display: display || undefined,
  };
}

/**
 * Convert PV1 attending doctor to FHIR Practitioner reference
 */
function pv1ToPractitionerReference(pv1: PV1Segment): Reference | undefined {
  if (!pv1.attendingDoctor) return undefined;
  
  const practitionerId = pv1.attendingDoctor.id || 'unknown';
  const display = xpnToDisplay(pv1.attendingDoctor);
  
  return {
    reference: `Practitioner/${practitionerId}`,
    display: display || undefined,
  };
}

/**
 * Convert AIL segment to FHIR Location reference
 */
function ailToLocationReference(ail: AILSegment): Reference | undefined {
  if (!ail.locationResourceId) return undefined;
  
  const locationId = ail.locationResourceId.pointOfCare || 
    ail.locationResourceId.facility || 
    'unknown';
  const display = ail.locationTypeCode?.text || ail.locationResourceId.facility;
  
  return {
    reference: `Location/${locationId}`,
    display: display || undefined,
  };
}

/**
 * Convert SCH reason to FHIR CodeableConcept
 */
function schReasonToCodeableConcept(sch: SCHSegment): CodeableConcept[] {
  const reasons: CodeableConcept[] = [];
  
  if (sch.appointmentReason?.text || sch.appointmentReason?.identifier) {
    reasons.push({
      coding: sch.appointmentReason.identifier ? [{
        code: sch.appointmentReason.identifier,
        display: sch.appointmentReason.text,
      }] : undefined,
      text: sch.appointmentReason.text,
    });
  }
  
  if (sch.eventReason?.text || sch.eventReason?.identifier) {
    reasons.push({
      coding: sch.eventReason.identifier ? [{
        code: sch.eventReason.identifier,
        display: sch.eventReason.text,
      }] : undefined,
      text: sch.eventReason.text,
    });
  }
  
  return reasons;
}

/**
 * Convert SCH appointment type to FHIR CodeableConcept
 */
function schTypeToCodeableConcept(sch: SCHSegment): CodeableConcept | undefined {
  if (!sch.appointmentType?.identifier && !sch.appointmentType?.text) {
    return undefined;
  }
  
  return {
    coding: sch.appointmentType.identifier ? [{
      code: sch.appointmentType.identifier,
      display: sch.appointmentType.text,
    }] : undefined,
    text: sch.appointmentType.text,
  };
}

/**
 * Extract appointment times from SCH segment
 */
function getAppointmentTimes(sch: SCHSegment): { start: string; end: string } {
  let start: Date;
  let end: Date;
  
  if (sch.appointmentTiming?.startDateTime) {
    start = parseHL7DateTime(sch.appointmentTiming.startDateTime);
  } else {
    start = new Date();
  }
  
  if (sch.appointmentTiming?.endDateTime) {
    end = parseHL7DateTime(sch.appointmentTiming.endDateTime);
  } else if (sch.appointmentDuration) {
    end = new Date(start.getTime() + sch.appointmentDuration * 60000);
  } else {
    end = new Date(start.getTime() + 30 * 60000); // Default 30 minutes
  }
  
  return {
    start: toNaiveISO(start),
    end: toNaiveISO(end),
  };
}

/**
 * Convert SIU message to FHIR Appointment resource
 */
export function siuToFhirAppointment(siu: SIUMessage): Appointment {
  const eventType = siu.msh.messageType.triggerEvent as SIUEventType;
  const status = SIU_EVENT_TO_FHIR_STATUS[eventType] || 'booked';
  const times = getAppointmentTimes(siu.sch);
  
  // Build identifiers
  const identifiers: Identifier[] = [];
  if (siu.sch.placerAppointmentId?.idNumber) {
    identifiers.push({
      system: 'urn:hl7:placer-appointment-id',
      value: siu.sch.placerAppointmentId.idNumber,
      use: 'official',
    });
  }
  if (siu.sch.fillerAppointmentId?.idNumber && 
      siu.sch.fillerAppointmentId.idNumber !== siu.sch.placerAppointmentId?.idNumber) {
    identifiers.push({
      system: 'urn:hl7:filler-appointment-id',
      value: siu.sch.fillerAppointmentId.idNumber,
    });
  }
  
  // Build participants
  const participants: Appointment['participant'] = [];
  
  // Add patient participant
  if (siu.pid) {
    participants.push({
      type: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
          code: 'SBJ',
          display: 'subject',
        }],
      }],
      actor: pidToPatientReference(siu.pid),
      required: 'required',
      status: status === 'cancelled' ? 'declined' : 'accepted',
    });
  }
  
  // Add practitioner participant from AIP or PV1
  if (siu.aip) {
    participants.push({
      type: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
          code: 'PPRF',
          display: 'primary performer',
        }],
      }],
      actor: aipToPractitionerReference(siu.aip),
      required: 'required',
      status: status === 'cancelled' ? 'declined' : 'accepted',
    });
  } else if (siu.pv1) {
    const practRef = pv1ToPractitionerReference(siu.pv1);
    if (practRef) {
      participants.push({
        type: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
            code: 'PPRF',
            display: 'primary performer',
          }],
        }],
        actor: practRef,
        required: 'required',
        status: status === 'cancelled' ? 'declined' : 'accepted',
      });
    }
  }
  
  // Add location participant
  if (siu.ail) {
    const locationRef = ailToLocationReference(siu.ail);
    if (locationRef) {
      participants.push({
        type: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
            code: 'LOC',
            display: 'location',
          }],
        }],
        actor: locationRef,
        required: 'required',
        status: 'accepted',
      });
    }
  }
  
  // Build the appointment
  const appointment: Appointment = {
    resourceType: 'Appointment',
    identifier: identifiers.length > 0 ? identifiers : undefined,
    status,
    appointmentType: schTypeToCodeableConcept(siu.sch),
    reasonCode: schReasonToCodeableConcept(siu.sch),
    description: siu.sch.appointmentReason?.text || siu.sch.eventReason?.text,
    start: times.start,
    end: times.end,
    created: toNaiveISO(new Date()),
    comment: siu.sch.fillerStatusCode,
    participant: participants,
  };
  
  return appointment;
}

/**
 * Convert SIU message to FHIR Slot resource
 * Creates a slot marking the appointment time
 */
export function siuToFhirSlot(siu: SIUMessage, scheduleRef: string): Slot {
  const eventType = siu.msh.messageType.triggerEvent as SIUEventType;
  const times = getAppointmentTimes(siu.sch);
  
  // Determine slot status based on event type
  let slotStatus: Slot['status'];
  switch (eventType) {
    case 'S12': // New appointment
    case 'S13': // Reschedule
    case 'S14': // Modification
      slotStatus = 'busy';
      break;
    case 'S15': // Cancellation
    case 'S17': // Deletion
      slotStatus = 'free';
      break;
    case 'S26': // No-show
      slotStatus = 'busy-unavailable';
      break;
    default:
      slotStatus = 'busy';
  }
  
  const slot: Slot = {
    resourceType: 'Slot',
    identifier: siu.sch.placerAppointmentId ? [{
      system: 'urn:hl7:placer-appointment-id',
      value: siu.sch.placerAppointmentId.idNumber,
    }] : undefined,
    schedule: {
      reference: scheduleRef,
    },
    status: slotStatus,
    start: times.start,
    end: times.end,
    serviceType: siu.sch.appointmentType ? [{
      text: siu.sch.appointmentType.text,
    }] : undefined,
    comment: siu.sch.appointmentReason?.text || siu.sch.eventReason?.text,
  };
  
  return slot;
}

/**
 * Find or create a schedule reference from SIU message
 */
export function siuToScheduleReference(siu: SIUMessage): { scheduleId: string; practitionerId: string } {
  let practitionerId = 'unknown';
  
  if (siu.aip?.personnelResourceId?.id) {
    practitionerId = siu.aip.personnelResourceId.id;
  } else if (siu.pv1?.attendingDoctor?.id) {
    practitionerId = siu.pv1.attendingDoctor.id;
  }
  
  // Generate a schedule ID based on practitioner
  const scheduleId = `schedule-${practitionerId}`;
  
  return { scheduleId, practitionerId };
}

/**
 * Create a Schedule resource from SIU message if needed
 */
export function siuToFhirSchedule(siu: SIUMessage): Schedule {
  const { scheduleId, practitionerId } = siuToScheduleReference(siu);
  
  let practitionerName = '';
  if (siu.aip?.personnelResourceId) {
    practitionerName = xpnToDisplay(siu.aip.personnelResourceId);
  } else if (siu.pv1?.attendingDoctor) {
    practitionerName = xpnToDisplay(siu.pv1.attendingDoctor);
  }
  
  const schedule: Schedule = {
    resourceType: 'Schedule',
    id: scheduleId,
    active: true,
    actor: [{
      reference: `Practitioner/${practitionerId}`,
      display: practitionerName || undefined,
    }],
    serviceType: siu.sch.appointmentType ? [{
      text: siu.sch.appointmentType.text,
    }] : undefined,
    comment: `Schedule for ${practitionerName || practitionerId}`,
  };
  
  return schedule;
}

/**
 * Result of converting SIU to FHIR resources
 */
export interface SIUToFhirResult {
  appointment: Appointment;
  slot?: Slot;
  schedule: Schedule;
  action: 'create' | 'update' | 'cancel' | 'noshow';
}

/**
 * Convert SIU message to all relevant FHIR resources
 */
export function siuToFhirResources(siu: SIUMessage): SIUToFhirResult {
  const eventType = siu.msh.messageType.triggerEvent as SIUEventType;
  const schedule = siuToFhirSchedule(siu);
  const appointment = siuToFhirAppointment(siu);
  const slot = siuToFhirSlot(siu, `Schedule/${schedule.id}`);
  
  // Determine action
  let action: SIUToFhirResult['action'];
  switch (eventType) {
    case 'S12':
      action = 'create';
      break;
    case 'S13':
    case 'S14':
      action = 'update';
      break;
    case 'S15':
    case 'S17':
      action = 'cancel';
      break;
    case 'S26':
      action = 'noshow';
      break;
    default:
      action = 'create';
  }
  
  return {
    appointment,
    slot,
    schedule,
    action,
  };
}

/**
 * Convert FHIR Appointment to appointment info for HL7 generation
 */
export function fhirAppointmentToHL7Info(appointment: Appointment): {
  appointmentId: string;
  startDateTime: Date;
  durationMinutes: number;
  reason?: string;
  appointmentType?: string;
  patientId?: string;
  practitionerId?: string;
} {
  const appointmentId = appointment.identifier?.[0]?.value || appointment.id || 'unknown';
  const startDateTime = appointment.start ? new Date(appointment.start) : new Date();
  const endDateTime = appointment.end ? new Date(appointment.end) : new Date(startDateTime.getTime() + 30 * 60000);
  const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000);
  
  // Extract patient and practitioner from participants
  let patientId: string | undefined;
  let practitionerId: string | undefined;
  
  for (const participant of appointment.participant || []) {
    const ref = participant.actor?.reference || '';
    if (ref.startsWith('Patient/')) {
      patientId = ref.replace('Patient/', '');
    } else if (ref.startsWith('Practitioner/')) {
      practitionerId = ref.replace('Practitioner/', '');
    }
  }
  
  return {
    appointmentId,
    startDateTime,
    durationMinutes,
    reason: appointment.description || appointment.reasonCode?.[0]?.text,
    appointmentType: appointment.appointmentType?.text || appointment.appointmentType?.coding?.[0]?.code,
    patientId,
    practitionerId,
  };
}

/**
 * Get SIU event type for FHIR appointment status
 */
export function fhirStatusToSIUEvent(status: Appointment['status'], isNew: boolean = false): SIUEventType {
  if (isNew && status === 'booked') {
    return 'S12';
  }
  return FHIR_STATUS_TO_SIU_EVENT[status] || 'S14';
}
