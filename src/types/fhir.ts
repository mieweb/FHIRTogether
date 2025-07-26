/**
 * FHIR R4 Resource Types
 * Simplified definitions for Schedule, Slot, and Appointment resources
 */

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
  };
}

export interface Identifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary';
  system?: string;
  value?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

/**
 * FHIR Schedule Resource
 */
export interface Schedule extends FhirResource {
  resourceType: 'Schedule';
  identifier?: Identifier[];
  active?: boolean;
  serviceCategory?: CodeableConcept[];
  serviceType?: CodeableConcept[];
  specialty?: CodeableConcept[];
  actor: Reference[];
  planningHorizon?: Period;
  comment?: string;
}

/**
 * FHIR Slot Resource
 */
export interface Slot extends FhirResource {
  resourceType: 'Slot';
  identifier?: Identifier[];
  serviceCategory?: CodeableConcept[];
  serviceType?: CodeableConcept[];
  specialty?: CodeableConcept[];
  appointmentType?: CodeableConcept;
  schedule: Reference;
  status: 'busy' | 'free' | 'busy-unavailable' | 'busy-tentative' | 'entered-in-error';
  start: string;
  end: string;
  overbooked?: boolean;
  comment?: string;
}

/**
 * FHIR Appointment Resource
 */
export interface Appointment extends FhirResource {
  resourceType: 'Appointment';
  identifier?: Identifier[];
  status: 'proposed' | 'pending' | 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow' | 'entered-in-error' | 'checked-in' | 'waitlist';
  cancelationReason?: CodeableConcept;
  serviceCategory?: CodeableConcept[];
  serviceType?: CodeableConcept[];
  specialty?: CodeableConcept[];
  appointmentType?: CodeableConcept;
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  priority?: number;
  description?: string;
  slot?: Reference[];
  created?: string;
  comment?: string;
  patientInstruction?: string;
  basedOn?: Reference[];
  participant: AppointmentParticipant[];
  requestedPeriod?: Period[];
}

export interface AppointmentParticipant {
  type?: CodeableConcept[];
  actor?: Reference;
  required?: 'required' | 'optional' | 'information-only';
  status: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  period?: Period;
}

/**
 * FHIR OperationOutcome Resource
 */
export interface OperationOutcome extends FhirResource {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

export interface OperationOutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: CodeableConcept;
  diagnostics?: string;
  location?: string[];
  expression?: string[];
}

/**
 * FHIR Bundle Resource
 */
export interface Bundle extends FhirResource {
  resourceType: 'Bundle';
  type: 'document' | 'message' | 'transaction' | 'transaction-response' | 'batch' | 'batch-response' | 'history' | 'searchset' | 'collection';
  total?: number;
  link?: BundleLink[];
  entry?: BundleEntry[];
}

export interface BundleLink {
  relation: string;
  url: string;
}

export interface BundleEntry {
  link?: BundleLink[];
  fullUrl?: string;
  resource?: FhirResource;
  search?: {
    mode?: 'match' | 'include' | 'outcome';
    score?: number;
  };
  request?: {
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    ifNoneMatch?: string;
    ifModifiedSince?: string;
    ifMatch?: string;
    ifNoneExist?: string;
  };
  response?: {
    status: string;
    location?: string;
    etag?: string;
    lastModified?: string;
    outcome?: FhirResource;
  };
}

/**
 * Query Parameters for FHIR Resources
 */
export interface FhirSlotQuery {
  schedule?: string;
  status?: string;
  start?: string;
  end?: string;
  serviceType?: string;
  specialty?: string;
  _count?: number;
  _offset?: number;
}

export interface FhirScheduleQuery {
  actor?: string;
  date?: string;
  identifier?: string;
  active?: boolean;
  serviceType?: string;
  specialty?: string;
  _count?: number;
  _offset?: number;
}

export interface FhirAppointmentQuery {
  date?: string;
  actor?: string;
  identifier?: string;
  patient?: string;
  practitioner?: string;
  status?: string;
  serviceType?: string;
  _count?: number;
  _offset?: number;
}