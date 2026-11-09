import type Database from 'better-sqlite3';
import {
  deriveNpcTaipanModeContribution,
  deriveNpcPoisonSourceContribution,
  npcTaipanInitialModeChoices,
  npcTaipanModeSourceRoster,
  readNpcTaipanModeContribution,
  type NpcPoisonSourceCatalog,
  type NpcTaipanModeContribution,
  type NpcTaipanModeHistoryAnchor,
  type NpcPoisonSourceObservation,
  type NpcPoisonLifeObservation,
  type NpcPoisonOrigin,
} from '../domain/rules/npc-authoring/formal-poison-source.js';
import {
  deriveNpcPreparedPoisonCoating,
  validateNpcPreparedPoisonCoating,
  readNpcPoisonCoatingContribution,
  deriveNpcPoisonPreparationEvidence,
  type NpcFormalPoisonCatalog,
  type NpcPoisonCoatingContribution,
  type NpcPoisonCoatingPreparation,
  type NpcInventoryCoatingContext,
  type NpcPoisonPreparationHistoryEvent,
} from '../domain/rules/npc-authoring/formal-poison-coating.js';
import {
  readNpcInventoryPhysicalBasis,
  buildNpcInventoryPhysicalBasis,
  npcInventoryPublicationSource,
  type NpcInventoryPhysicalBasis,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationContext,
} from '../domain/rules/npc-authoring/inventory-publication.js';
import type { NpcFormalLifeState } from '../domain/rules/npc-authoring/formal-life-state.js';
import {
  readNpcEditorDraft,
  projectNpcInventoryRequest,
  type NpcEditorCatalog,
  type NpcEditorDraft,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcInitialTraumaCalendarAnchor } from '../domain/rules/npc-authoring/initial-trauma.js';
import {
  deriveNpcInitialTaipanModeStates,
  npcHumanoidPoisonProofForTarget,
  type NpcHumanoidPoisonContext,
} from '../domain/rules/npc-authoring/taipan-mode-state.js';
import {
  readNpcPoisonPreparationEvidenceInTransaction,
  readNpcRuntimeEffectReservationEvidenceInTransaction,
  readNpcCoatingReservationEvidenceInTransaction,
  readNpcInventoryHistoryEvidenceInTransaction,
  readNpcCompositionDerivationEvidenceInTransaction,
} from '../persistence/npc-gm-source.js';
import type {
  NpcAttempt,
  NpcCalendarReadContext,
  NpcOperation,
} from '../persistence/npc-library-records.js';
import type { NpcAttemptReadContext } from '../persistence/npc-child-identities.js';
import { npcEditorForItemAttempt } from './npc-item-preparation.js';
import type { NpcPoisonCandidate } from './npc-poison-preparation.js';
import type { JsonObject } from '../shared/wire-protocol.js';
import {
  npcTechnicalRequestValue,
  npcPoisonModeSetRequestInputValue,
  npcPoisonCoatingPreparationRequestInputValue,
  npcPoisonCoatingRemovalRequestInputValue,
} from '../shared/npc-command.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';

export interface NpcPoisonReadBasis {
  readonly attempt: NpcAttempt;
  readonly draft: NpcEditorDraft;
  readonly editor: NpcEditorCatalog;
  readonly readContext: NpcAttemptReadContext;
  readonly evidence: ReturnType<typeof readNpcCompositionDerivationEvidenceInTransaction>;
  readonly compositionProof: unknown;
  readonly previousVersionCompositionProofOrNull: unknown;
  readonly physicalInventory: NpcInventoryPhysicalBasis;
  readonly inventoryHistory: NpcInventoryPublicationContext | null;
}
type Commit = Readonly<{ operationId: string; committedAt: string }>;
type HistoricalCoatingSelection = Readonly<{
  entries: readonly Readonly<{ itemInstanceId: string; coatingInstanceIds: readonly string[] }>[];
  prefix: NpcPoisonReadBasis['evidence']['current'];
}>;
/** Missing current authoring choice only; historical/candidate integrity errors never use this type. */
export class NpcPoisonReadInputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = new.target.name;
  }
}
/** The original preparation was independently proved; only its current clock became stale. */
export class NpcPoisonPreparationClockChangedError extends NpcPoisonReadInputError {
  constructor(
    readonly original: NpcPoisonCoatingContribution,
    readonly originalClock: NpcCalendarReadContext['currentClock'],
  ) {
    super('Время исходной подготовки изменилось. Снимите дозу с причиной или явно замените её.');
  }
}
function fail(detail: string): never {
  throw new Error(`NPC poison owning proof: ${detail}`);
}
function equal(a: unknown, b: unknown, detail: string): void {
  if (!s.same(a, b)) fail(detail);
}
function modeIds(draft: NpcEditorDraft): readonly string[] | null {
  const section = draft.initialState.poisonModeFactIds;
  if (section === undefined) return null;
  if (section.kind !== 'ENTERED') return fail('explicit mode selection required');
  const ids = section.value.map((id) => s.uuid(id));
  if (new Set(ids).size !== ids.length) return fail('repeated selected mode operation');
  return ids;
}

/** Source histories are reconstructed from actual operation prefixes, never from candidate payloads. */
export function createNpcPoisonReaders(
  options: Readonly<{
    db: Database.Database;
    source: NpcPoisonSourceCatalog | null;
    catalog: NpcFormalPoisonCatalog | null;
    publication: NpcInventoryPublicationCatalog;
    read: (attempt: NpcAttempt, calendar: NpcCalendarReadContext) => NpcPoisonReadBasis;
    composition: (attempt: NpcAttempt, calendar: NpcCalendarReadContext) => unknown;
    life: (
      attempt: NpcAttempt,
      calendar: NpcCalendarReadContext,
      commit: Commit | null,
    ) => NpcFormalLifeState | null;
    historicalCalendar: (
      operation: NpcOperation,
      calendar: NpcCalendarReadContext,
    ) => NpcCalendarReadContext;
    calendarAnchor: (calendar: NpcCalendarReadContext) => NpcInitialTraumaCalendarAnchor;
  }>,
) {
  function catalogs() {
    return {
      source: options.source ?? fail('approved poison source missing'),
      catalog: options.catalog ?? fail('approved coating source missing'),
    };
  }
  function originalMode(
    attempt: NpcAttempt,
    operationId: string,
    calendar: NpcCalendarReadContext,
  ) {
    const actual = readNpcPoisonPreparationEvidenceInTransaction(
      options.db,
      attempt.scope,
      attempt.candidateNpcUuid,
      operationId,
    );
    if (actual.request.preparation.kind !== 'POISON_MODE_SET')
      return fail('actual mode SET required');
    const input = npcPoisonModeSetRequestInputValue(actual.request.preparation.input);
    const atSet = options.historicalCalendar(actual.operation, calendar);
    const before = options.read(actual.evidence.current.openAttempt, atSet);
    const choice =
      npcTaipanInitialModeChoices(catalogs().source, {
        npcUuid: attempt.candidateNpcUuid,
        compositionProof: before.compositionProof,
        previousVersionCompositionProofOrNull: before.previousVersionCompositionProofOrNull,
      }).find((row) => row.sourceInstanceId === input.sourceInstanceId) ??
      fail('original new Taipan missing');
    const children = actual.event.childAllocations;
    const child = children[0];
    if (
      children.length !== 1 ||
      child?.kind !== 'EFFECT_INSTANCE' ||
      !('sourceKind' in child) ||
      child.sourceKind !== 'POISON_MODE' ||
      child.sourceInstanceId !== input.sourceInstanceId
    )
      return fail('actual mode effect allocation differs');
    const history: NpcTaipanModeHistoryAnchor = {
      kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE',
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      sourceInstanceId: input.sourceInstanceId,
      acquisitionFactId: choice.acquisitionFactId,
      modeOperationId: operationId,
      effectInstanceId: child.id,
      activePoisonProfileId: input.poisonProfileId,
      pendingSwitchOrNull: null,
      reason: input.reason,
      createdAt: actual.operation.committedAt,
    };
    // Prove the initial assignment at its original source boundary before projecting a later source.
    deriveNpcTaipanModeContribution(catalogs().source, history, {
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      campaignTimestampOrNull: atSet.currentClock.campaignTimestampOrNull,
      origin: { kind: 'PREPARED', preparationOperationId: operationId },
      originalCompositionProof: before.compositionProof,
      previousVersionCompositionProofOrNull: before.previousVersionCompositionProofOrNull,
      currentCompositionProof: before.compositionProof,
    });
    return { actual, before, history };
  }
  function mode(
    attempt: NpcAttempt,
    operationId: string,
    calendar: NpcCalendarReadContext,
    commit: Commit | null = null,
  ): NpcTaipanModeContribution {
    const original = originalMode(attempt, operationId, calendar);
    const current = options.read(attempt, calendar);
    const own = current.evidence.current.poisonOperations.some(
      (row) => row.operation.operationId === operationId,
    );
    let origin: NpcPoisonOrigin;
    if (own)
      origin =
        commit === null
          ? { kind: 'PREPARED', preparationOperationId: operationId }
          : { kind: 'COMMITTED', originCommitOperationId: commit.operationId };
    else {
      const reservation = readNpcRuntimeEffectReservationEvidenceInTransaction(
        options.db,
        attempt.scope,
        attempt.candidateNpcUuid,
        original.history.effectInstanceId,
      );
      if (reservation.sourceKind !== 'POISON_MODE') return fail('retained mode allocation kind');
      const stored =
        reservation.origin.committedOrNull ?? fail('retained mode has no committed origin');
      const originCalendar = options.historicalCalendar(stored.operation, calendar);
      const originalToken = mode(
        reservation.origin.current.openAttempt,
        operationId,
        originCalendar,
        {
          operationId: stored.operation.operationId,
          committedAt: stored.operation.committedAt,
        },
      );
      const saved = s.object(s.object(s.object(stored.record['snapshot'])['sheet'])['input']);
      const states = s.object(saved['initialState'])['sourceSpecificStates'];
      if (!Array.isArray(states)) return fail('original saved source states missing');
      const expected =
        deriveNpcInitialTaipanModeStates(
          catalogs().source,
          options.read(reservation.origin.current.openAttempt, originCalendar).compositionProof,
          {
            campaignId: attempt.scope.campaignId,
            npcUuid: attempt.candidateNpcUuid,
            campaignTimestampOrNull: originCalendar.currentClock.campaignTimestampOrNull,
            targetCommitOperationIdOrNull: stored.operation.operationId,
            previousVersionCompositionProofOrNull:
              original.before.previousVersionCompositionProofOrNull,
            modes: modes(reservation.origin.current.openAttempt, originCalendar, {
              operationId: stored.operation.operationId,
              committedAt: stored.operation.committedAt,
            }),
            coatingContext: null,
          },
        ).find((row) => row.anchor.modeOperationId === operationId) ??
        fail('mode absent at original publication');
      const candidates = states.filter(
        (row: unknown) => s.object(row)['effectInstanceId'] === original.history.effectInstanceId,
      );
      equal(candidates, [expected], 'original saved mode state');
      origin = readNpcTaipanModeContribution(catalogs().source, originalToken).origin;
    }
    return deriveNpcTaipanModeContribution(catalogs().source, original.history, {
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
      origin,
      originalCompositionProof: original.before.compositionProof,
      previousVersionCompositionProofOrNull: original.before.previousVersionCompositionProofOrNull,
      currentCompositionProof: current.compositionProof,
    });
  }
  function modes(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null = null,
  ) {
    return modesFromBasis(attempt, calendar, commit, options.read(attempt, calendar));
  }
  function modesFromBasis(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null,
    basis: NpcPoisonReadBasis,
  ) {
    const ids = modeIds(basis.draft);
    if (ids === null) return [];
    const tokens = ids.map((id) => mode(attempt, id, calendar, commit));
    const bySource = new Set<string>();
    for (const token of tokens) {
      const value = readNpcTaipanModeContribution(catalogs().source, token);
      if (bySource.has(value.sourceInstanceId))
        return fail('multiple selected modes for one Taipan');
      bySource.add(value.sourceInstanceId);
    }
    return tokens;
  }
  function minute(calendar: NpcCalendarReadContext): number {
    return (
      calendar.currentClock.campaignTimestampOrNull ?? fail('confirmed coating minute missing')
    );
  }
  function timeline(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null,
    basis: NpcPoisonReadBasis = options.read(attempt, calendar),
  ) {
    const prior =
      attempt.targetOrNull === null
        ? []
        : readNpcInventoryHistoryEvidenceInTransaction(
            options.db,
            attempt.scope,
            attempt.candidateNpcUuid,
            attempt.targetOrNull.expectedCurrentVersion,
          ).map((row) => ({
            prefix: row.stored.prefix,
            commit: row.stored.operation,
            calendar: options.historicalCalendar(row.stored.operation, calendar),
          }));
    return [...prior, { prefix: basis.evidence.current, commit, calendar }];
  }
  function observations(
    attempt: NpcAttempt,
    preparationOperationId: string,
    calendar: NpcCalendarReadContext,
    commit: Commit | null,
  ): readonly NpcPoisonSourceObservation[] {
    const result: NpcPoisonSourceObservation[] = [];
    let found = false,
      knownLife = false;
    for (const segment of timeline(attempt, calendar, commit)) {
      const relevant = [
        ...segment.prefix.poisonOperations
          .filter((row) => row.operation.operationId === preparationOperationId)
          .map((row) => ({ kind: 'PREPARATION' as const, ...row })),
        ...segment.prefix.ordinaryFacts
          .filter((row) => row.fact.kind !== 'STAT_CONTEXT')
          .map((row) => ({
            kind:
              row.fact.kind === 'CONFIRMATION'
                ? ('COMPOSITION_CONFIRMATION' as const)
                : ('COMPOSITION_RESOLUTION' as const),
            ...row,
          })),
        ...segment.prefix.lifeStateOperations.map((row) => ({
          kind: 'LIFE_STATE_SET' as const,
          ...row,
        })),
      ].sort((a, b) => a.event.attempt.revision - b.event.attempt.revision);
      for (const row of relevant) {
        if (!found && row.operation.operationId !== preparationOperationId) continue;
        found = true;
        const current = options.historicalCalendar(row.operation, calendar);
        const target = row.kind === 'PREPARATION' ? row.previous : row.event.attempt;
        let life: NpcPoisonLifeObservation;
        if (row.kind === 'PREPARATION' || row.kind === 'LIFE_STATE_SET') {
          const state = options.life(target, current, null);
          if (state === null && row.kind === 'LIFE_STATE_SET')
            return fail('actual life SET lost its state');
          life = state === null ? { kind: 'NOT_CONFIRMED_DRAFT' } : { kind: 'CONFIRMED', state };
          knownLife ||= state !== null;
        } else life = knownLife ? { kind: 'CARRY_PREVIOUS' } : { kind: 'NOT_CONFIRMED_DRAFT' };
        result.push({
          operationId: row.operation.operationId,
          kind: row.kind,
          campaignTimestamp: minute(current),
          compositionProof: options.composition(target, current),
          life,
        });
      }
      if (found && segment.commit !== null) {
        const current = segment.calendar;
        const state =
          options.life(segment.prefix.openAttempt, current, segment.commit) ??
          fail('actual COMMIT life missing');
        result.push({
          operationId: segment.commit.operationId,
          kind: 'COMMIT',
          campaignTimestamp: minute(current),
          compositionProof: options.composition(segment.prefix.openAttempt, current),
          life: { kind: 'CONFIRMED', state },
        });
        knownLife = true;
      }
    }
    if (!found) return fail('coating preparation absent from actual version prefix');
    return result;
  }
  function firstPublishedCoating(
    attempt: Pick<NpcAttempt, 'scope' | 'candidateNpcUuid' | 'targetOrNull'>,
    id: string,
  ) {
    if (attempt.targetOrNull === null) return null;
    const history = readNpcInventoryHistoryEvidenceInTransaction(
      options.db,
      attempt.scope,
      attempt.candidateNpcUuid,
      attempt.targetOrNull.expectedCurrentVersion,
    );
    for (const entry of history) {
      const proof = s.object(s.object(entry.stored.record['snapshot'])['derivation'])[
        'inventoryProof'
      ];
      if (proof === undefined) continue;
      const rows = s.object(proof)['entries'];
      if (!Array.isArray(rows)) return fail('actual publication entries missing');
      const matching = rows.filter((row: unknown) => {
        const ids = s.object(s.object(row)['request'])['coatingInstanceIds'];
        if (!Array.isArray(ids)) return fail('actual publication coating selection missing');
        return ids.map((value: unknown) => s.uuid(value)).includes(id);
      });
      if (matching.length > 1) return fail('published dose has multiple carriers');
      if (matching.length === 1) return entry.stored;
    }
    return null;
  }
  function replacementProof(
    attempt: NpcAttempt,
    id: string,
    calendar: NpcCalendarReadContext,
  ): NpcPoisonCoatingContribution {
    try {
      return coating(attempt, id, calendar);
    } catch (error) {
      if (error instanceof NpcPoisonPreparationClockChangedError) return error.original;
      throw error;
    }
  }
  function coating(
    attempt: NpcAttempt,
    id: string,
    calendar: NpcCalendarReadContext,
    commit: Commit | null = null,
  ): NpcPoisonCoatingContribution {
    const current = options.read(attempt, calendar);
    const own = current.evidence.current.poisonOperations.find(
      (row) =>
        'format' in row.event &&
        row.event.childAllocations.some(
          (child) => child.kind === 'COATING_INSTANCE' && child.id === id,
        ),
    );
    const reservation =
      own === undefined
        ? readNpcCoatingReservationEvidenceInTransaction(
            options.db,
            attempt.scope,
            attempt.candidateNpcUuid,
            id,
          )
        : null;
    const operationId =
      own?.operation.operationId ??
      reservation?.operationId ??
      fail('actual coating reservation missing');
    const actual = readNpcPoisonPreparationEvidenceInTransaction(
      options.db,
      attempt.scope,
      attempt.candidateNpcUuid,
      operationId,
    );
    if (actual.request.preparation.kind !== 'POISON_COATING_PREPARE')
      return fail('coating PREPARE required');
    const input = npcPoisonCoatingPreparationRequestInputValue(actual.request.preparation.input);
    const atPrepare = options.historicalCalendar(actual.operation, calendar);
    const before = options.read(actual.evidence.current.openAttempt, atPrepare);
    const selectedMode =
      modesFromBasis(actual.evidence.current.openAttempt, atPrepare, null, before).find(
        (token) =>
          readNpcTaipanModeContribution(catalogs().source, token).sourceInstanceId ===
          input.sourceInstanceId,
      ) ?? fail('actual original mode missing');
    const child = actual.event.childAllocations[0];
    equal(
      actual.event.childAllocations,
      [
        {
          kind: 'COATING_INSTANCE',
          id,
          itemInstanceId: input.targetItemInstanceId,
          sourceInstanceId: input.sourceInstanceId,
        },
      ],
      'actual coating child',
    );
    if (child?.kind !== 'COATING_INSTANCE') return fail('coating child discriminator');
    // A draft may commit with this carrier omitted. That COMMIT archives a real
    // preparation but does not fabricate a published coating payload or origin.
    const originalCommit = own === undefined ? firstPublishedCoating(attempt, id) : null;
    const origin =
      originalCommit === null && commit === null
        ? { kind: 'PREPARED' as const, preparationOperationId: operationId }
        : {
            kind: 'COMMITTED' as const,
            originCommitOperationId: originalCommit?.operation.operationId ?? commit!.operationId,
          };
    const history: NpcPoisonCoatingPreparation = {
      kind: 'GM_FORMAL_INITIAL_POISON_COATING',
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      coatingInstanceId: id,
      preparationOperationId: operationId,
      sourceInstanceId: input.sourceInstanceId,
      targetItemInstanceId: input.targetItemInstanceId,
      surfaceConfirmed: input.surfaceConfirmed === true ? true : fail('surface not confirmed'),
      replacesCoatingIdOrNull: input.replacesCoatingIdOrNull,
      replaceConfirmed: input.replaceConfirmed,
      reason: input.reason,
      calendarAnchor: options.calendarAnchor(atPrepare),
      createdAt: actual.operation.committedAt,
      revision: 1,
    };
    if (
      originalCommit === null &&
      !s.same(
        [
          atPrepare.currentClock.phase,
          atPrepare.currentClock.campaignTimestampOrNull,
          atPrepare.currentClock.lobbySnapshotRevisionOrNull,
        ],
        [
          calendar.currentClock.phase,
          calendar.currentClock.campaignTimestampOrNull,
          calendar.currentClock.lobbySnapshotRevisionOrNull,
        ],
      )
    ) {
      // Never turn malformed history into a recoverable availability status.
      // Rebuild at the real original event and clock before exposing Remove.
      const original = coating(
        {
          scope: actual.event.scope,
          ...actual.event.ref,
          status: actual.event.status,
          values: actual.event.values,
        },
        id,
        atPrepare,
      );
      if (commit !== null)
        return fail('saved coating first publication differs from its actual preparation clock');
      throw new NpcPoisonPreparationClockChangedError(original, atPrepare.currentClock);
    }
    const currentLife = commit === null ? options.life(attempt, calendar, null) : null;
    const source = deriveNpcPoisonSourceContribution(catalogs().source, selectedMode, {
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      campaignTimestamp: minute(calendar),
      origin,
      targetCommitOperationIdOrNull: commit?.operationId ?? null,
      observations: observations(attempt, operationId, calendar, commit),
      ...(commit !== null
        ? {}
        : {
            currentTarget: {
              owningOperationId: current.evidence.current.openOperationId,
              compositionProof: current.compositionProof,
              life:
                currentLife === null
                  ? { kind: 'NOT_CONFIRMED_DRAFT' as const }
                  : { kind: 'CONFIRMED' as const, state: currentLife },
            },
          }),
    });
    const context = {
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      campaignTimestamp: minute(calendar),
      origin,
      mode: selectedMode,
      source,
      originalInventory: before.physicalInventory,
      currentInventory: current.physicalInventory,
      replaces:
        input.replacesCoatingIdOrNull === null
          ? null
          : replacementProof(
              actual.evidence.current.openAttempt,
              input.replacesCoatingIdOrNull,
              atPrepare,
            ),
    };
    if (originalCommit !== null) {
      const savedAt = options.historicalCalendar(originalCommit.operation, calendar);
      const original = coating(originalCommit.prefix.openAttempt, id, savedAt, {
        operationId: originalCommit.operation.operationId,
        committedAt: originalCommit.operation.committedAt,
      });
      const originalValue = readNpcPoisonCoatingContribution(catalogs().catalog, original);
      const savedItems = s.object(s.object(originalCommit.record['snapshot'])['sheet'])[
        'itemProfiles'
      ];
      if (!Array.isArray(savedItems)) return fail('original item profiles missing');
      const savedItem: unknown = savedItems.find(
        (row: unknown) =>
          s.object(s.object(row)['item'])['itemInstanceId'] === input.targetItemInstanceId,
      );
      if (savedItem === undefined) return fail('original carrier missing');
      const savedCoatings = s.object(s.object(savedItem)['item'])['activeCoatings'];
      if (!Array.isArray(savedCoatings)) return fail('original coating payload missing');
      const candidates = savedCoatings.filter(
        (row: unknown) => s.object(row)['coatingInstanceId'] === id,
      );
      if (candidates.length !== 1) return fail('one original coating payload required');
      validateNpcPreparedPoisonCoating(
        catalogs().catalog,
        candidates[0],
        originalValue.preparation,
        originalValue.context,
      );
    }
    return deriveNpcPreparedPoisonCoating(catalogs().catalog, history, context);
  }
  /** One ordered selection fold serves both full publication and readonly editor enforcement. */
  function expectedSelections(
    prefix: NpcPoisonReadBasis['evidence']['current'],
    history: readonly HistoricalCoatingSelection[],
  ) {
    const expected = new Map<string, readonly string[]>();
    function apply(actual: NpcPoisonReadBasis['evidence']['current']) {
      for (const row of actual.poisonOperations) {
        const request = npcTechnicalRequestValue(row.operation.request);
        if (request.messageType !== 'network.npc-preparation.request')
          return fail('poison request missing');
        if (request.preparation.kind === 'POISON_COATING_PREPARE') {
          const input = npcPoisonCoatingPreparationRequestInputValue(request.preparation.input);
          const children = 'format' in row.event ? row.event.childAllocations : [];
          const child = children[0];
          if (children.length !== 1 || child?.kind !== 'COATING_INSTANCE')
            return fail('coating child missing');
          equal(
            expected.get(input.targetItemInstanceId) ?? [],
            input.replacesCoatingIdOrNull === null ? [] : [input.replacesCoatingIdOrNull],
            'coating predecessor selection',
          );
          expected.set(input.targetItemInstanceId, [child.id]);
        } else if (request.preparation.kind === 'POISON_COATING_REMOVE') {
          const input = npcPoisonCoatingRemovalRequestInputValue(request.preparation.input);
          const match =
            [...expected].find(([, ids]) => ids.includes(input.coatingInstanceId)) ??
            fail('removed coating was not selected');
          expected.set(match[0], []);
        }
      }
    }
    for (const version of history) {
      apply(version.prefix);
      // Published rows verify the journal; they do not replace its omitted-item
      // history. A durable replacement/removal must survive an unselected carrier.
      for (const item of version.entries) {
        equal(
          item.coatingInstanceIds,
          expected.get(item.itemInstanceId) ?? [],
          'historical published coating selection differs from its operation prefix',
        );
        if (!expected.has(item.itemInstanceId)) expected.set(item.itemInstanceId, []);
      }
    }
    apply(prefix);
    return expected;
  }
  function selectionHistory(
    attempt: NpcAttempt,
    inherited: NpcAttemptReadContext['inheritedVersionOrNull'],
  ): readonly HistoricalCoatingSelection[] {
    const history =
      inherited === null
        ? []
        : readNpcInventoryHistoryEvidenceInTransaction(
            options.db,
            attempt.scope,
            attempt.candidateNpcUuid,
            inherited.version,
          );
    if (inherited !== null) equal(history.at(-1)?.version, inherited, 'editor prior version');
    const historicalSelections = history.map(({ stored }): HistoricalCoatingSelection => {
      const snapshot = s.object(stored.record['snapshot']);
      const derivation = s.object(snapshot['derivation']);
      const proof = derivation['inventoryProof'];
      const entries = () => {
        if (proof === undefined) {
          equal(
            s.object(s.object(snapshot['sheet'])['input'])['inventory'],
            [],
            'no unproved prior inventory',
          );
          return [];
        }
        const rows = s.object(proof)['entries'];
        if (!Array.isArray(rows)) return fail('actual prior inventory entries required');
        return rows.map((entry: unknown) => {
          const request = s.object(s.object(entry)['request']);
          const ids = request['coatingInstanceIds'];
          if (!Array.isArray(ids)) return fail('actual prior coating selection required');
          return {
            itemInstanceId: s.uuid(request['itemInstanceId']),
            coatingInstanceIds: ids.map((id: unknown) => s.uuid(id)),
          };
        });
      };
      return { entries: entries(), prefix: stored.prefix };
    });
    return historicalSelections;
  }
  function validateEditorSelection(
    previous: JsonObject,
    next: NpcEditorDraft,
    readContext: NpcAttemptReadContext,
  ): void {
    // No historical dose exists in this exact checked prefix. The closed editor
    // still refuses caller-invented nonempty selections and unallocated IDs.
    if ((readContext.coatingBindings?.length ?? 0) === 0) return;
    const inherited = readContext.inheritedVersionOrNull;
    const before: NpcAttempt = {
      scope: readContext.scope,
      npcDraftId: readContext.npcDraftId,
      candidateNpcUuid: readContext.candidateNpcUuid,
      revision: readContext.revision,
      mode: inherited === null ? 'CREATE_V1' : 'APPEND_N_PLUS_ONE',
      targetOrNull:
        inherited === null
          ? null
          : { npcUuid: inherited.npcUuid, expectedCurrentVersion: inherited.version },
      stage: 'NPC-015',
      status: 'OPEN',
      values: previous,
    };
    // The primitive reader compares this whole envelope and the real operation
    // prefix. It works during historical replay without reading a later head.
    const evidence = readNpcCompositionDerivationEvidenceInTransaction(options.db, before);
    equal(
      evidence.current.openOperationId,
      readContext.operationId,
      'editor predecessor operation',
    );
    const historicalSelections = selectionHistory(before, inherited);
    const expected = expectedSelections(evidence.current, historicalSelections);
    // Whole-item omission is valid. Only selected readonly IDs are checked here;
    // other UNSET editor fields need neither a physical preview nor a clock.
    for (const row of next.inventory.kind === 'ENTERED' ? next.inventory.value : []) {
      const actual = expected.get(row.itemInstanceId) ?? [];
      const supplied = row.input.coatingInstanceIds;
      if (actual.length !== 0 || supplied.kind === 'ENTERED')
        equal(
          supplied,
          { kind: 'ENTERED', value: actual },
          'editor coating selection differs from actual history',
        );
    }
  }
  function selectedCoatingIds(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    current: NpcPoisonReadBasis = options.read(attempt, calendar),
  ) {
    const physical = readNpcInventoryPhysicalBasis(options.publication, current.physicalInventory);
    const expected = expectedSelections(
      current.evidence.current,
      selectionHistory(attempt, current.readContext.inheritedVersionOrNull),
    );
    const ids = physical.requests.flatMap((row) => {
      equal(
        row.coatingInstanceIds,
        expected.get(row.itemInstanceId) ?? [],
        'coating selection differs from complete operation history',
      );
      return row.coatingInstanceIds;
    });
    if (new Set(ids).size !== ids.length) return fail('coating selected on multiple items');
    return ids;
  }
  function selectedCoatings(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null = null,
  ) {
    return selectedCoatingsFromBasis(attempt, calendar, commit, undefined);
  }
  function selectedCoatingsFromBasis(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null,
    basis: NpcPoisonReadBasis | undefined,
  ) {
    const ids = selectedCoatingIds(attempt, calendar, basis);
    return ids.map((id) => coating(attempt, id, calendar, commit));
  }
  function preparationSelection(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    const coatings: NpcPoisonCoatingContribution[] = [];
    const staleCoatings: Array<
      Readonly<{
        kind: 'PREPARATION_CLOCK_CHANGED';
        original: NpcPoisonCoatingContribution;
        originalClock: NpcCalendarReadContext['currentClock'];
        explanation: string;
      }>
    > = [];
    for (const id of selectedCoatingIds(attempt, calendar)) {
      try {
        coatings.push(coating(attempt, id, calendar));
      } catch (error) {
        if (!(error instanceof NpcPoisonPreparationClockChangedError)) throw error;
        staleCoatings.push({
          kind: 'PREPARATION_CLOCK_CHANGED',
          original: error.original,
          originalClock: error.originalClock,
          explanation: error.message,
        });
      }
    }
    return { coatings, staleCoatings };
  }
  function preparationHistory(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    basis?: NpcPoisonReadBasis,
  ): readonly NpcPoisonPreparationHistoryEvent[] {
    return timeline(attempt, calendar, null, basis).flatMap(({ prefix }) =>
      prefix.poisonOperations.flatMap((row): readonly NpcPoisonPreparationHistoryEvent[] => {
        const request = npcTechnicalRequestValue(row.operation.request);
        if (
          request.messageType === 'network.npc-preparation.request' &&
          request.preparation.kind === 'POISON_COATING_PREPARE'
        ) {
          const children = 'format' in row.event ? row.event.childAllocations : [];
          const child = children[0];
          if (children.length !== 1 || child?.kind !== 'COATING_INSTANCE')
            return fail('archived preparation actual child missing');
          const original = readNpcPoisonCoatingContribution(
            catalogs().catalog,
            coating(
              row.event.attempt,
              child.id,
              options.historicalCalendar(row.operation, calendar),
            ),
          );
          return [
            {
              kind: 'PREPARE',
              preparation: deriveNpcPoisonPreparationEvidence(
                catalogs().catalog,
                original.preparation,
                {
                  mode: original.context.mode,
                  source: original.context.source,
                  originalInventory: original.context.originalInventory,
                  replaces: original.context.replaces,
                },
              ),
            },
          ];
        }
        if (
          request.messageType !== 'network.npc-preparation.request' ||
          request.preparation.kind !== 'POISON_COATING_REMOVE'
        )
          return [];
        const input = npcPoisonCoatingRemovalRequestInputValue(request.preparation.input);
        const actual = readNpcPoisonPreparationEvidenceInTransaction(
          options.db,
          attempt.scope,
          attempt.candidateNpcUuid,
          row.operation.operationId,
        );
        const before = options.read(
          actual.evidence.current.openAttempt,
          options.historicalCalendar(actual.operation, calendar),
        );
        const item =
          readNpcInventoryPhysicalBasis(
            options.publication,
            before.physicalInventory,
          ).requests.find((entry) => entry.coatingInstanceIds.includes(input.coatingInstanceId)) ??
          fail('removed physical coating missing');
        return [
          {
            kind: 'REMOVE',
            removal: {
              kind: 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL' as const,
              campaignId: attempt.scope.campaignId,
              npcUuid: attempt.candidateNpcUuid,
              coatingInstanceId: input.coatingInstanceId,
              targetItemInstanceId: item.itemInstanceId,
              sourceOperationId: row.operation.operationId,
              reason: input.reason,
              createdAt: row.operation.committedAt,
            },
          },
        ];
      }),
    );
  }
  function inventoryContext(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null = null,
  ) {
    return inventoryContextFromBasis(attempt, calendar, commit, undefined);
  }
  function inventoryContextFromBasis(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null,
    basis: NpcPoisonReadBasis | undefined,
  ) {
    if (!Object.hasOwn(s.object(s.object(attempt.values)['initialState']), 'poisonModeFactIds'))
      return null;
    const selected = selectedCoatingsFromBasis(attempt, calendar, commit, basis);
    const history = preparationHistory(attempt, calendar, basis);
    const removed = history.flatMap((row) => (row.kind === 'REMOVE' ? [row.removal] : []));
    return (
      selected.length === 0 && history.length === 0
        ? null
        : {
            catalog: catalogs().catalog,
            campaignId: attempt.scope.campaignId,
            npcUuid: attempt.candidateNpcUuid,
            campaignTimestamp: minute(calendar),
            targetCommitOperationIdOrNull: commit?.operationId ?? null,
            contributions: selected,
            removals: removed,
            preparationHistory: history,
          }
    ) satisfies NpcInventoryCoatingContext | null;
  }
  function context(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Commit | null = null,
  ) {
    if (!Object.hasOwn(s.object(s.object(attempt.values)['initialState']), 'poisonModeFactIds'))
      return null;
    // Share only this invocation's checked current prefix. Historical mode/coating reads
    // still rebuild their own attempt and calendar; no cross-call cache is introduced.
    const basis = options.read(attempt, calendar);
    const coatingContext = inventoryContextFromBasis(attempt, calendar, commit, basis);
    const poison: NpcHumanoidPoisonContext = {
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
      targetCommitOperationIdOrNull: commit?.operationId ?? null,
      previousVersionCompositionProofOrNull: basis.previousVersionCompositionProofOrNull,
      modes: modesFromBasis(attempt, calendar, commit, basis),
      coatingContext,
    };
    if (commit === null) {
      const selected = new Set(
        poison.modes.map(
          (token) => readNpcTaipanModeContribution(catalogs().source, token).sourceInstanceId,
        ),
      );
      const missing = npcTaipanModeSourceRoster(catalogs().source, {
        npcUuid: attempt.candidateNpcUuid,
        compositionProof: basis.compositionProof,
      }).filter((id) => !selected.has(id));
      if (missing.length !== 0)
        throw new NpcPoisonReadInputError(
          'Для каждого Тайпана нужен подтверждённый начальный режим яда. Выберите его на NPC-016; сохранённый режим без доказанного источника не восстанавливается автоматически. Не подтверждены: ' +
            missing.join(', '),
        );
    }
    const states = deriveNpcInitialTaipanModeStates(
      catalogs().source,
      basis.compositionProof,
      poison,
    );
    return {
      context: poison,
      states,
      proof: commit === null ? null : npcHumanoidPoisonProofForTarget(states, commit.operationId),
    };
  }
  function validateCandidate(candidate: NpcPoisonCandidate): void {
    const { request, calendar, next, childAllocations: children, committedAt } = candidate;
    const before = options.read(candidate.basis.attempt, calendar);
    equal(
      [before.attempt, before.compositionProof, before.readContext],
      [candidate.basis.attempt, candidate.basis.compositionProof, candidate.basis.readContext],
      'candidate actual source boundary',
    );
    const child = children[0];
    const context: NpcAttemptReadContext = {
      ...before.readContext,
      ...(child?.kind !== 'COATING_INSTANCE'
        ? {}
        : {
            pendingCoatingOrNull: {
              coatingInstanceId: child.id,
              itemInstanceId: child.itemInstanceId,
              sourceInstanceId: child.sourceInstanceId,
              operationId: request.operationId,
              npcDraftId: before.attempt.npcDraftId,
            },
          }),
    };
    const editor = npcEditorForItemAttempt(
      before.editor,
      npcInventoryPublicationSource(options.publication),
      context,
    );
    const draft = readNpcEditorDraft(editor, next.values);
    equal(
      [next.scope, next.npcDraftId, next.candidateNpcUuid, next.revision, next.status, next.stage],
      [
        before.attempt.scope,
        before.attempt.npcDraftId,
        before.attempt.candidateNpcUuid,
        before.attempt.revision + 1,
        'OPEN',
        before.attempt.stage,
      ],
      'candidate attempt envelope',
    );
    if (request.preparation.kind === 'POISON_MODE_SET') {
      const input = npcPoisonModeSetRequestInputValue(request.preparation.input);
      if (
        children.length !== 1 ||
        child?.kind !== 'EFFECT_INSTANCE' ||
        !('sourceKind' in child) ||
        child.sourceKind !== 'POISON_MODE' ||
        child.sourceInstanceId !== input.sourceInstanceId
      )
        return fail('candidate mode identity');
      const choice =
        npcTaipanInitialModeChoices(catalogs().source, {
          npcUuid: before.attempt.candidateNpcUuid,
          compositionProof: before.compositionProof,
          previousVersionCompositionProofOrNull: before.previousVersionCompositionProofOrNull,
        }).find((row) => row.sourceInstanceId === input.sourceInstanceId) ??
        fail('new mode source missing');
      const old = modes(before.attempt, calendar).map((token) =>
        readNpcTaipanModeContribution(catalogs().source, token),
      );
      if (
        old.some(
          (row) =>
            row.sourceInstanceId === input.sourceInstanceId && row.origin.kind === 'COMMITTED',
        )
      )
        return fail('retained initial mode cannot be reassigned');
      equal(
        modeIds(draft),
        old.some((row) => row.sourceInstanceId === input.sourceInstanceId)
          ? old.map((row) =>
              row.sourceInstanceId === input.sourceInstanceId
                ? request.operationId
                : row.modeOperationId,
            )
          : [...old.map((row) => row.modeOperationId), request.operationId],
        'candidate selected mode IDs',
      );
      deriveNpcTaipanModeContribution(
        catalogs().source,
        {
          kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE',
          campaignId: before.attempt.scope.campaignId,
          npcUuid: before.attempt.candidateNpcUuid,
          sourceInstanceId: input.sourceInstanceId,
          acquisitionFactId: choice.acquisitionFactId,
          modeOperationId: request.operationId,
          effectInstanceId: child.id,
          activePoisonProfileId: input.poisonProfileId,
          pendingSwitchOrNull: null,
          reason: input.reason,
          createdAt: committedAt,
        },
        {
          campaignId: before.attempt.scope.campaignId,
          npcUuid: before.attempt.candidateNpcUuid,
          campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
          origin: { kind: 'PREPARED', preparationOperationId: request.operationId },
          originalCompositionProof: before.compositionProof,
          previousVersionCompositionProofOrNull: before.previousVersionCompositionProofOrNull,
          currentCompositionProof: before.compositionProof,
        },
      );
      return;
    }
    const selection = preparationSelection(before.attempt, calendar);
    const selected = [...selection.coatings, ...selection.staleCoatings.map((row) => row.original)];
    if (request.preparation.kind === 'POISON_COATING_REMOVE') {
      equal(children, [], 'coating removal allocates no identity');
      const input = npcPoisonCoatingRemovalRequestInputValue(request.preparation.input);
      const old =
        selected.find(
          (token) =>
            readNpcPoisonCoatingContribution(catalogs().catalog, token).coating
              .coatingInstanceId === input.coatingInstanceId,
        ) ?? fail('removed dose not selected');
      const itemId = readNpcPoisonCoatingContribution(catalogs().catalog, old).preparation
        .targetItemInstanceId;
      const nextItem =
        projectNpcInventoryRequest(editor, draft.inventory).find(
          (row) => row.itemInstanceId === itemId,
        ) ?? fail('removed coating carrier missing');
      equal(nextItem.coatingInstanceIds, [], 'removed dose remains selected');
      return;
    }
    if (request.preparation.kind !== 'POISON_COATING_PREPARE') return fail('poison candidate kind');
    const input = npcPoisonCoatingPreparationRequestInputValue(request.preparation.input);
    if (children.length !== 1 || child?.kind !== 'COATING_INSTANCE')
      return fail('candidate coating identity');
    equal(
      [child.itemInstanceId, child.sourceInstanceId],
      [input.targetItemInstanceId, input.sourceInstanceId],
      'candidate coating ownership',
    );
    const mode =
      modes(before.attempt, calendar).find(
        (token) =>
          readNpcTaipanModeContribution(catalogs().source, token).sourceInstanceId ===
          input.sourceInstanceId,
      ) ?? fail('actual initial mode missing');
    const life = options.life(before.attempt, calendar, null);
    const source = deriveNpcPoisonSourceContribution(catalogs().source, mode, {
      campaignId: before.attempt.scope.campaignId,
      npcUuid: before.attempt.candidateNpcUuid,
      campaignTimestamp: minute(calendar),
      origin: { kind: 'PREPARED', preparationOperationId: request.operationId },
      targetCommitOperationIdOrNull: null,
      observations: [
        {
          operationId: request.operationId,
          kind: 'PREPARATION',
          campaignTimestamp: minute(calendar),
          compositionProof: before.compositionProof,
          life:
            life === null ? { kind: 'NOT_CONFIRMED_DRAFT' } : { kind: 'CONFIRMED', state: life },
        },
      ],
    });
    const physical = buildNpcInventoryPhysicalBasis(
      options.publication,
      projectNpcInventoryRequest(editor, draft.inventory),
      before.inventoryHistory,
    );
    deriveNpcPreparedPoisonCoating(
      catalogs().catalog,
      {
        kind: 'GM_FORMAL_INITIAL_POISON_COATING',
        campaignId: before.attempt.scope.campaignId,
        npcUuid: before.attempt.candidateNpcUuid,
        coatingInstanceId: child.id,
        preparationOperationId: request.operationId,
        sourceInstanceId: input.sourceInstanceId,
        targetItemInstanceId: input.targetItemInstanceId,
        surfaceConfirmed: input.surfaceConfirmed,
        replacesCoatingIdOrNull: input.replacesCoatingIdOrNull,
        replaceConfirmed: input.replaceConfirmed,
        reason: input.reason,
        calendarAnchor: options.calendarAnchor(calendar),
        createdAt: committedAt,
        revision: 1,
      },
      {
        campaignId: before.attempt.scope.campaignId,
        npcUuid: before.attempt.candidateNpcUuid,
        campaignTimestamp: minute(calendar),
        origin: { kind: 'PREPARED', preparationOperationId: request.operationId },
        mode,
        source,
        originalInventory: before.physicalInventory,
        currentInventory: physical,
        replaces:
          input.replacesCoatingIdOrNull === null
            ? null
            : (selected.find(
                (token) =>
                  readNpcPoisonCoatingContribution(catalogs().catalog, token).coating
                    .coatingInstanceId === input.replacesCoatingIdOrNull,
              ) ?? fail('replacement original dose missing')),
      },
    );
  }
  return {
    modes,
    coating,
    selectedCoatings,
    preparationSelection,
    firstPublishedCoating,
    inventoryContext,
    context,
    validateCandidate,
    validateEditorSelection,
  };
}
