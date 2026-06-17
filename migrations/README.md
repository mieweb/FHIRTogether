# Database migrations

Versioned SQL files that define the FHIRTogether schema. The same files are
applied by **both** storage backends:

| Backend                        | How migrations are applied                              |
|--------------------------------|---------------------------------------------------------|
| `SqliteStore` (Node)           | Read & executed by `SqliteStore.initialize()` at startup |
| `D1Store` (Cloudflare Workers) | Out-of-band via `wrangler d1 migrations apply <DB>`     |

## Conventions

- Filenames use a zero-padded ordinal prefix (`0001_*.sql`, `0002_*.sql`, …).
  `wrangler` applies them in filename order, so don't renumber after the fact.
- Each migration must be idempotent (`CREATE TABLE IF NOT EXISTS`, etc.) so
  the SQLite path can re-apply them safely on every boot.
- Don't edit an already-shipped migration — add a new file instead.

## Why one shared schema?

SQLite and Cloudflare D1 are dialect-compatible for the DDL we use. Keeping
one source of truth prevents drift between dev (SQLite) and production
(D1, future Postgres adapter, etc.).
