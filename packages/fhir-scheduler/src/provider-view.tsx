import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AppointmentList } from './components/AppointmentList';
import { ImportData } from './components/ImportData';
import './styles/scheduler.css';

// Determine FHIR API base URL
const fhirBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4010'
  : window.location.origin;

type TabType = 'appointments' | 'import';

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
          <AppointmentList key={refreshKey} fhirBaseUrl={fhirBaseUrl} />
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
