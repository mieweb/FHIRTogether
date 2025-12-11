// Main React component exports
export { SchedulerWidget } from './components/SchedulerWidget';
export { ProviderList, ConnectedProviderList } from './components/ProviderList';
export { SlotCalendar, ConnectedSlotCalendar } from './components/SlotCalendar';
export { BookingForm, ConnectedBookingForm } from './components/BookingForm';
export { Confirmation, ConnectedConfirmation } from './components/Confirmation';

// Store exports
export { useSchedulerStore } from './store/schedulerStore';

// API client exports
export { createFhirClient } from './api/fhirClient';
export type { FhirClient, FhirClientConfig } from './api/fhirClient';

// Type exports
export type {
  Schedule,
  Slot,
  Appointment,
  PatientInfo,
  QuestionnaireResponse,
  SlotHold,
  SchedulerWidgetProps,
  SchedulerStep,
} from './types';
