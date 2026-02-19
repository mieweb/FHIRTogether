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
 * Shift an ISO datetime string forward by a number of days.
 * Handles naive ISO strings (no timezone) by parsing/formatting
 * with local-time components to avoid UTC conversion issues.
 */
function shiftDateString(isoDate: string, offsetDays: number): string {
  if (!isoDate || offsetDays === 0) return isoDate;

  // Parse components directly to avoid timezone issues with Date constructor
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return isoDate;

  const date = new Date(
    parseInt(match[1], 10),
    parseInt(match[2], 10) - 1,
    parseInt(match[3], 10),
    match[4] ? parseInt(match[4], 10) : 0,
    match[5] ? parseInt(match[5], 10) : 0,
    match[6] ? parseInt(match[6], 10) : 0,
  );
  date.setDate(date.getDate() + offsetDays);

  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');

  // Preserve original format: date-only vs datetime
  return match[4] ? `${y}-${mo}-${d}T${h}:${mi}:${s}` : `${y}-${mo}-${d}`;
}

/**
 * Import seed data into the database.
 *
 * Date shifting (to keep demo data current) is applied here at import
 * time rather than at read time.  This ensures that real data created
 * through the API or HL7 is never accidentally shifted.
 */
export async function importSeedData(store: SqliteStore, dataDir: string = './data'): Promise<void> {
  const paths = getSeedDataPaths(dataDir);
  
  if (!seedDataExists(dataDir)) {
    throw new Error(`Seed data files not found in ${dataDir}. Run 'npm run generate-data' first.`);
  }
  
  console.log('📦 Importing seed data...');

  // Calculate the date offset so seed data dates are shifted to today
  const offsetDays = store.getDateOffsetDays();
  if (offsetDays !== 0) {
    console.log(`  ⏩ Shifting seed dates by ${offsetDays} day(s) to align with today`);
  }
  
  // Clear existing data
  await store.deleteAllAppointments();
  await store.deleteAllSlots();
  await store.deleteAllSchedules();
  
  // Import schedules (shift planning horizon dates)
  const schedules = await readJsonlFile(paths.schedules);
  for (const row of schedules) {
    if (row.planning_horizon_start) row.planning_horizon_start = shiftDateString(row.planning_horizon_start, offsetDays);
    if (row.planning_horizon_end) row.planning_horizon_end = shiftDateString(row.planning_horizon_end, offsetDays);
    await store.importScheduleRow(row);
  }
  console.log(`  ✓ Imported ${schedules.length} schedules`);
  
  // Import slots (shift start/end dates)
  const slots = await readJsonlFile(paths.slots);
  for (const row of slots) {
    if (row.start) row.start = shiftDateString(row.start, offsetDays);
    if (row.end) row.end = shiftDateString(row.end, offsetDays);
    await store.importSlotRow(row);
  }
  console.log(`  ✓ Imported ${slots.length} slots`);
  
  // Import appointments (shift start/end dates)
  const appointments = await readJsonlFile(paths.appointments);
  for (const row of appointments) {
    if (row.start) row.start = shiftDateString(row.start, offsetDays);
    if (row.end) row.end = shiftDateString(row.end, offsetDays);
    await store.importAppointmentRow(row);
  }
  console.log(`  ✓ Imported ${appointments.length} appointments`);

  // Update the generation date to today so offset becomes 0 for future reads
  if (offsetDays !== 0) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00`;
    store.setGenerationDate(todayStr);
    console.log(`  ✓ Updated generation date to ${todayStr}`);
  }
  
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
