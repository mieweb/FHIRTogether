/**
 * Runtime configuration shim.
 *
 * Reads from `process.env` when running on Node, or from a passed-in `env`
 * object when running on Cloudflare Workers (where `process.env` does not
 * exist and configuration is delivered via the `fetch(req, env, ctx)`
 * handler arg).
 *
 * Call `loadConfig()` once at startup and pass the result around — don't
 * sprinkle `process.env.*` reads throughout the codebase, since they break
 * the moment the code runs in a non-Node runtime.
 */
export interface AppConfig {
  /** Storage backend name: 'sqlite' (default, Node) or 'd1' (Workers, future) */
  storeBackend: string;
  /** Path to the SQLite database file (Node only). Ignored by D1. */
  sqliteDbPath: string;
  /** HTTP listen port (Node only). Ignored by Workers. */
  port: number;
  /** HTTP listen host (Node only). Ignored by Workers. */
  host: string;
  /** Default TTL (days) for newly registered systems. */
  systemTtlDays: number;
  /** Days of HL7 message log entries to retain. */
  hl7MessageLogRetentionDays: number;
  /** Hours between system-evaporation sweeps (Node setInterval / Workers cron). */
  evaporationCheckIntervalHours: number;
}

/**
 * Source of environment values. On Node this is `process.env`; on Workers
 * pass `env` from the `fetch` / `scheduled` handler.
 */
export type EnvSource = Record<string, string | undefined>;

function readInt(env: EnvSource, key: string, defaultValue: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readString(env: EnvSource, key: string, defaultValue: string): string {
  const raw = env[key];
  return raw === undefined || raw === '' ? defaultValue : raw;
}

/**
 * Build an `AppConfig` from an environment source.
 *
 * On Node, call as `loadConfig(process.env as EnvSource)`.
 * On Workers, call as `loadConfig(env as unknown as EnvSource)` from the
 * fetch handler.
 */
export function loadConfig(env: EnvSource): AppConfig {
  return {
    storeBackend: readString(env, 'STORE_BACKEND', 'sqlite'),
    sqliteDbPath: readString(env, 'SQLITE_DB_PATH', './data/fhirtogether.db'),
    port: readInt(env, 'PORT', 4010),
    host: readString(env, 'HOST', '0.0.0.0'),
    systemTtlDays: readInt(env, 'SYSTEM_TTL_DAYS', 7),
    hl7MessageLogRetentionDays: readInt(env, 'HL7_MESSAGE_LOG_RETENTION_DAYS', 7),
    evaporationCheckIntervalHours: readInt(env, 'EVAPORATION_CHECK_INTERVAL_HOURS', 1),
  };
}
