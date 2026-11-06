import type { DiseaseId } from '@generated/types/effects.js';
import type { SkillStageCatalog } from '../skill-stage/catalog.js';
import type { NpcDiseaseEffectInstance } from './effect-types.js';
import {
  validateNpcDiseaseEffects,
  type NpcDiseaseCodecCatalog,
  type NpcPneumoniaHistoryAnchor,
} from './periodic-disease-effects.js';
import {
  deriveNpcDiseaseStatContribution,
  previewNpcDiseaseStatContribution,
  type NpcPreparedDiseaseContribution,
  type NpcDiseaseStatContribution,
  type NpcDiseaseUnconsciousnessCatalog,
} from './disease-unconsciousness.js';
import { evaluateNpcCurrentSkillAvailability } from './skill-evaluation.js';
import { calculateStartSkillSlots } from '../skill-stage/skills.js';
import type { NpcInventoryRequestEntry } from './inventory.js';
import type { StatBlock } from '../skill-stage/stats.js';
import {
  buildNpcCleanHumanoidSnapshot,
  previewNpcCleanHumanoid,
  type NpcCleanHumanoidPreview,
  readNpcInitialSkillFactReference,
  type NpcCleanHumanoidBuildInput,
  type NpcCleanHumanoidCatalog,
  type NpcCleanHumanoidSnapshot,
} from './clean-humanoid-sheet.js';
import {
  buildNpcInventoryPublication,
  buildNpcInventoryPreview,
  type NpcInventoryPreview,
  npcPublicationData as data,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationProof,
} from './inventory-publication.js';
import type { NpcDerivedSheet, NpcStatLayers } from './types.js';

export interface NpcHumanoidComponents {
  readonly cleanHumanoid: NpcCleanHumanoidCatalog;
  readonly inventoryPublication: NpcInventoryPublicationCatalog;
  readonly diseaseEffects: NpcDiseaseCodecCatalog;
  readonly diseaseUnconsciousness: NpcDiseaseUnconsciousnessCatalog;
  readonly skills: SkillStageCatalog;
}
export interface NpcHumanoidCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_HUMANOID';
}
const catalogs = new WeakMap<NpcHumanoidCatalog, NpcHumanoidComponents>();
export function createNpcHumanoidCatalog(
  components: NpcHumanoidComponents,
  source: Readonly<{
    characterDictionaries: unknown;
    characterRuntime: unknown;
  }>,
): NpcHumanoidCatalog {
  data.record(components, [
    'cleanHumanoid',
    'inventoryPublication',
    'diseaseEffects',
    'diseaseUnconsciousness',
    'skills',
  ]);
  data.record(source, ['characterDictionaries', 'characterRuntime']);
  const layers = data
    .array(source.characterDictionaries)
    .map((r) => data.record(r))
    .filter((r) => r.Dictionary === 'StatLayer' && r.Code === 'equippedStats');
  data.equal(
    [
      {
        Code: 'equippedStats',
        Dictionary: 'StatLayer',
        LabelRU: 'С экипировкой',
        Meaning: 'После модификаторов экипировки',
        'RuleRef / Note': 'CORE-079',
      },
    ],
    layers,
  );
  const runtime = data
    .array(source.characterRuntime)
    .map((r) => data.record(r))
    .filter((r) => r.ContractKey === 'equippedStats');
  data.equal(
    [
      {
        Consumer: true,
        ContractKey: 'equippedStats',
        NormativeValue: 'CharacterProfile',
        RuleRef: 'StatMap',
      },
    ],
    runtime,
  );
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_HUMANOID' as const });
  catalogs.set(catalog, Object.freeze({ ...components }));
  return catalog;
}
export interface NpcHumanoidBuildInput extends NpcCleanHumanoidBuildInput {
  readonly inventoryProof: NpcInventoryPublicationProof;
  readonly initialStateProof?: NpcHumanoidInitialStateProof;
}
/** One complete humanoid format; unsupported combinations fail before this result exists. */
export interface NpcHumanoidSnapshot {
  readonly format: 'NPC_HUMANOID_V1';
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly derivation: NpcCleanHumanoidSnapshot['derivation'] &
    Readonly<{
      inventoryProof: NpcInventoryPublicationProof;
      initialStateProof?: NpcHumanoidInitialStateProof;
    }>;
  readonly sheet: Omit<NpcDerivedSheet, 'stats'> &
    Readonly<{
      stats: NpcStatLayers & Readonly<{ equippedStats: StatBlock }>;
      diseaseState?: NpcHumanoidDiseaseState;
    }>;
}

/** References are stored; their timestamp/identity evidence must come from the owning journal. */
export interface NpcHumanoidInitialStateProof {
  readonly commitOperationId: string;
  readonly assignments: readonly Readonly<{
    effectInstanceId: string;
    originOperationId: string;
  }>[];
}
/** Trusted caller evidence, never reconstructed from the snapshot being checked. */
export interface NpcHumanoidInitialStateContext {
  readonly npcUuid: string;
  readonly commitOperationId: string;
  readonly campaignTimestampOrNull: number | null;
  readonly origins: readonly Readonly<{
    effectInstanceId: string;
    diseaseId: DiseaseId;
    originOperationId: string;
    targetActorId: string;
    committedAt: string;
    campaignTimestamp: number;
  }>[];
}
export interface NpcHumanoidDiseaseState {
  readonly contribution: NpcDiseaseStatContribution;
  readonly currentSkills: ReturnType<typeof evaluateNpcCurrentSkillAvailability>;
}
function initialStateProof(value: unknown): NpcHumanoidInitialStateProof {
  const row = data.record(value, ['commitOperationId', 'assignments']);
  const assignments = data.array(row.assignments).map((value) => {
    const r = data.record(value, ['effectInstanceId', 'originOperationId']);
    return {
      effectInstanceId: data.uuid(r.effectInstanceId),
      originOperationId: data.uuid(r.originOperationId),
    };
  });
  if (new Set(assignments.map((a) => a.effectInstanceId)).size !== assignments.length)
    throw new Error('NPC humanoid: duplicate disease assignment identity');
  return data.freeze({ commitOperationId: data.uuid(row.commitOperationId), assignments });
}
function diseaseStateInput(
  components: NpcHumanoidComponents,
  npcUuid: string,
  candidate: unknown,
  proof: NpcHumanoidInitialStateProof,
  context: NpcHumanoidInitialStateContext | null,
): {
  effects: readonly NpcDiseaseEffectInstance[];
  scope: { targetActorId: string; campaignTimestampOrNull: number | null; dead: false };
  histories: readonly NpcPneumoniaHistoryAnchor[];
} {
  if (context === null) throw new Error('NPC humanoid: checked initial-state context required');
  const c = data.record(context, [
    'npcUuid',
    'commitOperationId',
    'campaignTimestampOrNull',
    'origins',
  ]);
  data.equal(npcUuid, data.uuid(c.npcUuid));
  data.equal(proof.commitOperationId, data.uuid(c.commitOperationId));
  const minute = c.campaignTimestampOrNull;
  if (
    minute !== null &&
    (typeof minute !== 'number' || !Number.isSafeInteger(minute) || minute < 0)
  )
    throw new Error('NPC humanoid: exact confirmed campaign minute required');
  const origins = data.array(c.origins).map((value) => {
    const row = data.record(value, [
      'effectInstanceId',
      'diseaseId',
      'originOperationId',
      'targetActorId',
      'committedAt',
      'campaignTimestamp',
    ]);
    const time = row.campaignTimestamp;
    if (
      typeof time !== 'number' ||
      !Number.isSafeInteger(time) ||
      time < 0 ||
      minute === null ||
      time > minute
    )
      throw new Error('NPC humanoid: original disease time outside checked version boundary');
    const effectInstanceId = data.uuid(row.effectInstanceId),
      targetActorId = data.uuid(row.targetActorId);
    data.equal(npcUuid, targetActorId);
    const ref = proof.assignments.find((a) => a.effectInstanceId === effectInstanceId);
    if (ref === undefined) throw new Error('NPC humanoid: unused disease origin');
    data.equal(ref.originOperationId, data.uuid(row.originOperationId));
    return {
      effectInstanceId,
      targetActorId,
      diseaseId: data.text(row.diseaseId),
      committedAt: data.text(row.committedAt),
      campaignTimestamp: time,
    };
  });
  if (
    origins.length !== proof.assignments.length ||
    new Set(origins.map((o) => o.effectInstanceId)).size !== origins.length
  )
    throw new Error('NPC humanoid: missing or repeated original disease proof');
  const scope = { targetActorId: npcUuid, campaignTimestampOrNull: minute, dead: false as const };
  // This slice proves initial assignments only. Processed ticks require their actual owning journal.
  const histories = origins
    .filter((o) => o.diseaseId === 'DIS-PNEUMONIA')
    .map((o) => ({
      effectInstanceId: o.effectInstanceId,
      targetActorId: o.targetActorId,
      startsAt: { campaignTimestamp: o.campaignTimestamp },
      lastTickAt: null,
      revision: 1,
    }));
  const effects = validateNpcDiseaseEffects(components.diseaseEffects, candidate, scope, histories);
  data.equal(
    proof.assignments.map((a) => a.effectInstanceId),
    effects.map((e) => e.effectInstanceId),
  );
  for (const effect of effects) {
    const origin = origins.find((o) => o.effectInstanceId === effect.effectInstanceId);
    if (origin === undefined) throw new Error('NPC humanoid: original effect absent');
    data.equal(
      [
        effect.payload.diseaseId,
        effect.targetActorId,
        effect.createdAt,
        effect.startsAt,
        effect.lastTickAt,
        effect.revision,
      ],
      [
        origin.diseaseId,
        origin.targetActorId,
        origin.committedAt,
        { campaignTimestamp: origin.campaignTimestamp },
        null,
        1,
      ],
    );
  }
  return { effects, scope, histories };
}

/** Read-only full display data; staged profiles are not active profile versions or played attacks. */
export interface NpcHumanoidPreview {
  readonly kind: 'UNCOMMITTED';
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly sheet: Omit<NpcCleanHumanoidPreview['sheet'], 'input' | 'itemProfiles' | 'stats'> &
    Readonly<{
      input: Omit<NpcCleanHumanoidPreview['sheet']['input'], 'inventory'> &
        Readonly<{ inventory: readonly NpcInventoryRequestEntry[] }>;
      itemProfiles: NpcInventoryPreview['items'];
      preparedDiseaseState?: NpcPreparedDiseaseContribution &
        Readonly<{ currentSkills: NpcHumanoidDiseaseState['currentSkills'] }>;
      stats: NpcStatLayers & Readonly<{ equippedStats: StatBlock }>;
    }>;
}
export function previewNpcHumanoid(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  diseaseSelection: Readonly<{
    assignments: readonly Readonly<{ effectInstanceId: string; diseaseId: DiseaseId }>[];
  }> | null = null,
): NpcHumanoidPreview {
  const components = catalogs.get(catalog);
  if (components === undefined) throw new Error('NPC humanoid: unrecognized source catalog');
  const request = data.record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'compositionProof',
  ]);
  const input = data.record(request.input, [
    'identity',
    'baseStats',
    'symbionts',
    'skills',
    'lifetimeFacts',
    'inventory',
    'initialState',
  ]);
  const inventory = buildNpcInventoryPreview(components.inventoryPublication, input.inventory);
  // The same source guard used by publication proves no equipment or coatings for this current branch.
  const clean = previewNpcCleanHumanoid(components.cleanHumanoid, {
    ...request,
    input: { ...input, inventory: [] },
  });
  const result: NpcHumanoidPreview = data.freeze({
    ...clean,
    sheet: {
      ...clean.sheet,
      input: { ...clean.sheet.input, inventory: inventory.items.map((item) => item.request) },
      itemProfiles: inventory.items,
      stats: { ...clean.sheet.stats, equippedStats: clean.sheet.stats.effectiveStats },
    },
  });
  if (diseaseSelection === null) return result;
  const selection = data.record(diseaseSelection, ['assignments']);
  const prepared = previewNpcDiseaseStatContribution(components.diseaseUnconsciousness, {
    assignments: selection.assignments,
    permanentStats: clean.sheet.stats.permanentStats,
  });
  const effective = prepared.contribution.effectiveStats,
    selected = clean.sheet.input.skills;
  // This clean preview has source-validated initial selections only: no acquired TRAINING facts.
  // CORE-166 preserves original costs while current requirements/capacity use the derived stats.
  const startCapacity = Math.min(selected.capacity, calculateStartSkillSlots(effective));
  const trainingCapacity = Math.min(
    Math.floor(clean.sheet.stats.skillStageStats.W / 2),
    Math.floor(effective.W / 2),
  );
  const currentSkills: NpcHumanoidDiseaseState['currentSkills'] = {
    disabledSkillKeys: selected.learnedSkills
      .filter(
        (skill) =>
          skill.source === 'SELECTED' &&
          components.skills.requirements.some(
            (r) => r.skillKey === skill.skillKey && effective[r.statCode] < r.minValue,
          ),
      )
      .map((skill) => skill.skillKey),
    pools: {
      START: {
        capacity: startCapacity,
        used: selected.used,
        available: Math.max(0, startCapacity - selected.used),
        overfill: Math.max(0, selected.used - startCapacity),
      },
      TRAINING: { capacity: trainingCapacity, used: 0, available: trainingCapacity, overfill: 0 },
    },
  };
  const unconscious = prepared.contribution.unconsciousness.triggers.length !== 0;
  return data.freeze({
    ...result,
    sheet: {
      ...result.sheet,
      stats: { ...result.sheet.stats, effectiveStats: effective, equippedStats: effective },
      capabilities: {
        ...result.sheet.capabilities,
        canPhysicalAct: !unconscious,
        canMentalAct: !unconscious,
        canReact: !unconscious,
        canActiveDefend: !unconscious,
      },
      requiresCampaignTime: prepared.assignments.length !== 0,
      preparedDiseaseState: { ...prepared, currentSkills },
    },
  });
}

/** No allocations, authority decisions, played inventory actions or fake previous events. */
export function buildNpcHumanoidSnapshot(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  initialContext: NpcHumanoidInitialStateContext | null = null,
): NpcHumanoidSnapshot {
  const components = catalogs.get(catalog);
  if (components === undefined) throw new Error('NPC humanoid: unrecognized source catalog');
  const withInitialState = Object.hasOwn(data.record(value), 'initialStateProof');
  const request = data.record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'skillProof',
    'compositionProof',
    'inventoryProof',
    ...(withInitialState ? ['initialStateProof'] : []),
  ]);
  const input = data.record(request.input, [
    'identity',
    'baseStats',
    'symbionts',
    'skills',
    'lifetimeFacts',
    'inventory',
    'initialState',
  ]);
  const initial = data.record(input.initialState, [
    'currentHP',
    'dead',
    'currentTraumas',
    'currentWounds',
    'effectInstances',
    'sourceSpecificStates',
    'deathTimerRollFactOrNull',
  ]);
  const stateProof = withInitialState ? initialStateProof(request.initialStateProof) : null;
  const disease =
    stateProof === null
      ? null
      : diseaseStateInput(
          components,
          data.uuid(request.npcUuid),
          initial.effectInstances,
          stateProof,
          initialContext,
        );
  const publication = buildNpcInventoryPublication(
    components.inventoryPublication,
    request.inventoryProof,
  );
  data.equal(publication.proof.npcUuid, request.npcUuid);
  data.equal(publication.input, input.inventory);
  // The leaf publication proves that every supported item is unequipped and has no active coating.
  // Therefore the existing complete no-item mechanics remain the exact pre-equipment calculation.
  const clean = buildNpcCleanHumanoidSnapshot(components.cleanHumanoid, {
    npcUuid: request.npcUuid,
    owningControllerId: request.owningControllerId,
    input: {
      ...input,
      inventory: [],
      initialState: disease === null ? initial : { ...initial, effectInstances: [] },
    },
    skillProof: request.skillProof,
    compositionProof: request.compositionProof,
  });
  for (const context of clean.derivation.skillProof.contexts)
    for (const fact of context.facts)
      data.equal(
        readNpcInitialSkillFactReference(fact.factId).commitOperationId,
        publication.proof.commitOperationId,
      );
  const result: NpcHumanoidSnapshot = data.freeze({
    format: 'NPC_HUMANOID_V1',
    npcUuid: clean.npcUuid,
    owningControllerId: clean.owningControllerId,
    derivation: { ...clean.derivation, inventoryProof: publication.proof },
    sheet: {
      ...clean.sheet,
      input: { ...clean.sheet.input, inventory: publication.input },
      stats: { ...clean.sheet.stats, equippedStats: clean.sheet.stats.effectiveStats },
      itemProfiles: publication.items,
    },
  });
  if (disease === null || stateProof === null) return result;
  const contribution = deriveNpcDiseaseStatContribution(components.diseaseUnconsciousness, {
    effects: disease.effects,
    permanentStats: result.sheet.stats.permanentStats,
    scope: disease.scope,
    histories: disease.histories,
  });
  const currentSkills = evaluateNpcCurrentSkillAvailability(components.skills, {
    identityKey: result.npcUuid,
    proof: result.derivation.skillProof,
    effectiveStats: contribution.effectiveStats,
  });
  const unconscious = contribution.unconsciousness.triggers.length !== 0;
  return data.freeze({
    ...result,
    derivation: { ...result.derivation, initialStateProof: stateProof },
    sheet: {
      ...result.sheet,
      input: {
        ...result.sheet.input,
        initialState: { ...result.sheet.input.initialState, effectInstances: disease.effects },
      },
      stats: {
        ...result.sheet.stats,
        equippedStats: contribution.effectiveStats,
        effectiveStats: contribution.effectiveStats,
      },
      capabilities: {
        ...result.sheet.capabilities,
        canPhysicalAct: !unconscious,
        canMentalAct: !unconscious,
        canReact: !unconscious,
        canActiveDefend: !unconscious,
      },
      diseaseState: { contribution, currentSkills },
      requiresCampaignTime: disease.effects.length !== 0,
    },
  });
}
/** Historical snapshots keep their original publication proof, including IDs and audit timestamp. */
export function readNpcHumanoidSnapshot(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  initialContext: NpcHumanoidInitialStateContext | null = null,
): NpcHumanoidSnapshot {
  const row = data.record(value, [
    'format',
    'npcUuid',
    'owningControllerId',
    'derivation',
    'sheet',
  ]);
  const withInitialState = Object.hasOwn(data.record(row.derivation), 'initialStateProof');
  const derivation = data.record(row.derivation, [
    'skillProof',
    'compositionProof',
    'inventoryProof',
    ...(withInitialState ? ['initialStateProof'] : []),
  ]);
  const sheet = data.record(row.sheet, [
    'input',
    'stats',
    'symbionts',
    'interactions',
    'itemProfiles',
    'maxHP',
    'capabilities',
    'requiresCampaignTime',
    'combatContext',
    ...(withInitialState ? ['diseaseState'] : []),
  ]);
  const expected = buildNpcHumanoidSnapshot(
    catalog,
    {
      npcUuid: row.npcUuid,
      owningControllerId: row.owningControllerId,
      input: sheet.input,
      skillProof: derivation.skillProof,
      compositionProof: derivation.compositionProof,
      inventoryProof: derivation.inventoryProof,
      ...(withInitialState ? { initialStateProof: derivation.initialStateProof } : {}),
    },
    initialContext,
  );
  data.equal(expected, value);
  return expected;
}
