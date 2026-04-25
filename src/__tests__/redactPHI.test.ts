import { redactAppointmentPHI } from '../routes/appointmentRoutes';
import type { Appointment } from '../types/fhir';

/** Helper: build a realistic appointment with PHI */
function makeAppointmentWithPHI(overrides?: Partial<Appointment>): Appointment {
  return {
    resourceType: 'Appointment',
    id: 'apt-123',
    status: 'booked',
    description: 'Follow-up Visit',
    start: '2026-04-27T12:00:00.000Z',
    end: '2026-04-27T12:20:00.000Z',
    comment: 'Patient reports severe chest pain and shortness of breath',
    participant: [
      {
        actor: {
          reference: 'Practitioner/practitioner-smith',
          display: 'Dr. Sarah Smith',
        },
        status: 'accepted',
      },
      {
        actor: {
          reference: 'Patient/patient-jane-doe',
          display: 'Jane Doe',
        },
        status: 'accepted',
      },
    ],
    ...overrides,
  } as Appointment;
}

describe('redactAppointmentPHI', () => {
  it('strips patient display name from participant', () => {
    const input = makeAppointmentWithPHI();
    const result = redactAppointmentPHI(input);

    const patient = result.participant.find(
      p => p.actor?.reference?.includes('Patient/')
    );
    expect(patient?.actor?.display).toBeUndefined();
    expect(patient?.actor?.reference).toBe('Patient/patient-jane-doe');
  });

  it('preserves provider display name', () => {
    const input = makeAppointmentWithPHI();
    const result = redactAppointmentPHI(input);

    const provider = result.participant.find(
      p => p.actor?.reference?.includes('Practitioner/')
    );
    expect(provider?.actor?.display).toBe('Dr. Sarah Smith');
  });

  it('removes the comment field (may contain reason for visit)', () => {
    const input = makeAppointmentWithPHI();
    const result = redactAppointmentPHI(input);

    expect(result.comment).toBeUndefined();
  });

  it('removes contained resources (may contain QuestionnaireResponse)', () => {
    const input = makeAppointmentWithPHI();
    (input as unknown as Record<string, unknown>).contained = [
      { resourceType: 'QuestionnaireResponse', item: [{ text: 'SSN: 123-45-6789' }] },
    ];
    const result = redactAppointmentPHI(input);

    expect((result as unknown as Record<string, unknown>).contained).toBeUndefined();
  });

  it('preserves non-PHI fields', () => {
    const input = makeAppointmentWithPHI();
    const result = redactAppointmentPHI(input);

    expect(result.id).toBe('apt-123');
    expect(result.status).toBe('booked');
    expect(result.description).toBe('Follow-up Visit');
    expect(result.start).toBe('2026-04-27T12:00:00.000Z');
    expect(result.end).toBe('2026-04-27T12:20:00.000Z');
    expect(result.resourceType).toBe('Appointment');
  });

  it('does not mutate the original appointment', () => {
    const input = makeAppointmentWithPHI();
    const originalComment = input.comment;
    const originalDisplay = input.participant[1].actor?.display;

    redactAppointmentPHI(input);

    expect(input.comment).toBe(originalComment);
    expect(input.participant[1].actor?.display).toBe(originalDisplay);
  });

  it('handles appointment with no participants', () => {
    const input = makeAppointmentWithPHI({ participant: [] });
    const result = redactAppointmentPHI(input);

    expect(result.participant).toEqual([]);
  });

  it('handles participant with no actor', () => {
    const input = makeAppointmentWithPHI({
      participant: [{ status: 'accepted' }],
    });
    const result = redactAppointmentPHI(input);

    expect(result.participant).toHaveLength(1);
    expect(result.participant[0].status).toBe('accepted');
  });

  it('strips display from multiple patient participants', () => {
    const input = makeAppointmentWithPHI({
      participant: [
        { actor: { reference: 'Patient/p1', display: 'Alice' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/dr1', display: 'Dr. Bob' }, status: 'accepted' },
        { actor: { reference: 'Patient/p2', display: 'Charlie' }, status: 'accepted' },
      ],
    });
    const result = redactAppointmentPHI(input);

    const patients = result.participant.filter(
      p => p.actor?.reference?.includes('Patient/')
    );
    expect(patients).toHaveLength(2);
    patients.forEach(p => {
      expect(p.actor?.display).toBeUndefined();
    });

    const provider = result.participant.find(
      p => p.actor?.reference?.includes('Practitioner/')
    );
    expect(provider?.actor?.display).toBe('Dr. Bob');
  });

  it('handles appointment with no comment gracefully', () => {
    const input = makeAppointmentWithPHI();
    delete input.comment;
    const result = redactAppointmentPHI(input);

    expect(result.comment).toBeUndefined();
  });
});
