import type { NpcBaseStatCatalog, NpcValidatedSchema } from './base-stats.js';
import { deriveNpcBaseStatLayers } from './base-stats.js';
import type { SkillStageCatalog } from '../skill-stage/catalog.js';
import { validateSkillSelection, type SkillSelectionResult } from '../skill-stage/skills.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { NpcCompositionConsequenceCatalog } from './composition-consequences.js';
import { evaluateNpcCompositionConsequences } from './composition-consequences.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import type { NpcPassiveHealthCatalog } from './passive-health.js';
import { deriveNpcPassiveHealthComponent } from './passive-health.js';
import {
  evaluateNpcSkills,
  assertNpcSkillSnapshot,
  type NpcSkillProof,
  type NpcSkillEvaluation,
} from './skill-evaluation.js';
import { readNpcInventoryRequest } from './inventory.js';
import type {
  NpcDerivedSheet,
  NpcIdentityInput,
  NpcLifetimeFacts,
  NpcSheetInput,
} from './types.js';

export interface NpcCleanHumanoidComponents {
  readonly baseStats: NpcBaseStatCatalog;
  readonly skills: SkillStageCatalog;
  readonly compositionConsequences: NpcCompositionConsequenceCatalog;
  readonly passiveHealth: NpcPassiveHealthCatalog;
}
export interface NpcCleanHumanoidCatalog {
  readonly kind: 'SOURCE_BOUND_CLEAN_HUMANOID';
}
/** A complete mechanical snapshot for this supported branch, not proof of host authority. */
export interface NpcCleanHumanoidSnapshot {
  readonly format: 'NPC_CLEAN_HUMANOID_V1';
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly derivation: Readonly<{
    skillProof: NpcSkillProof;
    compositionProof: NpcCompositionConsequenceProof;
  }>;
  readonly sheet: NpcDerivedSheet;
}
/** Caller-provided references are validated as data here and authenticated by the owning host. */
export interface NpcCleanHumanoidBuildInput {
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly input: NpcSheetInput;
  readonly skillProof: NpcSkillProof;
  readonly compositionProof: NpcCompositionConsequenceProof;
}
/** Read-only calculation: no acquisition ledger, prospective COMMIT identity or saved-version claim. */
export interface NpcCleanHumanoidPreview {
  readonly kind: 'UNCOMMITTED';
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly sheet: Omit<NpcDerivedSheet, 'input'> &
    Readonly<{
      input: Omit<NpcSheetInput, 'skills'> & Readonly<{ skills: SkillSelectionResult }>;
    }>;
}
type CleanCommonSheet = Omit<NpcDerivedSheet, 'input'> &
  Readonly<{
    input: Omit<NpcSheetInput, 'skills'>;
  }>;
export interface NpcInitialSkillFactReference {
  readonly commitOperationId: string;
  readonly ordinal: number;
}
export interface NpcPureInitialSkillInput {
  readonly npcUuid: string;
  readonly commitOperationId: string;
  readonly contextFactId: string;
  readonly schema: NpcValidatedSchema & Readonly<{ raceCode: 'PURE' }>;
  readonly baseStats: StatBlock;
  readonly selections: readonly Readonly<{
    skillKey: string;
    targetBonus: number;
    pool: 'START';
  }>[];
}
export class NpcCleanHumanoidError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_YET_SUPPORTED',
    detail: string,
  ) {
    super(`NPC clean humanoid ${code}: ${detail}`);
    this.name = new.target.name;
  }
}
const catalogs = new WeakMap<NpcCleanHumanoidCatalog, NpcCleanHumanoidComponents>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NAME_SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });
const INVISIBLE = /^(?:\p{White_Space}|\p{Default_Ignorable_Code_Point})$/u;
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
function fail(detail: string): never {
  throw new NpcCleanHumanoidError('INVALID', detail);
}
function unsupported(detail: string): never {
  throw new NpcCleanHumanoidError('NOT_YET_SUPPORTED', detail);
}
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('expected plain data record');
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== 'string') ||
    (keys !== undefined &&
      (actual.length !== keys.length || keys.some((key) => !actual.includes(key))))
  )
    return fail('unexpected or missing fields');
  const result: Record<string, unknown> = {};
  for (const key of actual) {
    if (typeof key !== 'string') return fail('symbol field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return fail('expected own enumerable data fields');
    Object.defineProperty(result, key, { value: descriptor.value as unknown, enumerable: true });
  }
  return result;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('expected plain array');
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return fail('expected dense unextended array');
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return fail('expected array data index');
    return descriptor.value as unknown;
  });
}
function empty(value: unknown, stage: string): readonly [] {
  if (array(value).length !== 0) return unsupported(stage);
  return Object.freeze([]);
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : fail('expected text');
}
function ref(value: unknown): string {
  const result = text(value);
  return result.length !== 0 && result.trim() === result
    ? result
    : fail('expected exact reference');
}
function uuid(value: unknown): string {
  const result = ref(value);
  return UUID.test(result) ? result : fail('expected canonical UUID v4');
}
/** An address within the immutable first COMMIT, not an allocated entity UUID or played training event. */
export function readNpcInitialSkillFactReference(value: unknown): NpcInitialSkillFactReference {
  const parts = ref(value).split('/');
  if (parts.length !== 3 || parts[0] !== 'NPC_INITIAL_SKILL')
    return fail('expected NPC_INITIAL_SKILL commit leaf reference');
  const commitOperationId = uuid(parts[1]);
  const token = parts[2];
  if (token === undefined || !/^[1-9]\d*$/u.test(token))
    return fail('initial skill leaf ordinal must be canonical');
  const ordinal = Number(token);
  if (!Number.isSafeInteger(ordinal) || String(ordinal) !== token)
    return fail('initial skill leaf ordinal must be safely representable');
  return Object.freeze({ commitOperationId, ordinal });
}
function equal(expected: unknown, actual: unknown): void {
  if (Array.isArray(expected)) {
    const values = array(actual);
    if (expected.length !== values.length) return fail('derived array differs');
    expected.forEach((value: unknown, index) => equal(value, values[index]));
  } else if (expected !== null && typeof expected === 'object') {
    const source = record(expected),
      target = record(actual, Object.keys(source));
    for (const key of Object.keys(source)) equal(source[key], target[key]);
  } else if (!Object.is(expected, actual)) return fail('derived value differs');
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function one(rows: unknown, field: string, value: string): Record<string, unknown> {
  const matches = array(rows)
    .map((row) => record(row))
    .filter((row) => row[field] === value);
  return matches.length === 1 && matches[0] !== undefined
    ? matches[0]
    : fail('missing or duplicate source row');
}
/** Closed empty-history branch only; validateVersion must also match the actual preserved proof. */
export function readNpcCleanHumanoidLifetimeFacts(value: unknown): NpcLifetimeFacts {
  const expected: NpcLifetimeFacts = {
    freeExtraSlot: { kind: 'NOT_UNLOCKED' },
    trogrLegacy: [],
    grossGrant: { kind: 'NOT_ISSUED' },
    advisorCards: [],
    absorptionFacts: [],
  };
  equal(expected, value);
  return freeze(expected);
}
/** Source checks make clean capabilities explicit; an unknown effect never selects this profile. */
export function createNpcCleanHumanoidCatalog(
  components: NpcCleanHumanoidComponents,
  source: Readonly<{
    capabilityProfiles: unknown;
    effectRuntimeFields: unknown;
    rules: unknown;
    characterRuntime: unknown;
  }>,
): NpcCleanHumanoidCatalog {
  const inputs = record(source, [
    'capabilityProfiles',
    'effectRuntimeFields',
    'rules',
    'characterRuntime',
  ]);
  const clean = one(inputs.capabilityProfiles, 'ProfileID', 'PRF-CLEAN');
  equal(
    {
      ProfileID: 'PRF-CLEAN',
      'Rule refs': 'AQA-009',
      Status: 'DEFINED',
      'Активная защита': 'YES',
      'Активные состояния': '—',
      Броня: 'YES',
      Выход: '—',
      Контроллер: 'owningController',
      'Ментальные действия': 'YES',
      Перемещение: 'YES',
      Реакции: 'YES',
      'Таймеры / автономные эффекты': 'Normal',
      'Физические действия': 'YES',
    },
    clean,
  );
  const rule = one(inputs.rules, 'Rule ID', 'CORE-164');
  if (
    rule['Статус'] !== 'Активно' ||
    !text(rule['Итоговый алгоритм']).includes('персонаж валиден, только если каждая ≥1;')
  )
    return fail('CORE-164 permanent minimum source differs');
  const hpBounds = one(inputs.rules, 'Rule ID', 'CORE-077');
  if (
    hpBounds['Статус'] !== 'Активно' ||
    hpBounds['Предусловия'] !== 'нет.' ||
    hpBounds['Runtime-триггер'] !== 'любое изменение текущего или максимального запаса.' ||
    hpBounds['Итоговый алгоритм'] !==
      'clamp текущего в [0,currentMax]; избыточное восстановление пропадает; при временном снижении max текущий снизить до нового max, если выше; увеличение max само не восстанавливает текущий запас.'
  )
    return fail('CORE-077 current resource bounds source differs');
  const current = one(inputs.characterRuntime, 'ContractKey', 'currentHP');
  if (current.NormativeValue !== 'CharacterProfile' || current.RuleRef !== 'integer')
    return fail('CharacterProfile currentHP representation differs');
  for (const [field, type] of [
    ['canPhysicalAct', 'boolean'],
    ['canMentalAct', 'boolean|conditional'],
    ['canReact', 'boolean'],
    ['canActiveDefend', 'boolean'],
    ['effectiveControllerId', 'UUID|string|null'],
    ['regionPenaltyById', 'map<regionId,number>'],
  ]) {
    const row = one(
      array(inputs.effectRuntimeFields).filter(
        (value) => record(value).Entity === 'DerivedStateProjection',
      ),
      'Field',
      field!,
    );
    if (row.Required !== 'YES' || row.Type !== type)
      return fail('DerivedStateProjection source differs');
  }
  const supplied = record(components, [
    'baseStats',
    'skills',
    'compositionConsequences',
    'passiveHealth',
  ]);
  if (Object.values(supplied).some((value) => value === null || typeof value !== 'object'))
    return fail('required source components missing');
  const result: NpcCleanHumanoidCatalog = Object.freeze({ kind: 'SOURCE_BOUND_CLEAN_HUMANOID' });
  catalogs.set(result, Object.freeze({ ...components }));
  return result;
}
type NpcIdentityMetadata = Pick<
  NpcIdentityInput,
  'name' | 'description' | 'affiliation' | 'campaignRole' | 'sex' | 'massKg' | 'artAssetKeyOrNull'
>;
function identityMetadata(value: unknown): NpcIdentityMetadata {
  const row = record(value, [
    'name',
    'description',
    'affiliation',
    'campaignRole',
    'sex',
    'massKg',
    'artAssetKeyOrNull',
  ]);
  const name = text(row.name).trim();
  for (let index = 0; index < name.length; index++) {
    const unit = name.charCodeAt(index);
    if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return fail('Q-CHAR-001 control character');
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = name.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail('Q-CHAR-001 unpaired surrogate');
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return fail('Q-CHAR-001 unpaired surrogate');
  }
  let visible = 0;
  for (const { segment } of NAME_SEGMENTER.segment(name))
    if ([...segment].some((point) => !INVISIBLE.test(point))) visible++;
  if (visible < 1 || visible > 64) return fail('Q-CHAR-001 name visible length');
  const description = row.description === null ? null : text(row.description);
  if (description !== null && (description.length === 0 || [...description].length > 2000))
    return fail('Q-CHAR-001 description length');
  if (row.sex !== 'MALE' && row.sex !== 'FEMALE') return fail('NPC-002 sex');
  if (
    typeof row.massKg !== 'number' ||
    !Number.isFinite(row.massKg) ||
    row.massKg <= 0 ||
    !Number.isSafeInteger(row.massKg * 10)
  )
    return fail('NPC-002 mass >0 at exact 0.1 precision');
  return {
    name,
    description,
    affiliation: text(row.affiliation),
    campaignRole: text(row.campaignRole),
    sex: row.sex,
    massKg: row.massKg,
    artAssetKeyOrNull: row.artAssetKeyOrNull === null ? null : ref(row.artAssetKeyOrNull),
  };
}
/** NPC-002 precedes race/class: validate its own exact fields without a fictitious schema/default. */
export function readNpcIdentityMetadata(
  catalog: NpcCleanHumanoidCatalog,
  value: unknown,
): NpcIdentityMetadata {
  if (!catalogs.has(catalog)) return fail('expected issued source catalog');
  return Object.freeze(identityMetadata(value));
}
function identity(value: unknown, catalog: SkillStageCatalog): NpcIdentityInput {
  const row = record(value, [
    'name',
    'description',
    'affiliation',
    'campaignRole',
    'raceCode',
    'pureClassOrNull',
    'sex',
    'massKg',
    'anatomyProfileId',
    'artAssetKeyOrNull',
  ]);
  const metadata = identityMetadata({
    name: row.name,
    description: row.description,
    affiliation: row.affiliation,
    campaignRole: row.campaignRole,
    sex: row.sex,
    massKg: row.massKg,
    artAssetKeyOrNull: row.artAssetKeyOrNull,
  });
  if (row.raceCode !== 'PURE')
    return unsupported('NPC-011: other race branches retain their source permission');
  const selectedClass = catalog.classes.find((entry) => entry.classCode === row.pureClassOrNull);
  if (selectedClass === undefined || selectedClass.raceCode !== 'PURE')
    return fail('CORE-008 requires a source PURE class');
  if (row.anatomyProfileId !== 'STANDARD_HUMANOID') return fail('AQA-010 NPC anatomy');
  return {
    ...metadata,
    raceCode: 'PURE',
    pureClassOrNull: selectedClass.classCode,
    anatomyProfileId: 'STANDARD_HUMANOID',
  };
}
function initialSelection(
  components: Readonly<Pick<NpcCleanHumanoidComponents, 'baseStats' | 'skills'>>,
  request: Readonly<{ schema: unknown; baseStats: unknown; selections: unknown }>,
) {
  const derived = deriveNpcBaseStatLayers(components.baseStats, {
    schema: request.schema,
    baseStats: request.baseStats,
  });
  if (derived.schema.raceCode !== 'PURE') return unsupported('NPC-014: initial PURE skill branch');
  for (const key of STATS)
    if (derived.skillStageStats[key] < 1) return fail('CORE-164 permanent stat below one');
  const selections = array(request.selections).map((value) => {
    const selected = record(value, ['skillKey', 'targetBonus', 'pool']);
    if (selected.pool !== 'START')
      return unsupported('NPC-014: initial acquisitions spend START only');
    if (typeof selected.targetBonus !== 'number' || !Number.isSafeInteger(selected.targetBonus))
      return fail('initial targetBonus must be a safe integer');
    return { skillKey: ref(selected.skillKey), targetBonus: selected.targetBonus };
  });
  const selected = validateSkillSelection(components.skills, {
    raceCode: derived.schema.raceCode,
    classCode: derived.schema.pureClassOrNull,
    skillStageStats: derived.skillStageStats,
    selectedSkills: selections,
  });
  return { derived, selected };
}
/**
 * Deterministic initial COMMIT candidate. The host proves these supplied operation/context
 * references against its saved NPC-014 prefix; this function performs no allocation or write.
 * Preview may use validateSkillSelection directly and must not claim these facts already occurred.
 */
export function deriveNpcPureInitialSkills(
  components: Readonly<Pick<NpcCleanHumanoidComponents, 'baseStats' | 'skills'>>,
  value: unknown,
): NpcSkillEvaluation {
  record(components, ['baseStats', 'skills']);
  const request = record(value, [
    'npcUuid',
    'commitOperationId',
    'contextFactId',
    'schema',
    'baseStats',
    'selections',
  ]);
  const npcUuid = uuid(request.npcUuid),
    commitOperationId = uuid(request.commitOperationId);
  const contextFactId = ref(request.contextFactId);
  const { derived, selected } = initialSelection(components, {
    schema: request.schema,
    baseStats: request.baseStats,
    selections: request.selections,
  });
  const facts = selected.learnedSkills
    .filter((skill) => skill.source === 'SELECTED')
    .map((skill, index) => ({
      kind: 'PAID_ACQUISITION' as const,
      factId: `NPC_INITIAL_SKILL/${commitOperationId}/${String(index + 1)}`,
      ordinal: index + 1,
      contextFactId,
      skillKey: skill.skillKey,
      bonusBefore: 0,
      bonusAfter: skill.bonus,
      pool: 'START' as const,
      chargedSlotCost: skill.slotCost,
    }));
  return evaluateNpcSkills(components.skills, {
    mode: 'CREATE_V1',
    identityKey: npcUuid,
    previousConfirmedProofOrNull: null,
    proof: {
      identityKey: npcUuid,
      contexts: [
        {
          contextFactId,
          ordinal: 1,
          stage: 'START_SELECTION',
          raceCode: derived.schema.raceCode,
          classCode: derived.schema.pureClassOrNull,
          skillStageStats: derived.skillStageStats,
          permanentStats: derived.skillStageStats,
          effectiveStats: derived.skillStageStats,
          grossGrantSourceOrNull: null,
          facts,
        },
      ],
    },
  });
}
/**
 * Host must bind supplied IDs/proofs to the actual attempt and confirmation journal.
 * No IDs, past facts, calendar, scene, equipment or controller authority are created here.
 */
function commonSheet(
  components: NpcCleanHumanoidComponents,
  npcUuid: string,
  owningControllerId: string,
  inputValue: unknown,
  compositionProof: unknown,
): Readonly<{ compositionProof: NpcCompositionConsequenceProof; sheet: CleanCommonSheet }> {
  const input = record(inputValue, [
    'identity',
    'baseStats',
    'symbionts',
    'skills',
    'lifetimeFacts',
    'inventory',
    'initialState',
  ]);
  const person = identity(input.identity, components.skills);
  const layers = deriveNpcBaseStatLayers(components.baseStats, {
    schema: {
      raceCode: person.raceCode,
      pureClassOrNull: person.pureClassOrNull,
      anatomyProfileId: person.anatomyProfileId,
      sex: person.sex,
      massKg: person.massKg,
    },
    baseStats: input.baseStats,
  });
  // This branch has no later modifiers; CORE-164 is checked here, after its complete composition.
  for (const key of STATS)
    if (layers.skillStageStats[key] < 1) return fail('CORE-164 permanent stat below one');
  empty(input.symbionts, 'NPC-013: nonempty symbionts');
  const composition = evaluateNpcCompositionConsequences(
    components.compositionConsequences,
    compositionProof,
    null,
  );
  if (
    composition.proof.identityKey !== npcUuid ||
    composition.proof.binding.raceCode !== person.raceCode
  )
    return fail('foreign composition proof identity/race');
  if (
    composition.proof.confirmations.length !== 0 ||
    composition.proof.resolutions.length !== 0 ||
    composition.composition.instances.length !== 0 ||
    composition.obligationStatus !== 'RESOLVED'
  )
    return unsupported('NPC-013: composition history must be retained by a broader branch');
  equal(composition.lifetimeFacts, readNpcCleanHumanoidLifetimeFacts(input.lifetimeFacts));
  if (readNpcInventoryRequest(input.inventory).length !== 0)
    return unsupported('NPC-015: nonempty inventory requires full equipment/profile validation');
  const initial = record(input.initialState, [
    'currentHP',
    'dead',
    'currentTraumas',
    'currentWounds',
    'effectInstances',
    'sourceSpecificStates',
    'deathTimerRollFactOrNull',
  ]);
  if (
    typeof initial.currentHP !== 'number' ||
    !Number.isSafeInteger(initial.currentHP) ||
    initial.currentHP <= 0
  )
    return unsupported('NPC-016: this branch requires explicit positive integer currentHP');
  if (initial.dead !== false || initial.deathTimerRollFactOrNull !== null)
    return unsupported('NPC-016: death/consequence state');
  empty(initial.currentTraumas, 'NPC-016/CORE-119: trauma');
  empty(initial.currentWounds, 'NPC-016/CORE-118: wound');
  empty(initial.effectInstances, 'NPC-016: active effects');
  empty(initial.sourceSpecificStates, 'NPC-016: source-specific state');
  const hp = deriveNpcPassiveHealthComponent(components.passiveHealth, []);
  // GM authoring validates the submitted resource; it never silently applies a played clamp.
  if (initial.currentHP > hp.subtotalHP) return fail('CORE-077 currentHP exceeds computed maxHP');
  return freeze({
    compositionProof: composition.proof,
    sheet: {
      input: {
        identity: person,
        baseStats: layers.baseStats,
        symbionts: [],
        lifetimeFacts: composition.lifetimeFacts,
        inventory: [],
        initialState: {
          currentHP: initial.currentHP,
          dead: false,
          currentTraumas: [],
          currentWounds: [],
          effectInstances: [],
          sourceSpecificStates: [],
          deathTimerRollFactOrNull: null,
        },
      },
      stats: {
        baseStats: layers.baseStats,
        skillStageStats: layers.skillStageStats,
        permanentStats: layers.skillStageStats,
        effectiveStats: layers.skillStageStats,
      },
      symbionts: [],
      interactions: [],
      itemProfiles: [],
      maxHP: hp.subtotalHP,
      capabilities: {
        canPhysicalAct: true,
        canMentalAct: true,
        canReact: true,
        canActiveDefend: true,
        effectiveControllerId: owningControllerId,
        regionPenaltyById: {},
      },
      requiresCampaignTime: false,
      combatContext: { kind: 'ABSENT' },
    },
  });
}
function orderedSkills<T>(input: CleanCommonSheet['input'], skills: T) {
  return {
    identity: input.identity,
    baseStats: input.baseStats,
    symbionts: input.symbionts,
    skills,
    lifetimeFacts: input.lifetimeFacts,
    inventory: input.inventory,
    initialState: input.initialState,
  };
}
export function buildNpcCleanHumanoidSnapshot(
  catalog: NpcCleanHumanoidCatalog,
  value: unknown,
): NpcCleanHumanoidSnapshot {
  const components = catalogs.get(catalog) ?? fail('expected issued source catalog');
  const request = record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'skillProof',
    'compositionProof',
  ]);
  const npcUuid = uuid(request.npcUuid),
    owningControllerId = ref(request.owningControllerId);
  const common = commonSheet(
    components,
    npcUuid,
    owningControllerId,
    request.input,
    request.compositionProof,
  );
  const skills = evaluateNpcSkills(components.skills, {
    mode: 'CREATE_V1',
    identityKey: npcUuid,
    previousConfirmedProofOrNull: null,
    proof: request.skillProof,
  });
  if (skills.proof.contexts.length !== 1) return unsupported('NPC-014: historical skill contexts');
  const context = skills.proof.contexts[0] ?? fail('missing initial skill context');
  if (context.grossGrantSourceOrNull !== null) return unsupported('NPC-014: symbiont skill source');
  let initialCommit: string | null = null;
  const initialKeys = new Set<string>();
  for (const [index, fact] of context.facts.entries()) {
    if (fact.kind !== 'PAID_ACQUISITION' || fact.pool !== 'START')
      return unsupported('NPC-014: only initial paid START facts are supported');
    if (fact.bonusBefore !== 0 || initialKeys.has(fact.skillKey))
      return fail('initial selection requires one acquisition from absence per skill');
    initialKeys.add(fact.skillKey);
    const reference = readNpcInitialSkillFactReference(fact.factId);
    if (
      reference.ordinal !== index + 1 ||
      (initialCommit !== null && reference.commitOperationId !== initialCommit)
    )
      return fail('initial skill leaf differs from the ordered original COMMIT');
    initialCommit = reference.commitOperationId;
  }
  if (
    context.raceCode !== common.sheet.input.identity.raceCode ||
    context.classCode !== common.sheet.input.identity.pureClassOrNull
  )
    return fail('foreign skill schema');
  equal(common.sheet.stats.skillStageStats, context.skillStageStats);
  equal(common.sheet.stats.skillStageStats, context.permanentStats);
  equal(common.sheet.stats.skillStageStats, context.effectiveStats);
  assertNpcSkillSnapshot(
    skills,
    record(request.input).skills,
    common.sheet.input.lifetimeFacts.grossGrant,
  );
  return freeze({
    format: 'NPC_CLEAN_HUMANOID_V1',
    npcUuid,
    owningControllerId,
    derivation: { skillProof: skills.proof, compositionProof: common.compositionProof },
    sheet: { ...common.sheet, input: orderedSkills(common.sheet.input, skills.ledger) },
  });
}
/** NPC-017 calculation does not turn the NPC-014 selection into a committed acquisition. */
export function previewNpcCleanHumanoid(
  catalog: NpcCleanHumanoidCatalog,
  value: unknown,
): NpcCleanHumanoidPreview {
  const components = catalogs.get(catalog) ?? fail('expected issued source catalog');
  const request = record(value, ['npcUuid', 'owningControllerId', 'input', 'compositionProof']);
  const npcUuid = uuid(request.npcUuid),
    owningControllerId = ref(request.owningControllerId);
  const common = commonSheet(
    components,
    npcUuid,
    owningControllerId,
    request.input,
    request.compositionProof,
  );
  const person = common.sheet.input.identity;
  const { selected } = initialSelection(components, {
    schema: {
      raceCode: person.raceCode,
      pureClassOrNull: person.pureClassOrNull,
      anatomyProfileId: person.anatomyProfileId,
      sex: person.sex,
      massKg: person.massKg,
    },
    baseStats: common.sheet.input.baseStats,
    selections: record(request.input).skills,
  });
  return freeze({
    kind: 'UNCOMMITTED',
    npcUuid,
    owningControllerId,
    sheet: { ...common.sheet, input: orderedSkills(common.sheet.input, selected) },
  });
}
/** Re-derives every stored field; a hash or a shape-only parse cannot replace this check. */
export function readNpcCleanHumanoidSnapshot(
  catalog: NpcCleanHumanoidCatalog,
  value: unknown,
): NpcCleanHumanoidSnapshot {
  const row = record(value, ['format', 'npcUuid', 'owningControllerId', 'derivation', 'sheet']);
  if (row.format !== 'NPC_CLEAN_HUMANOID_V1') return fail('unsupported snapshot format');
  const derivation = record(row.derivation, ['skillProof', 'compositionProof']);
  const sheet = record(row.sheet, [
    'input',
    'stats',
    'symbionts',
    'interactions',
    'itemProfiles',
    'maxHP',
    'capabilities',
    'requiresCampaignTime',
    'combatContext',
  ]);
  const expected = buildNpcCleanHumanoidSnapshot(catalog, {
    npcUuid: row.npcUuid,
    owningControllerId: row.owningControllerId,
    input: sheet.input,
    skillProof: derivation.skillProof,
    compositionProof: derivation.compositionProof,
  });
  equal(expected, value);
  return expected;
}
