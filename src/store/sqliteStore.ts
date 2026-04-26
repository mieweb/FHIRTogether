import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
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

/** A row returned from better-sqlite3 queries — values are SQLite primitives */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** SQL parameter values for parameterized queries */
type SqlParam = string | number | boolean | null | undefined;

/**
 * Format a Date as a naive ISO 8601 string without timezone suffix.
 * e.g. "2026-02-17T08:00:00"
 *
 * Stored datetimes are treated as local wall-clock time.
 * This avoids timezone conversion issues — 8:00 AM means 8:00 AM
 * regardless of the server or client timezone.
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
 * Bump this version whenever the schema changes.
 * The store will compare it against the version stored in the database
 * and report a mismatch so the server can warn or rebuild.
 */
export const SCHEMA_VERSION = 4;

export interface SchemaStatus {
  current: number;
  expected: number;
  match: boolean;
  migrated: boolean;
}

export class SqliteStore implements FhirStore {
  private db: Database.Database;
  private dataDir: string;
  private seedMetadataPath: string;

  constructor(dbPath?: string) {
    const finalPath = dbPath || process.env.SQLITE_DB_PATH || './data/fhirtogether.db';
    
    // Ensure directory exists
    this.dataDir = path.dirname(finalPath);
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Seed metadata file path (committable to git)
    this.seedMetadataPath = path.join(this.dataDir, 'seed-metadata.json');

    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
  }

  async initialize(): Promise<SchemaStatus> {
    // Meta table for tracking schema version
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Read the stored schema version (0 = brand new database)
    const row = this.db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
    const dbVersion = row ? parseInt(row.value, 10) : 0;

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL DEFAULT 'Schedule',
        active INTEGER DEFAULT 1,
        service_category TEXT,
        service_type TEXT,
        specialty TEXT,
        actor TEXT NOT NULL,
        planning_horizon_start TEXT,
        planning_horizon_end TEXT,
        comment TEXT,
        meta_last_updated TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL DEFAULT 'Slot',
        schedule_id TEXT NOT NULL,
        status TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        service_category TEXT,
        service_type TEXT,
        specialty TEXT,
        appointment_type TEXT,
        overbooked INTEGER DEFAULT 0,
        comment TEXT,
        meta_last_updated TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL DEFAULT 'Appointment',
        status TEXT NOT NULL,
        cancelation_reason TEXT,
        service_category TEXT,
        service_type TEXT,
        specialty TEXT,
        appointment_type TEXT,
        reason_code TEXT,
        priority INTEGER,
        description TEXT,
        slot_refs TEXT,
        start TEXT,
        end TEXT,
        created TEXT,
        comment TEXT,
        patient_instruction TEXT,
        participant TEXT NOT NULL,
        identifier TEXT,
        meta_last_updated TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_slots_schedule ON slots(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start);
      CREATE INDEX IF NOT EXISTS idx_slots_status ON slots(status);
      CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

      CREATE TABLE IF NOT EXISTS slot_holds (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL,
        hold_token TEXT UNIQUE NOT NULL,
        session_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_slot_holds_slot ON slot_holds(slot_id);
      CREATE INDEX IF NOT EXISTS idx_slot_holds_expires ON slot_holds(expires_at);
      CREATE INDEX IF NOT EXISTS idx_slot_holds_token ON slot_holds(hold_token);

      CREATE TABLE IF NOT EXISTS hl7_message_log (
        id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        source TEXT NOT NULL,
        remote_address TEXT,
        message_type TEXT,
        trigger_event TEXT,
        control_id TEXT,
        raw_message TEXT NOT NULL,
        ack_response TEXT,
        ack_code TEXT,
        processing_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_hl7_log_received ON hl7_message_log(received_at);
      CREATE INDEX IF NOT EXISTS idx_hl7_log_source ON hl7_message_log(source);
      CREATE INDEX IF NOT EXISTS idx_hl7_log_type ON hl7_message_log(message_type);

      CREATE TABLE IF NOT EXISTS systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT,
        api_key_hash TEXT,
        msh_application TEXT,
        msh_facility TEXT,
        msh_secret_hash TEXT,
        challenge_token TEXT,
        status TEXT NOT NULL DEFAULT 'unverified',
        last_activity_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ttl_days INTEGER NOT NULL DEFAULT 7,
        UNIQUE(msh_application, msh_facility)
      );

      CREATE INDEX IF NOT EXISTS idx_systems_status ON systems(status);
      CREATE INDEX IF NOT EXISTS idx_systems_url ON systems(url);
      CREATE INDEX IF NOT EXISTS idx_systems_msh ON systems(msh_application, msh_facility);
      CREATE INDEX IF NOT EXISTS idx_systems_api_key_hash ON systems(api_key_hash);

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        system_id TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        phone TEXT,
        hl7_location_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_locations_system ON locations(system_id);
      CREATE INDEX IF NOT EXISTS idx_locations_hl7 ON locations(system_id, hl7_location_id);
    `);

    // Migration: add identifier column if missing (existing databases)
    const cols = this.db.pragma('table_info(appointments)') as { name: string }[];
    if (!cols.some(c => c.name === 'identifier')) {
      this.db.exec('ALTER TABLE appointments ADD COLUMN identifier TEXT');
    }

    // Ensure identifier index exists (covers both fresh and migrated databases)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_identifier ON appointments(identifier)');

    // Migration v2→v3: add system_id and location_id to schedules
    const scheduleCols = this.db.pragma('table_info(schedules)') as { name: string }[];
    if (!scheduleCols.some(c => c.name === 'system_id')) {
      this.db.exec('ALTER TABLE schedules ADD COLUMN system_id TEXT REFERENCES systems(id) ON DELETE CASCADE');
      this.db.exec('ALTER TABLE schedules ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_system ON schedules(system_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_location ON schedules(location_id)');

      // If there are existing schedules, create a "legacy" system and assign them
      const existingCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM schedules').get() as { cnt: number }).cnt;
      if (existingCount > 0) {
        const now = toNaiveISO(new Date());
        const legacyId = `legacy-${Date.now()}`;
        this.db.prepare(`
          INSERT INTO systems (id, name, status, last_activity_at, created_at, ttl_days)
          VALUES (?, ?, 'active', ?, ?, 9999)
        `).run(legacyId, 'Legacy System', now, now);
        this.db.prepare('UPDATE schedules SET system_id = ? WHERE system_id IS NULL').run(legacyId);
        console.log(`\n🔄 Migration v2→v3: Created "Legacy System" (${legacyId}) for ${existingCount} existing schedules\n`);
      }
    }

    // Stamp the schema version after all migrations succeed
    const migrated = dbVersion !== SCHEMA_VERSION;
    this.db.prepare(
      'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('schema_version', String(SCHEMA_VERSION));

    return {
      current: dbVersion,
      expected: SCHEMA_VERSION,
      match: dbVersion === SCHEMA_VERSION || dbVersion === 0, // 0 = fresh DB, always fine
      migrated,
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ==================== DATE OFFSET FOR CONSISTENT TEST DATA ====================

  /**
   * Get the generation date from seed metadata file
   * This file is committed to git so all environments use the same date offset
   */
  getGenerationDate(): string | null {
    try {
      if (fs.existsSync(this.seedMetadataPath)) {
        const data = JSON.parse(fs.readFileSync(this.seedMetadataPath, 'utf-8'));
        return data.generationDate || null;
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  /**
   * Set the generation date in seed metadata file
   * This file should be committed to git
   */
  setGenerationDate(date: string): void {
    const metadata = {
      generationDate: date,
      description: 'Seed data generation metadata - commit this file to git',
      note: 'Dates in slots/appointments are shifted by (today - generationDate) days',
    };
    fs.writeFileSync(this.seedMetadataPath, JSON.stringify(metadata, null, 2) + '\n');
  }

  /**
   * Calculate the number of days to shift dates from generation to today
   */
  getDateOffsetDays(): number {
    const generationDate = this.getGenerationDate();
    if (!generationDate) return 0;
    
    const genDate = new Date(generationDate);
    const today = new Date();
    
    // Reset time to start of day for accurate day calculation
    genDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const diffMs = today.getTime() - genDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // ==================== SYNAPSE SYSTEM OPERATIONS ====================

  async createSystem(system: Omit<SynapseSystem, 'id' | 'createdAt' | 'lastActivityAt'> & { apiKeyHash?: string; mshSecretHash?: string; challengeToken?: string }): Promise<SynapseSystem> {
    const id = this.generateId();
    const now = toNaiveISO(new Date());

    this.db.prepare(`
      INSERT INTO systems (id, name, url, api_key_hash, msh_application, msh_facility, msh_secret_hash, challenge_token, status, last_activity_at, created_at, ttl_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      system.name,
      system.url || null,
      system.apiKeyHash || null,
      system.mshApplication || null,
      system.mshFacility || null,
      system.mshSecretHash || null,
      system.challengeToken || null,
      system.status,
      now,
      now,
      system.ttlDays,
    );

    return { id, name: system.name, url: system.url, mshApplication: system.mshApplication, mshFacility: system.mshFacility, status: system.status, lastActivityAt: now, createdAt: now, ttlDays: system.ttlDays };
  }

  async findOrCreateSystemByMSH(application: string, facility: string, secret: string): Promise<MSHLookupResult> {
    const existing = await this.getSystemByMsh(application, facility);

    if (existing) {
      // Verify secret matches
      const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
      const row = this.db.prepare('SELECT msh_secret_hash FROM systems WHERE id = ?').get(existing.id) as { msh_secret_hash: string } | undefined;
      const storedHash = row?.msh_secret_hash;

      if (!storedHash) {
        // First time setting a secret for this system (e.g., legacy system)
        this.db.prepare('UPDATE systems SET msh_secret_hash = ? WHERE id = ?').run(secretHash, existing.id);
        await this.updateSystemActivity(existing.id);
        // Issue a fresh API key on every successful HL7 auth (MSH-8 verified)
        const apiKey = this.issueApiKey(existing.id);
        return { system: existing, isNew: false, secretMatch: true, apiKey };
      }

      const match = crypto.timingSafeEqual(Buffer.from(secretHash), Buffer.from(storedHash));
      if (match) {
        await this.updateSystemActivity(existing.id);
        // Issue a fresh API key on every successful HL7 auth (MSH-8 verified)
        const apiKey = this.issueApiKey(existing.id);
        return { system: existing, isNew: false, secretMatch: match, apiKey };
      }
      return { system: existing, isNew: false, secretMatch: match };
    }

    // Create new system — generate API key at creation time
    const secretHash = secret ? crypto.createHash('sha256').update(secret).digest('hex') : undefined;
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const defaultTtl = parseInt(process.env.SYSTEM_TTL_DAYS || '7', 10);
    const system = await this.createSystem({
      name: `${application}@${facility}`,
      status: 'unverified' as SystemStatus,
      ttlDays: defaultTtl,
      mshApplication: application,
      mshFacility: facility,
      mshSecretHash: secretHash,
      apiKeyHash,
    });

    return { system, isNew: true, secretMatch: true, apiKey };
  }

  /**
   * Generate a new API key for a system and store the hash.
   * Returns the raw key (only time it's available in plaintext).
   */
  private issueApiKey(systemId: string): string {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    this.db.prepare('UPDATE systems SET api_key_hash = ? WHERE id = ?').run(hash, systemId);
    return apiKey;
  }

  async getSystemById(id: string): Promise<SynapseSystem | undefined> {
    const row = this.db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as DbRow | undefined;
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystemByUrl(url: string): Promise<SynapseSystem | undefined> {
    const row = this.db.prepare('SELECT * FROM systems WHERE url = ?').get(url) as DbRow | undefined;
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystemByMsh(application: string, facility: string): Promise<SynapseSystem | undefined> {
    const row = this.db.prepare('SELECT * FROM systems WHERE msh_application = ? AND msh_facility = ?').get(application, facility) as DbRow | undefined;
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystemByApiKeyHash(hash: string): Promise<SynapseSystem | undefined> {
    const row = this.db.prepare('SELECT * FROM systems WHERE api_key_hash = ?').get(hash) as DbRow | undefined;
    return row ? this.rowToSystem(row) : undefined;
  }

  async getSystems(query?: SynapseSystemQuery): Promise<SynapseSystem[]> {
    let sql = 'SELECT * FROM systems WHERE 1=1';
    const params: SqlParam[] = [];

    if (query?.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    sql += ' ORDER BY name ASC';

    if (query?._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as DbRow[];
    return rows.map(row => this.rowToSystem(row));
  }

  async updateSystem(id: string, updates: Partial<Pick<SynapseSystem, 'name' | 'url' | 'status' | 'ttlDays'>> & { apiKeyHash?: string; challengeToken?: string }): Promise<SynapseSystem> {
    const existing = await this.getSystemById(id);
    if (!existing) throw new Error(`System ${id} not found`);

    const setClauses: string[] = [];
    const params: SqlParam[] = [];

    if (updates.name !== undefined) { setClauses.push('name = ?'); params.push(updates.name); }
    if (updates.url !== undefined) { setClauses.push('url = ?'); params.push(updates.url); }
    if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
    if (updates.ttlDays !== undefined) { setClauses.push('ttl_days = ?'); params.push(updates.ttlDays); }
    if (updates.apiKeyHash !== undefined) { setClauses.push('api_key_hash = ?'); params.push(updates.apiKeyHash); }
    if (updates.challengeToken !== undefined) { setClauses.push('challenge_token = ?'); params.push(updates.challengeToken); }

    if (setClauses.length === 0) return existing;

    params.push(id);
    this.db.prepare(`UPDATE systems SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    return (await this.getSystemById(id))!;
  }

  async updateSystemActivity(id: string): Promise<void> {
    const now = toNaiveISO(new Date());
    this.db.prepare('UPDATE systems SET last_activity_at = ? WHERE id = ?').run(now, id);
  }

  async deleteSystem(id: string): Promise<void> {
    this.db.prepare('DELETE FROM systems WHERE id = ?').run(id);
  }

  async getSystemChallengeToken(id: string): Promise<string | undefined> {
    const row = this.db.prepare('SELECT challenge_token FROM systems WHERE id = ?').get(id) as { challenge_token: string | null } | undefined;
    return row?.challenge_token || undefined;
  }

  async evaporateExpiredSystems(): Promise<{ count: number; systems: Array<{ id: string; name: string; mshApplication?: string; mshFacility?: string }> }> {
    // Find expired systems: last_activity_at + ttl_days < now
    const rows = this.db.prepare(`
      SELECT id, name, msh_application, msh_facility FROM systems
      WHERE status != 'expired'
        AND datetime(last_activity_at, '+' || ttl_days || ' days') < datetime('now', 'localtime')
    `).all() as Array<{ id: string; name: string; msh_application: string | null; msh_facility: string | null }>;

    for (const row of rows) {
      // Cascade delete handles locations → schedules → slots → appointments
      this.db.prepare('DELETE FROM systems WHERE id = ?').run(row.id);
    }

    return {
      count: rows.length,
      systems: rows.map(r => ({ id: r.id, name: r.name, mshApplication: r.msh_application || undefined, mshFacility: r.msh_facility || undefined })),
    };
  }

  // ==================== SYNAPSE LOCATION OPERATIONS ====================

  async createLocation(location: Omit<SynapseLocation, 'id' | 'createdAt'>): Promise<SynapseLocation> {
    const id = this.generateId();
    const now = toNaiveISO(new Date());

    this.db.prepare(`
      INSERT INTO locations (id, system_id, name, address, city, state, zip, phone, hl7_location_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      location.systemId,
      location.name,
      location.address || null,
      location.city || null,
      location.state || null,
      location.zip || null,
      location.phone || null,
      location.hl7LocationId || null,
      now,
    );

    return { ...location, id, createdAt: now };
  }

  async findOrCreateLocationByHL7(systemId: string, hl7LocationId: string, name: string, address?: string): Promise<SynapseLocation> {
    // Look up by system + HL7 location ID
    const existing = this.db.prepare(
      'SELECT * FROM locations WHERE system_id = ? AND hl7_location_id = ?'
    ).get(systemId, hl7LocationId) as DbRow | undefined;

    if (existing) return this.rowToLocation(existing);

    return this.createLocation({
      systemId,
      name,
      hl7LocationId,
      address,
    });
  }

  async getLocations(query?: SynapseLocationQuery): Promise<SynapseLocation[]> {
    let sql = 'SELECT * FROM locations WHERE 1=1';
    const params: SqlParam[] = [];

    if (query?.systemId) {
      sql += ' AND system_id = ?';
      params.push(query.systemId);
    }

    if (query?.zip) {
      sql += ' AND zip = ?';
      params.push(query.zip);
    }

    sql += ' ORDER BY name ASC';

    if (query?._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as DbRow[];
    return rows.map(row => this.rowToLocation(row));
  }

  async getLocationById(id: string): Promise<SynapseLocation | undefined> {
    const row = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as DbRow | undefined;
    return row ? this.rowToLocation(row) : undefined;
  }

  async updateLocation(id: string, updates: Partial<Omit<SynapseLocation, 'id' | 'systemId' | 'createdAt'>>): Promise<SynapseLocation> {
    const existing = await this.getLocationById(id);
    if (!existing) throw new Error(`Location ${id} not found`);

    const setClauses: string[] = [];
    const params: SqlParam[] = [];

    if (updates.name !== undefined) { setClauses.push('name = ?'); params.push(updates.name); }
    if (updates.address !== undefined) { setClauses.push('address = ?'); params.push(updates.address); }
    if (updates.city !== undefined) { setClauses.push('city = ?'); params.push(updates.city); }
    if (updates.state !== undefined) { setClauses.push('state = ?'); params.push(updates.state); }
    if (updates.zip !== undefined) { setClauses.push('zip = ?'); params.push(updates.zip); }
    if (updates.phone !== undefined) { setClauses.push('phone = ?'); params.push(updates.phone); }

    if (setClauses.length === 0) return existing;

    params.push(id);
    this.db.prepare(`UPDATE locations SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    return (await this.getLocationById(id))!;
  }

  async deleteLocation(id: string): Promise<void> {
    this.db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  }

  // ==================== SCHEDULE OPERATIONS ====================

  async createSchedule(schedule: Schedule & { system_id?: string; location_id?: string }): Promise<Schedule> {
    const id = schedule.id || this.generateId();
    const now = toNaiveISO(new Date());

    const stmt = this.db.prepare(`
      INSERT INTO schedules (
        id, active, service_category, service_type, specialty, actor,
        planning_horizon_start, planning_horizon_end, comment, meta_last_updated,
        system_id, location_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      schedule.active ? 1 : 0,
      JSON.stringify(schedule.serviceCategory || []),
      JSON.stringify(schedule.serviceType || []),
      JSON.stringify(schedule.specialty || []),
      JSON.stringify(schedule.actor),
      schedule.planningHorizon?.start,
      schedule.planningHorizon?.end,
      schedule.comment,
      now,
      schedule.system_id || null,
      schedule.location_id || null,
    );

    return { ...schedule, id, meta: { lastUpdated: now } };
  }

  async getSchedules(query: FhirScheduleQuery & { system_id?: string }): Promise<Schedule[]> {
    let sql = 'SELECT s.*, sys.name AS system_name FROM schedules s LEFT JOIN systems sys ON s.system_id = sys.id WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.active !== undefined) {
      sql += ' AND s.active = ?';
      params.push(query.active ? 1 : 0);
    }

    if (query.actor) {
      sql += ' AND s.actor LIKE ?';
      params.push(`%${query.actor}%`);
    }

    if (query.date) {
      sql += ' AND (s.planning_horizon_start <= ? AND s.planning_horizon_end >= ?)';
      params.push(query.date, query.date);
    }

    if (query.system_id) {
      sql += ' AND s.system_id = ?';
      params.push(query.system_id);
    }

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as DbRow[];
    return rows.map((row) => this.rowToSchedule(row));
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as DbRow | undefined;
    return row ? this.rowToSchedule(row) : null;
  }

  async updateSchedule(id: string, schedule: Partial<Schedule>): Promise<Schedule> {
    const existing = await this.getScheduleById(id);
    if (!existing) throw new Error(`Schedule ${id} not found`);

    const updated = { ...existing, ...schedule, id };
    const now = toNaiveISO(new Date());

    const stmt = this.db.prepare(`
      UPDATE schedules SET
        active = ?, service_category = ?, service_type = ?, specialty = ?,
        actor = ?, planning_horizon_start = ?, planning_horizon_end = ?,
        comment = ?, meta_last_updated = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.active ? 1 : 0,
      JSON.stringify(updated.serviceCategory || []),
      JSON.stringify(updated.serviceType || []),
      JSON.stringify(updated.specialty || []),
      JSON.stringify(updated.actor),
      updated.planningHorizon?.start,
      updated.planningHorizon?.end,
      updated.comment,
      now,
      id
    );

    return { ...updated, meta: { lastUpdated: now } };
  }

  async deleteSchedule(id: string): Promise<void> {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  async deleteAllSchedules(): Promise<void> {
    this.db.prepare('DELETE FROM schedules').run();
  }

  /**
   * Import a raw schedule row from seed data (bypasses normal creation logic)
   */
  async importScheduleRow(row: DbRow): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO schedules (
        id, active, service_category, service_type, specialty, actor,
        planning_horizon_start, planning_horizon_end, comment, meta_last_updated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      row.id,
      row.active,
      row.service_category,
      row.service_type,
      row.specialty,
      row.actor,
      row.planning_horizon_start,
      row.planning_horizon_end,
      row.comment,
      row.meta_last_updated,
      row.created_at
    );
  }

  // ==================== SLOT OPERATIONS ====================

  async createSlot(slot: Slot): Promise<Slot> {
    const id = slot.id || this.generateId();
    const now = toNaiveISO(new Date());

    const stmt = this.db.prepare(`
      INSERT INTO slots (
        id, schedule_id, status, start, end, service_category, service_type,
        specialty, appointment_type, overbooked, comment, meta_last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const scheduleId = this.extractId(slot.schedule.reference);

    stmt.run(
      id,
      scheduleId,
      slot.status,
      slot.start,
      slot.end,
      JSON.stringify(slot.serviceCategory || []),
      JSON.stringify(slot.serviceType || []),
      JSON.stringify(slot.specialty || []),
      JSON.stringify(slot.appointmentType),
      slot.overbooked ? 1 : 0,
      slot.comment,
      now
    );

    return { ...slot, id, meta: { lastUpdated: now } };
  }

  async getSlots(query: FhirSlotQuery): Promise<Slot[]> {
    let sql = 'SELECT * FROM slots WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.schedule) {
      const scheduleId = this.extractId(query.schedule);
      sql += ' AND schedule_id = ?';
      params.push(scheduleId);
    }

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.start) {
      sql += ' AND start >= ?';
      params.push(query.start);
    }

    if (query.end) {
      sql += ' AND end <= ?';
      params.push(query.end);
    }

    sql += ' ORDER BY start ASC';

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as DbRow[];
    return rows.map((row) => this.rowToSlot(row));
  }

  async getSlotById(id: string): Promise<Slot | null> {
    const row = this.db.prepare('SELECT * FROM slots WHERE id = ?').get(id) as DbRow | undefined;
    return row ? this.rowToSlot(row) : null;
  }

  async updateSlot(id: string, slot: Partial<Slot>): Promise<Slot> {
    const existing = await this.getSlotById(id);
    if (!existing) throw new Error(`Slot ${id} not found`);

    const updated = { ...existing, ...slot, id };
    const now = toNaiveISO(new Date());

    const stmt = this.db.prepare(`
      UPDATE slots SET
        status = ?, start = ?, end = ?, service_category = ?, service_type = ?,
        specialty = ?, appointment_type = ?, overbooked = ?, comment = ?,
        meta_last_updated = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.status,
      updated.start,
      updated.end,
      JSON.stringify(updated.serviceCategory || []),
      JSON.stringify(updated.serviceType || []),
      JSON.stringify(updated.specialty || []),
      JSON.stringify(updated.appointmentType),
      updated.overbooked ? 1 : 0,
      updated.comment,
      now,
      id
    );

    return { ...updated, meta: { lastUpdated: now } };
  }

  async deleteSlot(id: string): Promise<void> {
    this.db.prepare('DELETE FROM slots WHERE id = ?').run(id);
  }

  async deleteAllSlots(): Promise<void> {
    this.db.prepare('DELETE FROM slots').run();
  }

  /**
   * Import a raw slot row from seed data (bypasses normal creation logic)
   */
  async importSlotRow(row: DbRow): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO slots (
        id, schedule_id, status, start, end, service_category, service_type,
        specialty, appointment_type, overbooked, comment, meta_last_updated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      row.id,
      row.schedule_id,
      row.status,
      row.start,
      row.end,
      row.service_category,
      row.service_type,
      row.specialty,
      row.appointment_type,
      row.overbooked,
      row.comment,
      row.meta_last_updated,
      row.created_at
    );
  }

  // ==================== APPOINTMENT OPERATIONS ====================

  async createAppointment(appointment: Appointment): Promise<Appointment> {
    const id = appointment.id || this.generateId();
    const now = toNaiveISO(new Date());

    const stmt = this.db.prepare(`
      INSERT INTO appointments (
        id, status, cancelation_reason, service_category, service_type,
        specialty, appointment_type, reason_code, priority, description,
        slot_refs, start, end, created, comment, patient_instruction,
        participant, identifier, meta_last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      appointment.status,
      JSON.stringify(appointment.cancelationReason),
      JSON.stringify(appointment.serviceCategory || []),
      JSON.stringify(appointment.serviceType || []),
      JSON.stringify(appointment.specialty || []),
      JSON.stringify(appointment.appointmentType),
      JSON.stringify(appointment.reasonCode || []),
      appointment.priority,
      appointment.description,
      JSON.stringify(appointment.slot || []),
      appointment.start,
      appointment.end,
      appointment.created || now,
      appointment.comment,
      appointment.patientInstruction,
      JSON.stringify(appointment.participant),
      JSON.stringify(appointment.identifier || null),
      now
    );

    // Update slot status to busy
    if (appointment.slot && appointment.slot.length > 0) {
      for (const slotRef of appointment.slot) {
        const slotId = this.extractId(slotRef.reference);
        await this.updateSlot(slotId, { status: 'busy' });
      }
    }

    return { ...appointment, id, meta: { lastUpdated: now } };
  }

  async getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]> {
    let sql = 'SELECT * FROM appointments WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.date) {
      sql += ' AND start >= ? AND start < ?';
      const startDate = query.date;
      const endDate = new Date(query.date + 'T00:00:00');
      endDate.setDate(endDate.getDate() + 1);
      params.push(startDate, endDate.toISOString().split('T')[0]);
    }

    if (query.patient) {
      sql += ' AND participant LIKE ?';
      params.push(`%${query.patient}%`);
    }

    if (query.actor) {
      // Filter by any participant actor reference (provider, patient, etc.)
      sql += ' AND participant LIKE ?';
      params.push(`%${query.actor}%`);
    }

    if (query.identifier) {
      sql += ' AND identifier LIKE ?';
      params.push(`%${query.identifier}%`);
    }

    sql += ' ORDER BY start ASC';

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as DbRow[];
    return rows.map((row) => this.rowToAppointment(row));
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    const row = this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as DbRow | undefined;
    return row ? this.rowToAppointment(row) : null;
  }

  async updateAppointment(id: string, appointment: Partial<Appointment>): Promise<Appointment> {
    const existing = await this.getAppointmentById(id);
    if (!existing) throw new Error(`Appointment ${id} not found`);

    const updated = { ...existing, ...appointment, id };
    const now = toNaiveISO(new Date());

    const stmt = this.db.prepare(`
      UPDATE appointments SET
        status = ?, cancelation_reason = ?, description = ?, start = ?,
        end = ?, comment = ?, participant = ?, identifier = ?,
        meta_last_updated = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.status,
      JSON.stringify(updated.cancelationReason),
      updated.description,
      updated.start,
      updated.end,
      updated.comment,
      JSON.stringify(updated.participant),
      JSON.stringify(updated.identifier || null),
      now,
      id
    );

    return { ...updated, meta: { lastUpdated: now } };
  }

  async deleteAppointment(id: string): Promise<void> {
    const appointment = await this.getAppointmentById(id);
    
    // Free up slots
    if (appointment?.slot) {
      for (const slotRef of appointment.slot) {
        const slotId = this.extractId(slotRef.reference);
        await this.updateSlot(slotId, { status: 'free' });
      }
    }

    this.db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  }

  async deleteAllAppointments(): Promise<void> {
    this.db.prepare('DELETE FROM appointments').run();
  }

  /**
   * Import a raw appointment row from seed data (bypasses normal creation logic)
   */
  async importAppointmentRow(row: DbRow): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO appointments (
        id, status, cancelation_reason, service_category, service_type,
        specialty, appointment_type, reason_code, priority, description,
        slot_refs, start, end, created, comment, patient_instruction,
        participant, meta_last_updated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      row.id,
      row.status,
      row.cancelation_reason,
      row.service_category,
      row.service_type,
      row.specialty,
      row.appointment_type,
      row.reason_code,
      row.priority,
      row.description,
      row.slot_refs,
      row.start,
      row.end,
      row.created,
      row.comment,
      row.patient_instruction,
      row.participant,
      row.meta_last_updated,
      row.created_at
    );
  }

  // ==================== SLOT HOLD OPERATIONS ====================

  async holdSlot(slotId: string, sessionId: string, durationMinutes: number): Promise<SlotHold> {
    // First, clean up expired holds
    await this.cleanupExpiredHolds();

    // Check if slot exists and is free
    const slot = await this.getSlotById(slotId);
    if (!slot) {
      throw new Error(`Slot ${slotId} not found`);
    }
    if (slot.status !== 'free') {
      throw new Error(`Slot ${slotId} is not available`);
    }

    // Check if there's already an active hold on this slot
    const existingHold = await this.getActiveHold(slotId);
    if (existingHold) {
      // If the hold is from the same session, extend it
      if (existingHold.sessionId === sessionId) {
        const newExpiry = toNaiveISO(new Date(Date.now() + durationMinutes * 60 * 1000));
        this.db.prepare('UPDATE slot_holds SET expires_at = ? WHERE id = ?').run(newExpiry, existingHold.id);
        return { ...existingHold, expiresAt: newExpiry };
      }
      throw new Error(`Slot ${slotId} is already held by another user`);
    }

    // Create new hold
    const id = this.generateId();
    const holdToken = `hold-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = toNaiveISO(new Date());
    const expiresAt = toNaiveISO(new Date(Date.now() + durationMinutes * 60 * 1000));

    const stmt = this.db.prepare(`
      INSERT INTO slot_holds (id, slot_id, hold_token, session_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, slotId, holdToken, sessionId, expiresAt, now);

    return {
      id,
      slotId,
      holdToken,
      sessionId,
      expiresAt,
      createdAt: now,
    };
  }

  async releaseHold(holdToken: string): Promise<void> {
    this.db.prepare('DELETE FROM slot_holds WHERE hold_token = ?').run(holdToken);
  }

  async getActiveHold(slotId: string): Promise<SlotHold | null> {
    const now = toNaiveISO(new Date());
    const row = this.db.prepare(
      'SELECT * FROM slot_holds WHERE slot_id = ? AND expires_at > ?'
    ).get(slotId, now) as DbRow | undefined;

    return row ? this.rowToSlotHold(row) : null;
  }

  async getHoldByToken(holdToken: string): Promise<SlotHold | null> {
    const row = this.db.prepare(
      'SELECT * FROM slot_holds WHERE hold_token = ?'
    ).get(holdToken) as DbRow | undefined;

    return row ? this.rowToSlotHold(row) : null;
  }

  async cleanupExpiredHolds(): Promise<number> {
    const now = toNaiveISO(new Date());
    const result = this.db.prepare('DELETE FROM slot_holds WHERE expires_at <= ?').run(now);
    return result.changes;
  }

  // ==================== HL7 MESSAGE LOG OPERATIONS ====================

  async logHL7Message(entry: Omit<HL7MessageLogEntry, 'id'>): Promise<HL7MessageLogEntry> {
    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO hl7_message_log (id, received_at, source, remote_address, message_type, trigger_event, control_id, raw_message, ack_response, ack_code, processing_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.receivedAt,
      entry.source,
      entry.remoteAddress || null,
      entry.messageType || null,
      entry.triggerEvent || null,
      entry.controlId || null,
      entry.rawMessage,
      entry.ackResponse || null,
      entry.ackCode || null,
      entry.processingMs ?? null,
    );
    return { id, ...entry };
  }

  async getHL7MessageLog(query?: HL7MessageLogQuery): Promise<HL7MessageLogEntry[]> {
    const conditions: string[] = [];
    const params: SqlParam[] = [];

    if (query?.source) {
      conditions.push('source = ?');
      params.push(query.source);
    }
    if (query?.messageType) {
      conditions.push('message_type = ?');
      params.push(query.messageType);
    }
    if (query?.ackCode) {
      conditions.push('ack_code = ?');
      params.push(query.ackCode);
    }
    if (query?.since) {
      conditions.push('received_at >= ?');
      params.push(query.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query?._count ?? 100;

    const rows = this.db.prepare(
      `SELECT * FROM hl7_message_log ${where} ORDER BY received_at DESC LIMIT ?`
    ).all(...params, limit) as DbRow[];

    return rows.map(row => this.rowToHL7LogEntry(row));
  }

  async cleanupHL7MessageLog(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = toNaiveISO(cutoff);
    const result = this.db.prepare('DELETE FROM hl7_message_log WHERE received_at < ?').run(cutoffStr);
    return result.changes;
  }

  // ==================== HELPER METHODS ====================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractId(reference: string): string {
    return reference.split('/').pop() || reference;
  }

  private rowToSchedule(row: DbRow): Schedule {
    const schedule: Schedule = {
      resourceType: 'Schedule',
      id: row.id,
      active: row.active === 1,
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      actor: this.parseJson(row.actor),
      planningHorizon: row.planning_horizon_start ? {
        start: row.planning_horizon_start,
        end: row.planning_horizon_end,
      } : undefined,
      comment: row.comment,
      meta: { lastUpdated: row.meta_last_updated },
    };

    // Include system name as a FHIR extension when available
    if (row.system_name) {
      (schedule as Schedule & { extension?: unknown[] }).extension = [{
        url: 'https://fhirtogether.org/fhir/StructureDefinition/system-name',
        valueString: row.system_name,
      }];
    }

    return schedule;
  }

  private rowToSlot(row: DbRow): Slot {
    return {
      resourceType: 'Slot',
      id: row.id,
      schedule: { reference: `Schedule/${row.schedule_id}` },
      status: row.status,
      start: row.start,
      end: row.end,
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      appointmentType: this.parseJson(row.appointment_type),
      overbooked: row.overbooked === 1,
      comment: row.comment,
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToAppointment(row: DbRow): Appointment {
    return {
      resourceType: 'Appointment',
      id: row.id,
      status: row.status,
      cancelationReason: this.parseJson(row.cancelation_reason),
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      appointmentType: this.parseJson(row.appointment_type),
      reasonCode: this.parseJson(row.reason_code),
      priority: row.priority,
      description: row.description,
      slot: this.parseJson(row.slot_refs),
      start: row.start,
      end: row.end,
      created: row.created,
      comment: row.comment,
      patientInstruction: row.patient_instruction,
      participant: this.parseJson(row.participant),
      identifier: this.parseJson(row.identifier),
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToSlotHold(row: DbRow): SlotHold {
    return {
      id: row.id,
      slotId: row.slot_id,
      holdToken: row.hold_token,
      sessionId: row.session_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private rowToHL7LogEntry(row: DbRow): HL7MessageLogEntry {
    return {
      id: row.id,
      receivedAt: row.received_at,
      source: row.source,
      remoteAddress: row.remote_address || undefined,
      messageType: row.message_type || undefined,
      triggerEvent: row.trigger_event || undefined,
      controlId: row.control_id || undefined,
      rawMessage: row.raw_message,
      ackResponse: row.ack_response || undefined,
      ackCode: row.ack_code || undefined,
      processingMs: row.processing_ms ?? undefined,
    };
  }

  private rowToSystem(row: DbRow): SynapseSystem {
    return {
      id: row.id,
      name: row.name,
      url: row.url || undefined,
      mshApplication: row.msh_application || undefined,
      mshFacility: row.msh_facility || undefined,
      status: row.status as SystemStatus,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      ttlDays: row.ttl_days,
    };
  }

  private rowToLocation(row: DbRow): SynapseLocation {
    return {
      id: row.id,
      systemId: row.system_id,
      name: row.name,
      address: row.address || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      zip: row.zip || undefined,
      phone: row.phone || undefined,
      hl7LocationId: row.hl7_location_id || undefined,
      createdAt: row.created_at,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseJson(value: string | null): any {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
