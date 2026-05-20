/**
 * Cross-runtime crypto helpers.
 *
 * Works on both Node.js (uses `node:crypto`) and Cloudflare Workers
 * (uses WebCrypto / `globalThis.crypto.subtle`). All public functions
 * are async-friendly so the API is identical across runtimes.
 *
 * Why this exists: `src/store/sqliteStore.ts` used Node's `crypto.createHash`
 * / `crypto.randomBytes` / `crypto.timingSafeEqual`. Those APIs don't
 * exist on Workers. The D1 store and any other Workers-bound code uses
 * this module instead.
 */

/**
 * Convert a byte array to a lowercase hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Compute the SHA-256 of a UTF-8 string and return it as a lowercase hex digest.
 *
 * Equivalent to: `crypto.createHash('sha256').update(input).digest('hex')`
 * — but works on Workers via `crypto.subtle.digest`.
 */
interface MinimalSubtle {
  digest(algorithm: string, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer>;
}
interface MinimalCrypto {
  subtle?: MinimalSubtle;
  getRandomValues?<T extends ArrayBufferView>(array: T): T;
}

export async function sha256Hex(input: string): Promise<string> {
  // Prefer WebCrypto when available (works on Workers AND modern Node ≥ 16).
  // Fall back to node:crypto only if subtle is unavailable.
  const subtle = (globalThis as { crypto?: MinimalCrypto }).crypto?.subtle;
  if (subtle) {
    const data = new TextEncoder().encode(input);
    const buf = await subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(buf));
  }
  // Node fallback (shouldn't be reached on Node ≥ 16 either, but defensive).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  return nodeCrypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Generate `byteLength` cryptographically-random bytes and return as a
 * lowercase hex string of length `byteLength * 2`.
 *
 * Equivalent to: `crypto.randomBytes(n).toString('hex')`.
 */
export function randomHex(byteLength: number): string {
  const buf = new Uint8Array(byteLength);
  const webCrypto = (globalThis as { crypto?: MinimalCrypto }).crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(buf);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    const nodeBuf = nodeCrypto.randomBytes(byteLength);
    return nodeBuf.toString('hex');
  }
  return bytesToHex(buf);
}

/**
 * Constant-time comparison of two equal-length hex strings.
 *
 * Equivalent to: `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`
 * but works on Workers (no `Buffer`) and is forgiving of length mismatch
 * (returns `false` instead of throwing).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
