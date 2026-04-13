/**
 * Booking Reference Generator
 * 
 * Generates short, phonetically-distinct booking reference codes
 * designed to be read aloud over the phone using NATO phonetic alphabet.
 * 
 * Avoids ambiguous characters: 0/O, 1/I/L, 2/Z, 5/S, 8/B
 */

// Characters that are phonetically distinct when spoken aloud
const REFERENCE_CHARS = 'ACDFGHJKMNPQRTUVWXY34679';

/**
 * Generate a short booking reference code.
 * Format: "BK-XXXX" where X is from the unambiguous character set.
 * 
 * @returns A booking reference string like "BK-7X3M"
 */
export function generateBookingReference(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * REFERENCE_CHARS.length);
    code += REFERENCE_CHARS[idx];
  }
  return `BK-${code}`;
}

/**
 * NATO phonetic alphabet mapping for reading references aloud
 */
const NATO_ALPHABET: Record<string, string> = {
  'A': 'Alpha', 'B': 'Bravo', 'C': 'Charlie', 'D': 'Delta',
  'E': 'Echo', 'F': 'Foxtrot', 'G': 'Golf', 'H': 'Hotel',
  'I': 'India', 'J': 'Juliet', 'K': 'Kilo', 'L': 'Lima',
  'M': 'Mike', 'N': 'November', 'O': 'Oscar', 'P': 'Papa',
  'Q': 'Quebec', 'R': 'Romeo', 'S': 'Sierra', 'T': 'Tango',
  'U': 'Uniform', 'V': 'Victor', 'W': 'Whiskey', 'X': 'X-ray',
  'Y': 'Yankee', 'Z': 'Zulu',
  '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four',
  '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Niner',
  '-': 'Dash',
};

/**
 * Convert a booking reference to NATO phonetic spelling for reading aloud.
 * 
 * @param reference - The booking reference (e.g., "BK-7X3M")
 * @returns NATO phonetic spelling (e.g., "Bravo Kilo Dash Seven X-ray Three Mike")
 */
export function referenceToNato(reference: string): string {
  return reference
    .toUpperCase()
    .split('')
    .map(char => NATO_ALPHABET[char] || char)
    .join(' ');
}
