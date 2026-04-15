import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FhirStore } from '../../types/fhir';
import { formatSlot, formatSlotList, structuredResult, speechSlotList, speechSlot } from './formatters';

/**
 * Register slot-related MCP tools
 */
export function registerSlotTools(server: McpServer, store: FhirStore): void {
  // List available slots tool
  server.tool(
    'list_available_slots',
    'List available appointment slots. Use this to find open time slots for booking appointments. Use list_schedules first to get the schedule_id for a specific provider.',
    {
      schedule_id: z.string().optional().describe('Filter by schedule ID to see slots for a specific provider. Get this from list_schedules.'),
      status: z.enum(['free', 'busy', 'busy-unavailable', 'busy-tentative']).optional().default('free').describe('Filter by slot status (defaults to "free" for available slots)'),
      start_date: z.string().optional().describe('Filter slots starting from this date (ISO 8601 format, e.g., 2024-01-15)'),
      end_date: z.string().optional().describe('Filter slots ending before this date (ISO 8601 format)'),
      limit: z.number().optional().describe('Maximum number of slots to return'),
    },
    async ({ schedule_id, status, start_date, end_date, limit }) => {
      try {
        // Normalize date-only strings to include time boundaries so that
        // SQLite lexicographic comparisons work correctly against ISO timestamps.
        const normalizedStart = start_date && !start_date.includes('T') ? start_date + 'T00:00:00.000Z' : start_date;
        const normalizedEnd = end_date && !end_date.includes('T') ? end_date + 'T23:59:59.999Z' : end_date;

        const slots = await store.getSlots({
          schedule: schedule_id ? `Schedule/${schedule_id}` : undefined,
          status: status || 'free',
          start: normalizedStart,
          end: normalizedEnd,
          _count: limit,
        });
        const context = formatSlotList(slots);
        const speech = speechSlotList(slots);
        return structuredResult(speech, context);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listing slots: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // Get slot by ID tool
  server.tool(
    'get_slot',
    'Get details of a specific slot by its ID.',
    {
      slot_id: z.string().describe('The ID of the slot to retrieve'),
    },
    async ({ slot_id }) => {
      try {
        const slot = await store.getSlotById(slot_id);
        if (!slot) {
          return {
            content: [{ type: 'text', text: `Slot not found: ${slot_id}` }],
            isError: true,
          };
        }
        const context = formatSlot(slot);
        const speech = speechSlot(slot);
        return structuredResult(speech, context);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error getting slot: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // Hold slot tool
  server.tool(
    'hold_slot',
    'Temporarily hold a slot to prevent double-booking during the appointment booking process. The hold expires automatically after the specified duration.',
    {
      slot_id: z.string().describe('The ID of the slot to hold'),
      session_id: z.string().describe('A unique session identifier for the booking session'),
      duration_minutes: z.number().optional().default(15).describe('How long to hold the slot in minutes (default: 15)'),
    },
    async ({ slot_id, session_id, duration_minutes }) => {
      try {
        const hold = await store.holdSlot(slot_id, session_id, duration_minutes || 15);
        const context = `Slot held successfully!\n\nHold Token: ${hold.holdToken}\nSlot ID: ${hold.slotId}\nExpires: ${new Date(hold.expiresAt).toLocaleString()}\n\nUse this hold token when creating the appointment to ensure the slot is reserved.`;
        const speech = `I've reserved that time slot for you. It will be held for ${duration_minutes || 15} minutes.`;
        return structuredResult(speech, context);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error holding slot: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // Release hold tool
  server.tool(
    'release_slot_hold',
    'Release a previously held slot. Use this if the booking is cancelled before completion.',
    {
      hold_token: z.string().describe('The hold token returned when the slot was held'),
    },
    async ({ hold_token }) => {
      try {
        await store.releaseHold(hold_token);
        return {
          content: [{ type: 'text', text: 'Slot hold released successfully.' }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error releasing hold: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );
}
