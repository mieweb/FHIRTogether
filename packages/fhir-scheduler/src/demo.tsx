import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchedulerWidget } from './components/SchedulerWidget';
import './styles/scheduler.css';

const root = createRoot(document.getElementById('scheduler-root')!);

root.render(
  <React.StrictMode>
    <SchedulerWidget
      fhirBaseUrl="http://localhost:4010"
      holdDurationSeconds={300}
      onAppointmentBooked={(appointment) => {
        console.log('Appointment booked:', appointment);
        alert(`Appointment booked!\nID: ${appointment.id}\nStart: ${appointment.start}`);
      }}
      onError={(error) => {
        console.error('Scheduler error:', error);
      }}
    />
  </React.StrictMode>
);
