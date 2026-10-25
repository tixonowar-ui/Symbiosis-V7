import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MechanicalRoll } from '../../src/domain/entities/roll-request/roll-model.js';
import {
  createSymbiontCatalog,
  type SymbiontCatalogSources,
  type SymbioticMonsterSpeciesKey,
} from '../../src/domain/rules/symbiont-stage/catalog.js';
import type { RandomSymbiontPhysicalRoll } from '../../src/domain/rules/symbiont-stage/random-sequence.js';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}/${path}`, 'utf8')) as unknown;
}

export function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError(`${label}[${String(index)}] must be an object`);
    }
    return entry as Record<string, unknown>;
  });
}

export const RAW = Object.freeze({
  dictionaries: readJson('generated/spec/character/dictionaries.json'),
  stats: readJson('generated/spec/character/stats.json'),
  races: readJson('generated/spec/character/races.json'),
  classes: readJson('generated/spec/character/classes.json'),
  skills: readJson('generated/spec/character/skills.json'),
  requirements: readJson('generated/spec/character/skill-requirements.json'),
  modifiers: readJson('generated/spec/character/modifiers.json'),
  symbionts: readJson('generated/spec/character/symbionts.json'),
  incompatibilities: readJson('generated/spec/character/incompatibilities.json'),
});
export const RAW_SYMBIONTS = rows(RAW.symbionts, 'symbionts');
export const RAW_MODIFIERS = rows(RAW.modifiers, 'modifiers');
export const CATALOG = createSymbiontCatalog(RAW);

export function cloneSources(): SymbiontCatalogSources {
  return structuredClone(RAW);
}

export function mutateSources(
  table: keyof SymbiontCatalogSources,
  change: (entries: Record<string, unknown>[]) => void,
): SymbiontCatalogSources {
  const sources = cloneSources();
  const original = sources[table];
  const entries = rows(original, table);
  change(entries);
  if (!Array.isArray(original)) throw new TypeError(`${table} must be an array`);
  if (entries.length !== original.length) Object.assign(sources, { [table]: entries });
  return sources;
}

export function d20(rawFace: number): MechanicalRoll {
  return { dieSides: 20, rawFace };
}

export function origin(face: number, id: string): RandomSymbiontPhysicalRoll {
  return {
    kind: 'SPECIES_ORIGIN',
    rollRequestId: `${id}-request`,
    rollReceiptId: `${id}-receipt`,
    mechanical: d20(face),
  };
}

export function confirmation(
  originRollRequestId: string,
  face: number,
  id: string,
  selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null = null,
): RandomSymbiontPhysicalRoll {
  return {
    kind: 'CRITICAL_CONFIRMATION',
    originRollRequestId,
    selectedMonsterSpeciesKeyOrNull,
    rollRequestId: `${id}-request`,
    rollReceiptId: `${id}-receipt`,
    mechanical: d20(face),
  };
}

export function advisorRoll(
  kind: 'ADVISOR_I' | 'ADVISOR_W',
  advisorAcceptedIndex: number,
  face: number,
  id: string,
): RandomSymbiontPhysicalRoll {
  return {
    kind,
    advisorAcceptedIndex,
    rollRequestId: `${id}-request`,
    rollReceiptId: `${id}-receipt`,
    mechanical: d20(face),
  };
}

export function suppressionRoll(
  advisorAcceptedIndex: number,
  face: number,
  id: string,
): RandomSymbiontPhysicalRoll {
  return {
    kind: 'TROGR_SUPPRESSION_B',
    advisorAcceptedIndex,
    rollRequestId: `${id}-request`,
    rollReceiptId: `${id}-receipt`,
    mechanical: d20(face),
  };
}
