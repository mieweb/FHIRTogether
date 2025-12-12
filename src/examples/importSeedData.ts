/**
 * Import Seed Data
 * 
 * Imports seed data from JSONL files into the SQLite database.
 * This ensures consistent, deterministic test data across all environments.
 * 
 * Usage:
 *   npm run import-seed-data
 *   
 * Or programmatically:
 *   import { importSeedData } from './importSeedData';
 *   await importSeedData(store);
 */

import { SqliteStore } from '../store/sqliteStore';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface SeedDataPaths {
  schedules: string;
  slots: string;
  appointments: string;
  metadata: string;
}

function getSeedDataPaths(dataDir: string): SeedDataPaths {
  return {
    schedules: path.join(dataDir, 'seed-schedules.jsonl'),
    slots: path.join(dataDir, 'seed-slots.jsonl'),
    appointments: path.join(dataDir, 'seed-appointments.jsonl'),
    metadata: path.join(dataDir, 'seed-metadata.json'),
  };
}

/**
 * Check if seed data files exist
 */
export function seedDataExists(dataDir: string = './data'): boolean {
  const paths = getSeedDataPaths(dataDir);
  return (
    fs.existsSync(paths.schedules) &&
    fs.existsSync(paths.slots) &&
    fs.existsSync(paths.appointments) &&
    fs.existsSync(paths.metadata)
  );
}

/**
 * Read JSONL file line by line and parse each line as JSON
 */
async function readJsonlFile(filePath: string): Promise<any[]> {
  const results: any[] = [];
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  
  for await (const line of rl) {
    if (line.trim()) {
      results.push(JSON.parse(line));
    }
  }
  
  return results;
}

/**
 * Import seed data into the database
 */
export async function importSeedData(store: SqliteStore, dataDir: string = './data'): Promise<void> {
  const paths = getSeedDataPaths(dataDir);
  
  if (!seedDataExists(dataDir)) {
    throw new Error(`Seed data files not found in ${dataDir}. Run 'npm run generate-data' first.`);
  }
  
  console.log('📦 Importing seed data...');
  
  // Clear existing data
  await store.deleteAllAppointments();
  await store.deleteAllSlots();
  await store.deleteAllSchedules();
  
  // Import schedules
  const schedules = await readJsonlFile(paths.schedules);
  for (const row of schedules) {
    await store.importScheduleRow(row);
  }
  console.log(`  ✓ Imported ${schedules.length} schedules`);
  
  // Import slots
  const slots = await readJsonlFile(paths.slots);
  for (const row of slots) {
    await store.importSlotRow(row);
  }
  console.log(`  ✓ Imported ${slots.length} slots`);
  
  // Import appointments
  const appointments = await readJsonlFile(paths.appointments);
  for (const row of appointments) {
    await store.importAppointmentRow(row);
  }
  console.log(`  ✓ Imported ${appointments.length} appointments`);
  
  console.log('✅ Seed data import complete');
}

/**
 * Main function for CLI usage
 */
async function main() {
  console.log('🌱 FHIRTogether Seed Data Importer\n');
  
  const dbPath = process.env.SQLITE_DB_PATH || './data/fhirtogether.db';
  const dataDir = path.dirname(dbPath);
  const store = new SqliteStore(dbPath);
  
  try {
    await store.initialize();
    await importSeedData(store, dataDir);
  } catch (error) {
    console.error('❌ Error importing seed data:', error);
    process.exit(1);
  } finally {
    await store.close();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
