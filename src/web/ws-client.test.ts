import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeClientMessage,
  decodeClientMessageV2,
  encodeHostMessage,
  encodeHostMessageV2,
  WIRE_PROTOCOL_V2_VERSION,
  WIRE_PROTOCOL_VERSION,
} from '@shared/index.js';
import type {
  ClientToHostMessage,
  CommandReceipt,
  HostToClientMessage,
  HostToClientV2Message,
  JsonObject,
  JsonValue,
  ProjectionSnapshotV2Message,
  SessionReconnectCapabilitiesV2Message,
} from '@shared/index.js';

import { connectProjection, WEB_PROTOCOL_VOCABULARY } from './ws-client.js';
import type {
  AdvisorSkillSelectionDraft,
  CharacterSkillSelectionDraft,
  ProjectionConnection,
  RandomSymbiontDraft,
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
const NO_GRANTED_SKILLS = { kind: 'NO_GRANTED_SKILLS' } as const;
const UNITED_GRANTED_SKILLS = {
  entries: [{ skillId: 'FOLLOWING_PAIN', skillLabel: 'Идущий вслед за болью' }],
  kind: 'GRANTED_SKILLS',
} as const;
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
      grantedSkills: UNITED_GRANTED_SKILLS,
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
      grantedSkills: NO_GRANTED_SKILLS,
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
      grantedSkills: NO_GRANTED_SKILLS,
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

function checkedHostText(message: HostToClientMessage): string {
  const encoded = encodeHostMessage(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) throw new Error(`invalid host fixture: ${JSON.stringify(encoded.refusal)}`);
  return encoded.text;
}

type DecoderWorkflowCommand = Extract<
  ClientToHostMessage,
  { readonly commandKind: 'workflow-command'; readonly messageType: 'command.request' }
>;

function decoderCommand(socket: DecoderFakeWebSocket): DecoderWorkflowCommand {
  const text = socket.sent.at(-1);
  if (text === undefined) throw new Error('missing decoder command');
  const decoded = decodeClientMessage(text, WEB_PROTOCOL_VOCABULARY);
  if (
    !decoded.ok ||
    decoded.value.messageType !== 'command.request' ||
    decoded.value.commandKind !== 'workflow-command'
  ) {
    throw new Error('invalid decoder workflow command');
  }
  return decoded.value;
}

function decoderTerminalText(receipt: CommandReceipt, replay = false): string {
  const message: HostToClientMessage = replay
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
  return checkedHostText(message);
}

// skills.json owns the 41-card cardinality. The remaining values below are a synthetic,
// internally signed protocol fixture; host tests separately assert CORE-081/165/167 values.
const DECODER_SKILL_STATS = { C: 8, D: 8, I: 8, M: 8, S: 8, W: 4, Z: 8 } as const;
const DECODER_SKILL_CARDS = Array.from({ length: 41 }, (_, index) => {
  const ordinal = String(index + 1).padStart(2, '0');
  const ineligible = index === 1;
  return {
    bonusDomainScope:
      index === 0
        ? 'Source-owned English scope stays unchanged.'
        : `Область действия бонуса ${ordinal}`,
    eligibility: ineligible ? ('REQUIREMENTS_NOT_MET' as const) : ('ELIGIBLE' as const),
    levelOptions: [
      { slotCost: 1, targetBonus: 1 },
      { slotCost: 2, targetBonus: 2 },
    ],
    missingSkillPenalty:
      index < 15
        ? ({ kind: 'MISSING_SKILL_PENALTY', value: -5 } as const)
        : ({ kind: 'NO_MISSING_SKILL_PENALTY' } as const),
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
).map(({ bonusDomainScope, levelOptions, missingSkillPenalty, skillId, skillLabel }) => ({
  bonusDomainScope,
  levelOptions,
  missingSkillPenalty,
  skillId,
  skillLabel,
}));
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
    selectionCheckpoint: commandId === null ? 'NONE' : 'EXACT',
    selectionValidation: decoderSelectionValidation(2, usedSlotCount),
    skillOptions: DECODER_SKILL_OPTIONS,
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  } as const;
}

// Source-backed values from creation-symbiont-server.test.ts, symbiont-stage catalog,
// and advisor.test.ts. Opaque ids only correlate this internally signed protocol fixture.
const DECODER_EMPTY_BRANCH_CACHE_HASH =
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const DECODER_RANDOM_SEQUENCE_ID = 'free-auto-random-sequence';
const DECODER_ADVISOR_SEQUENCE_ID = 'free-advisor-random-sequence';
const DECODER_BRANCH_UUID = 'free-auto-selection-command-live-branch';
const DECODER_EEL_SPECIES = {
  bindingPolicy: 'EEL_ARM',
  kind: 'ORDINARY',
  linkedStatCodes: ['D', 'I'],
  slotCost: 1,
  speciesKey: 'EEL',
  speciesLabel: 'Угорь',
  statModifiers: { kind: 'NO_STAT_MODIFIERS' },
} as const;
const DECODER_EEL_ORIGIN = {
  kind: 'SPECIES_ORIGIN',
  mechanical: { dieSides: 20, rawFace: 15 },
  rollReceiptId: 'free-auto-selection-command-live-receipt-1',
  rollRequestId: 'free-auto-selection-command-live-roll-request-1',
} as const;
const DECODER_EEL_BINDING_RIGHT = {
  acceptedIndex: 0,
  binding: { kind: 'EEL_ARM', side: 'RIGHT' },
  speciesKey: 'EEL',
} as const;
const DECODER_EEL_BINDING_LEFT = {
  acceptedIndex: 0,
  binding: { kind: 'EEL_ARM', side: 'LEFT' },
  speciesKey: 'EEL',
} as const;
const DECODER_MONSTER_ORIGIN = {
  kind: 'SPECIES_ORIGIN',
  mechanical: { dieSides: 20, rawFace: 20 },
  rollReceiptId: 'united-monster-selection-live-receipt-1',
  rollRequestId: 'united-monster-selection-live-roll-request-1',
} as const;
const DECODER_MONSTER_CONFIRM = {
  kind: 'CRITICAL_CONFIRMATION',
  mechanical: { dieSides: 20, rawFace: 14 },
  originRollRequestId: DECODER_MONSTER_ORIGIN.rollRequestId,
  rollReceiptId: 'united-monster-selection-live-receipt-2',
  rollRequestId: 'united-monster-selection-live-roll-request-2',
  selectedMonsterSpeciesKeyOrNull: 'CHIMERA',
} as const;
const DECODER_CHIMERA_BINDING = {
  acceptedIndex: 0,
  binding: { kind: 'NONE' },
  speciesKey: 'CHIMERA',
} as const;
const DECODER_ADVISOR_ORIGIN = {
  kind: 'SPECIES_ORIGIN',
  mechanical: { dieSides: 20, rawFace: 9 },
  rollReceiptId: 'free-advisor-origin-receipt',
  rollRequestId: 'free-advisor-origin-request',
} as const;
const DECODER_ADVISOR_I_ROLL = {
  advisorAcceptedIndex: 0,
  kind: 'ADVISOR_I',
  mechanical: { dieSides: 20, rawFace: 4 },
  rollReceiptId: 'free-advisor-i-receipt',
  rollRequestId: 'free-advisor-i-request',
} as const;
const DECODER_ADVISOR_W_ROLL = {
  advisorAcceptedIndex: 0,
  kind: 'ADVISOR_W',
  mechanical: { dieSides: 20, rawFace: 2 },
  rollReceiptId: 'free-advisor-w-receipt',
  rollRequestId: 'free-advisor-w-request',
} as const;
const DECODER_ADVISOR_BINDING = {
  acceptedIndex: 0,
  binding: { kind: 'NONE' },
  speciesKey: 'ADVISER',
} as const;
const DECODER_ACROBATICS_OPTION = {
  bonusDomainScope: 'Лазание, прыжки, кувырки, сложные маршруты, паркур',
  levelOptions: [
    { slotCost: 1, targetBonus: 1 },
    { slotCost: 2, targetBonus: 2 },
    { slotCost: 3, targetBonus: 3 },
    { slotCost: 4, targetBonus: 4 },
    { slotCost: 5, targetBonus: 5 },
  ],
  missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
  requirements: [
    {
      currentValue: 14,
      minValue: 14,
      satisfied: true,
      statCode: 'D',
      statLabel: 'Ловкость',
    },
  ],
  skillId: 'ACROBATICS',
  skillLabel: 'Акробатика',
} as const;

function decoderChr017Projection(): JsonObject {
  return {
    characterDraftId: CHARACTER_DRAFT_ID,
    draftRevision: 9,
    eligibleSymbiontSpecies: [DECODER_EEL_SPECIES],
    manualCompositionDraft: [],
    pureNoSymbiontRoute: false,
    raceChoice: 'FREE',
    selectedSpeciesOrNull: null,
    slotCapacity: 1,
    symbiontAcquisitionModeOrNull: 'RANDOM',
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  };
}

interface DecoderChr020Options {
  readonly advisorBranch?: boolean;
  readonly commandId?: string | null;
  readonly diceInputModeSnapshot?: 'AUTO' | 'MANUAL';
  readonly draftRevision?: number;
  readonly drawnSpeciesAndBindings?: readonly JsonObject[];
  readonly pendingRollRequestIdOrNull?: string | null;
  readonly physicalRolls?: readonly JsonObject[];
  readonly raceChoice?: 'FREE' | 'UNITED';
  readonly randomSequenceId?: string;
  readonly randomStatus?: 'NOT_STARTED' | 'PENDING' | 'BINDING' | 'COMMITTED';
}

function decoderChr020Projection(options: DecoderChr020Options = {}): JsonObject {
  const randomStatus = options.randomStatus ?? 'NOT_STARTED';
  return {
    advisorBranch: options.advisorBranch ?? false,
    characterDraftId: CHARACTER_DRAFT_ID,
    commandId: options.commandId ?? null,
    diceInputModeSnapshot: options.diceInputModeSnapshot ?? 'AUTO',
    draftRevision: options.draftRevision ?? 9,
    drawnSpeciesAndBindings:
      options.drawnSpeciesAndBindings ??
      (randomStatus === 'BINDING' ? [DECODER_EEL_BINDING_RIGHT] : []),
    duplicateRerollReceipts: [],
    pendingRollRequestIdOrNull:
      options.pendingRollRequestIdOrNull === undefined
        ? randomStatus === 'PENDING'
          ? 'pending-roll-request'
          : null
        : options.pendingRollRequestIdOrNull,
    raceChoice: options.raceChoice ?? 'FREE',
    randomSequenceId: options.randomSequenceId ?? DECODER_RANDOM_SEQUENCE_ID,
    randomStatus,
    seedOrManualFaces: {
      entries: options.physicalRolls ?? (randomStatus === 'BINDING' ? [DECODER_EEL_ORIGIN] : []),
      kind: 'D20_RESULTS',
    },
    symbiontAcquisitionMode: 'RANDOM',
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  };
}

function decoderChr041Projection(
  selectedSkills: readonly {
    readonly skillId: string;
    readonly slotCost: number;
    readonly targetBonus: number;
  }[] = [],
): JsonObject {
  const usedSlotCount = selectedSkills.reduce((sum, selected) => sum + selected.slotCost, 0);
  return {
    acknowledged: false,
    advisorCard: {
      advisorIPlus8: 12,
      advisorWPlus8: 10,
      effectsActive: true,
      speciesKey: 'ADVISER',
    },
    advisorIPlus8OrNull: 12,
    advisorInstanceDraftId: 'free-advisor-instance',
    advisorSlotsAndSkills: {
      requiredSlotCount: 5,
      selectedSkills,
      selectionValidation: decoderSelectionValidation(5, usedSlotCount),
      skillOptions: [DECODER_ACROBATICS_OPTION],
    },
    advisorWPlus8OrNull: 10,
    characterDraftId: CHARACTER_DRAFT_ID,
    commandId: null,
    draftRevision: 9,
    iwRollReceiptIds: ['free-advisor-i-receipt', 'free-advisor-w-receipt'],
    iwRollRequestIds: ['free-advisor-i-request', 'free-advisor-w-request'],
    randomSequenceId: DECODER_ADVISOR_SEQUENCE_ID,
    trogrSuppressionState: { kind: 'NOT_SUPPRESSED' },
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  };
}

const DECODER_THIEVERY_OPTION = {
  bonusDomainScope: 'Кражи, замки, обыск, городская маскировка; разрешение исключено',
  levelOptions: [{ slotCost: 1, targetBonus: 1 }],
  missingSkillPenalty: { kind: 'NO_MISSING_SKILL_PENALTY' },
  requirements: [],
  skillId: 'THIEVERY',
  skillLabel: 'Вор',
} as const;

function decoderManualFloorProjection(
  options: {
    readonly acknowledged?: boolean;
    readonly commandId?: string | null;
    readonly committed?: boolean;
    readonly diceInputModeSnapshot?: 'AUTO' | 'MANUAL';
    readonly suppressed?: boolean;
  } = {},
): JsonObject {
  const suppressed = options.suppressed ?? true;
  const committed = options.committed ?? false;
  const acknowledged = options.acknowledged ?? false;
  const selectedSkills = acknowledged
    ? suppressed
      ? [
          { skillId: 'ACROBATICS', slotCost: 7, targetBonus: 6 },
          { skillId: 'THIEVERY', slotCost: 1, targetBonus: 1 },
        ]
      : [{ skillId: 'ACROBATICS', slotCost: 5, targetBonus: 5 }]
    : [];
  const requiredSlotCount = suppressed ? 8 : 5;
  const usedSlotCount = selectedSkills.reduce((sum, selected) => sum + selected.slotCost, 0);
  const base = mutableProjection(decoderChr041Projection(selectedSkills));
  delete base['randomSequenceId'];
  const advisorCard = base['advisorCard'] as JsonObject;
  const slots = base['advisorSlotsAndSkills'] as JsonObject;
  return {
    ...base,
    acknowledged,
    advisorCard: {
      ...advisorCard,
      advisorIPlus8: suppressed ? 16 : 12,
      advisorWPlus8: suppressed ? 16 : 10,
      effectsActive: !suppressed,
    },
    advisorIPlus8OrNull: suppressed ? 16 : 12,
    advisorSlotsAndSkills: {
      ...slots,
      requiredSlotCount,
      selectedSkills,
      selectionValidation: decoderSelectionValidation(requiredSlotCount, usedSlotCount),
      skillOptions: suppressed
        ? [
            {
              ...DECODER_ACROBATICS_OPTION,
              levelOptions: [
                ...DECODER_ACROBATICS_OPTION.levelOptions,
                { slotCost: 7, targetBonus: 6 },
              ],
            },
            DECODER_THIEVERY_OPTION,
          ]
        : [DECODER_ACROBATICS_OPTION],
    },
    advisorWPlus8OrNull: suppressed ? 16 : 10,
    commandId:
      options.commandId === undefined
        ? committed
          ? 'manual-floor-b-command'
          : null
        : options.commandId,
    compositionDraftRevision: 1,
    diceInputModeSnapshot: options.diceInputModeSnapshot ?? 'MANUAL',
    draftRevision: committed ? 10 : 9,
    trogrSuppressionState: suppressed
      ? {
          kind: 'SUPPRESSED',
          minimumIOrNull: committed ? 2 : null,
          rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE',
          rollReceiptIdOrNull: committed ? 'manual-floor-b-receipt' : null,
          rollRequestIdOrNull: 'manual-floor-pending-b-request',
          suppressionBOrNull: committed ? 1 : null,
        }
      : { kind: 'NOT_SUPPRESSED' },
  };
}

function decoderManualFloorReceipt(command: DecoderWorkflowCommand): CommandReceipt {
  const payload = command.payload as JsonObject;
  const characterDraftId = payload['characterDraftId'];
  const wizardCheckpointId = payload['wizardCheckpointId'];
  const advisorInstanceDraftId = payload['advisorInstanceDraftId'];
  const compositionDraftRevision = payload['compositionDraftRevision'];
  const draftRevision = payload['draftRevision'];
  const pendingRollRequestId = payload['pendingRollRequestId'];
  if (
    typeof characterDraftId !== 'string' ||
    typeof wizardCheckpointId !== 'string' ||
    typeof advisorInstanceDraftId !== 'string' ||
    typeof compositionDraftRevision !== 'number' ||
    typeof draftRevision !== 'number' ||
    typeof pendingRollRequestId !== 'string' ||
    payload['manualFaceOrNull'] !== 2
  ) {
    throw new Error('invalid MANUAL intelligence floor command fixture');
  }
  return {
    commandId: command.commandId,
    receiptId: 'manual-floor-b-receipt',
    result: {
      advisorInstanceDraftId,
      branchCacheHash: DECODER_EMPTY_BRANCH_CACHE_HASH,
      branchUuid: DECODER_BRANCH_UUID,
      characterDraftId,
      checkpointId: wizardCheckpointId,
      checkpointOwnerId: characterDraftId,
      checkpointRevision: 1,
      compositionDraftRevision,
      draftRevision: draftRevision + 1,
      minimumI: 2,
      nextFormId: 'CHR-041',
      physicalRoll: {
        kind: 'TROGR_SUPPRESSION_B',
        mechanical: { dieSides: 20, rawFace: 2 },
        rollReceiptId: 'manual-floor-b-receipt',
        rollRequestId: pendingRollRequestId,
      },
      rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE',
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      suppressionB: 1,
      teacherAbsorbed: false,
      variant: 'TROGR_SUPPRESSION_B',
    },
    revisions: {
      actorVisibilityRevision: command.expectedRevisions.actorVisibilityRevision,
      projectionRevision: command.expectedRevisions.projectionRevision + 1,
      stateRevision: command.expectedRevisions.stateRevision + 1,
    },
  };
}

function decoderChr019Projection(
  species: 'EEL' | 'ADVISER' = 'EEL',
  commandId = 'free-auto-eel-binding-command',
): JsonObject {
  const advisor = species === 'ADVISER';
  return {
    bindings: [
      advisor
        ? { acceptedIndex: 0, binding: { kind: 'NONE' }, speciesKey: 'ADVISER' }
        : DECODER_EEL_BINDING_LEFT,
    ],
    characterDraftId: CHARACTER_DRAFT_ID,
    commandId,
    compositionValidation: 'VALID',
    draftRevision: 10,
    duplicatePolicy: { kind: 'REROLL_WITH_SEPARATE_RECEIPTS', receipts: [] },
    interactionGraph: { kind: 'NO_INTERACTIONS' },
    irreversibleBoundaryStatus: 'CROSSED',
    raceChoice: 'FREE',
    randomReceiptIds: advisor ? [] : [DECODER_EEL_ORIGIN.rollReceiptId],
    slotUsageAndCapacity: { capacity: 1, used: 1 },
    speciesKeys: [species],
    suppressionDestructionAbsorptionPreview: { kind: 'NONE' },
    symbiontInstancesDraft: [
      {
        absorbedSpeciesKeys: [],
        acceptedIndex: 0,
        currentOe: advisor ? 20 : 60,
        slotCost: 1,
        speciesKey: species,
        speciesLabel: advisor ? 'Советник' : 'Угорь',
        status: 'ACTIVE',
      },
    ],
    symbiontModifierBreakdown: {
      bySpecies: [
        {
          acceptedIndex: 0,
          effect: { kind: 'NO_STAT_MODIFIERS' },
          speciesKey: species,
          speciesLabel: advisor ? 'Советник' : 'Угорь',
          status: 'ACTIVE',
        },
      ],
      total: { kind: 'NO_STAT_MODIFIERS' },
    },
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  };
}

function decoderChimeraChr019Projection(
  commandId = 'united-monster-binding-command',
  draftRevision = 12,
): JsonObject {
  const effect = {
    entries: [
      { delta: 5, statCode: 'S', statLabel: 'Сила' },
      { delta: 10, statCode: 'M', statLabel: 'Метаболизм' },
    ],
    kind: 'ADDITIVE_STAT_MODIFIERS',
  } as const;
  return {
    bindings: [DECODER_CHIMERA_BINDING],
    characterDraftId: CHARACTER_DRAFT_ID,
    commandId,
    compositionValidation: 'VALID',
    draftRevision,
    duplicatePolicy: { kind: 'REROLL_WITH_SEPARATE_RECEIPTS', receipts: [] },
    interactionGraph: { kind: 'NO_INTERACTIONS' },
    irreversibleBoundaryStatus: 'CROSSED',
    raceChoice: 'UNITED',
    randomReceiptIds: [DECODER_MONSTER_ORIGIN.rollReceiptId, DECODER_MONSTER_CONFIRM.rollReceiptId],
    slotUsageAndCapacity: { capacity: 4, used: 4 },
    speciesKeys: ['CHIMERA'],
    suppressionDestructionAbsorptionPreview: { kind: 'NONE' },
    symbiontInstancesDraft: [
      {
        absorbedSpeciesKeys: [],
        acceptedIndex: 0,
        currentOe: 400,
        slotCost: 4,
        speciesKey: 'CHIMERA',
        speciesLabel: 'Химера',
        status: 'ACTIVE',
      },
    ],
    symbiontModifierBreakdown: {
      bySpecies: [
        {
          acceptedIndex: 0,
          effect,
          speciesKey: 'CHIMERA',
          speciesLabel: 'Химера',
          status: 'ACTIVE',
        },
      ],
      total: effect,
    },
    wizardCheckpointId: WIZARD_CHECKPOINT_ID,
  };
}

function decoderSymbiontReceipt(
  command: DecoderWorkflowCommand,
  receiptId: string,
  result: JsonObject,
): CommandReceipt {
  const payload = command.payload as JsonObject;
  const characterDraftId = payload['characterDraftId'];
  const wizardCheckpointId = payload['wizardCheckpointId'];
  const randomSequenceId = payload['randomSequenceId'];
  const draftRevision = payload['draftRevision'];
  if (
    typeof characterDraftId !== 'string' ||
    typeof wizardCheckpointId !== 'string' ||
    typeof randomSequenceId !== 'string' ||
    typeof draftRevision !== 'number'
  ) {
    throw new Error('invalid symbiont command fixture');
  }
  return {
    commandId: command.commandId,
    receiptId,
    result: {
      branchCacheHash: DECODER_EMPTY_BRANCH_CACHE_HASH,
      branchUuid: DECODER_BRANCH_UUID,
      characterDraftId,
      checkpointId: wizardCheckpointId,
      checkpointOwnerId: characterDraftId,
      checkpointRevision: 1,
      draftRevision: draftRevision + 1,
      randomSequenceId,
      stage: 'SYMBIONTS',
      ...result,
    },
    revisions: {
      actorVisibilityRevision: command.expectedRevisions.actorVisibilityRevision,
      projectionRevision: command.expectedRevisions.projectionRevision + 1,
      stateRevision: command.expectedRevisions.stateRevision + 1,
    },
  };
}

type DecoderFormId =
  | 'CHR-002'
  | 'CHR-010'
  | 'CHR-013'
  | 'CHR-015'
  | 'CHR-016'
  | 'CHR-017'
  | 'CHR-019'
  | 'CHR-020'
  | 'CHR-041';
type DecoderActionKeys = ProjectionSnapshotV2Message['presentation']['base']['availableActionKeys'];

function defaultDecoderActions(formId: DecoderFormId, projection: JsonObject): DecoderActionKeys {
  switch (formId) {
    case 'CHR-010':
      return ['CHR-010::CTA::004', 'CHR-010::CTA::005', 'CHR-010::CTA::006'];
    case 'CHR-016':
      return ['CHR-016::CTA::003', 'CHR-016::CTA::004'];
    case 'CHR-013':
      return ['CHR-013::CTA::001', 'CHR-013::CTA::002'];
    case 'CHR-015':
      return projection['selectionCheckpoint'] === 'EXACT'
        ? []
        : projection['selectionCheckpoint'] === 'PARTIAL'
          ? ['CHR-015::CTA::003', 'CHR-015::CTA::002']
          : ['CHR-015::CTA::003'];
    case 'CHR-002':
      return ['CHR-002::CTA::003', 'CHR-002::CTA::004', 'CHR-002::CTA::005'];
    case 'CHR-017':
      return projection['symbiontAcquisitionModeOrNull'] === 'RANDOM' ? ['CHR-017::CTA::003'] : [];
    case 'CHR-019':
      return [];
    case 'CHR-020': {
      if (projection['randomStatus'] === 'COMMITTED') return [];
      const actions: string[] = ['CHR-020::CTA::002'];
      const drawn = projection['drawnSpeciesAndBindings'];
      if (
        Array.isArray(drawn) &&
        (drawn as readonly JsonValue[]).some((entry) => {
          if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
          const speciesKey = (entry as JsonObject)['speciesKey'];
          return speciesKey === 'OWL' || speciesKey === 'EEL';
        })
      ) {
        actions.push('CHR-020::CTA::003');
      }
      return actions as DecoderActionKeys;
    }
    case 'CHR-041':
      return projection['acknowledged'] === true ? [] : ['CHR-041::CTA::001', 'CHR-041::CTA::002'];
  }
}

function projectionBase(
  formId: DecoderFormId,
  projection: JsonObject,
  availableActionKeys?: DecoderActionKeys,
): ProjectionSnapshotV2Message['presentation']['base'] {
  return {
    availableActionKeys: availableActionKeys ?? defaultDecoderActions(formId, projection),
    formId,
    formType: 'screen',
    roleFilteredPayload: projection,
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CHARACTER_DRAFT_ID }],
    routeTemplate: `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
  };
}

function decoderSnapshotText(
  formId: DecoderFormId,
  projection: JsonObject,
  assignment: ProjectionSnapshotV2Message['presentation']['assignment'],
  revisions: ProjectionSnapshotV2Message['revisions'],
  availableActionKeys?: DecoderActionKeys,
): string {
  return checkedHostTextV2({
    messageType: 'projection.snapshot',
    presentation: {
      assignment,
      base: projectionBase(formId, projection, availableActionKeys),
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions,
  });
}

interface DecoderHarness {
  readonly advisorDrafts: readonly (AdvisorSkillSelectionDraft | null)[];
  readonly connection: ProjectionConnection;
  readonly randomDrafts: readonly (RandomSymbiontDraft | null)[];
  readonly skillDrafts: readonly (CharacterSkillSelectionDraft | null)[];
  readonly socket: DecoderFakeWebSocket;
  readonly states: readonly WebClientState[];
}

async function connectDecoderFixture(
  formId: DecoderFormId,
  projection: JsonObject,
  availableActionKeys?: DecoderActionKeys,
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
  const randomDrafts: (RandomSymbiontDraft | null)[] = [];
  const advisorDrafts: (AdvisorSkillSelectionDraft | null)[] = [];
  const connection = connectProjection(
    (state) => states.push(state),
    undefined,
    undefined,
    undefined,
    undefined,
    (draft) => skillDrafts.push(draft),
    (draft) => randomDrafts.push(draft),
    (draft) => advisorDrafts.push(draft),
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
      base: projectionBase(formId, projection, availableActionKeys),
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: REVISIONS,
  };
  socket.message(checkedHostTextV2(capabilities));
  socket.message(checkedHostTextV2(snapshot));
  return { advisorDrafts, connection, randomDrafts, skillDrafts, socket, states };
}

async function decodeProjectionFixture(
  formId: DecoderFormId,
  projection: JsonObject,
  availableActionKeys?: DecoderActionKeys,
): Promise<WebClientState> {
  const { states } = await connectDecoderFixture(formId, projection, availableActionKeys);
  const finalState = states.at(-1);
  if (finalState === undefined) throw new Error('decoder test emitted no state');
  return finalState;
}

function reconnectDecoderFixture(
  harness: DecoderHarness,
  formId: DecoderFormId,
  projection: JsonObject,
  revisions: ProjectionSnapshotV2Message['revisions'],
  receipt?: CommandReceipt,
  availableActionKeys?: DecoderActionKeys,
): DecoderFakeWebSocket {
  harness.socket.serverClose(1006, 'decoder reconnect');
  expect(harness.connection.reconnect()).toEqual({ ok: true });
  const resumed = DecoderFakeWebSocket.instances.at(-1);
  if (resumed === undefined) throw new Error('missing resumed decoder socket');
  resumed.open();
  const reconnectText = resumed.sent[0];
  if (reconnectText === undefined) throw new Error('missing decoder reconnect');
  const reconnect = decodeClientMessageV2(reconnectText, WEB_PROTOCOL_VOCABULARY);
  if (!reconnect.ok || reconnect.value.messageType !== 'session.reconnect') {
    throw new Error('invalid decoder reconnect');
  }
  expect(reconnect.value.unacknowledgedCommandIds).toEqual(
    receipt === undefined ? [] : [receipt.commandId],
  );
  if (receipt !== undefined) resumed.message(decoderTerminalText(receipt, true));
  const capabilities: SessionReconnectCapabilitiesV2Message = {
    executableWorkflowCommandIds: [
      'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      'UI-CMD-CHAR-CREATION-SET-DECIDE',
      'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    ],
    messageType: 'session.reconnect.capabilities',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: reconnect.value.reconnectRequestId,
    revisions,
  };
  resumed.message(checkedHostTextV2(capabilities));
  resumed.message(
    decoderSnapshotText(
      formId,
      projection,
      { correlationId: reconnect.value.reconnectRequestId, reason: 'RECONNECT' },
      revisions,
      availableActionKeys,
    ),
  );
  return resumed;
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

  it('requires the exact race-owned granted-skills variant', async () => {
    const missing = mutableProjection(CHR_010_PROJECTION);
    delete racePreviewAt(missing, 0)['grantedSkills'];
    expect(await decodeProjectionFixture('CHR-010', missing as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.raceConsequenceOptions[0].raceConsequencesPreview.grantedSkills',
      },
    });

    const unitedWithoutGrant = mutableProjection(CHR_010_PROJECTION);
    racePreviewAt(unitedWithoutGrant, 0)['grantedSkills'] = structuredClone(NO_GRANTED_SKILLS);
    expect(
      await decodeProjectionFixture('CHR-010', unitedWithoutGrant as JsonObject),
    ).toMatchObject({
      kind: 'protocol-error',
    });

    const freeWithGrant = mutableProjection(CHR_010_PROJECTION);
    racePreviewAt(freeWithGrant, 1)['grantedSkills'] = structuredClone(UNITED_GRANTED_SKILLS);
    expect(await decodeProjectionFixture('CHR-010', freeWithGrant as JsonObject)).toMatchObject({
      kind: 'protocol-error',
    });

    const pureWithGrant = mutableProjection(CHR_010_PROJECTION);
    racePreviewAt(pureWithGrant, 2)['grantedSkills'] = structuredClone(UNITED_GRANTED_SKILLS);
    expect(await decodeProjectionFixture('CHR-010', pureWithGrant as JsonObject)).toMatchObject({
      kind: 'protocol-error',
    });

    const sourceOwnedPublicIdentity = mutableProjection(CHR_010_PROJECTION);
    const granted = objectValue(
      racePreviewAt(sourceOwnedPublicIdentity, 0)['grantedSkills'],
      'UNITED grantedSkills',
    );
    objectValue(
      arrayValue(granted['entries'], 'UNITED grantedSkills entries')[0],
      'UNITED grantedSkills entry',
    )['skillId'] = 'SOURCE_OWNED_PUBLIC_SKILL';
    expect(
      await decodeProjectionFixture('CHR-010', sourceOwnedPublicIdentity as JsonObject),
    ).toMatchObject({ kind: 'ready' });
  });

  it('rejects malformed or private UNITED granted-skill entries', async () => {
    const multiple = mutableProjection(CHR_010_PROJECTION);
    const multipleGranted = objectValue(
      racePreviewAt(multiple, 0)['grantedSkills'],
      'UNITED grantedSkills',
    );
    multipleGranted['entries'] = [
      ...arrayValue(multipleGranted['entries'], 'UNITED grantedSkills entries'),
      { skillId: 'FOLLOWING_PAIN', skillLabel: 'Дубликат' },
    ];
    expect(await decodeProjectionFixture('CHR-010', multiple as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.raceConsequenceOptions[0].raceConsequencesPreview.grantedSkills.entries',
      },
    });

    for (const [key, value] of [
      ['skillId', 'SKL-042'],
      ['skillLabel', '   '],
    ] as const) {
      const projection = mutableProjection(CHR_010_PROJECTION);
      const granted = objectValue(
        racePreviewAt(projection, 0)['grantedSkills'],
        'UNITED grantedSkills',
      );
      const entry = objectValue(
        arrayValue(granted['entries'], 'UNITED grantedSkills entries')[0],
        'UNITED grantedSkills entry',
      );
      entry[key] = value;
      expect(await decodeProjectionFixture('CHR-010', projection as JsonObject)).toMatchObject({
        kind: 'protocol-error',
        refusal: {
          path: `$.presentation.base.roleFilteredPayload.raceConsequenceOptions[0].raceConsequencesPreview.grantedSkills.entries[0].${key}`,
        },
      });
    }

    const privateField = mutableProjection(CHR_010_PROJECTION);
    const granted = objectValue(
      racePreviewAt(privateField, 0)['grantedSkills'],
      'UNITED grantedSkills',
    );
    objectValue(
      arrayValue(granted['entries'], 'UNITED grantedSkills entries')[0],
      'UNITED grantedSkills entry',
    )['SkillID'] = 'SKL-042';
    expect(await decodeProjectionFixture('CHR-010', privateField as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.raceConsequenceOptions[0].raceConsequencesPreview.grantedSkills.entries[0].SkillID',
      },
    });
  });

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

  it('rejects malformed skill content and a non-source penalty population in CHR-013', async () => {
    const positivePenalty = mutableProjection(DECODER_CHR_013_PROJECTION);
    optionAt(positivePenalty, 'skillCardSummaries', 0)['missingSkillPenalty'] = {
      kind: 'MISSING_SKILL_PENALTY',
      value: 7,
    };
    expect(await decodeProjectionFixture('CHR-013', positivePenalty as JsonObject)).toMatchObject({
      kind: 'ready',
    });

    const blankScope = mutableProjection(DECODER_CHR_013_PROJECTION);
    optionAt(blankScope, 'skillCardSummaries', 0)['bonusDomainScope'] = '   ';
    expect(await decodeProjectionFixture('CHR-013', blankScope as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.skillCardSummaries[0].bonusDomainScope',
      },
    });

    const malformedPenalties: readonly unknown[] = [
      null,
      {},
      { kind: 'UNKNOWN' },
      { kind: 'NO_MISSING_SKILL_PENALTY', value: -5 },
      { kind: 'MISSING_SKILL_PENALTY' },
      { kind: 'MISSING_SKILL_PENALTY', value: -1.5 },
      { kind: 'MISSING_SKILL_PENALTY', value: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const malformedPenalty of malformedPenalties) {
      const projection = mutableProjection(DECODER_CHR_013_PROJECTION);
      optionAt(projection, 'skillCardSummaries', 0)['missingSkillPenalty'] = malformedPenalty;
      expect(await decodeProjectionFixture('CHR-013', projection as JsonObject)).toMatchObject({
        kind: 'protocol-error',
      });
    }

    const wrongPopulation = mutableProjection(DECODER_CHR_013_PROJECTION);
    optionAt(wrongPopulation, 'skillCardSummaries', 15)['missingSkillPenalty'] = {
      kind: 'MISSING_SKILL_PENALTY',
      value: -5,
    };
    expect(await decodeProjectionFixture('CHR-013', wrongPopulation as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.skillCardSummaries' },
    });
  });

  it('strictly decodes content on eligible CHR-015 options', async () => {
    const blankScope = mutableProjection(decoderChr015Projection());
    optionAt(blankScope, 'skillOptions', 0)['bonusDomainScope'] = '';
    expect(await decodeProjectionFixture('CHR-015', blankScope as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.skillOptions[0].bonusDomainScope',
      },
    });

    const positivePenalty = mutableProjection(decoderChr015Projection());
    optionAt(positivePenalty, 'skillOptions', 0)['missingSkillPenalty'] = {
      kind: 'MISSING_SKILL_PENALTY',
      value: 7,
    };
    expect(await decodeProjectionFixture('CHR-015', positivePenalty as JsonObject)).toMatchObject({
      kind: 'ready',
    });

    const fractionalPenalty = mutableProjection(decoderChr015Projection());
    optionAt(fractionalPenalty, 'skillOptions', 0)['missingSkillPenalty'] = {
      kind: 'MISSING_SKILL_PENALTY',
      value: 1.5,
    };
    expect(await decodeProjectionFixture('CHR-015', fractionalPenalty as JsonObject)).toMatchObject(
      {
        kind: 'protocol-error',
        refusal: {
          path: '$.presentation.base.roleFilteredPayload.skillOptions[0].missingSkillPenalty.value',
        },
      },
    );

    const privateSourceField = mutableProjection(decoderChr015Projection());
    optionAt(privateSourceField, 'skillOptions', 0)['SkillID'] = 'SKL-001';
    expect(
      await decodeProjectionFixture('CHR-015', privateSourceField as JsonObject),
    ).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.skillOptions[0].SkillID' },
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

  it.each([
    ['skillLabel', 'Подменённая подпись'],
    ['bonusDomainScope', 'Substituted scope.'],
    ['missingSkillPenalty', { kind: 'MISSING_SKILL_PENALTY', value: -6 }],
  ] as const)(
    'cross-checks the CHR-013 to CHR-015 signed option join for %s',
    async (key, value) => {
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
      optionAt(destination, 'skillOptions', 0)[key] = value;
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
    },
  );

  it('continues CHR-013 into an existing PARTIAL selection', async () => {
    const { connection, socket, states } = await connectDecoderFixture(
      'CHR-013',
      DECODER_CHR_013_PROJECTION,
    );
    expect(connection.requestFormAction('CHR-013::CTA::002')).toEqual({ ok: true });
    const requestText = socket.sent.at(-1);
    if (requestText === undefined) throw new Error('missing CHR-013 continuation');
    const request = decodeClientMessageV2(requestText, WEB_PROTOCOL_VOCABULARY);
    if (!request.ok || request.value.messageType !== 'navigation.form-action') {
      throw new Error('invalid CHR-013 continuation');
    }
    const destination = {
      ...decoderChr015Projection(
        [{ skillId: 'SKILL_01', slotCost: 1, targetBonus: 1 }],
        'card-add',
      ),
      selectionCheckpoint: 'PARTIAL',
    } as const;
    socket.message(
      checkedHostTextV2({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: {
            correlationId: request.value.navigationRequestId,
            reason: 'FORM_ACTION',
          },
          base: projectionBase('CHR-015', destination),
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        revisions: { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 0 },
      }),
    );

    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-015',
        projection: {
          commandId: 'card-add',
          draftRevision: 9,
          selectedSkillIds: ['SKILL_01'],
          selectedSkills: [{ skillId: 'SKILL_01', slotCost: 1, targetBonus: 1 }],
          selectionCheckpoint: 'PARTIAL',
        },
        revisions: { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 0 },
      },
    });
  });

  it('rejects EXACT or empty PARTIAL after CHR-013 continue', async () => {
    const destinations = [
      decoderChr015Projection(
        [
          { skillId: 'SKILL_01', slotCost: 1, targetBonus: 1 },
          { skillId: 'SKILL_03', slotCost: 1, targetBonus: 1 },
        ],
        'final',
      ),
      {
        ...decoderChr015Projection([], 'card-add'),
        selectionCheckpoint: 'PARTIAL',
      },
    ] as const;
    for (const destination of destinations) {
      const { connection, socket, states } = await connectDecoderFixture(
        'CHR-013',
        DECODER_CHR_013_PROJECTION,
      );
      expect(connection.requestFormAction('CHR-013::CTA::002')).toEqual({ ok: true });
      const requestText = socket.sent.at(-1);
      if (requestText === undefined) throw new Error('missing CHR-013 continuation');
      const request = decodeClientMessageV2(requestText, WEB_PROTOCOL_VOCABULARY);
      if (!request.ok || request.value.messageType !== 'navigation.form-action') {
        throw new Error('invalid CHR-013 continuation');
      }
      socket.message(
        checkedHostTextV2({
          messageType: 'projection.snapshot',
          presentation: {
            assignment: {
              correlationId: request.value.navigationRequestId,
              reason: 'FORM_ACTION',
            },
            base: projectionBase('CHR-015', destination),
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
    }
  });

  it('allows catalog return only for PARTIAL CHR-015 selections', async () => {
    const partial = {
      ...decoderChr015Projection(
        [{ skillId: 'SKILL_01', slotCost: 1, targetBonus: 1 }],
        'card-add',
      ),
      selectionCheckpoint: 'PARTIAL',
    };
    const { connection, socket, states } = await connectDecoderFixture('CHR-015', partial, [
      'CHR-015::CTA::003',
      'CHR-015::CTA::002',
    ]);
    expect(connection.requestFormAction('CHR-015::CTA::002')).toEqual({ ok: true });
    const requestText = socket.sent.at(-1);
    if (requestText === undefined) throw new Error('missing partial catalog return');
    const request = decodeClientMessageV2(requestText, WEB_PROTOCOL_VOCABULARY);
    if (!request.ok || request.value.messageType !== 'navigation.form-action') {
      throw new Error('partial catalog return must use navigation.form-action');
    }
    expect(request.value).toMatchObject({
      actionKey: 'CHR-015::CTA::002',
      sourceFormId: 'CHR-015',
    });
    socket.message(
      checkedHostTextV2({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: { correlationId: request.value.navigationRequestId, reason: 'FORM_ACTION' },
          base: projectionBase('CHR-013', DECODER_CHR_013_PROJECTION),
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        revisions: { ...REVISIONS, projectionRevision: REVISIONS.projectionRevision + 1 },
      }),
    );
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'CHR-013' },
    });
    for (const projection of [
      decoderChr015Projection(),
      decoderChr015Projection(
        [
          { skillId: 'SKILL_01', slotCost: 1, targetBonus: 1 },
          { skillId: 'SKILL_03', slotCost: 1, targetBonus: 1 },
        ],
        'final',
      ),
    ]) {
      expect(
        await decodeProjectionFixture('CHR-015', projection, ['CHR-015::CTA::002']),
      ).toMatchObject({
        kind: 'protocol-error',
        refusal: { path: '$.presentation.base.availableActionKeys' },
      });
    }
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
    expect(JSON.stringify(command.value.payload)).not.toMatch(
      /bonusDomainScope|missingSkillPenalty|skillLabel|slotCost/u,
    );
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

describe('RANDOM projection decoders and action keys', () => {
  const cases: readonly (readonly [DecoderFormId, JsonObject])[] = [
    ['CHR-017', decoderChr017Projection()],
    ['CHR-020', decoderChr020Projection()],
    ['CHR-041', decoderChr041Projection()],
    ['CHR-019', decoderChr019Projection()],
  ];

  it.each(cases)('accepts the exact %s player projection', async (formId, projection) => {
    expect(await decodeProjectionFixture(formId, projection)).toMatchObject({ kind: 'ready' });
  });

  it('accepts the future intelligence floor and rejects a substituted purpose', async () => {
    const projection = mutableProjection(decoderChr041Projection()) as Record<string, JsonValue>;
    projection['trogrSuppressionState'] = {
      kind: 'SUPPRESSED',
      minimumIOrNull: 2,
      suppressionBOrNull: 1,
      rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE',
      rollRequestIdOrNull: 'suppression-b-request',
      rollReceiptIdOrNull: 'suppression-b-receipt',
    };
    expect(await decodeProjectionFixture('CHR-041', projection)).toMatchObject({ kind: 'ready' });
    projection['trogrSuppressionState'] = {
      kind: 'SUPPRESSED',
      minimumIOrNull: 2,
      suppressionBOrNull: 1,
      rollPurpose: 'CURRENT_ADVISOR_I',
      rollRequestIdOrNull: 'suppression-b-request',
      rollReceiptIdOrNull: 'suppression-b-receipt',
    };
    expect(await decodeProjectionFixture('CHR-041', projection)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.trogrSuppressionState.rollPurpose',
      },
    });
  });

  it.each(cases)('rejects a missing required field in %s', async (formId, projection) => {
    const malformed = mutableProjection(projection);
    delete malformed['characterDraftId'];
    expect(await decodeProjectionFixture(formId, malformed as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.characterDraftId' },
    });
  });

  it.each(cases)('rejects an extra private field in %s', async (formId, projection) => {
    const malformed = mutableProjection(projection);
    malformed['ruleId'] = 'private provenance';
    expect(await decodeProjectionFixture(formId, malformed as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.ruleId' },
    });
  });

  it.each(cases)('rejects a malformed required value in %s', async (formId, projection) => {
    const malformed = mutableProjection(projection);
    malformed['draftRevision'] = -1;
    expect(await decodeProjectionFixture(formId, malformed as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.draftRevision' },
    });
  });

  it.each([
    ['CHR-017', decoderChr017Projection(), ['CHR-017::CTA::001']],
    ['CHR-020', decoderChr020Projection(), ['CHR-020::CTA::001', 'CHR-020::CTA::002']],
    ['CHR-041', decoderChr041Projection(), ['CHR-041::CTA::001']],
    ['CHR-019', decoderChr019Projection(), ['CHR-019::CTA::001']],
  ] as const)(
    'fails closed on unsupported or incomplete actions for %s',
    async (formId, projection, actions) => {
      expect(await decodeProjectionFixture(formId, projection, actions)).toMatchObject({
        kind: 'protocol-error',
        refusal: { path: '$.presentation.base.availableActionKeys' },
      });
    },
  );

  it('navigates CHR-017 through navigation.form-action into a fresh CHR-020 sequence', async () => {
    const { connection, socket, states } = await connectDecoderFixture(
      'CHR-017',
      decoderChr017Projection(),
    );
    const wireCount = socket.sent.length;
    expect(connection.requestFormAction('CHR-017::CTA::003')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount + 1);
    const navigationText = socket.sent.at(-1);
    if (navigationText === undefined) throw new Error('missing CHR-017 navigation');
    const navigation = decodeClientMessageV2(navigationText, WEB_PROTOCOL_VOCABULARY);
    if (!navigation.ok || navigation.value.messageType !== 'navigation.form-action') {
      throw new Error('invalid CHR-017 navigation');
    }
    expect(navigation.value).toMatchObject({
      actionKey: 'CHR-017::CTA::003',
      expectedProjectionRevision: 0,
      sourceFormId: 'CHR-017',
    });
    socket.message(
      decoderSnapshotText(
        'CHR-020',
        decoderChr020Projection(),
        {
          correlationId: navigation.value.navigationRequestId,
          reason: 'FORM_ACTION',
        },
        { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 0 },
      ),
    );
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-020',
        projection: { randomSequenceId: DECODER_RANDOM_SEQUENCE_ID, randomStatus: 'NOT_STARTED' },
        revisions: { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 0 },
      },
    });
    expect(socket.sent).toHaveLength(wireCount + 1);
  });
});

describe('RANDOM local drafts, commands, and replay', () => {
  it('sends the exact AUTO payload and resumes an exact roll replay without rerolling', async () => {
    const harness = await connectDecoderFixture('CHR-020', decoderChr020Projection());
    const { connection, randomDrafts, socket, states } = harness;
    expect(connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(socket);
    expect(command.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      draftRevision: 9,
      manualFaceOrNull: null,
      pendingRollRequestIdOrNull: null,
      randomSequenceId: DECODER_RANDOM_SEQUENCE_ID,
      selectedMonsterSpeciesKeyOrNull: null,
      sourceFormId: 'CHR-020',
      stage: 'SYMBIONTS',
      variant: 'ROLL',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    const receipt = decoderSymbiontReceipt(command, DECODER_EEL_ORIGIN.rollReceiptId, {
      advisorBranch: false,
      diceInputModeSnapshot: 'AUTO',
      nextFormId: 'CHR-020',
      nextPendingRollRequestIdOrNull: null,
      physicalRoll: DECODER_EEL_ORIGIN,
      randomReceiptIdOrNull: DECODER_EEL_ORIGIN.rollReceiptId,
      randomStatus: 'BINDING',
      sourceFormId: 'CHR-020',
      variant: 'ROLL',
    });
    const destination = decoderChr020Projection({
      commandId: command.commandId,
      draftRevision: 10,
      randomStatus: 'BINDING',
    });
    const resumed = reconnectDecoderFixture(
      harness,
      'CHR-020',
      destination,
      receipt.revisions,
      receipt,
    );
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-020',
        projection: { commandId: command.commandId, randomStatus: 'BINDING' },
        revisions: receipt.revisions,
      },
    });
    expect(randomDrafts.at(-1)).toMatchObject({
      manualFaceOrNull: null,
      selectedMonsterSpeciesKeyOrNull: null,
      sideBySpecies: { EEL: 'RIGHT' },
    });
    expect(resumed.sent).toHaveLength(1);
  });

  it('rejects a changed pending roll replay instead of accepting a reroll', async () => {
    const { connection, socket, states } = await connectDecoderFixture(
      'CHR-020',
      decoderChr020Projection(),
    );
    expect(connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(socket);
    const receipt = decoderSymbiontReceipt(command, DECODER_EEL_ORIGIN.rollReceiptId, {
      advisorBranch: false,
      diceInputModeSnapshot: 'AUTO',
      nextFormId: 'CHR-020',
      nextPendingRollRequestIdOrNull: null,
      physicalRoll: DECODER_EEL_ORIGIN,
      randomReceiptIdOrNull: DECODER_EEL_ORIGIN.rollReceiptId,
      randomStatus: 'BINDING',
      sourceFormId: 'CHR-020',
      variant: 'ROLL',
    });
    socket.message(decoderTerminalText(receipt));
    expect(states.at(-1)?.kind).toBe('ready');
    const changed = structuredClone(receipt);
    const physical = objectValue(changed.result['physicalRoll'], 'physicalRoll');
    objectValue(physical['mechanical'], 'mechanical')['rawFace'] = 14;
    const wireCount = socket.sent.length;
    socket.message(decoderTerminalText(changed, true));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.receipt.receiptId' },
    });
    expect(socket.sent).toHaveLength(wireCount + 1);
  });

  it('gates MANUAL locally, resets the uncommitted face on refresh, then sends one face', async () => {
    const projection = decoderChr020Projection({ diceInputModeSnapshot: 'MANUAL' });
    const harness = await connectDecoderFixture('CHR-020', projection);
    const { connection, randomDrafts, socket, states } = harness;
    const wireCount = socket.sent.length;
    expect(connection.requestFormAction('CHR-020::CTA::002').ok).toBe(false);
    expect(connection.replaceRandomManualFace(9)).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount);
    expect(randomDrafts.at(-1)?.manualFaceOrNull).toBe(9);
    expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { revisions: REVISIONS } });

    const resumed = reconnectDecoderFixture(harness, 'CHR-020', projection, REVISIONS);
    expect(randomDrafts.at(-1)?.manualFaceOrNull).toBeNull();
    expect(connection.requestFormAction('CHR-020::CTA::002').ok).toBe(false);
    expect(connection.replaceRandomManualFace(9)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(resumed);
    expect(command.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      draftRevision: 9,
      manualFaceOrNull: 9,
      pendingRollRequestIdOrNull: null,
      randomSequenceId: DECODER_RANDOM_SEQUENCE_ID,
      selectedMonsterSpeciesKeyOrNull: null,
      sourceFormId: 'CHR-020',
      stage: 'SYMBIONTS',
      variant: 'ROLL',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    expect(resumed.sent).toHaveLength(2);
  });

  it('keeps SIDE wire-free and sends BINDING without another roll or revision overlay', async () => {
    const { connection, randomDrafts, socket, states } = await connectDecoderFixture(
      'CHR-020',
      decoderChr020Projection({
        commandId: 'free-auto-eel-roll-command',
        randomStatus: 'BINDING',
      }),
    );
    const wireCount = socket.sent.length;
    expect(randomDrafts.at(-1)?.sideBySpecies.EEL).toBe('RIGHT');
    expect(connection.requestFormAction('CHR-020::CTA::003')).toEqual({ ok: true });
    expect(connection.replaceRandomSideSpecies('OWL').ok).toBe(false);
    expect(socket.sent).toHaveLength(wireCount);
    expect(randomDrafts.at(-1)?.sideBySpecies.EEL).toBe('LEFT');
    expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { revisions: REVISIONS } });

    expect(connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(socket);
    expect(command.payload).toEqual({
      characterDraftId: CHARACTER_DRAFT_ID,
      draftRevision: 9,
      physicalRollReceiptIds: [DECODER_EEL_ORIGIN.rollReceiptId],
      randomSequenceId: DECODER_RANDOM_SEQUENCE_ID,
      selectedBindings: [{ side: 'LEFT', speciesKey: 'EEL' }],
      sourceFormId: 'CHR-020',
      stage: 'SYMBIONTS',
      variant: 'BINDING',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    const receipt = decoderSymbiontReceipt(command, 'free-auto-eel-binding-receipt', {
      advisorBranch: false,
      bindings: [DECODER_EEL_BINDING_LEFT],
      nextFormId: 'CHR-019',
      randomStatus: 'COMMITTED',
      sourceFormId: 'CHR-020',
      variant: 'BINDING',
    });
    socket.message(decoderTerminalText(receipt));
    socket.message(
      decoderSnapshotText(
        'CHR-019',
        decoderChr019Projection('EEL', command.commandId),
        { correlationId: command.commandId, reason: 'COMMAND_DESTINATION' },
        receipt.revisions,
      ),
    );
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-019',
        projection: { bindings: [DECODER_EEL_BINDING_LEFT] },
        revisions: receipt.revisions,
      },
    });
    expect(randomDrafts.at(-1)).toBeNull();
    expect(socket.sent).toHaveLength(wireCount + 1);
  });

  it('requires a local monster choice but only projects it from the host terminal snapshot', async () => {
    const projection = decoderChr020Projection({
      pendingRollRequestIdOrNull: DECODER_MONSTER_CONFIRM.rollRequestId,
      physicalRolls: [DECODER_MONSTER_ORIGIN],
      raceChoice: 'UNITED',
      randomSequenceId: 'united-monster-random-sequence',
      randomStatus: 'PENDING',
    });
    const { connection, randomDrafts, socket, states } = await connectDecoderFixture(
      'CHR-020',
      projection,
      ['CHR-020::CTA::002', 'CHR-020::CTA::004'],
    );
    const wireCount = socket.sent.length;
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { availableActionKeys: ['CHR-020::CTA::004'] },
    });
    expect(connection.requestFormAction('CHR-020::CTA::002').ok).toBe(false);
    expect(connection.requestFormAction('CHR-020::CTA::004')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount);
    expect(randomDrafts.at(-1)?.selectedMonsterSpeciesKeyOrNull).toBe('CHIMERA');
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        projection: { seedOrManualFaces: { entries: [DECODER_MONSTER_ORIGIN] } },
        revisions: REVISIONS,
      },
    });

    expect(connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(socket);
    expect(command.payload).toMatchObject({
      manualFaceOrNull: null,
      pendingRollRequestIdOrNull: DECODER_MONSTER_CONFIRM.rollRequestId,
      selectedMonsterSpeciesKeyOrNull: 'CHIMERA',
      variant: 'ROLL',
    });
    const receipt = decoderSymbiontReceipt(command, DECODER_MONSTER_CONFIRM.rollReceiptId, {
      advisorBranch: false,
      diceInputModeSnapshot: 'AUTO',
      nextFormId: 'CHR-020',
      nextPendingRollRequestIdOrNull: null,
      physicalRoll: DECODER_MONSTER_CONFIRM,
      randomReceiptIdOrNull: DECODER_MONSTER_CONFIRM.rollReceiptId,
      randomStatus: 'BINDING',
      sourceFormId: 'CHR-020',
      variant: 'ROLL',
    });
    socket.message(decoderTerminalText(receipt));
    socket.message(
      decoderSnapshotText(
        'CHR-020',
        decoderChr020Projection({
          commandId: command.commandId,
          draftRevision: 10,
          drawnSpeciesAndBindings: [DECODER_CHIMERA_BINDING],
          physicalRolls: [DECODER_MONSTER_ORIGIN, DECODER_MONSTER_CONFIRM],
          raceChoice: 'UNITED',
          randomSequenceId: 'united-monster-random-sequence',
          randomStatus: 'BINDING',
        }),
        { correlationId: command.commandId, reason: 'COMMAND_DESTINATION' },
        receipt.revisions,
      ),
    );
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-020',
        projection: {
          drawnSpeciesAndBindings: [DECODER_CHIMERA_BINDING],
          seedOrManualFaces: { entries: [DECODER_MONSTER_ORIGIN, DECODER_MONSTER_CONFIRM] },
        },
      },
    });
    expect(randomDrafts.at(-1)?.selectedMonsterSpeciesKeyOrNull).toBeNull();
    expect(socket.sent).toHaveLength(wireCount + 1);
  });
});

describe('RANDOM historic replay recovery', () => {
  async function beginMonsterOriginRoll() {
    const harness = await connectDecoderFixture(
      'CHR-020',
      decoderChr020Projection({
        raceChoice: 'UNITED',
        randomSequenceId: 'united-monster-random-sequence',
      }),
    );
    expect(harness.connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(harness.socket);
    const receipt = decoderSymbiontReceipt(command, DECODER_MONSTER_ORIGIN.rollReceiptId, {
      advisorBranch: false,
      diceInputModeSnapshot: 'AUTO',
      nextFormId: 'CHR-020',
      nextPendingRollRequestIdOrNull: DECODER_MONSTER_CONFIRM.rollRequestId,
      physicalRoll: DECODER_MONSTER_ORIGIN,
      randomReceiptIdOrNull: DECODER_MONSTER_ORIGIN.rollReceiptId,
      randomStatus: 'PENDING',
      sourceFormId: 'CHR-020',
      variant: 'ROLL',
    });
    return { harness, receipt };
  }

  async function beginAdvisorBinding() {
    const harness = await connectDecoderFixture(
      'CHR-020',
      decoderChr020Projection({
        advisorBranch: true,
        diceInputModeSnapshot: 'MANUAL',
        drawnSpeciesAndBindings: [DECODER_ADVISOR_BINDING],
        physicalRolls: [DECODER_ADVISOR_ORIGIN, DECODER_ADVISOR_I_ROLL, DECODER_ADVISOR_W_ROLL],
        randomSequenceId: DECODER_ADVISOR_SEQUENCE_ID,
        randomStatus: 'BINDING',
      }),
    );
    expect(harness.connection.requestFormAction('CHR-020::CTA::002')).toEqual({ ok: true });
    const command = decoderCommand(harness.socket);
    expect(command.payload).toMatchObject({
      physicalRollReceiptIds: [
        DECODER_ADVISOR_ORIGIN.rollReceiptId,
        DECODER_ADVISOR_I_ROLL.rollReceiptId,
        DECODER_ADVISOR_W_ROLL.rollReceiptId,
      ],
      selectedBindings: [],
      variant: 'BINDING',
    });
    const receipt = decoderSymbiontReceipt(command, 'free-advisor-binding-receipt', {
      advisorBranch: true,
      bindings: [DECODER_ADVISOR_BINDING],
      nextFormId: 'CHR-041',
      randomStatus: 'COMMITTED',
      sourceFormId: 'CHR-020',
      variant: 'BINDING',
    });
    return { harness, receipt };
  }

  it('recovers roll A into newer B and C projections without requiring the old current state', async () => {
    const laterRollProjection = decoderChr020Projection({
      commandId: 'united-monster-confirm-command',
      draftRevision: 11,
      drawnSpeciesAndBindings: [DECODER_CHIMERA_BINDING],
      physicalRolls: [DECODER_MONSTER_ORIGIN, DECODER_MONSTER_CONFIRM],
      raceChoice: 'UNITED',
      randomSequenceId: 'united-monster-random-sequence',
      randomStatus: 'BINDING',
    });
    const destinations = [
      {
        formId: 'CHR-020' as const,
        projection: laterRollProjection,
        revisions: { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
      },
      {
        formId: 'CHR-019' as const,
        projection: decoderChimeraChr019Projection(),
        revisions: { actorVisibilityRevision: 0, projectionRevision: 3, stateRevision: 3 },
      },
    ];
    for (const destination of destinations) {
      const { harness, receipt } = await beginMonsterOriginRoll();
      const resumed = reconnectDecoderFixture(
        harness,
        destination.formId,
        destination.projection,
        destination.revisions,
        receipt,
      );
      expect(harness.states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: {
          formId: destination.formId,
          projection: { draftRevision: destination.projection['draftRevision'] },
          revisions: destination.revisions,
        },
      });
      expect(resumed.sent).toHaveLength(1);
    }

    const malformedDestinations = [
      {
        path: '$.presentation.base.roleFilteredPayload.seedOrManualFaces.entries',
        projection: {
          ...laterRollProjection,
          seedOrManualFaces: { entries: [DECODER_MONSTER_CONFIRM], kind: 'D20_RESULTS' },
        } as JsonObject,
      },
      {
        path: '$.presentation.base.roleFilteredPayload.randomSequenceId',
        projection: {
          ...laterRollProjection,
          randomSequenceId: 'different-random-sequence',
        } as JsonObject,
      },
      {
        path: '$.revisions',
        projection: { ...laterRollProjection, draftRevision: 9 } as JsonObject,
      },
    ];
    for (const destination of malformedDestinations) {
      const { harness, receipt } = await beginMonsterOriginRoll();
      reconnectDecoderFixture(
        harness,
        'CHR-020',
        destination.projection,
        { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
        receipt,
      );
      expect(harness.states.at(-1)).toMatchObject({
        kind: 'protocol-error',
        refusal: { path: destination.path },
      });
    }
  });

  it('recovers a binding replay after the later Advisor checkpoint and keeps bindings strict', async () => {
    const latest = {
      ...decoderChr019Projection('ADVISER', 'free-advisor-checkpoint-command'),
      draftRevision: 11,
    } as JsonObject;
    const { harness, receipt } = await beginAdvisorBinding();
    const resumed = reconnectDecoderFixture(
      harness,
      'CHR-019',
      latest,
      { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
      receipt,
    );
    expect(harness.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-019',
        projection: {
          commandId: 'free-advisor-checkpoint-command',
          draftRevision: 11,
        },
      },
    });
    expect(resumed.sent).toHaveLength(1);

    const forged = { ...latest, bindings: [DECODER_EEL_BINDING_LEFT] } as JsonObject;
    const mismatch = await beginAdvisorBinding();
    reconnectDecoderFixture(
      mismatch.harness,
      'CHR-019',
      forged,
      { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
      mismatch.receipt,
    );
    expect(mismatch.harness.states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.bindings' },
    });
  });
});

describe('MANUAL Advisor intelligence floor projection and transport', () => {
  it('accepts pending and committed projections without a RANDOM identity', async () => {
    expect(
      await decodeProjectionFixture('CHR-041', decoderManualFloorProjection(), [
        'CHR-041::CTA::004',
      ]),
    ).toMatchObject({
      kind: 'ready',
      snapshot: {
        projection: {
          compositionDraftRevision: 1,
          diceInputModeSnapshot: 'MANUAL',
          trogrSuppressionState: {
            minimumIOrNull: null,
            rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE',
            rollReceiptIdOrNull: null,
            rollRequestIdOrNull: 'manual-floor-pending-b-request',
            suppressionBOrNull: null,
          },
        },
      },
    });
    expect(
      await decodeProjectionFixture(
        'CHR-041',
        decoderManualFloorProjection({ acknowledged: true, committed: true }),
      ),
    ).toMatchObject({
      kind: 'ready',
      snapshot: {
        availableActionKeys: [],
        projection: {
          acknowledged: true,
          advisorSlotsAndSkills: {
            selectedSkills: [
              { skillId: 'ACROBATICS', slotCost: 7, targetBonus: 6 },
              { skillId: 'THIEVERY', slotCost: 1, targetBonus: 1 },
            ],
          },
          trogrSuppressionState: {
            minimumIOrNull: 2,
            rollReceiptIdOrNull: 'manual-floor-b-receipt',
            suppressionBOrNull: 1,
          },
        },
      },
    });
    expect(
      await decodeProjectionFixture(
        'CHR-041',
        decoderManualFloorProjection({ suppressed: false }),
        ['CHR-041::CTA::004'],
      ),
    ).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.availableActionKeys' },
    });
  });

  it('sends one MANUAL face and restores its B receipt without another roll', async () => {
    const harness = await connectDecoderFixture('CHR-041', decoderManualFloorProjection(), [
      'CHR-041::CTA::004',
    ]);
    const { advisorDrafts, connection, socket, states } = harness;
    expect(states.at(-1)).toMatchObject({ kind: 'ready' });
    expect(advisorDrafts.at(-1)).toBeNull();
    const wireCount = socket.sent.length;
    expect(connection.requestFormAction('CHR-041::CTA::004', null).ok).toBe(false);
    expect(socket.sent).toHaveLength(wireCount);
    expect(connection.requestFormAction('CHR-041::CTA::004', 2)).toEqual({ ok: true });
    const command = decoderCommand(socket);
    expect(command.workflowCommandId).toBe('UI-CMD-CHAR-CREATION-ROLL-COMMIT');
    expect(command.payload).toEqual({
      advisorInstanceDraftId: 'free-advisor-instance',
      characterDraftId: CHARACTER_DRAFT_ID,
      compositionDraftRevision: 1,
      draftRevision: 9,
      manualFaceOrNull: 2,
      pendingRollRequestId: 'manual-floor-pending-b-request',
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      variant: 'TROGR_SUPPRESSION_B',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    expect(command.payload).not.toHaveProperty('randomSequenceId');

    const receipt = decoderManualFloorReceipt(command);
    const destination = decoderManualFloorProjection({
      commandId: command.commandId,
      committed: true,
    });
    const resumed = reconnectDecoderFixture(
      harness,
      'CHR-041',
      destination,
      receipt.revisions,
      receipt,
      ['CHR-041::CTA::001', 'CHR-041::CTA::002'],
    );
    const restored = states.at(-1);
    if (restored?.kind !== 'ready') throw new Error('MANUAL B destination was not restored');
    expect(restored.snapshot.projection).not.toHaveProperty('randomSequenceId');
    expect(restored.snapshot).toMatchObject({
      formId: 'CHR-041',
      projection: {
        commandId: command.commandId,
        compositionDraftRevision: 1,
        draftRevision: 10,
        trogrSuppressionState: {
          minimumIOrNull: 2,
          rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE',
          rollReceiptIdOrNull: 'manual-floor-b-receipt',
          rollRequestIdOrNull: 'manual-floor-pending-b-request',
          suppressionBOrNull: 1,
        },
      },
      revisions: receipt.revisions,
    });
    expect(restored.snapshot.availableActionKeys).not.toContain('CHR-041::CTA::004');
    expect(resumed.sent).toHaveLength(1);
  });

  it('rejects a forged RANDOM identity in the B receipt', async () => {
    const { connection, socket, states } = await connectDecoderFixture(
      'CHR-041',
      decoderManualFloorProjection(),
      ['CHR-041::CTA::004'],
    );
    expect(connection.requestFormAction('CHR-041::CTA::004', 2)).toEqual({ ok: true });
    const command = decoderCommand(socket);
    const receipt = decoderManualFloorReceipt(command);
    const forged = {
      ...receipt,
      result: { ...receipt.result, randomSequenceId: 'forged-random-sequence' },
    };
    socket.message(decoderTerminalText(forged));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.receipt.result.randomSequenceId' },
    });
  });

  it('rejects a changed B replay instead of replacing the durable result', async () => {
    const { connection, socket, states } = await connectDecoderFixture(
      'CHR-041',
      decoderManualFloorProjection(),
      ['CHR-041::CTA::004'],
    );
    expect(connection.requestFormAction('CHR-041::CTA::004', 2)).toEqual({ ok: true });
    const command = decoderCommand(socket);
    const receipt = decoderManualFloorReceipt(command);
    socket.message(decoderTerminalText(receipt));
    expect(states.at(-1)?.kind).toBe('ready');
    const changed = {
      ...structuredClone(receipt),
      result: { ...receipt.result, minimumI: 16 },
    };
    const wireCount = socket.sent.length;
    socket.message(decoderTerminalText(changed, true));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.receipt.receiptId' },
    });
    expect(socket.sent).toHaveLength(wireCount + 1);
  });

  it('rejects mixed identities and malformed suppression fields', async () => {
    const cases: readonly (readonly [string, (projection: Record<string, unknown>) => void])[] = [
      [
        'randomSequenceId',
        (projection) => {
          projection['randomSequenceId'] = 'forged-random-sequence';
        },
      ],
      [
        'compositionDraftRevision',
        (projection) => {
          delete projection['compositionDraftRevision'];
        },
      ],
      [
        'trogrSuppressionState.rollPurpose',
        (projection) => {
          delete objectValue(projection['trogrSuppressionState'], 'suppression')['rollPurpose'];
        },
      ],
      [
        'trogrSuppressionState.availabilityTrace',
        (projection) => {
          objectValue(projection['trogrSuppressionState'], 'suppression')['availabilityTrace'] = [];
        },
      ],
      [
        'trogrSuppressionState.rollRequestIdOrNull',
        (projection) => {
          objectValue(projection['trogrSuppressionState'], 'suppression')['rollRequestIdOrNull'] =
            null;
        },
      ],
      [
        'trogrSuppressionState.suppressionBOrNull',
        (projection) => {
          objectValue(projection['trogrSuppressionState'], 'suppression')['rollReceiptIdOrNull'] =
            'early-receipt';
        },
      ],
      [
        'iwRollReceiptIds',
        (projection) => {
          const ids = projection['iwRollReceiptIds'];
          if (!Array.isArray(ids)) throw new Error('missing MANUAL I/W receipt IDs');
          ids[0] = null;
        },
      ],
    ];
    for (const [path, mutate] of cases) {
      const projection = mutableProjection(decoderManualFloorProjection());
      mutate(projection);
      expect(
        await decodeProjectionFixture('CHR-041', projection as JsonObject, ['CHR-041::CTA::004']),
        path,
      ).toMatchObject({
        kind: 'protocol-error',
        refusal: { path: `$.presentation.base.roleFilteredPayload.${path}` },
      });
    }
    const random = mutableProjection(decoderChr041Projection());
    random['compositionDraftRevision'] = 1;
    expect(await decodeProjectionFixture('CHR-041', random as JsonObject)).toMatchObject({
      kind: 'protocol-error',
      refusal: {
        path: '$.presentation.base.roleFilteredPayload.compositionDraftRevision',
      },
    });
  });

  it('rejects an I/W request that reuses its receipt ID', async () => {
    const projection = mutableProjection(decoderManualFloorProjection());
    const requests = projection['iwRollRequestIds'] as JsonValue[] | undefined;
    const receipts = projection['iwRollReceiptIds'] as JsonValue[] | undefined;
    if (!Array.isArray(requests) || !Array.isArray(receipts)) {
      throw new Error('missing MANUAL I/W identities');
    }
    const requestId = requests[0];
    if (typeof requestId !== 'string') throw new Error('missing first MANUAL I/W request ID');
    receipts[0] = requestId;
    expect(
      await decodeProjectionFixture('CHR-041', projection as JsonObject, ['CHR-041::CTA::004']),
    ).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.iwRollReceiptIds' },
    });
  });

  it('rejects duplicated MANUAL I/W receipt identities', async () => {
    const projection = mutableProjection(decoderManualFloorProjection());
    const ids = projection['iwRollReceiptIds'];
    if (!Array.isArray(ids) || typeof ids[0] !== 'string') {
      throw new Error('missing MANUAL I/W receipt IDs');
    }
    ids[1] = ids[0];
    expect(
      await decodeProjectionFixture('CHR-041', projection as JsonObject, ['CHR-041::CTA::004']),
    ).toMatchObject({
      kind: 'protocol-error',
      refusal: { path: '$.presentation.base.roleFilteredPayload.iwRollReceiptIds' },
    });
  });
});

describe('CHR-041 Advisor local selection and checkpoint replay', () => {
  it('adds and removes exact skills wire-free, checkpoints once, and resumes the host snapshot', async () => {
    const harness = await connectDecoderFixture('CHR-041', decoderChr041Projection());
    const { advisorDrafts, connection, socket, states } = harness;
    const wireCount = socket.sent.length;
    expect(connection.requestFormAction('CHR-041::CTA::001').ok).toBe(false);
    expect(connection.replaceAdvisorSkillCandidate('ACROBATICS', 6).ok).toBe(false);
    expect(connection.replaceAdvisorSkillCandidate('ACROBATICS', 5)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-041::CTA::002')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount);
    expect(advisorDrafts.at(-1)).toMatchObject({
      selectedSkills: [{ skillId: 'ACROBATICS', slotCost: 5, targetBonus: 5 }],
      selectionValidation: { kind: 'EXACT', requiredSlotCount: 5, usedSlotCount: 5 },
    });
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { availableActionKeys: ['CHR-041::CTA::001'], revisions: REVISIONS },
    });

    expect(connection.replaceAdvisorSkillCandidate('ACROBATICS', 5)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-041::CTA::002')).toEqual({ ok: true });
    expect(advisorDrafts.at(-1)).toMatchObject({
      selectedSkills: [],
      selectionValidation: { kind: 'UNDERFILLED', missingSlotCount: 5 },
    });
    expect(connection.requestFormAction('CHR-041::CTA::001').ok).toBe(false);
    expect(connection.replaceAdvisorSkillCandidate('ACROBATICS', 5)).toEqual({ ok: true });
    expect(connection.requestFormAction('CHR-041::CTA::002')).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(wireCount);

    expect(connection.requestFormAction('CHR-041::CTA::001')).toEqual({ ok: true });
    const command = decoderCommand(socket);
    expect(command.payload).toEqual({
      advisorInstanceDraftId: 'free-advisor-instance',
      characterDraftId: CHARACTER_DRAFT_ID,
      draftRevision: 9,
      randomSequenceId: DECODER_ADVISOR_SEQUENCE_ID,
      selectedSkills: [{ skillId: 'ACROBATICS', targetBonus: 5 }],
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      wizardCheckpointId: WIZARD_CHECKPOINT_ID,
    });
    const receipt = decoderSymbiontReceipt(command, 'free-advisor-checkpoint-receipt', {
      advisorInstanceDraftId: 'free-advisor-instance',
      effectsActive: true,
      learnedSkills: [{ bonus: 5, skillKey: 'ACROBATICS', slotCost: 5 }],
      nextFormId: 'CHR-019',
      requiredSlotCount: 5,
      selectedSkills: [{ skillId: 'ACROBATICS', targetBonus: 5 }],
      sourceFormId: 'CHR-041',
      usedSlotCount: 5,
    });
    const resumed = reconnectDecoderFixture(
      harness,
      'CHR-019',
      decoderChr019Projection('ADVISER', command.commandId),
      receipt.revisions,
      receipt,
    );
    expect(states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-019',
        projection: { commandId: command.commandId, speciesKeys: ['ADVISER'] },
        revisions: receipt.revisions,
      },
    });
    expect(advisorDrafts.at(-1)).toBeNull();
    expect(resumed.sent).toHaveLength(1);
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
