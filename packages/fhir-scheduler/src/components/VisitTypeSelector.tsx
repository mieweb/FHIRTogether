import type { VisitType } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';

interface VisitTypeSelectorProps {
  onSelect?: (type: VisitType) => void;
}

/**
 * Landing page component for selecting visit type
 * - Follow-up: Goes directly to provider selection
 * - New Patient: Shows questionnaire first for screening
 */
export function VisitTypeSelector({ onSelect }: VisitTypeSelectorProps) {
  const selectVisitType = useSchedulerStore((state) => state.selectVisitType);
  
  const handleSelect = (type: VisitType) => {
    selectVisitType(type);
    onSelect?.(type);
  };
  
  return (
    <div className="fs-visit-type-selector" role="region" aria-label="Select visit type">
      <h2 className="fs-visit-type-title">Schedule an Appointment</h2>
      <p className="fs-visit-type-subtitle">
        Please select the type of visit you need
      </p>
      
      <div className="fs-visit-type-options">
        <button
          type="button"
          className="fs-visit-type-card"
          onClick={() => handleSelect('follow-up')}
          aria-label="Schedule a follow-up visit"
        >
          <div className="fs-visit-type-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="fs-visit-type-content">
            <h3 className="fs-visit-type-name">Follow-up Visit</h3>
            <p className="fs-visit-type-description">
              I'm an existing patient scheduling a follow-up appointment with my provider
            </p>
          </div>
          <div className="fs-visit-type-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </button>
        
        <button
          type="button"
          className="fs-visit-type-card"
          onClick={() => handleSelect('new-patient')}
          aria-label="Schedule a new patient visit"
        >
          <div className="fs-visit-type-icon fs-visit-type-icon--new" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </div>
          <div className="fs-visit-type-content">
            <h3 className="fs-visit-type-name">New Patient Visit</h3>
            <p className="fs-visit-type-description">
              I'm a new patient and need to complete an intake questionnaire before scheduling
            </p>
          </div>
          <div className="fs-visit-type-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  );
}

/**
 * Connected version that uses the Zustand store
 */
export function ConnectedVisitTypeSelector() {
  return <VisitTypeSelector />;
}
