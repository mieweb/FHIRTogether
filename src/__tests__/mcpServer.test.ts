/**
 * MCP Server integration tests
 *
 * Spins up a fresh FHIRTogether server with an empty database and exercises
 * the MCP tool flow:
 *   1. HL7 SIU^S12 → auto-register system, get schedule
 *   2. Create free slots via API
 *   3. MCP list_providers → discovers system and providers
 *   4. MCP list_available_slots → finds free slots
 *   5. MCP book_appointment → books a slot, gets booking reference
 *   6. MCP lookup_appointment → finds appointment by booking reference
 *   7. MCP cancel_appointment → cancels by booking reference, slot freed
 *   8. MCP book + reschedule_appointment → moves to a different slot
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

// Shared state
let apiKey: string;
let scheduleRef: string;
let slot1Id: string;
let slot2Id: string;
let slot3Id: string;

const FUTURE_DATE = '2027-07-20';
const FACILITY = `MCP_CLINIC_${Date.now()}`;

/** Parse the structured {speech, context} from an MCP tool result */
function parseStructured(text: string): { speech: string; context: string } {
  return JSON.parse(text);
}

// Persistent SSE session state
let sseController: AbortController | null = null;
let sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let sseSessionId: string = '';
let sseBuffer: string = '';
let rpcIdCounter = 0;

/** Establish a persistent SSE connection for MCP tool calls */
async function connectMcpSession(): Promise<void> {
  sseController = new AbortController();
  const sseRes = await fetch(`${baseUrl}/mcp/sse`, {
    signal: sseController.signal,
    headers: { Accept: 'text/event-stream' },
  });

  if (!sseRes.body) throw new Error('Failed to connect SSE');
  sseReader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  sseBuffer = '';

  // Read until we get the endpoint event with sessionId
  for (let i = 0; i < 10; i++) {
    const { value, done } = await sseReader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const endpointMatch = sseBuffer.match(/data:\s*(\/mcp\/messages\?sessionId=[^\s\n]+)/);
    if (endpointMatch) {
      const url = new URL(endpointMatch[1], baseUrl);
      sseSessionId = url.searchParams.get('sessionId')!;
      sseBuffer = ''; // clear consumed data
      return;
    }
  }
  throw new Error(`Could not extract sessionId from SSE stream. Got: ${sseBuffer}`);
}

/** Disconnect the persistent SSE session */
function disconnectMcpSession(): void {
  if (sseController) {
    sseController.abort();
    sseController = null;
  }
  sseReader = null;
  sseSessionId = '';
  sseBuffer = '';
}

/** Call an MCP tool via the persistent SSE session */
async function callMcpTool(toolName: string, args: Record<string, unknown> = {}): Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}> {
  if (!sseReader || !sseSessionId) {
    await connectMcpSession();
  }

  const rpcId = ++rpcIdCounter;
  const rpcRequest = {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  await fetch(`${baseUrl}/mcp/messages?sessionId=${sseSessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rpcRequest),
  });

  // Read the SSE stream for the JSON-RPC response
  const decoder = new TextDecoder();
  const timeout = 10_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    // Use a race between read and a timeout promise
    const readPromise = sseReader!.read();
    const timeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), Math.max(0, deadline - Date.now()))
    );

    const { value, done } = await Promise.race([readPromise, timeoutPromise]);
    if (done && !value) break;
    if (value) sseBuffer += decoder.decode(value, { stream: true });

    // Look for JSON-RPC response matching our request id
    const messageRegex = new RegExp(`event:\\s*message\\ndata:\\s*({[^\\n]*"id"\\s*:\\s*${rpcId}[^\\n]*)`, 's');
    const match = sseBuffer.match(messageRegex);
    if (match) {
      const rpcResponse = JSON.parse(match[1]);
      // Clear matched portion from buffer
      sseBuffer = sseBuffer.slice(sseBuffer.indexOf(match[0]) + match[0].length);
      return rpcResponse.result;
    }
  }

  throw new Error(`No tool response received for ${toolName} (id=${rpcId}). Buffer: ${sseBuffer.slice(0, 200)}`);
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-mcp-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'test.db');
  process.env.ENABLE_TEST_ENDPOINTS = 'true';
  process.env.LOG_LEVEL = 'error';
  process.env.HL7_SOCKET_ENABLED = 'false';
  // MCP is on by default (DISABLE_MCP not set)

  const result = await buildServer();
  fastify = result.fastify;
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 15000);

afterAll(async () => {
  disconnectMcpSession();
  await fastify?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}, 10000);

describe('MCP Server', () => {
  // Increase timeout for SSE-based tests
  jest.setTimeout(15000);

  // ── 0. Health check ──────────────────────────────────────

  it('MCP health endpoint responds', async () => {
    const res = await fetch(`${baseUrl}/mcp/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.server).toBe('fhirtogether-mcp');
  });

  // ── 1. Seed data via HL7 ────────────────────────────────

  it('HL7 SIU^S12 registers system and creates schedule', async () => {
    const hl7 = [
      `MSH|^~\\&|MCP_EHR|${FACILITY}|FHIRTOGETHER|SCHEDULING_GATEWAY|20270720120000||SIU^S12|MCP001|P|2.3`,
      'SCH|60001^60001|60001^60001|||60001|OFFICE^Office visit|Routine|OFFICE|20|m|^^20^20270720090000^20270720092000|||||||||||||BOOKED',
      'PID|1||88801||McpPatient^Bob||19850515|M|||2 MCP St^^Testville^TS^00000||(555)000-2222',
      'PV1|1|O|OFFICE^^^MCP Office||||200^McpDoc^Alice^D|||Internal Medicine',
      'RGS|1|A',
      'AIG|1|A|200^McpDoc^Alice^D|Internal Medicine',
      'AIL|1|A|OFFICE^^^MCP Office||||20270720090000|20|m',
      'AIP|1|A|200^McpDoc^Alice^D|Internal Medicine||20270720090000|20|m',
    ].join('\r');

    const res = await fetch(`${baseUrl}/hl7/siu`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: hl7,
    });
    expect(res.status).toBe(200);

    apiKey = res.headers.get('x-api-key')!;
    scheduleRef = res.headers.get('x-schedule-ref')!;
    expect(apiKey).toBeTruthy();
    expect(scheduleRef).toMatch(/^Schedule\//);
  });

  // ── 2. Create free slots via REST ────────────────────────

  it('creates three free slots', async () => {
    const createSlot = async (start: string, end: string) => {
      const res = await fetch(`${baseUrl}/Slot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          resourceType: 'Slot',
          schedule: { reference: scheduleRef },
          status: 'free',
          start,
          end,
        }),
      });
      expect(res.status).toBe(201);
      const slot = await res.json() as Record<string, unknown>;
      return slot.id as string;
    };

    slot1Id = await createSlot(`${FUTURE_DATE}T14:00:00Z`, `${FUTURE_DATE}T14:20:00Z`);
    slot2Id = await createSlot(`${FUTURE_DATE}T14:20:00Z`, `${FUTURE_DATE}T14:40:00Z`);
    slot3Id = await createSlot(`${FUTURE_DATE}T14:40:00Z`, `${FUTURE_DATE}T15:00:00Z`);
  });

  // ── 3. MCP list_providers ────────────────────────────────

  it('list_providers returns system-grouped providers', async () => {
    const result = await callMcpTool('list_providers');
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    const { speech, context } = parseStructured(text);

    // Should mention the provider
    expect(context).toContain('McpDoc');
    expect(context).toContain('Schedule ID:');
    expect(speech).toBeTruthy();
  });

  // ── 4. MCP list_available_slots ──────────────────────────

  it('list_available_slots returns free slots for the schedule', async () => {
    const scheduleId = scheduleRef.replace('Schedule/', '');
    const result = await callMcpTool('list_available_slots', {
      schedule_id: scheduleId,
      status: 'free',
    });
    expect(result.isError).toBeFalsy();

    const { speech, context } = parseStructured(result.content[0].text);
    expect(speech).toContain('available time slot');
    expect(context).toContain(slot1Id);
  });

  // ── 5. MCP book_appointment ──────────────────────────────

  let bookingReference: string;

  it('book_appointment books a slot and returns booking reference', async () => {
    const result = await callMcpTool('book_appointment', {
      slot_id: slot1Id,
      patient_name: 'Test McpPatient',
      patient_phone: '555-123-4567',
      reason: 'Routine checkup',
    });
    expect(result.isError).toBeFalsy();

    const { speech, context } = parseStructured(result.content[0].text);
    expect(speech).toContain('booked');
    expect(context).toContain('Booking Reference:');

    // Extract booking reference from context
    const refMatch = context.match(/Booking Reference:\s*(\S+)/);
    expect(refMatch).toBeTruthy();
    bookingReference = refMatch![1];
    expect(bookingReference).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);

    // Verify slot is now busy via REST
    const slotRes = await fetch(`${baseUrl}/Slot/${slot1Id}`);
    const slot = await slotRes.json() as Record<string, unknown>;
    expect(slot.status).toBe('busy');
  });

  // ── 6. MCP lookup_appointment ────────────────────────────

  it('lookup_appointment finds by booking reference', async () => {
    const result = await callMcpTool('lookup_appointment', {
      booking_reference: bookingReference,
    });
    expect(result.isError).toBeFalsy();

    const { context } = parseStructured(result.content[0].text);
    expect(context).toContain(bookingReference);
    expect(context).toContain('booked');
  });

  // ── 7. MCP cancel_appointment ────────────────────────────

  it('cancel_appointment cancels by booking reference and frees slot', async () => {
    const result = await callMcpTool('cancel_appointment', {
      booking_reference: bookingReference,
      reason: 'Patient requested cancellation',
    });
    expect(result.isError).toBeFalsy();

    const { speech } = parseStructured(result.content[0].text);
    expect(speech).toContain('cancelled');

    // Verify slot is free again
    const slotRes = await fetch(`${baseUrl}/Slot/${slot1Id}`);
    const slot = await slotRes.json() as Record<string, unknown>;
    expect(slot.status).toBe('free');
  });

  // ── 8. MCP book + reschedule ─────────────────────────────

  let rescheduleRef: string;
  let appointmentId: string;

  it('book then reschedule_appointment moves to new slot', async () => {
    // Book slot2
    const bookResult = await callMcpTool('book_appointment', {
      slot_id: slot2Id,
      patient_name: 'Reschedule Patient',
    });
    expect(bookResult.isError).toBeFalsy();

    const { context: bookCtx } = parseStructured(bookResult.content[0].text);
    const refMatch = bookCtx.match(/Booking Reference:\s*(\S+)/);
    rescheduleRef = refMatch![1];

    // Extract appointment ID from context
    const idMatch = bookCtx.match(/Appointment ID:\s*(\S+)/);
    expect(idMatch).toBeTruthy();
    appointmentId = idMatch![1];

    // Reschedule to slot3
    const result = await callMcpTool('reschedule_appointment', {
      booking_reference: rescheduleRef,
      new_slot_id: slot3Id,
    });
    expect(result.isError).toBeFalsy();

    const { speech } = parseStructured(result.content[0].text);
    expect(speech).toContain('rescheduled');

    // Old slot should be free, new slot should be busy
    const slot2Res = await fetch(`${baseUrl}/Slot/${slot2Id}`);
    const slot2 = await slot2Res.json() as Record<string, unknown>;
    expect(slot2.status).toBe('free');

    const slot3Res = await fetch(`${baseUrl}/Slot/${slot3Id}`);
    const slot3 = await slot3Res.json() as Record<string, unknown>;
    expect(slot3.status).toBe('busy');
  });

  // ── 9. MCP get_appointment ───────────────────────────────

  it('get_appointment retrieves by ID', async () => {
    const result = await callMcpTool('get_appointment', {
      appointment_id: appointmentId,
    });
    expect(result.isError).toBeFalsy();

    const { context } = parseStructured(result.content[0].text);
    expect(context).toContain(appointmentId);
  });

  // ── 10. MCP error cases ──────────────────────────────────

  it('book_appointment rejects busy slot', async () => {
    const result = await callMcpTool('book_appointment', {
      slot_id: slot3Id, // busy from reschedule
      patient_name: 'Should Fail',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
  });

  it('lookup_appointment returns error for unknown reference', async () => {
    const result = await callMcpTool('lookup_appointment', {
      booking_reference: 'fake-ref-0000',
    });
    expect(result.isError).toBe(true);
  });

  it('cancel_appointment without id or reference returns error', async () => {
    const result = await callMcpTool('cancel_appointment', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('provide either');
  });
});
