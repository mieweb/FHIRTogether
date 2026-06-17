import { sha256Hex, randomHex, timingSafeEqualHex } from '../util/hash';
import * as nodeCrypto from 'crypto';

describe('hash util (cross-runtime crypto shim)', () => {
  describe('sha256Hex', () => {
    it('matches Node crypto for ASCII input', async () => {
      const expected = nodeCrypto.createHash('sha256').update('hello world').digest('hex');
      expect(await sha256Hex('hello world')).toBe(expected);
    });

    it('matches Node crypto for UTF-8 input', async () => {
      const input = 'héllo 世界 🌍';
      const expected = nodeCrypto.createHash('sha256').update(input).digest('hex');
      expect(await sha256Hex(input)).toBe(expected);
    });

    it('produces 64-char hex output', async () => {
      const hex = await sha256Hex('x');
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns the same digest for the same input', async () => {
      const a = await sha256Hex('repeatable');
      const b = await sha256Hex('repeatable');
      expect(a).toBe(b);
    });
  });

  describe('randomHex', () => {
    it('returns a hex string of length 2 * byteLength', () => {
      expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
      expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns different values across calls (with overwhelming probability)', () => {
      const a = randomHex(32);
      const b = randomHex(32);
      expect(a).not.toBe(b);
    });
  });

  describe('timingSafeEqualHex', () => {
    it('returns true for equal strings', () => {
      expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(true);
    });

    it('returns false for different strings of equal length', () => {
      expect(timingSafeEqualHex('deadbeef', 'cafebabe')).toBe(false);
    });

    it('returns false (does not throw) when lengths differ', () => {
      expect(timingSafeEqualHex('deadbeef', 'deadbeefcafe')).toBe(false);
    });

    it('returns true for the digest of the same input', async () => {
      const a = await sha256Hex('secret');
      const b = await sha256Hex('secret');
      expect(timingSafeEqualHex(a, b)).toBe(true);
    });
  });
});
