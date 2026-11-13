import type Database from 'better-sqlite3';
import {
  enemyAuthoringContextValue,
  enemyVersionIdentityValue,
  type EnemyAuthoringAttempt,
  type EnemyVersionIdentity,
} from '@shared/enemy-authoring.js';
import type { GmRequestReviewScope, StoredGmRequestQueueEvent } from './campaign-creation.js';
import type { EnemyVersionAttemptContext } from '@shared/enemy-version-configuration.js';
import {
  enemyVersionMandatoryFactsValue,
  type EnemyVersionMandatoryFacts,
} from '@shared/enemy-version-facts.js';
import type { EnemyCompositionAcquisitions } from '@shared/enemy-composition.js';
import { networkApplicationStorage as s } from './network-local-application.js';

/**
 * Historical NAV resolves its actual earlier commit, not today's current pointer or a
 * self-declared copy. Full source/body and all table closure remain the host observer's job.
 */
export function readEnemyVersionSourceAtPrefix(
  db: Database.Database,
  scope: GmRequestReviewScope,
  events: readonly StoredGmRequestQueueEvent[],
  identity: EnemyVersionIdentity,
): {
  identity: EnemyVersionIdentity;
  attempt: EnemyAuthoringAttempt;
  configurationConfirmation?: NonNullable<EnemyVersionAttemptContext['configurationConfirmation']>;
  mandatoryFacts: EnemyVersionMandatoryFacts;
  unconfiguredAdvisorCardIdOrNull: string | null;
} {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  if (identity.campaignId !== scope.campaignId) return s.fail('FOREIGN_OWNER');
  const commits = events.filter(
    (event) =>
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      event.mutation.cause.committedVersionOrNull?.templateId === identity.templateId,
  );
  if (commits.length === 0 || commits.length !== identity.version) return s.fail('SOURCE_CHANGED');
  let previous: EnemyVersionIdentity | null = null;
  for (const [index, event] of commits.entries()) {
    if (event.mutation.kind !== 'ENEMY_AUTHORING') return s.fail('SOURCE_CHANGED');
    const current = event.mutation.cause.committedVersionOrNull ?? s.fail('SOURCE_CHANGED');
    if (
      current.version !== index + 1 ||
      current.kind !== identity.kind ||
      current.campaignId !== scope.campaignId ||
      current.templateId !== identity.templateId
    )
      return s.fail('SOURCE_CHANGED');
    if (previous !== null && previous.versionId === current.versionId)
      return s.fail('SOURCE_CHANGED');
    previous = current;
  }
  if (!s.same(previous, identity)) return s.fail('STALE_REVISION');
  const commit = commits.at(-1) ?? s.fail('SOURCE_CHANGED');
  const row = db
    .prepare(
      `SELECT * FROM campaign_enemy_version
    WHERE version_id=? AND template_id=? AND campaign_id=? AND version=?`,
    )
    .get(identity.versionId, identity.templateId, scope.campaignId, identity.version);
  if (row === undefined) return s.fail('SOURCE_CHANGED');
  const columns = s.object(row);
  const text = columns['record_json'];
  if (typeof text !== 'string') return s.fail('SOURCE_CHANGED');
  const saved: unknown = JSON.parse(text);
  if (s.canonical(saved) !== text || s.sha(text) !== columns['record_sha256'])
    return s.fail('SOURCE_CHANGED');
  const record = s.object(saved);
  const storedIdentity = enemyVersionIdentityValue(record['identity']);
  const attempt =
    enemyAuthoringContextValue({
      attemptOrNull: record['attempt'],
      selectedVersionOrNull: null,
    }).attemptOrNull ?? s.fail('SOURCE_CHANGED');
  const commitIndex = events.findIndex((event) => event.eventId === commit.eventId);
  if (
    !s.same(storedIdentity, identity) ||
    record['operationId'] !== commit.eventId ||
    commitIndex < 1 ||
    commit.mutation.kind !== 'ENEMY_AUTHORING' ||
    !s.same(attempt, events[commitIndex - 1]?.view.enemyAuthoring?.attemptOrNull) ||
    attempt.campaignId !== scope.campaignId ||
    attempt.kind !== identity.kind ||
    record['actorId'] !== commit.mutation.cause.authorMasterProfileId ||
    record['timestamp'] !== commit.mutation.cause.timestamp ||
    record['sourceBaselineVersion'] !== commit.mutation.cause.sourceBaselineVersion
  )
    return s.fail('SOURCE_CHANGED');
  const metadata = events[commitIndex - 1]?.view.enemyAuthoring?.versionAttempt;
  return {
    identity: storedIdentity,
    attempt,
    mandatoryFacts: collectEnemyVersionMandatoryFacts(events, identity),
    unconfiguredAdvisorCardIdOrNull: metadata?.unconfiguredAdvisorCardIdOrNull ?? null,
    ...(metadata?.configurationConfirmation === undefined
      ? {}
      : { configurationConfirmation: metadata.configurationConfirmation }),
  };
}

/**
 * Only this template's born attempt and actual earlier version NAVs own these facts.
 * Canceled current plans are not copied: the result contains only immutable acquisitions/first fill.
 */
export function collectEnemyVersionMandatoryFacts(
  events: readonly StoredGmRequestQueueEvent[],
  base: EnemyVersionIdentity,
): EnemyVersionMandatoryFacts {
  const commits = events.filter(
    (event) =>
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      event.mutation.cause.committedVersionOrNull?.templateId === base.templateId,
  );
  const last = commits.at(-1);
  if (
    commits.length !== base.version ||
    last?.mutation.kind !== 'ENEMY_AUTHORING' ||
    !s.same(last.mutation.cause.committedVersionOrNull, base)
  )
    return s.fail('SOURCE_CHANGED');
  const ownedAttempts = new Set<string>();
  const birth = commits[0];
  if (
    birth?.mutation.kind !== 'ENEMY_AUTHORING' ||
    birth.mutation.cause.committedVersionOrNull?.version !== 1
  )
    return s.fail('SOURCE_CHANGED');
  ownedAttempts.add(birth.mutation.cause.request.payload.creationAttemptId);
  for (const [index, event] of events.entries()) {
    if (event.mutation.kind !== 'NAV' || event.mutation.request.actionKey !== 'ENM-001::CTA::008')
      continue;
    const context = event.view.enemyAuthoring;
    const origin = context?.versionAttempt?.origin;
    if (origin?.base.templateId !== base.templateId) continue;
    const previous = events[index - 1]?.view;
    const earlier = events
      .slice(0, index)
      .filter(
        (event) =>
          event.mutation.kind === 'ENEMY_AUTHORING' &&
          event.mutation.cause.committedVersionOrNull?.templateId === base.templateId,
      )
      .at(-1);
    if (
      origin.base.campaignId !== base.campaignId ||
      origin.base.kind !== base.kind ||
      earlier?.mutation.kind !== 'ENEMY_AUTHORING' ||
      !s.same(earlier.mutation.cause.committedVersionOrNull, origin.base) ||
      !s.same(previous?.enemyLibrary?.userSelectionOrNull, origin.base) ||
      origin.navigationRequestId !== event.eventId ||
      context?.attemptOrNull?.attemptId !== event.eventId ||
      context.attemptOrNull.kind !== base.kind
    )
      return s.fail('SOURCE_CHANGED');
    ownedAttempts.add(event.eventId);
  }
  const commandIndices = new Map<string, number>();
  for (const [index, event] of events.entries())
    if (
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      ownedAttempts.has(event.mutation.cause.request.payload.creationAttemptId)
    )
      commandIndices.set(event.eventId, index);
  const priorCommand = (id: string, index: number): void => {
    const source = commandIndices.get(id);
    if (source === undefined || source > index) return s.fail('SOURCE_CHANGED');
  };
  let free: EnemyCompositionAcquisitions['freeSlotOrNull'] = null;
  const cards = new Map<string, Record<string, unknown>>();
  const fills = new Map<
    string,
    { commandId: string; skills: readonly { skillKey: string; targetBonus: number }[] }
  >();
  for (const [index, event] of events.entries()) {
    if (
      event.mutation.kind !== 'ENEMY_AUTHORING' ||
      !ownedAttempts.has(event.mutation.cause.request.payload.creationAttemptId)
    )
      continue;
    const attempt = event.view.enemyAuthoring?.attemptOrNull;
    // Commit closes the cursor; its already verified preceding publication owns the same facts.
    if (attempt == null) continue;
    if (
      attempt.campaignId !== base.campaignId ||
      attempt.kind !== base.kind ||
      event.scope.campaignId !== base.campaignId
    )
      return s.fail('SOURCE_CHANGED');
    if (attempt.kind === 'SENTIENT') {
      const acquisition = attempt.compositionAcquisitions;
      if (acquisition === undefined) continue;
      if (acquisition.freeSlotOrNull !== null) {
        priorCommand(acquisition.freeSlotOrNull.roll.originatingCommandId, index);
        if (free !== null && !s.same(free, acquisition.freeSlotOrNull))
          return s.fail('SOURCE_CHANGED');
        free = acquisition.freeSlotOrNull;
      }
      for (const fill of attempt.skillPlanState?.advisorInitialFillHistory ?? []) {
        priorCommand(fill.commandId, index);
        const source = events[commandIndices.get(fill.commandId) ?? -1];
        if (
          source?.mutation.kind !== 'ENEMY_AUTHORING' ||
          source.mutation.cause.request.payload.stage !== 'SENTIENT_INVENTORY'
        )
          return s.fail('SOURCE_CHANGED');
        if (!fills.has(fill.cardId))
          fills.set(fill.cardId, {
            commandId: fill.commandId,
            skills: fill.skills.map((skill) => ({
              skillKey: skill.skillKey,
              targetBonus: skill.bonus,
            })),
          });
      }
      for (const card of acquisition.advisorCards) {
        card.iwRolls.forEach((roll) => priorCommand(roll.originatingCommandId, index));
        if (card.suppressionRollOrNull !== null)
          priorCommand(card.suppressionRollOrNull.originatingCommandId, index);
        const immutable = {
          cardId: card.cardId,
          symbiontInstanceId: card.symbiontInstanceId,
          iwRolls: card.iwRolls,
        };
        const old = cards.get(card.cardId);
        if (
          old !== undefined &&
          (!s.same(old['iwRolls'], card.iwRolls) ||
            old['symbiontInstanceId'] !== card.symbiontInstanceId ||
            (old['suppressionRollOrNull'] !== null &&
              card.suppressionRollOrNull !== null &&
              !s.same(old['suppressionRollOrNull'], card.suppressionRollOrNull)))
        )
          return s.fail('SOURCE_CHANGED');
        cards.set(card.cardId, {
          ...immutable,
          suppressionRollOrNull:
            card.suppressionRollOrNull ?? old?.['suppressionRollOrNull'] ?? null,
        });
      }
    } else {
      for (const card of attempt.advisorCards) {
        card.iwRolls.forEach((roll) => priorCommand(roll.originatingCommandId, index));
        const old = cards.get(card.cardId);
        if (
          old !== undefined &&
          (!s.same(old['iwRolls'], card.iwRolls) ||
            old['symbiontInstanceId'] !== card.symbiontInstanceId)
        )
          return s.fail('SOURCE_CHANGED');
        cards.set(card.cardId, {
          cardId: card.cardId,
          symbiontInstanceId: card.symbiontInstanceId,
          iwRolls: card.iwRolls,
          acquisitionChoice: old?.['acquisitionChoice'] ?? card.confirmedChoice,
        });
        if (card.initialSkillsOrNull !== null && !fills.has(card.cardId)) {
          if (
            event.mutation.cause.request.payload.stage !== 'MONSTER_SYMBIONT' ||
            event.mutation.cause.request.payload.data?.['operation'] !== 'FINISH'
          )
            return s.fail('SOURCE_CHANGED');
          fills.set(card.cardId, { commandId: event.eventId, skills: card.initialSkillsOrNull });
        }
      }
    }
  }
  return enemyVersionMandatoryFactsValue({
    schemaVersion: 1,
    kind: base.kind,
    ...(base.kind === 'SENTIENT' ? { freeSlotOrNull: free } : {}),
    advisorCards: [...cards.entries()].map(([cardId, card]) => ({
      ...card,
      initialFillOrNull: fills.get(cardId) ?? null,
    })),
  });
}
