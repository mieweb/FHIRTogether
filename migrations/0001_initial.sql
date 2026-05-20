-- FHIRTogether — initial schema
--
-- Single source of truth for the relational schema, shared by:
--   • SqliteStore (Node, better-sqlite3) — applied at startup by initialize()
--   • Future D1Store (Cloudflare Workers) — applied out-of-band via
--     `wrangler d1 migrations apply`
--
-- SQLite and Cloudflare D1 share the same SQL dialect, so this file works
-- unchanged in both. When bumping the schema, add a new file
-- (0002_*.sql, 0003_*.sql, …) rather than editing this one — D1's
-- migrations runner relies on the filename order.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS systems (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  url               TEXT,
  api_key_hash      TEXT,
  msh_application   TEXT,
  msh_facility      TEXT,
  msh_secret_hash   TEXT,
  challenge_token   TEXT,
  status            TEXT NOT NULL DEFAULT 'unverified',
  last_activity_at  TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  ttl_days          INTEGER NOT NULL DEFAULT 7,
  UNIQUE(msh_application, msh_facility)
);

CREATE INDEX IF NOT EXISTS idx_systems_status        ON systems(status);
CREATE INDEX IF NOT EXISTS idx_systems_url           ON systems(url);
CREATE INDEX IF NOT EXISTS idx_systems_msh           ON systems(msh_application, msh_facility);
CREATE INDEX IF NOT EXISTS idx_systems_api_key_hash  ON systems(api_key_hash);

CREATE TABLE IF NOT EXISTS locations (
  id               TEXT PRIMARY KEY,
  system_id        TEXT NOT NULL,
  name             TEXT NOT NULL,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  zip              TEXT,
  phone            TEXT,
  hl7_location_id  TEXT,
  created_at       TEXT NOT NULL,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_locations_system ON locations(system_id);
CREATE INDEX IF NOT EXISTS idx_locations_hl7    ON locations(system_id, hl7_location_id);

CREATE TABLE IF NOT EXISTS schedules (
  id                      TEXT PRIMARY KEY,
  resource_type           TEXT NOT NULL DEFAULT 'Schedule',
  active                  INTEGER DEFAULT 1,
  service_category        TEXT,
  service_type            TEXT,
  specialty               TEXT,
  actor                   TEXT NOT NULL,
  planning_horizon_start  TEXT,
  planning_horizon_end    TEXT,
  comment                 TEXT,
  meta_last_updated       TEXT,
  created_at              TEXT DEFAULT CURRENT_TIMESTAMP,
  system_id               TEXT REFERENCES systems(id) ON DELETE CASCADE,
  location_id             TEXT REFERENCES locations(id) ON DELETE SET NULL,
  availability_template   TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedules_system   ON schedules(system_id);
CREATE INDEX IF NOT EXISTS idx_schedules_location ON schedules(location_id);

CREATE TABLE IF NOT EXISTS slots (
  id                  TEXT PRIMARY KEY,
  resource_type       TEXT NOT NULL DEFAULT 'Slot',
  schedule_id         TEXT NOT NULL,
  status              TEXT NOT NULL,
  start               TEXT NOT NULL,
  end                 TEXT NOT NULL,
  service_category    TEXT,
  service_type        TEXT,
  specialty           TEXT,
  appointment_type    TEXT,
  overbooked          INTEGER DEFAULT 0,
  comment             TEXT,
  meta_last_updated   TEXT,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slots_schedule ON slots(schedule_id);
CREATE INDEX IF NOT EXISTS idx_slots_start    ON slots(start);
CREATE INDEX IF NOT EXISTS idx_slots_status   ON slots(status);

CREATE TABLE IF NOT EXISTS appointments (
  id                  TEXT PRIMARY KEY,
  resource_type       TEXT NOT NULL DEFAULT 'Appointment',
  status              TEXT NOT NULL,
  identifier          TEXT,
  cancelation_reason  TEXT,
  service_category    TEXT,
  service_type        TEXT,
  specialty           TEXT,
  appointment_type    TEXT,
  reason_code         TEXT,
  priority            INTEGER,
  description         TEXT,
  slot_refs           TEXT,
  start               TEXT,
  end                 TEXT,
  created             TEXT,
  comment             TEXT,
  patient_instruction TEXT,
  participant         TEXT NOT NULL,
  meta_last_updated   TEXT,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_start      ON appointments(start);
CREATE INDEX IF NOT EXISTS idx_appointments_status     ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_identifier ON appointments(identifier);

CREATE TABLE IF NOT EXISTS slot_holds (
  id           TEXT PRIMARY KEY,
  slot_id      TEXT NOT NULL,
  hold_token   TEXT UNIQUE NOT NULL,
  session_id   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slot_holds_slot    ON slot_holds(slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_holds_expires ON slot_holds(expires_at);
CREATE INDEX IF NOT EXISTS idx_slot_holds_token   ON slot_holds(hold_token);

CREATE TABLE IF NOT EXISTS hl7_message_log (
  id              TEXT PRIMARY KEY,
  received_at     TEXT NOT NULL,
  source          TEXT NOT NULL,
  remote_address  TEXT,
  message_type    TEXT,
  trigger_event   TEXT,
  control_id      TEXT,
  raw_message     TEXT NOT NULL,
  ack_response    TEXT,
  ack_code        TEXT,
  processing_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_hl7_log_received ON hl7_message_log(received_at);
CREATE INDEX IF NOT EXISTS idx_hl7_log_source   ON hl7_message_log(source);
CREATE INDEX IF NOT EXISTS idx_hl7_log_type     ON hl7_message_log(message_type);
