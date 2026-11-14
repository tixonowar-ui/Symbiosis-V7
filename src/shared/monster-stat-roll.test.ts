import { expect, it } from 'vitest';
import {
  enemyAuthoringContextValue,
  enemyAuthoringMutationValue,
  enemyAuthoringReceipt,
  enemyVersionIdentityValue,
  enemyMonsterStatRollBinding,
  enemyWorkflowRequestValue,
  reduceEnemyAuthoring,
  type EnemyAuthoringContext,
  type EnemyAuthoringMutation,
} from './enemy-authoring.js';
import { newCustomMonsterAttempt } from './custom-monster-state.js';
import { CUSTOM_MONSTER_PLACEHOLDER, CUSTOM_MONSTER_PLACEHOLDER_SHA256 } from './custom-monster.js';
import {
  monsterStatRollCommandPayloadValue,
  monsterStatsDraftValue,
  monsterStatDraftRequiresAcceptance,
} from './monster-stat-roll.js';
import {
  createMonsterStatRollState,
  issueMonsterStatRoll,
  stageMonsterStatsDraft,
} from '../domain/entities/enemy-template/monster-stat-roll.js';

const id = (last: string) => '00000000-0000-4000-8000-' + last.padStart(12, '0');
const revisions = { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 };
const seed = 'a'.repeat(64);
it('distinguishes cached accepted input from each real pending body difference without clearing state', () => {
  const accepted = {
    baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
    massKg: 5.1,
    ageYears: 17,
    baseMaxHP: 42,
  };
  const cached = monsterStatsDraftValue(accepted),
    before = structuredClone(cached);
  expect(monsterStatDraftRequiresAcceptance(null, accepted)).toBe(false);
  expect(monsterStatDraftRequiresAcceptance(cached, accepted)).toBe(false);
  expect(monsterStatDraftRequiresAcceptance(cached, null)).toBe(true);
  for (const changed of [
    { ...cached, baseStats: { ...cached.baseStats, S: 34 } },
    { ...cached, massKg: 5.2 },
    { ...cached, ageYears: 18 },
    { ...cached, baseMaxHP: 43 },
    { ...cached, baseStats: { ...cached.baseStats, S: null } },
    { ...cached, massKg: null },
    { ...cached, ageYears: null },
    { ...cached, baseMaxHP: null },
  ])
    expect(monsterStatDraftRequiresAcceptance(monsterStatsDraftValue(changed), accepted)).toBe(
      true,
    );
  expect(cached).toEqual(before);
});
it('refuses saving or composition reconciliation at the exact pending-body guard for all four changed input fields', () => {
  const accepted = {
    statMode: 'MANUAL',
    baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
    massKg: 5.1,
    ageYears: 17,
    baseMaxHP: 42,
    rollReceiptOrNull: null,
  };
  const base = {
    campaignId: id('261'),
    templateId: id('280'),
    versionId: id('281'),
    version: 1,
    kind: 'CUSTOM_MONSTER',
    artAssetKey: CUSTOM_MONSTER_PLACEHOLDER,
    artSha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
  };
  const version = enemyAuthoringContextValue({
    ...initial(),
    attemptOrNull: { ...initial().attemptOrNull, statsOrNull: accepted },
    versionAttempt: {
      schemaVersion: 1,
      origin: {
        schemaVersion: 1,
        navigationRequestId: id('260'),
        base,
        expectedRevisions: revisions,
      },
      reason: 'Changed full candidate',
      retainedMandatoryFacts: { schemaVersion: 1, kind: 'CUSTOM_MONSTER', advisorCards: [] },
      unconfiguredAdvisorCardIdOrNull: null,
      replacementPreviewOrNull: null,
    },
  });
  const binding = enemyMonsterStatRollBinding(version),
    draft = { baseStats: accepted.baseStats, massKg: 5.1, ageYears: 17, baseMaxHP: 42 };
  for (const changed of [
    { ...draft, baseStats: { ...draft.baseStats, S: 34 } },
    { ...draft, massKg: 5.2 },
    { ...draft, ageYears: 18 },
    { ...draft, baseMaxHP: 43 },
    { ...draft, baseStats: { ...draft.baseStats, S: null } },
  ]) {
    const context = enemyAuthoringContextValue({
      ...version,
      monsterStatRoll: createMonsterStatRollState(binding, seed, changed),
    });
    const save = {
      ...mutation(context, 'UI-CMD-ENEMY-NEW-VERSION', { reason: 'Changed full candidate' }),
      committedVersionOrNull: enemyVersionIdentityValue({
        ...base,
        versionId: id('282'),
        version: 2,
      }),
    };
    const composition = {
      ...mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
        stage: 'MONSTER_SYMBIONT',
        data: { operation: 'PREVIEW', selection: { mode: 'NONE' } },
      }),
      versionPatchSourceFormId: 'ENM-017' as const,
    };
    for (const cause of [save, composition]) {
      try {
        reduceEnemyAuthoring(context, cause, 'ENM-017', revisions);
        throw new Error('Unexpected pending-body acceptance');
      } catch (error) {
        expect(error).toMatchObject({
          refusal: { code: 'INVALID_SHAPE', path: '$.monsterStatRoll.draftOrNull' },
        });
      }
    }
  }
});
function initial(): EnemyAuthoringContext {
  return enemyAuthoringContextValue({
    attemptOrNull: {
      ...newCustomMonsterAttempt(id('260'), id('261')),
      identityOrNull: { name: 'Unit monster', description: null, creatureType: 'CUSTOM_MONSTER' },
    },
    selectedVersionOrNull: null,
  });
}
function mutation(
  context: EnemyAuthoringContext,
  workflowCommandId: string,
  payload: object,
): EnemyAuthoringMutation {
  const attempt = context.attemptOrNull;
  if (attempt === null) throw new Error('Missing unit attempt');
  return {
    authorMasterProfileId: id('269'),
    sourceBaselineVersion: 'unit-contract-only',
    request: enemyWorkflowRequestValue({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: id('262'),
      workflowCommandId,
      expectedRevisions: revisions,
      payload: {
        campaignId: attempt.campaignId,
        creationAttemptId: attempt.attemptId,
        expectedAttemptRevision: attempt.revision,
        ...payload,
      },
    }),
    itemTemplateKeys: [],
    committedVersionOrNull: null,
    receiptId: id('263'),
    timestamp: '2026-11-14T00:00:00.000Z',
  };
}
function open() {
  const context = initial(),
    binding = enemyMonsterStatRollBinding(context);
  const cause = enemyAuthoringMutationValue({
    ...mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'MONSTER_STAT_DRAFT',
      data: { sourceActionKey: 'ENM-012::CTA::005', draftOrNull: null },
    }),
    preparedMonsterStatRoll: createMonsterStatRollState(binding, seed, null),
  });
  return reduceEnemyAuthoring(context, cause, 'ENM-012', revisions);
}
function roll() {
  const opened = open(),
    context = opened.context;
  const binding = enemyMonsterStatRollBinding(context);
  const cause = mutation(context, 'UI-CMD-MONSTER-STATS-ROLL-ONCE', {
    attemptId: binding.attemptId,
    monsterDraftId: binding.attemptId,
    originFormId: binding.originFormId,
    returnFormId: binding.originFormId,
    versionBindingOrNull: null,
  });
  const previous = context.monsterStatRoll;
  if (previous === undefined || context.attemptOrNull === null)
    throw new Error('Missing unit state');
  const preparedMonsterStatRoll = issueMonsterStatRoll(
    previous,
    binding,
    context.attemptOrNull.revision,
    {
      operationId: cause.request.commandId,
      randomReceiptId: cause.receiptId,
      attemptRevision: context.attemptOrNull.revision,
      authorMasterProfileId: cause.authorMasterProfileId,
      timestamp: cause.timestamp,
      sourceBaselineVersion: cause.sourceBaselineVersion,
      artSha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
    },
    () => 1,
  );
  const checked = enemyAuthoringMutationValue({ ...cause, preparedMonsterStatRoll });
  return {
    context: reduceEnemyAuthoring(context, checked, 'ENM-018', revisions).context,
    cause: checked,
    previous: context,
  };
}

it('opens018 from genuinely unentered stats without inventing metadata or accepting a body', () => {
  const result = open();
  expect(result.formId).toBe('ENM-018');
  expect(result.context.attemptOrNull?.revision).toBe(1);
  expect(
    result.context.attemptOrNull?.kind === 'CUSTOM_MONSTER' &&
      result.context.attemptOrNull.statsOrNull,
  ).toBeNull();
  expect(result.context.monsterStatRoll?.draftOrNull).toBeNull();
  expect(result.context.monsterStatRoll?.rollOnceStatus).toBe('NOT_ROLLED');
});

it('requires the earlier accepted metadata when an unedited null opening is prepared, rather than trusting empty prepared state', () => {
  const stats = {
    statMode: 'MANUAL',
    baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
    massKg: 12.3,
    ageYears: 17,
    baseMaxHP: 42,
    rollReceiptOrNull: null,
  };
  const context = enemyAuthoringContextValue({
    ...initial(),
    attemptOrNull: { ...initial().attemptOrNull, statsOrNull: stats },
  });
  const binding = enemyMonsterStatRollBinding(context);
  const cause = mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
    stage: 'MONSTER_STAT_DRAFT',
    data: { sourceActionKey: 'ENM-012::CTA::005', draftOrNull: null },
  });
  expect(() =>
    reduceEnemyAuthoring(
      context,
      enemyAuthoringMutationValue({
        ...cause,
        preparedMonsterStatRoll: createMonsterStatRollState(binding, seed, null),
      }),
      'ENM-012',
      revisions,
    ),
  ).toThrow('INVALID_SHAPE');
  const draft = { baseStats: stats.baseStats, massKg: 12.3, ageYears: 17, baseMaxHP: 42 };
  const result = reduceEnemyAuthoring(
    context,
    enemyAuthoringMutationValue({
      ...cause,
      preparedMonsterStatRoll: createMonsterStatRollState(binding, seed, draft),
    }),
    'ENM-012',
    revisions,
  );
  expect(result.context.monsterStatRoll?.draftOrNull).toEqual(draft);
  expect(
    result.context.attemptOrNull?.kind === 'CUSTOM_MONSTER' &&
      result.context.attemptOrNull.statsOrNull,
  ).toEqual(stats);
});
it('binds the owning operation receipt and keeps generated values provisional, separate from accepted body', () => {
  const result = roll();
  expect(
    result.context.attemptOrNull?.kind === 'CUSTOM_MONSTER' &&
      result.context.attemptOrNull.statsOrNull,
  ).toBeNull();
  expect(result.context.monsterStatRoll?.draftOrNull?.baseStats).toEqual({
    S: 1,
    D: 1,
    M: 1,
    Z: 1,
    I: 1,
    W: 1,
    C: 1,
  });
  expect(result.context.monsterStatRoll?.draftOrNull?.massKg).toBeNull();
  expect(enemyAuthoringReceipt(result.cause, revisions).result.sourceFormId).toBe('ENM-018');
  expect(result.context.monsterStatRoll?.randomReceiptOrNull?.randomReceiptId).toBe(
    result.cause.receiptId,
  );
});
it('range-valid direct correction enters019 without body reconciliation and never overwrites original faces', () => {
  const { context } = roll(),
    previous = context.monsterStatRoll;
  if (previous === undefined) throw new Error('Missing unit state');
  const draft = monsterStatsDraftValue({
    baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
    massKg: 5,
    ageYears: 1,
    baseMaxHP: 1,
  });
  const cause = enemyAuthoringMutationValue({
    ...mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'MONSTER_STAT_DRAFT',
      data: { sourceActionKey: 'ENM-012::CTA::002', draftOrNull: draft },
    }),
    preparedMonsterStatRoll: stageMonsterStatsDraft(previous, draft),
  });
  const result = reduceEnemyAuthoring(context, cause, 'ENM-012', revisions);
  expect(result.formId).toBe('ENM-019');
  expect(result.context.monsterStatRoll?.draftOrNull).toEqual(draft);
  expect(result.context.monsterStatRoll?.randomReceiptOrNull).toEqual(previous.randomReceiptOrNull);
  expect(
    result.context.attemptOrNull?.kind === 'CUSTOM_MONSTER' &&
      result.context.attemptOrNull.statsOrNull,
  ).toBeNull();
  expect(enemyAuthoringReceipt(cause, revisions).result.sourceFormId).toBe('ENM-012');
});
it('only accepted full MONSTER_STATS clears the provisional draft while keeping its spent right and receipt', () => {
  const { context } = roll(),
    state = context.monsterStatRoll;
  const cause = enemyAuthoringMutationValue({
    ...mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'MONSTER_STATS',
      data: {
        statMode: 'MANUAL',
        baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
        massKg: 5,
        ageYears: 1,
        baseMaxHP: 1,
        rollReceiptOrNull: null,
      },
    }),
    preparedMonsterKnowledge: { advisorCards: [], activeAdvisorCardIdOrNull: null },
  });
  const result = reduceEnemyAuthoring(context, cause, 'ENM-012', revisions);
  expect(result.formId).toBe('ENM-013');
  expect(result.context.monsterStatRoll).toEqual({ ...state, draftOrNull: null });
  expect(
    result.context.attemptOrNull?.kind === 'CUSTOM_MONSTER' &&
      result.context.attemptOrNull.statsOrNull?.baseStats.S,
  ).toBe(35);
});

it('receipt viewing cannot clear pending rolled stats, while accepted null-to-null viewing remains valid', () => {
  const { context } = roll(),
    state = context.monsterStatRoll;
  if (state === undefined) throw new Error('Missing unit state');
  const patch = mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
    stage: 'MONSTER_STAT_DRAFT',
    data: { sourceActionKey: 'ENM-012::CTA::002', draftOrNull: null },
  });
  const cause = enemyAuthoringMutationValue({
    ...patch,
    preparedMonsterStatRoll: { ...state, draftOrNull: null },
  });
  expect(() => reduceEnemyAuthoring(context, cause, 'ENM-012', revisions)).toThrow('INVALID_SHAPE');
  try {
    reduceEnemyAuthoring(context, cause, 'ENM-012', revisions);
    throw new Error('Unexpected pending clear');
  } catch (error) {
    expect(error).toMatchObject({
      refusal: { code: 'INVALID_SHAPE', path: '$.monsterStatDraftPatch' },
    });
  }
  const accepted = enemyAuthoringContextValue({
    ...context,
    monsterStatRoll: { ...state, draftOrNull: null },
  });
  expect(reduceEnemyAuthoring(accepted, cause, 'ENM-012', revisions).formId).toBe('ENM-019');
});

it('diagnoses malformed version context before attempting nested roll-origin linkage', () => {
  const { context } = roll();
  expect(() => enemyAuthoringContextValue({ ...context, versionAttempt: {} })).toThrow();
  try {
    enemyAuthoringContextValue({ ...context, versionAttempt: {} });
    throw new Error('Unexpected acceptance');
  } catch (error) {
    expect(error).not.toBeInstanceOf(TypeError);
  }
});
it('refuses replacement seed, wrong operation linkage and a roll from the parent instead of018', () => {
  const { context, cause, previous } = roll();
  expect(() => reduceEnemyAuthoring(previous, cause, 'ENM-012', revisions)).toThrow();
  expect(() =>
    reduceEnemyAuthoring(previous, { ...cause, receiptId: id('299') }, 'ENM-018', revisions),
  ).toThrow();
  expect(() => reduceEnemyAuthoring(context, cause, 'ENM-018', revisions)).toThrow();
  expect(() =>
    enemyAuthoringContextValue({
      ...context,
      monsterStatRoll: { ...context.monsterStatRoll, generationSeed: 'b'.repeat(64) },
    }),
  ).toThrow();
});
it('refuses foreign aliases, return selection, origin/version mismatch and SENTIENT smuggling', () => {
  const { cause, context } = roll(),
    payload = cause.request.payload;
  for (const patch of [
    { attemptId: id('299') },
    { monsterDraftId: id('299') },
    { returnFormId: 'ENM-017' },
    { originFormId: 'ENM-017' },
    { versionBindingOrNull: { templateId: id('299'), expectedCurrentVersion: 1 } },
  ])
    expect(() => monsterStatRollCommandPayloadValue({ ...payload, ...patch })).toThrow();
  const sentient = { ...context, attemptOrNull: { ...context.attemptOrNull, kind: 'SENTIENT' } };
  expect(() => enemyAuthoringContextValue(sentient)).toThrow();
});
it('does not let a committed receipt reopen018 or a never-rolled context view019', () => {
  const { context } = roll(),
    state = context.monsterStatRoll;
  if (state === undefined) throw new Error('Missing unit state');
  const cause = {
    ...mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'MONSTER_STAT_DRAFT',
      data: { sourceActionKey: 'ENM-012::CTA::005', draftOrNull: state.draftOrNull },
    }),
    preparedMonsterStatRoll: state,
  };
  expect(() => reduceEnemyAuthoring(context, cause, 'ENM-012', revisions)).toThrow();
  const before = open().context;
  const other = {
    ...mutation(before, 'UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'MONSTER_STAT_DRAFT',
      data: { sourceActionKey: 'ENM-012::CTA::002', draftOrNull: null },
    }),
    preparedMonsterStatRoll: before.monsterStatRoll,
  };
  expect(() =>
    reduceEnemyAuthoring(before, enemyAuthoringMutationValue(other), 'ENM-012', revisions),
  ).toThrow();
});

it('preserves pending version stats across own-choice preview, discard and confirmation without accepting a body', () => {
  const base = initial();
  const version = enemyAuthoringContextValue({
    ...base,
    versionAttempt: {
      schemaVersion: 1,
      origin: {
        schemaVersion: 1,
        navigationRequestId: id('260'),
        expectedRevisions: revisions,
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
      reason: 'Own-choice change',
      retainedMandatoryFacts: { schemaVersion: 1, kind: 'CUSTOM_MONSTER', advisorCards: [] },
      unconfiguredAdvisorCardIdOrNull: null,
      replacementPreviewOrNull: null,
    },
  });
  const binding = enemyMonsterStatRollBinding(version);
  const draft = monsterStatsDraftValue({
    baseStats: { S: 1, D: 1, M: 1, Z: 1, I: 1, W: 1, C: 1 },
    massKg: null,
    ageYears: null,
    baseMaxHP: null,
  });
  let context = enemyAuthoringContextValue({
    ...version,
    monsterStatRoll: createMonsterStatRollState(binding, seed, draft),
  });
  const input = { kind: 'CUSTOM_MONSTER' as const, advisorSkills: [] };
  const previewFor = (c: EnemyAuthoringContext) => {
    const attempt = c.attemptOrNull,
      state = c.versionAttempt;
    if (attempt === null || state === undefined) throw new Error('Missing unit version');
    return {
      schemaVersion: 1 as const,
      previewCommandId: id('270'),
      attemptId: attempt.attemptId,
      sourceAttemptRevision: attempt.revision,
      origin: state.origin,
      input,
      inputSummary: { kind: 'CUSTOM_MONSTER' as const, advisorOwnChoices: [] },
      before: attempt,
      invalidateComposition: true as const,
      invalidateInventory: false,
    };
  };
  function step(
    data: object,
    nextPreview: ReturnType<typeof previewFor> | null,
    confirmed = false,
  ) {
    const attempt = context.attemptOrNull,
      state = context.versionAttempt;
    if (attempt === null || state === undefined) throw new Error('Missing unit version');
    const cause = enemyAuthoringMutationValue({
      ...mutation(context, 'UI-CMD-ENEMY-DRAFT-PATCH', {
        stage: 'VERSION_CONFIGURATION',
        data,
      }),
      versionPatchSourceFormId: 'ENM-017',
      preparedVersionConfiguration: {
        attempt: { ...attempt, revision: attempt.revision + 1 },
        state: {
          ...state,
          replacementPreviewOrNull: nextPreview,
          ...(confirmed ? { configurationConfirmation: { commandId: id('262'), input } } : {}),
        },
      },
    });
    context = reduceEnemyAuthoring(context, cause, 'ENM-017', revisions).context;
    expect(context.monsterStatRoll).toEqual(
      version.monsterStatRoll ?? createMonsterStatRollState(binding, seed, draft),
    );
    expect(
      context.attemptOrNull?.kind === 'CUSTOM_MONSTER' && context.attemptOrNull.statsOrNull,
    ).toBeNull();
  }
  const preview1 = previewFor(context);
  step({ operation: 'PREVIEW_REPLACEMENT', input }, preview1);
  step({ operation: 'DISCARD_REPLACEMENT', previewCommandId: preview1.previewCommandId }, null);
  const preview2 = previewFor(context);
  step({ operation: 'PREVIEW_REPLACEMENT', input }, preview2);
  step(
    {
      operation: 'CONFIRM_REPLACEMENT',
      previewCommandId: preview2.previewCommandId,
      input,
      displayedPreview: preview2,
      consent: true,
    },
    null,
    true,
  );
});
