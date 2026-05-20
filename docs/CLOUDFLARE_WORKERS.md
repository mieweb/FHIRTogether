# Cloudflare Workers + D1 Deployment — Roadmap

This document captures the plan to make FHIRTogether deployable to
Cloudflare Workers with D1 as one of several interchangeable database
backends.

The user's framing was: *"I don't want to 'Replace' fastify, I would like
to make some standard APIs that allow me to 'interchange' the database
layer. Maybe I want mongodb. maybe in the future i want mysql, postgresql,
etc... D1 would be one."*

## Status

| Phase | Description                                                         | Status |
|-------|---------------------------------------------------------------------|--------|
| 1     | Storage seam refactor (factory, shared schema, decoupled helpers)   | ✅ Done |
| 2     | D1 backend implementation                                           | ⏳ TODO |
| 3     | Workers entry point + Fastify-on-Workers strategy                   | ⏳ TODO |
| 4     | Cron Triggers for background jobs                                   | ⏳ TODO |
| 5     | MLLP deployment story (Node/Docker-only or companion VM)            | ⏳ TODO |
| 6     | `wrangler.toml`, deploy, validate                                   | ⏳ TODO |

## Phase 1 — Storage seam refactor ✅

Landed in this PR. What it gives us:

- **`src/store/index.ts`** — `createStore(backend, options)` factory.
  This is the **only** module in the app that imports concrete
  `FhirStore` implementations. Routes, the server, and (eventually) the
  Workers entry depend on the `FhirStore` interface only. Uses dynamic
  `import()` so the SQLite path (which requires the native
  `better-sqlite3` module) isn't pulled into a Workers bundle.
- **`migrations/0001_initial.sql`** — single source of truth for the DDL.
  Applied by `SqliteStore.initialize()` at startup on Node, and ready to
  be applied to D1 via `wrangler d1 migrations apply` on Workers. SQLite
  and D1 share the same SQL dialect.
- **`src/examples/seedMetadata.ts`** — Node-only helper for the
  demo-data date-shift mechanism, moved out of `SqliteStore` so other
  backends (D1, Mongo, …) don't have to implement filesystem-bound
  metadata code.
- **`src/config.ts`** — env-config shim. On Node it reads `process.env`;
  on Workers it can read the `env` arg from the `fetch` handler.

Adding a new backend (Mongo, Postgres, …) is now:
1. Implement `FhirStore` from `src/types/fhir.ts`.
2. Wire it into the `switch` in `src/store/index.ts`.
3. That's it — no route changes.

## Phase 2 — D1 backend

Create `src/store/d1Store.ts` that implements `FhirStore` against a
Cloudflare `D1Database` binding.

- **Translate every method** from `src/store/sqliteStore.ts` (~1,400 lines).
  The queries are already SQL. The mechanical work: `better-sqlite3` is
  synchronous (`stmt.get()`, `stmt.all()`, `stmt.run()`), D1 is async
  (`stmt.bind(...).first()`, `.all()`, `.run()`).
- **Migrations**: D1 doesn't run them at request time. Use
  `wrangler d1 migrations apply <DB_NAME>`. The schema files in
  `migrations/` are already in the right format.
- **`initialize()`**: for D1 this becomes a no-op verification step
  (read `_meta.schema_version`, warn if mismatched). Mention this in
  the `FhirStore` JSDoc.
- **Hashing / UUIDs**: replace `crypto.createHash('sha256')` and
  `crypto.randomBytes` with WebCrypto (`globalThis.crypto.subtle` /
  `crypto.getRandomValues`). Consider a tiny shared
  `src/util/hash.ts` with both Node and Web implementations.
- **Shared contract test suite**: extract the `synapseSystem.test.ts` and
  `bookingLifecycle.test.ts` assertions into a backend-agnostic suite
  that runs against both SQLite (via better-sqlite3) and D1 (via
  Miniflare's D1 emulator). This is the safety net that makes
  "Mongo next, Postgres later" cheap.
- **Concurrency callouts to document on the interface**:
  - `findOrCreateSystemByMSH` / `findOrCreateLocationByHL7` — atomicity
    must be preserved. D1: `INSERT … ON CONFLICT`. Mongo: upsert.
  - `holdSlot` / `releaseHold` / `getActiveHold` — guarantee "at most
    one active hold per slot." D1: serializable per-DB. Mongo: unique
    partial index on `(slotId)` where `expires_at > now()`.

## Phase 3 — Workers entry point

Create `src/worker.ts` exporting a `fetch` handler (and a `scheduled`
handler for cron jobs, see Phase 4).

The user's constraint: **don't replace Fastify.** Two realistic options:

### Option (a): Keep Fastify, run via adapter
Use a small shim that polyfills `http.IncomingMessage` /
`ServerResponse` from a Workers `Request`. Works for typical JSON
routes; rough edges:
- `@fastify/static` won't work — replace with Workers Assets binding.
- `@fastify/swagger-ui` bundles assets — likely needs to be served
  as a separate Workers Asset.
- `pino-pretty` uses worker threads — replace with plain `pino` to
  `console.log` (or a structured-log shim that targets `console`).

### Option (b): Thin route adapter (recommended if (a) is flaky)
- Keep route *handlers* as plain functions taking `(req, store) → response`.
- Write small adapters that mount them on either Fastify (Node) or a
  Workers router (Hono / itty-router).
- Bonus: makes Mongo/Postgres deployments to Lambda / other serverless
  trivial.

Either way, the Workers entry must:
- Disable MLLP socket startup (no TCP listen on Workers — see Phase 5).
- Skip the `fs`-based "is the scheduler widget built?" check.
- Skip `setInterval` background jobs (those become Cron Triggers).
- Read config via `loadConfig(env)` from `src/config.ts`.
- Construct the store via `createStore('d1', { d1Database: env.DB })`.

## Phase 4 — Cron Triggers for background jobs

Today's `setInterval` background jobs (in `src/server.ts`):
- HL7 message log cleanup (`runHL7LogCleanup`, every 24h).
- System evaporation (`runEvaporation`, every N hours).
- Expired-slot-hold cleanup (currently on-demand inside routes).

Workers don't have long-lived processes. Move these to a `scheduled`
handler in `worker.ts` and register cron schedules in `wrangler.toml`.
The same backend methods (`cleanupHL7MessageLog`, `evaporateExpiredSystems`,
`cleanupExpiredHolds`) work unchanged — they just need to be safe to call
from a request-scoped invocation (idempotent, bounded work per call).

## Phase 5 — MLLP deployment story

Cloudflare Workers **cannot listen on TCP sockets**. MLLP (`src/hl7/socket.ts`,
~520 lines) cannot run on Workers — full stop. Options:

1. **Pragmatic**: Keep MLLP exclusively on the Node/Docker deployment.
   Mark the Workers deployment as "REST + HL7-over-HTTP only."
2. **Hybrid**: Run a small companion VM/container that accepts MLLP
   and forwards parsed messages to the Workers HTTP `/hl7/siu` endpoint.

The HTTP HL7 ingest path (`/hl7/siu`) already exists and works the same
on Workers, so option (1) is the lowest-effort default.

## Phase 6 — `wrangler.toml`, deploy, validate

- `wrangler.toml` with: D1 binding, Workers Assets binding (for `/public`
  and the scheduler widget), Cron Trigger schedules, env vars (non-secret)
  and secrets (`AUTH_PASSWORD`, etc.).
- Run the existing Playwright e2e suite against the deployed Worker URL
  — they're mostly HTTP-driven and should mostly pass.
- Update `README.md` with the Workers deployment quick-start.

## Things to call out

- The `FhirStore` interface is the right place to add backends. Don't
  invent a new abstraction — just keep SQLite-specific concerns
  (filesystem, seed metadata, synchronous calls) from leaking past it.
- **The database port is the small part of the work.** The big part is
  making the rest of the codebase tolerate a non-Node runtime: Fastify
  hosting, static assets, background timers, MLLP, logging, and the
  `process.env` reads.
- **MLLP will not run on Workers — ever.** Plan for a hybrid deployment
  or an HTTP-only Workers tier.
- Keep one shared SQL schema (`migrations/*.sql`) for SqliteStore and
  D1Store — this PR did that. Don't drift.
