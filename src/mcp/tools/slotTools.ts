/**
 * MCP Tool: search_available_slots
 * 
 * Searches for free appointment time slots.
 * Public access — no identity required. Anyone can browse availability.
 */

import { FhirStore, Slot } from '../../types/fhir';
import { formatSlotListForSpeech, getProviderName, SpeechContextResponse } from './formatters';

export const searchAvailableSlotsDefinition = {
  name: 'search_available_slots',
  description: 'Search for available appointment time slots. No patient identity needed — this is public availability information. Use this when a caller wants to know what appointment times are open. Returns a speech-friendly list of available slots.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      date_from: {
        type: 'string',
        description: 'Start of date range to search, in YYYY-MM-DD format. Defaults to today if not specified.',
      },
      date_to: {
        type: 'string',
        description: 'End of date range to search, in YYYY-MM-DD format. Defaults to 7 days from date_from if not specified.',
      },
      provider_name: {
        type: 'string',
        description: 'Filter by provider/practitioner name (partial match). Example: "Dr. Smith"',
      },
      provider_id: {
        type: 'string',
        description: 'Filter by provider user ID for an exact match. Example: "8", "72". Takes precedence over provider_name when both are given.',
      },
      appointment_type: {
        type: 'string',
        description: 'Type of appointment to filter by. Example: "checkup", "follow-up", "consultation"',
      },
    },
    required: [] as string[],
  },
};

export async function searchAvailableSlots(
  store: FhirStore,
  args: { date_from?: string; date_to?: string; provider_name?: string; provider_id?: string; appointment_type?: string }
): Promise<SpeechContextResponse> {
  // Default date range: today to 7 days from now
  const now = new Date();
  const dateFrom = args.date_from || now.toISOString().slice(0, 10);
  let dateTo = args.date_to || new Date(
    new Date(dateFrom).getTime() + 7 * 24 * 60 * 60 * 1000
  ).toISOString().slice(0, 10);

  // When date_to is a date-only string (YYYY-MM-DD), the caller means "through that day",
  // so extend to the end of the day by adding one day. Without this,
  // start=2026-03-24 & end=2026-03-24 would be a zero-width range (both = midnight UTC).
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    dateTo = new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  // Normalize provider_name: treat "any", "all", "no preference", etc. as no filter
  const NO_PREF = /^(any|all|none|no\s*preference|doesn'?t\s*matter|don'?t\s*care|whoever\s*is\s*available|anyone|any\s*provider|any\s*doctor)$/i;
  const effectiveProvider = args.provider_name && !NO_PREF.test(args.provider_name.trim())
    ? args.provider_name.trim()
    : undefined;

  // provider_id takes precedence over provider_name for exact matching
  const effectiveProviderId = args.provider_id?.trim() || undefined;

  // First, find schedules that match the provider filter
  let scheduleMap = new Map<string, string>(); // schedule reference → provider name
  
  if (effectiveProviderId) {
    // provider_id is the provider's user_id. In WebChart this maps to
    // the schedule's resource_id (actor). Try actor match first.
    const schedules = await store.getSchedules({ actor: `Practitioner/${effectiveProviderId}`, _count: 50 });
    for (const s of schedules) {
      scheduleMap.set(`Schedule/${s.id}`, getProviderName(s));
    }
    // Fall back to schedule ID match (for backends where schedule id = provider id)
    if (scheduleMap.size === 0) {
      const schedule = await store.getScheduleById(effectiveProviderId);
      if (schedule) {
        scheduleMap.set(`Schedule/${schedule.id}`, getProviderName(schedule));
      }
    }
  } else {
    const schedules = await store.getSchedules({ _count: 50 });
    for (const schedule of schedules) {
      const providerName = getProviderName(schedule);
      
      // Filter by provider name if specified
      if (effectiveProvider) {
        const searchLower = effectiveProvider.toLowerCase();
        if (!providerName.toLowerCase().includes(searchLower)) {
          continue;
        }
      }
      
      scheduleMap.set(`Schedule/${schedule.id}`, providerName);
    }
  }

  // Now query for free slots in the date range.
  // When filtering by provider, query per-schedule so server-side filtering
  // avoids the _count limit hiding matching slots.
  let allSlots: Slot[] = [];
  const scheduleRefs = Array.from(scheduleMap.keys()); // e.g. ["Schedule/5", "Schedule/8"]

  if ((effectiveProvider || effectiveProviderId) && scheduleRefs.length > 0) {
    for (const schedRef of scheduleRefs) {
      const schedId = schedRef.replace('Schedule/', '');
      const slots = await store.getSlots({
        schedule: schedId,
        status: 'free',
        start: dateFrom,
        end: dateTo,
        _count: 50,
      });
      allSlots.push(...slots);
    }
  } else {
    allSlots = await store.getSlots({
      status: 'free',
      start: dateFrom,
      end: dateTo,
      _count: 50,
    });
  }

  // Build slot list with provider names
  const slotsWithProviders: Array<{ slot: Slot; providerName?: string }> = [];
  
  for (const slot of allSlots) {
    const schedRef = slot.schedule?.reference;
    
    // If filtering by provider, only include slots from matching schedules
    if ((effectiveProvider || effectiveProviderId) && schedRef && !scheduleMap.has(schedRef)) {
      continue;
    }
    
    const providerName = schedRef ? scheduleMap.get(schedRef) : undefined;
    slotsWithProviders.push({ slot, providerName });
  }

  // Sort by start time
  slotsWithProviders.sort((a, b) => 
    new Date(a.slot.start).getTime() - new Date(b.slot.start).getTime()
  );

  return formatSlotListForSpeech(slotsWithProviders);
}
