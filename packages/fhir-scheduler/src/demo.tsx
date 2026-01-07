import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchedulerWidget } from './components/SchedulerWidget';
import type { FormsRendererFormData, Appointment } from './types';
import './styles/scheduler.css';

/**
 * Sample intake questionnaire for screening patients
 * This can be used to:
 * - Collect required information before scheduling
 * - Route patients to appropriate providers based on answers
 * - Screen for urgent conditions that need immediate attention
 */
const intakeQuestionnaire: FormsRendererFormData = {
  schemaType: 'mieforms-v1.0',
  title: 'Patient Intake Questionnaire',
  fields: [
    {
      id: 'sec-visit',
      fieldType: 'section',
      title: 'Visit Information',
      fields: [
        {
          id: 'q-visit-type',
          fieldType: 'radio',
          question: 'What type of visit do you need?',
          options: [
            { id: 'new-patient', value: 'New Patient Visit' },
            { id: 'urgent', value: 'Urgent Care' },
            { id: 'wellness', value: 'Wellness Check / Physical' },
          ],
          selected: null,
        },
        {
          id: 'q-reason',
          fieldType: 'text',
          question: 'Brief description of your reason for visit',
          answer: '',
        },
      ],
    },
    {
      id: 'sec-symptoms',
      fieldType: 'section',
      title: 'Current Symptoms',
      fields: [
        {
          id: 'q-symptoms',
          fieldType: 'check',
          question: 'Are you experiencing any of the following? (Select all that apply)',
          options: [
            { id: 'sym-fever', value: 'Fever or chills' },
            { id: 'sym-cough', value: 'Cough or shortness of breath' },
            { id: 'sym-pain', value: 'Pain or discomfort' },
            { id: 'sym-fatigue', value: 'Fatigue or weakness' },
            { id: 'sym-none', value: 'None of the above' },
          ],
          selected: [],
        },
        {
          id: 'q-symptom-duration',
          fieldType: 'radio',
          question: 'How long have you been experiencing these symptoms?',
          options: [
            { id: 'dur-days', value: 'Less than 3 days' },
            { id: 'dur-week', value: '3-7 days' },
            { id: 'dur-weeks', value: '1-2 weeks' },
            { id: 'dur-longer', value: 'More than 2 weeks' },
          ],
          selected: null,
          enableWhen: {
            logic: 'AND' as const,
            conditions: [
              { targetId: 'q-symptoms', operator: 'notIncludes', value: 'sym-none' },
            ],
          },
        },
      ],
    },
    {
      id: 'sec-insurance',
      fieldType: 'section',
      title: 'Insurance Information',
      fields: [
        {
          id: 'q-has-insurance',
          fieldType: 'radio',
          question: 'Do you have health insurance?',
          options: [
            { id: 'ins-yes', value: 'Yes' },
            { id: 'ins-no', value: 'No' },
          ],
          selected: null,
        },
        {
          id: 'q-insurance-provider',
          fieldType: 'text',
          question: 'Insurance provider name',
          answer: '',
          enableWhen: {
            logic: 'AND' as const,
            conditions: [
              { targetId: 'q-has-insurance', operator: 'equals', value: 'ins-yes' },
            ],
          },
        },
      ],
    },
  ],
};

// Determine FHIR API base URL - use same origin in production, localhost for development
const fhirBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4010'
  : window.location.origin;

const root = createRoot(document.getElementById('scheduler-root')!);

root.render(
  <React.StrictMode>
    <SchedulerWidget
      fhirBaseUrl={fhirBaseUrl}
      holdDurationMinutes={5}
      questionnaireFormData={intakeQuestionnaire}
      onComplete={(appointment: Appointment) => {
        console.log('Appointment booked:', appointment);
        alert(`Appointment booked!\nID: ${appointment.id}\nStart: ${appointment.start}`);
      }}
      onError={(error: Error) => {
        console.error('Scheduler error:', error);
      }}
    />
  </React.StrictMode>
);
