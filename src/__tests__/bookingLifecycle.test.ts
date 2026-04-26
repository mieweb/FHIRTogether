/**
 * End-to-end booking lifecycle integration test
 *
 * Spins up a fresh FHIRTogether server with an empty database and exercises
 * the complete flow:
 *   1. HL7 SIU^S12 → auto-register system, get API key + schedule ref
 *   2. Create free slots using the API key
 *   3. Hold a slot (no auth — patient-facing)
 *   4. Book an appointment (no auth — patient-facing), slot becomes busy
 *   5. Attempt to hold the same slot again → fails (slot is busy)
 *   6. Verify the other slot is still free
 *
 * This test would have caught the auth bug where POST /Slot/$hold and
 * POST /Appointment were blocked by the API key middleware.
 */

import { buildServer } from '../server';
import type { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AddressInfo } from 'net';

let fastify: FastifyInstance;
let baseUrl: string;
let tmpDir: string;

// Shared state across sequential tests
let apiKey: string;
let scheduleRef: string;   // e.g. "Schedule/schedule-1"
let slot1Id: string;
let slot2Id: string;

const FUTURE_DATE = '2027-06-15';
const FACILITY = `E2E_CLINIC_${Date.now()}`;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-lifecycle-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'test.db');
  process.env.ENABLE_TEST_ENDPOINTS = 'true';
  process.env.LOG_LEVEL = 'error'; // quiet during tests
  process.env.HL7_SOCKET_ENABLED = 'false'; // don't open MLLP port

  const result = await buildServer();
  fastify = result.fastify;
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 15000);

afterAll(async () => {
  await fastify.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── 1. HL7 auto-registration ────────────────────────────

describe('Booking Lifecycle', () => {
  it('HL7 SIU^S12 auto-registers system and creates schedule', async () => {
    const hl7 = [
      `MSH|^~\\&|TEST_EHR|${FACILITY}|FHIRTOGETHER|SCHEDULING_GATEWAY|20270615120000||SIU^S12|CTRL001|P|2.3`,
      'SCH|50001^50001|50001^50001|||50001|OFFICE^Office visit|Checkup|OFFICE|30|m|^^30^20270615090000^20270615093000|||||||||||||BOOKED',
      'PID|1||99901||TestPatient^Alice||19900101|F|||1 Test St^^Testville^TS^00000||(555)000-1111',
      'PV1|1|O|OFFICE^^^Test Office||||100^TestDoc^Bob^C|||Family Medicine',
      'RGS|1|A',
      'AIG|1|A|100^TestDoc^Bob^C|Family Medicine',
      'AIL|1|A|OFFICE^^^Test Office||||20270615090000|30|m',
      'AIP|1|A|100^TestDoc^Bob^C|Family Medicine||20270615090000|30|m',
    ].join('\r');

    const res = await fetch(`${baseUrl}/hl7/siu`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: hl7,
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('MSA|AA|');

    // Capture API key and schedule reference
    apiKey = res.headers.get('x-api-key')!;
    scheduleRef = res.headers.get('x-schedule-ref')!;

    expect(apiKey).toBeTruthy();
    expect(scheduleRef).toMatch(/^Schedule\//);
  });

  // ── 2. Create free slots ────────────────────────────────

  it('creates free slots using the API key', async () => {
    const scheduleId = scheduleRef; // "Schedule/schedule-1"

    // Slot 1: 9:00-9:30
    const res1 = await fetch(`${baseUrl}/Slot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        resourceType: 'Slot',
        schedule: { reference: scheduleId },
        status: 'free',
        start: `${FUTURE_DATE}T14:00:00Z`,
        end: `${FUTURE_DATE}T14:30:00Z`,
      }),
    });
    expect(res1.status).toBe(201);
    const slot1 = await res1.json() as Record<string, unknown>;
    slot1Id = slot1.id as string;
    expect(slot1Id).toBeTruthy();

    // Slot 2: 9:30-10:00
    const res2 = await fetch(`${baseUrl}/Slot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        resourceType: 'Slot',
        schedule: { reference: scheduleId },
        status: 'free',
        start: `${FUTURE_DATE}T14:30:00Z`,
        end: `${FUTURE_DATE}T15:00:00Z`,
      }),
    });
    expect(res2.status).toBe(201);
    const slot2 = await res2.json() as Record<string, unknown>;
    slot2Id = slot2.id as string;
    expect(slot2Id).toBeTruthy();
  });

  // ── 3. Hold a slot (no auth) ────────────────────────────

  it('holds a slot without auth', async () => {
    const res = await fetch(`${baseUrl}/Slot/${slot1Id}/$hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test-session-1', durationMinutes: 5 }),
    });

    expect(res.status).toBe(200);
    const hold = await res.json() as Record<string, unknown>;
    expect(hold.holdToken).toBeTruthy();
    expect(hold.status).toBe('held');
    expect(hold.expiresAt).toBeTruthy();
  });

  // ── 4. Book appointment (no auth), slot becomes busy ───

  it('books appointment without auth and slot becomes busy', async () => {
    const res = await fetch(`${baseUrl}/Appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceType: 'Appointment',
        status: 'booked',
        description: 'Follow-up visit',
        start: `${FUTURE_DATE}T14:00:00Z`,
        end: `${FUTURE_DATE}T14:30:00Z`,
        slot: [{ reference: `Slot/${slot1Id}` }],
        participant: [
          {
            actor: { reference: 'Practitioner/100', display: 'Bob C TestDoc' },
            status: 'accepted',
          },
          {
            actor: { reference: 'Patient/99901', display: 'Alice TestPatient' },
            status: 'accepted',
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const appt = await res.json() as Record<string, unknown>;
    expect(appt.id).toBeTruthy();
    expect(appt.status).toBe('booked');

    // Verify slot is now busy
    const slotRes = await fetch(`${baseUrl}/Slot/${slot1Id}`);
    expect(slotRes.status).toBe(200);
    const slot = await slotRes.json() as Record<string, unknown>;
    expect(slot.status).toBe('busy');
  });

  // ── 5. Second hold on same slot fails ──────────────────

  it('second hold on busy slot fails', async () => {
    const res = await fetch(`${baseUrl}/Slot/${slot1Id}/$hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test-session-2', durationMinutes: 5 }),
    });

    // Slot is busy, hold should fail
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ── 6. Other slot is still free ────────────────────────

  it('other slot is still free and can be held', async () => {
    // Verify slot2 is still free
    const slotRes = await fetch(`${baseUrl}/Slot/${slot2Id}`);
    const slot = await slotRes.json() as Record<string, unknown>;
    expect(slot.status).toBe('free');

    // Can hold it
    const holdRes = await fetch(`${baseUrl}/Slot/${slot2Id}/$hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test-session-3', durationMinutes: 5 }),
    });

    expect(holdRes.status).toBe(200);
    const hold = await holdRes.json() as Record<string, unknown>;
    expect(hold.holdToken).toBeTruthy();
  });
});
