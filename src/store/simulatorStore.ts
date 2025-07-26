/**
 * In-Memory Simulator Store Implementation
 * This is the only functional backend - others are stubs
 */

import { v4 as uuidv4 } from 'uuid';
import { FhirStore } from './interface';
import { Schedule, Slot, Appointment, FhirSlotQuery, FhirScheduleQuery, FhirAppointmentQuery, Reference, Period } from '../types/fhir';

export class SimulatorStore implements FhirStore {
  private schedules: Map<string, Schedule> = new Map();
  private slots: Map<string, Slot> = new Map();
  private appointments: Map<string, Appointment> = new Map();

  constructor() {
    this.initializeSampleData();
  }

  private initializeSampleData(): void {
    // Create sample schedules
    const drSmithSchedule: Schedule = {
      resourceType: 'Schedule',
      id: 'schedule-dr-smith',
      active: true,
      actor: [{
        reference: 'Practitioner/dr-smith',
        display: 'Dr. John Smith'
      }],
      serviceCategory: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-category',
          code: 'gp',
          display: 'General Practice'
        }]
      }],
      serviceType: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-type',
          code: '124',
          display: 'General Practice'
        }]
      }],
      planningHorizon: {
        start: '2024-01-01T00:00:00Z',
        end: '2024-12-31T23:59:59Z'
      },
      comment: 'Dr. Smith\'s regular schedule'
    };

    const xraySchedule: Schedule = {
      resourceType: 'Schedule',
      id: 'schedule-xray',
      active: true,
      actor: [{
        reference: 'Location/xray-room-1',
        display: 'X-Ray Room 1'
      }],
      serviceCategory: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-category',
          code: 'diagnostic',
          display: 'Diagnostic'
        }]
      }],
      serviceType: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-type',
          code: '708',
          display: 'X-Ray'
        }]
      }],
      planningHorizon: {
        start: '2024-01-01T00:00:00Z',
        end: '2024-12-31T23:59:59Z'
      },
      comment: 'X-Ray imaging schedule'
    };

    const ekgSchedule: Schedule = {
      resourceType: 'Schedule',
      id: 'schedule-ekg',
      active: true,
      actor: [{
        reference: 'Location/ekg-room-1',
        display: 'EKG Room 1'
      }],
      serviceCategory: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-category',
          code: 'diagnostic',
          display: 'Diagnostic'
        }]
      }],
      serviceType: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-type',
          code: '722',
          display: 'EKG'
        }]
      }],
      planningHorizon: {
        start: '2024-01-01T00:00:00Z',
        end: '2024-12-31T23:59:59Z'
      },
      comment: 'EKG testing schedule'
    };

    this.schedules.set(drSmithSchedule.id!, drSmithSchedule);
    this.schedules.set(xraySchedule.id!, xraySchedule);
    this.schedules.set(ekgSchedule.id!, ekgSchedule);

    // Create sample slots for next 7 days
    this.generateSampleSlots();
  }

  private generateSampleSlots(): void {
    const now = new Date();
    const scheduleIds = ['schedule-dr-smith', 'schedule-xray', 'schedule-ekg'];
    
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const currentDate = new Date(now);
      currentDate.setDate(currentDate.getDate() + dayOffset);
      
      scheduleIds.forEach(scheduleId => {
        this.generateDailySlotsForSchedule(scheduleId, currentDate);
      });
    }
  }

  private generateDailySlotsForSchedule(scheduleId: string, date: Date): void {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return;

    // Skip weekends for simplicity
    if (date.getDay() === 0 || date.getDay() === 6) return;

    // Generate slots from 9 AM to 5 PM, 30-minute intervals
    for (let hour = 9; hour < 17; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(date);
        slotStart.setHours(hour, minute, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 30);

        const slot: Slot = {
          resourceType: 'Slot',
          id: `slot-${scheduleId}-${slotStart.getTime()}`,
          schedule: {
            reference: `Schedule/${scheduleId}`
          },
          status: 'free',
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          serviceCategory: schedule.serviceCategory,
          serviceType: schedule.serviceType,
          specialty: schedule.specialty
        };

        this.slots.set(slot.id!, slot);
      }
    }
  }

  // Schedule operations
  async getSchedules(query: FhirScheduleQuery): Promise<Schedule[]> {
    let results = Array.from(this.schedules.values());

    if (query.actor) {
      results = results.filter(s => 
        s.actor.some(actor => actor.reference?.includes(query.actor!))
      );
    }

    if (query.active !== undefined) {
      results = results.filter(s => s.active === query.active);
    }

    if (query.serviceType) {
      results = results.filter(s =>
        s.serviceType?.some(st =>
          st.coding?.some(c => c.code === query.serviceType || c.display?.includes(query.serviceType!))
        )
      );
    }

    // Apply pagination
    const offset = query._offset || 0;
    const count = query._count || 20;
    return results.slice(offset, offset + count);
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    return this.schedules.get(id) || null;
  }

  async createSchedule(schedule: Schedule): Promise<Schedule> {
    if (!schedule.id) {
      schedule.id = uuidv4();
    }
    schedule.meta = {
      lastUpdated: new Date().toISOString()
    };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  async updateSchedule(id: string, schedule: Schedule): Promise<Schedule> {
    schedule.id = id;
    schedule.meta = {
      lastUpdated: new Date().toISOString()
    };
    this.schedules.set(id, schedule);
    return schedule;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    return this.schedules.delete(id);
  }

  async deleteAllSchedules(): Promise<boolean> {
    this.schedules.clear();
    return true;
  }

  // Slot operations
  async getSlots(query: FhirSlotQuery): Promise<Slot[]> {
    let results = Array.from(this.slots.values());

    if (query.schedule) {
      results = results.filter(s => s.schedule.reference?.includes(query.schedule!));
    }

    if (query.status) {
      results = results.filter(s => s.status === query.status);
    }

    if (query.start) {
      results = results.filter(s => s.start >= query.start!);
    }

    if (query.end) {
      results = results.filter(s => s.end <= query.end!);
    }

    if (query.serviceType) {
      results = results.filter(s =>
        s.serviceType?.some(st =>
          st.coding?.some(c => c.code === query.serviceType || c.display?.includes(query.serviceType!))
        )
      );
    }

    // Apply pagination
    const offset = query._offset || 0;
    const count = query._count || 20;
    return results.slice(offset, offset + count);
  }

  async getSlotById(id: string): Promise<Slot | null> {
    return this.slots.get(id) || null;
  }

  async createSlot(slot: Slot): Promise<Slot> {
    if (!slot.id) {
      slot.id = uuidv4();
    }
    slot.meta = {
      lastUpdated: new Date().toISOString()
    };
    this.slots.set(slot.id, slot);
    return slot;
  }

  async updateSlot(id: string, slot: Slot): Promise<Slot> {
    slot.id = id;
    slot.meta = {
      lastUpdated: new Date().toISOString()
    };
    this.slots.set(id, slot);
    return slot;
  }

  async deleteSlot(id: string): Promise<boolean> {
    return this.slots.delete(id);
  }

  async deleteAllSlots(): Promise<boolean> {
    this.slots.clear();
    return true;
  }

  // Appointment operations
  async getAppointments(query: FhirAppointmentQuery): Promise<Appointment[]> {
    let results = Array.from(this.appointments.values());

    if (query.status) {
      results = results.filter(a => a.status === query.status);
    }

    if (query.patient) {
      results = results.filter(a =>
        a.participant.some(p => p.actor?.reference?.includes(query.patient!))
      );
    }

    if (query.practitioner) {
      results = results.filter(a =>
        a.participant.some(p => p.actor?.reference?.includes(query.practitioner!))
      );
    }

    // Apply pagination
    const offset = query._offset || 0;
    const count = query._count || 20;
    return results.slice(offset, offset + count);
  }

  async getAppointmentById(id: string): Promise<Appointment | null> {
    return this.appointments.get(id) || null;
  }

  async createAppointment(appointment: Appointment): Promise<Appointment> {
    if (!appointment.id) {
      appointment.id = uuidv4();
    }
    appointment.meta = {
      lastUpdated: new Date().toISOString()
    };
    appointment.created = new Date().toISOString();

    // Mark referenced slots as busy
    if (appointment.slot) {
      for (const slotRef of appointment.slot) {
        const slotId = slotRef.reference?.split('/')[1];
        if (slotId) {
          const slot = this.slots.get(slotId);
          if (slot) {
            slot.status = 'busy';
            this.slots.set(slotId, slot);
          }
        }
      }
    }

    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  async updateAppointment(id: string, appointment: Appointment): Promise<Appointment> {
    appointment.id = id;
    appointment.meta = {
      lastUpdated: new Date().toISOString()
    };
    this.appointments.set(id, appointment);
    return appointment;
  }

  async deleteAppointment(id: string): Promise<boolean> {
    const appointment = this.appointments.get(id);
    if (appointment && appointment.slot) {
      // Free up the slots
      for (const slotRef of appointment.slot) {
        const slotId = slotRef.reference?.split('/')[1];
        if (slotId) {
          const slot = this.slots.get(slotId);
          if (slot) {
            slot.status = 'free';
            this.slots.set(slotId, slot);
          }
        }
      }
    }
    return this.appointments.delete(id);
  }

  // Test mode operations
  async simulateWeek(providerId: string): Promise<{ schedules: Schedule[]; slots: Slot[] }> {
    // Create a new schedule for the provider
    const schedule: Schedule = {
      resourceType: 'Schedule',
      id: `schedule-${providerId}`,
      active: true,
      actor: [{
        reference: `Practitioner/${providerId}`,
        display: `Provider ${providerId}`
      }],
      serviceCategory: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-category',
          code: 'gp',
          display: 'General Practice'
        }]
      }],
      planningHorizon: {
        start: new Date().toISOString(),
        end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      comment: `Simulated week for ${providerId}`
    };

    await this.createSchedule(schedule);

    // Generate slots for the next 7 days
    const slots: Slot[] = [];
    for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
      const currentDate = new Date();
      currentDate.setDate(currentDate.getDate() + dayOffset);
      
      // Skip weekends
      if (currentDate.getDay() === 0 || currentDate.getDay() === 6) continue;

      for (let hour = 9; hour < 17; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, minute, 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + 30);

          const slot: Slot = {
            resourceType: 'Slot',
            id: `slot-${providerId}-${slotStart.getTime()}`,
            schedule: {
              reference: `Schedule/${schedule.id}`
            },
            status: 'free',
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            serviceCategory: schedule.serviceCategory,
            serviceType: schedule.serviceType
          };

          await this.createSlot(slot);
          slots.push(slot);
        }
      }
    }

    return { schedules: [schedule], slots };
  }
}