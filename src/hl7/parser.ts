/**
 * HL7v2 Message Parser
 * 
 * Parses raw HL7v2 messages into structured TypeScript objects.
 * Builds HL7v2 messages from structured objects.
 */

import {
  HL7_FIELD_SEPARATOR,
  HL7_COMPONENT_SEPARATOR,
  HL7_REPETITION_SEPARATOR,
  HL7_ENCODING_CHARACTERS,
  MLLP_START_BLOCK,
  MLLP_END_BLOCK,
  MLLP_CARRIAGE_RETURN,
  MSHSegment,
  PIDSegment,
  SCHSegment,
  PV1Segment,
  RGSSegment,
  AIGSegment,
  AILSegment,
  AIPSegment,
  MSASegment,
  ERRSegment,
  SIUMessage,
  ACKMessage,
  RawHL7Message,
  XPN,
  CX,
  XAD,
  XTN,
  AckCode,
  ResourceAction,
  ScheduleStatus,
} from './types';

/**
 * Parse raw HL7 message string into segments
 */
export function parseRawMessage(raw: string): RawHL7Message {
  // Remove MLLP framing if present
  let cleaned = raw;
  if (cleaned.startsWith(MLLP_START_BLOCK)) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.endsWith(MLLP_END_BLOCK + MLLP_CARRIAGE_RETURN)) {
    cleaned = cleaned.substring(0, cleaned.length - 2);
  } else if (cleaned.endsWith(MLLP_END_BLOCK)) {
    cleaned = cleaned.substring(0, cleaned.length - 1);
  }

  // Split by segment terminator (CR or CRLF)
  const segments = cleaned
    .split(/\r\n|\r|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const result: RawHL7Message = {
    raw: cleaned,
    segments,
  };

  // Try to extract message type from MSH
  const mshSegment = segments.find(s => s.startsWith('MSH'));
  if (mshSegment) {
    const fields = mshSegment.split(HL7_FIELD_SEPARATOR);
    if (fields.length > 8) {
      const messageTypeField = fields[8];
      const [messageCode, triggerEvent] = messageTypeField.split(HL7_COMPONENT_SEPARATOR);
      result.messageType = messageCode;
      result.triggerEvent = triggerEvent;
    }
    if (fields.length > 9) {
      result.controlId = fields[9];
    }
  }

  return result;
}

/**
 * Parse a component string into XPN (Extended Person Name)
 */
export function parseXPN(component: string): XPN {
  const parts = component.split(HL7_COMPONENT_SEPARATOR);
  return {
    familyName: parts[0] || undefined,
    givenName: parts[1] || undefined,
    middleInitialOrName: parts[2] || undefined,
    suffix: parts[3] || undefined,
    prefix: parts[4] || undefined,
    degree: parts[5] || undefined,
  };
}

/**
 * Parse a component string into CX (Composite ID)
 */
export function parseCX(component: string): CX {
  const parts = component.split(HL7_COMPONENT_SEPARATOR);
  return {
    idNumber: parts[0] || '',
    checkDigit: parts[1] || undefined,
    checkDigitScheme: parts[2] || undefined,
    assigningAuthority: parts[3] || undefined,
    identifierTypeCode: parts[4] || undefined,
  };
}

/**
 * Parse a component string into XAD (Extended Address)
 */
export function parseXAD(component: string): XAD {
  const parts = component.split(HL7_COMPONENT_SEPARATOR);
  return {
    streetAddress: parts[0] || undefined,
    otherDesignation: parts[1] || undefined,
    city: parts[2] || undefined,
    stateOrProvince: parts[3] || undefined,
    zipOrPostalCode: parts[4] || undefined,
    country: parts[5] || undefined,
  };
}

/**
 * Parse a component string into XTN (Extended Telecommunication Number)
 */
export function parseXTN(component: string): XTN {
  const parts = component.split(HL7_COMPONENT_SEPARATOR);
  return {
    telephoneNumber: parts[0] || undefined,
    telecommunicationUseCode: parts[1] || undefined,
    telecommunicationEquipmentType: parts[2] || undefined,
    emailAddress: parts[3] || undefined,
  };
}

/**
 * Parse MSH segment
 */
export function parseMSH(segment: string): MSHSegment {
  // MSH is special - field separator is in position 3 (index 3)
  // and field 1 IS the separator, field 2 is encoding chars
  const fieldSep = segment.charAt(3);
  const fields = segment.substring(3).split(fieldSep);
  
  // fields[0] is empty because segment starts with separator
  // fields[1] = encoding characters (MSH-2)
  const messageTypeField = fields[8] || '';
  const [messageCode, triggerEvent] = messageTypeField.split(HL7_COMPONENT_SEPARATOR);

  return {
    segmentType: 'MSH',
    encodingCharacters: fields[1] || HL7_ENCODING_CHARACTERS,
    sendingApplication: fields[2] || '',
    sendingFacility: fields[3] || '',
    receivingApplication: fields[4] || '',
    receivingFacility: fields[5] || '',
    dateTimeOfMessage: fields[6] || '',
    security: fields[7] || undefined,
    messageType: {
      messageCode: messageCode || '',
      triggerEvent: triggerEvent || '',
    },
    messageControlId: fields[9] || '',
    processingId: fields[10] || 'P',
    versionId: fields[11] || '2.3',
  };
}

/**
 * Parse PID segment
 */
export function parsePID(segment: string): PIDSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  
  // Parse patient identifiers (may have multiple, separated by ~)
  const patientIdListField = fields[3] || '';
  const patientIds = patientIdListField
    .split(HL7_REPETITION_SEPARATOR)
    .filter(id => id.length > 0)
    .map(parseCX);

  return {
    segmentType: 'PID',
    setId: fields[1] || undefined,
    patientId: fields[2] ? parseCX(fields[2]) : undefined,
    patientIdentifierList: patientIds.length > 0 ? patientIds : [{ idNumber: '' }],
    alternatePatientId: fields[4] ? parseCX(fields[4]) : undefined,
    patientName: parseXPN(fields[5] || ''),
    mothersMaidenName: fields[6] ? parseXPN(fields[6]) : undefined,
    dateOfBirth: fields[7] || undefined,
    administrativeSex: fields[8] || undefined,
    patientAlias: fields[9] ? parseXPN(fields[9]) : undefined,
    race: fields[10] || undefined,
    patientAddress: fields[11] ? parseXAD(fields[11]) : undefined,
    countyCode: fields[12] || undefined,
    phoneNumberHome: fields[13] ? parseXTN(fields[13]) : undefined,
    phoneNumberBusiness: fields[14] ? parseXTN(fields[14]) : undefined,
    primaryLanguage: fields[15] || undefined,
    maritalStatus: fields[16] || undefined,
    religion: fields[17] || undefined,
    patientAccountNumber: fields[18] || undefined,
    ssn: fields[19] || undefined,
  };
}

/**
 * Parse SCH segment
 */
export function parseSCH(segment: string): SCHSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  
  // Parse appointment timing (SCH-11)
  const timingField = fields[11] || '';
  const timingParts = timingField.split(HL7_COMPONENT_SEPARATOR);
  
  return {
    segmentType: 'SCH',
    placerAppointmentId: parseCX(fields[1] || ''),
    fillerAppointmentId: fields[2] ? parseCX(fields[2]) : undefined,
    occurrenceNumber: fields[3] || undefined,
    placerGroupNumber: fields[4] || undefined,
    scheduleId: fields[5] || undefined,
    eventReason: {
      identifier: (fields[6] || '').split(HL7_COMPONENT_SEPARATOR)[0] || undefined,
      text: (fields[6] || '').split(HL7_COMPONENT_SEPARATOR)[1] || undefined,
    },
    appointmentReason: fields[7] ? {
      identifier: fields[7].split(HL7_COMPONENT_SEPARATOR)[0] || undefined,
      text: fields[7].split(HL7_COMPONENT_SEPARATOR)[1] || undefined,
    } : undefined,
    appointmentType: fields[8] ? {
      identifier: fields[8].split(HL7_COMPONENT_SEPARATOR)[0] || undefined,
      text: fields[8].split(HL7_COMPONENT_SEPARATOR)[1] || fields[8].split(HL7_COMPONENT_SEPARATOR)[0] || undefined,
    } : undefined,
    appointmentDuration: fields[9] ? parseInt(fields[9], 10) : undefined,
    appointmentDurationUnits: fields[10] || undefined,
    appointmentTiming: {
      quantity: timingParts[0] ? parseInt(timingParts[0], 10) : undefined,
      interval: timingParts[1] ? parseInt(timingParts[1], 10) : undefined,
      intervalUnits: timingParts[2] || undefined,
      startDateTime: timingParts[3] || undefined,
      endDateTime: timingParts[4] || undefined,
    },
    placerContactPerson: fields[12] ? parseXPN(fields[12]) : undefined,
    placerContactPhoneNumber: fields[13] ? parseXTN(fields[13]) : undefined,
    placerContactAddress: fields[14] ? parseXAD(fields[14]) : undefined,
    placerContactLocation: fields[15] || undefined,
    fillerContactPerson: fields[16] ? parseXPN(fields[16]) : undefined,
    fillerContactPhoneNumber: fields[17] ? parseXTN(fields[17]) : undefined,
    fillerContactAddress: fields[18] ? parseXAD(fields[18]) : undefined,
    fillerContactLocation: fields[19] || undefined,
    enteredByPerson: fields[20] ? parseXPN(fields[20]) : undefined,
    enteredByPhoneNumber: fields[21] ? parseXTN(fields[21]) : undefined,
    enteredByLocation: fields[22] || undefined,
    parentPlacerAppointmentId: fields[23] ? parseCX(fields[23]) : undefined,
    parentFillerAppointmentId: fields[24] ? parseCX(fields[24]) : undefined,
    fillerStatusCode: (fields[25] as ScheduleStatus) || undefined,
  };
}

/**
 * Parse PV1 segment
 */
export function parsePV1(segment: string): PV1Segment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  
  const parseDoctor = (field: string | undefined): (XPN & { id?: string }) | undefined => {
    if (!field) return undefined;
    const parts = field.split(HL7_COMPONENT_SEPARATOR);
    return {
      id: parts[0] || undefined,
      familyName: parts[1] || undefined,
      givenName: parts[2] || undefined,
      middleInitialOrName: parts[3] || undefined,
      suffix: parts[4] || undefined,
      prefix: parts[5] || undefined,
      degree: parts[6] || undefined,
    };
  };

  return {
    segmentType: 'PV1',
    setId: fields[1] || undefined,
    patientClass: fields[2] || 'O',
    assignedPatientLocation: fields[3] || undefined,
    admissionType: fields[4] || undefined,
    preadmitNumber: fields[5] || undefined,
    priorPatientLocation: fields[6] || undefined,
    attendingDoctor: parseDoctor(fields[7]),
    referringDoctor: parseDoctor(fields[8]),
    hospitalService: fields[10] || undefined,
    visitNumber: fields[19] || undefined,
  };
}

/**
 * Parse RGS segment
 */
export function parseRGS(segment: string): RGSSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  
  return {
    segmentType: 'RGS',
    setId: fields[1] || '1',
    segmentActionCode: (fields[2] as ResourceAction) || 'A',
    resourceGroupId: fields[3] || undefined,
  };
}

/**
 * Parse AIG segment
 */
export function parseAIG(segment: string): AIGSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  const resourceField = fields[3] || '';
  const resourceParts = resourceField.split(HL7_COMPONENT_SEPARATOR);
  
  return {
    segmentType: 'AIG',
    setId: fields[1] || '1',
    segmentActionCode: (fields[2] as ResourceAction) || 'A',
    resourceId: {
      id: resourceParts[0] || undefined,
      name: resourceParts[1] || undefined,
    },
    resourceType: fields[4] || undefined,
    resourceGroup: fields[5] || undefined,
    resourceQuantity: fields[6] ? parseInt(fields[6], 10) : undefined,
    resourceQuantityUnits: fields[7] || undefined,
    startDateTime: fields[8] || undefined,
    startDateTimeOffset: fields[9] ? parseInt(fields[9], 10) : undefined,
    startDateTimeOffsetUnits: fields[10] || undefined,
    duration: fields[11] ? parseInt(fields[11], 10) : undefined,
    durationUnits: fields[12] || undefined,
    allowSubstitutionCode: fields[13] || undefined,
    fillerStatusCode: fields[14] || undefined,
  };
}

/**
 * Parse AIL segment
 */
export function parseAIL(segment: string): AILSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  const locationField = fields[3] || '';
  const locationParts = locationField.split(HL7_COMPONENT_SEPARATOR);
  const locationTypeField = fields[4] || '';
  const locationTypeParts = locationTypeField.split(HL7_COMPONENT_SEPARATOR);
  
  return {
    segmentType: 'AIL',
    setId: fields[1] || '1',
    segmentActionCode: (fields[2] as ResourceAction) || 'A',
    locationResourceId: {
      pointOfCare: locationParts[0] || undefined,
      room: locationParts[1] || undefined,
      bed: locationParts[2] || undefined,
      facility: locationParts[3] || undefined,
      locationStatus: locationParts[4] || undefined,
      personLocationType: locationParts[5] || undefined,
      building: locationParts[6] || undefined,
      floor: locationParts[7] || undefined,
      locationDescription: locationParts[8] || undefined,
    },
    locationTypeCode: {
      code: locationTypeParts[0] || undefined,
      text: locationTypeParts[1] || undefined,
    },
    locationGroup: fields[5] || undefined,
    startDateTime: fields[6] || undefined,
    startDateTimeOffset: fields[7] ? parseInt(fields[7], 10) : undefined,
    startDateTimeOffsetUnits: fields[8] || undefined,
    duration: fields[9] ? parseInt(fields[9], 10) : undefined,
    durationUnits: fields[10] || undefined,
    allowSubstitutionCode: fields[11] || undefined,
    fillerStatusCode: fields[12] || undefined,
  };
}

/**
 * Parse AIP segment
 */
export function parseAIP(segment: string): AIPSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  const personnelField = fields[3] || '';
  const personnelParts = personnelField.split(HL7_COMPONENT_SEPARATOR);
  
  return {
    segmentType: 'AIP',
    setId: fields[1] || '1',
    segmentActionCode: (fields[2] as ResourceAction) || 'A',
    personnelResourceId: {
      id: personnelParts[0] || undefined,
      familyName: personnelParts[1] || undefined,
      givenName: personnelParts[2] || undefined,
      middleInitialOrName: personnelParts[3] || undefined,
      suffix: personnelParts[4] || undefined,
      prefix: personnelParts[5] || undefined,
      degree: personnelParts[6] || undefined,
    },
    resourceType: fields[4] || undefined,
    resourceGroup: fields[5] || undefined,
    startDateTime: fields[6] || undefined,
    startDateTimeOffset: fields[7] ? parseInt(fields[7], 10) : undefined,
    startDateTimeOffsetUnits: fields[8] || undefined,
    duration: fields[9] ? parseInt(fields[9], 10) : undefined,
    durationUnits: fields[10] || undefined,
    allowSubstitutionCode: fields[11] || undefined,
    fillerStatusCode: fields[12] || undefined,
  };
}

/**
 * Parse MSA segment
 */
export function parseMSA(segment: string): MSASegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  
  return {
    segmentType: 'MSA',
    acknowledgmentCode: (fields[1] as AckCode) || 'AA',
    messageControlId: fields[2] || '',
    textMessage: fields[3] || undefined,
    expectedSequenceNumber: fields[4] || undefined,
    delayedAcknowledgmentType: fields[5] || undefined,
    errorCondition: fields[6] || undefined,
  };
}

/**
 * Parse ERR segment
 */
export function parseERR(segment: string): ERRSegment {
  const fields = segment.split(HL7_FIELD_SEPARATOR);
  const errorCodeField = fields[3] || '';
  const errorCodeParts = errorCodeField.split(HL7_COMPONENT_SEPARATOR);
  
  return {
    segmentType: 'ERR',
    errorCodeAndLocation: fields[1] || undefined,
    errorLocation: fields[2] || undefined,
    hl7ErrorCode: {
      identifier: errorCodeParts[0] || undefined,
      text: errorCodeParts[1] || undefined,
    },
    severity: fields[4] || undefined,
    applicationErrorCode: fields[5] || undefined,
    applicationErrorParameter: fields[6] || undefined,
    diagnosticInformation: fields[7] || undefined,
    userMessage: fields[8] || undefined,
  };
}

/**
 * Parse complete SIU message
 */
export function parseSIUMessage(raw: string): SIUMessage {
  const parsed = parseRawMessage(raw);
  
  const mshSegment = parsed.segments.find(s => s.startsWith('MSH'));
  const schSegment = parsed.segments.find(s => s.startsWith('SCH'));
  const pidSegment = parsed.segments.find(s => s.startsWith('PID'));
  const pv1Segment = parsed.segments.find(s => s.startsWith('PV1'));
  const rgsSegment = parsed.segments.find(s => s.startsWith('RGS'));
  const aigSegment = parsed.segments.find(s => s.startsWith('AIG'));
  const ailSegment = parsed.segments.find(s => s.startsWith('AIL'));
  const aipSegment = parsed.segments.find(s => s.startsWith('AIP'));

  if (!mshSegment || !schSegment) {
    throw new Error('Invalid SIU message: MSH and SCH segments are required');
  }

  return {
    msh: parseMSH(mshSegment),
    sch: parseSCH(schSegment),
    pid: pidSegment ? parsePID(pidSegment) : undefined,
    pv1: pv1Segment ? parsePV1(pv1Segment) : undefined,
    rgs: rgsSegment ? parseRGS(rgsSegment) : undefined,
    aig: aigSegment ? parseAIG(aigSegment) : undefined,
    ail: ailSegment ? parseAIL(ailSegment) : undefined,
    aip: aipSegment ? parseAIP(aipSegment) : undefined,
  };
}

/**
 * Parse ACK message
 */
export function parseACKMessage(raw: string): ACKMessage {
  const parsed = parseRawMessage(raw);
  
  const mshSegment = parsed.segments.find(s => s.startsWith('MSH'));
  const msaSegment = parsed.segments.find(s => s.startsWith('MSA'));
  const errSegment = parsed.segments.find(s => s.startsWith('ERR'));

  if (!mshSegment || !msaSegment) {
    throw new Error('Invalid ACK message: MSH and MSA segments are required');
  }

  return {
    msh: parseMSH(mshSegment),
    msa: parseMSA(msaSegment),
    err: errSegment ? parseERR(errSegment) : undefined,
  };
}

// ============================================================================
// Message Building Functions
// ============================================================================

/**
 * Format XPN to HL7 string
 */
export function formatXPN(xpn: XPN | undefined): string {
  if (!xpn) return '';
  return [
    xpn.familyName || '',
    xpn.givenName || '',
    xpn.middleInitialOrName || '',
    xpn.suffix || '',
    xpn.prefix || '',
    xpn.degree || '',
  ].join(HL7_COMPONENT_SEPARATOR).replace(/\^+$/, '');
}

/**
 * Format CX to HL7 string
 */
export function formatCX(cx: CX | undefined): string {
  if (!cx) return '';
  return [
    cx.idNumber || '',
    cx.checkDigit || '',
    cx.checkDigitScheme || '',
    cx.assigningAuthority || '',
    cx.identifierTypeCode || '',
  ].join(HL7_COMPONENT_SEPARATOR).replace(/\^+$/, '');
}

/**
 * Format XAD to HL7 string
 */
export function formatXAD(xad: XAD | undefined): string {
  if (!xad) return '';
  return [
    xad.streetAddress || '',
    xad.otherDesignation || '',
    xad.city || '',
    xad.stateOrProvince || '',
    xad.zipOrPostalCode || '',
    xad.country || '',
  ].join(HL7_COMPONENT_SEPARATOR).replace(/\^+$/, '');
}

/**
 * Format XTN to HL7 string
 */
export function formatXTN(xtn: XTN | undefined): string {
  if (!xtn) return '';
  return xtn.telephoneNumber || '';
}

/**
 * Build MSH segment string
 */
export function buildMSH(msh: MSHSegment): string {
  const fields = [
    'MSH',
    msh.encodingCharacters || HL7_ENCODING_CHARACTERS,
    msh.sendingApplication || '',
    msh.sendingFacility || '',
    msh.receivingApplication || '',
    msh.receivingFacility || '',
    msh.dateTimeOfMessage || '',
    msh.security || '',
    `${msh.messageType.messageCode}${HL7_COMPONENT_SEPARATOR}${msh.messageType.triggerEvent}`,
    msh.messageControlId || '',
    msh.processingId || 'P',
    msh.versionId || '2.3',
    '', '', '', '', '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build PID segment string
 */
export function buildPID(pid: PIDSegment): string {
  const patientIds = pid.patientIdentifierList
    .map(formatCX)
    .join(HL7_REPETITION_SEPARATOR);
  
  const fields = [
    'PID',
    pid.setId || '1',
    formatCX(pid.patientId),
    patientIds,
    formatCX(pid.alternatePatientId),
    formatXPN(pid.patientName),
    formatXPN(pid.mothersMaidenName),
    pid.dateOfBirth || '',
    pid.administrativeSex || '',
    formatXPN(pid.patientAlias),
    pid.race || '',
    formatXAD(pid.patientAddress),
    pid.countyCode || '',
    formatXTN(pid.phoneNumberHome),
    formatXTN(pid.phoneNumberBusiness),
    pid.primaryLanguage || '',
    pid.maritalStatus || '',
    pid.religion || '',
    pid.patientAccountNumber || '',
    pid.ssn || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build SCH segment string
 */
export function buildSCH(sch: SCHSegment): string {
  const eventReason = sch.eventReason 
    ? `${sch.eventReason.identifier || ''}${HL7_COMPONENT_SEPARATOR}${sch.eventReason.text || ''}`
    : '';
  
  const appointmentReason = sch.appointmentReason
    ? `${sch.appointmentReason.identifier || ''}${HL7_COMPONENT_SEPARATOR}${sch.appointmentReason.text || ''}`
    : '';
  
  const timing = sch.appointmentTiming
    ? [
        sch.appointmentTiming.quantity?.toString() || '',
        sch.appointmentTiming.interval?.toString() || '',
        sch.appointmentTiming.intervalUnits || '',
        sch.appointmentTiming.startDateTime || '',
        sch.appointmentTiming.endDateTime || '',
      ].join(HL7_COMPONENT_SEPARATOR)
    : '';

  const fields = [
    'SCH',
    formatCX(sch.placerAppointmentId),
    formatCX(sch.fillerAppointmentId),
    sch.occurrenceNumber || '',
    sch.placerGroupNumber || '',
    sch.scheduleId || '',
    eventReason,
    appointmentReason,
    sch.appointmentType?.identifier || '',
    sch.appointmentDuration?.toString() || '',
    sch.appointmentDurationUnits || '',
    timing,
    formatXPN(sch.placerContactPerson),
    formatXTN(sch.placerContactPhoneNumber),
    formatXAD(sch.placerContactAddress),
    sch.placerContactLocation || '',
    formatXPN(sch.fillerContactPerson),
    formatXTN(sch.fillerContactPhoneNumber),
    formatXAD(sch.fillerContactAddress),
    sch.fillerContactLocation || '',
    formatXPN(sch.enteredByPerson),
    formatXTN(sch.enteredByPhoneNumber),
    sch.enteredByLocation || '',
    formatCX(sch.parentPlacerAppointmentId),
    formatCX(sch.parentFillerAppointmentId),
    sch.fillerStatusCode || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build PV1 segment string
 */
export function buildPV1(pv1: PV1Segment): string {
  const formatDoctor = (doctor: (XPN & { id?: string }) | undefined): string => {
    if (!doctor) return '';
    return [
      doctor.id || '',
      doctor.familyName || '',
      doctor.givenName || '',
      doctor.middleInitialOrName || '',
      doctor.suffix || '',
      doctor.prefix || '',
      doctor.degree || '',
      '', '', '',
    ].join(HL7_COMPONENT_SEPARATOR).replace(/\^+$/, '');
  };

  const fields = [
    'PV1',
    pv1.setId || '1',
    pv1.patientClass || 'O',
    pv1.assignedPatientLocation || '',
    pv1.admissionType || '',
    pv1.preadmitNumber || '',
    pv1.priorPatientLocation || '',
    formatDoctor(pv1.attendingDoctor),
    formatDoctor(pv1.referringDoctor),
    '', // PV1-9 consulting doctors
    pv1.hospitalService || '',
    '', '', '', '', '', '', '', '',
    pv1.visitNumber || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build RGS segment string
 */
export function buildRGS(rgs: RGSSegment): string {
  const fields = [
    'RGS',
    rgs.setId || '1',
    rgs.segmentActionCode || 'A',
    rgs.resourceGroupId || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build AIG segment string
 */
export function buildAIG(aig: AIGSegment): string {
  const resourceId = aig.resourceId
    ? `${aig.resourceId.id || ''}${HL7_COMPONENT_SEPARATOR}${aig.resourceId.name || ''}`
    : '';
  
  const fields = [
    'AIG',
    aig.setId || '1',
    aig.segmentActionCode || 'A',
    resourceId,
    aig.resourceType || '',
    aig.resourceGroup || '',
    aig.resourceQuantity?.toString() || '',
    aig.resourceQuantityUnits || '',
    aig.startDateTime || '',
    aig.startDateTimeOffset?.toString() || '',
    aig.startDateTimeOffsetUnits || '',
    aig.duration?.toString() || '',
    aig.durationUnits || '',
    aig.allowSubstitutionCode || '',
    aig.fillerStatusCode || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build AIL segment string
 */
export function buildAIL(ail: AILSegment): string {
  const locationId = ail.locationResourceId
    ? [
        ail.locationResourceId.pointOfCare || '',
        ail.locationResourceId.room || '',
        ail.locationResourceId.bed || '',
        ail.locationResourceId.facility || '',
        ail.locationResourceId.locationStatus || '',
        ail.locationResourceId.personLocationType || '',
        ail.locationResourceId.building || '',
        ail.locationResourceId.floor || '',
        ail.locationResourceId.locationDescription || '',
      ].join(HL7_COMPONENT_SEPARATOR).replace(/\^+$/, '')
    : '';
  
  const locationType = ail.locationTypeCode
    ? `${ail.locationTypeCode.code || ''}${HL7_COMPONENT_SEPARATOR}${ail.locationTypeCode.text || ''}`
    : '';
  
  const fields = [
    'AIL',
    ail.setId || '1',
    ail.segmentActionCode || 'A',
    locationId,
    locationType,
    ail.locationGroup || '',
    ail.startDateTime || '',
    ail.startDateTimeOffset?.toString() || '',
    ail.startDateTimeOffsetUnits || '',
    ail.duration?.toString() || '',
    ail.durationUnits || '',
    ail.allowSubstitutionCode || '',
    ail.fillerStatusCode || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build AIP segment string
 */
export function buildAIP(aip: AIPSegment): string {
  const personnelId = aip.personnelResourceId
    ? [
        aip.personnelResourceId.id || '',
        aip.personnelResourceId.familyName || '',
        aip.personnelResourceId.givenName || '',
        aip.personnelResourceId.middleInitialOrName || '',
        aip.personnelResourceId.suffix || '',
        aip.personnelResourceId.prefix || '',
        aip.personnelResourceId.degree || '',
        '', '', '',
      ].join(HL7_COMPONENT_SEPARATOR).replace(/\^+$/, '')
    : '';
  
  const fields = [
    'AIP',
    aip.setId || '1',
    aip.segmentActionCode || 'A',
    personnelId,
    aip.resourceType || '',
    aip.resourceGroup || '',
    aip.startDateTime || '',
    aip.startDateTimeOffset?.toString() || '',
    aip.startDateTimeOffsetUnits || '',
    aip.duration?.toString() || '',
    aip.durationUnits || '',
    aip.allowSubstitutionCode || '',
    aip.fillerStatusCode || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build MSA segment string
 */
export function buildMSA(msa: MSASegment): string {
  const fields = [
    'MSA',
    msa.acknowledgmentCode || 'AA',
    msa.messageControlId || '',
    msa.textMessage || '',
    msa.expectedSequenceNumber || '',
    msa.delayedAcknowledgmentType || '',
    msa.errorCondition || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build ERR segment string
 */
export function buildERR(err: ERRSegment): string {
  const errorCode = err.hl7ErrorCode
    ? `${err.hl7ErrorCode.identifier || ''}${HL7_COMPONENT_SEPARATOR}${err.hl7ErrorCode.text || ''}`
    : '';
  
  const fields = [
    'ERR',
    err.errorCodeAndLocation || '',
    err.errorLocation || '',
    errorCode,
    err.severity || '',
    err.applicationErrorCode || '',
    err.applicationErrorParameter || '',
    err.diagnosticInformation || '',
    err.userMessage || '',
  ];
  
  return fields.join(HL7_FIELD_SEPARATOR);
}

/**
 * Build complete SIU message string
 */
export function buildSIUMessage(message: SIUMessage): string {
  const segments: string[] = [
    buildMSH(message.msh),
    buildSCH(message.sch),
  ];
  
  if (message.pid) segments.push(buildPID(message.pid));
  if (message.pv1) segments.push(buildPV1(message.pv1));
  if (message.rgs) segments.push(buildRGS(message.rgs));
  if (message.aig) segments.push(buildAIG(message.aig));
  if (message.ail) segments.push(buildAIL(message.ail));
  if (message.aip) segments.push(buildAIP(message.aip));
  
  return segments.join('\r');
}

/**
 * Build ACK message string
 */
export function buildACKMessage(message: ACKMessage): string {
  const segments: string[] = [
    buildMSH(message.msh),
    buildMSA(message.msa),
  ];
  
  if (message.err) segments.push(buildERR(message.err));
  
  return segments.join('\r');
}

/**
 * Wrap message with MLLP framing
 */
export function wrapMLLP(message: string): string {
  return `${MLLP_START_BLOCK}${message}${MLLP_END_BLOCK}${MLLP_CARRIAGE_RETURN}`;
}

/**
 * Unwrap MLLP framing from message
 */
export function unwrapMLLP(message: string): string {
  let result = message;
  if (result.startsWith(MLLP_START_BLOCK)) {
    result = result.substring(1);
  }
  if (result.endsWith(MLLP_END_BLOCK + MLLP_CARRIAGE_RETURN)) {
    result = result.substring(0, result.length - 2);
  } else if (result.endsWith(MLLP_END_BLOCK)) {
    result = result.substring(0, result.length - 1);
  }
  return result;
}

/**
 * Create an ACK response for a received message
 */
export function createACKResponse(
  originalMsh: MSHSegment,
  ackCode: AckCode,
  message?: string,
  errorDetails?: { code?: string; text?: string; severity?: string }
): ACKMessage {
  const now = new Date();
  const timestamp = formatHL7DateTime(now);
  
  const ack: ACKMessage = {
    msh: {
      segmentType: 'MSH',
      encodingCharacters: HL7_ENCODING_CHARACTERS,
      sendingApplication: originalMsh.receivingApplication,
      sendingFacility: originalMsh.receivingFacility,
      receivingApplication: originalMsh.sendingApplication,
      receivingFacility: originalMsh.sendingFacility,
      dateTimeOfMessage: timestamp,
      messageType: {
        messageCode: 'ACK',
        triggerEvent: originalMsh.messageType.triggerEvent,
      },
      messageControlId: `ACK${timestamp}`,
      processingId: originalMsh.processingId,
      versionId: originalMsh.versionId,
    },
    msa: {
      segmentType: 'MSA',
      acknowledgmentCode: ackCode,
      messageControlId: originalMsh.messageControlId,
      textMessage: message,
    },
  };
  
  if (ackCode !== 'AA' && errorDetails) {
    ack.err = {
      segmentType: 'ERR',
      hl7ErrorCode: {
        identifier: errorDetails.code,
        text: errorDetails.text,
      },
      severity: errorDetails.severity || 'E',
    };
  }
  
  return ack;
}

/**
 * Format a Date to HL7 datetime format (yyyyMMddHHmmss)
 */
export function formatHL7DateTime(date: Date): string {
  const pad = (n: number, width: number = 2) => n.toString().padStart(width, '0');
  
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/**
 * Parse HL7 datetime format to Date
 */
export function parseHL7DateTime(hl7Date: string): Date {
  if (!hl7Date || hl7Date.length < 8) {
    return new Date();
  }
  
  const year = parseInt(hl7Date.substring(0, 4), 10);
  const month = parseInt(hl7Date.substring(4, 6), 10) - 1;
  const day = parseInt(hl7Date.substring(6, 8), 10);
  const hour = hl7Date.length >= 10 ? parseInt(hl7Date.substring(8, 10), 10) : 0;
  const minute = hl7Date.length >= 12 ? parseInt(hl7Date.substring(10, 12), 10) : 0;
  const second = hl7Date.length >= 14 ? parseInt(hl7Date.substring(12, 14), 10) : 0;
  
  return new Date(year, month, day, hour, minute, second);
}
