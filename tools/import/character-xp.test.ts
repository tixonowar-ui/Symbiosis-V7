/**
 * The XP runtime contract is the artifact ADR 0004 was written from, so these
 * tests double as a guard on that ADR: if the delivery changes the FREE
 * multiplier or makes an award reversible, they fail here and the decision has
 * to be revisited rather than quietly diverging from its source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAdr0004 } from './character-xp.js';
import { ImportError } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { SPEC_DIR, TYPES_DIR } from './lib/paths.js';

const section = <T>(name: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'character', 'xp-runtime', name), 'utf8')) as T;

describe('XP runtime sections', () => {
  it('splits the sheet into all nine sections at their declared sizes', () => {
    expect(section<unknown[]>('progression-routes.json')).toHaveLength(3);
    expect(section<unknown[]>('event-points.json')).toHaveLength(7);
    expect(section<unknown[]>('roll-kinds.json')).toHaveLength(11);
    expect(section<unknown[]>('never-sources.json')).toHaveLength(8);
    expect(section<unknown[]>('race-multipliers.json')).toHaveLength(3);
    expect(section<unknown[]>('suppression.json')).toHaveLength(3);
    expect(section<unknown[]>('xp-event-fields.json')).toHaveLength(19);
    expect(section<unknown[]>('gm-direct-policy.json')).toHaveLength(1);
    expect(section<unknown[]>('gm-award-fields.json')).toHaveLength(11);
  });

  it('reads sections H and I, whose titles are not spread across the row', () => {
    // A–G write their title into every column; H and I only into the first. A
    // shape-based reader drops these two without complaining.
    const gm = section<{ PolicyID: string }[]>('gm-direct-policy.json');
    expect(gm[0]?.PolicyID).toBe('GM_DIRECT_SYMBIONT_XP');
    const fields = section<{ Field: string }[]>('gm-award-fields.json');
    expect(fields.map((f) => f.Field)).toContain('awardId');
  });

  it('keeps numeric cells numeric rather than stringifying them', () => {
    const free = section<{ RaceCode: string; DirectXpMultiplier: number }[]>(
      'race-multipliers.json',
    ).find((r) => r.RaceCode === 'FREE');
    expect(free?.DirectXpMultiplier).toBe(2);
    expect(typeof free?.DirectXpMultiplier).toBe('number');
  });
});

describe('ADR 0004 invariants, checked against their source', () => {
  it('gives FREE a direct XP multiplier of 2 and the others 1', () => {
    const races =
      section<{ RaceCode: string; DirectXpMultiplier: number }[]>('race-multipliers.json');
    const byCode = new Map(races.map((r) => [r.RaceCode, r.DirectXpMultiplier]));
    expect(byCode.get('FREE')).toBe(2);
    expect(byCode.get('PURE')).toBe(1);
    expect(byCode.get('UNITED')).toBe(1);
  });

  it('states that a committed award has no inverse command', () => {
    const immutable = section<{ Field: string; 'Validation / constraint': string }[]>(
      'gm-award-fields.json',
    ).find((f) => f.Field === 'immutable');
    expect(immutable?.['Validation / constraint']).toContain('no inverse command');
  });

  it('makes awardId idempotent on exact retry (RTC-002)', () => {
    const awardId = section<{ Field: string; 'Validation / constraint': string }[]>(
      'gm-award-fields.json',
    ).find((f) => f.Field === 'awardId');
    expect(awardId?.['Validation / constraint']).toContain('exact retry only');
  });

  it('routes every never-progression source away from XP (RTC-004)', () => {
    const never =
      section<{ ProgressionRoute: string; CreatesXPOrPoints: boolean }[]>('never-sources.json');
    expect(never.every((n) => n.ProgressionRoute === 'NEVER_PROGRESSION')).toBe(true);
    expect(never.some((n) => n.CreatesXPOrPoints === true)).toBe(false);
  });
});

describe('the ADR 0004 guard actually fires', () => {
  const races = (multiplier: number): JsonObject[] => [
    { RaceCode: 'FREE', DirectXpMultiplier: multiplier },
  ];
  const award = (constraint: string): JsonObject[] => [
    { Field: 'immutable', 'Validation / constraint': constraint },
  ];
  const build = (m: number, c: string): ReadonlyMap<string, JsonObject[]> =>
    new Map([
      ['E. Race multipliers', races(m)],
      ['I. MasterSymbiontXpAward fields', award(c)],
    ]);

  it('accepts the values the artifact currently states', () => {
    expect(() => {
      assertAdr0004(build(2, 'Always true; no inverse command'));
    }).not.toThrow();
  });

  it('refuses a changed FREE multiplier and points at the ADR', () => {
    expect(() => {
      assertAdr0004(build(3, 'Always true; no inverse command'));
    }).toThrow(/FREE DirectXpMultiplier is "3", but ADR 0004 records 2/);
  });

  it('refuses an award that stops being irreversible', () => {
    expect(() => {
      assertAdr0004(build(2, 'Reversible by GM'));
    }).toThrow(/no longer states "no inverse command"/);
  });

  it('refuses a missing row rather than passing vacuously', () => {
    expect(() => {
      assertAdr0004(new Map());
    }).toThrow(ImportError);
  });
});

describe('generated XP types', () => {
  const source = readFileSync(join(TYPES_DIR, 'character-xp.ts'), 'utf8');

  it('exposes the three progression routes', () => {
    expect(source).toContain('"DIRECT_SYMBIONT"');
    expect(source).toContain('"CHARACTER_PROGRESS_COUNTER"');
    expect(source).toContain('"NEVER_PROGRESSION"');
  });

  it('is marked generated and uses LF endings', () => {
    expect(source.startsWith('// Generated by tools/import.')).toBe(true);
    expect(source).not.toContain('\r\n');
  });
});
