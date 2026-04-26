/**
 * SMART Scheduling Links ($bulk-publish) unit tests
 *
 * Tests the manifest endpoint and NDJSON file generation per the
 * SMART Scheduling Links specification.
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

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-smart-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'test.db');
  process.env.ENABLE_TEST_ENDPOINTS = 'true';
  process.env.SMART_SCHEDULING_ENABLED = 'true';
  process.env.LOG_LEVEL = 'error';
  process.env.HL7_SOCKET_ENABLED = 'false';

  const result = await buildServer();
  fastify = result.fastify;

  // Seed test data via the store directly
  const store = result.store;
  const system = await store.createSystem({ name: 'Test Clinic', status: 'active', ttlDays: 30 });
  await store.createLocation({ systemId: system.id, name: 'Main Office', address: '123 Main St', city: 'Springfield', state: 'MA', zip: '01101', phone: '555-0100' });
  await store.createSchedule({ resourceType: 'Schedule', active: true, actor: [{ reference: `Location/${system.id}` }], serviceType: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/service-type', code: '57', display: 'Immunization' }] }] } as import('../types/fhir').Schedule);
  const schedules = await store.getSchedules({});
  const scheduleId = schedules[0].id;
  await store.createSlot({ resourceType: 'Slot', schedule: { reference: `Schedule/${scheduleId}` }, status: 'free', start: '2027-06-15T09:00:00Z', end: '2027-06-15T09:30:00Z' } as import('../types/fhir').Slot);
  await store.createSlot({ resourceType: 'Slot', schedule: { reference: `Schedule/${scheduleId}` }, status: 'busy', start: '2027-06-15T10:00:00Z', end: '2027-06-15T10:30:00Z' } as import('../types/fhir').Slot);

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 15000);

afterAll(async () => {
  await fastify.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SMART Scheduling Links', () => {
  describe('GET /$bulk-publish', () => {
    it('returns a valid manifest with transactionTime, request, output, and error', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const manifest = await res.json() as Record<string, unknown>;
      expect(manifest.transactionTime).toBeDefined();
      expect(manifest.request).toContain('$bulk-publish');
      expect(Array.isArray(manifest.output)).toBe(true);
      expect(Array.isArray(manifest.error)).toBe(true);
      expect(manifest.error).toHaveLength(0);
    });

    it('manifest output includes Location, Schedule, and Slot entries', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish`);
      const manifest = await res.json() as { output: Array<{ type: string; url: string }> };

      const types = manifest.output.map((o: { type: string }) => o.type);
      expect(types).toContain('Location');
      expect(types).toContain('Schedule');
      expect(types).toContain('Slot');
    });

    it('all output entries have type and url fields', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish`);
      const manifest = await res.json() as { output: Array<{ type: string; url: string }> };

      for (const entry of manifest.output) {
        expect(entry.type).toBeDefined();
        expect(entry.url).toBeDefined();
        expect(entry.url).toContain('.ndjson');
      }
    });

    it('includes Cache-Control header', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish`);
      expect(res.headers.get('cache-control')).toContain('max-age=');
    });
  });

  describe('GET /$bulk-publish/locations.ndjson', () => {
    it('returns NDJSON with FHIR Location resources', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish/locations.ndjson`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/fhir+ndjson');

      const text = await res.text();
      const lines = text.split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      const location = JSON.parse(lines[0]);
      expect(location.resourceType).toBe('Location');
      expect(location.id).toBeDefined();
      expect(location.name).toBeDefined();
      expect(location.telecom).toBeDefined();
      expect(location.telecom.length).toBeGreaterThan(0);
    });
  });

  describe('GET /$bulk-publish/schedules.ndjson', () => {
    it('returns NDJSON with FHIR Schedule resources', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish/schedules.ndjson`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/fhir+ndjson');

      const text = await res.text();
      const lines = text.split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      const schedule = JSON.parse(lines[0]);
      expect(schedule.resourceType).toBe('Schedule');
      expect(schedule.id).toBeDefined();
      expect(schedule.actor).toBeInstanceOf(Array);
    });
  });

  describe('GET /$bulk-publish/slots.ndjson', () => {
    it('returns NDJSON with FHIR Slot resources', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish/slots.ndjson`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/fhir+ndjson');

      const text = await res.text();
      const lines = text.split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      const slot = JSON.parse(lines[0]);
      expect(slot.resourceType).toBe('Slot');
      expect(slot.id).toBeDefined();
      expect(slot.schedule).toBeDefined();
      expect(slot.schedule.reference).toContain('Schedule/');
      expect(slot.status).toBeDefined();
      expect(slot.start).toBeDefined();
      expect(slot.end).toBeDefined();
    });

    it('includes both free and busy slots', async () => {
      const res = await fetch(`${baseUrl}/$bulk-publish/slots.ndjson`);
      const text = await res.text();
      const slots = text.split('\n').filter(Boolean).map(l => JSON.parse(l));

      const statuses = slots.map((s: { status: string }) => s.status);
      expect(statuses).toContain('free');
      expect(statuses).toContain('busy');
    });
  });

  describe('Manifest URL resolution', () => {
    it('NDJSON files referenced in manifest are accessible', async () => {
      const manifestRes = await fetch(`${baseUrl}/$bulk-publish`);
      const manifest = await manifestRes.json() as { output: Array<{ type: string; url: string }> };

      for (const entry of manifest.output) {
        // URLs in the manifest may use auto-detected base; replace with test baseUrl
        const url = entry.url.replace(/https?:\/\/[^/]+/, baseUrl);
        const res = await fetch(url);
        expect(res.status).toBe(200);
      }
    });
  });
});
