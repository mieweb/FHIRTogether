import React from 'react';
import type { Schedule } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';

interface ProviderListProps {
  providers: Schedule[];
  onSelect: (provider: Schedule) => void;
  onBack?: () => void;
  loading?: boolean;
}

/**
 * Extract display name from Schedule resource
 */
function getProviderName(schedule: Schedule): string {
  // Try to get name from first actor
  const firstActor = schedule.actor?.[0];
  if (firstActor?.display) {
    return firstActor.display;
  }
  
  // Fallback to reference ID
  if (firstActor?.reference) {
    return firstActor.reference.split('/').pop() || 'Unknown Provider';
  }
  
  return schedule.id || 'Unknown Provider';
}

/**
 * Extract specialty from Schedule resource
 */
function getSpecialty(schedule: Schedule): string | null {
  const specialty = schedule.specialty?.[0];
  if (specialty?.text) {
    return specialty.text;
  }
  if (specialty?.coding?.[0]?.display) {
    return specialty.coding[0].display;
  }
  return null;
}

/**
 * Extract service type from Schedule resource
 */
function getServiceType(schedule: Schedule): string | null {
  const serviceType = schedule.serviceType?.[0];
  if (serviceType?.text) {
    return serviceType.text;
  }
  if (serviceType?.coding?.[0]?.display) {
    return serviceType.coding[0].display;
  }
  return null;
}

export function ProviderList({ providers, onSelect, onBack, loading }: ProviderListProps) {
  if (loading) {
    return (
      <div className="fs-provider-list fs-loading">
        <div className="fs-loading-spinner" aria-label="Loading providers">
          <svg className="fs-spinner" viewBox="0 0 24 24">
            <circle
              className="fs-spinner-track"
              cx="12"
              cy="12"
              r="10"
              fill="none"
              strokeWidth="3"
            />
            <circle
              className="fs-spinner-head"
              cx="12"
              cy="12"
              r="10"
              fill="none"
              strokeWidth="3"
              strokeDasharray="31.4"
              strokeDashoffset="23.5"
            />
          </svg>
          <span className="fs-loading-text">Loading providers...</span>
        </div>
      </div>
    );
  }
  
  if (providers.length === 0) {
    return (
      <div className="fs-provider-list fs-empty">
        <p className="fs-empty-message">No providers available</p>
      </div>
    );
  }
  
  return (
    <div className="fs-provider-list" role="list" aria-label="Available providers">
      {onBack && (
        <header className="fs-provider-header">
          <button
            type="button"
            className="fs-back-button"
            onClick={onBack}
            aria-label="Back to visit type selection"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </header>
      )}
      <h2 className="fs-section-title">Select a Provider</h2>
      <div className="fs-provider-grid">
        {providers.map((provider) => {
          const name = getProviderName(provider);
          const specialty = getSpecialty(provider);
          const serviceType = getServiceType(provider);
          
          return (
            <button
              key={provider.id}
              type="button"
              className="fs-provider-card"
              onClick={() => onSelect(provider)}
              aria-label={`Select ${name}${specialty ? `, ${specialty}` : ''}`}
            >
              <div className="fs-provider-avatar">
                <span className="fs-avatar-initials">
                  {name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              </div>
              <div className="fs-provider-info">
                <h3 className="fs-provider-name">{name}</h3>
                {specialty && <p className="fs-provider-specialty">{specialty}</p>}
                {serviceType && <p className="fs-provider-service">{serviceType}</p>}
              </div>
              <div className="fs-provider-status">
                {provider.active !== false && (
                  <span className="fs-status-badge fs-status-active">Available</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Connected version that uses the Zustand store
 */
export function ConnectedProviderList() {
  const providers = useSchedulerStore((state) => state.providers);
  const loading = useSchedulerStore((state) => state.loading);
  const selectProvider = useSchedulerStore((state) => state.selectProvider);
  const fetchProviders = useSchedulerStore((state) => state.fetchProviders);
  const goBack = useSchedulerStore((state) => state.goBack);
  
  React.useEffect(() => {
    if (providers.length === 0) {
      fetchProviders();
    }
  }, [fetchProviders, providers.length]);
  
  return <ProviderList providers={providers} onSelect={selectProvider} onBack={goBack} loading={loading} />;
}
