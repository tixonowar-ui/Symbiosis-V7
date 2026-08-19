import type {
  IdentityDraftRefusal,
  IdentityDraftRefusalV3Message,
  IdentityDraftReplaceV3Message,
  IdentityDraftResultV3Message,
  IdentityDraftScope,
  IdentityDraftValues,
  RevisionVector,
} from '@shared/index.js';
import { WIRE_PROTOCOL_V3_VERSION } from '@shared/index.js';
export interface IdentityDraftSnapshot {
  readonly draftRevision: number;
  readonly revisions: RevisionVector;
  readonly scope: IdentityDraftScope;
  readonly values: IdentityDraftValues;
}
export interface IdentityDraftClientState {
  readonly dirty: boolean;
  readonly lastRefusal: IdentityDraftRefusal | null;
  readonly outstanding: IdentityDraftReplaceV3Message | null;
  readonly widgetValues: IdentityDraftValues;
}
const copy = <T>(value: T): T => structuredClone(value);
const sameScope = (a: IdentityDraftScope, b: IdentityDraftScope, context = true): boolean =>
  a.characterDraftId === b.characterDraftId &&
  a.wizardCheckpointId === b.wizardCheckpointId &&
  (!context || a.contextId === b.contextId);
const revisionsAtLeast = (actual: RevisionVector, confirmed: RevisionVector): boolean =>
  actual.stateRevision >= confirmed.stateRevision &&
  actual.projectionRevision >= confirmed.projectionRevision &&
  actual.actorVisibilityRevision >= confirmed.actorVisibilityRevision;
type ArtValue = IdentityDraftValues['artAssetKeyOrLocalFile'];
const sameArt = (left: ArtValue, right: ArtValue): boolean => {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind === 'asset-key'
    ? left.assetKey === (right as typeof left).assetKey
    : left.mediaType === (right as typeof left).mediaType &&
        left.bytesBase64 === (right as typeof left).bytesBase64;
};
const sameValues = (left: IdentityDraftValues, right: IdentityDraftValues): boolean =>
  left.name === right.name &&
  left.description === right.description &&
  sameArt(left.artAssetKeyOrLocalFile, right.artAssetKeyOrLocalFile) &&
  left.age === right.age &&
  left.massKg === right.massKg &&
  left.sex === right.sex;
export class IdentityDraftClient {
  readonly #allocateUpdateId: () => string;
  #confirmed: IdentityDraftSnapshot;
  #dirty = false;
  #lastRefusal: IdentityDraftRefusal | null = null;
  #outstanding: IdentityDraftReplaceV3Message | null = null;
  #widgetValues: IdentityDraftValues;
  constructor(snapshot: IdentityDraftSnapshot, allocateUpdateId: () => string) {
    this.#confirmed = copy(snapshot);
    this.#widgetValues = copy(snapshot.values);
    this.#allocateUpdateId = allocateUpdateId;
  }
  get state(): IdentityDraftClientState {
    return copy({
      dirty: this.#dirty,
      lastRefusal: this.#lastRefusal,
      outstanding: this.#outstanding,
      widgetValues: this.#widgetValues,
    });
  }
  edit(values: IdentityDraftValues): IdentityDraftReplaceV3Message | null {
    this.#widgetValues = copy(values);
    this.#lastRefusal = null;
    const coalesced = this.#outstanding !== null;
    this.#dirty = coalesced || !sameValues(this.#widgetValues, this.#confirmed.values);
    return !coalesced && this.#dirty ? this.#issue() : null;
  }
  receiveResult(
    message: IdentityDraftResultV3Message,
    canonicalValues: IdentityDraftValues,
  ): IdentityDraftReplaceV3Message | null {
    const outstanding = this.#outstanding;
    if (outstanding === null || message.draftUpdateId !== outstanding.draftUpdateId) return null;
    this.#outstanding = null;
    const applicable =
      sameScope(message.scope, this.#confirmed.scope) &&
      message.draftRevision >= this.#confirmed.draftRevision &&
      revisionsAtLeast(message.revisions, this.#confirmed.revisions);
    if (!applicable) return null;
    const sentValues = outstanding.values;
    this.#confirmed = {
      scope: this.#confirmed.scope,
      draftRevision: message.draftRevision,
      revisions: copy(message.revisions),
      values: copy(canonicalValues),
    };
    this.#lastRefusal = null;
    if (!sameValues(this.#widgetValues, sentValues)) return this.#issue();
    this.#widgetValues = copy(canonicalValues);
    this.#dirty = false;
    return null;
  }
  receiveRefusal(message: IdentityDraftRefusalV3Message): IdentityDraftReplaceV3Message | null {
    const outstanding = this.#outstanding;
    if (outstanding === null || message.draftUpdateId !== outstanding.draftUpdateId) return null;
    this.#outstanding = null;
    const applicable =
      sameScope(message.scope, this.#confirmed.scope) &&
      revisionsAtLeast(message.revisions, this.#confirmed.revisions);
    if (!applicable) return null;
    this.#lastRefusal = copy(message.refusal);
    this.#dirty = true;
    return message.refusal.code === 'INVALID_FIELD' &&
      !sameValues(this.#widgetValues, outstanding.values)
      ? this.#issue()
      : null;
  }
  resumeAfterSnapshot(snapshot: IdentityDraftSnapshot): IdentityDraftReplaceV3Message | null {
    if (this.#outstanding !== null && sameScope(snapshot.scope, this.#confirmed.scope, false)) {
      this.#confirmed = copy(snapshot);
      return copy(this.#outstanding);
    }
    this.#confirmed = copy(snapshot);
    this.#widgetValues = copy(snapshot.values);
    this.#outstanding = null;
    this.#lastRefusal = null;
    this.#dirty = false;
    return null;
  }
  #issue(): IdentityDraftReplaceV3Message {
    const draftUpdateId = this.#allocateUpdateId();
    if (draftUpdateId.length === 0) throw new Error('draft update ID must be non-empty');
    const request: IdentityDraftReplaceV3Message = {
      protocolVersion: WIRE_PROTOCOL_V3_VERSION,
      messageType: 'character.identity-draft.replace',
      draftUpdateId,
      scope: copy(this.#confirmed.scope),
      expectedDraftRevision: this.#confirmed.draftRevision,
      expectedRevisions: copy(this.#confirmed.revisions),
      values: copy(this.#widgetValues),
    };
    this.#outstanding = copy(request);
    return request;
  }
}
