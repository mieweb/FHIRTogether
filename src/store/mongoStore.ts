import crypto from 'crypto';
import {
  MongoClient,
  Db,
  Collection,
  Filter,
  OptionalUnlessRequiredId,
} from 'mongodb';
import {
  FhirStore,
  Schedule,
  Slot,
  Appointment,
  SlotHold,
  SynapseSystem,
  SynapseLocation,
  SynapseSystemQuery,
  SynapseLocationQuery,
  MSHLookupResult,
  SystemStatus,
  HL7MessageLogEntry,
  HL7MessageLogQuery,
  FhirSlotQuery,
  FhirScheduleQuery,
  FhirAppointmentQuery,
} from '../types/fhir';

export const MONGO_SCHEMA_VERSION = 1;

interface SchemaStatus {
  current: number;
  expected: number;
  match: boolean;
  migrated: boolean;
}

interface MetaDoc {
  key: string;
  value: string;
}

interface SystemDoc {
  id: string;
  name: string;
  url?: string;
  apiKeyHash?: string;
  mshApplication?: string;
  mshFacility?: string;
  mshSecretHash?: string;
  challengeToken?: string;
  status: SystemStatus;
  lastActivityAt: string;
  createdAt: string;
  ttlDays: number;
}

interface LocationDoc {
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

interface ScheduleDoc {
  id: string;
  active?: boolean;
  serviceCategory?: Schedule['serviceCategory'];
  serviceType?: Schedule['serviceType'];
  specialty?: Schedule['specialty'];
  actor: Schedule['actor'];
  planningHorizonStart?: string;
  planningHorizonEnd?: string;
  comment?: string;
  metaLastUpdated: string;
  systemId?: string;
  locationId?: string;
  availabilityTemplate?: string;
}

interface SlotDoc {
  id: string;
  scheduleId: string;
  status: Slot['status'];
  start: string;
  end: string;
  serviceCategory?: Slot['serviceCategory'];
  serviceType?: Slot['serviceType'];
  specialty?: Slot['specialty'];
  appointmentType?: Slot['appointmentType'];
  overbooked?: boolean;
  comment?: string;
  metaLastUpdated: string;
}

interface AppointmentDoc {
  id: string;
  status: Appointment['status'];
  identifier?: Appointment['identifier'];
  cancelationReason?: Appointment['cancelationReason'];
  serviceCategory?: Appointment['serviceCategory'];
  serviceType?: Appointment['serviceType'];
  specialty?: Appointment['specialty'];
  appointmentType?: Appointment['appointmentType'];
  reasonCode?: Appointment['reasonCode'];
  priority?: number;
  description?: string;
  slotRefs?: Appointment['slot'];
  start?: string;
  end?: string;
  created?: string;
  comment?: string;
  patientInstruction?: string;
  participant: Appointment['participant'];
  metaLastUpdated: string;
}

interface SlotHoldDoc {
  id: string;
  slotId: string;
  holdToken: string;
  sessionId: string;
  expiresAt: string;
  createdAt: string;
}

interface HL7LogDoc {
  id: string;
  receivedAt: string;
  source: 'http' | 'mllp';
  remoteAddress?: string;
  messageType?: string;
  triggerEvent?: string;
  controlId?: string;
  rawMessage: string;
  ackResponse?: string;
  ackCode?: string;
  processingMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MongoStore implements FhirStore {
  private client: MongoClient;
  private dbName: string;
  private db?: Db;

  private meta!: Collection<MetaDoc>;
  private systems!: Collection<SystemDoc>;
  private locations!: Collection<LocationDoc>;
  private schedules!: Collection<ScheduleDoc>;
  private slots!: Collection<SlotDoc>;
  private appointments!: Collection<AppointmentDoc>;
  private slotHolds!: Collection<SlotHoldDoc>;
  private hl7Logs!: Collection<HL7LogDoc>;

  constructor(mongoUri?: string, dbName?: string) {
    const uri = mongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    this.dbName = dbName || process.env.MONGO_DB_NAME || 'fhirtogether';
    this.client = new MongoClient(uri);
  }

  async initialize(): Promise<SchemaStatus> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);

    this.meta = this.db.collection<MetaDoc>('meta');
    this.systems = this.db.collection<SystemDoc>('systems');
    this.locations = this.db.collection<LocationDoc>('locations');
    this.schedules = this.db.collection<ScheduleDoc>('schedules');
    this.slots = this.db.collection<SlotDoc>('slots');
    this.appointments = this.db.collection<AppointmentDoc>('appointments');
    this.slotHolds = this.db.collection<SlotHoldDoc>('slot_holds');
    this.hl7Logs = this.db.collection<HL7LogDoc>('hl7_message_log');

    await Promise.all([
      this.meta.createIndex({ key: 1 }, { unique: true }),
      this.systems.createIndex({ id: 1 }, { unique: true }),
      this.systems.createIndex({ url: 1 }),
      this.systems.createIndex({ mshApplication: 1, mshFacility: 1 }, { unique: true, sparse: true }),
      this.systems.createIndex({ apiKeyHash: 1 }, { sparse: true }),
      this.systems.createIndex({ status: 1 }),
      this.locations.createIndex({ id: 1 }, { unique: true }),
      this.locations.createIndex({ systemId: 1 }),
      this.locations.createIndex({ systemId: 1, hl7LocationId: 1 }, { sparse: true }),
      this.schedules.createIndex({ id: 1 }, { unique: true }),
      this.schedules.createIndex({ systemId: 1 }),
      this.schedules.createIndex({ locationId: 1 }),
      this.slots.createIndex({ id: 1 }, { unique: true }),
      this.slots.createIndex({ scheduleId: 1 }),
      this.slots.createIndex({ status: 1 }),
      this.slots.createIndex({ start: 1 }),
      this.appointments.createIndex({ id: 1 }, { unique: true }),
      this.appointments.createIndex({ status: 1 }),
      this.appointments.createIndex({ start: 1 }),
      this.slotHolds.createIndex({ id: 1 }, { unique: true }),
      this.slotHolds.createIndex({ holdToken: 1 }, { unique: true }),
      this.slotHolds.createIndex({ slotId: 1 }),
      this.slotHolds.createIndex({ expiresAt: 1 }),
      this.hl7Logs.createIndex({ id: 1 }, { unique: true }),
      this.hl7Logs.createIndex({ receivedAt: -1 }),
      this.hl7Logs.createIndex({ source: 1 }),
      this.hl7Logs.createIndex({ messageType: 1 }),
    ]);

    const versionDoc = await this.meta.findOne({ key: 'schema_version' });
    const current = versionDoc ? parseInt(versionDoc.value, 10) : 0;

    await this.meta.updateOne(
      { key: 'schema_version' },
      { $set: { value: String(MONGO_SCHEMA_VERSION) } },
      { upsert: true }
    );

    return {
      current,
      expected: MONGO_SCHEMA_VERSION,
      match: current === MONGO_SCHEMA_VERSION || current === 0,
      migrated: current !== MONGO_SCHEMA_VERSION,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private extractId(reference: string): string {
    return reference.split('/').pop() || reference;
  }

  private toSystem(doc: SystemDoc): SynapseSystem {
    return {
      id: doc.id,
      name: doc.name,
      url: doc.url,
      mshApplication: doc.mshApplication,
      mshFacility: doc.mshFacility,
      status: doc.status,
      lastActivityAt: doc.lastActivityAt,
      createdAt: doc.createdAt,
      ttlDays: doc.ttlDays,
    };
  }

  private toLocation(doc: LocationDoc): SynapseLocation {
    return {
      id: doc.id,
      systemId: doc.systemId,
      name: doc.name,
      address: doc.address,
      city: doc.city,
      state: doc.state,
      zip: doc.zip,
      phone: doc.phone,
      hl7LocationId: doc.hl7LocationId,
      createdAt: doc.createdAt,
    };
  }

  private async toSchedule(doc: ScheduleDoc): Promise<Schedule> {
    const schedule: Schedule & { extension?: Array<{ url: string; valueString?: string }>; system_id?: string; location_id?: string } = {
      resourceType: 'Schedule',
      id: doc.id,
      active: doc.active,
      serviceCategory: doc.serviceCategory,
      serviceType: doc.serviceType,
      specialty: doc.specialty,
      actor: doc.actor,
      planningHorizon: doc.planningHorizonStart
        ? { start: doc.planningHorizonStart, end: doc.planningHorizonEnd }
        : undefined,
      comment: doc.comment,
      meta: { lastUpdated: doc.metaLastUpdated },
      system_id: doc.systemId,
      location_id: doc.locationId,
    };

    const extension: Array<{ url: string; valueString?: string }> = [];
    if (doc.systemId) {
      const system = await this.systems.findOne({ id: doc.systemId });
      if (system?.name) {
        extension.push({
          url: 'https://fhirtogether.org/fhir/StructureDefinition/system-name',
          valueString: system.name,
        });
      }
    }

    if (doc.availabilityTemplate) {
      extension.push({
        url: 'https://fhirtogether.org/StructureDefinition/availability-template',
        valueString: doc.availabilityTemplate,
      });
    }

    if (extension.length > 0) {
      schedule.extension = extension;
    }

    return schedule;
  }

  private toSlot(doc: SlotDoc): Slot {
    return {
      resourceType: 'Slot',
      id: doc.id,
      schedule: { reference: `Schedule/${doc.scheduleId}` },
      status: doc.status,
      start: doc.start,
      end: doc.end,
      serviceCategory: doc.serviceCategory,
      serviceType: doc.serviceType,
      specialty: doc.specialty,
      appointmentType: doc.appointmentType,
      overbooked: doc.overbooked,
      comment: doc.comment,
      meta: { lastUpdated: doc.metaLastUpdated },
    };
  }

  private toAppointment(doc: AppointmentDoc): Appointment {
    return {
      resourceType: 'Appointment',
      id: doc.id,
      status: doc.status,
      identifier: doc.identifier,
      cancelationReason: doc.cancelationReason,
      serviceCategory: doc.serviceCategory,
      serviceType: doc.serviceType,
      specialty: doc.specialty,
      appointmentType: doc.appointmentType,
      reasonCode: doc.reasonCode,
      priority: doc.priority,
      description: doc.description,
      slot: doc.slotRefs,
      start: doc.start,
      end: doc.end,
      created: doc.created,
      comment: doc.comment,
      patientInstruction: doc.patientInstruction,
      participant: doc.participant,
      meta: { lastUpdated: doc.metaLastUpdated },
    };
  }

  private toSlotHold(doc: SlotHoldDoc): SlotHold {
    return {
      id: doc.id,
      slotId: doc.slotId,
      holdToken: doc.holdToken,
      sessionId: doc.sessionId,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
    };
  }

  private toHL7Log(doc: HL7LogDoc): HL7MessageLogEntry {
    return {
      id: doc.id,
      receivedAt: doc.receivedAt,
      source: doc.source,
      remoteAddress: doc.remoteAddress,
      messageType: doc.messageType,
      triggerEvent: doc.triggerEvent,
      controlId: doc.controlId,
      rawMessage: doc.rawMessage,
      ackResponse: doc.ackResponse,
      ackCode: doc.ackCode,
      processingMs: doc.processingMs,
    };
  }

  private async deleteSystemCascade(systemId: string): Promise<void> {
    const scheduleDocs = await this.schedules.find({ systemId }, { projection: { id: 1 } }).toArray();
    const scheduleIds = scheduleDocs.map((s) => s.id);

    const slotDocs = scheduleIds.length > 0
      ? await this.slots.find({ scheduleId: { $in: scheduleIds } }, { projection: { id: 1 } }).toArray()
      : [];
    const slotIds = slotDocs.map((s) => s.id);

    if (slotIds.length > 0) {
      const slotRefs = slotIds.map((id) => `Slot/${id}`);
      await this.appointments.deleteMany({
        slotRefs: { $elemMatch: { reference: { $in: slotRefs } } },
      });
      await this.slotHolds.deleteMany({ slotId: { $in: slotIds } });
    }

    if (scheduleIds.length > 0) {
      await this.slots.deleteMany({ scheduleId: { $in: scheduleIds } });
      await this.schedules.deleteMany({ id: { $in: scheduleIds } });
    }

    await this.locations.deleteMany({ systemId });
    await this.systems.deleteOne({ id: systemId });
  }

  async createSystem(system: Omit<SynapseSystem, 'id' | 'createdAt' | 'lastActivityAt'> & { apiKeyHash?: string; mshSecretHash?: string; challengeToken?: string }): Promise<SynapseSystem> {
    const id = this.generateId();
    const now = nowIso();

    const doc: OptionalUnlessRequiredId<SystemDoc> = {
      id,
      name: system.name,
      url: system.url,
      apiKeyHash: system.apiKeyHash,
      mshApplication: system.mshApplication,
      mshFacility: system.mshFacility,
      mshSecretHash: system.mshSecretHash,
      challengeToken: system.challengeToken,
      status: system.status,
      lastActivityAt: now,
      createdAt: now,
      ttlDays: system.ttlDays,
    };

    await this.systems.insertOne(doc);
    return this.toSystem(doc as SystemDoc);
  }

  async findOrCreateSystemByMSH(application: string, facility: string, secret: string): Promise<MSHLookupResult> {
    const existing = await this.systems.findOne({ mshApplication: application, mshFacility: facility });

    if (existing) {
      const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

      if (!existing.mshSecretHash) {
        await this.systems.updateOne({ id: existing.id }, { $set: { mshSecretHash: secretHash } });
        await this.updateSystemActivity(existing.id);
        const apiKey = await this.issueApiKey(existing.id);
        const refreshed = await this.systems.findOne({ id: existing.id });
        return { system: this.toSystem(refreshed || existing), isNew: false, secretMatch: true, apiKey };
      }

      const match = crypto.timingSafeEqual(Buffer.from(secretHash), Buffer.from(existing.mshSecretHash));
      if (match) {
        await this.updateSystemActivity(existing.id);
        const apiKey = await this.issueApiKey(existing.id);
        const refreshed = await this.systems.findOne({ id: existing.id });
        return { system: this.toSystem(refreshed || existing), isNew: false, secretMatch: true, apiKey };
      }

      return { system: this.toSystem(existing), isNew: false, secretMatch: false };
    }

    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const secretHash = secret ? crypto.createHash('sha256').update(secret).digest('hex') : undefined;
    const defaultTtl = parseInt(process.env.SYSTEM_TTL_DAYS || '7', 10);

    const system = await this.createSystem({
      name: `${application}@${facility}`,
      status: 'unverified',
      ttlDays: defaultTtl,
      mshApplication: application,
      mshFacility: facility,
      mshSecretHash: secretHash,
      apiKeyHash,
    });

    return { system, isNew: true, secretMatch: true, apiKey };
  }

  private async issueApiKey(systemId: string): Promise<string> {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    await this.systems.updateOne({ id: systemId }, { $set: { apiKeyHash: hash } });
    return apiKey;
  }

  async getSystemById(id: string): Promise<SynapseSystem | undefined> {
    const row = await this.systems.findOne({ id });
    return row ? this.toSystem(row) : undefined;
  }

  async getSystemByUrl(url: string): Promise<SynapseSystem | undefined> {
    const row = await this.systems.findOne({ url });
    return row ? this.toSystem(row) : undefined;
  }

  async getSystemByMsh(application: string, facility: string): Promise<SynapseSystem | undefined> {
    const row = await this.systems.findOne({ mshApplication: application, mshFacility: facility });
    return row ? this.toSystem(row) : undefined;
  }

  async getSystemByApiKeyHash(hash: string): Promise<SynapseSystem | undefined> {
    const row = await this.systems.findOne({ apiKeyHash: hash });
    return row ? this.toSystem(row) : undefined;
  }

  async getSystems(query?: SynapseSystemQuery): Promise<SynapseSystem[]> {
    const filter: Filter<SystemDoc> = {};
    if (query?.status) filter.status = query.status;

    let cursor = this.systems.find(filter).sort({ name: 1 });
    if (query?._count) cursor = cursor.limit(query._count);

    const rows = await cursor.toArray();
    return rows.map((r) => this.toSystem(r));
  }

  async updateSystem(id: string, updates: Partial<Pick<SynapseSystem, 'name' | 'url' | 'status' | 'ttlDays'>> & { apiKeyHash?: string; challengeToken?: string }): Promise<SynapseSystem> {
    const existing = await this.getSystemById(id);
    if (!existing) throw new Error(`System ${id} not found`);

    const set: Partial<SystemDoc> = {};
    if (updates.name !== undefined) set.name = updates.name;
    if (updates.url !== undefined) set.url = updates.url;
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.ttlDays !== undefined) set.ttlDays = updates.ttlDays;
    if (updates.apiKeyHash !== undefined) set.apiKeyHash = updates.apiKeyHash;
    if (updates.challengeToken !== undefined) set.challengeToken = updates.challengeToken;

    if (Object.keys(set).length > 0) {
      await this.systems.updateOne({ id }, { $set: set });
    }

    const updated = await this.getSystemById(id);
    return updated || existing;
  }

  async updateSystemActivity(id: string): Promise<void> {
    await this.systems.updateOne({ id }, { $set: { lastActivityAt: nowIso() } });
  }

  async deleteSystem(id: string): Promise<void> {
    await this.deleteSystemCascade(id);
  }

  async getSystemChallengeToken(id: string): Promise<string | undefined> {
    const row = await this.systems.findOne({ id }, { projection: { challengeToken: 1 } });
    return row?.challengeToken;
  }

  async evaporateExpiredSystems(): Promise<{ count: number; systems: Array<{ id: string; name: string; mshApplication?: string; mshFacility?: string }> }> {
    const now = Date.now();
    const candidates = await this.systems.find({ status: { $ne: 'expired' } }).toArray();
    const expired = candidates.filter((s) => {
      const last = new Date(s.lastActivityAt);
      if (Number.isNaN(last.getTime())) return false;
      last.setDate(last.getDate() + s.ttlDays);
      return last.getTime() < now;
    });

    for (const system of expired) {
      await this.deleteSystemCascade(system.id);
    }

    return {
      count: expired.length,
      systems: expired.map((s) => ({
        id: s.id,
        name: s.name,
        mshApplication: s.mshApplication,
        mshFacility: s.mshFacility,
      })),
    };
  }

  async createLocation(location: Omit<SynapseLocation, 'id' | 'createdAt'>): Promise<SynapseLocation> {
    const id = this.generateId();
    const now = nowIso();

    const doc: OptionalUnlessRequiredId<LocationDoc> = {
      id,
      systemId: location.systemId,
      name: location.name,
      address: location.address,
      city: location.city,
      state: location.state,
      zip: location.zip,
      phone: location.phone,
      hl7LocationId: location.hl7LocationId,
      createdAt: now,
    };

    await this.locations.insertOne(doc);
    return this.toLocation(doc as LocationDoc);
  }

  async findOrCreateLocationByHL7(systemId: string, hl7LocationId: string, name: string, address?: string): Promise<SynapseLocation> {
    const existing = await this.locations.findOne({ systemId, hl7LocationId });
    if (existing) return this.toLocation(existing);

    return this.createLocation({
      systemId,
      hl7LocationId,
      name,
      address,
    });
  }

  async getLocations(query?: SynapseLocationQuery): Promise<SynapseLocation[]> {
    const filter: Filter<LocationDoc> = {};
    if (query?.systemId) filter.systemId = query.systemId;
    if (query?.zip) filter.zip = query.zip;

    let cursor = this.locations.find(filter).sort({ name: 1 });
    if (query?._count) cursor = cursor.limit(query._count);

    const rows = await cursor.toArray();
    return rows.map((r) => this.toLocation(r));
  }

  async getLocationById(id: string): Promise<SynapseLocation | undefined> {
    const row = await this.locations.findOne({ id });
    return row ? this.toLocation(row) : undefined;
  }

  async updateLocation(id: string, updates: Partial<Omit<SynapseLocation, 'id' | 'systemId' | 'createdAt'>>): Promise<SynapseLocation> {
    const existing = await this.getLocationById(id);
    if (!existing) throw new Error(`Location ${id} not found`);

    const set: Partial<LocationDoc> = {};
    if (updates.name !== undefined) set.name = updates.name;
    if (updates.address !== undefined) set.address = updates.address;
    if (updates.city !== undefined) set.city = updates.city;
    if (updates.state !== undefined) set.state = updates.state;
    if (updates.zip !== undefined) set.zip = updates.zip;
    if (updates.phone !== undefined) set.phone = updates.phone;
    if (updates.hl7LocationId !== undefined) set.hl7LocationId = updates.hl7LocationId;

    if (Object.keys(set).length > 0) {
      await this.locations.updateOne({ id }, { $set: set });
    }

    const updated = await this.getLocationById(id);
    return updated || existing;
  }

  async deleteLocation(id: string): Promise<void> {
    await this.schedules.updateMany({ locationId: id }, { $unset: { locationId: '' } });
    await this.locations.deleteOne({ id });
  }

  async createSchedule(schedule: Schedule & { system_id?: string; location_id?: string; availability_template?: string }): Promise<Schedule> {
    const id = schedule.id || this.generateId();
    const now = nowIso();

    const doc: OptionalUnlessRequiredId<ScheduleDoc> = {
      id,
      active: schedule.active,
      serviceCategory: schedule.serviceCategory,
      serviceType: schedule.serviceType,
      specialty: schedule.specialty,
      actor: schedule.actor,
      planningHorizonStart: schedule.planningHorizon?.start,
      planningHorizonEnd: schedule.planningHorizon?.end,
      comment: schedule.comment,
      metaLastUpdated: now,
      systemId: schedule.system_id,
      locationId: schedule.location_id,
      availabilityTemplate: schedule.availability_template,
    };

    await this.schedules.insertOne(doc);
    const created = await this.schedules.findOne({ id });
    return this.toSchedule(created || (doc as ScheduleDoc));
  }

  async getSchedules(query: FhirScheduleQuery & { system_id?: string }): Promise<Schedule[]> {
    const filter: Filter<ScheduleDoc> = {};

    if (query.active !== undefined) filter.active = query.active;
    if (query.system_id) filter.systemId = query.system_id;
    if (query.date) {
      filter.planningHorizonStart = { $lte: query.date };
      filter.planningHorizonEnd = { $gte: query.date };
    }

    let rows = await this.schedules.find(filter).toArray();

    if (query.actor) {
      const actorNeedle = query.actor.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.actor || []).toLowerCase().includes(actorNeedle));
    }

    if (query._count) {
      rows = rows.slice(0, query._count);
    }

    const schedules: Schedule[] = [];
    for (const row of rows) {
      schedules.push(await this.toSchedule(row));
    }
    return schedules;
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    const row = await this.schedules.findOne({ id });
    return row ? this.toSchedule(row) : null;
  }

  async updateSchedule(id: string, schedule: Partial<Schedule>): Promise<Schedule> {
    const existing = await this.schedules.findOne({ id });
    if (!existing) throw new Error(`Schedule ${id} not found`);

    const merged: ScheduleDoc = {
      ...existing,
      active: schedule.active !== undefined ? schedule.active : existing.active,
      serviceCategory: schedule.serviceCategory !== undefined ? schedule.serviceCategory : existing.serviceCategory,
      serviceType: schedule.serviceType !== undefined ? schedule.serviceType : existing.serviceType,
      specialty: schedule.specialty !== undefined ? schedule.specialty : existing.specialty,
      actor: schedule.actor !== undefined ? schedule.actor : existing.actor,
      planningHorizonStart: schedule.planningHorizon?.start !== undefined ? schedule.planningHorizon.start : existing.planningHorizonStart,
      planningHorizonEnd: schedule.planningHorizon?.end !== undefined ? schedule.planningHorizon.end : existing.planningHorizonEnd,
      comment: schedule.comment !== undefined ? schedule.comment : existing.comment,
      metaLastUpdated: nowIso(),
    };

    await this.schedules.replaceOne({ id }, merged);
    return this.toSchedule(merged);
  }

  async deleteSchedule(id: string): Promise<void> {
    const slotDocs = await this.slots.find({ scheduleId: id }, { projection: { id: 1 } }).toArray();
    const slotIds = slotDocs.map((s) => s.id);

    if (slotIds.length > 0) {
      const slotRefs = slotIds.map((slotId) => `Slot/${slotId}`);
      await this.slotHolds.deleteMany({ slotId: { $in: slotIds } });
      await this.appointments.deleteMany({ slotRefs: { $elemMatch: { reference: { $in: slotRefs } } } });
      await this.slots.deleteMany({ scheduleId: id });
    }

    await this.schedules.deleteOne({ id });
  }

  async deleteAllSchedules(): Promise<void> {
    const scheduleDocs = await this.schedules.find({}, { projection: { id: 1 } }).toArray();
    const scheduleIds = scheduleDocs.map((s) => s.id);

    if (scheduleIds.length > 0) {
      const slotDocs = await this.slots.find({ scheduleId: { $in: scheduleIds } }, { projection: { id: 1 } }).toArray();
      const slotIds = slotDocs.map((s) => s.id);
      const slotRefs = slotIds.map((slotId) => `Slot/${slotId}`);

      if (slotIds.length > 0) {
        await this.slotHolds.deleteMany({ slotId: { $in: slotIds } });
        await this.appointments.deleteMany({ slotRefs: { $elemMatch: { reference: { $in: slotRefs } } } });
      }

      await this.slots.deleteMany({ scheduleId: { $in: scheduleIds } });
    }

    await this.schedules.deleteMany({});
  }

  async setAvailabilityTemplate(scheduleId: string, template: string | null): Promise<void> {
    if (template === null) {
      await this.schedules.updateOne({ id: scheduleId }, { $unset: { availabilityTemplate: '' }, $set: { metaLastUpdated: nowIso() } });
      return;
    }
    await this.schedules.updateOne({ id: scheduleId }, { $set: { availabilityTemplate: template, metaLastUpdated: nowIso() } });
  }

  async getAvailabilityTemplate(scheduleId: string): Promise<string | null> {
    const row = await this.schedules.findOne({ id: scheduleId }, { projection: { availabilityTemplate: 1 } });
    return row?.availabilityTemplate || null;
  }

  async getSlots(query: FhirSlotQuery): Promise<Slot[]> {
    const filter: Filter<SlotDoc> = {};

    if (query.schedule) {
      filter.scheduleId = this.extractId(query.schedule);
    }
    if (query.status) {
      filter.status = query.status as Slot['status'];
    }
    if (query.start) {
      filter.start = { $gte: query.start };
    }
    if (query.end) {
      filter.end = { $lte: query.end };
    }

    let cursor = this.slots.find(filter).sort({ start: 1 });
    if (query._count) cursor = cursor.limit(query._count);

    const rows = await cursor.toArray();
    return rows.map((r) => this.toSlot(r));
  }

  async getSlotById(id: string): Promise<Slot | null> {
    const row = await this.slots.findOne({ id });
    return row ? this.toSlot(row) : null;
  }

  async createSlot(slot: Slot): Promise<Slot> {
    const id = slot.id || this.generateId();
    const now = nowIso();

    const doc: OptionalUnlessRequiredId<SlotDoc> = {
      id,
      scheduleId: this.extractId(slot.schedule.reference),
      status: slot.status,
      start: slot.start,
      end: slot.end,
      serviceCategory: slot.serviceCategory,
      serviceType: slot.serviceType,
      specialty: slot.specialty,
      appointmentType: slot.appointmentType,
      overbooked: slot.overbooked,
      comment: slot.comment,
      metaLastUpdated: now,
    };

    await this.slots.insertOne(doc);
    return this.toSlot(doc as SlotDoc);
  }

  async createSlots(slots: Omit<Slot, 'id' | 'meta'>[]): Promise<{ count: number }> {
    const now = nowIso();
    const docs: SlotDoc[] = slots.map((slot) => ({
      id: this.generateId(),
      scheduleId: this.extractId(slot.schedule.reference),
      status: slot.status,
      start: slot.start,
      end: slot.end,
      serviceCategory: slot.serviceCategory,
      serviceType: slot.serviceType,
      specialty: slot.specialty,
      appointmentType: slot.appointmentType,
      overbooked: slot.overbooked,
      comment: slot.comment,
      metaLastUpdated: now,
    }));

    if (docs.length > 0) {
      await this.slots.insertMany(docs);
    }

    return { count: docs.length };
  }

  async updateSlot(id: string, slot: Partial<Slot>): Promise<Slot> {
    const existing = await this.slots.findOne({ id });
    if (!existing) throw new Error(`Slot ${id} not found`);

    const merged: SlotDoc = {
      ...existing,
      status: slot.status !== undefined ? slot.status : existing.status,
      start: slot.start !== undefined ? slot.start : existing.start,
      end: slot.end !== undefined ? slot.end : existing.end,
      serviceCategory: slot.serviceCategory !== undefined ? slot.serviceCategory : existing.serviceCategory,
      serviceType: slot.serviceType !== undefined ? slot.serviceType : existing.serviceType,
      specialty: slot.specialty !== undefined ? slot.specialty : existing.specialty,
      appointmentType: slot.appointmentType !== undefined ? slot.appointmentType : existing.appointmentType,
      overbooked: slot.overbooked !== undefined ? slot.overbooked : existing.overbooked,
      comment: slot.comment !== undefined ? slot.comment : existing.comment,
      metaLastUpdated: nowIso(),
    };

    await this.slots.replaceOne({ id }, merged);
    return this.toSlot(merged);
  }

  async deleteSlot(id: string): Promise<void> {
    await this.slotHolds.deleteMany({ slotId: id });
    await this.slots.deleteOne({ id });
  }

  async deleteAllSlots(): Promise<void> {
    await this.slotHolds.deleteMany({});
    await this.slots.deleteMany({});
  }

  async deleteSlotsBySchedule(scheduleId: string, statusFilter?: string): Promise<number> {
    const slotFilter: Filter<SlotDoc> = { scheduleId };
    if (statusFilter) {
      slotFilter.status = statusFilter as Slot['status'];
    }

    const slotDocs = await this.slots.find(slotFilter, { projection: { id: 1 } }).toArray();
    const slotIds = slotDocs.map((s) => s.id);

    if (slotIds.length > 0) {
      await this.slotHolds.deleteMany({ slotId: { $in: slotIds } });
    }

    const result = await this.slots.deleteMany(slotFilter);
    return result.deletedCount;
  }

  async getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]> {
    const filter: Filter<AppointmentDoc> = {};

    if (query.status) {
      filter.status = query.status as Appointment['status'];
    }

    if (query.date) {
      const startDate = query.date;
      const endDateObj = new Date(`${query.date}T00:00:00.000Z`);
      endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
      const endDate = endDateObj.toISOString().split('T')[0];
      filter.start = { $gte: startDate, $lt: endDate };
    }

    let cursor = this.appointments.find(filter).sort({ start: 1 });
    if (query._count) cursor = cursor.limit(query._count);

    let rows = await cursor.toArray();

    if (query.patient) {
      const needle = query.patient.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.participant || []).toLowerCase().includes(needle));
    }

    if (query.actor) {
      const needle = query.actor.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.participant || []).toLowerCase().includes(needle));
    }

    if (query.identifier) {
      const needle = query.identifier.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.identifier || []).toLowerCase().includes(needle));
    }

    return rows.map((r) => this.toAppointment(r));
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    const row = await this.appointments.findOne({ id });
    return row ? this.toAppointment(row) : null;
  }

  async getAppointmentByIdentifier(system: string, value: string): Promise<Appointment | null> {
    const row = await this.appointments.findOne({ identifier: { $elemMatch: { system, value } } });
    return row ? this.toAppointment(row) : null;
  }

  async createAppointment(appointment: Appointment): Promise<Appointment> {
    const id = appointment.id || this.generateId();
    const now = nowIso();

    const doc: OptionalUnlessRequiredId<AppointmentDoc> = {
      id,
      status: appointment.status,
      identifier: appointment.identifier,
      cancelationReason: appointment.cancelationReason,
      serviceCategory: appointment.serviceCategory,
      serviceType: appointment.serviceType,
      specialty: appointment.specialty,
      appointmentType: appointment.appointmentType,
      reasonCode: appointment.reasonCode,
      priority: appointment.priority,
      description: appointment.description,
      slotRefs: appointment.slot,
      start: appointment.start,
      end: appointment.end,
      created: appointment.created || now,
      comment: appointment.comment,
      patientInstruction: appointment.patientInstruction,
      participant: appointment.participant,
      metaLastUpdated: now,
    };

    await this.appointments.insertOne(doc);

    if (appointment.slot && appointment.slot.length > 0) {
      for (const slotRef of appointment.slot) {
        const slotId = this.extractId(slotRef.reference);
        await this.updateSlot(slotId, { status: 'busy' });
      }
    }

    return this.toAppointment(doc as AppointmentDoc);
  }

  async updateAppointment(id: string, appointment: Partial<Appointment>): Promise<Appointment> {
    const existing = await this.appointments.findOne({ id });
    if (!existing) throw new Error(`Appointment ${id} not found`);

    const merged: AppointmentDoc = {
      ...existing,
      status: appointment.status !== undefined ? appointment.status : existing.status,
      cancelationReason: appointment.cancelationReason !== undefined ? appointment.cancelationReason : existing.cancelationReason,
      description: appointment.description !== undefined ? appointment.description : existing.description,
      start: appointment.start !== undefined ? appointment.start : existing.start,
      end: appointment.end !== undefined ? appointment.end : existing.end,
      comment: appointment.comment !== undefined ? appointment.comment : existing.comment,
      participant: appointment.participant !== undefined ? appointment.participant : existing.participant,
      identifier: appointment.identifier !== undefined ? appointment.identifier : existing.identifier,
      metaLastUpdated: nowIso(),
    };

    await this.appointments.replaceOne({ id }, merged);
    return this.toAppointment(merged);
  }

  async deleteAppointment(id: string): Promise<void> {
    const appointment = await this.getAppointmentById(id);

    if (appointment?.slot) {
      for (const slotRef of appointment.slot) {
        const slotId = this.extractId(slotRef.reference);
        await this.updateSlot(slotId, { status: 'free' });
      }
    }

    await this.appointments.deleteOne({ id });
  }

  async deleteAllAppointments(): Promise<void> {
    await this.appointments.deleteMany({});
  }

  async holdSlot(slotId: string, sessionId: string, durationMinutes: number): Promise<SlotHold> {
    await this.cleanupExpiredHolds();

    const slot = await this.getSlotById(slotId);
    if (!slot) throw new Error(`Slot ${slotId} not found`);
    if (slot.status !== 'free') throw new Error(`Slot ${slotId} is not available`);

    const existingHold = await this.getActiveHold(slotId);
    if (existingHold) {
      if (existingHold.sessionId === sessionId) {
        const newExpiry = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        await this.slotHolds.updateOne({ id: existingHold.id }, { $set: { expiresAt: newExpiry } });
        return { ...existingHold, expiresAt: newExpiry };
      }
      throw new Error(`Slot ${slotId} is already held by another user`);
    }

    const id = this.generateId();
    const holdToken = `hold-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

    const hold: SlotHoldDoc = {
      id,
      slotId,
      holdToken,
      sessionId,
      createdAt,
      expiresAt,
    };

    await this.slotHolds.insertOne(hold);
    return this.toSlotHold(hold);
  }

  async releaseHold(holdToken: string): Promise<void> {
    await this.slotHolds.deleteOne({ holdToken });
  }

  async getActiveHold(slotId: string): Promise<SlotHold | null> {
    const hold = await this.slotHolds.findOne({ slotId, expiresAt: { $gt: nowIso() } });
    return hold ? this.toSlotHold(hold) : null;
  }

  async getHoldByToken(holdToken: string): Promise<SlotHold | null> {
    const hold = await this.slotHolds.findOne({ holdToken });
    return hold ? this.toSlotHold(hold) : null;
  }

  async cleanupExpiredHolds(): Promise<number> {
    const result = await this.slotHolds.deleteMany({ expiresAt: { $lte: nowIso() } });
    return result.deletedCount;
  }

  async clearAllHolds(): Promise<number> {
    const result = await this.slotHolds.deleteMany({});
    return result.deletedCount;
  }

  async logHL7Message(entry: Omit<HL7MessageLogEntry, 'id'>): Promise<HL7MessageLogEntry> {
    const id = this.generateId();
    const doc: HL7LogDoc = {
      id,
      receivedAt: entry.receivedAt,
      source: entry.source,
      remoteAddress: entry.remoteAddress,
      messageType: entry.messageType,
      triggerEvent: entry.triggerEvent,
      controlId: entry.controlId,
      rawMessage: entry.rawMessage,
      ackResponse: entry.ackResponse,
      ackCode: entry.ackCode,
      processingMs: entry.processingMs,
    };

    await this.hl7Logs.insertOne(doc);
    return this.toHL7Log(doc);
  }

  async getHL7MessageLog(query?: HL7MessageLogQuery): Promise<HL7MessageLogEntry[]> {
    const filter: Filter<HL7LogDoc> = {};
    if (query?.source) filter.source = query.source;
    if (query?.messageType) filter.messageType = query.messageType;
    if (query?.ackCode) filter.ackCode = query.ackCode;
    if (query?.since) filter.receivedAt = { $gte: query.since };

    const limit = query?._count ?? 100;
    const rows = await this.hl7Logs.find(filter).sort({ receivedAt: -1 }).limit(limit).toArray();
    return rows.map((r) => this.toHL7Log(r));
  }

  async cleanupHL7MessageLog(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = await this.hl7Logs.deleteMany({ receivedAt: { $lt: cutoff.toISOString() } });
    return result.deletedCount;
  }
}
