import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AppointmentList } from './components/AppointmentList';
import { ImportData } from './components/ImportData';
import { ScheduleSetup } from './components/ScheduleSetup';
import './styles/scheduler.css';

// Determine FHIR API base URL
const fhirBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4010'
  : window.location.origin;

// Read optional schedule ID from URL (?schedule=xxx)
const urlParams = new URLSearchParams(window.location.search);
const initialScheduleId = urlParams.get('schedule') || undefined;
const initialDate = urlParams.get('date') || undefined;

type TabType = 'appointments' | 'schedule-setup' | 'import';

function ProviderView() {
  const [activeTab, setActiveTab] = useState<TabType>('appointments');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleImportComplete = useCallback(() => {
    // Refresh appointments list when import completes
    setRefreshKey((k) => k + 1);
    setActiveTab('appointments');
  }, []);

  return (
    <div className="fs-provider-view">
      {/* Tab navigation */}
      <nav className="fs-demo-tabs" role="tablist" aria-label="Provider view tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'appointments'}
          aria-controls="tab-appointments"
          className={`fs-demo-tab ${activeTab === 'appointments' ? 'fs-demo-tab-active' : ''}`}
          onClick={() => setActiveTab('appointments')}
        >
          Appointments
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'schedule-setup'}
          aria-controls="tab-schedule-setup"
          className={`fs-demo-tab ${activeTab === 'schedule-setup' ? 'fs-demo-tab-active' : ''}`}
          onClick={() => setActiveTab('schedule-setup')}
        >
          Schedule Setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'import'}
          aria-controls="tab-import"
          className={`fs-demo-tab ${activeTab === 'import' ? 'fs-demo-tab-active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          Import Data
        </button>
      </nav>

      {/* Tab panels */}
      <div
        id="tab-appointments"
        role="tabpanel"
        aria-labelledby="tab-appointments"
        hidden={activeTab !== 'appointments'}
      >
        {activeTab === 'appointments' && (
          <AppointmentList key={refreshKey} fhirBaseUrl={fhirBaseUrl} initialScheduleId={initialScheduleId} initialDate={initialDate} />
        )}
      </div>

      <div
        id="tab-schedule-setup"
        role="tabpanel"
        aria-labelledby="tab-schedule-setup"
        hidden={activeTab !== 'schedule-setup'}
      >
        {activeTab === 'schedule-setup' && (
          <ScheduleSetup
            fhirBaseUrl={fhirBaseUrl}
            initialScheduleId={initialScheduleId}
            onGenerate={() => {
              setRefreshKey((k) => k + 1);
            }}
          />
        )}
      </div>

      <div
        id="tab-import"
        role="tabpanel"
        aria-labelledby="tab-import"
        hidden={activeTab !== 'import'}
      >
        {activeTab === 'import' && (
          <ImportData
            fhirBaseUrl={fhirBaseUrl}
            onImportComplete={handleImportComplete}
          />
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('app')!);

root.render(
  <React.StrictMode>
    <ProviderView />
  </React.StrictMode>
);
