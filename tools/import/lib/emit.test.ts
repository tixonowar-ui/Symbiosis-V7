import { describe, expect, it } from 'vitest';
import { stringify, tsUnion } from './emit.js';

describe('stringify', () => {
  it('sorts object keys so output does not depend on insertion order', () => {
    const a = stringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = stringify({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order, which carries meaning in the atlas', () => {
    expect(stringify(['b', 'a'])).toContain('[\n  "b",\n  "a"\n]');
  });

  it('ends with a single newline', () => {
    expect(stringify({ a: 1 })).toMatch(/}\n$/);
  });

  it('does not emit anything run-dependent', () => {
    const first = stringify({ forms: [{ id: 'APP-001' }] });
    const second = stringify({ forms: [{ id: 'APP-001' }] });
    expect(first).toBe(second);
  });
});

describe('tsUnion', () => {
  it('renders a union of string literals', () => {
    expect(tsUnion('Role', ['gm', 'player'])).toBe('export type Role =\n  | "gm"\n  | "player";\n');
  });

  it('collapses an empty set to never rather than to an any-like type', () => {
    expect(tsUnion('Empty', [])).toBe('export type Empty = never;\n');
  });

  it('escapes members that need quoting', () => {
    expect(tsUnion('Guard', ['scene/phase'])).toContain('"scene/phase"');
  });
});
