/**
 * SIU Message Generator
 * 
 * Generates realistic HL7v2 SIU scheduling messages
 * as if from a legacy EHR system.
 */

import {
  SIUMessage,
  MSHSegment,
  SCHSegment,
  PIDSegment,
  PV1Segment,
  RGSSegment,
  AIGSegment,
  AILSegment,
  AIPSegment,
  SIUEventType,
  ResourceAction,
  ScheduleStatus,
  HL7_ENCODING_CHARACTERS,
} from './types';
import { formatHL7DateTime, buildSIUMessage } from './parser';

/**
 * Configuration for the legacy EHR simulator
 */
export interface LegacyEHRConfig {
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  hl7Version: string;
}

/**
 * Provider information for generating appointments
 */
export interface ProviderInfo {
  id: string;
  familyName: string;
  givenName: string;
  middleInitial?: string;
  specialty: string;
  npi?: string;
}

/**
 * Patient information for generating appointments
 */
export interface PatientInfo {
  id: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string; // yyyyMMdd
  sex: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  phone?: string;
  ssn?: string;
}

/**
 * Appointment information
 */
export interface AppointmentInfo {
  appointmentId: string;
  startDateTime: Date;
  durationMinutes: number;
  reason?: string;
  appointmentType?: string;
  location?: {
    pointOfCare: string;
    facility?: string;
  };
}

/**
 * Default legacy EHR configuration
 */
export const DEFAULT_EHR_CONFIG: LegacyEHRConfig = {
  sendingApplication: 'LEGACY_EHR',
  sendingFacility: 'MAIN_HOSPITAL',
  receivingApplication: 'FHIRTOGETHER',
  receivingFacility: 'SCHEDULING_GATEWAY',
  hl7Version: '2.3',
};

/**
 * Sample providers for generating test data
 */
export const SAMPLE_PROVIDERS: ProviderInfo[] = [
  {
    id: '1',
    familyName: 'Adams',
    givenName: 'Douglas',
    middleInitial: 'A',
    specialty: 'Family Medicine',
    npi: '1234567890',
  },
  {
    id: '2',
    familyName: 'Colfer',
    givenName: 'Eoin',
    middleInitial: 'D',
    specialty: 'Internal Medicine',
    npi: '2345678901',
  },
  {
    id: '3',
    familyName: 'Dent',
    givenName: 'Arthur',
    specialty: 'Pediatrics',
    npi: '3456789012',
  },
  {
    id: '4',
    familyName: 'Prefect',
    givenName: 'Ford',
    specialty: 'Cardiology',
    npi: '4567890123',
  },
  {
    id: '5',
    familyName: 'Beeblebrox',
    givenName: 'Zaphod',
    specialty: 'Neurology',
    npi: '5678901234',
  },
];

/**
 * Sample patients for generating test data
 */
export const SAMPLE_PATIENTS: PatientInfo[] = [
  {
    id: '42',
    familyName: 'Beeblebrox',
    givenName: 'Zaphod',
    dateOfBirth: '19781012',
    sex: 'M',
    address: { street: '1 Heart of Gold ave', city: 'Fort Wayne', state: 'IN', zip: '46804' },
    phone: '(260)555-1234',
    ssn: '999999999',
  },
  {
    id: '135769',
    familyName: 'Mouse',
    givenName: 'Mickey',
    dateOfBirth: '19281118',
    sex: 'M',
    address: { street: '123 Main St.', city: 'Lake Buena Vista', state: 'FL', zip: '32830' },
    phone: '(407)939-1289',
    ssn: '99999999',
  },
  {
    id: '10001',
    familyName: 'Marvin',
    givenName: 'Android',
    dateOfBirth: '20100315',
    sex: 'M',
    address: { street: '99 Infinite Improbability Dr', city: 'Magrathea', state: 'CA', zip: '90210' },
    phone: '(555)123-4567',
  },
  {
    id: '10002',
    familyName: 'Trillian',
    givenName: 'Tricia',
    dateOfBirth: '19850522',
    sex: 'F',
    address: { street: '42 Galaxy Lane', city: 'London', state: 'UK', zip: 'SW1A 1AA' },
    phone: '(555)234-5678',
  },
  {
    id: '10003',
    familyName: 'Slartibartfast',
    givenName: 'Fjord',
    dateOfBirth: '19600101',
    sex: 'M',
    address: { street: '1 Norway Fjord St', city: 'Oslo', state: 'NW', zip: '00001' },
    phone: '(555)345-6789',
  },
];

/**
 * Appointment reasons
 */
export const APPOINTMENT_REASONS = [
  { code: 'OFFICE', text: 'Office visit' },
  { code: 'FOLLOWUP', text: 'Follow-up visit' },
  { code: 'NEWPT', text: 'New patient visit' },
  { code: 'PHYSICAL', text: 'Annual physical' },
  { code: 'CONSULT', text: 'Consultation' },
  { code: 'URGENT', text: 'Urgent care visit' },
  { code: 'PROCEDURE', text: 'Procedure' },
  { code: 'VACCINE', text: 'Vaccination' },
  { code: 'LABREV', text: 'Lab review' },
  { code: 'TELEHEALTH', text: 'Telehealth visit' },
];

/**
 * Appointment types
 */
export const APPOINTMENT_TYPES = [
  'OFFICE',
  'CLINIC',
  'TELEHEALTH',
  'HOME',
  'URGENT',
];

let messageCounter = 0;

/**
 * Generate a unique message control ID
 */
function generateMessageControlId(): string {
  messageCounter++;
  const timestamp = Date.now().toString();
  return `${timestamp}${messageCounter.toString().padStart(4, '0')}`;
}

/**
 * Get resource action based on event type
 */
function getResourceAction(eventType: SIUEventType): ResourceAction {
  switch (eventType) {
    case 'S12':
      return 'A'; // Add
    case 'S13':
    case 'S14':
      return 'U'; // Update
    case 'S15':
      return 'C'; // Cancel
    case 'S17':
      return 'D'; // Delete
    case 'S26':
      return 'U'; // Update (no-show)
    default:
      return 'A';
  }
}

/**
 * Get filler status based on event type
 */
function getFillerStatus(eventType: SIUEventType): ScheduleStatus {
  switch (eventType) {
    case 'S12':
    case 'S13':
    case 'S14':
      return 'Scheduled';
    case 'S15':
    case 'S17':
      return 'Cancelled';
    case 'S26':
      return 'NoShow';
    default:
      return 'Scheduled';
  }
}

/**
 * Build MSH segment for SIU message
 */
function buildMSHSegment(
  config: LegacyEHRConfig,
  eventType: SIUEventType,
  messageControlId: string,
  timestamp: Date
): MSHSegment {
  return {
    segmentType: 'MSH',
    encodingCharacters: HL7_ENCODING_CHARACTERS,
    sendingApplication: config.sendingApplication,
    sendingFacility: config.sendingFacility,
    receivingApplication: config.receivingApplication,
    receivingFacility: config.receivingFacility,
    dateTimeOfMessage: formatHL7DateTime(timestamp),
    messageType: {
      messageCode: 'SIU',
      triggerEvent: eventType,
    },
    messageControlId,
    processingId: 'P',
    versionId: config.hl7Version,
  };
}

/**
 * Build SCH segment
 */
function buildSCHSegment(
  appointment: AppointmentInfo,
  eventType: SIUEventType,
  provider: ProviderInfo
): SCHSegment {
  const endDateTime = new Date(appointment.startDateTime.getTime() + appointment.durationMinutes * 60000);
  const reason = appointment.reason 
    ? APPOINTMENT_REASONS.find(r => r.code === appointment.reason || r.text === appointment.reason) 
      || { code: appointment.reason, text: appointment.reason }
    : APPOINTMENT_REASONS[0];
  
  return {
    segmentType: 'SCH',
    placerAppointmentId: {
      idNumber: appointment.appointmentId,
      assigningAuthority: appointment.appointmentId,
    },
    fillerAppointmentId: {
      idNumber: appointment.appointmentId,
      assigningAuthority: appointment.appointmentId,
    },
    scheduleId: appointment.appointmentId,
    eventReason: {
      identifier: reason.code,
      text: reason.text,
    },
    appointmentReason: {
      text: appointment.reason || 'reason for the appointment',
    },
    appointmentType: {
      identifier: appointment.appointmentType || 'OFFICE',
      text: appointment.appointmentType || 'OFFICE',
    },
    appointmentDuration: appointment.durationMinutes,
    appointmentDurationUnits: 'm',
    appointmentTiming: {
      quantity: appointment.durationMinutes,
      startDateTime: formatHL7DateTime(appointment.startDateTime),
      endDateTime: formatHL7DateTime(endDateTime),
    },
    fillerContactPerson: {
      familyName: provider.familyName,
      givenName: provider.givenName,
      middleInitialOrName: provider.middleInitial,
    },
    enteredByPerson: {
      familyName: provider.familyName,
      givenName: provider.givenName,
      middleInitialOrName: provider.middleInitial,
    },
    fillerStatusCode: getFillerStatus(eventType),
  };
}

/**
 * Build PID segment
 */
function buildPIDSegment(patient: PatientInfo): PIDSegment {
  return {
    segmentType: 'PID',
    setId: '1',
    patientIdentifierList: [{
      idNumber: patient.id,
    }],
    patientName: {
      familyName: patient.familyName,
      givenName: patient.givenName,
    },
    dateOfBirth: patient.dateOfBirth,
    administrativeSex: patient.sex,
    patientAddress: patient.address ? {
      streetAddress: patient.address.street,
      city: patient.address.city,
      stateOrProvince: patient.address.state,
      zipOrPostalCode: patient.address.zip,
    } : undefined,
    phoneNumberHome: patient.phone ? {
      telephoneNumber: patient.phone,
    } : undefined,
    ssn: patient.ssn,
  };
}

/**
 * Build PV1 segment
 */
function buildPV1Segment(provider: ProviderInfo, visitNumber?: string): PV1Segment {
  return {
    segmentType: 'PV1',
    setId: '1',
    patientClass: 'O', // Outpatient
    attendingDoctor: {
      id: provider.id,
      familyName: provider.familyName,
      givenName: provider.givenName,
      middleInitialOrName: provider.middleInitial,
      prefix: 'MD',
    },
    visitNumber: visitNumber || provider.npi,
  };
}

/**
 * Build RGS segment
 */
function buildRGSSegment(eventType: SIUEventType): RGSSegment {
  return {
    segmentType: 'RGS',
    setId: '1',
    segmentActionCode: getResourceAction(eventType),
  };
}

/**
 * Build AIG segment
 */
function buildAIGSegment(
  provider: ProviderInfo,
  eventType: SIUEventType
): AIGSegment {
  return {
    segmentType: 'AIG',
    setId: '1',
    segmentActionCode: getResourceAction(eventType),
    resourceId: {
      id: provider.id,
      name: `${provider.givenName}, ${provider.familyName}`,
    },
    resourceType: 'D', // Doctor/Physician
  };
}

/**
 * Build AIL segment
 */
function buildAILSegment(
  appointment: AppointmentInfo,
  eventType: SIUEventType
): AILSegment {
  const location = appointment.location || { pointOfCare: 'OFFICE', facility: 'Main Office' };
  
  return {
    segmentType: 'AIL',
    setId: '1',
    segmentActionCode: getResourceAction(eventType),
    locationResourceId: {
      pointOfCare: location.pointOfCare,
      facility: location.pointOfCare,
    },
    locationTypeCode: {
      text: location.facility || 'Main Office',
    },
    startDateTime: formatHL7DateTime(appointment.startDateTime),
    duration: appointment.durationMinutes,
    durationUnits: 'm^Minutes',
    fillerStatusCode: getFillerStatus(eventType),
  };
}

/**
 * Build AIP segment
 */
function buildAIPSegment(
  provider: ProviderInfo,
  appointment: AppointmentInfo,
  eventType: SIUEventType
): AIPSegment {
  return {
    segmentType: 'AIP',
    setId: '1',
    segmentActionCode: getResourceAction(eventType),
    personnelResourceId: {
      id: provider.id,
      familyName: provider.familyName,
      givenName: provider.givenName,
      middleInitialOrName: provider.middleInitial,
      prefix: 'MD',
    },
    resourceType: `D^${provider.givenName}, ${provider.familyName}`,
    startDateTime: formatHL7DateTime(appointment.startDateTime),
    duration: appointment.durationMinutes,
    durationUnits: 'm^Minutes',
    fillerStatusCode: getFillerStatus(eventType),
  };
}

/**
 * Generate a complete SIU message
 */
export function generateSIUMessage(
  eventType: SIUEventType,
  patient: PatientInfo,
  provider: ProviderInfo,
  appointment: AppointmentInfo,
  config: LegacyEHRConfig = DEFAULT_EHR_CONFIG
): SIUMessage {
  const timestamp = new Date();
  const messageControlId = generateMessageControlId();

  return {
    msh: buildMSHSegment(config, eventType, messageControlId, timestamp),
    sch: buildSCHSegment(appointment, eventType, provider),
    pid: buildPIDSegment(patient),
    pv1: buildPV1Segment(provider),
    rgs: buildRGSSegment(eventType),
    aig: buildAIGSegment(provider, eventType),
    ail: buildAILSegment(appointment, eventType),
    aip: buildAIPSegment(provider, appointment, eventType),
  };
}

/**
 * Generate SIU^S12 (New Appointment) message
 */
export function generateNewAppointmentMessage(
  patient: PatientInfo,
  provider: ProviderInfo,
  appointment: AppointmentInfo,
  config?: LegacyEHRConfig
): SIUMessage {
  return generateSIUMessage('S12', patient, provider, appointment, config);
}

/**
 * Generate SIU^S14 (Appointment Modification) message
 */
export function generateModifyAppointmentMessage(
  patient: PatientInfo,
  provider: ProviderInfo,
  appointment: AppointmentInfo,
  config?: LegacyEHRConfig
): SIUMessage {
  return generateSIUMessage('S14', patient, provider, appointment, config);
}

/**
 * Generate SIU^S15 (Appointment Cancellation) message
 */
export function generateCancelAppointmentMessage(
  patient: PatientInfo,
  provider: ProviderInfo,
  appointment: AppointmentInfo,
  config?: LegacyEHRConfig
): SIUMessage {
  return generateSIUMessage('S15', patient, provider, appointment, config);
}

/**
 * Generate SIU^S26 (Appointment No-Show) message
 */
export function generateNoShowMessage(
  patient: PatientInfo,
  provider: ProviderInfo,
  appointment: AppointmentInfo,
  config?: LegacyEHRConfig
): SIUMessage {
  return generateSIUMessage('S26', patient, provider, appointment, config);
}

/**
 * Generate a random appointment for testing
 */
export function generateRandomAppointment(baseDate?: Date): AppointmentInfo {
  const startDate = baseDate || new Date();
  const randomDaysAhead = Math.floor(Math.random() * 30);
  const randomHour = 8 + Math.floor(Math.random() * 9); // 8am to 5pm
  const randomMinute = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
  
  const appointmentDate = new Date(startDate);
  appointmentDate.setDate(appointmentDate.getDate() + randomDaysAhead);
  appointmentDate.setHours(randomHour, randomMinute, 0, 0);
  
  const durations = [15, 20, 30, 45, 60];
  const duration = durations[Math.floor(Math.random() * durations.length)];
  
  const reason = APPOINTMENT_REASONS[Math.floor(Math.random() * APPOINTMENT_REASONS.length)];
  const appointmentType = APPOINTMENT_TYPES[Math.floor(Math.random() * APPOINTMENT_TYPES.length)];
  
  return {
    appointmentId: `APT${Date.now()}${Math.random().toString(36).substring(2, 8)}`,
    startDateTime: appointmentDate,
    durationMinutes: duration,
    reason: reason.text,
    appointmentType,
    location: {
      pointOfCare: appointmentType === 'TELEHEALTH' ? 'TELEHEALTH' : 'OFFICE',
      facility: appointmentType === 'TELEHEALTH' ? 'Virtual' : 'Main Office',
    },
  };
}

/**
 * Generate a batch of random SIU messages for testing
 */
export function generateTestMessages(count: number = 10): string[] {
  const messages: string[] = [];
  const eventTypes: SIUEventType[] = ['S12', 'S12', 'S12', 'S14', 'S15']; // More S12s than others
  
  for (let i = 0; i < count; i++) {
    const patient = SAMPLE_PATIENTS[Math.floor(Math.random() * SAMPLE_PATIENTS.length)];
    const provider = SAMPLE_PROVIDERS[Math.floor(Math.random() * SAMPLE_PROVIDERS.length)];
    const appointment = generateRandomAppointment();
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    
    const message = generateSIUMessage(eventType, patient, provider, appointment);
    messages.push(buildSIUMessage(message));
  }
  
  return messages;
}

/**
 * SIU Message Generator class for more controlled generation
 */
export class SIUMessageGenerator {
  private config: LegacyEHRConfig;
  private providers: ProviderInfo[];
  private patients: PatientInfo[];
  
  constructor(
    config: LegacyEHRConfig = DEFAULT_EHR_CONFIG,
    providers: ProviderInfo[] = SAMPLE_PROVIDERS,
    patients: PatientInfo[] = SAMPLE_PATIENTS
  ) {
    this.config = config;
    this.providers = providers;
    this.patients = patients;
  }
  
  /**
   * Generate a new appointment message
   */
  newAppointment(
    patientId?: string,
    providerId?: string,
    appointment?: Partial<AppointmentInfo>
  ): { message: SIUMessage; raw: string } {
    const patient = patientId 
      ? this.patients.find(p => p.id === patientId) || this.patients[0]
      : this.patients[Math.floor(Math.random() * this.patients.length)];
    
    const provider = providerId
      ? this.providers.find(p => p.id === providerId) || this.providers[0]
      : this.providers[Math.floor(Math.random() * this.providers.length)];
    
    const fullAppointment = {
      ...generateRandomAppointment(),
      ...appointment,
    };
    
    const message = generateNewAppointmentMessage(patient, provider, fullAppointment, this.config);
    return {
      message,
      raw: buildSIUMessage(message),
    };
  }
  
  /**
   * Generate an appointment modification message
   */
  modifyAppointment(
    appointmentId: string,
    patientId?: string,
    providerId?: string,
    changes?: Partial<AppointmentInfo>
  ): { message: SIUMessage; raw: string } {
    const patient = patientId
      ? this.patients.find(p => p.id === patientId) || this.patients[0]
      : this.patients[Math.floor(Math.random() * this.patients.length)];
    
    const provider = providerId
      ? this.providers.find(p => p.id === providerId) || this.providers[0]
      : this.providers[Math.floor(Math.random() * this.providers.length)];
    
    const appointment = {
      ...generateRandomAppointment(),
      ...changes,
      appointmentId,
    };
    
    const message = generateModifyAppointmentMessage(patient, provider, appointment, this.config);
    return {
      message,
      raw: buildSIUMessage(message),
    };
  }
  
  /**
   * Generate an appointment cancellation message
   */
  cancelAppointment(
    appointmentId: string,
    patientId?: string,
    providerId?: string,
    originalAppointment?: Partial<AppointmentInfo>
  ): { message: SIUMessage; raw: string } {
    const patient = patientId
      ? this.patients.find(p => p.id === patientId) || this.patients[0]
      : this.patients[Math.floor(Math.random() * this.patients.length)];
    
    const provider = providerId
      ? this.providers.find(p => p.id === providerId) || this.providers[0]
      : this.providers[Math.floor(Math.random() * this.providers.length)];
    
    const appointment = {
      ...generateRandomAppointment(),
      ...originalAppointment,
      appointmentId,
    };
    
    const message = generateCancelAppointmentMessage(patient, provider, appointment, this.config);
    return {
      message,
      raw: buildSIUMessage(message),
    };
  }
  
  /**
   * Generate a batch of messages for testing
   */
  generateBatch(count: number): Array<{ message: SIUMessage; raw: string; eventType: SIUEventType }> {
    const results: Array<{ message: SIUMessage; raw: string; eventType: SIUEventType }> = [];
    const createdAppointments: string[] = [];
    
    for (let i = 0; i < count; i++) {
      // Bias towards new appointments
      const rand = Math.random();
      let eventType: SIUEventType;
      
      if (rand < 0.6 || createdAppointments.length === 0) {
        eventType = 'S12'; // 60% new appointments
      } else if (rand < 0.8) {
        eventType = 'S14'; // 20% modifications
      } else {
        eventType = 'S15'; // 20% cancellations
      }
      
      const patient = this.patients[Math.floor(Math.random() * this.patients.length)];
      const provider = this.providers[Math.floor(Math.random() * this.providers.length)];
      const appointment = generateRandomAppointment();
      
      if (eventType === 'S12') {
        createdAppointments.push(appointment.appointmentId);
      } else if (createdAppointments.length > 0) {
        // Use an existing appointment ID for modifications/cancellations
        appointment.appointmentId = createdAppointments[Math.floor(Math.random() * createdAppointments.length)];
        if (eventType === 'S15') {
          // Remove cancelled appointments from the pool
          const idx = createdAppointments.indexOf(appointment.appointmentId);
          if (idx > -1) createdAppointments.splice(idx, 1);
        }
      }
      
      const message = generateSIUMessage(eventType, patient, provider, appointment, this.config);
      results.push({
        message,
        raw: buildSIUMessage(message),
        eventType,
      });
    }
    
    return results;
  }
}
