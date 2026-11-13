import { expect, it } from 'vitest';
import {
  ENEMY_PLACEHOLDER,
  ENEMY_PLACEHOLDER_SHA256,
  type EnemyVersionIdentity,
} from './enemy-authoring.js';
import { CUSTOM_MONSTER_PLACEHOLDER, CUSTOM_MONSTER_PLACEHOLDER_SHA256 } from './custom-monster.js';
import { enemyVersionHistoryValue, type EnemyVersionHistory } from './enemy-version-history.js';
import { enemyLibrarySelectionRequestValue } from './enemy-library.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function history(kind: 'SENTIENT' | 'CUSTOM_MONSTER'): EnemyVersionHistory {
  const base = { campaignId: id(1), templateId: id(2), versionId: id(3), version: 1 };
  const first: EnemyVersionIdentity =
    kind === 'SENTIENT'
      ? { ...base, kind, artAssetKey: ENEMY_PLACEHOLDER, artSha256: ENEMY_PLACEHOLDER_SHA256 }
      : {
          ...base,
          kind,
          artAssetKey: CUSTOM_MONSTER_PLACEHOLDER,
          artSha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
        };
  const current = { ...first, version: 2, versionId: id(4) };
  return {
    current,
    selected: first,
    activeCombatPins: [],
    entries: [
      {
        identity: first,
        timestamp: '2026-11-13T00:00:00.000Z',
        reason: null,
        changeSet: [],
        configurationSummaryOrNull: null,
      },
      {
        identity: current,
        timestamp: '2026-11-13T01:00:00.000Z',
        reason: 'Изменение имени',
        changeSet: [
          {
            path: '/identityOrNull/name',
            before: { present: true, value: 'Первое' },
            after: { present: true, value: 'Второе' },
          },
        ],
        configurationSummaryOrNull: null,
      },
    ],
  };
}
it.each(['SENTIENT', 'CUSTOM_MONSTER'] as const)(
  'keeps selected old %s separate from current in the closed ordered history DTO',
  (kind) => {
    const value = history(kind);
    expect(enemyVersionHistoryValue(value)).toEqual(value);
    expect(enemyVersionHistoryValue(value).selected.version).toBe(1);
    expect(enemyVersionHistoryValue(value).current.version).toBe(2);
  },
);
it.each(['SENTIENT', 'CUSTOM_MONSTER'] as const)(
  'refuses foreign, reordered, duplicate, fabricated pin and non-data %s history packets',
  (kind) => {
    const value = history(kind),
      first = value.entries[0]!,
      last = value.entries[1]!;
    for (const invalid of [
      { ...value, current: value.selected },
      { ...value, selected: { ...value.selected, versionId: id(900) } },
      { ...value, entries: [last, first] },
      {
        ...value,
        entries: [first, { ...last, identity: { ...last.identity, templateId: id(901) } }],
      },
      {
        ...value,
        entries: [
          first,
          { ...last, identity: { ...last.identity, versionId: first.identity.versionId } },
        ],
      },
      { ...value, entries: [first, { ...last, identity: { ...last.identity, version: 3 } }] },
      { ...value, entries: [first, { ...last, reason: null }] },
      { ...value, activeCombatPins: [{ instanceId: id(902) }] },
      { ...value, extra: true },
      {
        ...value,
        current: Object.defineProperty({ ...value.current }, 'version', {
          enumerable: true,
          get: () => {
            throw new Error('must never execute');
          },
        }),
      },
      { ...value, entries: new Array(2) },
      {
        ...value,
        entries: [
          first,
          Object.defineProperty({ ...last }, 'reason', {
            enumerable: true,
            get: () => {
              throw new Error('must never execute');
            },
          }),
        ],
      },
    ])
      expect(() => enemyVersionHistoryValue(invalid)).toThrow('INVALID_SHAPE');
  },
);
it.each(['SENTIENT', 'CUSTOM_MONSTER'] as const)(
  'uses the existing selection protocol for a closed own-kind %s history intent',
  (kind) => {
    const value = history(kind);
    const request = {
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: id(5),
      contextId: id(6),
      campaignId: id(1),
      sourceFormId: 'ENM-020',
      activeTab: kind === 'SENTIENT' ? 'SENTIENT_ENEMIES' : 'MONSTERS',
      expectedRevisions: { stateRevision: 1, projectionRevision: 2, actorVisibilityRevision: 0 },
      selectionOrNull: null,
      userSelectionOrNull: value.selected,
    };
    expect(enemyLibrarySelectionRequestValue(request)).toEqual(request);
    expect(() =>
      enemyLibrarySelectionRequestValue({ ...request, userSelectionOrNull: null }),
    ).toThrow('INVALID_SHAPE');
    expect(() =>
      enemyLibrarySelectionRequestValue({
        ...request,
        activeTab: kind === 'SENTIENT' ? 'MONSTERS' : 'SENTIENT_ENEMIES',
      }),
    ).toThrow('INVALID_SHAPE');
  },
);
