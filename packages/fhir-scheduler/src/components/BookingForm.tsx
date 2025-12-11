import React, { useState, useCallback, useEffect } from 'react';
import type { Slot, PatientInfo, Schedule } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';

interface BookingFormProps {
  provider: Schedule;
  slot: Slot;
  holdExpiresAt: Date | null;
  questionnaireFormData?: unknown;
  onSubmit: (patientInfo: PatientInfo) => Promise<void>;
  onBack: () => void;
  loading?: boolean;
  error?: string | null;
}

/**
 * Format time for display
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format duration in minutes
 */
function formatDuration(start: string, end: string): string {
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
 * Hold countdown timer component
 */
function HoldTimer({ expiresAt }: { expiresAt: Date }) {
  const [remaining, setRemaining] = useState<number>(
    Math.max(0, expiresAt.getTime() - Date.now())
  );
  
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(Math.max(0, expiresAt.getTime() - Date.now()));
    }, 1000);
    
    return () => clearInterval(timer);
  }, [expiresAt]);
  
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  
  const isWarning = remaining < 60000; // Less than 1 minute
  
  return (
    <div className={`fs-hold-timer ${isWarning ? 'fs-timer-warning' : ''}`}>
      <svg className="fs-timer-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"
          fill="currentColor"
        />
      </svg>
      <span className="fs-timer-text">
        Slot reserved for {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  );
}

export function BookingForm({
  provider,
  slot,
  holdExpiresAt,
  questionnaireFormData,
  onSubmit,
  onBack,
  loading,
  error,
}: BookingFormProps) {
  const [formData, setFormData] = useState<PatientInfo>({
    name: '',
    phone: '',
    email: '',
    dateOfBirth: '',
    reason: '',
  });
  
  const [validationErrors, setValidationErrors] = useState<Partial<Record<keyof PatientInfo, string>>>({});
  
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setFormData((prev) => ({ ...prev, [name]: value }));
      // Clear validation error when user types
      if (validationErrors[name as keyof PatientInfo]) {
        setValidationErrors((prev) => ({ ...prev, [name]: undefined }));
      }
    },
    [validationErrors]
  );
  
  const validate = useCallback((): boolean => {
    const errors: Partial<Record<keyof PatientInfo, string>> = {};
    
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }
    
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    
    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);
  
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (!validate()) {
        return;
      }
      
      await onSubmit(formData);
    },
    [formData, validate, onSubmit]
  );
  
  return (
    <div className="fs-booking-form">
      <header className="fs-form-header">
        <button
          type="button"
          className="fs-back-button"
          onClick={onBack}
          aria-label="Back to time selection"
        >
          <svg className="fs-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
          </svg>
          Back
        </button>
        <h2 className="fs-form-title">Complete Your Booking</h2>
      </header>
      
      {/* Hold Timer */}
      {holdExpiresAt && <HoldTimer expiresAt={holdExpiresAt} />}
      
      {/* Appointment Summary */}
      <div className="fs-appointment-summary">
        <h3 className="fs-summary-title">Appointment Details</h3>
        <dl className="fs-summary-list">
          <div className="fs-summary-item">
            <dt>Provider</dt>
            <dd>{getProviderName(provider)}</dd>
          </div>
          <div className="fs-summary-item">
            <dt>Date & Time</dt>
            <dd>{formatDateTime(slot.start)}</dd>
          </div>
          <div className="fs-summary-item">
            <dt>Duration</dt>
            <dd>{formatDuration(slot.start, slot.end)}</dd>
          </div>
        </dl>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="fs-error-message" role="alert">
          <svg className="fs-error-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
              fill="currentColor"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}
      
      {/* Patient Information Form */}
      <form onSubmit={handleSubmit} className="fs-patient-form">
        <h3 className="fs-section-title">Your Information</h3>
        
        <div className="fs-form-group">
          <label htmlFor="fs-name" className="fs-label">
            Full Name <span className="fs-required">*</span>
          </label>
          <input
            type="text"
            id="fs-name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`fs-input ${validationErrors.name ? 'fs-input-error' : ''}`}
            aria-invalid={!!validationErrors.name}
            aria-describedby={validationErrors.name ? 'fs-name-error' : undefined}
            disabled={loading}
          />
          {validationErrors.name && (
            <span id="fs-name-error" className="fs-field-error">
              {validationErrors.name}
            </span>
          )}
        </div>
        
        <div className="fs-form-group">
          <label htmlFor="fs-email" className="fs-label">
            Email <span className="fs-required">*</span>
          </label>
          <input
            type="email"
            id="fs-email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className={`fs-input ${validationErrors.email ? 'fs-input-error' : ''}`}
            aria-invalid={!!validationErrors.email}
            aria-describedby={validationErrors.email ? 'fs-email-error' : undefined}
            disabled={loading}
          />
          {validationErrors.email && (
            <span id="fs-email-error" className="fs-field-error">
              {validationErrors.email}
            </span>
          )}
        </div>
        
        <div className="fs-form-group">
          <label htmlFor="fs-phone" className="fs-label">
            Phone Number <span className="fs-required">*</span>
          </label>
          <input
            type="tel"
            id="fs-phone"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className={`fs-input ${validationErrors.phone ? 'fs-input-error' : ''}`}
            aria-invalid={!!validationErrors.phone}
            aria-describedby={validationErrors.phone ? 'fs-phone-error' : undefined}
            disabled={loading}
          />
          {validationErrors.phone && (
            <span id="fs-phone-error" className="fs-field-error">
              {validationErrors.phone}
            </span>
          )}
        </div>
        
        <div className="fs-form-group">
          <label htmlFor="fs-dob" className="fs-label">
            Date of Birth
          </label>
          <input
            type="date"
            id="fs-dob"
            name="dateOfBirth"
            value={formData.dateOfBirth}
            onChange={handleChange}
            className="fs-input"
            disabled={loading}
          />
        </div>
        
        <div className="fs-form-group">
          <label htmlFor="fs-reason" className="fs-label">
            Reason for Visit
          </label>
          <textarea
            id="fs-reason"
            name="reason"
            value={formData.reason}
            onChange={handleChange}
            className="fs-textarea"
            rows={3}
            disabled={loading}
          />
        </div>
        
        {/* Questionnaire placeholder - would integrate with @mieweb/forms-renderer */}
        {questionnaireFormData != null && (
          <div className="fs-questionnaire-section">
            <h3 className="fs-section-title">Additional Questions</h3>
            <p className="fs-questionnaire-placeholder">
              Questionnaire integration coming soon
            </p>
          </div>
        )}
        
        <button
          type="submit"
          className="fs-submit-button"
          disabled={loading}
        >
          {loading ? (
            <>
              <svg className="fs-spinner fs-button-spinner" viewBox="0 0 24 24">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  strokeWidth="3"
                  stroke="currentColor"
                  strokeDasharray="31.4"
                  strokeDashoffset="23.5"
                />
              </svg>
              Booking...
            </>
          ) : (
            'Confirm Booking'
          )}
        </button>
      </form>
    </div>
  );
}

/**
 * Connected version that uses the Zustand store
 */
export function ConnectedBookingForm({
  questionnaireFormData,
}: {
  questionnaireFormData?: unknown;
}) {
  const provider = useSchedulerStore((state) => state.selectedProvider);
  const slot = useSchedulerStore((state) => state.selectedSlot);
  const holdExpiresAt = useSchedulerStore((state) => state.holdExpiresAt);
  const loading = useSchedulerStore((state) => state.loading);
  const error = useSchedulerStore((state) => state.error);
  const setPatientInfo = useSchedulerStore((state) => state.setPatientInfo);
  const submitBooking = useSchedulerStore((state) => state.submitBooking);
  const goBack = useSchedulerStore((state) => state.goBack);
  
  const handleSubmit = useCallback(
    async (patientInfo: PatientInfo) => {
      setPatientInfo(patientInfo);
      await submitBooking();
    },
    [setPatientInfo, submitBooking]
  );
  
  if (!provider || !slot) {
    return null;
  }
  
  return (
    <BookingForm
      provider={provider}
      slot={slot}
      holdExpiresAt={holdExpiresAt}
      questionnaireFormData={questionnaireFormData}
      onSubmit={handleSubmit}
      onBack={goBack}
      loading={loading}
      error={error}
    />
  );
}
