import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FhirStore } from '../../types/fhir';
import { formatSchedule, formatScheduleList, formatCodeableConceptArray, structuredResult, speechProviderList } from './formatters';

/**
 * Register schedule-related MCP tools
 */
export function registerScheduleTools(server: McpServer, store: FhirStore): void {
  // List providers tool — lightweight provider discovery
  server.tool(
    'list_providers',
    'List available providers/doctors. Call this FIRST when a caller requests an appointment to discover which providers are available and their schedule IDs.',
    {},
    async () => {
      try {
        const schedules = await store.getSchedules({ active: true });
        if (schedules.length === 0) {
          return structuredResult(
            'There are no providers available right now.',
            'No providers are currently available.'
          );
        }
        const lines = schedules.map((s) => {
          const name = s.actor?.[0]?.display || 'Unknown';
          const ref = s.actor?.[0]?.reference || '';
          const specialty = formatCodeableConceptArray(s.serviceType);
          return `- ${name} | Schedule ID: ${s.id} | Ref: ${ref}${specialty ? ' | Specialty: ' + specialty : ''}`;
        });
        const context = `Available Providers:\n${lines.join('\n')}\n\nUse the Schedule ID when calling list_available_slots to find open times for a specific provider.`;
        const speech = speechProviderList(schedules);
        return structuredResult(speech, context);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listing providers: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // List schedules tool
  server.tool(
    'list_schedules',
    'List available appointment schedules. Use this to find which providers/schedules are available for booking.',
    {
      active: z.boolean().optional().describe('Filter by active status (true/false)'),
      actor: z.string().optional().describe('Filter by provider/actor reference (partial match)'),
      limit: z.number().optional().describe('Maximum number of schedules to return'),
    },
    async ({ active, actor, limit }) => {
      try {
        const schedules = await store.getSchedules({
          active,
          actor,
          _count: limit,
        });
        const context = formatScheduleList(schedules);
        const speech = speechProviderList(schedules);
        return structuredResult(speech, context);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listing schedules: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // Get schedule by ID tool
  server.tool(
    'get_schedule',
    'Get details of a specific schedule by its ID.',
    {
      schedule_id: z.string().describe('The ID of the schedule to retrieve'),
    },
    async ({ schedule_id }) => {
      try {
        const schedule = await store.getScheduleById(schedule_id);
        if (!schedule) {
          return {
            content: [{ type: 'text', text: `Schedule not found: ${schedule_id}` }],
            isError: true,
          };
        }
        const context = formatSchedule(schedule);
        const name = schedule.actor?.[0]?.display || 'Unknown provider';
        const specialty = formatCodeableConceptArray(schedule.serviceType);
        const speech = specialty ? `${name}, ${specialty}.` : `${name}.`;
        return structuredResult(speech, context);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error getting schedule: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );
}
