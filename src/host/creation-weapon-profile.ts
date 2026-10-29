import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { SymbiontCatalog } from '../domain/index.js';
import {
  validateWeaponProfile,
  canonicalFixedWeaponProfile,
  findWeaponProfile,
  weaponProfilePlayerFacts,
  type WeaponProfileCatalog,
  type WeaponProfileInputs,
  type WeaponEffectiveProfile,
} from '../domain/rules/item-stage/weapon-profile.js';
import { canonicalWeaponProfileCatalog } from './weapon-profile-catalog.js';
import {
  commitLocalCharacterCheckpoint,
  writeLocalCharacterSymbiontPresentation,
} from '../persistence/index.js';
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
} from './creation-symbiont-commands.js';
import {
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
} from './creation-symbiont-contract.js';
import { freshArmorId, type ArmorBundleValidationContext } from './creation-armor-bundle.js';
import { manualNavigationRevisionsMatch } from './creation-manual-composition-contract.js';
import {
  initialWeaponProfileStage,
  normalizeWeaponProfileRequest,
  weaponProfileCommonResult,
  weaponProfileStageIds,
  type WeaponProfileStage,
  type WeaponProfileRequest,
  type WeaponProfileEntryRequest,
  type WeaponProfileEntryReceipt,
  type WeaponProfileResult,
  type AnyWeaponProfileReceipt,
  type WeaponProfileReceiptFacts,
  type WeaponProfileRecord,
} from './creation-weapon-profile-contract.js';

type DecodedRequest = Parameters<typeof normalizeWeaponProfileRequest>[0];
export interface WeaponProfileDependencies {
  readonly catalog: SymbiontCatalog;
  readonly profileCatalog: WeaponProfileCatalog;
  readonly allocateRequestId: () => string;
  readonly allocateWitnessReceiptId: () => string;
}
export function weaponProfileForm(stage: WeaponProfileStage): 'CHR-023' | 'CHR-024' {
  return stage.kind === 'FORMULA' ? 'CHR-023' : 'CHR-024';
}
export function latestWeaponProfileRecord(stage: WeaponProfileStage) {
  return (
    stage.records.at(-1) ?? {
      request: stage.entryRequest,
      receipt: stage.entryReceipt,
      nextStageEnvelope: nextSymbiontEnvelope(
        weaponProfileForm(stage),
        stage.entryRequest.payload.characterDraftId,
      ),
    }
  );
}
export function weaponProfileRecords(stage: WeaponProfileStage) {
  return [
    ...(stage.entryRequest.payload.variant === 'WEAPON_PROFILE_ENTRY'
      ? [
          {
            request: stage.entryRequest as WeaponProfileEntryRequest,
            receipt: stage.entryReceipt as WeaponProfileEntryReceipt,
            nextStageEnvelope: nextSymbiontEnvelope(
              weaponProfileForm(stage),
              stage.entryRequest.payload.characterDraftId,
            ),
          },
        ]
      : []),
    ...stage.records,
  ];
}
function facts(
  checkpoint: DurableCreationWizardCheckpoint,
  receiptId: string,
): WeaponProfileReceiptFacts {
  return {
    checkpoint,
    receiptId,
    revisions: incrementedSymbiontRevisions(currentCreationWizardRevisions(checkpoint)),
    checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
    draftRevision: checkpoint.receipt.result.draftRevision + 1,
  };
}
function selection(checkpoint: DurableCreationWizardCheckpoint) {
  const weapon =
    checkpoint.startingWeaponStage ??
    ('startingWeaponStage' in checkpoint.durablePayload
      ? checkpoint.durablePayload.startingWeaponStage
      : undefined);
  if (weapon?.checkpointRecordOrNull == null || weapon.qualityRollRecordOrNull === null)
    return guardSymbiontRejected();
  return {
    weaponTypeId: weapon.qualityRollRecordOrNull.weaponTypeId,
    weaponVariant: weapon.qualityRollRecordOrNull.weaponVariant,
  };
}
function entryReceipt(
  f: WeaponProfileReceiptFacts,
  request: WeaponProfileEntryRequest,
  requestId: string,
  formId: 'CHR-023' | 'CHR-024',
): WeaponProfileEntryReceipt {
  return {
    commandId: request.commandId,
    receiptId: f.receiptId,
    revisions: f.revisions,
    result: {
      ...weaponProfileCommonResult(f, requestId),
      sourceFormId: 'CHR-022',
      variant: 'WEAPON_PROFILE_ENTRY',
      weaponCheckpointReceiptId: request.payload.weaponCheckpointReceiptId,
      nextFormId: formId,
    },
  };
}
const jsonObject = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;
function profileResult(
  f: WeaponProfileReceiptFacts,
  stage: WeaponProfileStage,
  request: Exclude<WeaponProfileRequest, WeaponProfileEntryRequest>,
  catalog: WeaponProfileCatalog,
  witnessReceiptIds: readonly string[],
): WeaponProfileResult {
  const selected = selection(f.checkpoint);
  const entry = findWeaponProfile(catalog, selected);
  const common = {
    ...weaponProfileCommonResult(f, stage.requestId),
    sourceFormId: request.payload.sourceFormId,
    variant: request.payload.variant,
    weaponTypeId: selected.weaponTypeId,
    weaponVariant: selected.weaponVariant,
    ownershipState: 'OWNED_NOT_EQUIPPED' as const,
  };
  if (request.payload.variant === 'WEAPON_PROFILE_ACKNOWLEDGE') {
    if (
      stage.kind !== 'FIXED' ||
      request.payload.canonicalProfileVersion !== entry.canonicalProfileVersion ||
      witnessReceiptIds.length !== 0
    )
      return guardSymbiontRejected();
    return {
      ...common,
      outcome: 'ACKNOWLEDGED',
      canonicalProfileVersion: entry.canonicalProfileVersion,
      profileOrNull: jsonObject(canonicalFixedWeaponProfile(catalog, selected)),
      proofOrNull: null,
      independentManufacturingDiceReceipts: [],
      invalidFieldSet: [],
      humanExplanations: [],
      requestStatus: 'SUBMITTED',
      requestStatusTransitions: ['DRAFT', 'VALIDATED', 'SUBMITTED'],
      approvalStatus: 'NOT_APPLICABLE',
      nextFormId: 'CHR-038',
    };
  }
  if (
    stage.kind !== 'FORMULA' ||
    request.payload.weaponTypeId !== selected.weaponTypeId ||
    request.payload.weaponVariant !== selected.weaponVariant
  )
    return guardSymbiontRejected();
  const result = validateWeaponProfile(
    catalog,
    selected,
    request.payload.inputs as unknown as WeaponProfileInputs,
  );
  if (result.status === 'INVALID') {
    if (witnessReceiptIds.length !== 0) return guardSymbiontRejected();
    return {
      ...common,
      outcome: 'INVALID',
      canonicalProfileVersion: null,
      profileOrNull: null,
      proofOrNull: null,
      independentManufacturingDiceReceipts: [],
      invalidFieldSet: result.invalidFieldSet,
      humanExplanations: result.humanExplanations,
      requestStatus: 'DRAFT',
      requestStatusTransitions: ['DRAFT'],
      approvalStatus: null,
      nextFormId: 'CHR-023',
    };
  }
  const dice = entry.formula?.independentDice;
  if (dice === undefined || dice.length !== witnessReceiptIds.length)
    return guardSymbiontRejected();
  return {
    ...common,
    outcome: 'SUBMITTED',
    canonicalProfileVersion: null,
    profileOrNull: jsonObject(result.profile),
    proofOrNull: jsonObject(result.proof),
    independentManufacturingDiceReceipts: dice.map((die, index) => ({
      receiptId: witnessReceiptIds[index]!,
      requestId: stage.requestId,
      submitCommandId: request.commandId,
      variable: die.key,
      dieSides: die.dieSides,
      value: result.proof.independentDice[die.key]!,
      provenance: 'PLAYER_WITNESS',
    })),
    invalidFieldSet: [],
    humanExplanations: [],
    requestStatus: 'SUBMITTED',
    requestStatusTransitions: ['DRAFT', 'VALIDATED', 'SUBMITTED'],
    approvalStatus: 'PENDING_GM',
    nextFormId: 'CHR-038',
  };
}
function publicResult(result: WeaponProfileResult): WeaponProfileResult {
  return {
    ...result,
    profileOrNull:
      result.profileOrNull === null
        ? null
        : jsonObject({
            facts: weaponProfilePlayerFacts(
              result.profileOrNull as unknown as WeaponEffectiveProfile,
            ),
          }),
    proofOrNull: result.proofOrNull === null ? null : { validated: true },
  };
}
export function rewriteWeaponProfilePresentation(
  database: Database.Database,
  checkpoint: DurableCreationWizardCheckpoint,
  formId: 'CHR-022' | 'CHR-023' | 'CHR-024' | 'CHR-031',
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
    routeTemplate:
      formId === 'CHR-031'
        ? '@dialog/chr-031'
        : `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
  });
}
export function preflightWeaponProfile(
  database: Database.Database,
  incoming: DecodedRequest,
  dependencies: Pick<WeaponProfileDependencies, 'catalog' | 'profileCatalog'>,
  receiptId?: string,
) {
  const request = normalizeWeaponProfileRequest(incoming);
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
    { allowArmorBundleStage: true, allowStartingWeaponStage: true, allowWeaponProfileStage: true },
  );
  const selected = selection(checkpoint);
  findWeaponProfile(dependencies.profileCatalog, selected);
  const currentForm =
    checkpoint.symbiontPresentationStage?.formId ?? checkpoint.nextStageEnvelope.formId;
  if (request.payload.variant === 'WEAPON_PROFILE_ENTRY') {
    const weapon = checkpoint.startingWeaponStage!;
    if (
      checkpoint.weaponProfileStage != null ||
      weapon.checkpointRecordOrNull!.receipt.result.weaponProfileRequestId !== undefined ||
      request.payload.weaponQualityRollRequestId !== weapon.weaponQualityRollRequestId ||
      request.payload.weaponCheckpointReceiptId !==
        weapon.checkpointRecordOrNull!.receipt.receiptId ||
      (currentForm !== 'CHR-022' &&
        currentForm !== weapon.checkpointRecordOrNull!.nextStageEnvelope.formId)
    )
      return guardSymbiontRejected();
    return { request, checkpoint, stage: null };
  }
  const stage = checkpoint.weaponProfileStage;
  if (
    stage == null ||
    stage.requestId !== request.payload.requestId ||
    stage.records.some((r) => r.receipt.result.outcome !== 'INVALID') ||
    currentForm !== request.payload.sourceFormId ||
    weaponProfileForm(stage) !== request.payload.sourceFormId
  )
    return guardSymbiontRejected();
  if (request.payload.variant === 'WEAPON_PROFILE_ACKNOWLEDGE') {
    if (
      findWeaponProfile(dependencies.profileCatalog, selected).canonicalProfileVersion !==
      request.payload.canonicalProfileVersion
    )
      return guardSymbiontRejected();
  } else if (
    request.payload.weaponTypeId !== selected.weaponTypeId ||
    request.payload.weaponVariant !== selected.weaponVariant
  )
    return guardSymbiontRejected();
  return { request, checkpoint, stage };
}
export function commitWeaponProfile(
  database: Database.Database,
  incoming: DecodedRequest,
  receiptId: string,
  dependencies: WeaponProfileDependencies,
): DurableCreationWizardCheckpoint {
  const normalized = normalizeWeaponProfileRequest(incoming);
  preflightWeaponProfile(database, normalized, dependencies, receiptId);
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightWeaponProfile(database, normalized, dependencies, receiptId);
      const f = facts(current.checkpoint, receiptId);
      let stage: WeaponProfileStage;
      let receipt: AnyWeaponProfileReceipt;
      let presentation: 'CHR-023' | 'CHR-024' | 'CHR-031';
      if (normalized.payload.variant === 'WEAPON_PROFILE_ENTRY') {
        const requestId = freshArmorId(
          current.checkpoint,
          normalized.commandId,
          receiptId,
          dependencies.allocateRequestId,
        );
        const initial = initialWeaponProfileStage(
          current.checkpoint.startingWeaponStage!,
          requestId,
        );
        const request = normalized as WeaponProfileEntryRequest;
        receipt = entryReceipt(f, request, requestId, weaponProfileForm(initial));
        stage = { ...initial, entryRequest: request, entryReceipt: receipt };
        presentation = weaponProfileForm(stage);
      } else {
        if (current.stage === null) return guardSymbiontRejected();
        stage = current.stage;
        const entry = findWeaponProfile(dependencies.profileCatalog, selection(current.checkpoint));
        const valid =
          normalized.payload.variant === 'WEAPON_PROFILE_SUBMIT' &&
          validateWeaponProfile(
            dependencies.profileCatalog,
            selection(current.checkpoint),
            normalized.payload.inputs as unknown as WeaponProfileInputs,
          ).status === 'VALID';
        const ids = valid
          ? entry.formula!.independentDice.map(() =>
              freshArmorId(
                current.checkpoint,
                normalized.commandId,
                receiptId,
                dependencies.allocateWitnessReceiptId,
              ),
            )
          : [];
        if (new Set(ids).size !== ids.length) return guardSymbiontRejected();
        const request = normalized as Exclude<WeaponProfileRequest, WeaponProfileEntryRequest>;
        const result = profileResult(f, stage, request, dependencies.profileCatalog, ids);
        receipt = {
          commandId: normalized.commandId,
          receiptId,
          revisions: f.revisions,
          result: publicResult(result),
        };
        const record: WeaponProfileRecord = {
          request,
          receipt,
          profileOrNull: result.profileOrNull,
          proofOrNull: result.proofOrNull,
          nextStageEnvelope: nextSymbiontEnvelope(
            result.nextFormId,
            normalized.payload.characterDraftId,
          ),
        };
        stage = { ...stage, records: [...stage.records, record] };
        presentation = result.outcome === 'INVALID' ? 'CHR-031' : weaponProfileForm(stage);
      }
      weaponProfileStageIds(stage);
      const nextStageEnvelope = nextSymbiontEnvelope(
        receipt.result.nextFormId,
        normalized.payload.characterDraftId,
      );
      const payload = current.checkpoint.durablePayload as CreationWizardSymbiontPayload;
      const saved = update(
        {
          payloadJson: JSON.stringify({
            ...payload,
            weaponProfileStage: stage,
            receipt,
            nextStageEnvelope,
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      rewriteWeaponProfilePresentation(
        database,
        current.checkpoint,
        presentation,
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
    throw new Error('weapon profile post-write validation was not executed');
  return validated;
}
export function advanceWeaponProfilePresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: 'CHR-022' | 'CHR-023' | 'CHR-024';
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
    const stage = current.weaponProfileStage;
    if (
      stage == null ||
      current.checkpoint.checkpointId !== input.wizardCheckpointId ||
      current.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER ||
      stage.records.some((r) => r.receipt.result.outcome !== 'INVALID')
    )
      return guardSymbiontRejected();
    const source = current.symbiontPresentationStage?.formId ?? weaponProfileForm(stage);
    const allowed =
      (source === weaponProfileForm(stage) && input.formId === 'CHR-022') ||
      (source === 'CHR-022' && input.formId === weaponProfileForm(stage)) ||
      (source === 'CHR-031' &&
        input.formId === 'CHR-023' &&
        stage.records.at(-1)?.receipt.result.outcome === 'INVALID');
    if (!allowed) return guardSymbiontRejected();
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
      rewriteWeaponProfilePresentation(
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
    throw new Error('weapon profile navigation validation was not executed');
  return validated;
}
export function validateWeaponProfileStageHistory(
  stage: WeaponProfileStage,
  context: ArmorBundleValidationContext,
): { readonly cursor: RollValidationCursor } {
  const weapon = (context.checkpointView.durablePayload as CreationWizardSymbiontPayload)
    .startingWeaponStage;
  if (
    weapon?.checkpointRecordOrNull == null ||
    stage.weaponCheckpointReceiptId !== weapon.checkpointRecordOrNull.receipt.receiptId ||
    context.cursor.latestEnvelope.formId !== weaponProfileForm(stage)
  )
    return guardSymbiontRejected();
  for (const id of weaponProfileStageIds(stage)) {
    if (context.occupiedIds.has(id)) return guardSymbiontRejected();
    context.occupiedIds.add(id);
  }
  let cursor = context.cursor;
  const advance = (
    request: WeaponProfileRequest,
    receipt: AnyWeaponProfileReceipt,
    envelope: RollValidationCursor['latestEnvelope'],
  ) => {
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
      latestEnvelope: envelope,
      latestRequest: request,
      latestReceipt: receipt,
      revisions: receipt.revisions,
    };
  };
  const recordFacts = (
    request: WeaponProfileRequest,
    receiptId: string,
  ): WeaponProfileReceiptFacts => ({
    checkpoint: context.checkpointView,
    receiptId,
    revisions: incrementedSymbiontRevisions(request.expectedRevisions),
    checkpointRevision: cursor.checkpointRevision + 1,
    draftRevision: cursor.draftRevision + 1,
  });
  if (stage.entryRequest.payload.variant === 'WEAPON_PROFILE_ENTRY') {
    const request = stage.entryRequest as WeaponProfileEntryRequest;
    if (
      request.payload.weaponQualityRollRequestId !== weapon.weaponQualityRollRequestId ||
      request.payload.weaponCheckpointReceiptId !== weapon.checkpointRecordOrNull.receipt.receiptId
    )
      return guardSymbiontRejected();
    const expected = entryReceipt(
      recordFacts(request, stage.entryReceipt.receiptId),
      request,
      stage.requestId,
      weaponProfileForm(stage),
    );
    if (!isDeepStrictEqual(expected, stage.entryReceipt)) return guardSymbiontRejected();
    advance(
      request,
      expected,
      nextSymbiontEnvelope(weaponProfileForm(stage), request.payload.characterDraftId),
    );
  }
  const catalog = canonicalWeaponProfileCatalog();
  let completed = false;
  for (const record of stage.records) {
    if (
      completed ||
      record.request.payload.requestId !== stage.requestId ||
      record.request.payload.sourceFormId !== weaponProfileForm(stage)
    )
      return guardSymbiontRejected();
    const result = profileResult(
      recordFacts(record.request, record.receipt.receiptId),
      stage,
      record.request,
      catalog,
      record.receipt.result.independentManufacturingDiceReceipts.map((d) => d.receiptId),
    );
    const expected = {
      commandId: record.request.commandId,
      receiptId: record.receipt.receiptId,
      revisions: incrementedSymbiontRevisions(record.request.expectedRevisions),
      result: publicResult(result),
    };
    const envelope = nextSymbiontEnvelope(
      result.nextFormId,
      record.request.payload.characterDraftId,
    );
    if (
      !isDeepStrictEqual(expected, record.receipt) ||
      !isDeepStrictEqual(result.profileOrNull, record.profileOrNull) ||
      !isDeepStrictEqual(result.proofOrNull, record.proofOrNull) ||
      !isDeepStrictEqual(envelope, record.nextStageEnvelope)
    )
      return guardSymbiontRejected();
    advance(record.request, expected, envelope);
    completed = result.outcome !== 'INVALID';
  }
  return { cursor };
}
