/**
 * FHIR Resource Types (subset for scheduler)
 */

// Import FormData from forms-renderer for questionnaire props
import type { FormData as FormsRendererFormData } from '@mieweb/forms-renderer';
export type { FormsRendererFormData };

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
  };
}

export interface Reference {
  reference: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Array<{
    system?: string;
    code?: string;
    display?: string;
  }>;
  text?: string;
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
  status: 'proposed' | 'pending' | 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow' | 'entered-in-error' | 'checked-in' | 'waitlist';
  cancelationReason?: CodeableConcept;
  serviceCategory?: CodeableConcept[];
  serviceType?: CodeableConcept[];
  specialty?: CodeableConcept[];
  appointmentType?: CodeableConcept;
  reasonCode?: CodeableConcept[];
  priority?: number;
  description?: string;
  slot?: Reference[];
  start?: string;
  end?: string;
  created?: string;
  comment?: string;
  patientInstruction?: string;
  participant: Array<{
    type?: CodeableConcept[];
    actor?: Reference;
    required?: 'required' | 'optional' | 'information-only';
    status: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  }>;
  contained?: FhirResource[];
}

/**
 * FHIR Bundle
 */
export interface Bundle<T extends FhirResource = FhirResource> {
  resourceType: 'Bundle';
  type: 'searchset' | 'collection' | 'transaction' | 'batch';
  total?: number;
  entry?: Array<{
    fullUrl?: string;
    resource: T;
  }>;
}

/**
 * Slot Hold
 */
export interface SlotHold {
  id: string;
  slotId: string;
  holdToken: string;
  sessionId: string;
  expiresAt: string;
  createdAt: string;
  status: 'held' | 'released' | 'expired';
}

/**
 * Patient Information for booking
 */
export interface PatientInfo {
  name: string;
  phone: string;
  email: string;
  dateOfBirth?: string;
  reason?: string;
}

/**
 * Questionnaire Response (simplified)
 */
export interface QuestionnaireResponse extends FhirResource {
  resourceType: 'QuestionnaireResponse';
  questionnaire?: string;
  status: 'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';
  authored?: string;
  subject?: { reference: string };
  item?: QuestionnaireResponseItem[];
}

export interface QuestionnaireResponseItem {
  linkId: string;
  text?: string;
  answer?: Array<{
    valueString?: string;
    valueInteger?: number;
    valueBoolean?: boolean;
    valueDate?: string;
    valueDateTime?: string;
  }>;
  item?: QuestionnaireResponseItem[];
}

/**
 * Questionnaire Form Data (MIE Forms schema)
 * Represents the input format for @mieweb/forms-renderer
 */
export interface QuestionnaireFormData {
  schemaType?: 'mieforms-v1.0' | 'surveyjs';
  title?: string;
  fields: QuestionnaireField[];
}

/**
 * Questionnaire Field (simplified for type hints)
 */
export interface QuestionnaireField {
  id: string;
  fieldType: 'text' | 'longtext' | 'multitext' | 'radio' | 'check' | 'dropdown' | 'boolean' | 'section' | string;
  question?: string;
  title?: string;
  answer?: string;
  selected?: string | string[] | null;
  options?: Array<{ id: string; value: string }>;
  fields?: QuestionnaireField[];
  enableWhen?: {
    logic: 'AND' | 'OR';
    conditions: Array<{
      targetId: string;
      operator: 'equals' | 'notEquals' | 'includes' | 'notIncludes';
      value: string;
    }>;
  };
}

/**
 * Scheduler Widget Props
 */
export interface SchedulerWidgetProps {
  /** Base URL of the FHIR server */
  fhirBaseUrl: string;
  /** Pre-select a specific provider (skip provider list) */
  providerId?: string;
  /** MIE Forms or questionnaire schema for intake (used for new patient flow) */
  questionnaireFormData?: FormsRendererFormData;
  /** How long to hold a slot during booking (minutes) */
  holdDurationMinutes?: number;
  /** Callback when booking succeeds */
  onComplete?: (appointment: Appointment) => void;
  /** Callback on booking failure */
  onError?: (error: Error) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Visit type for scheduling flow
 */
export type VisitType = 'new-patient' | 'follow-up';

/**
 * Scheduler workflow steps
 */
export type SchedulerStep = 'visit-type' | 'questionnaire' | 'providers' | 'calendar' | 'booking' | 'confirmation';
