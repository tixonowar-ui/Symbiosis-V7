import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir, type NetworkInterfaceInfo } from 'node:os';
import { join, resolve } from 'node:path';
import type * as Crypto from 'node:crypto';
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  CampaignCreateRequest,
  CampaignDraftReplaceV3Message,
} from '../shared/campaign-creation.js';
import type { FormActionIntentV2Message, JsonObject, PresentedBaseForm } from '../shared/index.js';
import { decodeHostMessageV3 } from '../shared/index.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from '../persistence/device-identity.js';
import {
  readCampaignCreationCursor,
  readCampaignDraft,
  readCampaignDraftUpdate,
  campaignCreationHash,
} from '../persistence/campaign-creation.js';
import { CAMPAIGN_CREATION_TABLES } from '../persistence/migrations/0007-campaign-creation.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import {
  createCampaignCreationRuntime,
  type CampaignConnection,
  type CampaignShell,
  type CampaignHostMessage,
} from './campaign-creation.js';
import {
  loadLocalCharacterExportBaseline,
  canonicalPostSaveJson,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});
const projectRoot = resolve('.');
let baseline: LocalCharacterExportBaseline;
let vocabulary: Awaited<ReturnType<typeof loadProtocolVocabulary>>;
beforeAll(async () => {
  [baseline, vocabulary] = await Promise.all([
    loadLocalCharacterExportBaseline(projectRoot),
    loadProtocolVocabulary(projectRoot),
  ]);
});
const databases: Database.Database[] = [];
const dirs: string[] = [];
const binds: ReturnType<typeof createCampaignBindManager>[] = [];
const servers: Server[] = [];
const open = (path: string) => {
  const db = openPersistenceDatabase(path);
  databases.push(db);
  return db;
};
const close = async (server: Server) => {
  if (server.listening)
    await new Promise<void>((done, fail) =>
      server.close((error) => (error === undefined ? done() : fail(error))),
    );
};
afterEach(async () => {
  await Promise.all(binds.splice(0).map((bind) => bind.close()));
  await Promise.all(servers.splice(0).map(close));
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});
const local: NetworkInterfaceInfo = {
  address: '127.0.0.1',
  family: 'IPv4',
  internal: true,
  netmask: '255.0.0.0',
  mac: '00:00:00:00:00:00',
  cidr: '127.0.0.1/8',
};
const bindManager = () => {
  const bind = createCampaignBindManager({
    readShellListener: () => null,
    readNetworkInterfaces: () => ({ local: [local] }),
  });
  binds.push(bind);
  return bind;
};
async function listen(port = 0) {
  const server = createServer((socket) => socket.destroy());
  servers.push(server);
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.off('error', fail);
      done();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing test address');
  return { server, port: address.port };
}
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const PASSWORD = 'Campaign-secret-123';
const SECOND_PASSWORD = 'Different-secret-123';
function storageSnapshot(db: Database.Database) {
  return Object.fromEntries(
    [...CAMPAIGN_CREATION_TABLES, 'campaign', 'campaign_checkpoint', 'campaign_character_copy'].map(
      (table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()],
    ),
  );
}
function shellContext(initialFormId: string | null = 'APP-001'): CampaignShell {
  let revisions = { ...zero };
  let formId: string | null = initialFormId;
  const base = (): PresentedBaseForm => ({
    formId: 'APP-001',
    formType: 'screen',
    routeTemplate: '/',
    routeBindings: [],
    availableActionKeys: [],
    roleFilteredPayload: {},
  });
  return {
    get formId() {
      return formId;
    },
    get revisions() {
      return revisions;
    },
    ready: true,
    advance: () => {
      revisions = { ...revisions, projectionRevision: revisions.projectionRevision + 1 };
      return revisions;
    },
    base,
    enter: () => {
      formId = null;
    },
    exit: () => {
      formId = 'APP-001';
    },
  };
}
function harness(db: Database.Database, root = projectRoot, contextId: string | null = null) {
  const bind = bindManager();
  const runtime = createCampaignCreationRuntime({
    database: db,
    projectRoot: root,
    baseline,
    bind,
  });
  let trusted = true;
  const connection: CampaignConnection = {
    gmLocalContextId: contextId,
    executableCreate: false,
    trusted: () => trusted,
  };
  const shell = shellContext();
  const messages: CampaignHostMessage[] = [];
  let counter = 0;
  const send = async (message: Parameters<typeof runtime.handle>[0]) => {
    const received: CampaignHostMessage[] = [];
    expect(
      await runtime.handle(message, connection, shell, (item) => {
        received.push(item);
        messages.push(item);
      }),
    ).toBe(true);
    return received;
  };
  const ctx = () => {
    if (connection.gmLocalContextId === null) throw new Error('test context absent');
    return connection.gmLocalContextId;
  };
  const cursor = () => readCampaignCreationCursor(db, ctx());
  const draft = () => {
    const at = cursor();
    if (at.kind !== 'DRAFT') throw new Error('test draft absent');
    return readCampaignDraft(db, ctx(), at.targetId);
  };
  const resume = async (ids: readonly string[] = []) =>
    send({
      messageType: 'campaign.local-context.resume',
      protocolVersion: 3,
      gmLocalContextId: ctx(),
      reconnectRequestId: `resume-${++counter}`,
      knownRevisions: zero,
      supportedWorkflowCommandIds: ['UI-CMD-CAMPAIGN-CREATE'],
      unacknowledgedCommandIds: ids,
    });
  const nav = async (actionKey: string) => {
    const current =
      connection.gmLocalContextId === null
        ? { formId: 'APP-001', revisions: shell.revisions }
        : cursor();
    return send({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: `nav-${++counter}`,
      sourceFormId: current.formId,
      actionKey,
      expectedProjectionRevision: current.revisions.projectionRevision,
    } as FormActionIntentV2Message);
  };
  const replace = async (
    variant: 'METADATA' | 'HOST' | 'SECRET' | 'MODE',
    values: JsonObject,
    id = `update-${++counter}`,
  ) => {
    const at = draft();
    const request = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: id,
      scope: {
        gmLocalContextId: ctx(),
        campaignDraftId: at.campaignDraftId,
        sourceFormId: at.formId,
      },
      variant,
      values,
      expectedDraftRevision: at.draftRevision,
      expectedRevisions: cursor().revisions,
    } as CampaignDraftReplaceV3Message;
    return { request, messages: await send(request) };
  };
  const snapshotPayload = () => {
    const last = messages.findLast(
      (message) => message.messageType === 'projection.snapshot' && message.protocolVersion === 2,
    );
    if (last?.messageType !== 'projection.snapshot' || last.protocolVersion !== 2)
      throw new Error('test snapshot absent');
    return last.presentation.base.roleFilteredPayload;
  };
  const createRequest = (): CampaignCreateRequest => {
    const at = draft();
    const p = snapshotPayload();
    const lease = p['hostBindPreflight'] as JsonObject;
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandId: 'create-command',
      commandKind: 'workflow-command',
      workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
      role: 'gm',
      expectedRevisions: cursor().revisions,
      payload: {
        stage: 'CAMPAIGN_CREATE',
        sourceFormId: 'CMP-005',
        gmLocalContextId: ctx(),
        campaignDraftId: at.campaignDraftId,
        draftRevision: at.draftRevision,
        preflightLeaseId:
          typeof lease['leaseIdOrNull'] === 'string' ? lease['leaseIdOrNull'] : 'unavailable-lease',
      },
    };
  };
  return {
    db,
    bind,
    runtime,
    connection,
    messages,
    send,
    nav,
    resume,
    replace,
    cursor,
    draft,
    snapshotPayload,
    createRequest,
    deny: () => {
      trusted = false;
    },
    ctx,
  };
}
async function setup(root = projectRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'symbiosis-campaign-runtime-'));
  dirs.push(dir);
  const path = join(dir, 'state.sqlite');
  const db = open(path);
  bootstrapDeviceIdentity(db);
  const h = harness(db, root);
  await h.nav('APP-001::CTA::002');
  await h.resume();
  await h.nav('APP-011::CTA::006');
  return { ...h, path };
}
async function ready(h: ReturnType<typeof harness>, port: number) {
  expect(
    (
      await h.replace('METADATA', {
        title: 'Runtime campaign',
        description: 'Private game notes',
        art: null,
      })
    ).messages[0]?.messageType,
  ).toBe('campaign.draft.result');
  await h.nav('CMP-001::CTA::001');
  await h.replace('HOST', {
    activePlayerCapacity: 3,
    hostAddress: '127.0.0.1',
    hostPort: port,
    networkInterface: 'local',
  });
  await h.nav('CMP-002::CTA::002');
  await h.replace(
    'SECRET',
    { masterTransferPassword: PASSWORD, masterTransferPasswordConfirmation: PASSWORD },
    'secret-A',
  );
  await h.nav('CMP-003::CTA::002');
  await h.replace('MODE', { defaultFutureRollMode: 'MANUAL' });
  await h.nav('CMP-004::CTA::002');
  expect(h.cursor().formId).toBe('CMP-005');
}
async function freePort() {
  const listener = await listen();
  await close(listener.server);
  return listener.port;
}

describe('campaign creation runtime with real SQLite and TCP bind', () => {
  it('serializes metadata frames across two connections and emits independently decodable revision-consistent results', async () => {
    const h = await setup();
    const at = h.draft();
    const first: CampaignDraftReplaceV3Message = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: 'concurrent-A',
      expectedDraftRevision: 0,
      expectedRevisions: zero,
      scope: {
        gmLocalContextId: h.ctx(),
        campaignDraftId: at.campaignDraftId,
        sourceFormId: 'CMP-001',
      },
      variant: 'METADATA',
      values: { title: 'First version', description: null, art: null },
    };
    const second: CampaignDraftReplaceV3Message = {
      ...first,
      draftUpdateId: 'concurrent-B',
      expectedDraftRevision: 1,
      expectedRevisions: { ...zero, stateRevision: 1, projectionRevision: 1 },
      values: { title: 'Second version', description: 'Later notes', art: null },
    };
    const other: CampaignConnection = { ...h.connection };
    const otherMessages: CampaignHostMessage[] = [];
    const [firstMessages, handled] = await Promise.all([
      h.send(first),
      h.runtime.handle(second, other, shellContext(null), (message) => otherMessages.push(message)),
    ]);
    expect(handled).toBe(true);
    for (const [messages, revision, title, id] of [
      [firstMessages, 1, 'First version', 'concurrent-A'],
      [otherMessages, 2, 'Second version', 'concurrent-B'],
    ] as const) {
      expect(messages).toHaveLength(1);
      const result = messages[0];
      expect(result).toMatchObject({
        messageType: 'campaign.draft.result',
        draftUpdateId: id,
        appliedDraftRevision: revision,
        draftRevision: revision,
        appliedRevisions: {
          stateRevision: revision,
          projectionRevision: revision,
          actorVisibilityRevision: 0,
        },
        revisions: {
          stateRevision: revision,
          projectionRevision: revision,
          actorVisibilityRevision: 0,
        },
        presentation: {
          base: { formId: 'CMP-001', roleFilteredPayload: { title, draftRevision: revision } },
        },
      });
      expect(decodeHostMessageV3(JSON.stringify(result), vocabulary)).toEqual({
        ok: true,
        value: result,
      });
    }
    expect(h.draft()).toMatchObject({
      draftRevision: 2,
      stateRevision: 2,
      projectionRevision: 2,
      values: { metadata: { title: 'Second version' } },
    });
    expect(h.db.prepare('SELECT count(*) AS count FROM campaign_draft_update').get()).toEqual({
      count: 2,
    });
    expect(h.db.prepare('SELECT * FROM campaign_checkpoint').all()).toEqual([]);
  });
  it('keeps the winning real bind lease when a concurrent stale forward navigation is refused', async () => {
    const h = await setup();
    const port = await freePort();
    await ready(h, port);
    await h.nav('CMP-005::CTA::002');
    const before = h.draft();
    const beforeCheckpoint = h.db.prepare('SELECT * FROM campaign_checkpoint').all();
    expect(before.formId).toBe('CMP-004');
    expect(h.bind.describe(before.campaignDraftId, before.values.host).status).not.toBe('PASS');
    const winner: FormActionIntentV2Message = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: 'concurrent-forward-A',
      sourceFormId: 'CMP-004',
      actionKey: 'CMP-004::CTA::002',
      expectedProjectionRevision: before.projectionRevision,
    };
    const loser = { ...winner, navigationRequestId: 'concurrent-forward-B' };
    const other: CampaignConnection = { ...h.connection };
    const otherMessages: CampaignHostMessage[] = [];
    const [winnerMessages, handled] = await Promise.all([
      h.send(winner),
      h.runtime.handle(loser, other, shellContext(null), (message) => otherMessages.push(message)),
    ]);
    expect(handled).toBe(true);
    const after = h.draft();
    expect(after).toMatchObject({
      formId: 'CMP-005',
      stateRevision: before.stateRevision,
      draftRevision: before.draftRevision,
      projectionRevision: before.projectionRevision + 1,
    });
    expect(winnerMessages).toMatchObject([
      {
        messageType: 'projection.snapshot',
        presentation: {
          base: {
            formId: 'CMP-005',
            roleFilteredPayload: { hostBindPreflight: { status: 'PASS' } },
          },
        },
      },
    ]);
    expect(otherMessages).toMatchObject([
      {
        messageType: 'navigation.form-action.refusal',
        presentationUnchanged: true,
        revisions: {
          stateRevision: after.stateRevision,
          projectionRevision: after.projectionRevision,
          actorVisibilityRevision: 0,
        },
      },
    ]);
    expect(h.db.prepare('SELECT * FROM campaign_checkpoint').all()).toEqual(beforeCheckpoint);
    const lease = h.bind.describe(after.campaignDraftId, after.values.host);
    expect(lease.status).toBe('PASS');
    expect(lease.leaseIdOrNull).not.toBeNull();
    expect(
      h.bind.validate(lease.leaseIdOrNull ?? '', after.campaignDraftId, after.values.host),
    ).toBe(true);
    await expect(listen(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const create = h.createRequest();
    expect(create.payload.preflightLeaseId).toBe(lease.leaseIdOrNull);
    expect((await h.send(create))[0]?.messageType).toBe('command.result');
    expect(h.db.prepare('SELECT count(*) AS count FROM campaign_checkpoint').get()).toEqual({
      count: 1,
    });
  });
  it('reuses the exact device-owned context on a fresh explicit Master launch and resumes its draft or paused campaign', async () => {
    const h = await setup();
    const contextId = h.ctx();
    const freshLaunch = async (expectedForm: 'CMP-001' | 'CMP-006') => {
      const before = storageSnapshot(h.db);
      const cursor = h.cursor();
      const c: CampaignConnection = {
        gmLocalContextId: null,
        executableCreate: false,
        trusted: () => true,
      };
      const shell = shellContext();
      const received: CampaignHostMessage[] = [];
      await h.runtime.handle(
        {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: `fresh-${expectedForm}`,
          sourceFormId: 'APP-001',
          actionKey: 'APP-001::CTA::002',
          expectedProjectionRevision: 0,
        },
        c,
        shell,
        (message) => received.push(message),
      );
      expect(c.gmLocalContextId).toBe(contextId);
      expect(received[0]).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: { base: { formId: 'APP-011' } },
      });
      expect(h.cursor()).toEqual(cursor);
      expect(storageSnapshot(h.db)).toEqual(before);
      await h.runtime.handle(
        {
          messageType: 'campaign.local-context.resume',
          protocolVersion: 3,
          gmLocalContextId: contextId,
          reconnectRequestId: `fresh-resume-${expectedForm}`,
          knownRevisions: zero,
          supportedWorkflowCommandIds: ['UI-CMD-CAMPAIGN-CREATE'],
          unacknowledgedCommandIds: [],
        },
        c,
        shell,
        (message) => received.push(message),
      );
      expect(received.at(-1)).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: { base: { formId: expectedForm } },
      });
      expect(h.cursor()).toEqual(cursor);
      expect(storageSnapshot(h.db)).toEqual(before);
    };
    await freshLaunch('CMP-001');
    await ready(h, await freePort());
    await h.send(h.createRequest());
    await freshLaunch('CMP-006');
  });
  it('does not adopt an old GM ticket from established player forms but allows a fresh socket', async () => {
    const h = await setup();
    const before = storageSnapshot(h.db);
    for (const formId of ['APP-004', 'CHR-025', null]) {
      const c: CampaignConnection = {
        gmLocalContextId: null,
        executableCreate: false,
        trusted: () => true,
      };
      const source = shellContext(formId);
      const enter = vi.fn(source.enter);
      const shell = { ...source, enter };
      const received: CampaignHostMessage[] = [];
      await h.runtime.handle(
        {
          messageType: 'campaign.local-context.resume',
          protocolVersion: 3,
          gmLocalContextId: h.ctx(),
          reconnectRequestId: 'old-ticket',
          knownRevisions: zero,
          supportedWorkflowCommandIds: ['UI-CMD-CAMPAIGN-CREATE'],
          unacknowledgedCommandIds: [],
        },
        c,
        shell,
        (message) => received.push(message),
      );
      if (formId !== null) {
        expect(received).toMatchObject([{ messageType: 'protocol.refusal' }]);
        expect(c.gmLocalContextId).toBeNull();
        expect(enter).not.toHaveBeenCalled();
      } else {
        expect(received.some((message) => message.messageType === 'projection.snapshot')).toBe(
          true,
        );
        expect(c.gmLocalContextId).toBe(h.ctx());
        expect(enter).toHaveBeenCalledOnce();
      }
      expect(storageSnapshot(h.db)).toEqual(before);
    }
  });
  it('replays the exact durable cancellation after reopen without replacing a newer draft', async () => {
    const h = await setup();
    const request: FormActionIntentV2Message = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: 'cancel-durable',
      sourceFormId: 'CMP-001',
      actionKey: 'CMP-001::CTA::002',
      expectedProjectionRevision: h.cursor().revisions.projectionRevision,
    };
    expect((await h.send(request))[0]?.messageType).toBe('projection.snapshot');
    expect(h.cursor().kind).toBe('MENU');
    const ctx = h.ctx();
    await h.bind.close();
    h.db.close();
    const restarted = harness(open(h.path), projectRoot, ctx);
    await restarted.resume();
    await restarted.nav('APP-011::CTA::006');
    const newer = restarted.cursor();
    const before = storageSnapshot(restarted.db);
    const replay = await restarted.send(request);
    expect(replay[0]?.messageType).toBe('projection.snapshot');
    expect(restarted.cursor()).toEqual(newer);
    expect(storageSnapshot(restarted.db)).toEqual(before);
    for (const changed of [
      { ...request, expectedProjectionRevision: request.expectedProjectionRevision + 1 },
      { ...request, actionKey: 'CMP-001::CTA::001' as const },
    ]) {
      expect((await restarted.send(changed))[0]?.messageType).toBe(
        'navigation.form-action.refusal',
      );
      expect(storageSnapshot(restarted.db)).toEqual(before);
    }
  });
  it('rejects a checksummed but unsupported durable KDF before any final projection or replay', async () => {
    const h = await setup();
    await ready(h, await freePort());
    const req = h.createRequest();
    await h.send(req);
    const stored = h.db
      .prepare('SELECT record_json,verifier_json FROM campaign_private_owner')
      .get() as { record_json: string; verifier_json: string };
    const proof = JSON.parse(stored.verifier_json) as Record<string, unknown>;
    proof['kdf'] = 'SCRYPT_UNKNOWN';
    const proofSha = campaignCreationHash(proof);
    const owner = JSON.parse(stored.record_json) as Record<string, unknown>;
    owner['verifierSha256'] = proofSha;
    h.db
      .prepare(
        'UPDATE campaign_private_owner SET record_json=?,record_sha256=?,verifier_json=?,verifier_sha256=?',
      )
      .run(
        canonicalPostSaveJson(owner),
        campaignCreationHash(owner),
        canonicalPostSaveJson(proof),
        proofSha,
      );
    const before = storageSnapshot(h.db);
    const resumed = await h.resume(['create-command']);
    expect(
      resumed.some(
        (message) =>
          message.messageType === 'projection.snapshot' || message.messageType === 'command.replay',
      ),
    ).toBe(false);
    expect((await h.send(req))[0]?.messageType).toBe('command.refusal');
    expect(storageSnapshot(h.db)).toEqual(before);
  });
  it('refuses occupied-port CREATE without durable mutation or leaking a secret', async () => {
    const occupied = await listen();
    const h = await setup();
    await ready(h, occupied.port);
    expect(h.snapshotPayload()['hostBindPreflight']).toMatchObject({
      status: 'FAIL',
      reasonCode: 'PORT_UNAVAILABLE',
      leaseIdOrNull: null,
    });
    const before = storageSnapshot(h.db);
    const result = await h.send(h.createRequest());
    expect(result).toMatchObject([
      { messageType: 'command.refusal', refusal: { code: 'GUARD_REJECTED' } },
    ]);
    expect(storageSnapshot(h.db)).toEqual(before);
    expect(JSON.stringify(h.messages)).not.toContain(PASSWORD);
    expect(JSON.stringify(h.messages)).not.toContain('verifierBase64');
  });
  it('blocks an incomplete temporary baseline without modifying supplied artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiosis-invalid-baseline-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'artifacts'));
    copyFileSync(
      join(projectRoot, 'artifacts/CHECKSUMS.sha256'),
      join(dir, 'artifacts/CHECKSUMS.sha256'),
    );
    const h = await setup(dir);
    await ready(h, await freePort());
    expect(h.snapshotPayload()['catalogCompatibility']).toMatchObject({
      status: 'FAIL',
      reasonCode: 'BASELINE_MISMATCH',
    });
    const before = storageSnapshot(h.db);
    expect((await h.send(h.createRequest()))[0]?.messageType).toBe('command.refusal');
    expect(storageSnapshot(h.db)).toEqual(before);
    expect(h.bind.describe(h.draft().campaignDraftId, h.draft().values.host).status).not.toBe(
      'PASS',
    );
  });
  it('creates once and recovers a lost destination and exact receipt after restart without choosing another draft', async () => {
    const h = await setup();
    const port = await freePort();
    await ready(h, port);
    expect(h.snapshotPayload()['hostBindPreflight']).toMatchObject({ status: 'PASS' });
    const request = h.createRequest();
    const committed = await h.send(request);
    const result = committed.find((message) => message.messageType === 'command.result');
    expect(result?.messageType).toBe('command.result');
    if (result?.messageType !== 'command.result') throw new Error('missing receipt');
    expect(h.cursor()).toMatchObject({ kind: 'CAMPAIGN', formId: 'CMP-006', revisions: zero });
    const snapshot = storageSnapshot(h.db);
    const ctx = h.ctx();
    await h.bind.close();
    h.db.close();
    const db = open(h.path);
    const restarted = harness(db, projectRoot, ctx);
    const replay = await restarted.resume(['create-command']);
    expect(replay.find((message) => message.messageType === 'command.replay')).toMatchObject({
      receipt: result.receipt,
    });
    expect(restarted.snapshotPayload()).toMatchObject({
      status: 'PAUSED',
      hostPort: port,
      creationReceiptId: result.receipt.receiptId,
      hostBindRecovery: { status: 'RESERVED' },
    });
    expect(storageSnapshot(db)).toEqual(snapshot);
    const again = await restarted.send(request);
    expect(again[0]).toMatchObject({ messageType: 'command.replay', receipt: result.receipt });
    expect(storageSnapshot(db)).toEqual(snapshot);
    const changed = await restarted.send({
      ...request,
      payload: { ...request.payload, preflightLeaseId: 'different' },
    });
    expect(changed[0]).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(storageSnapshot(db)).toEqual(snapshot);
    expect(JSON.stringify(restarted.messages)).not.toContain(PASSWORD);
    expect(JSON.stringify(restarted.messages)).not.toContain('saltBase64');
  });
  it('keeps the persisted endpoint and receipt when restart recovery finds its port occupied', async () => {
    const h = await setup();
    const port = await freePort();
    await ready(h, port);
    const req = h.createRequest();
    await h.send(req);
    const ctx = h.ctx();
    const before = storageSnapshot(h.db);
    await h.bind.close();
    h.db.close();
    await listen(port);
    const restarted = harness(open(h.path), projectRoot, ctx);
    await restarted.resume();
    expect(restarted.snapshotPayload()).toMatchObject({
      hostPort: port,
      hostBindRecovery: { status: 'UNAVAILABLE', reasonCode: 'PORT_UNAVAILABLE' },
    });
    expect(storageSnapshot(restarted.db)).toEqual(before);
  });
  it('rejects lost trusted connection and reset device without creating a campaign', async () => {
    const h = await setup();
    await ready(h, await freePort());
    const req = h.createRequest();
    const before = storageSnapshot(h.db);
    h.deny();
    expect((await h.send(req))[0]?.messageType).toBe('command.refusal');
    expect(storageSnapshot(h.db)).toEqual(before);
    const restarted = harness(h.db, projectRoot, h.ctx());
    resetDeviceIdentity(h.db, () => undefined);
    bootstrapDeviceIdentity(h.db);
    expect((await restarted.resume())[0]?.messageType).toBe('protocol.refusal');
    expect(storageSnapshot(h.db)).toEqual(before);
  });
  it('replays a prior secret by its per-update verifier, checks confirmation and performs no salt allocation for replay or KEEP', async () => {
    const h = await setup();
    await h.replace('METADATA', { title: 'Secret test', description: null, art: null });
    await h.nav('CMP-001::CTA::001');
    await h.replace('HOST', {
      activePlayerCapacity: 1,
      hostAddress: '127.0.0.1',
      hostPort: await freePort(),
      networkInterface: 'local',
    });
    await h.nav('CMP-002::CTA::002');
    const a = await h.replace(
      'SECRET',
      { masterTransferPassword: PASSWORD, masterTransferPasswordConfirmation: PASSWORD },
      'secret-A',
    );
    await h.replace(
      'SECRET',
      {
        masterTransferPassword: SECOND_PASSWORD,
        masterTransferPasswordConfirmation: SECOND_PASSWORD,
      },
      'secret-B',
    );
    const before = storageSnapshot(h.db);
    vi.mocked(randomBytes).mockClear();
    expect((await h.send(a.request))[0]?.messageType).toBe('campaign.draft.result');
    expect(randomBytes).not.toHaveBeenCalled();
    expect(storageSnapshot(h.db)).toEqual(before);
    const incorrect = {
      ...a.request,
      values: {
        masterTransferPassword: PASSWORD,
        masterTransferPasswordConfirmation: SECOND_PASSWORD,
      },
    } as CampaignDraftReplaceV3Message;
    expect((await h.send(incorrect))[0]).toMatchObject({
      messageType: 'campaign.draft.refusal',
      refusal: { code: 'INVALID_FIELD', error: { reason: 'CONFIRMATION_MISMATCH' } },
    });
    expect(randomBytes).not.toHaveBeenCalled();
    const noop = await h.replace(
      'SECRET',
      {
        masterTransferPassword: SECOND_PASSWORD,
        masterTransferPasswordConfirmation: SECOND_PASSWORD,
      },
      'keep-B',
    );
    expect(noop.messages[0]).toMatchObject({
      messageType: 'campaign.draft.result',
      changed: false,
    });
    expect(randomBytes).not.toHaveBeenCalled();
    const stored = readCampaignDraftUpdate(h.db, h.ctx(), h.draft().campaignDraftId, 'secret-A');
    expect(stored?.request.values).toEqual({ secretProvided: true });
    expect(JSON.stringify(h.messages)).not.toContain(PASSWORD);
    expect(JSON.stringify(h.messages)).not.toContain(SECOND_PASSWORD);
  });
});
