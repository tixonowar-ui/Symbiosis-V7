import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { enemyAuthoringContextValue, enemyVersionIdentityValue } from './enemy-authoring.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import {
  enemyVersionEditorValue,
  enemyVersionEditorReadinessErrors,
} from './enemy-version-editor.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(file: string) {
  const db = new Database(gunzipSync(readFileSync('tests/fixtures/' + file)));
  try {
    const row = db
      .prepare<[], { record_json: string }>(
        'SELECT record_json FROM campaign_enemy_version WHERE version=1',
      )
      .get();
    if (row === undefined) throw new Error('Missing genuine source version');
    const saved = r.record(JSON.parse(row.record_json), '$.saved');
    const identity = enemyVersionIdentityValue(saved['identity']);
    const base = enemyAuthoringContextValue({
      attemptOrNull: saved['attempt'],
      selectedVersionOrNull: null,
    }).attemptOrNull;
    if (base === null) throw new Error('Missing complete source attempt');
    const context = enemyAuthoringContextValue({
      attemptOrNull: { ...base, attemptId: id(259), revision: 0 },
      selectedVersionOrNull: null,
      versionAttempt: {
        schemaVersion: 1,
        origin: {
          schemaVersion: 1,
          navigationRequestId: id(259),
          base: identity,
          expectedRevisions: {
            stateRevision: 5,
            projectionRevision: 8,
            actorVisibilityRevision: 0,
          },
        },
        reason: '',
        replacementPreviewOrNull: null,
        retainedMandatoryFacts:
          base.kind === 'SENTIENT'
            ? {
                schemaVersion: 1,
                kind: base.kind,
                freeSlotOrNull: base.compositionAcquisitions?.freeSlotOrNull ?? null,
                advisorCards: [],
              }
            : { schemaVersion: 1, kind: base.kind, advisorCards: [] },
        ...(base.kind === 'CUSTOM_MONSTER' ? { unconfiguredAdvisorCardIdOrNull: null } : {}),
      },
    });
    return {
      context,
      editor: {
        schemaVersion: 1,
        baseSnapshot: base,
        currentVersion: identity,
        changeSet: [],
        activeCombatPins: [],
        replacementSummaryOrNull: null,
      },
    };
  } finally {
    db.close();
  }
}
const files = [
  'enemy-empty-v1/schema21-empty-v1.sqlite.gz',
  'enemy-composed-v1/schema21-composed-v1.sqlite.gz',
  'enemy-custom-v1/schema22-custom-v1.sqlite.gz',
] as const;
it.each(files)(
  'decodes the distinct immutable real %s base and technical editable copy without manufacturing a new plan',
  (file) => {
    const { editor, context } = fixture(file);
    const decoded = enemyVersionEditorValue(editor, context);
    expect(decoded).toEqual(editor);
    expect(decoded.baseSnapshot.attemptId).not.toBe(context.attemptOrNull?.attemptId);
    expect(enemyVersionEditorReadinessErrors(decoded, context)).toEqual([
      'Укажите и сохраните причину новой версии.',
    ]);
    const reasoned = {
      ...context,
      versionAttempt: { ...context.versionAttempt!, reason: 'Уточнение полного шаблона' },
    };
    expect(enemyVersionEditorReadinessErrors(decoded, reasoned)).toEqual([]);
  },
);
it.each(files)(
  'rejects self-candidate, foreign origin, incomplete base and accessor/pin smuggling for %s',
  (file) => {
    const { editor, context } = fixture(file);
    for (const invalid of [
      { ...editor, baseSnapshot: context.attemptOrNull },
      { ...editor, currentVersion: { ...editor.currentVersion, templateId: id(900) } },
      { ...editor, baseSnapshot: { ...editor.baseSnapshot, identityOrNull: null } },
      { ...editor, activeCombatPins: [{ instanceId: id(901) }] },
      { ...editor, unknown: true },
      {
        ...editor,
        baseSnapshot: Object.defineProperty({ ...editor.baseSnapshot }, 'campaignId', {
          enumerable: true,
          get: () => {
            throw new Error('must never execute');
          },
        }),
      },
    ])
      expect(() => enemyVersionEditorValue(invalid, context)).toThrow('INVALID_SHAPE');
    expect(() =>
      enemyVersionEditorValue(editor, {
        attemptOrNull: context.attemptOrNull,
        selectedVersionOrNull: null,
      }),
    ).toThrow('INVALID_SHAPE');
  },
);
