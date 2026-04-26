import { Schedule, Slot, Appointment, CodeableConcept, Reference } from '../../types/fhir';

/**
 * Extract the system name from a Schedule's extension (added by sqliteStore).
 */
export function getSystemName(schedule: Schedule): string | undefined {
  const ext = (schedule as Schedule & { extension?: { url: string; valueString?: string }[] }).extension;
  return ext?.find(e => e.url === 'https://fhirtogether.org/fhir/StructureDefinition/system-name')?.valueString;
}

/**
 * Helper to build the structured JSON response the IVR expects.
 * `speech` is caller-friendly (read aloud), `context` has full detail for the AI.
 */
export function structuredResult(speech: string, context: string): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ speech, context }) }],
  };
}

/**
 * Format a CodeableConcept for display
 */
export function formatCodeableConcept(concept: CodeableConcept | undefined): string {
  if (!concept) return '';
  if (concept.text) return concept.text;
  if (concept.coding && concept.coding.length > 0) {
    return concept.coding[0].display || concept.coding[0].code || '';
  }
  return '';
}

/**
 * Format a CodeableConcept array for display
 */
export function formatCodeableConceptArray(concepts: CodeableConcept[] | undefined): string {
  if (!concepts || concepts.length === 0) return '';
  return concepts.map(formatCodeableConcept).filter(Boolean).join(', ');
}

/**
 * Format a Reference for display
 */
export function formatReference(ref: Reference | undefined): string {
  if (!ref) return '';
  return ref.display || ref.reference || '';
}

/**
 * Format a date/time string for human display
 */
export function formatDateTime(isoString: string | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format just the date portion
 */
export function formatDate(isoString: string | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format just the time portion
 */
export function formatTime(isoString: string | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a Schedule resource for LLM consumption
 */
export function formatSchedule(schedule: Schedule): string {
  const parts: string[] = [];
  parts.push(`Schedule ID: ${schedule.id}`);

  if (schedule.actor && schedule.actor.length > 0) {
    const actors = schedule.actor.map(formatReference).filter(Boolean);
    if (actors.length > 0) {
      parts.push(`Provider: ${actors.join(', ')}`);
    }
  }

  if (schedule.serviceType && schedule.serviceType.length > 0) {
    parts.push(`Service Type: ${formatCodeableConceptArray(schedule.serviceType)}`);
  }

  if (schedule.specialty && schedule.specialty.length > 0) {
    parts.push(`Specialty: ${formatCodeableConceptArray(schedule.specialty)}`);
  }

  if (schedule.planningHorizon) {
    if (schedule.planningHorizon.start) {
      parts.push(`Available from: ${formatDate(schedule.planningHorizon.start)}`);
    }
    if (schedule.planningHorizon.end) {
      parts.push(`Available until: ${formatDate(schedule.planningHorizon.end)}`);
    }
  }

  if (schedule.comment) {
    parts.push(`Notes: ${schedule.comment}`);
  }

  parts.push(`Status: ${schedule.active ? 'Active' : 'Inactive'}`);
  return parts.join('\n');
}

/**
 * Format a Slot resource for LLM consumption
 */
export function formatSlot(slot: Slot): string {
  const parts: string[] = [];
  parts.push(`Slot ID: ${slot.id}`);
  parts.push(`Status: ${slot.status}`);
  parts.push(`Start: ${formatDateTime(slot.start)}`);
  parts.push(`End: ${formatDateTime(slot.end)}`);

  if (slot.serviceType && slot.serviceType.length > 0) {
    parts.push(`Service Type: ${formatCodeableConceptArray(slot.serviceType)}`);
  }

  if (slot.appointmentType) {
    parts.push(`Appointment Type: ${formatCodeableConcept(slot.appointmentType)}`);
  }

  if (slot.comment) {
    parts.push(`Notes: ${slot.comment}`);
  }

  return parts.join('\n');
}

/**
 * Format an Appointment resource for LLM consumption
 */
export function formatAppointment(appointment: Appointment): string {
  const parts: string[] = [];
  parts.push(`Appointment ID: ${appointment.id}`);
  parts.push(`Status: ${appointment.status}`);

  if (appointment.start) {
    parts.push(`Start: ${formatDateTime(appointment.start)}`);
  }
  if (appointment.end) {
    parts.push(`End: ${formatDateTime(appointment.end)}`);
  }

  if (appointment.serviceType && appointment.serviceType.length > 0) {
    parts.push(`Service Type: ${formatCodeableConceptArray(appointment.serviceType)}`);
  }

  if (appointment.appointmentType) {
    parts.push(`Appointment Type: ${formatCodeableConcept(appointment.appointmentType)}`);
  }

  if (appointment.reasonCode && appointment.reasonCode.length > 0) {
    parts.push(`Reason: ${formatCodeableConceptArray(appointment.reasonCode)}`);
  }

  if (appointment.description) {
    parts.push(`Description: ${appointment.description}`);
  }

  // Format participants
  if (appointment.participant && appointment.participant.length > 0) {
    const participants = appointment.participant.map((p) => {
      const actor = formatReference(p.actor);
      const status = p.status;
      return actor ? `${actor} (${status})` : null;
    }).filter(Boolean);
    if (participants.length > 0) {
      parts.push(`Participants: ${participants.join(', ')}`);
    }
  }

  // Include booking reference if present
  if (appointment.identifier && appointment.identifier.length > 0) {
    const bookingRef = appointment.identifier.find(
      (id) => id.system === 'urn:booking-reference'
    );
    if (bookingRef) {
      parts.push(`Booking Reference: ${bookingRef.value}`);
    }
  }

  if (appointment.comment) {
    parts.push(`Notes: ${appointment.comment}`);
  }

  if (appointment.patientInstruction) {
    parts.push(`Patient Instructions: ${appointment.patientInstruction}`);
  }

  return parts.join('\n');
}

/**
 * Format multiple schedules as a list
 */
export function formatScheduleList(schedules: Schedule[]): string {
  if (schedules.length === 0) {
    return 'No schedules found.';
  }
  return schedules.map((s, i) => `### Schedule ${i + 1}\n${formatSchedule(s)}`).join('\n\n');
}

/**
 * Format multiple slots as a list
 */
export function formatSlotList(slots: Slot[]): string {
  if (slots.length === 0) {
    return 'No available slots found.';
  }
  return slots.map((s, i) => `### Slot ${i + 1}\n${formatSlot(s)}`).join('\n\n');
}

/**
 * Format multiple appointments as a list
 */
export function formatAppointmentList(appointments: Appointment[]): string {
  if (appointments.length === 0) {
    return 'No appointments found.';
  }
  return appointments.map((a, i) => `### Appointment ${i + 1}\n${formatAppointment(a)}`).join('\n\n');
}

// ==================== SPEECH-FRIENDLY FORMATTERS ====================
// These produce short, caller-friendly text meant to be read aloud via TTS.

/**
 * Speech-friendly provider list: just names and specialties.
 */
export function speechProviderList(schedules: Schedule[]): string {
  if (schedules.length === 0) return 'There are no providers available right now.';
  const names = schedules.map((s) => {
    const name = s.actor?.[0]?.display || 'Unknown provider';
    const specialty = formatCodeableConceptArray(s.serviceType);
    return specialty ? `${name} in ${specialty}` : name;
  });
  if (names.length === 1) return `We have ${names[0]} available.`;
  return `We have ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]} available.`;
}

/**
 * Speech-friendly slot list: just times.
 */
export function speechSlotList(slots: Slot[]): string {
  if (slots.length === 0) return 'There are no available time slots for that date.';
  const times = slots.map((s) => formatTime(s.start));
  const count = slots.length;
  return `I found ${count} available time slot${count === 1 ? '' : 's'}. The times are: ${times.join(', ')}.`;
}

/**
 * Speech-friendly single slot.
 */
export function speechSlot(slot: Slot): string {
  return `${formatTime(slot.start)} to ${formatTime(slot.end)}, ${slot.status}.`;
}

/**
 * Speech-friendly appointment summary.
 */
export function speechAppointment(appointment: Appointment): string {
  const parts: string[] = [];
  if (appointment.start) parts.push(formatDateTime(appointment.start));
  const provider = appointment.participant?.find(p => p.actor?.reference?.startsWith('Practitioner/'));
  if (provider?.actor?.display) parts.push(`with ${provider.actor.display}`);
  parts.push(`Status: ${appointment.status}`);
  const bookingRef = appointment.identifier?.find(id => id.system === 'urn:booking-reference');
  if (bookingRef) parts.push(`Booking reference: ${bookingRef.value}`);
  return parts.join('. ') + '.';
}

/**
 * Speech-friendly appointment list.
 */
export function speechAppointmentList(appointments: Appointment[]): string {
  if (appointments.length === 0) return 'No appointments were found.';
  return appointments.map((a, i) => `Appointment ${i + 1}: ${speechAppointment(a)}`).join(' ');
}
