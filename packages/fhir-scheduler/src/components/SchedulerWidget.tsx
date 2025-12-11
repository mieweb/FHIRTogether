import { useEffect } from 'react';
import type { SchedulerWidgetProps } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';
import { ConnectedProviderList } from './ProviderList';
import { ConnectedSlotCalendar } from './SlotCalendar';
import { ConnectedBookingForm } from './BookingForm';
import { ConnectedConfirmation } from './Confirmation';
import '../styles/scheduler.css';

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
  const providers = useSchedulerStore((state) => state.providers);
  const fetchProviders = useSchedulerStore((state) => state.fetchProviders);
  
  // Initialize on mount
  useEffect(() => {
    initialize(fhirBaseUrl, holdDurationMinutes);
  }, [fhirBaseUrl, holdDurationMinutes, initialize]);
  
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
  
  return (
    <div className={`fs-scheduler-widget ${className}`}>
      {step === 'providers' && <ConnectedProviderList />}
      {step === 'calendar' && <ConnectedSlotCalendar />}
      {step === 'booking' && (
        <ConnectedBookingForm questionnaireFormData={questionnaireFormData} />
      )}
      {step === 'confirmation' && <ConnectedConfirmation />}
    </div>
  );
}

export default SchedulerWidget;
