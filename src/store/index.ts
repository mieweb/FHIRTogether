/**
 * Store Factory — creates the right FhirStore implementation from config.
 *
 * Usage:
 *   const store = createStore({ backend: 'sqlite' });
 *   const store = createStore({ backend: 'webchart', baseUrl, username, password });
 */

import { FhirStore, StoreConfig } from '../types/fhir';
import { SqliteStore } from './sqliteStore';
import { WebChartStore } from './webchartStore';

/**
 * Create and return a FhirStore instance based on the config.
 * Does NOT call initialize() — caller is responsible for that.
 */
export function createStore(config: StoreConfig): FhirStore {
  switch (config.backend) {
    case 'sqlite': {
      const dbPath = (config.dbPath as string) || undefined;
      return new SqliteStore(dbPath);
    }

    case 'webchart': {
      const baseUrl = config.baseUrl as string;
      const username = config.username as string;
      const password = config.password as string;
      if (!baseUrl || !username || !password) {
        throw new Error(
          'backend=webchart requires baseUrl, username, and password in config'
        );
      }
      return new WebChartStore({
        baseUrl,
        username,
        password,
        defaultLocation: (config.defaultLocation as string) || '0',
        timezone: config.timezone as string | undefined,
      });
    }

    default:
      throw new Error(`Unsupported store backend: ${config.backend}`);
  }
}

export { SqliteStore } from './sqliteStore';
export { WebChartStore, WebChartConfig } from './webchartStore';
