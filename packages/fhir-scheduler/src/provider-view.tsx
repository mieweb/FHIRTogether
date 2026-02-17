import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppointmentList } from './components/AppointmentList';
import './styles/scheduler.css';

// Determine FHIR API base URL
const fhirBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4010'
  : window.location.origin;

const root = createRoot(document.getElementById('app')!);

root.render(
  <React.StrictMode>
    <AppointmentList fhirBaseUrl={fhirBaseUrl} />
  </React.StrictMode>
);
