import * as calendarStore from '../persistence/campaign-admission-decision.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import * as npcStore from '../persistence/npc-library-store.js';
import * as queueStore from '../persistence/campaign-creation.js';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject, ProjectionSnapshotV2Message } from '@shared/index.js';
import type { NpcGmProjection } from '@shared/npc-presentation.js';
import {
  npcGmProjectionValue,
  npcArtReadRequestForProjection,
} from '@shared/npc-presentation-codec.js';
import { NPC_CONTROL_FORM_IDS } from '@shared/npc-presentation.js';
import { openLocalHostWebSocket } from '../../tests/fixtures/local-host-websocket.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { bootstrapDeviceIdentity, loadDeviceId } from '../persistence/device-identity.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  commitCampaignCreation,
  commitCampaignDraftUpdate,
  createCampaignDraft,
  createLocalGmContext,
  ensureLocalGmProfile,
  navigateCampaignDraft,
  readCampaignDraft,
  type RedactedCampaignDraftRequest,
} from '../persistence/campaign-creation.js';
import { createHost } from './server.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { prepareMasterSecret } from './campaign-secret.js';
import { npcKensiRequest } from '../../tests/fixtures/npc-published-inventory.js';
import type { NpcHumanoidSnapshot } from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';

const root = process.cwd(),
  timestamp = '2026-11-06T00:00:00.000Z';
const json = (value: unknown): JsonObject => JSON.parse(s.canonical(value)) as JsonObject;
const cleanup: Array<() => Promise<void>> = [];
let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let verifier: Awaited<ReturnType<typeof prepareMasterSecret>>;
let staticRoot: string;
beforeAll(async () => {
  // Host/WS tests run before the production build; browser coverage uses its own real build.
  staticRoot = await mkdtemp(join(tmpdir(), 'npc-host-static-'));
  await writeFile(join(staticRoot, 'index.html'), '<main>NPC host fixture</main>', 'utf8');
  baseline = await loadLocalCharacterExportBaseline(root);
  verifier = await prepareMasterSecret(
    'NPC transport fixture password',
    'NPC transport fixture password',
  );
});
afterAll(async () => {
  await rm(staticRoot, { recursive: true, force: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw Error('TCP address absent');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
function birth(db: Database.Database, port: number) {
  const ownerDeviceId = bootstrapDeviceIdentity(db),
    scope = { ownerDeviceId, gmLocalContextId: randomUUID(), campaignId: randomUUID() },
    profileId = randomUUID();
  const trusted = () => {
    expect(loadDeviceId(db)).toBe(ownerDeviceId);
  };
  ensureLocalGmProfile(db, { ownerDeviceId, masterProfileId: profileId }, trusted);
  createLocalGmContext(
    db,
    { ownerDeviceId, masterProfileId: profileId, gmLocalContextId: scope.gmLocalContextId },
    trusted,
  );
  const campaignDraftId = randomUUID();
  createCampaignDraft(
    db,
    { gmLocalContextId: scope.gmLocalContextId, campaignDraftId, expectedRevisions: s.zero() },
    trusted,
  );
  for (const stage of [
    {
      form: 'CMP-001',
      variant: 'METADATA',
      values: { title: 'NPC queue fixture', description: null, art: null },
    },
    {
      form: 'CMP-002',
      variant: 'HOST',
      values: {
        activePlayerCapacity: 5,
        hostAddress: '127.0.0.1',
        hostPort: port,
        networkInterface: 'loopback',
      },
    },
    { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
    { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
  ] as const) {
    let draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
    if (draft.formId !== stage.form) {
      navigateCampaignDraft(
        db,
        {
          gmLocalContextId: scope.gmLocalContextId,
          campaignDraftId,
          expectedDraftRevision: draft.draftRevision,
          expectedRevisions: s.vectorOf(draft),
          sourceFormId: draft.formId,
          targetFormId: stage.form,
        },
        trusted,
      );
      draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
    }
    const request = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: randomUUID(),
      scope: {
        gmLocalContextId: scope.gmLocalContextId,
        campaignDraftId,
        sourceFormId: draft.formId,
      },
      expectedDraftRevision: draft.draftRevision,
      expectedRevisions: s.vectorOf(draft),
      variant: stage.variant,
      values: stage.values,
    } as RedactedCampaignDraftRequest;
    commitCampaignDraftUpdate(
      db,
      {
        request,
        ...(stage.variant === 'SECRET'
          ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: verifier } }
          : {}),
      },
      trusted,
    );
  }
  let draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
  navigateCampaignDraft(
    db,
    {
      gmLocalContextId: scope.gmLocalContextId,
      campaignDraftId,
      expectedDraftRevision: draft.draftRevision,
      expectedRevisions: s.vectorOf(draft),
      sourceFormId: draft.formId,
      targetFormId: 'CMP-005',
    },
    trusted,
  );
  draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
  commitCampaignCreation(
    db,
    {
      campaignId: scope.campaignId,
      receiptId: randomUUID(),
      createdAt: timestamp,
      qrPayload: `http://127.0.0.1:${port}/?campaignId=${scope.campaignId}`,
      baselineVersion: baseline.baselineVersion,
      request: {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
        role: 'gm',
        commandId: randomUUID(),
        expectedRevisions: s.vectorOf(draft),
        payload: {
          stage: 'CAMPAIGN_CREATE',
          sourceFormId: 'CMP-005',
          gmLocalContextId: scope.gmLocalContextId,
          campaignDraftId,
          draftRevision: draft.draftRevision,
          preflightLeaseId: randomUUID(),
        },
      },
    },
    trusted,
  );
  return scope;
}
function inbox(socket: WebSocket) {
  const messages: JsonObject[] = [];
  const listeners = new Set<() => void>();
  socket.on('message', (data) => {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    messages.push(JSON.parse(bytes.toString()) as JsonObject);
    for (const listener of listeners) listener();
  });
  const take = (predicate: (value: JsonObject) => boolean): Promise<JsonObject> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(
          Error(
            'NPC transport response absent; received ' +
              messages.map((m) => JSON.stringify(m['messageType'])).join(','),
          ),
        );
      }, 10000);
      function check() {
        const index = messages.findIndex(predicate);
        if (index < 0) return;
        const [value] = messages.splice(index, 1);
        clearTimeout(timer);
        listeners.delete(check);
        if (value === undefined) reject(Error('missing response'));
        else resolve(value);
      }
      listeners.add(check);
      check();
    });
  return { messages, take };
}
async function fixture() {
  const db = openPersistenceDatabase(':memory:'),
    scope = birth(db, await freePort());
  let app: FastifyInstance;
  const errors: unknown[] = [];
  const sockets: WebSocket[] = [];
  let revisions = s.zero();
  const start = async () => {
    app = await createHost({
      database: db,
      projectRoot: root,
      staticRoot,
      allocateContextId: randomUUID,
      allocateLocalCharacterId: randomUUID,
      allocateWizardCheckpointId: randomUUID,
      allocateCreationBranchUuid: randomUUID,
      allocateCreationRollRequestId: randomUUID,
      allocateReceiptId: randomUUID,
      readRevisions: () => revisions,
      advanceRevisions: (impact) =>
        (revisions = {
          stateRevision: revisions.stateRevision + Number(impact.stateChanged),
          projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
          actorVisibilityRevision:
            revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
        }),
      sampleCreationD20: () => {
        throw Error('NPC branch must not invent gameplay RNG');
      },
      onFrameError: (error) => errors.push(error),
    });
  };
  await start();
  cleanup.push(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
    db.close();
  });
  const connect = async () => {
    const socket = await openLocalHostWebSocket(app);
    sockets.push(socket);
    return { socket, ...inbox(socket) };
  };
  let client = await connect();
  let snapshot: ProjectionSnapshotV2Message;
  const send = (value: unknown) => client.socket.send(JSON.stringify(value));
  const accept = async (id: string) => {
    const raw = await client.take(
      (m) =>
        (m['messageType'] === 'projection.snapshot' &&
          ((m['presentation'] as JsonObject)['assignment'] as JsonObject)['correlationId'] ===
            id) ||
        (m['messageType'] === 'navigation.form-action.refusal' &&
          m['navigationRequestId'] === id) ||
        m['messageType'] === 'protocol.refusal',
    );
    if (raw['messageType'] !== 'projection.snapshot')
      throw Error('Matching navigation refusal: ' + JSON.stringify(raw));
    snapshot = raw as unknown as ProjectionSnapshotV2Message;
    return snapshot;
  };
  const resume = async () => {
    const id = randomUUID();
    send({
      messageType: 'campaign.local-context.resume',
      protocolVersion: 3,
      gmLocalContextId: scope.gmLocalContextId,
      reconnectRequestId: id,
      knownRevisions: s.zero(),
      supportedWorkflowCommandIds: [
        'UI-CMD-CAMPAIGN-CREATE',
        'UI-CMD-NPC-COMMIT-V1',
        'UI-CMD-NPC-NEW-VERSION',
      ],
      unacknowledgedCommandIds: [],
    });
    await accept(id);
  };
  const nav = async (actionKey: ActionKey) => {
    const id = randomUUID();
    send({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: id,
      sourceFormId: snapshot.presentation.base.formId,
      actionKey,
      expectedProjectionRevision: snapshot.revisions.projectionRevision,
    });
    try {
      await accept(id);
    } catch (error) {
      throw new Error(
        'Navigation ' + actionKey + ' from ' + snapshot.presentation.base.formId + ' failed',
        { cause: error },
      );
    }
  };
  const projection = (): NpcGmProjection => {
    const payload = { ...snapshot.presentation.base.roleFilteredPayload };
    delete payload['currentCampaignLifecycle'];
    return npcGmProjectionValue(snapshot.presentation.base.formId, payload, {
      projectionRole: 'gm',
      contextId: scope.gmLocalContextId,
      campaignId: scope.campaignId,
      ...snapshot.revisions,
    });
  };
  const preparation = async (preparation: JsonObject) => {
    const p = projection(),
      attempt = p.attemptOrNull;
    if (attempt === null) throw Error('attempt absent');
    const request = {
      messageType: 'network.npc-preparation.request',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: scope.campaignId,
      sourceFormId: p.formId,
      npcDraftId: attempt.npcDraftId,
      expectedAttemptRevision: attempt.attemptRevision,
      expectedRevisions: snapshot.revisions,
      preparation,
    };
    send(request);
    const response = await client.take(
      (m) =>
        m['messageType'] === 'network.npc-editor.result' &&
        m['operationId'] === request.operationId,
    );
    await accept(request.operationId);
    return { request, response };
  };
  const replace = async (values: JsonObject) => {
    const p = projection(),
      a = p.attemptOrNull;
    if (a === null) throw Error('attempt absent');
    const request = {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: scope.campaignId,
      sourceFormId: p.formId,
      npcDraftId: a.npcDraftId,
      expectedAttemptRevision: a.attemptRevision,
      expectedRevisions: snapshot.revisions,
      values,
    };
    send(request);
    await client.take(
      (m) =>
        m['messageType'] === 'network.npc-editor.result' &&
        m['operationId'] === request.operationId,
    );
    await accept(request.operationId);
    return request;
  };
  const workflow = async (workflowCommandId: string, payload: JsonObject) => {
    const request = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId,
      expectedRevisions: snapshot.revisions,
      payload,
    };
    send(request);
    const response = await client.take(
      (m) =>
        ((m['messageType'] === 'command.result' || m['messageType'] === 'command.replay') &&
          (m['receipt'] as JsonObject)['commandId'] === request.commandId) ||
        (m['messageType'] === 'command.refusal' && m['commandId'] === request.commandId),
    );
    if (response['messageType'] === 'command.refusal')
      throw Error('Workflow refused: ' + JSON.stringify(response));
    await accept(request.commandId);
    return { request, response };
  };
  const restart = async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
    await start();
    client = await connect();
    await resume();
  };
  await resume();
  return {
    db,
    scope,
    errors,
    send,
    accept,
    nav,
    projection,
    preparation,
    workflow,
    replace,
    restart,
    connect,
    client: () => client,
    snapshot: () => snapshot,
  };
}
const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
/** Same explicit source-backed PURE/SEEKER values as npc-clean-humanoid fixture; no fact/RNG IDs are invented. */
async function fillOrdinary(
  h: Awaited<ReturnType<typeof fixture>>,
  fillInventory?: (host: Awaited<ReturnType<typeof fixture>>) => Promise<JsonObject>,
) {
  await h.preparation({ kind: 'ART_CLEAR' });
  const stages = [
    [
      'NPC-002',
      {
        name: entered('Наблюдатель'),
        description: entered(null),
        affiliation: entered('Нейтральный'),
        campaignRole: entered('Свидетель'),
        sex: entered('MALE'),
        massKg: entered(75),
        artAssetKeyOrNull: entered(null),
      },
      'NPC-002::CTA::001',
    ],
    [
      'NPC-011',
      {
        raceCode: entered('PURE'),
        pureClassOrNull: entered('SEEKER'),
        anatomyProfileId: entered('STANDARD_HUMANOID'),
      },
      'NPC-011::CTA::001',
    ],
    [
      'NPC-012',
      {
        S: entered(10),
        D: entered(10),
        M: entered(10),
        C: entered(10),
        I: entered(10),
        Z: entered(10),
        W: entered(2),
      },
      'NPC-012::CTA::001',
    ],
    ['NPC-013', entered([]), 'NPC-013::CTA::001'],
    ['NPC-014', entered([]), 'NPC-014::CTA::001'],
    ['NPC-015', entered([]), 'NPC-015::CTA::001'],
    [
      'NPC-016',
      {
        input: {
          currentHP: entered(70),
          effectInstanceIds: entered([]),
          traumaInstanceIds: entered([]),
          woundInstanceIds: entered([]),
          sourceSpecificStateFactIds: entered([]),
          deathConsequenceFactIdOrNull: entered(null),
        },
        currentOeChanges: [],
      },
      'NPC-016::CTA::001',
    ],
  ] as const;
  for (const [form, values, action] of stages) {
    expect(h.projection().formId).toBe(form);
    if (form === 'NPC-016') {
      const current = h.projection();
      if (current.formId !== 'NPC-016') throw Error('Initial state absent');
      const readonlyInput = current.content.input.input;
      // Atlas 1.19 owns these selections; the form edits preserve the authenticated values.
      await h.replace(
        json({
          ...values,
          input: { ...readonlyInput, ...values.input },
        }),
      );
      const updated = h.projection();
      if (updated.formId !== 'NPC-016' || updated.attemptOrNull === null)
        throw Error('Updated initial state absent');
      expect(updated.content.input.input.weaverEffectInstanceIds).toEqual(
        readonlyInput.weaverEffectInstanceIds,
      );
      expect(updated.content.input.input.poisonModeFactIds).toEqual(
        readonlyInput.poisonModeFactIds,
      );
      const life = updated.content.lifeStatePreparationOrNull;
      if (life == null) throw Error('Explicit life control absent');
      expect(life.canSubmit).toBe(true);
      expect(life.input.lifeKind).toEqual({ kind: 'UNSET' });
      // ADR0085 requires a deliberate ALIVE assignment even when HP is positive.
      const prepared = await h.preparation({
        kind: 'LIFE_STATE_SET',
        input: {
          capabilityKey: life.capabilityKey,
          lifeKind: 'ALIVE',
          reason: 'Исходное живое состояние NPC',
          remainingMinutesOrNull: null,
        },
      });
      const confirmed = h.projection();
      if (confirmed.formId !== 'NPC-016' || confirmed.attemptOrNull === null)
        throw Error('Confirmed life projection absent');
      expect(confirmed.attemptOrNull.attemptRevision).toBeGreaterThan(
        updated.attemptOrNull.attemptRevision,
      );
      expect(confirmed.content.lifeStatePreparationOrNull?.input.lifeKind).toEqual(
        entered('ALIVE'),
      );
      expect(confirmed.content.input.input.lifeStateConfirmationId).toEqual(
        entered(prepared.request.operationId),
      );
      expect(confirmed.content.input.input.weaverEffectInstanceIds).toEqual(
        readonlyInput.weaverEffectInstanceIds,
      );
      expect(confirmed.content.input.input.poisonModeFactIds).toEqual(
        readonlyInput.poisonModeFactIds,
      );
    } else {
      await h.replace(
        form === 'NPC-015' && fillInventory !== undefined ? await fillInventory(h) : json(values),
      );
    }
    await h.nav(action);
  }
}

describe('NPC actual GM WebSocket and SQLite bridge', () => {
  it('binds all eleven NPC screen routes to the actual delivered Atlas and inherited campaign UUID', async () => {
    const vocabulary = await loadProtocolVocabulary(root);
    const campaignId = randomUUID();
    expect(NPC_CONTROL_FORM_IDS).toHaveLength(11);
    for (const formId of NPC_CONTROL_FORM_IDS) {
      const route = '/master/campaigns/:campaignId/npc/' + formId.toLowerCase();
      const bindings = [{ parameterIndex: 0, source: 'inherited' as const, value: campaignId }];
      expect(vocabulary.isPresentedForm(formId, 'screen', route, bindings)).toBe(true);
      expect(vocabulary.isPresentedForm(formId, 'screen', route + '/unreviewed', bindings)).toBe(
        false,
      );
      expect(
        vocabulary.isPresentedForm(formId, 'screen', route, [
          { ...bindings[0]!, source: 'client-selected' },
        ]),
      ).toBe(false);
    }
    expect(
      vocabulary.isPresentedForm('NPC-005', 'screen', '/master/campaigns/:campaignId/npc/npc-005', [
        { parameterIndex: 0, source: 'inherited', value: campaignId },
      ]),
    ).toBe(false);
  });

  it('enters the existing library, clears before schema, retains one upload across edits/restart and rejects foreign art reads', async () => {
    const h = await fixture();
    await h.nav('CMP-006::CTA::001');
    await h.nav('CMP-007::CTA::004');
    expect(h.snapshot().presentation.base.availableActionKeys).toContain('GM-001::CTA::004');
    await h.nav('GM-001::CTA::004');
    expect(h.projection().formId).toBe('NPC-001');
    await h.nav('NPC-001::CTA::001');
    const created = h.projection();
    expect(created.formId).toBe('NPC-002');
    expect(created.attemptOrNull?.candidateNpcUuid).toMatch(/^[0-9a-f-]{36}$/u);
    await h.preparation({ kind: 'ART_CLEAR' });
    const cleared = h.projection();
    if (cleared.formId !== 'NPC-002') throw Error('wrong form');
    expect(cleared.content.input.artAssetKeyOrNull).toEqual({ kind: 'ENTERED', value: null });
    expect(cleared.content.artOrNull).toBeNull();
    expect(cleared.content.input.sex).toEqual({ kind: 'UNSET' });
    const bytesBase64 = readFileSync(
      join(
        root,
        'generated/media/local-character-portraits/symbiosis_placeholder_unified_female.png',
      ),
    ).toString('base64');
    const timing = performance.now(),
      upload = await h.preparation({
        kind: 'ART_UPLOAD',
        file: { kind: 'local-file', mediaType: 'image/png', bytesBase64 },
      });
    const uploaded = h.projection();
    if (uploaded.formId !== 'NPC-002' || uploaded.content.artOrNull === null)
      throw Error('uploaded portrait absent');
    const originalPortrait = uploaded.content.artOrNull;
    const editRoundTripMs: number[] = [];
    for (const name of ['Первое имя', 'Второе имя', 'Третье имя']) {
      const p = h.projection();
      if (p.formId !== 'NPC-002') throw Error('identity lost');
      const editStart = performance.now();
      await h.replace(json({ ...p.content.input, name: { kind: 'ENTERED', value: name } }));
      editRoundTripMs.push(performance.now() - editStart);
    }
    const p = h.projection();
    if (p.formId !== 'NPC-002' || p.attemptOrNull === null) throw Error('attempt lost');
    expect(p.content.artOrNull).toEqual(originalPortrait);
    const rows = h.db.prepare('SELECT record_json FROM npc_attempt_event').all() as {
      record_json: string;
    }[];
    expect(rows.every((row) => !row.record_json.includes(bytesBase64))).toBe(true);
    const operations = h.db.prepare('SELECT record_json FROM npc_operation').all() as {
      record_json: string;
    }[];
    expect(operations.filter((row) => row.record_json.includes(bytesBase64))).toHaveLength(1);
    const artRequest = npcArtReadRequestForProjection(
      {
        messageType: 'network.npc-art.read',
        protocolVersion: 3,
        requestId: randomUUID(),
        contextId: h.scope.gmLocalContextId,
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-002',
        expectedRevisions: h.snapshot().revisions,
        target: {
          kind: 'ATTEMPT',
          npcDraftId: p.attemptOrNull.npcDraftId,
          expectedAttemptRevision: p.attemptOrNull.attemptRevision,
        },
        assetKey: originalPortrait.assetKey,
        checksum: originalPortrait.checksum,
      },
      p,
    );
    h.send(artRequest);
    const art = await h
      .client()
      .take(
        (m) =>
          m['messageType'] === 'network.npc-art.result' && m['requestId'] === artRequest.requestId,
      );
    expect(art['bytesBase64']).toBe(bytesBase64);
    const stranger = await h.connect();
    stranger.socket.send(JSON.stringify({ ...artRequest, requestId: randomUUID() }));
    const denied = await stranger.take((m) => m['messageType'] === 'network.npc-art.refusal');
    expect(denied).not.toHaveProperty('bytesBase64');
    await h.restart();
    expect(h.projection().formId).toBe('NPC-002');
    h.send(upload.request);
    const replay = await h
      .client()
      .take(
        (m) =>
          m['messageType'] === 'network.npc-editor.result' &&
          m['operationId'] === upload.request.operationId,
      );
    expect(replay).toEqual(upload.response);
    await h.accept(upload.request.operationId);
    const beforeRefusals = h.db.serialize();
    for (const [request, code] of [
      [{ ...upload.request, preparation: { kind: 'ART_CLEAR' } }, 'IDEMPOTENCY_CONFLICT'],
      [
        { ...upload.request, operationId: randomUUID(), preparation: { kind: 'ART_CLEAR' } },
        'STALE_REVISION',
      ],
    ] as const) {
      h.send(request);
      const refusal = await h
        .client()
        .take(
          (m) =>
            m['messageType'] === 'network.npc-editor.refusal' &&
            m['operationId'] === request.operationId,
        );
      expect(refusal['refusal']).toEqual({ code });
      expect(refusal).not.toHaveProperty('currentAttempt');
      expect(h.db.serialize().equals(beforeRefusals)).toBe(true);
    }
    expect(h.db.prepare('SELECT count(*) AS n FROM npc_operation').get()).toEqual({ n: 6 });
    expect(NPC_CONTROL_FORM_IDS).toContain(h.projection().formId);
    expect(h.errors).toEqual([]);
    console.info(
      JSON.stringify({
        npcUploadAndThreeEditsAndRestartWallMs: performance.now() - timing,
        uploadBytes: Buffer.from(bytesBase64, 'base64').length,
        originCopies: 1,
        editRoundTripMs,
      }),
    );
  });
  it('keeps a committed CREATE and its receipt when the first delivery read fails, without a no-write refusal', async () => {
    const h = await fixture();
    await h.nav('CMP-006::CTA::001');
    await h.nav('CMP-007::CTA::004');
    await h.nav('GM-001::CTA::004');
    const request = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: 'NPC-001',
      actionKey: 'NPC-001::CTA::001',
      expectedProjectionRevision: h.snapshot().revisions.projectionRevision,
    };
    const actualWriter = npcStore.saveNpcAttemptPreparedWithEvidence;
    const failure = new Error('actual post-commit delivery read failure');
    let deliveredFault = 0;
    vi.spyOn(npcStore, 'saveNpcAttemptPreparedWithEvidence').mockImplementation((...args) => {
      const written = actualWriter(...args);
      if (args[1].operationId === request.navigationRequestId) {
        // The real writer, validation, SQL commit and mirror have already completed.
        vi.spyOn(queueStore, 'readGmRequestReviewViewStateInTransaction').mockImplementationOnce(
          () => {
            deliveredFault++;
            throw failure;
          },
        );
      }
      return written;
    });
    h.send(request);
    await vi.waitFor(() => expect(h.errors).toHaveLength(1), { timeout: 10000 });
    expect(deliveredFault).toBe(1);
    expect(h.errors[0]).toMatchObject({
      cause: { name: 'NpcApplicationPublicationError', cause: failure },
    });
    expect(
      h
        .client()
        .messages.some(
          (m) =>
            m['messageType'] === 'navigation.form-action.refusal' &&
            m['navigationRequestId'] === request.navigationRequestId,
        ),
    ).toBe(false);
    const saved = h.db
      .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
      .get(request.navigationRequestId) as { record_json: string };
    expect(saved).toBeDefined();
    const original = JSON.parse(saved.record_json) as JsonObject;
    expect(original['receiptId']).toEqual(expect.any(String));
    vi.restoreAllMocks();
    await h.restart();
    expect(h.projection().formId).toBe('NPC-002');
    h.send(request);
    await h.accept(request.navigationRequestId);
    expect(
      h.db
        .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
        .get(request.navigationRequestId),
    ).toEqual(saved);
    expect(h.db.prepare('SELECT count(*) AS n FROM npc_operation').get()).toEqual({ n: 1 });
    expect(h.errors).toHaveLength(1);
  });
  it('publishes a real full V1, reads immutable history, opens N+1 and replays after restart through the existing GM channel', async () => {
    const h = await fixture();
    await h.nav('CMP-006::CTA::001');
    await h.nav('CMP-007::CTA::004');
    await h.nav('GM-001::CTA::004');
    await h.nav('NPC-001::CTA::001');
    await fillOrdinary(h);
    const final = h.projection();
    if (final.formId !== 'NPC-017' || final.attemptOrNull === null)
      throw Error('Final stage absent');
    expect(final.content.fullValidationStatus).toBe('VALID');
    expect(final.content.previewOrNull).not.toBeNull();
    expect(h.db.prepare('SELECT count(*) AS n FROM npc_version').get()).toEqual({ n: 0 });
    const committed = await h.workflow('UI-CMD-NPC-COMMIT-V1', {
      campaignId: h.scope.campaignId,
      npcDraftId: final.attemptOrNull.npcDraftId,
      expectedAttemptRevision: final.attemptOrNull.attemptRevision,
    });
    const receipt = committed.response['receipt'] as JsonObject;
    expect(receipt['result']).toMatchObject({
      npcUuid: final.content.npcUuidOnCommit,
      versionOrNull: 1,
      operationKind: 'COMMIT_V1',
    });
    const sheet = h.projection();
    if (sheet.formId !== 'NPC-003') throw Error('Published sheet absent');
    expect(sheet.content).toMatchObject({
      npcUuid: final.content.npcUuidOnCommit,
      currentVersion: 1,
      displayedVersion: 1,
      name: 'Наблюдатель',
    });
    expect(Object.keys(sheet.content.sections).sort()).toEqual(
      ['IDENTITY', 'SCHEMA', 'STATS', 'SYMBIONTS', 'SKILLS', 'INVENTORY', 'INITIAL_STATE'].sort(),
    );
    expect(
      sheet.content.sections.INITIAL_STATE.find((row) => row.fieldKey === 'currentHP')?.value,
    ).toBe('70');
    const oldVersions = h.db
      .prepare('SELECT record_json FROM npc_version ORDER BY npc_uuid,version')
      .all();
    const oldCommit = h.db
      .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
      .get(committed.request.commandId);
    await h.nav('NPC-003::CTA::009');
    const history = h.projection();
    if (history.formId !== 'NPC-007') throw Error('History absent');
    expect(history.content.entries).toHaveLength(1);
    const opened = await h.workflow('UI-CMD-NPC-NEW-VERSION', {
      phase: 'OPEN',
      campaignId: h.scope.campaignId,
      npcUuid: sheet.content.npcUuid,
      expectedCurrentVersion: 1,
    });
    expect((opened.response['receipt'] as JsonObject)['result']).toMatchObject({
      npcUuid: sheet.content.npcUuid,
      versionOrNull: null,
      operationKind: 'OPEN',
    });
    expect(h.projection()).toMatchObject({
      formId: 'NPC-002',
      attemptOrNull: {
        editMode: 'APPEND_N_PLUS_ONE',
        candidateNpcUuid: sheet.content.npcUuid,
        versionBindingOrNull: { npcUuid: sheet.content.npcUuid, expectedCurrentVersion: 1 },
      },
    });
    await h.restart();
    h.send(committed.request);
    const replay = await h
      .client()
      .take(
        (m) =>
          m['messageType'] === 'command.replay' &&
          (m['receipt'] as JsonObject)['commandId'] === committed.request.commandId,
      );
    expect(replay['receipt']).toEqual(receipt);
    await h.accept(committed.request.commandId);
    expect(h.projection().formId).toBe('NPC-002');
    expect(
      h.db.prepare('SELECT record_json FROM npc_version ORDER BY npc_uuid,version').all(),
    ).toEqual(oldVersions);
    expect(
      h.db
        .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
        .get(committed.request.commandId),
    ).toEqual(oldCommit);
    expect(h.errors).toEqual([]);
  }, 60000);
  it('binds fresh structural calendar reads to persisted owner and recovers without a mutable connection cache', async () => {
    const original = calendarStore.readNpcCalendarContextInTransaction;
    const observed: ReturnType<typeof original>[] = [];
    const reader = vi
      .spyOn(calendarStore, 'readNpcCalendarContextInTransaction')
      .mockImplementation((db, scope, owner, rules) => {
        expect(db.inTransaction).toBe(true);
        expect(Object.hasOwn(rules, 'npc')).toBe(false);
        const result = original(db, scope, owner, rules);
        observed.push(result);
        return result;
      });
    const h = await fixture();
    await h.nav('CMP-006::CTA::001');
    await h.nav('CMP-007::CTA::004');
    await h.nav('GM-001::CTA::004');
    await h.nav('NPC-001::CTA::001');
    const create = h.projection();
    expect(create.attemptOrNull?.attemptRevision).toBe(0);
    await h.preparation({ kind: 'ART_CLEAR' });
    expect(observed.length).toBeGreaterThan(1);
    expect(observed.every((c) => s.same(c.scope, h.scope))).toBe(true);
    expect(new Set(observed).size).toBe(observed.length);
    const count = observed.length;
    await h.restart();
    expect(observed.length).toBeGreaterThan(count);
    expect(h.projection().attemptOrNull?.attemptRevision).toBe(1);
    const priorBytes = h.db.serialize();
    const p = h.projection();
    if (p.formId !== 'NPC-002' || p.attemptOrNull === null) throw Error('wrong restored stage');
    const request = {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: h.scope.campaignId,
      sourceFormId: 'NPC-002',
      expectedRevisions: h.snapshot().revisions,
      npcDraftId: p.attemptOrNull.npcDraftId,
      expectedAttemptRevision: p.attemptOrNull.attemptRevision,
      values: json({ ...p.content.input, name: { kind: 'ENTERED', value: 'Must not save' } }),
    };
    reader.mockImplementationOnce(() => {
      throw Error('injected missing structural calendar evidence');
    });
    h.send(request);
    const refused = await h
      .client()
      .take(
        (m) =>
          m['messageType'] === 'network.npc-editor.refusal' &&
          m['operationId'] === request.operationId,
      );
    expect(refused).not.toHaveProperty('values');
    expect(h.db.serialize().equals(priorBytes)).toBe(true);
    expect(h.errors).toEqual([]);
  });
  it('returns detached immutable checked writer evidence and still rejects corrupted replay history before factory entry', async () => {
    const h = await fixture();
    await h.nav('CMP-006::CTA::001');
    await h.nav('CMP-007::CTA::004');
    await h.nav('GM-001::CTA::004');
    const original = npcStore.saveNpcAttemptPreparedWithEvidence;
    const results: ReturnType<typeof original>[] = [];
    let factoryCalls = 0;
    vi.spyOn(npcStore, 'saveNpcAttemptPreparedWithEvidence').mockImplementation(
      (db, boundary, source, prepare, readers, integration) => {
        const written = original(
          db,
          boundary,
          source,
          (context) => {
            factoryCalls++;
            return prepare(context);
          },
          readers,
          integration,
        );
        results.push(written);
        return written;
      },
    );
    const request = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: 'NPC-001',
      actionKey: 'NPC-001::CTA::001',
      expectedProjectionRevision: h.snapshot().revisions.projectionRevision,
    };
    h.send(request);
    await h.accept(request.navigationRequestId);
    const first = results[0];
    if (first === undefined) throw Error('writer result absent');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.attemptEvent)).toBe(true);
    expect(Object.isFrozen(first.attemptEvent.attempt.values)).toBe(true);
    expect(first.attemptEvent.operationId).toBe(request.navigationRequestId);
    expect(s.sha(s.canonical(first.attemptEvent))).toBe(first.operation.attemptEventSha256);
    expect(Reflect.set(first.attemptEvent.attempt, 'revision', 99)).toBe(false);
    const stored = h.db
      .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
      .get(request.navigationRequestId);
    const beforeReplay = h.db.serialize();
    h.send(request);
    await h.accept(request.navigationRequestId);
    expect(factoryCalls).toBe(1);
    const replay = results.at(-1)!;
    expect(replay.replayed).toBe(true);
    expect(replay.attemptEvent).toEqual(first.attemptEvent);
    expect(replay.attemptEvent).not.toBe(first.attemptEvent);
    expect(replay.operation.receiptId).toBe(first.operation.receiptId);
    expect(h.db.serialize().equals(beforeReplay)).toBe(true);
    h.db
      .prepare('UPDATE npc_attempt_event SET record_sha256=? WHERE operation_id=?')
      .run('0'.repeat(64), request.navigationRequestId);
    const corrupted = h.db.serialize();
    h.send(request);
    await h
      .client()
      .take(
        (m) =>
          m['messageType'] === 'navigation.form-action.refusal' &&
          m['navigationRequestId'] === request.navigationRequestId,
      );
    expect(factoryCalls).toBe(1);
    expect(h.db.serialize().equals(corrupted)).toBe(true);
    expect(
      h.db
        .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
        .get(request.navigationRequestId),
    ).toEqual(stored);
    expect(h.errors).toEqual([]);
  });
});

describe('actual NPC initial inventory publication', () => {
  it('publishes the prepared weapon through the real host and retains profile IDs and receipt after restart', async () => {
    const h = await fixture();
    await h.nav('CMP-006::CTA::001');
    await h.nav('CMP-007::CTA::004');
    await h.nav('GM-001::CTA::004');
    await h.nav('NPC-001::CTA::001');
    let actualItemId = '';
    await fillOrdinary(h, async (host) => {
      await host.preparation({ kind: 'ITEM_RESERVE', values: json(entered([])) });
      const p = host.projection();
      if (p.formId !== 'NPC-015' || p.content.input.kind !== 'ENTERED')
        throw Error('Reserved item input absent');
      expect(p.content.input.value).toHaveLength(1);
      actualItemId = p.content.input.value[0]!.itemInstanceId;
      const { itemInstanceId, profile, ...fields } = npcKensiRequest(actualItemId);
      return json(
        entered([
          {
            itemInstanceId,
            input: Object.fromEntries(
              Object.entries(fields).map(([key, value]) => [key, entered(value)]),
            ),
            profile: entered(profile),
          },
        ]),
      );
    });
    const final = h.projection();
    if (final.formId !== 'NPC-017' || final.attemptOrNull === null)
      throw Error('Full weapon review absent');
    expect(final.content.fullValidationStatus).toBe('VALID');
    expect(
      final.content.previewOrNull?.sections.INVENTORY.some((row) => row.value.includes('Кенси')),
    ).toBe(true);
    expect(h.db.prepare('SELECT kind FROM npc_child_identity ORDER BY kind').all()).toEqual([
      { kind: 'ITEM' },
    ]);
    expect(h.db.prepare('SELECT count(*) AS n FROM npc_version').get()).toEqual({ n: 0 });
    const committed = await h.workflow('UI-CMD-NPC-COMMIT-V1', {
      campaignId: h.scope.campaignId,
      npcDraftId: final.attemptOrNull.npcDraftId,
      expectedAttemptRevision: final.attemptOrNull.attemptRevision,
    });
    const receipt = committed.response['receipt'];
    const saved = h.db.prepare('SELECT record_json FROM npc_version').get() as {
      record_json: string;
    };
    const version = JSON.parse(saved.record_json) as {
      snapshot: NpcHumanoidSnapshot;
      committedAt: string;
    };
    const proof = version.snapshot.derivation.inventoryProof;
    expect(proof.entries).toHaveLength(1);
    const profileId = proof.entries[0]!.weaponProfileVersionId;
    expect(profileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(profileId).not.toBe(actualItemId);
    expect(proof.entries[0]!.request).toEqual(npcKensiRequest(actualItemId));
    expect(proof).toMatchObject({
      npcUuid: final.content.npcUuidOnCommit,
      commitOperationId: committed.request.commandId,
      committedAt: version.committedAt,
    });
    expect(version.snapshot.sheet.itemProfiles).toMatchObject([
      {
        kind: 'WEAPON',
        item: {
          itemInstanceId: actualItemId,
          ownerId: final.content.npcUuidOnCommit,
          activeWeaponProfileVersionIdByVariant: { DEFAULT: profileId },
        },
        profileVersions: [
          {
            weaponProfileVersionId: profileId,
            itemInstanceId: actualItemId,
            createdAt: version.committedAt,
            previousVersionId: null,
          },
        ],
      },
    ]);
    const children = h.db.prepare('SELECT * FROM npc_child_identity ORDER BY kind,child_id').all();
    expect(children).toMatchObject([
      { kind: 'ITEM', child_id: actualItemId },
      {
        kind: 'WEAPON_PROFILE_VERSION',
        child_id: profileId,
        item_instance_id: actualItemId,
        weapon_variant_id: 'DEFAULT',
        origin_operation_id: committed.request.commandId,
      },
    ]);
    await h.restart();
    expect(h.projection().formId).toBe('NPC-003');
    h.send(committed.request);
    const replay = await h
      .client()
      .take(
        (m) =>
          m['messageType'] === 'command.replay' &&
          (m['receipt'] as JsonObject)['commandId'] === committed.request.commandId,
      );
    expect(replay['receipt']).toEqual(receipt);
    await h.accept(committed.request.commandId);
    expect(h.db.prepare('SELECT record_json FROM npc_version').get()).toEqual(saved);
    expect(h.db.prepare('SELECT * FROM npc_child_identity ORDER BY kind,child_id').all()).toEqual(
      children,
    );
    expect(h.errors).toEqual([]);
  }, 60000);
});
