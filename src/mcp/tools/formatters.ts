/**
 * Formatting utilities for converting FHIR resources to speech-friendly text.
 * All outputs are designed to be read aloud by a TTS engine during a phone call.
 */

import { Slot, Schedule, Appointment } from '../../types/fhir';

/**
 * Format an ISO date string into a speech-friendly format.
 * E.g., "2026-03-24T14:00:00Z" → "Monday, March 24th at 2:00 PM"
 */
export function formatDateTimeForSpeech(isoString: string): string {
  const date = new Date(isoString);
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  
  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayNum = date.getDate();
  const suffix = getOrdinalSuffix(dayNum);
  
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  
  const minuteStr = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`;
  
  return `${dayName}, ${monthName} ${dayNum}${suffix} at ${hours}${minuteStr} ${ampm}`;
}

/**
 * Format just the date portion for speech.
 * E.g., "2026-03-24" → "Monday, March 24th"
 */
export function formatDateForSpeech(isoString: string): string {
  const date = new Date(isoString);
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  
  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayNum = date.getDate();
  const suffix = getOrdinalSuffix(dayNum);
  
  return `${dayName}, ${monthName} ${dayNum}${suffix}`;
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Extract the provider/practitioner display name from a schedule's actor references.
 */
export function getProviderName(schedule: Schedule): string {
  if (!schedule.actor || schedule.actor.length === 0) return 'Unknown Provider';
  // Find actor that looks like a practitioner
  const practitioner = schedule.actor.find(a => 
    a.reference?.startsWith('Practitioner/') || a.display
  );
  return practitioner?.display || practitioner?.reference || 'Unknown Provider';
}

/**
 * Format a slot for speech output.
 * Returns clean speech text without slot IDs (those go in context).
 * E.g., "Tuesday, March 24th at 2:00 PM with Dr. Smith"
 */
export function formatSlotForSpeech(slot: Slot, providerName?: string): string {
  const dateTime = formatDateTimeForSpeech(slot.start);
  let result = dateTime;
  if (providerName) {
    result += ` with ${providerName}`;
  }
  return result;
}

/** Structured response with speech (for TTS) and context (for AI). */
export interface SpeechContextResponse {
  speech: string;
  context: string;
}

/**
 * Format a list of slots as a numbered speech-friendly list.
 * Returns { speech, context } — speech has no slot IDs, context has slot ID mappings for the AI.
 */
export function formatSlotListForSpeech(
  slots: Array<{ slot: Slot; providerName?: string }>,
  maxSlots: number = 5
): SpeechContextResponse {
  if (slots.length === 0) {
    const msg = 'No available appointment times were found matching your criteria.';
    return { speech: msg, context: msg };
  }

  const limited = slots.slice(0, maxSlots);
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
  
  const speechLines = limited.map((s, i) => {
    const prefix = ordinals[i] || `Option ${i + 1}`;
    return `${prefix}, ${formatSlotForSpeech(s.slot, s.providerName)}`;
  });

  let speech = `I found ${slots.length} available opening${slots.length > 1 ? 's' : ''}. `;
  speech += speechLines.join('. ') + '.';
  
  if (slots.length > maxSlots) {
    speech += ` There are ${slots.length - maxSlots} more options available. Would you like to hear more?`;
  } else {
    speech += ' Which time works best for you?';
  }

  // Context includes the same text plus a slot ID mapping for the AI
  const slotMapping = limited.map((s, i) => {
    const prefix = ordinals[i] || `Option ${i + 1}`;
    return `${prefix}: slot_id=${s.slot.id}`;
  });
  const context = speech + '\nSlot IDs: ' + slotMapping.join(', ');

  return { speech, context };
}

/**
 * Format an appointment confirmation for speech.
 */
export function formatAppointmentConfirmation(
  appointment: Appointment,
  bookingReference: string,
  natoReference: string
): SpeechContextResponse {
  const dateTime = appointment.start 
    ? formatDateTimeForSpeech(appointment.start) 
    : 'the requested time';
  
  const providerParticipant = appointment.participant?.find(p => 
    p.actor?.reference?.startsWith('Practitioner/') || 
    (p.type?.[0]?.coding?.[0]?.code === 'ATND')
  );
  const providerName = providerParticipant?.actor?.display || '';
  
  let speech = `Your appointment is confirmed for ${dateTime}`;
  if (providerName) {
    speech += ` with ${providerName}`;
  }
  speech += `. Your booking reference is ${natoReference}. `;
  speech += `That's ${bookingReference}. Please save this reference — you'll need it to check on or cancel your appointment.`;
  
  const context = speech + `\nAppointment ID: ${appointment.id || 'unknown'}, Booking Reference: ${bookingReference}`;
  return { speech, context };
}

/**
 * Format schedule list for speech output.
 */
export function formatScheduleListForSpeech(schedules: Schedule[]): SpeechContextResponse {
  if (schedules.length === 0) {
    const msg = 'No provider schedules were found matching your criteria.';
    return { speech: msg, context: msg };
  }

  const lines = schedules.map(schedule => {
    const name = getProviderName(schedule);
    const specialties = schedule.specialty
      ?.map(s => s.text || s.coding?.[0]?.display)
      .filter(Boolean)
      .join(', ');
    
    let line = name;
    if (specialties) {
      line += `, specializing in ${specialties}`;
    }
    if (schedule.planningHorizon) {
      if (schedule.planningHorizon.start && schedule.planningHorizon.end) {
        const from = formatDateForSpeech(schedule.planningHorizon.start);
        const to = formatDateForSpeech(schedule.planningHorizon.end);
        line += `, available from ${from} through ${to}`;
      }
    }
    return line;
  });

  const speech = `I found ${schedules.length} provider schedule${schedules.length > 1 ? 's' : ''}. ${lines.join('. ')}.`;

  // Context includes schedule IDs for the AI
  const scheduleMapping = schedules.map(s => `${getProviderName(s)}: schedule_id=${s.id}`).join(', ');
  const context = speech + '\nSchedule IDs: ' + scheduleMapping;

  return { speech, context };
}
