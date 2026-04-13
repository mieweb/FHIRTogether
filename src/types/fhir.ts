/**
 * FHIR Resource Types
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
  system?: string;
  value: string;
  use?: string;
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
}

/**
 * FHIR Bundle
 */
export interface Bundle {
  resourceType: 'Bundle';
  type: 'searchset' | 'collection' | 'transaction' | 'batch';
  total?: number;
  entry?: Array<{
    fullUrl?: string;
    resource: FhirResource;
  }>;
}

/**
 * Query Parameters
 */
export interface FhirSlotQuery {
  schedule?: string;
  status?: string;
  start?: string;
  end?: string;
  _count?: number;
}

export interface FhirScheduleQuery {
  actor?: string;
  active?: boolean;
  date?: string;
  _count?: number;
}

export interface FhirAppointmentQuery {
  date?: string;
  status?: string;
  actor?: string;
  patient?: string;
  _count?: number;
}

/**
 * Store Capabilities — declares what a backend can and cannot do.
 * Safe default: if a capability is missing, assume false.
 */
export interface StoreCapabilities {
  /** Backend supports creating/mutating schedules (SQLite yes, WebChart no) */
  scheduleWrite: boolean;
  /** Backend supports creating/mutating slots directly (SQLite yes, WebChart computes them) */
  slotWrite: boolean;
  /** Backend supports bulk delete operations */
  bulkDelete: boolean;
  /** Backend can look up an appointment by an identifier (system+value) without brute-force scan */
  appointmentIdentifierLookup: boolean;
}

/**
 * Configuration union for creating a store via the factory.
 */
export interface StoreConfig {
  backend: string;
  [key: string]: unknown;
}

/**
 * Store Interface
 */
export interface FhirStore {
  /** Human-readable name of the backend (e.g. "sqlite", "webchart") */
  readonly name: string;

  /** Declares what this backend supports */
  readonly capabilities: StoreCapabilities;

  // Slot operations
  getSlots(query: FhirSlotQuery): Promise<Slot[]>;
  getSlotById(id: string): Promise<Slot | null>;
  createSlot(slot: Slot): Promise<Slot>;
  updateSlot(id: string, slot: Partial<Slot>): Promise<Slot>;
  deleteSlot(id: string): Promise<void>;
  deleteAllSlots(): Promise<void>;

  // Schedule operations
  getSchedules(query: FhirScheduleQuery): Promise<Schedule[]>;
  getScheduleById(id: string): Promise<Schedule | null>;
  createSchedule(schedule: Schedule): Promise<Schedule>;
  updateSchedule(id: string, schedule: Partial<Schedule>): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  deleteAllSchedules(): Promise<void>;

  // Appointment operations
  getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]>;
  getAppointmentById(id: string): Promise<Appointment | null>;
  createAppointment(appointment: Appointment): Promise<Appointment>;
  updateAppointment(id: string, appointment: Partial<Appointment>): Promise<Appointment>;
  deleteAppointment(id: string): Promise<void>;
  deleteAllAppointments(): Promise<void>;

  /**
   * Look up an appointment by an identifier (system + value).
   * Backends that support efficient identifier lookup should query directly;
   * others fall back to scanning via getAppointments().
   */
  getAppointmentByIdentifier(system: string, value: string): Promise<Appointment | null>;

  // Utility
  initialize(): Promise<void>;
  close(): Promise<void>;
}
