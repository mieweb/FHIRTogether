import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  FhirStore,
  Schedule,
  Slot,
  Appointment,
  SlotHold,
  FhirSlotQuery,
  FhirScheduleQuery,
  FhirAppointmentQuery,
} from '../types/fhir';

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

  async initialize(): Promise<void> {
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
    `);
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
  private getDateOffsetDays(): number {
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

  /**
   * Shift an ISO date string by the date offset
   */
  private shiftDate(isoDate: string | undefined): string | undefined {
    if (!isoDate) return undefined;
    
    const offsetDays = this.getDateOffsetDays();
    if (offsetDays === 0) return isoDate;
    
    const date = new Date(isoDate);
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString();
  }

  // ==================== SCHEDULE OPERATIONS ====================

  async createSchedule(schedule: Schedule): Promise<Schedule> {
    const id = schedule.id || this.generateId();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO schedules (
        id, active, service_category, service_type, specialty, actor,
        planning_horizon_start, planning_horizon_end, comment, meta_last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now
    );

    return { ...schedule, id, meta: { lastUpdated: now } };
  }

  async getSchedules(query: FhirScheduleQuery): Promise<Schedule[]> {
    let sql = 'SELECT * FROM schedules WHERE 1=1';
    const params: any[] = [];

    if (query.active !== undefined) {
      sql += ' AND active = ?';
      params.push(query.active ? 1 : 0);
    }

    if (query.actor) {
      sql += ' AND actor LIKE ?';
      params.push(`%${query.actor}%`);
    }

    if (query.date) {
      sql += ' AND (planning_horizon_start <= ? AND planning_horizon_end >= ?)';
      params.push(query.date, query.date);
    }

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToSchedule(row));
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
    return row ? this.rowToSchedule(row) : null;
  }

  async updateSchedule(id: string, schedule: Partial<Schedule>): Promise<Schedule> {
    const existing = await this.getScheduleById(id);
    if (!existing) throw new Error(`Schedule ${id} not found`);

    const updated = { ...existing, ...schedule, id };
    const now = new Date().toISOString();

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
  async importScheduleRow(row: any): Promise<void> {
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
    const now = new Date().toISOString();

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
    const params: any[] = [];

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

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToSlot(row));
  }

  async getSlotById(id: string): Promise<Slot | null> {
    const row = this.db.prepare('SELECT * FROM slots WHERE id = ?').get(id) as any;
    return row ? this.rowToSlot(row) : null;
  }

  async updateSlot(id: string, slot: Partial<Slot>): Promise<Slot> {
    const existing = await this.getSlotById(id);
    if (!existing) throw new Error(`Slot ${id} not found`);

    const updated = { ...existing, ...slot, id };
    const now = new Date().toISOString();

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
  async importSlotRow(row: any): Promise<void> {
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
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO appointments (
        id, status, cancelation_reason, service_category, service_type,
        specialty, appointment_type, reason_code, priority, description,
        slot_refs, start, end, created, comment, patient_instruction,
        participant, meta_last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    const params: any[] = [];

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.date) {
      sql += ' AND start >= ? AND start < ?';
      const startDate = query.date;
      const endDate = new Date(query.date);
      endDate.setDate(endDate.getDate() + 1);
      params.push(startDate, endDate.toISOString());
    }

    if (query.patient) {
      sql += ' AND participant LIKE ?';
      params.push(`%${query.patient}%`);
    }

    sql += ' ORDER BY start ASC';

    if (query._count) {
      sql += ' LIMIT ?';
      params.push(query._count);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToAppointment(row));
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    const row = this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any;
    return row ? this.rowToAppointment(row) : null;
  }

  async updateAppointment(id: string, appointment: Partial<Appointment>): Promise<Appointment> {
    const existing = await this.getAppointmentById(id);
    if (!existing) throw new Error(`Appointment ${id} not found`);

    const updated = { ...existing, ...appointment, id };
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE appointments SET
        status = ?, cancelation_reason = ?, description = ?, start = ?,
        end = ?, comment = ?, participant = ?, meta_last_updated = ?
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
  async importAppointmentRow(row: any): Promise<void> {
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
        const newExpiry = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        this.db.prepare('UPDATE slot_holds SET expires_at = ? WHERE id = ?').run(newExpiry, existingHold.id);
        return { ...existingHold, expiresAt: newExpiry };
      }
      throw new Error(`Slot ${slotId} is already held by another user`);
    }

    // Create new hold
    const id = this.generateId();
    const holdToken = `hold-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

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
    const now = new Date().toISOString();
    const row = this.db.prepare(
      'SELECT * FROM slot_holds WHERE slot_id = ? AND expires_at > ?'
    ).get(slotId, now) as any;

    return row ? this.rowToSlotHold(row) : null;
  }

  async getHoldByToken(holdToken: string): Promise<SlotHold | null> {
    const row = this.db.prepare(
      'SELECT * FROM slot_holds WHERE hold_token = ?'
    ).get(holdToken) as any;

    return row ? this.rowToSlotHold(row) : null;
  }

  async cleanupExpiredHolds(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM slot_holds WHERE expires_at <= ?').run(now);
    return result.changes;
  }

  // ==================== HELPER METHODS ====================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractId(reference: string): string {
    return reference.split('/').pop() || reference;
  }

  private rowToSchedule(row: any): Schedule {
    return {
      resourceType: 'Schedule',
      id: row.id,
      active: row.active === 1,
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      actor: this.parseJson(row.actor),
      planningHorizon: row.planning_horizon_start ? {
        start: this.shiftDate(row.planning_horizon_start) || row.planning_horizon_start,
        end: this.shiftDate(row.planning_horizon_end) || row.planning_horizon_end,
      } : undefined,
      comment: row.comment,
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToSlot(row: any): Slot {
    return {
      resourceType: 'Slot',
      id: row.id,
      schedule: { reference: `Schedule/${row.schedule_id}` },
      status: row.status,
      start: this.shiftDate(row.start) || row.start,
      end: this.shiftDate(row.end) || row.end,
      serviceCategory: this.parseJson(row.service_category),
      serviceType: this.parseJson(row.service_type),
      specialty: this.parseJson(row.specialty),
      appointmentType: this.parseJson(row.appointment_type),
      overbooked: row.overbooked === 1,
      comment: row.comment,
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToAppointment(row: any): Appointment {
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
      start: this.shiftDate(row.start),
      end: this.shiftDate(row.end),
      created: row.created,
      comment: row.comment,
      patientInstruction: row.patient_instruction,
      participant: this.parseJson(row.participant),
      meta: { lastUpdated: row.meta_last_updated },
    };
  }

  private rowToSlotHold(row: any): SlotHold {
    return {
      id: row.id,
      slotId: row.slot_id,
      holdToken: row.hold_token,
      sessionId: row.session_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private parseJson(value: string | null): any {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
