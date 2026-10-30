import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type {
  ClientToHostMessage,
  ClientToHostV2Message,
  ClientToHostV3Message,
  HostToClientMessage,
  HostToClientV2Message,
  HostToClientV3Message,
  PresentedBaseForm,
  RevisionVector,
  JsonObject,
  FormActionIntentV2Message,
} from '../shared/index.js';
import {
  CAMPAIGN_CREATE_COMMAND_ID,
  campaignQrPayload,
  type CampaignCreateRequest,
  type CampaignDraftReplaceV3Message,
  type CampaignDraftFormId,
  type CampaignCreationProjection,
  type CampaignDraftRefusal,
  type CampaignBindPreflight,
} from '../shared/campaign-creation.js';
import { loadDeviceId } from '../persistence/index.js';
import {
  ensureLocalGmProfile,
  readLocalGmProfile,
  readActiveLocalGmContext,
  readCampaignCreationLibraryState,
  readPausedCampaign,
  createLocalGmContext,
  readLocalGmContext,
  readCampaignCreationCursor,
  createCampaignDraft,
  readCampaignDraft,
  readCampaignDraftUpdate,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  cancelCampaignDraft,
  readCampaignDraftCancellationById,
  readCampaignCreationCommand,
  commitCampaignCreation,
  readCampaignPrivateOwner,
  CampaignCreationStoreError,
  type StoredCampaignDraft,
  type CampaignDraftUpdateInput,
  type LocalGmContext,
  type CampaignSourceValidator,
} from '../persistence/campaign-creation.js';
import {
  prepareMasterSecret,
  validateMasterSecretInput,
  verifyMasterSecret,
  validateMasterSecretVerifier,
  MasterSecretError,
} from './campaign-secret.js';
import type { createCampaignBindManager } from './campaign-bind.js';
import { CAMPAIGN_CREATE_SCREEN_CONTRACTS } from './projections/cmp-create.js';
import {
  loadLocalCharacterExportBaseline,
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  validateCampaignMetadata,
  validateCampaignHost,
  validateCampaignMode,
  campaignDraftReadiness,
  CampaignDraftValidationError,
} from './campaign-draft-validation.js';

type AnyClient = ClientToHostMessage | ClientToHostV2Message | ClientToHostV3Message;
export type CampaignHostMessage =
  HostToClientMessage | HostToClientV2Message | HostToClientV3Message;
export interface CampaignConnection {
  gmLocalContextId: string | null;
  executableCreate: boolean;
  readonly trusted: () => boolean;
}
interface Dependencies {
  readonly database: Database.Database;
  readonly projectRoot: string;
  readonly baseline: LocalCharacterExportBaseline;
  readonly bind: ReturnType<typeof createCampaignBindManager>;
}
export interface CampaignShell {
  readonly formId: string | null;
  readonly revisions: RevisionVector;
  readonly ready: boolean;
  readonly advance: () => RevisionVector;
  readonly base: () => PresentedBaseForm;
  readonly enter: () => void;
  readonly exit: () => void;
}
const zero = (): RevisionVector => ({
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
});
const vector = (value: RevisionVector): RevisionVector => ({
  stateRevision: value.stateRevision,
  projectionRevision: value.projectionRevision,
  actorVisibilityRevision: value.actorVisibilityRevision,
});
const hash = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex');
const unavailable = (): never => {
  throw new CampaignCreationStoreError('DRAFT_UNAVAILABLE');
};
const trust = (c: CampaignConnection): void => {
  if (!c.trusted()) unavailable();
};
const actions: Readonly<Record<string, readonly string[]>> = {
  'APP-011': ['APP-011::CTA::001', 'APP-011::CTA::006'],
  'CMP-001': ['CMP-001::CTA::001', 'CMP-001::CTA::002'],
  'CMP-002': ['CMP-002::CTA::001', 'CMP-002::CTA::002'],
  'CMP-003': ['CMP-003::CTA::001', 'CMP-003::CTA::002'],
  'CMP-004': ['CMP-004::CTA::001', 'CMP-004::CTA::002'],
  'CMP-005': ['CMP-005::CTA::001', 'CMP-005::CTA::002'],
  'CMP-006': [],
};
const hops: Readonly<Record<string, CampaignDraftFormId>> = {
  'CMP-001::CTA::001': 'CMP-002',
  'CMP-002::CTA::001': 'CMP-001',
  'CMP-002::CTA::002': 'CMP-003',
  'CMP-003::CTA::001': 'CMP-002',
  'CMP-003::CTA::002': 'CMP-004',
  'CMP-004::CTA::001': 'CMP-003',
  'CMP-004::CTA::002': 'CMP-005',
  'CMP-005::CTA::002': 'CMP-004',
};

/** No client role or device claim can replace the live connection proof. */
export function createCampaignCreationRuntime(d: Dependencies) {
  const db = d.database;
  const navJournal = new Map<
    string,
    { request: FormActionIntentV2Message; contextId: string; snapshot: HostToClientV2Message }
  >();
  const baselineReady = new Map<string, boolean>();
  const lastBind = new Map<string, { host: string; preflight: CampaignBindPreflight }>();
  const bindView = (draft: StoredCampaignDraft): CampaignBindPreflight => {
    const live = d.bind.describe(draft.campaignDraftId, draft.values.host);
    const prior = lastBind.get(draft.campaignDraftId);
    return live.status === 'NOT_CHECKED' &&
      prior?.host === JSON.stringify(draft.values.host) &&
      prior.preflight.status === 'FAIL'
      ? prior.preflight
      : live;
  };
  const context = (c: CampaignConnection): LocalGmContext => {
    trust(c);
    if (c.gmLocalContextId === null) return unavailable();
    const result = readLocalGmContext(db, c.gmLocalContextId);
    if (result.ownerDeviceId !== loadDeviceId(db)) return unavailable();
    return result;
  };
  const commandAt = (ctx: LocalGmContext, id: string) => {
    const known = readCampaignCreationCommand(db, ctx.gmLocalContextId, id);
    if (known !== null) {
      assertStoredBaseline(known.receipt.result.baselineVersion);
      validateMasterSecretVerifier(
        readCampaignPrivateOwner(db, ctx.gmLocalContextId, known.receipt.result.campaignId)
          .verifier,
      );
    }
    return known;
  };
  const assertStoredBaseline = (version: string): void => {
    try {
      resolveStoredLocalCharacterExportBaseline(d.baseline, version);
    } catch {
      unavailable();
    }
  };
  const guard =
    (c: CampaignConnection): CampaignSourceValidator =>
    (_draft, ctx) => {
      const actual = context(c);
      if (!isDeepStrictEqual(actual, ctx)) unavailable();
    };
  const currentVector = (c: CampaignConnection): RevisionVector => {
    const ctx = context(c);
    return readCampaignCreationCursor(db, ctx.gmLocalContextId).revisions;
  };
  const common = (ctx: LocalGmContext): JsonObject => ({
    gmLocalContextId: ctx.gmLocalContextId,
    hostDeviceId: ctx.ownerDeviceId,
    masterAuthorityRevision: 0,
  });
  const menuPayload = (ctx: LocalGmContext): CampaignCreationProjection => {
    const { draftCount, pausedCampaignCount } = readCampaignCreationLibraryState(
      db,
      ctx.gmLocalContextId,
    );
    return {
      ...common(ctx),
      campaignLibraryState: {
        status:
          draftCount > 0
            ? 'DRAFT_AVAILABLE'
            : pausedCampaignCount > 0
              ? 'HOST_RECOVERABLE'
              : 'NO_CAMPAIGNS',
        draftCount,
        pausedCampaignCount,
      },
      masterAuthorityState: {
        status: 'CONFIRMED_LOCAL',
        masterProfileId: ctx.masterProfileId,
        revision: 0,
      },
    } as CampaignCreationProjection;
  };
  const artChecksum = (draft: StoredCampaignDraft): string | null =>
    draft.values.metadata.art === null
      ? null
      : hash(Buffer.from(draft.values.metadata.art.bytesBase64, 'base64'));
  function assertBaseline(): void {
    // The already verified manifest is also the exact allowlist; recheck its bytes
    // and all listed files in the synchronous commit guard after async preflight.
    const manifest = readFileSync(join(d.projectRoot, 'artifacts', 'CHECKSUMS.sha256'));
    if (`sha256:${hash(manifest)}` !== d.baseline.baselineVersion) unavailable();
    for (const line of manifest.toString('utf8').split(/\r?\n/u)) {
      if (line.trim() === '' || line.startsWith('#')) continue;
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
      if (
        match?.[1] === undefined ||
        match[2] === undefined ||
        hash(readFileSync(join(d.projectRoot, 'artifacts', ...match[2].split('/')))) !== match[1]
      )
        unavailable();
    }
  }
  function basicReady(draft: StoredCampaignDraft, stage: CampaignDraftFormId): void {
    const readiness = campaignDraftReadiness(
      draft.values,
      draft.currentVerifier !== null,
      stage,
      d.bind.interfaces(),
    );
    if (!readiness.ready)
      throw new CampaignDraftValidationError(
        readiness.errors[0] ?? { field: 'title', reason: 'REQUIRED' },
      );
    if (stage !== 'CMP-001' && stage !== 'CMP-002')
      validateMasterSecretVerifier(draft.currentVerifier);
  }
  async function prepare(
    draft: StoredCampaignDraft,
    c: CampaignConnection,
  ): Promise<CampaignBindPreflight | null> {
    trust(c);
    basicReady(draft, 'CMP-005');
    try {
      const fresh = await loadLocalCharacterExportBaseline(d.projectRoot);
      baselineReady.set(
        draft.campaignDraftId,
        fresh.baselineVersion === d.baseline.baselineVersion &&
          fresh.registryVersion === d.baseline.registryVersion &&
          fresh.catalogVersion === d.baseline.catalogVersion &&
          fresh.builtAgainstTuple === d.baseline.builtAgainstTuple,
      );
    } catch {
      baselineReady.set(draft.campaignDraftId, false);
    }
    trust(c);
    if (baselineReady.get(draft.campaignDraftId) !== true) {
      const prior = lastBind.get(draft.campaignDraftId);
      if (
        prior?.host === JSON.stringify(draft.values.host) &&
        prior.preflight.leaseIdOrNull !== null
      )
        await d.bind.releaseIf(
          prior.preflight.leaseIdOrNull,
          draft.campaignDraftId,
          draft.values.host,
        );
      return null;
    }
    const preflight = await d.bind.prepare(draft.campaignDraftId, draft.values.host);
    try {
      const ctx = context(c),
        current = readCampaignDraft(db, ctx.gmLocalContextId, draft.campaignDraftId);
      if (current.status !== 'DRAFT' || current.snapshotSha256 !== draft.snapshotSha256)
        unavailable();
    } catch (error) {
      if (preflight.leaseIdOrNull !== null)
        await d.bind.releaseIf(preflight.leaseIdOrNull, draft.campaignDraftId, draft.values.host);
      throw error;
    }
    lastBind.set(draft.campaignDraftId, { host: JSON.stringify(draft.values.host), preflight });
    return preflight;
  }
  function base(
    formId: string,
    payload: CampaignCreationProjection,
    available: readonly string[],
    routeId?: string,
  ): PresentedBaseForm {
    const screen = CAMPAIGN_CREATE_SCREEN_CONTRACTS.find((s) => s.formId === formId);
    if (screen === undefined) return unavailable();
    return {
      formId: screen.formId,
      formType: 'screen',
      routeTemplate: screen.route,
      routeBindings:
        routeId === undefined ? [] : [{ parameterIndex: 0, source: 'inherited', value: routeId }],
      availableActionKeys: available as PresentedBaseForm['availableActionKeys'],
      roleFilteredPayload: payload,
    };
  }
  async function project(
    c: CampaignConnection,
  ): Promise<{ base: PresentedBaseForm; revisions: RevisionVector }> {
    const ctx = context(c),
      cursor = readCampaignCreationCursor(db, ctx.gmLocalContextId),
      shared = common(ctx);
    let payload: JsonObject;
    let available = actions[cursor.formId] ?? [];
    if (cursor.kind === 'MENU') {
      payload = menuPayload(ctx);
    } else if (cursor.kind === 'CAMPAIGN') {
      validateMasterSecretVerifier(
        readCampaignPrivateOwner(db, ctx.gmLocalContextId, cursor.targetId).verifier,
      );
      const saved = readPausedCampaign(db, ctx.gmLocalContextId, cursor.targetId);
      assertStoredBaseline(saved.baselineVersion);
      const recovery = await d.bind.recover(saved.campaignId, saved.host);
      context(c);
      payload = {
        ...shared,
        routeIdentityKind: 'CAMPAIGN',
        campaignId: saved.campaignId,
        sourceCampaignDraftId: saved.sourceCampaignDraftId,
        status: 'PAUSED',
        createdAt: saved.createdAt,
        hostAddress: saved.host.hostAddress,
        hostPort: saved.host.hostPort,
        networkInterface: saved.host.networkInterface,
        qrPayload: saved.qrPayload,
        activePlayerCapacity: saved.host.activePlayerCapacity,
        creationReceiptId: saved.creationReceiptId,
        creationCommandId: saved.creationCommandId,
        hostBindRecovery: { ...recovery },
      };
    } else {
      const draft = readCampaignDraft(db, ctx.gmLocalContextId, cursor.targetId);
      if (draft.currentVerifier !== null) validateMasterSecretVerifier(draft.currentVerifier);
      const v = draft.values;
      if (
        draft.formId !== 'CMP-005' &&
        !campaignDraftReadiness(
          v,
          draft.currentVerifier !== null,
          draft.formId,
          d.bind.interfaces(),
        ).ready
      )
        available = available.filter(
          (key) =>
            key ===
            (draft.formId === 'CMP-001' ? 'CMP-001::CTA::002' : `${draft.formId}::CTA::001`),
        );
      payload = {
        ...shared,
        routeIdentityKind: 'CAMPAIGN_DRAFT',
        campaignDraftId: draft.campaignDraftId,
        draftRevision: draft.draftRevision,
      };
      if (cursor.formId === 'CMP-001')
        payload = {
          ...payload,
          title: v.metadata.title,
          description: v.metadata.description,
          artFilePickerState: {
            status: v.metadata.art === null ? 'EMPTY' : 'SELECTED',
            value: v.metadata.art,
          },
          artAssetChecksumOrNull: artChecksum(draft),
        };
      else if (cursor.formId === 'CMP-002')
        payload = { ...payload, ...v.host, availableNetworkInterfaces: d.bind.interfaces() };
      else if (cursor.formId === 'CMP-003')
        payload = {
          ...payload,
          masterSecretConfigured: draft.currentVerifier !== null,
          passwordStrengthLocal: {
            minimumCodePoints: 12,
            maximumCodePoints: 128,
            status: draft.currentVerifier === null ? 'NOT_CONFIGURED' : 'CONFIGURED',
          },
          secretPersistencePolicy: 'VERIFIER_ONLY_CLEAR_AFTER_SAVE',
        };
      else if (cursor.formId === 'CMP-004')
        payload = {
          ...payload,
          defaultFutureRollMode: v.defaultFutureRollMode,
          openRollRequestsUnaffected: true,
        };
      else {
        if (
          baselineReady.get(draft.campaignDraftId) === undefined ||
          d.bind.describe(draft.campaignDraftId, v.host).status !== 'PASS'
        )
          await prepare(draft, c);
        const bind = bindView(draft),
          compatible = baselineReady.get(draft.campaignDraftId) === true;
        const ready = compatible && bind.status === 'PASS';
        payload = {
          ...payload,
          fullDraftSummary: {
            ...v,
            masterSecretConfigured: draft.currentVerifier !== null,
            artAssetChecksumOrNull: artChecksum(draft),
          },
          baselineVersion: d.baseline.baselineVersion,
          catalogCompatibility: {
            status: compatible ? 'PASS' : 'FAIL',
            registryVersion: d.baseline.registryVersion,
            catalogVersion: d.baseline.catalogVersion,
            builtAgainstTuple: d.baseline.builtAgainstTuple,
            reasonCode: compatible ? null : 'BASELINE_MISMATCH',
          },
          hostBindPreflight: bind,
          activePlayerCount: 0,
          validationStatus: ready ? 'READY_TO_CREATE' : 'PREFLIGHT_BLOCKED',
          commandId: null,
        };
        available = ready && c.executableCreate ? available : ['CMP-005::CTA::002'];
      }
    }
    context(c);
    const after = readCampaignCreationCursor(db, ctx.gmLocalContextId);
    if (!isDeepStrictEqual(cursor, after)) return project(c);
    return {
      base: base(
        cursor.formId,
        payload as CampaignCreationProjection,
        available,
        cursor.kind === 'MENU'
          ? undefined
          : cursor.kind === 'DRAFT'
            ? `draft:${cursor.targetId}`
            : cursor.targetId,
      ),
      revisions: cursor.revisions,
    };
  }
  const snapshot = async (
    c: CampaignConnection,
    id: string,
    reason: 'FORM_ACTION' | 'RECONNECT' | 'COMMAND_DESTINATION',
  ): Promise<HostToClientV2Message> => {
    const view = await project(c);
    return {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'gm',
      revisions: view.revisions,
      presentation: { assignment: { correlationId: id, reason }, base: view.base, layers: [] },
    };
  };
  const launchSnapshot = (ctx: LocalGmContext, id: string): HostToClientV2Message => ({
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'gm',
    revisions: vector(ctx),
    presentation: {
      assignment: { reason: 'FORM_ACTION', correlationId: id },
      base: base('APP-011', menuPayload(ctx), actions['APP-011'] ?? []),
      layers: [],
    },
  });
  const navRefusal = (
    m: FormActionIntentV2Message,
    revisions: RevisionVector,
    stale = false,
  ): HostToClientV2Message => ({
    messageType: 'navigation.form-action.refusal',
    protocolVersion: 2,
    navigationRequestId: m.navigationRequestId,
    presentationUnchanged: true,
    revisions,
    refusal: stale
      ? {
          code: 'STALE_PROJECTION',
          actualProjectionRevision: revisions.projectionRevision,
          expectedProjectionRevision: m.expectedProjectionRevision,
        }
      : { code: 'NAVIGATION_UNAVAILABLE' },
  });

  async function navigate(
    m: FormActionIntentV2Message,
    c: CampaignConnection,
    shell: CampaignShell,
    send: (message: CampaignHostMessage) => void,
  ): Promise<void> {
    if (m.sourceFormId === 'APP-001' && m.actionKey === 'APP-001::CTA::002') {
      if (
        !c.trusted() ||
        shell.formId !== 'APP-001' ||
        !shell.ready ||
        shell.revisions.projectionRevision !== m.expectedProjectionRevision
      ) {
        send(navRefusal(m, shell.revisions));
        return;
      }
      const existing = navJournal.get(m.navigationRequestId);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.request, m)) {
          send(navRefusal(m, shell.revisions));
          return;
        }
        c.gmLocalContextId = existing.contextId;
        const resumed = context(c);
        shell.enter();
        send(launchSnapshot(resumed, m.navigationRequestId));
        return;
      }
      const ownerDeviceId = loadDeviceId(db);
      const profile =
        readLocalGmProfile(db, ownerDeviceId) ??
        ensureLocalGmProfile(db, { ownerDeviceId, masterProfileId: randomUUID() }, () => trust(c));
      const ctx =
        readActiveLocalGmContext(db, ownerDeviceId) ??
        createLocalGmContext(
          db,
          {
            ownerDeviceId,
            masterProfileId: profile.masterProfileId,
            gmLocalContextId: randomUUID(),
          },
          () => trust(c),
        );
      shell.advance();
      c.gmLocalContextId = ctx.gmLocalContextId;
      c.executableCreate = false;
      shell.enter();
      const target = launchSnapshot(ctx, m.navigationRequestId);
      navJournal.set(m.navigationRequestId, {
        request: m,
        contextId: ctx.gmLocalContextId,
        snapshot: target,
      });
      send(target);
      return;
    }
    const ctx = context(c),
      cursor = readCampaignCreationCursor(db, ctx.gmLocalContextId);
    const known = navJournal.get(m.navigationRequestId);
    if (known !== undefined) {
      if (known.contextId !== ctx.gmLocalContextId || !isDeepStrictEqual(known.request, m)) {
        send(navRefusal(m, cursor.revisions));
        return;
      }
      send(await snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
      return;
    }
    const cancelled = readCampaignDraftCancellationById(
      db,
      ctx.gmLocalContextId,
      m.navigationRequestId,
    );
    if (cancelled !== null) {
      if (
        m.sourceFormId !== 'CMP-001' ||
        m.actionKey !== 'CMP-001::CTA::002' ||
        m.expectedProjectionRevision !== cancelled.request.expectedRevisions.projectionRevision
      )
        throw new CampaignCreationStoreError('IDEMPOTENCY_CONFLICT');
      send(await snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
      return;
    }
    if (m.sourceFormId !== cursor.formId || !actions[cursor.formId]?.includes(m.actionKey)) {
      send(navRefusal(m, cursor.revisions));
      return;
    }
    if (m.expectedProjectionRevision !== cursor.revisions.projectionRevision) {
      send(navRefusal(m, cursor.revisions, true));
      return;
    }
    if (cursor.kind === 'MENU') {
      if (m.actionKey === 'APP-011::CTA::001') {
        const after = shell.advance();
        c.gmLocalContextId = null;
        c.executableCreate = false;
        shell.exit();
        send({
          messageType: 'projection.snapshot',
          protocolVersion: 2,
          projectionRole: null,
          revisions: after,
          presentation: {
            assignment: { reason: 'FORM_ACTION', correlationId: m.navigationRequestId },
            base: shell.base(),
            layers: [],
          },
        });
        return;
      }
      createCampaignDraft(
        db,
        {
          gmLocalContextId: ctx.gmLocalContextId,
          campaignDraftId: randomUUID(),
          expectedRevisions: cursor.revisions,
        },
        () => context(c),
      );
    } else if (cursor.kind === 'DRAFT') {
      const draft = readCampaignDraft(db, ctx.gmLocalContextId, cursor.targetId);
      if (m.actionKey === 'CMP-001::CTA::002') {
        cancelCampaignDraft(
          db,
          {
            cancelRequestId: m.navigationRequestId,
            gmLocalContextId: ctx.gmLocalContextId,
            campaignDraftId: draft.campaignDraftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: cursor.revisions,
            sourceFormId: 'CMP-001',
          },
          guard(c),
        );
        await d.bind.release(draft.campaignDraftId);
        baselineReady.delete(draft.campaignDraftId);
      } else {
        const target = hops[m.actionKey] ?? unavailable();
        if (Number(target.slice(4)) > Number(draft.formId.slice(4)))
          basicReady(draft, draft.formId);
        const prepared = target === 'CMP-005' ? await prepare(draft, c) : null;
        let advanced = false;
        try {
          navigateCampaignDraft(
            db,
            {
              gmLocalContextId: ctx.gmLocalContextId,
              campaignDraftId: draft.campaignDraftId,
              expectedDraftRevision: draft.draftRevision,
              expectedRevisions: cursor.revisions,
              sourceFormId: draft.formId,
              targetFormId: target,
            },
            (fresh, owner, phase) => {
              guard(c)(fresh, owner, phase);
              if (Number(target.slice(4)) > Number(fresh.formId.slice(4)))
                basicReady(fresh, fresh.formId);
            },
          );
          advanced = true;
        } finally {
          if (
            !advanced &&
            prepared?.leaseIdOrNull !== null &&
            prepared?.leaseIdOrNull !== undefined
          )
            await d.bind.releaseIf(
              prepared.leaseIdOrNull,
              draft.campaignDraftId,
              draft.values.host,
            );
        }
        if (draft.formId === 'CMP-005') await d.bind.release(draft.campaignDraftId);
      }
    } else unavailable();
    const target = await snapshot(c, m.navigationRequestId, 'FORM_ACTION');
    navJournal.set(m.navigationRequestId, {
      request: m,
      contextId: ctx.gmLocalContextId,
      snapshot: target,
    });
    send(target);
  }

  async function replace(
    m: CampaignDraftReplaceV3Message,
    c: CampaignConnection,
    send: (message: CampaignHostMessage) => void,
  ): Promise<void> {
    const ctx = context(c);
    if (ctx.gmLocalContextId !== m.scope.gmLocalContextId) unavailable();
    const initial = readCampaignDraft(db, ctx.gmLocalContextId, m.scope.campaignDraftId);
    if (initial.status !== 'DRAFT') unavailable();
    const validateIncoming = (): void => {
      if (m.variant === 'METADATA') validateCampaignMetadata(m.values);
      else if (m.variant === 'HOST') validateCampaignHost(m.values, d.bind.interfaces());
      else if (m.variant === 'MODE') validateCampaignMode(m.values);
    };
    validateIncoming();
    let input: CampaignDraftUpdateInput;
    if (m.variant === 'SECRET') {
      // Confirmation is checked on replay too; neither string is journalled.
      validateMasterSecretInput(
        m.values.masterTransferPassword,
        m.values.masterTransferPasswordConfirmation,
      );
      context(c);
      const draft = readCampaignDraft(db, ctx.gmLocalContextId, m.scope.campaignDraftId);
      const known = readCampaignDraftUpdate(
        db,
        ctx.gmLocalContextId,
        draft.campaignDraftId,
        m.draftUpdateId,
      );
      let verifiedReplayProofSha256: string | undefined;
      if (known !== null) {
        if (
          known.verifier === null ||
          !(await verifyMasterSecret(m.values.masterTransferPassword, known.verifier))
        )
          throw new CampaignCreationStoreError('IDEMPOTENCY_CONFLICT');
        verifiedReplayProofSha256 = known.verifierSha256 ?? unavailable();
      }
      const keep =
        known === null &&
        draft.currentVerifier !== null &&
        (await verifyMasterSecret(m.values.masterTransferPassword, draft.currentVerifier));
      const secretUpdate =
        known !== null
          ? undefined
          : keep
            ? {
                kind: 'KEEP' as const,
                expectedCurrentVerifierSha256: draft.currentVerifierSha256 ?? unavailable(),
              }
            : {
                kind: 'REPLACE' as const,
                preparedVerifier: await prepareMasterSecret(
                  m.values.masterTransferPassword,
                  m.values.masterTransferPasswordConfirmation,
                ),
              };
      context(c);
      input = {
        request: { ...m, values: { secretProvided: true } },
        ...(secretUpdate === undefined ? {} : { secretUpdate }),
        ...(verifiedReplayProofSha256 === undefined ? {} : { verifiedReplayProofSha256 }),
      };
    } else input = { request: m };
    const validateSource: CampaignSourceValidator = (draft, owner, phase) => {
      guard(c)(draft, owner, phase);
      if (phase === 'APPLY') validateIncoming();
    };
    let outcome = commitCampaignDraftUpdate(db, input, validateSource);
    if (outcome.kind === 'NEEDS_SECRET_VERIFICATION') {
      if (
        m.variant !== 'SECRET' ||
        outcome.update.verifier === null ||
        !(await verifyMasterSecret(m.values.masterTransferPassword, outcome.update.verifier))
      )
        throw new CampaignCreationStoreError('IDEMPOTENCY_CONFLICT');
      context(c);
      outcome = commitCampaignDraftUpdate(
        db,
        { ...input, verifiedReplayProofSha256: outcome.update.verifierSha256 ?? unavailable() },
        validateSource,
      );
    }
    if (outcome.kind === 'NEEDS_SECRET_VERIFICATION') unavailable();
    const view = await project(c);
    if (
      !/^CMP-00[1-5]$/u.test(view.base.formId) ||
      view.base.roleFilteredPayload['campaignDraftId'] !== m.scope.campaignDraftId
    )
      unavailable();
    send({
      messageType: 'campaign.draft.result',
      protocolVersion: 3,
      draftUpdateId: m.draftUpdateId,
      scope: m.scope,
      changed: outcome.update.event.changed,
      appliedDraftRevision: outcome.update.event.appliedDraftRevision,
      appliedRevisions: outcome.update.event.appliedRevisions,
      draftRevision: view.revisions.stateRevision,
      revisions: view.revisions,
      projectionRole: 'gm',
      presentation: { base: view.base, layers: [] },
    });
  }

  async function create(
    request: CampaignCreateRequest,
    c: CampaignConnection,
    send: (message: CampaignHostMessage) => void,
  ): Promise<void> {
    const ctx = context(c);
    if (
      !c.executableCreate ||
      request.role !== 'gm' ||
      request.payload.gmLocalContextId !== ctx.gmLocalContextId
    )
      unavailable();
    const known = commandAt(ctx, request.commandId);
    if (known !== null) {
      if (!isDeepStrictEqual(known.request, request))
        throw new CampaignCreationStoreError('IDEMPOTENCY_CONFLICT');
      send({
        messageType: 'command.replay',
        protocolVersion: 1,
        lifecycleState: 'IDEMPOTENT_REPLAY',
        receipt: known.receipt,
      });
      send(await snapshot(c, request.commandId, 'COMMAND_DESTINATION'));
      return;
    }
    const draft = readCampaignDraft(db, ctx.gmLocalContextId, request.payload.campaignDraftId);
    const sourceHash = draft.snapshotSha256;
    let committed = false;
    try {
      basicReady(draft, 'CMP-005');
      const freshBaseline = await loadLocalCharacterExportBaseline(d.projectRoot);
      context(c);
      if (
        freshBaseline.baselineVersion !== d.baseline.baselineVersion ||
        !d.bind.validate(request.payload.preflightLeaseId, draft.campaignDraftId, draft.values.host)
      )
        unavailable();
      const campaignId = randomUUID(),
        receiptId = randomUUID();
      const result = commitCampaignCreation(
        db,
        {
          request,
          campaignId,
          receiptId,
          createdAt: new Date().toISOString(),
          qrPayload: campaignQrPayload(
            draft.values.host.hostAddress ?? '',
            draft.values.host.hostPort ?? 0,
            campaignId,
          ),
          baselineVersion: d.baseline.baselineVersion,
        },
        (current, owner, phase) => {
          guard(c)(current, owner, phase);
          if (phase === 'REPLAY') return;
          if (current.snapshotSha256 !== sourceHash) unavailable();
          basicReady(current, 'CMP-005');
          assertBaseline();
          if (
            !d.bind.validate(
              request.payload.preflightLeaseId,
              current.campaignDraftId,
              current.values.host,
            )
          )
            unavailable();
        },
      );
      committed = true;
      d.bind.retainForCampaign(draft.campaignDraftId, campaignId);
      send({
        messageType: 'command.result',
        protocolVersion: 1,
        lifecycleState: 'COMMITTED',
        receipt: result.receipt,
      });
      send(await snapshot(c, request.commandId, 'COMMAND_DESTINATION'));
    } finally {
      if (!committed)
        await d.bind.releaseIf(
          request.payload.preflightLeaseId,
          draft.campaignDraftId,
          draft.values.host,
        );
    }
  }
  function draftRefusal(
    error: unknown,
    m: CampaignDraftReplaceV3Message,
    c: CampaignConnection,
  ): CampaignDraftRefusal {
    if (error instanceof CampaignDraftValidationError)
      return { code: 'INVALID_FIELD', error: error.fieldError };
    if (error instanceof MasterSecretError)
      return {
        code: 'INVALID_FIELD',
        error: {
          field:
            error.field === 'masterTransferPasswordConfirmation'
              ? 'masterTransferPasswordConfirmation'
              : 'masterTransferPassword',
          reason:
            error.code === 'CONFIRMATION_MISMATCH'
              ? 'CONFIRMATION_MISMATCH'
              : error.code === 'DISALLOWED_CHARACTERS'
                ? 'DISALLOWED_CHARACTERS'
                : error.code === 'INVALID_TYPE'
                  ? 'INVALID_TYPE'
                  : 'INVALID_LENGTH',
        },
      };
    if (error instanceof CampaignCreationStoreError) {
      if (error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'REVISION_OVERFLOW')
        return { code: error.code };
      const draft = readCampaignDraft(db, context(c).gmLocalContextId, m.scope.campaignDraftId);
      if (error.code === 'STALE_DRAFT')
        return {
          code: 'STALE_DRAFT',
          expected: m.expectedDraftRevision,
          actual: draft.draftRevision,
        };
      if (error.code === 'STALE_REVISION')
        return { code: 'STALE_REVISION', expected: m.expectedRevisions, actual: vector(draft) };
    }
    return { code: 'DRAFT_UNAVAILABLE' };
  }
  const runtime = {
    currentVector,
    async handle(
      message: AnyClient,
      c: CampaignConnection,
      shell: CampaignShell,
      send: (message: CampaignHostMessage) => void,
    ): Promise<boolean> {
      const launch =
        message.messageType === 'navigation.form-action' &&
        message.sourceFormId === 'APP-001' &&
        message.actionKey === 'APP-001::CTA::002';
      const campaignWrite = message.messageType === 'campaign.draft.replace';
      const resume = message.messageType === 'campaign.local-context.resume';
      const campaignCommand =
        message.messageType === 'command.request' &&
        message.commandKind === 'workflow-command' &&
        message.workflowCommandId === CAMPAIGN_CREATE_COMMAND_ID;
      if (!launch && !campaignWrite && !resume && !campaignCommand && c.gmLocalContextId === null)
        return false;
      try {
        trust(c);
        if (resume) {
          if (c.gmLocalContextId === null && shell.formId !== null) unavailable();
          if (c.gmLocalContextId !== null && c.gmLocalContextId !== message.gmLocalContextId)
            unavailable();
          const resumed = readLocalGmContext(db, message.gmLocalContextId);
          if (resumed.ownerDeviceId !== loadDeviceId(db)) unavailable();
          c.gmLocalContextId = message.gmLocalContextId;
          context(c);
          c.executableCreate = message.supportedWorkflowCommandIds.includes(
            CAMPAIGN_CREATE_COMMAND_ID,
          );
          shell.enter();
          for (const id of message.unacknowledgedCommandIds) {
            const known = commandAt(resumed, id);
            if (known !== null)
              send({
                messageType: 'command.replay',
                protocolVersion: 1,
                lifecycleState: 'IDEMPOTENT_REPLAY',
                receipt: known.receipt,
              });
            else
              send({
                messageType: 'command.refusal',
                protocolVersion: 1,
                commandId: id,
                lastLifecycleState: null,
                revisions: readCampaignCreationCursor(db, message.gmLocalContextId).revisions,
                refusal: { code: 'GUARD_REJECTED' },
              });
          }
          const target = await snapshot(c, message.reconnectRequestId, 'RECONNECT');
          send({
            messageType: 'session.reconnect.capabilities',
            protocolVersion: 2,
            reconnectRequestId: message.reconnectRequestId,
            revisions: target.revisions,
            executableWorkflowCommandIds: c.executableCreate ? [CAMPAIGN_CREATE_COMMAND_ID] : [],
          });
          send(target);
        } else if (message.messageType === 'navigation.form-action')
          await navigate(message, c, shell, send);
        else if (campaignWrite) await replace(message, c, send);
        else if (campaignCommand) {
          const p = message.payload;
          if (
            Object.keys(p).sort().join(',') !==
              'campaignDraftId,draftRevision,gmLocalContextId,preflightLeaseId,sourceFormId,stage' ||
            p['stage'] !== 'CAMPAIGN_CREATE' ||
            p['sourceFormId'] !== 'CMP-005' ||
            typeof p['campaignDraftId'] !== 'string' ||
            typeof p['gmLocalContextId'] !== 'string' ||
            typeof p['preflightLeaseId'] !== 'string' ||
            !Number.isSafeInteger(p['draftRevision'])
          )
            unavailable();
          await create(message as CampaignCreateRequest, c, send);
        } else unavailable();
      } catch (error) {
        // Refusals never interpolate the raw request or a KDF/library exception.
        const revisions =
          c.trusted() && c.gmLocalContextId !== null
            ? (() => {
                try {
                  return currentVector(c);
                } catch {
                  return zero();
                }
              })()
            : shell.revisions;
        if (message.messageType === 'navigation.form-action') send(navRefusal(message, revisions));
        else if (campaignWrite && c.trusted()) {
          let refusal: CampaignDraftRefusal = { code: 'DRAFT_UNAVAILABLE' };
          try {
            refusal = draftRefusal(error, message, c);
          } catch {
            /* foreign context remains unavailable */
          }
          send({
            messageType: 'campaign.draft.refusal',
            protocolVersion: 3,
            draftUpdateId: message.draftUpdateId,
            scope: message.scope,
            presentationUnchanged: true,
            revisions,
            refusal,
          });
        } else if (campaignCommand)
          send({
            messageType: 'command.refusal',
            protocolVersion: 1,
            commandId: message.commandId,
            lastLifecycleState: null,
            revisions,
            refusal:
              error instanceof CampaignCreationStoreError && error.code === 'IDEMPOTENCY_CONFLICT'
                ? {
                    code: 'IDEMPOTENCY_CONFLICT',
                    commandId: message.commandId,
                    detail: 'PAYLOAD_MISMATCH',
                  }
                : { code: 'GUARD_REJECTED' },
          });
        else
          send({
            messageType: 'protocol.refusal',
            protocolVersion: 1,
            relatedCommandId: null,
            refusal: { code: 'UNRECOGNIZED', path: '$.campaignContext', value: null },
          });
      }
      return true;
    },
  };
  let frames = Promise.resolve();
  return {
    currentVector,
    handle(
      message: AnyClient,
      c: CampaignConnection,
      shell: CampaignShell,
      send: (message: CampaignHostMessage) => void,
    ): Promise<boolean> {
      const launch =
        message.messageType === 'navigation.form-action' &&
        message.sourceFormId === 'APP-001' &&
        message.actionKey === 'APP-001::CTA::002';
      const command =
        message.messageType === 'command.request' &&
        message.commandKind === 'workflow-command' &&
        message.workflowCommandId === CAMPAIGN_CREATE_COMMAND_ID;
      if (
        c.gmLocalContextId === null &&
        !message.messageType.startsWith('campaign.') &&
        !launch &&
        !command
      )
        return Promise.resolve(false);
      // One host serializes GM work across transports; async preparation never
      // lets another GM frame borrow or retire an intermediate lease/snapshot.
      const pending = frames.then(() => runtime.handle(message, c, shell, send));
      frames = pending.then(
        () => {},
        () => {},
      );
      return pending;
    },
  };
}
