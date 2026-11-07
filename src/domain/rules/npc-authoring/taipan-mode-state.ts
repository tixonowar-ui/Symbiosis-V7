import type { NpcInventoryCoatingContext } from './formal-poison-coating.js';
import {
  assertNpcTaipanModeTarget,
  npcTaipanInitialModeChoices,
  npcTaipanModeSourceRoster,
  readNpcTaipanModeContribution,
  type NpcPoisonSourceCatalog,
  type NpcTaipanModeContribution,
} from './formal-poison-source.js';
import { npcPublicationData as data } from './inventory-publication.js';

type Mode = ReturnType<typeof readNpcTaipanModeContribution>;
/** A current source-specific value, not a fictitious timed activation or a live-source assertion. */
export interface NpcInitialTaipanModeState {
  readonly kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE';
  readonly effectTypeId: 'EFF-SYMBIONT-POISON_MODE';
  readonly effectInstanceId: string;
  readonly sourceInstanceId: string;
  readonly activePoisonType: Mode['activePoisonProfileId'];
  readonly sourceAbilityId: Mode['sourceAbilityId'];
  readonly pendingSwitchOrNull: null;
  readonly sourceSnapshot: Mode['sourceSnapshot'];
  readonly currentSourceStatus: Mode['currentSourceSnapshot']['status'];
  readonly effectsEnabled: boolean;
  readonly anchor: Mode['history'];
  readonly origin: Mode['origin'];
}
export interface NpcHumanoidPoisonProof {
  readonly commitOperationId: string;
  readonly modeAssignments: readonly Readonly<{
    modeOperationId: string;
    originCommitOperationId: string;
  }>[];
}
/** Independent owning adjunct; candidate mode IDs cannot provide their own history. */
export interface NpcHumanoidPoisonContext {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestampOrNull: number | null;
  readonly targetCommitOperationIdOrNull: string | null;
  readonly previousVersionCompositionProofOrNull: unknown;
  readonly modes: readonly NpcTaipanModeContribution[];
  readonly coatingContext: NpcInventoryCoatingContext | null;
}
export function readNpcHumanoidPoisonProof(value: unknown): NpcHumanoidPoisonProof {
  const row = data.record(value, ['commitOperationId', 'modeAssignments']);
  const modeAssignments = data.array(row.modeAssignments).map((value) => {
    const assignment = data.record(value, ['modeOperationId', 'originCommitOperationId']);
    return {
      modeOperationId: data.uuid(assignment.modeOperationId),
      originCommitOperationId: data.uuid(assignment.originCommitOperationId),
    };
  });
  if (new Set(modeAssignments.map((m) => m.modeOperationId)).size !== modeAssignments.length)
    throw new Error('NPC poison state: repeated mode origin');
  return data.freeze({ commitOperationId: data.uuid(row.commitOperationId), modeAssignments });
}
export function deriveNpcInitialTaipanModeStates(
  catalog: NpcPoisonSourceCatalog,
  compositionProof: unknown,
  supplied: NpcHumanoidPoisonContext,
): readonly NpcInitialTaipanModeState[] {
  data.record(supplied, [
    'campaignId',
    'npcUuid',
    'campaignTimestampOrNull',
    'targetCommitOperationIdOrNull',
    'previousVersionCompositionProofOrNull',
    'modes',
    'coatingContext',
  ]);
  const campaignId = data.uuid(supplied.campaignId),
    npcUuid = data.uuid(supplied.npcUuid);
  if (supplied.targetCommitOperationIdOrNull !== null)
    data.uuid(supplied.targetCommitOperationIdOrNull);
  if (
    supplied.campaignTimestampOrNull !== null &&
    (!Number.isSafeInteger(supplied.campaignTimestampOrNull) ||
      supplied.campaignTimestampOrNull < 0)
  )
    throw new Error('NPC poison state: exact virtual minute or explicit absence required');
  const choices = npcTaipanInitialModeChoices(catalog, {
    npcUuid,
    compositionProof,
    previousVersionCompositionProofOrNull: supplied.previousVersionCompositionProofOrNull,
  });
  const sources = new Set<string>(),
    effects = new Set<string>(),
    operations = new Set<string>();
  const states = data.array(supplied.modes).map((raw): NpcInitialTaipanModeState => {
    const token = raw as NpcTaipanModeContribution;
    assertNpcTaipanModeTarget(catalog, token, {
      campaignId,
      npcUuid,
      campaignTimestampOrNull: supplied.campaignTimestampOrNull,
      compositionProof,
    });
    const mode = readNpcTaipanModeContribution(catalog, token);
    if (
      sources.has(mode.sourceInstanceId) ||
      effects.has(mode.effectInstanceId) ||
      operations.has(mode.modeOperationId)
    )
      throw new Error('NPC poison state: duplicate source, effect or mode operation');
    sources.add(mode.sourceInstanceId);
    effects.add(mode.effectInstanceId);
    operations.add(mode.modeOperationId);
    if (supplied.targetCommitOperationIdOrNull !== null && mode.origin.kind !== 'COMMITTED')
      throw new Error('NPC poison state: PREPARED mode cannot claim a saved COMMIT');
    return {
      kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE',
      effectTypeId: 'EFF-SYMBIONT-POISON_MODE',
      effectInstanceId: mode.effectInstanceId,
      sourceInstanceId: mode.sourceInstanceId,
      activePoisonType: mode.activePoisonProfileId,
      sourceAbilityId: mode.sourceAbilityId,
      pendingSwitchOrNull: null,
      sourceSnapshot: mode.sourceSnapshot,
      currentSourceStatus: mode.currentSourceSnapshot.status,
      effectsEnabled: mode.currentSourceSnapshot.effectsEnabled,
      anchor: mode.history,
      origin: mode.origin,
    };
  });
  for (const choice of choices)
    if (!sources.has(choice.sourceInstanceId))
      throw new Error('NPC poison state: every new Taipan requires an explicit initial mode');
  for (const instanceId of npcTaipanModeSourceRoster(catalog, { npcUuid, compositionProof }))
    if (!sources.has(instanceId))
      throw new Error('NPC poison state: independently proven retained mode required');
  if (supplied.coatingContext !== null) {
    data.equal(campaignId, supplied.coatingContext.campaignId);
    data.equal(npcUuid, supplied.coatingContext.npcUuid);
    data.equal(supplied.campaignTimestampOrNull, supplied.coatingContext.campaignTimestamp);
    data.equal(
      supplied.targetCommitOperationIdOrNull,
      supplied.coatingContext.targetCommitOperationIdOrNull,
    );
  }
  return data.freeze(states);
}
export function npcHumanoidPoisonProofForTarget(
  states: readonly NpcInitialTaipanModeState[],
  commitOperationId: string,
): NpcHumanoidPoisonProof {
  return readNpcHumanoidPoisonProof({
    commitOperationId,
    modeAssignments: states.map((state) => {
      if (state.origin.kind !== 'COMMITTED')
        throw new Error('NPC poison state: committed mode origin required');
      return {
        modeOperationId: state.anchor.modeOperationId,
        originCommitOperationId: state.origin.originCommitOperationId,
      };
    }),
  });
}
