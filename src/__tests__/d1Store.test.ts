/**
 * D1Store contract smoke tests.
 *
 * Exercises a subset of the `FhirStore` contract against `D1Store` using
 * an in-memory better-sqlite3 wrapped in a D1-shaped adapter (`fakeD1`).
 * This is the "shared contract test suite" called out in
 * `docs/CLOUDFLARE_WORKERS.md` — it proves that the D1 port works
 * end-to-end without needing Miniflare or a live Workers runtime.
 *
 * The full `SqliteStore` test suite (`synapseSystem.test.ts`,
 * `bookingLifecycle.test.ts`) covers the FhirStore contract in depth
 * against the SQLite backend; this file covers the D1 backend.
 */
import { D1Store } from '../store/d1Store';
import { createTestD1Database, FakeD1Database } from './fakeD1';
import type { Schedule } from '../types/fhir';

/** Schedule with the extra system_id / location_id fields that the store accepts on create. */
type ScheduleInput = Schedule & { system_id?: string; location_id?: string };

async function createTestStore(): Promise<{ store: D1Store; close: () => void; d1: FakeD1Database }> {
  const { d1, close } = createTestD1Database();
  const store = new D1Store(
    // The FakeD1Database matches the structural D1Database type used by D1Store
    d1 as unknown as ConstructorParameters<typeof D1Store>[0],
  );
  return { store, close, d1 };
}

describe('D1Store contract', () => {
  describe('initialize', () => {
    it('reports schema_version match when migrations are applied', async () => {
      const { store, close } = await createTestStore();
      const status = await store.initialize();
      expect(status.current).toBe(5);
      expect(status.expected).toBe(5);
      expect(status.match).toBe(true);
      expect(status.migrated).toBe(false); // D1 never migrates inline
      close();
    });
  });

  describe('Synapse System CRUD', () => {
    it('creates, fetches, updates, deletes a system', async () => {
      const { store, close } = await createTestStore();

      const created = await store.createSystem({
        name: 'Test Clinic',
        status: 'pending',
        ttlDays: 7,
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Test Clinic');

      const fetched = await store.getSystemById(created.id);
      expect(fetched?.name).toBe('Test Clinic');

      const updated = await store.updateSystem(created.id, { name: 'Renamed', status: 'active' });
      expect(updated.name).toBe('Renamed');
      expect(updated.status).toBe('active');

      await store.deleteSystem(created.id);
      const gone = await store.getSystemById(created.id);
      expect(gone).toBeUndefined();

      close();
    });

    it('findOrCreateSystemByMSH creates then re-finds with secret match', async () => {
      const { store, close } = await createTestStore();

      const first = await store.findOrCreateSystemByMSH('TESTAPP', 'TESTFAC', 'sekret');
      expect(first.isNew).toBe(true);
      expect(first.secretMatch).toBe(true);
      expect(first.apiKey).toBeDefined();

      const second = await store.findOrCreateSystemByMSH('TESTAPP', 'TESTFAC', 'sekret');
      expect(second.isNew).toBe(false);
      expect(second.secretMatch).toBe(true);
      expect(second.system.id).toBe(first.system.id);

      const wrongSecret = await store.findOrCreateSystemByMSH('TESTAPP', 'TESTFAC', 'wrong');
      expect(wrongSecret.isNew).toBe(false);
      expect(wrongSecret.secretMatch).toBe(false);

      close();
    });
  });

  describe('Schedule + Slot lifecycle', () => {
    it('creates a schedule with system+location refs, adds slots, queries them', async () => {
      const { store, close } = await createTestStore();

      const system = await store.createSystem({ name: 'Sys', status: 'active', ttlDays: 30 });
      const location = await store.createLocation({ systemId: system.id, name: 'Main Office' });

      const sched = await store.createSchedule({
        resourceType: 'Schedule',
        active: true,
        actor: [{ reference: 'Practitioner/dr-smith', display: 'Dr. Smith' }],
        planningHorizon: { start: '2026-01-01', end: '2026-12-31' },
        system_id: system.id,
        location_id: location.id,
      } as ScheduleInput);

      expect(sched.id).toBeDefined();

      await store.createSlots([
        {
          resourceType: 'Slot',
          schedule: { reference: `Schedule/${sched.id}` },
          status: 'free',
          start: '2026-02-01T09:00:00',
          end: '2026-02-01T09:30:00',
        },
        {
          resourceType: 'Slot',
          schedule: { reference: `Schedule/${sched.id}` },
          status: 'free',
          start: '2026-02-01T09:30:00',
          end: '2026-02-01T10:00:00',
        },
      ]);

      const slots = await store.getSlots({ schedule: `Schedule/${sched.id}` });
      expect(slots).toHaveLength(2);
      expect(slots[0].status).toBe('free');

      close();
    });
  });

  describe('Slot holds', () => {
    it('places, retrieves, and releases a hold', async () => {
      const { store, close } = await createTestStore();

      const system = await store.createSystem({ name: 'Sys', status: 'active', ttlDays: 30 });
      const sched = await store.createSchedule({
        resourceType: 'Schedule',
        active: true,
        actor: [{ reference: 'Practitioner/x' }],
        system_id: system.id,
      } as ScheduleInput);

      const slot = await store.createSlot({
        resourceType: 'Slot',
        schedule: { reference: `Schedule/${sched.id}` },
        status: 'free',
        start: '2026-02-01T09:00:00',
        end: '2026-02-01T09:30:00',
      });

      const hold = await store.holdSlot(slot.id!, 'session-abc', 5);
      expect(hold.holdToken).toBeDefined();
      expect(hold.sessionId).toBe('session-abc');

      const active = await store.getActiveHold(slot.id!);
      expect(active?.holdToken).toBe(hold.holdToken);

      await store.releaseHold(hold.holdToken);
      const afterRelease = await store.getActiveHold(slot.id!);
      expect(afterRelease).toBeNull();

      close();
    });
  });

  describe('HL7 message log', () => {
    it('logs, queries, and cleans up messages', async () => {
      const { store, close } = await createTestStore();

      await store.logHL7Message({
        receivedAt: '2026-01-01T00:00:00',
        source: 'http',
        rawMessage: 'MSH|^~\\&|...|',
        messageType: 'SIU^S12',
        ackCode: 'AA',
      });

      const log = await store.getHL7MessageLog({ source: 'http' });
      expect(log).toHaveLength(1);
      expect(log[0].messageType).toBe('SIU^S12');

      // Cleanup with retention=0 should delete everything older than "now"
      const deleted = await store.cleanupHL7MessageLog(0);
      expect(deleted).toBeGreaterThanOrEqual(1);

      close();
    });
  });
});
