import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ClassCode, RaceCode } from '@generated/types/character.js';
import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  OperationCommandRequestMessage,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import type { IdentityDraftValues } from '@shared/wire-v3-protocol.js';
import type {
  SymbiontAcceptedSpecies,
  SymbiontBindingSelection,
  SymbiontSpeciesBinding,
  SymbiontComposition,
  RandomSymbiontPhysicalRoll,
  RandomAcceptedSymbiont,
  RandomAdvisorState,
  RandomSymbiontSequence,
  SymbioticMonsterSpeciesKey,
} from '../domain/index.js';
import type { SelectedSkillInput } from '../domain/rules/skill-stage/skills.js';
import type {
  CreationFinalMechanics,
  CreationInputLearnedSkill,
  CreationPermanentSkillGrant,
  CreationValidationBlocker,
  CreationTrainingSlotLedger,
} from '../domain/rules/creation-finalization/types.js';
import type { StartingPropertyReceiptRef } from './creation-property-summary.js';
import type { ResolvedRandomSymbiontSequence } from '../domain/rules/symbiont-stage/random-sequence.js';
import type { CreationNextStageEnvelope } from './creation-set-decide.js';
import type { FiveStartingPositionsCheckpointRecord } from './creation-five-starting-positions-contract.js';
import type { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import {
  exactSymbiontObject,
  guardSymbiontRejected,
  nonEmptySymbiontStringAt,
  objectSymbiontAt,
  revisionSymbiontAt,
  d20SymbiontFaceAt,
} from './creation-symbiont-contract.js';

export type CreationCorrectionFormId =
  | 'CHR-001'
  | 'CHR-009'
  | 'CHR-010'
  | 'CHR-011'
  | 'CHR-015'
  | 'CHR-017'
  | 'CHR-018'
  | 'CHR-019'
  | 'CHR-020'
  | 'CHR-041'
  | 'CHR-042';
export type CreationFinalizationFormId =
  | CreationCorrectionFormId
  | 'CHR-021'
  | 'CHR-022'
  | 'CHR-023'
  | 'CHR-024'
  | 'CHR-025'
  | 'CHR-032'
  | 'CHR-037'
  | 'CHR-038';
export interface CreationCorrectionContext extends JsonObject {
  readonly originFormId: 'CHR-025';
  readonly returnFormId: 'CHR-025';
  readonly sourceFormId: CreationCorrectionFormId;
  readonly summaryReceiptId: string;
  readonly correctionHeadHash: string;
}
export interface CreationCorrectionIdentity extends IdentityDraftValues {
  readonly name: string;
  readonly age: number;
  readonly sex: 'MALE' | 'FEMALE';
  readonly massKg: number;
}
export interface CreationCorrectionAdvisor {
  readonly advisorInstanceDraftId: string;
  readonly physicalRolls: readonly RandomSymbiontPhysicalRoll[];
  readonly selectedSkills: readonly SelectedSkillInput[];
  readonly learnedSkills: readonly {
    readonly skillKey: string;
    readonly bonus: number;
    readonly slotCost: number;
  }[];
  readonly skillsConfirmed: boolean;
}
/** A cached branch retains resolved species, including the race under which a critical was interpreted. */
export interface CreationCorrectionBranch {
  readonly branchId: string;
  readonly raceCode: RaceCode;
  readonly creationMode: 'MANUAL' | 'RANDOM' | null;
  readonly classCode: ClassCode | null;
  readonly composition: SymbiontComposition | null;
  readonly bindings: readonly SymbiontSpeciesBinding[];
  readonly retainedAccepted: readonly RandomAcceptedSymbiont[];
  readonly retainedAdvisorOrNull: RandomAdvisorState | null;
  readonly physicalRolls: readonly RandomSymbiontPhysicalRoll[];
  readonly randomSequenceOrNull: RandomSymbiontSequence | null;
  readonly sourceRandomSequenceOrNull: RandomSymbiontSequence | null;
  readonly monsterChoiceOverrideOrNull: SymbioticMonsterSpeciesKey | null;
  readonly advisorOrNull: CreationCorrectionAdvisor | null;
  readonly interactionsConfirmed: boolean;
  readonly bindingsConfirmed: boolean;
}
export interface CreationFinalizationState {
  readonly identity: CreationCorrectionIdentity;
  readonly lockedAcquisitionModeOrNull: 'MANUAL' | 'RANDOM' | null;
  readonly activeBranchId: string;
  readonly branches: readonly CreationCorrectionBranch[];
  readonly learnedSkills: readonly CreationInputLearnedSkill[];
  readonly permanentGrants: readonly CreationPermanentSkillGrant[];
  readonly trainingSlotLedger: CreationTrainingSlotLedger | null;
  readonly advisorCards: readonly CreationCorrectionAdvisor[];
}
interface CommonPayload extends JsonObject {
  readonly stage: 'FINALIZATION';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}
export interface CreationPropertySummaryPayload extends CommonPayload {
  readonly variant: 'PROPERTY_SUMMARY';
  readonly sourceFormId: 'CHR-032';
  readonly propertyCheckpointReceiptId: string;
  readonly propertyRollReceipts: readonly StartingPropertyReceiptRef[];
}
interface CorrectivePayload extends CommonPayload {
  readonly summaryReceiptId: string;
  readonly correctionHeadHash: string;
}
export type CreationCorrectionPayload = CorrectivePayload &
  (
    | {
        readonly variant: 'CORRECTION_IDENTITY';
        readonly sourceFormId: 'CHR-001';
        readonly identity: CreationCorrectionIdentity & JsonObject;
      }
    | {
        readonly variant: 'CORRECTION_RACE';
        readonly sourceFormId: 'CHR-010';
        readonly raceChoice: RaceCode;
        readonly acquisitionModeIfFirstOrNull: 'MANUAL' | 'RANDOM' | null;
      }
    | {
        readonly variant: 'CORRECTION_CLASS';
        readonly sourceFormId: 'CHR-011';
        readonly pureClass: ClassCode;
      }
    | {
        readonly variant: 'CORRECTION_SKILLS';
        readonly sourceFormId: 'CHR-015';
        readonly selectedSkills: readonly (SelectedSkillInput & JsonObject)[];
      }
    | {
        readonly variant: 'CORRECTION_MANUAL_COMPOSITION';
        readonly sourceFormId: 'CHR-018';
        readonly acceptedSpecies: readonly (SymbiontAcceptedSpecies & JsonObject)[];
        readonly selectedBindings: readonly (SymbiontBindingSelection & JsonObject)[];
      }
    | {
        readonly variant: 'CORRECTION_RANDOM_ROLL';
        readonly sourceFormId: 'CHR-020';
        readonly pendingRollRequestId: string;
        readonly manualFaceOrNull: number | null;
        readonly selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null;
      }
    | {
        readonly variant: 'CORRECTION_RANDOM_BINDINGS';
        readonly sourceFormId: 'CHR-020';
        readonly selectedBindings: readonly (SymbiontBindingSelection & JsonObject)[];
      }
    | {
        readonly variant: 'CORRECTION_MONSTER_CHOICE';
        readonly sourceFormId: 'CHR-020';
        readonly selectedMonsterSpeciesKey: SymbioticMonsterSpeciesKey;
      }
    | {
        readonly variant: 'CORRECTION_ADVISOR_IW';
        readonly sourceFormId: 'CHR-041';
        readonly pendingRollRequestIds: readonly [string, string];
        readonly manualFacesOrNull: readonly [number, number] | null;
      }
    | {
        readonly variant: 'CORRECTION_ADVISOR_B';
        readonly sourceFormId: 'CHR-041';
        readonly pendingRollRequestId: string;
        readonly manualFaceOrNull: number | null;
      }
    | {
        readonly variant: 'CORRECTION_ADVISOR_SKILLS';
        readonly sourceFormId: 'CHR-041';
        readonly selectedSkills: readonly (SelectedSkillInput & JsonObject)[];
      }
    | {
        readonly variant: 'CORRECTION_INTERACTIONS';
        readonly sourceFormId: 'CHR-042';
        readonly compositionHash: string;
      }
  );
export interface CreationFinalSavePayload extends CorrectivePayload {
  readonly variant: 'FINAL_SAVE';
  readonly sourceFormId: 'CHR-025';
}
export type CreationPropertySummaryRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  CreationPropertySummaryPayload
>;
export type CreationCorrectionRequest = WorkflowCommandRequestMessage<
  | 'UI-CMD-CHAR-WIZARD-CHECKPOINT'
  | 'UI-CMD-CHAR-CREATION-SET-DECIDE'
  | 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  CreationCorrectionPayload
>;
export type CreationFinalSaveRequest = Omit<OperationCommandRequestMessage, 'payload'> & {
  readonly payload: CreationFinalSavePayload;
};
export type CreationFinalizationRequest =
  CreationPropertySummaryRequest | CreationCorrectionRequest | CreationFinalSaveRequest;
export interface CreationFinalizationResult extends JsonObject {
  readonly stage: 'FINALIZATION';
  readonly variant: CreationFinalizationRequest['payload']['variant'];
  readonly sourceFormId: CreationFinalizationRequest['payload']['sourceFormId'];
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly correctionHeadHash: string;
  readonly branchCacheDigest: string;
  readonly finalSaveStatus: 'NOT_COMMITTED' | 'COMMITTED';
  readonly mechanicsSnapshotHashOrNull: string | null;
  readonly nextFormId: CreationFinalizationFormId | 'CHR-040';
  readonly physicalRolls?: readonly {
    readonly kind: RandomSymbiontPhysicalRoll['kind'];
    readonly rollRequestId: string;
    readonly rollReceiptId: string;
    readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
  }[];
}
export type CreationFinalizationReceipt = CommandReceipt<CreationFinalizationResult>;
export interface CreationFinalizationRecord {
  readonly request: CreationFinalizationRequest;
  readonly receipt: CreationFinalizationReceipt;
  readonly physicalRolls: readonly RandomSymbiontPhysicalRoll[];
  readonly afterStateHash: string;
  readonly nextStageEnvelope: CreationNextStageEnvelope<CreationFinalizationFormId | 'CHR-040'>;
}
export interface CreationFinalMechanicsSnapshot {
  readonly characterId: string;
  readonly identity: CreationCorrectionIdentity;
  readonly branch: CreationCorrectionBranch;
  readonly mechanics: CreationFinalMechanics;
  readonly propertyRollReceipts: readonly StartingPropertyReceiptRef[];
  readonly propertySummary: JsonObject;
  readonly correctionHeadHash: string;
}
export interface CreationFinalizationStage {
  readonly baseHistoryHash: string;
  readonly entryRequest: FiveStartingPositionsCheckpointRecord['request'];
  readonly entryReceipt: FiveStartingPositionsCheckpointRecord['receipt'];
  readonly initialState: CreationFinalizationState;
  readonly state: CreationFinalizationState;
  readonly records: readonly CreationFinalizationRecord[];
  readonly finalMechanicsSnapshotOrNull: CreationFinalMechanicsSnapshot | null;
}
export interface CreationFinalizationView {
  readonly compositionConsequencesOrNull: {
    readonly beforeCompositionOrNull: SymbiontComposition | null;
    readonly afterComposition: SymbiontComposition;
    readonly beforeMechanicsOrNull: CreationFinalMechanics | null;
    readonly afterMechanicsOrNull: CreationFinalMechanics | null;
  } | null;
  readonly state: CreationFinalizationState;
  readonly activeBranch: CreationCorrectionBranch;
  readonly mechanics: CreationFinalMechanics | null;
  readonly validationBlockers: readonly CreationValidationBlocker[];
  readonly identityAndMassStatus: {
    readonly valid: boolean;
    readonly massApprovalStatus: 'PENDING_GM';
    readonly minimumKg: number;
    readonly maximumKg: number;
  };
  readonly sevenStatsMinOne: boolean;
  readonly skillsAndSlotsStatus: {
    readonly valid: boolean;
    readonly required: number;
    readonly used: number;
  };
  readonly symbiontCompositionStatus: { readonly valid: boolean };
  readonly startingPropertyEightReceiptsStatus: { readonly valid: boolean; readonly count: 8 };
  readonly cleanRuntimeState: boolean;
  readonly branchCacheIntegrity: boolean;
  readonly finalSaveStatus: 'NOT_COMMITTED' | 'COMMITTED';
  readonly summaryReceiptIdOrNull: string | null;
  readonly correctionHeadHash: string;
  readonly branchCacheDigest: string;
  readonly correctionContextOrNull: CreationCorrectionContext | null;
  readonly nextCorrectionFormId: CreationCorrectionFormId | null;
  readonly pendingRollRequestIds: readonly string[];
  readonly randomStateOrNull: ResolvedRandomSymbiontSequence | null;
}

export function creationFinalizationHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function creationCorrectionId(
  characterDraftId: string,
  ...parts: readonly (string | number)[]
): string {
  return `creation-correction:${creationFinalizationHash(['symbiosis.creation-correction.v1', characterDraftId, ...parts])}`;
}
export function finalizationSummaryRecord(
  stage: CreationFinalizationStage,
): CreationFinalizationRecord | null {
  return stage.records.find((r) => r.request.payload.variant === 'PROPERTY_SUMMARY') ?? null;
}
export function creationCorrectionHeadHash(stage: CreationFinalizationStage): string {
  return creationFinalizationHash([
    stage.baseHistoryHash,
    stage.records.map((r) => ({
      request: r.request,
      receiptId: r.receipt.receiptId,
      physicalRolls: r.physicalRolls,
      afterStateHash: r.afterStateHash,
    })),
  ]);
}
export function finalizationActiveBranch(
  state: CreationFinalizationState,
): CreationCorrectionBranch {
  const branch = state.branches.find((b) => b.branchId === state.activeBranchId);
  return branch ?? guardSymbiontRejected();
}
export function creationFinalizationRecords(stage: CreationFinalizationStage) {
  return stage.records;
}
export function latestCreationFinalizationRecord(stage: CreationFinalizationStage) {
  return (
    stage.records.at(-1) ?? {
      request: stage.entryRequest,
      receipt: stage.entryReceipt,
      nextStageEnvelope: {
        formId: 'CHR-032' as const,
        routeBindings: [
          {
            parameterIndex: 0 as const,
            source: 'inherited' as const,
            value: stage.entryRequest.payload.characterDraftId,
          },
        ],
      },
    }
  );
}
export function creationFinalizationStageIds(
  stage: CreationFinalizationStage,
): ReadonlySet<string> {
  const ids = stage.records.flatMap((r) => [r.request.commandId, r.receipt.receiptId]);
  const rollIds = stage.records.flatMap((r) =>
    r.physicalRolls.flatMap((p) => [
      p.rollRequestId,
      ...(p.rollReceiptId === r.receipt.receiptId ? [] : [p.rollReceiptId]),
    ]),
  );
  ids.push(...rollIds);
  ids.push(...stage.state.branches.map((b) => b.branchId));
  const originalSequences = new Set(
    stage.initialState.branches.flatMap((b) =>
      b.randomSequenceOrNull === null ? [] : [b.randomSequenceOrNull.randomSequenceId],
    ),
  );
  const originalAdvisors = new Set(
    stage.initialState.advisorCards.map((c) => c.advisorInstanceDraftId),
  );
  ids.push(
    ...new Set(
      stage.state.branches.flatMap((b) =>
        b.randomSequenceOrNull === null ||
        originalSequences.has(b.randomSequenceOrNull.randomSequenceId)
          ? []
          : [b.randomSequenceOrNull.randomSequenceId],
      ),
    ),
  );
  ids.push(
    ...new Set(
      stage.state.advisorCards
        .filter((c) => !originalAdvisors.has(c.advisorInstanceDraftId))
        .map((c) => c.advisorInstanceDraftId),
    ),
  );
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || id.length === 0)
  )
    return guardSymbiontRejected();
  return new Set(ids);
}

type DecodedRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
const SHAPES = {
  PROPERTY_SUMMARY: [
    'CHR-032',
    'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    'propertyCheckpointReceiptId',
    'propertyRollReceipts',
  ],
  CORRECTION_IDENTITY: ['CHR-001', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', 'identity'],
  CORRECTION_RACE: [
    'CHR-010',
    'UI-CMD-CHAR-CREATION-SET-DECIDE',
    'raceChoice',
    'acquisitionModeIfFirstOrNull',
  ],
  CORRECTION_CLASS: ['CHR-011', 'UI-CMD-CHAR-CREATION-SET-DECIDE', 'pureClass'],
  CORRECTION_SKILLS: ['CHR-015', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', 'selectedSkills'],
  CORRECTION_MANUAL_COMPOSITION: [
    'CHR-018',
    'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    'acceptedSpecies',
    'selectedBindings',
  ],
  CORRECTION_RANDOM_ROLL: [
    'CHR-020',
    'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    'pendingRollRequestId',
    'manualFaceOrNull',
    'selectedMonsterSpeciesKeyOrNull',
  ],
  CORRECTION_RANDOM_BINDINGS: ['CHR-020', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', 'selectedBindings'],
  CORRECTION_MONSTER_CHOICE: [
    'CHR-020',
    'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    'selectedMonsterSpeciesKey',
  ],
  CORRECTION_ADVISOR_IW: [
    'CHR-041',
    'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    'pendingRollRequestIds',
    'manualFacesOrNull',
  ],
  CORRECTION_ADVISOR_B: [
    'CHR-041',
    'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    'pendingRollRequestId',
    'manualFaceOrNull',
  ],
  CORRECTION_ADVISOR_SKILLS: ['CHR-041', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', 'selectedSkills'],
  CORRECTION_INTERACTIONS: ['CHR-042', 'UI-CMD-CHAR-CREATION-SET-DECIDE', 'compositionHash'],
  FINAL_SAVE: ['CHR-025', 'OP-CHAR-CREATE'],
} as const;
export function normalizeCreationFinalizationRequest(
  request: DecodedRequest,
): CreationFinalizationRequest {
  const shell = objectSymbiontAt(request, '$');
  const payload = objectSymbiontAt(shell['payload'], '$.payload');
  const variant = payload['variant'];
  if (typeof variant !== 'string' || !Object.hasOwn(SHAPES, variant))
    return guardSymbiontRejected();
  const [source, command, ...fields] = SHAPES[variant as keyof typeof SHAPES];
  const operation = variant === 'FINAL_SAVE';
  exactSymbiontObject(shell, '$', [
    'messageType',
    'protocolVersion',
    'commandKind',
    'commandId',
    'expectedRevisions',
    'role',
    'payload',
    operation ? 'transition' : 'workflowCommandId',
  ]);
  exactSymbiontObject(payload, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    ...(variant === 'PROPERTY_SUMMARY' ? [] : ['summaryReceiptId', 'correctionHeadHash']),
    ...fields,
  ]);
  if (
    shell['messageType'] !== 'command.request' ||
    shell['protocolVersion'] !== 1 ||
    shell['role'] !== 'player' ||
    shell['commandKind'] !== (operation ? 'operation-command' : 'workflow-command') ||
    payload['stage'] !== 'FINALIZATION' ||
    payload['sourceFormId'] !== source ||
    (!operation && shell['workflowCommandId'] !== command)
  )
    return guardSymbiontRejected();
  if (
    operation &&
    !isDeepStrictEqual(shell['transition'], {
      from: 'CHR-025',
      kind: 'operation-command',
      to: 'CHR-040',
      trigger: 'Сохранить финального персонажа',
    })
  )
    return guardSymbiontRejected();
  nonEmptySymbiontStringAt(shell['commandId'], '$.commandId');
  for (const key of [
    'characterDraftId',
    'wizardCheckpointId',
    ...(variant === 'PROPERTY_SUMMARY'
      ? ['propertyCheckpointReceiptId']
      : ['summaryReceiptId', 'correctionHeadHash']),
  ])
    nonEmptySymbiontStringAt(payload[key], `$.payload.${key}`);
  revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision');
  const revisions = exactSymbiontObject(shell['expectedRevisions'], '$.expectedRevisions', [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  for (const key of Object.keys(revisions))
    revisionSymbiontAt(revisions[key], `$.expectedRevisions.${key}`);
  if (Object.hasOwn(payload, 'manualFaceOrNull') && payload['manualFaceOrNull'] !== null)
    d20SymbiontFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull');
  return request as CreationFinalizationRequest;
}
export function parseCreationFinalizationStage(value: unknown): CreationFinalizationStage {
  const stage = exactSymbiontObject(value, '$.finalizationStage', [
    'baseHistoryHash',
    'entryRequest',
    'entryReceipt',
    'initialState',
    'state',
    'records',
    'finalMechanicsSnapshotOrNull',
  ]);
  nonEmptySymbiontStringAt(stage['baseHistoryHash'], '$.finalizationStage.baseHistoryHash');
  if (!Array.isArray(stage['records']) || stage['records'].length === 0)
    return guardSymbiontRejected();
  for (const raw of stage['records']) {
    const record = exactSymbiontObject(raw, '$.finalizationStage.record', [
      'request',
      'receipt',
      'physicalRolls',
      'afterStateHash',
      'nextStageEnvelope',
    ]);
    normalizeCreationFinalizationRequest(record['request'] as DecodedRequest);
    exactSymbiontObject(record['receipt'], '$.finalizationStage.receipt', [
      'commandId',
      'receiptId',
      'revisions',
      'result',
    ]);
    if (!Array.isArray(record['physicalRolls'])) return guardSymbiontRejected();
  }
  const parsed = value as CreationFinalizationStage;
  creationFinalizationStageIds(parsed);
  return parsed;
}
