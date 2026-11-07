import {
  validateNpcAlcoholEffect,
  type NpcAlcoholCodecCatalog,
  type NpcAlcoholEffectInstance,
  type NpcAlcoholHistoryAnchor,
} from './alcohol-effects.js';
import {
  deriveNpcCombinedHpModes,
  type NpcCombinedHpModeCatalog,
  type NpcCombinedHpModeComponent,
  type NpcHpModeEffectInstance,
  type NpcHpModeHistoryAnchor,
  type NpcHpModeSourceEvidence,
  type NpcRegenerationHealingTimer,
} from './combined-hp-modes.js';
import type { NpcOrdinaryProofResult } from './ordinary-humanoid-proof.js';
import {
  deriveNpcOrdinaryHpModeSource,
  readNpcOrdinaryRuntimeBasis,
} from './npc-ordinary-humanoid-sheet.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  validateNpcFormalControlEffect,
  type NpcFormalControlCatalog,
  type NpcFormalControlEffectInstance,
  type NpcFormalControlHistoryAnchor,
} from './formal-control-effects.js';
import {
  readNpcFormalControlComposition,
  type NpcFormalControlComposition,
} from './formal-control-composition.js';

export interface NpcHumanoidRuntimeEffectProof {
  readonly commitOperationId: string;
  readonly assignments: readonly Readonly<{
    effectInstanceId: string;
    originCommitOperationId: string;
  }>[];
}
/** The owner reconstructs these leaves from immutable preparations and original commits. */
export interface NpcHumanoidRuntimeEffectContext {
  readonly npcUuid: string;
  readonly commitOperationId: string;
  readonly campaignTimestampOrNull: number | null;
  readonly alcohol: readonly Readonly<{
    effect: NpcAlcoholEffectInstance;
    history: NpcAlcoholHistoryAnchor;
    originCommitOperationId: string;
  }>[];
  readonly hpModes: readonly Readonly<{
    effect: NpcHpModeEffectInstance;
    history: NpcHpModeHistoryAnchor;
    originCommitOperationId: string;
  }>[];
  readonly hpModeSourceOrNull: NpcHpModeSourceEvidence | null;
  readonly provenHealingTimers: readonly NpcRegenerationHealingTimer[];
  readonly formalControls?: readonly Readonly<{
    effect: NpcFormalControlEffectInstance;
    history: NpcFormalControlHistoryAnchor;
    originCommitOperationId: string;
  }>[];
}
export interface NpcHumanoidRuntimeState {
  readonly effects: readonly (
    NpcAlcoholEffectInstance | NpcHpModeEffectInstance | NpcFormalControlEffectInstance
  )[];
  readonly hpModesOrNull: NpcCombinedHpModeComponent | null;
  readonly proof: NpcHumanoidRuntimeEffectProof;
}
function fail(detail: string): never {
  throw new Error(`NPC runtime effects: ${detail}`);
}
export function readNpcHumanoidRuntimeEffectProof(value: unknown): NpcHumanoidRuntimeEffectProof {
  const row = data.record(value, ['commitOperationId', 'assignments']);
  const assignments = data.array(row.assignments).map((value) => {
    const entry = data.record(value, ['effectInstanceId', 'originCommitOperationId']);
    return {
      effectInstanceId: data.uuid(entry.effectInstanceId),
      originCommitOperationId: data.uuid(entry.originCommitOperationId),
    };
  });
  if (
    assignments.length === 0 ||
    new Set(assignments.map((a) => a.effectInstanceId)).size !== assignments.length
  )
    return fail('nonempty unique assignments required');
  return data.freeze({ commitOperationId: data.uuid(row.commitOperationId), assignments });
}
export function deriveNpcHumanoidRuntimeState(
  catalogs: Readonly<{
    alcohol: NpcAlcoholCodecCatalog;
    hpModes: NpcCombinedHpModeCatalog;
    formalControls?: NpcFormalControlCatalog;
  }>,
  input: Readonly<{
    npcUuid: string;
    currentHP: unknown;
    effects: unknown;
    proof: NpcHumanoidRuntimeEffectProof;
    context: NpcHumanoidRuntimeEffectContext;
    ordinaryBasisOrNull: Readonly<{ proof: NpcOrdinaryProofResult; baseMaxHP: number }> | null;
    formalControlCompositionOrNull?: NpcFormalControlComposition | null;
  }>,
): NpcHumanoidRuntimeState {
  const c = data.record(input.context, [
    'npcUuid',
    'commitOperationId',
    'campaignTimestampOrNull',
    'alcohol',
    'hpModes',
    'hpModeSourceOrNull',
    'provenHealingTimers',
    ...(Object.hasOwn(input.context, 'formalControls') ? ['formalControls'] : []),
  ]);
  const npcUuid = data.uuid(input.npcUuid);
  data.equal(npcUuid, data.uuid(c.npcUuid));
  const minute = c.campaignTimestampOrNull;
  if (typeof minute !== 'number' || !Number.isSafeInteger(minute) || minute < 0)
    return fail('actual campaign minute required for retained timed effects');
  const proof = readNpcHumanoidRuntimeEffectProof(input.proof);
  data.equal(proof.commitOperationId, data.uuid(c.commitOperationId));
  const entries = [
    ...data.array(c.alcohol),
    ...data.array(c.hpModes),
    ...(Object.hasOwn(c, 'formalControls') ? data.array(c.formalControls) : []),
  ].map((raw) => {
    const entry = data.record(raw, ['effect', 'history', 'originCommitOperationId']);
    const effect = data.record(entry.effect);
    const effectInstanceId = data.uuid(effect.effectInstanceId);
    const reference = proof.assignments.find((r) => r.effectInstanceId === effectInstanceId);
    if (reference === undefined) return fail('orphan owning history');
    data.equal(reference.originCommitOperationId, data.uuid(entry.originCommitOperationId));
    return { effectInstanceId, effect: entry.effect };
  });
  if (
    entries.length !== proof.assignments.length ||
    new Set(entries.map((e) => e.effectInstanceId)).size !== entries.length
  )
    return fail('one independent origin per selected effect required');
  const selected = data.array(input.effects).map((effect) => data.record(effect));
  data.equal(
    proof.assignments.map((a) => a.effectInstanceId),
    selected.map((e) => e.effectInstanceId),
  );
  for (const effect of selected) {
    const own = entries.find((e) => e.effectInstanceId === effect.effectInstanceId);
    if (own === undefined) return fail('selected effect lacks independent owning origin');
    data.equal(own.effect, effect);
  }
  const alcohol = input.context.alcohol.map((entry) =>
    validateNpcAlcoholEffect(
      catalogs.alcohol,
      entry.effect,
      { targetActorId: npcUuid, campaignTimestampOrNull: minute, dead: false },
      entry.history,
    ),
  );
  let hpModesOrNull: NpcCombinedHpModeComponent | null = null;
  if (input.context.hpModes.length === 0) {
    data.equal(null, c.hpModeSourceOrNull);
    data.equal([], c.provenHealingTimers);
  } else {
    if (input.ordinaryBasisOrNull === null)
      return fail('complete actual HP source composition required');
    const basis = readNpcOrdinaryRuntimeBasis(input.ordinaryBasisOrNull);
    data.equal(npcUuid, basis.proof.npcUuid);
    const source = deriveNpcOrdinaryHpModeSource(basis.proof);
    data.equal(source, c.hpModeSourceOrNull);
    if (typeof input.currentHP !== 'number') return fail('explicit current HP required');
    hpModesOrNull = deriveNpcCombinedHpModes(catalogs.hpModes, {
      baseMaxHP: basis.baseMaxHP,
      currentHP: input.currentHP,
      modes: input.context.hpModes.map((e) => e.effect),
      histories: input.context.hpModes.map((e) => e.history),
      source,
      campaignTimestamp: minute,
      healingTimers: input.context.provenHealingTimers,
      provenHealingTimers: input.context.provenHealingTimers,
    });
  }
  const controls = (input.context.formalControls ?? []).map((entry) => {
    const catalog = catalogs.formalControls ?? fail('formal control source catalog required');
    const composition = readNpcFormalControlComposition(input.formalControlCompositionOrNull);
    data.equal(npcUuid, composition.npcUuid);
    if (composition.poisonControlResponse === 'IMMUNE')
      return fail('current source is immune to the selected decoction control');
    return validateNpcFormalControlEffect(catalog, entry.effect, entry.history, {
      npcUuid,
      campaignTimestamp: minute,
      dead: false,
    });
  });
  const checked = [...alcohol, ...(hpModesOrNull?.modes ?? []), ...controls];
  const effects = selected.map(
    (entry) =>
      checked.find((e) => e.effectInstanceId === entry.effectInstanceId) ??
      fail('unrecognized selected runtime effect'),
  );
  return data.freeze({ effects, hpModesOrNull, proof });
}
