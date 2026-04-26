/**
 * Server-side Slot Expansion Engine
 *
 * Parses YAML availability templates and expands them into FHIR Slot resources.
 * This is the single source of truth for schedule→slot expansion, used by:
 *   - POST /Schedule/:id/$generate-slots  (server API)
 *   - generateBusyOffice.ts               (test data generator)
 *
 * The YAML format is FHIRTogether's proprietary availability-template extension,
 * filling a gap in FHIR R4/R5 where no standard exists for recurrence rules on
 * Schedule resources. See docs/scheduling-models.md for the full specification.
 */

import { Slot, CodeableConcept } from '../types/fhir';

// ==================== TYPES ====================

export interface AppointmentTypeDefinition {
  code: string;
  description?: string;
  duration?: number;
}

export interface AvailabilityBlock {
  start: string;            // "08:00" (24h)
  end: string;              // "12:00" (24h)
  duration: number;         // minutes per slot
  types?: string[];         // allowed appointment type codes
  overbook?: number;        // max concurrent overbookings (0 = none)
}

export interface AvailabilityTemplate {
  startDate: string;        // "2026-05-01"
  endDate: string;          // "2026-10-28"
  weekdays: string[];       // ["mon", "tue", "wed", "thu", "fri"]
  appointmentTypes?: AppointmentTypeDefinition[];
  blocks: AvailabilityBlock[];
}

export interface ExpandResult {
  slots: Omit<Slot, 'id' | 'meta'>[];
  warnings: string[];
}

// ==================== YAML PARSER ====================

/**
 * Minimal YAML-ish parser for the slot definition format.
 * Supports: key: "value", key: [a, b, c], nested blocks with - start/end/duration,
 * appointmentTypes list, and per-block overbook/types fields.
 */
export function parseSlotYAML(text: string): AvailabilityTemplate {
  const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const result: Record<string, unknown> = { blocks: [], appointmentTypes: [] };
  let section: 'blocks' | 'appointmentTypes' | null = null;
  let currentItem: Record<string, unknown> | null = null;

  function flushItem(): void {
    if (!currentItem) return;
    if (section === 'blocks') (result.blocks as Record<string, unknown>[]).push(currentItem);
    else if (section === 'appointmentTypes') (result.appointmentTypes as Record<string, unknown>[]).push(currentItem);
    currentItem = null;
  }

  function parseValue(raw: string): string | string[] {
    // Strip inline comments (# not inside quotes)
    const val = raw.replace(/\s+#.*$/, '').trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      return val.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    }
    return val.replace(/^"(.*)"$/, '$1');
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'blocks:') { flushItem(); section = 'blocks'; continue; }
    if (trimmed === 'appointmentTypes:') { flushItem(); section = 'appointmentTypes'; continue; }

    if (section) {
      if (trimmed.startsWith('- ')) {
        flushItem();
        currentItem = {};
        const kv = trimmed.slice(2).trim();
        const m = kv.match(/^(\w+):\s*(.+?)\s*(?:#.*)?$/);
        if (m) currentItem[m[1]] = parseValue(m[2]);
      } else if (trimmed.match(/^\w+:/) && currentItem) {
        const m = trimmed.match(/^(\w+):\s*(.+?)\s*(?:#.*)?$/);
        if (m) currentItem[m[1]] = parseValue(m[2]);
      } else if (!trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
        flushItem();
        section = null;
      }
    }

    if (!section) {
      const kvMatch = trimmed.match(/^(\w+):\s*(.+)/);
      if (kvMatch) {
        result[kvMatch[1]] = parseValue(kvMatch[2]);
      }
    }
  }
  flushItem();

  // Normalize weekdays to lowercase
  if (Array.isArray(result.weekdays)) {
    result.weekdays = (result.weekdays as string[]).map(d => d.toLowerCase());
  }

  return result as unknown as AvailabilityTemplate;
}

// ==================== VALIDATION ====================

const VALID_WEEKDAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTemplate(template: AvailabilityTemplate): string[] {
  const errors: string[] = [];

  if (!template.startDate || !DATE_RE.test(template.startDate)) {
    errors.push('startDate is required and must be YYYY-MM-DD');
  }
  if (!template.endDate || !DATE_RE.test(template.endDate)) {
    errors.push('endDate is required and must be YYYY-MM-DD');
  }
  if (template.startDate && template.endDate && template.startDate > template.endDate) {
    errors.push('startDate must be before or equal to endDate');
  }

  if (!Array.isArray(template.weekdays) || template.weekdays.length === 0) {
    errors.push('weekdays is required and must be a non-empty array');
  } else {
    for (const day of template.weekdays) {
      if (!VALID_WEEKDAYS.has(day.toLowerCase())) {
        errors.push(`Invalid weekday: "${day}". Must be one of: ${[...VALID_WEEKDAYS].join(', ')}`);
      }
    }
  }

  if (!Array.isArray(template.blocks) || template.blocks.length === 0) {
    errors.push('blocks is required and must be a non-empty array');
  } else {
    for (let i = 0; i < template.blocks.length; i++) {
      const block = template.blocks[i];
      const prefix = `blocks[${i}]`;

      if (!block.start || !TIME_RE.test(block.start)) {
        errors.push(`${prefix}.start is required and must be HH:MM`);
      }
      if (!block.end || !TIME_RE.test(block.end)) {
        errors.push(`${prefix}.end is required and must be HH:MM`);
      }
      if (block.start && block.end && block.start >= block.end) {
        errors.push(`${prefix}.start must be before ${prefix}.end`);
      }

      const duration = parseInt(String(block.duration), 10);
      if (!duration || duration < 1 || duration > 480) {
        errors.push(`${prefix}.duration must be 1–480 minutes`);
      }

      if (block.overbook !== undefined) {
        const ob = parseInt(String(block.overbook), 10);
        if (isNaN(ob) || ob < 0) {
          errors.push(`${prefix}.overbook must be a non-negative integer`);
        }
      }
    }
  }

  // Validate appointment type codes referenced by blocks exist in definitions
  if (template.appointmentTypes && template.appointmentTypes.length > 0) {
    const definedCodes = new Set(template.appointmentTypes.map(t => t.code));
    for (let i = 0; i < (template.blocks || []).length; i++) {
      const block = template.blocks[i];
      if (block.types) {
        for (const code of block.types) {
          if (!definedCodes.has(code)) {
            errors.push(`blocks[${i}].types references undefined appointment type "${code}"`);
          }
        }
      }
    }
  }

  return errors;
}

// ==================== SLOT EXPANSION ====================

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const MAX_SLOTS = 50000;

/**
 * Expand an availability template into individual FHIR Slot resource bodies.
 *
 * Returns slots with optional appointmentType, overbooked, and serviceType
 * fields based on the template's appointmentTypes and block config.
 */
export function expandSlots(
  template: AvailabilityTemplate,
  scheduleRef: string,
): ExpandResult {
  const warnings: string[] = [];
  const weekdayNums = (template.weekdays || ['mon', 'tue', 'wed', 'thu', 'fri'])
    .map(d => DAY_MAP[d.toLowerCase()]);
  const startDate = new Date(template.startDate + 'T00:00:00');
  const endDate = new Date(template.endDate + 'T00:00:00');
  const slots: Omit<Slot, 'id' | 'meta'>[] = [];

  // Build lookup for appointment types by code
  const typeMap = new Map<string, AppointmentTypeDefinition>();
  for (const t of (template.appointmentTypes || [])) {
    typeMap.set(t.code, t);
  }

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    if (!weekdayNums.includes(d.getDay())) continue;
    const dateStr = d.toISOString().slice(0, 10);

    for (const block of template.blocks) {
      const duration = parseInt(String(block.duration), 10) || 30;
      const overbook = parseInt(String(block.overbook), 10);
      const [startH, startM] = block.start.split(':').map(Number);
      const [endH, endM] = block.end.split(':').map(Number);
      const blockStartMin = startH * 60 + startM;
      const blockEndMin = endH * 60 + endM;

      // Determine allowed appointment types for this block
      const blockTypes = Array.isArray(block.types) ? block.types : null;

      for (let min = blockStartMin; min + duration <= blockEndMin; min += duration) {
        if (slots.length >= MAX_SLOTS) {
          warnings.push(`Slot limit (${MAX_SLOTS}) reached — expansion stopped early`);
          return { slots, warnings };
        }

        const slotStart = `${dateStr}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}:00`;
        const slotEnd = `${dateStr}T${pad2(Math.floor((min + duration) / 60))}:${pad2((min + duration) % 60)}:00`;

        const slot: Omit<Slot, 'id' | 'meta'> = {
          resourceType: 'Slot',
          schedule: { reference: scheduleRef },
          status: 'free',
          start: slotStart,
          end: slotEnd,
        };

        // Add appointmentType from first allowed type if defined
        if (blockTypes && blockTypes.length > 0) {
          const primary = typeMap.get(blockTypes[0]);
          if (primary) {
            slot.appointmentType = { text: primary.description || primary.code };
          }
          // Store all allowed types as serviceType
          slot.serviceType = blockTypes
            .map(code => {
              const t = typeMap.get(code);
              return t ? { text: t.description || code } as CodeableConcept : { text: code } as CodeableConcept;
            });
        }

        // Add overbooking if configured
        if (overbook > 0) {
          slot.overbooked = false; // Not yet overbooked, but allows it
          slot.comment = `overbook:${overbook}`;
        }

        slots.push(slot);
      }
    }
  }

  if (slots.length >= 5000) {
    warnings.push(`Generated ${slots.length} slots — consider a shorter date range for better performance`);
  }

  return { slots, warnings };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
