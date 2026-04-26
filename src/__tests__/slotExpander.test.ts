import {
  parseSlotYAML,
  validateTemplate,
  expandSlots,
  AvailabilityTemplate,
} from '../scheduling/slotExpander';

// ==================== parseSlotYAML ====================

describe('parseSlotYAML', () => {
  it('parses a minimal YAML template', () => {
    const yaml = `
startDate: "2026-05-01"
endDate:   "2026-05-02"
weekdays:  [mon, tue, wed, thu, fri]

blocks:
  - start: "09:00"
    end:   "12:00"
    duration: 30
`;
    const result = parseSlotYAML(yaml);
    expect(result.startDate).toBe('2026-05-01');
    expect(result.endDate).toBe('2026-05-02');
    expect(result.weekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].start).toBe('09:00');
    expect(result.blocks[0].end).toBe('12:00');
    expect(result.blocks[0].duration).toBe('30'); // parsed as string from YAML
  });

  it('parses appointmentTypes and block types/overbook', () => {
    const yaml = `
startDate: "2026-06-01"
endDate:   "2026-06-30"
weekdays:  [mon, wed, fri]

appointmentTypes:
  - code: OV
    description: "Office Visit"
    duration: 30
  - code: FU
    description: "Follow-Up"
    duration: 15

blocks:
  - start: "08:00"
    end:   "12:00"
    duration: 30
    types: [OV, FU]
    overbook: 2
`;
    const result = parseSlotYAML(yaml);
    expect(result.appointmentTypes).toHaveLength(2);
    expect(result.appointmentTypes![0].code).toBe('OV');
    expect(result.appointmentTypes![1].description).toBe('Follow-Up');
    expect(result.blocks[0].types).toEqual(['OV', 'FU']);
    expect(result.blocks[0].overbook).toBe('2');
  });

  it('strips comments from YAML', () => {
    const yaml = `
# This is a comment
startDate: "2026-05-01"  # inline comment gets stripped by regex
endDate: "2026-05-01"
weekdays: [mon]
blocks:
  - start: "09:00"
    end: "10:00"
    duration: 30
`;
    const result = parseSlotYAML(yaml);
    expect(result.startDate).toBe('2026-05-01');
  });

  it('normalizes weekdays to lowercase', () => {
    const yaml = `
startDate: "2026-05-01"
endDate: "2026-05-01"
weekdays: [Mon, TUE, Wed]
blocks:
  - start: "09:00"
    end: "10:00"
    duration: 30
`;
    const result = parseSlotYAML(yaml);
    expect(result.weekdays).toEqual(['mon', 'tue', 'wed']);
  });
});

// ==================== validateTemplate ====================

describe('validateTemplate', () => {
  const validTemplate: AvailabilityTemplate = {
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    blocks: [{ start: '09:00', end: '12:00', duration: 30 }],
  };

  it('returns no errors for a valid template', () => {
    expect(validateTemplate(validTemplate)).toEqual([]);
  });

  it('rejects missing startDate', () => {
    const errors = validateTemplate({ ...validTemplate, startDate: '' });
    expect(errors).toContainEqual(expect.stringContaining('startDate'));
  });

  it('rejects startDate after endDate', () => {
    const errors = validateTemplate({ ...validTemplate, startDate: '2026-06-01', endDate: '2026-05-01' });
    expect(errors).toContainEqual(expect.stringContaining('startDate must be before'));
  });

  it('rejects invalid weekday names', () => {
    const errors = validateTemplate({ ...validTemplate, weekdays: ['monday'] });
    expect(errors).toContainEqual(expect.stringContaining('Invalid weekday'));
  });

  it('rejects empty blocks array', () => {
    const errors = validateTemplate({ ...validTemplate, blocks: [] });
    expect(errors).toContainEqual(expect.stringContaining('blocks'));
  });

  it('rejects block with start >= end', () => {
    const errors = validateTemplate({
      ...validTemplate,
      blocks: [{ start: '12:00', end: '09:00', duration: 30 }],
    });
    expect(errors).toContainEqual(expect.stringContaining('start must be before'));
  });

  it('rejects invalid duration', () => {
    const errors = validateTemplate({
      ...validTemplate,
      blocks: [{ start: '09:00', end: '12:00', duration: 0 }],
    });
    expect(errors).toContainEqual(expect.stringContaining('duration'));
  });

  it('rejects block type referencing undefined appointment type', () => {
    const errors = validateTemplate({
      ...validTemplate,
      appointmentTypes: [{ code: 'OV', description: 'Office Visit' }],
      blocks: [{ start: '09:00', end: '12:00', duration: 30, types: ['OV', 'UNKNOWN'] }],
    });
    expect(errors).toContainEqual(expect.stringContaining('undefined appointment type "UNKNOWN"'));
  });

  it('accepts blocks with types matching defined appointmentTypes', () => {
    const errors = validateTemplate({
      ...validTemplate,
      appointmentTypes: [{ code: 'OV' }, { code: 'FU' }],
      blocks: [{ start: '09:00', end: '12:00', duration: 30, types: ['OV', 'FU'] }],
    });
    expect(errors).toEqual([]);
  });
});

// ==================== expandSlots ====================

describe('expandSlots', () => {
  it('generates correct number of slots for a single day and block', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04', // Monday
      endDate: '2026-05-04',
      weekdays: ['mon'],
      blocks: [{ start: '09:00', end: '12:00', duration: 30 }],
    };
    const { slots, warnings } = expandSlots(template, 'Schedule/test-1');
    // 09:00-12:00 with 30min = 6 slots
    expect(slots).toHaveLength(6);
    expect(warnings).toEqual([]);
  });

  it('generates correct start/end times', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      weekdays: ['mon'],
      blocks: [{ start: '09:00', end: '10:00', duration: 20 }],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    // 09:00-10:00 with 20min = 3 slots (09:00, 09:20, 09:40)
    expect(slots).toHaveLength(3);
    expect(slots[0].start).toBe('2026-05-04T09:00:00');
    expect(slots[0].end).toBe('2026-05-04T09:20:00');
    expect(slots[1].start).toBe('2026-05-04T09:20:00');
    expect(slots[2].start).toBe('2026-05-04T09:40:00');
    expect(slots[2].end).toBe('2026-05-04T10:00:00');
  });

  it('skips days not in weekdays', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04', // Monday
      endDate: '2026-05-10',   // Sunday
      weekdays: ['mon', 'wed', 'fri'],
      blocks: [{ start: '09:00', end: '10:00', duration: 60 }],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    // Only Mon, Wed, Fri = 3 days × 1 slot each = 3
    expect(slots).toHaveLength(3);
  });

  it('handles multiple blocks (lunch break)', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      weekdays: ['mon'],
      blocks: [
        { start: '09:00', end: '12:00', duration: 60 }, // 3 slots
        { start: '13:00', end: '15:00', duration: 60 }, // 2 slots
      ],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    expect(slots).toHaveLength(5);
  });

  it('sets schedule reference on all slots', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      weekdays: ['mon'],
      blocks: [{ start: '09:00', end: '10:00', duration: 30 }],
    };
    const { slots } = expandSlots(template, 'Schedule/my-sched');
    for (const slot of slots) {
      expect(slot.schedule.reference).toBe('Schedule/my-sched');
      expect(slot.status).toBe('free');
      expect(slot.resourceType).toBe('Slot');
    }
  });

  it('adds appointmentType and serviceType from block types', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      weekdays: ['mon'],
      appointmentTypes: [
        { code: 'OV', description: 'Office Visit', duration: 30 },
        { code: 'FU', description: 'Follow-Up', duration: 15 },
      ],
      blocks: [{ start: '09:00', end: '09:30', duration: 30, types: ['OV', 'FU'] }],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    expect(slots).toHaveLength(1);
    expect(slots[0].appointmentType).toEqual({ text: 'Office Visit' });
    expect(slots[0].serviceType).toEqual([
      { text: 'Office Visit' },
      { text: 'Follow-Up' },
    ]);
  });

  it('adds overbook comment when configured', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      weekdays: ['mon'],
      blocks: [{ start: '09:00', end: '09:30', duration: 30, overbook: 3 }],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    expect(slots[0].overbooked).toBe(false);
    expect(slots[0].comment).toBe('overbook:3');
  });

  it('does not set overbook fields when overbook is 0 or undefined', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      weekdays: ['mon'],
      blocks: [{ start: '09:00', end: '09:30', duration: 30, overbook: 0 }],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    expect(slots[0].overbooked).toBeUndefined();
    expect(slots[0].comment).toBeUndefined();
  });

  it('returns empty array when date range has no matching weekdays', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-05-04', // Monday
      endDate: '2026-05-04',
      weekdays: ['sat', 'sun'],
      blocks: [{ start: '09:00', end: '12:00', duration: 30 }],
    };
    const { slots } = expandSlots(template, 'Schedule/test-1');
    expect(slots).toHaveLength(0);
  });

  it('warns when generating many slots', () => {
    const template: AvailabilityTemplate = {
      startDate: '2026-01-01',
      endDate: '2026-12-31', // full year
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      blocks: [
        { start: '08:00', end: '12:00', duration: 15 }, // 16 slots/block
        { start: '13:00', end: '17:00', duration: 15 }, // 16 slots/block
      ],
    };
    const { slots, warnings } = expandSlots(template, 'Schedule/test-1');
    // ~261 weekdays × 32 slots = ~8352
    expect(slots.length).toBeGreaterThan(5000);
    expect(warnings.some(w => w.includes('consider a shorter date range'))).toBe(true);
  });
});
