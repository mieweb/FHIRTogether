/**
 * FHIRTogether MCP (Model Context Protocol) Server
 * 
 * Exposes FHIR scheduling operations as MCP tools over SSE transport.
 * Designed for integration with AI-powered IVR systems, chatbots, and 
 * other AI agents that need to search availability and book appointments.
 * 
 * Trust model: This is a PUBLIC scheduling system. Callers provide 
 * self-reported identity which is recorded but NOT verified.
 * Booking references serve as bearer tokens for appointment management.
 * 
 * Transport: Server-Sent Events (SSE) — mounted on the Fastify server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { FhirStore } from '../types/fhir';
import { createStore } from '../store';
import { searchSchedules } from './tools/scheduleTools';
import { searchAvailableSlots } from './tools/slotTools';
import {
  bookAppointment,
  cancelAppointment,
  getAppointmentByReference,
} from './tools/appointmentTools';

import type { FastifyInstance } from 'fastify';

// Track active transports for cleanup
const activeTransports = new Map<string, SSEServerTransport>();

/**
 * Create the MCP server instance with all scheduling tools registered.
 */
function createMcpServer(store: FhirStore): McpServer {
  const server = new McpServer({
    name: 'fhirtogether-scheduling',
    version: '1.0.0',
  });

  // Register: search_schedules
  server.tool(
    'search_schedules',
    'Search for provider schedules to find out which providers are available and when. No patient identity needed — this is public schedule information.',
    {
      provider_name: z.string().optional().describe('Provider or practitioner name to search for (partial match supported). Example: "Dr. Smith"'),
      specialty: z.string().optional().describe('Medical specialty to filter by. Example: "cardiology", "family medicine"'),
      date: z.string().optional().describe('Date to check availability for, in YYYY-MM-DD format.'),
    },
    async (args) => {
      const result = await searchSchedules(store, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // Register: search_available_slots
  server.tool(
    'search_available_slots',
    'Search for available appointment time slots. No patient identity needed — this is public availability information. Returns a speech-friendly list of available slots.',
    {
      date_from: z.string().optional().describe('Start of date range to search, in YYYY-MM-DD format. Defaults to today.'),
      date_to: z.string().optional().describe('End of date range to search, in YYYY-MM-DD format. Defaults to 7 days from date_from.'),
      provider_name: z.string().optional().describe('Filter by provider/practitioner name (partial match). Example: "Dr. Smith"'),
      provider_id: z.string().optional().describe('Filter by provider user ID for an exact match. Example: "8", "72". Takes precedence over provider_name.'),
      appointment_type: z.string().optional().describe('Type of appointment to filter by. Example: "checkup", "follow-up"'),
    },
    async (args) => {
      const result = await searchAvailableSlots(store, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // Register: book_appointment
  server.tool(
    'book_appointment',
    'Book an appointment in an available time slot. Requires a slot_id plus the caller\'s self-reported name and phone. Identity is NOT verified. Returns a booking reference code.',
    {
      slot_id: z.string().describe('The ID of the available slot to book (from search_available_slots results)').meta({ exclude_confirmation: true }),
      caller_name: z.string().describe('Full name of the person booking, as stated by the caller'),
      caller_phone: z.string().describe('Phone number of the person booking, as stated by the caller'),
      caller_dob: z.string().optional().describe('Date of birth in YYYY-MM-DD format (optional)'),
      reason: z.string().optional().describe('Reason for the appointment, as stated by the caller'),
      caller_email: z.string().optional().describe('Email address of the caller (optional)'),
    },
    async (args) => {
      const result = await bookAppointment(store, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // Register: cancel_appointment
  server.tool(
    'cancel_appointment',
    'Cancel an existing appointment using the booking reference code provided at booking time. The reference serves as proof of booking.',
    {
      booking_reference: z.string().describe('The booking reference code given when the appointment was booked (e.g., "BK-7X3M")'),
    },
    async (args) => {
      const result = await cancelAppointment(store, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // Register: get_appointment_by_reference
  server.tool(
    'get_appointment_by_reference',
    'Look up an existing appointment using the booking reference code. Use when a caller wants to check appointment status or verify their booking.',
    {
      booking_reference: z.string().describe('The booking reference code given when the appointment was booked (e.g., "BK-7X3M")'),
    },
    async (args) => {
      const result = await getAppointmentByReference(store, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  return server;
}

/**
 * Register MCP SSE routes on the Fastify server.
 * 
 * Endpoints:
 *   GET  /mcp/sse     — SSE connection endpoint (clients connect here)
 *   POST /mcp/messages — Message endpoint (clients send messages here)
 * 
 * @param fastify - The Fastify instance
 * @param store - The FhirStore instance for data access
 */
export async function registerMcpRoutes(fastify: FastifyInstance, store: FhirStore): Promise<void> {

  // Wrap MCP routes in a Fastify plugin so we can remove content-type
  // parsers without affecting the rest of the server. This prevents
  // Fastify from consuming/encoding the raw request stream before
  // SSEServerTransport.handlePostMessage() can read it.
  await fastify.register(async function mcpPlugin(mcp) {

    // Remove all default parsers inside this plugin scope and add a
    // pass-through that leaves the raw stream untouched.
    mcp.removeAllContentTypeParsers();
    mcp.addContentTypeParser('*', function (_request: any, _payload: any, done: (err: null) => void) {
      done(null);
    });

    // SSE endpoint — clients connect here to establish the MCP session.
    // Each connection gets its own McpServer instance because the SDK
    // requires a 1:1 mapping between server and transport.
    mcp.get('/mcp/sse', async (request, reply) => {
      // Check for per-session config from the MCP client (multi-tenant support).
      // The IVR passes webchart credentials + timezone as a base64-encoded JSON
      // header so each clinic gets its own store instance.
      let sessionStore: FhirStore = store;
      let sessionStoreOwned = false;

      const configHeader = request.headers['x-mcp-config'];
      if (typeof configHeader === 'string') {
        try {
          const config = JSON.parse(Buffer.from(configHeader, 'base64').toString('utf-8'));
          if (config.store) {
            // Client specifies the full store config (backend, credentials, etc.)
            sessionStore = createStore({ ...config.store, timezone: config.timezone });
            await sessionStore.initialize();
            sessionStoreOwned = true;
            mcp.log.info(
              { backend: config.store.backend, timezone: config.timezone },
              'Created per-session store from MCP client config'
            );
          } else if (config.webchart?.url && config.webchart?.username && config.webchart?.password) {
            // Legacy shorthand: webchart block at top level
            sessionStore = createStore({
              backend: 'webchart',
              baseUrl: config.webchart.url,
              username: config.webchart.username,
              password: config.webchart.password,
              defaultLocation: config.webchart.defaultLocation || '0',
              timezone: config.timezone,
            });
            await sessionStore.initialize();
            sessionStoreOwned = true;
            mcp.log.info(
              { timezone: config.timezone, webchartUrl: config.webchart.url },
              'Created per-session WebChart store from MCP client config'
            );
          }
        } catch (err) {
          mcp.log.warn({ err }, 'Failed to parse x-mcp-config header, using default store');
        }
      }

      const mcpServer = createMcpServer(sessionStore);
      const transport = new SSEServerTransport('/mcp/messages', reply.raw);
      const sessionId = transport.sessionId;

      activeTransports.set(sessionId, transport);
      mcp.log.info({ sessionId }, 'MCP SSE client connected');

      // Clean up when client disconnects
      request.raw.on('close', () => {
        activeTransports.delete(sessionId);
        if (sessionStoreOwned && typeof (sessionStore as any).close === 'function') {
          (sessionStore as any).close().catch(() => {});
        }
        mcp.log.info({ sessionId }, 'MCP SSE client disconnected');
      });

      await mcpServer.connect(transport);
    });

    // Message endpoint — clients POST messages here
    mcp.post('/mcp/messages', async (request, reply) => {
      const sessionId = (request.query as any).sessionId;
      const transport = activeTransports.get(sessionId);

      if (!transport) {
        reply.code(400).send({ error: 'Invalid or expired session. Please reconnect to /mcp/sse' });
        return;
      }

      await transport.handlePostMessage(request.raw, reply.raw);
    });
  });

  fastify.log.info('MCP SSE routes registered at /mcp/sse and /mcp/messages');
}

/**
 * Get count of active MCP connections (for health checks / monitoring).
 */
export function getActiveMcpConnections(): number {
  return activeTransports.size;
}
