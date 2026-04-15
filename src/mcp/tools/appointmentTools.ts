import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FhirStore, Appointment } from '../../types/fhir';
import { formatAppointment, formatAppointmentList, structuredResult, speechAppointment, speechAppointmentList, formatDateTime } from './formatters';
import { generateBookingReference, BOOKING_REFERENCE_SYSTEM } from './bookingReference';

/**
 * Register appointment-related MCP tools
 */
export function registerAppointmentTools(server: McpServer, store: FhirStore): void {
  // Book appointment tool
  server.tool(
    'book_appointment',
    'Book an appointment by selecting an available slot. This creates a new appointment in the system.',
    {
      slot_id: z.string().describe('The ID of the slot to book'),
      patient_name: z.string().describe('The name of the patient'),
      patient_phone: z.string().optional().describe('Patient phone number'),
      reason: z.string().optional().describe('Reason for the appointment'),
      notes: z.string().optional().describe('Additional notes or comments'),
      hold_token: z.string().optional().describe('Hold token if the slot was previously held (will be released after booking)'),
    },
    async ({ slot_id, patient_name, patient_phone, reason, notes, hold_token }) => {
      try {
        const slot = await store.getSlotById(slot_id);
        if (!slot) {
          return { content: [{ type: 'text', text: `Slot not found: ${slot_id}` }], isError: true };
        }
        if (slot.status !== 'free') {
          return { content: [{ type: 'text', text: `Slot is not available. Current status: ${slot.status}` }], isError: true };
        }

        const bookingReference = generateBookingReference();
        const appointment: Appointment = {
          resourceType: 'Appointment',
          status: 'booked',
          identifier: [{ system: BOOKING_REFERENCE_SYSTEM, value: bookingReference }],
          slot: [{ reference: `Slot/${slot_id}` }],
          start: slot.start,
          end: slot.end,
          serviceType: slot.serviceType,
          appointmentType: slot.appointmentType,
          reasonCode: reason ? [{ text: reason }] : undefined,
          comment: notes,
          participant: [{
            actor: { reference: `Patient/${patient_name.replace(/\s+/g, '-').toLowerCase()}`, display: patient_name },
            status: 'accepted',
          }],
        };

        if (patient_phone) {
          appointment.comment = appointment.comment ? `${appointment.comment}\nPhone: ${patient_phone}` : `Phone: ${patient_phone}`;
        }

        const created = await store.createAppointment(appointment);

        if (hold_token) {
          try { await store.releaseHold(hold_token); } catch { /* ignore */ }
        }

        const context = `Appointment booked successfully!\n\nBooking Reference: ${bookingReference}\n\n${formatAppointment(created)}`;
        const speech = `Your appointment has been booked! Your booking reference is ${bookingReference}.`;
        return structuredResult(speech, context);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error booking appointment: ${error instanceof Error ? error.message : 'Unknown error'}` }], isError: true };
      }
    }
  );

  // List appointments tool
  server.tool(
    'list_appointments',
    'List appointments. Can filter by date, status, or patient.',
    {
      date: z.string().optional().describe('Filter by date (ISO 8601 format, e.g., 2024-01-15)'),
      status: z.enum(['proposed', 'pending', 'booked', 'arrived', 'fulfilled', 'cancelled', 'noshow']).optional().describe('Filter by appointment status'),
      patient: z.string().optional().describe('Filter by patient name (partial match)'),
      limit: z.number().optional().describe('Maximum number of appointments to return'),
    },
    async ({ date, status, patient, limit }) => {
      try {
        const appointments = await store.getAppointments({ date, status, patient, _count: limit });
        const context = formatAppointmentList(appointments);
        const speech = speechAppointmentList(appointments);
        return structuredResult(speech, context);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error listing appointments: ${error instanceof Error ? error.message : 'Unknown error'}` }], isError: true };
      }
    }
  );

  // Get appointment by ID tool
  server.tool(
    'get_appointment',
    'Get details of a specific appointment by its ID.',
    { appointment_id: z.string().describe('The ID of the appointment to retrieve') },
    async ({ appointment_id }) => {
      try {
        const appointment = await store.getAppointmentById(appointment_id);
        if (!appointment) {
          return { content: [{ type: 'text', text: `Appointment not found: ${appointment_id}` }], isError: true };
        }
        const context = formatAppointment(appointment);
        const speech = speechAppointment(appointment);
        return structuredResult(speech, context);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error getting appointment: ${error instanceof Error ? error.message : 'Unknown error'}` }], isError: true };
      }
    }
  );

  // Lookup appointment by booking reference tool
  server.tool(
    'lookup_appointment',
    'Look up an appointment by its booking reference (e.g., "happy-oak-4821").',
    { booking_reference: z.string().describe('The booking reference to look up (e.g., "happy-oak-4821")') },
    async ({ booking_reference }) => {
      try {
        const appointment = await store.getAppointmentByIdentifier(BOOKING_REFERENCE_SYSTEM, booking_reference);
        if (!appointment) {
          return { content: [{ type: 'text', text: `No appointment found with booking reference: ${booking_reference}` }], isError: true };
        }
        const context = formatAppointment(appointment);
        const speech = speechAppointment(appointment);
        return structuredResult(speech, context);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error looking up appointment: ${error instanceof Error ? error.message : 'Unknown error'}` }], isError: true };
      }
    }
  );

  // Cancel appointment tool
  server.tool(
    'cancel_appointment',
    'Cancel an existing appointment.',
    {
      appointment_id: z.string().optional().describe('The ID of the appointment to cancel'),
      booking_reference: z.string().optional().describe('The booking reference of the appointment to cancel'),
      reason: z.string().optional().describe('Reason for cancellation'),
    },
    async ({ appointment_id, booking_reference, reason }) => {
      try {
        let appointment: Appointment | null = null;
        if (appointment_id) {
          appointment = await store.getAppointmentById(appointment_id);
        } else if (booking_reference) {
          appointment = await store.getAppointmentByIdentifier(BOOKING_REFERENCE_SYSTEM, booking_reference);
        } else {
          return { content: [{ type: 'text', text: 'Please provide either appointment_id or booking_reference' }], isError: true };
        }

        if (!appointment) {
          return { content: [{ type: 'text', text: 'Appointment not found' }], isError: true };
        }

        const updated = await store.updateAppointment(appointment.id!, {
          status: 'cancelled',
          cancelationReason: reason ? { text: reason } : undefined,
        });

        if (appointment.slot) {
          for (const slotRef of appointment.slot) {
            const slotId = slotRef.reference.split('/').pop();
            if (slotId) { await store.updateSlot(slotId, { status: 'free' }); }
          }
        }

        const context = `Appointment cancelled successfully.\n\n${formatAppointment(updated)}`;
        const speech = 'Your appointment has been cancelled.';
        return structuredResult(speech, context);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error cancelling appointment: ${error instanceof Error ? error.message : 'Unknown error'}` }], isError: true };
      }
    }
  );

  // Reschedule appointment tool
  server.tool(
    'reschedule_appointment',
    'Reschedule an existing appointment to a new slot.',
    {
      appointment_id: z.string().optional().describe('The ID of the appointment to reschedule'),
      booking_reference: z.string().optional().describe('The booking reference of the appointment to reschedule'),
      new_slot_id: z.string().describe('The ID of the new slot to reschedule to'),
    },
    async ({ appointment_id, booking_reference, new_slot_id }) => {
      try {
        let appointment: Appointment | null = null;
        if (appointment_id) {
          appointment = await store.getAppointmentById(appointment_id);
        } else if (booking_reference) {
          appointment = await store.getAppointmentByIdentifier(BOOKING_REFERENCE_SYSTEM, booking_reference);
        } else {
          return { content: [{ type: 'text', text: 'Please provide either appointment_id or booking_reference' }], isError: true };
        }

        if (!appointment) {
          return { content: [{ type: 'text', text: 'Appointment not found' }], isError: true };
        }

        const newSlot = await store.getSlotById(new_slot_id);
        if (!newSlot) {
          return { content: [{ type: 'text', text: `New slot not found: ${new_slot_id}` }], isError: true };
        }

        if (newSlot.status !== 'free') {
          return { content: [{ type: 'text', text: `New slot is not available. Current status: ${newSlot.status}` }], isError: true };
        }

        if (appointment.slot) {
          for (const slotRef of appointment.slot) {
            const slotId = slotRef.reference.split('/').pop();
            if (slotId) { await store.updateSlot(slotId, { status: 'free' }); }
          }
        }

        const updated = await store.updateAppointment(appointment.id!, {
          slot: [{ reference: `Slot/${new_slot_id}` }],
          start: newSlot.start,
          end: newSlot.end,
        });

        await store.updateSlot(new_slot_id, { status: 'busy' });

        const context = `Appointment rescheduled successfully.\n\n${formatAppointment(updated)}`;
        const speech = `Your appointment has been rescheduled to ${formatDateTime(newSlot.start)}.`;
        return structuredResult(speech, context);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error rescheduling appointment: ${error instanceof Error ? error.message : 'Unknown error'}` }], isError: true };
      }
    }
  );
}
