import { NPC_CONTROL_FORM_IDS, NPC_CONTROL_ACTION_KEYS } from '@shared/npc-presentation.js';
import {
  npcTechnicalRequestValue,
  npcTechnicalResponseValue,
  npcWorkflowCommandRequestValue,
} from '@shared/npc-command.js';
import type {
  NpcTechnicalRequest,
  NpcTechnicalResponse,
  NpcTechnicalRefusal,
  NpcWorkflowCommandRequest,
} from '@shared/npc-command.js';
import type { RevisionVector, CommandReceipt } from '@shared/wire-protocol.js';
import type { ActionKey } from '@generated/types/atlas.js';
import type { NpcEditorStages } from '@shared/npc-editor-presentation.js';
import type { DecodeResult } from '@shared/wire-protocol.js';
import type {
  NpcArtPresentation as NpcArtReference,
  NpcArtReadTarget,
  NpcArtReadRequest,
  NpcGmProjection,
  NpcProjectionScope,
} from '@shared/npc-presentation.js';
import {
  npcGmProjectionValue,
  NpcProjectionDecodeError,
  npcArtReadMessageValue,
  npcArtReadBindingKey,
  npcArtReadRequestForProjection,
  npcArtResultBytes,
} from '@shared/npc-presentation-codec.js';
import type {
  NpcArtPresentation,
  NpcControlState,
  NpcIdentityPresentation,
  NpcSchemaPresentation,
  NpcStatPresentation,
  NpcLibraryPresentation,
  NpcSheetPresentation,
  NpcHistoryPresentation,
  NpcSymbiontsPresentation,
  NpcSkillsPresentation,
  NpcInventoryPresentation,
  NpcInitialStatePresentation,
  NpcFinalReviewPresentation,
} from './npc-presentation.js';

export function decodeNpcProjection(
  formId: string,
  value: unknown,
  expected: NpcProjectionScope,
): DecodeResult<NpcGmProjection> {
  try {
    return { ok: true, value: npcGmProjectionValue(formId, value, expected) };
  } catch (error) {
    return {
      ok: false,
      refusal: {
        code: 'INVALID_SHAPE',
        path: error instanceof NpcProjectionDecodeError ? error.path : '$.npc',
        actualType: 'redacted',
        expected: 'closed current NPC GM projection',
      },
    };
  }
}
export type NpcInputBufferState = Readonly<{
  canApply: boolean;
  canDiscard: boolean;
  conflict: boolean;
}>;
export type NpcControlPresentation = (
  | Readonly<{ formId: 'NPC-001'; presentation: NpcLibraryPresentation }>
  | Readonly<{ formId: 'NPC-002'; presentation: NpcIdentityPresentation }>
  | Readonly<{ formId: 'NPC-003'; presentation: NpcSheetPresentation }>
  | Readonly<{ formId: 'NPC-007'; presentation: NpcHistoryPresentation }>
  | Readonly<{ formId: 'NPC-011'; presentation: NpcSchemaPresentation }>
  | Readonly<{ formId: 'NPC-012'; presentation: NpcStatPresentation }>
  | Readonly<{ formId: 'NPC-013'; presentation: NpcSymbiontsPresentation }>
  | Readonly<{ formId: 'NPC-014'; presentation: NpcSkillsPresentation }>
  | Readonly<{ formId: 'NPC-015'; presentation: NpcInventoryPresentation }>
  | Readonly<{ formId: 'NPC-016'; presentation: NpcInitialStatePresentation }>
  | Readonly<{ formId: 'NPC-017'; presentation: NpcFinalReviewPresentation }>
) &
  Readonly<{
    editBuffer?: NpcInputBufferState;
  }>;

/** Caller obtains projection through decodeNpcProjection; local state never enters a wire DTO. */
export function npcControlPresentation(
  p: NpcGmProjection,
  local: NpcControlState,
  artSession?: NpcArtSession,
): NpcControlPresentation {
  const art = (
    target: NpcArtReadTarget,
    value: NpcArtReference | null,
  ): NpcArtPresentation | null => {
    if (value === null) return null;
    if (!artSession) return { ...value, status: 'LOADING' };
    return artSession.presentation(p, target, value);
  };
  const attemptArt = (value: NpcArtReference | null) => {
    const a = p.attemptOrNull;
    if (!a) return value === null ? null : { ...value, status: 'UNAVAILABLE' as const };
    return art(
      { kind: 'ATTEMPT', npcDraftId: a.npcDraftId, expectedAttemptRevision: a.attemptRevision },
      value,
    );
  };
  const state = Object.freeze({
    readOnly: local.readOnly,
    pending: local.pending,
    dirty: local.dirty,
    refusalOrNull: local.refusalOrNull,
    ...(local.localEditDirty ? { localEditDirty: true } : {}),
  });
  switch (p.formId) {
    case 'NPC-001':
      return {
        formId: p.formId,
        presentation: {
          ...p.content,
          rows: p.content.rows.map((r) => ({
            ...r,
            artOrNull: art(
              { kind: 'VERSION', npcUuid: r.npcUuid, version: r.currentVersion },
              r.artOrNull,
            ),
          })),
          state,
        },
      };
    case 'NPC-002':
      return {
        formId: p.formId,
        presentation: {
          ...p.content,
          artOrNull: attemptArt(p.content.artOrNull),
          state,
          bindingKey: [
            p.contextId,
            p.campaignId,
            p.attemptOrNull?.npcDraftId,
            p.attemptOrNull?.attemptRevision,
            p.projectionRevision,
          ].join(':'),
        },
      };
    case 'NPC-003':
      return {
        formId: p.formId,
        presentation: {
          ...p.content,
          artOrNull: art(
            { kind: 'VERSION', npcUuid: p.content.npcUuid, version: p.content.displayedVersion },
            p.content.artOrNull,
          ),
        },
      };
    case 'NPC-007': {
      const preview = p.content.previewOrNull;
      return {
        formId: p.formId,
        presentation: {
          ...p.content,
          previewOrNull:
            preview === null
              ? null
              : {
                  ...preview,
                  artOrNull: art(
                    {
                      kind: 'VERSION',
                      npcUuid: preview.npcUuid,
                      version: preview.displayedVersion,
                    },
                    preview.artOrNull,
                  ),
                },
          state,
        },
      };
    }
    case 'NPC-011':
      return { formId: p.formId, presentation: { ...p.content, state } };
    case 'NPC-012':
      return { formId: p.formId, presentation: { ...p.content, state } };
    case 'NPC-013':
      return {
        formId: p.formId,
        presentation: {
          ...p.content,
          state,
          bindingKey: [
            p.contextId,
            p.campaignId,
            p.attemptOrNull?.npcDraftId,
            p.attemptOrNull?.attemptRevision,
            p.stateRevision,
            p.projectionRevision,
            p.actorVisibilityRevision,
          ].join(':'),
        },
      };
    case 'NPC-014':
      return { formId: p.formId, presentation: { ...p.content, state } };
    case 'NPC-015':
      return { formId: p.formId, presentation: { ...p.content, state } };
    case 'NPC-016':
      return { formId: p.formId, presentation: { ...p.content, state } };
    case 'NPC-017': {
      const preview = p.content.previewOrNull;
      return {
        formId: p.formId,
        presentation: {
          ...p.content,
          previewOrNull:
            preview === null ? null : { ...preview, artOrNull: attemptArt(preview.artOrNull) },
          state,
        },
      };
    }
  }
}

/** Invalid local request/session use; ordinary loading/refusal is represented in portrait status. */
export class NpcArtSessionError extends Error {
  constructor() {
    super('Invalid NPC portrait request/session binding');
    this.name = new.target.name;
  }
}
const artSlot = (target: NpcArtReadTarget, art: NpcArtReference) =>
  JSON.stringify([
    target.kind,
    target.kind === 'ATTEMPT' ? target.npcDraftId : target.npcUuid,
    target.kind === 'ATTEMPT' ? target.expectedAttemptRevision : target.version,
    art.assetKey,
    art.checksum,
  ]);
/** One existing GM panel owns this local resource; clear on disconnect/role loss and dispose on unmount. */
export class NpcArtSession {
  #current: NpcGmProjection | null = null;
  #currentKey = '';
  #pending = new Map<string, NpcArtReadRequest>();
  #used = new Set<string>();
  #loaded = new Map<string, Extract<NpcArtPresentation, { status: 'READY' }>>();
  #unavailable = new Set<string>();
  #disposed = false;
  setProjection(projection: NpcGmProjection | null): void {
    if (this.#disposed) throw new NpcArtSessionError();
    // Input is the detached result of decodeNpcProjection. No caller-supplied URL is accepted.
    const key = projection === null ? '' : JSON.stringify(projection);
    if (key === this.#currentKey) return;
    for (const art of this.#loaded.values()) URL.revokeObjectURL(art.url);
    this.#loaded.clear();
    this.#unavailable.clear();
    this.#pending.clear();
    this.#current = projection;
    this.#currentKey = key;
  }
  needs(p: NpcGmProjection, target: NpcArtReadTarget, art: NpcArtReference): boolean {
    return (
      this.presentation(p, target, art).status === 'LOADING' &&
      ![...this.#pending.values()].some((r) => artSlot(r.target, r) === artSlot(target, art))
    );
  }
  begin(requestId: string, target: NpcArtReadTarget, art: NpcArtReference): NpcArtReadRequest {
    const p = this.#current;
    if (this.#disposed || p === null || this.#used.has(requestId)) throw new NpcArtSessionError();
    const request = npcArtReadRequestForProjection(
      {
        messageType: 'network.npc-art.read',
        protocolVersion: 3,
        requestId,
        contextId: p.contextId,
        campaignId: p.campaignId,
        sourceFormId: p.formId,
        expectedRevisions: {
          stateRevision: p.stateRevision,
          projectionRevision: p.projectionRevision,
          actorVisibilityRevision: p.actorVisibilityRevision,
        },
        target,
        assetKey: art.assetKey,
        checksum: art.checksum,
      },
      p,
    );
    this.#unavailable.delete(artSlot(request.target, request));
    this.#used.add(requestId);
    this.#pending.set(requestId, request);
    return request;
  }
  accept(value: unknown): 'LOADED' | 'REFUSED' | 'UNAVAILABLE' | 'IGNORED' {
    const response = npcArtReadMessageValue(value);
    const request = this.#pending.get(response.requestId),
      p = this.#current;
    if (this.#disposed || p === null || request === undefined) return 'IGNORED';
    if (
      response.messageType === 'network.npc-art.read' ||
      npcArtReadBindingKey(request) !== npcArtReadBindingKey(response)
    )
      throw new NpcProjectionDecodeError('$.art.response');
    npcArtReadRequestForProjection(request, p);
    this.#pending.delete(response.requestId);
    if (response.messageType === 'network.npc-art.refusal') {
      this.#markUnavailable(request);
      return 'REFUSED';
    }
    const bytes = npcArtResultBytes(response);
    // The authenticated host computes the checksum. This browser checks canonical bytes/signature
    // and the echoed checksum against the pending/current projection; it does not compute SHA.
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([bytes], { type: response.mediaType }));
    } catch {
      this.#markUnavailable(request);
      return 'UNAVAILABLE';
    }
    const slot = artSlot(request.target, request),
      old = this.#loaded.get(slot);
    if (old) URL.revokeObjectURL(old.url);
    if (!url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
      throw new NpcArtSessionError();
    }
    this.#unavailable.delete(slot);
    this.#loaded.set(
      slot,
      Object.freeze({
        status: 'READY',
        assetKey: request.assetKey,
        checksum: request.checksum,
        url: url as `blob:${string}`,
      }),
    );
    return 'LOADED';
  }
  presentation(
    p: NpcGmProjection,
    target: NpcArtReadTarget,
    art: NpcArtReference,
  ): NpcArtPresentation {
    if (this.#disposed || this.#current === null || JSON.stringify(p) !== this.#currentKey)
      return { ...art, status: 'UNAVAILABLE' };
    const slot = artSlot(target, art),
      result = this.#loaded.get(slot);
    return result ?? { ...art, status: this.#unavailable.has(slot) ? 'UNAVAILABLE' : 'LOADING' };
  }
  #markUnavailable(request: NpcArtReadRequest): void {
    const slot = artSlot(request.target, request),
      old = this.#loaded.get(slot);
    if (old) {
      URL.revokeObjectURL(old.url);
      this.#loaded.delete(slot);
    }
    this.#unavailable.add(slot);
  }
  /** Local transport failure/timeout: no server error text and no synthetic absent portrait. */
  fail(requestId: string): boolean {
    const request = this.#pending.get(requestId);
    if (this.#disposed || request === undefined) return false;
    this.#pending.delete(requestId);
    this.#markUnavailable(request);
    return true;
  }
  dispose(): void {
    if (this.#disposed) return;
    this.setProjection(null);
    this.#used.clear();
    this.#disposed = true;
  }
}

export const isNpcControlForm = (formId: string): formId is NpcGmProjection['formId'] =>
  (NPC_CONTROL_FORM_IDS as readonly string[]).includes(formId);

export type NpcStageEdit = {
  [F in keyof NpcEditorStages]: Readonly<{ formId: F; values: NpcEditorStages[F] }>;
}[keyof NpcEditorStages];

/** A local request buffer, never an authority/cache for domain validation. */
export class NpcBrowserSession {
  readonly art = new NpcArtSession();
  #projection: NpcGmProjection | null = null;
  #pending: {
    readonly request: NpcTechnicalRequest;
    readonly source: NpcGmProjection;
    result: Exclude<NpcTechnicalResponse, NpcTechnicalRefusal> | null;
  } | null = null;
  #refusal: string | null = null;
  #busyKey: string | null = null;
  #connected = false;
  #local: { readonly source: NpcGmProjection; edit: NpcStageEdit; conflict: boolean } | null = null;
  /** Socket OPEN is not readiness: only a checked projection adoption restores it. */
  get connected(): boolean {
    return this.#connected;
  }
  get dirty(): boolean {
    return this.#local !== null;
  }
  get pending(): boolean {
    return this.#pending !== null;
  }
  get busy(): boolean {
    return this.#busyKey !== null;
  }
  get request(): NpcTechnicalRequest | null {
    return this.#pending?.request ?? null;
  }
  get projection(): NpcGmProjection | null {
    return this.#projection;
  }
  get bindingKey(): string | null {
    const p = this.#projection;
    return p?.formId === 'NPC-002'
      ? [
          p.contextId,
          p.campaignId,
          p.attemptOrNull?.npcDraftId,
          p.attemptOrNull?.attemptRevision,
          p.projectionRevision,
        ].join(':')
      : null;
  }
  setBusy(key: string, busy: boolean): void {
    if (key !== this.bindingKey) return;
    this.#busyKey = busy ? key : null;
  }
  suspend(): void {
    this.#connected = false;
    this.#busyKey = null;
    this.art.setProjection(null);
  }
  dispose(): void {
    this.#local = null;
    this.#pending = null;
    this.#projection = null;
    this.#busyKey = null;
    this.#connected = false;
    this.art.dispose();
  }
  adopt(
    p: NpcGmProjection | null,
    currentAuthority?: Readonly<{ contextId: string; campaignId: string }> | null,
  ): void {
    const owner = this.#pending?.source ?? this.#local?.source;
    if (
      owner !== undefined &&
      currentAuthority !== undefined &&
      (currentAuthority === null ||
        currentAuthority.contextId !== owner.contextId ||
        currentAuthority.campaignId !== owner.campaignId)
    ) {
      if (this.#pending !== null) throw new NpcArtSessionError();
      // An authenticated principal/campaign change revokes even private dirty metadata.
      // A same-owner move to another form retains the explicit conflict/discard path below.
      this.#local = null;
      this.#refusal = null;
    }
    if (
      this.#pending !== null &&
      p !== null &&
      (p.contextId !== this.#pending.source.contextId ||
        p.campaignId !== this.#pending.source.campaignId)
    )
      throw new NpcArtSessionError();
    const oldKey = this.bindingKey;
    if (this.#local !== null && (p === null || !sameNpcData(p, this.#local.source)))
      this.#local.conflict = true;
    this.#projection = p;
    this.#connected = true;
    if (oldKey !== this.bindingKey) this.#busyKey = null;
    if (p === null && this.#pending === null) this.#refusal = null;
    this.art.setProjection(p);
  }
  inputBuffer(externalPending = false): NpcInputBufferState | null {
    const local = this.#local;
    return local === null
      ? null
      : {
          canApply:
            this.#connected && !this.pending && !this.busy && !externalPending && !local.conflict,
          canDiscard: !this.pending,
          conflict: local.conflict,
        };
  }
  controls(externalPending = false): NpcControlPresentation | null {
    const p = this.#projection;
    if (p === null) return null;
    const local = this.#local;
    // A different principal/campaign must never render either side of a retained private edit.
    if (
      local !== null &&
      (p.contextId !== local.source.contextId || p.campaignId !== local.source.campaignId)
    )
      return null;
    const controls: NpcControlPresentation = {
      ...npcControlPresentation(
        p,
        {
          readOnly: !this.#connected || local?.conflict === true,
          pending: this.pending || externalPending,
          dirty: this.dirty || this.pending || this.busy,
          localEditDirty: this.dirty,
          refusalOrNull: this.#refusal,
        },
        this.art,
      ),
      ...(local === null ? {} : { editBuffer: this.inputBuffer(externalPending)! }),
    };
    if (local !== null && sameNpcData(p, local.source))
      return {
        ...controls,
        presentation: { ...controls.presentation, input: local.edit.values },
      } as NpcControlPresentation;
    const pending = this.#pending,
      request = pending?.request;
    // An edit is displayed only on its original checked attempt. A newer host view is not rebased.
    if (
      request?.messageType === 'network.npc-editor.replace' &&
      p.formId === request.sourceFormId &&
      p.attemptOrNull?.npcDraftId === request.npcDraftId &&
      p.attemptOrNull.attemptRevision === request.expectedAttemptRevision
    ) {
      // Portrait authority remains the checked host projection, not the local edit buffer.
      return {
        ...controls,
        presentation: { ...controls.presentation, input: request.values },
      } as NpcControlPresentation;
    }
    return controls;
  }
  assertReconnectScope(revisions: RevisionVector, contextId: unknown, campaignId: unknown): void {
    const pending = this.#pending;
    if (
      pending === null ||
      contextId !== pending.source.contextId ||
      campaignId !== pending.source.campaignId ||
      !npcVectorAtLeast(
        revisions,
        pending.result?.appliedRevisions ?? pending.request.expectedRevisions,
      )
    )
      throw new NpcArtSessionError();
  }
  begin(value: unknown): NpcTechnicalRequest {
    return this.#begin(value, false);
  }
  /** Typing changes only this tab's detached draft; it allocates no command identity. */
  stage(edit: NpcStageEdit): void {
    const p = this.#projection;
    if (
      !this.#connected ||
      p === null ||
      this.pending ||
      this.busy ||
      this.#local?.conflict === true ||
      p.formId !== edit.formId ||
      p.attemptOrNull === null ||
      !('input' in p.content)
    )
      throw new NpcArtSessionError();
    const detached = structuredClone(edit);
    if (this.#local === null) this.#local = { source: p, edit: detached, conflict: false };
    else this.#local.edit = detached;
    this.#refusal = null;
  }
  apply(operationId: string): NpcTechnicalRequest {
    const local = this.#local,
      p = this.#projection,
      a = local?.source.attemptOrNull;
    if (
      local === null ||
      p === null ||
      a == null ||
      local.conflict ||
      !sameNpcData(p, local.source)
    )
      throw new NpcArtSessionError();
    return this.#begin(
      {
        messageType: 'network.npc-editor.replace',
        protocolVersion: 3,
        operationId,
        campaignId: p.campaignId,
        sourceFormId: local.edit.formId,
        expectedRevisions: {
          stateRevision: p.stateRevision,
          projectionRevision: p.projectionRevision,
          actorVisibilityRevision: p.actorVisibilityRevision,
        },
        npcDraftId: a.npcDraftId,
        expectedAttemptRevision: a.attemptRevision,
        values: local.edit.values,
      },
      true,
    );
  }
  discard(): void {
    // A sent command may already be durable. Discard never cancels or claims its outcome.
    if (this.pending) throw new NpcArtSessionError();
    this.#local = null;
    this.#refusal = null;
  }
  #begin(value: unknown, fromLocal: boolean): NpcTechnicalRequest {
    const p = this.#projection;
    if (!this.#connected || p === null || this.pending || this.busy || (this.dirty && !fromLocal))
      throw new NpcArtSessionError();
    const request = npcTechnicalRequestValue(value);
    if (
      request.campaignId !== p.campaignId ||
      request.sourceFormId !== p.formId ||
      !sameNpcVector(request.expectedRevisions, p)
    )
      throw new NpcArtSessionError();
    if (request.messageType === 'network.npc-selection.replace') {
      if (request.sourceFormId === 'NPC-001') {
        if (
          p.formId !== 'NPC-001' ||
          (request.npcUuidOrNull !== null &&
            !p.content.rows.some((r) => r.npcUuid === request.npcUuidOrNull))
        )
          throw new NpcArtSessionError();
      } else if (
        p.formId !== 'NPC-007' ||
        request.npcUuid !== p.content.npcUuid ||
        !p.content.entries.some((e) => e.version === request.version)
      )
        throw new NpcArtSessionError();
    } else if (
      p.attemptOrNull === null ||
      request.npcDraftId !== p.attemptOrNull.npcDraftId ||
      request.expectedAttemptRevision !== p.attemptOrNull.attemptRevision
    )
      throw new NpcArtSessionError();
    this.#pending = { request, source: p, result: null };
    this.#refusal = null;
    return request;
  }
  accept(value: unknown): 'RESULT' | 'REFUSAL' {
    const message = npcTechnicalResponseValue(value),
      pending = this.#pending;
    if (pending === null) throw new NpcArtSessionError();
    const r = pending.request;
    const editor = r.messageType !== 'network.npc-selection.replace';
    if (
      message.operationId !== r.operationId ||
      message.campaignId !== r.campaignId ||
      message.sourceFormId !== r.sourceFormId ||
      message.messageType.startsWith('network.npc-editor.') !== editor ||
      (editor &&
        (!('npcDraftId' in message) || !('npcDraftId' in r) || message.npcDraftId !== r.npcDraftId))
    )
      throw new NpcArtSessionError();
    if ('refusal' in message) {
      if (pending.result !== null) throw new NpcArtSessionError();
      this.#pending = null;
      this.#refusal = `Изменение НПС отклонено: ${message.refusal.code}.`;
      return 'REFUSAL';
    }
    const selectionUnchanged =
      r.messageType === 'network.npc-selection.replace' &&
      (r.sourceFormId === 'NPC-001'
        ? pending.source.formId === 'NPC-001' &&
          pending.source.content.selectedNpcUuidOrNull === r.npcUuidOrNull
        : pending.source.formId === 'NPC-007' &&
          pending.source.content.selectedVersionOrNull === r.version);
    const increment = selectionUnchanged ? 0 : 1;
    if (
      message.appliedRevisions.stateRevision !== r.expectedRevisions.stateRevision + increment ||
      message.appliedRevisions.projectionRevision !==
        r.expectedRevisions.projectionRevision + increment ||
      message.appliedRevisions.actorVisibilityRevision !==
        r.expectedRevisions.actorVisibilityRevision ||
      (message.messageType === 'network.npc-editor.result' &&
        'expectedAttemptRevision' in r &&
        message.appliedAttemptRevision !== r.expectedAttemptRevision + 1) ||
      (message.messageType === 'network.npc-selection.result' &&
        r.messageType === 'network.npc-selection.replace' &&
        (r.sourceFormId === 'NPC-001'
          ? message.sourceFormId !== 'NPC-001' || message.npcUuidOrNull !== r.npcUuidOrNull
          : message.sourceFormId !== 'NPC-007' ||
            message.npcUuid !== r.npcUuid ||
            message.version !== r.version)) ||
      (pending.result !== null && !sameNpcData(pending.result, message))
    )
      throw new NpcArtSessionError();
    pending.result = message;
    return 'RESULT';
  }
  /** The immutable ACK never becomes a current projection. Its independently decoded successor may be newer. */
  confirm(
    p: NpcGmProjection | null,
    revisions: RevisionVector,
    contextId: unknown,
    campaignId: unknown,
    correlation: string,
  ): void {
    const pending = this.#pending;
    if (
      pending === null ||
      pending.result === null ||
      correlation !== pending.request.operationId ||
      contextId !== pending.source.contextId ||
      campaignId !== pending.source.campaignId ||
      !npcVectorAtLeast(revisions, pending.result.appliedRevisions)
    )
      throw new NpcArtSessionError();
    const r = pending.request,
      result = pending.result;
    if (sameNpcVector(revisions, result.appliedRevisions)) {
      if (p === null || p.formId !== r.sourceFormId) throw new NpcArtSessionError();
      if (result.messageType === 'network.npc-editor.result') {
        if (
          p.attemptOrNull?.npcDraftId !== result.npcDraftId ||
          p.attemptOrNull.attemptRevision !== result.appliedAttemptRevision
        )
          throw new NpcArtSessionError();
        if (
          r.messageType === 'network.npc-editor.replace' &&
          (!('input' in p.content) || !sameNpcData(p.content.input, r.values))
        )
          throw new NpcArtSessionError();
      } else if (
        result.sourceFormId === 'NPC-001'
          ? p.formId !== 'NPC-001' || p.content.selectedNpcUuidOrNull !== result.npcUuidOrNull
          : p.formId !== 'NPC-007' ||
            p.content.npcUuid !== result.npcUuid ||
            p.content.selectedVersionOrNull !== result.version
      )
        throw new NpcArtSessionError();
    }
    if (
      this.#local !== null &&
      r.messageType === 'network.npc-editor.replace' &&
      sameNpcData(this.#local.source, pending.source) &&
      sameNpcData(this.#local.edit.values, r.values)
    )
      this.#local = null;
    this.#pending = null;
    this.#refusal = null;
  }
}
/** Both operands have passed the closed wire reader; object field order is not a value change. */
function sameNpcData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const left: readonly unknown[] = a,
      right: readonly unknown[] = b;
    return left.length === right.length && left.every((v, i) => sameNpcData(v, right[i]));
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Readonly<Record<string, unknown>>,
    right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((k) => Object.hasOwn(right, k) && sameNpcData(left[k], right[k]))
  );
}
const NPC_REVISION_AXES = [
  'stateRevision',
  'projectionRevision',
  'actorVisibilityRevision',
] as const;
export const sameNpcVector = (a: RevisionVector, b: RevisionVector): boolean =>
  NPC_REVISION_AXES.every((key) => a[key] === b[key]);
export const npcVectorAtLeast = (a: RevisionVector, b: RevisionVector): boolean =>
  NPC_REVISION_AXES.every((key) => a[key] >= b[key]);

export function npcAvailableActions(
  p: NpcGmProjection,
  supported: readonly string[],
): readonly ActionKey[] {
  switch (p.formId) {
    case 'NPC-001':
      return [
        ...(p.attemptOrNull === null ? ['NPC-001::CTA::001' as const] : []),
        ...(p.content.selectedNpcUuidOrNull === null ? [] : ['NPC-001::CTA::002' as const]),
        'NPC-001::CTA::003',
      ];
    case 'NPC-003':
      return [
        ...(p.attemptOrNull === null && supported.includes('UI-CMD-NPC-NEW-VERSION')
          ? ['NPC-003::CTA::008' as const]
          : []),
        'NPC-003::CTA::009',
        'NPC-003::CTA::010',
      ];
    case 'NPC-007':
      return [
        'NPC-007::CTA::001',
        ...(p.attemptOrNull === null && supported.includes('UI-CMD-NPC-NEW-VERSION')
          ? ['NPC-007::CTA::002' as const]
          : []),
        'NPC-007::CTA::003',
      ];
    case 'NPC-016':
      return [
        'NPC-016::CTA::002',
        ...(p.content.validationSummary.length === 0 &&
        (!p.content.calendar.requiresCampaignTime ||
          p.content.calendar.validationStatus === 'CURRENT')
          ? ['NPC-016::CTA::003' as const]
          : []),
        ...(p.campaignPhase === 'PRE_START' ? ['NPC-016::CTA::004' as const] : []),
      ];
    case 'NPC-017':
      return [
        ...(p.content.fullValidationStatus === 'VALID' &&
        p.attemptOrNull !== null &&
        supported.includes(
          p.attemptOrNull.editMode === 'CREATE_V1'
            ? 'UI-CMD-NPC-COMMIT-V1'
            : 'UI-CMD-NPC-NEW-VERSION',
        )
          ? ['NPC-017::CTA::002' as const]
          : []),
        'NPC-017::CTA::003',
      ];
    default:
      return NPC_CONTROL_ACTION_KEYS[p.formId];
  }
}
export function npcBrowserWorkflow(
  p: NpcGmProjection,
  actionKey: string,
  commandId: string,
): NpcWorkflowCommandRequest | null {
  const common = {
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    commandId,
    expectedRevisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
  };
  if (
    (p.formId === 'NPC-003' && actionKey === 'NPC-003::CTA::008') ||
    (p.formId === 'NPC-007' && actionKey === 'NPC-007::CTA::002')
  ) {
    return npcWorkflowCommandRequestValue({
      ...common,
      workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
      payload: {
        phase: 'OPEN',
        campaignId: p.campaignId,
        npcUuid: p.content.npcUuid,
        expectedCurrentVersion: p.content.currentVersion,
      },
    });
  }
  // The source's post-receipt 004 route must never create a new version.
  if (p.formId !== 'NPC-017' || actionKey !== 'NPC-017::CTA::002') return null;
  const a = p.attemptOrNull;
  if (a === null) throw new NpcArtSessionError();
  const payload = {
    campaignId: p.campaignId,
    npcDraftId: a.npcDraftId,
    expectedAttemptRevision: a.attemptRevision,
  };
  return npcWorkflowCommandRequestValue({
    ...common,
    workflowCommandId:
      a.editMode === 'CREATE_V1' ? 'UI-CMD-NPC-COMMIT-V1' : 'UI-CMD-NPC-NEW-VERSION',
    payload:
      a.editMode === 'CREATE_V1'
        ? payload
        : {
            ...payload,
            phase: 'COMMIT',
            expectedCurrentVersion: a.versionBindingOrNull?.expectedCurrentVersion,
          },
  });
}
/** Outer receipt was decoded by the existing wire codec. These are the closed NPC result fields. */
export function npcBrowserReceipt(
  receipt: CommandReceipt,
  request: NpcWorkflowCommandRequest,
  p: NpcGmProjection,
): CommandReceipt {
  const r = receipt.result;
  const keys =
    'workflowCommandId contextId campaignId npcDraftId npcUuid versionOrNull operationKind committedAt'.split(
      ' ',
    );
  const uuid = (x: unknown) =>
    typeof x === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(x);
  // Validate the host's immutable audit time; never derive campaign time from the local clock.
  const auditTimestamp = (value: unknown): boolean => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
      return false;
    const instant = Date.parse(value);
    return Number.isFinite(instant) && new Date(instant).toISOString() === value;
  };
  const open =
    request.workflowCommandId === 'UI-CMD-NPC-NEW-VERSION' && request.payload.phase === 'OPEN';
  const kind = open
    ? 'OPEN'
    : request.workflowCommandId === 'UI-CMD-NPC-COMMIT-V1'
      ? 'COMMIT_V1'
      : 'COMMIT';
  if (
    Object.keys(r).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(r, k)) ||
    receipt.commandId !== request.commandId ||
    !uuid(receipt.receiptId) ||
    r['workflowCommandId'] !== request.workflowCommandId ||
    r['contextId'] !== p.contextId ||
    r['campaignId'] !== p.campaignId ||
    r['operationKind'] !== kind ||
    !uuid(r['npcDraftId']) ||
    !uuid(r['npcUuid']) ||
    !auditTimestamp(r['committedAt']) ||
    receipt.revisions.stateRevision !== request.expectedRevisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== request.expectedRevisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !==
      request.expectedRevisions.actorVisibilityRevision ||
    (open
      ? r['versionOrNull'] !== null || r['npcUuid'] !== request.payload.npcUuid
      : !('npcDraftId' in request.payload) ||
        r['npcDraftId'] !== request.payload.npcDraftId ||
        r['npcUuid'] !== p.attemptOrNull?.candidateNpcUuid ||
        r['versionOrNull'] !==
          (kind === 'COMMIT_V1'
            ? 1
            : request.workflowCommandId === 'UI-CMD-NPC-NEW-VERSION' &&
                request.payload.phase === 'COMMIT'
              ? request.payload.expectedCurrentVersion + 1
              : 0))
  )
    throw new NpcArtSessionError();
  return receipt;
}
export function npcBrowserDestination(
  p: NpcGmProjection | null,
  receipt: CommandReceipt,
  revisions: RevisionVector,
): boolean {
  if (!npcVectorAtLeast(revisions, receipt.revisions)) return false;
  if (!sameNpcVector(revisions, receipt.revisions)) return true;
  const r = receipt.result;
  return r['operationKind'] === 'OPEN'
    ? p?.formId === 'NPC-002' &&
        p.attemptOrNull !== null &&
        p.attemptOrNull.npcDraftId === r['npcDraftId'] &&
        p.attemptOrNull.candidateNpcUuid === r['npcUuid'] &&
        p.attemptOrNull.editMode === 'APPEND_N_PLUS_ONE'
    : p?.formId === 'NPC-003' &&
        p.content.npcUuid === r['npcUuid'] &&
        p.content.currentVersion === r['versionOrNull'] &&
        p.content.displayedVersion === r['versionOrNull'];
}

export function npcPortraitRequests(
  p: NpcGmProjection,
  session: NpcArtSession,
  nextId: () => string | null,
): readonly NpcArtReadRequest[] {
  const refs: { target: NpcArtReadTarget; art: NpcArtReference }[] = [];
  const add = (target: NpcArtReadTarget, art: NpcArtReference | null) => {
    if (art !== null) refs.push({ target, art });
  };
  switch (p.formId) {
    case 'NPC-001':
      for (const row of p.content.rows)
        add({ kind: 'VERSION', npcUuid: row.npcUuid, version: row.currentVersion }, row.artOrNull);
      break;
    case 'NPC-003':
      add(
        { kind: 'VERSION', npcUuid: p.content.npcUuid, version: p.content.displayedVersion },
        p.content.artOrNull,
      );
      break;
    case 'NPC-007': {
      const row = p.content.previewOrNull;
      if (row !== null)
        add(
          { kind: 'VERSION', npcUuid: row.npcUuid, version: row.displayedVersion },
          row.artOrNull,
        );
      break;
    }
    case 'NPC-002':
    case 'NPC-017': {
      const a = p.attemptOrNull;
      if (a !== null)
        add(
          { kind: 'ATTEMPT', npcDraftId: a.npcDraftId, expectedAttemptRevision: a.attemptRevision },
          p.formId === 'NPC-002'
            ? p.content.artOrNull
            : (p.content.previewOrNull?.artOrNull ?? null),
        );
      break;
    }
    default:
      break;
  }
  return refs.flatMap(({ target, art }) => {
    if (!session.needs(p, target, art)) return [];
    const id = nextId();
    return id === null ? [] : [session.begin(id, target, art)];
  });
}
