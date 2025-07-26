/**
 * Pluggable Backend Store Interface
 */

import { Schedule, Slot, Appointment, FhirSlotQuery, FhirScheduleQuery, FhirAppointmentQuery } from '../types/fhir';

export interface FhirStore {
  // Schedule operations
  getSchedules(query: FhirScheduleQuery): Promise<Schedule[]>;
  getScheduleById(id: string): Promise<Schedule | null>;
  createSchedule(schedule: Schedule): Promise<Schedule>;
  updateSchedule(id: string, schedule: Schedule): Promise<Schedule>;
  deleteSchedule(id: string): Promise<boolean>;

  // Slot operations
  getSlots(query: FhirSlotQuery): Promise<Slot[]>;
  getSlotById(id: string): Promise<Slot | null>;
  createSlot(slot: Slot): Promise<Slot>;
  updateSlot(id: string, slot: Slot): Promise<Slot>;
  deleteSlot(id: string): Promise<boolean>;
  deleteAllSlots(): Promise<boolean>;

  // Appointment operations
  getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]>;
  getAppointmentById(id: string): Promise<Appointment | null>;
  createAppointment(appointment: Appointment): Promise<Appointment>;
  updateAppointment(id: string, appointment: Appointment): Promise<Appointment>;
  deleteAppointment(id: string): Promise<boolean>;

  // Test mode operations
  deleteAllSchedules(): Promise<boolean>;
  simulateWeek(providerId: string): Promise<{ schedules: Schedule[]; slots: Slot[] }>;
}