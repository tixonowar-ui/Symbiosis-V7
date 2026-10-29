import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import {
  recommendArmorQuality,
  validateArmorBundle,
  type ArmorBundleCatalog,
  type SymbiontCatalog,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import type { LocalCharacter, LocalCharacterCheckpoint } from '../persistence/index.js';
import {
  currentCreationWizardRevisions,
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  type CreationNextStageEnvelope,
  type CreationWizardSymbiontPayload,
  type DurableCreationWizardCheckpoint,
  type RollValidationCursor,
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
import {
  manualAdvisorWorkPending,
  manualInteractionConfirmationRequired,
  manualInteractionPreview,
  writeManualCommandPresentation,
} from './creation-manual-composition-navigation.js';
import {
  MANUAL_INTERACTION_CONFIRMATION_VARIANT,
  manualInteractionConfirmationReceipt,
  manualInteractionDiffJson,
} from './creation-manual-interaction.js';
import {
  armorBundleCheckpointReceipt,
  armorBundleEntryReceipt,
  armorBundleQualityRollReceipt,
  armorBundleStageIds,
  normalizeArmorBundleCheckpointRequest,
  normalizeArmorBundleEntryRequest,
  normalizeArmorBundleQualityRollRequest,
  type ArmorBundleCheckpointReceipt,
  type ArmorBundleCheckpointRequest,
  type ArmorBundleEntryRequest,
  type ArmorBundleQualityRollRecord,
  type ArmorBundleQualityRollReceipt,
  type ArmorBundleQualityRollRequest,
  type ArmorBundleQualityRecommendation,
  type ArmorBundleStage,
  type ArmorBundleStageEntryReceipt,
  type ArmorBundleStageEntryRequest,
} from './creation-armor-bundle-contract.js';

import { assertPureCompositionBinding } from './creation-pure-composition.js';
import type { SkillSelectionCheckpointReceipt } from './creation-skill-selection.js';
import { initialStartingWeaponStage } from './creation-starting-weapon-contract.js';

type DecodedCommandRequest = Parameters<typeof normalizeArmorBundleEntryRequest>[0];

export type ArmorBundleRecord =
  | {
      readonly kind: 'ENTRY';
      readonly request: ArmorBundleStageEntryRequest;
      readonly receipt: ArmorBundleStageEntryReceipt;
      readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-017' | 'CHR-021'>;
    }
  | {
      readonly kind: 'QUALITY_ROLL';
      readonly request: ArmorBundleQualityRollRequest;
      readonly receipt: ArmorBundleQualityRollReceipt;
      readonly nextStageEnvelope: ArmorBundleQualityRollRecord['nextStageEnvelope'];
    }
  | {
      readonly kind: 'CHECKPOINT';
      readonly request: ArmorBundleCheckpointRequest;
      readonly receipt: ArmorBundleCheckpointReceipt;
      readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-022'>;
    };

export function latestArmorBundleRecord(stage: ArmorBundleStage): ArmorBundleRecord {
  const checkpointRecord = stage.checkpointRecordOrNull;
  if (checkpointRecord !== null) {
    return { kind: 'CHECKPOINT', ...checkpointRecord };
  }
  const qualityRollRecord = stage.qualityRollRecordOrNull;
  if (qualityRollRecord !== null) {
    return { kind: 'QUALITY_ROLL', ...qualityRollRecord };
  }
  return {
    kind: 'ENTRY',
    request: stage.entryRequest,
    receipt: stage.entryReceipt,
    nextStageEnvelope: {
      formId: stage.entryRequest.payload.stage === 'SKILLS' ? 'CHR-017' : 'CHR-021',
      routeBindings: [
        {
          parameterIndex: 0,
          source: 'inherited',
          value: stage.entryRequest.payload.characterDraftId,
        },
      ],
    },
  };
}

export interface ArmorBundleEntryDependencies {
  readonly catalog: SymbiontCatalog;
  readonly allocateArmorBundleId: () => string;
  readonly allocateQualityRollRequestId: () => string;
}

export interface ArmorBundleQualityRollDependencies {
  readonly catalog: SymbiontCatalog;
  readonly armorCatalog: ArmorBundleCatalog;
  readonly sampleD20: () => number;
}

export interface ArmorBundleCheckpointDependencies {
  readonly catalog: SymbiontCatalog;
  readonly allocateWeaponQualityRollRequestId?: () => string;
}

interface ArmorBundleEntryPreflight {
  readonly request: ArmorBundleEntryRequest;
  readonly checkpoint: DurableCreationWizardCheckpoint;
}

interface ArmorBundleQualityRollPreflight {
  readonly request: ArmorBundleQualityRollRequest;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly stage: ArmorBundleStage;
}

interface ArmorBundleCheckpointPreflight {
  readonly request: ArmorBundleCheckpointRequest;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly stage: ArmorBundleStage;
}

function symbiontWorkComplete(
  manualStage: DurableCreationWizardCheckpoint['manualCompositionStage'],
  randomStage: DurableCreationWizardCheckpoint['randomSymbiontStage'],
): boolean {
  if (manualStage !== null && manualStage !== undefined) {
    return !manualAdvisorWorkPending(manualStage);
  }
  if (randomStage !== null && randomStage !== undefined) {
    return (
      randomStage.bindingRecordOrNull !== null &&
      (randomStage.advisorInstanceDraftIdOrNull === null ||
        randomStage.advisorSkillRecordOrNull !== null)
    );
  }
  return false;
}

export function assertEntryState(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  interaction: 'FORBID' | 'REQUIRE' = 'FORBID',
): void {
  const raceAndMethod = checkpoint.raceAndMethodStage;
  const confirmationRequired = manualInteractionConfirmationRequired(checkpoint, catalog);
  if (
    raceAndMethod === null ||
    raceAndMethod.race?.value === undefined ||
    raceAndMethod.race.value === 'PURE' ||
    raceAndMethod.diceInput?.value === undefined ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-019' ||
    (checkpoint.armorBundleStage !== null && checkpoint.armorBundleStage !== undefined) ||
    !symbiontWorkComplete(checkpoint.manualCompositionStage, checkpoint.randomSymbiontStage) ||
    (interaction === 'FORBID' ? confirmationRequired : !confirmationRequired)
  ) {
    return guardSymbiontRejected();
  }
}

export function preflightArmorBundleEntry(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): ArmorBundleEntryPreflight {
  const normalized = normalizeArmorBundleEntryRequest(request);
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
  assertEntryState(checkpoint, catalog);
  return { request: normalized, checkpoint };
}

export function freshArmorId(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
  receiptId: string,
  allocate: () => string,
  additional: readonly string[] = [],
): string {
  const occupied = new Set([
    ...creationWizardDurableIds(checkpoint),
    commandId,
    receiptId,
    ...additional,
  ]);
  const value = allocate();
  if (typeof value !== 'string' || value.length === 0 || occupied.has(value)) {
    return guardSymbiontRejected();
  }
  return value;
}

export function rewriteArmorPresentation(
  database: Database.Database,
  checkpoint: DurableCreationWizardCheckpoint,
  formId: 'CHR-021' | 'CHR-022',
  projectionRevision: number,
  draftRevision: number,
): void {
  const presentation = checkpoint.symbiontPresentationStage;
  if (presentation === null || presentation === undefined) return;
  const compositionDraftRevision =
    checkpoint.manualCompositionStage?.compositionDraftRevision ?? draftRevision;
  writeManualCommandPresentation(
    database,
    formId,
    checkpoint.localCharacter.localCharacterId,
    compositionDraftRevision,
    projectionRevision,
  );
}

export function commitArmorBundleEntry(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: ArmorBundleEntryDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `armor bundle entry receiptId must be non-empty, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeArmorBundleEntryRequest(request);
  preflightArmorBundleEntry(database, normalized, dependencies.catalog, receiptId);
  let validatedCheckpoint: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightArmorBundleEntry(
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
      const diceInputModeSnapshot = current.checkpoint.raceAndMethodStage!.diceInput!.value;
      const revisions = incrementedSymbiontRevisions(
        currentCreationWizardRevisions(current.checkpoint),
      );
      const nextStageEnvelope = nextSymbiontEnvelope(
        'CHR-021',
        normalized.payload.characterDraftId,
      );
      const receipt = armorBundleEntryReceipt(
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
        diceInputModeSnapshot,
        entryRequest: normalized,
        entryReceipt: receipt,
        qualityRollRequestId,
        qualityRollRecordOrNull: null,
        checkpointRecordOrNull: null,
      };
      armorBundleStageIds(armorBundleStage);
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
      rewriteArmorPresentation(
        database,
        current.checkpoint,
        'CHR-021',
        revisions.projectionRevision,
        receipt.result.draftRevision,
      );
      return result;
    },
    () => {
      validatedCheckpoint = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validatedCheckpoint === undefined) {
    throw new Error('armor bundle checkpoint validation was not executed');
  }
  return validatedCheckpoint;
}

function assertQualityRollState(
  checkpoint: DurableCreationWizardCheckpoint,
  request: ArmorBundleQualityRollRequest,
): ArmorBundleStage {
  const stage = checkpoint.armorBundleStage;
  const pureEntry =
    checkpoint.pureCompositionStage != null &&
    checkpoint.nextStageEnvelope.formId === 'CHR-017' &&
    checkpoint.symbiontPresentationStage?.formId === 'CHR-021';
  if (pureEntry) assertPureCompositionBinding(checkpoint);
  if (
    stage === null ||
    stage === undefined ||
    stage.qualityRollRecordOrNull !== null ||
    stage.checkpointRecordOrNull !== null ||
    (checkpoint.nextStageEnvelope.formId !== 'CHR-021' && !pureEntry) ||
    request.payload.armorBundleId !== stage.armorBundleId ||
    request.payload.qualityRollRequestId !== stage.qualityRollRequestId ||
    (stage.diceInputModeSnapshot === 'AUTO') !== (request.payload.manualFaceOrNull === null)
  ) {
    return guardSymbiontRejected();
  }
  return stage;
}

export function preflightArmorBundleQualityRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  dependencies: ArmorBundleQualityRollDependencies,
  receiptId?: string,
): ArmorBundleQualityRollPreflight {
  const normalized = normalizeArmorBundleQualityRollRequest(request);
  assertNoPreviousSymbiontCommand(database, dependencies.catalog, normalized);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
    receiptId,
    { allowArmorBundleStage: true },
  );
  const stage = assertQualityRollState(checkpoint, normalized);
  return { request: normalized, checkpoint, stage };
}

function validatedSelection(
  catalog: ArmorBundleCatalog,
  request: ArmorBundleQualityRollRequest,
): ReturnType<typeof validateArmorBundle> {
  try {
    return validateArmorBundle(catalog, request.payload.armorPieces);
  } catch {
    return guardSymbiontRejected();
  }
}

export function commitArmorBundleQualityRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: ArmorBundleQualityRollDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `armor bundle quality roll receiptId must be non-empty, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeArmorBundleQualityRollRequest(request);
  preflightArmorBundleQualityRoll(database, normalized, dependencies, receiptId);
  let validatedCheckpoint: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightArmorBundleQualityRoll(
        database,
        normalized,
        dependencies,
        receiptId,
      );
      const stage = assertQualityRollState(current.checkpoint, normalized);
      const bundle = validatedSelection(dependencies.armorCatalog, normalized);
      const rawFace =
        normalized.payload.manualFaceOrNull ?? sampledSymbiontFace(dependencies.sampleD20);
      const physicalRoll = {
        kind: 'ARMOR_BUNDLE_QUALITY' as const,
        rollRequestId: normalized.payload.qualityRollRequestId,
        rollReceiptId: receiptId,
        mechanical: { dieSides: 20 as const, rawFace },
      };
      const qualityRecommendation: ArmorBundleQualityRecommendation = Object.freeze({
        ...recommendArmorQuality(rawFace),
      });
      const revisions = incrementedSymbiontRevisions(
        currentCreationWizardRevisions(current.checkpoint),
      );
      const nextStageEnvelope = nextSymbiontEnvelope(
        'CHR-021',
        normalized.payload.characterDraftId,
      );
      const receipt = armorBundleQualityRollReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
          diceInputModeSnapshot: stage.diceInputModeSnapshot,
        },
        normalized,
        physicalRoll,
        bundle,
        qualityRecommendation,
      );
      const record: ArmorBundleQualityRollRecord = {
        armorPieces: bundle.armorPieces,
        distinctBodyZones: bundle.distinctBodyZones,
        qualityRecommendation,
        physicalRoll,
        request: normalized,
        receipt,
        nextStageEnvelope,
      };
      const armorBundleStage: ArmorBundleStage = {
        ...stage,
        qualityRollRecordOrNull: record,
      };
      armorBundleStageIds(armorBundleStage);
      const durablePayload = current.checkpoint.durablePayload as CreationWizardSymbiontPayload;
      const result = update(
        {
          payloadJson: JSON.stringify({
            ...durablePayload,
            nextStageEnvelope,
            receipt,
            randomReceiptIds:
              stage.diceInputModeSnapshot === 'AUTO'
                ? [...durablePayload.randomReceiptIds, receiptId]
                : durablePayload.randomReceiptIds,
            armorBundleStage,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      rewriteArmorPresentation(
        database,
        current.checkpoint,
        'CHR-021',
        revisions.projectionRevision,
        receipt.result.draftRevision,
      );
      return result;
    },
    () => {
      validatedCheckpoint = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validatedCheckpoint === undefined) {
    throw new Error('armor bundle checkpoint validation was not executed');
  }
  return validatedCheckpoint;
}

function assertCheckpointState(
  checkpoint: DurableCreationWizardCheckpoint,
  request: ArmorBundleCheckpointRequest,
): ArmorBundleStage {
  const stage = checkpoint.armorBundleStage;
  if (
    stage === null ||
    stage === undefined ||
    stage.qualityRollRecordOrNull === null ||
    stage.checkpointRecordOrNull !== null ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-021' ||
    request.payload.armorBundleId !== stage.armorBundleId ||
    request.payload.qualityRollReceiptId !== stage.qualityRollRecordOrNull.receipt.receiptId
  ) {
    return guardSymbiontRejected();
  }
  return stage;
}

export function preflightArmorBundleCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): ArmorBundleCheckpointPreflight {
  const normalized = normalizeArmorBundleCheckpointRequest(request);
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
    { allowArmorBundleStage: true },
  );
  const stage = assertCheckpointState(checkpoint, normalized);
  return { request: normalized, checkpoint, stage };
}

export function commitArmorBundleCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: ArmorBundleCheckpointDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `armor bundle checkpoint receiptId must be non-empty, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeArmorBundleCheckpointRequest(request);
  preflightArmorBundleCheckpoint(database, normalized, dependencies.catalog, receiptId);
  let validatedCheckpoint: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightArmorBundleCheckpoint(
        database,
        normalized,
        dependencies.catalog,
        receiptId,
      );
      const stage = assertCheckpointState(current.checkpoint, normalized);
      const qualityRollRecord = stage.qualityRollRecordOrNull!;
      const revisions = incrementedSymbiontRevisions(
        currentCreationWizardRevisions(current.checkpoint),
      );
      const nextStageEnvelope = nextSymbiontEnvelope(
        'CHR-022',
        normalized.payload.characterDraftId,
      );
      const weaponQualityRollRequestId =
        dependencies.allocateWeaponQualityRollRequestId === undefined
          ? undefined
          : freshArmorId(
              current.checkpoint,
              normalized.commandId,
              receiptId,
              dependencies.allocateWeaponQualityRollRequestId,
            );
      const receipt = armorBundleCheckpointReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
        },
        normalized,
        {
          armorPieces: qualityRollRecord.armorPieces,
          distinctBodyZones: qualityRollRecord.distinctBodyZones,
        },
        qualityRollRecord.receipt,
        weaponQualityRollRequestId,
      );
      const record = {
        armorPieces: qualityRollRecord.armorPieces,
        distinctBodyZones: qualityRollRecord.distinctBodyZones,
        request: normalized,
        receipt,
        nextStageEnvelope,
      };
      const armorBundleStage: ArmorBundleStage = {
        ...stage,
        checkpointRecordOrNull: record,
      };
      armorBundleStageIds(armorBundleStage);
      const startingWeaponStage =
        weaponQualityRollRequestId === undefined
          ? undefined
          : initialStartingWeaponStage(armorBundleStage, weaponQualityRollRequestId);
      const result = update(
        {
          payloadJson: JSON.stringify({
            ...current.checkpoint.durablePayload,
            nextStageEnvelope,
            receipt,
            armorBundleStage,
            ...(startingWeaponStage === undefined ? {} : { startingWeaponStage }),
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      rewriteArmorPresentation(
        database,
        current.checkpoint,
        'CHR-022',
        revisions.projectionRevision,
        receipt.result.draftRevision,
      );
      return result;
    },
    () => {
      validatedCheckpoint = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validatedCheckpoint === undefined) {
    throw new Error('armor bundle checkpoint validation was not executed');
  }
  return validatedCheckpoint;
}

export interface ArmorBundleValidationContext {
  readonly catalog: SymbiontCatalog;
  readonly localCharacter: LocalCharacter;
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly checkpointView: DurableCreationWizardCheckpoint;
  readonly cursor: RollValidationCursor;
  readonly commandIds: Set<string>;
  readonly receiptIds: Set<string>;
  readonly occupiedIds: Set<string>;
}

function occupy(context: ArmorBundleValidationContext, id: string): void {
  if (context.occupiedIds.has(id)) throw new Error(`duplicate durable ID ${JSON.stringify(id)}`);
  context.occupiedIds.add(id);
}

function advanceCursor(
  context: ArmorBundleValidationContext,
  cursor: RollValidationCursor,
  request:
    ArmorBundleStageEntryRequest | ArmorBundleQualityRollRequest | ArmorBundleCheckpointRequest,
  receipt:
    ArmorBundleStageEntryReceipt | ArmorBundleQualityRollReceipt | ArmorBundleCheckpointReceipt,
  nextStageEnvelope: RollValidationCursor['latestEnvelope'],
): RollValidationCursor {
  if (context.commandIds.has(request.commandId)) return guardSymbiontRejected();
  context.commandIds.add(request.commandId);
  if (context.receiptIds.has(receipt.receiptId)) return guardSymbiontRejected();
  context.receiptIds.add(receipt.receiptId);
  return {
    checkpointRevision: cursor.checkpointRevision + 1,
    draftRevision: cursor.draftRevision + 1,
    latestEnvelope: nextStageEnvelope,
    latestReceipt: receipt,
    latestRequest: request,
    revisions: receipt.revisions,
  };
}

export function validateArmorBundleStageHistory(
  stage: ArmorBundleStage,
  context: ArmorBundleValidationContext,
): { readonly cursor: RollValidationCursor } {
  const checkpointView = context.checkpointView;
  const acquisition = checkpointView.raceAndMethodStage;
  const payload = checkpointView.durablePayload as CreationWizardSymbiontPayload;
  const characterDraftId = context.localCharacter.localCharacterId;
  let cursor = context.cursor;
  if (stage.entryRequest.payload.stage === 'SKILLS') {
    assertPureCompositionBinding(checkpointView);
    if (
      acquisition?.diceInput?.value !== stage.diceInputModeSnapshot ||
      cursor.latestEnvelope.formId !== 'CHR-017'
    )
      return guardSymbiontRejected();
    const pure = checkpointView.pureCompositionStage!;
    for (const id of armorBundleStageIds(stage)) {
      if (
        pure.entryMode === 'SKILL_CHECKPOINT' &&
        (id === stage.entryRequest.commandId || id === stage.entryReceipt.receiptId)
      )
        continue;
      occupy(context, id);
    }
    if (pure.entryMode === 'SKILL_RECONFIRM') {
      const request = stage.entryRequest;
      const receipt = stage.entryReceipt as SkillSelectionCheckpointReceipt;
      const skills = checkpointView.skillSelectionStage!;
      const expected = {
        commandId: request.commandId,
        receiptId: receipt.receiptId,
        result: {
          ...skills.receipt.result,
          pureArmorBundleId: stage.armorBundleId,
          pureArmorQualityRollRequestId: stage.qualityRollRequestId,
          checkpointRevision: cursor.checkpointRevision + 1,
          draftRevision: cursor.draftRevision + 1,
        },
        revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      };
      if (
        request.payload.characterDraftId !== characterDraftId ||
        request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
        request.payload.draftRevision !== cursor.draftRevision ||
        !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions) ||
        !isDeepStrictEqual(receipt, expected)
      )
        return guardSymbiontRejected();
      cursor = advanceCursor(context, cursor, request, receipt, {
        formId: 'CHR-017',
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
      });
    }
  } else {
    if (
      acquisition === null ||
      acquisition.race?.value === undefined ||
      acquisition.race.value === 'PURE' ||
      acquisition.diceInput?.value !== stage.diceInputModeSnapshot ||
      checkpointView.skillSelectionStage === null ||
      !symbiontWorkComplete(payload.manualCompositionStage, payload.randomSymbiontStage) ||
      context.cursor.latestEnvelope.formId !== 'CHR-019'
    ) {
      return guardSymbiontRejected();
    }
    for (const id of armorBundleStageIds(stage)) occupy(context, id);

    const entryRequest = stage.entryRequest;
    if (
      entryRequest.payload.characterDraftId !== characterDraftId ||
      entryRequest.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      entryRequest.payload.draftRevision !== context.cursor.draftRevision ||
      !manualNavigationRevisionsMatch(entryRequest.expectedRevisions, context.cursor.revisions)
    ) {
      return guardSymbiontRejected();
    }
    const interaction = entryRequest.payload.variant === MANUAL_INTERACTION_CONFIRMATION_VARIANT;
    const entryCheckpoint = {
      ...checkpointView,
      manualCompositionStage: payload.manualCompositionStage ?? null,
    };
    if (manualInteractionConfirmationRequired(entryCheckpoint, context.catalog) !== interaction) {
      return guardSymbiontRejected();
    }
    if (
      interaction &&
      !isDeepStrictEqual(
        entryRequest.payload.interactionDiff,
        manualInteractionDiffJson(
          context.catalog,
          manualInteractionPreview(entryCheckpoint, context.catalog),
        ),
      )
    ) {
      return guardSymbiontRejected();
    }
    const facts = {
      checkpoint: checkpointView,
      receiptId: stage.entryReceipt.receiptId,
      revisions: incrementedSymbiontRevisions(entryRequest.expectedRevisions),
      checkpointRevision: context.cursor.checkpointRevision + 1,
      draftRevision: context.cursor.draftRevision + 1,
      armorBundleId: stage.armorBundleId,
      qualityRollRequestId: stage.qualityRollRequestId,
    };
    let entryReceipt: ArmorBundleStageEntryReceipt;
    if (entryRequest.workflowCommandId === 'UI-CMD-CHAR-CREATION-SET-DECIDE') {
      entryReceipt = manualInteractionConfirmationReceipt(facts, entryRequest);
    } else {
      entryReceipt = armorBundleEntryReceipt(facts, entryRequest as ArmorBundleEntryRequest);
    }
    const entryEnvelope = nextSymbiontEnvelope('CHR-021', characterDraftId);
    if (!isDeepStrictEqual(stage.entryReceipt, entryReceipt)) {
      return guardSymbiontRejected();
    }
    cursor = advanceCursor(context, context.cursor, entryRequest, entryReceipt, entryEnvelope);
  }

  const rollRecord = stage.qualityRollRecordOrNull;
  if (rollRecord !== null) {
    const request = rollRecord.request;
    if (
      request.payload.characterDraftId !== characterDraftId ||
      request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      request.payload.armorBundleId !== stage.armorBundleId ||
      request.payload.qualityRollRequestId !== stage.qualityRollRequestId ||
      request.payload.draftRevision !== cursor.draftRevision ||
      !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions)
    ) {
      return guardSymbiontRejected();
    }
    const bundle = {
      armorPieces: rollRecord.armorPieces,
      distinctBodyZones: rollRecord.distinctBodyZones,
    };
    const qualityRecommendation = recommendArmorQuality(rollRecord.physicalRoll.mechanical.rawFace);
    const receipt = armorBundleQualityRollReceipt(
      {
        checkpoint: checkpointView,
        receiptId: rollRecord.receipt.receiptId,
        revisions: incrementedSymbiontRevisions(request.expectedRevisions),
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
        diceInputModeSnapshot: stage.diceInputModeSnapshot,
      },
      request,
      rollRecord.physicalRoll,
      bundle,
      qualityRecommendation,
    );
    const nextStageEnvelope = nextSymbiontEnvelope('CHR-021', characterDraftId);
    if (
      !isDeepStrictEqual(rollRecord.receipt, receipt) ||
      !isDeepStrictEqual(rollRecord.nextStageEnvelope, nextStageEnvelope) ||
      !isDeepStrictEqual(rollRecord.qualityRecommendation, qualityRecommendation)
    ) {
      return guardSymbiontRejected();
    }
    cursor = advanceCursor(context, cursor, request, receipt, nextStageEnvelope);
  }

  const checkpointRecord = stage.checkpointRecordOrNull;
  if (checkpointRecord !== null) {
    if (rollRecord === null) return guardSymbiontRejected();
    const request = checkpointRecord.request;
    if (
      request.payload.characterDraftId !== characterDraftId ||
      request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      request.payload.armorBundleId !== stage.armorBundleId ||
      request.payload.qualityRollReceiptId !== rollRecord.receipt.receiptId ||
      request.payload.draftRevision !== cursor.draftRevision ||
      !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions)
    ) {
      return guardSymbiontRejected();
    }
    const receipt = armorBundleCheckpointReceipt(
      {
        checkpoint: checkpointView,
        receiptId: checkpointRecord.receipt.receiptId,
        revisions: incrementedSymbiontRevisions(request.expectedRevisions),
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
      },
      request,
      {
        armorPieces: checkpointRecord.armorPieces,
        distinctBodyZones: checkpointRecord.distinctBodyZones,
      },
      rollRecord.receipt,
      checkpointRecord.receipt.result.weaponQualityRollRequestId,
    );
    const nextStageEnvelope = nextSymbiontEnvelope('CHR-022', characterDraftId);
    if (
      !isDeepStrictEqual(checkpointRecord.receipt, receipt) ||
      !isDeepStrictEqual(checkpointRecord.nextStageEnvelope, nextStageEnvelope)
    ) {
      return guardSymbiontRejected();
    }
    cursor = advanceCursor(context, cursor, request, receipt, nextStageEnvelope);
  }

  return { cursor };
}
