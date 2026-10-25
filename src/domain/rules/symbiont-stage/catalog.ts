import type { RaceCode, StatCode } from '@generated/types/character.js';

import {
  createSkillStageCatalog,
  type SkillStageCatalog,
  type SkillStageCatalogSources,
  type StatModifierDefinition,
} from '../skill-stage/catalog.js';

/** Exact face order from CORE-169. */
export const CORE_169_SPECIES_BY_FACE = Object.freeze([
  'WEAVER',
  'TAIPAN',
  'OWL',
  'TEACHER',
  'ARMADILLO',
  'DRAGON',
  'TROGR',
  'KEEPER',
  'ADVISER',
  'TICK',
  'CRICKET',
  'SPIDER',
  'CHAMELEON',
  'PENGUIN',
  'EEL',
  'TOAD',
  'RAT',
  'DOLPHIN',
  'MANTIS',
  'SKUNK',
] as const);
export const SYMBIOTIC_MONSTER_SPECIES_KEYS = Object.freeze([
  'CHIMERA',
  'PUPPETEER',
  'PLAGUE_DOCTOR',
] as const);
export const RANDOM_SYMBIONT_RACE_CODES = Object.freeze(['FREE', 'UNITED'] as const);
export const SYMBIONT_SIDES = Object.freeze(['LEFT', 'RIGHT'] as const);

export type Core169SpeciesKey = (typeof CORE_169_SPECIES_BY_FACE)[number];
export type SymbioticMonsterSpeciesKey = (typeof SYMBIOTIC_MONSTER_SPECIES_KEYS)[number];
export type SymbiontSpeciesKey = Core169SpeciesKey | SymbioticMonsterSpeciesKey;
export type RandomSymbiontRaceCode = (typeof RANDOM_SYMBIONT_RACE_CODES)[number];
export type SymbiontKind = 'ORDINARY' | 'SYMBIOTIC_MONSTER';
export type SymbiontSide = (typeof SYMBIONT_SIDES)[number];
export type SymbiontBindingPolicy =
  | 'NONE'
  | 'OWL_EYE'
  | 'EEL_ARM'
  | 'TICK_RIGHT_HAND'
  | 'SPIDER_BOTH_WRISTS'
  | 'MANTIS_BOTH_FOREARMS';
export type SymbiontBinding =
  | Readonly<{ kind: 'NONE' }>
  | Readonly<{ kind: 'OWL_EYE'; side: SymbiontSide }>
  | Readonly<{ kind: 'EEL_ARM'; side: SymbiontSide }>
  | Readonly<{ kind: 'TICK_RIGHT_HAND' }>
  | Readonly<{ kind: 'SPIDER_BOTH_WRISTS' }>
  | Readonly<{ kind: 'MANTIS_BOTH_FOREARMS' }>;

export interface SymbiontAcceptedSpecies {
  readonly acceptedIndex: number;
  readonly speciesKey: SymbiontSpeciesKey;
}

export interface SymbiontBindingSelection {
  readonly speciesKey: 'OWL' | 'EEL';
  readonly side: SymbiontSide;
}

export interface SymbiontSpeciesBinding extends SymbiontAcceptedSpecies {
  readonly binding: SymbiontBinding;
}

export interface SymbiontSpeciesDefinition {
  readonly speciesKey: SymbiontSpeciesKey;
  readonly speciesLabel: string;
  readonly kind: SymbiontKind;
  readonly profileRuleId: string;
  readonly allowedRaceCodes: readonly RaceCode[];
  readonly slotCost: number;
  readonly linkedStatCodes: readonly StatCode[];
  readonly initialCurrentOe: number;
  readonly bindingPolicy: SymbiontBindingPolicy;
  readonly modifiers: readonly StatModifierDefinition[];
}

export interface SymbiontRaceDefinition {
  readonly raceCode: RaceCode;
  readonly raceLabel: string;
  readonly baseSymbiontSlots: number;
  readonly symbioticMonsterAllowed: boolean;
}

export interface SymbiontStatDefinition {
  readonly statCode: StatCode;
  readonly statLabel: string;
  readonly order: number;
}

export interface SymbiontInteractionDefinition {
  readonly conflictId: string;
  readonly conflictType: string;
  readonly leftEntityId: string;
  readonly rightEntityId: string;
  readonly symmetric: boolean;
}

export interface SymbiontCatalog {
  readonly species: readonly SymbiontSpeciesDefinition[];
  readonly races: readonly SymbiontRaceDefinition[];
  readonly stats: readonly SymbiontStatDefinition[];
  readonly interactions: readonly SymbiontInteractionDefinition[];
  readonly skillStage: SkillStageCatalog;
}

export interface SymbiontCatalogSources extends SkillStageCatalogSources {
  readonly symbionts: unknown;
  readonly incompatibilities: unknown;
}

export type SymbiontStatModifierEffect =
  | Readonly<{ kind: 'NO_STAT_MODIFIERS' }>
  | Readonly<{
      kind: 'ADDITIVE_STAT_MODIFIERS';
      entries: readonly Readonly<{
        statCode: StatCode;
        statLabel: string;
        delta: number;
      }>[];
    }>;

export interface SymbiontPlayerSpecies {
  readonly speciesKey: SymbiontSpeciesKey;
  readonly speciesLabel: string;
  readonly kind: SymbiontKind;
  readonly slotCost: number;
  readonly linkedStatCodes: readonly StatCode[];
  readonly bindingPolicy: SymbiontBindingPolicy;
  readonly statModifiers: SymbiontStatModifierEffect;
}

export interface SymbiontPlayerCatalog {
  readonly slotCapacity: number;
  readonly eligibleSymbiontSpecies: readonly SymbiontPlayerSpecies[];
}

export class SymbiontCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

type Row = Record<string, unknown>;

const STAT_CODES = Object.freeze(['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const);
const RACE_CODES = Object.freeze(['PURE', 'FREE', 'UNITED'] as const);
const SPECIES_KEYS = Object.freeze([
  ...CORE_169_SPECIES_BY_FACE,
  ...SYMBIOTIC_MONSTER_SPECIES_KEYS,
]);
const LEGEND_KEYS = Object.freeze([
  'Нормализованные связи SpeciesKey ↔ LinkedStatCode',
  '48 отношений, дословно извлечённых из профильных карточек Rules v1.6. Модификатор характеристики профиля не считается связью.',
  'LinkID',
] as const);
const ORDINARY_KEYS = Object.freeze([
  'AdditionalSlotPolicy',
  'AllowedRaceCodes',
  'BranchPolicy',
  'ID unique',
  'LinkedStatCodes',
  'MaxL',
  'OEPolicy',
  'ProfileRuleID',
  'Rule IDs',
  'SlotCost',
  'SpeciesKey',
  'Status',
  'SymbiontKind',
  'XPPolicy',
  'Источник',
  'Название',
] as const);
const LINK_KEYS = Object.freeze([
  'AllowedRaceCodes',
  'MaxL',
  'SlotCost',
  'SpeciesKey',
  'SymbiontKind',
  'XPPolicy',
  'Название',
] as const);
const EXPECTED_INTERACTIONS = Object.freeze({
  'SYM-UNIQUE-SPECIES': ['HARD_REJECTION', 'ANY_ORDINARY_SYMBIONT', 'SAME_SPECIES', false],
  'SYM-SLOT-CAPACITY': ['HARD_REJECTION', 'HOST', 'ANY_SYMBIONT', false],
  'TOAD-SUPPRESSES-TAIPAN': ['COEXISTENCE_WITH_SUPPRESSION', 'TOAD', 'TAIPAN', false],
  'OWL-SUPPRESSES-DOUBLE-FOCUS': ['ABILITY_SUPPRESSION', 'OWL', 'CHAMELEON', false],
  'TROGR-CONSUMES-TEACHER-DOLPHIN': ['IMMEDIATE_DESTRUCTION', 'TROGR', 'TEACHER+DOLPHIN', false],
  'TROGR-VS-KEEPER': ['CURRENT_OE_DUEL', 'TROGR', 'KEEPER', true],
  'TROGR-SUPPRESSES-ADVISER': ['COEXISTENCE_WITH_SUPPRESSION', 'TROGR', 'ADVISER', false],
  'TROGR-SUPPRESSES-PENGUIN': ['COEXISTENCE_WITH_SUPPRESSION', 'TROGR', 'PENGUIN', false],
  'SYMBIOTIC-MONSTER-BASE-SLOTS': ['SLOT_EXCLUSIVITY', 'CHIMERA', 'PUPPETEER+PLAGUE_DOCTOR', false],
} as const);
const MODIFIER_PREDICATES = new Set([
  'symbiontActive=true',
  'symbiontActive=true AND NOT equippedHermeticNate',
]);
const speciesKeySet = new Set<unknown>(SPECIES_KEYS);
const randomRaceSet = new Set<unknown>(RANDOM_SYMBIONT_RACE_CODES);

function fail(path: string, detail: string): never {
  throw new SymbiontCatalogError(`${path}: ${detail}`);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function rows(value: unknown, path: string, expected: number): Row[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length !== expected)
    fail(path, `expected ${String(expected)} rows, got ${String(value.length)}`);
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(`${path}[${String(index)}]`, 'expected an object');
    }
    return entry as Row;
  });
}

function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key}`, 'expected a non-empty string');
  }
  return value;
}

function integer(row: Row, key: string, path: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(`${path}.${key}`, 'expected a safe integer');
  }
  return value;
}

function literal<T extends string>(row: Row, key: string, allowed: readonly T[], path: string): T {
  const value = text(row, key, path);
  if (!(allowed as readonly string[]).includes(value)) {
    fail(
      `${path}.${key}`,
      `unrecognized ${JSON.stringify(value)}; expected: ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

function exactKeys(
  row: Row,
  path: string,
  expected: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...expected, ...optional]);
  const actual = Object.keys(row);
  const missing = expected.filter((key) => !Object.hasOwn(row, key));
  const extra = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      path,
      `keys must be exact; missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}`,
    );
  }
}

function requireArrayEqual(
  path: string,
  actual: readonly unknown[],
  expected: readonly unknown[],
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(path, `expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`);
  }
}

function requireSpeciesKey(value: string, path: string): SymbiontSpeciesKey {
  if (!speciesKeySet.has(value)) fail(path, `unknown SpeciesKey ${JSON.stringify(value)}`);
  return value as SymbiontSpeciesKey;
}

function bindingPolicy(speciesKey: SymbiontSpeciesKey): SymbiontBindingPolicy {
  switch (speciesKey) {
    case 'OWL':
      return 'OWL_EYE';
    case 'EEL':
      return 'EEL_ARM';
    case 'TICK':
      return 'TICK_RIGHT_HAND';
    case 'SPIDER':
      return 'SPIDER_BOTH_WRISTS';
    case 'MANTIS':
      return 'MANTIS_BOTH_FOREARMS';
    default:
      return 'NONE';
  }
}

function initialCurrentOe(row: Row, path: string, speciesKey: SymbiontSpeciesKey): number {
  const parts = text(row, 'OEPolicy', path).split('; ');
  const match = /^baseMaxOE=([1-9]\d*)×L$/.exec(parts[0] ?? '');
  if (
    match === null ||
    parts[1] !== 'currentOE clamped to max' ||
    parts[2] !== 'new instance full except transplant=0'
  ) {
    fail(
      `${path}.OEPolicy`,
      'expected baseMaxOE=<positive integer>×L and the full-new-instance policy',
    );
  }
  if (parts.length > 3) {
    if (
      speciesKey !== 'KEEPER' ||
      parts.length !== 4 ||
      parts[3] !== 'Кромсатель заменяет формулу на 200×L'
    ) {
      fail(`${path}.OEPolicy`, 'unrecognized additional OE policy');
    }
  }
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value))
    fail(`${path}.OEPolicy`, 'base L1 OE is not safely representable');
  return value;
}

function splitCodes<T extends string>(
  row: Row,
  key: string,
  allowed: readonly T[],
  path: string,
): readonly T[] {
  const values = text(row, key, path)
    .split(';')
    .map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    fail(`${path}.${key}`, 'expected a non-empty semicolon-separated code list');
  }
  if (new Set(values).size !== values.length) fail(`${path}.${key}`, 'contains duplicate codes');
  return Object.freeze(
    values.map((value) => {
      if (!(allowed as readonly string[]).includes(value)) {
        fail(
          `${path}.${key}`,
          `unrecognized ${JSON.stringify(value)}; expected: ${allowed.join(', ')}`,
        );
      }
      return value as T;
    }),
  );
}

function requireRace(catalog: SymbiontCatalog, raceCode: RaceCode): SymbiontRaceDefinition {
  const race = catalog.races.find((candidate) => candidate.raceCode === raceCode);
  if (race === undefined) fail('raceCode', `unknown RaceCode ${JSON.stringify(raceCode)}`);
  return race;
}

export function requireRandomSymbiontRace(value: unknown): RandomSymbiontRaceCode {
  if (!randomRaceSet.has(value)) {
    fail('raceChoice', `expected FREE or UNITED; received ${show(value)}`);
  }
  return value as RandomSymbiontRaceCode;
}

export function requireSymbiontSpecies(
  catalog: SymbiontCatalog,
  speciesKey: unknown,
): SymbiontSpeciesDefinition {
  const species = catalog.species.find((candidate) => candidate.speciesKey === speciesKey);
  if (species === undefined) fail('speciesKey', `unknown SpeciesKey ${show(speciesKey)}`);
  return species;
}

export function symbiontSpeciesByFace(
  catalog: SymbiontCatalog,
  rawFace: unknown,
): SymbiontSpeciesDefinition {
  if (
    typeof rawFace !== 'number' ||
    !Number.isSafeInteger(rawFace) ||
    rawFace < 1 ||
    rawFace > 20
  ) {
    fail('rawFace', `expected an integer in 1..20; received ${show(rawFace)}`);
  }
  const speciesKey = CORE_169_SPECIES_BY_FACE[rawFace - 1];
  if (speciesKey === undefined) fail('rawFace', `CORE-169 row ${String(rawFace)} is missing`);
  return requireSymbiontSpecies(catalog, speciesKey);
}

export function createSymbiontModifierEffect(
  catalog: SymbiontCatalog,
  modifiers: readonly StatModifierDefinition[],
): SymbiontStatModifierEffect {
  if (modifiers.length === 0) return Object.freeze({ kind: 'NO_STAT_MODIFIERS' });
  const entries = catalog.stats.flatMap((stat) =>
    modifiers
      .filter((modifier) => modifier.targetCode === stat.statCode)
      .map((modifier) =>
        Object.freeze({
          statCode: stat.statCode,
          statLabel: stat.statLabel,
          delta: modifier.value,
        }),
      ),
  );
  if (entries.length !== modifiers.length)
    fail('modifiers', 'contains a target outside canonical StatCode order');
  return Object.freeze({ kind: 'ADDITIVE_STAT_MODIFIERS', entries: Object.freeze(entries) });
}

export function createSymbiontPlayerCatalog(
  catalog: SymbiontCatalog,
  raceCode: RaceCode,
): SymbiontPlayerCatalog {
  const race = requireRace(catalog, raceCode);
  const eligible = catalog.species.filter(
    (species) =>
      species.allowedRaceCodes.includes(raceCode) &&
      (species.kind === 'ORDINARY' || race.symbioticMonsterAllowed),
  );
  return Object.freeze({
    slotCapacity: race.baseSymbiontSlots,
    eligibleSymbiontSpecies: Object.freeze(
      eligible.map((species) =>
        Object.freeze({
          speciesKey: species.speciesKey,
          speciesLabel: species.speciesLabel,
          kind: species.kind,
          slotCost: species.slotCost,
          linkedStatCodes: species.linkedStatCodes,
          bindingPolicy: species.bindingPolicy,
          statModifiers: createSymbiontModifierEffect(catalog, species.modifiers),
        }),
      ),
    ),
  });
}

export function createSymbiontBindingSnapshot(
  catalog: SymbiontCatalog,
  acceptedSpecies: readonly SymbiontAcceptedSpecies[],
  selections: readonly SymbiontBindingSelection[] = [],
): readonly SymbiontSpeciesBinding[] {
  const acceptedInput: unknown = acceptedSpecies;
  const selectionsInput: unknown = selections;
  if (!Array.isArray(acceptedInput)) fail('acceptedSpecies', 'expected an array');
  if (!Array.isArray(selectionsInput)) fail('selections', 'expected an array');
  const accepted = (acceptedInput as readonly SymbiontAcceptedSpecies[]).map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(`acceptedSpecies[${String(index)}]`, 'expected an object');
    }
    exactKeys(entry as unknown as Row, `acceptedSpecies[${String(index)}]`, [
      'acceptedIndex',
      'speciesKey',
    ]);
    if (entry.acceptedIndex !== index) {
      fail(`acceptedSpecies[${String(index)}].acceptedIndex`, `expected ${String(index)}`);
    }
    return Object.freeze({
      acceptedIndex: index,
      speciesKey: requireSymbiontSpecies(catalog, entry.speciesKey).speciesKey,
    });
  });
  if (new Set(accepted.map((entry) => entry.speciesKey)).size !== accepted.length) {
    fail('acceptedSpecies', 'contains a duplicate species');
  }
  const selected = new Map<SymbiontSpeciesKey, SymbiontSide>();
  for (const [index, selection] of (
    selectionsInput as readonly SymbiontBindingSelection[]
  ).entries()) {
    if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) {
      fail(`selections[${String(index)}]`, 'expected an object');
    }
    exactKeys(selection as unknown as Row, `selections[${String(index)}]`, ['speciesKey', 'side']);
    const species = requireSymbiontSpecies(catalog, selection.speciesKey);
    if (species.bindingPolicy !== 'OWL_EYE' && species.bindingPolicy !== 'EEL_ARM') {
      fail(
        `selections[${String(index)}].speciesKey`,
        `${species.speciesKey} has a fixed or empty binding`,
      );
    }
    if (!accepted.some((entry) => entry.speciesKey === species.speciesKey)) {
      fail(`selections[${String(index)}].speciesKey`, `${species.speciesKey} was not accepted`);
    }
    if (selected.has(species.speciesKey))
      fail('selections', `duplicate selection for ${species.speciesKey}`);
    if (!SYMBIONT_SIDES.includes(selection.side)) {
      fail(
        `selections[${String(index)}].side`,
        `expected LEFT or RIGHT; received ${show(selection.side)}`,
      );
    }
    selected.set(species.speciesKey, selection.side);
  }
  return Object.freeze(
    accepted.map((entry) => {
      const species = requireSymbiontSpecies(catalog, entry.speciesKey);
      let binding: SymbiontBinding;
      switch (species.bindingPolicy) {
        case 'NONE':
          binding = Object.freeze({ kind: 'NONE' });
          break;
        case 'OWL_EYE':
        case 'EEL_ARM':
          binding = Object.freeze({
            kind: species.bindingPolicy,
            side: selected.get(species.speciesKey) ?? 'RIGHT',
          });
          break;
        default:
          binding = Object.freeze({ kind: species.bindingPolicy });
      }
      return Object.freeze({ ...entry, binding });
    }),
  );
}

export function createSymbiontCatalog(sources: SymbiontCatalogSources): SymbiontCatalog {
  const skillStage = createSkillStageCatalog(sources);
  const symbiontRows = rows(sources.symbionts, 'symbionts', 74);
  const raceRows = rows(sources.races, 'races', 3);
  const statRows = rows(sources.stats, 'stats', 7);
  const modifierRows = rows(sources.modifiers, 'modifiers', 43);
  const dictionaryRows = rows(sources.dictionaries, 'dictionaries', 151);
  const incompatibilityRows = rows(sources.incompatibilities, 'incompatibilities', 9);

  const dictionarySpecies = dictionaryRows
    .filter((row) => row.Dictionary === 'SymbiontSpecies')
    .map((row, index) => text(row, 'Code', `dictionaries SymbiontSpecies[${String(index)}]`));
  requireArrayEqual(
    'dictionary SymbiontSpecies',
    [...dictionarySpecies].sort(),
    [...SPECIES_KEYS].sort(),
  );

  const stats = statRows.map((row, index): SymbiontStatDefinition => {
    const path = `stats[${String(index)}]`;
    const statCode = literal(row, 'StatCode', STAT_CODES, path);
    const domainStat = skillStage.stats.find((candidate) => candidate.statCode === statCode);
    const order = integer(row, 'Порядок', path);
    if (domainStat === undefined || domainStat.order !== order) {
      fail(path, 'stat join with SkillStageCatalog failed');
    }
    return Object.freeze({ statCode, statLabel: text(row, 'Название', path), order });
  });
  requireArrayEqual(
    'stats order',
    stats.map((stat) => stat.statCode),
    STAT_CODES,
  );

  const races = raceRows.map((row, index): SymbiontRaceDefinition => {
    const path = `races[${String(index)}]`;
    const raceCode = literal(row, 'RaceCode', RACE_CODES, path);
    const domainRace = skillStage.races.find((candidate) => candidate.raceCode === raceCode);
    const baseSymbiontSlots = integer(row, 'BaseSymbiontSlots', path);
    if (domainRace === undefined || domainRace.baseSymbiontSlots !== baseSymbiontSlots) {
      fail(path, 'race join with SkillStageCatalog failed');
    }
    if (row.SymbioticMonsterAllowed !== true && row.SymbioticMonsterAllowed !== false) {
      fail(`${path}.SymbioticMonsterAllowed`, 'expected a boolean');
    }
    literal(row, 'Status', ['ACTIVE'] as const, path);
    return Object.freeze({
      raceCode,
      raceLabel: text(row, 'Название', path),
      baseSymbiontSlots,
      symbioticMonsterAllowed: row.SymbioticMonsterAllowed,
    });
  });
  requireArrayEqual(
    'races order',
    races.map((race) => race.raceCode),
    RACE_CODES,
  );

  const nonSpecies: { row: Row; index: number }[] = [];
  const parsedSpecies: (Omit<SymbiontSpeciesDefinition, 'modifiers'> & { row: Row })[] = [];
  for (const [index, row] of symbiontRows.entries()) {
    const path = `symbionts[${String(index)}]`;
    if (row.SymbiontKind !== 'ORDINARY' && row.SymbiontKind !== 'SYMBIOTIC_MONSTER') {
      nonSpecies.push({ row, index });
      continue;
    }
    const kind = row.SymbiontKind;
    exactKeys(row, path, ORDINARY_KEYS, kind === 'SYMBIOTIC_MONSTER' ? ['MonsterProfileID'] : []);
    const speciesKey = requireSpeciesKey(text(row, 'SpeciesKey', path), `${path}.SpeciesKey`);
    const slotCost = integer(row, 'SlotCost', path);
    const expectedSlotCost = kind === 'ORDINARY' ? 1 : 4;
    if (slotCost !== expectedSlotCost)
      fail(`${path}.SlotCost`, `expected ${String(expectedSlotCost)}`);
    literal(row, 'Status', ['ACTIVE'] as const, path);
    if (integer(row, 'ID unique', path) !== 1) fail(`${path}.ID unique`, 'expected 1');
    if (integer(row, 'MaxL', path) < 1) fail(`${path}.MaxL`, 'expected a positive level bound');
    const allowedRaceCodes = splitCodes(row, 'AllowedRaceCodes', RACE_CODES, path);
    const expectedRaces = kind === 'ORDINARY' ? ['FREE', 'UNITED'] : ['UNITED'];
    requireArrayEqual(`${path}.AllowedRaceCodes`, allowedRaceCodes, expectedRaces);
    if (kind === 'ORDINARY') {
      literal(row, 'AdditionalSlotPolicy', ['NONE'] as const, path);
    }
    parsedSpecies.push({
      speciesKey,
      speciesLabel: text(row, 'Название', path),
      kind,
      profileRuleId: text(row, 'ProfileRuleID', path),
      allowedRaceCodes,
      slotCost,
      linkedStatCodes: splitCodes(row, 'LinkedStatCodes', STAT_CODES, path),
      initialCurrentOe: initialCurrentOe(row, path, speciesKey),
      bindingPolicy: bindingPolicy(speciesKey),
      row,
    });
  }
  const ordinary = parsedSpecies.filter((species) => species.kind === 'ORDINARY');
  const monsters = parsedSpecies.filter((species) => species.kind === 'SYMBIOTIC_MONSTER');
  requireArrayEqual(
    'ORDINARY CORE-169 order',
    ordinary.map((entry) => entry.speciesKey),
    CORE_169_SPECIES_BY_FACE,
  );
  requireArrayEqual(
    'SYMBIOTIC_MONSTER order',
    monsters.map((entry) => entry.speciesKey),
    SYMBIOTIC_MONSTER_SPECIES_KEYS,
  );
  if (nonSpecies.length !== 51)
    fail('symbionts legend/link rows', `expected 51, got ${String(nonSpecies.length)}`);
  requireArrayEqual(
    'symbionts legend rows',
    nonSpecies.slice(0, 3).map(({ row }) => row.SpeciesKey),
    LEGEND_KEYS,
  );

  const linkPairs: string[] = [];
  for (const { row, index } of nonSpecies.slice(3)) {
    const path = `symbionts[${String(index)}]`;
    exactKeys(row, path, LINK_KEYS);
    const speciesKey = requireSpeciesKey(text(row, 'Название', path), `${path}.Название`);
    const species = parsedSpecies.find((candidate) => candidate.speciesKey === speciesKey);
    if (species === undefined) fail(path, 'link points outside the 23 species rows');
    const statCode = literal(row, 'SymbiontKind', STAT_CODES, path);
    const stat = stats.find((candidate) => candidate.statCode === statCode);
    if (stat === undefined) fail(path, 'link points outside StatCode catalog');
    if (text(row, 'SpeciesKey', path) !== `SYMSTAT-${speciesKey}-${statCode}`) {
      fail(`${path}.SpeciesKey`, 'link ID does not match its species/stat pair');
    }
    if (text(row, 'AllowedRaceCodes', path) !== species.profileRuleId) {
      fail(`${path}.AllowedRaceCodes`, 'link profile does not match the species row');
    }
    literal(row, 'MaxL', ['ACTIVE'] as const, path);
    if (integer(row, 'XPPolicy', path) !== 1) fail(`${path}.XPPolicy`, 'expected ID unique=1');
    if (integer(row, 'SlotCost', path) !== stat.order)
      fail(`${path}.SlotCost`, 'expected StatOrder');
    linkPairs.push(`${speciesKey}\0${statCode}`);
  }
  if (linkPairs.length !== 48 || new Set(linkPairs).size !== 48) {
    fail('symbionts links', `expected 48 unique links, got ${String(linkPairs.length)}`);
  }
  for (const species of parsedSpecies) {
    const expected = species.linkedStatCodes.map(
      (statCode) => `${species.speciesKey}\0${statCode}`,
    );
    const actual = linkPairs.filter((pair) => pair.startsWith(`${species.speciesKey}\0`));
    requireArrayEqual(`symbionts links/${species.speciesKey}`, actual, expected);
  }

  const rawModifiersById = new Map(
    modifierRows.map(
      (row, index) => [text(row, 'ModifierID', `modifiers[${String(index)}]`), row] as const,
    ),
  );
  const profileModifiers = skillStage.modifiers.filter(
    (modifier) => modifier.sourceType === 'SYMBIONT_PROFILE',
  );
  if (profileModifiers.length !== 14) {
    fail('modifiers SYMBIONT_PROFILE', `expected 14 rows, got ${String(profileModifiers.length)}`);
  }
  const species = parsedSpecies.map((parsed): SymbiontSpeciesDefinition => {
    const modifiers = profileModifiers.filter(
      (modifier) => modifier.sourceId === parsed.speciesKey,
    );
    for (const modifier of modifiers) {
      if (
        modifier.applicationStage !== 'EFFECTIVE_STATS' ||
        modifier.stackPolicy !== 'ADD_ONCE_PER_ACTIVE_SPECIES' ||
        !MODIFIER_PREDICATES.has(modifier.contextPredicate)
      ) {
        fail(
          `modifiers/${modifier.modifierId}`,
          'unexpected symbiont stage, stack policy, or predicate',
        );
      }
      const raw = rawModifiersById.get(modifier.modifierId);
      if (raw === undefined || raw['Rule IDs'] !== parsed.profileRuleId) {
        fail(`modifiers/${modifier.modifierId}`, 'profile rule join failed');
      }
    }
    return Object.freeze({
      speciesKey: parsed.speciesKey,
      speciesLabel: parsed.speciesLabel,
      kind: parsed.kind,
      profileRuleId: parsed.profileRuleId,
      allowedRaceCodes: parsed.allowedRaceCodes,
      slotCost: parsed.slotCost,
      linkedStatCodes: parsed.linkedStatCodes,
      initialCurrentOe: parsed.initialCurrentOe,
      bindingPolicy: parsed.bindingPolicy,
      modifiers: Object.freeze(modifiers),
    });
  });
  for (const sourceId of new Set(profileModifiers.map((modifier) => modifier.sourceId))) {
    if (!species.some((candidate) => candidate.speciesKey === sourceId)) {
      fail('modifiers SYMBIONT_PROFILE', `unknown SourceID ${JSON.stringify(sourceId)}`);
    }
  }

  const interactions = incompatibilityRows.map((row, index): SymbiontInteractionDefinition => {
    const path = `incompatibilities[${String(index)}]`;
    exactKeys(
      row,
      path,
      [
        'ConflictID',
        'ConflictType',
        'Context',
        'EnforcementStage',
        'ID unique',
        'LeftEntityID',
        'LeftEntityType',
        'Resolution',
        'RightEntityID',
        'RightEntityType',
        'Rule IDs',
        'Status',
        'Symmetric',
      ],
      ['Source Question IDs'],
    );
    const conflictId = text(row, 'ConflictID', path);
    const expected = EXPECTED_INTERACTIONS[conflictId as keyof typeof EXPECTED_INTERACTIONS];
    if (expected === undefined) fail(`${path}.ConflictID`, `unknown ${JSON.stringify(conflictId)}`);
    const conflictType = text(row, 'ConflictType', path);
    const leftEntityId = text(row, 'LeftEntityID', path);
    const rightEntityId = text(row, 'RightEntityID', path);
    if (row.Symmetric !== true && row.Symmetric !== false)
      fail(`${path}.Symmetric`, 'expected a boolean');
    const actual = [conflictType, leftEntityId, rightEntityId, row.Symmetric] as const;
    requireArrayEqual(path, actual, expected);
    literal(row, 'Context', ['CHARACTER_COMPOSITION_AND_RUNTIME'] as const, path);
    if (!text(row, 'EnforcementStage', path).split('; ').includes('CREATE')) {
      fail(`${path}.EnforcementStage`, 'CREATE is required');
    }
    if (integer(row, 'ID unique', path) !== 1) fail(`${path}.ID unique`, 'expected 1');
    literal(row, 'Status', ['ACTIVE'] as const, path);
    text(row, 'Resolution', path);
    text(row, 'Rule IDs', path);
    return Object.freeze({
      conflictId,
      conflictType,
      leftEntityId,
      rightEntityId,
      symmetric: row.Symmetric,
    });
  });

  return Object.freeze({
    species: Object.freeze(species),
    races: Object.freeze(races),
    stats: Object.freeze(stats),
    interactions: Object.freeze(interactions),
    skillStage,
  });
}
