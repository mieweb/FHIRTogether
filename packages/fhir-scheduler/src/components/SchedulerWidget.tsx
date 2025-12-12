import { useEffect, useRef } from 'react';
import type { SchedulerWidgetProps, SchedulerStep } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';
import { ConnectedVisitTypeSelector } from './VisitTypeSelector';
import { ConnectedIntakeQuestionnaire } from './IntakeQuestionnaire';
import { ConnectedProviderList } from './ProviderList';
import { ConnectedSlotCalendar } from './SlotCalendar';
import { ConnectedBookingForm } from './BookingForm';
import { ConnectedConfirmation } from './Confirmation';
import '../styles/scheduler.css';

/**
 * Step order for history navigation
 */
const STEP_ORDER: SchedulerStep[] = ['visit-type', 'questionnaire', 'providers', 'calendar', 'booking', 'confirmation'];

/**
 * Parse the URL hash to get step and optional provider ID
 * Supports formats: #providers, #calendar/ScheduleId
 */
interface HashInfo {
  step: SchedulerStep | null;
  providerId: string | null;
}

function parseHash(): HashInfo {
  const hash = window.location.hash.slice(1); // Remove the # prefix
  const parts = hash.split('/');
  const stepPart = parts[0];
  
  if (STEP_ORDER.includes(stepPart as SchedulerStep)) {
    return {
      step: stepPart as SchedulerStep,
      providerId: parts[1] || null,
    };
  }
  return { step: null, providerId: null };
}

/**
 * Build a hash string from step and optional provider ID
 */
function buildHash(step: SchedulerStep, providerId?: string | null): string {
  if (providerId && (step === 'calendar' || step === 'booking')) {
    return `#${step}/${providerId}`;
  }
  return `#${step}`;
}

/**
 * Main orchestrator component for the FHIR Scheduler Widget
 */
export function SchedulerWidget({
  fhirBaseUrl,
  providerId,
  questionnaireFormData,
  holdDurationMinutes = 5,
  onComplete,
  onError,
  className = '',
}: SchedulerWidgetProps) {
  const initialize = useSchedulerStore((state) => state.initialize);
  const step = useSchedulerStore((state) => state.step);
  const error = useSchedulerStore((state) => state.error);
  const bookedAppointment = useSchedulerStore((state) => state.bookedAppointment);
  const selectProvider = useSchedulerStore((state) => state.selectProvider);
  const selectedProvider = useSchedulerStore((state) => state.selectedProvider);
  const providers = useSchedulerStore((state) => state.providers);
  const fetchProviders = useSchedulerStore((state) => state.fetchProviders);
  const goBack = useSchedulerStore((state) => state.goBack);
  const navigateToStep = useSchedulerStore((state) => state.navigateToStep);
  
  // Track if we're handling a popstate event to avoid pushing duplicate history
  const isPopstateRef = useRef(false);
  const lastStepRef = useRef<SchedulerStep>(step);
  const initializedRef = useRef(false);
  
  // Initialize on mount and handle deep linking
  useEffect(() => {
    initialize(fhirBaseUrl, holdDurationMinutes);
    
    // Handle deep link on initial load (only once)
    if (!initializedRef.current) {
      initializedRef.current = true;
      const hashInfo = parseHash();
      if (hashInfo.step && hashInfo.step !== 'visit-type') {
        // Use setTimeout to ensure store is initialized
        setTimeout(() => {
          navigateToStep(hashInfo.step!, hashInfo.providerId || undefined);
        }, 0);
      }
    }
  }, [fhirBaseUrl, holdDurationMinutes, initialize, navigateToStep]);
  
  // Handle pre-selected provider
  useEffect(() => {
    if (providerId && providers.length > 0) {
      const provider = providers.find(
        (p) => p.id === providerId || `Schedule/${p.id}` === providerId
      );
      if (provider) {
        selectProvider(provider);
      }
    }
  }, [providerId, providers, selectProvider]);
  
  // Fetch providers if we need to show the list or find a pre-selected provider
  useEffect(() => {
    if (providers.length === 0) {
      fetchProviders();
    }
  }, [providers.length, fetchProviders]);
  
  // Browser history integration
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const historyStep = event.state?.step as SchedulerStep | undefined;
      
      if (historyStep && historyStep !== step) {
        const currentIndex = STEP_ORDER.indexOf(step);
        const targetIndex = STEP_ORDER.indexOf(historyStep);
        
        // Only allow going back, not forward via browser
        if (targetIndex < currentIndex) {
          isPopstateRef.current = true;
          goBack();
        }
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [step, goBack]);
  
  // Push history state when step changes (but not on popstate)
  useEffect(() => {
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
      lastStepRef.current = step;
      return;
    }
    
    // Build the hash with provider ID for calendar/booking steps
    const currentProviderId = selectedProvider?.id || null;
    const hash = buildHash(step, currentProviderId);
    
    // Don't push if step hasn't actually changed
    if (step === lastStepRef.current) {
      // But do replace state on initial load to set the hash
      if (!window.history.state?.step) {
        window.history.replaceState({ step, providerId: currentProviderId }, '', hash);
      }
      return;
    }
    
    const currentIndex = STEP_ORDER.indexOf(step);
    const lastIndex = STEP_ORDER.indexOf(lastStepRef.current);
    
    // Push state when moving forward, replace when going back
    if (currentIndex > lastIndex) {
      window.history.pushState({ step, providerId: currentProviderId }, '', hash);
    } else {
      // Going back - just update the hash without adding history
      window.history.replaceState({ step, providerId: currentProviderId }, '', hash);
    }
    
    lastStepRef.current = step;
  }, [step, selectedProvider]);
  
  // Callback on completion
  useEffect(() => {
    if (bookedAppointment && onComplete) {
      onComplete(bookedAppointment);
    }
  }, [bookedAppointment, onComplete]);
  
  // Callback on error
  useEffect(() => {
    if (error && onError) {
      onError(new Error(error));
    }
  }, [error, onError]);
  
  // Get visit type to determine if questionnaire should show in booking
  // For new-patient: questionnaire already completed in dedicated step
  // For follow-up: no questionnaire needed
  // Only show in booking if visitType is not set (legacy/direct embed behavior)
  const visitType = useSchedulerStore((state) => state.visitType);
  
  return (
    <div className={`fs-scheduler-widget ${className}`}>
      {step === 'visit-type' && <ConnectedVisitTypeSelector />}
      {step === 'questionnaire' && (
        <ConnectedIntakeQuestionnaire questionnaireFormData={questionnaireFormData} />
      )}
      {step === 'providers' && <ConnectedProviderList />}
      {step === 'calendar' && <ConnectedSlotCalendar />}
      {step === 'booking' && (
        <ConnectedBookingForm 
          questionnaireFormData={visitType ? undefined : questionnaireFormData} 
        />
      )}
      {step === 'confirmation' && <ConnectedConfirmation />}
    </div>
  );
}

export default SchedulerWidget;
