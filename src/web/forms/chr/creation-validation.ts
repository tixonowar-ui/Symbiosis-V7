import type { ActionKey } from '@generated/types/atlas.js';
import type {
  AtlasTransitionReference,
  DecodeResult,
  JsonObject,
  JsonValue,
} from '@shared/index.js';
import { decodeProjection, isJsonObject, isNonEmptyString } from './random-symbionts.js';
import { decodeArray, isFace, sameJson } from './random-symbionts.js';
import { decodeFiveStartingPositionSnapshots } from './five-starting-positions.js';
import type {
  CommandReceipt,
  HostToClientMessage,
  RevisionVector,
  WorkflowCommandRequestMessage,
  OperationCommandRequestMessage,
} from '@shared/index.js';

export const CHR_032_CONFIRM_ACTION_KEY = 'CHR-032::CTA::001' as const satisfies ActionKey;
export const CHR_025_FINAL_SAVE_ACTION_KEY = 'CHR-025::CTA::007' as const satisfies ActionKey;
export const CHR_025_RACE_EDIT_ACTION_KEY = 'CHR-025::CTA::002' as const satisfies ActionKey;
export const CREATION_FINAL_SAVE_TRANSITION = {
  from: 'CHR-025',
  kind: 'operation-command',
  to: 'CHR-040',
  trigger: 'Сохранить финального персонажа',
} as const satisfies AtlasTransitionReference<'operation-command'>;

export const CREATION_BLOCKER_RETURN_FORMS = {
  IDENTITY_OR_MASS: 'CHR-001',
  RACE_OR_RACE_DEPENDENCIES: 'CHR-010',
  STATS: 'CHR-009',
  SKILLS: 'CHR-015',
  SYMBIONT_COMPOSITION: 'CHR-019',
  STARTING_PROPERTY: 'CHR-032',
} as const;
export const CREATION_BLOCKER_ACTION_KEYS = {
  IDENTITY_OR_MASS: 'CHR-025::CTA::001',
  RACE_OR_RACE_DEPENDENCIES: CHR_025_RACE_EDIT_ACTION_KEY,
  STATS: 'CHR-025::CTA::003',
  SKILLS: 'CHR-025::CTA::004',
  SYMBIONT_COMPOSITION: 'CHR-025::CTA::005',
  STARTING_PROPERTY: 'CHR-025::CTA::006',
} as const satisfies Record<keyof typeof CREATION_BLOCKER_RETURN_FORMS, ActionKey>;
export interface CreationValidationBlockerProjection extends JsonObject {
  readonly kind: keyof typeof CREATION_BLOCKER_RETURN_FORMS;
  readonly code: string;
  readonly message: string;
  readonly returnFormId: (typeof CREATION_BLOCKER_RETURN_FORMS)[keyof typeof CREATION_BLOCKER_RETURN_FORMS];
}
export function creationValidationPublicText(value: JsonValue | undefined): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/\b(?:CORE|SYM|MON|AQ\d?|AQA|CQA|Q[A-Z0-9]*|USR|OP|REQ|F-WPN|CVD|RG)-[A-Z0-9-]+\b|Источник|(?:action)?availabilityTrace|masterPredicate|gmFinalization/i.test(
      value,
    )
  );
}
export function decodeCreationValidationBlocker(
  value: unknown,
  path: string,
): DecodeResult<CreationValidationBlockerProjection> {
  const refused = (): DecodeResult<CreationValidationBlockerProjection> => ({
    ok: false,
    refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue },
  });
  if (!isJsonObject(value)) return refused();
  const kind = value['kind'];
  if (typeof kind !== 'string' || !Object.hasOwn(CREATION_BLOCKER_RETURN_FORMS, kind))
    return refused();
  const decoded = decodeProjection(value, path, {
    kind: (field) => field === kind,
    code: (field) => isNonEmptyString(field) && creationValidationPublicText(field),
    message: creationValidationPublicText,
    returnFormId: (field) =>
      field === CREATION_BLOCKER_RETURN_FORMS[kind as keyof typeof CREATION_BLOCKER_RETURN_FORMS],
  });
  return decoded.ok ? { ok: true, value: value as CreationValidationBlockerProjection } : decoded;
}

export interface CreationValidationCommon extends JsonObject {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string;
  readonly summaryReceiptIdOrNull: string | null;
  readonly correctionHeadHash: string;
  readonly branchCacheDigest: string;
  readonly finalSaveStatus: 'NOT_COMMITTED' | 'COMMITTED';
}
export interface PropertyReceiptRef extends JsonObject {
  readonly block: 'ARMOR_BUNDLE' | 'WEAPON' | 'MONEY' | 'POSITION';
  readonly positionIdOrNull: string | null;
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly rawFace: number;
}
export interface Chr032Projection extends CreationValidationCommon {
  readonly propertyCheckpointReceiptId: string;
  readonly armorBundle: JsonObject;
  readonly weapon: JsonObject;
  readonly moneyRecommendation: JsonObject;
  readonly fivePositions: readonly JsonObject[];
  readonly propertyRollReceipts: readonly PropertyReceiptRef[];
  readonly exactOperationCount: 8;
  readonly ownershipStateAll: 'OWNED_NOT_EQUIPPED';
  readonly massAndMandatoryRowsStatus: JsonObject;
  readonly summaryEntryMode: 'INITIAL' | 'RESUME';
  readonly nextFormId: 'CHR-025' | 'CHR-041';
}
export interface Chr025Projection extends CreationValidationCommon {
  readonly identity: JsonObject;
  readonly raceChoice: 'PURE' | 'UNITED' | 'FREE';
  readonly pureClassOrNull: string | null;
  readonly identityAndMassStatus: JsonObject;
  readonly sevenStatsMinOne: boolean;
  readonly skillsAndSlotsStatus: JsonObject;
  readonly symbiontCompositionStatus: JsonObject;
  readonly startingPropertyEightReceiptsStatus: JsonObject;
  readonly cleanRuntimeState: boolean;
  readonly branchCacheIntegrity: boolean;
  readonly validationBlockers: readonly CreationValidationBlockerProjection[];
  readonly skillStageStatsOrNull: JsonObject | null;
  readonly effectiveStatsOrNull: JsonObject | null;
  readonly statProof: readonly JsonObject[];
  readonly mechanicsSnapshotHashOrNull: string | null;
  readonly nextFormId: 'CHR-025' | 'CHR-040';
}
const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const revision = (v: JsonValue | undefined): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: JsonValue | undefined): boolean => typeof v === 'number' && Number.isFinite(v);
const bool = (v: JsonValue | undefined): boolean => typeof v === 'boolean';
const nullableId = (v: JsonValue | undefined): boolean => v === null || isNonEmptyString(v);
const hash = (v: JsonValue | undefined): boolean =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const owned = (v: JsonValue | undefined): boolean => v === 'OWNED_NOT_EQUIPPED';
const commonFields = {
  characterDraftId: isNonEmptyString,
  wizardCheckpointId: isNonEmptyString,
  draftRevision: revision,
  commandId: isNonEmptyString,
  summaryReceiptIdOrNull: nullableId,
  correctionHeadHash: hash,
  branchCacheDigest: hash,
  finalSaveStatus: (v: JsonValue | undefined) => v === 'NOT_COMMITTED' || v === 'COMMITTED',
};
const quality = (v: JsonValue | undefined): boolean =>
  isJsonObject(v) &&
  decodeProjection(v, '$.quality', {
    kind: (k) =>
      typeof k === 'string' &&
      [
        'MISSING_OR_UNFIT',
        'POOR',
        'ORDINARY',
        'GOOD',
        'EXCEPTIONAL',
        'RARE',
        'NONE',
        'SMALL',
        'LARGE',
        'RARE_FORTUNE',
      ].includes(k),
    label: creationValidationPublicText,
    range: creationValidationPublicText,
    rawFace: isFace,
  }).ok;
function refuse<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
const object = (
  v: JsonValue | undefined,
  fields: Parameters<typeof decodeProjection>[2],
): boolean => isJsonObject(v) && decodeProjection(v, '$.field', fields).ok;
const array = (v: JsonValue | undefined, predicate: (entry: JsonValue) => boolean): boolean =>
  Array.isArray(v) && v.every(predicate);
export function decodeChr032Projection(
  value: unknown,
  path: string,
): DecodeResult<Chr032Projection> {
  if (!isJsonObject(value)) return refuse(path, value);
  const decoded = decodeProjection(value, path, {
    ...commonFields,
    propertyCheckpointReceiptId: isNonEmptyString,
    armorBundle: (v) =>
      object(v, {
        armorBundleId: isNonEmptyString,
        armorPieces: (a) =>
          array(a, (p) =>
            object(p, {
              itemId: isNonEmptyString,
              name: creationValidationPublicText,
              coverageModel: creationValidationPublicText,
              bodyZone: nullableId,
            }),
          ),
        distinctBodyZones: (a) => array(a, isNonEmptyString),
        qualityRecommendation: quality,
        ownershipState: owned,
      }),
    weapon: (v) =>
      object(v, {
        weaponTypeId: isNonEmptyString,
        weaponVariant: isNonEmptyString,
        name: creationValidationPublicText,
        qualityRecommendation: quality,
        profileFacts: (a) =>
          array(a, (f) =>
            object(f, {
              label: creationValidationPublicText,
              value: (x) => bool(x) || finite(x) || creationValidationPublicText(x),
            }),
          ),
        profileStatus: (x) => x === 'SUBMITTED' || x === 'ACKNOWLEDGED',
        ownershipState: owned,
      }),
    moneyRecommendation: (v) =>
      object(v, { wealthRecommendation: quality, gmFinalizationRequired: (x) => x === true }),
    fivePositions: (v) =>
      Array.isArray(v) &&
      v.length === 5 &&
      v.every((p) => isJsonObject(p) && p['ownershipState'] === 'OWNED_NOT_EQUIPPED'),
    propertyRollReceipts: (v) =>
      Array.isArray(v) &&
      v.length === 8 &&
      v.every((r: JsonValue) =>
        object(r, {
          block: (b) => ['ARMOR_BUNDLE', 'WEAPON', 'MONEY', 'POSITION'].includes(b as string),
          positionIdOrNull: nullableId,
          rollRequestId: isNonEmptyString,
          rollReceiptId: isNonEmptyString,
          rawFace: isFace,
        }),
      ),
    exactOperationCount: (v) => v === 8,
    ownershipStateAll: owned,
    massAndMandatoryRowsStatus: (v) =>
      object(v, { valid: bool, massApprovalStatus: (x) => x === 'PENDING_GM' }),
    summaryEntryMode: (v) => v === 'INITIAL' || v === 'RESUME',
    nextFormId: (v) => v === 'CHR-025' || v === 'CHR-041',
  });
  if (!decoded.ok) return decoded;
  const p = value as Chr032Projection;
  const snapshots = decodeFiveStartingPositionSnapshots(
    p.fivePositions.map((row) => {
      const { ownershipState: _ownership, ...rest } = row;
      return rest;
    }),
    `${path}.fivePositions`,
  );
  if (!snapshots.ok) return snapshots;
  if (
    snapshots.value.some((row) => row.qualityRollReceiptId === null) ||
    p.summaryEntryMode !== (p.summaryReceiptIdOrNull === null ? 'INITIAL' : 'RESUME')
  )
    return refuse(path, value);
  const refs = p.propertyRollReceipts;
  if (
    new Set(refs.map((r) => r.rollReceiptId)).size !== 8 ||
    new Set(refs.map((r) => r.rollRequestId)).size !== 8
  )
    return refuse(path, value);
  for (const [i, ref] of refs.entries()) {
    if (
      ref.block !== (['ARMOR_BUNDLE', 'WEAPON', 'MONEY'][i] ?? 'POSITION') ||
      (i < 3
        ? ref.positionIdOrNull !== null
        : ref.positionIdOrNull !== snapshots.value[i - 3]?.positionId)
    )
      return refuse(path, value);
    if (i >= 3) {
      const row = snapshots.value[i - 3]!;
      if (
        ref.rollRequestId !== row.qualityRollRequestId ||
        ref.rollReceiptId !== row.qualityRollReceiptId ||
        ref.rawFace !== row.qualityRollFaceOrNull
      )
        return refuse(path, value);
    }
  }
  return { ok: true, value: p };
}
export function decodeChr025Projection(
  value: unknown,
  path: string,
): DecodeResult<Chr025Projection> {
  if (!isJsonObject(value)) return refuse(path, value);
  const blockers = decodeArray(
    value['validationBlockers'],
    `${path}.validationBlockers`,
    decodeCreationValidationBlocker,
  );
  if (!blockers.ok) return blockers;
  const stats = (v: JsonValue | undefined) =>
    v === null || object(v, Object.fromEntries(STAT_CODES.map((code) => [code, finite])));
  const decoded = decodeProjection(value, path, {
    ...commonFields,
    identity: (v) =>
      object(v, {
        name: isNonEmptyString,
        age: revision,
        sex: (s) => s === 'MALE' || s === 'FEMALE',
        massKg: finite,
      }),
    raceChoice: (v) => v === 'PURE' || v === 'UNITED' || v === 'FREE',
    pureClassOrNull: (v) => v === null || v === 'SEEKER' || v === 'STALKER' || v === 'SOLDIER',
    identityAndMassStatus: (v) =>
      object(v, {
        valid: bool,
        massApprovalStatus: (x) => x === 'PENDING_GM',
        minimumKg: finite,
        maximumKg: finite,
      }),
    sevenStatsMinOne: bool,
    skillsAndSlotsStatus: (v) => object(v, { valid: bool, required: revision, used: revision }),
    symbiontCompositionStatus: (v) => object(v, { valid: bool }),
    startingPropertyEightReceiptsStatus: (v) => object(v, { valid: bool, count: (x) => x === 8 }),
    cleanRuntimeState: bool,
    branchCacheIntegrity: bool,
    validationBlockers: (v) => v === value['validationBlockers'],
    skillStageStatsOrNull: stats,
    effectiveStatsOrNull: stats,
    statProof: (v) =>
      array(v, (row) =>
        object(row, {
          statCode: (s) => STAT_CODES.includes(s as (typeof STAT_CODES)[number]),
          skillStageValue: finite,
          positiveSymbiontDelta: finite,
          negativeSymbiontDelta: finite,
          appliedNegativeDelta: finite,
          beforeLimits: finite,
          minimumOrNull: (s) => s === null || finite(s),
          maximumOrNull: (s) => s === null || finite(s),
          effectiveValue: finite,
        }),
      ),
    mechanicsSnapshotHashOrNull: (v) => v === null || hash(v),
    nextFormId: (v) => v === 'CHR-025' || v === 'CHR-040',
  });
  if (!decoded.ok) return decoded;
  const p = value as Chr025Projection;
  if (
    p.summaryReceiptIdOrNull === null ||
    p.nextFormId !== (p.finalSaveStatus === 'COMMITTED' ? 'CHR-040' : 'CHR-025') ||
    (p.finalSaveStatus === 'COMMITTED') !== (p.mechanicsSnapshotHashOrNull !== null) ||
    (p.finalSaveStatus === 'COMMITTED' && p.validationBlockers.length > 0)
  )
    return refuse(path, value);
  return { ok: true, value: p };
}
export function expectedChr032ActionKeys(
  p: Chr032Projection,
  checkpoint: boolean,
): readonly ActionKey[] {
  return p.finalSaveStatus === 'COMMITTED'
    ? []
    : [
        ...(checkpoint || p.summaryEntryMode === 'RESUME' ? [CHR_032_CONFIRM_ACTION_KEY] : []),
        'CHR-032::CTA::002',
        'CHR-032::CTA::003',
        'CHR-032::CTA::004',
        'CHR-032::CTA::005',
      ];
}
export function expectedChr025ActionKeys(
  p: Chr025Projection,
  finalSave: boolean,
): readonly ActionKey[] {
  if (p.finalSaveStatus === 'COMMITTED') return [];
  return [
    ...Object.entries(CREATION_BLOCKER_ACTION_KEYS)
      .filter(
        ([kind]) =>
          kind === 'IDENTITY_OR_MASS' ||
          kind === 'RACE_OR_RACE_DEPENDENCIES' ||
          p.validationBlockers.some((b) => b.kind === kind),
      )
      .map(([, action]) => action),
    ...(finalSave && p.validationBlockers.length === 0 ? [CHR_025_FINAL_SAVE_ACTION_KEY] : []),
  ];
}
export type CreationFinalizationRequest =
  | WorkflowCommandRequestMessage<
      | 'UI-CMD-CHAR-WIZARD-CHECKPOINT'
      | 'UI-CMD-CHAR-CREATION-SET-DECIDE'
      | 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
      JsonObject
    >
  | OperationCommandRequestMessage;
export function creationPropertySummaryPayload(p: Chr032Projection): JsonObject {
  if (p.summaryEntryMode !== 'INITIAL') throw new Error('property summary is already confirmed');
  return {
    stage: 'FINALIZATION',
    variant: 'PROPERTY_SUMMARY',
    sourceFormId: 'CHR-032',
    characterDraftId: p.characterDraftId,
    wizardCheckpointId: p.wizardCheckpointId,
    draftRevision: p.draftRevision,
    propertyCheckpointReceiptId: p.propertyCheckpointReceiptId,
    propertyRollReceipts: p.propertyRollReceipts,
  };
}
export function creationFinalSavePayload(p: Chr025Projection): JsonObject {
  if (
    p.finalSaveStatus !== 'NOT_COMMITTED' ||
    p.validationBlockers.length !== 0 ||
    p.summaryReceiptIdOrNull === null
  )
    throw new Error('final save is unavailable');
  return {
    stage: 'FINALIZATION',
    variant: 'FINAL_SAVE',
    sourceFormId: 'CHR-025',
    characterDraftId: p.characterDraftId,
    wizardCheckpointId: p.wizardCheckpointId,
    draftRevision: p.draftRevision,
    summaryReceiptId: p.summaryReceiptIdOrNull,
    correctionHeadHash: p.correctionHeadHash,
  };
}
export function decodeCreationFinalizationTerminal(
  message: Extract<HostToClientMessage, { messageType: 'command.result' | 'command.replay' }>,
  request: CreationFinalizationRequest,
  source: { readonly projection: JsonObject; readonly revisions: RevisionVector },
): DecodeResult<CommandReceipt> {
  const receipt = message.receipt,
    p = request.payload,
    r = receipt.result;
  if (
    receipt.commandId !== request.commandId ||
    receipt.revisions.stateRevision !== source.revisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== source.revisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision
  )
    return refuse('$.receipt', receipt);
  const final = p['variant'] === 'FINAL_SAVE';
  const roll = ['CORRECTION_RANDOM_ROLL', 'CORRECTION_ADVISOR_IW', 'CORRECTION_ADVISOR_B'].includes(
    p['variant'] as string,
  );
  if (
    p['characterDraftId'] !== source.projection['characterDraftId'] ||
    p['wizardCheckpointId'] !== source.projection['wizardCheckpointId'] ||
    p['draftRevision'] !== source.projection['draftRevision'] ||
    (p['variant'] !== 'PROPERTY_SUMMARY' &&
      (p['correctionHeadHash'] !== source.projection['correctionHeadHash'] ||
        p['summaryReceiptId'] !== source.projection['summaryReceiptIdOrNull']))
  )
    return refuse('$.receipt', receipt);
  const decoded = decodeProjection(r, '$.receipt.result', {
    stage: (v) => v === 'FINALIZATION',
    variant: (v) => v === p['variant'],
    sourceFormId: (v) => v === p['sourceFormId'],
    characterDraftId: (v) => v === p['characterDraftId'],
    checkpointOwnerId: (v) => v === p['characterDraftId'],
    checkpointId: (v) => v === p['wizardCheckpointId'],
    checkpointRevision: revision,
    draftRevision: (v) => v === (p['draftRevision'] as number) + 1,
    branchCacheHash: (v) =>
      v === '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    correctionHeadHash: hash,
    branchCacheDigest: hash,
    finalSaveStatus: (v) => v === (final ? 'COMMITTED' : 'NOT_COMMITTED'),
    mechanicsSnapshotHashOrNull: (v) => (final ? hash(v) : v === null),
    nextFormId: (v) =>
      p['variant'] === 'PROPERTY_SUMMARY'
        ? v === source.projection['nextFormId']
        : final
          ? v === 'CHR-040'
          : v === 'CHR-025' ||
            [
              'CHR-011',
              'CHR-015',
              'CHR-017',
              'CHR-018',
              'CHR-019',
              'CHR-020',
              'CHR-041',
              'CHR-042',
            ].includes(v as string),
    ...(roll
      ? {
          physicalRolls: (v: JsonValue | undefined) =>
            array(v, (row) =>
              object(row, {
                kind: isNonEmptyString,
                rollRequestId: isNonEmptyString,
                rollReceiptId: isNonEmptyString,
                mechanical: (m) => object(m, { dieSides: (d) => d === 20, rawFace: isFace }),
              }),
            ),
        }
      : {}),
  });
  if (!decoded.ok) return decoded;
  if (r['correctionHeadHash'] === source.projection['correctionHeadHash'])
    return refuse('$.receipt.result', r);
  if (roll) {
    const rows = r['physicalRolls'] as readonly JsonObject[];
    const iw = p['variant'] === 'CORRECTION_ADVISOR_IW';
    const ids = iw
      ? (p['pendingRollRequestIds'] as readonly string[])
      : [p['pendingRollRequestId'] as string];
    const manualFaces = iw
      ? (p['manualFacesOrNull'] as readonly number[] | null)
      : p['manualFaceOrNull'] === null
        ? null
        : [p['manualFaceOrNull'] as number];
    if (
      rows.length !== (iw ? 2 : 1) ||
      !sameJson(ids, source.projection['pendingRollRequestIds']) ||
      rows[0]?.['rollReceiptId'] !== receipt.receiptId ||
      new Set(rows.map((row) => row['rollReceiptId'])).size !== rows.length
    )
      return refuse('$.receipt.result.physicalRolls', rows);
    for (const [index, row] of rows.entries()) {
      const kind = iw
        ? index === 0
          ? 'ADVISOR_I'
          : 'ADVISOR_W'
        : p['variant'] === 'CORRECTION_ADVISOR_B'
          ? 'TROGR_SUPPRESSION_B'
          : source.projection['nextRandomKindOrNull'];
      const mechanical = row['mechanical'] as JsonObject;
      if (
        row['kind'] !== kind ||
        row['rollRequestId'] !== ids[index] ||
        (manualFaces !== null && mechanical['rawFace'] !== manualFaces[index])
      )
        return refuse('$.receipt.result.physicalRolls', rows);
      const old = source.projection['physicalRolls'];
      if (
        Array.isArray(old) &&
        old.some(
          (previous) =>
            isJsonObject(previous) &&
            (previous['rollRequestId'] === row['rollRequestId'] ||
              previous['rollReceiptId'] === row['rollReceiptId']),
        )
      )
        return refuse('$.receipt.result.physicalRolls', rows);
    }
  }
  return { ok: true, value: receipt };
}
export function creationFinalizationSnapshotMatchesReceipt(
  snapshot: {
    readonly formId: string;
    readonly projection: JsonObject;
    readonly revisions: RevisionVector;
    readonly layers: readonly unknown[];
  },
  receipt: CommandReceipt,
): boolean {
  const p = snapshot.projection,
    r = receipt.result;
  return (
    snapshot.layers.length === 0 &&
    snapshot.formId === (r['nextFormId'] === 'CHR-040' ? 'CHR-025' : r['nextFormId']) &&
    p['characterDraftId'] === r['characterDraftId'] &&
    p['wizardCheckpointId'] === r['checkpointId'] &&
    p['draftRevision'] === r['draftRevision'] &&
    p['commandId'] === receipt.commandId &&
    p['correctionHeadHash'] === r['correctionHeadHash'] &&
    p['branchCacheDigest'] === r['branchCacheDigest'] &&
    p['finalSaveStatus'] === r['finalSaveStatus'] &&
    (r['variant'] !== 'PROPERTY_SUMMARY' || p['summaryReceiptIdOrNull'] === receipt.receiptId) &&
    sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
  );
}
