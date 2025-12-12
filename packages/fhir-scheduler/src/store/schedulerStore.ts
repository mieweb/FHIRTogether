import { create } from 'zustand';
import type {
  Schedule,
  Slot,
  Appointment,
  PatientInfo,
  QuestionnaireResponse,
  SchedulerStep,
  VisitType,
} from '../types';
import { createFhirClient, type FhirClient } from '../api/fhirClient';

interface SchedulerState {
  // Configuration
  fhirBaseUrl: string;
  holdDurationMinutes: number;
  
  // Data
  providers: Schedule[];
  slots: Slot[];
  dateAvailability: Record<string, number>; // date -> slot count
  
  // Selection
  visitType: VisitType | null;
  selectedProvider: Schedule | null;
  selectedDate: string | null;
  selectedSlot: Slot | null;
  
  // Hold management
  holdToken: string | null;
  holdExpiresAt: Date | null;
  
  // Booking flow
  step: SchedulerStep;
  patientInfo: PatientInfo | null;
  questionnaireResponse: QuestionnaireResponse | null;
  
  // Status
  loading: boolean;
  error: string | null;
  bookedAppointment: Appointment | null;
  
  // Internal
  _client: FhirClient | null;
  _sessionId: string;
  _holdTimer: ReturnType<typeof setInterval> | null;
}

interface SchedulerActions {
  // Configuration
  initialize: (baseUrl: string, holdDurationMinutes?: number) => void;
  
  // Visit type selection
  selectVisitType: (type: VisitType) => void;
  proceedFromQuestionnaire: () => void;
  
  // Provider actions
  fetchProviders: () => Promise<void>;
  selectProvider: (provider: Schedule) => void;
  
  // Slot actions
  fetchSlots: (date: string) => Promise<void>;
  fetchDateAvailability: (dates: string[]) => Promise<void>;
  selectSlot: (slot: Slot) => Promise<void>;
  releaseHold: () => Promise<void>;
  
  // Booking actions
  setPatientInfo: (info: PatientInfo) => void;
  setQuestionnaireResponse: (response: QuestionnaireResponse) => void;
  submitBooking: () => Promise<Appointment>;
  
  // Navigation
  goBack: () => void;
  reset: () => void;
  navigateToStep: (step: SchedulerStep, providerId?: string) => void;
  
  // Utility
  getHoldTimeRemaining: () => number;
}

export type SchedulerStore = SchedulerState & SchedulerActions;

const generateSessionId = (): string => {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};

const initialState: Omit<SchedulerState, '_sessionId'> = {
  fhirBaseUrl: '',
  holdDurationMinutes: 5,
  dateAvailability: {},
  providers: [],
  slots: [],
  visitType: null,
  selectedProvider: null,
  selectedDate: null,
  selectedSlot: null,
  holdToken: null,
  holdExpiresAt: null,
  step: 'visit-type',
  patientInfo: null,
  questionnaireResponse: null,
  loading: false,
  error: null,
  bookedAppointment: null,
  _client: null,
  _holdTimer: null,
};

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  ...initialState,
  _sessionId: generateSessionId(),
  
  initialize: (baseUrl: string, holdDurationMinutes = 5) => {
    const client = createFhirClient({ baseUrl });
    set({
      fhirBaseUrl: baseUrl,
      holdDurationMinutes,
      _client: client,
    });
  },
  
  selectVisitType: (type: VisitType) => {
    set({ visitType: type });
    
    if (type === 'follow-up') {
      // Follow-up: go directly to provider selection
      set({ step: 'providers' });
    } else {
      // New patient: show questionnaire first
      set({ step: 'questionnaire' });
    }
  },
  
  proceedFromQuestionnaire: () => {
    // Move from questionnaire to provider selection
    set({ step: 'providers' });
  },
  
  fetchProviders: async () => {
    const { _client } = get();
    if (!_client) {
      set({ error: 'Scheduler not initialized' });
      return;
    }
    
    set({ loading: true, error: null });
    
    try {
      const providers = await _client.getProviders();
      set({ providers, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch providers',
        loading: false,
      });
    }
  },
  
  selectProvider: (provider: Schedule) => {
    set({
      selectedProvider: provider,
      step: 'calendar',
      selectedDate: null,
      selectedSlot: null,
      slots: [],
      dateAvailability: {},
    });
  },
  
  fetchSlots: async (date: string) => {
    const { _client, selectedProvider } = get();
    if (!_client || !selectedProvider) {
      set({ error: 'No provider selected' });
      return;
    }
    
    set({ loading: true, error: null, selectedDate: date });
    
    try {
      const scheduleId = selectedProvider.id || '';
      // Fetch slots for the selected date (full day)
      const startOfDay = `${date}T00:00:00Z`;
      const endOfDay = `${date}T23:59:59Z`;
      const slots = await _client.getSlots(scheduleId, startOfDay, endOfDay);
      set({ slots, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch slots',
        loading: false,
      });
    }
  },
  
  fetchDateAvailability: async (dates: string[]) => {
    const { _client, selectedProvider } = get();
    if (!_client || !selectedProvider) {
      return;
    }
    
    try {
      const scheduleId = selectedProvider.id || '';
      const counts = await _client.getSlotCounts(scheduleId, dates);
      set({ dateAvailability: counts });
    } catch (err) {
      // Silently fail - availability indicators are optional
      console.warn('Failed to fetch date availability:', err);
    }
  },
  
  selectSlot: async (slot: Slot) => {
    const { _client, holdDurationMinutes, _sessionId, _holdTimer } = get();
    if (!_client) {
      set({ error: 'Scheduler not initialized' });
      return;
    }
    
    // Clear any existing hold timer
    if (_holdTimer) {
      clearInterval(_holdTimer);
    }
    
    set({ loading: true, error: null });
    
    try {
      const slotId = slot.id || '';
      const hold = await _client.holdSlot(slotId, holdDurationMinutes, _sessionId);
      
      // Set up a timer to warn when hold is about to expire
      const timer = setInterval(() => {
        const remaining = get().getHoldTimeRemaining();
        if (remaining <= 0) {
          clearInterval(timer);
          set({
            error: 'Slot hold expired. Please select a new time.',
            step: 'calendar',
            holdToken: null,
            holdExpiresAt: null,
            selectedSlot: null,
          });
        }
      }, 1000);
      
      set({
        selectedSlot: slot,
        holdToken: hold.holdToken,
        holdExpiresAt: new Date(hold.expiresAt),
        step: 'booking',
        loading: false,
        _holdTimer: timer,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to hold slot',
        loading: false,
      });
    }
  },
  
  releaseHold: async () => {
    const { _client, selectedSlot, holdToken, _holdTimer } = get();
    
    if (_holdTimer) {
      clearInterval(_holdTimer);
    }
    
    if (!_client || !selectedSlot || !holdToken) {
      set({
        holdToken: null,
        holdExpiresAt: null,
        _holdTimer: null,
      });
      return;
    }
    
    try {
      const slotId = selectedSlot.id || '';
      await _client.releaseHold(slotId, holdToken);
    } catch {
      // Ignore release errors - hold will expire naturally
    }
    
    set({
      holdToken: null,
      holdExpiresAt: null,
      _holdTimer: null,
    });
  },
  
  setPatientInfo: (info: PatientInfo) => {
    set({ patientInfo: info });
  },
  
  setQuestionnaireResponse: (response: QuestionnaireResponse) => {
    set({ questionnaireResponse: response });
  },
  
  submitBooking: async () => {
    const { _client, selectedSlot, patientInfo, holdToken, questionnaireResponse, _holdTimer } = get();
    
    if (!_client) {
      throw new Error('Scheduler not initialized');
    }
    if (!selectedSlot) {
      throw new Error('No slot selected');
    }
    if (!patientInfo) {
      throw new Error('Patient information required');
    }
    if (!holdToken) {
      throw new Error('Slot hold expired');
    }
    
    set({ loading: true, error: null });
    
    try {
      const appointment = await _client.bookAppointment(
        selectedSlot,
        patientInfo,
        holdToken,
        questionnaireResponse || undefined
      );
      
      // Clear hold timer on success
      if (_holdTimer) {
        clearInterval(_holdTimer);
      }
      
      set({
        bookedAppointment: appointment,
        step: 'confirmation',
        loading: false,
        holdToken: null,
        holdExpiresAt: null,
        _holdTimer: null,
      });
      
      return appointment;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Booking failed',
        loading: false,
      });
      throw err;
    }
  },
  
  goBack: () => {
    const { step, releaseHold, visitType } = get();
    
    switch (step) {
      case 'questionnaire':
        set({ step: 'visit-type', visitType: null });
        break;
      case 'providers':
        // Go back to questionnaire for new patients, or visit-type for follow-ups
        if (visitType === 'new-patient') {
          set({ step: 'questionnaire', selectedProvider: null });
        } else {
          set({ step: 'visit-type', visitType: null, selectedProvider: null });
        }
        break;
      case 'calendar':
        set({ step: 'providers', selectedProvider: null, slots: [] });
        break;
      case 'booking':
        releaseHold();
        set({ step: 'calendar', selectedSlot: null });
        break;
      case 'confirmation':
        // Can't go back from confirmation
        break;
    }
  },
  
  reset: () => {
    const { _holdTimer, releaseHold } = get();
    
    if (_holdTimer) {
      clearInterval(_holdTimer);
    }
    
    releaseHold();
    
    set({
      ...initialState,
      _sessionId: generateSessionId(),
    });
  },
  
  navigateToStep: (targetStep: SchedulerStep, providerId?: string) => {
    const { step, visitType, selectedProvider, selectedSlot, providers, fetchProviders } = get();
    
    // Don't navigate if already at target step
    if (step === targetStep) return;
    
    // Helper to find and select provider by ID
    const findAndSelectProvider = (id: string) => {
      const provider = providers.find(
        (p) => p.id === id || `Schedule/${p.id}` === id
      );
      if (provider) {
        set({
          selectedProvider: provider,
          visitType: visitType || 'follow-up',
        });
        return true;
      }
      return false;
    };
    
    // Define what state is required for each step
    switch (targetStep) {
      case 'visit-type':
        // Always allowed - reset to initial
        set({ step: 'visit-type', visitType: null });
        break;
        
      case 'questionnaire':
        // Set as new patient and go to questionnaire
        set({ step: 'questionnaire', visitType: 'new-patient' });
        break;
        
      case 'providers':
        // Can deep link to providers - set follow-up to skip questionnaire
        if (!visitType) {
          set({ step: 'providers', visitType: 'follow-up' });
        } else {
          set({ step: 'providers' });
        }
        break;
        
      case 'calendar':
        // If provider ID is provided, try to select that provider
        if (providerId) {
          if (providers.length > 0) {
            if (findAndSelectProvider(providerId)) {
              set({ step: 'calendar' });
            } else {
              // Provider not found - go to provider list
              set({ step: 'providers', visitType: visitType || 'follow-up' });
            }
          } else {
            // Providers not loaded yet - fetch them and retry
            fetchProviders().then(() => {
              const { providers: loadedProviders } = get();
              const provider = loadedProviders.find(
                (p) => p.id === providerId || `Schedule/${p.id}` === providerId
              );
              if (provider) {
                set({
                  selectedProvider: provider,
                  step: 'calendar',
                  visitType: visitType || 'follow-up',
                });
              } else {
                set({ step: 'providers', visitType: visitType || 'follow-up' });
              }
            });
          }
        } else if (selectedProvider) {
          set({ step: 'calendar' });
        } else {
          set({ step: 'providers', visitType: visitType || 'follow-up' });
        }
        break;
        
      case 'booking':
        // Requires a slot - redirect appropriately
        if (!selectedSlot) {
          if (providerId && !selectedProvider) {
            // Try to navigate to calendar with provider first
            get().navigateToStep('calendar', providerId);
          } else if (!selectedProvider) {
            set({ step: 'providers', visitType: visitType || 'follow-up' });
          } else {
            set({ step: 'calendar' });
          }
        } else {
          set({ step: 'booking' });
        }
        break;
        
      case 'confirmation':
        // Can't deep link to confirmation - go to start
        set({ step: 'visit-type', visitType: null });
        break;
    }
  },
  
  getHoldTimeRemaining: () => {
    const { holdExpiresAt } = get();
    if (!holdExpiresAt) return 0;
    return Math.max(0, holdExpiresAt.getTime() - Date.now());
  },
}));

// Selector hooks for common patterns
export const useProviders = () => useSchedulerStore((state) => state.providers);
export const useSlots = () => useSchedulerStore((state) => state.slots);
export const useStep = () => useSchedulerStore((state) => state.step);
export const useLoading = () => useSchedulerStore((state) => state.loading);
export const useError = () => useSchedulerStore((state) => state.error);
export const useSelectedProvider = () => useSchedulerStore((state) => state.selectedProvider);
export const useSelectedSlot = () => useSchedulerStore((state) => state.selectedSlot);
export const useBookedAppointment = () => useSchedulerStore((state) => state.bookedAppointment);
