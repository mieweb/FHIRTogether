
import type { Appointment, Schedule } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';

interface ConfirmationProps {
  appointment: Appointment;
  provider: Schedule;
  onReset: () => void;
}

/**
 * Format date and time for display
 */
function formatDateTime(isoString: string | undefined): string {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format duration between two times
 */
function formatDuration(start: string | undefined, end: string | undefined): string {
  if (!start || !end) return 'N/A';
  const startDate = new Date(start);
  const endDate = new Date(end);
  const minutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  return `${minutes} minutes`;
}

/**
 * Get provider display name
 */
function getProviderName(schedule: Schedule): string {
  const firstActor = schedule.actor?.[0];
  return firstActor?.display || firstActor?.reference?.split('/').pop() || 'Provider';
}

/**
 * Get patient name from appointment
 */
function getPatientName(appointment: Appointment): string {
  const participant = appointment.participant?.find(
    (p) => p.actor?.display || p.actor?.reference?.includes('Patient')
  );
  return participant?.actor?.display || 'Patient';
}

export function Confirmation({ appointment, provider, onReset }: ConfirmationProps) {
  return (
    <div className="fs-confirmation">
      <div className="fs-confirmation-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#22c55e" />
          <path
            d="M9 12l2 2 4-4"
            stroke="white"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      
      <h2 className="fs-confirmation-title">Appointment Confirmed!</h2>
      
      <p className="fs-confirmation-message">
        Your appointment has been successfully booked. A confirmation email will be sent shortly.
      </p>
      
      <div className="fs-confirmation-details">
        <h3 className="fs-details-title">Appointment Details</h3>
        <dl className="fs-details-list">
          <div className="fs-details-item">
            <dt>Confirmation Number</dt>
            <dd className="fs-confirmation-number">{appointment.id}</dd>
          </div>
          <div className="fs-details-item">
            <dt>Patient</dt>
            <dd>{getPatientName(appointment)}</dd>
          </div>
          <div className="fs-details-item">
            <dt>Provider</dt>
            <dd>{getProviderName(provider)}</dd>
          </div>
          <div className="fs-details-item">
            <dt>Date & Time</dt>
            <dd>{formatDateTime(appointment.start)}</dd>
          </div>
          <div className="fs-details-item">
            <dt>Duration</dt>
            <dd>{formatDuration(appointment.start, appointment.end)}</dd>
          </div>
          {appointment.comment && (
            <div className="fs-details-item">
              <dt>Reason</dt>
              <dd>{appointment.comment}</dd>
            </div>
          )}
        </dl>
      </div>
      
      <div className="fs-confirmation-actions">
        <button
          type="button"
          className="fs-secondary-button"
          onClick={onReset}
        >
          Book Another Appointment
        </button>
      </div>
      
      <div className="fs-confirmation-footer">
        <p className="fs-footer-text">
          Need to make changes?{' '}
          <a href="#" className="fs-link">
            Contact us
          </a>{' '}
          to reschedule or cancel.
        </p>
      </div>
    </div>
  );
}

/**
 * Connected version that uses the Zustand store
 */
export function ConnectedConfirmation() {
  const appointment = useSchedulerStore((state) => state.bookedAppointment);
  const provider = useSchedulerStore((state) => state.selectedProvider);
  const reset = useSchedulerStore((state) => state.reset);
  
  if (!appointment || !provider) {
    return null;
  }
  
  return <Confirmation appointment={appointment} provider={provider} onReset={reset} />;
}
