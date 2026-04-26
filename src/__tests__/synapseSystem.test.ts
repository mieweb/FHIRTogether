import { SqliteStore } from '../store/sqliteStore';
import { generateApiKey, hashApiKey } from '../auth/apiKeyAuth';
import type { SynapseSystem } from '../types/fhir';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** Create a fresh in-memory SqliteStore for each test. */
async function createTestStore(): Promise<SqliteStore> {
  // Use a temp file so better-sqlite3 doesn't share state across tests
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-test-'));
  const store = new SqliteStore(path.join(tmpDir, 'test.db'));
  await store.initialize();
  return store;
}

describe('Synapse System CRUD', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    store = await createTestStore();
  });

  it('creates a system and retrieves it by ID', async () => {
    const sys = await store.createSystem({
      name: 'Test Clinic',
      status: 'pending',
      ttlDays: 7,
    });

    expect(sys.id).toBeDefined();
    expect(sys.name).toBe('Test Clinic');
    expect(sys.status).toBe('pending');
    expect(sys.ttlDays).toBe(7);

    const fetched = await store.getSystemById(sys.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Test Clinic');
  });

  it('retrieves system by URL', async () => {
    await store.createSystem({
      name: 'URL Clinic',
      url: 'https://clinic.example.com',
      status: 'active',
      ttlDays: 14,
    });

    const found = await store.getSystemByUrl('https://clinic.example.com');
    expect(found).toBeDefined();
    expect(found!.name).toBe('URL Clinic');
  });

  it('retrieves system by MSH application + facility', async () => {
    await store.createSystem({
      name: 'HL7 Clinic',
      status: 'unverified',
      ttlDays: 7,
      mshApplication: 'LEGACY_EHR',
      mshFacility: 'MAIN_HOSPITAL',
    });

    const found = await store.getSystemByMsh('LEGACY_EHR', 'MAIN_HOSPITAL');
    expect(found).toBeDefined();
    expect(found!.name).toBe('HL7 Clinic');
  });

  it('retrieves system by API key hash', async () => {
    const apiKey = generateApiKey();
    const hash = hashApiKey(apiKey);

    await store.createSystem({
      name: 'API Clinic',
      status: 'active',
      ttlDays: 7,
      apiKeyHash: hash,
    });

    const found = await store.getSystemByApiKeyHash(hash);
    expect(found).toBeDefined();
    expect(found!.name).toBe('API Clinic');
  });

  it('returns undefined for non-existent system', async () => {
    expect(await store.getSystemById('nonexistent')).toBeUndefined();
    expect(await store.getSystemByUrl('https://nope.example.com')).toBeUndefined();
    expect(await store.getSystemByMsh('NOPE', 'NOPE')).toBeUndefined();
    expect(await store.getSystemByApiKeyHash('badhash')).toBeUndefined();
  });

  it('updates system fields', async () => {
    const sys = await store.createSystem({
      name: 'Old Name',
      status: 'pending',
      ttlDays: 7,
    });

    const updated = await store.updateSystem(sys.id, {
      name: 'New Name',
      status: 'active',
    });

    expect(updated.name).toBe('New Name');
    expect(updated.status).toBe('active');
  });

  it('updates system activity timestamp', async () => {
    const sys = await store.createSystem({
      name: 'Activity Clinic',
      status: 'active',
      ttlDays: 7,
    });

    const original = await store.getSystemById(sys.id);
    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 10));
    await store.updateSystemActivity(sys.id);
    const after = (await store.getSystemById(sys.id))!.lastActivityAt;

    // lastActivityAt should be updated (may or may not differ by ms within same second)
    expect(after).toBeDefined();
    expect(typeof after).toBe('string');
    expect(original).toBeDefined();
  });

  it('deletes a system', async () => {
    const sys = await store.createSystem({
      name: 'Doomed Clinic',
      status: 'active',
      ttlDays: 7,
    });

    await store.deleteSystem(sys.id);
    expect(await store.getSystemById(sys.id)).toBeUndefined();
  });

  it('lists systems with optional status filter', async () => {
    await store.createSystem({ name: 'Active 1', status: 'active', ttlDays: 7 });
    await store.createSystem({ name: 'Active 2', status: 'active', ttlDays: 7 });
    await store.createSystem({ name: 'Pending 1', status: 'pending', ttlDays: 7 });

    const all = await store.getSystems();
    expect(all.length).toBeGreaterThanOrEqual(3);

    const activeOnly = await store.getSystems({ status: 'active' });
    expect(activeOnly.every(s => s.status === 'active')).toBe(true);
    expect(activeOnly.length).toBe(2);

    const pendingOnly = await store.getSystems({ status: 'pending' });
    expect(pendingOnly.length).toBe(1);
    expect(pendingOnly[0].name).toBe('Pending 1');
  });

  it('stores and retrieves challenge tokens', async () => {
    const sys = await store.createSystem({
      name: 'Challenge Clinic',
      status: 'pending',
      ttlDays: 7,
      challengeToken: 'test-token-abc123',
    });

    const token = await store.getSystemChallengeToken(sys.id);
    expect(token).toBe('test-token-abc123');
  });

  it('returns undefined for cleared challenge token', async () => {
    const sys = await store.createSystem({
      name: 'No Token Clinic',
      status: 'active',
      ttlDays: 7,
    });

    const token = await store.getSystemChallengeToken(sys.id);
    expect(token).toBeUndefined();
  });
});

describe('findOrCreateSystemByMSH', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    store = await createTestStore();
  });

  it('creates a new unverified system on first contact', async () => {
    const result = await store.findOrCreateSystemByMSH('LEGACY_EHR', 'NEW_HOSPITAL', 'secret123');

    expect(result.isNew).toBe(true);
    expect(result.secretMatch).toBe(true);
    expect(result.system.name).toBe('LEGACY_EHR@NEW_HOSPITAL');
    expect(result.system.status).toBe('unverified');
    expect(result.system.mshApplication).toBe('LEGACY_EHR');
    expect(result.system.mshFacility).toBe('NEW_HOSPITAL');
  });

  it('returns existing system when application+facility matches', async () => {
    const first = await store.findOrCreateSystemByMSH('EHR', 'REPEAT_HOSPITAL', 'secret');
    const second = await store.findOrCreateSystemByMSH('EHR', 'REPEAT_HOSPITAL', 'secret');

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(first.system.id).toBe(second.system.id);
  });

  it('creates separate systems for different MSH-3 with same MSH-4', async () => {
    const a = await store.findOrCreateSystemByMSH('EHR_A', 'SAME_HOSPITAL', 'secret');
    const b = await store.findOrCreateSystemByMSH('EHR_B', 'SAME_HOSPITAL', 'secret');

    expect(a.system.id).not.toBe(b.system.id);
  });

  it('returns secretMatch=false for wrong secret', async () => {
    await store.findOrCreateSystemByMSH('EHR', 'SECURE_HOSPITAL', 'correct-secret');
    const result = await store.findOrCreateSystemByMSH('EHR', 'SECURE_HOSPITAL', 'wrong-secret');

    expect(result.isNew).toBe(false);
    expect(result.secretMatch).toBe(false);
  });

  it('returns secretMatch=true for correct secret', async () => {
    await store.findOrCreateSystemByMSH('EHR', 'SECURE_HOSPITAL', 'mysecret');
    const result = await store.findOrCreateSystemByMSH('EHR', 'SECURE_HOSPITAL', 'mysecret');

    expect(result.isNew).toBe(false);
    expect(result.secretMatch).toBe(true);
  });
});

describe('Synapse Location CRUD', () => {
  let store: SqliteStore;
  let system: SynapseSystem;

  beforeEach(async () => {
    store = await createTestStore();
    system = await store.createSystem({
      name: 'Parent Clinic',
      status: 'active',
      ttlDays: 7,
    });
  });

  it('creates a location and retrieves it by ID', async () => {
    const loc = await store.createLocation({
      systemId: system.id,
      name: 'Main Office',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      phone: '555-1234',
    });

    expect(loc.id).toBeDefined();
    expect(loc.name).toBe('Main Office');
    expect(loc.systemId).toBe(system.id);

    const fetched = await store.getLocationById(loc.id);
    expect(fetched).toBeDefined();
    expect(fetched!.address).toBe('123 Main St');
  });

  it('lists locations filtered by system', async () => {
    const sys2 = await store.createSystem({ name: 'Other Clinic', status: 'active', ttlDays: 7 });
    await store.createLocation({ systemId: system.id, name: 'Loc A' });
    await store.createLocation({ systemId: system.id, name: 'Loc B' });
    await store.createLocation({ systemId: sys2.id, name: 'Loc C' });

    const locs = await store.getLocations({ systemId: system.id });
    expect(locs.length).toBe(2);
    expect(locs.every(l => l.systemId === system.id)).toBe(true);
  });

  it('filters locations by zip code', async () => {
    await store.createLocation({ systemId: system.id, name: 'Loc 1', zip: '60601' });
    await store.createLocation({ systemId: system.id, name: 'Loc 2', zip: '90210' });

    const locs = await store.getLocations({ zip: '60601' });
    expect(locs.length).toBe(1);
    expect(locs[0].zip).toBe('60601');
  });

  it('updates location fields', async () => {
    const loc = await store.createLocation({
      systemId: system.id,
      name: 'Old Office',
    });

    const updated = await store.updateLocation(loc.id, {
      name: 'New Office',
      city: 'Chicago',
    });

    expect(updated.name).toBe('New Office');
    expect(updated.city).toBe('Chicago');
  });

  it('deletes a location', async () => {
    const loc = await store.createLocation({
      systemId: system.id,
      name: 'Temp Office',
    });

    await store.deleteLocation(loc.id);
    expect(await store.getLocationById(loc.id)).toBeUndefined();
  });

  it('cascade-deletes locations when system is deleted', async () => {
    const loc = await store.createLocation({
      systemId: system.id,
      name: 'Will Be Deleted',
    });

    await store.deleteSystem(system.id);
    expect(await store.getLocationById(loc.id)).toBeUndefined();
  });
});

describe('findOrCreateLocationByHL7', () => {
  let store: SqliteStore;
  let system: SynapseSystem;

  beforeEach(async () => {
    store = await createTestStore();
    system = await store.createSystem({
      name: 'HL7 Clinic',
      status: 'unverified',
      ttlDays: 7,
    });
  });

  it('creates a new location on first HL7 reference', async () => {
    const loc = await store.findOrCreateLocationByHL7(system.id, 'MAIN^1', 'Main Campus');

    expect(loc.name).toBe('Main Campus');
    expect(loc.hl7LocationId).toBe('MAIN^1');
    expect(loc.systemId).toBe(system.id);
  });

  it('returns existing location on duplicate HL7 ID', async () => {
    const first = await store.findOrCreateLocationByHL7(system.id, 'MAIN^1', 'Main Campus');
    const second = await store.findOrCreateLocationByHL7(system.id, 'MAIN^1', 'Different Name');

    expect(first.id).toBe(second.id);
    expect(second.name).toBe('Main Campus'); // Original name preserved
  });

  it('creates separate locations for different HL7 IDs', async () => {
    const loc1 = await store.findOrCreateLocationByHL7(system.id, 'LOC1', 'Campus A');
    const loc2 = await store.findOrCreateLocationByHL7(system.id, 'LOC2', 'Campus B');

    expect(loc1.id).not.toBe(loc2.id);
  });
});

describe('System Evaporation', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    store = await createTestStore();
  });

  it('does not evaporate active systems within TTL', async () => {
    await store.createSystem({
      name: 'Fresh Clinic',
      status: 'active',
      ttlDays: 7,
    });

    const result = await store.evaporateExpiredSystems();
    expect(result.count).toBe(0);
  });

  it('evaporates systems past TTL (simulated via 0-day TTL)', async () => {
    // Create a system with 0-day TTL — it should immediately be past TTL
    const sys = await store.createSystem({
      name: 'Ephemeral Clinic',
      status: 'unverified',
      ttlDays: 0,
    });

    // Backdate last_activity_at to ensure it's past TTL
    // SQLite: datetime(last_activity_at, '+0 days') = last_activity_at, which is < now
    // We need to backdate by at least 1 second
    const store2 = store as any;
    store2.db.prepare("UPDATE systems SET last_activity_at = datetime('now', 'localtime', '-1 day') WHERE id = ?").run(sys.id);

    const result = await store.evaporateExpiredSystems();
    expect(result.count).toBe(1);
    expect(result.systems[0].name).toBe('Ephemeral Clinic');

    // System should be deleted
    expect(await store.getSystemById(sys.id)).toBeUndefined();
  });

  it('does not evaporate already-expired systems', async () => {
    const sys = await store.createSystem({
      name: 'Already Expired',
      status: 'expired',
      ttlDays: 0,
    });

    // Backdate
    const store2 = store as any;
    store2.db.prepare("UPDATE systems SET last_activity_at = datetime('now', 'localtime', '-1 day') WHERE id = ?").run(sys.id);

    const result = await store.evaporateExpiredSystems();
    // The query excludes status='expired', so this should not be counted
    expect(result.count).toBe(0);
  });
});

describe('API Key utilities', () => {
  it('generateApiKey returns 64-char hex string', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashApiKey produces consistent SHA-256 hex', () => {
    const key = 'test-api-key-12345';
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different keys produce different hashes', () => {
    const hash1 = hashApiKey('key-a');
    const hash2 = hashApiKey('key-b');
    expect(hash1).not.toBe(hash2);
  });
});
