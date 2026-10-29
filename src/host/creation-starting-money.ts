import { initialFiveStartingPositionsStage } from './creation-five-starting-positions-contract.js';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { SymbiontCatalog } from '../domain/index.js';
import {
  recommendStartingWealth,
  type StartingMoneyCatalog,
} from '../domain/rules/item-stage/starting-money.js';
import {
  commitLocalCharacterCheckpoint,
  writeLocalCharacterSymbiontPresentation,
} from '../persistence/index.js';
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
  d20SymbiontFaceAt,
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
} from './creation-symbiont-contract.js';
import { manualNavigationRevisionsMatch } from './creation-manual-composition-contract.js';
import type { ArmorBundleValidationContext } from './creation-armor-bundle.js';
import { weaponProfileForm } from './creation-weapon-profile.js';
import { canonicalStartingMoneyCatalog } from './starting-money-catalog.js';
import {
  initialStartingMoneyStage,
  normalizeStartingMoneyRequest,
  startingMoneyCommonResult,
  startingMoneyStageForCheckpoint,
  startingMoneyPresentationForm,
  startingMoneyStageIds,
  type StartingMoneyStage,
  type StartingMoneyRollRequest,
  type StartingMoneyCheckpointRequest,
  type StartingMoneyReceiptFacts,
  type StartingMoneyReceipt,
  type StartingMoneyRollReceipt,
  type StartingMoneyPhysicalRoll,
  type StartingMoneyCheckpointReceipt,
} from './creation-starting-money-contract.js';
export { startingMoneyStageForCheckpoint } from './creation-starting-money-contract.js';

type DecodedRequest = Parameters<typeof normalizeStartingMoneyRequest>[0];
export interface StartingMoneyDependencies {
  readonly catalog: SymbiontCatalog;
  readonly moneyCatalog: StartingMoneyCatalog;
  readonly sampleD20: () => number;
}
export function latestStartingMoneyRecord(stage: StartingMoneyStage) {
  return (
    stage.checkpointRecordOrNull ??
    stage.rollRecordOrNull ?? {
      request: stage.entryRequest,
      receipt: stage.entryReceipt,
      nextStageEnvelope: nextSymbiontEnvelope(
        'CHR-038',
        stage.entryRequest.payload.characterDraftId,
      ),
    }
  );
}
export function startingMoneyRecords(stage: StartingMoneyStage) {
  return [
    ...(stage.rollRecordOrNull === null ? [] : [stage.rollRecordOrNull]),
    ...(stage.checkpointRecordOrNull === null ? [] : [stage.checkpointRecordOrNull]),
  ];
}
function facts(
  checkpoint: DurableCreationWizardCheckpoint,
  receiptId: string,
): StartingMoneyReceiptFacts {
  return {
    checkpoint,
    receiptId,
    revisions: incrementedSymbiontRevisions(currentCreationWizardRevisions(checkpoint)),
    checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
    draftRevision: checkpoint.receipt.result.draftRevision + 1,
  };
}
function rollReceipt(
  f: StartingMoneyReceiptFacts,
  stage: StartingMoneyStage,
  request: StartingMoneyRollRequest,
  physicalRoll: StartingMoneyPhysicalRoll,
  catalog: StartingMoneyCatalog,
): StartingMoneyRollReceipt {
  return {
    commandId: request.commandId,
    receiptId: f.receiptId,
    revisions: f.revisions,
    result: {
      ...startingMoneyCommonResult(f, stage),
      variant: 'STARTING_MONEY_ROLL',
      physicalRoll,
      wealthRecommendation: {
        ...recommendStartingWealth(physicalRoll.mechanical.rawFace, catalog),
      },
      nextFormId: 'CHR-038',
    },
  };
}
function checkpointReceipt(
  f: StartingMoneyReceiptFacts,
  stage: StartingMoneyStage,
  request: StartingMoneyCheckpointRequest,
): StartingMoneyCheckpointReceipt {
  if (stage.rollRecordOrNull === null) return guardSymbiontRejected();
  return {
    commandId: request.commandId,
    receiptId: f.receiptId,
    revisions: f.revisions,
    result: {
      ...startingMoneyCommonResult(f, stage),
      variant: 'STARTING_MONEY_CHECKPOINT',
      moneyRollReceiptId: stage.rollRecordOrNull.receipt.receiptId,
      wealthRecommendation: stage.rollRecordOrNull.wealthRecommendation,
      nextFormId: 'CHR-037',
    },
  };
}
export function preflightStartingMoney(
  database: Database.Database,
  incoming: DecodedRequest,
  dependencies: StartingMoneyDependencies,
  receiptId?: string,
) {
  const request = normalizeStartingMoneyRequest(incoming);
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
    },
  );
  const stage = startingMoneyStageForCheckpoint(checkpoint);
  const atMoney = startingMoneyPresentationForm(checkpoint) === 'CHR-038';
  if (
    stage === null ||
    stage.checkpointRecordOrNull !== null ||
    stage.moneyRollRequestId !== request.payload.moneyRollRequestId ||
    !atMoney
  )
    return guardSymbiontRejected();
  // A derived address occupies the same namespace even before its first durable money record.
  if (
    checkpoint.startingMoneyStage == null &&
    (creationWizardDurableIds(checkpoint).has(stage.moneyRollRequestId) ||
      request.commandId === stage.moneyRollRequestId ||
      receiptId === stage.moneyRollRequestId)
  )
    return guardSymbiontRejected();
  if (request.payload.variant === 'STARTING_MONEY_ROLL') {
    if (
      stage.rollRecordOrNull !== null ||
      (stage.diceInputModeSnapshot === 'AUTO') !== (request.payload.manualFaceOrNull === null)
    )
      return guardSymbiontRejected();
  } else if (
    stage.rollRecordOrNull === null ||
    request.payload.moneyRollReceiptId !== stage.rollRecordOrNull.receipt.receiptId
  )
    return guardSymbiontRejected();
  return { request, checkpoint, stage };
}
export function rewriteStartingMoneyPresentation(
  database: Database.Database,
  checkpoint: DurableCreationWizardCheckpoint,
  formId: 'CHR-022' | 'CHR-023' | 'CHR-024' | 'CHR-037' | 'CHR-038',
  projectionRevision: number,
  draftRevision = checkpoint.receipt.result.draftRevision,
): void {
  writeLocalCharacterSymbiontPresentation(database, {
    formId,
    compositionDraftRevision:
      checkpoint.manualCompositionStage?.compositionDraftRevision ?? draftRevision,
    projectionRevision,
    routeBindings: [
      { parameterIndex: 0, source: 'inherited', value: checkpoint.localCharacter.localCharacterId },
    ],
    routeTemplate: `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
  });
}
export function commitStartingMoney(
  database: Database.Database,
  incoming: DecodedRequest,
  receiptId: string,
  dependencies: StartingMoneyDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0)
    throw new TypeError('starting money receiptId must be non-empty');
  const normalized = normalizeStartingMoneyRequest(incoming);
  preflightStartingMoney(database, normalized, dependencies, receiptId);
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightStartingMoney(database, incoming, dependencies, receiptId);
      const { request } = current;
      let stage = current.stage;
      let receipt: StartingMoneyReceipt;
      if (request.payload.variant === 'STARTING_MONEY_ROLL') {
        const typed = request as StartingMoneyRollRequest;
        const rawFace =
          typed.payload.manualFaceOrNull ?? sampledSymbiontFace(dependencies.sampleD20);
        const physicalRoll: StartingMoneyPhysicalRoll = {
          kind: 'STARTING_MONEY',
          rollRequestId: stage.moneyRollRequestId,
          rollReceiptId: receiptId,
          mechanical: { dieSides: 20, rawFace },
        };
        const rolled = rollReceipt(
          facts(current.checkpoint, receiptId),
          stage,
          typed,
          physicalRoll,
          dependencies.moneyCatalog,
        );
        receipt = rolled;
        stage = {
          ...stage,
          rollRecordOrNull: {
            request: typed,
            receipt: rolled,
            physicalRoll,
            wealthRecommendation: rolled.result.wealthRecommendation,
            nextStageEnvelope: nextSymbiontEnvelope('CHR-038', typed.payload.characterDraftId),
          },
        };
      } else {
        const typed = request as StartingMoneyCheckpointRequest;
        const confirmed = checkpointReceipt(facts(current.checkpoint, receiptId), stage, typed);
        receipt = confirmed;
        stage = {
          ...stage,
          checkpointRecordOrNull: {
            request: typed,
            receipt: confirmed,
            nextStageEnvelope: nextSymbiontEnvelope('CHR-037', typed.payload.characterDraftId),
          },
        };
      }
      startingMoneyStageIds(stage);
      const payload = current.checkpoint.durablePayload as CreationWizardSymbiontPayload;
      const saved = update(
        {
          payloadJson: JSON.stringify({
            ...payload,
            startingMoneyStage: stage,
            ...(stage.checkpointRecordOrNull === null
              ? {}
              : { fiveStartingPositionsStage: initialFiveStartingPositionsStage(stage) }),
            receipt,
            nextStageEnvelope: nextSymbiontEnvelope(
              receipt.result.nextFormId,
              request.payload.characterDraftId,
            ),
            randomReceiptIds:
              request.payload.variant === 'STARTING_MONEY_ROLL' &&
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
        stage.checkpointRecordOrNull === null ? 'CHR-038' : 'CHR-037',
        receipt.revisions.projectionRevision,
        receipt.result.draftRevision,
      );
      return saved;
    },
    () => {
      const request = normalizeStartingMoneyRequest(incoming);
      validated = loadCreationWizardCheckpoint(
        database,
        request.payload.characterDraftId,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validated === undefined) throw new Error('money post-write validation was not executed');
  return validated;
}
export function advanceStartingMoneyPresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: 'CHR-022' | 'CHR-023' | 'CHR-024' | 'CHR-038';
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
    const stage = startingMoneyStageForCheckpoint(current);
    if (
      stage === null ||
      stage.checkpointRecordOrNull !== null ||
      current.weaponProfileStage == null ||
      current.checkpoint.checkpointId !== input.wizardCheckpointId ||
      current.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER
    )
      return guardSymbiontRejected();
    const profile = weaponProfileForm(current.weaponProfileStage);
    const source = startingMoneyPresentationForm(current);
    if (!(
      (source === 'CHR-038' && input.formId === 'CHR-022') ||
      (source === 'CHR-022' && input.formId === profile) ||
      (source === profile && input.formId === 'CHR-038')
    ))
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
  if (validated === undefined) throw new Error('money presentation validation was not executed');
  return validated;
}
export function validateStartingMoneyStageHistory(
  stage: StartingMoneyStage,
  context: ArmorBundleValidationContext,
) {
  const view = context.checkpointView;
  const profile =
    view.weaponProfileStage ??
    ('weaponProfileStage' in view.durablePayload
      ? view.durablePayload.weaponProfileStage
      : undefined);
  const weapon =
    view.startingWeaponStage ??
    ('startingWeaponStage' in view.durablePayload
      ? view.durablePayload.startingWeaponStage
      : undefined);
  if (profile == null || weapon == null || context.cursor.latestEnvelope.formId !== 'CHR-038')
    return guardSymbiontRejected();
  const expectedStage = initialStartingMoneyStage(profile, weapon);
  for (const key of [
    'entryMode',
    'profileReceiptId',
    'weaponCheckpointReceiptId',
    'moneyRollRequestId',
    'diceInputModeSnapshot',
    'entryRequest',
    'entryReceipt',
  ] as const)
    if (!isDeepStrictEqual(expectedStage[key], stage[key])) return guardSymbiontRejected();
  for (const id of startingMoneyStageIds(stage)) {
    if (context.occupiedIds.has(id)) return guardSymbiontRejected();
    context.occupiedIds.add(id);
  }
  let cursor = context.cursor;
  const catalog = canonicalStartingMoneyCatalog();
  for (const record of startingMoneyRecords(stage)) {
    const request = record.request;
    if (
      request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
      request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
      request.payload.draftRevision !== cursor.draftRevision ||
      request.payload.moneyRollRequestId !== stage.moneyRollRequestId ||
      !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions) ||
      context.commandIds.has(request.commandId) ||
      context.receiptIds.has(record.receipt.receiptId)
    )
      return guardSymbiontRejected();
    const f: StartingMoneyReceiptFacts = {
      checkpoint: view,
      receiptId: record.receipt.receiptId,
      revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
    };
    let expected: StartingMoneyReceipt;
    if (request.payload.variant === 'STARTING_MONEY_ROLL') {
      const roll = stage.rollRecordOrNull!;
      const face = d20SymbiontFaceAt(
        roll.physicalRoll.mechanical.rawFace,
        '$.money.physicalRoll.mechanical.rawFace',
      );
      const physical: StartingMoneyPhysicalRoll = {
        kind: 'STARTING_MONEY',
        rollRequestId: stage.moneyRollRequestId,
        rollReceiptId: roll.receipt.receiptId,
        mechanical: { dieSides: 20, rawFace: face },
      };
      if (
        !isDeepStrictEqual(physical, roll.physicalRoll) ||
        (stage.diceInputModeSnapshot === 'AUTO'
          ? request.payload.manualFaceOrNull !== null
          : request.payload.manualFaceOrNull !== face)
      )
        return guardSymbiontRejected();
      expected = rollReceipt(f, stage, request as StartingMoneyRollRequest, physical, catalog);
      if (!isDeepStrictEqual(expected.result.wealthRecommendation, roll.wealthRecommendation))
        return guardSymbiontRejected();
    } else {
      if (
        stage.rollRecordOrNull === null ||
        request.payload.moneyRollReceiptId !== stage.rollRecordOrNull.receipt.receiptId
      )
        return guardSymbiontRejected();
      expected = checkpointReceipt(f, stage, request as StartingMoneyCheckpointRequest);
    }
    const envelope = nextSymbiontEnvelope(
      expected.result.nextFormId,
      request.payload.characterDraftId,
    );
    if (
      !isDeepStrictEqual(expected, record.receipt) ||
      !isDeepStrictEqual(envelope, record.nextStageEnvelope)
    )
      return guardSymbiontRejected();
    context.commandIds.add(request.commandId);
    context.receiptIds.add(expected.receiptId);
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: envelope,
      latestRequest: request,
      latestReceipt: expected,
      revisions: expected.revisions,
    };
  }
  return { cursor };
}
