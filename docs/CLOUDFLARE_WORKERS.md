# Cloudflare Workers + D1 Deployment

This document describes the dual-deployment topology that FHIRTogether
supports as of the Cloudflare Workers + D1 port:

| Deployment           | Runtime                      | Storage              | Scope                                                |
|----------------------|------------------------------|----------------------|------------------------------------------------------|
| **Node**             | Node.js + Fastify            | SQLite (better-sqlite3) | Full feature set: REST, Swagger UI, MCP SSE, MLLP TCP, static assets |
| **Cloudflare Workers** | Workers + Hono             | Cloudflare D1        | REST FHIR endpoints + HL7-over-HTTP + cron jobs       |

Both deployments use the same `FhirStore` interface (`src/types/fhir.ts`)
and the same SQL schema (`migrations/*.sql`).

## Status

| Phase | Description                                                         | Status |
|-------|---------------------------------------------------------------------|--------|
| 1     | Storage seam refactor (factory, shared schema, decoupled helpers)   | ✅ Done |
| 2     | D1 backend (`src/store/d1Store.ts`) + shared contract test suite    | ✅ Done |
| 3     | Workers entry point (`src/worker.ts`) with Hono router              | ✅ Done |
| 4     | Cron Triggers for background jobs                                   | ✅ Done |
| 5     | MLLP deployment story (Node/Docker only)                            | ✅ Done |
| 6     | `wrangler.toml`, deploy commands                                    | ✅ Done |

## Quick start (Workers deployment)

```bash
# 1. Authenticate with Cloudflare
npx wrangler login

# 2. Create the D1 database
npx wrangler d1 create fhirtogether
#    → copy the printed `database_id` into wrangler.toml
#      (replace REPLACE_WITH_D1_DATABASE_ID)

# 3. Apply migrations to the production D1
npm run d1:migrate:remote

# 4. Deploy
npm run deploy:worker
```

Local development:

```bash
# Spin up Miniflare with a local D1, applies migrations automatically
npm run d1:migrate:local
npm run dev:worker
```

## What landed

### Phase 1 — Storage seam refactor

- **`src/store/index.ts`** — `createStore(backend, options)` factory. The
  **only** module that imports concrete `FhirStore` implementations. Uses
  dynamic `import()` so the SQLite path (which requires the native
  `better-sqlite3` module) isn't pulled into a Workers bundle.
- **`migrations/0001_initial.sql`** — single source of truth for the DDL.
  Applied by `SqliteStore.initialize()` at startup on Node; applied to D1
  via `npm run d1:migrate:{local,remote}`. SQLite and D1 share the same
  SQL dialect.
- **`src/examples/seedMetadata.ts`** — Node-only helper for the demo-data
  date-shift mechanism, moved out of `SqliteStore`.
- **`src/config.ts`** — env-config shim. Reads `process.env` on Node;
  reads the `env` arg on Workers.

### Phase 2 — D1 backend

- **`src/store/d1Store.ts`** — full implementation of `FhirStore` against
  a `D1Database` binding. Mechanical port of `SqliteStore`:
  `better-sqlite3`'s synchronous API (`stmt.get/all/run`) becomes D1's
  async API (`stmt.bind(...).first/all/run`). Transactions become
  `db.batch([...])`.
- **`src/util/hash.ts`** — cross-runtime crypto shim. Replaces Node's
  `crypto.createHash` / `crypto.randomBytes` / `crypto.timingSafeEqual`
  with WebCrypto equivalents that work on both Node and Workers.
- **`src/__tests__/d1Store.test.ts`** + **`src/__tests__/fakeD1.ts`** —
  shared contract test suite. Runs the D1Store against an in-memory
  SQLite wrapped in a D1-shaped adapter, proving the port works without
  needing Miniflare in CI. Covers system CRUD, MSH find-or-create,
  schedule/slot lifecycle, slot holds, HL7 message log.
- **`src/__tests__/hash.test.ts`** — verifies the crypto shim matches
  Node's `crypto` byte-for-byte.

`initialize()` on D1 is read-only: it checks `_meta.schema_version` and
reports a mismatch if migrations haven't been applied. It does NOT
attempt to apply DDL — that's `wrangler d1 migrations apply`'s job.

### Phase 3 — Workers entry point

- **`src/worker.ts`** — exports a default object with `fetch` and
  `scheduled` handlers (Cloudflare Workers conventions). Uses
  [Hono](https://hono.dev/) as a thin router. Implements per-plan
  option (b): a thin route adapter rather than fighting Fastify-on-Workers.
- **Routes**: `/Schedule`, `/Slot`, `/Appointment` (GET list, GET by id,
  POST create), `/System`, `/Location` (GET), `/health`, `/`,
  `/_schema`. All return JSON; FHIR search returns proper `Bundle`
  shape via the `makeBundle()` helper.
- Not included on Workers (Node-only, by design):
  - Fastify, `@fastify/swagger-ui`, `@fastify/static` — Workers doesn't
    support arbitrary plugins/static serving via Fastify.
  - `src/hl7/socket.ts` (MLLP TCP) — Workers can't `listen()` on TCP.
  - `src/mcp/mcpServer.ts` (MCP SSE) — SSE may work on Workers via Web
    Streams, but it's out of scope for the first port.
  - `pino-pretty` — uses worker threads; replaced by `console.log`.
  - Seed-data scripts, scheduler-widget build check, graceful shutdown.

### Phase 4 — Cron Triggers

The `scheduled` handler in `src/worker.ts` replaces the `setInterval`
background jobs from `src/server.ts`:

```toml
# wrangler.toml
[triggers]
crons = [
  "0 */24 * * *",  # HL7 log cleanup (daily)
  "0 * * * *",     # System evaporation (hourly)
  "*/10 * * * *",  # Expired slot-hold cleanup
]
```

Each handler dispatches by `event.cron` and calls the same idempotent,
bounded store methods (`cleanupHL7MessageLog`, `evaporateExpiredSystems`,
`cleanupExpiredHolds`) used by the Node deployment. Work is wrapped in
`ctx.waitUntil(...)` so the cron tick can return promptly.

### Phase 5 — MLLP deployment story

**MLLP cannot run on Cloudflare Workers.** Workers cannot bind to raw
TCP sockets. Options:

1. **Recommended:** Keep MLLP exclusively on the Node/Docker deployment.
   The Workers deployment is "REST + HL7-over-HTTP only" — the `/hl7/siu`
   HTTP endpoint already accepts pipe-delimited HL7v2 in the request body,
   so any system that can send HTTP can deliver HL7 to the Workers tier.
2. **Hybrid:** Run a small companion VM/container that accepts MLLP TCP
   and forwards parsed messages to the Workers `/hl7/siu` HTTP endpoint.

The `worker.ts` entry deliberately does not import `src/hl7/socket.ts`.

### Phase 6 — `wrangler.toml`

Top-level `wrangler.toml` configures: D1 binding (as `env.DB`),
non-secret config via `[vars]`, cron triggers, `nodejs_compat` flag for
Workers, and observability. Secrets are set via `wrangler secret put`.

Three new npm scripts:

```jsonc
"deploy:worker":       "wrangler deploy",
"dev:worker":          "wrangler dev",
"d1:migrate:local":    "wrangler d1 migrations apply fhirtogether --local",
"d1:migrate:remote":   "wrangler d1 migrations apply fhirtogether --remote",
```

## Things to know

- `wrangler` and `@cloudflare/workers-types` are **devDependencies**.
  Only Workers deployers need them; existing Node devs are unaffected.
  `hono` is a runtime dependency so wrangler can bundle it.
- The Workers deployment is **smaller in scope** than the Node deployment
  on purpose — anything that needs filesystem, TCP, worker-threads, or
  long-lived processes stays on Node. Don't try to port them.
- The shared SQL schema (`migrations/*.sql`) prevents drift between
  SQLite and D1. When bumping the schema, add a new migration file
  (`0002_*.sql`) rather than editing `0001_initial.sql`.
- Adding a new backend (Mongo, Postgres, …) is still just: implement
  `FhirStore`, add a `case` to the switch in `src/store/index.ts`. The
  factory pattern set up in Phase 1 makes this cheap.
