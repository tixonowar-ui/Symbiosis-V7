import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { enemyVersionIdentityValue } from '@shared/enemy-authoring.js';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';
import { configurePersistenceDatabase } from './database.js';
import { readGmRequestReviewViewStateInTransaction } from './campaign-creation.js';
import { readEnemyVersionSourceAtPrefix } from './enemy-version-source.js';
import { collectEnemyVersionMandatoryFacts } from './enemy-version-source.js';
import { enemyVersionMandatoryFactsValue } from '@shared/enemy-version-facts.js';

it.each([
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz'],
])(
  'resolves genuine %s only from an actual earlier owning commit, with no SQL writes',
  (folder, filename) => {
    const root = join('tests/fixtures', folder);
    const metadata = r.record(
      JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8')),
      '$.metadata',
    );
    const scopeValue = r.record(metadata['scope'], '$.scope');
    const scope = {
      campaignId: r.uuid(scopeValue['campaignId'], '$.campaignId'),
      ownerDeviceId: r.uuid(scopeValue['ownerDeviceId'], '$.ownerDeviceId'),
      gmLocalContextId: r.uuid(scopeValue['gmLocalContextId'], '$.gmLocalContextId'),
    };
    const db = new Database(gunzipSync(readFileSync(join(root, filename))));
    try {
      configurePersistenceDatabase(db);
      const bytes = db.serialize();
      db.transaction(() => {
        const state = readGmRequestReviewViewStateInTransaction(db, scope);
        const row = db
          .prepare<[], { record_json: string }>('SELECT record_json FROM campaign_enemy_version')
          .get();
        if (row === undefined) throw new Error('Missing genuine saved version');
        const record = r.record(JSON.parse(row.record_json), '$.record');
        const identity = enemyVersionIdentityValue(record['identity']);
        const result = readEnemyVersionSourceAtPrefix(db, scope, state.events, identity);
        expect(result.identity).toEqual(identity);
        expect(result.attempt).toEqual(record['attempt']);
        const facts = collectEnemyVersionMandatoryFacts(state.events, identity);
        expect(facts.kind).toBe(identity.kind);
        if (facts.kind === 'SENTIENT') {
          const actual = r.record(record['attempt'], '$.attempt');
          const ledger = r.record(actual['compositionAcquisitions'], '$.acquisitions');
          expect(facts.freeSlotOrNull).toEqual(ledger['freeSlotOrNull']);
          expect(facts.freeSlotOrNull).not.toBeNull();
        } else {
          expect(Object.hasOwn(facts, 'freeSlotOrNull')).toBe(false);
          expect(() =>
            enemyVersionMandatoryFactsValue({ ...facts, freeSlotOrNull: null }),
          ).toThrow();
        }
        expect(facts.advisorCards).toEqual([]);
        expect(() =>
          collectEnemyVersionMandatoryFacts(state.events, { ...identity, version: 2 }),
        ).toThrow('SOURCE_CHANGED');
        const commitIndex = state.events.findIndex(
          (event) => event.eventId === record['operationId'],
        );
        expect(commitIndex).toBeGreaterThan(0);
        // SQL already contains the real immutable row; it still cannot prove a future commit.
        expect(() =>
          readEnemyVersionSourceAtPrefix(db, scope, state.events.slice(0, commitIndex), identity),
        ).toThrow();
        expect(() =>
          readEnemyVersionSourceAtPrefix(db, scope, state.events, {
            ...identity,
            campaignId: '00000000-0000-4000-8000-000000000998',
          }),
        ).toThrow('FOREIGN_OWNER');
        const changed = state.events.map((event, index) =>
          index !== commitIndex - 1
            ? event
            : {
                ...event,
                view: {
                  ...event.view,
                  enemyAuthoring: { attemptOrNull: null, selectedVersionOrNull: null },
                },
              },
        );
        expect(() => readEnemyVersionSourceAtPrefix(db, scope, changed, identity)).toThrow(
          'SOURCE_CHANGED',
        );
      })();
      expect(db.serialize().equals(bytes)).toBe(true);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  },
);
