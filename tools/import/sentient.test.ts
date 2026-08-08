/**
 * Pinned against the registry passport (44 templates = 12 pure + 16 free +
 * 16 united, 44 arts, 1195 checks) and the audit (CHK-012 44 templates,
 * CHK-013 50 pack files).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportError } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { MEDIA_DIR, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { assertAdr0007Contract, assertTemplateInvariants } from './sentient.js';

const spec = <T>(name: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'sentient', name), 'utf8')) as T;

interface Art {
  ArtAssetID: string;
  SystemTemplateID: string;
  'Runtime-файл': string;
  'SHA-256 PNG': string;
}

interface Template {
  SystemTemplateID: string;
  Race: string;
  ActorType: string;
  ProgressionPolicy: string;
  Immutable: boolean | string;
}

const templates = spec<Template[]>('templates.json');
const arts = spec<Art[]>('arts.json');

describe('generated sentient spec', () => {
  it('carries 44 frozen templates (CHK-012)', () => {
    expect(templates).toHaveLength(44);
    expect(new Set(templates.map((t) => t.SystemTemplateID)).size).toBe(44);
  });

  it('splits templates 12 pure / 16 free / 16 united, as the passport states', () => {
    // The split is by Race. "Группа" is a finer breakdown — 4 stalkers,
    // 5 soldiers, 3 seekers and so on — and does not sum to the passport's three.
    const byRace = new Map<string, number>();
    for (const t of templates) byRace.set(t.Race, (byRace.get(t.Race) ?? 0) + 1);
    expect(byRace.get('PURE')).toBe(12);
    expect(byRace.get('FREE')).toBe(16);
    expect(byRace.get('UNITED')).toBe(16);
  });

  it('states the progression invariants on every template, not just in the summary', () => {
    expect(templates.filter((t) => t.ActorType !== 'SYSTEM_SENTIENT_ENEMY')).toEqual([]);
    expect(templates.filter((t) => t.ProgressionPolicy !== 'NO_XP_PROGRESSION')).toEqual([]);
    expect(templates.filter((t) => String(t.Immutable) !== 'true')).toEqual([]);
  });

  it('carries the remaining sheets at their declared sizes', () => {
    expect(spec<unknown[]>('stats.json')).toHaveLength(44);
    expect(spec<unknown[]>('skills.json')).toHaveLength(93);
    expect(spec<unknown[]>('symbionts.json')).toHaveLength(71);
    expect(spec<unknown[]>('equipment.json')).toHaveLength(169);
    expect(spec<unknown[]>('qa.json')).toHaveLength(1195);
    expect(spec<unknown[]>('payloads.json')).toHaveLength(44);
  });

  it('points every dependent row at a known template', () => {
    const ids = new Set(templates.map((t) => t.SystemTemplateID));
    for (const file of ['stats.json', 'skills.json', 'symbionts.json', 'equipment.json']) {
      const rows = spec<{ SystemTemplateID: string }[]>(file);
      expect(rows.filter((r) => !ids.has(r.SystemTemplateID))).toEqual([]);
    }
  });

  it('records that the pack was accepted on forward compatibility', () => {
    const meta = spec<{
      packFiles: number;
      packBuiltAgainst: string;
      forwardCompatibilityAsserted: boolean;
    }>('meta.json');
    expect(meta.packFiles).toBe(50);
    expect(meta.forwardCompatibilityAsserted).toBe(true);
    // Deliberately older than the current line — see ADR 0007. Requiring an
    // exact tuple match would reject a valid frozen pack.
    expect(meta.packBuiltAgainst).toContain('Rules v1.6');
    expect(meta.packBuiltAgainst).toContain('Bestiary v1.3');
  });
});

describe('extracted sentient arts', () => {
  const dir = join(MEDIA_DIR, 'sentient');
  const files = readdirSync(dir);

  it('writes one art per template', () => {
    expect(arts).toHaveLength(44);
    expect(files).toHaveLength(44);
  });

  it('matches the SHA-256 the registry declares for every file', () => {
    // The bytes come from the frozen pack; the digest comes from the registry.
    // Two artifacts agreeing is the whole basis for accepting a frozen pack.
    for (const art of arts) {
      const bytes = readFileSync(join(dir, art['Runtime-файл']));
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest).toBe(art['SHA-256 PNG'].toLowerCase());
    }
  });

  it('writes real PNG bytes', () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const file of files) {
      expect(readFileSync(join(dir, file)).subarray(0, 8).equals(signature)).toBe(true);
    }
  });
});

describe('ADR 0007 contract, checked against its source', () => {
  const contract = spec<{ ContractKey: string; 'Нормативное значение': string }[]>('contract.json');
  const value = (key: string): string | undefined =>
    contract.find((c) => c.ContractKey === key)?.['Нормативное значение'];

  it('keeps sentient enemies out of progression (RTC-011)', () => {
    expect(value('actorType')).toBe('SYSTEM_SENTIENT_ENEMY');
    expect(value('progressionPolicy')).toBe('NO_XP_PROGRESSION');
  });

  it('prohibits the progression fields a player character carries', () => {
    expect(value('symbiontXpProgressPoints')).toBe('PROHIBITED_FIELD');
    expect(value('unallocatedSymbiontXp')).toBe('PROHIBITED_FIELD');
  });
});

describe('the ADR 0007 guard actually fires', () => {
  const row = (key: string, value: string): JsonObject => ({
    ContractKey: key,
    'Нормативное значение': value,
  });
  const good = (): JsonObject[] => [
    row('actorType', 'SYSTEM_SENTIENT_ENEMY'),
    row('progressionPolicy', 'NO_XP_PROGRESSION'),
    row('symbiontXpProgressPoints', 'PROHIBITED_FIELD'),
    row('unallocatedSymbiontXp', 'PROHIBITED_FIELD'),
  ];

  it('accepts the contract the artifact currently declares', () => {
    expect(() => {
      assertAdr0007Contract(good());
    }).not.toThrow();
  });

  it('refuses if progression is switched on', () => {
    const rows = good();
    rows[1] = row('progressionPolicy', 'XP_ENABLED');
    expect(() => {
      assertAdr0007Contract(rows);
    }).toThrow(/excluded from progression/);
  });

  it('refuses if a prohibited field becomes allowed', () => {
    const rows = good();
    rows[2] = row('symbiontXpProgressPoints', 'ALLOWED');
    expect(() => {
      assertAdr0007Contract(rows);
    }).toThrow(/expected "PROHIBITED_FIELD"/);
  });

  it('refuses a missing contract key rather than passing vacuously', () => {
    expect(() => {
      assertAdr0007Contract([]);
    }).toThrow(ImportError);
  });

  it('refuses a single template that drifts, even if the summary is clean', () => {
    expect(() => {
      assertTemplateInvariants([
        {
          SystemTemplateID: 'SENT-OK',
          ActorType: 'SYSTEM_SENTIENT_ENEMY',
          ProgressionPolicy: 'NO_XP_PROGRESSION',
          Immutable: true,
        },
        {
          SystemTemplateID: 'SENT-DRIFTED',
          ActorType: 'SYSTEM_SENTIENT_ENEMY',
          ProgressionPolicy: 'XP_ENABLED',
          Immutable: true,
        },
      ]);
    }).toThrow(/SENT-DRIFTED: ProgressionPolicy is "XP_ENABLED"/);
  });
});

describe('generated sentient types', () => {
  const source = readFileSync(join(TYPES_DIR, 'sentient.ts'), 'utf8');

  it('emits a SystemTemplateId per frozen template', () => {
    const union = /export type SystemTemplateId =\n((?: {2}\| "[^"]+";?\n)+)/.exec(source);
    expect(union).not.toBeNull();
    expect(union![1]!.trimEnd().split('\n')).toHaveLength(44);
  });

  it('is marked generated and uses LF endings', () => {
    expect(source.startsWith('// Generated by tools/import.')).toBe(true);
    expect(source).not.toContain('\r\n');
  });
});
