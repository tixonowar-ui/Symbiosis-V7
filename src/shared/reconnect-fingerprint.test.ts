import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reconnectFingerprint } from './reconnect-fingerprint.js';

const sha256 = (canonical: string) => createHash('sha256').update(canonical, 'utf8').digest('hex');

describe('shared reconnect fingerprint', () => {
  it('matches Node SHA-256 for canonical UTF-8, escaped text, numbers and arrays', () => {
    for (const input of [null, true, 0, -0, 1e-8, '', 'Ёж 🧬\n"\\', [1, null, ['я', false]]]) {
      expect(reconnectFingerprint(input)).toBe(sha256(JSON.stringify(input)));
    }
  });

  it('orders object keys by code unit at every level and preserves array order', () => {
    const one = { z: { '2': 'два', '10': 'десять' }, a: [{ я: 0, a: 1 }, '🦊'] };
    const two = { a: [{ a: 1, я: 0 }, '🦊'], z: { '10': 'десять', '2': 'два' } };
    const expected = sha256('{"a":[{"a":1,"я":0},"🦊"],"z":{"10":"десять","2":"два"}}');
    expect(reconnectFingerprint(one)).toBe(expected);
    expect(reconnectFingerprint(two)).toBe(expected);
    expect(reconnectFingerprint({ ...two, a: [...two.a].reverse() })).not.toBe(expected);
  });

  it('hashes the null-prototype records returned by the wire decoder', () => {
    const record = Object.assign(Object.create(null) as Record<string, unknown>, { nested: 'ёж' });
    expect(reconnectFingerprint({ entry: record })).toBe(sha256('{"entry":{"nested":"ёж"}}'));
  });

  it('matches Node SHA-256 at the length field and full-block boundaries', () => {
    for (const byteLength of [55, 56, 63, 64, 65, 119, 120, 128, 129, 4097]) {
      const value = 'x'.repeat(byteLength - 2);
      expect(reconnectFingerprint(value)).toBe(sha256(JSON.stringify(value)));
    }
  });

  it('rejects non-JSON data and cycles, and accepts repeated ordinary JSON values', () => {
    const circular: unknown[] = [];
    circular.push(circular);
    for (const input of [
      undefined,
      { a: undefined },
      NaN,
      Infinity,
      2n,
      new Date(0),
      Array<unknown>(1),
      circular,
    ]) {
      expect(() => reconnectFingerprint(input)).toThrow(TypeError);
    }
    const shared = { a: 1 };
    expect(reconnectFingerprint([shared, shared])).toBe(sha256('[{"a":1},{"a":1}]'));
  });
});
