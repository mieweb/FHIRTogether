/**
 * Tiny `D1Database`-shaped adapter over `better-sqlite3`.
 *
 * Used by unit tests to exercise `D1Store` against the same SQL engine
 * that Cloudflare D1 uses (SQLite) without needing Miniflare or a live
 * Workers runtime. Only implements the subset of the D1 API that
 * `D1Store` actually uses.
 *
 * NOT for production. Lives under `__tests__/` deliberately.
 */
import Database from 'better-sqlite3';

interface D1Meta { changes?: number; last_row_id?: number }
interface D1Result<T = unknown> { results: T[]; success: boolean; meta: D1Meta }
interface D1RunResult { success: boolean; meta: D1Meta }

class FakeD1PreparedStatement {
  private params: unknown[] = [];
  constructor(private readonly db: Database.Database, private readonly sql: string) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    // Convert undefined → null (D1 does this implicitly; better-sqlite3 throws on undefined)
    this.params = values.map(v => (v === undefined ? null : v));
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows, success: true, meta: {} };
  }

  async run(): Promise<D1RunResult> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }

  /** Sync execution used by `batch()`. Picks `.run()` vs `.all()` based on stmt type. */
  execInTx<T>(): D1Result<T> {
    const stmt = this.db.prepare(this.sql);
    if (stmt.reader) {
      const rows = stmt.all(...this.params) as T[];
      return { results: rows, success: true, meta: {} };
    }
    const info = stmt.run(...this.params);
    return { results: [], success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }
}

export class FakeD1Database {
  constructor(private readonly db: Database.Database) {}

  prepare(sql: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db, sql);
  }

  async batch<T = unknown>(stmts: FakeD1PreparedStatement[]): Promise<D1Result<T>[]> {
    // better-sqlite3 supports synchronous transactions — wrap the batch in one.
    // We pick `.run()` vs `.all()` per-statement based on whether the prepared
    // statement returns data (`reader` is true for SELECT).
    const tx = this.db.transaction((batch: FakeD1PreparedStatement[]): D1Result<T>[] => {
      return batch.map(s => s.execInTx<T>());
    });
    return tx(stmts);
  }
}

/**
 * Spin up an in-memory SQLite DB, apply the shared migrations SQL, and
 * wrap it in a D1-shaped adapter. Use this to construct a `D1Store` in
 * unit tests.
 */
export function createTestD1Database(): { d1: FakeD1Database; close: () => void } {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // Apply the same migration that wrangler would apply in production.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const schemaPath = path.resolve(__dirname, '..', '..', 'migrations', '0001_initial.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  // D1Store reads _meta.schema_version on initialize() — pre-populate it
  // so initialize() reports match=true (mirroring `wrangler d1 migrations apply`).
  db.prepare("INSERT INTO _meta (key, value) VALUES ('schema_version', ?)").run('5');
  return {
    d1: new FakeD1Database(db),
    close: () => db.close(),
  };
}
