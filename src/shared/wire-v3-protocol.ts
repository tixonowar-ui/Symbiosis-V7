import type { RevisionVector } from './wire-protocol.js';
import type {
  PresentedBaseForm,
  PresentedLayerForm,
  WireV2Vocabulary,
} from './wire-v2-protocol.js';

export const WIRE_PROTOCOL_V3_VERSION = 3 as const;

interface WireV3Envelope<T extends string> {
  readonly messageType: T;
  readonly protocolVersion: typeof WIRE_PROTOCOL_V3_VERSION;
}

export interface IdentityDraftScope {
  readonly sourceFormId: 'CHR-001';
  readonly contextId: string;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
}

export type IdentityDraftArtValue =
  | null
  | { readonly kind: 'asset-key'; readonly assetKey: string }
  | {
      readonly kind: 'local-file';
      readonly mediaType: 'image/jpeg' | 'image/png';
      readonly bytesBase64: string;
    };

export type IdentityDraftSex = 'FEMALE' | 'MALE';

export interface IdentityDraftValues {
  readonly name: string | null;
  readonly description: string | null;
  readonly artAssetKeyOrLocalFile: IdentityDraftArtValue;
  readonly age: number | null;
  readonly sex: IdentityDraftSex | null;
  readonly massKg: number | null;
}

export interface IdentityDraftReplaceV3Message extends WireV3Envelope<'character.identity-draft.replace'> {
  readonly draftUpdateId: string;
  readonly scope: IdentityDraftScope;
  readonly expectedDraftRevision: number;
  readonly expectedRevisions: RevisionVector;
  readonly values: IdentityDraftValues;
}

export interface IdentityDraftPresentation {
  readonly base: PresentedBaseForm;
  readonly layers: readonly PresentedLayerForm[];
}

export interface IdentityDraftResultV3Message extends WireV3Envelope<'character.identity-draft.result'> {
  readonly draftUpdateId: string;
  readonly scope: IdentityDraftScope;
  readonly draftRevision: number;
  readonly revisions: RevisionVector;
  readonly projectionRole: 'player';
  readonly presentation: IdentityDraftPresentation;
}

export type IdentityDraftFieldError =
  | {
      readonly field: 'name';
      readonly reason:
        | 'BLANK_AFTER_TRIM'
        | 'CONTROL_CHARACTER'
        | 'NO_VISIBLE_GRAPHEME'
        | 'TOO_LONG'
        | 'UNPAIRED_SURROGATE';
    }
  | { readonly field: 'description'; readonly reason: 'EMPTY_NOT_NULL' | 'TOO_LONG' }
  | {
      readonly field: 'artAssetKeyOrLocalFile';
      readonly reason:
        | 'ASSET_NOT_FOUND'
        | 'EMPTY_ASSET_KEY'
        | 'FILE_TOO_LARGE'
        | 'MEDIA_SIGNATURE_MISMATCH'
        | 'NON_CANONICAL_BASE64';
    }
  | { readonly field: 'massKg'; readonly reason: 'NOT_POSITIVE' | 'STEP_MISMATCH' };

export type IdentityDraftRefusal =
  | { readonly code: 'INVALID_FIELD'; readonly error: IdentityDraftFieldError }
  | { readonly code: 'STALE_DRAFT'; readonly expected: number; readonly actual: number }
  | {
      readonly code: 'STALE_REVISION';
      readonly expected: RevisionVector;
      readonly actual: RevisionVector;
    }
  | { readonly code: 'IDEMPOTENCY_CONFLICT'; readonly detail: 'PAYLOAD_MISMATCH' }
  | { readonly code: 'DRAFT_UNAVAILABLE' }
  | {
      readonly code: 'REVISION_OVERFLOW';
      readonly axis: 'draftRevision' | 'projectionRevision';
    };

export interface IdentityDraftRefusalV3Message extends WireV3Envelope<'character.identity-draft.refusal'> {
  readonly draftUpdateId: string;
  readonly scope: IdentityDraftScope;
  readonly revisions: RevisionVector;
  readonly presentationUnchanged: true;
  readonly refusal: IdentityDraftRefusal;
}

export type ClientToHostV3Message = IdentityDraftReplaceV3Message;
export type HostToClientV3Message = IdentityDraftRefusalV3Message | IdentityDraftResultV3Message;

/** V3 identity presentations use the same generated Atlas vocabulary as V2 snapshots. */
export type WireV3Vocabulary = WireV2Vocabulary;
