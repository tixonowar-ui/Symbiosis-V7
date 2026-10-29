import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  DecodeResult,
  HostToClientMessage,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/index.js';

import type {
  ArmorBundleQualityRecommendationProjection,
  Chr021Projection,
} from './armor-bundle.js';
import {
  decodeArray,
  decodeProjection,
  isFace,
  isJsonObject,
  isNonEmptyString,
  sameJson,
} from './random-symbionts.js';

export const CHR_022_ROLL_ACTION_KEY = 'CHR-022::CTA::004' as const satisfies ActionKey;
export const CHR_022_CONFIRM_ACTION_KEY = 'CHR-022::CTA::001' as const satisfies ActionKey;
export const CHR_022_PURE_CONFIRM_ACTION_KEY = 'CHR-022::CTA::002' as const satisfies ActionKey;
export const CHR_022_RETURN_ACTION_KEY = 'CHR-022::CTA::003' as const satisfies ActionKey;

export type StartingWeaponVariant =
  'DEFAULT' | 'ONE_HAND' | 'TWO_HAND' | 'SWORD' | 'SHIELD' | 'RAPIER';
const VARIANTS: ReadonlySet<string> = new Set([
  'DEFAULT',
  'ONE_HAND',
  'TWO_HAND',
  'SWORD',
  'SHIELD',
  'RAPIER',
]);
const QUALITY_KINDS: ReadonlySet<string> = new Set([
  'MISSING_OR_UNFIT',
  'POOR',
  'ORDINARY',
  'GOOD',
  'EXCEPTIONAL',
  'RARE',
]);

export interface WeaponRequirementPreview extends JsonObject {
  readonly requirements: string;
  readonly skillOrClass: string;
  readonly missingSkillOrClassPenalty: string;
}
export interface StartingWeaponCatalogEntryProjection extends JsonObject {
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly name: string;
  readonly variantLabel: string;
  readonly requirementPreview: WeaponRequirementPreview;
}
export interface Chr022Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly weaponCatalog: { readonly entries: readonly StartingWeaponCatalogEntryProjection[] };
  readonly weaponTypeId: string | null;
  readonly weaponVariant: StartingWeaponVariant | null;
  readonly raceChoice: 'FREE' | 'UNITED' | 'PURE';
  readonly weaponQualityRollRequestId: string;
  readonly weaponQualityRollReceiptIdOrNull: string | null;
  readonly weaponCheckpointReceiptIdOrNull: string | null;
  readonly qualityRecommendation: ArmorBundleQualityRecommendationProjection | null;
  readonly requirementPreview: WeaponRequirementPreview | null;
  readonly ownershipState: 'OWNED_NOT_EQUIPPED';
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string;
  readonly nextFormId: 'CHR-022' | 'CHR-023' | 'CHR-024';
}
function refused<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
const isVariant = (value: JsonValue | undefined): value is StartingWeaponVariant =>
  typeof value === 'string' && VARIANTS.has(value);
const isRevision = (value: JsonValue | undefined): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableId = (value: JsonValue | undefined): boolean =>
  value === null || isNonEmptyString(value);

function decodeRequirement(value: unknown, path: string): DecodeResult<WeaponRequirementPreview> {
  if (!isJsonObject(value)) return refused(path, value);
  const result = decodeProjection(value, path, {
    requirements: isNonEmptyString,
    skillOrClass: isNonEmptyString,
    missingSkillOrClassPenalty: isNonEmptyString,
  });
  return result.ok ? { ok: true, value: value as WeaponRequirementPreview } : result;
}
function decodeEntry(
  value: unknown,
  path: string,
): DecodeResult<StartingWeaponCatalogEntryProjection> {
  if (!isJsonObject(value)) return refused(path, value);
  const preview = decodeRequirement(value['requirementPreview'], `${path}.requirementPreview`);
  if (!preview.ok) return preview;
  const result = decodeProjection(value, path, {
    weaponTypeId: isNonEmptyString,
    weaponVariant: isVariant,
    name: isNonEmptyString,
    variantLabel: isNonEmptyString,
    requirementPreview: (field) => field === value['requirementPreview'],
  });
  return result.ok ? { ok: true, value: value as StartingWeaponCatalogEntryProjection } : result;
}
function decodeRecommendation(
  value: unknown,
  path: string,
): DecodeResult<ArmorBundleQualityRecommendationProjection> {
  if (!isJsonObject(value)) return refused(path, value);
  const result = decodeProjection(value, path, {
    kind: (field) => typeof field === 'string' && QUALITY_KINDS.has(field),
    label: isNonEmptyString,
    range: isNonEmptyString,
    rawFace: isFace,
  });
  return result.ok
    ? { ok: true, value: value as ArmorBundleQualityRecommendationProjection }
    : result;
}
export function decodeChr022Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr022Projection> {
  const rawCatalog = value['weaponCatalog'];
  if (!isJsonObject(rawCatalog)) return refused(`${path}.weaponCatalog`, rawCatalog);
  const entries = decodeArray(rawCatalog['entries'], `${path}.weaponCatalog.entries`, decodeEntry);
  if (!entries.ok) return entries;
  const catalog = decodeProjection(rawCatalog, `${path}.weaponCatalog`, {
    entries: (field) => field === rawCatalog['entries'],
  });
  if (!catalog.ok) return catalog;
  if (
    entries.value.length === 0 ||
    new Set(entries.value.map((entry) => `${entry.weaponTypeId}:${entry.weaponVariant}`)).size !==
      entries.value.length
  ) {
    return refused(`${path}.weaponCatalog.entries`, rawCatalog['entries']);
  }
  const recommendation =
    value['qualityRecommendation'] === null
      ? { ok: true as const, value: null }
      : decodeRecommendation(value['qualityRecommendation'], `${path}.qualityRecommendation`);
  if (!recommendation.ok) return recommendation;
  const preview =
    value['requirementPreview'] === null
      ? { ok: true as const, value: null }
      : decodeRequirement(value['requirementPreview'], `${path}.requirementPreview`);
  if (!preview.ok) return preview;
  const result = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    commandId: isNonEmptyString,
    draftRevision: isRevision,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    nextFormId: (field) => field === 'CHR-022' || field === 'CHR-023' || field === 'CHR-024',
    ownershipState: (field) => field === 'OWNED_NOT_EQUIPPED',
    qualityRecommendation: (field) => field === value['qualityRecommendation'],
    requirementPreview: (field) => field === value['requirementPreview'],
    raceChoice: (field) => field === 'FREE' || field === 'UNITED' || field === 'PURE',
    weaponCatalog: (field) => field === rawCatalog,
    weaponTypeId: nullableId,
    weaponVariant: (field) => field === null || isVariant(field),
    weaponQualityRollRequestId: isNonEmptyString,
    weaponQualityRollReceiptIdOrNull: nullableId,
    weaponCheckpointReceiptIdOrNull: nullableId,
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  const projection = value as Chr022Projection;
  const rolled = projection.weaponQualityRollReceiptIdOrNull !== null;
  const checkpointed = projection.weaponCheckpointReceiptIdOrNull !== null;
  const selected = entries.value.find(
    (entry) =>
      entry.weaponTypeId === projection.weaponTypeId &&
      entry.weaponVariant === projection.weaponVariant,
  );
  if (
    (rolled
      ? selected === undefined ||
        preview.value === null ||
        !sameJson(selected.requirementPreview, preview.value)
      : projection.weaponTypeId !== null ||
        projection.weaponVariant !== null ||
        preview.value !== null) ||
    rolled !== (recommendation.value !== null) ||
    (checkpointed && !rolled) ||
    projection.nextFormId !==
      (checkpointed ? (projection.raceChoice === 'PURE' ? 'CHR-024' : 'CHR-023') : 'CHR-022')
  )
    return refused(path, value);
  return { ok: true, value: projection };
}
export function expectedChr022ActionKeys(
  projection: Chr022Projection,
  capabilities: { readonly rollCommit: boolean; readonly checkpoint: boolean },
): readonly ActionKey[] {
  if (projection.weaponCheckpointReceiptIdOrNull !== null) return [];
  return [
    ...(projection.weaponQualityRollReceiptIdOrNull === null
      ? capabilities.rollCommit
        ? [CHR_022_ROLL_ACTION_KEY]
        : []
      : capabilities.checkpoint
        ? [
            projection.raceChoice === 'PURE'
              ? CHR_022_PURE_CONFIRM_ACTION_KEY
              : CHR_022_CONFIRM_ACTION_KEY,
          ]
        : []),
    CHR_022_RETURN_ACTION_KEY,
  ];
}
export interface StartingWeaponDraft {
  readonly weaponTypeId: string | null;
  readonly weaponVariant: StartingWeaponVariant | null;
}
export function startingWeaponDraftFromSnapshot(projection: Chr022Projection): StartingWeaponDraft {
  return { weaponTypeId: projection.weaponTypeId, weaponVariant: projection.weaponVariant };
}
export function selectStartingWeapon(
  projection: Chr022Projection,
  weaponTypeId: string,
  weaponVariant: string,
): StartingWeaponDraft {
  if (projection.weaponQualityRollReceiptIdOrNull !== null)
    throw new Error('starting weapon: selection is already committed');
  const entry = projection.weaponCatalog.entries.find(
    (candidate) =>
      candidate.weaponTypeId === weaponTypeId && candidate.weaponVariant === weaponVariant,
  );
  if (entry === undefined)
    throw new Error(`starting weapon: unknown type/variant ${weaponTypeId}/${weaponVariant}`);
  return { weaponTypeId: entry.weaponTypeId, weaponVariant: entry.weaponVariant };
}
export interface StartingWeaponSnapshotSource {
  readonly formId: 'CHR-022';
  readonly projection: Chr022Projection;
  readonly revisions: RevisionVector;
}
interface WeaponPayloadCommon extends JsonObject {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-022';
  readonly stage: 'SYMBIONTS';
}
export interface StartingWeaponQualityPayload extends WeaponPayloadCommon {
  readonly variant: 'STARTING_WEAPON_QUALITY';
  readonly weaponQualityRollRequestId: string;
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly manualFaceOrNull: number | null;
}
export interface StartingWeaponCheckpointPayload extends WeaponPayloadCommon {
  readonly variant: 'STARTING_WEAPON_CHECKPOINT';
  readonly weaponQualityRollRequestId: string;
  readonly weaponQualityRollReceiptId: string;
}
export interface StartingWeaponEntryPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly variant: 'STARTING_WEAPON_ENTRY';
  readonly sourceFormId: 'CHR-021';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly armorBundleId: string;
  readonly armorBundleCheckpointReceiptId: string;
}
export type StartingWeaponQualityRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  StartingWeaponQualityPayload
>;
export type StartingWeaponCheckpointRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  StartingWeaponCheckpointPayload
>;
export type StartingWeaponEntryRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  StartingWeaponEntryPayload
>;
function commonPayload(projection: Chr022Projection): WeaponPayloadCommon {
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-022',
    characterDraftId: projection.characterDraftId,
    wizardCheckpointId: projection.wizardCheckpointId,
    draftRevision: projection.draftRevision,
  };
}
export function startingWeaponQualityPayload(
  source: StartingWeaponSnapshotSource,
  draft: StartingWeaponDraft,
  manualFaceOrNull: number | null,
): StartingWeaponQualityPayload {
  const projection = source.projection;
  if (draft.weaponTypeId === null || draft.weaponVariant === null)
    throw new Error('starting weapon: select exactly one type/variant');
  const selection = selectStartingWeapon(projection, draft.weaponTypeId, draft.weaponVariant);
  if (
    (projection.diceInputModeSnapshot === 'AUTO') !== (manualFaceOrNull === null) ||
    (manualFaceOrNull !== null && !isFace(manualFaceOrNull))
  ) {
    throw new Error('starting weapon: MANUAL requires one explicit d20 face, AUTO requires none');
  }
  return {
    ...commonPayload(projection),
    variant: 'STARTING_WEAPON_QUALITY',
    weaponQualityRollRequestId: projection.weaponQualityRollRequestId,
    weaponTypeId: selection.weaponTypeId!,
    weaponVariant: selection.weaponVariant!,
    manualFaceOrNull,
  };
}
export function startingWeaponCheckpointPayload(
  source: StartingWeaponSnapshotSource,
): StartingWeaponCheckpointPayload {
  const projection = source.projection;
  if (
    projection.weaponQualityRollReceiptIdOrNull === null ||
    projection.weaponCheckpointReceiptIdOrNull !== null
  )
    throw new Error('starting weapon: checkpoint requires a new committed quality roll');
  return {
    ...commonPayload(projection),
    variant: 'STARTING_WEAPON_CHECKPOINT',
    weaponQualityRollRequestId: projection.weaponQualityRollRequestId,
    weaponQualityRollReceiptId: projection.weaponQualityRollReceiptIdOrNull,
  };
}
export function startingWeaponEntryPayload(
  projection: Chr021Projection,
): StartingWeaponEntryPayload {
  if (
    projection.weaponEntryMode !== 'INITIAL' ||
    projection.bundleCheckpointReceiptIdOrNull === null
  )
    throw new Error('starting weapon: entry requires confirmed armor');
  return {
    stage: 'SYMBIONTS',
    variant: 'STARTING_WEAPON_ENTRY',
    sourceFormId: 'CHR-021',
    characterDraftId: projection.characterDraftId,
    wizardCheckpointId: projection.wizardCheckpointId,
    draftRevision: projection.draftRevision,
    armorBundleId: projection.armorBundleId,
    armorBundleCheckpointReceiptId: projection.bundleCheckpointReceiptIdOrNull,
  };
}

type TerminalMessage = Extract<
  HostToClientMessage,
  { readonly messageType: 'command.replay' | 'command.result' }
>;
export function decodeStartingWeaponTerminal(
  message: TerminalMessage,
  request:
    StartingWeaponQualityRequest | StartingWeaponCheckpointRequest | StartingWeaponEntryRequest,
  source: { readonly revisions: RevisionVector; readonly projection: JsonObject },
): DecodeResult<CommandReceipt> {
  const receipt = message.receipt;
  const payload = request.payload;
  const result = receipt.result;
  if (
    receipt.commandId !== request.commandId ||
    !isNonEmptyString(receipt.receiptId) ||
    receipt.revisions.stateRevision !== source.revisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== source.revisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision
  )
    return refused('$.receipt', receipt);
  const common = {
    stage: (field: JsonValue | undefined) => field === 'SYMBIONTS',
    variant: (field: JsonValue | undefined) => field === payload.variant,
    sourceFormId: (field: JsonValue | undefined) => field === payload.sourceFormId,
    characterDraftId: (field: JsonValue | undefined) => field === payload.characterDraftId,
    checkpointOwnerId: (field: JsonValue | undefined) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue | undefined) => field === payload.wizardCheckpointId,
    checkpointRevision: isRevision,
    draftRevision: (field: JsonValue | undefined) => field === payload.draftRevision + 1,
    branchCacheHash: isNonEmptyString,
    branchUuid: isNonEmptyString,
    weaponQualityRollRequestId: isNonEmptyString,
  };
  if (payload.variant === 'STARTING_WEAPON_ENTRY') {
    const decoded = decodeProjection(result, '$.receipt.result', {
      ...common,
      armorBundleId: (field) => field === payload.armorBundleId,
      armorBundleCheckpointReceiptId: (field) => field === payload.armorBundleCheckpointReceiptId,
      nextFormId: (field) => field === 'CHR-022',
    });
    return decoded.ok ? { ok: true, value: receipt } : decoded;
  }
  const recommendation = decodeRecommendation(
    result['qualityRecommendation'],
    '$.receipt.result.qualityRecommendation',
  );
  if (!recommendation.ok) return recommendation;
  const roll = result['physicalRoll'];
  if (payload.variant === 'STARTING_WEAPON_QUALITY') {
    if (!isJsonObject(roll) || !isJsonObject(roll['mechanical']))
      return refused('$.receipt.result.physicalRoll', roll);
    const mechanical = decodeProjection(
      roll['mechanical'],
      '$.receipt.result.physicalRoll.mechanical',
      {
        dieSides: (field) => field === 20,
        rawFace: (field) =>
          isFace(field) &&
          field === recommendation.value.rawFace &&
          (payload.manualFaceOrNull === null || field === payload.manualFaceOrNull),
      },
    );
    if (!mechanical.ok) return mechanical;
    const decodedRoll = decodeProjection(roll, '$.receipt.result.physicalRoll', {
      kind: (field) => field === 'STARTING_WEAPON_QUALITY',
      mechanical: (field) => field === roll['mechanical'],
      rollRequestId: (field) => field === payload.weaponQualityRollRequestId,
      rollReceiptId: (field) => field === receipt.receiptId,
    });
    if (!decodedRoll.ok) return decodedRoll;
  }
  const decoded = decodeProjection(result, '$.receipt.result', {
    ...common,
    weaponQualityRollRequestId: (field) =>
      field === source.projection['weaponQualityRollRequestId'],
    weaponTypeId: (field) =>
      field ===
      (payload.variant === 'STARTING_WEAPON_QUALITY'
        ? payload.weaponTypeId
        : source.projection['weaponTypeId']),
    weaponVariant: (field) =>
      field ===
      (payload.variant === 'STARTING_WEAPON_QUALITY'
        ? payload.weaponVariant
        : source.projection['weaponVariant']),
    qualityRecommendation: (field) => field === result['qualityRecommendation'],
    ownershipState: (field) => field === 'OWNED_NOT_EQUIPPED',
    nextFormId: (field) =>
      field ===
      (payload.variant === 'STARTING_WEAPON_QUALITY'
        ? 'CHR-022'
        : source.projection['raceChoice'] === 'PURE'
          ? 'CHR-024'
          : 'CHR-023'),
    ...(payload.variant === 'STARTING_WEAPON_QUALITY'
      ? {
          diceInputModeSnapshot: (field: JsonValue | undefined) =>
            field === source.projection['diceInputModeSnapshot'],
          physicalRoll: (field: JsonValue | undefined) => field === roll,
        }
      : {
          weaponQualityRollReceiptId: (field: JsonValue | undefined) =>
            field === payload.weaponQualityRollReceiptId,
        }),
  });
  return decoded.ok ? { ok: true, value: receipt } : decoded;
}
