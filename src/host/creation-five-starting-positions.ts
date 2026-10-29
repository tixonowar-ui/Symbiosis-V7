import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { SymbiontCatalog } from '../domain/index.js';
import {
  validateFiveStartingPositions,
  recommendPositionQuality,
  type FiveStartingPositionsCatalog,
  type ValidatedFiveStartingPosition,
} from '../domain/rules/item-stage/five-starting-positions.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import {
  currentCreationWizardRevisions,
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
  type CreationWizardSymbiontPayload,
} from './creation-set-decide.js';
import {
  assertCommonSymbiont,
  assertNoPreviousSymbiontCommand,
  sampledSymbiontFace,
} from './creation-symbiont-commands.js';
import {
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
} from './creation-symbiont-contract.js';
import { manualNavigationRevisionsMatch } from './creation-manual-composition-contract.js';
import type { ArmorBundleValidationContext } from './creation-armor-bundle.js';
import { rewriteStartingMoneyPresentation } from './creation-starting-money.js';
import { canonicalFiveStartingPositionsCatalog } from './five-starting-positions-catalog.js';
import {
  initialFiveStartingPositionsStage,
  normalizeFiveStartingPositionsRequest,
  fiveStartingPositionsCommonResult,
  fiveStartingPositionsStageForCheckpoint,
  fiveStartingPositionsPresentationForm,
  fiveStartingPositionsStageIds,
  fiveStartingPositionReceiptRefs,
  type FiveStartingPositionsStage,
  type FiveStartingPositionsRollRequest,
  type FiveStartingPositionsCheckpointRequest,
  type FiveStartingPositionsReceiptFacts,
  type FiveStartingPositionsReceipt,
  type FiveStartingPositionsRollReceipt,
  type FiveStartingPositionPhysicalRoll,
  type FiveStartingPositionSnapshot,
  type FiveStartingPositionsCheckpointReceipt,
} from './creation-five-starting-positions-contract.js';

type DecodedRequest = Parameters<typeof normalizeFiveStartingPositionsRequest>[0];
export interface FiveStartingPositionsDependencies {
  readonly catalog: SymbiontCatalog;
  readonly positionsCatalog: FiveStartingPositionsCatalog;
  readonly sampleD20: () => number;
}
export function latestFiveStartingPositionsRecord(stage: FiveStartingPositionsStage) {
  return (
    stage.checkpointRecordOrNull ??
    stage.rollRecords.at(-1) ?? {
      request: stage.entryRequest,
      receipt: stage.entryReceipt,
      nextStageEnvelope: nextSymbiontEnvelope(
        'CHR-037',
        stage.entryRequest.payload.characterDraftId,
      ),
    }
  );
}
export function fiveStartingPositionsRecords(stage: FiveStartingPositionsStage) {
  return [
    ...stage.rollRecords,
    ...(stage.checkpointRecordOrNull === null ? [] : [stage.checkpointRecordOrNull]),
  ];
}
function checkedDraft(
  stage: FiveStartingPositionsStage,
  request: FiveStartingPositionsRollRequest,
  catalog: FiveStartingPositionsCatalog,
): readonly ValidatedFiveStartingPosition[] {
  let selections: readonly ValidatedFiveStartingPosition[];
  try {
    selections = validateFiveStartingPositions(catalog, request.payload.positions);
  } catch {
    return guardSymbiontRejected();
  }
  if (
    !isDeepStrictEqual(
      selections.map((s) => s.positionId),
      stage.slots.map((s) => s.positionId),
    )
  )
    return guardSymbiontRejected();
  const slot = stage.slots.find((s) => s.positionId === request.payload.positionId);
  if (
    slot === undefined ||
    slot.qualityRollRequestId !== request.payload.qualityRollRequestId ||
    stage.rollRecords.some((r) => r.position.positionId === slot.positionId) ||
    (stage.diceInputModeSnapshot === 'AUTO') !== (request.payload.manualFaceOrNull === null)
  )
    return guardSymbiontRejected();
  for (const record of stage.rollRecords) {
    const selected = selections.find((s) => s.positionId === record.position.positionId);
    if (selected === undefined) return guardSymbiontRejected();
    for (const key of [
      'positionId',
      'itemTypeIdOrStoryType',
      'quantity',
      'storyDescriptionOrNull',
      'name',
      'kind',
    ] as const)
      if (selected[key] !== record.position[key]) return guardSymbiontRejected();
  }
  return selections;
}
function checkFinalRefs(
  stage: FiveStartingPositionsStage,
  request: FiveStartingPositionsCheckpointRequest,
): void {
  if (
    stage.rollRecords.length !== 5 ||
    !isDeepStrictEqual(request.payload.positionReceipts, fiveStartingPositionReceiptRefs(stage))
  )
    return guardSymbiontRejected();
}
function facts(
  checkpoint: DurableCreationWizardCheckpoint,
  receiptId: string,
): FiveStartingPositionsReceiptFacts {
  return {
    checkpoint,
    receiptId,
    revisions: incrementedSymbiontRevisions(currentCreationWizardRevisions(checkpoint)),
    checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
    draftRevision: checkpoint.receipt.result.draftRevision + 1,
  };
}
function rolledStage(
  stage: FiveStartingPositionsStage,
  request: FiveStartingPositionsRollRequest,
  f: FiveStartingPositionsReceiptFacts,
  physicalRoll: FiveStartingPositionPhysicalRoll,
  catalog: FiveStartingPositionsCatalog,
): FiveStartingPositionsStage {
  const draftSelections = checkedDraft(stage, request, catalog);
  const selected = draftSelections.find((s) => s.positionId === request.payload.positionId)!;
  const position: FiveStartingPositionSnapshot = {
    ...selected,
    qualityRollRequestId: request.payload.qualityRollRequestId,
    qualityRollReceiptId: f.receiptId,
    qualityRollFaceOrNull: physicalRoll.mechanical.rawFace,
    qualityRecommendation: { ...recommendPositionQuality(physicalRoll.mechanical.rawFace) },
  };
  const updated = { ...stage, draftSelections };
  const common = fiveStartingPositionsCommonResult(f, updated);
  const receipt: FiveStartingPositionsRollReceipt = {
    commandId: request.commandId,
    receiptId: f.receiptId,
    revisions: f.revisions,
    result: {
      ...common,
      variant: 'FIVE_STARTING_POSITIONS_ROLL',
      positionId: selected.positionId,
      physicalRoll,
      positions: common.positions.map((p) => (p.positionId === selected.positionId ? position : p)),
      nextFormId: 'CHR-037',
    },
  };
  return {
    ...updated,
    rollRecords: [
      ...stage.rollRecords,
      {
        request,
        receipt,
        physicalRoll,
        position,
        nextStageEnvelope: nextSymbiontEnvelope('CHR-037', request.payload.characterDraftId),
      },
    ],
  };
}
function checkpointedStage(
  stage: FiveStartingPositionsStage,
  request: FiveStartingPositionsCheckpointRequest,
  f: FiveStartingPositionsReceiptFacts,
): FiveStartingPositionsStage {
  checkFinalRefs(stage, request);
  const receipt: FiveStartingPositionsCheckpointReceipt = {
    commandId: request.commandId,
    receiptId: f.receiptId,
    revisions: f.revisions,
    result: {
      ...fiveStartingPositionsCommonResult(f, stage),
      variant: 'FIVE_STARTING_POSITIONS_CHECKPOINT',
      nextFormId: 'CHR-032',
    },
  };
  return {
    ...stage,
    checkpointRecordOrNull: {
      request,
      receipt,
      nextStageEnvelope: nextSymbiontEnvelope('CHR-032', request.payload.characterDraftId),
    },
  };
}
export function preflightFiveStartingPositions(
  database: Database.Database,
  incoming: DecodedRequest,
  dependencies: FiveStartingPositionsDependencies,
  receiptId?: string,
) {
  const request = normalizeFiveStartingPositionsRequest(incoming);
  assertNoPreviousSymbiontCommand(database, dependencies.catalog, request);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    request.payload.characterDraftId,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    request,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    request.payload.draftRevision,
    receiptId,
    {
      allowArmorBundleStage: true,
      allowStartingWeaponStage: true,
      allowWeaponProfileStage: true,
      allowStartingMoneyStage: true,
      allowFiveStartingPositionsStage: true,
    },
  );
  const stage = fiveStartingPositionsStageForCheckpoint(checkpoint);
  if (
    stage === null ||
    stage.checkpointRecordOrNull !== null ||
    stage.moneyCheckpointReceiptId !== request.payload.moneyCheckpointReceiptId ||
    fiveStartingPositionsPresentationForm(checkpoint) !== 'CHR-037'
  )
    return guardSymbiontRejected();
  if (checkpoint.fiveStartingPositionsStage == null) {
    const occupied = creationWizardDurableIds(checkpoint);
    for (const id of fiveStartingPositionsStageIds(stage))
      if (occupied.has(id) || request.commandId === id || receiptId === id)
        return guardSymbiontRejected();
  }
  if (request.payload.variant === 'FIVE_STARTING_POSITIONS_ROLL')
    checkedDraft(stage, request as FiveStartingPositionsRollRequest, dependencies.positionsCatalog);
  else checkFinalRefs(stage, request as FiveStartingPositionsCheckpointRequest);
  return { request, checkpoint, stage };
}
export function commitFiveStartingPositions(
  database: Database.Database,
  incoming: DecodedRequest,
  receiptId: string,
  dependencies: FiveStartingPositionsDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0)
    throw new TypeError('five positions receiptId must be non-empty');
  const normalized = normalizeFiveStartingPositionsRequest(incoming);
  preflightFiveStartingPositions(database, normalized, dependencies, receiptId);
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightFiveStartingPositions(database, normalized, dependencies, receiptId);
      const { request } = current;
      let stage: FiveStartingPositionsStage;
      if (request.payload.variant === 'FIVE_STARTING_POSITIONS_ROLL') {
        const typed = request as FiveStartingPositionsRollRequest;
        const physicalRoll: FiveStartingPositionPhysicalRoll = {
          kind: 'FIVE_STARTING_POSITION_QUALITY',
          rollRequestId: typed.payload.qualityRollRequestId,
          rollReceiptId: receiptId,
          mechanical: {
            dieSides: 20,
            rawFace: typed.payload.manualFaceOrNull ?? sampledSymbiontFace(dependencies.sampleD20),
          },
        };
        stage = rolledStage(
          current.stage,
          typed,
          facts(current.checkpoint, receiptId),
          physicalRoll,
          dependencies.positionsCatalog,
        );
      } else
        stage = checkpointedStage(
          current.stage,
          request as FiveStartingPositionsCheckpointRequest,
          facts(current.checkpoint, receiptId),
        );
      fiveStartingPositionsStageIds(stage);
      const receipt = latestFiveStartingPositionsRecord(stage)
        .receipt as FiveStartingPositionsReceipt;
      const payload = current.checkpoint.durablePayload as CreationWizardSymbiontPayload;
      const saved = update(
        {
          payloadJson: JSON.stringify({
            ...payload,
            fiveStartingPositionsStage: stage,
            receipt,
            nextStageEnvelope: nextSymbiontEnvelope(
              receipt.result.nextFormId,
              request.payload.characterDraftId,
            ),
            randomReceiptIds:
              request.payload.variant === 'FIVE_STARTING_POSITIONS_ROLL' &&
              stage.diceInputModeSnapshot === 'AUTO'
                ? [...payload.randomReceiptIds, receiptId]
                : payload.randomReceiptIds,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      rewriteStartingMoneyPresentation(
        database,
        current.checkpoint,
        'CHR-037',
        receipt.revisions.projectionRevision,
        receipt.result.draftRevision,
      );
      return saved;
    },
    () => {
      validated = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validated === undefined)
    throw new Error('five positions post-write validation was not executed');
  return validated;
}
export function advanceFiveStartingPositionsPresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: 'CHR-037' | 'CHR-038';
  },
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  const check = () => {
    const current = loadCreationWizardCheckpoint(
      database,
      input.characterDraftId,
      catalog.skillStage,
      catalog,
    );
    const stage = fiveStartingPositionsStageForCheckpoint(current);
    const source = fiveStartingPositionsPresentationForm(current);
    if (
      stage === null ||
      stage.checkpointRecordOrNull !== null ||
      current.checkpoint.checkpointId !== input.wizardCheckpointId ||
      current.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER ||
      !(
        (source === 'CHR-037' && input.formId === 'CHR-038') ||
        (source === 'CHR-038' && input.formId === 'CHR-037')
      )
    )
      return guardSymbiontRejected();
    return current;
  };
  check();
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    input.characterDraftId,
    input.wizardCheckpointId,
    (update) => {
      const current = check();
      rewriteStartingMoneyPresentation(
        database,
        current,
        input.formId,
        current.localCharacter.projectionRevision + 1,
      );
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
    () => {
      validated = loadCreationWizardCheckpoint(
        database,
        input.characterDraftId,
        catalog.skillStage,
        catalog,
      );
    },
  );
  if (validated === undefined)
    throw new Error('five positions presentation validation was not executed');
  return validated;
}
export function validateFiveStartingPositionsStageHistory(
  stage: FiveStartingPositionsStage,
  context: ArmorBundleValidationContext,
) {
  const view = context.checkpointView;
  const money =
    view.startingMoneyStage ??
    ('startingMoneyStage' in view.durablePayload
      ? view.durablePayload.startingMoneyStage
      : undefined);
  if (money == null || context.cursor.latestEnvelope.formId !== 'CHR-037')
    return guardSymbiontRejected();
  let reconstructed = initialFiveStartingPositionsStage(money);
  for (const key of [
    'moneyCheckpointReceiptId',
    'moneyRollRequestId',
    'moneyRollReceiptId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
    'slots',
  ] as const)
    if (!isDeepStrictEqual(reconstructed[key], stage[key])) return guardSymbiontRejected();
  for (const id of fiveStartingPositionsStageIds(stage)) {
    if (context.occupiedIds.has(id)) return guardSymbiontRejected();
    context.occupiedIds.add(id);
  }
  let cursor = context.cursor;
  const catalog = canonicalFiveStartingPositionsCatalog();
  for (const record of fiveStartingPositionsRecords(stage)) {
    const request = record.request;
    if (
      request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
      request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      request.payload.moneyCheckpointReceiptId !== stage.moneyCheckpointReceiptId ||
      request.payload.draftRevision !== cursor.draftRevision ||
      !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions) ||
      context.commandIds.has(request.commandId) ||
      context.receiptIds.has(record.receipt.receiptId)
    )
      return guardSymbiontRejected();
    const f: FiveStartingPositionsReceiptFacts = {
      checkpoint: view,
      receiptId: record.receipt.receiptId,
      revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
    };
    if (request.payload.variant === 'FIVE_STARTING_POSITIONS_ROLL') {
      const typed = request as FiveStartingPositionsRollRequest;
      if (!('physicalRoll' in record)) return guardSymbiontRejected();
      const physical: FiveStartingPositionPhysicalRoll = {
        kind: 'FIVE_STARTING_POSITION_QUALITY',
        rollRequestId: typed.payload.qualityRollRequestId,
        rollReceiptId: record.receipt.receiptId,
        mechanical: { dieSides: 20, rawFace: record.physicalRoll.mechanical.rawFace },
      };
      if (
        !isDeepStrictEqual(physical, record.physicalRoll) ||
        (stage.diceInputModeSnapshot === 'MANUAL' &&
          typed.payload.manualFaceOrNull !== physical.mechanical.rawFace)
      )
        return guardSymbiontRejected();
      reconstructed = rolledStage(reconstructed, typed, f, physical, catalog);
    } else
      reconstructed = checkpointedStage(
        reconstructed,
        request as FiveStartingPositionsCheckpointRequest,
        f,
      );
    const expected = latestFiveStartingPositionsRecord(reconstructed);
    if (!isDeepStrictEqual(expected, record)) return guardSymbiontRejected();
    context.commandIds.add(request.commandId);
    context.receiptIds.add(record.receipt.receiptId);
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: expected.nextStageEnvelope,
      latestRequest: request,
      latestReceipt: expected.receipt,
      revisions: expected.receipt.revisions,
    };
  }
  if (!isDeepStrictEqual(reconstructed, stage)) return guardSymbiontRejected();
  return { cursor };
}
