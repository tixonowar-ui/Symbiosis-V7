import type { SkillStageCatalog } from '../skill-stage/catalog.js';

import type { NpcCleanHumanoidCatalog } from './clean-humanoid-sheet.js';
import { readNpcIdentityMetadata } from './clean-humanoid-sheet.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  assertNpcHumanoidLifeBoundary,
  type NpcHumanoidLifeBoundary,
} from './humanoid-life-boundary.js';
import { deriveNpcPassiveHealthComponent, type NpcPassiveHealthCatalog } from './passive-health.js';
import {
  evaluateNpcSkills,
  previewNpcSkills,
  readNpcSkillProof,
  type NpcOrdinarySkillPreview,
  assertNpcSkillSnapshot,
  type NpcSkillProof,
} from './skill-evaluation.js';
import {
  createNpcOrdinaryStatCatalog,
  deriveNpcOrdinaryStatContext,
  type NpcOrdinaryStatCatalog,
  type NpcOrdinaryStatComponents,
  type NpcEffectiveStatLimits,
} from './ordinary-stat-profile.js';
import {
  evaluateNpcOrdinaryHumanoidProof,
  evaluateNpcOrdinaryAuthoringProof,
  assertNpcOrdinarySkillContexts,
  assertNpcOrdinaryCurrentSkillContext,
  type NpcOrdinaryHumanoidProof,
  type NpcOrdinaryProofResult,
} from './ordinary-humanoid-proof.js';
import type { NpcDerivedSheet, NpcIdentityInput, NpcSheetInput } from './types.js';
import {
  readNpcCombinedHpModeBoundary,
  type NpcCombinedHpModeComponent,
  type NpcHpModeSourceEvidence,
} from './combined-hp-modes.js';

export interface NpcOrdinaryHumanoidComponents extends NpcOrdinaryStatComponents {
  readonly cleanHumanoid: NpcCleanHumanoidCatalog;
  readonly skills: SkillStageCatalog;
  readonly passiveHealth: NpcPassiveHealthCatalog;
}
export interface NpcOrdinaryHumanoidCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_ORDINARY_HUMANOID';
}
export interface NpcOrdinaryHumanoidBuildInput {
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly input: NpcSheetInput;
  readonly compositionProof: NpcCompositionConsequenceProof;
  readonly skillProof: NpcSkillProof;
  readonly ordinaryProof: NpcOrdinaryHumanoidProof;
}
/** Internal base result only. The owning wrapper retains the single NPC_HUMANOID_V1 format. */
export interface NpcOrdinaryHumanoidSnapshot {
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly derivation: Readonly<{
    compositionProof: NpcCompositionConsequenceProof;
    skillProof: NpcSkillProof;
    ordinaryProof: NpcOrdinaryHumanoidProof;
  }>;
  readonly sheet: NpcDerivedSheet;
}
export interface NpcOrdinaryHumanoidPreview {
  readonly kind: 'UNCOMMITTED';
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly sheet: Omit<NpcDerivedSheet, 'input'> &
    Readonly<{
      input: Omit<NpcSheetInput, 'skills'> & Readonly<{ skills: NpcOrdinarySkillPreview }>;
    }>;
}
interface Context {
  readonly components: NpcOrdinaryHumanoidComponents;
  readonly stats: NpcOrdinaryStatCatalog;
}
const catalogs = new WeakMap<NpcOrdinaryHumanoidCatalog, Context>();
const resultLimits = new WeakMap<object, NpcEffectiveStatLimits>();
export function npcOrdinaryResultEffectiveLimits(value: unknown): NpcEffectiveStatLimits {
  if (value === null || typeof value !== 'object') return fail('issued ordinary result required');
  return resultLimits.get(value) ?? fail('issued ordinary result required');
}
function fail(detail: string): never {
  throw new Error(`NPC ordinary humanoid: ${detail}`);
}
export class NpcOrdinarySkillReconfirmationRequiredError extends Error {
  constructor() {
    super(
      'Экипировка изменила постоянные требования изученных навыков. Вернитесь на шаг навыков (NPC-014) и подтвердите последствия.',
    );
    this.name = new.target.name;
  }
}
function context(catalog: NpcOrdinaryHumanoidCatalog): Context {
  return catalogs.get(catalog) ?? fail('expected issued source catalog');
}
function assertInventorySkillRequirements(
  catalog: NpcOrdinaryHumanoidCatalog,
  proof: NpcOrdinaryProofResult,
  learned: readonly Readonly<{ skillKey: string }>[],
): void {
  if (proof.contexts.at(-1)?.fact.inventoryConfirmationOperationId === undefined) return;
  const requirements = context(catalog).components.skills.requirements;
  // Q-CHAR-009 makes Skunk's C penalty permanent even though actual Nate gates it.
  // NPC015 may not manufacture the CORE-166 loss/released-charge facts of NPC014.
  if (
    learned.some((skill) =>
      requirements.some(
        (r) =>
          r.skillKey === skill.skillKey &&
          proof.current.stats.permanentStats[r.statCode] < r.minValue,
      ),
    )
  )
    throw new NpcOrdinarySkillReconfirmationRequiredError();
}
export function createNpcOrdinaryHumanoidCatalog(
  components: NpcOrdinaryHumanoidComponents,
  source: Readonly<{ rules: unknown }>,
): NpcOrdinaryHumanoidCatalog {
  data.record(components, [
    'baseStats',
    'symbionts',
    'compositionConsequences',
    'cleanHumanoid',
    'skills',
    'passiveHealth',
    ...(Object.hasOwn(components, 'equipment') ? ['equipment'] : []),
    ...(Object.hasOwn(components, 'initialMonsters') ? ['initialMonsters'] : []),
  ]);
  data.record(source, ['rules']);
  const stats = createNpcOrdinaryStatCatalog(
    {
      baseStats: components.baseStats,
      symbionts: components.symbionts,
      ...(components.equipment === undefined ? {} : { equipment: components.equipment }),
      ...(components.initialMonsters === undefined
        ? {}
        : { initialMonsters: components.initialMonsters }),
      compositionConsequences: components.compositionConsequences,
    },
    source.rules,
  );
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_ORDINARY_HUMANOID' as const });
  catalogs.set(catalog, {
    components: { ...components, skills: data.freeze(structuredClone(components.skills)) },
    stats,
  });
  return catalog;
}
export function deriveNpcOrdinaryStatProfile(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
  previousConfirmedProofOrNull: unknown = null,
): NpcOrdinaryProofResult {
  return evaluateNpcOrdinaryHumanoidProof(
    context(catalog).stats,
    value,
    previousConfirmedProofOrNull,
  );
}

/** Explicit authoring result; callers must surface invalidPermanentStats before confirmation. */
export function deriveNpcOrdinaryDraftStatProfile(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
): NpcOrdinaryProofResult {
  return evaluateNpcOrdinaryAuthoringProof(context(catalog).stats, value);
}

export interface NpcOrdinaryRuntimeBasis {
  readonly proof: NpcOrdinaryProofResult;
  readonly baseMaxHP: number;
}
const runtimeBases = new WeakSet<object>();
export function readNpcOrdinaryRuntimeBasis(value: unknown): NpcOrdinaryRuntimeBasis {
  if (value === null || typeof value !== 'object' || !runtimeBases.has(value))
    return fail('issued ordinary runtime basis required');
  return value as NpcOrdinaryRuntimeBasis;
}
export function deriveNpcOrdinaryRuntimeBasis(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
): NpcOrdinaryRuntimeBasis {
  const proof = deriveNpcOrdinaryStatProfile(catalog, value);
  const health = deriveNpcPassiveHealthComponent(
    context(catalog).components.passiveHealth,
    proof.current.symbionts.map((i) => ({
      symbiontInstanceId: i.symbiontInstanceId,
      speciesKey: i.speciesKey,
      effectiveLevel: i.targetLevel,
      learnedNodeRefs: i.learnedNodeRefs,
      effectsEnabled: i.effectsEnabled,
    })),
  );
  const result = data.freeze({ proof, baseMaxHP: health.subtotalHP });
  runtimeBases.add(result);
  return result;
}

/** Recomputed current source membership; no caller-supplied mode source may widen the sheet. */
export function deriveNpcOrdinaryHpModeSource(
  proof: NpcOrdinaryProofResult,
): NpcHpModeSourceEvidence {
  const current = proof.current;
  const last = current.composition.proof.confirmations.at(-1);
  if (last === undefined) return fail('actual HP source confirmation required');
  const monsters = current.symbionts.filter(
    (source) =>
      source.speciesKey === 'CHIMERA' ||
      source.speciesKey === 'PUPPETEER' ||
      source.speciesKey === 'PLAGUE_DOCTOR',
  );
  if (monsters.length > 1) return fail('one actual monster source required');
  const member = (s: (typeof current.symbionts)[number]) => ({
    symbiontInstanceId: s.symbiontInstanceId,
    speciesKey: s.speciesKey,
    targetLevel: s.targetLevel,
    learnedNodeRefs: s.learnedNodeRefs,
    binding: s.binding,
    currentOE: s.currentOE,
  });
  return data.freeze({
    npcUuid: proof.npcUuid,
    compositionFactId: last.input.factId,
    raceCode: current.schema.raceCode,
    monsterOrNull: monsters[0] === undefined ? null : member(monsters[0]),
    ordinarySymbionts: current.symbionts.filter((s) => !monsters.includes(s)).map(member),
    unavailableSourceInstanceIds: current.symbionts
      .filter((s) => !s.effectsEnabled)
      .map((s) => s.symbiontInstanceId),
    chimeraSlotProofOrNull: null,
    previousChimeraSlotProofOrNull: null,
  });
}

type BaseSheet = Omit<NpcDerivedSheet, 'input'> &
  Readonly<{ input: Omit<NpcSheetInput, 'skills'> }>;
function common(
  catalog: NpcOrdinaryHumanoidCatalog,
  request: Record<string, unknown>,
  previous: NpcOrdinaryHumanoidSnapshot | null,
  hpModeComponent: NpcCombinedHpModeComponent | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
): { proof: NpcOrdinaryProofResult; sheet: BaseSheet } {
  const { components } = context(catalog);
  const npcUuid = data.uuid(request.npcUuid);
  const owningControllerId = data.text(request.owningControllerId);
  const input = data.record(request.input, [
    'identity',
    'baseStats',
    'symbionts',
    'skills',
    'lifetimeFacts',
    'inventory',
    'initialState',
  ]);
  const person = data.record(input.identity, [
    'name',
    'description',
    'affiliation',
    'campaignRole',
    'sex',
    'massKg',
    'artAssetKeyOrNull',
    'raceCode',
    'pureClassOrNull',
    'anatomyProfileId',
  ]);
  const metadata = readNpcIdentityMetadata(components.cleanHumanoid, {
    name: person.name,
    description: person.description,
    affiliation: person.affiliation,
    campaignRole: person.campaignRole,
    sex: person.sex,
    massKg: person.massKg,
    artAssetKeyOrNull: person.artAssetKeyOrNull,
  });
  const proof = deriveNpcOrdinaryStatProfile(
    catalog,
    {
      npcUuid,
      compositionProof: request.compositionProof,
      ordinaryProof: request.ordinaryProof,
    },
    previous === null
      ? null
      : {
          npcUuid: previous.npcUuid,
          compositionProof: previous.derivation.compositionProof,
          ordinaryProof: previous.derivation.ordinaryProof,
        },
  );
  const profile = proof.current;
  data.equal(profile.schema, {
    raceCode: person.raceCode,
    pureClassOrNull: person.pureClassOrNull,
    anatomyProfileId: person.anatomyProfileId,
    sex: metadata.sex,
    massKg: metadata.massKg,
  });
  data.equal(profile.stats.baseStats, input.baseStats);
  if (profile.composition.obligationStatus !== 'RESOLVED')
    return fail('required composition consequences remain unresolved');
  const symbionts = profile.symbionts.map((i) => ({
    symbiontInstanceId: i.symbiontInstanceId,
    speciesKey: i.speciesKey,
    targetLevel: i.targetLevel,
    learnedNodeRefs: i.learnedNodeRefs,
    binding: i.binding,
    currentOE: i.currentOE,
  }));
  data.equal(symbionts, input.symbionts);
  data.equal(profile.composition.lifetimeFacts, input.lifetimeFacts);
  data.equal([], input.inventory);
  const state = data.record(input.initialState, [
    'currentHP',
    'dead',
    'currentTraumas',
    'currentWounds',
    'effectInstances',
    'sourceSpecificStates',
    'deathTimerRollFactOrNull',
  ]);
  for (const field of [
    'currentTraumas',
    'currentWounds',
    'effectInstances',
    'sourceSpecificStates',
  ])
    data.equal([], state[field]);
  const life =
    lifeBoundary === null
      ? null
      : assertNpcHumanoidLifeBoundary(lifeBoundary, {
          npcUuid,
          compositionProof: proof.compositionProof,
          currentHP: state.currentHP,
          dead: state.dead,
        });
  data.equal(life?.dead ?? false, state.dead);
  data.equal(null, state.deathTimerRollFactOrNull);
  const health = deriveNpcPassiveHealthComponent(
    components.passiveHealth,
    profile.symbionts.map((i) => ({
      symbiontInstanceId: i.symbiontInstanceId,
      speciesKey: i.speciesKey,
      effectiveLevel: i.targetLevel,
      learnedNodeRefs: i.learnedNodeRefs,
      effectsEnabled: i.effectsEnabled,
    })),
  );
  const hpBoundary =
    hpModeComponent === null ? null : readNpcCombinedHpModeBoundary(hpModeComponent);
  if (hpBoundary !== null) {
    data.equal(npcUuid, hpBoundary.npcUuid);
    data.equal(health.subtotalHP, hpBoundary.baseMaxHP);
    data.equal(state.currentHP, hpBoundary.currentHP);
    data.equal(deriveNpcOrdinaryHpModeSource(proof), hpBoundary.source);
  }
  const maxHP = hpBoundary?.maxHP ?? health.subtotalHP;
  if (
    typeof state.currentHP !== 'number' ||
    !Number.isSafeInteger(state.currentHP) ||
    state.currentHP < (life === null || life.lifeKind === 'ALIVE' ? 1 : 0) ||
    state.currentHP > maxHP
  )
    return fail('CORE-077 explicit living currentHP must be within the derived maximum');
  const identity: NpcIdentityInput = { ...metadata, ...profile.schema };
  return {
    proof,
    sheet: data.freeze({
      input: {
        identity,
        baseStats: profile.stats.baseStats,
        symbionts,
        lifetimeFacts: profile.composition.lifetimeFacts,
        inventory: [],
        initialState: {
          currentHP: state.currentHP,
          dead: life?.dead ?? false,
          currentTraumas: [],
          currentWounds: [],
          effectInstances: [],
          sourceSpecificStates: [],
          deathTimerRollFactOrNull: null,
        },
      },
      stats: profile.stats,
      symbionts: profile.symbionts,
      interactions: profile.composition.compositionReceipts.flatMap((receipt) =>
        receipt.consequences.map((consequence, consequenceIndex) => ({
          compositionFactId: receipt.factId,
          consequenceIndex,
          consequence,
        })),
      ),
      itemProfiles: [],
      maxHP,
      capabilities: {
        canPhysicalAct:
          life?.restrictionOrNull === null ||
          life === null ||
          life.restrictionOrNull.physicalActions === 'YES',
        canMentalAct:
          life?.restrictionOrNull === null ||
          life === null ||
          life.restrictionOrNull.mentalActions === 'YES',
        canReact:
          life?.restrictionOrNull === null ||
          life === null ||
          life.restrictionOrNull.reactions === 'YES',
        canActiveDefend:
          life?.restrictionOrNull === null ||
          life === null ||
          life.restrictionOrNull.activeDefense === 'YES',
        effectiveControllerId: life?.dead === true ? null : owningControllerId,
        regionPenaltyById: {},
      },
      requiresCampaignTime: false,
      combatContext: { kind: 'ABSENT' },
    }),
  };
}

export function buildNpcOrdinaryHumanoidSnapshot(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
  previousSnapshotOrNull: unknown = null,
  hpModeComponent: NpcCombinedHpModeComponent | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
): NpcOrdinaryHumanoidSnapshot {
  const request = data.record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'compositionProof',
    'skillProof',
    'ordinaryProof',
  ]);
  const previous =
    previousSnapshotOrNull === null
      ? null
      : readNpcOrdinaryHumanoidSnapshot(catalog, previousSnapshotOrNull);
  const { proof, sheet } = common(catalog, request, previous, hpModeComponent, lifeBoundary);
  const skills = evaluateNpcSkills(context(catalog).components.skills, {
    mode: previous === null ? 'CREATE_V1' : 'APPEND_N_PLUS_ONE',
    identityKey: proof.npcUuid,
    previousConfirmedProofOrNull: previous?.derivation.skillProof ?? null,
    proof: request.skillProof,
  });
  assertNpcOrdinarySkillContexts(proof, skills.proof);
  assertNpcOrdinaryCurrentSkillContext(proof, skills.proof);
  assertInventorySkillRequirements(catalog, proof, skills.ledger.learnedSkills);
  assertNpcSkillSnapshot(
    skills,
    data.record(request.input).skills,
    sheet.input.lifetimeFacts.grossGrant,
  );
  const result = data.freeze({
    npcUuid: proof.npcUuid,
    owningControllerId: data.text(request.owningControllerId),
    derivation: {
      skillProof: skills.proof,
      compositionProof: proof.compositionProof,
      ordinaryProof: proof.ordinaryProof,
    },
    sheet: { ...sheet, input: { ...sheet.input, skills: skills.ledger } },
  });
  resultLimits.set(result, proof.current.effectiveLimits);
  return result;
}

function skillPreview(
  catalog: NpcOrdinaryHumanoidCatalog,
  proof: NpcOrdinaryProofResult,
  selections: unknown,
  previousSkillProofOrNull: unknown,
  draftInventory: Readonly<{
    sourceOperationId: string;
    profile: NpcOrdinaryProofResult['current'];
  }> | null = null,
): NpcOrdinarySkillPreview {
  const previous =
    previousSkillProofOrNull === null ? null : readNpcSkillProof(previousSkillProofOrNull);
  if (previous !== null) assertNpcOrdinarySkillContexts(proof, previous);
  const previousIndex =
    previous === null
      ? -1
      : proof.contexts.findIndex(
          (c) => c.fact.contextFactId === previous.contexts.at(-1)?.contextFactId,
        );
  if (previous !== null && previousIndex < 0)
    return fail('previous skill context absent from actual stat prefix');
  // An incomplete authoring draft is retained for replay, but it is not a
  // character state in which skills can be acquired or permanently forgotten.
  // The current profile was validated above; earlier confirmed skills retain
  // their original exact context and are never recomputed with current gear.
  const pending = proof.contexts
    .slice(previousIndex + 1)
    .filter(
      ({ fact, profile }) =>
        fact.inventoryConfirmationOperationId === undefined &&
        profile.invalidPermanentStats.length === 0,
    );
  const selected =
    pending.length === 0
      ? proof.contexts
          .filter(({ fact }) => fact.inventoryConfirmationOperationId === undefined)
          .slice(-1)
      : pending;
  const previewContext = (contextFactId: string, profile: NpcOrdinaryProofResult['current']) => {
    const dolphin = profile.symbionts.find(
      (s) =>
        s.speciesKey === 'DOLPHIN' && s.effectsEnabled && s.learnedNodeRefs.includes('SYM-166'),
    );
    return {
      contextFactId,
      raceCode: profile.schema.raceCode,
      classCode: profile.schema.pureClassOrNull,
      skillStageStats: profile.stats.skillStageStats,
      permanentStats: profile.stats.permanentStats,
      effectiveStats: profile.stats.effectiveStats,
      grossGrant: profile.composition.lifetimeFacts.grossGrant,
      sym166SourceOrNull:
        dolphin === undefined
          ? null
          : { symbiontInstanceId: dolphin.symbiontInstanceId, nodeRef: 'SYM-166' },
    };
  };
  const result = previewNpcSkills(context(catalog).components.skills, {
    identityKey: proof.npcUuid,
    previousConfirmedProofOrNull: previous,
    selections,
    contexts: [
      ...selected.map(({ fact, profile }) => previewContext(fact.contextFactId, profile)),
      // This is a provisional reference to a real draft operation, never a new
      // ordinary/paid fact. Only actual NPC014 confirmation records the loss.
      ...(draftInventory === null
        ? []
        : [previewContext(draftInventory.sourceOperationId, draftInventory.profile)]),
    ],
  });
  if (draftInventory === null)
    assertInventorySkillRequirements(catalog, proof, result.learnedSkills);
  return result;
}

/** NPC-014 preview needs no HP, item, publication identity or prospective acquisition fact. */
export function previewNpcOrdinarySkills(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
): NpcOrdinarySkillPreview {
  const hasInventory = Object.hasOwn(data.record(value), 'currentInventory');
  const request = data.record(value, [
    'npcUuid',
    'compositionProof',
    'ordinaryProof',
    'selections',
    'previousSkillProofOrNull',
    ...(hasInventory ? ['currentInventory'] : []),
  ]);
  const proof = deriveNpcOrdinaryStatProfile(catalog, {
    npcUuid: request.npcUuid,
    compositionProof: request.compositionProof,
    ordinaryProof: request.ordinaryProof,
  });
  if (proof.current.composition.obligationStatus !== 'RESOLVED')
    return fail('unresolved composition before skill selection');
  const inventory = hasInventory
    ? data.record(request.currentInventory, ['sourceOperationId', 'requests'])
    : null;
  return skillPreview(
    catalog,
    proof,
    request.selections,
    request.previousSkillProofOrNull,
    inventory === null
      ? null
      : {
          sourceOperationId: data.uuid(inventory.sourceOperationId),
          profile: deriveNpcOrdinaryStatContext(context(catalog).stats, {
            schema: proof.current.schema,
            baseStats: proof.current.stats.baseStats,
            compositionProof: proof.compositionProof,
            equippedInventory: inventory.requests,
          }),
        },
  );
}

/** Preview follows actual source history without inventing confirmation/acquisition IDs. */
export function previewNpcOrdinaryHumanoid(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
  hpModeComponent: NpcCombinedHpModeComponent | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
): NpcOrdinaryHumanoidPreview {
  const candidate = data.record(value);
  const hasPrevious = Object.hasOwn(candidate, 'previousSkillProofOrNull');
  const request = data.record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'compositionProof',
    'ordinaryProof',
    ...(hasPrevious ? ['previousSkillProofOrNull'] : []),
  ]);
  const { proof, sheet } = common(catalog, request, null, hpModeComponent, lifeBoundary);
  const skills = skillPreview(
    catalog,
    proof,
    data.record(request.input).skills,
    hasPrevious ? request.previousSkillProofOrNull : null,
  );
  const result: NpcOrdinaryHumanoidPreview = data.freeze({
    kind: 'UNCOMMITTED',
    npcUuid: proof.npcUuid,
    owningControllerId: data.text(request.owningControllerId),
    sheet: { ...sheet, input: { ...sheet.input, skills } },
  });
  resultLimits.set(result, proof.current.effectiveLimits);
  return result;
}
/** Every derived field is recomputed; this internal value does not itself authenticate host facts. */
export function readNpcOrdinaryHumanoidSnapshot(
  catalog: NpcOrdinaryHumanoidCatalog,
  value: unknown,
  previousSnapshotOrNull: unknown = null,
): NpcOrdinaryHumanoidSnapshot {
  const row = data.record(value, ['npcUuid', 'owningControllerId', 'derivation', 'sheet']);
  const derivation = data.record(row.derivation, [
    'skillProof',
    'compositionProof',
    'ordinaryProof',
  ]);
  const sheet = data.record(row.sheet);
  const expected = buildNpcOrdinaryHumanoidSnapshot(
    catalog,
    {
      npcUuid: row.npcUuid,
      owningControllerId: row.owningControllerId,
      input: sheet.input,
      ...derivation,
    },
    previousSnapshotOrNull,
  );
  data.equal(expected, value);
  return expected;
}
