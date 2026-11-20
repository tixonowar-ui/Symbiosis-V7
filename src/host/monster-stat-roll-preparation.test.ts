import { expect, it, vi } from 'vitest';
import {
  enemyAuthoringContextValue,
  enemyMonsterStatRollBinding,
  enemyWorkflowRequestValue,
  type EnemyAuthoringContext,
} from '@shared/enemy-authoring.js';
import { newCustomMonsterAttempt } from '@shared/custom-monster-state.js';
import {
  CUSTOM_MONSTER_PLACEHOLDER,
  CUSTOM_MONSTER_PLACEHOLDER_SHA256,
} from '@shared/custom-monster.js';
import { createMonsterStatRollState } from '../domain/entities/enemy-template/monster-stat-roll.js';
import { prepareMonsterStatRollCommand } from './monster-stat-roll-preparation.js';

const id = (last: string) => '00000000-0000-4000-8000-' + last.padStart(12, '0');
const seed = 'a'.repeat(64);
const context = enemyAuthoringContextValue({
  attemptOrNull: newCustomMonsterAttempt(id('260'), id('261')),
  selectedVersionOrNull: null,
});
function inputs() {
  return {
    operation: vi.fn(() => ({
      operationId: id('262'),
      randomReceiptId: id('263'),
      attemptRevision: 0,
      authorMasterProfileId: id('269'),
      timestamp: '2026-11-14T00:00:00.000Z',
      sourceBaselineVersion: 'unit-preparation-only',
      artSha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
    })),
    newSeed: vi.fn(() => seed),
    sampleNaturalR20: vi.fn(() => 20),
  };
}
function request(
  c: EnemyAuthoringContext,
  roll = false,
  data: unknown = { sourceActionKey: 'ENM-012::CTA::005', draftOrNull: null },
) {
  const a = c.attemptOrNull;
  if (a === null) throw new Error('Missing unit attempt');
  const binding = enemyMonsterStatRollBinding(c);
  return enemyWorkflowRequestValue({
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    commandId: id('262'),
    workflowCommandId: roll ? 'UI-CMD-MONSTER-STATS-ROLL-ONCE' : 'UI-CMD-ENEMY-DRAFT-PATCH',
    expectedRevisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
    payload: {
      campaignId: a.campaignId,
      creationAttemptId: a.attemptId,
      expectedAttemptRevision: a.revision,
      ...(roll
        ? {
            attemptId: a.attemptId,
            monsterDraftId: a.attemptId,
            originFormId: binding.originFormId,
            returnFormId: binding.originFormId,
            versionBindingOrNull: binding.versionBindingOrNull,
          }
        : { stage: 'MONSTER_STAT_DRAFT', data }),
    },
  });
}
function opened() {
  return enemyAuthoringContextValue({
    ...context,
    monsterStatRoll: createMonsterStatRollState(enemyMonsterStatRollBinding(context), seed, null),
  });
}

it('creates the host nonce only after a bound opening guard and does not sample or invent missing body metadata', () => {
  const i = inputs(),
    result = prepareMonsterStatRollCommand(context, 'ENM-012', request(context), i);
  expect(i.newSeed).toHaveBeenCalledTimes(1);
  expect(i.operation).toHaveBeenCalledTimes(1);
  expect(i.sampleNaturalR20).not.toHaveBeenCalled();
  expect(result.preparedMonsterStatRoll.draftOrNull).toBeNull();
  expect(result.preparedMonsterStatRoll.binding.originFormId).toBe('ENM-012');
});
it('refuses wrong source form and foreign/stale coordinates before operation allocation, nonce or sampler', () => {
  const r = request(context);
  for (const [form, command] of [
    ['ENM-017', r],
    ['ENM-012', { ...r, payload: { ...r.payload, campaignId: id('999') } }],
    ['ENM-012', { ...r, payload: { ...r.payload, expectedAttemptRevision: 1 } }],
  ] as const) {
    const i = inputs();
    expect(() => prepareMonsterStatRollCommand(context, form, command, i)).toThrow();
    expect(i.operation).not.toHaveBeenCalled();
    expect(i.newSeed).not.toHaveBeenCalled();
    expect(i.sampleNaturalR20).not.toHaveBeenCalled();
  }
});
it('uses exactly seven20 faces, no critical continuation, and reconstructs the same prepared record from stored faces', () => {
  const c = opened(),
    r = request(c, true),
    i = inputs();
  const actual = prepareMonsterStatRollCommand(c, 'ENM-018', r, i);
  expect(i.sampleNaturalR20).toHaveBeenCalledTimes(7);
  expect(i.newSeed).not.toHaveBeenCalled();
  expect(actual.preparedMonsterStatRoll.randomReceiptOrNull?.dieFaces).toEqual([
    20, 20, 20, 20, 20, 20, 20,
  ]);
  let index = 0;
  const fromStored = prepareMonsterStatRollCommand(c, 'ENM-018', r, {
    operation: () => actual.operation,
    newSeed: () => {
      throw new Error('Historical nonce regeneration');
    },
    sampleNaturalR20: () =>
      actual.preparedMonsterStatRoll.randomReceiptOrNull?.dieFaces[index++] ??
      (() => {
        throw new Error('Unexpected face');
      })(),
  });
  expect(index).toBe(7);
  expect(fromStored).toEqual(actual);
});
it('refuses receipt-view null clearing and a second fresh roll before any operation/seed/sampler call', () => {
  const c = opened(),
    rolled = prepareMonsterStatRollCommand(c, 'ENM-018', request(c, true), inputs());
  const pending = enemyAuthoringContextValue({
    ...c,
    monsterStatRoll: rolled.preparedMonsterStatRoll,
  });
  for (const [form, r] of [
    [
      'ENM-012',
      request(pending, false, { sourceActionKey: 'ENM-012::CTA::002', draftOrNull: null }),
    ],
    ['ENM-018', request(pending, true)],
  ] as const) {
    const i = inputs();
    expect(() => prepareMonsterStatRollCommand(pending, form, r, i)).toThrow();
    expect(i.operation).not.toHaveBeenCalled();
    expect(i.newSeed).not.toHaveBeenCalled();
    expect(i.sampleNaturalR20).not.toHaveBeenCalled();
  }
});

it('views an already accepted null draft without regenerating its nonce, faces or pending input', () => {
  const c = opened(),
    rolled = prepareMonsterStatRollCommand(c, 'ENM-018', request(c, true), inputs());
  const accepted = enemyAuthoringContextValue({
    ...c,
    monsterStatRoll: { ...rolled.preparedMonsterStatRoll, draftOrNull: null },
  });
  const i = inputs(),
    result = prepareMonsterStatRollCommand(
      accepted,
      'ENM-012',
      request(accepted, false, { sourceActionKey: 'ENM-012::CTA::002', draftOrNull: null }),
      i,
    );
  expect(result.preparedMonsterStatRoll).toEqual(accepted.monsterStatRoll);
  expect(i.newSeed).not.toHaveBeenCalled();
  expect(i.sampleNaturalR20).not.toHaveBeenCalled();
  expect(i.operation).toHaveBeenCalledTimes(1);
});

it('opening an accepted N+1 body without local edits preserves its metadata before rolling only seven bases', () => {
  const stats = {
    statMode: 'MANUAL',
    baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
    massKg: 12.3,
    ageYears: 17,
    baseMaxHP: 42,
    rollReceiptOrNull: null,
  };
  const version = enemyAuthoringContextValue({
    ...context,
    attemptOrNull: { ...context.attemptOrNull, statsOrNull: stats },
    versionAttempt: {
      schemaVersion: 1,
      origin: {
        schemaVersion: 1,
        navigationRequestId: id('260'),
        expectedRevisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
        base: {
          campaignId: id('261'),
          templateId: id('280'),
          versionId: id('281'),
          version: 1,
          kind: 'CUSTOM_MONSTER',
          artAssetKey: CUSTOM_MONSTER_PLACEHOLDER,
          artSha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
        },
      },
      reason: 'Unit version',
      retainedMandatoryFacts: { schemaVersion: 1, kind: 'CUSTOM_MONSTER', advisorCards: [] },
      unconfiguredAdvisorCardIdOrNull: null,
      replacementPreviewOrNull: null,
    },
  });
  for (const existing of [false, true]) {
    const c = existing
      ? enemyAuthoringContextValue({
          ...version,
          monsterStatRoll: createMonsterStatRollState(
            enemyMonsterStatRollBinding(version),
            seed,
            null,
          ),
        })
      : version;
    const i = inputs(),
      openedState = prepareMonsterStatRollCommand(
        c,
        'ENM-017',
        request(c, false, {
          sourceActionKey: 'ENM-017::CTA::006',
          draftOrNull: null,
        }),
        i,
      ).preparedMonsterStatRoll;
    expect(openedState.draftOrNull).toEqual({
      baseStats: stats.baseStats,
      massKg: 12.3,
      ageYears: 17,
      baseMaxHP: 42,
    });
    expect(i.newSeed).toHaveBeenCalledTimes(existing ? 0 : 1);
    const openedContext = enemyAuthoringContextValue({ ...c, monsterStatRoll: openedState });
    const rolled = prepareMonsterStatRollCommand(
      openedContext,
      'ENM-018',
      request(openedContext, true),
      inputs(),
    );
    expect(rolled.preparedMonsterStatRoll.draftOrNull).toEqual({
      baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
      massKg: 12.3,
      ageYears: 17,
      baseMaxHP: 42,
    });
    expect(rolled.preparedMonsterStatRoll.randomReceiptOrNull?.beforeDraftOrNull).toEqual(
      openedState.draftOrNull,
    );
    expect(rolled.preparedMonsterStatRoll.binding.versionBindingOrNull).toEqual({
      templateId: id('280'),
      expectedCurrentVersion: 1,
    });
  }
});
