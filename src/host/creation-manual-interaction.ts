import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

import type {
  ManualInteractionPreview,
  SymbiontCatalog,
  SymbiontComposition,
  SymbiontStatModifierEffect,
  ValidatedManualComposition,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import {
  assertEntryState,
  freshArmorId,
  type ArmorBundleEntryDependencies,
} from './creation-armor-bundle.js';
import { armorBundleStageIds, type ArmorBundleStage } from './creation-armor-bundle-contract.js';
import {
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  validateDurableCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  manualInteractionPreview,
  writeManualCommandPresentation,
} from './creation-manual-composition-navigation.js';
import {
  assertCommonSymbiont,
  assertNoPreviousSymbiontCommand,
} from './creation-symbiont-commands.js';
import {
  CreationSymbiontApplicationError,
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
  SYMBIONT_STAGE,
  exactSymbiontObject,
  nonEmptySymbiontStringAt,
  objectSymbiontAt,
  revisionSymbiontAt,
  symbiontBindingsJson,
} from './creation-symbiont-contract.js';

export const MANUAL_INTERACTION_CONFIRMATION_VARIANT = 'MANUAL_INTERACTION_CONFIRMATION' as const;

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

export interface ManualInteractionConfirmationPayload extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly sourceFormId: 'CHR-042';
  readonly variant: typeof MANUAL_INTERACTION_CONFIRMATION_VARIANT;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly interactionDiff: JsonObject;
}

export type ManualInteractionConfirmationRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  ManualInteractionConfirmationPayload
>;

export interface ManualInteractionConfirmationReceiptResult extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly sourceFormId: 'CHR-042';
  readonly variant: typeof MANUAL_INTERACTION_CONFIRMATION_VARIANT;
  readonly anatomyProfile: 'STANDARD_HUMANOID';
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
  readonly interactionDiff: JsonObject;
  readonly nextFormId: 'CHR-021';
}

export type ManualInteractionConfirmationReceipt =
  CommandReceipt<ManualInteractionConfirmationReceiptResult>;

function literal<T extends JsonValue>(value: unknown, expected: T, path: string): T {
  if (!isDeepStrictEqual(value, expected)) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path,
      value: value as JsonValue,
    });
  }
  return expected;
}

function revisionsAt(value: unknown): RevisionVector {
  const object = exactSymbiontObject(value, '$.expectedRevisions', [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    actorVisibilityRevision: revisionSymbiontAt(
      object['actorVisibilityRevision'],
      '$.expectedRevisions.actorVisibilityRevision',
    ),
    projectionRevision: revisionSymbiontAt(
      object['projectionRevision'],
      '$.expectedRevisions.projectionRevision',
    ),
    stateRevision: revisionSymbiontAt(object['stateRevision'], '$.expectedRevisions.stateRevision'),
  };
}

export function normalizeManualInteractionConfirmationRequest(
  request: DecodedCommandRequest,
): ManualInteractionConfirmationRequest {
  const envelope = exactSymbiontObject(request, '$', [
    'commandId',
    'commandKind',
    'expectedRevisions',
    'messageType',
    'payload',
    'protocolVersion',
    'role',
    'workflowCommandId',
  ]);
  literal(envelope['messageType'], 'command.request', '$.messageType');
  literal(envelope['protocolVersion'], 1, '$.protocolVersion');
  literal(envelope['role'], 'player', '$.role');
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-CREATION-SET-DECIDE', '$.workflowCommandId');
  if (request.commandKind !== 'workflow-command') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.commandKind',
      value: request.commandKind,
    });
  }
  const payload = exactSymbiontObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'interactionDiff',
  ]);
  literal(payload['stage'], SYMBIONT_STAGE, '$.payload.stage');
  literal(payload['sourceFormId'], 'CHR-042', '$.payload.sourceFormId');
  literal(payload['variant'], MANUAL_INTERACTION_CONFIRMATION_VARIANT, '$.payload.variant');
  return {
    commandId: nonEmptySymbiontStringAt(envelope['commandId'], '$.commandId'),
    commandKind: 'workflow-command',
    expectedRevisions: revisionsAt(request.expectedRevisions),
    messageType: 'command.request',
    payload: {
      stage: SYMBIONT_STAGE,
      sourceFormId: 'CHR-042',
      variant: MANUAL_INTERACTION_CONFIRMATION_VARIANT,
      characterDraftId: nonEmptySymbiontStringAt(
        payload['characterDraftId'],
        '$.payload.characterDraftId',
      ),
      wizardCheckpointId: nonEmptySymbiontStringAt(
        payload['wizardCheckpointId'],
        '$.payload.wizardCheckpointId',
      ),
      draftRevision: revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision'),
      interactionDiff: objectSymbiontAt(
        payload['interactionDiff'],
        '$.payload.interactionDiff',
      ) as JsonObject,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-SET-DECIDE',
  };
}

export function manualInteractionConfirmationReceipt(
  facts: {
    readonly checkpoint: DurableCreationWizardCheckpoint;
    readonly receiptId: string;
    readonly revisions: RevisionVector;
    readonly checkpointRevision: number;
    readonly draftRevision: number;
    readonly armorBundleId: string;
    readonly qualityRollRequestId: string;
  },
  request: ManualInteractionConfirmationRequest,
): ManualInteractionConfirmationReceipt {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid,
      characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
      checkpointId: facts.checkpoint.checkpoint.checkpointId,
      checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
      checkpointRevision: facts.checkpointRevision,
      draftRevision: facts.draftRevision,
      stage: SYMBIONT_STAGE,
      sourceFormId: 'CHR-042',
      variant: MANUAL_INTERACTION_CONFIRMATION_VARIANT,
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId: facts.armorBundleId,
      qualityRollRequestId: facts.qualityRollRequestId,
      interactionDiff: request.payload.interactionDiff,
      nextFormId: 'CHR-021',
    },
  };
}

function compositionJson(
  catalog: SymbiontCatalog,
  composition: SymbiontComposition,
  bindings: ValidatedManualComposition['bindings'],
): JsonObject {
  return {
    symbiontInstancesDraft: composition.instances.map((instance) => {
      const species = catalog.species.find(
        (candidate) => candidate.speciesKey === instance.speciesKey,
      );
      if (species === undefined) throw new Error('composition references an unknown species');
      return {
        acceptedIndex: instance.acceptedIndex,
        speciesKey: instance.speciesKey,
        speciesLabel: species.speciesLabel,
        status: instance.status,
        slotCost: instance.slotCost,
        currentOe: instance.currentOe,
        absorbedSpeciesKeys: instance.absorbedSpeciesKeys,
      };
    }),
    speciesKeys: composition.acceptedSpecies.map((accepted) => accepted.speciesKey),
    bindings: symbiontBindingsJson(bindings),
    slotUsageAndCapacity: { used: composition.slotUsage, capacity: composition.slotCapacity },
  };
}

function modifierEffectJson(
  effect: SymbiontStatModifierEffect | Readonly<{ kind: 'INACTIVE' }>,
): JsonObject {
  if (effect.kind !== 'ADDITIVE_STAT_MODIFIERS') return { kind: effect.kind };
  return {
    kind: effect.kind,
    entries: effect.entries.map((entry) => ({
      statCode: entry.statCode,
      statLabel: entry.statLabel,
      delta: entry.delta,
    })),
  };
}

export function manualInteractionDiffJson(
  catalog: SymbiontCatalog,
  preview: ManualInteractionPreview,
): JsonObject {
  return {
    compositionBefore: compositionJson(
      catalog,
      preview.compositionBefore.composition,
      preview.compositionBefore.bindings,
    ),
    compositionAfter: compositionJson(
      catalog,
      preview.compositionAfter.composition,
      preview.compositionAfter.bindings,
    ),
    interactionGraph: preview.interactionGraph,
    suppressionDestructionAbsorption: preview.suppressionDestructionAbsorption,
    slotStatOeDiff: {
      slotUsageBefore: preview.slotStatOeDiff.slotUsageBefore,
      slotUsageAfter: preview.slotStatOeDiff.slotUsageAfter,
      entries: preview.slotStatOeDiff.entries.map((entry) => ({
        speciesKey: entry.speciesKey,
        before:
          entry.before === null
            ? null
            : {
                slotCost: entry.before.slotCost,
                currentOe: entry.before.currentOe,
                status: entry.before.status,
              },
        after:
          entry.after === null
            ? null
            : {
                slotCost: entry.after.slotCost,
                currentOe: entry.after.currentOe,
                status: entry.after.status,
              },
      })),
      modifierBreakdownBefore: modifierEffectJson(preview.slotStatOeDiff.modifierBreakdownBefore),
      modifierBreakdownAfter: modifierEffectJson(preview.slotStatOeDiff.modifierBreakdownAfter),
    },
    irreversibleOperationIds: preview.irreversibleOperationIds,
  };
}

interface ManualInteractionConfirmationPreflight {
  readonly request: ManualInteractionConfirmationRequest;
  readonly checkpoint: DurableCreationWizardCheckpoint;
}

function assertExactDiff(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  interactionDiff: JsonObject,
): void {
  assertEntryState(checkpoint, catalog, 'REQUIRE');
  const expected = manualInteractionDiffJson(
    catalog,
    manualInteractionPreview(checkpoint, catalog),
  );
  if (!isDeepStrictEqual(interactionDiff, expected)) guardSymbiontRejected();
}

export function preflightManualInteractionConfirmation(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): ManualInteractionConfirmationPreflight {
  const normalized = normalizeManualInteractionConfirmationRequest(request);
  assertNoPreviousSymbiontCommand(database, catalog, normalized);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
    receiptId,
  );
  assertExactDiff(checkpoint, catalog, normalized.payload.interactionDiff);
  return { request: normalized, checkpoint };
}

export function commitManualInteractionConfirmation(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: ArmorBundleEntryDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError('manual interaction confirmation receiptId must be non-empty');
  }
  const normalized = normalizeManualInteractionConfirmationRequest(request);
  preflightManualInteractionConfirmation(database, normalized, dependencies.catalog, receiptId);
  let validatedCheckpoint: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightManualInteractionConfirmation(
        database,
        normalized,
        dependencies.catalog,
        receiptId,
      );
      const armorBundleId = freshArmorId(
        current.checkpoint,
        normalized.commandId,
        receiptId,
        dependencies.allocateArmorBundleId,
      );
      const qualityRollRequestId = freshArmorId(
        current.checkpoint,
        normalized.commandId,
        receiptId,
        dependencies.allocateQualityRollRequestId,
        [armorBundleId],
      );
      const revisions = incrementedSymbiontRevisions(
        currentCreationWizardRevisions(current.checkpoint),
      );
      const receipt = manualInteractionConfirmationReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
          armorBundleId,
          qualityRollRequestId,
        },
        normalized,
      );
      const armorBundleStage: ArmorBundleStage = {
        anatomyProfile: 'STANDARD_HUMANOID',
        armorBundleId,
        diceInputModeSnapshot: current.checkpoint.raceAndMethodStage!.diceInput!.value,
        entryRequest: normalized,
        entryReceipt: receipt,
        qualityRollRequestId,
        qualityRollRecordOrNull: null,
        checkpointRecordOrNull: null,
      };
      armorBundleStageIds(armorBundleStage);
      const nextStageEnvelope = nextSymbiontEnvelope(
        'CHR-021',
        normalized.payload.characterDraftId,
      );
      const result = update(
        {
          payloadJson: JSON.stringify({
            ...current.checkpoint.durablePayload,
            nextStageEnvelope,
            receipt,
            armorBundleStage,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      if (current.checkpoint.symbiontPresentationStage !== null) {
        writeManualCommandPresentation(
          database,
          'CHR-021',
          normalized.payload.characterDraftId,
          current.checkpoint.manualCompositionStage?.compositionDraftRevision ??
            current.checkpoint.receipt.result.draftRevision,
          revisions.projectionRevision,
        );
      }
      return result;
    },
    (result, checkpoint) => {
      validatedCheckpoint = validateDurableCreationWizardCheckpoint(
        result,
        checkpoint,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validatedCheckpoint === undefined) {
    throw new Error('manual interaction checkpoint validation was not executed');
  }
  return validatedCheckpoint;
}
