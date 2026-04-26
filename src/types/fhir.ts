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
  system_id?: string;
}

export interface FhirAppointmentQuery {
  date?: string;
  status?: string;
  actor?: string;
  patient?: string;
  identifier?: string;
  _count?: number;
}

// ==================== SYNAPSE MULTI-TENANT TYPES ====================

/**
 * System status progression:
 *   HL7 path:  (first SIU) → unverified → [admin verifies] → active → [stops sending] → expired
 *   REST path: register → pending → [TLS challenge] → active → [stops calling] → expired
 */
export type SystemStatus = 'unverified' | 'pending' | 'active' | 'expired';

/**
 * A registered system (EHR, clinic, hospital) in the synapse gateway.
 * Systems are identified by MSH-3 (sending application) + MSH-4 (sending facility)
 * in HL7, or by URL in REST.
 */
export interface SynapseSystem {
  id: string;
  name: string;
  url?: string;
  mshApplication?: string;
  mshFacility?: string;
  status: SystemStatus;
  lastActivityAt: string;
  createdAt: string;
  ttlDays: number;
}

/**
 * A physical location belonging to a system.
 * Auto-created from AIL segments in HL7, or via REST API.
 */
export interface SynapseLocation {
  id: string;
  systemId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  hl7LocationId?: string;
  createdAt: string;
}

/**
 * Returned when a new system is registered via REST API.
 */
export interface SystemRegistration {
  systemId: string;
  challengeToken: string;
  challengeUrl: string;
}

/**
 * Result of findOrCreateSystemByMSH — tells callers
 * whether the system was just created and whether the secret matched.
 */
export interface MSHLookupResult {
  system: SynapseSystem;
  isNew: boolean;
  secretMatch: boolean;
  /** Raw API key — only present when a new key was generated (first contact). */
  apiKey?: string;
}

/**
 * Query parameters for system listing
 */
export interface SynapseSystemQuery {
  status?: SystemStatus;
  _count?: number;
}

/**
 * Query parameters for location listing
 */
export interface SynapseLocationQuery {
  systemId?: string;
  zip?: string;
  _count?: number;
}

/**
 * Slot Hold for preventing double-booking during checkout
 */
export interface SlotHold {
  id: string;
  slotId: string;
  holdToken: string;
  sessionId: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * HL7 Message Log Entry
 *
 * Persisted audit record of every inbound HL7 message.
 * Old entries are purged daily based on HL7_MESSAGE_LOG_RETENTION_DAYS.
 */
export interface HL7MessageLogEntry {
  id: string;
  receivedAt: string;
  source: 'http' | 'mllp';
  remoteAddress?: string;
  messageType?: string;
  triggerEvent?: string;
  controlId?: string;
  rawMessage: string;
  ackResponse?: string;
  ackCode?: string;        // AA, AE, AR
  processingMs?: number;
}

export interface HL7MessageLogQuery {
  source?: 'http' | 'mllp';
  messageType?: string;
  ackCode?: string;
  since?: string;          // ISO datetime lower-bound
  _count?: number;
}

/**
 * Store Interface
 */
export interface FhirStore {
  // ==================== SYNAPSE SYSTEM OPERATIONS ====================
  createSystem(system: Omit<SynapseSystem, 'id' | 'createdAt' | 'lastActivityAt'> & { apiKeyHash?: string; mshSecretHash?: string; challengeToken?: string }): Promise<SynapseSystem>;
  findOrCreateSystemByMSH(application: string, facility: string, secret: string): Promise<MSHLookupResult>;
  getSystemById(id: string): Promise<SynapseSystem | undefined>;
  getSystemByUrl(url: string): Promise<SynapseSystem | undefined>;
  getSystemByMsh(application: string, facility: string): Promise<SynapseSystem | undefined>;
  getSystemByApiKeyHash(hash: string): Promise<SynapseSystem | undefined>;
  getSystems(query?: SynapseSystemQuery): Promise<SynapseSystem[]>;
  updateSystem(id: string, updates: Partial<Pick<SynapseSystem, 'name' | 'url' | 'status' | 'ttlDays'>> & { apiKeyHash?: string; challengeToken?: string }): Promise<SynapseSystem>;
  updateSystemActivity(id: string): Promise<void>;
  deleteSystem(id: string): Promise<void>;
  getSystemChallengeToken(id: string): Promise<string | undefined>;
  evaporateExpiredSystems(): Promise<{ count: number; systems: Array<{ id: string; name: string; mshApplication?: string; mshFacility?: string }> }>;

  // ==================== SYNAPSE LOCATION OPERATIONS ====================
  createLocation(location: Omit<SynapseLocation, 'id' | 'createdAt'>): Promise<SynapseLocation>;
  findOrCreateLocationByHL7(systemId: string, hl7LocationId: string, name: string, address?: string): Promise<SynapseLocation>;
  getLocations(query?: SynapseLocationQuery): Promise<SynapseLocation[]>;
  getLocationById(id: string): Promise<SynapseLocation | undefined>;
  updateLocation(id: string, updates: Partial<Omit<SynapseLocation, 'id' | 'systemId' | 'createdAt'>>): Promise<SynapseLocation>;
  deleteLocation(id: string): Promise<void>;

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

  // Slot hold operations
  holdSlot(slotId: string, sessionId: string, durationMinutes: number): Promise<SlotHold>;
  releaseHold(holdToken: string): Promise<void>;
  getActiveHold(slotId: string): Promise<SlotHold | null>;
  getHoldByToken(holdToken: string): Promise<SlotHold | null>;
  cleanupExpiredHolds(): Promise<number>;

  // HL7 message log operations
  logHL7Message(entry: Omit<HL7MessageLogEntry, 'id'>): Promise<HL7MessageLogEntry>;
  getHL7MessageLog(query?: HL7MessageLogQuery): Promise<HL7MessageLogEntry[]>;
  cleanupHL7MessageLog(retentionDays: number): Promise<number>;

  // Utility
  initialize(): Promise<{ current: number; expected: number; match: boolean; migrated: boolean }>;
  close(): Promise<void>;
}
