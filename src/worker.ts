/**
 * Cloudflare Workers entry point.
 *
 * This is the Workers analogue of `src/server.ts`. It exposes:
 *   • `fetch`     — HTTP request handler (uses Hono as a thin router)
 *   • `scheduled` — Cron-trigger handler for background jobs that the
 *                   Node deployment runs via `setInterval`.
 *
 * The Workers deployment is **REST + HL7-over-HTTP only**. The MLLP TCP
 * listener (`src/hl7/socket.ts`), `@fastify/swagger-ui`, `@fastify/static`,
 * the MCP SSE transport, and the seed-data / scheduler-widget build
 * checks all stay on the Node deployment exclusively — see
 * `docs/CLOUDFLARE_WORKERS.md`.
 *
 * The route handlers here are intentionally thin — they re-use the same
 * `FhirStore` interface and resource shapes as the Node routes, just
 * without Fastify-specific schema validation / OpenAPI plumbing. Adding
 * a new resource means: implement on the store, expose a handler here.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createStore } from './store';
import { loadConfig } from './config';
import { SCHEMA_VERSION } from './store/sqliteStore';
import type { FhirStore, SystemStatus } from './types/fhir';

/**
 * The shape of `env` that the Worker receives from Cloudflare. Defined
 * inline so we don't have to take a hard dependency on
 * `@cloudflare/workers-types` at compile time (it's a devDep).
 */
interface WorkerEnv {
  /** D1 database binding configured in `wrangler.toml`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DB: any;
  /** Optional config overrides as env vars. */
  STORE_BACKEND?: string;
  SYSTEM_TTL_DAYS?: string;
  HL7_MESSAGE_LOG_RETENTION_DAYS?: string;
  EVAPORATION_CHECK_INTERVAL_HOURS?: string;
  [k: string]: unknown;
}

/**
 * Minimal cron-trigger event shape — `cron` is the schedule that fired
 * (matches the `crons = [...]` list in wrangler.toml).
 */
interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

/**
 * Minimal execution context — `waitUntil` lets us run async work
 * past the response being sent (used by cron handlers). Matches the
 * Cloudflare Workers `ExecutionContext` shape (extra fields like
 * `passThroughOnException` exist on the real type but we don't use them).
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props?: any;
}

/** Build a `FhirStore` from the Worker env. */
async function buildStore(env: WorkerEnv): Promise<FhirStore> {
  const cfg = loadConfig({
    ...(env as Record<string, string | undefined>),
    // Force D1 unless explicitly overridden — Workers cannot run SQLite.
    STORE_BACKEND: env.STORE_BACKEND ?? 'd1',
  });
  return createStore(cfg.storeBackend, { d1Database: env.DB });
}

/** Build a Hono app wired to the given store. Exported for testing. */
export function buildApp(store: FhirStore): Hono<{ Bindings: WorkerEnv }> {
  const app = new Hono<{ Bindings: WorkerEnv }>();

  app.use('*', cors({ origin: '*' }));

  // ── Health & metadata ────────────────────────────────────────────
  app.get('/health', (c) =>
    c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      store: 'd1',
      runtime: 'cloudflare-workers',
      schemaVersion: SCHEMA_VERSION,
    }),
  );

  app.get('/', (c) =>
    c.json({
      name: 'FHIRTogether Scheduling Synapse',
      version: '1.0.0',
      runtime: 'cloudflare-workers',
      fhirVersion: 'R4',
      endpoints: {
        schedule: '/Schedule',
        slot: '/Slot',
        appointment: '/Appointment',
        system: '/System',
        location: '/Location',
        health: '/health',
      },
      note: 'Workers deployment is REST + HL7-over-HTTP only. MLLP runs on Node only.',
    }),
  );

  // ── Schedule ─────────────────────────────────────────────────────
  app.get('/Schedule', async (c) => {
    const q = c.req.query();
    const schedules = await store.getSchedules({
      active: q.active === undefined ? undefined : q.active === 'true',
      actor: q.actor,
      date: q.date,
      _count: q._count ? parseInt(q._count, 10) : undefined,
    });
    return c.json(makeBundle('Schedule', schedules));
  });

  app.get('/Schedule/:id', async (c) => {
    const found = await store.getScheduleById(c.req.param('id'));
    if (!found) return c.json({ error: 'Schedule not found' }, 404);
    return c.json(found);
  });

  app.post('/Schedule', async (c) => {
    const body = await c.req.json();
    const created = await store.createSchedule(body);
    return c.json(created, 201);
  });

  // ── Slot ─────────────────────────────────────────────────────────
  app.get('/Slot', async (c) => {
    const q = c.req.query();
    const slots = await store.getSlots({
      schedule: q.schedule,
      status: q.status,
      start: q.start,
      end: q.end,
      _count: q._count ? parseInt(q._count, 10) : undefined,
    });
    return c.json(makeBundle('Slot', slots));
  });

  app.get('/Slot/:id', async (c) => {
    const found = await store.getSlotById(c.req.param('id'));
    if (!found) return c.json({ error: 'Slot not found' }, 404);
    return c.json(found);
  });

  app.post('/Slot', async (c) => {
    const body = await c.req.json();
    const created = await store.createSlot(body);
    return c.json(created, 201);
  });

  // ── Appointment ──────────────────────────────────────────────────
  app.get('/Appointment', async (c) => {
    const q = c.req.query();
    const appts = await store.getAppointments({
      status: q.status,
      date: q.date,
      patient: q.patient,
      actor: q.actor,
      identifier: q.identifier,
      _count: q._count ? parseInt(q._count, 10) : undefined,
    });
    return c.json(makeBundle('Appointment', appts));
  });

  app.get('/Appointment/:id', async (c) => {
    const found = await store.getAppointmentById(c.req.param('id'));
    if (!found) return c.json({ error: 'Appointment not found' }, 404);
    return c.json(found);
  });

  app.post('/Appointment', async (c) => {
    const body = await c.req.json();
    const created = await store.createAppointment(body);
    return c.json(created, 201);
  });

  // ── System / Location (admin-ish) ───────────────────────────────
  app.get('/System', async (c) => {
    const status = c.req.query('status') as SystemStatus | undefined;
    const systems = await store.getSystems(status ? { status } : undefined);
    return c.json({ systems });
  });

  app.get('/Location', async (c) => {
    const locations = await store.getLocations({
      systemId: c.req.query('systemId'),
      zip: c.req.query('zip'),
    });
    return c.json({ locations });
  });

  // ── Schema status (lets ops verify migrations were applied) ─────
  app.get('/_schema', async (c) => c.json(await store.initialize()));

  return app;
}

/** Wrap an FHIR resource array into a FHIR `Bundle`. */
function makeBundle<T extends { resourceType: string; id?: string }>(
  resourceType: string,
  resources: T[],
): { resourceType: 'Bundle'; type: 'searchset'; total: number; entry: Array<{ fullUrl?: string; resource: T }> } {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: resources.length,
    entry: resources.map((r) => ({
      fullUrl: r.id ? `${resourceType}/${r.id}` : undefined,
      resource: r,
    })),
  };
}

/**
 * Cloudflare Workers default export: `fetch` + `scheduled` handlers.
 */
export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const store = await buildStore(env);
    const app = buildApp(store);
    // The runtime `ctx` is the real Workers ExecutionContext; Hono's stricter
    // type isn't materially different, so cast through unknown to satisfy it.
    return app.fetch(request, env, ctx as unknown as Parameters<typeof app.fetch>[2]);
  },

  /**
   * Cron-trigger handler. Configure schedules in `wrangler.toml` under
   * `[triggers] crons = [...]`. The plan's Phase 4 work — replaces the
   * `setInterval` background jobs from `src/server.ts` with idempotent,
   * bounded calls into the store.
   *
   * All three jobs are idempotent and bounded, so we run all of them on
   * every cron tick rather than coupling this handler to specific cron
   * strings in `wrangler.toml`. The cron schedule controls *frequency*
   * (set in wrangler.toml: hourly is enough for the heaviest job), not
   * *which* jobs run.
   */
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const cfg = loadConfig(env as Record<string, string | undefined>);
    const store = await buildStore(env);

    // Use `waitUntil` so the cron tick can return promptly while work runs.
    ctx.waitUntil(
      (async () => {
        try {
          const expiredHolds = await store.cleanupExpiredHolds();
          if (expiredHolds > 0) console.log(`[cron] Cleaned up ${expiredHolds} expired slot hold(s)`);

          const evapResult = await store.evaporateExpiredSystems();
          if (evapResult.count > 0) console.log(`[cron] Evaporated ${evapResult.count} expired system(s)`);

          const logRows = await store.cleanupHL7MessageLog(cfg.hl7MessageLogRetentionDays);
          if (logRows > 0) console.log(`[cron] HL7 log cleanup: ${logRows} rows deleted`);
        } catch (err) {
          console.error('[cron] handler failed:', err);
        }
      })(),
    );
  },
};
