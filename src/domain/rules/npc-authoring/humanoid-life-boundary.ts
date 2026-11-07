import {
  createNpcFormalLifeState,
  validateNpcFormalLifeState,
  deriveNpcRetainedFormalLifeState,
  assertNpcFormalLifeTransition,
  readNpcFormalLifeBoundary,
  type NpcFormalLifeCatalog,
  type NpcFormalLifeState,
  type NpcFormalLifeHistoryAnchor,
  type NpcFormalLifeKind,
} from './formal-life-state.js';
import {
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
  type NpcFunctionalDuplicateCatalog,
  type NpcFunctionalDuplicateProof,
} from './functional-duplicate-composition.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  deriveNpcFormalWeaverEffectContribution,
  validateNpcFormalWeaverEffectContribution,
  readNpcFormalWeaverEffectContribution,
  assertNpcFormalWeaverContributionSet,
  compareNpcFormalWeaverExactTimes,
  type NpcFormalWeaverCatalog,
  type NpcFormalWeaverEffectContribution,
  type NpcFormalWeaverEffectInstance,
  type NpcFormalWeaverHistoryAnchor,
} from './formal-weaver-effects.js';

export type NpcHumanoidWeaverEffectContext = Readonly<{
  history: NpcFormalWeaverHistoryAnchor;
  originalCompositionProof: unknown;
}> &
  (
    | Readonly<{ origin: { readonly kind: 'PREPARED'; readonly preparationOperationId: string } }>
    | Readonly<{
        origin: { readonly kind: 'COMMITTED'; readonly originCommitOperationId: string };
        effect: NpcFormalWeaverEffectInstance;
      }>
  );

export interface NpcHumanoidLifeProof {
  readonly commitOperationId: string;
  readonly originCommitOperationId: string;
  readonly temporaryWeaverAssignments?: readonly Readonly<{
    effectInstanceId: string;
    originCommitOperationId: string;
  }>[];
}
interface LifeContextBase {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestampOrNull: number | null;
  readonly history: NpcFormalLifeHistoryAnchor;
  readonly entryDuplicateProofOrNull: NpcFunctionalDuplicateProof | null;
  readonly previousLifeKindOrNull: NpcFormalLifeKind | null;
  readonly temporaryWeaverEffects?: readonly NpcHumanoidWeaverEffectContext[];
}
export interface NpcHumanoidLifeContext extends LifeContextBase {
  readonly commitOperationId: string;
  readonly originCommitOperationId: string;
  readonly state: NpcFormalLifeState;
}
export type NpcHumanoidLifePreview = LifeContextBase &
  (
    | Readonly<{ kind: 'PREPARED'; sourceOperationId: string }>
    | Readonly<{ kind: 'RETAINED'; originCommitOperationId: string }>
  );
export interface NpcHumanoidLifeCatalogs {
  readonly formalLife: NpcFormalLifeCatalog;
  readonly functionalDuplicate: NpcFunctionalDuplicateCatalog;
  readonly formalWeaver?: NpcFormalWeaverCatalog | null;
}
declare const brand: unique symbol;
export interface NpcHumanoidLifeBoundary {
  readonly [brand]: true;
}
const boundaries = new WeakMap<
  NpcHumanoidLifeBoundary,
  Readonly<{
    state: NpcFormalLifeState;
    compositionProof: unknown;
    currentHP: number;
    temporaryWeaverEffects: readonly NpcFormalWeaverEffectInstance[];
  }>
>();
function fail(detail: string): never {
  throw new Error(`NPC humanoid life: ${detail}`);
}
const BASE_FIELDS = [
  'campaignId',
  'npcUuid',
  'campaignTimestampOrNull',
  'history',
  'entryDuplicateProofOrNull',
  'previousLifeKindOrNull',
] as const;
export function readNpcHumanoidLifeProof(value: unknown): NpcHumanoidLifeProof {
  const record = data.record(value),
    withWeaver = Object.hasOwn(record, 'temporaryWeaverAssignments');
  const row = data.record(value, [
    'commitOperationId',
    'originCommitOperationId',
    ...(withWeaver ? ['temporaryWeaverAssignments'] : []),
  ]);
  return data.freeze({
    commitOperationId: data.uuid(row.commitOperationId),
    originCommitOperationId: data.uuid(row.originCommitOperationId),
    ...(withWeaver
      ? {
          temporaryWeaverAssignments: data.array(row.temporaryWeaverAssignments).map((value) => {
            const entry = data.record(value, ['effectInstanceId', 'originCommitOperationId']);
            return {
              effectInstanceId: data.uuid(entry.effectInstanceId),
              originCommitOperationId: data.uuid(entry.originCommitOperationId),
            };
          }),
        }
      : {}),
  });
}
function currentDuplicate(
  catalogs: NpcHumanoidLifeCatalogs,
  context: LifeContextBase,
  compositionProof: unknown,
  temporaryEffects: readonly NpcFormalWeaverEffectContribution[],
) {
  if (context.history.lifeKind !== 'SEVERELY_WOUNDED') return null;
  if (context.campaignTimestampOrNull === null)
    return fail('severe state requires the actual virtual minute');
  return deriveNpcFunctionalDuplicateProof(catalogs.functionalDuplicate, {
    npcUuid: context.npcUuid,
    campaignTimestamp: context.campaignTimestampOrNull,
    compositionProof,
    temporaryEffects,
    ...(temporaryEffects.length === 0 ? {} : { campaignId: context.campaignId }),
  });
}
function weaverContributions(
  catalogs: NpcHumanoidLifeCatalogs,
  context: LifeContextBase,
  compositionProof: unknown,
  saved: boolean,
): readonly NpcFormalWeaverEffectContribution[] {
  if (!Object.hasOwn(context, 'temporaryWeaverEffects')) return [];
  if (context.temporaryWeaverEffects === undefined)
    return fail('explicit Weaver effects require an array');
  const entries = data.array(context.temporaryWeaverEffects);
  const catalog =
    catalogs.formalWeaver ?? fail('accepted temporary Weaver source delivery required');
  if (entries.length === 0) return [];
  if (context.campaignTimestampOrNull === null)
    return fail('temporary Weaver requires actual confirmed time');
  const result = context.temporaryWeaverEffects.map((entry) => {
    const row = data.record(entry),
      origin = data.record(row.origin);
    const committed = origin.kind === 'COMMITTED';
    data.record(entry, [
      'history',
      'originalCompositionProof',
      'origin',
      ...(committed ? ['effect'] : []),
    ]);
    if (saved && !committed) return fail('saved Weaver requires actual original COMMIT');
    const actual = {
      campaignId: context.campaignId,
      npcUuid: context.npcUuid,
      campaignTimestamp: context.campaignTimestampOrNull!,
      origin: entry.origin,
      originalCompositionProof: entry.originalCompositionProof,
      currentCompositionProof: compositionProof,
    };
    return committed
      ? validateNpcFormalWeaverEffectContribution(catalog, row.effect, entry.history, actual)
      : deriveNpcFormalWeaverEffectContribution(catalog, entry.history, actual);
  });
  assertNpcFormalWeaverContributionSet(result);
  return result;
}
function issue(
  state: NpcFormalLifeState,
  compositionProof: unknown,
  temporary: readonly NpcFormalWeaverEffectContribution[],
): NpcHumanoidLifeBoundary {
  const checked = readNpcFormalLifeBoundary(state);
  const effects = temporary.map((value) => {
    const actual = readNpcFormalWeaverEffectContribution(value);
    data.equal(checked.context.campaignId, actual.history.campaignId);
    data.equal(checked.context.npcUuid, actual.history.npcUuid);
    data.equal(checked.context.campaignTimestampOrNull, actual.context.campaignTimestamp);
    data.equal(compositionProof, actual.context.currentCompositionProof);
    if (state.lifeKind === 'DEAD') return fail('DEAD cannot retain personal Weaver effects');
    if (actual.history.branch !== 'DUPLICATED_ORGANS_PROTECTION') {
      if (
        state.lifeKind !== 'SEVERELY_WOUNDED' ||
        checked.context.currentHP !== 0 ||
        !state.abstractVitalSystemDamaged
      )
        return fail(
          'replacement requires actual severe HP=0 and abstract vital damage at final preview/commit',
        );
      if (
        actual.history.branch === 'REPLACEMENT_RECOVERY' &&
        compareNpcFormalWeaverExactTimes(
          state.deathTimerOrNull.expiresAt.campaignTimestampExact,
          actual.effect.expiresAt.campaignTimestampExact,
        ) < 0
      )
        return fail('recovery deadline exceeds unchanged death deadline');
    }
    return actual.effect;
  });
  const boundary = Object.freeze({}) as NpcHumanoidLifeBoundary;
  boundaries.set(
    boundary,
    data.freeze({
      state: checked.state,
      compositionProof,
      currentHP: checked.context.currentHP,
      temporaryWeaverEffects: effects,
    }),
  );
  return boundary;
}
export function readNpcHumanoidLifeBoundary(value: unknown) {
  if (value === null || typeof value !== 'object')
    return fail('issued whole-sheet life boundary required');
  return (
    boundaries.get(value as NpcHumanoidLifeBoundary) ??
    fail('issued whole-sheet life boundary required')
  );
}
/** The low-level sheet cannot reuse even a genuine life component with different current source facts. */
export function assertNpcHumanoidLifeBoundary(
  boundary: NpcHumanoidLifeBoundary,
  input: Readonly<{
    npcUuid: string;
    compositionProof: unknown;
    currentHP: unknown;
    dead: unknown;
  }>,
): NpcFormalLifeState {
  const checked = readNpcHumanoidLifeBoundary(boundary);
  data.equal(checked.state.anchor.npcUuid, input.npcUuid);
  data.equal(checked.currentHP, input.currentHP);
  data.equal(checked.state.dead, input.dead);
  data.equal(checked.compositionProof, input.compositionProof);
  return checked.state;
}
export function deriveNpcHumanoidLifeBoundary(
  catalogs: NpcHumanoidLifeCatalogs,
  input: Readonly<{
    npcUuid: string;
    compositionProof: unknown;
    currentHP: number;
    proof: NpcHumanoidLifeProof;
    context: NpcHumanoidLifeContext;
  }>,
): NpcHumanoidLifeBoundary {
  data.record(input, ['npcUuid', 'compositionProof', 'currentHP', 'proof', 'context']);
  const proof = readNpcHumanoidLifeProof(input.proof),
    context = input.context;
  data.record(context, [
    ...BASE_FIELDS,
    'commitOperationId',
    'originCommitOperationId',
    'state',
    ...(Object.hasOwn(context, 'temporaryWeaverEffects') ? ['temporaryWeaverEffects'] : []),
  ]);
  data.equal(data.uuid(input.npcUuid), data.uuid(context.npcUuid));
  data.equal(proof.commitOperationId, data.uuid(context.commitOperationId));
  data.equal(proof.originCommitOperationId, data.uuid(context.originCommitOperationId));
  assertNpcFormalLifeTransition(
    catalogs.formalLife,
    context.previousLifeKindOrNull,
    context.history.lifeKind,
  );
  const temporary = weaverContributions(catalogs, context, input.compositionProof, true);
  data.equal(
    proof.temporaryWeaverAssignments ?? [],
    temporary.map((value) => {
      const actual = readNpcFormalWeaverEffectContribution(value);
      if (actual.context.origin.kind !== 'COMMITTED')
        return fail('saved Weaver requires actual original COMMIT');
      return {
        effectInstanceId: actual.history.effectInstanceId,
        originCommitOperationId: actual.context.origin.originCommitOperationId,
      };
    }),
  );
  if (
    Object.hasOwn(proof, 'temporaryWeaverAssignments') !==
    Object.hasOwn(context, 'temporaryWeaverEffects')
  )
    return fail('Weaver assignments require the matching independent context');
  const current = currentDuplicate(catalogs, context, input.compositionProof, temporary);
  if (proof.originCommitOperationId === proof.commitOperationId && current !== null) {
    if (context.entryDuplicateProofOrNull === null)
      return fail('actual entry duplicate proof required');
    data.equal(
      readNpcFunctionalDuplicateProof(current),
      readNpcFunctionalDuplicateProof(context.entryDuplicateProofOrNull),
    );
    data.equal(
      context.campaignTimestampOrNull,
      context.history.severeWoundOrNull?.calendarAnchor.campaignTimestamp,
    );
  }
  const state = validateNpcFormalLifeState(
    catalogs.formalLife,
    context.state,
    context.history,
    {
      campaignId: context.campaignId,
      npcUuid: context.npcUuid,
      currentHP: input.currentHP,
      campaignTimestampOrNull: context.campaignTimestampOrNull,
    },
    context.entryDuplicateProofOrNull,
    current,
  );
  return issue(state, input.compositionProof, temporary);
}
export function previewNpcHumanoidLifeBoundary(
  catalogs: NpcHumanoidLifeCatalogs,
  input: Readonly<{
    npcUuid: string;
    compositionProof: unknown;
    currentHP: number;
    context: NpcHumanoidLifePreview;
  }>,
): NpcHumanoidLifeBoundary {
  data.record(input, ['npcUuid', 'compositionProof', 'currentHP', 'context']);
  const context = input.context;
  if (context.kind !== 'PREPARED' && context.kind !== 'RETAINED')
    return fail('known actual life origin required');
  data.record(context, [
    ...BASE_FIELDS,
    'kind',
    context.kind === 'PREPARED' ? 'sourceOperationId' : 'originCommitOperationId',
    ...(Object.hasOwn(context, 'temporaryWeaverEffects') ? ['temporaryWeaverEffects'] : []),
  ]);
  data.equal(data.uuid(input.npcUuid), data.uuid(context.npcUuid));
  assertNpcFormalLifeTransition(
    catalogs.formalLife,
    context.previousLifeKindOrNull,
    context.history.lifeKind,
  );
  const temporary = weaverContributions(catalogs, context, input.compositionProof, false);
  const current = currentDuplicate(catalogs, context, input.compositionProof, temporary);
  const scope = {
    campaignId: context.campaignId,
    npcUuid: context.npcUuid,
    currentHP: input.currentHP,
    campaignTimestampOrNull: context.campaignTimestampOrNull,
  };
  let state: NpcFormalLifeState;
  if (context.kind === 'PREPARED') {
    data.equal(data.uuid(context.sourceOperationId), context.history.initialStateConfirmationId);
    if (current !== null) {
      if (context.entryDuplicateProofOrNull === null)
        return fail('actual entry duplicate proof required');
      data.equal(
        readNpcFunctionalDuplicateProof(current),
        readNpcFunctionalDuplicateProof(context.entryDuplicateProofOrNull),
      );
    }
    state = createNpcFormalLifeState(
      catalogs.formalLife,
      context.history,
      scope,
      context.entryDuplicateProofOrNull,
    );
  } else {
    data.uuid(context.originCommitOperationId);
    state = deriveNpcRetainedFormalLifeState(
      catalogs.formalLife,
      context.history,
      scope,
      context.entryDuplicateProofOrNull,
      current,
    );
  }
  return issue(state, input.compositionProof, temporary);
}
