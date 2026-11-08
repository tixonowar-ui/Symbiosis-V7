import { beforeAll, describe, expect, it } from 'vitest';
import { loadNpcAuthoringSourceCatalog, type NpcAuthoringSourceCatalog } from './npc-catalog.js';
import { npcCleanHumanoidFixture } from '../../tests/fixtures/npc-clean-humanoid.js';
import { npcKensiRequest } from '../../tests/fixtures/npc-published-inventory.js';
import { deriveNpcOrdinaryStatProfile } from '../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import {
  evaluateNpcSkills,
  type NpcSkillProof,
} from '../domain/rules/npc-authoring/skill-evaluation.js';
import type { NpcHumanoidBuildInput } from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import {
  createNpcFormalLifeState,
  type NpcFormalLifeHistoryAnchor,
} from '../domain/rules/npc-authoring/formal-life-state.js';
import type { NpcHumanoidLifeContext } from '../domain/rules/npc-authoring/humanoid-life-boundary.js';
import type { NpcCompositionConsequenceProof } from '../domain/rules/npc-authoring/composition-consequence-types.js';
import {
  buildNpcInventoryPhysicalBasis,
  buildNpcInventoryPublication,
  type NpcInventoryPublicationProof,
  type NpcInventoryPublicationContext,
} from '../domain/rules/npc-authoring/inventory-publication.js';
import {
  deriveNpcTaipanModeContribution,
  deriveNpcPoisonSourceContribution,
  type NpcTaipanModeHistoryAnchor,
  type NpcPoisonSourceObservation,
} from '../domain/rules/npc-authoring/formal-poison-source.js';
import {
  deriveNpcPreparedPoisonCoating,
  type NpcInventoryCoatingContext,
  type NpcPoisonCoatingPreparation,
} from '../domain/rules/npc-authoring/formal-poison-coating.js';
import type { NpcHumanoidPoisonContext } from '../domain/rules/npc-authoring/taipan-mode-state.js';

let source: NpcAuthoringSourceCatalog;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(process.cwd());
  if (source.poisonSource === null || source.poisonCoatings === null)
    throw new Error('Delivered ADR0087 sources required for whole-sheet scenario');
});
function sourceCatalog() {
  if (source.poisonSource === null) throw new Error('Delivered poison source required');
  return source.poisonSource;
}
function carrierCatalog() {
  if (source.poisonCoatings === null) throw new Error('Delivered coating source required');
  return source.poisonCoatings;
}
function initial(): NpcHumanoidBuildInput {
  const clean = npcCleanHumanoidFixture(source, {
    npcUuid: id(1),
    owningControllerId: id(2),
    contextFactId: id(74),
    compositionJournalId: id(6),
  });
  const schema = {
    raceCode: 'UNITED',
    pureClassOrNull: null,
    anatomyProfileId: 'STANDARD_HUMANOID',
    sex: 'MALE',
    massKg: 75,
  } as const;
  const member = {
    symbiontInstanceId: id(70),
    speciesKey: 'TAIPAN' as const,
    targetLevel: 1,
    currentOE: 0,
    binding: { kind: 'NONE' as const },
    learnedNodeRefs: source.development.nodes
      .filter((n) => n.speciesKey === 'TAIPAN' && n.level <= 1)
      .map((n) => n.nodeRef),
  };
  const compositionProof: NpcCompositionConsequenceProof = {
    identityKey: id(1),
    binding: { journalId: id(6), raceCode: 'UNITED' },
    resolutions: [],
    confirmations: [
      {
        confirmationCommandId: id(71),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(72),
          journalId: id(6),
          ordinal: 1,
          raceCode: 'UNITED',
          additions: [member],
          removals: [],
          buildChanges: [],
          currentOeChanges: [],
        },
      },
    ],
  };
  const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 5, W: 2, C: 20 };
  const ordinaryProof = {
    currentStatContextFactId: id(74),
    statContexts: [73, 74].map((n) => ({
      contextFactId: id(n),
      schema,
      baseStats,
      compositionOrdinal: 1,
      resolutionOrdinal: 0,
    })),
  };
  const profile = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
    npcUuid: id(1),
    compositionProof,
    ordinaryProof,
  });
  const stealth = source.skills.skills.find((s) => s.skillKey === 'STEALTH');
  if (stealth === undefined) throw new Error('Actual source STEALTH required');
  const skillProof: NpcSkillProof = {
    identityKey: id(1),
    contexts: [73, 74].map((n, index) => ({
      contextFactId: id(n),
      ordinal: index + 1,
      stage: index === 0 ? 'START_SELECTION' : 'CONFIRMED',
      raceCode: 'UNITED',
      classCode: null,
      skillStageStats: profile.current.stats.skillStageStats,
      permanentStats: profile.current.stats.permanentStats,
      effectiveStats: profile.current.stats.effectiveStats,
      grossGrantSourceOrNull: null,
      sym166SourceOrNull: null,
      facts:
        index === 0
          ? [
              {
                kind: 'PAID_ACQUISITION',
                factId: `NPC_INITIAL_SKILL/${id(3)}/1`,
                ordinal: 1,
                contextFactId: id(73),
                skillKey: stealth.skillKey,
                bonusBefore: 0,
                bonusAfter: 1,
                chargedSlotCost: 1,
                pool: 'START',
              },
            ]
          : [],
    })),
  };
  const skills = evaluateNpcSkills(source.skills, {
    identityKey: id(1),
    mode: 'CREATE_V1',
    previousConfirmedProofOrNull: null,
    proof: skillProof,
  });
  const inventoryProof: NpcInventoryPublicationProof = {
    npcUuid: id(1),
    commitOperationId: id(3),
    sourceOperationId: 'actual-npc015-confirm',
    actorId: id(2),
    committedAt: '2026-11-07T10:00:00.000Z',
    entries: [
      {
        request: {
          ...npcKensiRequest(id(84)),
          itemTypeId: 'RES-AMM-001',
          currentAmmo: null,
        },
        weaponProfileVersionId: null,
      },
    ],
  };
  const inventory = buildNpcInventoryPublication(source.inventoryPublication, inventoryProof);
  return {
    ...clean,
    compositionProof,
    ordinaryProof,
    skillProof,
    inventoryProof,
    input: {
      ...clean.input,
      identity: { ...clean.input.identity, ...schema },
      baseStats,
      symbionts: [member],
      skills: skills.ledger,
      lifetimeFacts: profile.current.composition.lifetimeFacts,
      inventory: inventory.input,
      initialState: { ...clean.input.initialState, currentHP: 7 },
    },
  };
}
function life(
  value: NpcHumanoidBuildInput,
  timestamp: number | null,
  target = 3,
): NpcHumanoidLifeContext {
  const history: NpcFormalLifeHistoryAnchor = {
    kind: 'GM_FORMAL_INITIAL_LIFE',
    campaignId: id(10),
    npcUuid: id(1),
    lifeKind: 'ALIVE',
    initialStateConfirmationId: id(86),
    reason: 'Подтверждённое исходное состояние',
    createdAt: '2026-11-07T10:00:00.000Z',
    severeWoundOrNull: null,
  };
  const state = createNpcFormalLifeState(
    source.formalLife,
    history,
    {
      campaignId: id(10),
      npcUuid: id(1),
      currentHP: value.input.initialState.currentHP,
      campaignTimestampOrNull: timestamp,
    },
    null,
  );
  return {
    campaignId: id(10),
    npcUuid: id(1),
    commitOperationId: id(target),
    originCommitOperationId: id(3),
    campaignTimestampOrNull: timestamp,
    history,
    state,
    entryDuplicateProofOrNull: null,
    previousLifeKindOrNull: target === 3 ? null : 'ALIVE',
  };
}
function mode(value: NpcHumanoidBuildInput, timestamp: number | null, prepared = false) {
  const history: NpcTaipanModeHistoryAnchor = {
    kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE',
    campaignId: id(10),
    npcUuid: id(1),
    sourceInstanceId: id(70),
    acquisitionFactId: id(72),
    modeOperationId: id(81),
    effectInstanceId: id(82),
    activePoisonProfileId: 'POI-TAIPAN-DEADLY',
    pendingSwitchOrNull: null,
    reason: 'Явный исходный режим',
    createdAt: '2026-11-07T10:00:00.000Z',
  };
  return deriveNpcTaipanModeContribution(sourceCatalog(), history, {
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestampOrNull: timestamp,
    origin: prepared
      ? { kind: 'PREPARED', preparationOperationId: id(81) }
      : { kind: 'COMMITTED', originCommitOperationId: id(3) },
    originalCompositionProof: value.compositionProof,
    previousVersionCompositionProofOrNull: null,
    currentCompositionProof: value.compositionProof,
  });
}
function poison(
  value: NpcHumanoidBuildInput,
  lifeContext: NpcHumanoidLifeContext,
  coating: boolean,
  target = 3,
  prepared = false,
  inventoryHistory: NpcInventoryPublicationContext | null = null,
): NpcHumanoidPoisonContext {
  const chosen = mode(value, lifeContext.campaignTimestampOrNull, prepared);
  let coatingContext: NpcInventoryCoatingContext | null = null;
  if (coating) {
    if (lifeContext.campaignTimestampOrNull !== 37)
      throw new Error('Explicit source clock required');
    const preparation: NpcPoisonCoatingPreparation = {
      kind: 'GM_FORMAL_INITIAL_POISON_COATING',
      campaignId: id(10),
      npcUuid: id(1),
      coatingInstanceId: id(85),
      preparationOperationId: id(80),
      sourceInstanceId: id(70),
      targetItemInstanceId: id(84),
      surfaceConfirmed: true,
      replacesCoatingIdOrNull: null,
      replaceConfirmed: false,
      reason: 'Одна исходная доза на отдельной стреле',
      calendarAnchor: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 37,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      createdAt: '2026-11-07T10:00:00.000Z',
      revision: 1,
    };
    const observation = (
      operationId: number,
      kind: NpcPoisonSourceObservation['kind'],
    ): NpcPoisonSourceObservation => ({
      operationId: id(operationId),
      kind,
      campaignTimestamp: 37,
      compositionProof: value.compositionProof,
      life: { kind: 'CONFIRMED', state: lifeContext.state },
    });
    const origin = prepared
      ? { kind: 'PREPARED' as const, preparationOperationId: id(80) }
      : { kind: 'COMMITTED' as const, originCommitOperationId: id(3) };
    const sourceContribution = deriveNpcPoisonSourceContribution(sourceCatalog(), chosen, {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin,
      targetCommitOperationIdOrNull: prepared ? null : id(target),
      observations: [
        observation(80, 'PREPARATION'),
        ...(prepared ? [] : [observation(3, 'COMMIT')]),
        ...(target === 3 ? [] : [observation(target, 'COMMIT')]),
      ],
    });
    const rows = value.inventoryProof.entries.map((e) => e.request);
    const contribution = deriveNpcPreparedPoisonCoating(carrierCatalog(), preparation, {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin,
      mode: chosen,
      source: sourceContribution,
      originalInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        rows.map((r) => ({ ...r, coatingInstanceIds: [] })),
      ),
      currentInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        rows.map((r) => ({ ...r, coatingInstanceIds: [id(85)] })),
        inventoryHistory,
      ),
      replaces: null,
    });
    coatingContext = {
      catalog: carrierCatalog(),
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      targetCommitOperationIdOrNull: prepared ? null : id(target),
      contributions: [contribution],
      removals: [],
    };
  }
  return {
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestampOrNull: lifeContext.campaignTimestampOrNull,
    targetCommitOperationIdOrNull: prepared ? null : id(target),
    previousVersionCompositionProofOrNull: target === 3 ? null : value.compositionProof,
    modes: [chosen],
    coatingContext,
  };
}

import {
  createNpcPoisonPreparation,
  type NpcPoisonCandidate,
  type NpcPoisonPreparationBasis,
} from './npc-poison-preparation.js';
import { npcEditorForItemAttempt } from './npc-item-preparation.js';
import {
  createEmptyNpcEditorDraft,
  readNpcEditorDraft,
  restoreNpcInventoryEditorRows,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcAttemptReadContext } from '../persistence/npc-child-identities.js';
import type {
  NpcAttempt,
  NpcAttemptEvent,
  NpcCalendarReadContext,
  NpcOperation,
} from '../persistence/npc-library-records.js';
import type { NpcAttemptPreparationContext } from '../persistence/npc-library-store.js';
import { networkApplicationStorage as storage } from '../persistence/network-local-application.js';
import type { JsonObject } from '../shared/wire-protocol.js';
import { npcTechnicalRequestValue, type NpcPreparationRequest } from '../shared/npc-command.js';
import { readNpcTaipanModeContribution } from '../domain/rules/npc-authoring/formal-poison-source.js';
import { readNpcPoisonCoatingContribution } from '../domain/rules/npc-authoring/formal-poison-coating.js';

type Request = Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' | 'NPC-016' }>;
const stamp = '2026-11-07T10:00:00.000Z';
const json = (value: unknown): JsonObject =>
  storage.object(JSON.parse(storage.canonical(value)) as unknown) as JsonObject;
function basisBytes(basis: NpcPoisonPreparationBasis): string {
  return storage.canonical({
    attempt: basis.attempt,
    draft: basis.draft,
    modes: basis.modes.map((v) => readNpcTaipanModeContribution(sourceCatalog(), v)),
    coatings: basis.coatings.map(
      (v) => readNpcPoisonCoatingContribution(carrierCatalog(), v).coating,
    ),
    ...(basis.staleCoatings === undefined
      ? {}
      : {
          staleCoatings: basis.staleCoatings.map((entry) => ({
            ...entry,
            original: readNpcPoisonCoatingContribution(carrierCatalog(), entry.original),
          })),
        }),
  });
}

/** These callbacks stand for the separately tested owning SQL/history boundary.
 * All mechanics tokens are still issued by actual source evaluators. No token is cast or forged. */
function harness(
  options: {
    stage?: 'NPC-015' | 'NPC-016';
    time?: number | null;
    mode?: 'NONE' | 'PREPARED' | 'COMMITTED';
    dose?: boolean;
    staleDose?: boolean;
  } = {},
) {
  const input = initial();
  const time = options.time === undefined ? 37 : options.time;
  const alive = life(input, time);
  if (options.staleDose && !options.dose) throw Error('An actual original dose is required');
  const selected =
    options.dose === true ? poison(input, alive, true, 3, options.staleDose === true) : null;
  const modes =
    selected?.modes ??
    (options.mode === 'NONE' ? [] : [mode(input, time, options.mode !== 'COMMITTED')]);
  const coatings = selected?.coatingContext?.contributions ?? [];
  const scope = { campaignId: id(10), ownerDeviceId: id(2), gmLocalContextId: id(150) };
  const revisions = { stateRevision: 4, projectionRevision: 5, actorVisibilityRevision: 3 };
  const checkpoint = {
    ...revisions,
    campaignId: scope.campaignId,
    snapshotJson: '{"fixture":"separate-owning-boundary"}',
  };
  const readContext: NpcAttemptReadContext = {
    scope,
    npcDraftId: id(151),
    candidateNpcUuid: id(1),
    revision: 8,
    operationId: id(152),
    inheritedVersionOrNull: null,
    itemBindings: [
      {
        itemInstanceId: id(84),
        originOperationId: id(153),
        originDraftId: id(151),
        originEventSha256: 'b'.repeat(64),
      },
    ],
    pendingItemOrNull: null,
    effectBindings: [],
    pendingEffectOrNull: null,
    symbiontBindings: [
      {
        symbiontInstanceId: id(70),
        originOperationId: id(154),
        originDraftId: id(151),
        originEventSha256: 'c'.repeat(64),
        retainedSpeciesKeyOrNull: 'TAIPAN',
      },
    ],
    pendingSymbiontOrNull: null,
    woundBindings: [],
    pendingWoundOrNull: null,
    traumaBindings: [],
    pendingTraumaOrNull: null,
    coatingBindings:
      options.dose === true
        ? [
            {
              coatingInstanceId: id(85),
              itemInstanceId: id(84),
              sourceInstanceId: id(70),
              originOperationId: id(80),
              originDraftId: id(151),
              originEventSha256: 'd'.repeat(64),
              retainedOriginCommitOperationIdOrNull: options.staleDose ? null : id(3),
            },
          ]
        : [],
  };
  const editor = npcEditorForItemAttempt(
    { skills: source.skills, development: source.development },
    source.inventory,
    readContext,
  );
  const requests = input.inventoryProof.entries.map((e) => ({
    ...e.request,
    coatingInstanceIds: options.dose === true ? [id(85)] : [],
  }));
  const blank = createEmptyNpcEditorDraft();
  const draft = readNpcEditorDraft(editor, {
    ...blank,
    inventory: restoreNpcInventoryEditorRows(editor, blank.inventory, requests),
    initialState: {
      ...blank.initialState,
      poisonModeFactIds: { kind: 'ENTERED', value: modes.map(() => id(81)) },
    },
  });
  const attempt: NpcAttempt = {
    scope,
    npcDraftId: id(151),
    candidateNpcUuid: id(1),
    revision: 8,
    mode: 'CREATE_V1',
    targetOrNull: null,
    stage: options.stage ?? 'NPC-015',
    status: 'OPEN',
    values: json(draft),
  };
  const calendar: NpcCalendarReadContext = {
    format: 'NPC_CALENDAR_READ_V1',
    scope,
    checkpoint,
    currentQueuePrefixOrNull: { eventId: id(155), recordSha256: 'e'.repeat(64) },
    currentClock: {
      phase: 'PRE_START',
      campaignTimestampOrNull: time,
      sourceOrNull:
        time === null
          ? null
          : { kind: 'INITIAL_TIME', commandId: id(156), recordSha256: 'f'.repeat(64) },
      lobbySnapshotRevisionOrNull:
        time === null ? null : (options.staleDose ? 'b' : 'a').repeat(64),
    },
    operations: [],
  };
  let basis: NpcPoisonPreparationBasis = {
    attempt,
    draft,
    editor,
    readContext,
    compositionProof: input.compositionProof,
    previousVersionCompositionProofOrNull: null,
    sourceSignature: { owningPrefix: id(152) },
    modes,
    physicalInventory: buildNpcInventoryPhysicalBasis(source.inventoryPublication, requests),
    coatings: options.staleDose ? [] : coatings,
    ...(options.staleDose
      ? {
          staleCoatings: coatings.map((original) => ({
            kind: 'PREPARATION_CLOCK_CHANGED' as const,
            original,
            originalClock: {
              ...calendar.currentClock,
              lobbySnapshotRevisionOrNull: 'a'.repeat(64),
            },
            explanation: 'Подтверждение времени изменилось; исходная доза не переподтверждена.',
          })),
        }
      : {}),
    lifeStateOrNull: alive.state,
  };
  const candidates: NpcPoisonCandidate[] = [];
  const historicalReads: string[] = [];
  let rejectCandidate = false;
  let issued = 0;
  const allocate = () => id(300 + ++issued);
  const buildAdapter = (enabled = true) =>
    createNpcPoisonPreparation({
      source: enabled ? sourceCatalog() : null,
      catalog: enabled ? carrierCatalog() : null,
      publication: source.inventoryPublication,
      read: (actual, clock) => {
        expect(actual).toEqual(basis.attempt);
        expect(clock).toEqual(calendar);
        return basis;
      },
      historicalCalendar: (operation, _current) => {
        historicalReads.push(operation.operationId);
        return calendar;
      },
      validateCandidate: (candidate) => {
        candidates.push(candidate);
        expect(candidate.basis).toBe(basis);
        expect(candidate.calendar).toEqual(calendar);
        expect(candidate.next.revision).toBe(attempt.revision + 1);
        expect(candidate.next.scope).toEqual(scope);
        if (rejectCandidate) throw Error('owning candidate source validation refused');
      },
    });
  const api = buildAdapter();
  const previous: NpcAttemptEvent = { operationId: id(152), previousSha256OrNull: null, attempt };
  function context(request: Request): NpcAttemptPreparationContext {
    return {
      calendarContext: calendar,
      source: { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
      boundary: {
        scope,
        operationId: request.operationId,
        kind: 'REPLACE',
        request: json(request),
        expectedAttemptRevisionOrNull: 8,
        expectedCurrentVersionOrNull: null,
      },
      checkpoint,
      beforeGmSource: {
        sourceFormId: attempt.stage,
        revisions,
        sourceSnapshotSha256: 'a'.repeat(64),
        queuePrefix: { eventId: id(155), recordSha256: 'e'.repeat(64) },
      },
      previousOrNull: previous,
      previousReadContextOrNull: readContext,
      baseVersionOrNull: null,
      inheritedVersionForPreviousAttemptOrNull: null,
    };
  }
  function request(preparation: Request['preparation'], form = attempt.stage): Request {
    const value = npcTechnicalRequestValue({
      messageType: 'network.npc-preparation.request',
      protocolVersion: 3,
      operationId: id(200),
      campaignId: scope.campaignId,
      npcDraftId: attempt.npcDraftId,
      expectedAttemptRevision: 8,
      expectedRevisions: revisions,
      sourceFormId: form,
      preparation,
    });
    if (
      value.messageType !== 'network.npc-preparation.request' ||
      (value.sourceFormId !== 'NPC-015' && value.sourceFormId !== 'NPC-016')
    )
      throw Error('Exact poison request required');
    return value;
  }
  function modeRequest(): Request {
    const offered = api.inspect(attempt, calendar)?.modePreparations[0];
    if (offered === undefined) throw Error('Actual initial mode choice required');
    const profile = offered.profileChoices[0];
    if (profile === undefined) throw Error('Actual learned profile required');
    return request(
      {
        kind: 'POISON_MODE_SET',
        input: {
          capabilityKey: offered.capabilityKey,
          sourceInstanceId: offered.sourceInstanceId,
          poisonProfileId: profile.value,
          reason: 'Явный исходный режим',
        },
      },
      'NPC-016',
    );
  }
  function doseRequest(): Request {
    const offered = api.inspect(attempt, calendar)?.coatingPreparations[0];
    if (offered === undefined) throw Error('Actual physical carrier choice required');
    return request({
      kind: 'POISON_COATING_PREPARE',
      input: {
        capabilityKey: offered.capabilityKey,
        sourceInstanceId: offered.sourceInstanceId,
        targetItemInstanceId: offered.targetItemInstanceId,
        surfaceConfirmed: true,
        replacesCoatingIdOrNull: offered.replacesCoatingIdOrNull,
        replaceConfirmed: offered.replacesCoatingIdOrNull !== null,
        reason: 'Подтверждённая исходная поверхность',
      },
    });
  }
  function removeRequest(): Request {
    const offered = api.inspect(attempt, calendar)?.coatingStates[0];
    if (offered === undefined) throw Error('Actual selected dose required');
    return request({
      kind: 'POISON_COATING_REMOVE',
      input: {
        capabilityKey: offered.capabilityKey,
        coatingInstanceId: offered.coatingInstanceId,
        reason: 'Явное снятие исходной дозы',
      },
    });
  }
  return {
    api,
    input,
    calendar,
    attempt,
    previous,
    readContext,
    context,
    request,
    modeRequest,
    doseRequest,
    removeRequest,
    allocate,
    candidates,
    historicalReads,
    buildAdapter,
    get basis() {
      return basis;
    },
    setBasis(next: NpcPoisonPreparationBasis) {
      basis = next;
    },
    get issued() {
      return issued;
    },
    rejectCandidate() {
      rejectCandidate = true;
    },
  };
}

describe('actual-source poison preparation adapter boundaries', () => {
  it('does not expose unavailable source capabilities and does not allocate on refusal', () => {
    const h = harness({ stage: 'NPC-016', mode: 'NONE', time: null });
    expect(h.buildAdapter(false).inspect(h.attempt, h.calendar)).toBeNull();
    const request = h.modeRequest();
    expect(() =>
      h.buildAdapter(false).prepare(request, h.context(request), h.allocate, stamp),
    ).toThrow(/sources unavailable/);
    expect(h.issued).toBe(0);
    expect(h.candidates).toEqual([]);
  });
  it('preserves saved legacy absence without exposing poison controls and rejects an explicit unset selection', () => {
    const h = harness({ stage: 'NPC-016', mode: 'NONE', time: null });
    const initialState = Object.fromEntries(
      Object.entries(h.basis.draft.initialState).filter(([key]) => key !== 'poisonModeFactIds'),
    );
    const legacyDraft = readNpcEditorDraft(h.basis.editor, { ...h.basis.draft, initialState });
    const legacy = { ...h.attempt, values: json(legacyDraft) };
    h.setBasis({ ...h.basis, draft: legacyDraft, attempt: legacy });
    const before = basisBytes(h.basis);
    expect(h.api.inspect(legacy, h.calendar)).toBeNull();
    expect(basisBytes(h.basis)).toBe(before);

    const pendingDraft = readNpcEditorDraft(h.basis.editor, {
      ...legacyDraft,
      initialState: { ...initialState, poisonModeFactIds: { kind: 'UNSET' } },
    });
    const pending = { ...h.attempt, values: json(pendingDraft) };
    h.setBasis({ ...h.basis, draft: pendingDraft, attempt: pending });
    const pendingBytes = basisBytes(h.basis);
    expect(() => h.api.inspect(pending, h.calendar)).toThrow(
      /explicit owning mode selection required/,
    );
    expect(basisBytes(h.basis)).toBe(pendingBytes);
    expect(h.issued).toBe(0);
    expect(h.candidates).toEqual([]);
  });
  it('prepares an explicit learned mode without a clock and preserves unentered controls', () => {
    const h = harness({ stage: 'NPC-016', mode: 'NONE', time: null }),
      before = basisBytes(h.basis);
    const view = h.api.inspect(h.attempt, h.calendar),
      offered = view?.modePreparations[0];
    expect(offered?.input).toEqual({
      poisonProfileId: { kind: 'UNSET' },
      reason: { kind: 'UNSET' },
    });
    expect(offered?.profileChoices.map((v) => v.value)).toEqual(['POI-TAIPAN-DEADLY']);
    const request = h.modeRequest(),
      result = h.api.prepare(request, h.context(request), h.allocate, stamp);
    expect(result.childAllocations).toEqual([
      { kind: 'EFFECT_INSTANCE', id: id(301), sourceKind: 'POISON_MODE', sourceInstanceId: id(70) },
    ]);
    expect(result.receiptId).toBe(id(302));
    expect(h.issued).toBe(2);
    expect(h.candidates).toHaveLength(1);
    expect(result.next.values['initialState']).toMatchObject({
      poisonModeFactIds: { kind: 'ENTERED', value: [id(200)] },
    });
    expect(storage.canonical(result.next.values)).not.toMatch(
      /startsAt|durationMinutes|pendingSwitch/,
    );
    expect(basisBytes(h.basis)).toBe(before);
  });
  it('rejects wrong-stage or unlearned mode intent and a cloned source token before allocation', () => {
    const h = harness({ stage: 'NPC-016', mode: 'NONE' }),
      request = h.modeRequest();
    if (request.preparation.kind !== 'POISON_MODE_SET') throw Error('Mode request required');
    const unlearned = h.request(
      {
        kind: 'POISON_MODE_SET',
        input: { ...request.preparation.input, poisonProfileId: 'POI-TAIPAN-PARALYTIC' },
      },
      'NPC-016',
    );
    expect(() => h.api.prepare(unlearned, h.context(unlearned), h.allocate, stamp)).toThrow(
      /learned source profile/,
    );
    h.setBasis({ ...h.basis, attempt: { ...h.attempt, stage: 'NPC-015' } });
    expect(() => h.api.selection(request, h.basis.attempt, h.calendar)).toThrow(/form changed/);
    const clone = harness();
    clone.setBasis({
      ...clone.basis,
      modes: clone.basis.modes.map((token) => structuredClone(token)),
    });
    expect(() => clone.api.inspect(clone.attempt, clone.calendar)).toThrow();
    expect(h.issued).toBe(0);
    expect(clone.issued).toBe(0);
  });
  it('checks source eligibility again even when a retained mode is given a copied UI capability', () => {
    const h = harness({ stage: 'NPC-016', mode: 'COMMITTED' }),
      request = h.modeRequest();
    expect(h.api.inspect(h.attempt, h.calendar)?.modePreparations[0]?.canSubmit).toBe(false);
    expect(() => h.api.prepare(request, h.context(request), h.allocate, stamp)).toThrow(
      /committed mode/,
    );
    // A caller can copy a capability; it cannot override actual prior-version source ancestry.
    h.setBasis({ ...h.basis, previousVersionCompositionProofOrNull: h.input.compositionProof });
    expect(h.api.inspect(h.attempt, h.calendar)?.modePreparations).toEqual([]);
    expect(() => h.api.prepare(request, h.context(request), h.allocate, stamp)).toThrow(
      /retained or missing source/,
    );
    expect(h.issued).toBe(0);
    expect(h.candidates).toEqual([]);
  });
  it('blocks coating without time and refuses stale capability before allocating', () => {
    const h = harness({ time: null });
    expect(h.api.inspect(h.attempt, h.calendar)?.coatingPreparations[0]?.canSubmit).toBe(false);
    const request = h.doseRequest();
    expect(() => h.api.prepare(request, h.context(request), h.allocate, stamp)).toThrow(
      /initial time/,
    );
    const fresh = harness(),
      freshRequest = fresh.doseRequest();
    fresh.setBasis({ ...fresh.basis, sourceSignature: { owningPrefix: id(999) } });
    expect(() =>
      fresh.api.prepare(freshRequest, fresh.context(freshRequest), fresh.allocate, stamp),
    ).toThrow(/capability changed/);
    expect(h.issued).toBe(0);
    expect(fresh.issued).toBe(0);
  });
  it('requires exact surface and replacement consent and allocates only the new physical dose', () => {
    for (const existing of [false, true]) {
      const h = harness({ dose: existing }),
        request = h.doseRequest(),
        before = basisBytes(h.basis);
      if (request.preparation.kind !== 'POISON_COATING_PREPARE')
        throw Error('Dose request required');
      const input = request.preparation.input;
      for (const altered of [
        { ...input, surfaceConfirmed: false },
        { ...input, replaceConfirmed: !existing },
        { ...input, replacesCoatingIdOrNull: existing ? null : id(999) },
      ]) {
        const hostile = h.request({ kind: 'POISON_COATING_PREPARE', input: altered });
        expect(() => h.api.prepare(hostile, h.context(hostile), h.allocate, stamp)).toThrow();
      }
      expect(h.issued).toBe(0);
      const result = h.api.prepare(request, h.context(request), h.allocate, stamp);
      expect(result.childAllocations).toEqual([
        { kind: 'COATING_INSTANCE', id: id(301), itemInstanceId: id(84), sourceInstanceId: id(70) },
      ]);
      expect(result.next.values['inventory']).toMatchObject({
        kind: 'ENTERED',
        value: [
          {
            itemInstanceId: id(84),
            input: { coatingInstanceIds: { kind: 'ENTERED', value: [id(301)] } },
          },
        ],
      });
      expect(h.issued).toBe(2);
      expect(basisBytes(h.basis)).toBe(before);
    }
  });
  it('removes the exact selected dose without a child allocation or rewriting its origin', () => {
    const h = harness({ dose: true }),
      request = h.removeRequest(),
      before = basisBytes(h.basis);
    expect(h.api.inspect(h.attempt, h.calendar)?.coatingStates[0]).toMatchObject({
      canRemove: true,
      errors: [],
    });
    const result = h.api.prepare(request, h.context(request), h.allocate, stamp);
    expect(result.childAllocations).toEqual([]);
    expect(h.issued).toBe(1);
    expect(result.receiptId).toBe(id(301));
    expect(result.next.values['inventory']).toMatchObject({
      kind: 'ENTERED',
      value: [
        { itemInstanceId: id(84), input: { coatingInstanceIds: { kind: 'ENTERED', value: [] } } },
      ],
    });
    expect(basisBytes(h.basis)).toBe(before);
  });
  it('shows only original stale-dose facts and permits explicit removal without a current payload', () => {
    const h = harness({ dose: true, staleDose: true }),
      before = basisBytes(h.basis),
      view = h.api.inspect(h.attempt, h.calendar);
    expect(h.basis.coatings).toEqual([]);
    expect(view?.coatingStates).toHaveLength(1);
    expect(view?.coatingStates[0]).toMatchObject({
      coatingInstanceId: id(85),
      targetItemInstanceId: id(84),
      canRemove: true,
      errors: ['Подтверждение времени изменилось; исходная доза не переподтверждена.'],
      explanation: 'Подтверждение времени изменилось; исходная доза не переподтверждена.',
    });
    const rows = view?.coatingStates[0]?.derivedRows ?? [];
    expect(rows).toContainEqual({ label: 'Исходная минута подготовки', value: '37' });
    expect(rows.some((row) => row.label === 'Текущий или закреплённый уровень')).toBe(false);
    const request = h.removeRequest();
    const result = h.api.prepare(request, h.context(request), h.allocate, stamp);
    expect(result.childAllocations).toEqual([]);
    expect(h.issued).toBe(1);
    expect(result.next.values['inventory']).toMatchObject({
      kind: 'ENTERED',
      value: [{ input: { coatingInstanceIds: { kind: 'ENTERED', value: [] } } }],
    });
    expect(basisBytes(h.basis)).toBe(before);
  });
  it('replaces a stale selected dose only with its exact identity and fresh explicit consent', () => {
    const h = harness({ dose: true, staleDose: true }),
      before = basisBytes(h.basis),
      request = h.doseRequest();
    if (request.preparation.kind !== 'POISON_COATING_PREPARE') throw Error('Dose request required');
    expect(request.preparation.input.replacesCoatingIdOrNull).toBe(id(85));
    const unconfirmed = h.request({
      kind: 'POISON_COATING_PREPARE',
      input: { ...request.preparation.input, replaceConfirmed: false },
    });
    expect(() => h.api.prepare(unconfirmed, h.context(unconfirmed), h.allocate, stamp)).toThrow();
    expect(h.issued).toBe(0);
    const result = h.api.prepare(request, h.context(request), h.allocate, stamp);
    expect(result.childAllocations).toEqual([
      { kind: 'COATING_INSTANCE', id: id(301), itemInstanceId: id(84), sourceInstanceId: id(70) },
    ]);
    expect(result.next.values['inventory']).toMatchObject({
      kind: 'ENTERED',
      value: [{ input: { coatingInstanceIds: { kind: 'ENTERED', value: [id(301)] } } }],
    });
    expect(h.issued).toBe(2);
    expect(basisBytes(h.basis)).toBe(before);
  });
  it('refuses falsely stale, committed, cloned or duplicate original evidence before any allocation', () => {
    const committed = harness({ dose: true }).basis.coatings[0];
    if (committed === undefined) throw Error('Actual committed source token required');
    for (const kind of ['UNCHANGED_CLOCK', 'COMMITTED', 'CLONED', 'DUPLICATE'] as const) {
      const h = harness({ dose: true, staleDose: true });
      const entry = h.basis.staleCoatings?.[0];
      if (entry === undefined) throw Error('Actual original preparation required');
      h.setBasis({
        ...h.basis,
        coatings: kind === 'DUPLICATE' ? [entry.original] : [],
        staleCoatings: [
          {
            ...entry,
            original:
              kind === 'COMMITTED'
                ? committed
                : kind === 'CLONED'
                  ? structuredClone(entry.original)
                  : entry.original,
            originalClock:
              kind === 'UNCHANGED_CLOCK' ? h.calendar.currentClock : entry.originalClock,
          },
        ],
      });
      expect(() => h.api.inspect(h.attempt, h.calendar)).toThrow();
      expect(h.issued).toBe(0);
      expect(h.candidates).toEqual([]);
    }
  });
  it('propagates owning candidate refusal before issuing a receipt and preserves predecessor bytes', () => {
    const h = harness(),
      request = h.doseRequest(),
      before = basisBytes(h.basis);
    h.rejectCandidate();
    expect(() => h.api.prepare(request, h.context(request), h.allocate, stamp)).toThrow(
      /owning candidate source/,
    );
    expect(h.candidates).toHaveLength(1);
    expect(h.issued).toBe(1);
    expect(basisBytes(h.basis)).toBe(before);
  });
  it('replays exact accepted values and allocation at the historical clock and rejects changed event or predecessor', () => {
    const h = harness({ dose: true }),
      request = h.removeRequest(),
      context = h.context(request);
    const prepared = h.api.prepare(request, context, h.allocate, stamp);
    const event: NpcAttemptEvent = {
      format: 'NPC_ATTEMPT_EVENT_V2',
      operationId: request.operationId,
      previousSha256OrNull: storage.sha(storage.canonical(h.previous)),
      attempt: prepared.next,
      childAllocations: prepared.childAllocations ?? [],
    };
    const operation: NpcOperation = {
      operationId: request.operationId,
      receiptId: prepared.receiptId,
      kind: 'REPLACE',
      scope: h.attempt.scope,
      request: json(request),
      attemptEventSha256: storage.sha(storage.canonical(event)),
      versionOrNull: null,
      anchorOrNull: null,
      beforeGmSource: context.beforeGmSource,
      beforeCheckpoint: context.checkpoint,
      afterCheckpoint: context.checkpoint,
      committedAt: stamp,
    };
    const currentCalendar = {
      ...h.calendar,
      currentClock: { ...h.calendar.currentClock, campaignTimestampOrNull: 38 },
    };
    const before = storage.canonical({ event, operation, previous: h.previous });
    expect(h.api.apply(operation, event, h.previous, h.readContext, currentCalendar)).toEqual(
      prepared.next.values,
    );
    expect(h.historicalReads).toEqual([request.operationId]);
    expect(h.issued).toBe(1);
    expect(h.candidates).toHaveLength(2);
    expect(() =>
      h.api.apply(
        operation,
        { ...event, attempt: { ...event.attempt, revision: 99 } },
        h.previous,
        h.readContext,
        currentCalendar,
      ),
    ).toThrow(/event changed/);
    expect(() =>
      h.api.apply(
        operation,
        {
          ...event,
          childAllocations: [
            {
              kind: 'COATING_INSTANCE',
              id: id(399),
              itemInstanceId: id(84),
              sourceInstanceId: id(70),
            },
          ],
        },
        h.previous,
        h.readContext,
        currentCalendar,
      ),
    ).toThrow(/allocation changed/);
    expect(() =>
      h.api.apply(
        operation,
        event,
        h.previous,
        { ...h.readContext, npcDraftId: id(999) },
        currentCalendar,
      ),
    ).toThrow(/predecessor/);
    expect(storage.canonical({ event, operation, previous: h.previous })).toBe(before);
    expect(h.issued).toBe(1);
  });
});
