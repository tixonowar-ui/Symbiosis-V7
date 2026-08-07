import { describe, expect, it } from 'vitest';
import { ImportError } from './fail.js';
import { asArray, asNumber, asObject, asString, expectString } from './json.js';

describe('fail-closed JSON access', () => {
  it('names the path and the actual type on mismatch', () => {
    expect(() => asString(42, 'atlas', 'forms[3].id')).toThrow(
      /atlas: forms\[3\]\.id is not a string \(got number\)/,
    );
  });

  it('rejects an array where an object is expected', () => {
    expect(() => asObject([], 'atlas', 'counts')).toThrow(
      /counts is not an object \(got array\(0\)\)/,
    );
  });

  it('rejects null, which JSON allows and callers rarely handle', () => {
    expect(() => asObject(null, 'atlas', 'meta')).toThrow(/got null/);
    expect(() => asArray(null, 'atlas', 'forms')).toThrow(/got null/);
  });

  it('reports a missing field as undefined rather than throwing a TypeError', () => {
    expect(() => asArray(undefined, 'atlas', 'forms')).toThrow(
      /forms is not an array \(got undefined\)/,
    );
  });

  it('rejects NaN and Infinity, which survive JSON round-trips as numbers', () => {
    expect(() => asNumber(Number.NaN, 'atlas', 'counts.forms')).toThrow(/not a finite number/);
    expect(() => asNumber(Number.POSITIVE_INFINITY, 'atlas', 'counts.forms')).toThrow(
      /not a finite number/,
    );
  });

  it('pins exact values so a version bump cannot pass silently', () => {
    expect(expectString('1.2.0', 'atlas', 'schemaVersion', '1.2.0')).toBe('1.2.0');
    expect(() => expectString('1.3.0', 'atlas', 'schemaVersion', '1.2.0')).toThrow(
      /schemaVersion expected "1\.2\.0", got "1\.3\.0"/,
    );
  });

  it('throws ImportError so the CLI can distinguish it from a crash', () => {
    expect(() => asString(1, 'atlas', 'x')).toThrow(ImportError);
  });
});
