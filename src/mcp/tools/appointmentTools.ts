/**
 * MCP Tools: book_appointment, cancel_appointment, get_appointment_by_reference
 * 
 * These tools handle appointment lifecycle operations.
 * 
 * Trust model: FHIRTogether is a public scheduling system (like cal.com/Calendly).
 * Callers provide self-reported identity info which is recorded as-is, NOT verified.
 * The booking reference serves as a bearer token for future lookup/cancellation.
 */

import { FhirStore, Appointment } from '../../types/fhir';
import { generateBookingReference, referenceToNato } from './bookingReference';
import { formatAppointmentConfirmation, formatDateTimeForSpeech, getProviderName, SpeechContextResponse } from './formatters';

// ============================================================================
// book_appointment
// ============================================================================

export const bookAppointmentDefinition = {
  name: 'book_appointment',
  description: 'Book an appointment in an available time slot. Requires a slot_id from search_available_slots results, plus the caller\'s self-reported name and phone number. The caller\'s identity is NOT verified — it is recorded as provided. Returns a booking reference code that the caller should save for future lookup or cancellation.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      slot_id: {
        type: 'string',
        description: 'The ID of the available slot to book (obtained from search_available_slots results)',
      },
      caller_name: {
        type: 'string',
        description: 'Full name of the person booking the appointment, as stated by the caller',
      },
      caller_phone: {
        type: 'string',
        description: 'Phone number of the person booking, as stated by the caller',
      },
      caller_dob: {
        type: 'string',
        description: 'Date of birth in YYYY-MM-DD format (optional, if provided by the caller)',
      },
      reason: {
        type: 'string',
        description: 'Reason for the appointment, as stated by the caller',
      },
      caller_email: {
        type: 'string',
        description: 'Email address of the caller (optional)',
      },
    },
    required: ['slot_id', 'caller_name', 'caller_phone'],
  },
};

export async function bookAppointment(
  store: FhirStore,
  args: {
    slot_id: string;
    caller_name: string;
    caller_phone: string;
    caller_dob?: string;
    reason?: string;
    caller_email?: string;
  }
): Promise<SpeechContextResponse> {
  // Verify the slot exists and is free
  const slot = await store.getSlotById(args.slot_id);
  if (!slot) {
    const msg = 'I\'m sorry, that appointment slot could not be found. It may have been taken. Would you like to search for other available times?';
    return { speech: msg, context: msg };
  }
  if (slot.status !== 'free') {
    const msg = 'I\'m sorry, that time slot is no longer available — someone else may have just booked it. Would you like to search for other available times?';
    return { speech: msg, context: msg };
  }

  // Look up the schedule to get the provider for this slot
  const scheduleRef = slot.schedule?.reference; // e.g. "Schedule/72"
  const scheduleId = scheduleRef?.replace('Schedule/', '');
  let providerActor: { reference: string; display: string } | undefined;

  if (scheduleId) {
    const schedule = await store.getScheduleById(scheduleId);
    if (schedule) {
      const practitioner = schedule.actor?.find(a => a.reference?.startsWith('Practitioner/'));
      if (practitioner) {
        providerActor = {
          reference: practitioner.reference,
          display: practitioner.display || getProviderName(schedule),
        };
      }
    }
  }

  // Generate booking reference
  const bookingReference = generateBookingReference();
  const natoReference = referenceToNato(bookingReference);

  // Build the FHIR Appointment resource
  const appointment: Appointment = {
    resourceType: 'Appointment',
    status: 'booked',
    identifier: [
      {
        system: 'urn:fhirtogether:booking-reference',
        value: bookingReference,
      },
    ],
    slot: [{ reference: `Slot/${slot.id}` }],
    start: slot.start,
    end: slot.end,
    created: new Date().toISOString(),
    description: args.reason || undefined,
    comment: `Booked via IVR. Caller identity is self-reported and unverified.`,
    participant: [
      {
        // The caller/patient participant — self-reported identity
        actor: {
          display: args.caller_name,
          reference: `Patient/unverified-${args.caller_phone.replace(/\D/g, '')}`,
        },
        required: 'required',
        status: 'accepted',
        type: [
          {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'SBJ', display: 'Subject' }],
            text: 'Patient',
          },
        ],
      },
    ],
  };

  // Add the provider/practitioner participant from the slot's schedule
  if (providerActor) {
    appointment.participant.push({
      actor: providerActor,
      required: 'required',
      status: 'accepted',
      type: [
        {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'PPRF', display: 'Primary Performer' }],
          text: 'Practitioner',
        },
      ],
    });
  }

  // Add appointment type as a reason code if provided
  if (args.reason) {
    appointment.reasonCode = [{ text: args.reason }];
  }

  // Store contact info in participant extensions via comment
  const contactParts: string[] = [];
  contactParts.push(`Phone: ${args.caller_phone}`);
  if (args.caller_dob) contactParts.push(`DOB: ${args.caller_dob}`);
  if (args.caller_email) contactParts.push(`Email: ${args.caller_email}`);
  appointment.patientInstruction = `Self-reported contact: ${contactParts.join(', ')}`;

  // Create the appointment
  const created = await store.createAppointment(appointment);

  // Mark the slot as busy
  await store.updateSlot(args.slot_id, { status: 'busy' });

  return formatAppointmentConfirmation(created, bookingReference, natoReference);
}

// ============================================================================
// cancel_appointment
// ============================================================================

export const cancelAppointmentDefinition = {
  name: 'cancel_appointment',
  description: 'Cancel an existing appointment using the booking reference code provided at the time of booking. The caller must provide the booking reference (e.g., "BK-7X3M") — this serves as proof that they booked the appointment.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      booking_reference: {
        type: 'string',
        description: 'The booking reference code given when the appointment was booked (e.g., "BK-7X3M")',
      },
    },
    required: ['booking_reference'],
  },
};

export async function cancelAppointment(
  store: FhirStore,
  args: { booking_reference: string }
): Promise<SpeechContextResponse> {
  const ref = args.booking_reference.toUpperCase().trim();
  
  // Look up appointment by booking reference identifier
  const matching = await store.getAppointmentByIdentifier(
    'urn:fhirtogether:booking-reference',
    ref
  );

  if (!matching || !matching.id) {
    const msg = 'I wasn\'t able to find an appointment with that booking reference. Please double-check the reference code and try again. If you\'ve lost your reference, you may need to call the office directly for assistance.';
    return { speech: msg, context: msg };
  }

  if (matching.status === 'cancelled') {
    const msg = 'That appointment has already been cancelled.';
    return { speech: msg, context: msg };
  }

  // Cancel the appointment
  await store.updateAppointment(matching.id, {
    status: 'cancelled',
    cancelationReason: {
      text: 'Cancelled by caller via IVR',
    },
  });

  // Free up the slot if we can find it
  if (matching.slot && matching.slot.length > 0) {
    const slotRef = matching.slot[0].reference;
    const slotId = slotRef?.replace('Slot/', '');
    if (slotId) {
      try {
        await store.updateSlot(slotId, { status: 'free' });
      } catch (_e) {
        // Slot may have been already modified; non-critical
      }
    }
  }

  const dateStr = matching.start ? formatDateTimeForSpeech(matching.start) : 'the scheduled time';
  const speech = `Your appointment for ${dateStr} has been successfully cancelled. The time slot has been freed up. Is there anything else I can help you with?`;
  const context = speech + `\nCancelled appointment reference: ${ref}`;
  return { speech, context };
}

// ============================================================================
// get_appointment_by_reference
// ============================================================================

export const getAppointmentByReferenceDefinition = {
  name: 'get_appointment_by_reference',
  description: 'Look up an existing appointment using the booking reference code. Use this when a caller wants to check on their appointment status, confirm the date/time, or verify their booking. Requires the booking reference given at booking time.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      booking_reference: {
        type: 'string',
        description: 'The booking reference code given when the appointment was booked (e.g., "BK-7X3M")',
      },
    },
    required: ['booking_reference'],
  },
};

export async function getAppointmentByReference(
  store: FhirStore,
  args: { booking_reference: string }
): Promise<SpeechContextResponse> {
  const ref = args.booking_reference.toUpperCase().trim();
  
  // Look up appointment by booking reference identifier
  const matching = await store.getAppointmentByIdentifier(
    'urn:fhirtogether:booking-reference',
    ref
  );

  if (!matching) {
    const msg = 'I wasn\'t able to find an appointment with that booking reference. Please double-check the reference code and try again. If you\'ve lost your reference, you may need to call the office directly for assistance.';
    return { speech: msg, context: msg };
  }

  const dateStr = matching.start ? formatDateTimeForSpeech(matching.start) : 'no scheduled time';
  const status = matching.status || 'unknown';
  
  const providerParticipant = matching.participant?.find(p =>
    p.actor?.reference?.startsWith('Practitioner/')
  );
  const providerName = providerParticipant?.actor?.display;

  let speech = `I found your appointment. Status: ${status}. `;
  speech += `Scheduled for ${dateStr}`;
  if (providerName) {
    speech += ` with ${providerName}`;
  }
  speech += '.';
  
  if (matching.description) {
    speech += ` Reason: ${matching.description}.`;
  }

  if (status === 'cancelled') {
    speech += ' This appointment has been cancelled.';
  }

  const context = speech + `\nAppointment ID: ${matching.id || 'unknown'}, Booking Reference: ${ref}`;
  return { speech, context };
}
