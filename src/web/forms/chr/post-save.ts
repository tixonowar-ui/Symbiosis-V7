import type { ActionKey, FormId } from '@generated/types/atlas.js';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import type {
  CommandReceipt,
  DecodeResult,
  HostToClientMessage,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandId,
} from '@shared/index.js';
import {
  POST_SAVE_COMMAND_IDS,
  type PostSaveFormId,
  type PostSaveProjection,
  type PostSaveMetadata,
  type PostSavePayload,
  type PostSaveRequest,
  type PostSaveDraftRequest,
  type PostSaveCommandResult,
} from '@shared/local-character-post-save.js';
import {
  decodeProjection,
  isJsonObject,
  isNonEmptyString,
  isSpeciesKey,
  isFace,
} from './random-symbionts.js';
import { creationValidationPublicText, startingPropertyFields } from './creation-validation.js';
import { decodeFiveStartingPositionSnapshots } from './five-starting-positions.js';

export const POST_SAVE_FORMS = ['CHR-026', 'CHR-039', 'CHR-040', 'APP-009', 'APP-010'] as const;
export const LIBRARY_ROUTES = {
  'CHR-026': '/player/characters/:localCharacterId/create/chr-026',
  'CHR-040': '/player/characters/:localCharacterId/create/chr-040',
  'CHR-001': '/player/characters/:localCharacterId/create/chr-001',
} as const;
export const RESTORE_FORMS: readonly FormId[] = [
  'CHR-001',
  'CHR-002',
  'CHR-003',
  'CHR-004',
  'CHR-005',
  'CHR-006',
  'CHR-007',
  'CHR-008',
  'CHR-009',
  'CHR-010',
  'CHR-011',
  'CHR-012',
  'CHR-013',
  'CHR-014',
  'CHR-015',
  'CHR-016',
  'CHR-017',
  'CHR-018',
  'CHR-019',
  'CHR-020',
  'CHR-021',
  'CHR-022',
  'CHR-023',
  'CHR-024',
  'CHR-025',
  'CHR-028',
  'CHR-029',
  'CHR-030',
  'CHR-031',
  'CHR-032',
  'CHR-036',
  'CHR-037',
  'CHR-038',
  'CHR-039',
  'CHR-041',
  'CHR-042',
];
export const POST_SAVE_ACTIONS = {
  RESTORE: 'APP-009::CTA::003',
  METADATA_PATCH: 'CHR-040::CTA::004',
  VARIANT_CREATE: 'APP-010::CTA::004',
  EXPORT: 'APP-010::CTA::005',
} as const satisfies Record<PostSavePayload['variant'], ActionKey>;
const integer = (v: JsonValue | undefined) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const hash = (v: JsonValue | undefined) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nullableId = (v: JsonValue | undefined) => v === null || isNonEmptyString(v);
const nullableInteger = (v: JsonValue | undefined) => v === null || integer(v);
const nullableHash = (v: JsonValue | undefined) => v === null || hash(v);
const boolean = (v: JsonValue | undefined) => typeof v === 'boolean';
const ids = (v: JsonValue | undefined) =>
  Array.isArray(v) && v.every(isNonEmptyString) && new Set(v).size === v.length;
const object = (v: JsonValue | undefined, fields: Parameters<typeof decodeProjection>[2]) =>
  isJsonObject(v) && decodeProjection(v, '$.field', fields).ok;
const common = {
  postSaveScopeId: isNonEmptyString,
  sourceBindingHash: hash,
  sourceEntityId: isNonEmptyString,
};
const revisions = (v: JsonValue | undefined) =>
  object(v, {
    stateRevision: integer,
    projectionRevision: integer,
    actorVisibilityRevision: integer,
  });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameRevisions = (a: RevisionVector, b: RevisionVector) =>
  a.stateRevision === b.stateRevision &&
  a.projectionRevision === b.projectionRevision &&
  a.actorVisibilityRevision === b.actorVisibilityRevision;
const restoreForm = (v: JsonValue | undefined) =>
  v === null || (typeof v === 'string' && RESTORE_FORMS.includes(v as FormId));
const restoreStatus = (v: JsonValue | undefined) =>
  v === 'READY' || v === 'RESTORED' || v === 'CORRUPT';
const metadataFields = {
  name: isNonEmptyString,
  description: (v: JsonValue | undefined) => v === null || typeof v === 'string',
  artAssetKeyOrLocalFile: (v: JsonValue | undefined) =>
    v === null ||
    object(v, {
      kind: (k) => k === 'asset-key',
      assetKey: (key) =>
        typeof key === 'string' &&
        (LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS as readonly string[]).includes(key),
    }) ||
    object(v, {
      kind: (k) => k === 'local-file',
      mediaType: (m) => m === 'image/png' || m === 'image/jpeg',
      bytesBase64: isNonEmptyString,
    }),
};
const finite = (v: JsonValue | undefined) => typeof v === 'number' && Number.isFinite(v);
const codes = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const stats = (v: JsonValue | undefined) =>
  object(v, Object.fromEntries(codes.map((c) => [c, finite])));
const rows = (v: JsonValue | undefined, check: (row: JsonValue) => boolean) =>
  Array.isArray(v) && v.every(check);
const skill = (v: JsonValue | undefined) =>
  object(v, {
    skillId: creationValidationPublicText,
    label: creationValidationPublicText,
    bonus: finite,
    slotCost: integer,
    source: (s) =>
      ['SELECTED', 'RACE_GRANTED', 'CLASS_MANDATORY', 'SYMBIONT_PERMANENT'].includes(s as string),
  });
const binding = (v: JsonValue | undefined) =>
  object(v, {
    kind: (k) =>
      ['NONE', 'TICK_RIGHT_HAND', 'SPIDER_BOTH_WRISTS', 'MANTIS_BOTH_FOREARMS'].includes(
        k as string,
      ),
  }) ||
  object(v, {
    kind: (k) => k === 'OWL_EYE' || k === 'EEL_ARM',
    side: (s) => s === 'LEFT' || s === 'RIGHT',
  });
const empty = (v: JsonValue | undefined) => Array.isArray(v) && v.length === 0;
const runtime = (v: JsonValue | undefined) =>
  object(v, {
    maxHp: finite,
    currentHp: finite,
    alive: (x) => x === true,
    conscious: (x) => x === true,
    ...Object.fromEntries(
      ['stunned', 'bound', 'burning', 'poisoned', 'diseased'].map((k) => [
        k,
        (x: JsonValue | undefined) => x === false,
      ]),
    ),
    ...Object.fromEntries(
      [
        'wounds',
        'injuries',
        'bleeding',
        'temporaryEffects',
        'cooldowns',
        'preparations',
        'combatUsageLimits',
        'equippedItems',
        'generatedObjects',
        'externalEntities',
        'chimeraDevouringHistory',
      ].map((k) => [k, empty]),
    ),
    initiativeOrNull: (x) => x === null,
    combatSceneIdOrNull: (x) => x === null,
    statProgressionCounters: (s) =>
      object(s, Object.fromEntries(codes.map((c) => [c, (x: JsonValue | undefined) => x === 0]))),
    symbiontXpProgressPoints: (x) => x === 0,
    unallocatedSymbiontXp: (x) => x === 0,
    chimeraExtraSlots: (x) => x === 0,
    taipanPoisonOrNull: (x) => x === null || x === 'DEADLY',
    penguinMiMiMiActive: boolean,
    ratInsideHost: boolean,
    keeperInsideHost: boolean,
    mantisBladeStateOrNull: (x) => x === null || x === 'ORDINARY',
  });
const property = (v: JsonValue | undefined) => {
  if (!object(v, startingPropertyFields)) return false;
  const p = v as JsonObject;
  const five = decodeFiveStartingPositionSnapshots(
    (p['fivePositions'] as readonly JsonObject[]).map(
      ({ ownershipState: _ownership, ...row }) => row,
    ),
    '$.property.fivePositions',
  );
  if (!five.ok || five.value.some((row) => row.qualityRollReceiptId === null)) return false;
  const refs = p['propertyRollReceipts'] as readonly JsonObject[];
  return (
    new Set(refs.map((r) => r['rollReceiptId'])).size === 8 &&
    new Set(refs.map((r) => r['rollRequestId'])).size === 8 &&
    refs.every(
      (r, i) =>
        r['block'] === (['ARMOR_BUNDLE', 'WEAPON', 'MONEY'][i] ?? 'POSITION') &&
        (i < 3
          ? r['positionIdOrNull'] === null
          : r['positionIdOrNull'] === five.value[i - 3]?.positionId &&
            r['rollRequestId'] === five.value[i - 3]?.qualityRollRequestId &&
            r['rollReceiptId'] === five.value[i - 3]?.qualityRollReceiptId &&
            r['rawFace'] === five.value[i - 3]?.qualityRollFaceOrNull),
    )
  );
};
export const postSaveMechanics = (v: JsonValue | undefined) =>
  object(v, {
    identity: (x) =>
      object(x, { age: integer, sex: (s) => s === 'MALE' || s === 'FEMALE', massKg: finite }),
    race: (x) =>
      object(x, {
        code: (c) => c === 'PURE' || c === 'UNITED' || c === 'FREE',
        label: creationValidationPublicText,
      }),
    classOrNull: (x) =>
      x === null ||
      object(x, {
        code: (c) => c === 'SEEKER' || c === 'STALKER' || c === 'SOLDIER',
        label: creationValidationPublicText,
      }),
    creationMode: (x) => x === null || x === 'MANUAL' || x === 'RANDOM',
    skillStageStats: stats,
    effectiveStats: stats,
    statProof: (x) =>
      Array.isArray(x) &&
      x.length === 7 &&
      (x as readonly JsonValue[]).every((r, i) =>
        object(r, {
          statCode: (c) => c === codes[i],
          skillStageValue: finite,
          positiveSymbiontDelta: finite,
          negativeSymbiontDelta: finite,
          appliedNegativeDelta: finite,
          beforeLimits: finite,
          minimumOrNull: (n) => n === null || finite(n),
          maximumOrNull: (n) => n === null || finite(n),
          effectiveValue: finite,
        }),
      ),
    skills: (x) => rows(x, skill),
    symbionts: (x) =>
      rows(x, (s) =>
        object(s, {
          acceptedIndex: integer,
          speciesKey: isSpeciesKey,
          label: creationValidationPublicText,
          status: (s) => ['ACTIVE', 'SUPPRESSED', 'ABSORBED', 'DESTROYED'].includes(s as string),
          level: integer,
          maxOe: finite,
          currentOe: finite,
          xp: (n) => n === 0,
          effectsEnabled: boolean,
          xpEligible: boolean,
          learnedNodes: (n) =>
            rows(n, (r) => object(r, { label: creationValidationPublicText, level: integer })),
          binding,
        }),
      ),
    advisorOrNull: (x) =>
      x === null ||
      object(x, {
        intelligence: finite,
        wisdom: finite,
        suppressionBonusOrNull: (n) => n === null || finite(n),
        skills: (s) => rows(s, (r) => skill(r) && (r as JsonObject)['source'] === 'SELECTED'),
      }),
    permanentGrants: (x) =>
      rows(x, (g) =>
        object(g, { kind: (k) => k === 'TROGR_GROSS', bonusBefore: integer, bonusAfter: integer }),
      ),
    trainingSlotLedger: (x) => object(x, { maxPermanentWisdom: finite, everIssued: integer }),
    property,
    manufacturingReceipts: (x) =>
      rows(x, (r) =>
        object(r, {
          receiptId: isNonEmptyString,
          requestId: isNonEmptyString,
          submitCommandId: isNonEmptyString,
          variable: creationValidationPublicText,
          dieSides: (n) => integer(n) && (n as number) > 0,
          value: (n) =>
            integer(n) &&
            (n as number) > 0 &&
            (n as number) <= ((r as JsonObject)['dieSides'] as number),
          provenance: (p) => p === 'PLAYER_WITNESS',
        }),
      ),
    runtime,
  });
const creationReceipts = (v: JsonValue | undefined) =>
  rows(v, (r) =>
    object(r, {
      kind: (k) =>
        [
          'STAT_SET',
          'STAT_CRITICAL_CONFIRMATION',
          'SPECIES_ORIGIN',
          'CRITICAL_CONFIRMATION',
          'ADVISOR_I',
          'ADVISOR_W',
          'TROGR_SUPPRESSION_B',
          'ARMOR_BUNDLE_QUALITY',
          'STARTING_WEAPON_QUALITY',
          'STARTING_MONEY',
          'FIVE_STARTING_POSITION_QUALITY',
        ].includes(k as string),
      rollRequestId: isNonEmptyString,
      rollReceiptId: isNonEmptyString,
      diceInputMode: (m) => m === 'AUTO' || m === 'MANUAL',
      dieSides: (d) => d === 20,
      faces: (f) =>
        Array.isArray(f) &&
        f.length === ((r as JsonObject)['kind'] === 'STAT_SET' ? 7 : 1) &&
        f.every(isFace),
    }),
  );
const provenance = (v: JsonValue | undefined) =>
  object(v, {
    registryVersion: isNonEmptyString,
    catalogVersion: isNonEmptyString,
    builtAgainstTuple: isNonEmptyString,
    sourceUuid: isNonEmptyString,
    sourceSnapshotId: isNonEmptyString,
    metadataRevision: integer,
    sourceChecksum: hash,
    finalSaveReceiptId: isNonEmptyString,
    finalSnapshotVersion: integer,
  });
function refused<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
export function isPostSaveForm(formId: string): formId is PostSaveFormId {
  return (POST_SAVE_FORMS as readonly string[]).includes(formId);
}
export function decodePostSaveMetadata(value: unknown, path = '$'): DecodeResult<PostSaveMetadata> {
  if (!isJsonObject(value)) return refused(path, value);
  return decodeProjection(value, path, metadataFields) as DecodeResult<PostSaveMetadata>;
}

export function decodePostSaveProjection(
  value: unknown,
  path: string,
  formId: PostSaveFormId,
  role: 'player' | 'gm' | null,
  version: RevisionVector,
): DecodeResult<PostSaveProjection> {
  if (!isJsonObject(value) || (role !== 'player' && !(role === 'gm' && formId === 'APP-010')))
    return refused(path, value);
  let decoded: DecodeResult<JsonObject>;
  if (formId === 'CHR-026')
    decoded = decodeProjection(value, path, {
      ...common,
      characterDraftId: (v) => v === value['sourceEntityId'],
      lastCompleteCheckpointId: nullableId,
      lastCompleteCheckpointRevision: nullableInteger,
      resumeFormId: restoreForm,
      branchCacheHash: nullableHash,
      randomReceiptIds: ids,
      corruptTailIgnored: boolean,
      restoreStatus,
      draftRevision: nullableInteger,
      commandId: nullableId,
    });
  else if (formId === 'APP-009')
    decoded = decodeProjection(value, path, {
      ...common,
      checkpointOwnerId: (v) => v === value['sourceEntityId'],
      checkpointEntityKind: (v) => v === 'CHARACTER_DRAFT',
      lastCompleteCheckpointId: nullableId,
      checkpointRevision: nullableInteger,
      branchCacheHashOrNull: nullableHash,
      randomReceiptIds: ids,
      resumeFormId: restoreForm,
      restoreReceiptIdOrNull: nullableId,
      corruptTailIgnored: boolean,
      restoreStatus,
      commandId: nullableId,
    });
  else if (formId === 'CHR-039')
    decoded = decodeProjection(value, path, {
      ...common,
      characterDraftId: (v) => v === value['sourceEntityId'],
      wizardCheckpointId: isNonEmptyString,
      branchCacheEntries: (v) =>
        Array.isArray(v) &&
        (v as readonly JsonValue[]).every((e) =>
          object(e, {
            branchUuid: isNonEmptyString,
            branchKind: (k) => k === 'RACE' || k === 'CLASS' || k === 'SYMBIONT',
            payloadHash: hash,
            randomReceiptIds: ids,
            savedAtRevision: integer,
          }),
        ),
      selectedBranchUuidOrNull: nullableId,
      cacheIntegrityStatus: (v) => v === 'VALID' || v === 'CORRUPT',
      originFormId: (v) => ['CHR-017', 'CHR-019', 'CHR-025', 'CHR-032'].includes(v as string),
      returnFormId: (v) => v === value['originFormId'],
      draftRevision: integer,
      branchCacheHash: hash,
    });
  else if (formId === 'CHR-040')
    decoded = decodeProjection(value, path, {
      ...common,
      ...metadataFields,
      localCharacterUuid: (v) => v === value['sourceEntityId'],
      finalSnapshotVersion: integer,
      finalSaveReceiptId: isNonEmptyString,
      mechanicsSnapshot: postSaveMechanics,
      creationRandomReceipts: creationReceipts,
      localMetadataRevision: integer,
      candidateSnapshotIds: ids,
      campaignCopyIds: ids,
      checksum: hash,
      provenance,
      commandId: isNonEmptyString,
    });
  else {
    const player = role === 'player';
    decoded = decodeProjection(value, path, {
      ...common,
      ownerContext: (v) => v === (player ? 'PLAYER_LOCAL' : 'GM_ARCHIVE_EXPORT'),
      sourceKind: (v) => v === (player ? 'LOCAL_FINAL' : 'COMPLETED_CAMPAIGN_COPY'),
      originFormId: (v) => (player ? v === 'APP-004' || v === 'CHR-040' : v === 'CMP-012'),
      returnFormId: (v) => v === value['originFormId'],
      activeLocalOwnerIdOrNull: player ? isNonEmptyString : (v) => v === null,
      masterAuthorityRevisionOrNull: player ? (v) => v === null : integer,
      sourceSnapshotId: isNonEmptyString,
      sourceUuid: (v) => v === value['sourceEntityId'],
      schemaVersion: (v) => v === 1,
      baselineVersion: isNonEmptyString,
      checksum: hash,
      provenance,
      localMetadataRevision: integer,
      metadata: (v) => object(v, metadataFields),
      stateRevision: (v) => v === version.stateRevision,
      projectionRevision: (v) => v === version.projectionRevision,
    });
  }
  if (!decoded.ok) return decoded;
  if (formId === 'CHR-026' || formId === 'APP-009') {
    const missing = value['lastCompleteCheckpointId'] === null;
    const revision =
      value[formId === 'CHR-026' ? 'lastCompleteCheckpointRevision' : 'checkpointRevision'];
    const digest = value[formId === 'CHR-026' ? 'branchCacheHash' : 'branchCacheHashOrNull'];
    if (
      missing !== (revision === null) ||
      missing !== (value['resumeFormId'] === null) ||
      missing !== (digest === null) ||
      (value['restoreStatus'] === 'READY' && value['corruptTailIgnored'] !== false) ||
      (missing &&
        (value['restoreStatus'] !== 'CORRUPT' ||
          value['corruptTailIgnored'] !== false ||
          (value['randomReceiptIds'] as readonly string[]).length !== 0))
    )
      return refused(path, value);
  }
  if (formId === 'CHR-039') {
    const entries = value['branchCacheEntries'] as readonly JsonObject[];
    if (
      new Set(entries.map((e) => e['branchUuid'])).size !== entries.length ||
      (value['selectedBranchUuidOrNull'] !== null &&
        !entries.some((e) => e['branchUuid'] === value['selectedBranchUuidOrNull']))
    )
      return refused(path, value);
  }
  if (formId === 'CHR-040' || formId === 'APP-010') {
    const p = value['provenance'] as JsonObject;
    if (
      p['sourceUuid'] !== value['sourceEntityId'] ||
      p['metadataRevision'] !== value['localMetadataRevision']
    )
      return refused(`${path}.provenance`, p);
    if (
      formId === 'CHR-040' &&
      (p['sourceSnapshotId'] !== value['finalSaveReceiptId'] ||
        p['finalSaveReceiptId'] !== value['finalSaveReceiptId'] ||
        p['finalSnapshotVersion'] !== value['finalSnapshotVersion'])
    )
      return refused(`${path}.provenance`, p);
    if (
      formId === 'APP-010' &&
      (p['sourceSnapshotId'] !== value['sourceSnapshotId'] ||
        (role === 'player' && p['sourceSnapshotId'] !== p['finalSaveReceiptId']) ||
        (role === 'gm' && p['sourceSnapshotId'] !== `sha256:${p['sourceChecksum'] as string}`))
    )
      return refused(`${path}.provenance`, p);
  }
  return { ok: true, value: value as PostSaveProjection };
}

export function expectedPostSaveActions(
  formId: PostSaveFormId,
  p: PostSaveProjection,
  capabilities: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  const can = (variant: PostSavePayload['variant']) =>
    capabilities.includes(POST_SAVE_COMMAND_IDS[variant]);
  switch (formId) {
    case 'CHR-026':
      return [
        ...(p['resumeFormId'] !== null ? ['CHR-026::CTA::001' as const] : []),
        'CHR-026::CTA::002',
      ];
    case 'APP-009':
      return [
        ...(p['resumeFormId'] !== null && can('RESTORE') ? ['APP-009::CTA::003' as const] : []),
        'APP-009::CTA::002',
      ];
    case 'CHR-039':
      return [
        {
          'CHR-017': 'CHR-039::CTA::001',
          'CHR-019': 'CHR-039::CTA::002',
          'CHR-032': 'CHR-039::CTA::003',
          'CHR-025': 'CHR-039::CTA::004',
        }[p['returnFormId'] as 'CHR-017'] as ActionKey,
      ];
    case 'CHR-040':
      return [
        'CHR-040::CTA::001',
        'CHR-040::CTA::003',
        ...(can('METADATA_PATCH') ? ['CHR-040::CTA::004' as const] : []),
      ];
    case 'APP-010':
      if (p['ownerContext'] === 'GM_ARCHIVE_EXPORT')
        return can('EXPORT') ? ['APP-010::CTA::005'] : [];
      return [
        ...(p['ownerContext'] === 'PLAYER_LOCAL' && can('VARIANT_CREATE')
          ? ['APP-010::CTA::004' as const]
          : []),
        ...(can('EXPORT') ? ['APP-010::CTA::005' as const] : []),
        p['returnFormId'] === 'APP-004'
          ? 'APP-010::CTA::001'
          : p['returnFormId'] === 'CHR-040'
            ? 'APP-010::CTA::002'
            : 'APP-010::CTA::003',
      ];
  }
}

export function postSavePayload(
  formId: PostSaveFormId,
  p: PostSaveProjection,
  variant: PostSavePayload['variant'],
  values?: PostSaveMetadata,
): PostSavePayload {
  if (
    variant === 'RESTORE'
      ? formId !== 'APP-009'
      : variant === 'METADATA_PATCH'
        ? formId !== 'CHR-040'
        : formId !== 'APP-010'
  )
    throw new Error('post-save command source mismatch');
  if (variant === 'VARIANT_CREATE' && p['ownerContext'] !== 'PLAYER_LOCAL')
    throw new Error('variant requires player-local source');
  if (variant === 'METADATA_PATCH' && (values === undefined || !decodePostSaveMetadata(values).ok))
    throw new Error('metadata fields are invalid');
  return {
    postSaveScopeId: p.postSaveScopeId,
    sourceBindingHash: p.sourceBindingHash,
    sourceEntityId: p.sourceEntityId,
    stage: 'LOCAL_CHARACTER_POST_SAVE',
    sourceFormId: formId,
    variant,
    expectedMetadataRevisionOrNull:
      variant === 'RESTORE' ? null : (p['localMetadataRevision'] as number),
    ...(variant === 'METADATA_PATCH' ? { values } : {}),
  } as PostSavePayload;
}

export function decodePostSaveTerminal(
  message: HostToClientMessage,
  request: PostSaveRequest | PostSaveDraftRequest,
  source: JsonObject,
): DecodeResult<CommandReceipt<PostSaveCommandResult>> {
  if (message.messageType !== 'command.result' && message.messageType !== 'command.replay')
    return refused('$.messageType', message.messageType);
  const receipt = message.receipt,
    r = receipt.result,
    p = request.payload;
  const save = p.variant === 'SAVE_VALID_DRAFT';
  const sourceId = save ? p.characterDraftId : p.sourceEntityId;
  const result = decodeProjection(r, '$.receipt.result', {
    ...common,
    stage: (v) => v === 'LOCAL_CHARACTER_POST_SAVE',
    variant: (v) => v === p.variant,
    sourceFormId: (v) => v === p.sourceFormId,
    sourceRevisions: revisions,
    nextFormId: (v) =>
      save
        ? v === 'CHR-026'
        : p.variant === 'RESTORE'
          ? v === source['resumeFormId']
          : v === (p.variant === 'METADATA_PATCH' ? 'CHR-040' : 'APP-010'),
    targetEntityId: (v) => v === sourceId,
    targetRevisions: revisions,
    localMetadataRevision: nullableInteger,
    createdVariantUuidOrNull: p.variant === 'VARIANT_CREATE' ? isNonEmptyString : (v) => v === null,
    restoredCheckpointOrNull: (v) =>
      p.variant === 'RESTORE'
        ? object(v, {
            ownerId: (x) => x === sourceId,
            ownerDeviceId: isNonEmptyString,
            corruptTailIgnored: boolean,
            restoreStatus: (x) =>
              x === (isJsonObject(v) && v['corruptTailIgnored'] === true ? 'CORRUPT' : 'RESTORED'),
            checkpointId: (x) => x === source['lastCompleteCheckpointId'],
            checkpointRevision: (x) => x === source['checkpointRevision'],
            checkpointSha256: hash,
            resumeFormId: (x) => x === source['resumeFormId'],
            layerFormIds: (x) =>
              Array.isArray(x) &&
              (x.length === 0 ||
                (source['resumeFormId'] === 'CHR-023' && x.length === 1 && x[0] === 'CHR-031')),
          })
        : v === null,
    downloadOrNull: (v) =>
      p.variant === 'EXPORT'
        ? object(v, {
            fileName: (n) =>
              isNonEmptyString(n) && !/[\\/]/.test(n) && [...n].every((c) => c.charCodeAt(0) >= 32),
            mediaType: (m) => m === 'application/json',
            contentText: (s) => typeof s === 'string',
            bytesSha256: hash,
          })
        : v === null,
  });
  if (!result.ok) return result;
  const mutation = p.variant === 'METADATA_PATCH' || p.variant === 'VARIANT_CREATE';
  const expectedReceiptRevisions = {
    stateRevision: request.expectedRevisions.stateRevision + (mutation ? 1 : 0),
    projectionRevision: request.expectedRevisions.projectionRevision + (mutation ? 1 : 0),
    actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision,
  };
  if (
    !sameRevisions(receipt.revisions, expectedReceiptRevisions) ||
    (p.variant !== 'RESTORE' &&
      !sameRevisions(r['targetRevisions'] as unknown as RevisionVector, receipt.revisions))
  )
    return refused('$.receipt.revisions', receipt.revisions);
  if (
    receipt.commandId !== request.commandId ||
    (!save && r['postSaveScopeId'] !== p.postSaveScopeId) ||
    (!save && r['sourceBindingHash'] !== p.sourceBindingHash) ||
    r['sourceEntityId'] !== sourceId ||
    !sameRevisions(r['sourceRevisions'] as unknown as RevisionVector, request.expectedRevisions) ||
    (p.variant === 'METADATA_PATCH' &&
      r['localMetadataRevision'] !== p.expectedMetadataRevisionOrNull! + 1) ||
    (!save &&
      p.variant !== 'RESTORE' &&
      p.variant !== 'METADATA_PATCH' &&
      r['localMetadataRevision'] !== p.expectedMetadataRevisionOrNull) ||
    (p.variant === 'VARIANT_CREATE' && r['createdVariantUuidOrNull'] === sourceId) ||
    ((save || p.variant === 'RESTORE') && r['localMetadataRevision'] !== null)
  )
    return refused('$.receipt', receipt);
  return { ok: true, value: receipt as CommandReceipt<PostSaveCommandResult> };
}

export function postSaveDestinationMatches(
  snapshot: {
    readonly formId: string;
    readonly projection: JsonObject;
    readonly revisions: RevisionVector;
    readonly layers: readonly { readonly formId: string; readonly projection: JsonObject }[];
  },
  receipt: CommandReceipt<PostSaveCommandResult>,
): boolean {
  const r = receipt.result,
    p = snapshot.projection;
  if (snapshot.formId !== r.nextFormId || !sameRevisions(snapshot.revisions, r.targetRevisions))
    return false;
  if (r.variant === 'RESTORE')
    return (
      same(
        snapshot.layers.map((layer) => layer.formId),
        r.restoredCheckpointOrNull?.layerFormIds,
      ) &&
      p['characterDraftId'] === r.targetEntityId &&
      p['wizardCheckpointId'] === r.restoredCheckpointOrNull?.checkpointId &&
      snapshot.layers.every(
        (layer) =>
          layer.projection['characterDraftId'] === p['characterDraftId'] &&
          layer.projection['requestId'] === p['requestId'] &&
          layer.projection['draftRevision'] === p['draftRevision'],
      )
    );
  if (snapshot.layers.length !== 0) return false;
  if (r.variant === 'SAVE_VALID_DRAFT')
    return (
      p['sourceEntityId'] === r.targetEntityId &&
      p['postSaveScopeId'] === r.postSaveScopeId &&
      p['sourceBindingHash'] === r.sourceBindingHash
    );
  return (
    p['sourceEntityId'] === r.targetEntityId &&
    p['postSaveScopeId'] === r.postSaveScopeId &&
    p['sourceBindingHash'] === r.sourceBindingHash &&
    p['localMetadataRevision'] === r.localMetadataRevision
  );
}

export function postSaveReceiptUnchanged(a: CommandReceipt, b: CommandReceipt): boolean {
  return same(a, b);
}
