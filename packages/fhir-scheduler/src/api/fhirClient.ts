import type {
  Schedule,
  Slot,
  Appointment,
  PatientInfo,
  QuestionnaireResponse,
  SlotHold,
  Bundle,
} from '../types';

export interface FhirClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface FhirClient {
  getProviders(): Promise<Schedule[]>;
  getSlots(scheduleId: string, start: string, end: string): Promise<Slot[]>;
  getSlotCounts(scheduleId: string, dates: string[]): Promise<Record<string, number>>;
  holdSlot(slotId: string, durationMinutes: number, sessionId: string): Promise<SlotHold>;
  releaseHold(slotId: string, holdToken: string): Promise<void>;
  checkHold(slotId: string): Promise<SlotHold | null>;
  bookAppointment(
    slot: Slot,
    patientInfo: PatientInfo,
    holdToken: string,
    questionnaireResponse?: QuestionnaireResponse
  ): Promise<Appointment>;
}

export function createFhirClient(config: FhirClientConfig): FhirClient {
  const { baseUrl, headers = {} } = config;
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  
  return {
    async getProviders(): Promise<Schedule[]> {
      const res = await fetch(`${baseUrl}/Schedule?active=true`, {
        headers: defaultHeaders,
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch providers: ${res.statusText}`);
      }
      
      const bundle: Bundle<Schedule> = await res.json();
      return bundle.entry?.map((e) => e.resource) || [];
    },
    
    async getSlots(scheduleId: string, start: string, end: string): Promise<Slot[]> {
      const params = new URLSearchParams({
        schedule: `Schedule/${scheduleId}`,
        status: 'free',
        start: start,
        end: end,
      });
      
      const res = await fetch(`${baseUrl}/Slot?${params}`, {
        headers: defaultHeaders,
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch slots: ${res.statusText}`);
      }
      
      const bundle: Bundle<Slot> = await res.json();
      return bundle.entry?.map((e) => e.resource) || [];
    },
    
    async getSlotCounts(scheduleId: string, dates: string[]): Promise<Record<string, number>> {
      // Fetch all slots for the date range and count per day
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];
      
      const params = new URLSearchParams({
        schedule: `Schedule/${scheduleId}`,
        status: 'free',
        start: `${startDate}T00:00:00Z`,
        end: `${endDate}T23:59:59Z`,
      });
      
      const res = await fetch(`${baseUrl}/Slot?${params}`, {
        headers: defaultHeaders,
      });
      
      if (!res.ok) {
        // Return empty counts on error
        return {};
      }
      
      const bundle: Bundle<Slot> = await res.json();
      const slots = bundle.entry?.map((e) => e.resource) || [];
      
      // Count slots per date
      const counts: Record<string, number> = {};
      for (const date of dates) {
        counts[date] = 0;
      }
      
      for (const slot of slots) {
        const slotDate = slot.start.split('T')[0];
        if (counts[slotDate] !== undefined) {
          counts[slotDate]++;
        }
      }
      
      return counts;
    },
    
    async holdSlot(slotId: string, durationMinutes: number, sessionId: string): Promise<SlotHold> {
      const res = await fetch(`${baseUrl}/Slot/${slotId}/$hold`, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({
          durationMinutes,
          sessionId,
        }),
      });
      
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error('Slot is already held by another user');
        }
        throw new Error(`Failed to hold slot: ${res.statusText}`);
      }
      
      return res.json();
    },
    
    async releaseHold(slotId: string, holdToken: string): Promise<void> {
      const res = await fetch(`${baseUrl}/Slot/${slotId}/$hold/${holdToken}`, {
        method: 'DELETE',
        headers: defaultHeaders,
      });
      
      // Ignore 404 (hold already released/expired)
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to release hold: ${res.statusText}`);
      }
    },
    
    async checkHold(slotId: string): Promise<SlotHold | null> {
      const res = await fetch(`${baseUrl}/Slot/${slotId}/$hold`, {
        headers: defaultHeaders,
      });
      
      if (res.status === 404) {
        return null;
      }
      
      if (!res.ok) {
        throw new Error(`Failed to check hold: ${res.statusText}`);
      }
      
      return res.json();
    },
    
    async bookAppointment(
      slot: Slot,
      patientInfo: PatientInfo,
      holdToken: string,
      questionnaireResponse?: QuestionnaireResponse
    ): Promise<Appointment> {
      const appointment: Appointment & { _holdToken?: string } = {
        resourceType: 'Appointment',
        status: 'booked',
        slot: [{ reference: `Slot/${slot.id}` }],
        start: slot.start,
        end: slot.end,
        participant: [
          {
            actor: {
              reference: `Patient/${patientInfo.name.toLowerCase().replace(/\s+/g, '-')}`,
              display: patientInfo.name,
            },
            status: 'accepted',
          },
        ],
        comment: patientInfo.reason,
        _holdToken: holdToken,
        contained: questionnaireResponse ? [questionnaireResponse] : undefined,
      };
      
      const res = await fetch(`${baseUrl}/Appointment`, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(appointment),
      });
      
      if (res.status === 409) {
        throw new Error('Slot is no longer available. Please select a different time.');
      }
      
      if (!res.ok) {
        throw new Error(`Booking failed: ${res.statusText}`);
      }
      
      return res.json();
    },
  };
}
