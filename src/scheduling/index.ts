/**
 * Scheduling Module — availability template parsing and slot expansion.
 */
export {
  parseSlotYAML,
  validateTemplate,
  expandSlots,
} from './slotExpander';

export type {
  AvailabilityTemplate,
  AvailabilityBlock,
  AppointmentTypeDefinition,
  ExpandResult,
} from './slotExpander';
