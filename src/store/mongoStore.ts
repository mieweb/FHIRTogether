/**
 * MongoDB Store Implementation (Stub)
 */

import { FhirStore } from './interface';
import { Schedule, Slot, Appointment, FhirSlotQuery, FhirScheduleQuery, FhirAppointmentQuery } from '../types/fhir';

export class MongoStore implements FhirStore {
  constructor() {
    console.log('MongoDB store initialized (stub implementation)');
  }

  async getSchedules(query: FhirScheduleQuery): Promise<Schedule[]> {
    throw new Error('MongoDB store not yet implemented');
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    throw new Error('MongoDB store not yet implemented');
  }

  async createSchedule(schedule: Schedule): Promise<Schedule> {
    throw new Error('MongoDB store not yet implemented');
  }

  async updateSchedule(id: string, schedule: Schedule): Promise<Schedule> {
    throw new Error('MongoDB store not yet implemented');
  }

  async deleteSchedule(id: string): Promise<boolean> {
    throw new Error('MongoDB store not yet implemented');
  }

  async deleteAllSchedules(): Promise<boolean> {
    throw new Error('MongoDB store not yet implemented');
  }

  async getSlots(query: FhirSlotQuery): Promise<Slot[]> {
    throw new Error('MongoDB store not yet implemented');
  }

  async getSlotById(id: string): Promise<Slot | null> {
    throw new Error('MongoDB store not yet implemented');
  }

  async createSlot(slot: Slot): Promise<Slot> {
    throw new Error('MongoDB store not yet implemented');
  }

  async updateSlot(id: string, slot: Slot): Promise<Slot> {
    throw new Error('MongoDB store not yet implemented');
  }

  async deleteSlot(id: string): Promise<boolean> {
    throw new Error('MongoDB store not yet implemented');
  }

  async deleteAllSlots(): Promise<boolean> {
    throw new Error('MongoDB store not yet implemented');
  }

  async getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]> {
    throw new Error('MongoDB store not yet implemented');
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    throw new Error('MongoDB store not yet implemented');
  }

  async createAppointment(appointment: Appointment): Promise<Appointment> {
    throw new Error('MongoDB store not yet implemented');
  }

  async updateAppointment(id: string, appointment: Appointment): Promise<Appointment> {
    throw new Error('MongoDB store not yet implemented');
  }

  async deleteAppointment(id: string): Promise<boolean> {
    throw new Error('MongoDB store not yet implemented');
  }

  async simulateWeek(providerId: string): Promise<{ schedules: Schedule[]; slots: Slot[] }> {
    throw new Error('MongoDB store not yet implemented');
  }
}