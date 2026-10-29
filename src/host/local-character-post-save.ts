import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { ActionKey, FormId } from '@generated/types/atlas.js';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import type { CommandReceipt, JsonObject, RevisionVector } from '@shared/wire-protocol.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import {
  POST_SAVE_COMMAND_IDS,
  type PostSaveCommon,
  type PostSaveMetadata,
  type PostSaveFormId,
  type PostSaveRequest,
  type PostSaveDraftRequest,
  type PostSaveCommandResult,
  type ExportSourceEnvelope,
} from '@shared/local-character-post-save.js';
import {
  assertLocalCharacterOwnedByDevice,
  createPostSaveHead,
  readPostSaveHeadById,
  readLocalMetadataHistory,
  readLocalCharacterWriteIntent,
  commitPostSaveCommand,
  updatePostSavePresentation,
  readLocalCharacter,
  loadDeviceId,
  readLocalCharacterOwner,
  readPostSaveCommandById,
  writePostSaveCursor,
  type VariantInitializationProof,
  type PostSaveScope,
  type PostSaveHead,
} from '../persistence/index.js';
import {
  loadCreationWizardCommandByCommandId,
  currentCreationWizardRevisions,
  creationWizardDurableIds,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { creationFinalizationHash } from './creation-finalization-contract.js';
import { canonicalizeIdentityDraftValues } from './identity-draft.js';
import { deriveCreationFinalizationView } from './creation-finalization.js';
import { deriveLocalCharacterCache } from './local-character-cache.js';
import {
  deriveLocalFinalExport,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import type { SymbiontCatalog } from '../domain/index.js';

export interface LocalPostSaveDependencies {
  readonly database: Database.Database;
  readonly symbiontCatalog: SymbiontCatalog;
  readonly baseline: LocalCharacterExportBaseline;
  readonly loadCheckpoint: (id: string) => DurableCreationWizardCheckpoint;
  readonly resumeForm: (checkpoint: DurableCreationWizardCheckpoint) => FormId;
}
export class LocalPostSaveError extends Error {
  constructor(message: string) {
    super(`local post-save: ${message}`);
  }
}
const fail = (message: string): never => {
  throw new LocalPostSaveError(message);
};
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value: unknown): string => {
  const bytes = Buffer.from(hash(value).slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 15) | 128;
  bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
export const POST_SAVE_FORMS: ReadonlySet<string> = new Set([
  'CHR-026',
  'CHR-039',
  'CHR-040',
  'APP-009',
  'APP-010',
]);
const CACHE_RETURNS: ReadonlySet<string> = new Set(['CHR-017', 'CHR-019', 'CHR-025', 'CHR-032']);
export const LOCAL_CHARACTER_RESUME_FORMS: ReadonlySet<string> = new Set([
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
]);
export function postSaveRevisions(head: PostSaveHead): RevisionVector {
  return {
    stateRevision: head.stateRevision,
    projectionRevision: head.projectionRevision,
    actorVisibilityRevision: head.actorVisibilityRevision,
  };
}
export function postSaveCommon(head: PostSaveHead): PostSaveCommon {
  return {
    postSaveScopeId: head.scope.scopeId,
    sourceBindingHash: hash(head.scope.sourceBinding),
    sourceEntityId: head.scope.entityId,
  };
}
const exact = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())
  )
    return fail('unrecognized command fields');
  return value as Record<string, unknown>;
};
export function normalizePostSaveRequest(value: unknown): PostSaveRequest | PostSaveDraftRequest {
  const r = exact(value, [
    'messageType',
    'protocolVersion',
    'commandKind',
    'workflowCommandId',
    'commandId',
    'expectedRevisions',
    'role',
    'payload',
  ]);
  if (
    r['messageType'] !== 'command.request' ||
    r['protocolVersion'] !== 1 ||
    r['commandKind'] !== 'workflow-command' ||
    r['role'] !== 'player'
  )
    return fail('unrecognized player command envelope');
  const raw = r['payload'] as Record<string, unknown> | null;
  const variant = raw?.['variant'];
  if (variant === 'SAVE_VALID_DRAFT') {
    const p = exact(raw, [
      'stage',
      'variant',
      'sourceFormId',
      'characterDraftId',
      'wizardCheckpointId',
      'draftRevision',
    ]);
    if (
      p['stage'] !== 'LOCAL_CHARACTER_POST_SAVE' ||
      p['sourceFormId'] !== 'CHR-025' ||
      r['workflowCommandId'] !== 'UI-CMD-CHAR-WIZARD-CHECKPOINT'
    )
      return fail('invalid draft save');
  } else {
    const p = exact(raw, [
      'stage',
      'variant',
      'sourceFormId',
      'postSaveScopeId',
      'sourceBindingHash',
      'sourceEntityId',
      'expectedMetadataRevisionOrNull',
      ...(variant === 'METADATA_PATCH' ? ['values'] : []),
    ]);
    if (
      p['stage'] !== 'LOCAL_CHARACTER_POST_SAVE' ||
      typeof variant !== 'string' ||
      !Object.hasOwn(POST_SAVE_COMMAND_IDS, variant) ||
      r['workflowCommandId'] !==
        POST_SAVE_COMMAND_IDS[variant as keyof typeof POST_SAVE_COMMAND_IDS] ||
      p['sourceFormId'] !==
        (variant === 'RESTORE' ? 'APP-009' : variant === 'METADATA_PATCH' ? 'CHR-040' : 'APP-010')
    )
      return fail('invalid post-save command');
    for (const key of ['postSaveScopeId', 'sourceBindingHash', 'sourceEntityId'])
      if (typeof p[key] !== 'string' || p[key].length === 0) return fail(`missing ${key}`);
    if (
      variant === 'RESTORE'
        ? p['expectedMetadataRevisionOrNull'] !== null
        : !Number.isSafeInteger(p['expectedMetadataRevisionOrNull']) ||
          Number(p['expectedMetadataRevisionOrNull']) < 0
    )
      return fail('invalid metadata revision');
    if (variant === 'METADATA_PATCH')
      exact(p['values'], ['name', 'description', 'artAssetKeyOrLocalFile']);
  }
  return value as PostSaveRequest | PostSaveDraftRequest;
}
function assertUncommitted(d: LocalPostSaveDependencies, commandId: string): void {
  if (
    loadCreationWizardCommandByCommandId(
      d.database,
      commandId,
      d.symbiontCatalog.skillStage,
      d.symbiontCatalog,
    ) !== null
  )
    fail('write intent already has a committed game receipt');
}
function inspect(d: LocalPostSaveDependencies, id: string) {
  const ownerId = loadDeviceId(d.database);
  assertLocalCharacterOwnedByDevice(d.database, id, ownerId);
  const row = readLocalCharacter(d.database, id);
  if (row.lifecycleState !== 'DRAFT' && row.lifecycleState !== 'FINAL')
    return fail('source is not a draft or final character');
  try {
    const checkpoint = d.loadCheckpoint(id);
    const resume = d.resumeForm(checkpoint);
    if (row.lifecycleState === 'DRAFT' && !LOCAL_CHARACTER_RESUME_FORMS.has(resume))
      return fail('resume form is not allowlisted');
    const intent =
      row.lifecycleState === 'DRAFT' ? readLocalCharacterWriteIntent(d.database, id) : null;
    if (intent !== null) {
      if (
        intent.ownerDeviceId !== ownerId ||
        intent.checkpointId !== checkpoint.checkpoint.checkpointId ||
        intent.baseCheckpointRevision !== checkpoint.checkpoint.checkpointRevision ||
        intent.baseSnapshotSha256 !== checkpoint.checkpoint.snapshotSha256
      )
        return fail('uncommitted intent does not belong to the complete checkpoint');
      assertUncommitted(d, intent.commandId);
    }
    return { ownerId, row, checkpoint, resume, intent };
  } catch (error: unknown) {
    if (row.lifecycleState === 'FINAL' || error instanceof LocalPostSaveError) throw error;
    return { ownerId, row, checkpoint: null, resume: null, intent: null };
  }
}
function bindingFor(
  d: LocalPostSaveDependencies,
  id: string,
  origin: FormId,
  returnForm: FormId,
  entryCorrelationId: string,
): { scope: PostSaveScope; form: PostSaveFormId } {
  if (
    origin !== returnForm ||
    (origin !== 'APP-004' && origin !== 'CHR-040' && !CACHE_RETURNS.has(origin))
  )
    return fail('invalid signed origin/return pair');
  if (typeof entryCorrelationId !== 'string' || entryCorrelationId.length === 0)
    return fail('entry correlation is missing');
  const source = inspect(d, id);
  const { checkpoint, ownerId, row } = source;
  if (
    row.lifecycleState === 'FINAL'
      ? origin !== 'APP-004' && origin !== 'CHR-040'
      : origin === 'CHR-040'
  )
    return fail('origin does not match the source lifecycle');
  let binding: JsonObject;
  let entityKind: PostSaveScope['entityKind'];
  let baseSnapshotSha256: string;
  if (checkpoint === null) {
    entityKind = 'DRAFT_DIAGNOSTIC';
    binding = {
      kind: entityKind,
      entryCorrelationId,
      ownerId,
      characterId: id,
      originFormId: origin,
      returnFormId: returnForm,
      payloadFingerprint: hash(row.payloadJson),
      revisions: {
        stateRevision: row.stateRevision,
        projectionRevision: row.projectionRevision,
        actorVisibilityRevision: row.actorVisibilityRevision,
      },
    };
    baseSnapshotSha256 = hash(binding);
  } else if (row.lifecycleState === 'FINAL') {
    const snapshot = checkpoint.finalizationStage?.finalMechanicsSnapshotOrNull;
    if (snapshot == null || checkpoint.receipt.result['variant'] !== 'FINAL_SAVE')
      return fail('final source lacks its final save proof');
    entityKind = 'LOCAL_FINAL';
    baseSnapshotSha256 = creationFinalizationHash(snapshot);
    binding = {
      kind: entityKind,
      entryCorrelationId,
      ownerId,
      characterId: id,
      snapshotId: checkpoint.receipt.receiptId,
      snapshotVersion: checkpoint.receipt.result.draftRevision,
      snapshotSha256: baseSnapshotSha256,
      checkpointSha256: checkpoint.checkpoint.snapshotSha256,
      originFormId: origin,
      returnFormId: returnForm,
      entryMetadataRevision: readLocalMetadataHistory(d.database, id).length,
    };
  } else {
    entityKind = 'CHARACTER_DRAFT';
    baseSnapshotSha256 = checkpoint.checkpoint.snapshotSha256;
    binding = {
      kind: entityKind,
      entryCorrelationId,
      ownerId,
      characterId: id,
      checkpointId: checkpoint.checkpoint.checkpointId,
      checkpointRevision: checkpoint.checkpoint.checkpointRevision,
      checkpointSha256: baseSnapshotSha256,
      resumeFormId: source.resume,
      originFormId: origin,
      returnFormId: returnForm,
      intentSha256OrNull: source.intent?.intentSha256 ?? null,
    };
  }
  return {
    form: row.lifecycleState === 'FINAL' ? 'CHR-040' : 'CHR-026',
    scope: {
      scopeId: uuid(['SYMBIOSIS_POST_SAVE_SCOPE_V1', binding]),
      entityKind,
      entityId: id,
      ownerContext: 'PLAYER_LOCAL',
      ownerDeviceId: ownerId,
      baseSnapshotSha256,
      sourceBinding: binding,
      baseRevisions: {
        stateRevision: row.stateRevision,
        projectionRevision: row.projectionRevision,
        actorVisibilityRevision: row.actorVisibilityRevision,
      },
    },
  };
}
export function validatePostSaveSource(
  d: LocalPostSaveDependencies,
  head: PostSaveHead,
): DurableCreationWizardCheckpoint | null {
  if (
    head.scope.ownerContext !== 'PLAYER_LOCAL' ||
    head.scope.ownerDeviceId !== loadDeviceId(d.database)
  )
    return fail('owner context differs');
  const b = head.scope.sourceBinding;
  const recreated = bindingFor(
    d,
    head.scope.entityId,
    b['originFormId'] as FormId,
    b['returnFormId'] as FormId,
    b['entryCorrelationId'] as string,
  ).scope;
  const expected = { ...head.scope.sourceBinding };
  const actual = { ...recreated.sourceBinding };
  // Metadata has an independent append-only head; it does not change the immutable base.
  if (head.scope.entityKind === 'LOCAL_FINAL') {
    const savedRevision = expected['entryMetadataRevision'];
    if (
      typeof savedRevision !== 'number' ||
      !Number.isSafeInteger(savedRevision) ||
      savedRevision < 0 ||
      savedRevision > Number(actual['entryMetadataRevision'])
    )
      return fail('invalid entry metadata revision');
    delete expected['entryMetadataRevision'];
    delete actual['entryMetadataRevision'];
  }
  if (
    head.scope.entityKind !== recreated.entityKind ||
    head.scope.baseSnapshotSha256 !== recreated.baseSnapshotSha256 ||
    !isDeepStrictEqual(head.scope.baseRevisions, recreated.baseRevisions) ||
    !isDeepStrictEqual(expected, actual)
  )
    return fail('signed source binding differs');
  return inspect(d, head.scope.entityId).checkpoint;
}
export function openPlayerPostSave(
  d: LocalPostSaveDependencies,
  id: string,
  origin: FormId = 'APP-004',
  returnForm: FormId = origin,
  entryCorrelationId = 'INITIAL_ENTRY',
): PostSaveHead {
  if (
    origin !== returnForm ||
    (origin !== 'APP-004' && origin !== 'CHR-040' && !CACHE_RETURNS.has(origin))
  )
    return fail('invalid signed origin/return pair');
  const { scope, form } = bindingFor(d, id, origin, returnForm, entryCorrelationId);
  if (origin !== 'APP-004' && origin !== 'CHR-040' && !CACHE_RETURNS.has(origin))
    return fail('invalid post-save origin');
  return createPostSaveHead(d.database, scope, { formId: form }, () => {
    assertLocalCharacterOwnedByDevice(d.database, id, scope.ownerDeviceId);
    const fresh = bindingFor(d, id, origin, returnForm, entryCorrelationId).scope;
    if (!isDeepStrictEqual(fresh, scope)) fail('source changed during entry');
  });
}
export function metadataForFinal(
  d: LocalPostSaveDependencies,
  checkpoint: DurableCreationWizardCheckpoint,
  pinnedRevision?: number,
): { values: PostSaveMetadata; revision: number } {
  const snapshot = checkpoint.finalizationStage?.finalMechanicsSnapshotOrNull;
  if (snapshot == null) return fail('missing final mechanics snapshot');
  const history = readLocalMetadataHistory(d.database, checkpoint.localCharacter.localCharacterId);
  const baseline: PostSaveMetadata = {
    name: snapshot.identity.name,
    description: snapshot.identity.description,
    artAssetKeyOrLocalFile: snapshot.identity.artAssetKeyOrLocalFile,
  };
  const sourceHash = creationFinalizationHash(snapshot);
  if (history.some((entry) => entry.finalSnapshotSha256 !== sourceHash))
    return fail('metadata source hash differs');
  if (history.length > 0 && history[0]!.previousValuesSha256 !== hash(baseline))
    return fail('metadata baseline link differs');
  const revision = pinnedRevision ?? history.length;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > history.length)
    return fail('unknown metadata version');
  return { values: revision === 0 ? baseline : history[revision - 1]!.values, revision };
}
export function projectLocalPostSave(
  d: LocalPostSaveDependencies,
  head: PostSaveHead,
  capabilities: ReadonlySet<string>,
  replayVersion = false,
): PresentedBaseForm {
  const checkpoint = validatePostSaveSource(d, head);
  const form = head.presentation['formId'];
  if (typeof form !== 'string' || !POST_SAVE_FORMS.has(form))
    return fail('unrecognized signed presentation');
  const common = postSaveCommon(head);
  let payload: JsonObject;
  let actions: readonly ActionKey[];
  if (form === 'CHR-026' || form === 'APP-009') {
    if (head.scope.entityKind !== 'CHARACTER_DRAFT' && head.scope.entityKind !== 'DRAFT_DIAGNOSTIC')
      return fail('recovery source is not a draft');
    const cache =
      checkpoint === null ? null : deriveLocalCharacterCache(checkpoint, head.scope.ownerDeviceId);
    const facts = {
      lastCompleteCheckpointId: checkpoint?.checkpoint.checkpointId ?? null,
      randomReceiptIds: checkpoint?.durablePayload.randomReceiptIds ?? [],
      resumeFormId: checkpoint === null ? null : d.resumeForm(checkpoint),
      corruptTailIgnored: false,
      restoreStatus: checkpoint === null ? 'CORRUPT' : 'READY',
      commandId: checkpoint?.receipt.commandId ?? null,
    };
    payload =
      form === 'CHR-026'
        ? {
            ...common,
            ...facts,
            characterDraftId: head.scope.entityId,
            lastCompleteCheckpointRevision: checkpoint?.checkpoint.checkpointRevision ?? null,
            branchCacheHash: cache?.hash ?? null,
            draftRevision: checkpoint?.receipt.result.draftRevision ?? null,
          }
        : {
            ...common,
            ...facts,
            checkpointOwnerId: head.scope.entityId,
            checkpointEntityKind: 'CHARACTER_DRAFT',
            checkpointRevision: checkpoint?.checkpoint.checkpointRevision ?? null,
            branchCacheHashOrNull: cache?.hash ?? null,
            restoreReceiptIdOrNull: null,
          };
    actions =
      form === 'CHR-026'
        ? [...(checkpoint === null ? [] : ['CHR-026::CTA::001' as const]), 'CHR-026::CTA::002']
        : [
            ...(checkpoint !== null && capabilities.has(POST_SAVE_COMMAND_IDS.RESTORE)
              ? ['APP-009::CTA::003' as const]
              : []),
            'APP-009::CTA::002',
          ];
  } else if (form === 'CHR-039') {
    const returnFormId = head.scope.sourceBinding['returnFormId'];
    if (checkpoint === null || typeof returnFormId !== 'string' || !CACHE_RETURNS.has(returnFormId))
      return fail('cache lacks its signed return');
    const cache = deriveLocalCharacterCache(checkpoint, head.scope.ownerDeviceId);
    payload = {
      ...common,
      characterDraftId: head.scope.entityId,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      branchCacheEntries: cache.entries,
      selectedBranchUuidOrNull: cache.selectedBranchUuidOrNull,
      branchCacheHash: cache.hash,
      cacheIntegrityStatus: 'VALID',
      originFormId: head.scope.sourceBinding['originFormId']!,
      returnFormId,
      draftRevision: checkpoint.receipt.result.draftRevision,
    };
    const returnActions: Readonly<Record<string, ActionKey>> = {
      'CHR-017': 'CHR-039::CTA::001',
      'CHR-019': 'CHR-039::CTA::002',
      'CHR-032': 'CHR-039::CTA::003',
      'CHR-025': 'CHR-039::CTA::004',
    };
    const returnAction = returnActions[returnFormId];
    if (returnAction === undefined) return fail('unknown cache return action');
    actions = [returnAction];
  } else {
    if (checkpoint === null || head.scope.entityKind !== 'LOCAL_FINAL')
      return fail('final view requires a verified local final');
    const metadata = metadataForFinal(
      d,
      checkpoint,
      replayVersion ? head.metadataRevision : undefined,
    );
    if (metadata.revision !== head.metadataRevision) return fail('metadata scope is stale');
    const originFormId = head.scope.sourceBinding['originFormId'];
    const returnFormId = head.scope.sourceBinding['returnFormId'];
    if ((originFormId !== 'CHR-040' && originFormId !== 'APP-004') || returnFormId !== originFormId)
      return fail('invalid final origin/return binding');
    const envelope: ExportSourceEnvelope = {
      ownerContext: 'PLAYER_LOCAL' as const,
      sourceKind: 'LOCAL_FINAL' as const,
      originFormId,
      returnFormId,
      activeLocalOwnerIdOrNull: head.scope.ownerDeviceId,
      masterAuthorityRevisionOrNull: null,
    };
    const exported = deriveLocalFinalExport(
      checkpoint,
      metadata.values,
      metadata.revision,
      envelope,
      d.baseline,
    );
    payload =
      form === 'CHR-040'
        ? {
            ...common,
            ...metadata.values,
            localCharacterUuid: head.scope.entityId,
            finalSnapshotVersion: exported.finalSnapshotVersion,
            finalSaveReceiptId: exported.finalSaveReceiptId,
            mechanicsSnapshot: exported.mechanicsSnapshot,
            creationRandomReceipts: exported.creationRandomReceipts,
            localMetadataRevision: metadata.revision,
            candidateSnapshotIds: [],
            campaignCopyIds: [],
            checksum: exported.checksum,
            provenance: exported.provenance,
            commandId: checkpoint.receipt.commandId,
          }
        : {
            ...common,
            ...envelope,
            sourceSnapshotId: exported.sourceSnapshotId,
            sourceUuid: head.scope.entityId,
            schemaVersion: 1,
            baselineVersion: d.baseline.baselineVersion,
            checksum: exported.checksum,
            provenance: exported.provenance,
            localMetadataRevision: metadata.revision,
            metadata: metadata.values,
            stateRevision: head.stateRevision,
            projectionRevision: head.projectionRevision,
          };
    actions =
      form === 'CHR-040'
        ? [
            'CHR-040::CTA::001',
            'CHR-040::CTA::003',
            ...(capabilities.has(POST_SAVE_COMMAND_IDS.METADATA_PATCH)
              ? ['CHR-040::CTA::004' as const]
              : []),
          ]
        : [
            ...(capabilities.has(POST_SAVE_COMMAND_IDS.VARIANT_CREATE)
              ? ['APP-010::CTA::004' as const]
              : []),
            ...(capabilities.has(POST_SAVE_COMMAND_IDS.EXPORT)
              ? ['APP-010::CTA::005' as const]
              : []),
            envelope.returnFormId === 'CHR-040' ? 'APP-010::CTA::002' : 'APP-010::CTA::001',
          ];
  }
  return {
    formId: form as PostSaveFormId,
    formType: 'screen',
    routeTemplate: form.startsWith('CHR-')
      ? `/player/characters/:localCharacterId/create/${form.toLowerCase()}`
      : `/local/${form.toLowerCase()}`,
    routeBindings: form.startsWith('CHR-')
      ? [{ parameterIndex: 0, source: 'inherited', value: head.scope.entityId }]
      : [],
    availableActionKeys: actions,
    roleFilteredPayload: payload,
  };
}
/** A delivery view is derived from a real immutable receipt, never written back over a newer head. */
export function postSaveReceiptView(
  head: PostSaveHead,
  receipt: CommandReceipt<PostSaveCommandResult>,
): PostSaveHead {
  if (
    head.scope.entityKind !== 'LOCAL_FINAL' ||
    receipt.result.postSaveScopeId !== head.scope.scopeId ||
    receipt.result.sourceBindingHash !== postSaveCommon(head).sourceBindingHash ||
    receipt.result.targetEntityId !== head.scope.entityId ||
    receipt.result.localMetadataRevision === null ||
    !['CHR-040', 'APP-010'].includes(receipt.result.nextFormId) ||
    !isDeepStrictEqual(receipt.revisions, receipt.result.targetRevisions)
  )
    return fail('receipt does not identify a final delivery view');
  return {
    ...head,
    ...receipt.revisions,
    metadataRevision: receipt.result.localMetadataRevision,
    presentation: { formId: receipt.result.nextFormId },
  };
}
export function navigateLocalPostSave(
  d: LocalPostSaveDependencies,
  head: PostSaveHead,
  formId: PostSaveFormId,
): PostSaveHead {
  return updatePostSavePresentation(
    d.database,
    head.scope,
    postSaveRevisions(head),
    { formId },
    () => {
      validatePostSaveSource(d, head);
    },
  );
}
export function loadPlayerPostSave(d: LocalPostSaveDependencies, scopeId: string): PostSaveHead {
  return (
    readPostSaveHeadById(d.database, scopeId, loadDeviceId(d.database)) ??
    fail('unknown post-save scope')
  );
}
export function readProvisionalVariant(
  d: LocalPostSaveDependencies,
  id: string,
  checkpointId: string,
): { metadata: PostSaveMetadata; proof: VariantInitializationProof } {
  const ownerId = loadDeviceId(d.database);
  assertLocalCharacterOwnedByDevice(d.database, id, ownerId);
  const row = readLocalCharacter(d.database, id);
  const owner = readLocalCharacterOwner(d.database, id);
  if (
    row.lifecycleState !== 'VARIANT' ||
    owner?.variantBirthCommandId == null ||
    row.stateRevision !== 0 ||
    row.projectionRevision !== 0 ||
    row.actorVisibilityRevision !== 0
  )
    return fail('not an untouched variant');
  const marker = exact(JSON.parse(row.payloadJson) as unknown, [
    'kind',
    'schemaVersion',
    'metadata',
    'birthCommandId',
    'birthReceiptId',
  ]);
  const birth = readPostSaveCommandById(d.database, owner.variantBirthCommandId, ownerId);
  if (birth === null) return fail('variant birth journal is missing');
  const payloadHash = createHash('sha256').update(row.payloadJson).digest('hex');
  if (
    marker['kind'] !== 'LOCAL_VARIANT_PRE_IDENTITY' ||
    marker['schemaVersion'] !== 1 ||
    marker['birthCommandId'] !== owner.variantBirthCommandId ||
    birth?.command.receiptId !== marker['birthReceiptId'] ||
    birth.head.scope.entityKind !== 'LOCAL_FINAL' ||
    birth.command.commandKind !== POST_SAVE_COMMAND_IDS.VARIANT_CREATE ||
    !isDeepStrictEqual(birth.command.effects['variant'], {
      characterId: id,
      provisionalPayloadSha256: payloadHash,
    })
  )
    return fail('variant birth proof differs');
  const metadata = exact(marker['metadata'], [
    'name',
    'description',
    'artAssetKeyOrLocalFile',
  ]) as PostSaveMetadata;
  const checked = canonicalizeIdentityDraftValues(
    { ...metadata, age: null, sex: null, massKg: null },
    new Set(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS),
  );
  if (
    !checked.ok ||
    checked.value.name === null ||
    !isDeepStrictEqual(metadata, {
      name: checked.value.name,
      description: checked.value.description,
      artAssetKeyOrLocalFile: checked.value.artAssetKeyOrLocalFile,
    })
  )
    return fail('variant metadata differs');
  return {
    metadata,
    proof: {
      characterId: id,
      checkpointId,
      expectedOwnerDeviceId: ownerId,
      variantBirthCommandId: owner.variantBirthCommandId,
      variantBirthReceiptId: birth.command.receiptId,
      expectedProvisionalPayloadSha256: payloadHash,
    },
  };
}
function validateRestoredBase(
  d: LocalPostSaveDependencies,
  head: PostSaveHead,
  receipt: JsonObject,
): void {
  const result = receipt['result'] as PostSaveCommandResult;
  const checkpoint = d.loadCheckpoint(head.scope.entityId);
  const proof = result.restoredCheckpointOrNull;
  if (
    head.scope.entityKind !== 'CHARACTER_DRAFT' ||
    head.scope.ownerDeviceId !== loadDeviceId(d.database) ||
    checkpoint.localCharacter.lifecycleState !== 'DRAFT' ||
    result.stage !== 'LOCAL_CHARACTER_POST_SAVE' ||
    result.variant !== 'RESTORE' ||
    result.postSaveScopeId !== head.scope.scopeId ||
    result.sourceBindingHash !== postSaveCommon(head).sourceBindingHash ||
    result.targetEntityId !== head.scope.entityId ||
    proof === null ||
    proof.ownerId !== head.scope.entityId ||
    proof.ownerDeviceId !== head.scope.ownerDeviceId ||
    proof.restoreStatus !== (proof.corruptTailIgnored ? 'CORRUPT' : 'RESTORED') ||
    proof.checkpointId !== checkpoint.checkpoint.checkpointId ||
    proof.checkpointRevision !== checkpoint.checkpoint.checkpointRevision ||
    proof.checkpointSha256 !== checkpoint.checkpoint.snapshotSha256 ||
    proof.resumeFormId !== d.resumeForm(checkpoint) ||
    result.nextFormId !== proof.resumeFormId ||
    !isDeepStrictEqual(
      proof.layerFormIds,
      checkpoint.symbiontPresentationStage?.formId === 'CHR-031' ? ['CHR-031'] : [],
    ) ||
    !isDeepStrictEqual(result.targetRevisions, currentCreationWizardRevisions(checkpoint))
  )
    return fail('committed restore no longer matches its exact base');
}
export function commitLocalPostSave(
  d: LocalPostSaveDependencies,
  input: PostSaveRequest | PostSaveDraftRequest,
  receiptId: string,
  allocateVariantId: () => string,
) {
  const request = normalizePostSaveRequest(input);
  const p = request.payload;
  const prior = readPostSaveCommandById(d.database, request.commandId, loadDeviceId(d.database));
  if (prior !== null && !isDeepStrictEqual(prior.command.request, request))
    return fail('command ID reused with a different request');
  if (prior === null && p.variant === 'SAVE_VALID_DRAFT') {
    const checkpoint = d.loadCheckpoint(p.characterDraftId);
    const view = deriveCreationFinalizationView(checkpoint, { catalog: d.symbiontCatalog });
    if (
      checkpoint.localCharacter.lifecycleState !== 'DRAFT' ||
      d.resumeForm(checkpoint) !== 'CHR-025' ||
      p.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
      p.draftRevision !== checkpoint.receipt.result.draftRevision ||
      view.validationBlockers.length > 0 ||
      !isDeepStrictEqual(request.expectedRevisions, currentCreationWizardRevisions(checkpoint))
    )
      return fail('draft save proof differs');
  }
  const head =
    prior?.head ??
    (p.variant === 'SAVE_VALID_DRAFT'
      ? openPlayerPostSave(d, p.characterDraftId, 'CHR-025', 'CHR-025', request.commandId)
      : loadPlayerPostSave(d, p.postSaveScopeId));
  const common = postSaveCommon(head);
  if (
    p.variant !== 'SAVE_VALID_DRAFT' &&
    (p.sourceEntityId !== common.sourceEntityId || p.sourceBindingHash !== common.sourceBindingHash)
  )
    return fail('source binding differs');
  const command = request.workflowCommandId;
  return commitPostSaveCommand(
    d.database,
    {
      scope: head.scope,
      expectedRevisions: request.expectedRevisions,
      commandId: request.commandId,
      receiptId,
      commandKind: command,
      request: request as unknown as JsonObject,
      impact: {
        stateChanged: p.variant === 'METADATA_PATCH' || p.variant === 'VARIANT_CREATE',
        projectionChanged: p.variant === 'METADATA_PATCH' || p.variant === 'VARIANT_CREATE',
        actorVisibilityChanged: false,
      },
    },
    () => {
      if (prior !== null && p.variant === 'RESTORE')
        validateRestoredBase(d, head, prior.command.receipt);
      else validatePostSaveSource(d, head);
    },
    (writer, next) => {
      const checkpoint = validatePostSaveSource(d, head);
      if (checkpoint === null) return fail('corrupt source cannot execute a command');
      const occupied = creationWizardDurableIds(checkpoint);
      if (
        occupied.has(request.commandId) ||
        occupied.has(receiptId) ||
        request.commandId === receiptId
      )
        return fail('command ID belongs to the creation history');
      let nextFormId: FormId;
      let target = postSaveRevisions(next);
      let restored: PostSaveCommandResult['restoredCheckpointOrNull'] = null;
      let download: PostSaveCommandResult['downloadOrNull'] = null;
      let created: string | null = null;
      let resultingMetadataRevision =
        head.scope.entityKind === 'LOCAL_FINAL' ? head.metadataRevision : null;
      if (p.variant === 'RESTORE') {
        if (
          head.presentation['formId'] !== 'APP-009' ||
          head.scope.entityKind !== 'CHARACTER_DRAFT'
        )
          return fail('restore is unavailable');
        const intent = readLocalCharacterWriteIntent(d.database, head.scope.entityId);
        if (intent !== null)
          writer.discardIntent(intent, (id) => {
            assertUncommitted(d, id);
          });
        nextFormId = d.resumeForm(checkpoint);
        target = currentCreationWizardRevisions(checkpoint);
        const ignoredCorruptTail = intent !== null && intent.payloadIntegrity === 'CORRUPT';
        restored = {
          ownerId: head.scope.entityId,
          ownerDeviceId: head.scope.ownerDeviceId,
          restoreStatus: ignoredCorruptTail ? 'CORRUPT' : 'RESTORED',
          corruptTailIgnored: ignoredCorruptTail,
          layerFormIds:
            checkpoint.symbiontPresentationStage?.formId === 'CHR-031' ? ['CHR-031'] : [],
          checkpointId: checkpoint.checkpoint.checkpointId,
          checkpointRevision: checkpoint.checkpoint.checkpointRevision,
          checkpointSha256: checkpoint.checkpoint.snapshotSha256,
          resumeFormId: nextFormId,
        };
        writePostSaveCursor(d.database, head.scope, request.commandId);
      } else if (p.variant === 'SAVE_VALID_DRAFT') {
        const view = deriveCreationFinalizationView(checkpoint, { catalog: d.symbiontCatalog });
        if (
          checkpoint.localCharacter.lifecycleState !== 'DRAFT' ||
          p.sourceFormId !== 'CHR-025' ||
          d.resumeForm(checkpoint) !== 'CHR-025' ||
          p.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
          p.draftRevision !== checkpoint.receipt.result.draftRevision ||
          view.validationBlockers.length > 0
        )
          return fail('draft is not valid for saving');
        nextFormId = 'CHR-026';
      } else {
        if (
          head.scope.entityKind !== 'LOCAL_FINAL' ||
          head.presentation['formId'] !== p.sourceFormId
        )
          return fail('final source presentation differs');
        const metadata = metadataForFinal(d, checkpoint);
        if (
          metadata.revision !== head.metadataRevision ||
          p.expectedMetadataRevisionOrNull !== metadata.revision
        )
          return fail('metadata revision is stale');
        if (p.variant === 'METADATA_PATCH') {
          const identity = checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!.identity;
          const canonical = canonicalizeIdentityDraftValues(
            { ...identity, ...p.values },
            new Set(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS),
          );
          if (!canonical.ok || canonical.value.name === null) return fail('metadata is invalid');
          const values = {
            name: canonical.value.name,
            description: canonical.value.description,
            artAssetKeyOrLocalFile: canonical.value.artAssetKeyOrLocalFile,
          };
          if (!isDeepStrictEqual(values, p.values) || isDeepStrictEqual(values, metadata.values))
            return fail('metadata is not a canonical change');
          const baseline = {
            name: identity.name,
            description: identity.description,
            artAssetKeyOrLocalFile: identity.artAssetKeyOrLocalFile,
          };
          resultingMetadataRevision = writer.appendMetadata(values, baseline).revision;
          nextFormId = 'CHR-040';
        } else if (p.variant === 'VARIANT_CREATE') {
          created = allocateVariantId();
          if (occupied.has(created)) return fail('variant UUID belongs to the creation history');
          writer.createVariant(created, metadata.values);
          nextFormId = 'APP-010';
        } else {
          const binding = head.scope.sourceBinding;
          const envelope = {
            ownerContext: 'PLAYER_LOCAL' as const,
            sourceKind: 'LOCAL_FINAL' as const,
            originFormId: binding['originFormId'] as 'APP-004' | 'CHR-040',
            returnFormId: binding['returnFormId'] as 'APP-004' | 'CHR-040',
            activeLocalOwnerIdOrNull: head.scope.ownerDeviceId,
            masterAuthorityRevisionOrNull: null,
          };
          const exported = deriveLocalFinalExport(
            checkpoint,
            metadata.values,
            metadata.revision,
            envelope,
            d.baseline,
          );
          download = {
            fileName: `character-${head.scope.entityId}.json`,
            mediaType: 'application/json',
            contentText: exported.contentText,
            bytesSha256: exported.bytesSha256,
          };
          nextFormId = 'APP-010';
        }
      }
      const receipt: CommandReceipt<PostSaveCommandResult> = {
        commandId: request.commandId,
        receiptId,
        revisions: postSaveRevisions(next),
        result: {
          ...common,
          stage: 'LOCAL_CHARACTER_POST_SAVE',
          variant: p.variant,
          sourceFormId: p.sourceFormId,
          sourceRevisions: { ...request.expectedRevisions },
          nextFormId,
          targetEntityId: head.scope.entityId,
          targetRevisions: { ...target },
          localMetadataRevision: resultingMetadataRevision,
          createdVariantUuidOrNull: created,
          restoredCheckpointOrNull: restored,
          downloadOrNull: download,
        },
      };
      return receipt as unknown as JsonObject;
    },
  );
}
