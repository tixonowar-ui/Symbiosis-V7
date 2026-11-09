import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './app.js';
import {
  connectProjection,
  WEB_PROTOCOL_VOCABULARY,
  type ProjectionConnection,
  type WebClientState,
} from './ws-client.js';
import { GM_CONTEXT_STORAGE_KEY } from './forms/cmp/campaign-create.js';
import {
  NpcBrowserSession,
  decodeNpcProjection,
  npcAvailableActions,
  npcBrowserWorkflow,
  npcBrowserReceipt,
  npcBrowserDestination,
  type NpcControlPresentation,
} from './forms/npc/npc-application.js';
import type { NpcGmProjection, NpcAvailableContinuation } from '@shared/npc-presentation.js';
import type { NpcPreparationRequest } from '@shared/npc-command.js';
import type { NpcEditorStages } from '../domain/rules/npc-authoring/staged-input.js';
import {
  NPC_CONTROL_FORM_IDS,
  NPC_FULL_SHEET_FIELDS,
  NPC_VALIDATION_STAGE_IDS,
} from '@shared/npc-presentation.js';
import { IMPLEMENTED_FORM_IDS, presentedFormDefinition } from './forms/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caps = ['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'] as const;
const scope = {
  projectionRole: 'gm' as const,
  contextId: id(1),
  campaignId: id(2),
  stateRevision: 3,
  projectionRevision: 4,
  actorVisibilityRevision: 0,
};
// Closed presentation fixtures exercise browser transport, not host mechanics or full-sheet validation.
const UNSET = { kind: 'UNSET' } as const;
function identity() {
  const input: NpcEditorStages['NPC-002'] = {
    name: UNSET,
    description: UNSET,
    affiliation: UNSET,
    campaignRole: UNSET,
    sex: UNSET,
    massKg: UNSET,
    artAssetKeyOrNull: UNSET,
  };
  return {
    ...scope,
    formId: 'NPC-002',
    campaignStatus: 'PAUSED',
    campaignPhase: 'PRE_START',
    libraryRevision: 0,
    attemptOrNull: {
      npcDraftId: id(3),
      candidateNpcUuid: id(4),
      attemptRevision: 2,
      draftRevision: 2,
      stage: 'NPC-002',
      editMode: 'CREATE_V1',
      versionBindingOrNull: null,
    },
    content: {
      input,
      errors: {},
      artOrNull: null,
    },
  };
}
function checked(value = identity(), expected = scope): NpcGmProjection {
  const d = decodeNpcProjection(value.formId, value, {
    ...expected,
    stateRevision: value.stateRevision,
    projectionRevision: value.projectionRevision,
  });
  if (!d.ok) throw Error('invalid fixture');
  return d.value;
}
function editedInput(): NpcEditorStages['NPC-002'] {
  return { ...identity().content.input, name: { kind: 'ENTERED', value: 'Эхо' } };
}
function request(
  values: unknown = { ...identity().content.input, name: { kind: 'ENTERED', value: 'Эхо' } },
) {
  return {
    messageType: 'network.npc-editor.replace',
    protocolVersion: 3,
    operationId: id(8),
    campaignId: id(2),
    sourceFormId: 'NPC-002',
    npcDraftId: id(3),
    expectedAttemptRevision: 2,
    expectedRevisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 },
    values,
  };
}
function result(r = request()) {
  return {
    messageType: 'network.npc-editor.result',
    protocolVersion: 3,
    operationId: r.operationId,
    campaignId: r.campaignId,
    projectionRole: 'gm',
    sourceFormId: r.sourceFormId,
    npcDraftId: r.npcDraftId,
    appliedAttemptRevision: 3,
    appliedRevisions: { stateRevision: 4, projectionRevision: 5, actorVisibilityRevision: 0 },
  };
}
function afterEdit() {
  const p = identity();
  return {
    ...p,
    stateRevision: 4,
    projectionRevision: 5,
    attemptOrNull: { ...p.attemptOrNull, attemptRevision: 3, draftRevision: 3 },
    content: {
      ...p.content,
      input: { ...p.content.input, name: { kind: 'ENTERED' as const, value: 'Эхо' } },
    },
  };
}

describe('NPC local immutable request buffer', () => {
  it('binds OPEN to current selected version and refuses changed immutable receipt facts', () => {
    const raw = {
      ...identity(),
      formId: 'NPC-003',
      attemptOrNull: null,
      libraryRevision: 2,
      content: {
        npcUuid: id(4),
        name: 'Эхо',
        displayedVersion: 2,
        currentVersion: 2,
        historyRevision: 2,
        artOrNull: null,
        sections: Object.fromEntries(
          Object.entries(NPC_FULL_SHEET_FIELDS).map(([section, fields]) => [
            section,
            fields.map((fieldKey) => ({ fieldKey, label: fieldKey, value: 'display' })),
          ]),
        ),
        pinnedCombatReferences: [],
        returnContext: 'NPC_ADMIN',
        sourceCombatIdOrNull: null,
        dispositionReceiptIdOrNull: null,
        pinnedCombatVersionOrNull: null,
      },
    };
    const parsed = decodeNpcProjection('NPC-003', raw, scope);
    if (!parsed.ok) throw Error('sheet display fixture');
    const req = npcBrowserWorkflow(parsed.value, 'NPC-003::CTA::008', id(9));
    if (req === null) throw Error('OPEN');
    expect(req.payload).toEqual({
      phase: 'OPEN',
      campaignId: id(2),
      npcUuid: id(4),
      expectedCurrentVersion: 2,
    });
    const receipt = {
      commandId: id(9),
      receiptId: id(10),
      revisions: { stateRevision: 4, projectionRevision: 5, actorVisibilityRevision: 0 },
      result: {
        workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
        contextId: id(1),
        campaignId: id(2),
        npcDraftId: id(11),
        npcUuid: id(4),
        versionOrNull: null,
        operationKind: 'OPEN',
        committedAt: '2026-11-06T01:00:00.000Z',
      },
    };
    expect(npcBrowserReceipt(receipt, req, parsed.value)).toEqual(receipt);
    expect(() =>
      npcBrowserReceipt(
        { ...receipt, result: { ...receipt.result, npcUuid: id(99) } },
        req,
        parsed.value,
      ),
    ).toThrow();
    expect(() =>
      npcBrowserReceipt(
        { ...receipt, result: { ...receipt.result, versionOrNull: 3 } },
        req,
        parsed.value,
      ),
    ).toThrow();
    expect(() =>
      npcBrowserReceipt(
        { ...receipt, result: { ...receipt.result, privateProof: 'secret' } },
        req,
        parsed.value,
      ),
    ).toThrow();
    expect(npcBrowserDestination(null, receipt, receipt.revisions)).toBe(false);
    expect(
      npcBrowserDestination(null, receipt, {
        stateRevision: 5,
        projectionRevision: 8,
        actorVisibilityRevision: 0,
      }),
    ).toBe(true);
  });
  it('retains detached exact input until ACK and independently checked current projection', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    const r = request();
    const sent = session.begin(r);
    r.values = {};
    expect(sent).toEqual(request());
    expect(session.pending).toBe(true);
    const controls = session.controls();
    if (controls?.formId !== 'NPC-002') throw Error('identity');
    expect(controls.presentation.input.name).toEqual({ kind: 'ENTERED', value: 'Эхо' });
    expect(session.accept(result())).toBe('RESULT');
    expect(session.pending).toBe(true);
    const p = checked(afterEdit());
    session.confirm(p, p, p.contextId, p.campaignId, id(8));
    session.adopt(p);
    expect(session.pending).toBe(false);
    expect(session.controls()?.formId).toBe('NPC-002');
    session.dispose();
  });
  it.each(['operationId', 'campaignId', 'npcDraftId', 'sourceFormId'])(
    'refuses changed ACK binding %s without clearing pending',
    (key) => {
      const session = new NpcBrowserSession();
      session.adopt(checked());
      session.begin(request());
      expect(() =>
        session.accept({ ...result(), [key]: key === 'sourceFormId' ? 'NPC-011' : id(99) }),
      ).toThrow();
      expect(session.pending).toBe(true);
      session.dispose();
    },
  );
  it.each(['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])(
    'refuses forged applied %s',
    (axis) => {
      const session = new NpcBrowserSession();
      session.adopt(checked());
      session.begin(request());
      const ack = result();
      expect(() =>
        session.accept({ ...ack, appliedRevisions: { ...ack.appliedRevisions, [axis]: 99 } }),
      ).toThrow();
      session.dispose();
    },
  );
  it('does not accept a matching current projection before its ACK', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.begin(request());
    const p = checked(afterEdit());
    expect(() => session.confirm(p, p, p.contextId, p.campaignId, id(8))).toThrow();
    expect(session.pending).toBe(true);
    session.dispose();
  });
  it('does not silently normalize a same-revision saved input', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.begin(request());
    session.accept(result());
    const p = checked({
      ...afterEdit(),
      content: { ...afterEdit().content, input: identity().content.input },
    });
    expect(() => session.confirm(p, p, p.contextId, p.campaignId, id(8))).toThrow();
    session.dispose();
  });
  it('keeps exact request through disconnect, and accepts a later current head independently', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    const sent = session.begin(request());
    session.suspend();
    expect(session.request).toEqual(sent);
    session.adopt(checked({ ...afterEdit(), stateRevision: 8, projectionRevision: 10 }));
    session.accept(result());
    const p = session.projection!;
    session.confirm(p, p, p.contextId, p.campaignId, id(8));
    expect(session.pending).toBe(false);
    expect(p.stateRevision).toBe(8);
    session.dispose();
  });
  it('requires the same GM and campaign before replay even when the destination is another form', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.begin(request());
    session.suspend();
    expect(() => session.assertReconnectScope(scope, id(99), scope.campaignId)).toThrow();
    expect(() => session.assertReconnectScope(scope, scope.contextId, id(99))).toThrow();
    expect(() =>
      session.assertReconnectScope(
        { ...scope, stateRevision: 2 },
        scope.contextId,
        scope.campaignId,
      ),
    ).toThrow();
    expect(() =>
      session.assertReconnectScope(scope, scope.contextId, scope.campaignId),
    ).not.toThrow();
    session.accept(result());
    expect(() => session.assertReconnectScope(scope, scope.contextId, scope.campaignId)).toThrow();
    expect(() =>
      session.assertReconnectScope(result().appliedRevisions, scope.contextId, scope.campaignId),
    ).not.toThrow();
    session.dispose();
  });
  it('compares saved field values independently of object key insertion order', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    const values = Object.fromEntries(Object.entries(editedInput()).reverse());
    session.begin(request(values));
    session.accept(result());
    const p = checked(afterEdit());
    expect(() => session.confirm(p, p, p.contextId, p.campaignId, id(8))).not.toThrow();
    session.dispose();
  });
  it('keeps the FileReader busy fence distinct from a pending write, and rejects old bindings', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    const key = session.bindingKey!;
    session.setBusy(key, true);
    const p = session.controls();
    if (p?.formId !== 'NPC-002') throw Error('fixture');
    expect(p.presentation.state.pending).toBe(false);
    expect(p.presentation.state.dirty).toBe(true);
    expect(() => session.begin(request())).toThrow();
    session.adopt(checked(afterEdit()));
    session.setBusy(key, true);
    expect(session.busy).toBe(false);
    session.dispose();
  });
  it('keeps a checked portrait while showing an unsaved local field, and revokes it on disconnect', () => {
    const create = vi.fn((blob: Blob) => 'blob:npc-' + String(blob.size)),
      revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const raw = identity(),
      reference = { assetKey: 'symbiosis_placeholder_pure_male', checksum: 'a'.repeat(64) };
    const parsed = decodeNpcProjection(
      'NPC-002',
      { ...raw, content: { ...raw.content, artOrNull: reference } },
      scope,
    );
    if (!parsed.ok) throw Error('portrait fixture');
    const session = new NpcBrowserSession();
    session.adopt(parsed.value);
    const art = session.art.begin(
      id(30),
      { kind: 'ATTEMPT', npcDraftId: id(3), expectedAttemptRevision: 2 },
      reference,
    );
    expect(
      session.art.accept({
        ...art,
        messageType: 'network.npc-art.result',
        mediaType: 'image/png',
        bytesBase64: 'iVBORw0KGgo=',
      }),
    ).toBe('LOADED');
    session.begin(request());
    const controls = session.controls();
    if (controls?.formId !== 'NPC-002') throw Error('identity');
    expect(controls.presentation.input.name).toEqual({ kind: 'ENTERED', value: 'Эхо' });
    expect(controls.presentation.artOrNull).toEqual({
      ...reference,
      status: 'READY',
      url: 'blob:npc-8',
    });
    expect(revoke).not.toHaveBeenCalled();
    session.suspend();
    expect(revoke).toHaveBeenCalledWith('blob:npc-8');
    session.dispose();
  });
  it('retains a redacted refusal and does not adopt reply fields as current state', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.begin(request());
    expect(
      session.accept({
        messageType: 'network.npc-editor.refusal',
        protocolVersion: 3,
        operationId: id(8),
        campaignId: id(2),
        projectionRole: 'gm',
        sourceFormId: 'NPC-002',
        npcDraftId: id(3),
        presentationUnchanged: true,
        refusal: { code: 'STALE_ATTEMPT' },
      }),
    ).toBe('REFUSAL');
    expect(session.pending).toBe(false);
    expect(session.projection?.stateRevision).toBe(3);
    const p = session.controls();
    if (p?.formId !== 'NPC-002') throw Error('fixture');
    expect(p.presentation.state.refusalOrNull).toContain('STALE_ATTEMPT');
    session.dispose();
  });
});

function commitFixture(editMode: 'CREATE_V1' | 'APPEND_N_PLUS_ONE') {
  const versionBindingOrNull =
    editMode === 'CREATE_V1' ? null : { npcUuid: id(4), expectedCurrentVersion: 2 };
  const resultVersion = editMode === 'CREATE_V1' ? 1 : 3;
  const p = identity();
  const raw = {
    ...p,
    formId: 'NPC-017',
    attemptOrNull: { ...p.attemptOrNull, stage: 'NPC-017', editMode, versionBindingOrNull },
    content: {
      binding: { editMode, attemptRevision: 2, versionBindingOrNull, resultVersion },
      npcUuidOnCommit: id(4),
      previewOrNull: {
        name: 'Эхо',
        artOrNull: null,
        sections: Object.fromEntries(
          Object.entries(NPC_FULL_SHEET_FIELDS).map(([section, fields]) => [
            section,
            fields.map((fieldKey) => ({ fieldKey, label: fieldKey, value: 'display' })),
          ]),
        ),
        pinnedCombatReferences: [],
      },
      stages: Object.fromEntries(
        NPC_VALIDATION_STAGE_IDS.map((stage) => [
          stage,
          { label: stage, status: 'VALID', messages: [] },
        ]),
      ),
      fullValidationStatus: 'VALID',
      validationErrors: [],
      calendar: {
        requiresCampaignTime: false,
        validationStatus: 'NOT_REQUIRED',
        bindingOrNull: null,
        initialTimeLockOrNull: null,
        messages: [],
      },
      commitStatusLabel: 'Готово',
      receiptOrNull: null,
    },
  };
  const decoded = decodeNpcProjection('NPC-017', raw, scope);
  if (!decoded.ok) throw Error('closed final presentation fixture');
  const request = npcBrowserWorkflow(decoded.value, 'NPC-017::CTA::002', id(12));
  if (request === null) throw Error('commit request fixture');
  const receipt = {
    commandId: id(12),
    receiptId: id(13),
    revisions: { stateRevision: 4, projectionRevision: 5, actorVisibilityRevision: 0 },
    result: {
      workflowCommandId: request.workflowCommandId,
      contextId: id(1),
      campaignId: id(2),
      npcDraftId: id(3),
      npcUuid: id(4),
      versionOrNull: resultVersion,
      operationKind: editMode === 'CREATE_V1' ? 'COMMIT_V1' : 'COMMIT',
      committedAt: '2026-11-06T01:00:00.000Z',
    },
  };
  return { projection: decoded.value, request, receipt };
}
describe('NPC immutable workflow commit receipts', () => {
  it.each(['CREATE_V1', 'APPEND_N_PLUS_ONE'] as const)(
    'accepts the exact %s result and rejects altered binding facts',
    (mode) => {
      const f = commitFixture(mode);
      expect(npcBrowserReceipt(f.receipt, f.request, f.projection)).toEqual(f.receipt);
      expect(f.request.payload).toEqual({
        campaignId: id(2),
        npcDraftId: id(3),
        expectedAttemptRevision: 2,
        ...(mode === 'APPEND_N_PLUS_ONE' ? { phase: 'COMMIT', expectedCurrentVersion: 2 } : {}),
      });
      for (const change of [
        { npcDraftId: id(99) },
        { npcUuid: id(99) },
        { campaignId: id(99) },
        { contextId: id(99) },
        { versionOrNull: f.receipt.result.versionOrNull + 1 },
        { operationKind: 'OPEN' },
        { workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE' },
      ])
        expect(() =>
          npcBrowserReceipt(
            { ...f.receipt, result: { ...f.receipt.result, ...change } },
            f.request,
            f.projection,
          ),
        ).toThrow();
      expect(() =>
        npcBrowserReceipt({ ...f.receipt, commandId: id(99) }, f.request, f.projection),
      ).toThrow();
      expect(() =>
        npcBrowserReceipt(
          { ...f.receipt, revisions: { ...f.receipt.revisions, projectionRevision: 6 } },
          f.request,
          f.projection,
        ),
      ).toThrow();
    },
  );
  it.each([
    'garbage',
    '',
    '2026-11-06',
    '2026-11-06T01:00:00Z',
    '2026-11-06T01:00:00.000+00:00',
    '2026-02-30T01:00:00.000Z',
    '2026-11-06T25:00:00.000Z',
  ])('refuses noncanonical or impossible audit time %j', (committedAt) => {
    const f = commitFixture('CREATE_V1');
    expect(() =>
      npcBrowserReceipt(
        { ...f.receipt, result: { ...f.receipt.result, committedAt } },
        f.request,
        f.projection,
      ),
    ).toThrow();
  });
});

class Socket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static CLOSING = 2;
  static all: Socket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: WebSocket['onopen'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  constructor(_url: string | URL) {
    Socket.all.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }
  message(value: unknown) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent('message', { data: JSON.stringify(value) }),
    );
  }
  lost() {
    this.readyState = 3;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code: 1006 }));
  }
}
const connections: ProjectionConnection[] = [];
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root !== null) {
    const old = root;
    root = null;
    await act(async () => {
      old.unmount();
      await Promise.resolve();
    });
  }
  container?.remove();
  container = null;
  for (const c of connections.splice(0)) c.disconnect();
  Socket.all = [];
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});
function setup() {
  window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, id(1));
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ deviceId: id(20) }), { status: 200 })),
    ),
  );
}
function snapshot(p = identity(), correlation = 'unused', reason = 'RECONNECT') {
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'gm',
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
    presentation: {
      assignment: { reason, correlationId: correlation },
      base: {
        formId: p.formId,
        formType: 'screen',
        routeTemplate: `/master/campaigns/:campaignId/npc/${p.formId.toLowerCase()}`,
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: p.campaignId }],
        roleFilteredPayload: p,
        availableActionKeys: npcAvailableActions(
          checked(p, { ...scope, contextId: p.contextId, campaignId: p.campaignId }),
          caps,
        ),
      },
      layers: [],
    },
  };
}
function resume(socket: Socket, p = identity()) {
  socket.open();
  const r = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: r.reconnectRequestId,
    executableWorkflowCommandIds: caps,
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
  });
  socket.message(snapshot(p, r.reconnectRequestId));
}
async function client(onResume: (socket: Socket) => void = resume) {
  setup();
  const states: WebClientState[] = [],
    controls: (NpcControlPresentation | null)[] = [];
  const c = connectProjection(
    (s) => states.push(s),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (p) => controls.push(p),
  );
  connections.push(c);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const socket = Socket.all.at(-1)!;
  onResume(socket);
  expect(states.at(-1)).toMatchObject({ kind: 'ready' });
  return { c, socket, states, controls };
}
describe('actual projection connection NPC branch', () => {
  it('registers only the eleven delivered NPC forms in the existing Atlas registry', () => {
    expect(IMPLEMENTED_FORM_IDS.filter((id) => id.startsWith('NPC-'))).toEqual(
      NPC_CONTROL_FORM_IDS,
    );
    for (const form of NPC_CONTROL_FORM_IDS)
      expect(presentedFormDefinition(form)?.type).toBe('screen');
    for (const form of ['NPC-004', 'NPC-005', 'NPC-006', 'NPC-008', 'NPC-009', 'NPC-010'] as const)
      expect(presentedFormDefinition(form)).toBeNull();
    for (const command of caps)
      expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId(command)).toBe(true);
    for (const command of ['UI-CMD-NPC-DELETE', 'UI-CMD-NPC-ARCHIVE', 'UI-CMD-NPC-DUPLICATE'])
      expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId(command)).toBe(false);
  });
  it('sends a checked stage request and blocks NAV until ACK plus current projection', async () => {
    const { c, socket, states } = await client();
    expect(c.replaceNpcStage({ formId: 'NPC-002', values: editedInput() })).toEqual({ ok: true });
    const sent = JSON.parse(socket.sent.at(-1)!) as ReturnType<typeof request>;
    expect(sent.messageType).toBe('network.npc-editor.replace');
    expect(c.requestFormAction('NPC-002::CTA::002').ok).toBe(false);
    socket.message(result(sent));
    expect(c.requestFormAction('NPC-002::CTA::002').ok).toBe(false);
    socket.message(snapshot(afterEdit(), sent.operationId, 'FORM_ACTION'));
    expect(states.at(-1)?.kind).toBe('ready');
    expect(c.requestFormAction('NPC-002::CTA::002')).toEqual({ ok: true });
    const nav = JSON.parse(socket.sent.at(-1)!) as {
      messageType: string;
      navigationRequestId: string;
    };
    expect(nav.messageType).toBe('navigation.form-action');
    expect(nav.navigationRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
  it('reconnects and replays identical operation bytes without allocating a new intention', async () => {
    const { c, socket, states } = await client();
    c.replaceNpcStage({ formId: 'NPC-002', values: editedInput() });
    const original = socket.sent.at(-1)!;
    socket.lost();
    expect(states.at(-1)?.kind).toBe('disconnected');
    expect(c.reconnect()).toEqual({ ok: true });
    const next = Socket.all.at(-1)!;
    resume(next);
    expect(next.sent.at(-1)).toBe(original);
  });
  it('does not replay a pending edit into a foreign campaign after reconnect', async () => {
    const { c, socket, states } = await client();
    c.replaceNpcStage({ formId: 'NPC-002', values: editedInput() });
    const original = socket.sent.at(-1)!;
    socket.lost();
    c.reconnect();
    const next = Socket.all.at(-1)!;
    resume(next, { ...identity(), campaignId: id(99) });
    expect(states.at(-1)?.kind).toBe('protocol-error');
    expect(next.sent).not.toContain(original);
  });
  it.each(['matching', 'phase', 'status'] as const)(
    'validates the current campaign lifecycle sibling: %s',
    async (kind) => {
      const { c, socket, states } = await client();
      socket.lost();
      c.reconnect();
      const next = Socket.all.at(-1)!;
      next.open();
      const r = JSON.parse(next.sent[0]!) as { reconnectRequestId: string };
      next.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: r.reconnectRequestId,
        executableWorkflowCommandIds: [...caps, 'UI-CMD-CAMPAIGN-PAUSE-SET'],
        revisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 },
      });
      const p = identity();
      if (kind !== 'matching') p.campaignPhase = 'STARTED';
      const m = snapshot(p, r.reconnectRequestId);
      Object.assign(m.presentation.base.roleFilteredPayload, {
        currentCampaignLifecycle: {
          contextId: id(1),
          campaignId: id(2),
          stateRevision: 3,
          projectionRevision: 4,
          actorVisibilityRevision: 0,
          campaignRevision: 1,
          settingsRevision: 0,
          campaignStatus: kind === 'status' ? 'HOSTING' : 'PAUSED',
          pauseReasonOrNull: null,
          firstStartCompleted: kind === 'status',
        },
      });
      next.message(m);
      expect(states.at(-1)?.kind).toBe(kind === 'matching' ? 'ready' : 'protocol-error');
    },
  );
  it.each(['role', 'context', 'route', 'action', 'local-field'])(
    'rejects forged NPC projection %s',
    async (kind) => {
      const { socket, states } = await client();
      socket.lost();
      const c = connections.at(-1)!;
      c.reconnect();
      const next = Socket.all.at(-1)!;
      next.open();
      const reconnect = JSON.parse(next.sent[0]!) as { reconnectRequestId: string };
      next.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: reconnect.reconnectRequestId,
        executableWorkflowCommandIds: caps,
        revisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 },
      });
      const m = snapshot(identity(), reconnect.reconnectRequestId);
      if (kind === 'role') m.projectionRole = 'player';
      if (kind === 'context') m.presentation.base.roleFilteredPayload.contextId = id(99);
      if (kind === 'route') m.presentation.base.routeBindings[0]!.value = id(99);
      if (kind === 'action') m.presentation.base.availableActionKeys = ['NPC-003::CTA::004'];
      if (kind === 'local-field')
        Object.assign(m.presentation.base.roleFilteredPayload.content, { dirty: true });
      next.message(m);
      expect(states.at(-1)?.kind).toBe('protocol-error');
    },
  );
  it('mounts real NPC002 fields in the existing single Atlas shell without a generic JSON dump', async () => {
    setup();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<App />);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      resume(Socket.all.at(-1)!);
      await Promise.resolve();
    });
    expect(container.querySelectorAll('[data-npc-content="NPC-002"]').length).toBe(1);
    expect(
      [...container.querySelectorAll('legend')].filter(
        (x) => x.textContent === 'AtlasForm NPC-002',
      ),
    ).toHaveLength(1);
    expect(container.textContent).not.toContain('roleFilteredPayload');
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });
});

describe('explicit local NPC stage input', () => {
  it('detaches typing without a request and blocks independent preparations until discard', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    const values = { ...editedInput() };
    session.stage({ formId: 'NPC-002', values });
    values.name = { kind: 'ENTERED', value: 'caller changed' };
    expect(session.request).toBeNull();
    expect(session.pending).toBe(false);
    expect(session.dirty).toBe(true);
    expect(session.controls()).toMatchObject({
      presentation: {
        input: editedInput(),
        state: { pending: false, readOnly: false, localEditDirty: true },
      },
      editBuffer: { canApply: true, canDiscard: true, conflict: false },
    });
    const preparation = {
      messageType: 'network.npc-preparation.request',
      protocolVersion: 3,
      operationId: id(8),
      campaignId: id(2),
      sourceFormId: 'NPC-002',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
      expectedRevisions: request().expectedRevisions,
      preparation: { kind: 'ART_CLEAR' },
    };
    expect(() => session.begin(preparation)).toThrow();
    session.discard();
    expect(session.controls()).toMatchObject({ presentation: { input: identity().content.input } });
    expect(session.dirty).toBe(false);
    expect(session.request).toBeNull();
    expect(() => session.begin(preparation)).not.toThrow();
  });
  it('keeps local input through refused and lost delivery and clears only exact ACK plus checked successor', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.stage({ formId: 'NPC-002', values: editedInput() });
    const original = session.apply(id(8));
    expect(() => session.discard()).toThrow();
    session.suspend();
    expect(session.request).toEqual(original);
    expect(session.dirty).toBe(true);
    session.adopt(checked());
    session.accept(editRefusal(request()));
    expect(session.pending).toBe(false);
    expect(session.dirty).toBe(true);
    expect(session.controls()).toMatchObject({
      presentation: { input: editedInput(), state: { readOnly: false } },
    });
    session.apply(id(8));
    expect(session.request).toEqual(original);
  });
  it('keeps conflicts sticky, never auto-rebases, and hides both private contexts across a principal change', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.stage({ formId: 'NPC-002', values: editedInput() });
    session.adopt(checked(afterEdit()));
    expect(session.controls()).toMatchObject({
      editBuffer: { conflict: true, canApply: false },
      presentation: { state: { readOnly: true } },
    });
    expect(() => session.apply(id(8))).toThrow();
    session.adopt(checked());
    expect(() => session.stage({ formId: 'NPC-002', values: editedInput() })).toThrow();
    const foreign = { ...identity(), contextId: id(99) };
    session.adopt(checked(foreign, { ...scope, contextId: id(99) }));
    expect(session.controls()).toBeNull();
    expect(session.dirty).toBe(true);
    session.adopt(checked());
    session.discard();
    expect(session.controls()?.editBuffer).toBeUndefined();
  });
  it('retains only conflict controls when the host leaves the NPC leaf, without exposing old input', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.stage({ formId: 'NPC-002', values: editedInput() });
    session.adopt(null, { contextId: id(1), campaignId: id(2) });
    expect(session.controls()).toBeNull();
    expect(session.inputBuffer()).toEqual({ canApply: false, canDiscard: true, conflict: true });
    session.discard();
    expect(session.inputBuffer()).toBeNull();
  });
  it.each([
    null,
    { contextId: id(99), campaignId: id(2) },
    { contextId: id(1), campaignId: id(99) },
  ])('revokes unsent private metadata when checked authority changes to %j', (authority) => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.stage({ formId: 'NPC-002', values: editedInput() });
    session.adopt(null, authority);
    expect(session.controls()).toBeNull();
    expect(session.inputBuffer()).toBeNull();
    expect(session.dirty).toBe(false);
  });
  it('requires an independently checked successor after the exact ACK', () => {
    const session = new NpcBrowserSession();
    session.adopt(checked());
    session.stage({ formId: 'NPC-002', values: editedInput() });
    session.apply(id(8));
    expect(() => session.accept({ ...result(), npcDraftId: id(99) })).toThrow();
    expect(session.dirty).toBe(true);
    session.accept(result());
    expect(session.controls()?.editBuffer?.canDiscard).toBe(false);
    const p = checked(afterEdit());
    expect(() => session.confirm(p, p, p.contextId, p.campaignId, id(99))).toThrow();
    expect(session.dirty).toBe(true);
    session.confirm(p, p, p.contextId, p.campaignId, id(8));
    session.adopt(p);
    expect(session.dirty).toBe(false);
    expect(session.controls()?.editBuffer).toBeUndefined();
  });
});

function editRefusal(r: ReturnType<typeof request>) {
  return {
    messageType: 'network.npc-editor.refusal',
    protocolVersion: 3,
    operationId: r.operationId,
    campaignId: r.campaignId,
    projectionRole: 'gm',
    sourceFormId: r.sourceFormId,
    npcDraftId: r.npcDraftId,
    presentationUnchanged: true,
    refusal: { code: 'STALE_ATTEMPT' },
  };
}
async function mountNpc(final: NpcGmProjection | null = null) {
  setup();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
    await new Promise<void>((r) => setTimeout(r, 0));
  });
  const socket = Socket.all.at(-1)!;
  await act(async () => {
    if (final === null) resume(socket);
    else {
      socket.open();
      const reconnect = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
      socket.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: reconnect.reconnectRequestId,
        executableWorkflowCommandIds: caps,
        revisions: {
          stateRevision: final.stateRevision,
          projectionRevision: final.projectionRevision,
          actorVisibilityRevision: final.actorVisibilityRevision,
        },
      });
      const outer = snapshot(identity(), reconnect.reconnectRequestId);
      socket.message({
        ...outer,
        presentation: {
          ...outer.presentation,
          base: {
            ...outer.presentation.base,
            formId: final.formId,
            routeTemplate: '/master/campaigns/:campaignId/npc/' + final.formId.toLowerCase(),
            roleFilteredPayload: final,
            // The fixture declares the source contract, independently of the browser recomputation.
            availableActionKeys: ['NPC-017::CTA::002', 'NPC-017::CTA::003'],
          },
        },
      });
    }
    await Promise.resolve();
  });
  return socket;
}
function namedInput(label: string): HTMLInputElement {
  const field = [...container!.querySelectorAll('label')].find((x) =>
    x.textContent?.includes(label),
  );
  const input = field?.htmlFor
    ? document.getElementById(field.htmlFor)
    : field?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw Error('Missing input ' + label);
  return input;
}
function namedButton(label: string): HTMLButtonElement {
  const button = [...container!.querySelectorAll('button')].find((x) => x.textContent === label);
  if (button === undefined) throw Error('Missing button ' + label);
  return button;
}
async function typeValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}
describe('App explicit NPC input confirmation', () => {
  it('keeps every typed character and focused DOM node with zero frames/UUID until one explicit full-stage apply', async () => {
    const socket = await mountNpc();
    const before = socket.sent.length,
      input = namedInput('Имя НПС');
    input.focus();
    const entropy = vi.spyOn(crypto, 'getRandomValues');
    try {
      for (const value of ['Э', 'Эх', 'Эхо', 'Эхо ', 'Эхо леса']) {
        await typeValue(input, value);
        expect(namedInput('Имя НПС')).toBe(input);
        expect(input.value).toBe(value);
        expect(input.matches(':disabled')).toBe(false);
        expect(document.activeElement).toBe(input);
      }
      await typeValue(namedInput('Принадлежность'), 'Лес');
      expect(socket.sent).toHaveLength(before);
      expect(entropy).not.toHaveBeenCalled();
      expect(container!.querySelector('input[type="file"]')!.matches(':disabled')).toBe(true);
      expect(namedButton('Убрать изображение').matches(':disabled')).toBe(true);
      await act(async () => {
        namedButton('Подтвердить ввод').click();
        await Promise.resolve();
      });
      expect(entropy).toHaveBeenCalledTimes(1);
    } finally {
      entropy.mockRestore();
    }
    expect(socket.sent).toHaveLength(before + 1);
    const sent = JSON.parse(socket.sent.at(-1)!) as ReturnType<typeof request>;
    expect(sent.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(sent).toEqual({
      ...request({
        ...identity().content.input,
        name: { kind: 'ENTERED', value: 'Эхо леса' },
        affiliation: { kind: 'ENTERED', value: 'Лес' },
      }),
      operationId: sent.operationId,
    });
    expect(namedButton('Отменить ввод').matches(':disabled')).toBe(true);
    await act(async () => {
      socket.message(result(sent));
      await Promise.resolve();
    });
    expect(namedButton('Подтвердить ввод').matches(':disabled')).toBe(true);
    const next = {
      ...afterEdit(),
      content: { ...afterEdit().content, input: sent.values as NpcEditorStages['NPC-002'] },
    };
    await act(async () => {
      socket.message(snapshot(next, sent.operationId, 'FORM_ACTION'));
      await Promise.resolve();
    });
    expect(container!.querySelector('[aria-label="Локальный ввод НПС"]')).toBeNull();
    expect(namedInput('Имя НПС').value).toBe('Эхо леса');
  });
  it('discards only unsent typing without sending or changing the checked host input', async () => {
    const socket = await mountNpc(),
      before = socket.sent.length;
    await typeValue(namedInput('Имя НПС'), 'Не отправлено');
    await act(async () => {
      namedButton('Отменить ввод').click();
      await Promise.resolve();
    });
    expect(socket.sent).toHaveLength(before);
    expect(namedInput('Имя НПС').value).toBe('');
    expect(container!.querySelector('[aria-label="Локальный ввод НПС"]')).toBeNull();
    expect(namedButton('Убрать изображение').matches(':disabled')).toBe(false);
  });
  it('retains refused typing through refresh and permits correction before retry', async () => {
    const { c, socket, controls } = await client();
    expect(c.stageNpcInput({ formId: 'NPC-002', values: editedInput() }).ok).toBe(true);
    expect(c.applyNpcInput().ok).toBe(true);
    const sent = JSON.parse(socket.sent.at(-1)!) as ReturnType<typeof request>;
    socket.message(editRefusal(sent));
    const next = Socket.all.at(-1)!;
    resume(next);
    expect(controls.at(-1)).toMatchObject({
      presentation: { input: editedInput(), state: { pending: false, readOnly: false } },
      editBuffer: { canApply: true },
    });
    const corrected = { ...editedInput(), name: { kind: 'ENTERED' as const, value: 'Исправлено' } };
    expect(c.stageNpcInput({ formId: 'NPC-002', values: corrected }).ok).toBe(true);
    expect(c.applyNpcInput().ok).toBe(true);
    const retried = JSON.parse(next.sent.at(-1)!) as ReturnType<typeof request>;
    expect(retried.values).toEqual(corrected);
    expect(retried.operationId).not.toBe(sent.operationId);
  });
  it('blocks NAV and preparations while dirty and replays an applied lost ACK with identical request bytes', async () => {
    const { c, socket } = await client();
    c.stageNpcInput({ formId: 'NPC-002', values: editedInput() });
    const count = socket.sent.length;
    expect(c.requestFormAction('NPC-002::CTA::002').ok).toBe(false);
    expect(c.reserveNpcItem().ok).toBe(false);
    expect(socket.sent).toHaveLength(count);
    c.applyNpcInput();
    const original = socket.sent.at(-1)!;
    expect(c.discardNpcInput().ok).toBe(false);
    socket.lost();
    c.reconnect();
    const next = Socket.all.at(-1)!;
    resume(next);
    expect(next.sent.at(-1)).toBe(original);
    expect(c.discardNpcInput().ok).toBe(false);
  });
  it('does not rebase unsent input onto a newer host attempt after reconnect', async () => {
    const { c, socket, controls } = await client();
    c.stageNpcInput({ formId: 'NPC-002', values: editedInput() });
    socket.lost();
    c.reconnect();
    const next = Socket.all.at(-1)!;
    resume(next, afterEdit());
    expect(next.sent).toHaveLength(1);
    expect(controls.at(-1)?.editBuffer).toMatchObject({
      conflict: true,
      canApply: false,
      canDiscard: true,
    });
    expect(c.applyNpcInput().ok).toBe(false);
    expect(c.stageNpcInput({ formId: 'NPC-002', values: editedInput() }).ok).toBe(false);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(controls.at(-1)?.editBuffer).toBeUndefined();
  });
  it('does not turn unsent discard or file cleanup into a transport reconnection', async () => {
    const { c, socket, states, controls } = await client();
    c.stageNpcInput({ formId: 'NPC-002', values: editedInput() });
    const control = controls.at(-1);
    if (control?.formId !== 'NPC-002') throw Error('identity');
    socket.lost();
    c.setNpcInputPending(control.presentation.bindingKey, false);
    expect(states.at(-1)?.kind).toBe('disconnected');
    expect(c.discardNpcInput().ok).toBe(true);
    expect(states.at(-1)?.kind).toBe('disconnected');
    expect(controls.at(-1)?.editBuffer).toBeUndefined();
  });
  it('never mounts retained local values or foreign GM values after a foreign reconnect', async () => {
    const socket = await mountNpc();
    await typeValue(namedInput('Имя НПС'), 'Private local input');
    await act(async () => {
      socket.lost();
      await Promise.resolve();
    });
    const reconnect = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Переподключ'),
    );
    if (reconnect === undefined) throw Error('Reconnect control');
    await act(async () => {
      reconnect.click();
      await Promise.resolve();
    });
    const next = Socket.all.at(-1)!;
    const foreign = {
      ...identity(),
      contextId: id(99),
      content: {
        ...identity().content,
        input: {
          ...identity().content.input,
          name: { kind: 'ENTERED' as const, value: 'Foreign private input' },
        },
      },
    };
    await act(async () => {
      resume(next, foreign);
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-npc-content]')).toBeNull();
    expect(container!.querySelector('[aria-label="Локальный ввод НПС"]')).toBeNull();
    expect(container!.textContent).not.toContain('Private local input');
    expect(container!.textContent).not.toContain('Foreign private input');
  });
  it('does not leak or block on the old buffer after an accepted authenticated campaign switch', async () => {
    const socket = await mountNpc();
    await typeValue(namedInput('Имя НПС'), 'Private old campaign input');
    await act(async () => {
      socket.lost();
      await Promise.resolve();
    });
    await act(async () => {
      namedButton('Переподключиться').click();
      await Promise.resolve();
    });
    const next = Socket.all.at(-1)!;
    await act(async () => {
      resume(next, { ...identity(), campaignId: id(99) });
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-npc-content="NPC-002"]')).not.toBeNull();
    expect(container!.querySelector('[aria-label="Локальный ввод НПС"]')).toBeNull();
    expect(namedInput('Имя НПС').value).toBe('');
    expect(namedInput('Имя НПС').matches(':disabled')).toBe(false);
    expect(namedButton('Убрать изображение').matches(':disabled')).toBe(false);
    await typeValue(namedInput('Имя НПС'), 'New campaign input');
    await act(async () => {
      namedButton('Подтвердить ввод').click();
      await Promise.resolve();
    });
    const sent = JSON.parse(next.sent.at(-1)!) as ReturnType<typeof request>;
    expect(sent.campaignId).toBe(id(99));
    expect(sent.values).toEqual({
      ...identity().content.input,
      name: { kind: 'ENTERED', value: 'New campaign input' },
    });
  });
});

function completeOpenNpcSocket(socket: Socket, p = identity(), capabilitiesOnly = false) {
  const { reconnectRequestId } = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId,
    executableWorkflowCommandIds: caps,
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
  });
  if (!capabilitiesOnly) socket.message(snapshot(p, reconnectRequestId));
  return reconnectRequestId;
}
describe('NPC readiness waits for a checked reconnect pair', () => {
  it('keeps cleanup and unsent discard in awaiting-snapshot after OPEN without a checked pair', async () => {
    const { c, socket, states, controls } = await client();
    c.stageNpcInput({ formId: 'NPC-002', values: editedInput() });
    const before = controls.at(-1);
    if (before?.formId !== 'NPC-002') throw Error('identity');
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    next.open();
    expect(states.at(-1)?.kind).toBe('awaiting-snapshot');
    c.setNpcInputPending(before.presentation.bindingKey, false);
    expect(states.at(-1)?.kind).toBe('awaiting-snapshot');
    expect(controls.at(-1)).toMatchObject({ presentation: { state: { readOnly: true } } });
    expect(c.discardNpcInput().ok).toBe(true);
    expect(states.at(-1)?.kind).toBe('awaiting-snapshot');
    expect(c.stageNpcInput({ formId: 'NPC-002', values: editedInput() }).ok).toBe(false);
    const correlation = completeOpenNpcSocket(next, identity(), true);
    c.setNpcInputPending(before.presentation.bindingKey, false);
    expect(states.at(-1)?.kind).toBe('awaiting-snapshot');
    expect(next.sent).toHaveLength(1);
    next.message(snapshot(identity(), correlation));
    expect(states.at(-1)?.kind).toBe('ready');
    expect(controls.at(-1)).toMatchObject({ presentation: { state: { readOnly: false } } });
  });
  it('keeps the actual App unmount cleanup awaiting the pair instead of remounting stale NPC controls', async () => {
    const socket = await mountNpc();
    await typeValue(namedInput('Имя НПС'), 'Pending local input');
    await act(async () => {
      socket.lost();
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-client-state="disconnected"]')).not.toBeNull();
    await act(async () => {
      namedButton('Переподключиться').click();
      await Promise.resolve();
    });
    const next = Socket.all.at(-1)!;
    await act(async () => {
      next.open();
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(container!.querySelector('[data-npc-content]')).toBeNull();
    expect(container!.querySelector('[aria-label="Локальный ввод НПС"]')).toBeNull();
    let correlation = '';
    await act(async () => {
      correlation = completeOpenNpcSocket(next, identity(), true);
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(container!.querySelector('[data-npc-content]')).toBeNull();
    await act(async () => {
      next.message(snapshot(identity(), correlation));
      await Promise.resolve();
    });
    expect(namedInput('Имя НПС').value).toBe('Pending local input');
    expect(namedInput('Имя НПС').matches(':disabled')).toBe(false);
    expect(next.sent).toHaveLength(1);
  });
  it('suspends NPC readiness during refusal refresh even without a preceding close event', async () => {
    const { c, socket, states, controls } = await client();
    c.stageNpcInput({ formId: 'NPC-002', values: editedInput() });
    c.applyNpcInput();
    const sent = JSON.parse(socket.sent.at(-1)!) as ReturnType<typeof request>;
    socket.message(editRefusal(sent));
    const next = Socket.all.at(-1)!;
    expect(next).not.toBe(socket);
    next.open();
    expect(states.at(-1)?.kind).toBe('awaiting-snapshot');
    const control = controls.at(-1);
    if (control?.formId !== 'NPC-002') throw Error('identity');
    expect(control.presentation.state.readOnly).toBe(true);
    c.setNpcInputPending(control.presentation.bindingKey, false);
    expect(states.at(-1)?.kind).toBe('awaiting-snapshot');
    expect(c.applyNpcInput().ok).toBe(false);
    completeOpenNpcSocket(next);
    expect(states.at(-1)?.kind).toBe('ready');
    expect(controls.at(-1)).toMatchObject({
      presentation: { input: editedInput(), state: { readOnly: false } },
    });
  });
});
type DiseaseProjection = Extract<NpcGmProjection, { formId: 'NPC-016' }>;
function diseaseProjection(): DiseaseProjection {
  return {
    ...scope,
    formId: 'NPC-016',
    campaignStatus: 'PAUSED',
    campaignPhase: 'PRE_START',
    libraryRevision: 0,
    attemptOrNull: { ...identity().attemptOrNull, stage: 'NPC-016', editMode: 'CREATE_V1' },
    content: {
      input: {
        input: {
          currentHP: { kind: 'ENTERED', value: 10 },
          effectInstanceIds: { kind: 'ENTERED', value: [] },
          traumaInstanceIds: { kind: 'ENTERED', value: [] },
          woundInstanceIds: { kind: 'ENTERED', value: [] },
          sourceSpecificStateFactIds: { kind: 'ENTERED', value: [] },
          deathConsequenceFactIdOrNull: { kind: 'ENTERED', value: null },
        },
        currentOeChanges: [],
      },
      errors: {},
      symbionts: [],
      choices: {
        effectInstanceIds: [],
        traumaInstanceIds: [],
        woundInstanceIds: [],
        sourceSpecificStateFactIds: [],
        deathConsequenceFactIdOrNull: [{ value: null, label: 'Без последствия смерти' }],
      },
      derivedRows: [],
      calendar: {
        requiresCampaignTime: false,
        validationStatus: 'NOT_REQUIRED',
        bindingOrNull: null,
        initialTimeLockOrNull: null,
        messages: [],
      },
      traumaPreparationOrNull: null,
      diseasePreparationOrNull: {
        capabilityKey: 'disease-actual-attempt-2',
        input: UNSET,
        choices: [
          { value: 'DIS-RHINITIS', label: 'Насморк' },
          { value: 'DIS-PNEUMONIA', label: 'Пневмония' },
        ],
        errors: [],
        canSubmit: true,
        explanation: 'Подготовка выбора; runtime создаётся только при сохранении НПС.',
      },
      woundPreparationOrNull: null,
      preparationBlockers: [],
      validationSummary: [],
    },
  };
}
function diseaseSnapshot(
  p: DiseaseProjection | InventoryProjection,
  correlation: string,
  reason = 'RECONNECT',
) {
  const read = decodeNpcProjection(p.formId, p, {
    ...scope,
    stateRevision: p.stateRevision,
    projectionRevision: p.projectionRevision,
  });
  if (!read.ok) throw Error('Invalid disease presentation fixture');
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'gm',
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
    presentation: {
      assignment: { reason, correlationId: correlation },
      base: {
        formId: p.formId,
        formType: 'screen',
        routeTemplate: `/master/campaigns/:campaignId/npc/${p.formId.toLowerCase()}`,
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: p.campaignId }],
        roleFilteredPayload: p,
        availableActionKeys: npcAvailableActions(read.value, caps),
      },
      layers: [],
    },
  };
}
function resumeDisease(
  socket: Socket,
  p: DiseaseProjection | InventoryProjection = diseaseProjection(),
) {
  socket.open();
  const r = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: r.reconnectRequestId,
    executableWorkflowCommandIds: caps,
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
  });
  socket.message(diseaseSnapshot(p, r.reconnectRequestId));
}
async function diseaseClient(p = diseaseProjection()) {
  return client((socket) => resumeDisease(socket, p));
}
function preparedDiseaseProjection(): DiseaseProjection {
  const p = diseaseProjection();
  return {
    ...p,
    stateRevision: 4,
    projectionRevision: 5,
    attemptOrNull: { ...p.attemptOrNull!, attemptRevision: 3, draftRevision: 3 },
    content: {
      ...p.content,
      choices: {
        ...p.content.choices,
        effectInstanceIds: [{ value: id(80), label: 'Насморк · host reservation' }],
      },
      traumaPreparationOrNull: null,
      diseasePreparationOrNull: {
        ...p.content.diseasePreparationOrNull!,
        capabilityKey: 'disease-actual-attempt-3',
      },
    },
  };
}
function diseaseResult(r: NpcPreparationRequest) {
  return {
    ...result(),
    operationId: r.operationId,
    sourceFormId: 'NPC-016',
    npcDraftId: r.npcDraftId,
  };
}
async function mountDisease(p: DiseaseProjection | InventoryProjection = diseaseProjection()) {
  setup();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const socket = Socket.all.at(-1)!;
  await act(async () => {
    resumeDisease(socket, p);
    await Promise.resolve();
  });
  return socket;
}
function diseaseSelect() {
  const field = [...container!.querySelectorAll('label')].find(
    (x) => x.textContent === 'Болезнь для назначения',
  );
  const select = field?.htmlFor
    ? document.getElementById(field.htmlFor)
    : field?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw Error('Missing disease select');
  return select;
}
async function chooseDisease(index: string) {
  await act(async () => {
    const select = diseaseSelect();
    select.value = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('actual NPC016 disease preparation controls', () => {
  it('sends the closed intent without an effect ID or calendar and exposes the host reservation only after its paired receipt', async () => {
    const { c, socket, controls } = await diseaseClient(),
      before = socket.sent.length;
    expect(c.reserveNpcDisease('stale-key', 'DIS-RHINITIS').ok).toBe(false);
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-POISONING').ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-RHINITIS')).toEqual({ ok: true });
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent).toEqual({
      messageType: 'network.npc-preparation.request',
      protocolVersion: 3,
      operationId: sent.operationId,
      campaignId: id(2),
      sourceFormId: 'NPC-016',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
      expectedRevisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 },
      preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-RHINITIS' },
    });
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-RHINITIS').ok).toBe(false);
    expect(socket.sent).toHaveLength(before + 1);
    socket.message(diseaseResult(sent));
    const awaiting = controls.at(-1);
    if (awaiting?.formId !== 'NPC-016') throw Error('Expected initial state');
    expect(awaiting.presentation.choices.effectInstanceIds).toEqual([]);
    socket.message(diseaseSnapshot(preparedDiseaseProjection(), sent.operationId, 'FORM_ACTION'));
    const confirmed = controls.at(-1);
    if (confirmed?.formId !== 'NPC-016') throw Error('Expected initial state');
    expect(confirmed.presentation.choices.effectInstanceIds).toEqual([
      { value: id(80), label: 'Насморк · host reservation' },
    ]);
    expect(confirmed.presentation.input.input.effectInstanceIds).toEqual({
      kind: 'ENTERED',
      value: [],
    });
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-RHINITIS').ok).toBe(false);
    expect(socket.sent).toHaveLength(before + 1);
  });
  it('keeps the exact disease request through a lost acknowledgement and reconnect', async () => {
    const { c, socket } = await diseaseClient();
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-PNEUMONIA').ok).toBe(true);
    const original = socket.sent.at(-1)!;
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next);
    expect(next.sent.at(-1)).toBe(original);
    expect(next.sent.filter((x) => x === original)).toHaveLength(1);
  });
  it('preserves dirty and disconnected fences before sending disease preparation', async () => {
    const { c, socket } = await diseaseClient(),
      before = socket.sent.length,
      p = diseaseProjection();
    expect(
      c.stageNpcInput({
        formId: 'NPC-016',
        values: {
          ...p.content.input,
          input: { ...p.content.input.input, currentHP: { kind: 'ENTERED', value: 9 } },
        },
      }).ok,
    ).toBe(true);
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-RHINITIS').ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    socket.lost();
    expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-RHINITIS').ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
  });
  it.each(['absent', 'withdrawn'] as const)(
    'does not send when the host capability is %s',
    async (kind) => {
      const p = diseaseProjection(),
        withCapability: DiseaseProjection = {
          ...p,
          content: {
            ...p.content,
            traumaPreparationOrNull: null,
            diseasePreparationOrNull:
              kind === 'absent'
                ? null
                : { ...p.content.diseasePreparationOrNull!, canSubmit: false },
          },
        };
      const { c, socket } = await diseaseClient(withCapability),
        before = socket.sent.length;
      expect(c.reserveNpcDisease('disease-actual-attempt-2', 'DIS-RHINITIS').ok).toBe(false);
      expect(socket.sent).toHaveLength(before);
    },
  );
  it('keeps the source choice local until PREPARE and selects the returned effect in a separate confirmed stage edit', async () => {
    const socket = await mountDisease(),
      before = socket.sent.length;
    expect(diseaseSelect().value).toBe('');
    expect(namedButton('Подготовить выбранную болезнь').matches(':disabled')).toBe(true);
    const entropy = vi.spyOn(crypto, 'getRandomValues');
    try {
      await chooseDisease('0');
      expect(socket.sent).toHaveLength(before);
      expect(entropy).not.toHaveBeenCalled();
    } finally {
      entropy.mockRestore();
    }
    await act(async () => {
      namedButton('Подготовить выбранную болезнь').click();
      await Promise.resolve();
    });
    expect(socket.sent).toHaveLength(before + 1);
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent.preparation).toEqual({ kind: 'DISEASE_RESERVE', diseaseId: 'DIS-RHINITIS' });
    await act(async () => {
      socket.message(diseaseResult(sent));
      await Promise.resolve();
    });
    expect(container!.textContent).not.toContain('host reservation');
    await act(async () => {
      socket.message(diseaseSnapshot(preparedDiseaseProjection(), sent.operationId, 'FORM_ACTION'));
      await Promise.resolve();
    });
    expect(diseaseSelect().value).toBe('');
    const checkbox = [...container!.querySelectorAll('label')]
      .find((x) => x.textContent?.includes('host reservation'))
      ?.querySelector('input');
    if (!(checkbox instanceof HTMLInputElement)) throw Error('Missing host effect choice');
    expect(checkbox.checked).toBe(false);
    await act(async () => {
      checkbox.click();
      await Promise.resolve();
    });
    expect(socket.sent).toHaveLength(before + 1);
    expect(namedButton('Подготовить выбранную болезнь').matches(':disabled')).toBe(true);
    await act(async () => {
      namedButton('Подтвердить ввод').click();
      await Promise.resolve();
    });
    const edit = JSON.parse(socket.sent.at(-1)!) as {
      messageType: string;
      values: NpcEditorStages['NPC-016'];
    };
    expect(edit.messageType).toBe('network.npc-editor.replace');
    expect(edit.values.input.effectInstanceIds).toEqual({ kind: 'ENTERED', value: [id(80)] });
    expect(socket.sent).toHaveLength(before + 2);
  });
  it('clears an unsent disease choice when a new host attempt revision arrives after reconnect', async () => {
    const socket = await mountDisease();
    await chooseDisease('1');
    await act(async () => {
      socket.lost();
      await Promise.resolve();
    });
    await act(async () => {
      namedButton('Переподключиться').click();
      await Promise.resolve();
    });
    const next = Socket.all.at(-1)!;
    await act(async () => {
      resumeDisease(next, preparedDiseaseProjection());
      await Promise.resolve();
    });
    expect(diseaseSelect().value).toBe('');
    expect(namedButton('Подготовить выбранную болезнь').matches(':disabled')).toBe(true);
    expect(next.sent).toHaveLength(1);
  });
});

function traumaProjection(): DiseaseProjection {
  const p = diseaseProjection();
  return {
    ...p,
    content: {
      ...p.content,
      diseasePreparationOrNull: null,
      traumaPreparationOrNull: {
        capabilityKey: 'trauma-actual-attempt-2',
        canSubmit: true,
        explanation: 'Новая исходная травма без автоматически заданных параметров.',
        regions: [
          { value: 'HEAD', label: 'Голова' },
          { value: 'TORSO', label: 'Корпус' },
        ],
        retainedIds: [],
        errors: {},
      },
    },
  };
}
function preparedTraumaProjection(): DiseaseProjection {
  const p = traumaProjection();
  return {
    ...p,
    stateRevision: 4,
    projectionRevision: 5,
    attemptOrNull: { ...p.attemptOrNull!, attemptRevision: 3, draftRevision: 3 },
    content: {
      ...p.content,
      input: {
        ...p.content.input,
        input: {
          ...p.content.input.input,
          traumaInputs: {
            kind: 'ENTERED',
            value: [
              {
                traumaInstanceId: id(81),
                input: { regionId: UNSET, traumaValue: UNSET, reason: UNSET },
                head: UNSET,
              },
            ],
          },
        },
      },
      choices: {
        ...p.content.choices,
        traumaInstanceIds: [{ value: id(81), label: 'Новая травма · host reservation' }],
      },
      traumaPreparationOrNull: {
        ...p.content.traumaPreparationOrNull!,
        capabilityKey: 'trauma-actual-attempt-3',
      },
    },
  };
}
function traumaSelect(label: string): HTMLSelectElement {
  const field = [...container!.querySelectorAll('label')].find((x) => x.textContent === label);
  const select = field?.htmlFor
    ? document.getElementById(field.htmlFor)
    : field?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw Error('Missing trauma select ' + label);
  return select;
}
async function chooseTrauma(label: string, value: string) {
  await act(async () => {
    const select = traumaSelect(label);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}
describe('actual NPC016 trauma preparation controls', () => {
  it('sends exactly the closed reserve intent from the real App button and waits for the paired host row', async () => {
    const socket = await mountDisease(traumaProjection()),
      before = socket.sent.length;
    expect(container!.textContent).not.toContain('Величина травмы');
    await act(async () => {
      namedButton('Добавить новую исходную травму').click();
      await Promise.resolve();
    });
    expect(socket.sent).toHaveLength(before + 1);
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(sent).toEqual({
      messageType: 'network.npc-preparation.request',
      protocolVersion: 3,
      operationId: sent.operationId,
      campaignId: id(2),
      sourceFormId: 'NPC-016',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
      expectedRevisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 },
      preparation: { kind: 'TRAUMA_RESERVE' },
    });
    expect(namedButton('Добавить новую исходную травму').matches(':disabled')).toBe(true);
    await act(async () => {
      namedButton('Добавить новую исходную травму').click();
      socket.message(diseaseResult(sent));
      await Promise.resolve();
    });
    expect(socket.sent).toHaveLength(before + 1);
    expect(container!.textContent).not.toContain('host reservation');
    expect(container!.textContent).not.toContain('Величина травмы');
    await act(async () => {
      socket.message(diseaseSnapshot(preparedTraumaProjection(), sent.operationId, 'FORM_ACTION'));
      await Promise.resolve();
    });
    expect(traumaSelect('Зона травмы').value).toBe('');
    expect(namedInput('Величина травмы').value).toBe('');
    expect(namedInput('Причина травмы').value).toBe('');
    expect(container!.textContent).not.toContain('Остаток оглушения, минуты');
    const choice = [...container!.querySelectorAll('label')]
      .find((x) => x.textContent?.includes('host reservation'))
      ?.querySelector('input');
    if (!(choice instanceof HTMLInputElement)) throw Error('Missing reserved trauma choice');
    expect(choice.checked).toBe(false);
    expect(socket.sent).toHaveLength(before + 1);
  });
  it('keeps partial HEAD inputs local and sends exact decimal text only on explicit stage confirmation', async () => {
    const socket = await mountDisease(preparedTraumaProjection()),
      before = socket.sent.length,
      exact = '0.100000000000000005';
    const entropy = vi.spyOn(crypto, 'getRandomValues');
    try {
      await chooseTrauma('Зона травмы', '0');
      expect(traumaSelect('Одноразовый штраф головы').value).toBe('');
      expect(traumaSelect('Оглушение головы').value).toBe('');
      await chooseTrauma('Одноразовый штраф головы', '0');
      await chooseTrauma('Оглушение головы', '1');
      expect(namedInput('Остаток оглушения, минуты').value).toBe('');
      await typeValue(namedInput('Остаток оглушения, минуты'), exact);
      expect(namedInput('Остаток оглушения, минуты').value).toBe(exact);
      expect(namedInput('Величина травмы').value).toBe('');
      expect(namedInput('Причина травмы').value).toBe('');
      expect(namedButton('Добавить новую исходную травму').matches(':disabled')).toBe(true);
      await act(async () => {
        namedButton('Добавить новую исходную травму').click();
        await Promise.resolve();
      });
      expect(socket.sent).toHaveLength(before);
      expect(entropy).not.toHaveBeenCalled();
    } finally {
      entropy.mockRestore();
    }
    await act(async () => {
      namedButton('Подтвердить ввод').click();
      await Promise.resolve();
    });
    expect(socket.sent).toHaveLength(before + 1);
    const sent = JSON.parse(socket.sent.at(-1)!) as {
      messageType: string;
      sourceFormId: string;
      expectedAttemptRevision: number;
      values: NpcEditorStages['NPC-016'];
    };
    expect(sent.messageType).toBe('network.npc-editor.replace');
    expect(sent.sourceFormId).toBe('NPC-016');
    expect(sent.expectedAttemptRevision).toBe(3);
    expect(sent.values).toEqual({
      ...preparedTraumaProjection().content.input,
      input: {
        ...preparedTraumaProjection().content.input.input,
        traumaInputs: {
          kind: 'ENTERED',
          value: [
            {
              traumaInstanceId: id(81),
              input: {
                regionId: { kind: 'ENTERED', value: 'HEAD' },
                traumaValue: UNSET,
                reason: UNSET,
              },
              head: {
                kind: 'ENTERED',
                value: {
                  penalty: { kind: 'ENTERED', value: 'PENDING' },
                  stun: {
                    kind: 'ENTERED',
                    value: {
                      status: 'ACTIVE',
                      remainingMinutes: { kind: 'ENTERED', value: exact },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    });
  });
  it.each(['absent', 'withdrawn'] as const)(
    'refuses reserve when the host capability is %s',
    async (kind) => {
      const p = traumaProjection();
      const { c, socket } = await diseaseClient({
        ...p,
        content: {
          ...p.content,
          traumaPreparationOrNull:
            kind === 'absent' ? null : { ...p.content.traumaPreparationOrNull!, canSubmit: false },
        },
      });
      const before = socket.sent.length;
      expect(c.reserveNpcTrauma('trauma-actual-attempt-2').ok).toBe(false);
      expect(socket.sent).toHaveLength(before);
    },
  );
  it('refuses stale capability, local dirty input, an in-flight reserve and a disconnected session without extra frames', async () => {
    const p = traumaProjection(),
      { c, socket } = await diseaseClient(p),
      before = socket.sent.length;
    expect(c.reserveNpcTrauma('trauma-old-attempt').ok).toBe(false);
    expect(
      c.stageNpcInput({
        formId: 'NPC-016',
        values: {
          ...p.content.input,
          input: { ...p.content.input.input, currentHP: { kind: 'ENTERED', value: 9 } },
        },
      }).ok,
    ).toBe(true);
    expect(c.reserveNpcTrauma('trauma-actual-attempt-2').ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(c.reserveNpcTrauma('trauma-actual-attempt-2').ok).toBe(true);
    expect(c.reserveNpcTrauma('trauma-actual-attempt-2').ok).toBe(false);
    expect(socket.sent).toHaveLength(before + 1);
    socket.lost();
    expect(c.reserveNpcTrauma('trauma-actual-attempt-2').ok).toBe(false);
    expect(socket.sent).toHaveLength(before + 1);
  });
  it('replays the same reserve bytes after a lost acknowledgement without adding a client trauma identity', async () => {
    const { c, socket } = await diseaseClient(traumaProjection());
    expect(c.reserveNpcTrauma('trauma-actual-attempt-2').ok).toBe(true);
    const original = socket.sent.at(-1)!;
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, traumaProjection());
    expect(next.sent.at(-1)).toBe(original);
    expect(next.sent.filter((frame) => frame === original)).toHaveLength(1);
    expect((JSON.parse(original) as NpcPreparationRequest).preparation).toEqual({
      kind: 'TRAUMA_RESERVE',
    });
  });
});

describe('NPC016 calendar-bound forward controls', () => {
  it.each(['MISSING', 'CURRENT', 'NOT_REQUIRED'] as const)(
    'keeps preparation and preview reachable while %s controls final-review navigation',
    async (status) => {
      const p = preparedDiseaseProjection();
      const selected = status !== 'NOT_REQUIRED';
      const missing = status === 'MISSING';
      const projection: DiseaseProjection = {
        ...p,
        content: {
          ...p.content,
          input: {
            ...p.content.input,
            input: {
              ...p.content.input.input,
              effectInstanceIds: { kind: 'ENTERED', value: selected ? [id(80)] : [] },
            },
          },
          calendar: {
            requiresCampaignTime: selected,
            validationStatus: status,
            bindingOrNull:
              status === 'CURRENT'
                ? {
                    kind: 'PRE_START_INITIAL',
                    campaignTimestamp: 60,
                    lobbySnapshotRevision: 'd'.repeat(64),
                  }
                : null,
            initialTimeLockOrNull: null,
            messages: missing ? ['Подтвердите начальное время кампании'] : [],
          },
          validationSummary: missing ? ['Подтвердите начальное время кампании'] : [],
          derivedRows: [{ label: 'Проверенный предварительный результат', value: 'Насморк' }],
        },
      };
      const socket = await mountDisease(projection);
      const buttons = [...container!.querySelectorAll('button')];
      expect(buttons.some((b) => b.textContent === 'Перейти к итоговой проверке')).toBe(!missing);
      expect(buttons.some((b) => b.textContent === 'Открыть начальное время кампании')).toBe(true);
      expect(container!.textContent).toContain('Проверенный предварительный результат');
      expect(diseaseSelect()).toBeInstanceOf(HTMLSelectElement);
      expect(socket.sent).toHaveLength(1);
    },
  );
});

describe('NPC017 source-bound save action', () => {
  it.each(['CREATE_V1', 'APPEND_N_PLUS_ONE'] as const)(
    'uses the same save action and only the bound %s workflow capability',
    (mode) => {
      const f = commitFixture(mode);
      expect(npcAvailableActions(f.projection, caps)).toEqual([
        'NPC-017::CTA::002',
        'NPC-017::CTA::003',
      ]);
      const wrongCapability =
        mode === 'CREATE_V1' ? 'UI-CMD-NPC-NEW-VERSION' : 'UI-CMD-NPC-COMMIT-V1';
      expect(npcAvailableActions(f.projection, [wrongCapability])).toEqual(['NPC-017::CTA::003']);
      expect(npcBrowserWorkflow(f.projection, 'NPC-017::CTA::004', id(90))).toBeNull();
      expect(npcBrowserWorkflow(f.projection, 'NPC-017::CTA::003', id(91))).toBeNull();
    },
  );
  it.each(['CREATE_V1', 'APPEND_N_PLUS_ONE'] as const)(
    'clicks the actual Atlas save button for %s and sends exactly one bound workflow',
    async (mode) => {
      const f = commitFixture(mode),
        socket = await mountNpc(f.projection);
      expect(container!.querySelectorAll('[data-npc-content="NPC-017"]')).toHaveLength(1);
      expect(container!.textContent).not.toContain('Открыть сохранённый лист после receipt');
      const button = namedButton('Сохранить NPC атомарно');
      expect(button.matches(':disabled')).toBe(false);
      const before = socket.sent.length;
      await act(async () => {
        button.click();
        await Promise.resolve();
      });
      expect(socket.sent).toHaveLength(before + 1);
      const sent = JSON.parse(socket.sent.at(-1)!) as { commandId: string };
      expect(sent.commandId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(sent).toEqual({ ...f.request, commandId: sent.commandId });
      expect(
        container!.querySelectorAll('[data-atlas-action-key="NPC-017::CTA::002"]:not(:disabled)'),
      ).toHaveLength(0);
    },
  );
});

type CompositionProjection = Extract<NpcGmProjection, { formId: 'NPC-013' }>;
function compositionProjection(
  continuations: readonly NpcAvailableContinuation[] = [],
): CompositionProjection {
  return {
    ...scope,
    formId: 'NPC-013',
    campaignStatus: 'PAUSED',
    campaignPhase: 'PRE_START',
    libraryRevision: 0,
    attemptOrNull: {
      ...identity().attemptOrNull,
      stage: 'NPC-013',
      editMode: 'CREATE_V1',
    },
    content: {
      input: { kind: 'ENTERED', value: [] },
      species: [],
      canAdd: true,
      errors: {},
      computedRows: {},
      compositionSummary: [],
      continuations,
    },
  };
}
function compositionSnapshot(p: CompositionProjection, correlation: string) {
  const decoded = decodeNpcProjection(p.formId, p, scope);
  if (!decoded.ok) throw Error('Invalid composition presentation fixture');
  const envelope = snapshot(identity(), correlation);
  return {
    ...envelope,
    presentation: {
      ...envelope.presentation,
      base: {
        ...envelope.presentation.base,
        formId: p.formId,
        routeTemplate: '/master/campaigns/:campaignId/npc/npc-013',
        roleFilteredPayload: p,
        availableActionKeys: npcAvailableActions(decoded.value, caps),
      },
    },
  };
}
function resumeComposition(socket: Socket, p: CompositionProjection) {
  socket.open();
  const reconnect = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: reconnect.reconnectRequestId,
    executableWorkflowCommandIds: caps,
    revisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 },
  });
  socket.message(compositionSnapshot(p, reconnect.reconnectRequestId));
}
async function mountComposition(p: CompositionProjection) {
  setup();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const socket = Socket.all.at(-1)!;
  await act(async () => {
    resumeComposition(socket, p);
    await Promise.resolve();
  });
  return socket;
}
async function compositionButton(label: string) {
  const button = [...container!.querySelectorAll('button')].find(
    (entry) => entry.textContent === label,
  );
  if (button === undefined) throw Error('Missing composition button ' + label);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe('NPC013 composition controls and transport', () => {
  const confirm: NpcAvailableContinuation = {
    capabilityKey: 'confirmed-source-2',
    kind: 'CONFIRM_COMPOSITION',
    label: 'Подтвердить состав и последствия',
    explanation: 'Подтверждённый состав хоста',
    diceMode: 'NO_ROLL',
    rolls: [],
  };
  it('allocates through the host and preserves the exact reserve request after a lost acknowledgement', async () => {
    const p = compositionProjection(),
      { c, socket } = await client((s) => resumeComposition(s, p));
    expect(c.reserveNpcSymbiont()).toEqual({ ok: true });
    const raw = socket.sent.at(-1)!,
      sent = JSON.parse(raw) as NpcPreparationRequest;
    expect(sent).toMatchObject({
      messageType: 'network.npc-preparation.request',
      sourceFormId: 'NPC-013',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
      preparation: { kind: 'SYMBIONT_RESERVE', values: p.content.input },
    });
    expect(Object.keys(sent.preparation).sort()).toEqual(['kind', 'values']);
    expect(c.reserveNpcSymbiont().ok).toBe(false);
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeComposition(next, p);
    expect(next.sent.at(-1)).toBe(raw);
    expect(next.sent.filter((frame) => frame === raw)).toHaveLength(1);
  });
  it('refuses stale capabilities, dirty input and attempts to use confirmation as a roll', async () => {
    const p = compositionProjection([confirm]),
      { c, socket } = await client((s) => resumeComposition(s, p));
    const before = socket.sent.length;
    expect(c.confirmNpcComposition('old-capability').ok).toBe(false);
    expect(
      c.resolveNpcComposition(confirm.capabilityKey, { kind: 'FREE_SLOT_ROLL', manualFaces: null })
        .ok,
    ).toBe(false);
    expect(c.stageNpcInput({ formId: 'NPC-013', values: UNSET }).ok).toBe(true);
    expect(c.confirmNpcComposition(confirm.capabilityKey).ok).toBe(false);
    expect(c.reserveNpcSymbiont().ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(c.confirmNpcComposition(confirm.capabilityKey)).toEqual({ ok: true });
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent.preparation).toEqual({ kind: 'COMPOSITION_CONFIRM', values: p.content.input });
  });
  it('connects the visible confirmation button to the closed current composition request', async () => {
    const p = compositionProjection([confirm]),
      socket = await mountComposition(p);
    await compositionButton('Подтвердить состав и последствия');
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent).toMatchObject({
      sourceFormId: 'NPC-013',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
    });
    expect(sent.preparation).toEqual({ kind: 'COMPOSITION_CONFIRM', values: p.content.input });
  });
  it('keeps a MANUAL face blank until entered and sends no authoritative outcome', async () => {
    const p = compositionProjection([
      {
        capabilityKey: 'manual-source-2',
        kind: 'FREE_SLOT_ROLL',
        label: 'Подтвердить R6',
        explanation: 'Грань вводит GM; последствия вычисляет хост',
        diceMode: 'MANUAL',
        rolls: [
          { key: 'slot', label: 'Грань свободного слота', dieSides: 6, input: UNSET, errors: [] },
        ],
      },
    ]);
    const socket = await mountComposition(p),
      before = socket.sent.length;
    await compositionButton('Подтвердить R6');
    expect(socket.sent).toHaveLength(before);
    const label = [...container!.querySelectorAll('label')].find(
      (entry) => entry.textContent === 'Грань свободного слота',
    );
    const field = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (!(field instanceof HTMLInputElement)) throw Error('Missing manual face');
    expect(field.value).toBe('');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '4');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await compositionButton('Подтвердить R6');
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent.preparation).toEqual({
      kind: 'COMPOSITION_RESOLVE',
      capabilityKey: 'manual-source-2',
      input: { kind: 'FREE_SLOT_ROLL', manualFaces: [4] },
    });
  });
});

function woundProjection(): DiseaseProjection {
  const p = diseaseProjection();
  return {
    ...p,
    content: {
      ...p.content,
      diseasePreparationOrNull: null,
      woundPreparationOrNull: {
        capabilityKey: 'wound-actual-attempt-2',
        input: { woundType: UNSET, regionId: UNSET, damagePerTick: UNSET },
        typeChoices: [
          { value: 'GENERIC', label: 'Обычная рана' },
          { value: 'BLEEDING', label: 'Кровотечение' },
        ],
        regionChoices: [
          { value: 'TORSO', label: 'Корпус' },
          { value: 'ARM_L', label: 'Левая рука' },
        ],
        errors: {},
        canSubmit: true,
        explanation: 'Явное назначение мастера; урон и боевой ход не создаются.',
      },
    },
  };
}
async function chooseWoundField(label: string, index: string) {
  const node = [...container!.querySelectorAll('label')].find(
    (entry) => entry.textContent === label,
  );
  const select = node?.htmlFor ? document.getElementById(node.htmlFor) : null;
  if (!(select instanceof HTMLSelectElement)) throw Error('Missing wound choice ' + label);
  await act(async () => {
    select.value = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}
describe('NPC016 actual wound controls and transport', () => {
  it('rejects stale, dirty and unavailable preparation and preserves exact bytes after lost acknowledgement', async () => {
    const p = woundProjection(),
      { c, socket } = await diseaseClient(p);
    const input = { woundType: 'GENERIC' as const, regionId: 'ARM_L' as const };
    const before = socket.sent.length;
    expect(c.prepareNpcWound('expired', input).ok).toBe(false);
    expect(c.prepareNpcWound('wound-actual-attempt-2', { ...input, regionId: 'HEAD' }).ok).toBe(
      false,
    );
    expect(
      c.stageNpcInput({
        formId: 'NPC-016',
        values: {
          ...p.content.input,
          input: { ...p.content.input.input, currentHP: { kind: 'ENTERED', value: 9 } },
        },
      }).ok,
    ).toBe(true);
    expect(c.prepareNpcWound('wound-actual-attempt-2', input).ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(c.prepareNpcWound('wound-actual-attempt-2', input).ok).toBe(true);
    const raw = socket.sent.at(-1)!,
      sent = JSON.parse(raw) as NpcPreparationRequest;
    expect(sent.preparation).toEqual({ kind: 'WOUND_PREPARE', input });
    expect(sent).toMatchObject({
      sourceFormId: 'NPC-016',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
    });
    expect(c.prepareNpcWound('wound-actual-attempt-2', input).ok).toBe(false);
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(raw);
  });
  it('requires explicit wound kind, region and bleeding damage, including an entered zero', async () => {
    const socket = await mountDisease(woundProjection()),
      before = socket.sent.length;
    await compositionButton('Подготовить рану');
    expect(socket.sent).toHaveLength(before);
    await chooseWoundField('Вид раны', '1');
    await chooseWoundField('Область раны', '0');
    const damage = namedInput('Урон кровотечения за тик');
    expect(damage.value).toBe('');
    await compositionButton('Подготовить рану');
    expect(socket.sent).toHaveLength(before);
    await typeValue(damage, '0');
    await compositionButton('Подготовить рану');
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent.preparation).toEqual({
      kind: 'WOUND_PREPARE',
      input: { woundType: 'BLEEDING', regionId: 'TORSO', damagePerTick: 0 },
    });
  });
  it('submits a generic wound without importing a hidden bleeding damage or runtime fields', async () => {
    const socket = await mountDisease(woundProjection());
    await chooseWoundField('Вид раны', '1');
    await chooseWoundField('Область раны', '1');
    await typeValue(namedInput('Урон кровотечения за тик'), '3');
    await chooseWoundField('Вид раны', '0');
    await compositionButton('Подготовить рану');
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent.preparation).toEqual({
      kind: 'WOUND_PREPARE',
      input: { woundType: 'GENERIC', regionId: 'ARM_L' },
    });
  });
});

type InventoryProjection = Extract<NpcGmProjection, { formId: 'NPC-015' }>;
function inventoryProjection(): InventoryProjection {
  return {
    ...scope,
    formId: 'NPC-015',
    campaignStatus: 'PAUSED',
    campaignPhase: 'PRE_START',
    libraryRevision: 0,
    attemptOrNull: { ...identity().attemptOrNull, stage: 'NPC-015', editMode: 'CREATE_V1' },
    content: {
      input: { kind: 'ENTERED', value: [] },
      choices: {
        itemTypes: [],
        profileKinds: [],
        equippedSlots: [],
        bodyZones: [],
        gripModes: [],
        linkedSets: [],
        componentRoles: [],
        coatings: [],
        qualityRolls: [],
        weaponVariants: [],
        dicePatterns: [],
        heldSizes: [],
        armorWeights: [],
        flammabilities: [],
        stats: [],
      },
      canAdd: true,
      errors: {},
      previewRows: {},
      validationSummary: [],
      compatibilityPreparationOrNull: {
        capabilityKey: 'equipment-current-2',
        orderedItems: [
          { itemInstanceId: id(81), label: 'Надетая броня' },
          { itemInstanceId: id(82), label: 'Удерживаемое оружие' },
        ],
        input: { reason: UNSET },
        errors: [],
        canSubmit: true,
        explanation: 'Подтверждение относится только к показанному составу экипировки.',
      },
    },
  };
}
function compositeInventoryProjection(): InventoryProjection {
  const p = inventoryProjection();
  return {
    ...p,
    content: {
      ...p.content,
      compatibilityPreparationOrNull: null,
      compositePreparationOrNull: {
        capabilityKey: 'composite-current-2',
        choices: [{ value: 'ITM-WPN-026', label: 'Корнадора — меч и щит' }],
        canSubmit: true,
        errors: [],
        explanation: 'Хост создаёт связанный набор и два физических предмета.',
      },
    },
  };
}
function customInventoryProjection(): InventoryProjection {
  const p = inventoryProjection();
  return {
    ...p,
    content: {
      ...p.content,
      compatibilityPreparationOrNull: null,
      customPreparationOrNull: {
        capabilityKey: 'custom-current-2',
        canAdd: true,
        modifierTargets: [{ itemInstanceId: id(81), label: 'Предмет каталога' }],
        versionTargets: [
          {
            itemInstanceId: id(82),
            profileId: id(83),
            profileVersionId: id(84),
            label: 'Сохранённая версия',
          },
        ],
        backpackChoices: [{ value: id(85), label: 'Рюкзак НПС' }],
        editableProfileVersionIds: [],
        errors: [],
        explanation: 'Идентичности профилей выдаёт хост.',
      },
    },
  };
}
describe('NPC015 custom item intent delivery', () => {
  it('connects the real add-custom control to a reservation without invented IDs', async () => {
    const socket = await mountDisease(customInventoryProjection()),
      before = socket.sent.length;
    await compositionButton('Добавить произвольный предмет');
    expect(socket.sent).toHaveLength(before + 1);
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent).toMatchObject({
      sourceFormId: 'NPC-015',
      npcDraftId: id(3),
      expectedAttemptRevision: 2,
    });
    expect(sent.preparation).toEqual({
      kind: 'CUSTOM_ITEM_RESERVE',
      values: { kind: 'ENTERED', value: [] },
    });
    expect(socket.sent.at(-1)).not.toContain('profileId');
    expect(socket.sent.at(-1)).not.toContain('itemInstanceId');
  });
  it.each(['ITEM', 'MODIFIER', 'VERSION'] as const)(
    'requires exact offered %s targets and replays the same reservation after a lost response',
    async (kind) => {
      const p = customInventoryProjection(),
        { c, socket } = await client((s) => resumeDisease(s, p)),
        before = socket.sent.length;
      expect(c.reserveNpcCustomItem('old-custom').ok).toBe(false);
      expect(c.reserveNpcCustomModifier('custom-current-2', id(99)).ok).toBe(false);
      expect(c.reserveNpcCustomProfileVersion('custom-current-2', id(82), id(83), id(99)).ok).toBe(
        false,
      );
      expect(socket.sent).toHaveLength(before);
      const send = () =>
        kind === 'ITEM'
          ? c.reserveNpcCustomItem('custom-current-2')
          : kind === 'MODIFIER'
            ? c.reserveNpcCustomModifier('custom-current-2', id(81))
            : c.reserveNpcCustomProfileVersion('custom-current-2', id(82), id(83), id(84));
      expect(c.stageNpcInput({ formId: 'NPC-015', values: UNSET }).ok).toBe(true);
      expect(send().ok).toBe(false);
      expect(c.discardNpcInput().ok).toBe(true);
      expect(send().ok).toBe(true);
      const original = socket.sent.at(-1)!;
      const expected =
        kind === 'ITEM'
          ? { kind: 'CUSTOM_ITEM_RESERVE' }
          : kind === 'MODIFIER'
            ? { kind: 'CUSTOM_MODIFIER_RESERVE', itemInstanceId: id(81) }
            : {
                kind: 'CUSTOM_PROFILE_VERSION_RESERVE',
                itemInstanceId: id(82),
                profileId: id(83),
                expectedProfileVersionId: id(84),
              };
      expect((JSON.parse(original) as NpcPreparationRequest).preparation).toEqual({
        ...expected,
        values: p.content.input,
      });
      expect(send().ok).toBe(false);
      socket.lost();
      expect(c.reconnect().ok).toBe(true);
      const next = Socket.all.at(-1)!;
      resumeDisease(next, p);
      expect(next.sent.at(-1)).toBe(original);
    },
  );
  it('does not offer a custom reservation from a projection that lacks the capability', async () => {
    const { c, socket } = await client((s) => resumeDisease(s, inventoryProjection())),
      before = socket.sent.length;
    expect(c.reserveNpcCustomItem('custom-current-2').ok).toBe(false);
    expect(c.reserveNpcCustomModifier('custom-current-2', id(81)).ok).toBe(false);
    expect(c.reserveNpcCustomProfileVersion('custom-current-2', id(82), id(83), id(84)).ok).toBe(
      false,
    );
    expect(socket.sent).toHaveLength(before);
  });
});

function restoreInventoryProjection(): InventoryProjection {
  const p = inventoryProjection();
  const attempt = p.attemptOrNull;
  if (attempt === null) throw Error('Expected fixture attempt');
  return {
    ...p,
    attemptOrNull: {
      ...attempt,
      editMode: 'APPEND_N_PLUS_ONE',
      versionBindingOrNull: { npcUuid: attempt.candidateNpcUuid, expectedCurrentVersion: 2 },
    },
    content: {
      ...p.content,
      restorePreparationOrNull: {
        capabilityKey: 'restore-current-2',
        choices: [{ value: id(91), label: 'Сохранённый меч и его щит' }],
        canSubmit: true,
        errors: [],
        explanation:
          'Вернётся тот же экземпляр в последнем сохранённом состоянии. Конфликты экипировки потребуется разрешить.',
      },
    },
  };
}
describe('NPC015 real historical item restore control', () => {
  it('requires an explicit historical item choice and sends exact identity without a new profile', async () => {
    const p = restoreInventoryProjection(),
      socket = await mountDisease(p),
      before = socket.sent.length;
    const label = [...container!.querySelectorAll('label')].find(
      (x) => x.textContent === 'Предмет из истории',
    );
    const select = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (!(select instanceof HTMLSelectElement)) throw Error('Missing historical item select');
    expect(select.value).toBe('');
    await compositionButton('Вернуть предмет из истории');
    expect(socket.sent).toHaveLength(before);
    await act(async () => {
      select.value = '0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await compositionButton('Вернуть предмет из истории');
    expect(socket.sent).toHaveLength(before + 1);
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
      kind: 'ITEM_RESTORE',
      capabilityKey: 'restore-current-2',
      itemInstanceId: id(91),
      values: p.content.input,
    });
  });
  it('fences stale/foreign/dirty/pending restore and replays the lost request bytes', async () => {
    const p = restoreInventoryProjection(),
      { c, socket } = await client((s) => resumeDisease(s, p)),
      before = socket.sent.length;
    expect(c.restoreNpcItem('stale', id(91)).ok).toBe(false);
    expect(c.restoreNpcItem('restore-current-2', id(92)).ok).toBe(false);
    expect(c.stageNpcInput({ formId: 'NPC-015', values: UNSET }).ok).toBe(true);
    expect(c.restoreNpcItem('restore-current-2', id(91)).ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(c.restoreNpcItem('restore-current-2', id(91)).ok).toBe(true);
    const raw = socket.sent.at(-1)!;
    expect(c.restoreNpcItem('restore-current-2', id(91)).ok).toBe(false);
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(raw);
  });
});
describe('NPC015 composite inventory controls', () => {
  it('requires an explicit source pair and sends no invented identities or default mechanics', async () => {
    const socket = await mountDisease(compositeInventoryProjection()),
      before = socket.sent.length;
    const label = [...container!.querySelectorAll('label')].find(
      (x) => x.textContent === 'Составной набор для добавления',
    );
    const select = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (!(select instanceof HTMLSelectElement)) throw Error('Missing composite select');
    expect(select.value).toBe('');
    await compositionButton('Добавить составной набор');
    expect(socket.sent).toHaveLength(before);
    await act(async () => {
      select.value = '0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await compositionButton('Добавить составной набор');
    expect(socket.sent).toHaveLength(before + 1);
    const sent = JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest;
    expect(sent).toMatchObject({
      sourceFormId: 'NPC-015',
      expectedAttemptRevision: 2,
      npcDraftId: id(3),
    });
    expect(sent.preparation).toEqual({
      kind: 'COMPOSITE_ITEM_RESERVE',
      input: { itemTypeId: 'ITM-WPN-026' },
    });
    expect(socket.sent.at(-1)).not.toContain('itemInstanceId');
  });
  it('refuses unavailable or dirty choices and replays exact pair intent after a lost response', async () => {
    const p = compositeInventoryProjection(),
      { c, socket } = await client((s) => resumeDisease(s, p)),
      before = socket.sent.length;
    expect(c.reserveNpcCompositeItem('ITM-WPN-027').ok).toBe(false);
    expect(c.stageNpcInput({ formId: 'NPC-015', values: UNSET }).ok).toBe(true);
    expect(c.reserveNpcCompositeItem('ITM-WPN-026').ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(c.reserveNpcCompositeItem('ITM-WPN-026').ok).toBe(true);
    const original = socket.sent.at(-1)!;
    expect(c.reserveNpcCompositeItem('ITM-WPN-026').ok).toBe(false);
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(original);
  });
});

function compatibilityCheckbox(): HTMLInputElement {
  const label = [...container!.querySelectorAll('label')].find((x) =>
    x.textContent?.includes('Подтверждаю физическую совместимость перечисленных предметов'),
  );
  const field = label?.querySelector('input');
  if (!(field instanceof HTMLInputElement)) throw Error('Missing equipment confirmation checkbox');
  return field;
}
describe('NPC015 equipment compatibility controls', () => {
  it('requires explicit reason and confirmation for the visible ordered equipment', async () => {
    const socket = await mountDisease(inventoryProjection()),
      before = socket.sent.length;
    expect(
      [...container!.querySelectorAll('ol[aria-label="Проверяемые предметы экипировки"] li')].map(
        (x) => x.textContent,
      ),
    ).toEqual(['Надетая броня', 'Удерживаемое оружие']);
    expect(compatibilityCheckbox().checked).toBe(false);
    await compositionButton('Подтвердить совместимость экипировки');
    expect(socket.sent).toHaveLength(before);
    await writeNpcTextArea('Обоснование совместимости экипировки', 'Предметы не мешают друг другу');
    await compositionButton('Подтвердить совместимость экипировки');
    expect(socket.sent).toHaveLength(before);
    await act(async () => {
      compatibilityCheckbox().click();
      await Promise.resolve();
    });
    await compositionButton('Подтвердить совместимость экипировки');
    expect(socket.sent).toHaveLength(before + 1);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      messageType: 'network.npc-preparation.request',
      sourceFormId: 'NPC-015',
      preparation: {
        kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM',
        input: {
          capabilityKey: 'equipment-current-2',
          reason: 'Предметы не мешают друг другу',
        },
      },
    });
  });
  it('rejects stale, blank and dirty requests and replays the identical submitted request', async () => {
    const p = inventoryProjection(),
      { c, socket } = await client((s) => resumeDisease(s, p)),
      before = socket.sent.length;
    expect(c.confirmNpcEquipmentCompatibility('expired', 'Explicit reason').ok).toBe(false);
    expect(c.confirmNpcEquipmentCompatibility('equipment-current-2', ' ').ok).toBe(false);
    expect(c.stageNpcInput({ formId: 'NPC-015', values: UNSET }).ok).toBe(true);
    expect(c.confirmNpcEquipmentCompatibility('equipment-current-2', 'Explicit reason').ok).toBe(
      false,
    );
    expect(socket.sent).toHaveLength(before);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(c.confirmNpcEquipmentCompatibility('equipment-current-2', 'Explicit reason').ok).toBe(
      true,
    );
    const original = socket.sent.at(-1)!;
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(original);
  });
  it('clears local consent when the host presents a different equipment capability', async () => {
    const p = inventoryProjection(),
      socket = await mountDisease(p);
    await writeNpcTextArea('Обоснование совместимости экипировки', 'Старое подтверждение');
    await act(async () => {
      compatibilityCheckbox().click();
      await Promise.resolve();
    });
    expect(compatibilityCheckbox().checked).toBe(true);
    const updated: InventoryProjection = {
      ...p,
      stateRevision: 4,
      projectionRevision: 5,
      attemptOrNull: { ...p.attemptOrNull!, attemptRevision: 3, draftRevision: 3 },
      content: {
        ...p.content,
        compatibilityPreparationOrNull: {
          ...p.content.compatibilityPreparationOrNull!,
          capabilityKey: 'equipment-current-3',
          orderedItems: [{ itemInstanceId: id(83), label: 'Другой предмет' }],
        },
      },
    };
    await act(async () => {
      socket.message(
        diseaseSnapshot(updated, `network-gm-view:${'a'.repeat(64)}`, 'HOST_SYSTEM_EVENT'),
      );
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('Другой предмет');
    expect(compatibilityCheckbox().checked).toBe(false);
    const button = namedButton('Подтвердить совместимость экипировки');
    expect(button.disabled).toBe(true);
  });
});

function effectPreparationProjection(): DiseaseProjection {
  const p = diseaseProjection();
  return {
    ...p,
    content: {
      ...p.content,
      diseasePreparationOrNull: null,
      alcoholPreparationOrNull: {
        capabilityKey: 'alcohol-current-2',
        input: { reason: UNSET },
        errors: {},
        canSubmit: true,
        explanation: 'Назначение по текущей защите от яда и здоровью.',
        derivedRows: [{ label: 'Первый тик', value: '11:30' }],
      },
      hpModePreparations: [
        {
          capabilityKey: 'weaver-current-2',
          mode: 'REGENERATION',
          sourceLabel: 'Ткач',
          input: { reason: UNSET, remainingMinutes: UNSET },
          maximumRemainingMinutes: '5',
          errors: {},
          canSubmit: true,
          explanation: 'Исходное состояние, без повторной активации.',
          derivedRows: [{ label: 'Максимум HP', value: '1000' }],
        },
      ],
      formalControlPreparations: (['SLEEP', 'PARALYSIS'] as const).map((controlKind) => ({
        capabilityKey: `formal-${controlKind}-2`,
        controlKind,
        sourceLabel: controlKind === 'SLEEP' ? 'Снотворное' : 'Отвар-паралитик',
        input: { reason: UNSET, remainingMinutes: UNSET },
        maximumRemainingMinutes: '60',
        errors: {},
        canSubmit: true,
        explanation: 'Текущее состояние без приёма препарата.',
        derivedRows: [],
      })),
    },
  };
}
function weaverPreparationProjection(selected = false): DiseaseProjection {
  const p = diseaseProjection();
  return {
    ...p,
    content: {
      ...p.content,
      input: {
        ...p.content.input,
        input: {
          ...p.content.input.input,
          weaverEffectInstanceIds: { kind: 'ENTERED', value: selected ? [id(96)] : [] },
        },
        currentOeChanges: [
          { symbiontInstanceId: id(95), currentOE: { kind: 'ENTERED', value: 0 } },
        ],
      },
      symbionts: [
        {
          symbiontInstanceId: id(95),
          label: 'Ткач',
          currentOE: { kind: 'ENTERED', value: 0 },
          maximumOrNull: 100,
          errors: [],
        },
      ],
      temporaryWeaverStatePreparations: [
        {
          capabilityKey: 'weaver-state-current-2',
          sourceInstanceId: id(95),
          sourceLabel: 'Ткач',
          branchChoices: [
            {
              value: 'REPLACEMENT_TEMPORARY',
              label: 'Временная замена',
              maximumRemainingMinutes: '5',
            },
            {
              value: 'REPLACEMENT_RECOVERY',
              label: 'Замена с восстановлением',
              maximumRemainingMinutes: '7',
            },
            {
              value: 'DUPLICATED_ORGANS_PROTECTION',
              label: 'Неиспользованная защита',
              maximumRemainingMinutes: '10',
            },
          ],
          input: { branch: UNSET, reason: UNSET, remainingMinutes: UNSET },
          canSubmit: true,
          errors: {},
          explanation: 'Явное текущее состояние без прошлого R20 и расхода ОЭ.',
          derivedRows: [
            {
              label: 'Совместимость сроков',
              value: 'Срок смерти должен покрывать восстановление; продления нет.',
            },
          ],
        },
      ],
      temporaryWeaverStates: selected
        ? [
            {
              capabilityKey: 'weaver-remove-current-2',
              effectInstanceId: id(96),
              sourceLabel: 'Ткач',
              branch: 'REPLACEMENT_RECOVERY',
              canRemove: true,
              errors: [],
              explanation: 'Исходный срок сохранён.',
              derivedRows: [{ label: 'Восстановление', value: 'При отсутствии новой потери HP' }],
            },
          ]
        : [],
    },
  };
}
describe('formal Weaver current-state controls', () => {
  it.each([
    'REPLACEMENT_TEMPORARY',
    'REPLACEMENT_RECOVERY',
    'DUPLICATED_ORGANS_PROTECTION',
  ] as const)(
    'requires explicit fields and sends offered %s without a roll, cost or editable time',
    async (branch) => {
      const socket = await mountDisease(weaverPreparationProjection()),
        before = socket.sent.length;
      expect(traumaSelect('Вариант состояния Ткача').value).toBe('');
      expect(namedInput('Остаток состояния Ткача, минуты').value).toBe('');
      expect(namedButton('Подготовить состояние Ткача').disabled).toBe(true);
      await chooseTrauma('Вариант состояния Ткача', branch);
      await typeValue(namedInput('Остаток состояния Ткача, минуты'), '0.125');
      expect(namedButton('Подготовить состояние Ткача').disabled).toBe(true);
      await writeNpcTextArea('Причина исходного состояния Ткача', 'Текущее исходное состояние');
      expect(container!.textContent).toContain('Срок смерти должен покрывать восстановление');
      await compositionButton('Подготовить состояние Ткача');
      expect(socket.sent).toHaveLength(before + 1);
      expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
        kind: 'WEAVER_STATE_PREPARE',
        input: {
          capabilityKey: 'weaver-state-current-2',
          sourceInstanceId: id(95),
          branch,
          remainingMinutes: '0.125',
          reason: 'Текущее исходное состояние',
        },
      });
    },
  );
  it('shows the original state and requires a separate reason before removal', async () => {
    const socket = await mountDisease(weaverPreparationProjection(true));
    expect(container!.textContent).toContain('Исходный срок сохранён.');
    expect(namedButton('Снять состояние Ткача').disabled).toBe(true);
    await writeNpcTextArea('Причина снятия состояния Ткача', 'Явно снять исходное состояние');
    await compositionButton('Снять состояние Ткача');
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
      kind: 'WEAVER_STATE_REMOVE',
      input: {
        capabilityKey: 'weaver-remove-current-2',
        effectInstanceId: id(96),
        reason: 'Явно снять исходное состояние',
      },
    });
  });
  it('fences stale/foreign/dirty/pending requests and replays exactly after a lost response', async () => {
    const p = weaverPreparationProjection(true),
      { c, socket } = await diseaseClient(p),
      before = socket.sent.length;
    const input = {
      capabilityKey: 'weaver-state-current-2',
      sourceInstanceId: id(95),
      branch: 'REPLACEMENT_RECOVERY' as const,
      remainingMinutes: '0.125',
      reason: 'Current state',
    };
    expect(c.prepareNpcWeaverState({ ...input, capabilityKey: 'stale' }).ok).toBe(false);
    expect(c.prepareNpcWeaverState({ ...input, sourceInstanceId: id(94) }).ok).toBe(false);
    expect(
      c.removeNpcWeaverState({
        capabilityKey: 'weaver-remove-current-2',
        effectInstanceId: id(94),
        reason: 'Removal',
      }).ok,
    ).toBe(false);
    expect(c.stageNpcInput({ formId: 'NPC-016', values: p.content.input }).ok).toBe(true);
    expect(c.prepareNpcWeaverState(input).ok).toBe(false);
    expect(
      c.removeNpcWeaverState({
        capabilityKey: 'weaver-remove-current-2',
        effectInstanceId: id(96),
        reason: 'Removal',
      }).ok,
    ).toBe(false);
    expect(c.discardNpcInput().ok).toBe(true);
    expect(socket.sent).toHaveLength(before);
    expect(c.prepareNpcWeaverState(input).ok).toBe(true);
    expect(c.prepareNpcWeaverState(input).ok).toBe(false);
    const raw = socket.sent.at(-1)!;
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(raw);
  });
  it('refuses an unoffered branch and disabled removal even with a current key', async () => {
    const p = weaverPreparationProjection(true);
    const { c, socket } = await diseaseClient({
      ...p,
      content: {
        ...p.content,
        temporaryWeaverStatePreparations: p.content.temporaryWeaverStatePreparations!.map(
          (entry) => ({
            ...entry,
            branchChoices: entry.branchChoices.filter(
              (choice) => choice.value === 'REPLACEMENT_TEMPORARY',
            ),
          }),
        ),
        temporaryWeaverStates: p.content.temporaryWeaverStates!.map((entry) => ({
          ...entry,
          canRemove: false,
        })),
      },
    });
    const before = socket.sent.length;
    expect(
      c.prepareNpcWeaverState({
        capabilityKey: 'weaver-state-current-2',
        sourceInstanceId: id(95),
        branch: 'REPLACEMENT_RECOVERY',
        remainingMinutes: '1',
        reason: 'Current state',
      }).ok,
    ).toBe(false);
    expect(
      c.removeNpcWeaverState({
        capabilityKey: 'weaver-remove-current-2',
        effectInstanceId: id(96),
        reason: 'Removal',
      }).ok,
    ).toBe(false);
    expect(socket.sent).toHaveLength(before);
  });
});

function lifePreparationProjection(
  mode: 'AUTO' | 'MANUAL' = 'AUTO',
  rolled = false,
  retained = false,
): DiseaseProjection {
  const p = effectPreparationProjection();
  return {
    ...p,
    content: {
      ...p.content,
      lifeStatePreparationOrNull: {
        capabilityKey: 'life-current-2',
        canRoll: !rolled && !retained,
        canSubmit: true,
        diceMode: mode,
        lifeChoices: [
          { value: 'ALIVE', label: 'Жив' },
          { value: 'SEVERELY_WOUNDED', label: 'Тяжёлое ранение' },
          { value: 'DEAD', label: 'Окончательная смерть' },
        ],
        input: { lifeKind: UNSET, reason: UNSET, remainingMinutes: UNSET },
        retainedTimer: retained,
        rollOrNull: rolled || retained ? { rawFace: 3, mode, receiptId: id(94) } : null,
        maximumRemainingMinutesOrNull: rolled || retained ? '15' : null,
        errors: {},
        explanation: 'Явный текущий снимок без входящего урона.',
        derivedRows: [{ label: 'Дубль органов', value: 'Доказанного действующего дубля нет' }],
      },
    },
  };
}
describe('NPC016 life state real controls and exact preparation transport', () => {
  it('starts without a life default and sends ALIVE without a fabricated timer or roll', async () => {
    const socket = await mountDisease(lifePreparationProjection()),
      before = socket.sent.length;
    expect(traumaSelect('Исходное жизненное состояние').value).toBe('');
    expect(namedButton('Подтвердить жизненное состояние').disabled).toBe(true);
    await chooseTrauma('Исходное жизненное состояние', 'ALIVE');
    await writeNpcTextArea('Причина жизненного состояния', 'Явно заданное состояние');
    await compositionButton('Подтвердить жизненное состояние');
    expect(socket.sent).toHaveLength(before + 1);
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
      kind: 'LIFE_STATE_SET',
      input: {
        capabilityKey: 'life-current-2',
        lifeKind: 'ALIVE',
        reason: 'Явно заданное состояние',
        remainingMinutesOrNull: null,
      },
    });
  });
  it.each(['AUTO', 'MANUAL'] as const)(
    'records %s D6 through the visible roll control without choosing a remainder',
    async (mode) => {
      const socket = await mountDisease(lifePreparationProjection(mode)),
        before = socket.sent.length;
      await chooseTrauma('Исходное жизненное состояние', 'SEVERELY_WOUNDED');
      expect(namedButton('Подтвердить жизненное состояние').disabled).toBe(true);
      await writeNpcTextArea('Причина жизненного состояния', 'Исходное тяжёлое ранение');
      if (mode === 'MANUAL') {
        expect(namedInput('Действительный результат D6').value).toBe('');
        expect(namedButton('Зафиксировать D6 таймера смерти').disabled).toBe(true);
        await typeValue(namedInput('Действительный результат D6'), '4');
      }
      await compositionButton('Зафиксировать D6 таймера смерти');
      expect(socket.sent).toHaveLength(before + 1);
      expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
        kind: 'LIFE_STATE_ROLL',
        input: {
          capabilityKey: 'life-current-2',
          reason: 'Исходное тяжёлое ранение',
          manualFaceOrNull: mode === 'AUTO' ? null : 4,
        },
      });
    },
  );
  it('shows saved roll receipt and keeps the new remainder blank until explicitly entered', async () => {
    const socket = await mountDisease(lifePreparationProjection('AUTO', true));
    await chooseTrauma('Исходное жизненное состояние', 'SEVERELY_WOUNDED');
    expect(container!.textContent).toContain(id(94));
    expect(namedInput('Остаток таймера смерти, минуты').value).toBe('');
    await writeNpcTextArea('Причина жизненного состояния', 'Точный текущий остаток');
    expect(namedButton('Подтвердить жизненное состояние').disabled).toBe(true);
    await typeValue(namedInput('Остаток таймера смерти, минуты'), '0.125');
    await compositionButton('Подтвердить жизненное состояние');
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
      kind: 'LIFE_STATE_SET',
      input: {
        capabilityKey: 'life-current-2',
        lifeKind: 'SEVERELY_WOUNDED',
        reason: 'Точный текущий остаток',
        remainingMinutesOrNull: '0.125',
      },
    });
  });
  it('retains the original severe timer without editable remaining or another roll', async () => {
    const socket = await mountDisease(lifePreparationProjection('AUTO', true, true));
    await chooseTrauma('Исходное жизненное состояние', 'SEVERELY_WOUNDED');
    expect(container!.textContent).toContain('Повторный бросок');
    expect(
      [...container!.querySelectorAll('label')].some(
        (n) => n.textContent === 'Остаток таймера смерти, минуты',
      ),
    ).toBe(false);
    await writeNpcTextArea('Причина жизненного состояния', 'Сохранить исходное ранение');
    await compositionButton('Подтвердить жизненное состояние');
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toMatchObject({
      kind: 'LIFE_STATE_SET',
      input: { lifeKind: 'SEVERELY_WOUNDED', remainingMinutesOrNull: null },
    });
  });
  it('shows terminal DEAD behavior and uses no life roll or timer', async () => {
    const socket = await mountDisease(lifePreparationProjection());
    await chooseTrauma('Исходное жизненное состояние', 'DEAD');
    expect(container!.textContent).toContain('обычная правка не воскрешает NPC');
    await writeNpcTextArea('Причина жизненного состояния', 'Окончательная смерть уже наступила');
    await compositionButton('Подтвердить жизненное состояние');
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toMatchObject({
      kind: 'LIFE_STATE_SET',
      input: { lifeKind: 'DEAD', remainingMinutesOrNull: null },
    });
  });
  it('refuses stale/unoffered/manual-mode mismatches and replays lost roll bytes exactly', async () => {
    const p = lifePreparationProjection(),
      { c, socket } = await diseaseClient(p),
      before = socket.sent.length;
    const input = {
      capabilityKey: 'life-current-2',
      reason: 'Formal severe wound',
      manualFaceOrNull: null,
    };
    expect(c.prepareNpcLifeRoll({ ...input, capabilityKey: 'stale' }).ok).toBe(false);
    expect(c.prepareNpcLifeRoll({ ...input, manualFaceOrNull: 4 }).ok).toBe(false);
    expect(
      c.prepareNpcLifeState({
        capabilityKey: input.capabilityKey,
        reason: input.reason,
        lifeKind: 'SEVERELY_WOUNDED',
        remainingMinutesOrNull: '5',
      }).ok,
    ).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.prepareNpcLifeRoll(input).ok).toBe(true);
    const raw = socket.sent.at(-1)!;
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(raw);
  });
  it('refuses a life choice removed by the current host capability', async () => {
    const p = lifePreparationProjection();
    const preparation = p.content.lifeStatePreparationOrNull!;
    const { c, socket } = await diseaseClient({
      ...p,
      content: {
        ...p.content,
        lifeStatePreparationOrNull: {
          ...preparation,
          lifeChoices: preparation.lifeChoices.filter((choice) => choice.value !== 'ALIVE'),
        },
      },
    });
    const before = socket.sent.length;
    expect(
      c.prepareNpcLifeState({
        capabilityKey: preparation.capabilityKey,
        lifeKind: 'ALIVE',
        reason: 'An earlier projection offered this choice',
        remainingMinutesOrNull: null,
      }).ok,
    ).toBe(false);
    expect(socket.sent).toHaveLength(before);
  });
});
async function writeNpcTextArea(label: string, value: string) {
  const node = [...container!.querySelectorAll('label')].find(
    (entry) => entry.textContent === label,
  );
  const field = node?.htmlFor ? document.getElementById(node.htmlFor) : null;
  if (!(field instanceof HTMLTextAreaElement)) throw Error('Missing textarea ' + label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}
describe('NPC016 effect preparation controls', () => {
  it.each([
    ['SLEEP', 'Сон'],
    ['PARALYSIS', 'Паралич'],
  ] as const)(
    'uses real %s controls and sends one exact current-state request',
    async (controlKind, label) => {
      const p = effectPreparationProjection(),
        socket = await mountDisease(p);
      const before = socket.sent.length;
      const duration = namedInput(`Остаток состояния «${label}», минуты`);
      expect(duration.value).toBe('');
      await compositionButton(`Подготовить состояние «${label}»`);
      expect(socket.sent).toHaveLength(before);
      await typeValue(duration, '30.125');
      await writeNpcTextArea(`Причина исходного состояния «${label}»`, 'Явно заданное состояние');
      await compositionButton(`Подготовить состояние «${label}»`);
      const raw = socket.sent.at(-1)!;
      expect((JSON.parse(raw) as NpcPreparationRequest).preparation).toEqual({
        kind: 'FORMAL_CONTROL_SET',
        input: {
          capabilityKey: `formal-${controlKind}-2`,
          controlKind,
          remainingMinutes: '30.125',
          reason: 'Явно заданное состояние',
        },
      });
      expect(socket.sent).toHaveLength(before + 1);
    },
  );
  it('binds formal control kind to its offered key and preserves pending bytes after lost response', async () => {
    const p = effectPreparationProjection(),
      { c, socket } = await diseaseClient(p);
    const input = {
      capabilityKey: 'formal-SLEEP-2',
      controlKind: 'SLEEP' as const,
      remainingMinutes: '2.5',
      reason: 'Current state',
    };
    const before = socket.sent.length;
    expect(c.prepareNpcFormalControl({ ...input, controlKind: 'PARALYSIS' }).ok).toBe(false);
    expect(c.prepareNpcFormalControl({ ...input, capabilityKey: 'expired' }).ok).toBe(false);
    expect(c.prepareNpcFormalControl({ ...input, remainingMinutes: '2.50' }).ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.prepareNpcFormalControl(input).ok).toBe(true);
    const raw = socket.sent.at(-1)!;
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(raw);
  });
  it('submits only the explicit alcohol reason and preserves the request on reconnect', async () => {
    const p = effectPreparationProjection(),
      { c, socket } = await diseaseClient(p);
    const before = socket.sent.length;
    expect(c.prepareNpcAlcohol('expired', { reason: 'Назначение мастера' }).ok).toBe(false);
    expect(c.prepareNpcAlcohol('alcohol-current-2', { reason: '' }).ok).toBe(false);
    expect(socket.sent).toHaveLength(before);
    expect(c.prepareNpcAlcohol('alcohol-current-2', { reason: 'Назначение мастера' }).ok).toBe(
      true,
    );
    const raw = socket.sent.at(-1)!;
    expect((JSON.parse(raw) as NpcPreparationRequest).preparation).toEqual({
      kind: 'ALCOHOL_PREPARE',
      input: { reason: 'Назначение мастера' },
    });
    socket.lost();
    expect(c.reconnect().ok).toBe(true);
    const next = Socket.all.at(-1)!;
    resumeDisease(next, p);
    expect(next.sent.at(-1)).toBe(raw);
  });
  it('uses the visible alcohol reason control without local Z, immunity or calendar decisions', async () => {
    const socket = await mountDisease(effectPreparationProjection()),
      before = socket.sent.length;
    expect(container!.textContent).toContain('Первый тик');
    expect(container!.textContent).toContain('11:30');
    await compositionButton('Подготовить алкогольное отравление');
    expect(socket.sent).toHaveLength(before);
    await writeNpcTextArea('Причина назначения алкогольного отравления', 'Явно заданное состояние');
    await compositionButton('Подготовить алкогольное отравление');
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
      kind: 'ALCOHOL_PREPARE',
      input: { reason: 'Явно заданное состояние' },
    });
  });
  it('keeps the HP mode duration blank, preserves exact decimal input and sends the offered capability only', async () => {
    const socket = await mountDisease(effectPreparationProjection()),
      before = socket.sent.length;
    const duration = namedInput('Остаток режима «Регенерация», минуты');
    expect(duration.value).toBe('');
    expect(container!.textContent).toContain('1000');
    await writeNpcTextArea('Причина исходного режима «Регенерация»', 'Уже действующая регенерация');
    await compositionButton('Подготовить режим «Регенерация»');
    expect(socket.sent).toHaveLength(before);
    await typeValue(duration, '0.125');
    await compositionButton('Подготовить режим «Регенерация»');
    expect((JSON.parse(socket.sent.at(-1)!) as NpcPreparationRequest).preparation).toEqual({
      kind: 'HP_MODE_PREPARE',
      input: {
        capabilityKey: 'weaver-current-2',
        remainingMinutes: '0.125',
        reason: 'Уже действующая регенерация',
      },
    });
  });
  it('refuses unavailable, stale, noncanonical and dirty HP mode intents before transport', async () => {
    const p = effectPreparationProjection(),
      { c, socket } = await diseaseClient(p),
      before = socket.sent.length;
    const input = {
      capabilityKey: 'weaver-current-2',
      remainingMinutes: '2.5',
      reason: 'Current state',
    };
    expect(c.prepareNpcHpMode({ ...input, capabilityKey: 'foreign-source' }).ok).toBe(false);
    expect(c.prepareNpcHpMode({ ...input, remainingMinutes: '2.50' }).ok).toBe(false);
    expect(
      c.stageNpcInput({
        formId: 'NPC-016',
        values: {
          ...p.content.input,
          input: { ...p.content.input.input, currentHP: { kind: 'ENTERED', value: 9 } },
        },
      }).ok,
    ).toBe(true);
    expect(c.prepareNpcHpMode(input).ok).toBe(false);
    expect(c.prepareNpcAlcohol('alcohol-current-2', { reason: 'Current state' }).ok).toBe(false);
    expect(
      c.prepareNpcFormalControl({
        capabilityKey: 'formal-SLEEP-2',
        controlKind: 'SLEEP',
        remainingMinutes: '2.5',
        reason: 'Current state',
      }).ok,
    ).toBe(false);
    expect(socket.sent).toHaveLength(before);
  });
});
