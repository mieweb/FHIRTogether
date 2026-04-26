import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FhirStore, Schedule } from '../../types/fhir';
import { formatSchedule, formatScheduleList, formatCodeableConceptArray, structuredResult, speechProviderList, getSystemName } from './formatters';

/**
 * Register schedule-related MCP tools
 */
export function registerScheduleTools(server: McpServer, store: FhirStore): void {
  // List providers tool — lightweight provider discovery
  server.tool(
    'list_providers',
    'List available providers/doctors. When called without a system_id, groups providers by system so the caller can choose. When called with a system_id, returns only that system\'s providers.',
    {
      system_id: z.string().optional().describe('Optional system ID to scope to a specific organization. Omit to see all systems and their providers.'),
    },
    async ({ system_id }) => {
      try {
        const schedules = await store.getSchedules({ active: true, system_id });
        if (schedules.length === 0) {
          return structuredResult(
            'There are no providers available right now.',
            'No providers are currently available.'
          );
        }

        // When no system_id specified, group by system for discovery
        if (!system_id) {
          const bySystem = new Map<string, { systemId: string; systemName: string; schedules: Schedule[] }>();
          for (const s of schedules) {
            const sysName = getSystemName(s) || 'Unknown System';
            if (!bySystem.has(sysName)) {
              bySystem.set(sysName, { systemId: '', systemName: sysName, schedules: [] });
            }
            bySystem.get(sysName)!.schedules.push(s);
          }

          // Build context with system grouping
          const contextParts: string[] = ['# Available Systems and Providers\n'];
          const speechParts: string[] = [];
          for (const [name, group] of bySystem) {
            contextParts.push(`## ${name}`);
            const providerLines = group.schedules.map((s) => {
              const provName = s.actor?.[0]?.display || 'Unknown';
              const ref = s.actor?.[0]?.reference || '';
              const specialty = formatCodeableConceptArray(s.serviceType);
              return `- ${provName} | Schedule ID: ${s.id} | Ref: ${ref}${specialty ? ' | Specialty: ' + specialty : ''}`;
            });
            contextParts.push(providerLines.join('\n'));
            const names = group.schedules.map(s => s.actor?.[0]?.display || 'Unknown');
            speechParts.push(`${name} has ${names.join(' and ')}`);
          }
          contextParts.push('\nUse list_available_slots with a Schedule ID to find open times for a specific provider.');
          const context = contextParts.join('\n');
          const speech = speechParts.length === 1
            ? `${speechParts[0]} available.`
            : `We have providers at ${speechParts.length} systems. ${speechParts.join('. ')}.`;
          return structuredResult(speech, context);
        }

        // System-scoped: concise listing
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
      system_id: z.string().optional().describe('Filter by system ID'),
      limit: z.number().optional().describe('Maximum number of schedules to return'),
    },
    async ({ active, actor, system_id, limit }) => {
      try {
        const schedules = await store.getSchedules({
          active,
          actor,
          system_id,
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
