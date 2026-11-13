import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { beforeAll, expect, it } from 'vitest';
import { loadNpcAuthoringSourceCatalog } from '../../../host/npc-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from '../../../host/enemy-authoring-catalog.js';
import { deriveEnemyVersionReplacementSummary } from '../../../host/enemy-version-preparation.js';
import {
  enemyAuthoringContextValue,
  enemyAuthoringMutationValue,
  enemyVersionIdentityValue,
} from '@shared/enemy-authoring.js';
import {
  enemyVersionOriginValue,
  enemyVersionConfigurationInputValue,
  enemyVersionReplacementPreviewValue,
  enemyVersionDiffValue,
  enemyVersionDiffDataValue,
} from '@shared/enemy-version-configuration.js';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';
import {
  assertEnemyVersionReplacementConsent,
  copyEnemyVersionAttempt,
  diffEnemyVersionValues,
  previewEnemyVersionReplacement,
  enemyVersionLegacyEffectRequiresUpgrade,
} from './version-configuration.js';
import { enemyVersionMandatoryFactsValue } from '@shared/enemy-version-facts.js';

let catalog: ReturnType<typeof loadEnemyAuthoringSourceCatalog>;
beforeAll(async () => {
  catalog = loadEnemyAuthoringSourceCatalog(
    process.cwd(),
    await loadNpcAuthoringSourceCatalog(process.cwd()),
  );
});
function previewWithActualSummary(
  ...args: Parameters<typeof previewEnemyVersionReplacement> extends [...infer T, unknown]
    ? T
    : never
) {
  return previewEnemyVersionReplacement(
    ...args,
    deriveEnemyVersionReplacementSummary(catalog, args[2]),
  );
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function oldVersion(fixture: string) {
  const db = new Database(gunzipSync(readFileSync('tests/fixtures/' + fixture)));
  try {
    const row = db
      .prepare<[], { record_json: string }>(
        'SELECT record_json FROM campaign_enemy_version WHERE version=1',
      )
      .get();
    if (row === undefined) throw new Error('Genuine fixture has no version');
    const record = r.record(JSON.parse(row.record_json), '$.saved');
    const identity = enemyVersionIdentityValue(record['identity']);
    const attempt = enemyAuthoringContextValue({
      attemptOrNull: record['attempt'],
      selectedVersionOrNull: null,
    }).attemptOrNull;
    if (attempt === null) throw new Error('Genuine fixture has no attempt');
    return { identity, attempt };
  } finally {
    db.close();
  }
}
const fixtures = [
  'enemy-empty-v1/schema21-empty-v1.sqlite.gz',
  'enemy-composed-v1/schema21-composed-v1.sqlite.gz',
  'enemy-custom-v1/schema22-custom-v1.sqlite.gz',
] as const;
it('distinguishes an inactive zero FREE loss from an unrepresented permanent loss or active FREE slot', () => {
  const legacy = oldVersion(fixtures[0]).attempt;
  const composed = oldVersion(fixtures[1]).attempt;
  if (legacy.kind !== 'SENTIENT' || composed.kind !== 'SENTIENT')
    throw new Error('Missing genuine SENTIENT examples');
  expect(legacy.buildOrNull?.raceCode).toBe('PURE');
  const acquired = composed.compositionAcquisitions?.freeSlotOrNull;
  if (acquired == null) throw new Error('Missing genuine R6 provenance');
  const nonzero = enemyVersionMandatoryFactsValue({
    schemaVersion: 1,
    kind: 'SENTIENT',
    freeSlotOrNull: acquired,
    advisorCards: [],
  });
  const zero = enemyVersionMandatoryFactsValue({
    ...nonzero,
    freeSlotOrNull: {
      ...acquired,
      statsBefore: { S: 1, M: 1, Z: 1 },
      permanentStatConsequence: { S: 0, M: 0, Z: 0 },
    },
  });
  expect(enemyVersionLegacyEffectRequiresUpgrade(legacy, zero)).toBe(false);
  expect(enemyVersionLegacyEffectRequiresUpgrade(legacy, nonzero)).toBe(true);
  expect(
    enemyVersionLegacyEffectRequiresUpgrade(
      { ...legacy, buildOrNull: { raceCode: 'FREE', pureClassOrNull: null, skillSelections: [] } },
      zero,
    ),
  ).toBe(true);
  expect(legacy).not.toHaveProperty('compositionAcquisitions');
});
function source(fixture: string) {
  const base = oldVersion(fixture);
  const origin = enemyVersionOriginValue({
    schemaVersion: 1,
    navigationRequestId: id(259),
    base: base.identity,
    expectedRevisions: { stateRevision: 11, projectionRevision: 17, actorVisibilityRevision: 3 },
  });
  return { base, origin, attempt: copyEnemyVersionAttempt(origin, base) };
}
function inputFor(attempt: ReturnType<typeof source>['attempt']) {
  if (attempt.kind === 'CUSTOM_MONSTER')
    return enemyVersionConfigurationInputValue({ kind: attempt.kind, advisorSkills: [] });
  return enemyVersionConfigurationInputValue({
    kind: attempt.kind,
    initialInput: { baseStats: attempt.baseStatsOrNull, build: attempt.buildOrNull },
    advisorSkills: [],
  });
}

it.each(fixtures)(
  'copies the real old full %s without new accounting/absence or mutation',
  (fixture) => {
    const { base, origin, attempt } = source(fixture);
    expect(attempt).toEqual({ ...base.attempt, attemptId: id(259), revision: 0 });
    expect(attempt).not.toBe(base.attempt);
    expect(origin.base).toEqual(base.identity);
    expect(attempt).not.toHaveProperty('versionConfiguration');
    if (attempt.kind === 'SENTIENT' && base.attempt.kind === 'SENTIENT') {
      expect(Object.hasOwn(attempt, 'skillPlanState')).toBe(
        Object.hasOwn(base.attempt, 'skillPlanState'),
      );
      expect(attempt.skillPlanState).toEqual(base.attempt.skillPlanState);
      expect(attempt.compositionAcquisitions).toEqual(base.attempt.compositionAcquisitions);
      if (attempt.compositionAcquisitions !== undefined)
        expect(attempt.compositionAcquisitions).not.toBe(base.attempt.compositionAcquisitions);
    }
    const changedSource = { ...base, identity: { ...base.identity, templateId: id(998) } };
    expect(() => copyEnemyVersionAttempt(origin, changedSource)).toThrow('owning template/version');
  },
);

it.each(fixtures)(
  'binds deliberate identical replacement consent to the actual prefix for %s',
  (fixture) => {
    const { attempt, origin } = source(fixture);
    const input = inputFor(attempt);
    const preview = previewWithActualSummary(origin, attempt, input, id(260));
    const actual = {
      origin,
      attempt: { ...attempt, revision: 1 },
      input,
      displayedPreview: preview,
    };
    expect(() => assertEnemyVersionReplacementConsent(preview, actual)).not.toThrow();
    expect(preview.before).toEqual(attempt);
    expect(preview.before).not.toBe(attempt);
    expect(() => assertEnemyVersionReplacementConsent(preview, { ...actual, attempt })).toThrow(
      'stale/changed',
    );
    expect(() =>
      assertEnemyVersionReplacementConsent(preview, {
        ...actual,
        origin: { ...origin, navigationRequestId: id(261) },
      }),
    ).toThrow('stale/changed');
    expect(() =>
      assertEnemyVersionReplacementConsent(preview, {
        ...actual,
        displayedPreview: { ...preview, previewCommandId: id(262) },
      }),
    ).toThrow('stale/changed');
    expect(() =>
      assertEnemyVersionReplacementConsent(preview, {
        ...actual,
        attempt: { ...actual.attempt, identityOrNull: null },
      }),
    ).toThrow('stale/changed');
    // Preview/consent checking is read-only; it does not issue a plan, forget a skill or reset a pool.
    expect(attempt).toEqual(preview.before);
  },
);

it('rejects cross-kind input and hidden/accessor fields before any caller uses a preview', () => {
  const { attempt, origin } = source(fixtures[1]);
  const input = inputFor(attempt);
  const preview = previewWithActualSummary(origin, attempt, input, id(260));
  expect(() =>
    enemyVersionReplacementPreviewValue({
      ...preview,
      input: { kind: 'CUSTOM_MONSTER', advisorSkills: [] },
    }),
  ).toThrow();
  expect(() =>
    enemyVersionConfigurationInputValue({
      kind: 'CUSTOM_MONSTER',
      advisorSkills: [],
      initialInput: {},
    }),
  ).toThrow();
  expect(() =>
    enemyVersionConfigurationInputValue({
      kind: 'CUSTOM_MONSTER',
      advisorSkills: [
        { skillKey: 'LEARNING', targetBonus: 6 },
        { skillKey: 'LEARNING', targetBonus: 7 },
      ],
    }),
  ).toThrow();
  let reads = 0;
  const hidden = Object.defineProperty(
    { kind: 'CUSTOM_MONSTER', advisorSkills: [] },
    'initialInput',
    {
      get() {
        reads++;
        return {};
      },
      enumerable: true,
    },
  );
  expect(() => enemyVersionConfigurationInputValue(hidden)).toThrow();
  expect(reads).toBe(0);
  expect(() => enemyVersionOriginValue({ ...origin, expectedCurrentVersion: 1 })).toThrow();
  expect(() => enemyVersionDiffDataValue(hidden)).toThrow();
  expect(reads).toBe(0);
  expect(() => enemyVersionDiffDataValue(Array(1))).toThrow();
});

it('repreviews after discard without recursively embedding the previous preview or reviving old consent', () => {
  const { attempt, origin } = source(fixtures[1]);
  const input = inputFor(attempt);
  const first = previewWithActualSummary(origin, attempt, input, id(260));
  // Preview and discard are context metadata. The candidate changes only its command revision.
  const afterDiscard = { ...attempt, revision: 2 };
  const second = previewWithActualSummary(origin, afterDiscard, input, id(261));
  expect(second.before).toEqual(afterDiscard);
  expect(second.before).not.toHaveProperty('replacementPreview');
  expect(JSON.stringify(second).length).toBe(JSON.stringify(first).length);
  const actual = {
    origin,
    attempt: { ...attempt, revision: 3 },
    input,
    displayedPreview: second,
  };
  expect(() => assertEnemyVersionReplacementConsent(second, actual)).not.toThrow();
  expect(() => assertEnemyVersionReplacementConsent(first, actual)).toThrow('stale/changed');
  expect(() =>
    enemyVersionReplacementPreviewValue({
      ...second,
      before: { ...second.before, replacementPreview: first },
    }),
  ).toThrow();
  if (attempt.kind !== 'SENTIENT' || first.before.kind !== 'SENTIENT')
    throw new Error('Expected the genuine composed SENTIENT fixture');
  expect(attempt.skillPlanState).toEqual(first.before.skillPlanState);
});

it('decodes positive history versions without allowing a V1 cause to commit N+1', () => {
  for (const fixture of [fixtures[0], fixtures[2]]) {
    const { identity } = oldVersion(fixture);
    expect(enemyVersionIdentityValue({ ...identity, version: 2 }).version).toBe(2);
    for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => enemyVersionIdentityValue({ ...identity, version })).toThrow();
    const mutation = {
      authorMasterProfileId: id(501),
      sourceBaselineVersion: 'B17',
      receiptId: id(502),
      timestamp: '2026-11-13T07:00:00.000Z',
      itemTemplateKeys: [],
      committedVersionOrNull: identity,
      request: {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: id(503),
        workflowCommandId: 'UI-CMD-ENEMY-COMMIT-V1',
        expectedRevisions: { stateRevision: 1, projectionRevision: 2, actorVisibilityRevision: 0 },
        payload: {
          campaignId: identity.campaignId,
          creationAttemptId: id(504),
          expectedAttemptRevision: 0,
        },
      },
    };
    expect(() => enemyAuthoringMutationValue(mutation)).not.toThrow();
    expect(() =>
      enemyAuthoringMutationValue({
        ...mutation,
        committedVersionOrNull: { ...identity, version: 2 },
      }),
    ).toThrow();
  }
});

it('reports actual values, null/absence and array changes with stable escaped JSON pointers', () => {
  const before = { name: 'Старое', 'a/b~c': 1, absentLater: null, items: [{ quantity: 1 }] };
  const after = { name: 'Новое', 'a/b~c': 2, addedNull: null, items: [{ quantity: 2 }] };
  expect(diffEnemyVersionValues(before, after)).toEqual([
    { path: '/a~1b~0c', before: { present: true, value: 1 }, after: { present: true, value: 2 } },
    { path: '/absentLater', before: { present: true, value: null }, after: { present: false } },
    { path: '/addedNull', before: { present: false }, after: { present: true, value: null } },
    {
      path: '/items',
      before: { present: true, value: [{ quantity: 1 }] },
      after: { present: true, value: [{ quantity: 2 }] },
    },
    {
      path: '/name',
      before: { present: true, value: 'Старое' },
      after: { present: true, value: 'Новое' },
    },
  ]);
  expect(diffEnemyVersionValues({ b: 2, a: 1 }, { a: 1, b: 2 })).toEqual([]);
  expect(diffEnemyVersionValues(1, ['new'])).toEqual([
    { path: '', before: { present: true, value: 1 }, after: { present: true, value: ['new'] } },
  ]);
  expect(() =>
    enemyVersionDiffValue([
      { path: '/~2', before: { present: false }, after: { present: true, value: null } },
    ]),
  ).toThrow();
});
