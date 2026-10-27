// @vitest-environment node

import { resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionKey } from '@generated/types/atlas.js';
import {
  decodeClientMessage,
  decodeClientMessageV2,
  encodeHostMessage,
  encodeHostMessageV2,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  ClientToHostV2Message,
  CommandReceipt,
  HostToClientMessage,
  HostToClientV2Message,
  JsonObject,
  RevisionVector,
  SessionReconnectCapabilitiesV2Message,
} from '@shared/index.js';

import { commitManualComposition } from '../../../host/creation-manual-composition.js';
import {
  commitManualAdvisorIw,
  commitManualAdvisorSkills,
} from '../../../host/creation-manual-advisor.js';
import { commitAdvisorIntelligenceFloorRoll } from '../../../host/creation-advisor-intelligence-floor.js';
import type {
  ManualAdvisorIwRollCommandRequest,
  ManualCompositionCheckpointCommandRequest,
} from '../../../host/creation-manual-composition-contract.js';
import {
  handleSymbiontAddressableRoute,
  advanceManualSymbiontPresentation,
} from '../../../host/creation-manual-composition-navigation.js';
import { currentCreationWizardRevisions } from '../../../host/creation-set-decide.js';
import type { DurableCreationWizardCheckpoint } from '../../../host/creation-set-decide.js';
import {
  loadCreationSkillCatalog,
  type CreationSkillCatalog,
} from '../../../host/creation-skill-catalog.js';
import type { openPersistenceDatabase } from '../../../persistence/index.js';
import {
  loadSymbiontMediaCatalog,
  type SymbiontMediaPreview,
} from '../../../host/symbiont-media.js';
import {
  projectManualChr017,
  projectManualChr018,
  projectManualChr019,
  projectManualChr041,
} from '../../../host/projections/chr-manual-symbionts.js';
import type { SymbiontSpeciesKey } from '../../../domain/index.js';
import {
  createManualWizardSetup,
  exactManualAdvisorSkills,
  manualAdvisorFloorRollRequest,
  manualAdvisorIwRequest,
  manualAdvisorSkillRequest,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../../../tests/fixtures/manual-symbiont-stage.js';
import { advisorIntelligenceFloorSnapshotMatchesReceipt } from './random-symbionts.js';
import { connectProjection, WEB_PROTOCOL_VOCABULARY } from '../../ws-client.js';
import type {
  ConfirmedProjectionSnapshot,
  ManualCompositionDraft,
  ProjectionConnection,
  WebClientState,
} from '../../ws-client.js';
import {
  decodeChr017ManualProjection,
  decodeChr018Projection,
  decodeChr019ManualProjection,
  decodeChr041ManualProjection,
  decodeManualAdvisorIwTerminal,
  manualAdvisorIwPayload,
  manualCompositionDraftFromSnapshot,
  manualCompositionPayload,
  toggleManualCompositionSpecies,
} from './manual-symbionts.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
let media: ReadonlyMap<SymbiontSpeciesKey, SymbiontMediaPreview>;
let presentation: CreationSkillCatalog;

beforeAll(async () => {
  [media, presentation] = await Promise.all([
    loadSymbiontMediaCatalog(PROJECT_ROOT),
    loadCreationSkillCatalog(
      PROJECT_ROOT,
      (await import('../../../../tests/fixtures/symbiont-stage.js')).CATALOG.skillStage,
    ),
  ]);
});

const connections: ProjectionConnection[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.disconnect();
  FakeWebSocket.instances.splice(0);
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

const WEB_CHARACTER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function setup(prefix: string, race: 'FREE' | 'UNITED' = 'FREE'): ManualWizardSetup {
  const result = createManualWizardSetup(prefix, race, 'MANUAL', ':memory:', WEB_CHARACTER_ID);
  databases.push(result.database);
  return result;
}

function card(
  value: ManualWizardSetup,
  speciesKey: SymbiontSpeciesKey,
): DurableCreationWizardCheckpoint {
  return handleSymbiontAddressableRoute(
    value.database,
    {
      characterDraftId: value.characterDraftId,
      wizardCheckpointId: value.wizardCheckpointId,
      speciesKey,
    },
    value.catalog,
    media,
  );
}

function snapshot(
  formId: 'CHR-017' | 'CHR-018' | 'CHR-019' | 'CHR-041',
  projection: JsonObject,
  availableActionKeys: readonly ActionKey[],
  path: string,
): ConfirmedProjectionSnapshot {
  return {
    availableActionKeys,
    executableWorkflowCommandIds: [
      'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      'UI-CMD-CHAR-CREATION-SET-DECIDE',
      'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    ],
    formId,
    layers: [],
    path,
    projection,
    revisions: { actorVisibilityRevision: 1, projectionRevision: 10, stateRevision: 5 },
  } as unknown as ConfirmedProjectionSnapshot;
}

function noRolls() {
  return {
    catalog: undefined,
    allocateRollRequestId: () => {
      throw new Error('no request expected');
    },
    sampleD20: () => {
      throw new Error('no roll expected');
    },
  };
}

describe('manual symbiont strict projections and replacement draft', () => {
  it('decodes CHR-017 and exact CHR-018 media without private fields', () => {
    const value = setup('web-manual-card');
    const catalog = projectManualChr017(value.checkpoint, value.catalog);
    const decodedCatalog = decodeChr017ManualProjection(catalog.roleFilteredPayload, '$.payload');
    expect(decodedCatalog.ok).toBe(true);
    const opened = card(value, 'EEL');
    const projection = projectManualChr018(opened, value.catalog, media, true);
    const decoded = decodeChr018Projection(projection.roleFilteredPayload, '$.payload');
    expect(decoded).toMatchObject({
      ok: true,
      value: {
        artAndTreePreview: {
          artPath: '/generated/media/symbionts/EEL.png',
          developmentTreePath: '/generated/media/development-trees/EEL.png',
        },
        bindingChoiceOrReadOnly: { defaultSide: 'RIGHT', kind: 'CHOICE' },
        speciesKey: 'EEL',
      },
    });
    for (const invalid of [
      { ...projection.roleFilteredPayload, sourceQuestionIds: ['Q-CHAR-010'] },
      {
        ...projection.roleFilteredPayload,
        artAndTreePreview: {
          artPath: '/generated/media/symbionts/OWL.png',
          developmentTreePath: '/generated/media/development-trees/EEL.png',
        },
      },
    ]) {
      expect(decodeChr018Projection(invalid, '$.payload').ok).toBe(false);
    }
  });

  it('keeps pending I/W free of fabricated skill capacity and decodes exact skills later', () => {
    const value = setup('web-manual-advisor', 'UNITED');
    const opened = card(value, 'ADVISER');
    const dependencies = {
      catalog: value.catalog,
      allocateRollRequestId: (() => {
        let index = 0;
        return () => `web-advisor-request-${String(index++)}`;
      })(),
      sampleD20: () => {
        throw new Error('pending composition must not sample');
      },
    };
    const current = commitManualComposition(
      value.database,
      manualCompositionRequest(value, opened, 'web-advisor-add', [
        'ADVISER',
        'TAIPAN',
        'WEAVER',
        'OWL',
      ]),
      'web-advisor-add-receipt',
      dependencies,
    );
    const pending = projectManualChr041(current, value.catalog, presentation, true, true);
    const decodedPending = decodeChr041ManualProjection(pending.roleFilteredPayload, '$.payload');
    expect(decodedPending).toMatchObject({
      ok: true,
      value: { advisorSlotsAndSkills: { kind: 'IW_ROLLS_REQUIRED' } },
    });
    const rolled = commitManualAdvisorIw(
      value.database,
      manualAdvisorIwRequest(value, current, 'web-advisor-iw', [3, 5]),
      ['web-advisor-i-receipt', 'web-advisor-w-receipt'],
      dependencies,
    );
    const options = projectManualChr041(rolled, value.catalog, presentation, true, true);
    expect(decodeChr041ManualProjection(options.roleFilteredPayload, '$.payload')).toMatchObject({
      ok: true,
      value: { advisorIPlus8OrNull: 11, advisorWPlus8OrNull: 13 },
    });
    const source = snapshot(
      'CHR-041',
      pending.roleFilteredPayload,
      pending.availableActionKeys,
      '/chr-041',
    );
    expect(manualAdvisorIwPayload(source, [3, 5])).toMatchObject({
      manualFacesOrNull: [3, 5],
      pendingRollRequestIds: current.manualCompositionStage?.iwRollRequestIdsOrNull,
      variant: 'ADVISOR_IW',
    });
    expect(() => manualAdvisorIwPayload(source, null)).toThrow(/two complete MANUAL faces/u);
  });

  it('retains a local removal through presentation navigation and submits a full replacement', () => {
    const value = setup('web-manual-replacement');
    const first = card(value, 'EEL');
    const current = commitManualComposition(
      value.database,
      manualCompositionRequest(
        value,
        first,
        'web-replacement-add',
        ['EEL'],
        [{ speciesKey: 'EEL', side: 'RIGHT' }],
      ),
      'web-replacement-add-receipt',
      { ...noRolls(), catalog: value.catalog },
    );
    const summary = projectManualChr019(current, value.catalog);
    const decodedSummary = decodeChr019ManualProjection(summary.roleFilteredPayload, '$.payload');
    expect(decodedSummary.ok).toBe(true);
    const summarySnapshot = snapshot(
      'CHR-019',
      summary.roleFilteredPayload,
      summary.availableActionKeys,
      '/chr-019',
    );
    const catalogCheckpoint = advanceManualSymbiontPresentation(
      value.database,
      {
        characterDraftId: value.characterDraftId,
        wizardCheckpointId: value.wizardCheckpointId,
        formId: 'CHR-017',
      },
      value.catalog,
    );
    const catalog = projectManualChr017(catalogCheckpoint, value.catalog);
    const catalogSnapshot = snapshot(
      'CHR-017',
      catalog.roleFilteredPayload,
      catalog.availableActionKeys,
      '/chr-017',
    );
    let draft = manualCompositionDraftFromSnapshot(summarySnapshot, null);
    expect(draft?.entries).toHaveLength(1);
    draft = manualCompositionDraftFromSnapshot(catalogSnapshot, draft);
    const nextCard = projectManualChr018(card(value, 'OWL'), value.catalog, media, true);
    const nextSnapshot = snapshot(
      'CHR-018',
      nextCard.roleFilteredPayload,
      nextCard.availableActionKeys,
      '/chr-018/OWL',
    );
    draft = manualCompositionDraftFromSnapshot(nextSnapshot, draft);
    if (draft === null) throw new Error('expected an active manual composition draft');
    expect(draft.entries.map((entry) => entry.speciesKey)).toEqual(['EEL']);
    draft = toggleManualCompositionSpecies(nextSnapshot, draft, 'OWL', true);
    expect(() => manualCompositionPayload(nextSnapshot, draft)).toThrow(/cardinality/u);
    draft = toggleManualCompositionSpecies(nextSnapshot, draft, 'EEL', false);
    expect(draft.entries.map((entry) => entry.speciesKey)).toEqual(['OWL']);
    const restored = projectManualChr017(
      advanceManualSymbiontPresentation(
        value.database,
        {
          characterDraftId: value.characterDraftId,
          wizardCheckpointId: value.wizardCheckpointId,
          formId: 'CHR-017',
        },
        value.catalog,
      ),
      value.catalog,
    );
    const retained = manualCompositionDraftFromSnapshot(
      snapshot('CHR-017', restored.roleFilteredPayload, restored.availableActionKeys, '/chr-017'),
      draft,
    );
    if (retained === null) throw new Error('expected retained local composition');
    expect(retained.entries.map((entry) => entry.speciesKey)).toEqual(['OWL']);
    const cardAgain = projectManualChr018(card(value, 'OWL'), value.catalog, media, true);
    const payload = manualCompositionPayload(
      snapshot(
        'CHR-018',
        cardAgain.roleFilteredPayload,
        cardAgain.availableActionKeys,
        '/chr-018/OWL',
      ),
      retained,
    );
    expect(payload).toMatchObject({
      acceptedSpecies: [{ acceptedIndex: 0, speciesKey: 'OWL' }],
      compositionDraftRevision: current.manualCompositionStage?.compositionDraftRevision,
      selectedBindings: [{ side: 'RIGHT', speciesKey: 'OWL' }],
      sourceFormId: 'CHR-018',
      variant: 'MANUAL_COMPOSITION',
    });
    expect(payload).not.toHaveProperty('randomSequenceId');
    expect(
      manualCompositionDraftFromSnapshot(catalogSnapshot, null)?.entries.map(
        (entry) => entry.speciesKey,
      ),
    ).toEqual(['EEL']);
  });
});

describe('manual Advisor roll-time B recovery', () => {
  it('accepts a later replacement only against the preserved B receipt and minimum', () => {
    const value = setup('roll-time-b', 'UNITED');
    const allocated: string[] = [];
    const dependencies = {
      catalog: value.catalog,
      allocateRollRequestId: () => {
        const id = [
          'roll-time-advisor',
          'roll-time-i-request',
          'roll-time-w-request',
          'roll-time-b-request',
        ][allocated.length];
        if (id === undefined) throw new Error('unexpected request allocation');
        allocated.push(id);
        return id;
      },
      sampleD20: () => {
        throw new Error('MANUAL rolls must not sample');
      },
    };
    const opened = card(value, 'TROGR');
    let current = commitManualComposition(
      value.database,
      manualCompositionRequest(value, opened, 'roll-time-composition', [
        'TROGR',
        'ADVISER',
        'TAIPAN',
        'OWL',
      ]),
      'roll-time-composition-receipt',
      dependencies,
    );
    const pendingIw = projectManualChr041(current, value.catalog, presentation, true, true);
    expect(decodeChr041ManualProjection(pendingIw.roleFilteredPayload, '$.payload')).toMatchObject({
      ok: true,
      value: {
        advisorSlotsAndSkills: { kind: 'IW_ROLLS_REQUIRED' },
        trogrSuppressionState: {
          kind: 'SUPPRESSED',
          rollReceiptIdOrNull: null,
          rollRequestIdOrNull: null,
        },
      },
    });
    current = commitManualAdvisorIw(
      value.database,
      manualAdvisorIwRequest(value, current, 'roll-time-iw', [8, 9]),
      ['roll-time-i-receipt', 'roll-time-w-receipt'],
      dependencies,
    );
    const before = projectManualChr041(current, value.catalog, presentation, true, true);
    expect(decodeChr041ManualProjection(before.roleFilteredPayload, '$.payload').ok).toBe(true);
    expect(before.availableActionKeys).toEqual(['CHR-041::CTA::004', 'CHR-041::CTA::002']);
    const source = {
      ...snapshot('CHR-041', before.roleFilteredPayload, before.availableActionKeys, '/chr-041'),
      revisions: currentCreationWizardRevisions(current),
    };
    current = commitAdvisorIntelligenceFloorRoll(
      value.database,
      manualAdvisorFloorRollRequest(value, current, 'roll-time-b-command', 2),
      'roll-time-b-receipt',
      dependencies,
    );
    const receipt = current.manualCompositionStage?.suppressionRollRecordOrNull?.receipt;
    if (receipt === undefined) throw new Error('missing B receipt');
    current = commitManualAdvisorSkills(
      value.database,
      manualAdvisorSkillRequest(
        value,
        current,
        'roll-time-skills',
        exactManualAdvisorSkills(current, presentation),
      ),
      'roll-time-skills-receipt',
      dependencies,
    );
    const catalogCheckpoint = advanceManualSymbiontPresentation(
      value.database,
      {
        characterDraftId: value.characterDraftId,
        wizardCheckpointId: value.wizardCheckpointId,
        formId: 'CHR-017',
      },
      value.catalog,
    );
    const catalogProjection = projectManualChr017(catalogCheckpoint, value.catalog);
    const baseline = manualCompositionDraftFromSnapshot(
      snapshot(
        'CHR-017',
        catalogProjection.roleFilteredPayload,
        catalogProjection.availableActionKeys,
        '/chr-017',
      ),
      null,
    );
    const replacementCheckpoint = card(value, 'TEACHER');
    const replacementCard = projectManualChr018(replacementCheckpoint, value.catalog, media, true);
    const replacementDraft = manualCompositionDraftFromSnapshot(
      snapshot(
        'CHR-018',
        replacementCard.roleFilteredPayload,
        replacementCard.availableActionKeys,
        '/chr-018/TEACHER',
      ),
      baseline,
    );
    expect(replacementDraft).toMatchObject({
      compositionDraftRevision: current.manualCompositionStage?.compositionDraftRevision,
    });
    expect(replacementDraft?.entries).toHaveLength(4);
    current = commitManualComposition(
      value.database,
      manualCompositionRequest(value, replacementCheckpoint, 'roll-time-replacement', [
        'TROGR',
        'TEACHER',
        'ADVISER',
        'TAIPAN',
      ]),
      'roll-time-replacement-receipt',
      dependencies,
    );
    const after = projectManualChr041(current, value.catalog, presentation, true, true);
    const afterSnapshot = {
      ...snapshot('CHR-041', after.roleFilteredPayload, after.availableActionKeys, '/chr-041'),
      revisions: currentCreationWizardRevisions(current),
    };
    expect(current.nextStageEnvelope.formId).toBe('CHR-019');
    expect(after.roleFilteredPayload['compositionDraftRevision']).toBeGreaterThan(
      receipt.result.compositionDraftRevision,
    );
    expect(after.roleFilteredPayload).toMatchObject({
      trogrSuppressionState: {
        minimumIOrNull: receipt.result.minimumI,
        rollReceiptIdOrNull: receipt.receiptId,
        suppressionBOrNull: receipt.result.suppressionB,
      },
    });
    expect(advisorIntelligenceFloorSnapshotMatchesReceipt(afterSnapshot, receipt, source).ok).toBe(
      true,
    );
  });
});

type ManualForm = 'CHR-017' | 'CHR-018' | 'CHR-019' | 'CHR-041';
const ALL_COMMANDS = [
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
] as const;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onopen: WebSocket['onopen'] = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(_url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  message(data: string): void {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data }));
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.call(
      this as unknown as WebSocket,
      Object.assign(new Event('close'), { code: 1006, reason: 'test reconnect', wasClean: false }),
    );
  }
}

function workflow(socket: FakeWebSocket) {
  const text = socket.sent.at(-1);
  if (text === undefined) throw new Error('missing workflow command');
  const decoded = decodeClientMessage(text, WEB_PROTOCOL_VOCABULARY);
  if (
    !decoded.ok ||
    decoded.value.messageType !== 'command.request' ||
    decoded.value.commandKind !== 'workflow-command'
  ) {
    throw new Error('invalid workflow command');
  }
  return decoded.value;
}

function sessionReconnect(
  socket: FakeWebSocket,
): Extract<ClientToHostV2Message, { messageType: 'session.reconnect' }> {
  const text = socket.sent.at(-1);
  if (text === undefined) throw new Error('missing session reconnect');
  const decoded = decodeClientMessageV2(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok || decoded.value.messageType !== 'session.reconnect') {
    throw new Error('invalid session reconnect');
  }
  return decoded.value;
}

function navigationId(
  socket: FakeWebSocket,
  type: 'navigation.addressable-route' | 'navigation.form-action',
): string {
  const text = socket.sent.at(-1);
  if (text === undefined) throw new Error('missing navigation request');
  const decoded = decodeClientMessageV2(text, WEB_PROTOCOL_VOCABULARY);
  if (
    !decoded.ok ||
    decoded.value.messageType !== type ||
    !('navigationRequestId' in decoded.value)
  ) {
    throw new Error('invalid navigation request');
  }
  return decoded.value.navigationRequestId;
}

function sendCapabilities(
  socket: FakeWebSocket,
  reconnectRequestId: string,
  revisions: RevisionVector,
): void {
  const capabilities: SessionReconnectCapabilitiesV2Message = {
    executableWorkflowCommandIds: ALL_COMMANDS,
    messageType: 'session.reconnect.capabilities',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId,
    revisions,
  };
  const encoded = encodeHostMessageV2(capabilities, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) throw new Error('invalid capabilities fixture');
  socket.message(encoded.text);
}

function sendProjection(
  socket: FakeWebSocket,
  form: ManualForm,
  setupValue: ManualWizardSetup,
  checkpoint: DurableCreationWizardCheckpoint,
  correlationId: string,
  reason: 'ADDRESSABLE_ROUTE' | 'COMMAND_DESTINATION' | 'FORM_ACTION' | 'RECONNECT',
): void {
  const base =
    form === 'CHR-017'
      ? projectManualChr017(checkpoint, setupValue.catalog)
      : form === 'CHR-018'
        ? projectManualChr018(checkpoint, setupValue.catalog, media, true)
        : form === 'CHR-019'
          ? projectManualChr019(checkpoint, setupValue.catalog)
          : projectManualChr041(checkpoint, setupValue.catalog, presentation, true, true);
  const snapshot: HostToClientV2Message = {
    messageType: 'projection.snapshot',
    presentation: { assignment: { correlationId, reason }, base, layers: [] },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: currentCreationWizardRevisions(checkpoint),
  };
  const encoded = encodeHostMessageV2(snapshot, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok)
    throw new Error(`invalid projection fixture: ${JSON.stringify(encoded.refusal)}`);
  socket.message(encoded.text);
}

function sendTerminal(socket: FakeWebSocket, receipt: CommandReceipt, replay = false): void {
  const message: HostToClientMessage = replay
    ? {
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: 1,
        receipt,
      }
    : { lifecycleState: 'COMMITTED', messageType: 'command.result', protocolVersion: 1, receipt };
  const encoded = encodeHostMessage(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) throw new Error(`invalid terminal fixture: ${JSON.stringify(encoded.refusal)}`);
  socket.message(encoded.text);
}

interface ManualHarness {
  readonly connection: ProjectionConnection;
  readonly drafts: (ManualCompositionDraft | null)[];
  readonly socket: FakeWebSocket;
  readonly states: WebClientState[];
}

function readySnapshot(states: readonly WebClientState[]): ConfirmedProjectionSnapshot {
  const state = states.at(-1);
  if (state?.kind !== 'ready') throw new Error(`expected ready state: ${JSON.stringify(state)}`);
  return state.snapshot;
}

async function connectManual(
  setupValue: ManualWizardSetup,
  checkpoint: DurableCreationWizardCheckpoint,
  form: ManualForm = 'CHR-017',
): Promise<ManualHarness> {
  let entropy = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      values.set([++entropy, 2, 3, 4]);
      return values;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ deviceId: '123e4567-e89b-42d3-a456-426614174000' }), {
          status: 200,
        }),
      ),
    ),
  );
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
  const states: WebClientState[] = [];
  const drafts: (ManualCompositionDraft | null)[] = [];
  const connection = connectProjection(
    (state) => states.push(state),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (draft) => drafts.push(draft),
  );
  connections.push(connection);
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('missing fake socket');
  socket.open();
  const reconnect = sessionReconnect(socket);
  sendCapabilities(
    socket,
    reconnect.reconnectRequestId,
    currentCreationWizardRevisions(checkpoint),
  );
  sendProjection(socket, form, setupValue, checkpoint, reconnect.reconnectRequestId, 'RECONNECT');
  return { connection, drafts, socket, states };
}

function reconnectManual(
  harness: ManualHarness,
  setupValue: ManualWizardSetup,
  checkpoint: DurableCreationWizardCheckpoint,
  form: ManualForm,
  receipt?: CommandReceipt,
): FakeWebSocket {
  harness.socket.serverClose();
  expect(harness.connection.reconnect()).toEqual({ ok: true });
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('missing resumed socket');
  socket.open();
  const reconnect = sessionReconnect(socket);
  expect(reconnect.unacknowledgedCommandIds).toEqual(
    receipt === undefined ? [] : [receipt.commandId],
  );
  if (receipt !== undefined) {
    sendTerminal(socket, receipt, true);
    sendTerminal(socket, receipt, true);
  }
  sendCapabilities(
    socket,
    reconnect.reconnectRequestId,
    currentCreationWizardRevisions(checkpoint),
  );
  sendProjection(socket, form, setupValue, checkpoint, reconnect.reconnectRequestId, 'RECONNECT');
  return socket;
}

describe('manual symbiont websocket delivery', () => {
  it('commits a full replacement and preserves local edits only until reconnect', () => {
    const value = setup('websocket-free');
    return (async () => {
      const harness = await connectManual(value, value.checkpoint);
      expect(readySnapshot(harness.states).formId).toBe('CHR-017');
      expect(harness.connection.requestSymbiontCard('EEL')).toEqual({ ok: true });
      let checkpoint = card(value, 'EEL');
      sendProjection(
        harness.socket,
        'CHR-018',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.addressable-route'),
        'ADDRESSABLE_ROUTE',
      );
      expect(readySnapshot(harness.states).formId).toBe('CHR-018');
      expect(harness.drafts.at(-1)?.entries).toEqual([]);
      expect(harness.connection.requestFormAction('CHR-018::CTA::002')).toEqual({ ok: true });
      checkpoint = advanceManualSymbiontPresentation(
        value.database,
        {
          characterDraftId: value.characterDraftId,
          wizardCheckpointId: value.wizardCheckpointId,
          formId: 'CHR-017',
        },
        value.catalog,
      );
      sendProjection(
        harness.socket,
        'CHR-017',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.form-action'),
        'FORM_ACTION',
      );
      expect(readySnapshot(harness.states).formId).toBe('CHR-017');
      expect(harness.connection.requestSymbiontCard('EEL')).toEqual({ ok: true });
      checkpoint = card(value, 'EEL');
      sendProjection(
        harness.socket,
        'CHR-018',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.addressable-route'),
        'ADDRESSABLE_ROUTE',
      );
      expect(readySnapshot(harness.states).formId).toBe('CHR-018');
      expect(harness.drafts.at(-1)?.entries).toEqual([]);
      expect(harness.connection.replaceManualBindingSide('LEFT')).toEqual({ ok: true });
      expect(harness.connection.toggleManualCompositionSpecies('EEL', true)).toEqual({ ok: true });
      expect(harness.connection.requestFormAction('CHR-018::CTA::001')).toEqual({ ok: true });
      const addRequest = workflow(harness.socket) as ManualCompositionCheckpointCommandRequest;
      expect(addRequest.payload.selectedBindings).toEqual([{ side: 'LEFT', speciesKey: 'EEL' }]);
      checkpoint = commitManualComposition(
        value.database,
        addRequest,
        'websocket-free-add-receipt',
        {
          catalog: value.catalog,
          allocateRollRequestId: () => {
            throw new Error('unexpected Advisor allocation');
          },
          sampleD20: () => {
            throw new Error('unexpected non-Advisor roll');
          },
        },
      );
      const addReceipt = checkpoint.manualCompositionStage?.compositionRecords.at(-1)?.receipt;
      if (addReceipt === undefined) throw new Error('missing composition receipt');
      sendTerminal(harness.socket, addReceipt);
      sendProjection(
        harness.socket,
        'CHR-019',
        value,
        checkpoint,
        addRequest.commandId,
        'COMMAND_DESTINATION',
      );
      expect(readySnapshot(harness.states).formId).toBe('CHR-019');
      expect(harness.connection.requestFormAction('CHR-019::CTA::004')).toEqual({ ok: true });
      checkpoint = advanceManualSymbiontPresentation(
        value.database,
        {
          characterDraftId: value.characterDraftId,
          wizardCheckpointId: value.wizardCheckpointId,
          formId: 'CHR-017',
        },
        value.catalog,
      );
      sendProjection(
        harness.socket,
        'CHR-017',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.form-action'),
        'FORM_ACTION',
      );
      expect(harness.connection.toggleManualCompositionSpecies('EEL', false)).toEqual({ ok: true });
      expect(harness.connection.requestSymbiontCard('OWL')).toEqual({ ok: true });
      checkpoint = card(value, 'OWL');
      sendProjection(
        harness.socket,
        'CHR-018',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.addressable-route'),
        'ADDRESSABLE_ROUTE',
      );
      expect(harness.connection.toggleManualCompositionSpecies('OWL', true)).toEqual({ ok: true });
      expect(harness.connection.requestFormAction('CHR-018::CTA::001')).toEqual({ ok: true });
      const replaceRequest = workflow(harness.socket) as ManualCompositionCheckpointCommandRequest;
      expect(replaceRequest.payload.acceptedSpecies).toEqual([
        { acceptedIndex: 0, speciesKey: 'OWL' },
      ]);
      expect(replaceRequest.commandId).not.toBe(addRequest.commandId);
      checkpoint = commitManualComposition(
        value.database,
        replaceRequest,
        'websocket-free-replace-receipt',
        {
          catalog: value.catalog,
          allocateRollRequestId: () => {
            throw new Error('unexpected Advisor allocation');
          },
          sampleD20: () => {
            throw new Error('unexpected non-Advisor roll');
          },
        },
      );
      const replaceReceipt = checkpoint.manualCompositionStage?.compositionRecords.at(-1)?.receipt;
      if (replaceReceipt === undefined) throw new Error('missing replacement receipt');
      sendTerminal(harness.socket, replaceReceipt);
      sendProjection(
        harness.socket,
        'CHR-019',
        value,
        checkpoint,
        replaceRequest.commandId,
        'COMMAND_DESTINATION',
      );
      expect(harness.drafts.at(-1)?.entries.map((entry) => entry.speciesKey)).toEqual(['OWL']);
      expect(harness.connection.requestFormAction('CHR-019::CTA::004')).toEqual({ ok: true });
      checkpoint = advanceManualSymbiontPresentation(
        value.database,
        {
          characterDraftId: value.characterDraftId,
          wizardCheckpointId: value.wizardCheckpointId,
          formId: 'CHR-017',
        },
        value.catalog,
      );
      sendProjection(
        harness.socket,
        'CHR-017',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.form-action'),
        'FORM_ACTION',
      );
      expect(harness.connection.toggleManualCompositionSpecies('OWL', false)).toEqual({ ok: true });
      expect(harness.connection.requestFormAction('CHR-017::CTA::002')).toEqual({ ok: true });
      checkpoint = advanceManualSymbiontPresentation(
        value.database,
        {
          characterDraftId: value.characterDraftId,
          wizardCheckpointId: value.wizardCheckpointId,
          formId: 'CHR-019',
        },
        value.catalog,
      );
      sendProjection(
        harness.socket,
        'CHR-019',
        value,
        checkpoint,
        navigationId(harness.socket, 'navigation.form-action'),
        'FORM_ACTION',
      );
      expect(harness.drafts.at(-1)?.entries).toEqual([]);
      reconnectManual(harness, value, checkpoint, 'CHR-019');
      expect(readySnapshot(harness.states).formId).toBe('CHR-019');
      expect(harness.drafts.at(-1)?.entries.map((entry) => entry.speciesKey)).toEqual(['OWL']);
    })();
  });

  it('resumes AUTO Advisor I/W with two samples and byte-identical replay', async () => {
    const value = createManualWizardSetup(
      'websocket-advisor',
      'UNITED',
      'AUTO',
      ':memory:',
      WEB_CHARACTER_ID,
    );
    databases.push(value.database);
    const samples: number[] = [];
    const dependencies = {
      catalog: value.catalog,
      allocateRollRequestId: (() => {
        const ids = [
          'websocket-advisor-instance',
          'websocket-advisor-i-request',
          'websocket-advisor-w-request',
        ];
        let index = 0;
        return () => {
          const id = ids[index++];
          if (id === undefined) throw new Error('unexpected roll request allocation');
          return id;
        };
      })(),
      sampleD20: () => {
        samples.push(samples.length + 3);
        return samples.at(-1)!;
      },
    };
    const opened = card(value, 'ADVISER');
    let checkpoint = commitManualComposition(
      value.database,
      manualCompositionRequest(value, opened, 'websocket-advisor-add', [
        'ADVISER',
        'TAIPAN',
        'WEAVER',
        'OWL',
      ]),
      'websocket-advisor-add-receipt',
      dependencies,
    );
    const harness = await connectManual(value, checkpoint, 'CHR-041');
    expect(readySnapshot(harness.states).formId).toBe('CHR-041');
    expect(samples).toEqual([]);
    expect(harness.connection.requestFormAction('CHR-041::CTA::003')).toEqual({ ok: true });
    const request = workflow(harness.socket) as ManualAdvisorIwRollCommandRequest;
    const pendingSource = readySnapshot(harness.states);
    expect(request.payload.manualFacesOrNull).toBeNull();
    checkpoint = commitManualAdvisorIw(
      value.database,
      request,
      ['websocket-advisor-i-receipt', 'websocket-advisor-w-receipt'],
      dependencies,
    );
    const receipt = checkpoint.manualCompositionStage?.advisorIwRecordOrNull?.receipt;
    if (receipt === undefined) throw new Error('missing I/W receipt');
    sendTerminal(harness.socket, receipt);
    expect(harness.states.at(-1)?.kind, JSON.stringify(harness.states.at(-1))).toBe('ready');
    expect(
      decodeManualAdvisorIwTerminal(
        {
          lifecycleState: 'IDEMPOTENT_REPLAY',
          messageType: 'command.replay',
          protocolVersion: 1,
          receipt: {
            ...receipt,
            result: {
              ...receipt.result,
              advisorIw: { I: { rawFace: 3, value: 99 }, W: receipt.result.advisorIw.W },
            },
          },
        },
        request,
        pendingSource,
      ).ok,
    ).toBe(false);
    reconnectManual(harness, value, checkpoint, 'CHR-041', receipt);
    const snapshot = readySnapshot(harness.states);
    expect(snapshot.formId).toBe('CHR-041');
    if (snapshot.formId !== 'CHR-041') throw new Error('expected Advisor snapshot');
    expect(snapshot.projection.iwRollRequestIds).toEqual(request.payload.pendingRollRequestIds);
    expect(snapshot.projection.iwRollReceiptIds).toEqual([
      'websocket-advisor-i-receipt',
      'websocket-advisor-w-receipt',
    ]);
    expect(snapshot.projection.advisorSlotsAndSkills).not.toMatchObject({
      kind: 'IW_ROLLS_REQUIRED',
    });
    expect(samples).toEqual([3, 4]);
  });
});
