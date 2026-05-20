/**
 * Storage backend factory.
 *
 * This is the **only** module in the app that imports concrete `FhirStore`
 * implementations. Routes and the server entry point depend on the
 * `FhirStore` interface (from `../types/fhir`) and call `createStore()`
 * to obtain one.
 *
 * The factory uses **dynamic `import()`** so that Node-only backends
 * (e.g. `SqliteStore`, which depends on the native `better-sqlite3`
 * module) are not bundled into a Cloudflare Workers build. Workers
 * builds should call `createStore('d1', { d1Database })` and the
 * SqliteStore path will never be reached.
 */
import type { FhirStore } from '../types/fhir';

/** Options accepted by every backend; individual backends may ignore fields they don't need. */
export interface CreateStoreOptions {
  /**
   * Path to the SQLite database file (sqlite backend only).
   * Defaults to `./data/fhirtogether.db`.
   */
  sqliteDbPath?: string;

  /**
   * A function returning the number of days to shift "seed-data" timestamps
   * by, so demo data always looks current. Pass `undefined` (the default)
   * for real deployments — only the example/seed-import scripts inject
   * this. See `src/examples/seedMetadata.ts`.
   */
  dateOffsetProvider?: () => number;

  /**
   * Cloudflare D1 database binding (d1 backend only). Will be required
   * once the d1 backend lands.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d1Database?: any;
}

/**
 * Create a `FhirStore` for the requested backend.
 *
 * @param backend  Backend name (e.g. 'sqlite'). Matches the
 *                 `STORE_BACKEND` env var.
 * @param options  Backend-specific options.
 *
 * @throws If the backend name is unknown or the backend cannot be loaded
 *         (e.g. asking for 'sqlite' from a Workers bundle).
 */
export async function createStore(
  backend: string,
  options: CreateStoreOptions = {},
): Promise<FhirStore> {
  switch (backend) {
    case 'sqlite': {
      // Dynamic import so Workers bundles can tree-shake / exclude this path.
      const mod = await import('./sqliteStore');
      return new mod.SqliteStore(options.sqliteDbPath, {
        dateOffsetProvider: options.dateOffsetProvider,
      });
    }
    case 'd1': {
      // Cloudflare D1 backend. Used by `src/worker.ts`.
      // The d1Database binding comes from the Workers `env.DB` (or
      // whatever name is configured in `wrangler.toml`).
      if (!options.d1Database) {
        throw new Error(
          "Store backend 'd1' requires options.d1Database (the D1 binding from env). " +
          'See docs/CLOUDFLARE_WORKERS.md.',
        );
      }
      const mod = await import('./d1Store');
      return new mod.D1Store(options.d1Database, {
        dateOffsetProvider: options.dateOffsetProvider,
      });
    }
    default:
      throw new Error(`Unsupported store backend: ${backend}`);
  }
}
