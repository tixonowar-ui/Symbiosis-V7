import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeClientMessage,
  decodeClientMessageV2,
  encodeHostMessageV2,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  HostToClientV2Message,
  JsonObject,
  ProjectionSnapshotV2Message,
  SessionReconnectCapabilitiesV2Message,
} from '@shared/index.js';

import { connectProjection, WEB_PROTOCOL_VOCABULARY } from './ws-client.js';
import type {
  CharacterSkillSelectionDraft,
  ProjectionConnection,
  WebClientState,
} from './ws-client.js';

const CHARACTER_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WIZARD_CHECKPOINT_ID = 'opaque-wizard-checkpoint';
const REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const;
const ADDITIVE_S = {
  entries: [{ delta: -2, statCode: 'S', statLabel: 'Сила' }],
  kind: 'ADDITIVE_STAT_MODIFIERS',
} as const;
const NO_STAT_MODIFIERS = { kind: 'NO_STAT_MODIFIERS' } as const;
const UNITED_MODE_OPTIONS = [
  {
    modeConsequences: {
      baseSymbiontSlots: 4,
      raceChoice: 'UNITED',
      raceLabel: 'Единый',
      statModifiers: ADDITIVE_S,
    },
    symbiontAcquisitionMode: 'MANUAL',
  },
  {
    modeConsequences: {
      baseSymbiontSlots: 4,
      raceChoice: 'UNITED',
      raceLabel: 'Единый',
      statModifiers: ADDITIVE_S,
    },
    symbiontAcquisitionMode: 'RANDOM',
  },
] as const;
const FREE_MODE_OPTIONS = [
  {
    modeConsequences: {
      baseSymbiontSlots: 1,
      raceChoice: 'FREE',
      raceLabel: 'Вольный',
      statModifiers: ADDITIVE_S,
    },
    symbiontAcquisitionMode: 'MANUAL',
  },
  {
    modeConsequences: {
      baseSymbiontSlots: 1,
      raceChoice: 'FREE',
      raceLabel: 'Вольный',
      statModifiers: NO_STAT_MODIFIERS,
    },
    symbiontAcquisitionMode: 'RANDOM',
  },
] as const;
const RACE_CONSEQUENCE_OPTIONS = [
  {
    raceChoice: 'UNITED',
    raceConsequencesPreview: {
      allocationXpMultiplier: 1,
      baseSymbiontSlots: 4,
      classPolicy: 'NO_CLASS',
      directXpMultiplier: 1,
      raceLabel: 'Единый',
      raceStatModifiersByAcquisitionMode: {
        alternatives: UNITED_MODE_OPTIONS,
        kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
      },
      symbiontXpPolicy: 'STANDARD_XP_AWARD',
      symbioticMonsterAllowed: true,
    },
  },
  {
    raceChoice: 'FREE',
    raceConsequencesPreview: {
      allocationXpMultiplier: 2,
      baseSymbiontSlots: 1,
      classPolicy: 'NO_CLASS',
      directXpMultiplier: 2,
      raceLabel: 'Вольный',
      raceStatModifiersByAcquisitionMode: {
        alternatives: FREE_MODE_OPTIONS,
        kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
      },
      symbiontXpPolicy: 'XP_AWARD_X2',
      symbioticMonsterAllowed: false,
    },
  },
  {
    raceChoice: 'PURE',
    raceConsequencesPreview: {
      allocationXpMultiplier: 1,
      baseSymbiontSlots: 0,
      classPolicy: 'REQUIRED_PURE_CLASS',
      directXpMultiplier: 1,
      raceLabel: 'Чистый',
      raceStatModifiersByAcquisitionMode: { kind: 'NOT_APPLICABLE' },
      symbiontXpPolicy: 'STANDARD_XP_AWARD',
      symbioticMonsterAllowed: false,
    },
  },
] as const;
const REJECTED_SET = {
  creationCriticalConsequencesDiscarded: true,
  irreversible: true,
  setValuesDiscarded: true,
} as const;
const METHOD_CONSEQUENCE_OPTIONS = [
  {
    methodConsequences: {
      maximumAttempts: 1,
      rejectedSet: REJECTED_SET,
      terminalRule: { afterAttempt: 1, exactTotal: 90, kind: 'POINT_BUY_AFTER_REJECTION' },
    },
    statMethod: 'CLASSIC',
  },
  {
    methodConsequences: {
      maximumAttempts: 2,
      rejectedSet: REJECTED_SET,
      terminalRule: { afterAttempt: 2, exactTotal: 85, kind: 'POINT_BUY_AFTER_REJECTION' },
    },
    statMethod: 'ADVENTUROUS',
  },
  {
    methodConsequences: {
      maximumAttempts: 5,
      rejectedSet: REJECTED_SET,
      terminalRule: { attemptIndex: 5, kind: 'MANDATORY_ACCEPT' },
    },
    statMethod: 'ALL_OR_NOTHING',
  },
] as const;
const CHR_010_PROJECTION = {
  ancientOptionSerialized: false,
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  draftRevision: 0,
  raceChoice: null,
  raceConsequenceOptions: RACE_CONSEQUENCE_OPTIONS,
  raceConsequencesPreview: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const CHR_016_PROJECTION = {
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  draftRevision: 1,
  modeConsequenceOptions: UNITED_MODE_OPTIONS,
  modeConsequences: null,
  raceChoice: 'UNITED',
  symbiontAcquisitionMode: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const CHR_002_PROJECTION = {
  characterDraftId: CHARACTER_DRAFT_ID,
  choiceLockStatus: 'UNLOCKED',
  commandId: null,
  draftRevision: 3,
  methodConsequenceOptions: METHOD_CONSEQUENCE_OPTIONS,
  methodConsequences: null,
  statMethod: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;

class DecoderFakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: DecoderFakeWebSocket[] = [];

  readonly sent: string[] = [];
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onopen: WebSocket['onopen'] = null;
  readyState = DecoderFakeWebSocket.CONNECTING;

  constructor(_url: string | URL) {
    DecoderFakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = DecoderFakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = DecoderFakeWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  message(data: string): void {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data }));
  }

  serverClose(code: number, reason: string): void {
    this.readyState = DecoderFakeWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code, reason }));
  }
}

const decoderConnections: ProjectionConnection[] = [];

afterEach(() => {
  for (const connection of decoderConnections.splice(0)) connection.disconnect();
  DecoderFakeWebSocket.instances.splice(0);
  vi.unstubAllGlobals();
});

function checkedHostTextV2(message: HostToClientV2Message): string {
  const encoded = encodeHostMessageV2(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) throw new Error(`invalid host fixture: ${JSON.stringify(encoded.refusal)}`);
  return encoded.text;
}

// skills.json owns the 41-card cardinality. The remaining values below are a synthetic,
// internally signed protocol fixture; host tests separately assert CORE-081/165/167 values.
const DECODER_SKILL_STATS = { C: 8, D: 8, I: 8, M: 8, S: 8, W: 4, Z: 8 } as const;
const DECODER_SKILL_CARDS = Array.from({ length: 41 }, (_, index) => {
  const ordinal = String(index + 1).padStart(2, '0');
  const ineligible = index === 1;
  return {
    eligibility: ineligible ? ('REQUIREMENTS_NOT_MET' as const) : ('ELIGIBLE' as const),
    levelOptions: [
      { slotCost: 1, targetBonus: 1 },
      { slotCost: 2, targetBonus: 2 },
    ],
    requirements: [
      {
        currentValue: 4,
        minValue: ineligible ? 5 : 1,
        satisfied: !ineligible,
        statCode: 'W' as const,
        statLabel: 'Мудрость',
      },
    ],
    skillId: `SKILL_${ordinal}`,
    skillLabel: `Навык ${ordinal}`,
  };
});
const DECODER_ELIGIBLE_SKILL_IDS = DECODER_SKILL_CARDS.filter(
  ({ eligibility }) => eligibility === 'ELIGIBLE',
).map(({ skillId }) => skillId);
const DECODER_SKILL_OPTIONS = DECODER_SKILL_CARDS.filter(
  ({ eligibility }) => eligibility === 'ELIGIBLE',
).map(({ levelOptions, skillId, skillLabel }) => ({ levelOptions, skillId, skillLabel }));
const DECODER_CHR_013_PROJECTION = {
  characterDraftId: CHARACTER_DRAFT_ID,
  commandId: null,
  draftRevision: 9,
  eligibleSkillIds: DECODER_ELIGIBLE_SKILL_IDS,
  selectedSkillIdOrNull: null,
  skillCardSummaries: DECODER_SKILL_CARDS,
  skillStageStats: DECODER_SKILL_STATS,
  slotSources: {
    mandatoryClassSkillOrNull: null,
    racialFreeSkills: [],
    requiredSlotCount: 2,
  },
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;

function decoderSelectionValidation(requiredSlotCount: number, usedSlotCount: number) {
  if (usedSlotCount < requiredSlotCount) {
    return {
      kind: 'UNDERFILLED' as const,
      missingSlotCount: requiredSlotCount - usedSlotCount,
      requiredSlotCount,
      usedSlotCount,
    };
  }
  if (usedSlotCount > requiredSlotCount) {
    return {
      excessSlotCount: usedSlotCount - requiredSlotCount,
      kind: 'OVERFILLED' as const,
      requiredSlotCount,
      usedSlotCount,
    };
  }
  return { kind: 'EXACT' as const, requiredSlotCount, usedSlotCount };
}

function decoderChr015Projection(
  selectedSkills: readonly {
    readonly skillId: string;
    readonly slotCost: number;
    readonly targetBonus: number;
  }[] = [],
  commandId: string | null = null,
) {
  const options = new Map(DECODER_SKILL_OPTIONS.map((option) => [option.skillId, option]));
  const entries = selectedSkills.map((selected) => ({
    bonus: selected.targetBonus,
    skillId: selected.skillId,
    skillLabel: options.get(selected.skillId)?.skillLabel ?? 'forged',
    slotCost: selected.slotCost,
    source: 'SELECTED' as const,
  }));
  const usedSlotCount = entries.reduce((sum, entry) => sum + entry.slotCost, 0);
  return {
    characterDraftId: CHARACTER_DRAFT_ID,
    commandId,
    draftRevision: 9,
    eligibleSkillIds: DECODER_ELIGIBLE_SKILL_IDS,
    mandatoryClassSkillOrNull: null,
    paidSlotUsage: { entries, usedSlotCount },
    racialFreeSkillIds: [],
    racialFreeSkills: [],
    requiredSlotCount: 2,
    selectedSkillIds: selectedSkills.map(({ skillId }) => skillId),
    selectedSkills,
    selectionValidation: decoderSelectionValidation(2, usedSlotCount),
    skillOptions: DECODER_SKILL_OPTIONS,
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  } as const;
}

type DecoderFormId = 'CHR-002' | 'CHR-010' | 'CHR-013' | 'CHR-015' | 'CHR-016';

function projectionBase(
  formId: DecoderFormId,
  projection: JsonObject,
): ProjectionSnapshotV2Message['presentation']['base'] {
  const actions =
    formId === 'CHR-010'
      ? (['CHR-010::CTA::004', 'CHR-010::CTA::005', 'CHR-010::CTA::006'] as const)
      : formId === 'CHR-016'
        ? (['CHR-016::CTA::003', 'CHR-016::CTA::004'] as const)
        : formId === 'CHR-013'
          ? (['CHR-013::CTA::002'] as const)
          : formId === 'CHR-015'
            ? projection['commandId'] === null
              ? (['CHR-015::CTA::003'] as const)
              : ([] as const)
            : (['CHR-002::CTA::003', 'CHR-002::CTA::004', 'CHR-002::CTA::005'] as const);
  return {
    availableActionKeys: actions,
    formId,
    formType: 'screen',
    roleFilteredPayload: projection,
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
    routeTemplate: `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
  };
}

interface DecoderHarness {
  readonly connection: ProjectionConnection;
  readonly skillDrafts: readonly (CharacterSkillSelectionDraft | null)[];
  readonly socket: DecoderFakeWebSocket;
  readonly states: readonly WebClientState[];
}

async function connectDecoderFixture(
  formId: DecoderFormId,
  projection: JsonObject,
): Promise<DecoderHarness> {
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ deviceId: '123e4567-e89b-42d3-a456-426614174000' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    ),
  );
  vi.stubGlobal('WebSocket', DecoderFakeWebSocket);
  const states: WebClientState[] = [];
  const skillDrafts: (CharacterSkillSelectionDraft | null)[] = [];
  const connection = connectProjection(
    (state) => states.push(state),
    undefined,
    undefined,
    undefined,
    undefined,
    (draft) => skillDrafts.push(draft),
  );
  decoderConnections.push(connection);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const socket = DecoderFakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('decoder test socket was not created');
  socket.open();
  const reconnectText = socket.sent[0];
  if (reconnectText === undefined) throw new Error('decoder test reconnect was not sent');
  const reconnect = decodeClientMessageV2(reconnectText, WEB_PROTOCOL_VOCABULARY);
  if (!reconnect.ok || reconnect.value.messageType !== 'session.reconnect') {
    throw new Error('decoder test reconnect did not decode');
  }
  const capabilities: SessionReconnectCapabilitiesV2Message = {
    executableWorkflowCommandIds: [
      'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      'UI-CMD-CHAR-CREATION-SET-DECIDE',
      'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    ],
    messageType: 'session.reconnect.capabilities',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: reconnect.value.reconnectRequestId,
    revisions: REVISIONS,
  };
  const snapshot: ProjectionSnapshotV2Message = {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId: reconnect.value.reconnectRequestId, reason: 'RECONNECT' },
      base: projectionBase(formId, projection),
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: REVISIONS,
  };
  socket.message(checkedHostTextV2(capabilities));
  socket.message(checkedHostTextV2(snapshot));
  return { connection, skillDrafts, socket, states };
}

async function decodeProjectionFixture(
  formId: DecoderFormId,
  projection: JsonObject,
): Promise<WebClientState> {
  const { states } = await connectDecoderFixture(formId, projection);
  const finalState = states.at(-1);
  if (finalState === undefined) throw new Error('decoder test emitted no state');
  return finalState;
}

function mutableProjection(source: JsonObject): Record<string, unknown> {
  return structuredClone(source);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`fixture ${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`fixture ${label} is not an array`);
  return value;
}

type ConsequenceFormId = 'CHR-002' | 'CHR-010' | 'CHR-016';

function validProjection(formId: ConsequenceFormId): JsonObject {
  switch (formId) {
    case 'CHR-010':
      return CHR_010_PROJECTION;
    case 'CHR-016':
      return CHR_016_PROJECTION;
    case 'CHR-002':
      return CHR_002_PROJECTION;
  }
}

function optionAt(projection: Record<string, unknown>, key: string, index: number) {
  return objectValue(arrayValue(projection[key], key)[index], `${key}[${String(index)}]`);
}

function racePreviewAt(projection: Record<string, unknown>, index: number) {
  return objectValue(
    optionAt(projection, 'raceConsequenceOptions', index)['raceConsequencesPreview'],
    `raceConsequenceOptions[${String(index)}].raceConsequencesPreview`,
  );
}

function nestedModeAt(projection: Record<string, unknown>, raceIndex: number, modeIndex: number) {
  const conditional = objectValue(
    racePreviewAt(projection, raceIndex)['raceStatModifiersByAcquisitionMode'],
    'raceStatModifiersByAcquisitionMode',
  );
  return objectValue(
    arrayValue(conditional['alternatives'], 'alternatives')[modeIndex],
    `alternatives[${String(modeIndex)}]`,
  );
}

describe('decision consequence projection decoder', () => {
  it.each([
    ['CHR-010', 'raceConsequenceOptions'],
    ['CHR-016', 'modeConsequenceOptions'],
    ['CHR-002', 'methodConsequenceOptions'],
  ] as const)('rejects %s when %s is missing', async (formId, key) => {
    const projection = mutableProjection(validProjection(formId));
    delete projection[key];
    const state = await decodeProjectionFixture(formId, projection as JsonObject);
    expect(state).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        code: 'UNRECOGNIZED',
        path: `$.presentation.base.roleFilteredPayload.${key}`,
      },
    });
  });

  it.each([
    ['CHR-010', 'raceConsequenceOptions', 'raceChoice'],
    ['CHR-016', 'modeConsequenceOptions', 'symbiontAcquisitionMode'],
    ['CHR-002', 'methodConsequenceOptions', 'statMethod'],
  ] as const)('rejects non-canonical %s option order', async (formId, key, discriminator) => {
    const projection = mutableProjection(validProjection(formId));
    arrayValue(projection[key], key).reverse();
    const state = await decodeProjectionFixture(formId, projection as JsonObject);
    expect(state).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        code: 'UNRECOGNIZED',
        path: `$.presentation.base.roleFilteredPayload.${key}[0].${discriminator}`,
      },
    });
  });

  it.each(['ruleId', 'modifierId', 'sourceType', 'questionId'] as const)(
    'rejects private %s provenance nested in a player option',
    async (key) => {
      const projection = mutableProjection(CHR_010_PROJECTION);
      racePreviewAt(projection, 0)[key] = ['private', key].join('-');
      const state = await decodeProjectionFixture('CHR-010', projection as JsonObject);
      expect(state).toMatchObject({
        kind: 'protocol-error',
        refusal: {
          code: 'UNRECOGNIZED',
          path: `$.presentation.base.roleFilteredPayload.raceConsequenceOptions[0].raceConsequencesPreview.${key}`,
        },
      });
    },
  );

  it('rejects a malformed player-visible modifier label', async () => {
    const projection = mutableProjection(CHR_010_PROJECTION);
    const modeConsequences = objectValue(
      nestedModeAt(projection, 0, 0)['modeConsequences'],
      'modeConsequences',
    );
    const statModifiers = objectValue(modeConsequences['statModifiers'], 'statModifiers');
    const firstEntry = objectValue(
      arrayValue(statModifiers['entries'], 'entries')[0],
      'entries[0]',
    );
    firstEntry['statLabel'] = '   ';
    const state = await decodeProjectionFixture('CHR-010', projection as JsonObject);
    expect(state.kind).toBe('protocol-error');
    if (state.kind !== 'protocol-error') throw new Error('expected malformed label refusal');
    expect(state.refusal).toMatchObject({ code: 'UNRECOGNIZED' });
    expect(state.refusal.path).toContain('.statModifiers.entries[0].statLabel');
  });

  it('accepts a source-backed zero additive modifier without a client-owned gameplay rule', async () => {
    const projection = mutableProjection(CHR_010_PROJECTION);
    const modeConsequences = objectValue(
      nestedModeAt(projection, 0, 0)['modeConsequences'],
      'modeConsequences',
    );
    const statModifiers = objectValue(modeConsequences['statModifiers'], 'statModifiers');
    const firstEntry = objectValue(
      arrayValue(statModifiers['entries'], 'entries')[0],
      'entries[0]',
    );
    firstEntry['delta'] = 0;

    const state = await decodeProjectionFixture('CHR-010', projection as JsonObject);
    expect(state.kind).toBe('ready');
  });

  it('rejects an invented FREE RANDOM additive branch', async () => {
    const projection = mutableProjection(CHR_010_PROJECTION);
    const modeConsequences = objectValue(
      nestedModeAt(projection, 1, 1)['modeConsequences'],
      'FREE RANDOM modeConsequences',
    );
    modeConsequences['statModifiers'] = structuredClone(ADDITIVE_S);
    const state = await decodeProjectionFixture('CHR-010', projection as JsonObject);
    expect(state.kind).toBe('protocol-error');
    if (state.kind !== 'protocol-error') throw new Error('expected FREE RANDOM branch refusal');
    expect(state.refusal).toMatchObject({
      code: 'UNRECOGNIZED',
      value: 'ADDITIVE_STAT_MODIFIERS',
    });
    expect(state.refusal.path).toContain('.modeConsequences.statModifiers.kind');
  });

  it.each([
    ['PURE', 2, 0],
    ['UNITED', 0, 2],
  ] as const)(
    'rejects %s with the other race kind of acquisition-mode conditional',
    async (_raceChoice, targetIndex, sourceIndex) => {
      const projection = mutableProjection(CHR_010_PROJECTION);
      racePreviewAt(projection, targetIndex)['raceStatModifiersByAcquisitionMode'] =
        structuredClone(
          racePreviewAt(projection, sourceIndex)['raceStatModifiersByAcquisitionMode'],
        );
      const state = await decodeProjectionFixture('CHR-010', projection as JsonObject);
      expect(state.kind).toBe('protocol-error');
      if (state.kind !== 'protocol-error') throw new Error('expected mixed race branch refusal');
      expect(state.refusal).toMatchObject({ code: 'UNRECOGNIZED' });
      expect(state.refusal.path).toContain(
        `.raceConsequenceOptions[${String(targetIndex)}].raceConsequencesPreview.raceStatModifiersByAcquisitionMode`,
      );
    },
  );

  it('rejects CHR-016 options for a different committed race branch', async () => {
    const projection = mutableProjection(CHR_016_PROJECTION);
    const modeConsequences = objectValue(
      optionAt(projection, 'modeConsequenceOptions', 0)['modeConsequences'],
      'modeConsequenceOptions[0].modeConsequences',
    );
    modeConsequences['raceChoice'] = 'FREE';
    const state = await decodeProjectionFixture('CHR-016', projection as JsonObject);
    expect(state).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.presentation.base.roleFilteredPayload.modeConsequenceOptions[0].modeConsequences.raceChoice',
      },
    });
  });

  it('rejects a method terminal rule that contradicts maximumAttempts', async () => {
    const projection = mutableProjection(CHR_002_PROJECTION);
    const methodConsequences = objectValue(
      optionAt(projection, 'methodConsequenceOptions', 0)['methodConsequences'],
      'methodConsequenceOptions[0].methodConsequences',
    );
    const terminalRule = objectValue(methodConsequences['terminalRule'], 'terminalRule');
    terminalRule['afterAttempt'] = 2;
    const state = await decodeProjectionFixture('CHR-002', projection as JsonObject);
    expect(state).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.presentation.base.roleFilteredPayload.methodConsequenceOptions[0].methodConsequences.terminalRule.afterAttempt',
      },
    });
  });
});

describe('SKILLS projection decoder and local draft', () => {
  it.each([
    ['CHR-013', DECODER_CHR_013_PROJECTION],
    ['CHR-015', decoderChr015Projection()],
  ] as const)('accepts the exact %s player projection', async (formId, projection) => {
    const state = await decodeProjectionFixture(formId, projection);
    expect(state.kind).toBe('ready');
  });

  it('rejects missing, extra, internal-id, and contradictory CHR-013 fields', async () => {
    const missing = mutableProjection(DECODER_CHR_013_PROJECTION);
    delete missing['selectedSkillIdOrNull'];
    expect(await decodeProjectionFixture('CHR-013', missing as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.selectedSkillIdOrNull' },
    });

    const extra = mutableProjection(DECODER_CHR_013_PROJECTION);
    extra['requirementId'] = 'REQ-001';
    expect(await decodeProjectionFixture('CHR-013', extra as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.requirementId' },
    });

    const internal = mutableProjection(DECODER_CHR_013_PROJECTION);
    optionAt(internal, 'skillCardSummaries', 0)['skillId'] = 'SKL-001';
    expect(await decodeProjectionFixture('CHR-013', internal as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.skillCardSummaries[0].skillId',
      },
    });

    const contradictory = mutableProjection(DECODER_CHR_013_PROJECTION);
    optionAt(contradictory, 'skillCardSummaries', 1)['eligibility'] = 'ELIGIBLE';
    expect(await decodeProjectionFixture('CHR-013', contradictory as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.skillCardSummaries[1].eligibility',
      },
    });
  });

  it('rejects non-canonical selections and values absent from signed levelOptions', async () => {
    const nonCanonical = decoderChr015Projection(
      [
        { skillId: 'SKILL_03', slotCost: 1, targetBonus: 1 },
        { skillId: 'SKILL_01', slotCost: 1, targetBonus: 1 },
      ],
      'terminal-command',
    );
    expect(await decodeProjectionFixture('CHR-015', nonCanonical)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.selectedSkills[1].skillId' },
    });

    const forgedLevel = decoderChr015Projection(
      [{ skillId: 'SKILL_01', slotCost: 3, targetBonus: 3 }],
      'terminal-command',
    );
    expect(await decodeProjectionFixture('CHR-015', forgedLevel)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.selectedSkills[0].skillId' },
    });
  });

  it('cross-checks the CHR-013 to CHR-015 signed option join', async () => {
    const { connection, socket, states } = await connectDecoderFixture(
      'CHR-013',
      DECODER_CHR_013_PROJECTION,
    );
    expect(connection.requestFormAction('CHR-013::CTA::002')).toEqual({ ok: true });
    const requestText = socket.sent.at(-1);
    if (requestText === undefined) throw new Error('missing CHR-013 form action');
    const request = decodeClientMessageV2(requestText, WEB_PROTOCOL_VOCABULARY);
    if (!request.ok || request.value.messageType !== 'navigation.form-action') {
      throw new Error('invalid CHR-013 form action');
    }
    const destination = mutableProjection(decoderChr015Projection());
    optionAt(destination, 'skillOptions', 0)['skillLabel'] = 'Подменённая подпись';
    socket.message(
      checkedHostTextV2({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: {
            correlationId: request.value.navigationRequestId,
            reason: 'FORM_ACTION',
          },
          base: projectionBase('CHR-015', destination as JsonObject),
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        revisions: { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 0 },
      }),
    );

    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.skillOptions' },
    });
  });

  it('keeps toggles wire-free and canonical, rejects unsigned candidates, and checkpoints only EXACT', async () => {
    const { connection, skillDrafts, socket, states } = await connectDecoderFixture(
      'CHR-015',
      decoderChr015Projection(),
    );
    const wireCount = socket.sent.length;
    expect(connection.requestFormAction('CHR-015::CTA::001').ok).toBe(false);
    expect(connection.replaceSkillSelectionCandidate('SKILL_01', 3)).toEqual({
      detail: 'target bonus is absent from signed levelOptions',
      ok: false,
    });
    expect(connection.replaceSkillSelectionCandidate('SKILL_03', 1)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-015::CTA::003')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount);
    expect(skillDrafts.at(-1)?.selectionValidation.kind).toBe('UNDERFILLED');

    expect(connection.replaceSkillSelectionCandidate('SKILL_01', 1)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-015::CTA::003')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount);
    expect(skillDrafts.at(-1)?.selectedSkillIds).toEqual(['SKILL_01', 'SKILL_03']);
    expect(skillDrafts.at(-1)?.selectionValidation.kind).toBe('EXACT');
    const exactState = states.at(-1);
    expect(exactState?.kind).toBe('ready');
    if (exactState?.kind !== 'ready') throw new Error('missing exact local state');
    expect(exactState.snapshot.revisions).toEqual(REVISIONS);
    expect(exactState.snapshot.availableActionKeys).toContain('CHR-015::CTA::001');

    expect(connection.replaceSkillSelectionCandidate('SKILL_04', 1)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-015::CTA::003')).toEqual({ ok: true });
    expect(skillDrafts.at(-1)?.selectionValidation).toMatchObject({
      excessSlotCount: 1,
      kind: 'OVERFILLED',
    });
    expect(connection.requestFormAction('CHR-015::CTA::001').ok).toBe(false);
    expect(socket.sent).toHaveLength(wireCount);

    expect(connection.replaceSkillSelectionCandidate('SKILL_04', 1)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-015::CTA::003')).toEqual({ ok: true });
    expect(skillDrafts.at(-1)?.selectionValidation.kind).toBe('EXACT');
    expect(connection.requestFormAction('CHR-015::CTA::001')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount + 1);
    const commandText = socket.sent.at(-1);
    if (commandText === undefined) throw new Error('missing skill checkpoint');
    const command = decodeClientMessage(commandText, WEB_PROTOCOL_VOCABULARY);
    if (!command.ok || command.value.messageType !== 'command.request') {
      throw new Error('invalid skill checkpoint');
    }
    expect(command.value.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      draftRevision: 9,
      selectedSkills: [
        { skillId: 'SKILL_01', targetBonus: 1 },
        { skillId: 'SKILL_03', targetBonus: 1 },
      ],
      sourceFormId: 'CHR-015',
      stage: 'SKILLS',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
  });

  it('discards the local CHR-015 overlay when reconnect restores the durable snapshot', async () => {
    const { connection, skillDrafts, socket } = await connectDecoderFixture(
      'CHR-015',
      decoderChr015Projection(),
    );
    expect(connection.replaceSkillSelectionCandidate('SKILL_01', 1)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-015::CTA::003')).toEqual({ ok: true });
    expect(skillDrafts.at(-1)?.selectedSkillIds).toEqual(['SKILL_01']);
    socket.serverClose(1006, 'overlay lost');
    expect(connection.reconnect()).toEqual({ ok: true });
    const resumedSocket = DecoderFakeWebSocket.instances.at(-1);
    if (resumedSocket === undefined) throw new Error('missing resumed socket');
    resumedSocket.open();
    const reconnectText = resumedSocket.sent[0];
    if (reconnectText === undefined) throw new Error('missing reconnect request');
    const reconnect = decodeClientMessageV2(reconnectText, WEB_PROTOCOL_VOCABULARY);
    if (!reconnect.ok || reconnect.value.messageType !== 'session.reconnect') {
      throw new Error('invalid reconnect request');
    }
    const capabilities: SessionReconnectCapabilitiesV2Message = {
      executableWorkflowCommandIds: [
        'UI-CMD-CHAR-WIZARD-CHECKPOINT',
        'UI-CMD-CHAR-CREATION-SET-DECIDE',
        'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
      ],
      messageType: 'session.reconnect.capabilities',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: reconnect.value.reconnectRequestId,
      revisions: REVISIONS,
    };
    const snapshot: ProjectionSnapshotV2Message = {
      messageType: 'projection.snapshot',
      presentation: {
        assignment: {
          correlationId: reconnect.value.reconnectRequestId,
          reason: 'RECONNECT',
        },
        base: projectionBase('CHR-015', decoderChr015Projection()),
        layers: [],
      },
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      revisions: REVISIONS,
    };
    resumedSocket.message(checkedHostTextV2(capabilities));
    resumedSocket.message(checkedHostTextV2(snapshot));

    expect(skillDrafts.at(-1)?.selectedSkillIds).toEqual([]);
    expect(skillDrafts.at(-1)?.selectionValidation.kind).toBe('UNDERFILLED');
  });
});

describe('APP-004 web protocol vocabulary', () => {
  it('accepts only the exact unbound APP-004 route shape', () => {
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('APP-004', 'screen', '/player/characters', []),
    ).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm('APP-004', 'screen', '/player', [])).toBe(false);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('APP-004', 'screen', '/player/characters', [
        { parameterIndex: 0, source: 'executor-allocated', value: 'character' },
      ]),
    ).toBe(false);
  });

  it('recognizes source-declared APP-004 keys without inventing another key', () => {
    for (let index = 1; index <= 8; index += 1) {
      const actionKey = `APP-004::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('APP-004', actionKey), actionKey).toBe(true);
    }
    expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('APP-004', 'APP-004::CTA::009')).toBe(false);
  });
});

describe('CHR-010 web protocol vocabulary', () => {
  it('accepts only the inherited character binding and exact route', () => {
    const binding = [
      {
        parameterIndex: 0,
        source: 'inherited' as const,
        value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        binding,
      ),
    ).toBe(true);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm(
        'CHR-010',
        'screen',
        '/player/characters/:localCharacterId/create/chr-010',
        [{ ...binding[0]!, source: 'executor-allocated' }],
      ),
    ).toBe(false);
  });

  it('recognizes six source actions and only the two implemented workflow commands', () => {
    for (let index = 1; index <= 6; index += 1) {
      const actionKey = `CHR-010::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey('CHR-010', actionKey), actionKey).toBe(true);
    }
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CHAR-WIZARD-CHECKPOINT')).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CHAR-CREATION-SET-DECIDE')).toBe(
      true,
    );
    expect(WEB_PROTOCOL_VOCABULARY.isWorkflowCommandId('UI-CMD-CAMPAIGN-CREATE')).toBe(false);
  });
});

describe('SET-DECIDE web protocol vocabulary', () => {
  const binding = [
    {
      parameterIndex: 0,
      source: 'inherited' as const,
      value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ];

  it.each([
    ['CHR-016', '/player/characters/:localCharacterId/create/chr-016', 4],
    ['CHR-036', '/player/characters/:localCharacterId/create/chr-036', 5],
    ['CHR-002', '/player/characters/:localCharacterId/create/chr-002', 5],
  ] as const)(
    'accepts only the exact inherited %s route and source actions',
    (formId, route, count) => {
      expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, binding)).toBe(true);
      expect(
        WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, [
          { ...binding[0]!, source: 'executor-allocated' },
        ]),
      ).toBe(false);
      for (let index = 1; index <= count; index += 1) {
        const actionKey = `${formId}::CTA::${String(index).padStart(3, '0')}`;
        expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey(formId, actionKey), actionKey).toBe(true);
      }
      expect(
        WEB_PROTOCOL_VOCABULARY.isFormActionKey(
          formId,
          `${formId}::CTA::${String(count + 1).padStart(3, '0')}`,
        ),
      ).toBe(false);
    },
  );
});

describe('STAT_ROLLS set-decision web protocol vocabulary', () => {
  const binding = [
    {
      parameterIndex: 0,
      source: 'inherited' as const,
      value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ];

  it.each(['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const)(
    'accepts only the inherited %s screen route',
    (formId) => {
      expect(
        WEB_PROTOCOL_VOCABULARY.isPresentedForm(
          formId,
          'screen',
          `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
          binding,
        ),
      ).toBe(true);
      expect(
        WEB_PROTOCOL_VOCABULARY.isPresentedForm(
          formId,
          'screen',
          `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
          [],
        ),
      ).toBe(false);
    },
  );

  it('accepts CHR-028 only as an unbound dialog', () => {
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('CHR-028', 'dialog', '@dialog/chr-028', []),
    ).toBe(true);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('CHR-028', 'screen', '@dialog/chr-028', []),
    ).toBe(false);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm('CHR-028', 'dialog', '@dialog/chr-028', binding),
    ).toBe(false);
  });
});

describe('STAT_ASSIGNMENT web protocol vocabulary', () => {
  const binding = [
    {
      parameterIndex: 0,
      source: 'inherited' as const,
      value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ];

  it.each([
    ['CHR-009', 3],
    ['CHR-011', 5],
    ['CHR-012', 3],
  ] as const)('accepts only the inherited %s route and source actions', (formId, count) => {
    const route = `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`;
    expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, binding)).toBe(true);
    expect(WEB_PROTOCOL_VOCABULARY.isPresentedForm(formId, 'screen', route, [])).toBe(false);
    for (let index = 1; index <= count; index += 1) {
      const actionKey = `${formId}::CTA::${String(index).padStart(3, '0')}`;
      expect(WEB_PROTOCOL_VOCABULARY.isFormActionKey(formId, actionKey), actionKey).toBe(true);
    }
  });
});
