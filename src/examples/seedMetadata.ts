/**
 * Seed-metadata helper (Node only).
 *
 * The demo-data generator writes a `seed-metadata.json` file alongside the
 * seed JSONL files recording the date on which the seed data was generated.
 * On import (and inside `SqliteStore.getSlots`) we use that date to shift
 * all seed timestamps forward so the demo data always looks "current."
 *
 * This module is intentionally **filesystem-bound and Node-only**. It used
 * to live inside `SqliteStore`, but seed metadata is a deployment concern,
 * not a storage concern — D1, Mongo, Postgres backends shouldn't have to
 * implement it.
 */
import * as fs from 'fs';
import * as path from 'path';

const METADATA_FILENAME = 'seed-metadata.json';

interface SeedMetadata {
  generationDate?: string;
  description?: string;
  note?: string;
}

function metadataPath(dataDir: string): string {
  return path.join(dataDir, METADATA_FILENAME);
}

/** Read the seed-data generation date from `<dataDir>/seed-metadata.json`. */
export function getGenerationDate(dataDir: string): string | null {
  const file = metadataPath(dataDir);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as SeedMetadata;
      return data.generationDate || null;
    }
  } catch {
    // Ignore parse errors — treat as "no metadata"
  }
  return null;
}

/** Write the seed-data generation date to `<dataDir>/seed-metadata.json`. */
export function setGenerationDate(dataDir: string, date: string): void {
  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const metadata: SeedMetadata = {
    generationDate: date,
    description: 'Seed data generation metadata - commit this file to git',
    note: 'Dates in slots/appointments are shifted by (today - generationDate) days',
  };
  fs.writeFileSync(metadataPath(dataDir), JSON.stringify(metadata, null, 2) + '\n');
}

/**
 * Number of days to shift seed timestamps so they line up with today.
 * Returns 0 when no metadata file is present (i.e. real data, not seed data).
 */
export function getDateOffsetDays(dataDir: string): number {
  const generationDate = getGenerationDate(dataDir);
  if (!generationDate) return 0;

  const genDate = new Date(generationDate);
  const today = new Date();

  // Reset time to start of day for accurate day calculation
  genDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffMs = today.getTime() - genDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
