/**
 * MCP Tool: search_schedules
 * 
 * Searches for provider schedules/availability windows.
 * Public access — no identity required.
 */

import { FhirStore } from '../../types/fhir';
import { formatScheduleListForSpeech, SpeechContextResponse } from './formatters';

export const searchSchedulesDefinition = {
  name: 'search_schedules',
  description: 'Search for provider schedules to find out which providers are available and when. No patient identity needed — this is public schedule information. Use this when a caller asks about provider availability, who is available, or what days a specific provider works.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      provider_name: {
        type: 'string',
        description: 'Provider or practitioner name to search for (partial match supported). Example: "Dr. Smith" or "Smith"',
      },
      specialty: {
        type: 'string',
        description: 'Medical specialty to filter by. Example: "cardiology", "family medicine"',
      },
      date: {
        type: 'string',
        description: 'Date to check availability for, in YYYY-MM-DD format. Example: "2026-03-24"',
      },
    },
    required: [] as string[],
  },
};

export async function searchSchedules(
  store: FhirStore,
  args: { provider_name?: string; specialty?: string; date?: string }
): Promise<SpeechContextResponse> {
  const query: { actor?: string; date?: string; _count?: number } = {
    _count: 10,
  };

  if (args.provider_name) {
    query.actor = args.provider_name;
  }
  if (args.date) {
    query.date = args.date;
  }

  const schedules = await store.getSchedules(query);
  
  // Filter by specialty if provided (client-side since FHIR query may not support it)
  let filtered = schedules;
  if (args.specialty) {
    const specLower = args.specialty.toLowerCase();
    filtered = schedules.filter(s => 
      s.specialty?.some(sp => 
        sp.text?.toLowerCase().includes(specLower) ||
        sp.coding?.some(c => c.display?.toLowerCase().includes(specLower))
      )
    );
  }

  return formatScheduleListForSpeech(filtered);
}
