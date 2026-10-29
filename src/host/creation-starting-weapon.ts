import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import {
  validateStartingWeapon,
  validateStartingWeaponRace,
  canonicalStartingWeaponSelection,
  type StartingWeaponCatalog,
  type SymbiontCatalog,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import {
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
  type RollValidationCursor,
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
import {
  freshArmorId,
  rewriteArmorPresentation,
  type ArmorBundleValidationContext,
} from './creation-armor-bundle.js';
import { manualNavigationRevisionsMatch } from './creation-manual-composition-contract.js';
import {
  initialStartingWeaponStage,
  normalizeStartingWeaponEntryRequest,
  normalizeStartingWeaponQualityRollRequest,
  normalizeStartingWeaponCheckpointRequest,
  startingWeaponEntryReceipt,
  startingWeaponQualityRollReceipt,
  startingWeaponCheckpointReceipt,
  startingWeaponStageIds,
  type StartingWeaponEntryRequest,
  type StartingWeaponQualityRollRequest,
  type StartingWeaponStage,
  type StartingWeaponQualityRollRecord,
  type StartingWeaponRequest,
  type StartingWeaponReceiptFacts,
  type StartingWeaponReceipt,
} from './creation-starting-weapon-contract.js';

type DecodedRequest = Parameters<typeof normalizeStartingWeaponEntryRequest>[0];
export interface StartingWeaponEntryDependencies {
  readonly catalog: SymbiontCatalog;
  readonly allocateWeaponQualityRollRequestId: () => string;
}
export interface StartingWeaponCheckpointDependencies {
  readonly catalog: SymbiontCatalog;
  readonly weaponCatalog: StartingWeaponCatalog;
}
export interface StartingWeaponQualityRollDependencies extends StartingWeaponCheckpointDependencies {
  readonly sampleD20: () => number;
}
export function latestStartingWeaponRecord(stage: StartingWeaponStage) {
  return (
    stage.checkpointRecordOrNull ??
    stage.qualityRollRecordOrNull ?? {
      request: stage.entryRequest,
      receipt: stage.entryReceipt,
      nextStageEnvelope: nextSymbiontEnvelope(
        'CHR-022',
        stage.entryRequest.payload.characterDraftId,
      ),
    }
  );
}
export function startingWeaponRecords(stage: StartingWeaponStage) {
  return [
    ...(stage.entryRequest.payload.variant === 'STARTING_WEAPON_ENTRY'
      ? [
          {
            request: stage.entryRequest,
            receipt: stage.entryReceipt,
            nextStageEnvelope: nextSymbiontEnvelope(
              'CHR-022',
              stage.entryRequest.payload.characterDraftId,
            ),
          },
        ]
      : []),
    ...(stage.qualityRollRecordOrNull === null ? [] : [stage.qualityRollRecordOrNull]),
    ...(stage.checkpointRecordOrNull === null ? [] : [stage.checkpointRecordOrNull]),
  ];
}
function checkedCommon(
  database: Database.Database,
  request: StartingWeaponRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): DurableCreationWizardCheckpoint {
  assertNoPreviousSymbiontCommand(database, catalog, request);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    request.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    request,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    request.payload.draftRevision,
    receiptId,
    { allowArmorBundleStage: true, allowStartingWeaponStage: true },
  );
  return checkpoint;
}
function armorCheckpoint(checkpoint: DurableCreationWizardCheckpoint) {
  const armor = checkpoint.armorBundleStage;
  if (
    armor === null ||
    armor === undefined ||
    armor.checkpointRecordOrNull === null ||
    checkpoint.raceAndMethodStage?.diceInput === null ||
    checkpoint.raceAndMethodStage?.race === null
  )
    return guardSymbiontRejected();
  return armor;
}
function assertEntryState(
  checkpoint: DurableCreationWizardCheckpoint,
  request: StartingWeaponEntryRequest,
) {
  const armor = armorCheckpoint(checkpoint);
  if (
    checkpoint.startingWeaponStage != null ||
    armor.checkpointRecordOrNull!.receipt.result.weaponQualityRollRequestId !== undefined ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-022' ||
    request.payload.armorBundleId !== armor.armorBundleId ||
    request.payload.armorBundleCheckpointReceiptId !==
      armor.checkpointRecordOrNull!.receipt.receiptId
  )
    return guardSymbiontRejected();
  return armor;
}
export function preflightStartingWeaponEntry(
  database: Database.Database,
  request: DecodedRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
) {
  const normalized = normalizeStartingWeaponEntryRequest(request);
  const checkpoint = checkedCommon(database, normalized, catalog, receiptId);
  const armor = assertEntryState(checkpoint, normalized);
  return { request: normalized, checkpoint, armor };
}
function facts(
  checkpoint: DurableCreationWizardCheckpoint,
  receiptId: string,
): StartingWeaponReceiptFacts {
  return {
    checkpoint,
    receiptId,
    revisions: incrementedSymbiontRevisions(currentCreationWizardRevisions(checkpoint)),
    checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
    draftRevision: checkpoint.receipt.result.draftRevision + 1,
  };
}
function commit(
  database: Database.Database,
  request: StartingWeaponRequest,
  receiptId: string,
  catalog: SymbiontCatalog,
  prepare: () => {
    checkpoint: DurableCreationWizardCheckpoint;
    stage: StartingWeaponStage;
    receipt: StartingWeaponReceipt;
    nextStageEnvelope: DurableCreationWizardCheckpoint['nextStageEnvelope'];
    random: boolean;
  },
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0)
    throw new TypeError('starting weapon receiptId must be non-empty');
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    (update) => {
      const value = prepare();
      startingWeaponStageIds(value.stage);
      const payload = value.checkpoint.durablePayload as CreationWizardSymbiontPayload;
      const result = update(
        {
          payloadJson: JSON.stringify({
            ...payload,
            startingWeaponStage: value.stage,
            receipt: value.receipt,
            nextStageEnvelope: value.nextStageEnvelope,
            randomReceiptIds: value.random
              ? [...payload.randomReceiptIds, receiptId]
              : payload.randomReceiptIds,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      // Final destinations remain unpublished, while the durable record keeps the signed route.
      rewriteArmorPresentation(
        database,
        value.checkpoint,
        'CHR-022',
        value.receipt.revisions.projectionRevision,
        value.receipt.result.draftRevision,
      );
      return result;
    },
    () => {
      validated = loadCreationWizardCheckpoint(
        database,
        request.payload.characterDraftId,
        catalog.skillStage,
        catalog,
      );
    },
  );
  if (validated === undefined)
    throw new Error('starting weapon post-write validation was not executed');
  return validated;
}
export function commitStartingWeaponEntry(
  database: Database.Database,
  request: DecodedRequest,
  receiptId: string,
  dependencies: StartingWeaponEntryDependencies,
): DurableCreationWizardCheckpoint {
  const normalized = normalizeStartingWeaponEntryRequest(request);
  preflightStartingWeaponEntry(database, normalized, dependencies.catalog, receiptId);
  return commit(database, normalized, receiptId, dependencies.catalog, () => {
    const current = preflightStartingWeaponEntry(
      database,
      normalized,
      dependencies.catalog,
      receiptId,
    );
    const requestId = freshArmorId(
      current.checkpoint,
      normalized.commandId,
      receiptId,
      dependencies.allocateWeaponQualityRollRequestId,
    );
    const receipt = startingWeaponEntryReceipt(
      facts(current.checkpoint, receiptId),
      normalized,
      requestId,
    );
    const stage: StartingWeaponStage = {
      ...initialStartingWeaponStage(current.armor, requestId),
      entryRequest: normalized,
      entryReceipt: receipt,
    };
    return {
      checkpoint: current.checkpoint,
      stage,
      receipt,
      nextStageEnvelope: nextSymbiontEnvelope('CHR-022', normalized.payload.characterDraftId),
      random: false,
    };
  });
}
function activeStage(checkpoint: DurableCreationWizardCheckpoint): StartingWeaponStage {
  armorCheckpoint(checkpoint);
  const stage = checkpoint.startingWeaponStage;
  if (
    stage === null ||
    stage === undefined ||
    stage.checkpointRecordOrNull !== null ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-022' ||
    (checkpoint.symbiontPresentationStage != null &&
      checkpoint.symbiontPresentationStage.formId !== 'CHR-022')
  )
    return guardSymbiontRejected();
  return stage;
}
function selection(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: StartingWeaponCatalog,
  weaponTypeId: string,
  weaponVariant: StartingWeaponQualityRollRequest['payload']['weaponVariant'],
) {
  const race = checkpoint.raceAndMethodStage?.race?.value;
  if (race === undefined) return guardSymbiontRejected();
  try {
    const weapon = validateStartingWeapon(catalog, { weaponTypeId, weaponVariant });
    validateStartingWeaponRace(weapon, race);
    return weapon;
  } catch {
    return guardSymbiontRejected();
  }
}
export function preflightStartingWeaponQualityRoll(
  database: Database.Database,
  request: DecodedRequest,
  dependencies: StartingWeaponQualityRollDependencies,
  receiptId?: string,
) {
  const normalized = normalizeStartingWeaponQualityRollRequest(request);
  const checkpoint = checkedCommon(database, normalized, dependencies.catalog, receiptId);
  const stage = activeStage(checkpoint);
  if (
    stage.qualityRollRecordOrNull !== null ||
    stage.weaponQualityRollRequestId !== normalized.payload.weaponQualityRollRequestId ||
    (stage.diceInputModeSnapshot === 'AUTO') !== (normalized.payload.manualFaceOrNull === null)
  )
    return guardSymbiontRejected();
  const weapon = selection(
    checkpoint,
    dependencies.weaponCatalog,
    normalized.payload.weaponTypeId,
    normalized.payload.weaponVariant,
  );
  return { request: normalized, checkpoint, stage, weapon };
}
export function commitStartingWeaponQualityRoll(
  database: Database.Database,
  request: DecodedRequest,
  receiptId: string,
  dependencies: StartingWeaponQualityRollDependencies,
): DurableCreationWizardCheckpoint {
  const normalized = normalizeStartingWeaponQualityRollRequest(request);
  preflightStartingWeaponQualityRoll(database, normalized, dependencies, receiptId);
  return commit(database, normalized, receiptId, dependencies.catalog, () => {
    const current = preflightStartingWeaponQualityRoll(
      database,
      normalized,
      dependencies,
      receiptId,
    );
    const rawFace =
      normalized.payload.manualFaceOrNull ?? sampledSymbiontFace(dependencies.sampleD20);
    const physicalRoll = {
      kind: 'STARTING_WEAPON_QUALITY' as const,
      rollRequestId: current.stage.weaponQualityRollRequestId,
      rollReceiptId: receiptId,
      mechanical: { dieSides: 20 as const, rawFace },
    };
    const receipt = startingWeaponQualityRollReceipt(
      facts(current.checkpoint, receiptId),
      normalized,
      physicalRoll,
      current.stage.diceInputModeSnapshot,
    );
    const nextStageEnvelope = nextSymbiontEnvelope('CHR-022', normalized.payload.characterDraftId);
    const record: StartingWeaponQualityRollRecord = {
      weaponTypeId: current.weapon.weaponTypeId,
      weaponVariant: current.weapon.weaponVariant,
      name: current.weapon.name,
      physicalRoll,
      qualityRecommendation: receipt.result.qualityRecommendation,
      request: normalized,
      receipt,
      nextStageEnvelope,
    };
    return {
      checkpoint: current.checkpoint,
      stage: { ...current.stage, qualityRollRecordOrNull: record },
      receipt,
      nextStageEnvelope,
      random: current.stage.diceInputModeSnapshot === 'AUTO',
    };
  });
}
export function preflightStartingWeaponCheckpoint(
  database: Database.Database,
  request: DecodedRequest,
  dependencies: StartingWeaponCheckpointDependencies,
  receiptId?: string,
) {
  const normalized = normalizeStartingWeaponCheckpointRequest(request);
  const checkpoint = checkedCommon(database, normalized, dependencies.catalog, receiptId);
  const stage = activeStage(checkpoint);
  const roll = stage.qualityRollRecordOrNull;
  if (
    roll === null ||
    normalized.payload.weaponQualityRollRequestId !== stage.weaponQualityRollRequestId ||
    normalized.payload.weaponQualityRollReceiptId !== roll.receipt.receiptId
  )
    return guardSymbiontRejected();
  selection(checkpoint, dependencies.weaponCatalog, roll.weaponTypeId, roll.weaponVariant);
  return { request: normalized, checkpoint, stage, roll };
}
export function commitStartingWeaponCheckpoint(
  database: Database.Database,
  request: DecodedRequest,
  receiptId: string,
  dependencies: StartingWeaponCheckpointDependencies,
): DurableCreationWizardCheckpoint {
  const normalized = normalizeStartingWeaponCheckpointRequest(request);
  preflightStartingWeaponCheckpoint(database, normalized, dependencies, receiptId);
  return commit(database, normalized, receiptId, dependencies.catalog, () => {
    const current = preflightStartingWeaponCheckpoint(
      database,
      normalized,
      dependencies,
      receiptId,
    );
    const nextFormId =
      current.checkpoint.raceAndMethodStage!.race!.value === 'PURE' ? 'CHR-024' : 'CHR-023';
    const receipt = startingWeaponCheckpointReceipt(
      facts(current.checkpoint, receiptId),
      normalized,
      current.roll.receipt,
      nextFormId,
    );
    const nextStageEnvelope = nextSymbiontEnvelope(nextFormId, normalized.payload.characterDraftId);
    return {
      checkpoint: current.checkpoint,
      stage: {
        ...current.stage,
        checkpointRecordOrNull: { request: normalized, receipt, nextStageEnvelope },
      },
      receipt,
      nextStageEnvelope,
      random: false,
    };
  });
}
export function validateStartingWeaponStageHistory(
  stage: StartingWeaponStage,
  context: ArmorBundleValidationContext,
): { readonly cursor: RollValidationCursor } {
  const armor = (context.checkpointView.durablePayload as CreationWizardSymbiontPayload)
    .armorBundleStage;
  if (
    armor === undefined ||
    armor.checkpointRecordOrNull === null ||
    context.cursor.latestEnvelope.formId !== 'CHR-022' ||
    stage.armorBundleCheckpointReceiptId !== armor.checkpointRecordOrNull.receipt.receiptId ||
    stage.diceInputModeSnapshot !== armor.diceInputModeSnapshot
  )
    return guardSymbiontRejected();
  for (const id of startingWeaponStageIds(stage)) {
    if (context.occupiedIds.has(id)) return guardSymbiontRejected();
    context.occupiedIds.add(id);
  }
  let cursor = context.cursor;
  function advance(
    request: StartingWeaponRequest,
    receipt: StartingWeaponReceipt,
    nextStageEnvelope: RollValidationCursor['latestEnvelope'],
  ) {
    if (
      request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
      request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      request.payload.draftRevision !== cursor.draftRevision ||
      !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions) ||
      context.commandIds.has(request.commandId) ||
      context.receiptIds.has(receipt.receiptId)
    )
      return guardSymbiontRejected();
    context.commandIds.add(request.commandId);
    context.receiptIds.add(receipt.receiptId);
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestRequest: request,
      latestReceipt: receipt,
      revisions: receipt.revisions,
    };
  }
  function recordFacts(
    receiptId: string,
    request: StartingWeaponRequest,
  ): StartingWeaponReceiptFacts {
    return {
      checkpoint: context.checkpointView,
      receiptId,
      revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
    };
  }
  if (stage.entryRequest.payload.variant === 'STARTING_WEAPON_ENTRY') {
    const request = stage.entryRequest as StartingWeaponEntryRequest;
    if (
      request.payload.armorBundleId !== armor.armorBundleId ||
      request.payload.armorBundleCheckpointReceiptId !==
        armor.checkpointRecordOrNull.receipt.receiptId
    )
      return guardSymbiontRejected();
    const expected = startingWeaponEntryReceipt(
      recordFacts(stage.entryReceipt.receiptId, request),
      request,
      stage.weaponQualityRollRequestId,
    );
    if (!isDeepStrictEqual(expected, stage.entryReceipt)) return guardSymbiontRejected();
    advance(request, expected, nextSymbiontEnvelope('CHR-022', request.payload.characterDraftId));
  } else if (
    !isDeepStrictEqual(stage.entryRequest, armor.checkpointRecordOrNull.request) ||
    !isDeepStrictEqual(stage.entryReceipt, armor.checkpointRecordOrNull.receipt)
  )
    return guardSymbiontRejected();
  const roll = stage.qualityRollRecordOrNull;
  if (roll !== null) {
    const race = context.checkpointView.raceAndMethodStage?.race?.value;
    if (race === undefined) return guardSymbiontRejected();
    try {
      const canonical = canonicalStartingWeaponSelection(
        roll.weaponTypeId,
        roll.weaponVariant,
        race,
      );
      if (canonical.name !== roll.name) return guardSymbiontRejected();
    } catch {
      return guardSymbiontRejected();
    }
    if (roll.request.payload.weaponQualityRollRequestId !== stage.weaponQualityRollRequestId)
      return guardSymbiontRejected();
    const expected = startingWeaponQualityRollReceipt(
      recordFacts(roll.receipt.receiptId, roll.request),
      roll.request,
      roll.physicalRoll,
      stage.diceInputModeSnapshot,
    );
    const envelope = nextSymbiontEnvelope('CHR-022', roll.request.payload.characterDraftId);
    if (
      !isDeepStrictEqual(expected, roll.receipt) ||
      !isDeepStrictEqual(envelope, roll.nextStageEnvelope)
    )
      return guardSymbiontRejected();
    advance(roll.request, expected, envelope);
  }
  const record = stage.checkpointRecordOrNull;
  if (record !== null) {
    if (
      roll === null ||
      record.request.payload.weaponQualityRollRequestId !== stage.weaponQualityRollRequestId ||
      record.request.payload.weaponQualityRollReceiptId !== roll.receipt.receiptId
    )
      return guardSymbiontRejected();
    const nextFormId =
      context.checkpointView.raceAndMethodStage!.race!.value === 'PURE' ? 'CHR-024' : 'CHR-023';
    const expected = startingWeaponCheckpointReceipt(
      recordFacts(record.receipt.receiptId, record.request),
      record.request,
      roll.receipt,
      nextFormId,
    );
    const envelope = nextSymbiontEnvelope(nextFormId, record.request.payload.characterDraftId);
    if (
      !isDeepStrictEqual(expected, record.receipt) ||
      !isDeepStrictEqual(envelope, record.nextStageEnvelope)
    )
      return guardSymbiontRejected();
    advance(record.request, expected, envelope);
  }
  return { cursor };
}
