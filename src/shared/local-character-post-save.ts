import type { FormId } from '@generated/types/atlas.js';
import type { JsonObject, RevisionVector, WorkflowCommandRequestMessage } from './wire-protocol.js';
import type { IdentityDraftArtValue } from './wire-v3-protocol.js';

export type PostSaveFormId = 'CHR-026' | 'CHR-039' | 'CHR-040' | 'APP-009' | 'APP-010';
export interface PostSaveMetadata extends JsonObject {
  readonly name: string;
  readonly description: string | null;
  readonly artAssetKeyOrLocalFile: IdentityDraftArtValue;
}
export interface PostSaveCommon extends JsonObject {
  readonly postSaveScopeId: string;
  readonly sourceBindingHash: string;
  readonly sourceEntityId: string;
}
export interface PostSaveCacheEntry extends JsonObject {
  readonly branchUuid: string;
  readonly branchKind: 'RACE' | 'CLASS' | 'SYMBIONT';
  readonly payloadHash: string;
  readonly randomReceiptIds: readonly string[];
  readonly savedAtRevision: number;
}
export interface SavedDraftProjection extends PostSaveCommon {
  readonly characterDraftId: string;
  readonly lastCompleteCheckpointId: string | null;
  readonly lastCompleteCheckpointRevision: number | null;
  readonly resumeFormId: FormId | null;
  readonly branchCacheHash: string | null;
  readonly randomReceiptIds: readonly string[];
  readonly corruptTailIgnored: boolean;
  readonly restoreStatus: 'READY' | 'RESTORED' | 'CORRUPT';
  readonly draftRevision: number | null;
  readonly commandId: string | null;
}
export interface RestoreProjection extends PostSaveCommon {
  readonly checkpointOwnerId: string;
  readonly checkpointEntityKind: 'CHARACTER_DRAFT';
  readonly lastCompleteCheckpointId: string | null;
  readonly checkpointRevision: number | null;
  readonly branchCacheHashOrNull: string | null;
  readonly randomReceiptIds: readonly string[];
  readonly resumeFormId: FormId | null;
  readonly restoreReceiptIdOrNull: string | null;
  readonly corruptTailIgnored: boolean;
  readonly restoreStatus: 'READY' | 'RESTORED' | 'CORRUPT';
  readonly commandId: string | null;
}
export interface BranchCacheProjection extends PostSaveCommon {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly branchCacheEntries: readonly PostSaveCacheEntry[];
  readonly selectedBranchUuidOrNull: string | null;
  readonly cacheIntegrityStatus: 'VALID' | 'CORRUPT';
  readonly originFormId: 'CHR-017' | 'CHR-019' | 'CHR-025' | 'CHR-032';
  readonly returnFormId: BranchCacheProjection['originFormId'];
  readonly draftRevision: number;
  readonly branchCacheHash: string;
}
export interface FinalCharacterProjection extends PostSaveCommon, PostSaveMetadata {
  readonly localCharacterUuid: string;
  readonly finalSnapshotVersion: number;
  readonly finalSaveReceiptId: string;
  readonly mechanicsSnapshot: JsonObject;
  readonly creationRandomReceipts: readonly JsonObject[];
  readonly localMetadataRevision: number;
  readonly candidateSnapshotIds: readonly string[];
  readonly campaignCopyIds: readonly string[];
  readonly checksum: string;
  readonly provenance: JsonObject;
  readonly commandId: string;
}
export type ExportSourceEnvelope =
  | {
      readonly ownerContext: 'PLAYER_LOCAL';
      readonly sourceKind: 'LOCAL_FINAL';
      readonly originFormId: 'APP-004' | 'CHR-040';
      readonly returnFormId: 'APP-004' | 'CHR-040';
      readonly activeLocalOwnerIdOrNull: string;
      readonly masterAuthorityRevisionOrNull: null;
    }
  | {
      readonly ownerContext: 'GM_ARCHIVE_EXPORT';
      readonly sourceKind: 'COMPLETED_CAMPAIGN_COPY';
      readonly originFormId: 'CMP-012';
      readonly returnFormId: 'CMP-012';
      readonly activeLocalOwnerIdOrNull: null;
      readonly masterAuthorityRevisionOrNull: number;
    };
export type CharacterExportProjection = PostSaveCommon &
  JsonObject &
  ExportSourceEnvelope & {
    readonly sourceSnapshotId: string;
    readonly sourceUuid: string;
    readonly schemaVersion: 1;
    readonly baselineVersion: string;
    readonly checksum: string;
    readonly provenance: JsonObject;
    readonly localMetadataRevision: number;
    readonly metadata: PostSaveMetadata;
    readonly stateRevision: number;
    readonly projectionRevision: number;
  };
export type PostSaveProjection =
  | SavedDraftProjection
  | RestoreProjection
  | BranchCacheProjection
  | FinalCharacterProjection
  | CharacterExportProjection;

interface CommandBase extends PostSaveCommon {
  readonly stage: 'LOCAL_CHARACTER_POST_SAVE';
  readonly sourceFormId: PostSaveFormId;
  readonly expectedMetadataRevisionOrNull: number | null;
}
export type PostSavePayload = CommandBase &
  (
    | { readonly variant: 'RESTORE'; readonly sourceFormId: 'APP-009' }
    | {
        readonly variant: 'METADATA_PATCH';
        readonly sourceFormId: 'CHR-040';
        readonly values: PostSaveMetadata;
      }
    | { readonly variant: 'VARIANT_CREATE'; readonly sourceFormId: 'APP-010' }
    | { readonly variant: 'EXPORT'; readonly sourceFormId: 'APP-010' }
  );
export const POST_SAVE_COMMAND_IDS = {
  RESTORE: 'UI-CMD-LOCAL-CHECKPOINT-RESTORE',
  METADATA_PATCH: 'UI-CMD-CHAR-LOCAL-METADATA-PATCH',
  VARIANT_CREATE: 'UI-CMD-CHAR-VARIANT-CREATE',
  EXPORT: 'UI-CMD-CHAR-EXPORT',
} as const;
export type PostSaveRequest = WorkflowCommandRequestMessage<
  (typeof POST_SAVE_COMMAND_IDS)[keyof typeof POST_SAVE_COMMAND_IDS],
  PostSavePayload
>;
export interface PostSaveDraftPayload extends JsonObject {
  readonly stage: 'LOCAL_CHARACTER_POST_SAVE';
  readonly variant: 'SAVE_VALID_DRAFT';
  readonly sourceFormId: 'CHR-025';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}
export type PostSaveDraftRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  PostSaveDraftPayload
>;
export interface PostSaveCommandResult extends JsonObject, PostSaveCommon {
  readonly stage: 'LOCAL_CHARACTER_POST_SAVE';
  readonly variant: PostSavePayload['variant'] | 'SAVE_VALID_DRAFT';
  readonly sourceFormId: PostSaveFormId | 'CHR-025';
  readonly sourceRevisions: RevisionVector & JsonObject;
  readonly nextFormId: FormId;
  readonly targetEntityId: string;
  readonly targetRevisions: RevisionVector & JsonObject;
  readonly localMetadataRevision: number | null;
  readonly createdVariantUuidOrNull: string | null;
  readonly restoredCheckpointOrNull:
    | null
    | (JsonObject & {
        readonly ownerId: string;
        readonly ownerDeviceId: string;
        readonly restoreStatus: 'RESTORED' | 'CORRUPT';
        readonly corruptTailIgnored: boolean;
        readonly layerFormIds: readonly FormId[];
        readonly checkpointId: string;
        readonly checkpointRevision: number;
        readonly checkpointSha256: string;
        readonly resumeFormId: FormId;
      });
  readonly downloadOrNull:
    | null
    | (JsonObject & {
        readonly fileName: string;
        readonly mediaType: 'application/json';
        readonly contentText: string;
        readonly bytesSha256: string;
      });
}
