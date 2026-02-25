/**
 * HL7v2 Type Definitions
 * 
 * Focused on SIU (Scheduling Information Unsolicited) messages
 * for scheduling operations from legacy EHR systems.
 */

/**
 * HL7v2 Field Separator and Encoding Characters
 */
export const HL7_FIELD_SEPARATOR = '|';
export const HL7_COMPONENT_SEPARATOR = '^';
export const HL7_REPETITION_SEPARATOR = '~';
export const HL7_ESCAPE_CHARACTER = '\\';
export const HL7_SUBCOMPONENT_SEPARATOR = '&';
export const HL7_ENCODING_CHARACTERS = '^~\\&';

/**
 * MLLP (Minimal Lower Layer Protocol) Framing Characters
 */
export const MLLP_START_BLOCK = '\x0B'; // VT (Vertical Tab)
export const MLLP_END_BLOCK = '\x1C';   // FS (File Separator)
export const MLLP_CARRIAGE_RETURN = '\x0D'; // CR

/**
 * HL7 Segment Types
 */
export type HL7SegmentType = 
  | 'MSH' // Message Header
  | 'SCH' // Scheduling Activity Information
  | 'PID' // Patient Identification
  | 'PV1' // Patient Visit
  | 'RGS' // Resource Group
  | 'AIG' // Appointment Information - General Resource
  | 'AIL' // Appointment Information - Location Resource
  | 'AIP' // Appointment Information - Personnel Resource
  | 'MSA' // Message Acknowledgment
  | 'ERR'; // Error

/**
 * SIU Message Event Types
 */
export type SIUEventType = 
  | 'S12' // New appointment notification
  | 'S13' // Appointment rescheduling notification
  | 'S14' // Appointment modification notification
  | 'S15' // Appointment cancellation notification
  | 'S17' // Appointment deletion notification
  | 'S26'; // Appointment no-show notification

/**
 * ACK Acknowledgment Codes
 */
export type AckCode = 
  | 'AA' // Application Accept
  | 'AE' // Application Error
  | 'AR'; // Application Reject

/**
 * Scheduling Status Codes
 */
export type ScheduleStatus = 
  | 'Scheduled'
  | 'Cancelled'
  | 'NoShow'
  | 'Completed';

/**
 * Resource Group Action Codes
 */
export type ResourceAction =
  | 'A' // Add/Insert
  | 'U' // Update
  | 'D' // Delete
  | 'C'; // Cancel

/**
 * MSH - Message Header Segment
 */
export interface MSHSegment {
  segmentType: 'MSH';
  encodingCharacters: string;          // MSH-2
  sendingApplication: string;          // MSH-3
  sendingFacility: string;             // MSH-4
  receivingApplication: string;        // MSH-5
  receivingFacility: string;           // MSH-6
  dateTimeOfMessage: string;           // MSH-7 (yyyyMMddHHmmss format)
  security?: string;                   // MSH-8
  messageType: {                       // MSH-9
    messageCode: string;               // e.g., 'SIU'
    triggerEvent: string;              // e.g., 'S12'
  };
  messageControlId: string;            // MSH-10
  processingId: string;                // MSH-11 (P=Production, T=Training, D=Debugging)
  versionId: string;                   // MSH-12 (e.g., '2.3')
}

/**
 * Extended Person Name
 */
export interface XPN {
  familyName?: string;
  givenName?: string;
  middleInitialOrName?: string;
  suffix?: string;
  prefix?: string;
  degree?: string;
}

/**
 * Extended Composite ID with Check Digit
 */
export interface CX {
  idNumber: string;
  checkDigit?: string;
  checkDigitScheme?: string;
  assigningAuthority?: string;
  identifierTypeCode?: string;
}

/**
 * Extended Address
 */
export interface XAD {
  streetAddress?: string;
  otherDesignation?: string;
  city?: string;
  stateOrProvince?: string;
  zipOrPostalCode?: string;
  country?: string;
}

/**
 * Extended Telecommunication Number
 */
export interface XTN {
  telephoneNumber?: string;
  telecommunicationUseCode?: string;
  telecommunicationEquipmentType?: string;
  emailAddress?: string;
}

/**
 * PID - Patient Identification Segment
 */
export interface PIDSegment {
  segmentType: 'PID';
  setId?: string;                      // PID-1
  patientId?: CX;                      // PID-2 (External ID)
  patientIdentifierList: CX[];         // PID-3 (Internal IDs)
  alternatePatientId?: CX;             // PID-4
  patientName: XPN;                    // PID-5
  mothersMaidenName?: XPN;             // PID-6
  dateOfBirth?: string;                // PID-7 (yyyyMMdd format)
  administrativeSex?: string;          // PID-8 (M, F, O, U)
  patientAlias?: XPN;                  // PID-9
  race?: string;                       // PID-10
  patientAddress?: XAD;                // PID-11
  countyCode?: string;                 // PID-12
  phoneNumberHome?: XTN;               // PID-13
  phoneNumberBusiness?: XTN;           // PID-14
  primaryLanguage?: string;            // PID-15
  maritalStatus?: string;              // PID-16
  religion?: string;                   // PID-17
  patientAccountNumber?: string;       // PID-18
  ssn?: string;                        // PID-19
}

/**
 * SCH - Scheduling Activity Information Segment
 */
export interface SCHSegment {
  segmentType: 'SCH';
  placerAppointmentId: CX;             // SCH-1 (Appointment ID from placer)
  fillerAppointmentId?: CX;            // SCH-2 (Appointment ID from filler)
  occurrenceNumber?: string;           // SCH-3
  placerGroupNumber?: string;          // SCH-4
  scheduleId?: string;                 // SCH-5
  eventReason: {                       // SCH-6
    identifier?: string;
    text?: string;
  };
  appointmentReason?: {                // SCH-7
    identifier?: string;
    text?: string;
  };
  appointmentType?: {                  // SCH-8
    identifier?: string;
    text?: string;
  };
  appointmentDuration?: number;        // SCH-9 (in minutes)
  appointmentDurationUnits?: string;   // SCH-10
  appointmentTiming?: {                // SCH-11
    quantity?: number;
    interval?: number;
    intervalUnits?: string;
    startDateTime?: string;
    endDateTime?: string;
  };
  placerContactPerson?: XPN;           // SCH-12
  placerContactPhoneNumber?: XTN;      // SCH-13
  placerContactAddress?: XAD;          // SCH-14
  placerContactLocation?: string;      // SCH-15
  fillerContactPerson?: XPN;           // SCH-16
  fillerContactPhoneNumber?: XTN;      // SCH-17
  fillerContactAddress?: XAD;          // SCH-18
  fillerContactLocation?: string;      // SCH-19
  enteredByPerson?: XPN;               // SCH-20
  enteredByPhoneNumber?: XTN;          // SCH-21
  enteredByLocation?: string;          // SCH-22
  parentPlacerAppointmentId?: CX;      // SCH-23
  parentFillerAppointmentId?: CX;      // SCH-24
  fillerStatusCode?: ScheduleStatus;   // SCH-25
}

/**
 * PV1 - Patient Visit Segment
 */
export interface PV1Segment {
  segmentType: 'PV1';
  setId?: string;                      // PV1-1
  patientClass: string;                // PV1-2 (I=Inpatient, O=Outpatient, E=Emergency)
  assignedPatientLocation?: string;    // PV1-3
  admissionType?: string;              // PV1-4
  preadmitNumber?: string;             // PV1-5
  priorPatientLocation?: string;       // PV1-6
  attendingDoctor?: XPN & { id?: string }; // PV1-7
  referringDoctor?: XPN & { id?: string }; // PV1-8
  consultingDoctor?: XPN[];            // PV1-9
  hospitalService?: string;            // PV1-10
  visitNumber?: string;                // PV1-19
}

/**
 * RGS - Resource Group Segment
 */
export interface RGSSegment {
  segmentType: 'RGS';
  setId: string;                       // RGS-1
  segmentActionCode: ResourceAction;   // RGS-2 (A=Add, U=Update, D=Delete, C=Cancel)
  resourceGroupId?: string;            // RGS-3
}

/**
 * AIG - Appointment Information - General Resource Segment
 */
export interface AIGSegment {
  segmentType: 'AIG';
  setId: string;                       // AIG-1
  segmentActionCode: ResourceAction;   // AIG-2
  resourceId?: {                       // AIG-3
    id?: string;
    name?: string;
  };
  resourceType?: string;               // AIG-4
  resourceGroup?: string;              // AIG-5
  resourceQuantity?: number;           // AIG-6
  resourceQuantityUnits?: string;      // AIG-7
  startDateTime?: string;              // AIG-8
  startDateTimeOffset?: number;        // AIG-9
  startDateTimeOffsetUnits?: string;   // AIG-10
  duration?: number;                   // AIG-11
  durationUnits?: string;              // AIG-12
  allowSubstitutionCode?: string;      // AIG-13
  fillerStatusCode?: string;           // AIG-14
}

/**
 * AIL - Appointment Information - Location Resource Segment
 */
export interface AILSegment {
  segmentType: 'AIL';
  setId: string;                       // AIL-1
  segmentActionCode: ResourceAction;   // AIL-2
  locationResourceId?: {               // AIL-3 (PL data type)
    pointOfCare?: string;              // PL.1
    room?: string;                     // PL.2
    bed?: string;                      // PL.3
    facility?: string;                 // PL.4
    locationStatus?: string;           // PL.5
    personLocationType?: string;       // PL.6
    building?: string;                 // PL.7
    floor?: string;                    // PL.8
    locationDescription?: string;      // PL.9
  };
  locationTypeCode?: {                 // AIL-4
    code?: string;
    text?: string;
  };
  locationGroup?: string;              // AIL-5
  startDateTime?: string;              // AIL-6
  startDateTimeOffset?: number;        // AIL-7
  startDateTimeOffsetUnits?: string;   // AIL-8
  duration?: number;                   // AIL-9
  durationUnits?: string;              // AIL-10
  allowSubstitutionCode?: string;      // AIL-11
  fillerStatusCode?: string;           // AIL-12
}

/**
 * AIP - Appointment Information - Personnel Resource Segment
 */
export interface AIPSegment {
  segmentType: 'AIP';
  setId: string;                       // AIP-1
  segmentActionCode: ResourceAction;   // AIP-2
  personnelResourceId?: XPN & { id?: string }; // AIP-3
  resourceType?: string;               // AIP-4
  resourceGroup?: string;              // AIP-5
  startDateTime?: string;              // AIP-6
  startDateTimeOffset?: number;        // AIP-7
  startDateTimeOffsetUnits?: string;   // AIP-8
  duration?: number;                   // AIP-9
  durationUnits?: string;              // AIP-10
  allowSubstitutionCode?: string;      // AIP-11
  fillerStatusCode?: string;           // AIP-12
}

/**
 * MSA - Message Acknowledgment Segment
 */
export interface MSASegment {
  segmentType: 'MSA';
  acknowledgmentCode: AckCode;         // MSA-1 (AA, AE, AR)
  messageControlId: string;            // MSA-2 (from original MSH-10)
  textMessage?: string;                // MSA-3
  expectedSequenceNumber?: string;     // MSA-4
  delayedAcknowledgmentType?: string;  // MSA-5
  errorCondition?: string;             // MSA-6
}

/**
 * ERR - Error Segment
 */
export interface ERRSegment {
  segmentType: 'ERR';
  errorCodeAndLocation?: string;       // ERR-1
  errorLocation?: string;              // ERR-2
  hl7ErrorCode?: {                     // ERR-3
    identifier?: string;
    text?: string;
  };
  severity?: string;                   // ERR-4 (E=Error, W=Warning, I=Information)
  applicationErrorCode?: string;       // ERR-5
  applicationErrorParameter?: string;  // ERR-6
  diagnosticInformation?: string;      // ERR-7
  userMessage?: string;                // ERR-8
}

/**
 * Union type for all segment types
 */
export type HL7Segment = 
  | MSHSegment
  | PIDSegment
  | SCHSegment
  | PV1Segment
  | RGSSegment
  | AIGSegment
  | AILSegment
  | AIPSegment
  | MSASegment
  | ERRSegment;

/**
 * SIU Message Structure
 */
export interface SIUMessage {
  msh: MSHSegment;
  sch: SCHSegment;
  pid?: PIDSegment;
  pv1?: PV1Segment;
  rgs?: RGSSegment;
  aig?: AIGSegment;
  ail?: AILSegment;
  aip?: AIPSegment;
}

/**
 * ACK Message Structure
 */
export interface ACKMessage {
  msh: MSHSegment;
  msa: MSASegment;
  err?: ERRSegment;
}

/**
 * Raw HL7 Message (unparsed)
 */
export interface RawHL7Message {
  raw: string;
  segments: string[];
  messageType?: string;
  triggerEvent?: string;
  controlId?: string;
}
