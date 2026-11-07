import {
  buildNpcOrdinaryHumanoidSnapshot,
  deriveNpcOrdinaryRuntimeBasis,
  npcOrdinaryResultEffectiveLimits,
  previewNpcOrdinaryHumanoid,
  type NpcOrdinaryHumanoidCatalog,
} from './npc-ordinary-humanoid-sheet.js';
import {
  npcOrdinaryInventoryIsStatNeutral,
  type NpcOrdinaryHumanoidProof,
} from './ordinary-humanoid-proof.js';
import type { DiseaseId } from '@generated/types/effects.js';
import {
  deriveNpcHumanoidLifeBoundary,
  previewNpcHumanoidLifeBoundary,
  readNpcHumanoidLifeBoundary,
  readNpcHumanoidLifeProof,
  type NpcHumanoidLifeBoundary,
  type NpcHumanoidLifeCatalogs,
  type NpcHumanoidLifeContext,
  type NpcHumanoidLifePreview,
  type NpcHumanoidLifeProof,
} from './humanoid-life-boundary.js';
export type {
  NpcHumanoidLifeContext,
  NpcHumanoidLifePreview,
  NpcHumanoidLifeProof,
  NpcHumanoidWeaverEffectContext,
} from './humanoid-life-boundary.js';
import {
  deriveNpcInitialTraumaConsequences,
  previewNpcInitialTraumaConsequences,
  readNpcInitialTraumaFact,
  type NpcInitialTraumaCatalog,
  type NpcInitialTraumaFact,
  type NpcInitialTraumaEvidence,
  type NpcInitialTraumaDerivationBoundary,
  type NpcInitialTraumaCalendarAnchor,
  type NpcInitialTraumaChoice,
  type NpcInitialTraumaContribution,
  type NpcInitialTraumaScope,
} from './initial-trauma.js';
import type { NpcTraumaInstance } from './effect-types.js';
import type { NpcWoundInstance } from './effect-types.js';
import { readNpcWoundInstance } from './wound-instances.js';
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
  deriveNpcDiseaseEquippedStatContribution,
  previewNpcDiseaseEquippedStatContribution,
  type NpcPreparedDiseaseContribution,
  type NpcDiseaseStatContribution,
  type NpcDiseaseUnconsciousnessCatalog,
} from './disease-unconsciousness.js';
import {
  evaluateNpcCurrentSkillAvailability,
  type NpcOrdinarySkillPreview,
} from './skill-evaluation.js';
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
  deriveNpcCustomItemContribution,
  type NpcInventoryPreview,
  npcPublicationData as data,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationProof,
  type NpcInventoryPublicationContext,
} from './inventory-publication.js';
import {
  assertNpcInventoryCoatingTarget,
  type NpcInventoryCoatingContext,
} from './formal-poison-coating.js';
import {
  assertNpcPoisonSourceCatalog,
  type NpcPoisonSourceCatalog,
} from './formal-poison-source.js';
import {
  deriveNpcInitialTaipanModeStates,
  readNpcHumanoidPoisonProof,
  npcHumanoidPoisonProofForTarget,
  type NpcHumanoidPoisonContext,
  type NpcHumanoidPoisonProof,
  type NpcInitialTaipanModeState,
} from './taipan-mode-state.js';
export type { NpcHumanoidPoisonContext, NpcHumanoidPoisonProof } from './taipan-mode-state.js';
import type { NpcDerivedSheet, NpcStatLayers } from './types.js';
import type { NpcAlcoholCodecCatalog } from './alcohol-effects.js';
import {
  npcHpModeStatProfileForComponent,
  type NpcCombinedHpModeCatalog,
} from './combined-hp-modes.js';
import type { NpcAlcoholPoisonResponseCatalog } from './alcohol-response.js';
import {
  npcFormalControlRestriction,
  type NpcFormalControlCatalog,
  type NpcFormalControlEffectInstance,
} from './formal-control-effects.js';
import {
  deriveNpcFormalControlComposition,
  type NpcFormalControlComposition,
  type NpcFormalControlCompositionCatalog,
} from './formal-control-composition.js';
import {
  deriveNpcHumanoidRuntimeState,
  readNpcHumanoidRuntimeEffectProof,
  type NpcHumanoidRuntimeEffectProof,
  type NpcHumanoidRuntimeEffectContext,
  type NpcHumanoidRuntimeState,
} from './runtime-effect-state.js';
import {
  deriveNpcHumanoidRuntimePreview,
  type NpcHumanoidRuntimeEffectPreview,
  type NpcHumanoidRuntimePreviewState,
} from './runtime-effect-preview.js';
export type { NpcHumanoidRuntimeEffectPreview } from './runtime-effect-preview.js';
export type {
  NpcHumanoidRuntimeEffectProof,
  NpcHumanoidRuntimeEffectContext,
} from './runtime-effect-state.js';
import {
  deriveNpcEquipmentProfile,
  deriveNpcEquipmentRequirementPenalties,
  type NpcEquipmentCatalog,
  type NpcEquipmentProfile,
  type NpcArmorCompatibilityProof,
  type NpcEquipmentRequirementPenalties,
} from './equipment-profile.js';

export interface NpcHumanoidComponents {
  readonly poisonSource?: NpcPoisonSourceCatalog;
  readonly life?: NpcHumanoidLifeCatalogs;
  readonly runtimeEffects?: Readonly<{
    alcohol: NpcAlcoholCodecCatalog;
    hpModes: NpcCombinedHpModeCatalog;
    poisonResponse: NpcAlcoholPoisonResponseCatalog;
    formalControls?: NpcFormalControlCatalog;
    formalControlComposition?: NpcFormalControlCompositionCatalog;
  }>;
  readonly equipment?: NpcEquipmentCatalog;
  readonly ordinaryHumanoid?: NpcOrdinaryHumanoidCatalog;
  readonly initialTrauma?: NpcInitialTraumaCatalog;
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
    ...(Object.hasOwn(components, 'initialTrauma') ? ['initialTrauma'] : []),
    ...(Object.hasOwn(components, 'ordinaryHumanoid') ? ['ordinaryHumanoid'] : []),
    ...(Object.hasOwn(components, 'equipment') ? ['equipment'] : []),
    ...(Object.hasOwn(components, 'runtimeEffects') ? ['runtimeEffects'] : []),
    ...(Object.hasOwn(components, 'life') ? ['life'] : []),
    ...(Object.hasOwn(components, 'poisonSource') ? ['poisonSource'] : []),
  ]);
  if (components.poisonSource !== undefined) assertNpcPoisonSourceCatalog(components.poisonSource);
  if (components.life !== undefined)
    data.record(components.life, [
      'formalLife',
      'functionalDuplicate',
      ...(Object.hasOwn(components.life, 'formalWeaver') ? ['formalWeaver'] : []),
    ]);
  if (components.runtimeEffects !== undefined)
    data.record(components.runtimeEffects, [
      'alcohol',
      'hpModes',
      'poisonResponse',
      ...(Object.hasOwn(components.runtimeEffects, 'formalControls') ? ['formalControls'] : []),
      ...(Object.hasOwn(components.runtimeEffects, 'formalControlComposition')
        ? ['formalControlComposition']
        : []),
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
  readonly initialPoisonProof?: NpcHumanoidPoisonProof;
  readonly initialLifeProof?: NpcHumanoidLifeProof;
  readonly initialRuntimeProof?: NpcHumanoidRuntimeEffectProof;
  readonly initialWoundProof?: NpcHumanoidWoundProof;
  readonly equipmentProof?: NpcHumanoidEquipmentProof;
  readonly ordinaryProof?: NpcOrdinaryHumanoidProof;
  readonly inventoryProof: NpcInventoryPublicationProof;
  readonly initialStateProof?: NpcHumanoidInitialStateProof;
  readonly initialTraumaProof?: NpcHumanoidTraumaProof;
}
/** One complete humanoid format; unsupported combinations fail before this result exists. */
export interface NpcHumanoidSnapshot {
  readonly format: 'NPC_HUMANOID_V1';
  readonly npcUuid: string;
  readonly owningControllerId: string;
  readonly derivation: NpcCleanHumanoidSnapshot['derivation'] &
    Readonly<{
      inventoryProof: NpcInventoryPublicationProof;
      initialPoisonProof?: NpcHumanoidPoisonProof;
      initialLifeProof?: NpcHumanoidLifeProof;
      initialRuntimeProof?: NpcHumanoidRuntimeEffectProof;
      initialWoundProof?: NpcHumanoidWoundProof;
      equipmentProof?: NpcHumanoidEquipmentProof;
      ordinaryProof?: NpcOrdinaryHumanoidProof;
      initialStateProof?: NpcHumanoidInitialStateProof;
      initialTraumaProof?: NpcHumanoidTraumaProof;
    }>;
  readonly sheet: Omit<NpcDerivedSheet, 'stats'> &
    Readonly<{
      stats: NpcStatLayers & Readonly<{ equippedStats: StatBlock }>;
      diseaseState?: NpcHumanoidDiseaseState;
      traumaState?: NpcInitialTraumaContribution;
      equipmentState?: NpcEquipmentProfile;
      equipmentRequirements?: NpcEquipmentRequirementPenalties;
      currentSkills?: NpcHumanoidDiseaseState['currentSkills'];
      runtimeState?: Readonly<Pick<NpcHumanoidRuntimeState, 'hpModesOrNull'>>;
      sourceControlState?: NpcHumanoidSourceControlState;
    }>;
}
export interface NpcHumanoidSourceControlState {
  readonly formalControls: readonly Readonly<{
    effectInstanceId: string;
    restriction: ReturnType<typeof npcFormalControlRestriction>;
  }>[];
  readonly automaticAdviserOrNull: NpcFormalControlComposition['automaticAdviserOrNull'];
}

/** The supported whole sheet proves physical state; a source override never accepts a caller flag. */
function applySourceControl<T extends NpcHumanoidSnapshot | NpcHumanoidPreview>(
  catalog: NpcHumanoidCatalog,
  request: Record<string, unknown>,
  snapshot: T,
): T {
  const components =
    catalogs.get(catalog) ??
    (() => {
      throw new Error('NPC humanoid: source catalog required');
    })();
  const preview = 'kind' in snapshot ? snapshot : null;
  const saved = 'format' in snapshot ? snapshot : null;
  const effects =
    preview?.sheet.preparedRuntimeState?.effects ??
    snapshot.sheet.input.initialState.effectInstances;
  const controls = effects.filter(
    (effect): effect is NpcFormalControlEffectInstance =>
      effect.effectTypeId === 'EFF-CONSCIOUS-SLEEP' ||
      effect.effectTypeId === 'EFF-CONTROL-PARALYSIS',
  );
  const sleep = controls.some((effect) => effect.payload.controlKind === 'SLEEP');
  const paralysis = controls.some((effect) => effect.payload.controlKind === 'PARALYSIS');
  const trauma = snapshot.sheet.traumaState;
  const stunned = trauma?.headStuns.some((stun) => stun.activeNow) === true;
  const disease =
    preview?.sheet.preparedDiseaseState?.contribution ?? saved?.sheet.diseaseState?.contribution;
  const diseaseUnconscious = (disease?.unconsciousness.triggers.length ?? 0) > 0;
  const cognitionLost = sleep || stunned || diseaseUnconscious;
  const hasAdviser = snapshot.sheet.symbionts.some(
    (member) =>
      member.speciesKey === 'ADVISER' &&
      member.effectsEnabled &&
      member.learnedNodeRefs.includes('SYM-100'),
  );
  if (controls.length === 0 && (!cognitionLost || !hasAdviser)) return snapshot;
  const compositionCatalog = components.runtimeEffects?.formalControlComposition;
  if (compositionCatalog === undefined)
    throw new Error('NPC humanoid: actual formal control composition catalog required');
  const composition = deriveNpcFormalControlComposition(
    compositionCatalog,
    request.compositionProof,
  );
  data.equal(snapshot.npcUuid, composition.npcUuid);
  if (controls.length !== 0 && composition.poisonControlResponse === 'IMMUNE')
    throw new Error('NPC humanoid: current source is immune to selected decoction control');
  const formalControls = controls.map((effect) => {
    const source = components.runtimeEffects?.formalControls;
    if (source === undefined)
      throw new Error('NPC humanoid: formal control source catalog required');
    return {
      effectInstanceId: effect.effectInstanceId,
      restriction: npcFormalControlRestriction(source, effect.payload.controlKind),
    };
  });
  // This closed initial humanoid branch already rejects severe/dead/unknown source-specific
  // states. Physical paralysis remains stronger than an Advisor's automatic control.
  const adviser =
    cognitionLost &&
    !paralysis &&
    snapshot.sheet.input.initialState.currentHP > 0 &&
    !snapshot.sheet.input.initialState.dead
      ? composition.automaticAdviserOrNull
      : null;
  const current = snapshot.sheet.capabilities;
  const disabled = sleep || paralysis;
  return data.freeze({
    ...snapshot,
    sheet: {
      ...snapshot.sheet,
      capabilities: {
        ...current,
        canPhysicalAct: adviser !== null ? true : disabled ? false : current.canPhysicalAct,
        canMentalAct:
          adviser !== null
            ? true
            : sleep || current.canMentalAct === false
              ? false
              : paralysis
                ? ('CONDITIONAL_NO_SPEECH_MOVEMENT_BODY' as const)
                : current.canMentalAct,
        canReact: adviser !== null ? true : disabled ? false : current.canReact,
        canActiveDefend: adviser !== null ? true : disabled ? false : current.canActiveDefend,
        effectiveControllerId: adviser?.cardId ?? current.effectiveControllerId,
      },
      sourceControlState: { formalControls, automaticAdviserOrNull: adviser },
    },
  });
}

function lifeCatalogs(catalog: NpcHumanoidCatalog): NpcHumanoidLifeCatalogs {
  return (
    catalogs.get(catalog)?.life ??
    (() => {
      throw new Error('NPC humanoid: checked life source catalogs required');
    })()
  );
}
function stripLifeInput(value: unknown, boundary: NpcHumanoidLifeBoundary, saved: boolean) {
  const request = data.record(value),
    input = data.record(request.input),
    initial = data.record(input.initialState);
  const { state, temporaryWeaverEffects } = readNpcHumanoidLifeBoundary(boundary);
  const selected = data.array(initial.effectInstances);
  const timers = selected.filter((e) => data.record(e).effectTypeId === 'EFF-LIFE-DEATH_TIMER');
  const isWeaver = (e: unknown) => {
    const row = data.record(e);
    return (
      row.effectTypeId === 'EFF-CAPABILITY-SEVERE_WOUND' ||
      row.effectTypeId === 'EFF-PROTECTION-SEVERE_WOUND'
    );
  };
  const weavers = selected.filter(isWeaver);
  const other = selected.filter(
    (e) => !isWeaver(e) && data.record(e).effectTypeId !== 'EFF-LIFE-DEATH_TIMER',
  );
  if (saved) {
    data.equal([state], initial.sourceSpecificStates);
    data.equal(state.anchor.severeWoundOrNull?.rollFact ?? null, initial.deathTimerRollFactOrNull);
    data.equal(state.deathTimerOrNull === null ? [] : [state.deathTimerOrNull], timers);
    data.equal(temporaryWeaverEffects, weavers);
    data.equal([...other, ...weavers, ...timers], selected);
  } else {
    data.equal([], initial.sourceSpecificStates);
    data.equal(null, initial.deathTimerRollFactOrNull);
    data.equal([], timers);
    data.equal([], weavers);
  }
  data.equal(state.dead, initial.dead);
  if (state.dead && selected.length !== 0)
    throw new Error(
      'NPC humanoid: DEAD effects require independently proven source-specific corpse treatment',
    );
  return {
    ...Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'initialLifeProof')),
    input: {
      ...input,
      initialState: {
        ...initial,
        sourceSpecificStates: [],
        deathTimerRollFactOrNull: null,
        effectInstances: other,
      },
    },
  };
}
function finishLife<T extends NpcHumanoidSnapshot | NpcHumanoidPreview>(
  snapshot: T,
  boundary: NpcHumanoidLifeBoundary,
  proof: NpcHumanoidLifeProof | null,
): T {
  const { state, temporaryWeaverEffects } = readNpcHumanoidLifeBoundary(boundary),
    current = snapshot.sheet.capabilities;
  const restriction = state.restrictionOrNull;
  const active = restriction === null || restriction.physicalActions === 'YES';
  const mental = restriction === null || restriction.mentalActions === 'YES';
  return data.freeze({
    ...snapshot,
    ...('derivation' in snapshot && proof !== null
      ? { derivation: { ...snapshot.derivation, initialLifeProof: proof } }
      : {}),
    sheet: {
      ...snapshot.sheet,
      input: {
        ...snapshot.sheet.input,
        initialState: {
          ...snapshot.sheet.input.initialState,
          dead: state.dead,
          sourceSpecificStates: [state],
          deathTimerRollFactOrNull: state.anchor.severeWoundOrNull?.rollFact ?? null,
          effectInstances: [
            ...snapshot.sheet.input.initialState.effectInstances,
            ...temporaryWeaverEffects,
            ...(state.deathTimerOrNull === null ? [] : [state.deathTimerOrNull]),
          ],
        },
      },
      capabilities: {
        ...current,
        canPhysicalAct: active && current.canPhysicalAct,
        canMentalAct: mental ? current.canMentalAct : false,
        canReact: (restriction === null || restriction.reactions === 'YES') && current.canReact,
        canActiveDefend:
          (restriction === null || restriction.activeDefense === 'YES') && current.canActiveDefend,
        effectiveControllerId: state.dead ? null : current.effectiveControllerId,
      },
      requiresCampaignTime:
        snapshot.sheet.requiresCampaignTime ||
        state.lifeKind === 'SEVERELY_WOUNDED' ||
        temporaryWeaverEffects.length !== 0,
    },
  });
}
interface PoisonLayer {
  readonly value: unknown;
  readonly states: readonly NpcInitialTaipanModeState[];
  readonly proof: NpcHumanoidPoisonProof | null;
  readonly coatingContext: NpcInventoryCoatingContext | null;
}
function preparePoisonLayer(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  context: NpcHumanoidPoisonContext | null,
  saved: boolean,
): PoisonLayer | null {
  const request = data.record(value);
  if (context === null) {
    if (Object.hasOwn(request, 'initialPoisonProof'))
      throw new Error('NPC humanoid: independent poison context required');
    return null;
  }
  const source = catalogs.get(catalog)?.poisonSource;
  if (source === undefined)
    throw new Error('NPC humanoid: delivered poison source catalog required');
  data.equal(data.uuid(request.npcUuid), context.npcUuid);
  const states = deriveNpcInitialTaipanModeStates(source, request.compositionProof, context);
  let proof: NpcHumanoidPoisonProof | null = null;
  if (saved) {
    const commitOperationId = data.uuid(data.record(request.inventoryProof).commitOperationId);
    data.equal(commitOperationId, context.targetCommitOperationIdOrNull);
    proof = readNpcHumanoidPoisonProof(request.initialPoisonProof);
    data.equal(npcHumanoidPoisonProofForTarget(states, commitOperationId), proof);
  } else {
    if (Object.hasOwn(request, 'initialPoisonProof'))
      throw new Error('NPC humanoid: preview cannot invent a poison COMMIT');
    data.equal(null, context.targetCommitOperationIdOrNull);
  }
  const input = data.record(request.input),
    initial = data.record(input.initialState),
    all = data.array(initial.sourceSpecificStates);
  const isMode = (value: unknown) =>
    data.record(value).kind === 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE';
  const selected = all.filter(isMode),
    other = all.filter((value) => !isMode(value));
  data.equal(saved ? states : [], selected);
  if (saved) data.equal([...other, ...states], all);
  return {
    states,
    proof,
    coatingContext: context.coatingContext,
    value: {
      ...Object.fromEntries(
        Object.entries(request).filter(([key]) => key !== 'initialPoisonProof'),
      ),
      input: { ...input, initialState: { ...initial, sourceSpecificStates: other } },
    },
  };
}
function finishPoison<T extends NpcHumanoidSnapshot | NpcHumanoidPreview>(
  snapshot: T,
  layer: PoisonLayer | null,
): T {
  if (layer === null) return snapshot;
  return data.freeze({
    ...snapshot,
    ...(layer.proof === null
      ? {}
      : {
          derivation: {
            ...(snapshot as NpcHumanoidSnapshot).derivation,
            initialPoisonProof: layer.proof,
          },
        }),
    sheet: {
      ...snapshot.sheet,
      input: {
        ...snapshot.sheet.input,
        initialState: {
          ...snapshot.sheet.input.initialState,
          sourceSpecificStates: [
            ...snapshot.sheet.input.initialState.sourceSpecificStates,
            ...layer.states,
          ],
        },
      },
    },
  });
}
function assertPoisonTarget(
  value: unknown,
  layer: PoisonLayer | null,
  boundary: NpcHumanoidLifeBoundary | null,
): void {
  if (layer?.coatingContext === null || layer === null) return;
  const request = data.record(value);
  assertNpcInventoryCoatingTarget(layer.coatingContext, {
    npcUuid: data.uuid(request.npcUuid),
    compositionProof: request.compositionProof,
    lifeStateOrNull: boundary === null ? null : readNpcHumanoidLifeBoundary(boundary).state,
  });
}
/** A separate actual life origin widens HP=0 without substituting a positive resource. */
export function buildNpcHumanoidSnapshot(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  initialContext: NpcHumanoidInitialStateContext | null = null,
  traumaContext: NpcHumanoidTraumaContext | null = null,
  equipmentContext: NpcHumanoidEquipmentContext | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimeContext: NpcHumanoidRuntimeEffectContext | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifeContext: NpcHumanoidLifeContext | null = null,
  poisonContext: NpcHumanoidPoisonContext | null = null,
): NpcHumanoidSnapshot {
  const poison = preparePoisonLayer(catalog, value, poisonContext, true);
  value = poison?.value ?? value;
  const coatingContext = poison?.coatingContext ?? null;
  const request = data.record(value),
    withLife = Object.hasOwn(request, 'initialLifeProof');
  if (!withLife) {
    if (lifeContext !== null) throw new Error('NPC humanoid: orphan life context');
    assertPoisonTarget(value, poison, null);
    return finishPoison(
      buildHumanoidWithTrauma(
        catalog,
        value,
        initialContext,
        traumaContext,
        equipmentContext,
        woundContext,
        runtimeContext,
        inventoryContext,
        null,
        coatingContext,
      ),
      poison,
    );
  }
  if (lifeContext === null)
    throw new Error('NPC humanoid: independent life origin context required');
  const proof = readNpcHumanoidLifeProof(request.initialLifeProof);
  data.equal(proof.commitOperationId, data.record(request.inventoryProof).commitOperationId);
  const currentHP = data.record(data.record(request.input).initialState).currentHP;
  if (typeof currentHP !== 'number') throw new Error('NPC humanoid: explicit HP required');
  const boundary = deriveNpcHumanoidLifeBoundary(lifeCatalogs(catalog), {
    npcUuid: data.uuid(request.npcUuid),
    compositionProof: request.compositionProof,
    currentHP,
    proof,
    context: lifeContext,
  });
  const normalized = stripLifeInput(value, boundary, true);
  assertPoisonTarget(value, poison, boundary);
  return finishPoison(
    finishLife(
      buildHumanoidWithTrauma(
        catalog,
        normalized,
        initialContext,
        traumaContext,
        equipmentContext,
        woundContext,
        runtimeContext,
        inventoryContext,
        boundary,
        coatingContext,
      ),
      boundary,
      proof,
    ),
    poison,
  );
}
export function previewNpcHumanoid(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  diseaseSelection: Readonly<{
    assignments: readonly Readonly<{ effectInstanceId: string; diseaseId: DiseaseId }>[];
  }> | null = null,
  trauma: NpcHumanoidTraumaPreview | null = null,
  equipment: Readonly<{
    proof: NpcHumanoidEquipmentProof | null;
    context: NpcHumanoidEquipmentContext | null;
  }> | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimePreview: NpcHumanoidRuntimeEffectPreview | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifePreview: NpcHumanoidLifePreview | null = null,
  poisonContext: NpcHumanoidPoisonContext | null = null,
): NpcHumanoidPreview {
  const poison = preparePoisonLayer(catalog, value, poisonContext, false);
  value = poison?.value ?? value;
  const coatingContext = poison?.coatingContext ?? null;
  if (lifePreview === null) {
    assertPoisonTarget(value, poison, null);
    return finishPoison(
      previewHumanoidWithTrauma(
        catalog,
        value,
        diseaseSelection,
        trauma,
        equipment,
        woundContext,
        runtimePreview,
        inventoryContext,
        null,
        coatingContext,
      ),
      poison,
    );
  }
  const request = data.record(value),
    currentHP = data.record(data.record(request.input).initialState).currentHP;
  if (Object.hasOwn(request, 'initialLifeProof'))
    throw new Error('NPC humanoid: preview cannot invent a saved life COMMIT');
  if (typeof currentHP !== 'number') throw new Error('NPC humanoid: explicit HP required');
  const boundary = previewNpcHumanoidLifeBoundary(lifeCatalogs(catalog), {
    npcUuid: data.uuid(request.npcUuid),
    compositionProof: request.compositionProof,
    currentHP,
    context: lifePreview,
  });
  if (
    readNpcHumanoidLifeBoundary(boundary).state.dead &&
    ((diseaseSelection?.assignments.length ?? 0) !== 0 ||
      (runtimePreview?.alcohol.length ?? 0) !== 0 ||
      (runtimePreview?.hpModes.length ?? 0) !== 0 ||
      (runtimePreview?.formalControls?.length ?? 0) !== 0)
  )
    throw new Error(
      'NPC humanoid: DEAD effects require independently proven source-specific corpse treatment',
    );
  const normalized = stripLifeInput(value, boundary, false);
  assertPoisonTarget(value, poison, boundary);
  return finishPoison(
    finishLife(
      previewHumanoidWithTrauma(
        catalog,
        normalized,
        diseaseSelection,
        trauma,
        equipment,
        woundContext,
        runtimePreview,
        inventoryContext,
        boundary,
        coatingContext,
      ),
      boundary,
      null,
    ),
    poison,
  );
}

export interface NpcHumanoidWoundProof {
  readonly assignments: readonly Readonly<{ woundInstanceId: string; originOperationId: string }>[];
}
export interface NpcHumanoidWoundContext {
  readonly npcUuid: string;
  readonly facts: readonly Readonly<{
    kind: 'GM_WOUND_ASSIGNMENT';
    npcUuid: string;
    sourceOperationId: string;
    wound: NpcWoundInstance;
  }>[];
}
function initialWoundProof(value: unknown): NpcHumanoidWoundProof {
  const row = data.record(value, ['assignments']);
  const assignments = data.array(row.assignments).map((value) => {
    const r = data.record(value, ['woundInstanceId', 'originOperationId']);
    return {
      woundInstanceId: data.uuid(r.woundInstanceId),
      originOperationId: data.uuid(r.originOperationId),
    };
  });
  if (new Set(assignments.map((a) => a.woundInstanceId)).size !== assignments.length)
    throw new Error('NPC humanoid: repeated wound assignment');
  return { assignments };
}
function readWoundContext(value: unknown): NpcHumanoidWoundContext {
  const row = data.record(value, ['npcUuid', 'facts']);
  return {
    npcUuid: data.uuid(row.npcUuid),
    facts: data.array(row.facts).map((raw) => {
      const fact = data.record(raw, ['kind', 'npcUuid', 'sourceOperationId', 'wound']);
      data.equal('GM_WOUND_ASSIGNMENT', fact.kind);
      return {
        kind: 'GM_WOUND_ASSIGNMENT',
        npcUuid: data.uuid(fact.npcUuid),
        sourceOperationId: data.uuid(fact.sourceOperationId),
        wound: readNpcWoundInstance({ anatomyProfileId: 'STANDARD_HUMANOID' }, fact.wound),
      };
    }),
  };
}
function checkedInitialWounds(
  npcUuid: string,
  anatomyProfileId: unknown,
  value: unknown,
  proof: NpcHumanoidWoundProof | null,
  context: NpcHumanoidWoundContext | null,
): readonly NpcWoundInstance[] | null {
  if (proof === null) {
    if (data.array(value).length !== 0)
      throw new Error('NPC humanoid: original wound proof required');
    if (context !== null) {
      const checked = readWoundContext(context);
      data.equal(npcUuid, checked.npcUuid);
      if (checked.facts.length !== 0)
        throw new Error('NPC humanoid: selected wound origin cannot be omitted');
    }
    return null;
  }
  if (context === null) throw new Error('NPC humanoid: independent wound origin context required');
  const checkedContext = readWoundContext(context);
  data.equal(npcUuid, checkedContext.npcUuid);
  if (anatomyProfileId !== 'STANDARD_HUMANOID')
    throw new Error('NPC humanoid: wound anatomy required');
  const facts = data.array(checkedContext.facts).map((raw) => {
    const r = data.record(raw, ['kind', 'npcUuid', 'sourceOperationId', 'wound']);
    data.equal('GM_WOUND_ASSIGNMENT', r.kind);
    data.equal(npcUuid, data.uuid(r.npcUuid));
    return {
      sourceOperationId: data.uuid(r.sourceOperationId),
      wound: readNpcWoundInstance({ anatomyProfileId }, r.wound),
    };
  });
  data.equal(
    proof.assignments,
    facts.map((f) => ({
      woundInstanceId: f.wound.woundInstanceId,
      originOperationId: f.sourceOperationId,
    })),
  );
  const wounds = facts.map((f) => f.wound);
  data.equal(wounds, value);
  return wounds;
}

export interface NpcHumanoidEquipmentProof {
  readonly compatibilityProofOrNull: NpcArmorCompatibilityProof | null;
}
/** Separate original journal evidence; the candidate cannot approve its own layered equipment. */
export interface NpcHumanoidEquipmentContext {
  readonly npcUuid: string;
  readonly confirmations: readonly NpcArmorCompatibilityProof[];
}
export class NpcEquipmentValidationError extends Error {
  constructor(
    readonly code: 'COMPATIBILITY_REQUIRED' | 'EQUIPPED_STAT_MINIMUM',
    detail: string,
  ) {
    super(detail);
    this.name = new.target.name;
  }
}
function equipmentState(
  components: NpcHumanoidComponents,
  request: Record<string, unknown>,
  input: Record<string, unknown>,
  inventory: NpcInventoryPreview,
  proof: NpcHumanoidEquipmentProof | null,
  context: NpcHumanoidEquipmentContext | null,
): NpcEquipmentProfile | null {
  const hasEquipped = inventory.items.some((item) => item.request.equipped);
  const hasActiveCustomItem = deriveNpcCustomItemContribution(
    components.inventoryPublication,
    inventory,
  ).items.some((item) => item.active);
  if (data.record(input.identity).raceCode !== 'PURE') {
    const ordinary = data.record(request.ordinaryProof);
    const current = data.record(data.array(ordinary.statContexts).at(-1));
    if (
      hasEquipped ||
      hasActiveCustomItem ||
      !npcOrdinaryInventoryIsStatNeutral(
        components.inventoryPublication,
        current.equippedInventory ?? [],
      )
    )
      data.equal(
        inventory.items.map((item) => item.request),
        current.equippedInventory,
      );
  }
  if (!hasEquipped && !hasActiveCustomItem) {
    if (proof !== null) throw new Error('NPC humanoid: equipment proof has no equipped loadout');
    return null;
  }
  if (components.equipment === undefined)
    throw new Error('NPC humanoid: equipment source catalog required');
  const identity = data.record(input.identity),
    npcUuid = data.uuid(request.npcUuid);
  const result = deriveNpcEquipmentProfile(components.equipment, {
    npcUuid,
    statInput: {
      schema: {
        raceCode: identity.raceCode,
        pureClassOrNull: identity.pureClassOrNull,
        sex: identity.sex,
        massKg: identity.massKg,
        anatomyProfileId: identity.anatomyProfileId,
      },
      baseStats: input.baseStats,
      ...(identity.raceCode === 'PURE' ? {} : { compositionProof: request.compositionProof }),
    },
    inventoryPreview: inventory,
    compatibilityProofOrNull: proof?.compatibilityProofOrNull ?? null,
  });
  validateEquippedStatMinimum(result.equippedStats);
  if (result.compatibilityProofOrNull !== null) {
    if (context === null)
      throw new Error('NPC humanoid: original equipment confirmation context required');
    data.record(context, ['npcUuid', 'confirmations']);
    data.equal(npcUuid, data.uuid(context.npcUuid));
    const matches = data
      .array(context.confirmations)
      .filter(
        (raw) =>
          data.record(raw).confirmationId === result.compatibilityProofOrNull?.confirmationId,
      );
    if (matches.length !== 1)
      throw new Error('NPC humanoid: unique original equipment confirmation required');
    data.equal(result.compatibilityProofOrNull, matches[0]);
  }
  return result;
}
function equipmentProof(value: unknown): NpcHumanoidEquipmentProof {
  const row = data.record(value, ['compatibilityProofOrNull']);
  if (row.compatibilityProofOrNull === null) return { compatibilityProofOrNull: null };
  const proof = data.record(row.compatibilityProofOrNull, [
    'confirmationId',
    'npcUuid',
    'itemInstanceIds',
    'reason',
  ]);
  return {
    compatibilityProofOrNull: {
      confirmationId: data.text(proof.confirmationId),
      npcUuid: data.uuid(proof.npcUuid),
      itemInstanceIds: data.array(proof.itemInstanceIds).map(data.uuid),
      reason: data.text(proof.reason),
    },
  };
}
function validateEquippedRequirements(
  equipment: NpcEquipmentProfile | null,
  stats: StatBlock,
): void {
  if (equipment === null) return;
  validateEquippedStatMinimum(stats);
  if (equipment.compatibilityRequired)
    throw new NpcEquipmentValidationError(
      'COMPATIBILITY_REQUIRED',
      'NPC humanoid: physical armor compatibility confirmation required',
    );
}
function equipmentRequirements(
  components: NpcHumanoidComponents,
  inventory: NpcInventoryPreview,
  stats: StatBlock,
): NpcEquipmentRequirementPenalties {
  if (components.equipment === undefined)
    throw new Error('NPC humanoid: equipment source catalog required');
  return deriveNpcEquipmentRequirementPenalties(components.equipment, {
    inventoryPreview: inventory,
    effectiveStats: stats,
  });
}
function validateEquippedStatMinimum(stats: StatBlock): void {
  for (const [key, value] of Object.entries(stats))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new NpcEquipmentValidationError(
        'EQUIPPED_STAT_MINIMUM',
        `NPC humanoid: equipped ${key} must be a safe integer at least one`,
      );
}

export interface NpcHumanoidTraumaProof {
  readonly commitOperationId: string;
  readonly facts: readonly NpcInitialTraumaFact[];
}
export interface NpcHumanoidTraumaContext {
  readonly scope: NpcInitialTraumaScope;
  readonly npcUuid: string;
  readonly commitOperationId: string;
  readonly campaignTimestampOrNull: number | null;
  readonly evidence: readonly NpcInitialTraumaEvidence[];
  readonly boundary: NpcInitialTraumaDerivationBoundary;
}
export interface NpcHumanoidTraumaPreview {
  readonly currentTraumas: readonly NpcTraumaInstance[];
  readonly choices: readonly NpcInitialTraumaChoice[];
  readonly calendarAnchorOrNull: NpcInitialTraumaCalendarAnchor | null;
  readonly retained: Readonly<{
    context: NpcHumanoidTraumaContext;
    facts: readonly NpcInitialTraumaFact[];
  }> | null;
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
      input: Omit<NpcCleanHumanoidPreview['sheet']['input'], 'inventory' | 'skills'> &
        Readonly<{
          inventory: readonly NpcInventoryRequestEntry[];
          skills: NpcCleanHumanoidPreview['sheet']['input']['skills'] | NpcOrdinarySkillPreview;
        }>;
      itemProfiles: NpcInventoryPreview['items'];
      traumaState?: NpcInitialTraumaContribution;
      equipmentState?: NpcEquipmentProfile;
      equipmentRequirements?: NpcEquipmentRequirementPenalties;
      currentSkills?: NpcHumanoidDiseaseState['currentSkills'];
      preparedRuntimeState?: NpcHumanoidRuntimePreviewState;
      sourceControlState?: NpcHumanoidSourceControlState;
      preparedDiseaseState?: NpcPreparedDiseaseContribution &
        Readonly<{ currentSkills: NpcHumanoidDiseaseState['currentSkills'] }>;
      stats: NpcStatLayers & Readonly<{ equippedStats: StatBlock }>;
    }>;
}
function currentPreviewSkills(
  components: NpcHumanoidComponents,
  clean: NpcCleanHumanoidPreview | ReturnType<typeof previewNpcOrdinaryHumanoid>,
  effective: StatBlock,
): NpcHumanoidDiseaseState['currentSkills'] {
  const selected = clean.sheet.input.skills;
  // Current requirements never rewrite the original payment or historical acquisition context.
  const ordinaryPools = 'pools' in selected ? selected.pools : null;
  const startCapacity = Math.min(
    ordinaryPools?.START.capacity ?? selected.capacity,
    calculateStartSkillSlots(effective),
  );
  const trainingCapacity = Math.min(
    ordinaryPools?.TRAINING.capacity ?? Math.floor(clean.sheet.stats.skillStageStats.W / 2),
    Math.floor(effective.W / 2),
  );
  return {
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
      TRAINING: {
        capacity: trainingCapacity,
        used: ordinaryPools?.TRAINING.used ?? 0,
        available: Math.max(0, trainingCapacity - (ordinaryPools?.TRAINING.used ?? 0)),
        overfill: Math.max(0, (ordinaryPools?.TRAINING.used ?? 0) - trainingCapacity),
      },
      ...(ordinaryPools === null ? {} : { 'SYM-166': ordinaryPools['SYM-166'] }),
    },
  };
}
function currentSym166Source(symbionts: NpcDerivedSheet['symbionts']) {
  const source = symbionts.find(
    (s) => s.speciesKey === 'DOLPHIN' && s.effectsEnabled && s.learnedNodeRefs.includes('SYM-166'),
  );
  return source === undefined
    ? null
    : { symbiontInstanceId: source.symbiontInstanceId, nodeRef: 'SYM-166' as const };
}
function previewHumanoidWithoutTrauma(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  diseaseSelection: Readonly<{
    assignments: readonly Readonly<{ effectInstanceId: string; diseaseId: DiseaseId }>[];
  }> | null = null,
  equipmentPreview: Readonly<{
    proof: NpcHumanoidEquipmentProof | null;
    context: NpcHumanoidEquipmentContext | null;
  }> | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimePreview: NpcHumanoidRuntimeEffectPreview | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcHumanoidPreview {
  const components = catalogs.get(catalog);
  if (components === undefined) throw new Error('NPC humanoid: unrecognized source catalog');
  const withOrdinary = Object.hasOwn(data.record(value), 'ordinaryProof');
  const withPreviousSkills = Object.hasOwn(data.record(value), 'previousSkillProofOrNull');
  if (withPreviousSkills && !withOrdinary)
    throw new Error('NPC humanoid: ordinary preview proof required');
  const request = data.record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'compositionProof',
    ...(withOrdinary ? ['ordinaryProof'] : []),
    ...(withPreviousSkills ? ['previousSkillProofOrNull'] : []),
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
  const inventory = buildNpcInventoryPreview(
    components.inventoryPublication,
    input.inventory,
    inventoryContext,
    coatingContext,
  );
  if (inventoryContext !== null)
    for (const previous of inventoryContext.history)
      data.equal(data.uuid(request.npcUuid), previous.npcUuid);
  const initial = data.record(input.initialState);
  const checkedWoundContext = woundContext === null ? null : readWoundContext(woundContext);
  const woundProof =
    checkedWoundContext === null
      ? null
      : initialWoundProof({
          assignments: checkedWoundContext.facts.map((f) => ({
            woundInstanceId: f.wound.woundInstanceId,
            originOperationId: f.sourceOperationId,
          })),
        });
  const wounds = checkedInitialWounds(
    data.uuid(request.npcUuid),
    data.record(input.identity).anatomyProfileId,
    initial.currentWounds,
    woundProof,
    woundContext,
  );
  const equipment = equipmentState(
    components,
    request,
    input,
    inventory,
    equipmentPreview?.proof ?? null,
    equipmentPreview?.context ?? null,
  );
  let runtime: NpcHumanoidRuntimePreviewState | null = null;
  if (runtimePreview !== null) {
    if (components.runtimeEffects === undefined)
      throw new Error('NPC humanoid: runtime source catalogs required');
    data.equal([], initial.effectInstances);
    const identity = data.record(input.identity);
    runtime = deriveNpcHumanoidRuntimePreview(
      components.runtimeEffects,
      {
        context: runtimePreview,
        formalControlCompositionOrNull:
          (runtimePreview.formalControls?.length ?? 0) === 0
            ? null
            : deriveNpcFormalControlComposition(
                components.runtimeEffects.formalControlComposition ??
                  (() => {
                    throw new Error('NPC humanoid: formal control composition source required');
                  })(),
                request.compositionProof,
              ),
        currentHP: initial.currentHP,
        basisInput: {
          npcUuid: data.uuid(request.npcUuid),
          schema: {
            raceCode: identity.raceCode,
            pureClassOrNull: identity.pureClassOrNull,
            sex: identity.sex,
            massKg: identity.massKg,
            anatomyProfileId: identity.anatomyProfileId,
          },
          baseStats: input.baseStats,
          compositionProof: request.compositionProof,
          ordinaryProofOrNull: withOrdinary ? request.ordinaryProof : null,
          inventoryRequests: input.inventory,
          diseaseAssignments: diseaseSelection?.assignments ?? [],
          equipmentProofOrNull: equipmentPreview?.proof ?? null,
          equipmentContextOrNull: equipmentPreview?.context ?? null,
        },
        ordinaryBasisOrNull:
          !withOrdinary || runtimePreview.hpModes.length === 0
            ? null
            : deriveNpcOrdinaryRuntimeBasis(
                components.ordinaryHumanoid ??
                  (() => {
                    throw new Error('NPC humanoid: ordinary HP source catalog required');
                  })(),
                {
                  npcUuid: request.npcUuid,
                  compositionProof: request.compositionProof,
                  ordinaryProof: request.ordinaryProof,
                },
              ),
      },
      inventoryContext,
    );
  }
  const baseRequest = {
    ...request,
    input: {
      ...input,
      inventory: [],
      ...(wounds === null ? {} : { initialState: { ...initial, currentWounds: [] } }),
    },
  };
  const clean = withOrdinary
    ? previewNpcOrdinaryHumanoid(
        components.ordinaryHumanoid ??
          (() => {
            throw new Error('NPC humanoid: ordinary source catalog required');
          })(),
        baseRequest,
        runtime?.hpModesOrNull ?? null,
        lifeBoundary,
      )
    : previewNpcCleanHumanoid(components.cleanHumanoid, baseRequest, lifeBoundary);
  const result: NpcHumanoidPreview = data.freeze({
    ...clean,
    sheet: {
      ...clean.sheet,
      input: {
        ...clean.sheet.input,
        inventory: inventory.items.map((item) => item.request),
        ...(wounds === null
          ? {}
          : { initialState: { ...clean.sheet.input.initialState, currentWounds: wounds } }),
      },
      itemProfiles: inventory.items,
      requiresCampaignTime:
        clean.sheet.requiresCampaignTime ||
        inventory.items.some((item) => item.request.coatingInstanceIds.length !== 0),
      stats: {
        ...clean.sheet.stats,
        equippedStats: equipment?.equippedStats ?? clean.sheet.stats.effectiveStats,
        effectiveStats: equipment?.equippedStats ?? clean.sheet.stats.effectiveStats,
      },
      ...(equipment === null
        ? {}
        : {
            equipmentState: equipment,
            equipmentRequirements: equipmentRequirements(
              components,
              inventory,
              equipment.equippedStats,
            ),
            currentSkills: currentPreviewSkills(components, clean, equipment.equippedStats),
          }),
    },
  });
  const finish = (snapshot: NpcHumanoidPreview): NpcHumanoidPreview =>
    runtime === null
      ? snapshot
      : data.freeze({
          ...snapshot,
          sheet: { ...snapshot.sheet, preparedRuntimeState: runtime, requiresCampaignTime: true },
        });
  const modeStats =
    runtime?.hpModesOrNull == null ? null : npcHpModeStatProfileForComponent(runtime.hpModesOrNull);
  const hunger = modeStats?.hungerStatMultiplier === 2;
  if (diseaseSelection === null && !hunger) {
    validateEquippedRequirements(equipment, result.sheet.stats.effectiveStats);
    return finish(result);
  }
  const selection =
    diseaseSelection === null
      ? { assignments: [] }
      : data.record(diseaseSelection, ['assignments']);
  if (equipment !== null) validateEquippedStatMinimum(equipment.equippedStats);
  const prepared =
    equipment === null
      ? previewNpcDiseaseStatContribution(
          components.diseaseUnconsciousness,
          {
            assignments: selection.assignments,
            permanentStats: clean.sheet.stats.permanentStats,
          },
          modeStats,
          withOrdinary ? npcOrdinaryResultEffectiveLimits(clean) : null,
        )
      : previewNpcDiseaseEquippedStatContribution(
          components.diseaseUnconsciousness,
          {
            assignments: selection.assignments,
            equipmentProfile: equipment,
          },
          modeStats,
        );
  const effective = prepared.contribution.effectiveStats;
  const currentSkills = currentPreviewSkills(components, clean, effective);
  const unconscious = prepared.contribution.unconsciousness.triggers.length !== 0;
  validateEquippedRequirements(equipment, effective);
  return finish(
    data.freeze({
      ...result,
      sheet: {
        ...result.sheet,
        stats: {
          ...result.sheet.stats,
          effectiveStats: effective,
          equippedStats:
            equipment === null
              ? hunger
                ? clean.sheet.stats.permanentStats
                : effective
              : equipment.equippedStats,
        },
        capabilities: {
          ...result.sheet.capabilities,
          canPhysicalAct: !unconscious && result.sheet.capabilities.canPhysicalAct,
          canMentalAct: !unconscious && result.sheet.capabilities.canMentalAct,
          canReact: !unconscious && result.sheet.capabilities.canReact,
          canActiveDefend: !unconscious && result.sheet.capabilities.canActiveDefend,
        },
        requiresCampaignTime:
          result.sheet.requiresCampaignTime || prepared.assignments.length !== 0,
        ...(diseaseSelection === null
          ? {}
          : { preparedDiseaseState: { ...prepared, currentSkills } }),
        ...(equipment === null && !hunger
          ? {}
          : {
              currentSkills,
              equipmentRequirements: equipmentRequirements(components, inventory, effective),
            }),
      },
    }),
  );
}

/** Preview retains old anchors; fresh runtime projections remain explicitly UNCOMMITTED. */
function previewHumanoidWithTrauma(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  diseaseSelection: Readonly<{
    assignments: readonly Readonly<{ effectInstanceId: string; diseaseId: DiseaseId }>[];
  }> | null = null,
  trauma: NpcHumanoidTraumaPreview | null = null,
  equipment: Readonly<{
    proof: NpcHumanoidEquipmentProof | null;
    context: NpcHumanoidEquipmentContext | null;
  }> | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimePreview: NpcHumanoidRuntimeEffectPreview | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcHumanoidPreview {
  if (trauma === null)
    return applySourceControl(
      catalog,
      data.record(value),
      previewHumanoidWithoutTrauma(
        catalog,
        value,
        diseaseSelection,
        equipment,
        woundContext,
        runtimePreview,
        inventoryContext,
        lifeBoundary,
        coatingContext,
      ),
    );
  const source = catalogs.get(catalog)?.initialTrauma;
  if (source === undefined) throw new Error('NPC humanoid: source trauma catalog required');
  const request = data.record(value),
    input = data.record(request.input),
    initial = data.record(input.initialState);
  data.equal(initial.currentTraumas, trauma.currentTraumas);
  const retainedIds = new Set((trauma.retained?.facts ?? []).map((f) => f.trauma.traumaInstanceId));
  const retained = trauma.retained;
  let oldContribution: NpcInitialTraumaContribution | null = null;
  if (retained !== null) {
    if (retained.context.boundary.kind !== 'HISTORICAL')
      throw new Error('NPC humanoid: preview retained history only');
    for (const fact of retained.facts) {
      const current = trauma.currentTraumas.find(
        (t) => t.traumaInstanceId === fact.trauma.traumaInstanceId,
      );
      const choice = trauma.choices.find(
        (c) => c.traumaInstanceId === fact.trauma.traumaInstanceId,
      );
      if (current === undefined || choice === undefined)
        throw new Error('NPC humanoid: unused retained trauma');
      data.equal(current, fact.trauma);
      const c = fact.consequence;
      data.equal(choice, {
        traumaInstanceId: fact.trauma.traumaInstanceId,
        reason: fact.reason,
        consequence:
          c.kind !== 'HEAD' || c.stun.status === 'ABSENT'
            ? c
            : { ...c, stun: { status: 'ACTIVE', remainingMinutes: c.stun.remainingMinutes } },
      });
    }
    oldContribution = deriveNpcInitialTraumaConsequences(
      source,
      {
        scope: retained.context.scope,
        npcUuid: retained.context.npcUuid,
        currentCampaignTimestampOrNull: retained.context.campaignTimestampOrNull,
        currentTraumas: retained.facts.map((f) => f.trauma),
        facts: retained.facts,
        evidence: retained.context.evidence,
      },
      retained.context.boundary,
    );
  }
  const fresh = previewNpcInitialTraumaConsequences(source, {
    currentTraumas: trauma.currentTraumas.filter((t) => !retainedIds.has(t.traumaInstanceId)),
    choices: trauma.choices.filter((c) => !retainedIds.has(c.traumaInstanceId)),
    calendarAnchorOrNull: trauma.calendarAnchorOrNull,
  });
  // Limb totals must be recomputed together: two identities disabling one limb yield one global penalty.
  const totals = previewNpcInitialTraumaConsequences(source, {
    currentTraumas: trauma.currentTraumas,
    choices: trauma.choices.map((c) =>
      c.consequence.kind !== 'HEAD'
        ? c
        : { ...c, consequence: { ...c.consequence, stun: { status: 'ABSENT' as const } } },
    ),
    calendarAnchorOrNull: null,
  });
  const headStuns = trauma.currentTraumas.flatMap((t) =>
    [...(oldContribution?.headStuns ?? []), ...fresh.headStuns].filter(
      (h) => h.traumaInstanceId === t.traumaInstanceId,
    ),
  );
  const contribution = {
    ...totals,
    headStuns,
    requiresCampaignTime:
      fresh.requiresCampaignTime || (oldContribution?.requiresCampaignTime ?? false),
  };
  const result = previewHumanoidWithoutTrauma(
    catalog,
    { ...request, input: { ...input, initialState: { ...initial, currentTraumas: [] } } },
    diseaseSelection,
    equipment,
    woundContext,
    runtimePreview,
    inventoryContext,
    lifeBoundary,
    coatingContext,
  );
  const disabled = headStuns.some((h) => h.activeNow);
  return applySourceControl(
    catalog,
    request,
    data.freeze({
      ...result,
      sheet: {
        ...result.sheet,
        input: {
          ...result.sheet.input,
          initialState: {
            ...result.sheet.input.initialState,
            currentTraumas: trauma.currentTraumas,
          },
        },
        traumaState: contribution,
        requiresCampaignTime:
          result.sheet.requiresCampaignTime || contribution.requiresCampaignTime,
        capabilities: {
          ...result.sheet.capabilities,
          canPhysicalAct: disabled ? false : result.sheet.capabilities.canPhysicalAct,
          canMentalAct: disabled ? false : result.sheet.capabilities.canMentalAct,
          canReact: disabled ? false : result.sheet.capabilities.canReact,
          canActiveDefend: disabled ? false : result.sheet.capabilities.canActiveDefend,
          regionPenaltyById: Object.fromEntries(
            contribution.limbs.map((limb) => [limb.regionId, limb.localCheckPenalty]),
          ),
        },
      },
    }),
  );
}

/** No allocations, authority decisions, played inventory actions or fake previous events. */
function buildHumanoidWithoutTrauma(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  initialContext: NpcHumanoidInitialStateContext | null = null,
  equipmentContext: NpcHumanoidEquipmentContext | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimeContext: NpcHumanoidRuntimeEffectContext | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcHumanoidSnapshot {
  const components = catalogs.get(catalog);
  if (components === undefined) throw new Error('NPC humanoid: unrecognized source catalog');
  const withInitialState = Object.hasOwn(data.record(value), 'initialStateProof');
  const withOrdinary = Object.hasOwn(data.record(value), 'ordinaryProof');
  const withEquipment = Object.hasOwn(data.record(value), 'equipmentProof');
  const withWounds = Object.hasOwn(data.record(value), 'initialWoundProof');
  const withRuntime = Object.hasOwn(data.record(value), 'initialRuntimeProof');
  const request = data.record(value, [
    'npcUuid',
    'owningControllerId',
    'input',
    'skillProof',
    'compositionProof',
    'inventoryProof',
    ...(withOrdinary ? ['ordinaryProof'] : []),
    ...(withInitialState ? ['initialStateProof'] : []),
    ...(withEquipment ? ['equipmentProof'] : []),
    ...(withWounds ? ['initialWoundProof'] : []),
    ...(withRuntime ? ['initialRuntimeProof'] : []),
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
  const selectedEffects = data.array(initial.effectInstances);
  const runtimeSelected = selectedEffects.filter((e) =>
    [
      'EFF-POISON-INSTANCE',
      'EFF-FORM-STANCE',
      'EFF-CONSCIOUS-SLEEP',
      'EFF-CONTROL-PARALYSIS',
    ].includes(data.text(data.record(e).effectTypeId)),
  );
  let runtime: NpcHumanoidRuntimeState | null = null;
  if (withRuntime) {
    if (runtimeContext === null || components.runtimeEffects === undefined)
      throw new Error('NPC humanoid: checked runtime effect context/catalog required');
    runtime = deriveNpcHumanoidRuntimeState(components.runtimeEffects, {
      npcUuid: data.uuid(request.npcUuid),
      formalControlCompositionOrNull:
        (runtimeContext.formalControls?.length ?? 0) === 0
          ? null
          : deriveNpcFormalControlComposition(
              components.runtimeEffects.formalControlComposition ??
                (() => {
                  throw new Error('NPC humanoid: formal control composition source required');
                })(),
              request.compositionProof,
            ),
      currentHP: initial.currentHP,
      effects: runtimeSelected,
      proof: readNpcHumanoidRuntimeEffectProof(request.initialRuntimeProof),
      context: runtimeContext,
      ordinaryBasisOrNull:
        !withOrdinary || runtimeContext.hpModes.length === 0
          ? null
          : deriveNpcOrdinaryRuntimeBasis(
              components.ordinaryHumanoid ??
                (() => {
                  throw new Error('NPC humanoid: ordinary HP source catalog required');
                })(),
              {
                npcUuid: request.npcUuid,
                compositionProof: request.compositionProof,
                ordinaryProof: request.ordinaryProof,
              },
            ),
    });
  } else if (runtimeSelected.length !== 0 || runtimeContext !== null)
    throw new Error('NPC humanoid: runtime effects require exact independent origin references');
  const otherEffects = selectedEffects.filter((e) => !runtimeSelected.includes(e));
  const woundProof = withWounds ? initialWoundProof(request.initialWoundProof) : null;
  const wounds = checkedInitialWounds(
    data.uuid(request.npcUuid),
    data.record(input.identity).anatomyProfileId,
    initial.currentWounds,
    woundProof,
    woundContext,
  );
  const disease =
    stateProof === null
      ? null
      : diseaseStateInput(
          components,
          data.uuid(request.npcUuid),
          otherEffects,
          stateProof,
          initialContext,
        );
  const publication = buildNpcInventoryPublication(
    components.inventoryPublication,
    request.inventoryProof,
    inventoryContext,
    coatingContext,
  );
  data.equal(publication.proof.npcUuid, request.npcUuid);
  data.equal(publication.input, input.inventory);
  const inventory = buildNpcInventoryPreview(
    components.inventoryPublication,
    publication.proof.entries.map((entry) => entry.request),
    inventoryContext,
    coatingContext,
  );
  const proof = withEquipment ? equipmentProof(request.equipmentProof) : null;
  const equipment = equipmentState(components, request, input, inventory, proof, equipmentContext);
  const baseRequest = {
    npcUuid: request.npcUuid,
    owningControllerId: request.owningControllerId,
    input: {
      ...input,
      inventory: [],
      initialState: {
        ...initial,
        effectInstances: disease === null ? otherEffects : [],
        ...(wounds === null ? {} : { currentWounds: [] }),
      },
    },
    skillProof: request.skillProof,
    compositionProof: request.compositionProof,
    ...(withOrdinary ? { ordinaryProof: request.ordinaryProof } : {}),
  };
  const clean = withOrdinary
    ? buildNpcOrdinaryHumanoidSnapshot(
        components.ordinaryHumanoid ??
          (() => {
            throw new Error('NPC humanoid: ordinary source catalog required');
          })(),
        baseRequest,
        null,
        runtime?.hpModesOrNull ?? null,
        lifeBoundary,
      )
    : buildNpcCleanHumanoidSnapshot(components.cleanHumanoid, baseRequest, lifeBoundary);
  // The legacy PURE branch uses its original commit leaf grammar. Ordinary histories are
  // bound to confirmed composition/stat contexts by the owning immutable prefix reader.
  if (!withOrdinary)
    for (const context of clean.derivation.skillProof.contexts)
      for (const fact of context.facts) {
        const origin = readNpcInitialSkillFactReference(fact.factId).commitOperationId;
        if (publication.proof.previous === undefined)
          data.equal(origin, publication.proof.commitOperationId);
        else if (
          origin !== publication.proof.commitOperationId &&
          !inventoryContext?.history.some(
            (version) => version.npcUuid === clean.npcUuid && version.commitOperationId === origin,
          )
        )
          throw new Error(
            'NPC humanoid: initial skill origin is outside the actual NPC version history',
          );
      }
  const result: NpcHumanoidSnapshot = data.freeze({
    format: 'NPC_HUMANOID_V1',
    npcUuid: clean.npcUuid,
    owningControllerId: clean.owningControllerId,
    derivation: {
      ...clean.derivation,
      inventoryProof: publication.proof,
      ...(proof === null ? {} : { equipmentProof: proof }),
      ...(woundProof === null ? {} : { initialWoundProof: woundProof }),
    },
    sheet: {
      ...clean.sheet,
      input: {
        ...clean.sheet.input,
        inventory: publication.input,
        ...(wounds === null
          ? {}
          : { initialState: { ...clean.sheet.input.initialState, currentWounds: wounds } }),
      },
      stats: {
        ...clean.sheet.stats,
        equippedStats: equipment?.equippedStats ?? clean.sheet.stats.effectiveStats,
        effectiveStats: equipment?.equippedStats ?? clean.sheet.stats.effectiveStats,
      },
      itemProfiles: publication.items,
      requiresCampaignTime:
        clean.sheet.requiresCampaignTime ||
        publication.input.some((item) => item.coatings.length !== 0),
      ...(equipment === null
        ? {}
        : {
            equipmentState: equipment,
            equipmentRequirements: equipmentRequirements(
              components,
              inventory,
              equipment.equippedStats,
            ),
            currentSkills: evaluateNpcCurrentSkillAvailability(components.skills, {
              identityKey: clean.npcUuid,
              proof: clean.derivation.skillProof,
              effectiveStats: equipment.equippedStats,
              sym166SourceOrNull: currentSym166Source(clean.sheet.symbionts),
            }),
          }),
    },
  });
  const finish = (snapshot: NpcHumanoidSnapshot): NpcHumanoidSnapshot => {
    if (runtime === null) return snapshot;
    const checked = [...(disease?.effects ?? []), ...runtime.effects];
    const effects = selectedEffects.map(
      (value) =>
        checked.find((e) => e.effectInstanceId === data.record(value).effectInstanceId) ??
        (() => {
          throw new Error('NPC humanoid: unchecked initial effect');
        })(),
    );
    return data.freeze({
      ...snapshot,
      derivation: { ...snapshot.derivation, initialRuntimeProof: runtime.proof },
      sheet: {
        ...snapshot.sheet,
        input: {
          ...snapshot.sheet.input,
          initialState: { ...snapshot.sheet.input.initialState, effectInstances: effects },
        },
        runtimeState: { hpModesOrNull: runtime.hpModesOrNull },
        requiresCampaignTime: true,
      },
    });
  };
  const modeStats =
    runtime?.hpModesOrNull == null ? null : npcHpModeStatProfileForComponent(runtime.hpModesOrNull);
  const hunger = modeStats?.hungerStatMultiplier === 2;
  if ((disease === null || stateProof === null) && !hunger) {
    validateEquippedRequirements(equipment, result.sheet.stats.effectiveStats);
    return finish(result);
  }
  if (equipment !== null) validateEquippedStatMinimum(equipment.equippedStats);
  const contribution =
    equipment === null
      ? deriveNpcDiseaseStatContribution(
          components.diseaseUnconsciousness,
          {
            effects: disease?.effects ?? [],
            permanentStats: result.sheet.stats.permanentStats,
            scope: disease?.scope ?? {
              targetActorId: result.npcUuid,
              campaignTimestampOrNull: runtimeContext?.campaignTimestampOrNull,
              dead: false,
            },
            histories: disease?.histories ?? [],
          },
          modeStats,
          withOrdinary ? npcOrdinaryResultEffectiveLimits(clean) : null,
        )
      : deriveNpcDiseaseEquippedStatContribution(
          components.diseaseUnconsciousness,
          {
            effects: disease?.effects ?? [],
            equipmentProfile: equipment,
            scope: disease?.scope ?? {
              targetActorId: result.npcUuid,
              campaignTimestampOrNull: runtimeContext?.campaignTimestampOrNull,
              dead: false,
            },
            histories: disease?.histories ?? [],
          },
          modeStats,
        );
  const currentSkills = evaluateNpcCurrentSkillAvailability(components.skills, {
    identityKey: result.npcUuid,
    proof: result.derivation.skillProof,
    effectiveStats: contribution.effectiveStats,
    sym166SourceOrNull: currentSym166Source(result.sheet.symbionts),
  });
  const unconscious = contribution.unconsciousness.triggers.length !== 0;
  validateEquippedRequirements(equipment, contribution.effectiveStats);
  return finish(
    data.freeze({
      ...result,
      derivation: {
        ...result.derivation,
        ...(stateProof === null ? {} : { initialStateProof: stateProof }),
      },
      sheet: {
        ...result.sheet,
        input: {
          ...result.sheet.input,
          initialState: {
            ...result.sheet.input.initialState,
            effectInstances: disease?.effects ?? [],
          },
        },
        stats: {
          ...result.sheet.stats,
          equippedStats:
            equipment === null
              ? hunger
                ? result.sheet.stats.permanentStats
                : contribution.effectiveStats
              : equipment.equippedStats,
          effectiveStats: contribution.effectiveStats,
        },
        capabilities: {
          ...result.sheet.capabilities,
          canPhysicalAct: !unconscious && result.sheet.capabilities.canPhysicalAct,
          canMentalAct: !unconscious && result.sheet.capabilities.canMentalAct,
          canReact: !unconscious && result.sheet.capabilities.canReact,
          canActiveDefend: !unconscious && result.sheet.capabilities.canActiveDefend,
        },
        ...(disease === null ? {} : { diseaseState: { contribution, currentSkills } }),
        ...(equipment === null && !hunger
          ? {}
          : {
              currentSkills,
              equipmentRequirements: equipmentRequirements(
                components,
                inventory,
                contribution.effectiveStats,
              ),
            }),
        requiresCampaignTime:
          result.sheet.requiresCampaignTime || (disease?.effects.length ?? 0) !== 0,
      },
    }),
  );
}
/** The candidate and an unchecked old snapshot cannot certify their own trauma origin. */
function buildHumanoidWithTrauma(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  initialContext: NpcHumanoidInitialStateContext | null = null,
  traumaContext: NpcHumanoidTraumaContext | null = null,
  equipmentContext: NpcHumanoidEquipmentContext | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimeContext: NpcHumanoidRuntimeEffectContext | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifeBoundary: NpcHumanoidLifeBoundary | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcHumanoidSnapshot {
  const request = data.record(value);
  if (!Object.hasOwn(request, 'initialTraumaProof'))
    return applySourceControl(
      catalog,
      request,
      buildHumanoidWithoutTrauma(
        catalog,
        value,
        initialContext,
        equipmentContext,
        woundContext,
        runtimeContext,
        inventoryContext,
        lifeBoundary,
        coatingContext,
      ),
    );
  const components = catalogs.get(catalog),
    source = components?.initialTrauma;
  if (source === undefined || traumaContext === null)
    throw new Error('NPC humanoid: checked trauma source/context required');
  const proof = data.record(request.initialTraumaProof, ['commitOperationId', 'facts']);
  data.equal(data.uuid(proof.commitOperationId), traumaContext.commitOperationId);
  data.equal(data.uuid(request.npcUuid), traumaContext.npcUuid);
  const facts = data.array(proof.facts).map((raw) => {
    const id = data.record(data.record(raw).trauma).traumaInstanceId;
    const evidence = traumaContext.evidence.filter((e) => e.trauma.traumaInstanceId === id);
    if (evidence.length !== 1 || evidence[0] === undefined)
      throw new Error('NPC humanoid: exact external trauma origin required');
    return readNpcInitialTraumaFact(source, raw, evidence[0], evidence[0].phase);
  });
  const input = data.record(request.input),
    initial = data.record(input.initialState);
  data.equal(
    initial.currentTraumas,
    facts.map((f) => f.trauma),
  );
  const contribution = deriveNpcInitialTraumaConsequences(
    source,
    {
      scope: traumaContext.scope,
      npcUuid: traumaContext.npcUuid,
      currentCampaignTimestampOrNull: traumaContext.campaignTimestampOrNull,
      currentTraumas: facts.map((f) => f.trauma),
      facts,
      evidence: traumaContext.evidence,
    },
    traumaContext.boundary,
  );
  const base = Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== 'initialTraumaProof'),
  );
  const result = buildHumanoidWithoutTrauma(
    catalog,
    { ...base, input: { ...input, initialState: { ...initial, currentTraumas: [] } } },
    initialContext,
    equipmentContext,
    woundContext,
    runtimeContext,
    inventoryContext,
    lifeBoundary,
    coatingContext,
  );
  const disabled = contribution.headStuns.some((s) => s.activeNow);
  return applySourceControl(
    catalog,
    request,
    data.freeze({
      ...result,
      derivation: {
        ...result.derivation,
        initialTraumaProof: { commitOperationId: traumaContext.commitOperationId, facts },
      },
      sheet: {
        ...result.sheet,
        input: {
          ...result.sheet.input,
          initialState: {
            ...result.sheet.input.initialState,
            currentTraumas: facts.map((f) => f.trauma),
          },
        },
        capabilities: {
          ...result.sheet.capabilities,
          canPhysicalAct: disabled ? false : result.sheet.capabilities.canPhysicalAct,
          canMentalAct: disabled ? false : result.sheet.capabilities.canMentalAct,
          canReact: disabled ? false : result.sheet.capabilities.canReact,
          canActiveDefend: disabled ? false : result.sheet.capabilities.canActiveDefend,
          regionPenaltyById: Object.fromEntries(
            contribution.limbs.map((limb) => [limb.regionId, limb.localCheckPenalty]),
          ),
        },
        traumaState: contribution,
        requiresCampaignTime:
          result.sheet.requiresCampaignTime || contribution.requiresCampaignTime,
      },
    }),
  );
}
/** Historical snapshots keep their original publication proof, including IDs and audit timestamp. */
export function readNpcHumanoidSnapshot(
  catalog: NpcHumanoidCatalog,
  value: unknown,
  initialContext: NpcHumanoidInitialStateContext | null = null,
  traumaContext: NpcHumanoidTraumaContext | null = null,
  equipmentContext: NpcHumanoidEquipmentContext | null = null,
  woundContext: NpcHumanoidWoundContext | null = null,
  runtimeContext: NpcHumanoidRuntimeEffectContext | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
  lifeContext: NpcHumanoidLifeContext | null = null,
  poisonContext: NpcHumanoidPoisonContext | null = null,
): NpcHumanoidSnapshot {
  const row = data.record(value, [
    'format',
    'npcUuid',
    'owningControllerId',
    'derivation',
    'sheet',
  ]);
  const withInitialState = Object.hasOwn(data.record(row.derivation), 'initialStateProof');
  const withTrauma = Object.hasOwn(data.record(row.derivation), 'initialTraumaProof');
  const withOrdinary = Object.hasOwn(data.record(row.derivation), 'ordinaryProof');
  const withEquipment = Object.hasOwn(data.record(row.derivation), 'equipmentProof');
  const withWounds = Object.hasOwn(data.record(row.derivation), 'initialWoundProof');
  const withRuntime = Object.hasOwn(data.record(row.derivation), 'initialRuntimeProof');
  const withLife = Object.hasOwn(data.record(row.derivation), 'initialLifeProof');
  const withPoison = Object.hasOwn(data.record(row.derivation), 'initialPoisonProof');
  const withEquipmentState = Object.hasOwn(data.record(row.sheet), 'equipmentState');
  const withRuntimeStatEvaluation =
    withRuntime && !withEquipmentState && Object.hasOwn(data.record(row.sheet), 'currentSkills');
  const derivation = data.record(row.derivation, [
    'skillProof',
    'compositionProof',
    'inventoryProof',
    ...(withOrdinary ? ['ordinaryProof'] : []),
    ...(withInitialState ? ['initialStateProof'] : []),
    ...(withTrauma ? ['initialTraumaProof'] : []),
    ...(withEquipment ? ['equipmentProof'] : []),
    ...(withWounds ? ['initialWoundProof'] : []),
    ...(withRuntime ? ['initialRuntimeProof'] : []),
    ...(withLife ? ['initialLifeProof'] : []),
    ...(withPoison ? ['initialPoisonProof'] : []),
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
    ...(withTrauma ? ['traumaState'] : []),
    ...(withEquipmentState ? ['equipmentState', 'equipmentRequirements', 'currentSkills'] : []),
    ...(withRuntimeStatEvaluation ? ['equipmentRequirements', 'currentSkills'] : []),
    ...(withRuntime ? ['runtimeState'] : []),
    ...(Object.hasOwn(data.record(row.sheet), 'sourceControlState') ? ['sourceControlState'] : []),
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
      ...(withOrdinary ? { ordinaryProof: derivation.ordinaryProof } : {}),
      ...(withInitialState ? { initialStateProof: derivation.initialStateProof } : {}),
      ...(withTrauma ? { initialTraumaProof: derivation.initialTraumaProof } : {}),
      ...(withEquipment ? { equipmentProof: derivation.equipmentProof } : {}),
      ...(withWounds ? { initialWoundProof: derivation.initialWoundProof } : {}),
      ...(withRuntime ? { initialRuntimeProof: derivation.initialRuntimeProof } : {}),
      ...(withLife ? { initialLifeProof: derivation.initialLifeProof } : {}),
      ...(withPoison ? { initialPoisonProof: derivation.initialPoisonProof } : {}),
    },
    initialContext,
    traumaContext,
    equipmentContext,
    woundContext,
    runtimeContext,
    inventoryContext,
    lifeContext,
    poisonContext,
  );
  data.equal(expected, value);
  return expected;
}
