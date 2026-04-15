/**
 * Booking Reference Generator
 * Generates human-readable booking references for appointments
 */

const ADJECTIVES = [
  'happy', 'sunny', 'gentle', 'bright', 'calm', 'kind', 'warm', 'swift',
  'quiet', 'bold', 'fresh', 'lucky', 'noble', 'proud', 'wise', 'brave',
  'cool', 'fair', 'free', 'glad', 'keen', 'neat', 'pure', 'true'
];

const NOUNS = [
  'oak', 'river', 'bird', 'star', 'moon', 'cloud', 'leaf', 'wave',
  'hill', 'lake', 'pine', 'rose', 'wind', 'sun', 'sky', 'fox',
  'deer', 'bear', 'hawk', 'wolf', 'lion', 'swan', 'dove', 'owl'
];

/**
 * Generate a human-readable booking reference
 * Format: adjective-noun-number (e.g., "happy-oak-4821")
 */
export function generateBookingReference(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(1000 + Math.random() * 9000); // 4-digit number
  
  return `${adjective}-${noun}-${number}`;
}

/**
 * The system identifier for booking references
 */
export const BOOKING_REFERENCE_SYSTEM = 'urn:booking-reference';

/**
 * Create a FHIR Identifier for a booking reference
 */
export function createBookingReferenceIdentifier(reference?: string): {
  system: string;
  value: string;
} {
  return {
    system: BOOKING_REFERENCE_SYSTEM,
    value: reference || generateBookingReference(),
  };
}

/**
 * Validate a booking reference format
 */
export function isValidBookingReference(reference: string): boolean {
  // Format: word-word-number (e.g., happy-oak-4821)
  const pattern = /^[a-z]+-[a-z]+-\d{4}$/;
  return pattern.test(reference);
}
