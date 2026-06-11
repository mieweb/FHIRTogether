import {
  parseScheduleBundle,
  isSyncedSchedule,
  buildSlotTemplate,
  SYNC_SOURCE_EXTENSION_URL,
} from '../scheduling/scheduleSync';

const SOURCE_URL = 'https://example.org/fhir/schedules';

const COLLECTION_BUNDLE = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Practitioner',
        id: '16',
        name: [{ family: 'Butler', given: ['Internist', 'E.'] }],
      },
    },
    { resource: { resourceType: 'Location', id: 'OFFICE', name: 'Office' } },
    {
      resource: {
        resourceType: 'Schedule',
        id: '5',
        actor: [
          { reference: 'Practitioner/16', display: 'Butler, Internist E.' },
          { reference: 'Location/OFFICE' },
        ],
        serviceType: [{ coding: [{ display: 'OSHA Beryllium' }], text: 'OSHA Beryllium' }],
        planningHorizon: { start: '2026-01-30T13:00:00Z', end: '2026-08-30T21:00:00Z' },
        comment: 'Test comment',
        extension: [
          {
            url: 'https://zeus.example/StructureDefinition/schedule-portal-time-slots',
            valueInteger: 15,
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/availableTime',
            availableTime: [
              { daysOfWeek: ['mon', 'tue'], availableStartTime: '08:00:00', availableEndTime: '17:00:00' },
            ],
          },
        ],
      },
    },
  ],
};

describe('parseScheduleBundle', () => {
  it('parses a collection bundle into persistable schedules', () => {
    const { schedules } = parseScheduleBundle(COLLECTION_BUNDLE, SOURCE_URL);
    expect(schedules).toHaveLength(1);
    const s = schedules[0];
    expect(s.resourceType).toBe('Schedule');
    expect(s.id).toBe('5');
    expect(s.comment).toBe('Test comment');
    expect(s.planningHorizon).toEqual({ start: '2026-01-30T13:00:00Z', end: '2026-08-30T21:00:00Z' });
  });

  it('resolves the Location actor display from the bundle', () => {
    const { schedules } = parseScheduleBundle(COLLECTION_BUNDLE, SOURCE_URL);
    const locationActor = schedules[0].actor.find((a) => a.reference?.startsWith('Location/'));
    expect(locationActor?.display).toBe('Office');
  });

  it('preserves the availableTime and slot-length extensions', () => {
    const { schedules } = parseScheduleBundle(COLLECTION_BUNDLE, SOURCE_URL);
    const ext = schedules[0].extension || [];
    const avail = ext.find((e) => e.url === 'http://hl7.org/fhir/StructureDefinition/availableTime');
    const slot = ext.find(
      (e) => typeof e.url === 'string' && e.url.endsWith('/schedule-portal-time-slots')
    );
    expect(avail).toBeDefined();
    expect((slot as { valueInteger?: number })?.valueInteger).toBe(15);
  });

  it('stamps a sync-source marker extension', () => {
    const { schedules } = parseScheduleBundle(COLLECTION_BUNDLE, SOURCE_URL);
    const marker = (schedules[0].extension || []).find((e) => e.url === SYNC_SOURCE_EXTENSION_URL);
    expect((marker as { valueString?: string })?.valueString).toBe(SOURCE_URL);
    expect(isSyncedSchedule(schedules[0])).toBe(true);
  });

  it('does not duplicate the marker when re-parsing an already-synced schedule', () => {
    const { schedules: first } = parseScheduleBundle(COLLECTION_BUNDLE, SOURCE_URL);
    const reBundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: { ...first[0] } }],
    };
    const { schedules: second } = parseScheduleBundle(reBundle, SOURCE_URL);
    const markers = (second[0].extension || []).filter((e) => e.url === SYNC_SOURCE_EXTENSION_URL);
    expect(markers).toHaveLength(1);
  });

  it('rejects a non-Bundle payload', () => {
    expect(() => parseScheduleBundle({ resourceType: 'Schedule' }, SOURCE_URL)).toThrow(
      /not a FHIR Bundle/
    );
  });

  it('rejects a Bundle that is not a collection', () => {
    expect(() =>
      parseScheduleBundle({ resourceType: 'Bundle', type: 'searchset', entry: [] }, SOURCE_URL)
    ).toThrow(/collection/);
  });
});

describe('buildSlotTemplate', () => {
  const [schedule] = parseScheduleBundle(COLLECTION_BUNDLE, SOURCE_URL).schedules;

  it('converts availableTime + slot-length into a forward-projected template', () => {
    const { template } = buildSlotTemplate(schedule, '2026-02-01');
    expect(template).not.toBeNull();
    expect(template!.weekdays).toEqual(['mon', 'tue']);
    expect(template!.blocks).toEqual([{ start: '08:00', end: '17:00', duration: 15 }]);
    // Starts at today (after the horizon start), ends at the horizon end.
    expect(template!.startDate).toBe('2026-02-01');
    expect(template!.endDate).toBe('2026-08-30');
  });

  it('starts at the horizon start when it is still in the future', () => {
    const { template } = buildSlotTemplate(schedule, '2025-01-01');
    expect(template!.startDate).toBe('2026-01-30');
  });

  it('produces no template when the planning horizon has already ended', () => {
    const { template, note } = buildSlotTemplate(schedule, '2027-01-01');
    expect(template).toBeNull();
    expect(note).toMatch(/in the past/);
  });

  it('defaults to weekdays when daysOfWeek is empty', () => {
    const noDays = {
      ...schedule,
      extension: (schedule.extension || []).map((e) =>
        e.url === 'http://hl7.org/fhir/StructureDefinition/availableTime'
          ? { ...e, availableTime: [{ availableStartTime: '08:00:00', availableEndTime: '17:00:00', daysOfWeek: [] }] }
          : e
      ),
    };
    const { template } = buildSlotTemplate(noDays, '2026-02-01');
    expect(template!.weekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
  });

  it('returns no template when availableTime is missing', () => {
    const noAvail = {
      ...schedule,
      extension: (schedule.extension || []).filter(
        (e) => e.url !== 'http://hl7.org/fhir/StructureDefinition/availableTime'
      ),
    };
    const { template, note } = buildSlotTemplate(noAvail, '2026-02-01');
    expect(template).toBeNull();
    expect(note).toMatch(/availableTime/);
  });
});
