/**
 * Store Factory - Creates backend store instances based on configuration
 */

import { FhirStore } from './interface';
import { SimulatorStore } from './simulatorStore';
import { MongoStore } from './mongoStore';
import { PostgresStore } from './postgresStore';
import { MySQLStore } from './mysqlStore';
import { MSSQLStore } from './mssqlStore';

export type StoreBackend = 'simulator' | 'mongodb' | 'postgres' | 'mysql' | 'mssql';

export class StoreFactory {
  static createStore(backend: StoreBackend): FhirStore {
    switch (backend) {
      case 'simulator':
        return new SimulatorStore();
      case 'mongodb':
        return new MongoStore();
      case 'postgres':
        return new PostgresStore();
      case 'mysql':
        return new MySQLStore();
      case 'mssql':
        return new MSSQLStore();
      default:
        throw new Error(`Unknown store backend: ${backend}`);
    }
  }
}

// Global store instance
let storeInstance: FhirStore | null = null;

export function getStore(): FhirStore {
  if (!storeInstance) {
    const backend = (process.env.STORE_BACKEND as StoreBackend) || 'simulator';
    storeInstance = StoreFactory.createStore(backend);
    console.log(`Initialized ${backend} store`);
  }
  return storeInstance;
}

export function resetStore(): void {
  storeInstance = null;
}