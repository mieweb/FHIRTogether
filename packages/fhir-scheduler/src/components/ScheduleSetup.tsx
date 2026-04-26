import { useState, useEffect, useMemo, useCallback } from 'react';
import { createFhirClient } from '../api/fhirClient';
import type { Schedule, Bundle, AvailabilityTemplate, AvailabilityBlock, AppointmentTypeDefinition, GenerateSlotsResult } from '../types';

// ==================== Props ====================

interface ScheduleSetupProps {
  /** Base URL of the FHIR server */
  fhirBaseUrl: string;
  /** Pre-select a provider by schedule ID */
  initialScheduleId?: string;
  /** Callback when slots are generated successfully */
  onGenerate?: (result: GenerateSlotsResult) => void;
}

// ==================== Constants ====================

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};
const DAY_NUMBERS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const DURATION_OPTIONS = [15, 20, 30, 45, 60];

/** Maps weekday abbreviations to RRULE BYDAY tokens */
const WEEKDAY_TO_BYDAY: Record<string, string> = {
  sun: 'SU', mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA',
};
const BYDAY_TO_WEEKDAY: Record<string, string> = {
  SU: 'sun', MO: 'mon', TU: 'tue', WE: 'wed', TH: 'thu', FR: 'fri', SA: 'sat',
};

/** Recurrence frequency tabs (Outlook-style) */
type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Daily sub-mode */
type DailyMode = 'interval' | 'weekdays';

/** Monthly sub-mode */
type MonthlyMode = 'dayOfMonth' | 'weekdayOfMonth';

/** Yearly sub-mode */
type YearlyMode = 'exact' | 'relative';

/** Ordinal position for "the Nth weekday" pattern */
const ORDINALS = [
  { value: '1', label: 'First' },
  { value: '2', label: 'Second' },
  { value: '3', label: 'Third' },
  { value: '4', label: 'Fourth' },
  { value: '-1', label: 'Last' },
];

/** Weekday choices for monthly/yearly relative patterns */
const RELATIVE_DAY_OPTIONS = [
  { value: 'MO', label: 'Monday' },
  { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' },
  { value: 'TH', label: 'Thursday' },
  { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
  { value: 'SU', label: 'Sunday' },
  { value: 'MO,TU,WE,TH,FR', label: 'Weekday' },
  { value: 'SA,SU', label: 'Weekend day' },
  { value: 'MO,TU,WE,TH,FR,SA,SU', label: 'Day' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Build an RRULE string from the Outlook-style form state */
function buildRrule(
  freq: RecurrenceFreq,
  opts: {
    dailyMode: DailyMode;
    dailyInterval: number;
    weeklyInterval: number;
    weeklyDays: string[];         // ['mon','tue',...]
    monthlyMode: MonthlyMode;
    monthlyInterval: number;
    monthlyDayOfMonth: number;
    monthlyOrdinal: string;       // '1','-1', etc.
    monthlyWeekday: string;       // 'MO', 'MO,TU,...'
    yearlyMode: YearlyMode;
    yearlyMonth: number;          // 1-12
    yearlyDayOfMonth: number;
    yearlyOrdinal: string;
    yearlyWeekday: string;
  },
): { rrule: string | undefined; weekdays: string[] } {
  switch (freq) {
    case 'daily': {
      if (opts.dailyMode === 'weekdays') {
        // Every weekday → simple weekdays array (no RRULE needed)
        return { rrule: undefined, weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] };
      }
      if (opts.dailyInterval === 1) {
        // Every day → all 7 weekdays
        return { rrule: undefined, weekdays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };
      }
      return { rrule: `FREQ=DAILY;INTERVAL=${opts.dailyInterval}`, weekdays: [] };
    }
    case 'weekly': {
      const byDay = opts.weeklyDays.map(d => WEEKDAY_TO_BYDAY[d]).filter(Boolean);
      if (opts.weeklyInterval === 1 && byDay.length > 0) {
        // Simple weekly → weekdays array
        return { rrule: undefined, weekdays: opts.weeklyDays };
      }
      const parts = ['FREQ=WEEKLY'];
      if (opts.weeklyInterval > 1) parts.push(`INTERVAL=${opts.weeklyInterval}`);
      if (byDay.length > 0) parts.push(`BYDAY=${byDay.join(',')}`);
      return { rrule: parts.join(';'), weekdays: opts.weeklyDays };
    }
    case 'monthly': {
      const parts = ['FREQ=MONTHLY'];
      if (opts.monthlyInterval > 1) parts.push(`INTERVAL=${opts.monthlyInterval}`);
      if (opts.monthlyMode === 'dayOfMonth') {
        parts.push(`BYMONTHDAY=${opts.monthlyDayOfMonth}`);
      } else {
        // e.g. BYDAY=1MO  or  BYDAY=-1FR
        const ordStr = opts.monthlyOrdinal;
        const dayTokens = opts.monthlyWeekday.split(',');
        // For multi-day tokens (Weekday, Weekend, Day), use BYDAY with BYSETPOS
        if (dayTokens.length > 1) {
          parts.push(`BYDAY=${dayTokens.join(',')}`);
          parts.push(`BYSETPOS=${ordStr}`);
        } else {
          parts.push(`BYDAY=${ordStr}${dayTokens[0]}`);
        }
      }
      return { rrule: parts.join(';'), weekdays: [] };
    }
    case 'yearly': {
      const parts = ['FREQ=YEARLY', `BYMONTH=${opts.yearlyMonth}`];
      if (opts.yearlyMode === 'exact') {
        parts.push(`BYMONTHDAY=${opts.yearlyDayOfMonth}`);
      } else {
        const ordStr = opts.yearlyOrdinal;
        const dayTokens = opts.yearlyWeekday.split(',');
        if (dayTokens.length > 1) {
          parts.push(`BYDAY=${dayTokens.join(',')}`);
          parts.push(`BYSETPOS=${ordStr}`);
        } else {
          parts.push(`BYDAY=${ordStr}${dayTokens[0]}`);
        }
      }
      return { rrule: parts.join(';'), weekdays: [] };
    }
  }
}

/** Parse an RRULE string into Outlook-style form state (best-effort) */
function parseRruleToForm(rrule: string): {
  freq: RecurrenceFreq;
  dailyMode: DailyMode; dailyInterval: number;
  weeklyInterval: number; weeklyDays: string[];
  monthlyMode: MonthlyMode; monthlyInterval: number; monthlyDayOfMonth: number;
  monthlyOrdinal: string; monthlyWeekday: string;
  yearlyMode: YearlyMode; yearlyMonth: number; yearlyDayOfMonth: number;
  yearlyOrdinal: string; yearlyWeekday: string;
} | null {
  const parts = new Map<string, string>();
  for (const seg of rrule.split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) parts.set(k, v);
  }

  const freqStr = parts.get('FREQ')?.toUpperCase();
  const interval = Number(parts.get('INTERVAL')) || 1;
  const byDay = parts.get('BYDAY') || '';
  const byMonthDay = Number(parts.get('BYMONTHDAY')) || 1;
  const byMonth = Number(parts.get('BYMONTH')) || 1;
  const bySetPos = parts.get('BYSETPOS') || '';

  const defaults = {
    dailyMode: 'interval' as DailyMode, dailyInterval: 1,
    weeklyInterval: 1, weeklyDays: ['mon', 'tue', 'wed', 'thu', 'fri'] as string[],
    monthlyMode: 'dayOfMonth' as MonthlyMode, monthlyInterval: 1, monthlyDayOfMonth: 1,
    monthlyOrdinal: '1', monthlyWeekday: 'MO',
    yearlyMode: 'exact' as YearlyMode, yearlyMonth: 1, yearlyDayOfMonth: 1,
    yearlyOrdinal: '1', yearlyWeekday: 'MO',
  };

  switch (freqStr) {
    case 'DAILY':
      return { ...defaults, freq: 'daily', dailyInterval: interval };

    case 'WEEKLY': {
      const days = byDay ? byDay.split(',').map(d => BYDAY_TO_WEEKDAY[d.trim()]).filter(Boolean) : [];
      return { ...defaults, freq: 'weekly', weeklyInterval: interval, weeklyDays: days.length ? days : defaults.weeklyDays };
    }

    case 'MONTHLY': {
      if (byMonthDay && !byDay) {
        return { ...defaults, freq: 'monthly', monthlyMode: 'dayOfMonth', monthlyInterval: interval, monthlyDayOfMonth: byMonthDay };
      }
      // Parse BYDAY like "1MO" or "-1FR" or BYDAY=MO,TU + BYSETPOS=1
      let ordinal = '1';
      let weekday = 'MO';
      if (bySetPos) {
        ordinal = bySetPos;
        weekday = byDay;
      } else if (byDay) {
        const m = byDay.match(/^(-?\d)(.+)$/);
        if (m) {
          ordinal = m[1];
          weekday = m[2];
        } else {
          weekday = byDay;
        }
      }
      return { ...defaults, freq: 'monthly', monthlyMode: 'weekdayOfMonth', monthlyInterval: interval, monthlyOrdinal: ordinal, monthlyWeekday: weekday };
    }

    case 'YEARLY': {
      if (byMonthDay && !byDay) {
        return { ...defaults, freq: 'yearly', yearlyMode: 'exact', yearlyMonth: byMonth, yearlyDayOfMonth: byMonthDay };
      }
      let ordinal = '1';
      let weekday = 'MO';
      if (bySetPos) {
        ordinal = bySetPos;
        weekday = byDay;
      } else if (byDay) {
        const m = byDay.match(/^(-?\d)(.+)$/);
        if (m) {
          ordinal = m[1];
          weekday = m[2];
        } else {
          weekday = byDay;
        }
      }
      return { ...defaults, freq: 'yearly', yearlyMode: 'relative', yearlyMonth: byMonth, yearlyOrdinal: ordinal, yearlyWeekday: weekday };
    }

    default:
      return null;
  }
}

const DEFAULT_BLOCKS: AvailabilityBlock[] = [
  { start: '08:00', end: '12:00', duration: 30 },
  { start: '13:00', end: '17:00', duration: 30 },
];

// ==================== Helpers ====================

function getProviderName(schedule: Schedule): string {
  const firstActor = schedule.actor?.[0];
  return firstActor?.display || firstActor?.reference?.split('/').pop() || 'Provider';
}

function getSystemName(schedule: Schedule): string {
  const ext = schedule.extension?.find(
    (e: { url: string; valueString?: string }) =>
      e.url === 'https://fhirtogether.org/fhir/StructureDefinition/system-name'
  );
  return ext?.valueString || 'Local';
}

/** Format a date as YYYY-MM-DD */
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Count matching weekdays between two dates */
function countWeekdaysBetween(startStr: string, endStr: string, weekdays: string[]): number {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const dayNums = weekdays.map(d => DAY_NUMBERS[d]);
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    if (dayNums.includes(d.getDay())) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Get sample dates (first 5 + last 2) matching weekdays */
function getSampleDates(startStr: string, endStr: string, weekdays: string[], max = 7): string[] {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const dayNums = weekdays.map(d => DAY_NUMBERS[d]);
  const matches: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    if (dayNums.includes(d.getDay())) {
      matches.push(toDateString(d));
    }
    d.setDate(d.getDate() + 1);
  }
  if (matches.length <= max) return matches;
  return [...matches.slice(0, 5), '…', ...matches.slice(-2)];
}

/** Count slots per day from blocks */
function slotsPerDay(blocks: AvailabilityBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    const [sh, sm] = block.start.split(':').map(Number);
    const [eh, em] = block.end.split(':').map(Number);
    const blockMinutes = (eh * 60 + em) - (sh * 60 + sm);
    if (blockMinutes > 0 && block.duration > 0) {
      total += Math.floor(blockMinutes / block.duration);
    }
  }
  return total;
}

// ==================== YAML Helpers ====================

/** Serialize form state to the Schedule YAML format */
function templateToYaml(t: AvailabilityTemplate): string {
  const lines: string[] = [];
  lines.push(`startDate: "${t.startDate}"`);
  lines.push(`endDate:   "${t.endDate}"`);

  if (t.rrule) {
    lines.push(`rrule: "${t.rrule}"`);
  } else if (t.weekdays?.length) {
    lines.push(`weekdays:  [${t.weekdays.join(', ')}]`);
  }

  if (t.exdates?.length) {
    lines.push(`exdates: [${t.exdates.join(', ')}]`);
  }

  if (t.appointmentTypes?.length) {
    lines.push('');
    lines.push('appointmentTypes:');
    for (const at of t.appointmentTypes) {
      lines.push(`  - code: ${at.code}`);
      if (at.description) lines.push(`    description: "${at.description}"`);
      if (at.duration) lines.push(`    duration: ${at.duration}`);
    }
  }

  lines.push('');
  lines.push('blocks:');
  for (const b of t.blocks) {
    lines.push(`  - start: "${b.start}"`);
    lines.push(`    end:   "${b.end}"`);
    lines.push(`    duration: ${b.duration}`);
    if (b.types?.length) lines.push(`    types: [${b.types.join(', ')}]`);
    if (b.overbook !== undefined && b.overbook > 0) lines.push(`    overbook: ${b.overbook}`);
  }

  return lines.join('\n') + '\n';
}

/** Parse Schedule YAML back into an AvailabilityTemplate (best-effort) */
function yamlToTemplate(yaml: string): AvailabilityTemplate | null {
  try {
    const t: AvailabilityTemplate = { startDate: '', endDate: '', weekdays: [], blocks: [] };

    // Simple key-value extraction
    const val = (key: string): string | undefined => {
      const re = new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, 'm');
      const m = yaml.match(re);
      return m ? m[1].trim() : undefined;
    };

    const arr = (key: string): string[] => {
      const re = new RegExp(`^${key}:\\s*\\[([^\\]]+)\\]`, 'm');
      const m = yaml.match(re);
      return m ? m[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
    };

    t.startDate = val('startDate') || '';
    t.endDate = val('endDate') || '';
    t.rrule = val('rrule');
    t.weekdays = arr('weekdays');
    t.exdates = arr('exdates');
    if (t.exdates.length === 0) t.exdates = undefined;

    // Parse blocks
    const blockMatches = [...yaml.matchAll(/- start:\s*"?(\d{2}:\d{2})"?/g)];
    for (const bm of blockMatches) {
      const idx = bm.index!;
      // Grab the text from this "- start:" to the next "- start:" or end
      const nextBlock = yaml.indexOf('- start:', idx + 1);
      const chunk = yaml.slice(idx, nextBlock > -1 ? nextBlock : undefined);

      const end = chunk.match(/end:\s*"?(\d{2}:\d{2})"?/)?.[1] || '';
      const dur = chunk.match(/duration:\s*(\d+)/)?.[1];
      const types = chunk.match(/types:\s*\[([^\]]+)\]/)?.[1]?.split(',').map(s => s.trim());
      const overbook = chunk.match(/overbook:\s*(\d+)/)?.[1];

      t.blocks.push({
        start: bm[1],
        end,
        duration: dur ? Number(dur) : 30,
        types: types?.length ? types : undefined,
        overbook: overbook !== undefined ? Number(overbook) : undefined,
      });
    }

    // Parse appointment types
    const aptSection = yaml.match(/appointmentTypes:\n([\s\S]*?)(?=\nblocks:|\n\S|\Z)/);
    if (aptSection) {
      const aptTypes: AppointmentTypeDefinition[] = [];
      const codeMatches = [...aptSection[1].matchAll(/- code:\s*(.+)/g)];
      for (const cm of codeMatches) {
        const cIdx = cm.index!;
        const nextCode = aptSection[1].indexOf('- code:', cIdx + 1);
        const chunk = aptSection[1].slice(cIdx, nextCode > -1 ? nextCode : undefined);

        const desc = chunk.match(/description:\s*"?([^"\n]+)"?/)?.[1]?.trim();
        const dur = chunk.match(/duration:\s*(\d+)/)?.[1];

        aptTypes.push({
          code: cm[1].trim(),
          description: desc,
          duration: dur ? Number(dur) : undefined,
        });
      }
      if (aptTypes.length) t.appointmentTypes = aptTypes;
    }

    if (!t.startDate || !t.endDate || t.blocks.length === 0) return null;
    return t;
  } catch {
    return null;
  }
}

// ==================== Component ====================

export function ScheduleSetup({ fhirBaseUrl, initialScheduleId, onGenerate }: ScheduleSetupProps) {
  // Providers
  const [providers, setProviders] = useState<Schedule[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Schedule | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);

  // Template fields
  const today = toDateString(new Date());
  const sixMonthsLater = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return toDateString(d);
  }, []);

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(sixMonthsLater);

  // Recurrence builder state (Outlook-style)
  const [recFreq, setRecFreq] = useState<RecurrenceFreq>('weekly');
  const [dailyMode, setDailyMode] = useState<DailyMode>('weekdays');
  const [dailyInterval, setDailyInterval] = useState(1);
  const [weeklyInterval, setWeeklyInterval] = useState(1);
  const [selectedWeekdays, setSelectedWeekdays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('dayOfMonth');
  const [monthlyInterval, setMonthlyInterval] = useState(1);
  const [monthlyDayOfMonth, setMonthlyDayOfMonth] = useState(1);
  const [monthlyOrdinal, setMonthlyOrdinal] = useState('1');
  const [monthlyWeekday, setMonthlyWeekday] = useState('MO');
  const [yearlyMode, setYearlyMode] = useState<YearlyMode>('exact');
  const [yearlyMonth, setYearlyMonth] = useState(1);
  const [yearlyDayOfMonth, setYearlyDayOfMonth] = useState(1);
  const [yearlyOrdinal, setYearlyOrdinal] = useState('1');
  const [yearlyWeekday, setYearlyWeekday] = useState('MO');

  const [exdates, setExdates] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>(() => DEFAULT_BLOCKS.map(b => ({ ...b })));
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentTypeDefinition[]>([]);
  const [showTypes, setShowTypes] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [yamlText, setYamlText] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [mode, setMode] = useState<'replace' | 'incremental'>('replace');

  // Status
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateSlotsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => createFhirClient({ baseUrl: fhirBaseUrl }), [fhirBaseUrl]);

  // Fetch providers
  useEffect(() => {
    async function fetchProviders() {
      setProvidersLoading(true);
      try {
        const res = await fetch(`${fhirBaseUrl}/Schedule?active=true`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`Failed to fetch providers: ${res.statusText}`);
        const bundle: Bundle<Schedule> = await res.json();
        const list = bundle.entry?.map(e => e.resource) || [];
        setProviders(list);
        const match = initialScheduleId ? list.find(p => p.id === initialScheduleId) : null;
        if (match) setSelectedProvider(match);
        else if (list.length > 0) setSelectedProvider(list[0]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load providers');
      } finally {
        setProvidersLoading(false);
      }
    }
    fetchProviders();
  }, [fhirBaseUrl, initialScheduleId]);

  // Preview calculations
  const preview = useMemo(() => {
    if (!startDate || !endDate || selectedWeekdays.length === 0 || blocks.length === 0) {
      return null;
    }
    const dayCount = countWeekdaysBetween(startDate, endDate, selectedWeekdays);
    const perDay = slotsPerDay(blocks);
    const totalSlots = dayCount * perDay;
    const sampleDates = getSampleDates(startDate, endDate, selectedWeekdays);
    return { dayCount, perDay, totalSlots, sampleDates };
  }, [startDate, endDate, selectedWeekdays, blocks]);

  // Weekday toggle
  const toggleWeekday = useCallback((day: string) => {
    setSelectedWeekdays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  }, []);

  // Build the current template from form state (used for YAML export + generate)
  const currentTemplate = useMemo((): AvailabilityTemplate => {
    const rec = buildRrule(recFreq, {
      dailyMode, dailyInterval,
      weeklyInterval, weeklyDays: selectedWeekdays,
      monthlyMode, monthlyInterval, monthlyDayOfMonth, monthlyOrdinal, monthlyWeekday,
      yearlyMode, yearlyMonth, yearlyDayOfMonth, yearlyOrdinal, yearlyWeekday,
    });

    const t: AvailabilityTemplate = {
      startDate,
      endDate,
      weekdays: rec.weekdays.length > 0 ? rec.weekdays : selectedWeekdays,
      blocks: blocks.map(b => ({
        ...b,
        duration: Number(b.duration),
        overbook: b.overbook !== undefined ? Number(b.overbook) : undefined,
      })),
    };
    if (rec.rrule) {
      t.rrule = rec.rrule;
    }
    if (exdates.length > 0) {
      t.exdates = exdates;
    }
    if (appointmentTypes.length > 0) {
      const filtered = appointmentTypes.filter(at => at.code.trim());
      if (filtered.length) t.appointmentTypes = filtered;
    }
    return t;
  }, [startDate, endDate, selectedWeekdays, recFreq, dailyMode, dailyInterval, weeklyInterval,
      monthlyMode, monthlyInterval, monthlyDayOfMonth, monthlyOrdinal, monthlyWeekday,
      yearlyMode, yearlyMonth, yearlyDayOfMonth, yearlyOrdinal, yearlyWeekday,
      exdates, blocks, appointmentTypes]);

  // Sync form → YAML when the YAML panel is open
  useEffect(() => {
    if (showYaml) {
      setYamlText(templateToYaml(currentTemplate));
      setYamlError(null);
    }
  }, [showYaml, currentTemplate]);

  // Apply YAML edits → form state
  const applyYaml = useCallback(() => {
    const parsed = yamlToTemplate(yamlText);
    if (!parsed) {
      setYamlError('Invalid YAML — could not parse. Check format and try again.');
      return;
    }
    setYamlError(null);
    setStartDate(parsed.startDate);
    setEndDate(parsed.endDate);

    if (parsed.rrule) {
      const formState = parseRruleToForm(parsed.rrule);
      if (formState) {
        setRecFreq(formState.freq);
        setDailyMode(formState.dailyMode);
        setDailyInterval(formState.dailyInterval);
        setWeeklyInterval(formState.weeklyInterval);
        setSelectedWeekdays(formState.weeklyDays);
        setMonthlyMode(formState.monthlyMode);
        setMonthlyInterval(formState.monthlyInterval);
        setMonthlyDayOfMonth(formState.monthlyDayOfMonth);
        setMonthlyOrdinal(formState.monthlyOrdinal);
        setMonthlyWeekday(formState.monthlyWeekday);
        setYearlyMode(formState.yearlyMode);
        setYearlyMonth(formState.yearlyMonth);
        setYearlyDayOfMonth(formState.yearlyDayOfMonth);
        setYearlyOrdinal(formState.yearlyOrdinal);
        setYearlyWeekday(formState.yearlyWeekday);
      }
    } else {
      setRecFreq('weekly');
      setWeeklyInterval(1);
      setSelectedWeekdays(parsed.weekdays || []);
    }

    setExdates(parsed.exdates || []);
    setBlocks(parsed.blocks);
    setAppointmentTypes(parsed.appointmentTypes || []);
    setShowTypes(!!(parsed.appointmentTypes?.length));
  }, [yamlText]);

  // Exdate management
  const addExdate = useCallback(() => {
    setExdates(prev => [...prev, '']);
  }, []);

  const updateExdate = useCallback((index: number, value: string) => {
    setExdates(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  const removeExdate = useCallback((index: number) => {
    setExdates(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Block management
  const updateBlock = useCallback((index: number, field: keyof AvailabilityBlock, value: string | number) => {
    setBlocks(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const addBlock = useCallback(() => {
    setBlocks(prev => [...prev, { start: '09:00', end: '10:00', duration: 30 }]);
  }, []);

  const removeBlock = useCallback((index: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Appointment type management
  const updateType = useCallback((index: number, field: keyof AppointmentTypeDefinition, value: string | number) => {
    setAppointmentTypes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const addType = useCallback(() => {
    setAppointmentTypes(prev => [...prev, { code: '', description: '' }]);
  }, []);

  const removeType = useCallback((index: number) => {
    setAppointmentTypes(prev => prev.filter((_, i) => i !== index));
    // Also remove references from blocks
    const removedCode = appointmentTypes[index]?.code;
    if (removedCode) {
      setBlocks(prev => prev.map(b =>
        b.types ? { ...b, types: b.types.filter(t => t !== removedCode) } : b
      ));
    }
  }, [appointmentTypes]);

  const toggleBlockType = useCallback((blockIndex: number, typeCode: string) => {
    setBlocks(prev => {
      const updated = [...prev];
      const block = { ...updated[blockIndex] };
      const types = block.types ? [...block.types] : [];
      if (types.includes(typeCode)) {
        block.types = types.filter(t => t !== typeCode);
      } else {
        block.types = [...types, typeCode];
      }
      if (block.types.length === 0) block.types = undefined;
      updated[blockIndex] = block;
      return updated;
    });
  }, []);

  // Generate slots
  const handleGenerate = useCallback(async () => {
    if (!selectedProvider?.id) return;

    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await client.generateSlots(selectedProvider.id, currentTemplate, mode);
      setResult(res);
      onGenerate?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate slots');
    } finally {
      setGenerating(false);
    }
  }, [selectedProvider, currentTemplate, mode, client, onGenerate]);

  const canGenerate = selectedProvider && startDate && endDate && selectedWeekdays.length > 0 && blocks.length > 0 && !generating;

  // Loading state
  if (providersLoading) {
    return (
      <div className="fs-scheduler-widget fs-schedule-setup">
        <div className="fs-loading">
          <div className="fs-loading-spinner">
            <svg className="fs-spinner" viewBox="0 0 50 50" aria-label="Loading providers">
              <circle className="fs-spinner-track" cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
              <circle className="fs-spinner-head" cx="25" cy="25" r="20" fill="none" strokeWidth="4" strokeDasharray="80, 200" strokeLinecap="round" />
            </svg>
            <span className="fs-loading-text">Loading providers...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fs-scheduler-widget fs-schedule-setup">
      <header className="fs-schedule-setup-header">
        <h2 className="fs-section-title">Schedule Setup</h2>
        <p className="fs-schedule-setup-subtitle">
          Define recurring availability to generate bookable time slots.
        </p>
      </header>

      {/* Provider selector */}
      <section className="fs-schedule-setup-section" aria-label="Select provider">
        <label htmlFor="schedule-provider" className="fs-schedule-setup-label">Provider</label>
        <select
          id="schedule-provider"
          className="fs-apptlist-select"
          value={selectedProvider?.id || ''}
          onChange={e => {
            const provider = providers.find(p => p.id === e.target.value);
            setSelectedProvider(provider || null);
          }}
          aria-label="Select a provider to configure schedule"
        >
          {(() => {
            const groups = new Map<string, Schedule[]>();
            for (const p of providers) {
              const sys = getSystemName(p);
              const list = groups.get(sys) || [];
              list.push(p);
              groups.set(sys, list);
            }
            if (groups.size <= 1) {
              return providers.map(p => (
                <option key={p.id} value={p.id}>{getProviderName(p)}</option>
              ));
            }
            return Array.from(groups.entries()).map(([systemName, groupProviders]) => (
              <optgroup key={systemName} label={systemName}>
                {groupProviders.map(p => (
                  <option key={p.id} value={p.id}>{getProviderName(p)}</option>
                ))}
              </optgroup>
            ));
          })()}
        </select>
      </section>

      {/* Date range */}
      <section className="fs-schedule-setup-section" aria-label="Date range">
        <h3 className="fs-schedule-setup-label">Date Range</h3>
        <div className="fs-schedule-setup-row">
          <div className="fs-schedule-setup-field">
            <label htmlFor="schedule-start-date">Start</label>
            <input
              id="schedule-start-date"
              type="date"
              className="fs-schedule-setup-input"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div className="fs-schedule-setup-field">
            <label htmlFor="schedule-end-date">End</label>
            <input
              id="schedule-end-date"
              type="date"
              className="fs-schedule-setup-input"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Recurrence pattern (Outlook-style) */}
      <section className="fs-schedule-setup-section" aria-label="Recurrence pattern">
        <h3 className="fs-schedule-setup-label">Recurrence</h3>

        {/* Frequency tabs */}
        <div className="fs-recurrence-tabs" role="tablist" aria-label="Recurrence frequency">
          {(['daily', 'weekly', 'monthly', 'yearly'] as RecurrenceFreq[]).map(f => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={recFreq === f}
              className={`fs-recurrence-tab ${recFreq === f ? 'fs-recurrence-tab-active' : ''}`}
              onClick={() => setRecFreq(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Daily options */}
        {recFreq === 'daily' && (
          <div className="fs-recurrence-panel" role="tabpanel" aria-label="Daily options">
            <label className="fs-recurrence-radio-row">
              <input
                type="radio"
                name="daily-mode"
                checked={dailyMode === 'interval'}
                onChange={() => setDailyMode('interval')}
              />
              Every
              <input
                type="number"
                className="fs-recurrence-num"
                min={1}
                max={365}
                value={dailyInterval}
                onChange={e => setDailyInterval(Math.max(1, Number(e.target.value)))}
                disabled={dailyMode !== 'interval'}
                aria-label="Day interval"
              />
              day(s)
            </label>
            <label className="fs-recurrence-radio-row">
              <input
                type="radio"
                name="daily-mode"
                checked={dailyMode === 'weekdays'}
                onChange={() => setDailyMode('weekdays')}
              />
              Every weekday (Mon–Fri)
            </label>
          </div>
        )}

        {/* Weekly options */}
        {recFreq === 'weekly' && (
          <div className="fs-recurrence-panel" role="tabpanel" aria-label="Weekly options">
            <div className="fs-recurrence-inline-row">
              <span>Recur every</span>
              <input
                type="number"
                className="fs-recurrence-num"
                min={1}
                max={52}
                value={weeklyInterval}
                onChange={e => setWeeklyInterval(Math.max(1, Number(e.target.value)))}
                aria-label="Week interval"
              />
              <span>week(s) on:</span>
            </div>
            <div className="fs-weekday-picker" role="group" aria-label="Weekday selection">
              {WEEKDAYS.map(day => (
                <button
                  key={day}
                  type="button"
                  className={`fs-weekday-btn ${selectedWeekdays.includes(day) ? 'fs-weekday-btn-active' : ''}`}
                  onClick={() => toggleWeekday(day)}
                  aria-pressed={selectedWeekdays.includes(day)}
                  aria-label={day}
                >
                  {WEEKDAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Monthly options */}
        {recFreq === 'monthly' && (
          <div className="fs-recurrence-panel" role="tabpanel" aria-label="Monthly options">
            <label className="fs-recurrence-radio-row">
              <input
                type="radio"
                name="monthly-mode"
                checked={monthlyMode === 'dayOfMonth'}
                onChange={() => setMonthlyMode('dayOfMonth')}
              />
              Day
              <input
                type="number"
                className="fs-recurrence-num"
                min={1}
                max={31}
                value={monthlyDayOfMonth}
                onChange={e => setMonthlyDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
                disabled={monthlyMode !== 'dayOfMonth'}
                aria-label="Day of month"
              />
              of every
              <input
                type="number"
                className="fs-recurrence-num"
                min={1}
                max={12}
                value={monthlyInterval}
                onChange={e => setMonthlyInterval(Math.max(1, Number(e.target.value)))}
                disabled={monthlyMode !== 'dayOfMonth'}
                aria-label="Month interval"
              />
              month(s)
            </label>
            <label className="fs-recurrence-radio-row">
              <input
                type="radio"
                name="monthly-mode"
                checked={monthlyMode === 'weekdayOfMonth'}
                onChange={() => setMonthlyMode('weekdayOfMonth')}
              />
              The
              <select
                className="fs-recurrence-select"
                value={monthlyOrdinal}
                onChange={e => setMonthlyOrdinal(e.target.value)}
                disabled={monthlyMode !== 'weekdayOfMonth'}
                aria-label="Ordinal position"
              >
                {ORDINALS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                className="fs-recurrence-select"
                value={monthlyWeekday}
                onChange={e => setMonthlyWeekday(e.target.value)}
                disabled={monthlyMode !== 'weekdayOfMonth'}
                aria-label="Day of week"
              >
                {RELATIVE_DAY_OPTIONS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              of every
              <input
                type="number"
                className="fs-recurrence-num"
                min={1}
                max={12}
                value={monthlyInterval}
                onChange={e => setMonthlyInterval(Math.max(1, Number(e.target.value)))}
                disabled={monthlyMode !== 'weekdayOfMonth'}
                aria-label="Month interval"
              />
              month(s)
            </label>
          </div>
        )}

        {/* Yearly options */}
        {recFreq === 'yearly' && (
          <div className="fs-recurrence-panel" role="tabpanel" aria-label="Yearly options">
            <label className="fs-recurrence-radio-row">
              <input
                type="radio"
                name="yearly-mode"
                checked={yearlyMode === 'exact'}
                onChange={() => setYearlyMode('exact')}
              />
              Every
              <select
                className="fs-recurrence-select"
                value={yearlyMonth}
                onChange={e => setYearlyMonth(Number(e.target.value))}
                disabled={yearlyMode !== 'exact'}
                aria-label="Month"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number"
                className="fs-recurrence-num"
                min={1}
                max={31}
                value={yearlyDayOfMonth}
                onChange={e => setYearlyDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
                disabled={yearlyMode !== 'exact'}
                aria-label="Day of month"
              />
            </label>
            <label className="fs-recurrence-radio-row">
              <input
                type="radio"
                name="yearly-mode"
                checked={yearlyMode === 'relative'}
                onChange={() => setYearlyMode('relative')}
              />
              The
              <select
                className="fs-recurrence-select"
                value={yearlyOrdinal}
                onChange={e => setYearlyOrdinal(e.target.value)}
                disabled={yearlyMode !== 'relative'}
                aria-label="Ordinal position"
              >
                {ORDINALS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                className="fs-recurrence-select"
                value={yearlyWeekday}
                onChange={e => setYearlyWeekday(e.target.value)}
                disabled={yearlyMode !== 'relative'}
                aria-label="Day of week"
              >
                {RELATIVE_DAY_OPTIONS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              of
              <select
                className="fs-recurrence-select"
                value={yearlyMonth}
                onChange={e => setYearlyMonth(Number(e.target.value))}
                disabled={yearlyMode !== 'relative'}
                aria-label="Month"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Generated RRULE display */}
        {(() => {
          const rec = buildRrule(recFreq, {
            dailyMode, dailyInterval, weeklyInterval, weeklyDays: selectedWeekdays,
            monthlyMode, monthlyInterval, monthlyDayOfMonth, monthlyOrdinal, monthlyWeekday,
            yearlyMode, yearlyMonth, yearlyDayOfMonth, yearlyOrdinal, yearlyWeekday,
          });
          return rec.rrule ? (
            <div className="fs-rrule-display" aria-label="Generated RRULE">
              <code>{rec.rrule}</code>
            </div>
          ) : null;
        })()}

        {/* Excluded dates */}
        <div className="fs-exdates-section">
          <div className="fs-schedule-setup-label-row">
            <span className="fs-schedule-setup-sublabel">Excluded dates (holidays, closures)</span>
            <button
              type="button"
              className="fs-secondary-button fs-schedule-setup-preset-btn"
              onClick={addExdate}
              aria-label="Add excluded date"
            >
              + Add Date
            </button>
          </div>
          {exdates.length > 0 && (
            <div className="fs-exdate-list">
              {exdates.map((d, i) => (
                <div key={i} className="fs-exdate-row">
                  <input
                    type="date"
                    className="fs-schedule-setup-input"
                    value={d}
                    onChange={e => updateExdate(i, e.target.value)}
                    aria-label={`Excluded date ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="fs-block-remove"
                    onClick={() => removeExdate(i)}
                    aria-label={`Remove excluded date ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Time blocks */}
      <section className="fs-schedule-setup-section" aria-label="Time blocks">
        <h3 className="fs-schedule-setup-label">Time Blocks</h3>
        <div className="fs-block-list">
          {blocks.map((block, i) => (
            <div key={i} className="fs-block-row" aria-label={`Block ${i + 1}`}>
              <div className="fs-schedule-setup-field">
                <label htmlFor={`block-start-${i}`}>Start</label>
                <input
                  id={`block-start-${i}`}
                  type="time"
                  className="fs-schedule-setup-input"
                  value={block.start}
                  onChange={e => updateBlock(i, 'start', e.target.value)}
                />
              </div>
              <div className="fs-schedule-setup-field">
                <label htmlFor={`block-end-${i}`}>End</label>
                <input
                  id={`block-end-${i}`}
                  type="time"
                  className="fs-schedule-setup-input"
                  value={block.end}
                  onChange={e => updateBlock(i, 'end', e.target.value)}
                />
              </div>
              <div className="fs-schedule-setup-field">
                <label htmlFor={`block-dur-${i}`}>Duration</label>
                <select
                  id={`block-dur-${i}`}
                  className="fs-schedule-setup-input"
                  value={block.duration}
                  onChange={e => updateBlock(i, 'duration', Number(e.target.value))}
                >
                  {DURATION_OPTIONS.map(d => (
                    <option key={d} value={d}>{d} min</option>
                  ))}
                </select>
              </div>
              {/* Per-block type checkboxes */}
              {showTypes && appointmentTypes.length > 0 && (
                <div className="fs-schedule-setup-field fs-block-types">
                  <span className="fs-block-types-label">Types</span>
                  {appointmentTypes.filter(t => t.code.trim()).map(t => (
                    <label key={t.code} className="fs-block-type-check">
                      <input
                        type="checkbox"
                        checked={block.types?.includes(t.code) || false}
                        onChange={() => toggleBlockType(i, t.code)}
                      />
                      {t.code}
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="fs-block-remove"
                onClick={() => removeBlock(i)}
                aria-label={`Remove block ${i + 1}`}
                disabled={blocks.length <= 1}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="fs-secondary-button" onClick={addBlock}>
          + Add Block
        </button>
      </section>

      {/* Appointment types (collapsible) */}
      <section className="fs-schedule-setup-section" aria-label="Appointment types">
        <button
          type="button"
          className="fs-schedule-setup-toggle"
          onClick={() => setShowTypes(!showTypes)}
          aria-expanded={showTypes}
        >
          <span className={`fs-toggle-arrow ${showTypes ? 'fs-toggle-arrow-open' : ''}`}>▸</span>
          Appointment Types
          <span className="fs-schedule-setup-optional">(optional)</span>
        </button>
        {showTypes && (
          <div className="fs-type-list">
            {appointmentTypes.map((type, i) => (
              <div key={i} className="fs-type-row" aria-label={`Appointment type ${i + 1}`}>
                <div className="fs-schedule-setup-field">
                  <label htmlFor={`type-code-${i}`}>Code</label>
                  <input
                    id={`type-code-${i}`}
                    type="text"
                    className="fs-schedule-setup-input"
                    placeholder="OV"
                    value={type.code}
                    onChange={e => updateType(i, 'code', e.target.value)}
                  />
                </div>
                <div className="fs-schedule-setup-field">
                  <label htmlFor={`type-desc-${i}`}>Description</label>
                  <input
                    id={`type-desc-${i}`}
                    type="text"
                    className="fs-schedule-setup-input"
                    placeholder="Office Visit"
                    value={type.description || ''}
                    onChange={e => updateType(i, 'description', e.target.value)}
                  />
                </div>
                <div className="fs-schedule-setup-field">
                  <label htmlFor={`type-dur-${i}`}>Duration</label>
                  <select
                    id={`type-dur-${i}`}
                    className="fs-schedule-setup-input"
                    value={type.duration || 30}
                    onChange={e => updateType(i, 'duration', Number(e.target.value))}
                  >
                    {DURATION_OPTIONS.map(d => (
                      <option key={d} value={d}>{d} min</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="fs-block-remove"
                  onClick={() => removeType(i)}
                  aria-label={`Remove type ${type.code || i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="fs-secondary-button" onClick={addType}>
              + Add Type
            </button>
          </div>
        )}
      </section>

      {/* Preview */}
      {preview && (
        <section className="fs-schedule-setup-section fs-preview" aria-label="Slot preview" aria-live="polite">
          <h3 className="fs-schedule-setup-label">Preview</h3>
          <div className="fs-preview-summary">
            <strong>{preview.totalSlots.toLocaleString()}</strong> slots across{' '}
            <strong>{preview.dayCount}</strong> days
            <span className="fs-preview-detail"> ({preview.perDay} slots/day)</span>
          </div>
          {preview.totalSlots > 5000 && (
            <div className="fs-preview-warning" role="alert">
              ⚠️ Large number of slots — consider a shorter date range for better performance.
            </div>
          )}
          <div className="fs-preview-dates">
            <span className="fs-preview-dates-label">Sample dates: </span>
            {preview.sampleDates.map((d, i) => (
              <span key={i} className="fs-preview-date">{d}</span>
            ))}
          </div>
        </section>
      )}

      {/* YAML config (collapsible) */}
      <section className="fs-schedule-setup-section" aria-label="YAML configuration">
        <button
          type="button"
          className="fs-schedule-setup-toggle"
          onClick={() => setShowYaml(!showYaml)}
          aria-expanded={showYaml}
        >
          <span className={`fs-toggle-arrow ${showYaml ? 'fs-toggle-arrow-open' : ''}`}>▸</span>
          YAML Config
          <span className="fs-schedule-setup-optional">(import / export)</span>
        </button>
        {showYaml && (
          <div className="fs-yaml-section">
            <p className="fs-yaml-hint">
              Edit the YAML below and click <strong>Apply</strong> to update the form,
              or use the form above and the YAML updates automatically.
            </p>
            <textarea
              className="fs-yaml-textarea"
              value={yamlText}
              onChange={e => { setYamlText(e.target.value); setYamlError(null); }}
              spellCheck={false}
              rows={16}
              aria-label="Schedule YAML configuration"
            />
            {yamlError && (
              <div className="fs-yaml-error" role="alert">{yamlError}</div>
            )}
            <div className="fs-yaml-actions">
              <button
                type="button"
                className="fs-primary-button"
                onClick={applyYaml}
              >
                Apply YAML → Form
              </button>
              <button
                type="button"
                className="fs-secondary-button"
                onClick={() => {
                  navigator.clipboard.writeText(yamlText);
                }}
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Generate actions */}
      <section className="fs-schedule-setup-section fs-generate-actions" aria-label="Generate slots">
        <div className="fs-generate-mode" role="radiogroup" aria-label="Generation mode">
          <label className="fs-generate-mode-option">
            <input
              type="radio"
              name="generate-mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace existing free slots
          </label>
          <label className="fs-generate-mode-option">
            <input
              type="radio"
              name="generate-mode"
              value="incremental"
              checked={mode === 'incremental'}
              onChange={() => setMode('incremental')}
            />
            Keep existing, add new
          </label>
        </div>

        <button
          type="button"
          className="fs-primary-button fs-generate-btn"
          onClick={handleGenerate}
          disabled={!canGenerate}
          aria-busy={generating}
        >
          {generating ? 'Generating…' : 'Generate Slots'}
        </button>
      </section>

      {/* Result / Error messages */}
      {result && (
        <div className="fs-schedule-setup-result fs-schedule-setup-success" role="status" aria-live="polite">
          ✅ Created <strong>{result.slotsCreated.toLocaleString()}</strong> slots
          {result.slotsDeleted > 0 && (
            <span> (replaced {result.slotsDeleted.toLocaleString()} existing free slots)</span>
          )}
          {result.warnings && (
            <div className="fs-schedule-setup-warnings">⚠️ {result.warnings}</div>
          )}
        </div>
      )}
      {error && (
        <div className="fs-error-banner" role="alert" aria-live="assertive">
          {error}
        </div>
      )}
    </div>
  );
}
