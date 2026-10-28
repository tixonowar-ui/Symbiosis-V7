import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import type { ClientToHostMessage, JsonObject } from '@shared/wire-protocol.js';

import type { SymbiontCatalog } from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
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
import { manualInteractionDiffJson } from './creation-manual-interaction-json.js';
import {
  manualInteractionConfirmationReceipt,
  normalizeManualInteractionConfirmationRequest,
  type ManualInteractionConfirmationRequest,
} from './creation-manual-interaction-contract.js';
import {
  assertCommonSymbiont,
  assertNoPreviousSymbiontCommand,
} from './creation-symbiont-commands.js';
import {
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
} from './creation-symbiont-contract.js';

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

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
