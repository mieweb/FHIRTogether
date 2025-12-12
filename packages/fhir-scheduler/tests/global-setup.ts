/**
 * Playwright Global Setup
 * 
 * Ensures test data exists before running tests.
 * If the database is empty or doesn't exist, imports seed data from JSONL files.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup() {
  const projectRoot = path.resolve(__dirname, '../../..');
  const dbPath = path.join(projectRoot, 'data', 'fhirtogether.db');
  const seedSchedulesPath = path.join(projectRoot, 'data', 'seed-schedules.jsonl');
  
  // Check if database exists and seed data is available
  const dbExists = existsSync(dbPath);
  const seedDataExists = existsSync(seedSchedulesPath);
  
  if (!dbExists && seedDataExists) {
    console.log('🔧 Database not found, importing seed data...');
    
    try {
      // Import seed data from JSONL files
      execSync('npm run import-seed', {
        cwd: projectRoot,
        stdio: 'inherit',
      });
      console.log('✅ Seed data imported successfully');
    } catch (error) {
      console.error('❌ Failed to import seed data:', error);
      throw error;
    }
  } else if (!dbExists && !seedDataExists) {
    console.log('🔧 No database or seed data, generating fresh data...');
    
    try {
      // Generate fresh data
      execSync('npm run generate-data', {
        cwd: projectRoot,
        stdio: 'inherit',
      });
      console.log('✅ Test data generated successfully');
    } catch (error) {
      console.error('❌ Failed to generate test data:', error);
      throw error;
    }
  } else {
    console.log('✅ Test database already exists');
  }
}
