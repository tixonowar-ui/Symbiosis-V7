import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JsonObject } from '../shared/wire-protocol.js';
import type { ProjectionSnapshotV2Message } from '../shared/wire-v2-protocol.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from '../shared/device-admission.js';
import { campaignQrPayload } from '../shared/campaign-creation.js';
import {
  openPersistenceDatabase,
  bootstrapDeviceIdentity,
  loadDeviceId,
} from '../persistence/index.js';
import {
  ensureLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  type RedactedCampaignDraftRequest,
} from '../persistence/campaign-creation.js';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import {
  readHostedPausedCampaignIds,
  type HostedNetworkPrincipal,
} from '../persistence/network-device-request.js';
import {
  readLocalNetworkApplication,
  readLocalNetworkOutbox,
} from '../persistence/network-local-application.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import { commitCreationFinalization } from './creation-finalization.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  loadLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { createCampaignNetworkEndpoint } from './campaign-network-endpoint.js';
import { createCampaignNetworkExecutor } from './campaign-network-executor.js';
import { initializeNetworkInstallation, loadNetworkInstallation } from './network-installation.js';
import { campaignPeerPublicIdentity } from './campaign-peer-identity.js';
import { acceptCampaignPeerChannel, connectCampaignPeerChannel } from './campaign-peer-channel.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import { validatePeerCampaignHeader } from './campaign-peer-handshake.js';
import { prepareMasterSecret, validateMasterSecretVerifier } from './campaign-secret.js';
import {
  createDeviceAdmissionPeerRuntime,
  type DeviceAdmissionPeerRuntimeLimits,
} from './device-admission-peer-runtime.js';
import { createLocalNetworkPeer } from './network-local-peer.js';
import type { DeviceAdmissionPeerResponse } from './device-admission-peer-response.js';
import {
  loadNetworkApplicationConfig,
  type NetworkApplicationConfig,
} from './network-application-config.js';
import {
  createLocalNetworkRuntime,
  type LocalNetworkConnection,
  type LocalNetworkShell,
  type LocalNetworkClientMessage,
  type LocalNetworkHostMessage,
} from './network-application.js';
import { isNetworkApplicationProjection } from '../shared/network-application-codec.js';

let baseline: LocalCharacterExportBaseline,
  config: NetworkApplicationConfig,
  secret: Awaited<ReturnType<typeof prepareMasterSecret>>;
let player: Awaited<ReturnType<typeof createCreationFinalizationSetup>>,
  playerMaterial: ReturnType<typeof initializeNetworkInstallation>;
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const vector = (s: typeof zero) => ({
  stateRevision: s.stateRevision,
  projectionRevision: s.projectionRevision,
  actorVisibilityRevision: s.actorVisibilityRevision,
});
const cleaners: (() => Promise<void>)[] = [],
  dirs: string[] = [];
let limits: DeviceAdmissionPeerRuntimeLimits, channelLimits: NetworkApplicationConfig['channel'];
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  config = await loadNetworkApplicationConfig(process.cwd());
  limits = config.transfer;
  channelLimits = config.channel;
  secret = await prepareMasterSecret('Valid fixture secret', 'Valid fixture secret');
  player = await createCreationFinalizationSetup({
    prefix: 'local-application-source',
    raceChoice: 'FREE',
    diceInputMode: 'AUTO',
  });
  const current = commitCreationFinalization(
    player.setup.database,
    creationPropertySummaryRequest(player.current, 'local-source-summary'),
    'local-source-summary-receipt',
    player.dependencies,
  );
  commitCreationFinalization(
    player.setup.database,
    creationFinalSaveRequest(current, 'local-source-final'),
    'local-source-final-receipt',
    player.dependencies,
  );
  playerMaterial = initializeNetworkInstallation(player.setup.database);
});
afterEach(async () => {
  for (const close of cleaners.splice(0).reverse()) await close();
});
afterAll(() => {
  if (player.setup.database.open) player.setup.database.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function client() {
  const dir = mkdtempSync(join(tmpdir(), 'network-app-'));
  dirs.push(dir);
  const path = join(dir, 'player.sqlite');
  return player.setup.database.backup(path).then(() => {
    let db = openPersistenceDatabase(path),
      runtime: ReturnType<typeof createLocalNetworkRuntime>;
    let live = true,
      loseExit = false,
      lastExit: string | null = null,
      shellFinalId = player.setup.characterDraftId,
      shellForm: string | null = 'APP-002',
      shellContext: string | null = randomUUID();
    const sent: LocalNetworkHostMessage[] = [];
    const responses: DeviceAdmissionPeerResponse[] = [];
    const peerErrors: string[] = [];
    const c: LocalNetworkConnection = {
      networkScopeId: null,
      contextId: null,
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
      trusted: () => live && db.open && loadDeviceId(db) === playerMaterial.ownerDeviceId,
    };
    const own = (id: string, formId: 'APP-002' | 'CHR-040'): ProjectionSnapshotV2Message => ({
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'player',
      revisions: zero,
      presentation: {
        assignment: { correlationId: id, reason: 'FORM_ACTION' },
        base: {
          formId,
          formType: 'screen',
          routeTemplate:
            formId === 'APP-002'
              ? '/player'
              : '/player/characters/:localCharacterId/create/chr-040',
          routeBindings:
            formId === 'APP-002'
              ? []
              : [{ parameterIndex: 0, source: 'inherited', value: player.setup.characterDraftId }],
          availableActionKeys: [],
          roleFilteredPayload: {},
        },
        layers: [],
      },
    });
    const shell: LocalNetworkShell = {
      get formId() {
        return shellForm;
      },
      get contextId() {
        return shellContext;
      },
      deviceId: playerMaterial.ownerDeviceId,
      revisions: zero,
      get sourceFinalIdOrNull() {
        return shellForm === 'CHR-040' ? shellFinalId : null;
      },
      get lastNetworkExitNavigationIdOrNull() {
        return lastExit;
      },
      enterNetwork() {
        lastExit = null;
        shellForm = null;
      },
      exitToPlayer(id) {
        if (loseExit) {
          loseExit = false;
          throw new Error('Simulated loss after durable close');
        }
        shellForm = 'APP-002';
        shellContext = randomUUID();
        lastExit = id;
        return own(id, 'APP-002');
      },
      returnToFinal(_source, id) {
        if (loseExit) {
          loseExit = false;
          throw new Error('Simulated loss after durable retained exit');
        }
        shellForm = 'CHR-040';
        shellContext = randomUUID();
        lastExit = id;
        return own(id, 'CHR-040');
      },
    };
    function start() {
      const catalog = player.setup.catalog;
      const peer = createLocalNetworkPeer({ database: db, baseline, config });
      runtime = createLocalNetworkRuntime({
        database: db,
        projectRoot: process.cwd(),
        baseline,
        config,
        postSave: {
          database: db,
          baseline,
          symbiontCatalog: catalog,
          loadCheckpoint: (id) => loadCreationWizardCheckpoint(db, id, catalog.skillStage, catalog),
          resumeForm: (checkpoint) => checkpoint.nextStageEnvelope.formId,
        },
        peer: {
          ...peer,
          async deliver(scope, out) {
            try {
              const value = await peer.deliver(scope, out);
              responses.push(value);
              return value;
            } catch (error) {
              peerErrors.push(error instanceof Error ? (error.stack ?? error.message) : 'unknown');
              throw error;
            }
          },
          async recover(scope, out) {
            const value = await peer.recover(scope, out);
            responses.push(value);
            return value;
          },
        },
        discover: () => Promise.resolve({ offers: [], diagnostics: [], truncated: false }),
      });
    }
    start();
    cleaners.push(() => {
      runtime.close();
      if (db.open) db.close();
      return Promise.resolve();
    });
    const scope = () => ({
      ownerDeviceId: playerMaterial.ownerDeviceId,
      networkScopeId: c.networkScopeId!,
    });
    const state = () => readLocalNetworkApplication(db, scope());
    const send = async (m: LocalNetworkClientMessage) => {
      sent.length = 0;
      expect(await runtime.handle(m, c, shell, (value) => sent.push(value))).toBe(true);
      return sent;
    };
    const nav = async (action: string, from?: string) => {
      const s = c.networkScopeId === null ? null : state();
      const m = {
        messageType: 'navigation.form-action' as const,
        protocolVersion: 2 as const,
        navigationRequestId: randomUUID(),
        sourceFormId: (from ?? s?.formId ?? shellForm) as 'NET-001',
        actionKey: action as 'NET-001::CTA::001',
        expectedProjectionRevision: s?.projectionRevision ?? 0,
      };
      await send(m);
      return m;
    };
    const payload = () => {
      const last = sent.findLast(
        (m) => m.messageType === 'projection.snapshot' || m.messageType === 'network.draft.result',
      );
      if (last === undefined || !('presentation' in last))
        throw new Error('Missing destination ' + JSON.stringify(sent));
      return last.presentation.base.roleFilteredPayload;
    };
    const replace = async (
      variant: 'ADDRESS' | 'SELECTION' | 'CANCEL_REASON',
      values: JsonObject,
    ) => {
      const s = state();
      const m = {
        messageType: 'network.draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          networkScopeId: s.networkScopeId,
          contextId: c.contextId!,
          sourceFormId: s.formId,
        },
        expectedDraftRevision: s.draftRevision,
        expectedRevisions: vector(s),
        variant,
        values,
      } as LocalNetworkClientMessage;
      await send(m);
      return m;
    };
    const command = async (
      id:
        'UI-CMD-CONNECTION-OPEN' | 'UI-CMD-DEVICE-REQUEST-SUBMIT' | 'UI-CMD-DEVICE-REQUEST-CANCEL',
      extras: JsonObject,
    ) => {
      const s = state();
      const m = {
        messageType: 'command.request' as const,
        protocolVersion: 1 as const,
        commandKind: 'workflow-command' as const,
        workflowCommandId: id,
        commandId: randomUUID(),
        role: 'player' as const,
        expectedRevisions: vector(s),
        payload: {
          networkScopeId: s.networkScopeId,
          contextId: c.contextId!,
          expectedDraftRevision: s.draftRevision,
          ...extras,
        },
      };
      await send(m);
      return m;
    };
    return {
      get db() {
        return db;
      },
      path,
      c,
      shell,
      sent,
      responses,
      peerErrors,
      send,
      nav,
      payload,
      replace,
      command,
      state,
      scope,
      revoke() {
        live = false;
      },
      final(sourceId = player.setup.characterDraftId) {
        shellFinalId = sourceId;
        shellForm = 'CHR-040';
        shellContext = randomUUID();
        lastExit = null;
      },
      newPlayerTab() {
        lastExit = null;
        c.networkScopeId = null;
        c.contextId = null;
        shellForm = 'APP-002';
        shellContext = randomUUID();
      },
      laterLocalNavigation() {
        shellForm = 'APP-004';
        shellContext = randomUUID();
        lastExit = null;
      },
      loseNextExit() {
        loseExit = true;
      },
      reopenShell(formId: 'APP-002' | 'CHR-040', sourceId = player.setup.characterDraftId) {
        runtime.close();
        db.close();
        db = openPersistenceDatabase(path);
        c.networkScopeId = null;
        c.contextId = null;
        shellForm = formId;
        shellContext = randomUUID();
        shellFinalId = sourceId;
        lastExit = null;
        start();
      },
      async restart(pending: readonly string[] = [], retiredScope?: string) {
        const id = retiredScope ?? c.networkScopeId!,
          v = retiredScope === undefined ? vector(state()) : zero;
        runtime.close();
        db.close();
        db = openPersistenceDatabase(path);
        c.networkScopeId = null;
        c.contextId = null;
        shellForm = null;
        lastExit = null;
        start();
        await send({
          messageType: 'network.local-context.resume',
          protocolVersion: 3,
          networkScopeId: id,
          reconnectRequestId: randomUUID(),
          knownRevisions: v,
          supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
          unacknowledgedCommandIds: pending,
        });
      },
    };
  });
}

describe('local network application with durable SQLite and real Node peers', () => {
  it('binds an entry before the first NAV fault and refuses a changed envelope after reopen without binding the connection', async () => {
    const p = await client();
    p.db.exec(
      "CREATE TRIGGER abort_entry_nav BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='NAVIGATE' BEGIN SELECT RAISE(ABORT,'entry fault'); END",
    );
    const original = await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.sent.some((m) => m.messageType === 'navigation.form-action.refusal')).toBe(true);
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_tab_entry').get()).toEqual({
      n: 1,
    });
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_application_event').get()).toEqual(
      { n: 0 },
    );
    const originalScope = p.c.networkScopeId;
    p.db.exec('DROP TRIGGER abort_entry_nav');
    p.reopenShell('CHR-040');
    const before = p.db.serialize();
    await p.send({ ...original, sourceFormId: 'CHR-040', actionKey: 'CHR-040::CTA::002' });
    expect(p.sent.some((m) => m.messageType === 'navigation.form-action.refusal')).toBe(true);
    expect(p.c.networkScopeId).toBeNull();
    expect(p.c.contextId).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.send(original);
    expect(p.state().formId).toBe('NET-001');
    expect(p.c.networkScopeId).toBe(originalScope);
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_tab_entry').get()).toEqual({
      n: 1,
    });
  });
  it('restores the original owned FINAL after entry/NAV crash even when a different actual FINAL is now open', async () => {
    const p = await client();
    const second = await createCreationFinalizationSetup({
      prefix: 'second-entry-final',
      characterDraftId: randomUUID(),
      databasePath: p.path,
      raceChoice: 'FREE',
      diceInputMode: 'AUTO',
    });
    try {
      const summary = commitCreationFinalization(
        second.setup.database,
        creationPropertySummaryRequest(second.current, randomUUID()),
        randomUUID(),
        second.dependencies,
      );
      commitCreationFinalization(
        second.setup.database,
        creationFinalSaveRequest(summary, randomUUID()),
        randomUUID(),
        second.dependencies,
      );
    } finally {
      second.setup.database.close();
    }
    p.final();
    p.db.exec(
      "CREATE TRIGGER abort_entry_nav BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='NAVIGATE' BEGIN SELECT RAISE(ABORT,'entry fault'); END",
    );
    const original = await p.nav('CHR-040::CTA::002', 'CHR-040');
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_application_event').get()).toEqual(
      { n: 0 },
    );
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_tab_entry').get()).toEqual({
      n: 1,
    });
    const scope = p.c.networkScopeId;
    p.db.exec('DROP TRIGGER abort_entry_nav');
    p.reopenShell('CHR-040', second.setup.characterDraftId);
    await p.send(original);
    expect(p.state().formId).toBe('CHR-027');
    expect(p.state().selectedCandidates.map((r) => r.sourceUuid)).toEqual([
      player.setup.characterDraftId,
    ]);
    expect(p.c.networkScopeId).toBe(scope);
    const saved = p.db.serialize();
    await p.send(original);
    expect(p.db.serialize().equals(saved)).toBe(true);
    expect(p.state().selectedCandidates.map((r) => r.sourceUuid)).toEqual([
      player.setup.characterDraftId,
    ]);
  }, 15000);
  it('rejects forged entry CTAs before allocation when the negotiated source capabilities are absent', async () => {
    const p = await client();
    for (const missing of [
      'UI-CMD-CONNECTION-OPEN',
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-DEVICE-REQUEST-CANCEL',
    ]) {
      p.newPlayerTab();
      p.c.executableWorkflowCommandIds = NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter(
        (id) => id !== missing,
      );
      const before = p.db.serialize();
      await p.nav('APP-002::CTA::003', 'APP-002');
      expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
      expect(p.c.networkScopeId).toBeNull();
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    p.final();
    p.c.executableWorkflowCommandIds = NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter(
      (id) => id !== 'UI-CMD-CONNECTION-OPEN',
    );
    const before = p.db.serialize();
    await p.nav('CHR-040::CTA::002', 'CHR-040');
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.c.networkScopeId).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('resumes an exact logical tab and releases it only through an explicit exit', async () => {
    const p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.state().formId).toBe('NET-001');
    const first = p.c.networkScopeId;
    await p.restart();
    expect(p.c.networkScopeId).toBe(first);
    // The same physical shell can return only through a published source action.
    await p.nav('NET-001::CTA::003');
    expect(p.c.networkScopeId).toBeNull();
    await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.c.networkScopeId).not.toBe(first);
  });
  it('creates three distinct counted inputs through actual runtime entry and refuses the fourth', async () => {
    const p = await client();
    const scopes: string[] = [];
    for (let i = 0; i < 3; i++) {
      p.newPlayerTab();
      const entry = await p.nav('APP-002::CTA::003', 'APP-002');
      scopes.push(p.c.networkScopeId!);
      const before = p.db.serialize();
      await p.send(entry);
      expect(p.c.networkScopeId).toBe(scopes[i]);
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    expect(new Set(scopes).size).toBe(3);
    p.newPlayerTab();
    const before = p.db.serialize();
    await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(p.c.networkScopeId).toBeNull();
  });
  it('recovers a committed exit after lost delivery and SQLite reopen without recreating a tab', async () => {
    const p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    const retiredScope = p.c.networkScopeId!;
    p.loseNextExit();
    const closedNavigation = await p.nav('NET-001::CTA::003');
    const before = p.db.serialize();
    await p.restart([], retiredScope);
    expect(p.sent).toHaveLength(2);
    expect(p.sent[0]).toMatchObject({
      messageType: 'session.reconnect.capabilities',
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
    });
    expect(p.sent[1]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'RECONNECT' }, base: { formId: 'APP-002' } },
    });
    expect(p.c.networkScopeId).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.send(closedNavigation);
    expect(p.sent[0]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'FORM_ACTION' }, base: { formId: 'APP-002' } },
    });
    p.laterLocalNavigation();
    const later = p.db.serialize();
    await p.send(closedNavigation);
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.shell.formId).toBe('APP-004');
    expect(p.db.serialize().equals(later)).toBe(true);
  });
  it('records definite pre-OPEN failures and plans distinct retries without reusing an old command identity', async () => {
    const unavailableHost = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => unavailableHost.listen(0, '127.0.0.1', resolve));
    cleaners.push(() => new Promise<void>((resolve) => unavailableHost.close(() => resolve())));
    const bound = unavailableHost.address();
    if (bound === null || typeof bound === 'string') throw new Error('Actual listener required');
    const p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', bound.port, randomUUID()),
    });
    const firstAttempt = p.state().plannedAttemptIdOrNull;
    const first = await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: firstAttempt,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-011');
    expect(p.state().lastAttemptIdOrNull).toBe(firstAttempt);
    const retry = p.state().plannedAttemptIdOrNull;
    expect(retry).not.toBe(firstAttempt);
    const before = p.db.serialize();
    await p.send(first);
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.send({ ...first, payload: { ...first.payload, attemptId: retry } });
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: retry,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    expect(p.state().lastAttemptIdOrNull).toBe(retry);
    expect(p.state().plannedAttemptIdOrNull).not.toBe(retry);
    expect(p.payload()['retryCount']).toBe(1);
    expect(p.state().pendingCommandIdOrNull).toBeNull();
    await p.restart([first.commandId]);
    expect(p.state().lastAttemptIdOrNull).toBe(retry);
  });
  it('retains a confirmed UNBOUND session across a lost return to FINAL and clears only its exit marker on new entry', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::002');
    const before = p.state(),
      scope = p.scope();
    p.loseNextExit();
    const leaving = await p.nav('CHR-027::CTA::002');
    const saved = readLocalNetworkApplication(p.db, scope);
    expect(saved.sessionOrNull).toEqual(before.sessionOrNull);
    expect(saved.stateRevision).toBe(before.stateRevision);
    expect(saved.projectionRevision).toBe(before.projectionRevision + 1);
    expect(saved.shellExitOrNull).toEqual({
      navigationRequestId: leaving.navigationRequestId,
      sourceUuid: player.setup.characterDraftId,
    });
    const bytes = p.db.serialize();
    await p.restart([], scope.networkScopeId);
    expect(p.sent[1]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'RECONNECT' }, base: { formId: 'CHR-040' } },
    });
    expect(p.db.serialize().equals(bytes)).toBe(true);
    await p.send(leaving);
    expect(p.sent[0]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'FORM_ACTION' }, base: { formId: 'CHR-040' } },
    });
    p.laterLocalNavigation();
    const later = p.db.serialize();
    await p.send(leaving);
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.shell.formId).toBe('APP-004');
    expect(p.db.serialize().equals(later)).toBe(true);
    p.final();
    await p.nav('CHR-040::CTA::002', 'CHR-040');
    expect(p.c.networkScopeId).toBe(scope.networkScopeId);
    expect(p.state().shellExitOrNull).toBeNull();
    expect(p.state().sessionOrNull).toEqual(before.sessionOrNull);
    const newEntry = p.db.serialize();
    await p.send(leaving);
    expect(p.db.serialize().equals(newEntry)).toBe(true);
    expect(p.c.networkScopeId).toBe(scope.networkScopeId);
  }, 15000);
  it('opens, pins real FINAL bytes, submits and cancels with exact replay after a complete local restart', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    const opening = await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    expect(
      p.state().formId,
      JSON.stringify({ sent: p.sent, responses: p.responses, remoteErrors: h.errors }),
    ).toBe('NET-003');
    const candidates = p.payload()['eligibleFinalCandidates'] as readonly JsonObject[];
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::001');
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-004');
    const batch = p.state().preparedBatchOrNull!;
    const submit = await p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      connectionRevision: batch.connectionRevision,
      selectedCandidates: p.state().selectedCandidates,
    });
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    const original = p.sent.find((m) => m.messageType === 'command.result');
    expect(original).toBeDefined();
    const serialized = JSON.stringify(p.sent);
    for (const value of [
      'canonicalWitnessText',
      'privateKeyPkcs8Base64',
      'learnedNodeRefs',
      'privateVerifier',
    ])
      expect(serialized).not.toContain(value);
    await p.restart([submit.commandId]);
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    expect(p.sent.find((m) => m.messageType === 'command.replay')).toMatchObject({
      receipt: (original as Extract<LocalNetworkHostMessage, { messageType: 'command.result' }>)
        .receipt,
    });
    expect(isNetworkApplicationProjection('NET-005', p.payload())).toBe(true);
    const before = p.db.serialize();
    await p.send({ ...submit, payload: { ...submit.payload, contextId: randomUUID() } });
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(p.db.serialize().equals(before)).toBe(true);
    const oversizedReason = 'r'.repeat(70 * 1024);
    await p.replace('CANCEL_REASON', { cancelReason: oversizedReason });
    const oversizedBefore = p.db.serialize(),
      pendingRequest = p.state().requestOrNull!;
    const oversizedCancel = await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
      requestId: pendingRequest.requestId,
      technicalSessionId: pendingRequest.technicalSessionId,
      requestRevision: pendingRequest.requestRevision,
      reason: oversizedReason,
    });
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.refusal',
      commandId: oversizedCancel.commandId,
    });
    expect(readLocalNetworkOutbox(p.db, p.scope(), oversizedCancel.commandId)).toBeNull();
    expect(p.state().pendingCommandIdOrNull).toBeNull();
    expect(p.state().cancelReason).toBe(oversizedReason);
    expect(p.db.serialize().equals(oversizedBefore)).toBe(true);
    await p.replace('CANCEL_REASON', { cancelReason: 'Changed selection' });
    const request = p.state().requestOrNull!;
    const cancel = await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
      requestId: request.requestId,
      technicalSessionId: request.technicalSessionId,
      requestRevision: request.requestRevision,
      reason: 'Changed selection',
    });
    expect(
      p.state().formId,
      JSON.stringify({
        sent: p.sent,
        responses: p.responses,
        peerErrors: p.peerErrors,
        remoteErrors: h.errors,
        remoteCommands: h.db.prepare('SELECT operation FROM hosted_network_command').all(),
      }),
    ).toBe('NET-003');
    await p.restart([opening.commandId, submit.commandId, cancel.commandId]);
    expect(p.state().formId).toBe('NET-003');
    expect(p.sent.filter((m) => m.messageType === 'command.replay')).toHaveLength(3);
    expect(
      readLocalNetworkOutbox(p.db, p.scope(), cancel.commandId)?.acknowledgementOrNull?.operation,
    ).toBe('CANCEL');
  }, 30000);
  it.each([false, true])(
    'recovers an offline confirmed OPEN without a new attempt, with prepared batch %s',
    async (prepareBatch) => {
      const dir = mkdtempSync(join(tmpdir(), 'network-confirmed-offline-'));
      dirs.push(dir);
      const path = join(dir, 'host.sqlite');
      let h = await host({ path });
      const p = await client();
      const hostOptions = { path, port: h.port, campaignId: h.campaignId };
      await p.nav('APP-002::CTA::003', 'APP-002');
      await p.nav('NET-001::CTA::001');
      await p.replace('ADDRESS', {
        addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
      });
      const opening = await p.command('UI-CMD-CONNECTION-OPEN', {
        attemptId: p.state().plannedAttemptIdOrNull,
        addressOrQrPayload: p.state().addressOrQrPayload,
        selectedCampaignIdOrNull: null,
      });
      expect(p.state().formId).toBe('NET-003');
      const original = p.sent.find((m) => m.messageType === 'command.result');
      expect(original).toBeDefined();
      if (prepareBatch) {
        const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
        const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
        await p.replace('SELECTION', { selectedCandidates: [ref] });
        await p.nav('NET-003::CTA::001');
      }
      const confirmed = p.state();
      const actions = () => {
        const view = p.sent.findLast(
          (m) => m.messageType === 'projection.snapshot' && m.protocolVersion === 2,
        );
        if (view?.messageType !== 'projection.snapshot' || view.protocolVersion !== 2)
          throw new Error('Missing network view');
        return view.presentation.base.availableActionKeys;
      };
      await h.close();
      await p.restart([opening.commandId]);
      expect(p.state()).toMatchObject({
        formId: 'NET-011',
        sessionOrNull: confirmed.sessionOrNull,
        plannedAttemptIdOrNull: confirmed.plannedAttemptIdOrNull,
        pendingCommandIdOrNull: null,
      });
      expect(p.payload()['retryAttemptIdOrNull']).toBeNull();
      expect(actions()).toEqual(['NET-011::CTA::004', 'NET-011::CTA::005']);
      expect(p.sent.find((m) => m.messageType === 'command.replay')).toMatchObject({
        receipt: (original as Extract<LocalNetworkHostMessage, { messageType: 'command.result' }>)
          .receipt,
      });
      if (!prepareBatch) {
        await p.nav('NET-011::CTA::004');
        expect(p.state().formId).toBe('NET-002');
        expect(p.state().plannedAttemptIdOrNull).toBe(confirmed.plannedAttemptIdOrNull);
        expect(actions()).toEqual(['NET-002::CTA::001']);
        h = await host(hostOptions);
        await p.restart();
        expect(actions()).toEqual(['NET-002::CTA::001', 'NET-002::CTA::002']);
        await p.nav('NET-002::CTA::002');
        expect(p.state().formId).toBe('NET-003');
        await h.close();
        await p.restart();
      }
      const beforeRecovery = p.state();
      h = await host(hostOptions);
      await p.restart([opening.commandId]);
      expect(p.state()).toMatchObject({
        formId: prepareBatch ? 'NET-004' : 'NET-003',
        stateRevision: beforeRecovery.stateRevision,
        projectionRevision: beforeRecovery.projectionRevision + 1,
        sessionOrNull: confirmed.sessionOrNull,
        preparedBatchOrNull: confirmed.preparedBatchOrNull,
        plannedAttemptIdOrNull: confirmed.plannedAttemptIdOrNull,
      });
      expect(h.db.prepare('SELECT operation FROM hosted_network_command').all()).toEqual([
        { operation: 'OPEN' },
      ]);
      expect(p.db.prepare('SELECT COUNT(*) AS count FROM local_network_outbox').get()).toEqual({
        count: 1,
      });
      const recovered = p.state();
      await p.restart();
      expect(p.state()).toEqual(recovered);
      await h.close();
      await p.restart();
      await p.nav('NET-011::CTA::005');
      expect(p.c.networkScopeId).toBeNull();
      expect(p.sent.findLast((m) => m.messageType === 'projection.snapshot')).toMatchObject({
        presentation: { base: { formId: 'APP-002' } },
      });
    },
    30000,
  );
  it('keeps an unresolved SUBMIT after local ACK failure and recovers the same remote request after reopen', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    // A fresh physical connection must restore an acknowledged OPEN before the first SUBMIT.
    await p.restart();
    expect(p.state().formId).toBe('NET-003');
    const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::001');
    const batch = p.state().preparedBatchOrNull!;
    p.db.exec(
      "CREATE TRIGGER fail_local_ack BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='ACKNOWLEDGE' BEGIN SELECT RAISE(ABORT,'local ACK interrupted'); END",
    );
    const submit = await p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      connectionRevision: batch.connectionRevision,
      selectedCandidates: p.state().selectedCandidates,
    });
    expect(
      p.sent.some((m) => m.messageType === 'command.result' || m.messageType === 'command.refusal'),
    ).toBe(false);
    const pending = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)!;
    expect(pending.acknowledgementOrNull).toBeNull();
    expect(p.state().pendingCommandIdOrNull).toBe(submit.commandId);
    expect(
      h.db
        .prepare("SELECT COUNT(*) AS count FROM hosted_network_command WHERE operation='SUBMIT'")
        .get(),
    ).toEqual({ count: 1 });
    p.db.exec('DROP TRIGGER fail_local_ack');
    await p.restart([submit.commandId]);
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    const recovered = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)!;
    expect(recovered.intent).toEqual(pending.intent);
    expect(recovered.acknowledgementOrNull?.operation).toBe('SUBMIT');
    expect(p.sent.some((m) => m.messageType === 'command.replay')).toBe(true);
    expect(
      h.db
        .prepare("SELECT COUNT(*) AS count FROM hosted_network_command WHERE operation='SUBMIT'")
        .get(),
    ).toEqual({ count: 1 });
  }, 30000);
});
async function host(
  options: {
    path?: string;
    port?: number;
    campaignId?: string;
    capacity?: number;
    limits?: Partial<DeviceAdmissionPeerRuntimeLimits>;
  } = {},
) {
  const db = openPersistenceDatabase(options.path ?? ':memory:');
  bootstrapDeviceIdentity(db);
  initializeNetworkInstallation(db);
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => http.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('Actual endpoint required');
  const bind = createCampaignBindManager({
    readShellListener: () => (http.listening ? { address: '127.0.0.1', port: address.port } : null),
  });
  const loopback = bind.interfaces().find((i) => i.hostAddress === '127.0.0.1');
  if (loopback === undefined) throw new Error('Actual loopback missing');
  const owner = loadDeviceId(db),
    validate = (
      p: Parameters<typeof readHostedCurrentPausedCampaign>[2] extends (p: infer P) => void
        ? P
        : never,
    ) => {
      validateMasterSecretVerifier(p.verifier);
    };
  const ids = readHostedPausedCampaignIds(db, validate);
  let campaignId: string;
  if (options.campaignId !== undefined) {
    if (!ids.includes(options.campaignId)) throw new Error('Expected persisted campaign');
    campaignId = options.campaignId;
  } else {
    campaignId = randomUUID();
    const context = randomUUID(),
      draftId = randomUUID();
    const owned = () => {
      if (loadDeviceId(db) !== owner || !http.listening)
        throw new Error('Real source ownership unavailable');
    };
    ensureLocalGmProfile(db, { ownerDeviceId: owner, masterProfileId: randomUUID() }, owned);
    // read the real profile id through its public owner reader rather than inventing another owner.
    const { readLocalGmProfile } = await import('../persistence/campaign-creation.js');
    createLocalGmContext(
      db,
      {
        ownerDeviceId: owner,
        masterProfileId: readLocalGmProfile(db, owner)!.masterProfileId,
        gmLocalContextId: context,
      },
      owned,
    );
    createCampaignDraft(
      db,
      { gmLocalContextId: context, campaignDraftId: draftId, expectedRevisions: zero },
      owned,
    );
    for (const stage of [
      {
        form: 'CMP-001',
        variant: 'METADATA',
        values: { title: 'Actual peer campaign', description: null, art: null },
      },
      {
        form: 'CMP-002',
        variant: 'HOST',
        values: {
          hostAddress: '127.0.0.1',
          hostPort: address.port,
          networkInterface: loopback.networkInterface,
          activePlayerCapacity: options.capacity ?? 3,
        },
      },
      { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
      { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
    ] as const) {
      let draft = readCampaignDraft(db, context, draftId);
      if (draft.formId !== stage.form) {
        navigateCampaignDraft(
          db,
          {
            gmLocalContextId: context,
            campaignDraftId: draftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: vector(draft),
            sourceFormId: draft.formId,
            targetFormId: stage.form,
          },
          owned,
        );
        draft = readCampaignDraft(db, context, draftId);
      }
      commitCampaignDraftUpdate(
        db,
        {
          request: {
            messageType: 'campaign.draft.replace',
            protocolVersion: 3,
            draftUpdateId: randomUUID(),
            scope: {
              gmLocalContextId: context,
              campaignDraftId: draftId,
              sourceFormId: stage.form,
            },
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: vector(draft),
            variant: stage.variant,
            values: stage.values,
          } as RedactedCampaignDraftRequest,
          ...(stage.variant === 'SECRET'
            ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: { ...secret } } }
            : {}),
        },
        owned,
      );
    }
    let draft = readCampaignDraft(db, context, draftId);
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId: context,
        campaignDraftId: draftId,
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: vector(draft),
        sourceFormId: draft.formId,
        targetFormId: 'CMP-005',
      },
      owned,
    );
    draft = readCampaignDraft(db, context, draftId);
    const preflight = await bind.prepare(draftId, draft.values.host);
    if (preflight.status !== 'PASS') throw new Error('Actual bind failed');
    commitCampaignCreation(
      db,
      {
        campaignId,
        receiptId: randomUUID(),
        createdAt: '2026-10-30T10:00:00.000Z',
        qrPayload: campaignQrPayload('127.0.0.1', address.port, campaignId),
        baselineVersion: baseline.baselineVersion,
        request: {
          protocolVersion: 1,
          messageType: 'command.request',
          commandKind: 'workflow-command',
          workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
          role: 'gm',
          commandId: randomUUID(),
          expectedRevisions: vector(draft),
          payload: {
            stage: 'CAMPAIGN_CREATE',
            sourceFormId: 'CMP-005',
            gmLocalContextId: context,
            campaignDraftId: draftId,
            draftRevision: draft.draftRevision,
            preflightLeaseId: preflight.leaseIdOrNull!,
          },
        },
      },
      (fresh, ctx) => {
        owned();
        if (
          ctx.ownerDeviceId !== owner ||
          fresh.currentVerifier === null ||
          !bind.validate(preflight.leaseIdOrNull!, draftId, fresh.values.host)
        )
          throw new Error('Real CREATE source changed');
        validateMasterSecretVerifier(fresh.currentVerifier);
      },
    );
    bind.retainForCampaign(draftId, campaignId);
  }
  const header = () => readHostedCurrentPausedCampaign(db, campaignId, validate);
  if (options.campaignId !== undefined) {
    const h = header();
    if (
      (
        await bind.recover(campaignId, {
          ...h.bindConfiguration,
          activePlayerCapacity: h.activePlayerCapacity,
        })
      ).status !== 'RESERVED'
    )
      throw new Error('Real recovery bind failed');
  }
  const publicHeader = () => {
    const h = header();
    return validatePeerCampaignHeader({
      campaignId: h.campaignId,
      title: h.title,
      status: h.status,
      activePlayerCapacity: h.activePlayerCapacity,
      activePcCount: h.activePcCount,
      checkpointSha256: h.checkpointSha256,
      baselineVersion: h.baselineVersion,
      revisions: vector(h),
    });
  };
  const ex = createCampaignNetworkExecutor(config.executor),
    runtime = createDeviceAdmissionPeerRuntime({
      database: db,
      baseline,
      executor: ex,
      limits: { ...limits, ...options.limits },
    });
  const errors: string[] = [];
  const endpoint = createCampaignNetworkEndpoint({
    maxConnections: config.transfer.maxChannels,
    shellServer: http,
    bind,
    readPublicCampaignHeaders: (published) =>
      published.map((id) => {
        if (id !== campaignId) throw new Error('Unpublished');
        return publicHeader();
      }),
    onError: (e) => {
      errors.push(e.code);
    },
    accept: async (socket, request, published) => {
      const channel = await acceptCampaignPeerChannel(socket, request, {
        limits: channelLimits,
        resolveCampaign: (id) =>
          id === campaignId && published.includes(id)
            ? { hostMaterial: loadNetworkInstallation(db), campaign: publicHeader() }
            : null,
      });
      await runtime.run(channel);
    },
  });
  endpoint.publishCampaign(campaignId);
  let closed = false;
  const clients: Awaited<ReturnType<typeof connectCampaignPeerChannel>>[] = [];
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const client of clients) client.close();
    await runtime.close();
    await endpoint.close();
    ex.close();
    await bind.close();
    http.closeAllConnections();
    if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    if (db.open) db.close();
  };
  cleaners.push(close);
  const connect = async (material = playerMaterial) => {
    const client = await connectCampaignPeerChannel({
      target: parseCampaignLanAddress(`http://127.0.0.1:${String(address.port)}`),
      campaignId,
      deviceMaterial: material,
      hostTrust: {
        kind: 'PINNED',
        identity: campaignPeerPublicIdentity(loadNetworkInstallation(db)),
      },
      limits: channelLimits,
    });
    clients.push(client);
    return client;
  };
  const principal: HostedNetworkPrincipal = {
    hostOwnerDeviceId: owner,
    campaignId,
    peerIdentity: campaignPeerPublicIdentity(playerMaterial),
  };
  return {
    db,
    campaignId,
    port: address.port,
    header,
    principal,
    validate,
    runtime,
    connect,
    close,
    errors,
  };
}
