import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import {
  decodeClientMessage,
  decodeClientMessageV2,
  decodeClientMessageV3,
  encodeHostMessage,
  encodeHostMessageV2,
  encodeHostMessageV3,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
  WIRE_PROTOCOL_V3_VERSION,
} from '@shared/index.js';
import type {
  HostToClientMessage,
  HostToClientV2Message,
  HostToClientV3Message,
  ProjectionSnapshotV2Message,
  SessionReconnectCapabilitiesV2Message,
} from '@shared/index.js';

import { App } from './app.js';
import { WEB_PROTOCOL_VOCABULARY } from './ws-client.js';
import type { App001Projection } from './ws-client.js';

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const DEVICE_ID = '123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = 'reconnect-00000001000000020000000300000004';
const PLAYER_NAVIGATION_REQUEST_ID = 'navigation-00000005000000060000000700000008';
const CHARACTER_NAVIGATION_REQUEST_ID = 'navigation-000000090000000a0000000b0000000c';
const LIBRARY_NAVIGATION_REQUEST_ID = 'navigation-00000015000000160000001700000018';
const MENU_NAVIGATION_REQUEST_ID = 'navigation-000000190000001a0000001b0000001c';
const IDENTITY_CHECKPOINT_COMMAND_ID = 'command-0000000d0000000e0000000f00000010';
const IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT';
const SET_DECIDE_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-SET-DECIDE';
const ROLL_COMMIT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-ROLL-COMMIT';
const EMPTY_BRANCH_CACHE_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const APP_001_ACTION_KEYS = [
  'APP-001::CTA::001',
  'APP-001::CTA::002',
  'APP-001::CTA::003',
  'APP-001::CTA::004',
] as const;
const CHARACTER_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WIZARD_CHECKPOINT_ID = 'opaque-wizard-checkpoint';
const REVISIONS = {
  actorVisibilityRevision: 3,
  projectionRevision: 8,
  stateRevision: 5,
} as const;
const HOST_PROJECTION = {
  baselineCompatibility: {
    builtAgainstTuple: { status: 'PASS', value: 'host-tuple-36' },
    catalogVersion: { status: 'PASS', value: 'host-catalog-36' },
    registryVersion: { status: 'PASS', value: 'host-registry-36' },
  },
  bootState: 'READY',
  buildVersion: 'host-build-36',
  formId: 'APP-001',
  integrityStatus: {
    changed: [],
    missing: [],
    ok: true,
    tracked: 36,
    untracked: [],
  },
} as const satisfies App001Projection;
const APP_002_PROJECTION = {
  contextId: CONTEXT_ID,
  deviceId: DEVICE_ID,
  projectionRevision: 9,
  stateRevision: 5,
} as const;
const CHR_001_PROJECTION = {
  age: null,
  anatomyProfile: 'STANDARD_HUMANOID',
  artAssetKeyOrLocalFile: null,
  characterDraftId: CHARACTER_DRAFT_ID,
  commandId: null,
  description: null,
  draftRevision: 0,
  massApprovalStatus: 'PENDING_GM',
  massKg: null,
  name: null,
  sex: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const VALID_CHR_001_PROJECTION = {
  ...CHR_001_PROJECTION,
  age: 1,
  description: 'Подтверждённая идентичность',
  massKg: 0.1,
  name: 'Алиса',
  sex: 'FEMALE',
} as const;
const CHR_010_PROJECTION = {
  ancientOptionSerialized: false,
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  draftRevision: 0,
  raceChoice: null,
  raceConsequencesPreview: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const CHR_016_PROJECTION = {
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  draftRevision: 1,
  modeConsequences: null,
  raceChoice: 'UNITED',
  symbiontAcquisitionMode: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const CHR_036_PROJECTION = {
  appliesToAllCreationRolls: true,
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  diceInputMode: null,
  draftRevision: 2,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const CHR_002_PROJECTION = {
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  draftRevision: 3,
  methodConsequences: null,
  statMethod: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const BRANCH_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SET_ROLL_REQUEST_ID = 'set-roll-request-1';
const SET_ROLL_RECEIPT_ID = 'set-roll-receipt-1';
const CONFIRMATION_ROLL_REQUEST_ID = 'confirmation-roll-request-1';
const CHR_003_MANUAL_PROJECTION = {
  attemptIndex: 1,
  branchUuid: BRANCH_UUID,
  characterDraftId: CHARACTER_DRAFT_ID,
  commandId: null,
  diceInputModeSnapshot: 'MANUAL',
  draftRevision: 4,
  facesOrManualInputs: [null, null, null, null, null, null, null],
  naturalCriticalQueue: [],
  setRollReceiptId: null,
  setRollRequestId: SET_ROLL_REQUEST_ID,
  shownResultLocked: false,
  statMethod: 'CLASSIC',
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const CHR_003_AUTO_PROJECTION = {
  ...CHR_003_MANUAL_PROJECTION,
  diceInputModeSnapshot: 'AUTO',
} as const;
const ENTITY_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const;
const APP_004_PROJECTION = {
  campaignAuthority: false,
  draftCharacterIds: [],
  finalCharacterIds: [],
  handoffIdOrNull: null,
  handoffReceiptIdOrNull: null,
  launchContext: 'PLAYER_MENU',
  localCharacterLibraryRevision: 0,
  localOwnerIdOrNull: null,
  projectionRevision: 11,
  returnContext: 'PLAYER_MENU',
  stateRevision: 5,
} as const;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly closeCalls: {
    readonly code: number | undefined;
    readonly reason: string | undefined;
  }[] = [];
  readonly sent: string[] = [];
  readonly url: string;
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onopen: WebSocket['onopen'] = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('fake socket is not open');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data }));
  }

  serverClose(code: number, reason: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code, reason }));
  }
}

class DeferredFileReader {
  static readonly instances: DeferredFileReader[] = [];

  readonly #listeners = new Map<string, EventListenerOrEventListenerObject>();
  result: ArrayBuffer | null = null;

  constructor() {
    DeferredFileReader.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener !== null) this.#listeners.set(type, listener);
  }

  readAsArrayBuffer(): void {}

  complete(bytes: Uint8Array): void {
    this.result = Uint8Array.from(bytes).buffer;
    const listener = this.#listeners.get('load');
    if (typeof listener === 'function') {
      listener.call(this as unknown as FileReader, new ProgressEvent('load'));
    } else {
      listener?.handleEvent(new ProgressEvent('load'));
    }
  }
}

interface MountedClient {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

interface ConnectedClient extends MountedClient {
  readonly socket: FakeWebSocket;
}

const mountedClients: MountedClient[] = [];

afterEach(() => {
  for (const mounted of mountedClients.splice(0)) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  FakeWebSocket.instances.splice(0);
  DeferredFileReader.instances.splice(0);
  vi.unstubAllGlobals();
});

function identityResponse(value: unknown = { deviceId: DEVICE_ID }, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function mountClient(
  response: Promise<Response> = Promise.resolve(identityResponse()),
): MountedClient {
  let entropyCall = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      const offset = entropyCall++ * 4;
      values.set([offset + 1, offset + 2, offset + 3, offset + 4]);
      return values;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response),
  );
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  const mounted = { container, root };
  mountedClients.push(mounted);
  return mounted;
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function connectClient(
  response: Promise<Response> = Promise.resolve(identityResponse()),
): Promise<ConnectedClient> {
  const mounted = mountClient(response);
  await flushAsyncWork();
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('test setup: App did not create a WebSocket');
  return { ...mounted, socket };
}

function checkedHostTextV1(message: HostToClientMessage): string {
  const encoded = encodeHostMessage(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) {
    throw new Error(`test setup: invalid host fixture ${JSON.stringify(encoded.refusal)}`);
  }
  return encoded.text;
}

function checkedHostTextV2(message: HostToClientV2Message): string {
  const encoded = encodeHostMessageV2(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) {
    throw new Error(`test setup: invalid host fixture ${JSON.stringify(encoded.refusal)}`);
  }
  return encoded.text;
}

function checkedHostTextV3(message: HostToClientV3Message): string {
  const encoded = encodeHostMessageV3(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) {
    throw new Error(`test setup: invalid host fixture ${JSON.stringify(encoded.refusal)}`);
  }
  return encoded.text;
}

function capabilities(
  overrides: Partial<SessionReconnectCapabilitiesV2Message> = {},
): SessionReconnectCapabilitiesV2Message {
  return {
    executableWorkflowCommandIds: [
      IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
      SET_DECIDE_WORKFLOW_COMMAND_ID,
      ROLL_COMMIT_WORKFLOW_COMMAND_ID,
    ],
    messageType: 'session.reconnect.capabilities',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: REQUEST_ID,
    revisions: REVISIONS,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<ProjectionSnapshotV2Message> = {},
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId: REQUEST_ID, reason: 'RECONNECT' },
      base: {
        availableActionKeys: APP_001_ACTION_KEYS,
        formId: 'APP-001',
        formType: 'screen',
        roleFilteredPayload: HOST_PROJECTION,
        routeBindings: [],
        routeTemplate: '/',
      },
      layers: [],
    },
    projectionRole: null,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: REVISIONS,
    ...overrides,
  };
}

function navigationSnapshot(
  base: ProjectionSnapshotV2Message['presentation']['base'],
  projectionRevision: number,
  correlationId: string,
  reason: 'FORM_ACTION' | 'RECONNECT' = 'FORM_ACTION',
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId, reason },
      base,
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: { ...REVISIONS, projectionRevision },
  };
}

const chr001Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] = CHR_001_PROJECTION,
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: ['CHR-001::CTA::002'],
  formId: 'CHR-001',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'executor-allocated', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
});

const chr010Base = (): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: ['CHR-010::CTA::004', 'CHR-010::CTA::005', 'CHR-010::CTA::006'],
  formId: 'CHR-010',
  formType: 'screen',
  roleFilteredPayload: CHR_010_PROJECTION,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-010',
});

const chr016Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] = CHR_016_PROJECTION,
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: ['CHR-016::CTA::003', 'CHR-016::CTA::004'],
  formId: 'CHR-016',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-016',
});

const chr036Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] = CHR_036_PROJECTION,
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: ['CHR-036::CTA::004', 'CHR-036::CTA::005'],
  formId: 'CHR-036',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-036',
});

const chr002Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] = CHR_002_PROJECTION,
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: ['CHR-002::CTA::003', 'CHR-002::CTA::004', 'CHR-002::CTA::005'],
  formId: 'CHR-002',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-002',
});

const chr003Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] = CHR_003_MANUAL_PROJECTION,
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: projection['setRollReceiptId'] === null ? ['CHR-003::CTA::002'] : [],
  formId: 'CHR-003',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-003',
});

const chr004Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'],
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: projection['confirmationReceiptId'] === null ? ['CHR-004::CTA::001'] : [],
  formId: 'CHR-004',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-004',
});

type DecisionFormId = 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
const SET_DECISION_RULES = {
  'CHR-005': {
    alternateDecision: 'USE_POINT_BUY_90',
    attemptIndex: 1,
    method: 'CLASSIC',
    receiptField: 'acceptedSetReceiptId',
    transitionKind: 'CLASSIC_TO_90',
  },
  'CHR-006': {
    alternateDecision: 'GO_ATTEMPT_2',
    attemptIndex: 1,
    method: 'ADVENTUROUS',
    receiptField: 'setReceiptId',
    transitionKind: 'ADVENTUROUS_TO_SECOND',
  },
  'CHR-007': {
    alternateDecision: 'USE_POINT_BUY_85',
    attemptIndex: 2,
    method: 'ADVENTUROUS',
    receiptField: 'setReceiptId',
    transitionKind: 'ADVENTUROUS_TO_85',
  },
  'CHR-008': {
    alternateDecision: 'GO_NEXT_ATTEMPT',
    attemptIndex: 1,
    method: 'ALL_OR_NOTHING',
    receiptField: 'setReceiptId',
    transitionKind: 'ALL_OR_NOTHING_NEXT',
  },
} as const;
const DECISION_SET_RECEIPT_ID = 'decision-set-receipt-current';

function setDecisionProjection(
  formId: DecisionFormId,
  {
    attemptIndex = SET_DECISION_RULES[formId].attemptIndex,
    commandId = null,
    decision = 'PENDING',
    decisionReceiptIdOrNull = null,
    draftRevision = 6,
  }: {
    readonly attemptIndex?: number;
    readonly commandId?: string | null;
    readonly decision?: string;
    readonly decisionReceiptIdOrNull?: string | null;
    readonly draftRevision?: number;
  } = {},
): ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] {
  const rule = SET_DECISION_RULES[formId];
  return {
    ...(formId === 'CHR-005' ? {} : { attemptIndex }),
    characterDraftId: CHARACTER_DRAFT_ID,
    commandId,
    decision,
    decisionReceiptIdOrNull,
    draftRevision,
    ...(formId === 'CHR-008' ? { fifthAttemptMandatoryAccept: attemptIndex === 5 } : {}),
    [rule.receiptField]: DECISION_SET_RECEIPT_ID,
    statMethod: rule.method,
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  };
}

function setDecisionBase(
  formId: DecisionFormId,
  projection = setDecisionProjection(formId),
): ProjectionSnapshotV2Message['presentation']['base'] {
  const mandatory = projection['fifthAttemptMandatoryAccept'] === true;
  const pending = projection['decision'] === 'PENDING';
  return {
    availableActionKeys: pending
      ? mandatory
        ? [`${formId}::CTA::001`]
        : [`${formId}::CTA::001`, `${formId}::CTA::002`]
      : [],
    formId,
    formType: 'screen',
    roleFilteredPayload: projection,
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
    routeTemplate: `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
  };
}

function abandonmentConsequences(formId: DecisionFormId, attemptIndex: number) {
  return {
    creationCriticalConsequencesDiscarded: true,
    exactPointBuyTotalOrNull: formId === 'CHR-005' ? 90 : formId === 'CHR-007' ? 85 : null,
    nextAttemptIndexOrNull:
      formId === 'CHR-006' ? 2 : formId === 'CHR-008' ? attemptIndex + 1 : null,
    setValuesDiscarded: true,
  } as const;
}

function chr028Layer(
  originDecisionFormId: DecisionFormId,
  {
    commandId = null,
    decision = null,
    decisionReceiptIdOrNull = null,
    draftRevision = 6,
    attemptIndex = SET_DECISION_RULES[originDecisionFormId].attemptIndex,
  }: {
    readonly attemptIndex?: number;
    readonly commandId?: string | null;
    readonly decision?: 'CONFIRM' | null;
    readonly decisionReceiptIdOrNull?: string | null;
    readonly draftRevision?: number;
  } = {},
): ProjectionSnapshotV2Message['presentation']['layers'][number] {
  return {
    availableActionKeys: decision === null ? ['CHR-028::CTA::001', 'CHR-028::CTA::002'] : [],
    formId: 'CHR-028',
    formType: 'dialog',
    roleFilteredPayload: {
      abandonedSetReceiptIds: [DECISION_SET_RECEIPT_ID],
      characterDraftId: CHARACTER_DRAFT_ID,
      commandId,
      decision,
      decisionReceiptIdOrNull,
      draftRevision,
      irreversibleConsequences: abandonmentConsequences(originDecisionFormId, attemptIndex),
      originDecisionFormId,
      transitionKind: SET_DECISION_RULES[originDecisionFormId].transitionKind,
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    },
    routeBindings: [],
    routeTemplate: '@dialog/chr-028',
  };
}

type SetDecisionFixture =
  | {
      readonly branchUuid: string;
      readonly nextFormId: 'CHR-003';
      readonly setRollRequestId: string;
      readonly sourceFormId: 'CHR-002';
      readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
    }
  | {
      readonly diceInputMode: 'AUTO' | 'MANUAL';
      readonly nextFormId: 'CHR-002';
      readonly sourceFormId: 'CHR-036';
    }
  | {
      readonly nextFormId: 'CHR-016' | 'CHR-036';
      readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
      readonly sourceFormId: 'CHR-010';
    }
  | {
      readonly nextFormId: 'CHR-036';
      readonly sourceFormId: 'CHR-016';
      readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
    };

function entityRevisions(revision: number) {
  return {
    actorVisibilityRevision: 0,
    projectionRevision: revision,
    stateRevision: revision,
  } as const;
}

function setDecisionTerminal(
  commandId: string,
  decision: SetDecisionFixture,
  checkpointRevision: number,
  draftRevision: number,
  replay = false,
): Extract<HostToClientMessage, { readonly messageType: 'command.replay' | 'command.result' }> {
  const common = {
    branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
    characterDraftId: CHARACTER_DRAFT_ID,
    checkpointId: WIZARD_CHECKPOINT_ID,
    checkpointOwnerId: CHARACTER_DRAFT_ID,
    checkpointRevision,
    draftRevision,
    nextFormId: decision.nextFormId,
    sourceFormId: decision.sourceFormId,
    stage: 'RACE_AND_METHOD',
  } as const;
  const result =
    decision.sourceFormId === 'CHR-002'
      ? {
          ...common,
          branchUuid: decision.branchUuid,
          setRollRequestId: decision.setRollRequestId,
          statMethod: decision.statMethod,
        }
      : decision.sourceFormId === 'CHR-010'
        ? { ...common, raceChoice: decision.raceChoice }
        : decision.sourceFormId === 'CHR-016'
          ? { ...common, symbiontAcquisitionMode: decision.symbiontAcquisitionMode }
          : { ...common, diceInputMode: decision.diceInputMode };
  const receipt = {
    commandId,
    receiptId: `set-decision-receipt-${String(checkpointRevision)}`,
    result,
    revisions: entityRevisions(checkpointRevision),
  };
  return replay
    ? {
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      }
    : {
        lifecycleState: 'COMMITTED',
        messageType: 'command.result',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      };
}

function rollCommitTerminal(
  commandId: string,
  receiptId: string,
  result: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'],
  revision: number,
  replay = false,
): Extract<HostToClientMessage, { readonly messageType: 'command.replay' | 'command.result' }> {
  const receipt = { commandId, receiptId, result, revisions: entityRevisions(revision) };
  return replay
    ? {
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      }
    : {
        lifecycleState: 'COMMITTED',
        messageType: 'command.result',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      };
}

function setDecisionDestinationSnapshot(
  commandId: string,
  base: ProjectionSnapshotV2Message['presentation']['base'],
  revision: number,
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId: commandId, reason: 'COMMAND_DESTINATION' },
      base,
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: entityRevisions(revision),
  };
}

function setDecisionPresentationSnapshot(
  correlationId: string,
  reason: 'COMMAND_DESTINATION' | 'FORM_ACTION' | 'RECONNECT',
  base: ProjectionSnapshotV2Message['presentation']['base'],
  layers: ProjectionSnapshotV2Message['presentation']['layers'],
  revisions: ProjectionSnapshotV2Message['revisions'],
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId, reason },
      base,
      layers,
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions,
  };
}

function statSetDecisionTerminal(
  commandId: string,
  receiptId: string,
  result: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'],
  revisions: ProjectionSnapshotV2Message['revisions'],
  replay = false,
): Extract<HostToClientMessage, { readonly messageType: 'command.replay' | 'command.result' }> {
  const receipt = { commandId, receiptId, result, revisions };
  return replay
    ? {
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      }
    : {
        lifecycleState: 'COMMITTED',
        messageType: 'command.result',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      };
}

function reconnectWizardSnapshot(
  reconnectRequestId: string,
  base: ProjectionSnapshotV2Message['presentation']['base'],
  revision: number,
): ProjectionSnapshotV2Message {
  return {
    ...setDecisionDestinationSnapshot(reconnectRequestId, base, revision),
    presentation: {
      assignment: { correlationId: reconnectRequestId, reason: 'RECONNECT' },
      base,
      layers: [],
    },
  };
}

function checkpointTerminal(
  commandId: string,
  replay = false,
): Extract<HostToClientMessage, { readonly messageType: 'command.replay' | 'command.result' }> {
  const receipt = {
    commandId,
    receiptId: 'identity-checkpoint-receipt',
    result: {
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 0,
      draftRevision: 0,
      nextFormId: 'CHR-010',
      stage: 'IDENTITY',
    },
    revisions: ENTITY_REVISIONS,
  } as const;
  return replay
    ? {
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      }
    : {
        lifecycleState: 'COMMITTED',
        messageType: 'command.result',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt,
      };
}

function commandDestinationSnapshot(commandId: string): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId: commandId, reason: 'COMMAND_DESTINATION' },
      base: chr010Base(),
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: ENTITY_REVISIONS,
  };
}

function reconnectChr010Snapshot(reconnectRequestId: string): ProjectionSnapshotV2Message {
  return {
    ...commandDestinationSnapshot(reconnectRequestId),
    presentation: {
      assignment: { correlationId: reconnectRequestId, reason: 'RECONNECT' },
      base: chr010Base(),
      layers: [],
    },
  };
}

function open(socket: FakeWebSocket): void {
  act(() => {
    socket.open();
  });
}

function deliver(socket: FakeWebSocket, data: unknown): void {
  act(() => {
    socket.message(data);
  });
}

function deliverPair(
  socket: FakeWebSocket,
  capabilityMessage: SessionReconnectCapabilitiesV2Message = capabilities(),
  snapshotMessage: ProjectionSnapshotV2Message = snapshot(),
): void {
  deliver(socket, checkedHostTextV2(capabilityMessage));
  deliver(socket, checkedHostTextV2(snapshotMessage));
}

async function connectToWizardBase(
  base: ProjectionSnapshotV2Message['presentation']['base'],
  revision: number,
): Promise<ConnectedClient> {
  const connection = await connectClient();
  open(connection.socket);
  deliverPair(
    connection.socket,
    capabilities({ revisions: entityRevisions(revision) }),
    reconnectWizardSnapshot(REQUEST_ID, base, revision),
  );
  return connection;
}

async function connectToValidChr001(
  capabilityMessage: SessionReconnectCapabilitiesV2Message = capabilities(),
): Promise<ConnectedClient> {
  const connection = await connectClient();
  const { container, socket } = connection;
  open(socket);
  deliverPair(socket, capabilityMessage);
  act(() => {
    requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
      'APP-001 player action',
    ).click();
  });
  deliver(
    socket,
    checkedHostTextV2(
      navigationSnapshot(
        {
          availableActionKeys: ['APP-002::CTA::007'],
          formId: 'APP-002',
          formType: 'screen',
          roleFilteredPayload: APP_002_PROJECTION,
          routeBindings: [],
          routeTemplate: '/player',
        },
        9,
        PLAYER_NAVIGATION_REQUEST_ID,
      ),
    ),
  );
  act(() => {
    requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Создать персонажа"]'),
      'APP-002 create-character action',
    ).click();
  });
  deliver(
    socket,
    checkedHostTextV2(
      navigationSnapshot(
        {
          ...chr001Base(VALID_CHR_001_PROJECTION),
          availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
        },
        10,
        CHARACTER_NAVIGATION_REQUEST_ID,
      ),
    ),
  );
  return connection;
}

async function connectToChr010(
  capabilityMessage: SessionReconnectCapabilitiesV2Message = capabilities(),
): Promise<ConnectedClient> {
  const connection = await connectToValidChr001(capabilityMessage);
  const { container, socket } = connection;
  act(() => {
    requiredElement(
      container.querySelector<HTMLButtonElement>(
        '[data-atlas-action="Сохранить идентичность и продолжить"]',
      ),
      'CHR-001 Continue action',
    ).click();
  });
  deliver(socket, checkedHostTextV1(checkpointTerminal(IDENTITY_CHECKPOINT_COMMAND_ID)));
  deliver(socket, checkedHostTextV2(commandDestinationSnapshot(IDENTITY_CHECKPOINT_COMMAND_ID)));
  return connection;
}

function requiredElement<T extends Element>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} not found`);
  return value;
}

function select(selectElement: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (descriptor?.set === undefined) throw new Error('test setup: select value setter not found');
  act(() => {
    descriptor.set!.call(selectElement, value);
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function inputNumber(input: HTMLInputElement, value: number): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set === undefined) throw new Error('test setup: input value setter not found');
  act(() => {
    descriptor.set!.call(input, String(value));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function chooseFile(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flushAsyncWork();
  await flushAsyncWork();
}

function decodedClientMessageV2(socket: FakeWebSocket, index: number) {
  const text = socket.sent[index];
  if (text === undefined) throw new Error(`test setup: client frame ${String(index)} not sent`);
  const decoded = decodeClientMessageV2(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(`test setup: invalid client frame ${JSON.stringify(decoded.refusal)}`);
  }
  return decoded.value;
}

function decodedClientMessageV3(socket: FakeWebSocket, index: number) {
  const text = socket.sent[index];
  if (text === undefined) throw new Error(`test setup: client frame ${String(index)} not sent`);
  const decoded = decodeClientMessageV3(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(`test setup: invalid client frame ${JSON.stringify(decoded.refusal)}`);
  }
  return decoded.value;
}

function decodedClientMessageV1(socket: FakeWebSocket, index: number) {
  const text = socket.sent[index];
  if (text === undefined) throw new Error(`test setup: client frame ${String(index)} not sent`);
  const decoded = decodeClientMessage(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(`test setup: invalid client frame ${JSON.stringify(decoded.refusal)}`);
  }
  return decoded.value;
}

function openSetAbandonmentDialog(
  container: HTMLDivElement,
  socket: FakeWebSocket,
  formId: DecisionFormId,
  base: ProjectionSnapshotV2Message['presentation']['base'],
  revision: number,
) {
  act(() => {
    requiredElement(
      container.querySelector<HTMLButtonElement>(`[data-atlas-action-key="${formId}::CTA::002"]`),
      `${formId} warning action`,
    ).click();
  });
  const request = decodedClientMessageV2(socket, socket.sent.length - 1);
  if (request.messageType !== 'navigation.form-action') {
    throw new Error('test setup: warning did not send form action');
  }
  expect(request).toMatchObject({
    actionKey: `${formId}::CTA::002`,
    expectedProjectionRevision: revision,
    sourceFormId: formId,
  });
  const openRevisions = {
    actorVisibilityRevision: 0,
    projectionRevision: revision + 1,
    stateRevision: revision,
  } as const;
  deliver(
    socket,
    checkedHostTextV2(
      setDecisionPresentationSnapshot(
        request.navigationRequestId,
        'FORM_ACTION',
        base,
        [chr028Layer(formId)],
        openRevisions,
      ),
    ),
  );
  return { openRevisions, request };
}

describe('APP-001 web entry', () => {
  it('loads the host identity before opening ws and sends only a checked v2 reconnect', async () => {
    let resolveIdentity: ((response: Response) => void) | undefined;
    const pendingIdentity = new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    });
    const { container } = mountClient(pendingIdentity);

    expect(container.querySelector('[data-client-state="connecting"]')).not.toBeNull();
    expect(container.querySelector('[data-app-001-data="missing"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);

    resolveIdentity?.(identityResponse());
    await flushAsyncWork();
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error('test setup: WebSocket was not created');

    open(socket);

    expect(container.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(socket.sent).toHaveLength(1);
    const reconnect = decodedClientMessageV2(socket, 0);
    expect(reconnect).toEqual({
      deviceId: DEVICE_ID,
      knownRevisions: {
        actorVisibilityRevision: 0,
        projectionRevision: 0,
        stateRevision: 0,
      },
      messageType: 'session.reconnect',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: REQUEST_ID,
      supportedWorkflowCommandIds: [
        IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        SET_DECIDE_WORKFLOW_COMMAND_ID,
        ROLL_COMMIT_WORKFLOW_COMMAND_ID,
      ],
      unacknowledgedCommandIds: [],
    });
    expect(decodeClientMessage(socket.sent[0] ?? '', WEB_PROTOCOL_VOCABULARY)).toMatchObject({
      ok: false,
      refusal: { path: '$.protocolVersion', value: WIRE_PROTOCOL_V2_VERSION },
    });
    expect(socket.sent[0]).not.toContain('projection.reconnect');
    expect(fetch).toHaveBeenCalledWith(new URL('/device-identity', window.location.href).href, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const url = new URL(socket.url);
    expect(url.protocol).toBe(window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe('/state');
  });

  it('renders the full confirmed APP-001 to APP-002 to CHR-001 to APP-004 to APP-002 path', async () => {
    const connection = await connectClient();
    const { container } = connection;
    let { socket } = connection;
    open(socket);
    deliver(socket, checkedHostTextV2(capabilities()));

    expect(container.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();

    deliver(socket, checkedHostTextV2(snapshot()));

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(4);
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('[data-host-field="bootState"]')?.textContent).toBe('READY');
    expect(
      container.querySelector('[data-host-field="baselineCompatibility"]')?.textContent,
    ).toContain('host-tuple-36');
    expect(container.querySelector('[data-host-field="integrityStatus"]')?.textContent).toContain(
      '"tracked": 36',
    );

    expect(socket.sent).toHaveLength(1);
    const initialUrl = window.location.href;

    const player = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
      'APP-001 player action',
    );
    act(() => {
      player.click();
    });

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).toBeNull();
    expect(window.location.href).toBe(initialUrl);
    expect(decodedClientMessageV2(socket, 1)).toMatchObject({
      actionKey: 'APP-001::CTA::001',
      expectedProjectionRevision: 8,
      navigationRequestId: PLAYER_NAVIGATION_REQUEST_ID,
      sourceFormId: 'APP-001',
    });

    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-002::CTA::002', 'APP-002::CTA::007'],
            formId: 'APP-002',
            formType: 'screen',
            roleFilteredPayload: APP_002_PROJECTION,
            routeBindings: [],
            routeTemplate: '/player',
          },
          9,
          PLAYER_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-host-field]')).toHaveLength(4);
    expect(window.location.pathname).toBe('/player');

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Создать персонажа"]'),
        'APP-002 create-character action',
      ).click();
    });

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).toBeNull();
    expect(window.location.pathname).toBe('/player');
    expect(decodedClientMessageV2(socket, 2)).toMatchObject({
      actionKey: 'APP-002::CTA::007',
      expectedProjectionRevision: 9,
      navigationRequestId: CHARACTER_NAVIGATION_REQUEST_ID,
      sourceFormId: 'APP-002',
    });

    deliver(
      socket,
      checkedHostTextV2(navigationSnapshot(chr001Base(), 10, CHARACTER_NAVIGATION_REQUEST_ID)),
    );

    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).not.toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-001`,
    );
    expect(container.querySelectorAll('[data-host-field]')).toHaveLength(12);
    expect(container.querySelector('[data-host-field="massKg"]')?.textContent).toContain('null');
    expect(
      container.querySelector('[data-host-field="wizardCheckpointId"]')?.textContent,
    ).toContain(WIZARD_CHECKPOINT_ID);
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(1);
    expect(
      container.querySelector('[data-atlas-action="Сохранить идентичность и продолжить"]'),
    ).toBeNull();

    select(
      requiredElement(
        container.querySelector<HTMLSelectElement>('[data-identity-field="sex"]'),
        'CHR-001 sex selector',
      ),
      'FEMALE',
    );
    const identity = decodedClientMessageV3(socket, 3);
    expect(identity).toMatchObject({
      expectedDraftRevision: 0,
      expectedRevisions: { ...REVISIONS, projectionRevision: 10 },
      messageType: 'character.identity-draft.replace',
      scope: {
        characterDraftId: CHARACTER_DRAFT_ID,
        contextId: CONTEXT_ID,
        sourceFormId: 'CHR-001',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      values: {
        age: null,
        artAssetKeyOrLocalFile: null,
        description: null,
        massKg: null,
        name: null,
        sex: 'FEMALE',
      },
    });
    if (identity.messageType !== 'character.identity-draft.replace') {
      throw new Error('test setup: identity replacement not sent');
    }
    const identityText = socket.sent[3];
    act(() => socket.serverClose(1006, 'identity result lost'));
    act(() => requiredElement(container.querySelector('button'), 'reconnect action').click());
    socket = FakeWebSocket.instances.at(-1)!;
    open(socket);
    const resumed = decodedClientMessageV2(socket, 0);
    if (resumed.messageType !== 'session.reconnect') throw new Error('missing reconnect request');
    deliverPair(
      socket,
      capabilities({
        reconnectRequestId: resumed.reconnectRequestId,
        revisions: { ...REVISIONS, projectionRevision: 10 },
      }),
      navigationSnapshot(chr001Base(), 10, resumed.reconnectRequestId, 'RECONNECT'),
    );
    expect(socket.sent[1]).toBe(identityText);
    deliver(
      socket,
      checkedHostTextV3({
        draftRevision: 1,
        draftUpdateId: identity.draftUpdateId,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: chr001Base({ ...CHR_001_PROJECTION, draftRevision: 1, sex: 'FEMALE' }),
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V3_VERSION,
        revisions: { ...REVISIONS, projectionRevision: 11 },
        scope: identity.scope,
      }),
    );
    expect(container.querySelector<HTMLSelectElement>('[data-identity-field="sex"]')?.value).toBe(
      'FEMALE',
    );
    expect(container.querySelector('[data-identity-dirty="false"]')).not.toBeNull();

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Отменить новый черновик"]'),
        'CHR-001 cancel action',
      ).click();
    });

    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-004"]')).toBeNull();
    expect(decodedClientMessageV2(socket, 2)).toMatchObject({
      actionKey: 'CHR-001::CTA::002',
      expectedProjectionRevision: 11,
      navigationRequestId: LIBRARY_NAVIGATION_REQUEST_ID,
      sourceFormId: 'CHR-001',
    });

    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-004::CTA::001', 'APP-004::CTA::007'],
            formId: 'APP-004',
            formType: 'screen',
            roleFilteredPayload: { ...APP_004_PROJECTION, projectionRevision: 12 },
            routeBindings: [],
            routeTemplate: '/player/characters',
          },
          12,
          LIBRARY_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="APP-004"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/player/characters');
    expect(container.querySelectorAll('[data-host-field]')).toHaveLength(11);
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(2);
    for (const actionKey of [
      'APP-004::CTA::002',
      'APP-004::CTA::003',
      'APP-004::CTA::004',
      'APP-004::CTA::005',
      'APP-004::CTA::006',
      'APP-004::CTA::008',
    ]) {
      expect(container.querySelector(`[data-atlas-action-key="${actionKey}"]`)).toBeNull();
    }

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Вернуться в главное меню игрока"]',
        ),
        'APP-004 return action',
      ).click();
    });

    expect(container.querySelector('[data-atlas-form-id="APP-004"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).toBeNull();
    expect(decodedClientMessageV2(socket, 3)).toMatchObject({
      actionKey: 'APP-004::CTA::007',
      expectedProjectionRevision: 12,
      navigationRequestId: MENU_NAVIGATION_REQUEST_ID,
      sourceFormId: 'APP-004',
    });

    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-002::CTA::002', 'APP-002::CTA::007'],
            formId: 'APP-002',
            formType: 'screen',
            roleFilteredPayload: { ...APP_002_PROJECTION, projectionRevision: 13 },
            routeBindings: [],
            routeTemplate: '/player',
          },
          13,
          MENU_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/player');
  });

  it('offers the exact six CHR-001 catalog placeholders and sends a selected asset key', async () => {
    const { container, socket } = await connectToValidChr001();
    const placeholder = requiredElement(
      container.querySelector<HTMLSelectElement>('[data-character-art-placeholder]'),
      'CHR-001 portrait placeholder selector',
    );

    expect([...placeholder.options].map((option) => option.value)).toEqual([
      '',
      ...LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS,
    ]);
    expect(container.textContent).not.toContain('Ключ портрета');

    select(placeholder, LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[0]);

    expect(decodedClientMessageV3(socket, 3)).toMatchObject({
      messageType: 'character.identity-draft.replace',
      scope: { sourceFormId: 'CHR-001' },
      values: {
        artAssetKeyOrLocalFile: {
          assetKey: LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[0],
          kind: 'asset-key',
        },
      },
    });
    expect(container.querySelector('[data-character-art-current]')?.textContent).toContain(
      LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[0],
    );
  });

  it('derives local-file media type from bytes, replaces the file, and clears art to null', async () => {
    const { container, socket } = await connectToValidChr001();
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'renamed.jpg',
      { type: 'image/jpeg' },
    );
    await chooseFile(
      requiredElement(
        container.querySelector<HTMLInputElement>('[data-character-art-file]'),
        'CHR-001 character art file input',
      ),
      png,
    );

    const pngRequest = decodedClientMessageV3(socket, 3);
    expect(pngRequest).toMatchObject({
      messageType: 'character.identity-draft.replace',
      scope: { sourceFormId: 'CHR-001' },
      values: {
        artAssetKeyOrLocalFile: {
          bytesBase64: 'iVBORw0KGgo=',
          kind: 'local-file',
          mediaType: 'image/png',
        },
      },
    });
    expect(container.querySelector('[data-character-art-status]')?.textContent).toContain(
      'отправлен хосту',
    );
    expect(
      container
        .querySelector('[data-character-art-file]')
        ?.closest('fieldset')
        ?.getAttribute('aria-busy'),
    ).toBe('false');
    if (pngRequest.messageType !== 'character.identity-draft.replace') {
      throw new Error('test setup: PNG identity replacement not sent');
    }
    deliver(
      socket,
      checkedHostTextV3({
        draftRevision: 1,
        draftUpdateId: pngRequest.draftUpdateId,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: {
            ...chr001Base({
              ...VALID_CHR_001_PROJECTION,
              artAssetKeyOrLocalFile: pngRequest.values.artAssetKeyOrLocalFile,
              draftRevision: 1,
            }),
            availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
          },
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V3_VERSION,
        revisions: { ...REVISIONS, projectionRevision: 11 },
        scope: pngRequest.scope,
      }),
    );
    expect(container.querySelector('[data-character-art-current]')?.textContent).toContain(
      'image/png',
    );
    const confirmedArtText =
      container.querySelector('[data-host-field="artAssetKeyOrLocalFile"]')?.textContent ?? '';
    expect(confirmedArtText).toContain('[omitted from presentation]');
    expect(confirmedArtText).not.toContain('iVBORw0KGgo=');

    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'renamed.png', {
      type: 'image/png',
    });
    await chooseFile(
      requiredElement(
        container.querySelector<HTMLInputElement>('[data-character-art-file]'),
        'CHR-001 character art replacement input',
      ),
      jpeg,
    );
    const jpegRequest = decodedClientMessageV3(socket, 4);
    expect(jpegRequest).toMatchObject({
      values: {
        artAssetKeyOrLocalFile: {
          bytesBase64: '/9j/',
          kind: 'local-file',
          mediaType: 'image/jpeg',
        },
      },
    });
    if (jpegRequest.messageType !== 'character.identity-draft.replace') {
      throw new Error('test setup: JPEG identity replacement not sent');
    }
    deliver(
      socket,
      checkedHostTextV3({
        draftRevision: 2,
        draftUpdateId: jpegRequest.draftUpdateId,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: {
            ...chr001Base({
              ...VALID_CHR_001_PROJECTION,
              artAssetKeyOrLocalFile: jpegRequest.values.artAssetKeyOrLocalFile,
              draftRevision: 2,
            }),
            availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
          },
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V3_VERSION,
        revisions: { ...REVISIONS, projectionRevision: 12 },
        scope: jpegRequest.scope,
      }),
    );

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-character-art-clear]'),
        'CHR-001 clear character art action',
      ).click();
    });
    expect(decodedClientMessageV3(socket, 5)).toMatchObject({
      values: { artAssetKeyOrLocalFile: null },
    });
  });

  it('preserves a newer identity edit when a pending file read completes', async () => {
    vi.stubGlobal('FileReader', DeferredFileReader);
    const { container, socket } = await connectToValidChr001();
    const fileInput = requiredElement(
      container.querySelector<HTMLInputElement>('[data-character-art-file]'),
      'CHR-001 character art file input',
    );
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([0])], 'deferred.png')],
    });
    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(DeferredFileReader.instances).toHaveLength(1);

    select(
      requiredElement(
        container.querySelector<HTMLSelectElement>('[data-identity-field="sex"]'),
        'CHR-001 sex selector',
      ),
      'MALE',
    );
    const sexRequest = decodedClientMessageV3(socket, 3);
    if (sexRequest.messageType !== 'character.identity-draft.replace') {
      throw new Error('test setup: sex identity replacement not sent');
    }
    act(() => {
      DeferredFileReader.instances[0]?.complete(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    });
    await flushAsyncWork();
    expect(socket.sent).toHaveLength(4);

    deliver(
      socket,
      checkedHostTextV3({
        draftRevision: 1,
        draftUpdateId: sexRequest.draftUpdateId,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: {
            ...chr001Base({ ...VALID_CHR_001_PROJECTION, draftRevision: 1, sex: 'MALE' }),
            availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
          },
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V3_VERSION,
        revisions: { ...REVISIONS, projectionRevision: 11 },
        scope: sexRequest.scope,
      }),
    );

    expect(decodedClientMessageV3(socket, 4)).toMatchObject({
      values: {
        artAssetKeyOrLocalFile: {
          bytesBase64: 'iVBORw0KGgo=',
          kind: 'local-file',
          mediaType: 'image/png',
        },
        sex: 'MALE',
      },
    });
  });

  it('keeps the confirmed CHR-001 read-only when a pending file finishes after disconnect', async () => {
    vi.stubGlobal('FileReader', DeferredFileReader);
    const { container, socket } = await connectToValidChr001();
    const fileInput = requiredElement(
      container.querySelector<HTMLInputElement>('[data-character-art-file]'),
      'CHR-001 character art file input',
    );
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([0])], 'deferred.png')],
    });
    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(DeferredFileReader.instances).toHaveLength(1);

    act(() => socket.serverClose(1006, 'connection lost during file read'));
    expect(container.querySelector('[data-client-state="disconnected"]')).not.toBeNull();

    act(() => {
      DeferredFileReader.instances[0]?.complete(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    });
    await flushAsyncWork();

    expect(socket.sent).toHaveLength(3);
    expect(container.querySelector('[data-client-state="disconnected"]')).not.toBeNull();
    expect(container.querySelector('[data-client-state="ready"]')).toBeNull();
    expect(container.textContent).toContain('Переподключиться');
    expect(container.querySelector('[data-character-art-local-error]')?.textContent).toContain(
      'черновик недоступен',
    );
  });

  it('does not guess an unsupported file type or leave Continue active while reading', async () => {
    vi.stubGlobal('FileReader', DeferredFileReader);
    const { container, socket } = await connectToValidChr001();
    const continueAction = requiredElement(
      container.querySelector<HTMLButtonElement>(
        '[data-atlas-action="Сохранить идентичность и продолжить"]',
      ),
      'CHR-001 Continue action',
    );
    const fileInput = requiredElement(
      container.querySelector<HTMLInputElement>('[data-character-art-file]'),
      'CHR-001 character art file input',
    );
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([0x47, 0x49, 0x46])], 'not-an-image.png')],
    });
    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(fileInput.closest('fieldset')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-character-art-status]')?.textContent).toContain(
      'Чтение файла',
    );
    expect(
      container.querySelector('[data-atlas-action="Сохранить идентичность и продолжить"]'),
    ).toBeNull();
    const sentWhileReading = socket.sent.length;
    act(() => continueAction.click());
    expect(socket.sent).toHaveLength(sentWhileReading);

    act(() => {
      DeferredFileReader.instances[0]?.complete(new Uint8Array([0x47, 0x49, 0x46]));
    });
    await flushAsyncWork();
    expect(socket.sent).toHaveLength(3);
    expect(container.querySelector('[data-character-art-local-error]')?.textContent).toContain(
      'не является PNG или JPEG',
    );
    expect(fileInput.closest('fieldset')?.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
  });

  it.each([
    ['FILE_TOO_LARGE', '12 МБ'],
    ['MEDIA_SIGNATURE_MISMATCH', 'Сигнатура файла'],
  ] as const)(
    'shows host art refusal %s as a field error without internal identifiers',
    async (reason, expectedText) => {
      const { container, socket } = await connectToValidChr001();
      await chooseFile(
        requiredElement(
          container.querySelector<HTMLInputElement>('[data-character-art-file]'),
          'CHR-001 character art file input',
        ),
        new File(
          [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
          'portrait.png',
        ),
      );
      const request = decodedClientMessageV3(socket, 3);
      if (request.messageType !== 'character.identity-draft.replace') {
        throw new Error('test setup: art identity replacement not sent');
      }

      deliver(
        socket,
        checkedHostTextV3({
          draftUpdateId: request.draftUpdateId,
          messageType: 'character.identity-draft.refusal',
          presentationUnchanged: true,
          protocolVersion: WIRE_PROTOCOL_V3_VERSION,
          refusal: {
            code: 'INVALID_FIELD',
            error: { field: 'artAssetKeyOrLocalFile', reason },
          },
          revisions: { ...REVISIONS, projectionRevision: 10 },
          scope: request.scope,
        }),
      );

      const alert = requiredElement(
        container.querySelector<HTMLElement>(
          '[data-identity-refusal-field="artAssetKeyOrLocalFile"]',
        ),
        'CHR-001 character art host refusal',
      );
      expect(alert.closest('fieldset')?.querySelector('[data-character-art-file]')).not.toBeNull();
      expect(alert.textContent).toContain('Поле «Арт персонажа»');
      expect(alert.textContent).toContain(expectedText);
      expect(alert.textContent).not.toContain(reason);
      expect(alert.textContent).not.toContain('INVALID_FIELD');
      expect(alert.textContent).not.toMatch(/Rule ID/iu);
      expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    },
  );

  it('removes Continue from the executable DOM cache while confirmed CHR-001 values are dirty', async () => {
    const { container, socket } = await connectToValidChr001();
    const continueAction = requiredElement(
      container.querySelector<HTMLButtonElement>(
        '[data-atlas-action="Сохранить идентичность и продолжить"]',
      ),
      'CHR-001 Continue action',
    );

    select(
      requiredElement(
        container.querySelector<HTMLSelectElement>('[data-identity-field="sex"]'),
        'CHR-001 sex selector',
      ),
      '',
    );

    expect(decodedClientMessageV3(socket, 3)).toMatchObject({
      messageType: 'character.identity-draft.replace',
      values: {
        age: 1,
        artAssetKeyOrLocalFile: null,
        description: 'Подтверждённая идентичность',
        massKg: 0.1,
        name: 'Алиса',
        sex: null,
      },
    });
    expect(container.querySelector('[data-identity-dirty="true"]')).not.toBeNull();
    expect(
      container.querySelector('[data-atlas-action="Сохранить идентичность и продолжить"]'),
    ).toBeNull();
    expect(container.querySelector('[data-host-field="sex"]')?.textContent).toContain('FEMALE');
    const sentAfterInvalidReplacement = socket.sent.length;
    act(() => continueAction.click());
    expect(socket.sent).toHaveLength(sentAfterInvalidReplacement);
  });

  it('sends the exact checkpoint, accepts CHR-010, freezes sex, and keeps race selectors local', async () => {
    const { container, socket } = await connectToValidChr001();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Сохранить идентичность и продолжить"]',
        ),
        'CHR-001 Continue action',
      ).click();
    });

    expect(decodedClientMessageV1(socket, 3)).toEqual({
      commandId: IDENTITY_CHECKPOINT_COMMAND_ID,
      commandKind: 'workflow-command',
      expectedRevisions: { ...REVISIONS, projectionRevision: 10 },
      messageType: 'command.request',
      payload: {
        stage: 'IDENTITY',
        characterDraftId: CHARACTER_DRAFT_ID,
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
        draftRevision: 0,
        name: 'Алиса',
        description: 'Подтверждённая идентичность',
        artAssetKeyOrLocalFile: null,
        age: 1,
        sex: 'FEMALE',
        massKg: 0.1,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    });
    expect(
      container.querySelector('[data-atlas-action="Сохранить идентичность и продолжить"]'),
    ).toBeNull();

    deliver(socket, checkedHostTextV1(checkpointTerminal(IDENTITY_CHECKPOINT_COMMAND_ID)));
    const sentAfterCheckpoint = socket.sent.length;
    select(
      requiredElement(
        container.querySelector<HTMLSelectElement>('[data-identity-field="sex"]'),
        'frozen CHR-001 sex selector',
      ),
      'MALE',
    );
    expect(socket.sent).toHaveLength(sentAfterCheckpoint);
    expect(container.querySelector<HTMLSelectElement>('[data-identity-field="sex"]')?.value).toBe(
      'FEMALE',
    );

    deliver(socket, checkedHostTextV2(commandDestinationSnapshot(IDENTITY_CHECKPOINT_COMMAND_ID)));

    expect(container.querySelector('[data-atlas-form-id="CHR-010"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).toBeNull();
    expect(container.querySelector('[data-identity-field="sex"]')).toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-010`,
    );
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(3);
    for (const actionKey of ['CHR-010::CTA::001', 'CHR-010::CTA::002', 'CHR-010::CTA::003']) {
      expect(container.querySelector(`[data-atlas-action-key="${actionKey}"]`)).toBeNull();
    }
    expect(
      container.querySelector('[data-host-field="raceConsequencesPreview"]')?.textContent,
    ).toContain('null');
    expect(container.querySelector('[data-host-field="choiceLockStatus"]')?.textContent).toContain(
      'UNLOCKED',
    );

    const sentBeforeRaceChoices = socket.sent.length;
    for (const [label, choice] of [
      ['Выбрать Единого', 'UNITED'],
      ['Выбрать Вольного', 'FREE'],
      ['Выбрать Чистого', 'PURE'],
    ] as const) {
      act(() => {
        requiredElement(
          container.querySelector<HTMLButtonElement>(`[data-atlas-action="${label}"]`),
          `CHR-010 ${choice} selector`,
        ).click();
      });
      expect(container.querySelector('[data-race-choice-draft]')?.textContent).toContain(choice);
      expect(container.querySelector('[data-host-field="raceChoice"]')?.textContent).toContain(
        'null',
      );
      const expectedConfirmation = choice === 'PURE' ? 'CHR-010::CTA::002' : 'CHR-010::CTA::001';
      expect(
        container.querySelector(`[data-atlas-action-key="${expectedConfirmation}"]`),
      ).not.toBeNull();
      expect(
        container.querySelector(
          `[data-atlas-action-key="${
            expectedConfirmation === 'CHR-010::CTA::001' ? 'CHR-010::CTA::002' : 'CHR-010::CTA::001'
          }"]`,
        ),
      ).toBeNull();
      expect(socket.sent).toHaveLength(sentBeforeRaceChoices);
    }
  });

  it('walks CHR-010 through CHR-016 and CHR-036 to CHR-002 method selection', async () => {
    const { container, socket } = await connectToChr010();

    const sentBeforeRace = socket.sent.length;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Выбрать Единого"]'),
        'CHR-010 UNITED selector',
      ).click();
    });
    expect(socket.sent).toHaveLength(sentBeforeRace);
    expect(container.querySelector('[data-character-creation-choice]')?.textContent).toContain(
      'UNITED',
    );
    expect(container.querySelector('[data-character-creation-consequence]')?.textContent).toBe(
      'Выбрать Единого',
    );
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить Единого или Вольного"]',
        ),
        'CHR-010 confirmation',
      ).click();
    });
    const raceRequest = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(raceRequest).toEqual({
      commandId: raceRequest.messageType === 'command.request' ? raceRequest.commandId : '',
      commandKind: 'workflow-command',
      expectedRevisions: ENTITY_REVISIONS,
      messageType: 'command.request',
      payload: {
        characterDraftId: CHARACTER_DRAFT_ID,
        draftRevision: 0,
        raceChoice: 'UNITED',
        sourceFormId: 'CHR-010',
        stage: 'RACE_AND_METHOD',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
    });
    if (raceRequest.messageType !== 'command.request') throw new Error('missing race command');
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          raceRequest.commandId,
          { nextFormId: 'CHR-016', raceChoice: 'UNITED', sourceFormId: 'CHR-010' },
          1,
          1,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(setDecisionDestinationSnapshot(raceRequest.commandId, chr016Base(), 1)),
    );

    expect(container.querySelector('[data-atlas-form-id="CHR-016"]')).not.toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-016`,
    );
    const sentBeforeAcquisition = socket.sent.length;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Выбрать ручное получение симбионтов"]',
        ),
        'CHR-016 MANUAL selector',
      ).click();
    });
    expect(socket.sent).toHaveLength(sentBeforeAcquisition);
    expect(container.querySelector('[data-character-creation-consequence]')?.textContent).toBe(
      'Выбрать ручное получение симбионтов',
    );
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить способ получения симбионтов"]',
        ),
        'CHR-016 confirmation',
      ).click();
    });
    const acquisitionRequest = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(acquisitionRequest).toMatchObject({
      commandKind: 'workflow-command',
      expectedRevisions: entityRevisions(1),
      messageType: 'command.request',
      payload: {
        characterDraftId: CHARACTER_DRAFT_ID,
        draftRevision: 1,
        sourceFormId: 'CHR-016',
        stage: 'RACE_AND_METHOD',
        symbiontAcquisitionMode: 'MANUAL',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
    });
    if (acquisitionRequest.messageType !== 'command.request') {
      throw new Error('missing acquisition command');
    }
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          acquisitionRequest.commandId,
          {
            nextFormId: 'CHR-036',
            sourceFormId: 'CHR-016',
            symbiontAcquisitionMode: 'MANUAL',
          },
          2,
          2,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionDestinationSnapshot(acquisitionRequest.commandId, chr036Base(), 2),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="CHR-036"]')).not.toBeNull();
    const sentBeforeDice = socket.sent.length;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Выбрать автоматические броски"]',
        ),
        'CHR-036 AUTO selector',
      ).click();
    });
    expect(socket.sent).toHaveLength(sentBeforeDice);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить режим дайсов создания"]',
        ),
        'CHR-036 confirmation',
      ).click();
    });
    const diceRequest = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(diceRequest).toMatchObject({
      expectedRevisions: entityRevisions(2),
      messageType: 'command.request',
      payload: {
        characterDraftId: CHARACTER_DRAFT_ID,
        diceInputMode: 'AUTO',
        draftRevision: 2,
        sourceFormId: 'CHR-036',
        stage: 'RACE_AND_METHOD',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
    });
    if (diceRequest.messageType !== 'command.request') throw new Error('missing dice command');
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          diceRequest.commandId,
          { diceInputMode: 'AUTO', nextFormId: 'CHR-002', sourceFormId: 'CHR-036' },
          3,
          3,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(setDecisionDestinationSnapshot(diceRequest.commandId, chr002Base(), 3)),
    );

    expect(container.querySelector('[data-atlas-form-id="CHR-002"]')).not.toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-002`,
    );
    expect(container.querySelector('[data-atlas-action-key="CHR-002::CTA::001"]')).toBeNull();
    const sentAtMethodBoundary = socket.sent.length;
    for (const [label, value] of [
      ['Выбрать классический метод', 'CLASSIC'],
      ['Выбрать авантюристский метод', 'ADVENTUROUS'],
      ['Выбрать «Всё или ничего»', 'ALL_OR_NOTHING'],
    ] as const) {
      act(() => {
        requiredElement(
          container.querySelector<HTMLButtonElement>(`[data-atlas-action="${label}"]`),
          `CHR-002 ${value} selector`,
        ).click();
      });
      expect(container.querySelector('[data-character-creation-choice]')?.textContent).toContain(
        value,
      );
      expect(container.querySelector('[data-atlas-action-key="CHR-002::CTA::001"]')).not.toBeNull();
      expect(socket.sent).toHaveLength(sentAtMethodBoundary);
    }
  });

  it('bridges CHR-002 confirmation and keeps seven MANUAL faces local until submit', async () => {
    const { container, socket } = await connectToWizardBase(chr002Base(), 3);
    const sentBeforeMethod = socket.sent.length;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Выбрать классический метод"]',
        ),
        'CHR-002 CLASSIC selector',
      ).click();
    });
    expect(socket.sent).toHaveLength(sentBeforeMethod);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить метод характеристик"]',
        ),
        'CHR-002 confirmation',
      ).click();
    });
    const methodRequest = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(methodRequest).toMatchObject({
      expectedRevisions: entityRevisions(3),
      messageType: 'command.request',
      payload: {
        characterDraftId: CHARACTER_DRAFT_ID,
        draftRevision: 3,
        sourceFormId: 'CHR-002',
        stage: 'RACE_AND_METHOD',
        statMethod: 'CLASSIC',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
    });
    if (methodRequest.messageType !== 'command.request') throw new Error('missing method command');
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          methodRequest.commandId,
          {
            branchUuid: BRANCH_UUID,
            nextFormId: 'CHR-003',
            setRollRequestId: SET_ROLL_REQUEST_ID,
            sourceFormId: 'CHR-002',
            statMethod: 'CLASSIC',
          },
          4,
          4,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(setDecisionDestinationSnapshot(methodRequest.commandId, chr003Base(), 4)),
    );

    const inputs = [...container.querySelectorAll<HTMLInputElement>('[data-stat-roll-input]')];
    expect(inputs).toHaveLength(7);
    expect(container.querySelector('[data-atlas-action-key="CHR-003::CTA::002"]')).toBeNull();
    const sentBeforeFaces = socket.sent.length;
    const faces = [2, 3, 4, 5, 6, 7, 8];
    inputs.forEach((input, index) => {
      inputNumber(input, faces[index]!);
      expect(socket.sent).toHaveLength(sentBeforeFaces);
      const commit = container.querySelector('[data-atlas-action-key="CHR-003::CTA::002"]');
      if (index === 6) expect(commit).not.toBeNull();
      else expect(commit).toBeNull();
    });
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Зафиксировать текущий набор характеристик"]',
        ),
        'CHR-003 commit',
      ).click();
    });
    const rollRequest = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(rollRequest).toMatchObject({
      expectedRevisions: entityRevisions(4),
      messageType: 'command.request',
      payload: {
        branchUuid: BRANCH_UUID,
        characterDraftId: CHARACTER_DRAFT_ID,
        draftRevision: 4,
        manualFacesOrNull: faces,
        setRollRequestId: SET_ROLL_REQUEST_ID,
        sourceFormId: 'CHR-003',
        stage: 'STAT_ROLLS',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
    });
  });

  it('submits AUTO as null and restores the same committed CHR-003 set after replay', async () => {
    const { container, socket } = await connectToWizardBase(chr003Base(CHR_003_AUTO_PROJECTION), 4);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Зафиксировать текущий набор характеристик"]',
        ),
        'CHR-003 AUTO commit',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(request).toMatchObject({
      messageType: 'command.request',
      payload: {
        branchUuid: BRANCH_UUID,
        characterDraftId: CHARACTER_DRAFT_ID,
        draftRevision: 4,
        manualFacesOrNull: null,
        setRollRequestId: SET_ROLL_REQUEST_ID,
        sourceFormId: 'CHR-003',
        stage: 'STAT_ROLLS',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
    });
    if (request.messageType !== 'command.request') throw new Error('missing AUTO roll command');
    const faces = [2, 3, 4, 5, 6, 7, 8];
    const result = {
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 5,
      confirmationRollRequestIdOrNull: null,
      diceInputModeSnapshot: 'AUTO',
      draftRevision: 5,
      faces,
      naturalCriticalQueue: [],
      nextFormId: 'CHR-003',
      setRollReceiptId: SET_ROLL_RECEIPT_ID,
      setRollRequestId: SET_ROLL_REQUEST_ID,
      shownResultLocked: true,
      sourceFormId: 'CHR-003',
      stage: 'STAT_ROLLS',
    } as const;
    act(() => socket.serverClose(1006, 'transport lost'));
    act(() => {
      requiredElement(
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent === 'Переподключиться',
        ) ?? null,
        'reconnect button',
      ).click();
    });
    const resumedSocket = FakeWebSocket.instances.at(-1)!;
    open(resumedSocket);
    const reconnect = decodedClientMessageV2(resumedSocket, 0);
    if (reconnect.messageType !== 'session.reconnect') throw new Error('missing reconnect');
    expect(reconnect.unacknowledgedCommandIds).toEqual([request.commandId]);
    deliver(
      resumedSocket,
      checkedHostTextV1(
        rollCommitTerminal(request.commandId, SET_ROLL_RECEIPT_ID, result, 5, true),
      ),
    );
    const committedProjection = {
      ...CHR_003_AUTO_PROJECTION,
      draftRevision: 5,
      facesOrManualInputs: faces,
      setRollReceiptId: SET_ROLL_RECEIPT_ID,
      shownResultLocked: true,
    } as const;
    deliverPair(
      resumedSocket,
      capabilities({
        reconnectRequestId: reconnect.reconnectRequestId,
        revisions: entityRevisions(5),
      }),
      reconnectWizardSnapshot(reconnect.reconnectRequestId, chr003Base(committedProjection), 5),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(
      [...container.querySelectorAll('[data-stat-roll-face]')].map((item) => item.textContent),
    ).toEqual(faces.map(String));
    expect(container.querySelector('[data-stat-roll-committed]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-003::CTA::002"]')).toBeNull();
  });

  it('keeps the AUTO roll CTA absent without the ROLL-COMMIT capability', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(
      socket,
      capabilities({
        executableWorkflowCommandIds: [
          IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          SET_DECIDE_WORKFLOW_COMMAND_ID,
        ],
        revisions: entityRevisions(4),
      }),
      reconnectWizardSnapshot(
        REQUEST_ID,
        { ...chr003Base(CHR_003_AUTO_PROJECTION), availableActionKeys: [] },
        4,
      ),
    );
    expect(container.querySelector('[data-atlas-action-key="CHR-003::CTA::002"]')).toBeNull();
    expect(socket.sent).toHaveLength(1);
  });

  it('keeps CHR-004 MANUAL confirmation local and renders actionless CHAIN_COMPLETE', async () => {
    const pendingProjection = {
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      commandId: null,
      confirmationFace: null,
      confirmationReceiptId: null,
      confirmationRollRequestId: CONFIRMATION_ROLL_REQUEST_ID,
      criticalQueueIndex: 0,
      diceInputModeSnapshot: 'MANUAL',
      draftRevision: 5,
      originFace: 20,
      returnDecisionFormId: 'CHR-005',
      setRollReceiptId: SET_ROLL_RECEIPT_ID,
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    } as const;
    const { container, socket } = await connectToWizardBase(chr004Base(pendingProjection), 5);
    expect(container.querySelector('[data-atlas-action-key="CHR-004::CTA::001"]')).toBeNull();
    const sentBeforeInput = socket.sent.length;
    inputNumber(
      requiredElement(
        container.querySelector<HTMLInputElement>('[data-confirmation-roll-input]'),
        'CHR-004 MANUAL face',
      ),
      14,
    );
    expect(socket.sent).toHaveLength(sentBeforeInput);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Зафиксировать текущий подтверждающий бросок"]',
        ),
        'CHR-004 confirmation commit',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    expect(request).toMatchObject({
      expectedRevisions: entityRevisions(5),
      messageType: 'command.request',
      payload: {
        branchUuid: BRANCH_UUID,
        characterDraftId: CHARACTER_DRAFT_ID,
        confirmationRollRequestId: CONFIRMATION_ROLL_REQUEST_ID,
        criticalQueueIndex: 0,
        draftRevision: 5,
        manualFaceOrNull: 14,
        setRollReceiptId: SET_ROLL_RECEIPT_ID,
        sourceFormId: 'CHR-004',
        stage: 'STAT_ROLLS',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
    });
    if (request.messageType !== 'command.request') throw new Error('missing confirmation command');
    const confirmationReceiptId = 'confirmation-receipt-1';
    const result = {
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 6,
      confirmationFace: 14,
      confirmationReceiptId,
      confirmationRollRequestId: CONFIRMATION_ROLL_REQUEST_ID,
      criticalQueueIndex: 0,
      draftRevision: 6,
      nextConfirmationRollRequestIdOrNull: null,
      nextFormId: 'CHR-004',
      originFace: 20,
      outcomeOrNull: {
        creationCriticalPenaltyOrNull: null,
        criticalGrade: 0,
        criticalPolarity: 'NONE',
        setEntryIndex: 0,
        value: 20,
      },
      returnDecisionFormId: 'CHR-005',
      setRollReceiptId: SET_ROLL_RECEIPT_ID,
      sourceFormId: 'CHR-004',
      stage: 'STAT_ROLLS',
    } as const;
    deliver(
      socket,
      checkedHostTextV1(rollCommitTerminal(request.commandId, confirmationReceiptId, result, 6)),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionDestinationSnapshot(
          request.commandId,
          chr004Base({
            ...pendingProjection,
            confirmationFace: 14,
            confirmationReceiptId,
            draftRevision: 6,
          }),
          6,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-critical-chain-status="CHAIN_COMPLETE"]')).not.toBeNull();
    expect(container.querySelector('[data-confirmation-face]')?.textContent).toBe('14');
    expect(container.querySelector('[data-atlas-action-key="CHR-004::CTA::001"]')).toBeNull();
  });

  it('routes PURE directly from CHR-010 to CHR-036 without a synthetic CHR-016 step', async () => {
    const { container, socket } = await connectToChr010();
    const sentBeforePure = socket.sent.length;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Выбрать Чистого"]'),
        'CHR-010 PURE selector',
      ).click();
    });
    expect(socket.sent).toHaveLength(sentBeforePure);
    expect(container.querySelector('[data-atlas-action-key="CHR-010::CTA::001"]')).toBeNull();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Подтвердить Чистого"]'),
        'CHR-010 PURE confirmation',
      ).click();
    });
    const raceRequest = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (raceRequest.messageType !== 'command.request') throw new Error('missing PURE command');
    expect(raceRequest.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      draftRevision: 0,
      raceChoice: 'PURE',
      sourceFormId: 'CHR-010',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          raceRequest.commandId,
          { nextFormId: 'CHR-036', raceChoice: 'PURE', sourceFormId: 'CHR-010' },
          1,
          1,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionDestinationSnapshot(
          raceRequest.commandId,
          chr036Base({ ...CHR_036_PROJECTION, draftRevision: 1 }),
          1,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="CHR-016"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-036"]')).not.toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-036`,
    );
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(2);
  });

  it('replays SET-DECIDE after its receipt arrived but the signed destination was lost', async () => {
    const { container, socket } = await connectToChr010();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Выбрать Единого"]'),
        'CHR-010 UNITED selector',
      ).click();
    });
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить Единого или Вольного"]',
        ),
        'CHR-010 confirmation',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing race command');
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          request.commandId,
          { nextFormId: 'CHR-016', raceChoice: 'UNITED', sourceFormId: 'CHR-010' },
          1,
          1,
        ),
      ),
    );
    act(() => socket.serverClose(1006, 'SET-DECIDE destination lost'));
    act(() => requiredElement(container.querySelector('button'), 'reconnect action').click());
    const resumedSocket = FakeWebSocket.instances.at(-1)!;
    open(resumedSocket);
    const reconnect = decodedClientMessageV2(resumedSocket, 0);
    if (reconnect.messageType !== 'session.reconnect') throw new Error('missing reconnect request');
    expect(reconnect.unacknowledgedCommandIds).toEqual([request.commandId]);

    deliver(
      resumedSocket,
      checkedHostTextV1(
        setDecisionTerminal(
          request.commandId,
          { nextFormId: 'CHR-016', raceChoice: 'UNITED', sourceFormId: 'CHR-010' },
          1,
          1,
          true,
        ),
      ),
    );
    deliverPair(
      resumedSocket,
      capabilities({
        reconnectRequestId: reconnect.reconnectRequestId,
        revisions: entityRevisions(1),
      }),
      reconnectWizardSnapshot(reconnect.reconnectRequestId, chr016Base(), 1),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-016"]')).not.toBeNull();
  });

  it('keeps a historic SET-DECIDE receipt while accepting the latest forward destination', async () => {
    const { container, socket } = await connectToChr010();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Выбрать Единого"]'),
        'CHR-010 UNITED selector',
      ).click();
    });
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить Единого или Вольного"]',
        ),
        'CHR-010 confirmation',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing race command');
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          request.commandId,
          { nextFormId: 'CHR-016', raceChoice: 'UNITED', sourceFormId: 'CHR-010' },
          1,
          1,
          true,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionDestinationSnapshot(
          request.commandId,
          chr002Base({ ...CHR_002_PROJECTION, draftRevision: 3 }),
          3,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-002"]')).not.toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-002`,
    );
  });

  it('refuses a historic SET-DECIDE replay that claims an impossible forward delta', async () => {
    const { container, socket } = await connectToChr010();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Выбрать Единого"]'),
        'CHR-010 UNITED selector',
      ).click();
    });
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Подтвердить Единого или Вольного"]',
        ),
        'CHR-010 confirmation',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing race command');
    deliver(
      socket,
      checkedHostTextV1(
        setDecisionTerminal(
          request.commandId,
          { nextFormId: 'CHR-016', raceChoice: 'UNITED', sourceFormId: 'CHR-010' },
          1,
          1,
          true,
        ),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionDestinationSnapshot(
          request.commandId,
          chr002Base({ ...CHR_002_PROJECTION, draftRevision: 2 }),
          2,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-002"]')).toBeNull();
    expect(decodedClientMessageV1(socket, socket.sent.length - 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { path: '$.presentation.base.roleFilteredPayload.draftRevision' },
    });
  });

  it('keeps confirmation absent when SET-DECIDE capability was not advertised', async () => {
    const { container, socket } = await connectToChr010(
      capabilities({ executableWorkflowCommandIds: [IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID] }),
    );
    const sentBeforeChoice = socket.sent.length;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Выбрать Единого"]'),
        'CHR-010 UNITED selector',
      ).click();
    });

    expect(container.querySelector('[data-character-creation-choice]')?.textContent).toContain(
      'UNITED',
    );
    expect(container.querySelector('[data-atlas-action-key="CHR-010::CTA::001"]')).toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-010::CTA::002"]')).toBeNull();
    expect(socket.sent).toHaveLength(sentBeforeChoice);
  });

  it.each([
    {
      label: 'missing choiceLockStatus',
      mutate: (message: ProjectionSnapshotV2Message): ProjectionSnapshotV2Message => {
        const { choiceLockStatus: _missing, ...projection } = CHR_010_PROJECTION;
        return {
          ...message,
          presentation: {
            ...message.presentation,
            base: { ...message.presentation.base, roleFilteredPayload: projection },
          },
        };
      },
      path: '$.presentation.base.roleFilteredPayload.choiceLockStatus',
    },
    {
      label: 'extra initial action',
      mutate: (message: ProjectionSnapshotV2Message): ProjectionSnapshotV2Message => ({
        ...message,
        presentation: {
          ...message.presentation,
          base: {
            ...message.presentation.base,
            availableActionKeys: [
              ...message.presentation.base.availableActionKeys,
              'CHR-010::CTA::003',
            ],
          },
        },
      }),
      path: '$.presentation.base.availableActionKeys',
    },
    {
      label: 'route binding mismatch',
      mutate: (message: ProjectionSnapshotV2Message): ProjectionSnapshotV2Message => ({
        ...message,
        presentation: {
          ...message.presentation,
          base: {
            ...message.presentation.base,
            routeBindings: [
              {
                parameterIndex: 0,
                source: 'inherited',
                value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              },
            ],
          },
        },
      }),
      path: '$.presentation.base.roleFilteredPayload.characterDraftId',
    },
    {
      label: 'checkpoint receipt mismatch',
      mutate: (message: ProjectionSnapshotV2Message): ProjectionSnapshotV2Message => ({
        ...message,
        presentation: {
          ...message.presentation,
          base: {
            ...message.presentation.base,
            roleFilteredPayload: {
              ...CHR_010_PROJECTION,
              wizardCheckpointId: 'another-checkpoint',
            },
          },
        },
      }),
      path: '$.presentation.base.roleFilteredPayload.wizardCheckpointId',
    },
  ])('refuses a CHR-010 destination with $label', async ({ mutate, path }) => {
    const { container, socket } = await connectToValidChr001();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Сохранить идентичность и продолжить"]',
        ),
        'CHR-001 Continue action',
      ).click();
    });
    deliver(socket, checkedHostTextV1(checkpointTerminal(IDENTITY_CHECKPOINT_COMMAND_ID)));
    deliver(
      socket,
      checkedHostTextV2(mutate(commandDestinationSnapshot(IDENTITY_CHECKPOINT_COMMAND_ID))),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-010"]')).toBeNull();
    expect(decodedClientMessageV1(socket, 4)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { path },
    });
  });

  it('replays a checkpoint after its receipt arrived but the CHR-010 snapshot was lost', async () => {
    const { container, socket } = await connectToValidChr001();
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Сохранить идентичность и продолжить"]',
        ),
        'CHR-001 Continue action',
      ).click();
    });
    deliver(socket, checkedHostTextV1(checkpointTerminal(IDENTITY_CHECKPOINT_COMMAND_ID)));
    act(() => socket.serverClose(1006, 'destination snapshot lost'));
    act(() => requiredElement(container.querySelector('button'), 'reconnect action').click());
    const resumedSocket = FakeWebSocket.instances.at(-1)!;
    open(resumedSocket);
    const reconnect = decodedClientMessageV2(resumedSocket, 0);
    if (reconnect.messageType !== 'session.reconnect') throw new Error('missing reconnect request');
    expect(reconnect.unacknowledgedCommandIds).toEqual([IDENTITY_CHECKPOINT_COMMAND_ID]);

    deliver(
      resumedSocket,
      checkedHostTextV1(checkpointTerminal(IDENTITY_CHECKPOINT_COMMAND_ID, true)),
    );
    deliverPair(
      resumedSocket,
      capabilities({
        reconnectRequestId: reconnect.reconnectRequestId,
        revisions: ENTITY_REVISIONS,
      }),
      reconnectChr010Snapshot(reconnect.reconnectRequestId),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-010"]')).not.toBeNull();
    expect(container.querySelector('[data-identity-field="sex"]')).toBeNull();
  });

  it('rejects a whitespace-only wizard checkpoint identity before caching CHR-001', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
        'APP-001 player action',
      ).click();
    });
    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-002::CTA::007'],
            formId: 'APP-002',
            formType: 'screen',
            roleFilteredPayload: APP_002_PROJECTION,
            routeBindings: [],
            routeTemplate: '/player',
          },
          9,
          PLAYER_NAVIGATION_REQUEST_ID,
        ),
      ),
    );
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Создать персонажа"]'),
        'APP-002 create-character action',
      ).click();
    });
    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: [],
            formId: 'CHR-001',
            formType: 'screen',
            roleFilteredPayload: { ...CHR_001_PROJECTION, wizardCheckpointId: '   ' },
            routeBindings: [
              { parameterIndex: 0, source: 'executor-allocated', value: CHARACTER_DRAFT_ID },
            ],
            routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
          },
          10,
          CHARACTER_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).toBeNull();
    expect(decodedClientMessageV1(socket, 3)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.presentation.base.roleFilteredPayload.wizardCheckpointId',
        value: '   ',
      },
    });
  });

  it('keeps the prior presentation after a matching navigation refusal', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);
    const confirmedUrl = window.location.href;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
        'APP-001 player action',
      ).click();
    });

    deliver(
      socket,
      checkedHostTextV2({
        messageType: 'navigation.form-action.refusal',
        navigationRequestId: PLAYER_NAVIGATION_REQUEST_ID,
        presentationUnchanged: true,
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        revisions: REVISIONS,
      }),
    );

    expect(container.querySelector('[data-client-state="navigation-refusal"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).toBeNull();
    expect(window.location.href).toBe(confirmedUrl);
    expect(container.textContent).toContain('NAVIGATION_UNAVAILABLE');
  });

  it('rejects missing or malformed host fields without rendering a fallback', async () => {
    const { bootState: _bootState, ...missingBootState } = HOST_PROJECTION;
    const scenarios = [
      {
        projection: missingBootState,
        refusalPath: '$.presentation.base.roleFilteredPayload.bootState',
      },
      {
        projection: { ...HOST_PROJECTION, baselineCompatibility: {} },
        refusalPath:
          '$.presentation.base.roleFilteredPayload.baselineCompatibility.builtAgainstTuple',
      },
      {
        projection: { ...HOST_PROJECTION, integrityStatus: {} },
        refusalPath: '$.presentation.base.roleFilteredPayload.integrityStatus.changed',
      },
    ] as const;

    for (const scenario of scenarios) {
      const { container, socket } = await connectClient();
      open(socket);
      deliver(socket, checkedHostTextV2(capabilities()));
      deliver(
        socket,
        checkedHostTextV2(
          snapshot({
            presentation: {
              ...snapshot().presentation,
              base: {
                ...snapshot().presentation.base,
                roleFilteredPayload: scenario.projection,
              },
            },
          }),
        ),
      );

      expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
      expect(container.querySelector('[data-host-field="bootState"]')).toBeNull();
      expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
      expect(decodedClientMessageV1(socket, 1)).toMatchObject({
        messageType: 'protocol.refusal',
        refusal: {
          code: 'INVALID_SHAPE',
          path: scenario.refusalPath,
        },
      });
    }
  });

  it('shows a checked v1 host refusal as a state distinct from disconnect', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    const refusal = {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal: { code: 'UNRECOGNIZED', path: '$.projectionRole', value: 'gm' },
      relatedCommandId: null,
    } as const satisfies HostToClientMessage;

    deliver(socket, checkedHostTextV1(refusal));

    expect(container.querySelector('[data-client-state="host-refusal"]')).not.toBeNull();
    expect(container.querySelector('[data-client-state="disconnected"]')).toBeNull();
    expect(container.textContent).toContain('UNRECOGNIZED');
    expect(socket.sent).toHaveLength(1);
    expect(socket.closeCalls).toContainEqual({ code: 1002, reason: 'wire frame refused' });
  });

  it('keeps the confirmed snapshot read-only after a connection loss', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);

    act(() => {
      socket.serverClose(1006, 'LAN link lost');
    });

    expect(container.querySelector('[data-client-state="disconnected"]')).not.toBeNull();
    expect(container.textContent).toContain('Последняя подтверждённая проекция');
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    const fieldset = requiredElement(container.querySelector('fieldset'), 'read-only fieldset');
    expect(fieldset.hasAttribute('disabled')).toBe(true);
    const buttons = [...fieldset.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.matches(':disabled'))).toBe(true);
  });

  it('refuses malformed text and preserves a prior snapshot read-only', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);

    deliver(socket, '{');

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'MALFORMED_JSON', path: '$' },
    });
  });

  it('refuses a binary frame instead of coercing it to text', async () => {
    const { container, socket } = await connectClient();
    open(socket);

    deliver(socket, new Uint8Array([1, 2, 3]));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: {
        code: 'INVALID_SHAPE',
        expected: 'text application frame',
        path: '$',
      },
    });
  });

  it.each([
    {
      expectedPath: '$.messageType',
      label: 'extra capability frame',
      send: (socket: FakeWebSocket) => {
        deliver(socket, checkedHostTextV2(capabilities()));
        deliver(socket, checkedHostTextV2(capabilities()));
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'intervening v1 frame',
      send: (socket: FakeWebSocket) => {
        deliver(socket, checkedHostTextV2(capabilities()));
        deliver(
          socket,
          checkedHostTextV1({
            messageType: 'protocol.refusal',
            protocolVersion: WIRE_PROTOCOL_VERSION,
            refusal: { code: 'UNRECOGNIZED', path: '$.deviceId', value: 'stale' },
            relatedCommandId: null,
          }),
        );
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'v2 frame before capabilities',
      send: (socket: FakeWebSocket) => {
        deliver(
          socket,
          checkedHostTextV2({
            messageType: 'navigation.form-action.refusal',
            navigationRequestId: 'intervening-navigation',
            presentationUnchanged: true,
            protocolVersion: WIRE_PROTOCOL_V2_VERSION,
            refusal: { code: 'NAVIGATION_UNAVAILABLE' },
            revisions: REVISIONS,
          }),
        );
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'v3 identity frame before capabilities',
      send: (socket: FakeWebSocket) => {
        deliver(
          socket,
          checkedHostTextV3({
            draftUpdateId: 'intervening-identity',
            messageType: 'character.identity-draft.refusal',
            presentationUnchanged: true,
            protocolVersion: WIRE_PROTOCOL_V3_VERSION,
            refusal: { code: 'DRAFT_UNAVAILABLE' },
            revisions: REVISIONS,
            scope: {
              characterDraftId: CHARACTER_DRAFT_ID,
              contextId: CONTEXT_ID,
              sourceFormId: 'CHR-001',
              wizardCheckpointId: WIZARD_CHECKPOINT_ID,
            },
          }),
        );
      },
    },
    {
      expectedPath: '$.presentation.assignment.correlationId',
      label: 'correlation mismatch',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            assignment: { correlationId: 'another-request', reason: 'RECONNECT' },
          },
        });
      },
    },
    {
      expectedPath: '$.presentation.assignment.reason',
      label: 'foreign assignment reason',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            assignment: { correlationId: REQUEST_ID, reason: 'FORM_ACTION' },
          },
        });
      },
    },
    {
      expectedPath: '$.revisions',
      label: 'revision mismatch',
      send: (socket: FakeWebSocket) => {
        deliverPair(socket, capabilities(), {
          ...snapshot(),
          revisions: { ...REVISIONS, projectionRevision: REVISIONS.projectionRevision + 1 },
        });
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'missing capability frame',
      send: (socket: FakeWebSocket) => deliver(socket, checkedHostTextV2(snapshot())),
    },
    {
      expectedPath: '$.projectionRole',
      label: 'non-null bootstrap role',
      send: (socket: FakeWebSocket) =>
        deliverPair(socket, capabilities(), { ...snapshot(), projectionRole: 'gm' }),
    },
    {
      expectedPath: null,
      label: 'read-only CHR-001 without a retained player context',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            base: chr001Base(),
          },
          projectionRole: 'player',
        });
      },
    },
    {
      expectedCode: 'INVALID_SHAPE' as const,
      expectedPath: '$.presentation.base.roleFilteredPayload.sex',
      label: 'CHR-001 projection without sex',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        const projection = Object.fromEntries(
          Object.entries(CHR_001_PROJECTION).filter(([key]) => key !== 'sex'),
        );
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: { ...value.presentation, base: chr001Base(projection) },
          projectionRole: 'player',
        });
      },
    },
    {
      expectedPath: '$.presentation.base.roleFilteredPayload.sex',
      label: 'CHR-001 projection with unknown sex',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            base: chr001Base({ ...CHR_001_PROJECTION, sex: 'OTHER' }),
          },
          projectionRole: 'player',
        });
      },
    },
    {
      expectedPath: null,
      label: 'partial action set',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            base: { ...value.presentation.base, availableActionKeys: APP_001_ACTION_KEYS.slice(1) },
          },
        });
      },
    },
  ])(
    'handles $label fail closed or as negative space',
    async ({ expectedCode, expectedPath, label, send }) => {
      const { container, socket } = await connectClient();
      open(socket);

      send(socket);

      if (expectedPath === null) {
        expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(
          label.startsWith('read-only') ? 1 : 3,
        );
        return;
      }
      expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
      expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
      expect(decodedClientMessageV1(socket, 1)).toMatchObject({
        messageType: 'protocol.refusal',
        refusal: { code: expectedCode ?? 'UNRECOGNIZED', path: expectedPath },
      });
    },
  );

  it.each([
    ['missing deviceId', Promise.resolve(identityResponse({}))],
    [
      'uppercase deviceId',
      Promise.resolve(identityResponse({ deviceId: DEVICE_ID.toUpperCase() })),
    ],
    ['malformed deviceId', Promise.resolve(identityResponse({ deviceId: 'not-a-uuid' }))],
    [
      'non-success HTTP response',
      Promise.resolve(
        identityResponse({ error: 'device identity unavailable: not initialized' }, 503),
      ),
    ],
    ['malformed JSON response', Promise.resolve(new Response('{', { status: 200 }))],
  ])('blocks the session on %s without generating a substitute', async (_label, response) => {
    const { container } = mountClient(response);
    await flushAsyncWork();

    expect(container.querySelector('[data-client-state="client-error"]')).not.toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(container.textContent).toMatch(/device identity|JSON/u);
    if (_label === 'non-success HTTP response') {
      expect(container.textContent).toContain('device identity unavailable: not initialized');
    }
  });

  it('discards staged capabilities when the socket closes before the snapshot', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliver(socket, checkedHostTextV2(capabilities()));

    act(() => socket.serverClose(1006, 'pair interrupted'));

    expect(container.querySelector('[data-client-state="disconnected"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
  });

  it('keeps a committed snapshot read-only when an extra capability arrives', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);
    deliver(socket, checkedHostTextV2(capabilities()));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
  });

  it('refuses a decoded v1 host message that the reconnect did not request', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    const unexpected = {
      messageType: 'read.result',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'unexpected-read',
      result: {},
      revisions: REVISIONS,
    } as const satisfies HostToClientMessage;

    deliver(socket, checkedHostTextV1(unexpected));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: '$.messageType', value: 'read.result' },
    });
  });

  it.each(['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const)(
    'sends the exact field-minimal ACCEPT_SET payload from %s',
    async (formId) => {
      const { container, socket } = await connectToWizardBase(setDecisionBase(formId), 6);
      expect(
        container.querySelector(
          `[data-host-field="${formId === 'CHR-005' ? 'acceptedSetReceiptId' : 'setReceiptId'}"]`,
        ),
      ).not.toBeNull();
      expect(
        container.querySelector(
          `[data-host-field="${formId === 'CHR-005' ? 'setReceiptId' : 'acceptedSetReceiptId'}"]`,
        ),
      ).toBeNull();

      act(() => {
        requiredElement(
          container.querySelector<HTMLButtonElement>(
            `[data-atlas-action-key="${formId}::CTA::001"]`,
          ),
          `${formId} accept action`,
        ).click();
      });
      const request = decodedClientMessageV1(socket, socket.sent.length - 1);
      expect(request).toMatchObject({
        messageType: 'command.request',
        workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
      });
      if (request.messageType !== 'command.request') throw new Error('missing accept command');
      expect(request.payload).toEqual({
        characterDraftId: CHARACTER_DRAFT_ID,
        decision: 'ACCEPT_SET',
        draftRevision: 6,
        sourceFormId: formId,
        stage: 'STAT_ROLLS',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      });
      expect(container.querySelector(`[data-atlas-action-key^="${formId}::CTA::"]`)).toBeNull();
    },
  );

  it('accepts an immutable set through exact result, replay and actionless signed CHR-009 boundary', async () => {
    const formId = 'CHR-005';
    const { container, socket } = await connectToWizardBase(setDecisionBase(formId), 6);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action-key="CHR-005::CTA::001"]'),
        'CHR-005 accept action',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing accept command');
    const receiptId = 'accepted-decision-receipt';
    const revisions = entityRevisions(7);
    const result = {
      acceptedSetReceiptId: DECISION_SET_RECEIPT_ID,
      assignmentMode: 'ROLLED_BIJECTION',
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 7,
      decision: 'ACCEPT_SET',
      draftRevision: 7,
      nextFormId: 'CHR-009',
      sourceFormId: formId,
      stage: 'STAT_ROLLS',
    } as const;
    deliver(
      socket,
      checkedHostTextV1(statSetDecisionTerminal(request.commandId, receiptId, result, revisions)),
    );
    deliver(
      socket,
      checkedHostTextV1(
        statSetDecisionTerminal(request.commandId, receiptId, result, revisions, true),
      ),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionPresentationSnapshot(
          request.commandId,
          'COMMAND_DESTINATION',
          setDecisionBase(
            formId,
            setDecisionProjection(formId, {
              commandId: request.commandId,
              decision: 'ACCEPT_SET',
              decisionReceiptIdOrNull: receiptId,
              draftRevision: 7,
            }),
          ),
          [],
          revisions,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-character-set-decision="ACCEPT_SET"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-009"]')).toBeNull();
    expect(container.querySelector('[data-atlas-action-key^="CHR-005::CTA::"]')).toBeNull();
  });

  it('opens CHR-028 as an unbound semantic top layer and CANCEL restores the unchanged set', async () => {
    const formId = 'CHR-005';
    const base = setDecisionBase(formId);
    const { container, socket } = await connectToWizardBase(base, 6);
    const { openRevisions } = openSetAbandonmentDialog(container, socket, formId, base, 6);
    const dialog = requiredElement(
      container.querySelector<HTMLDialogElement>('dialog[open][data-atlas-form-id="CHR-028"]'),
      'CHR-028 dialog',
    );
    expect(dialog.getAttribute('aria-labelledby')).toBe('CHR-028-title');
    const underlay = requiredElement(
      container.querySelector<HTMLElement>('main[data-atlas-form-id="CHR-005"]'),
      'CHR-005 underlay',
    ).closest('fieldset');
    expect(underlay?.hasAttribute('disabled')).toBe(true);
    expect(
      requiredElement(
        dialog.querySelector('[data-chr-028-decision]'),
        'CHR-028 role-filtered details',
      ).textContent,
    ).not.toMatch(/branchUuid|random|seed|Rule ID/u);

    act(() => {
      requiredElement(
        dialog.querySelector<HTMLButtonElement>('[data-atlas-action-key="CHR-028::CTA::002"]'),
        'CHR-028 cancel action',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing cancel command');
    expect(request.expectedRevisions).toEqual(openRevisions);
    expect(request.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      decision: 'CANCEL',
      draftRevision: 6,
      sourceFormId: 'CHR-028',
      stage: 'STAT_ROLLS',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    const receiptId = 'cancel-wire-receipt';
    const result = {
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 6,
      decision: 'CANCEL',
      decisionReceiptIdOrNull: null,
      draftRevision: 6,
      nextFormId: formId,
      originDecisionFormId: formId,
      sourceFormId: 'CHR-028',
      stage: 'STAT_ROLLS',
    } as const;
    deliver(
      socket,
      checkedHostTextV1(
        statSetDecisionTerminal(request.commandId, receiptId, result, openRevisions),
      ),
    );
    deliver(
      socket,
      checkedHostTextV1(
        statSetDecisionTerminal(request.commandId, receiptId, result, openRevisions, true),
      ),
    );
    const closedRevisions = { ...openRevisions, projectionRevision: 8 };
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionPresentationSnapshot(
          request.commandId,
          'COMMAND_DESTINATION',
          base,
          [],
          closedRevisions,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-028"]')).toBeNull();
    expect(container.querySelector('[data-character-set-decision="PENDING"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-005::CTA::002"]')).not.toBeNull();
  });

  it('refuses a CANCEL receipt whose branch ID collides with the current set receipt', async () => {
    const formId = 'CHR-005';
    const base = setDecisionBase(formId);
    const { container, socket } = await connectToWizardBase(base, 6);
    const { openRevisions } = openSetAbandonmentDialog(container, socket, formId, base, 6);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action-key="CHR-028::CTA::002"]'),
        'CHR-028 cancel action',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing cancel command');

    deliver(
      socket,
      checkedHostTextV1(
        statSetDecisionTerminal(
          request.commandId,
          'cancel-collision-receipt',
          {
            branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
            branchUuid: DECISION_SET_RECEIPT_ID,
            characterDraftId: CHARACTER_DRAFT_ID,
            checkpointId: WIZARD_CHECKPOINT_ID,
            checkpointOwnerId: CHARACTER_DRAFT_ID,
            checkpointRevision: 6,
            decision: 'CANCEL',
            decisionReceiptIdOrNull: null,
            draftRevision: 6,
            nextFormId: formId,
            originDecisionFormId: formId,
            sourceFormId: 'CHR-028',
            stage: 'STAT_ROLLS',
          },
          openRevisions,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessageV1(socket, socket.sent.length - 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { path: '$.receipt.result.branchUuid' },
    });
  });

  it('reconciles a lost transient CANCEL when reconnect restores the exact durable origin', async () => {
    const formId = 'CHR-005';
    const base = setDecisionBase(formId);
    const { container, socket } = await connectToWizardBase(base, 6);
    openSetAbandonmentDialog(container, socket, formId, base, 6);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action-key="CHR-028::CTA::002"]'),
        'CHR-028 cancel action',
      ).click();
    });
    const cancel = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (cancel.messageType !== 'command.request') throw new Error('missing cancel command');
    act(() => socket.serverClose(1006, 'host restarted before transient receipt'));
    act(() => {
      requiredElement(
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent === 'Переподключиться',
        ) ?? null,
        'reconnect button',
      ).click();
    });
    const resumedSocket = FakeWebSocket.instances.at(-1)!;
    open(resumedSocket);
    const reconnect = decodedClientMessageV2(resumedSocket, 0);
    if (reconnect.messageType !== 'session.reconnect') throw new Error('missing reconnect request');
    expect(reconnect.unacknowledgedCommandIds).toEqual([cancel.commandId]);
    const revisions = { actorVisibilityRevision: 0, projectionRevision: 8, stateRevision: 6 };
    deliverPair(
      resumedSocket,
      capabilities({ reconnectRequestId: reconnect.reconnectRequestId, revisions }),
      setDecisionPresentationSnapshot(
        reconnect.reconnectRequestId,
        'RECONNECT',
        base,
        [],
        revisions,
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-028"]')).toBeNull();
    expect(container.querySelector('[data-character-set-decision="PENDING"]')).not.toBeNull();
  });

  it('CONFIRM point-buy keeps an actionless CHR-028/COMMITTED layer and CHR-009 unpublished', async () => {
    const formId = 'CHR-005';
    const base = setDecisionBase(formId);
    const { container, socket } = await connectToWizardBase(base, 6);
    const { openRevisions } = openSetAbandonmentDialog(container, socket, formId, base, 6);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action-key="CHR-028::CTA::001"]'),
        'CHR-028 confirm action',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing confirm command');
    expect(request.expectedRevisions).toEqual(openRevisions);
    expect(request.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      decision: 'CONFIRM',
      draftRevision: 6,
      sourceFormId: 'CHR-028',
      stage: 'STAT_ROLLS',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    const receiptId = 'point-buy-decision-receipt';
    const consequences = abandonmentConsequences(formId, 1);
    const revisions = { actorVisibilityRevision: 0, projectionRevision: 8, stateRevision: 7 };
    const result = {
      abandonedSetReceiptIds: [DECISION_SET_RECEIPT_ID],
      alternateDecision: 'USE_POINT_BUY_90',
      assignmentModeOrNull: 'POINT_BUY_90',
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 7,
      decision: 'CONFIRM',
      draftRevision: 7,
      irreversibleConsequences: consequences,
      nextAttemptIndexOrNull: null,
      nextFormId: 'CHR-009',
      nextSetRollRequestIdOrNull: null,
      originDecisionFormId: formId,
      sourceFormId: 'CHR-028',
      sourceSetReceiptIdOrNull: null,
      stage: 'STAT_ROLLS',
      transitionKind: 'CLASSIC_TO_90',
    } as const;
    deliver(
      socket,
      checkedHostTextV1(statSetDecisionTerminal(request.commandId, receiptId, result, revisions)),
    );
    deliver(
      socket,
      checkedHostTextV1(
        statSetDecisionTerminal(request.commandId, receiptId, result, revisions, true),
      ),
    );
    const committedBase = setDecisionBase(
      formId,
      setDecisionProjection(formId, {
        commandId: request.commandId,
        decision: 'USE_POINT_BUY_90',
        decisionReceiptIdOrNull: receiptId,
        draftRevision: 7,
      }),
    );
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionPresentationSnapshot(
          request.commandId,
          'COMMAND_DESTINATION',
          committedBase,
          [
            chr028Layer(formId, {
              commandId: request.commandId,
              decision: 'CONFIRM',
              decisionReceiptIdOrNull: receiptId,
              draftRevision: 7,
            }),
          ],
          revisions,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-chr-028-decision="CONFIRM"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-009"]')).toBeNull();
    expect(container.querySelectorAll('[data-atlas-action-key]')).toHaveLength(0);
  });

  it('CONFIRM adventurous abandonment lands on the exact fresh CHR-003 attempt', async () => {
    const formId = 'CHR-006';
    const base = setDecisionBase(formId);
    const { container, socket } = await connectToWizardBase(base, 6);
    const { openRevisions } = openSetAbandonmentDialog(container, socket, formId, base, 6);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action-key="CHR-028::CTA::001"]'),
        'CHR-028 confirm action',
      ).click();
    });
    const request = decodedClientMessageV1(socket, socket.sent.length - 1);
    if (request.messageType !== 'command.request') throw new Error('missing confirm command');
    expect(request.expectedRevisions).toEqual(openRevisions);
    const receiptId = 'next-attempt-decision-receipt';
    const nextSetRollRequestId = 'set-roll-request-2';
    const consequences = abandonmentConsequences(formId, 1);
    const revisions = { actorVisibilityRevision: 0, projectionRevision: 8, stateRevision: 7 };
    const result = {
      abandonedSetReceiptIds: [DECISION_SET_RECEIPT_ID],
      alternateDecision: 'GO_ATTEMPT_2',
      assignmentModeOrNull: null,
      branchCacheHash: EMPTY_BRANCH_CACHE_HASH,
      branchUuid: BRANCH_UUID,
      characterDraftId: CHARACTER_DRAFT_ID,
      checkpointId: WIZARD_CHECKPOINT_ID,
      checkpointOwnerId: CHARACTER_DRAFT_ID,
      checkpointRevision: 7,
      decision: 'CONFIRM',
      draftRevision: 7,
      irreversibleConsequences: consequences,
      nextAttemptIndexOrNull: 2,
      nextFormId: 'CHR-003',
      nextSetRollRequestIdOrNull: nextSetRollRequestId,
      originDecisionFormId: formId,
      sourceFormId: 'CHR-028',
      sourceSetReceiptIdOrNull: null,
      stage: 'STAT_ROLLS',
      transitionKind: 'ADVENTUROUS_TO_SECOND',
    } as const;
    deliver(
      socket,
      checkedHostTextV1(statSetDecisionTerminal(request.commandId, receiptId, result, revisions)),
    );
    const nextProjection = {
      ...CHR_003_AUTO_PROJECTION,
      attemptIndex: 2,
      branchUuid: BRANCH_UUID,
      draftRevision: 7,
      setRollRequestId: nextSetRollRequestId,
      statMethod: 'ADVENTUROUS',
    } as const;
    deliver(
      socket,
      checkedHostTextV2(
        setDecisionPresentationSnapshot(
          request.commandId,
          'COMMAND_DESTINATION',
          chr003Base(nextProjection),
          [],
          revisions,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-003"]')).not.toBeNull();
    expect(container.querySelector('[data-host-field="attemptIndex"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-atlas-form-id="CHR-028"]')).toBeNull();
  });

  it('omits the CHR-008 warning capability and dialog path on mandatory attempt five', async () => {
    const formId = 'CHR-008';
    const projection = setDecisionProjection(formId, { attemptIndex: 5 });
    const { container } = await connectToWizardBase(setDecisionBase(formId, projection), 9);

    expect(container.querySelector('[data-fifth-attempt-mandatory-accept]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-008::CTA::001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="CHR-008::CTA::002"]')).toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-028"]')).toBeNull();
  });
});
