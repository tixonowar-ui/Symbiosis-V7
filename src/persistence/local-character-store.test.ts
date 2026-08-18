import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import { V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';
import {
  createLocalCharacter,
  listLocalCharacters,
  readLocalCharacter,
  updateLocalCharacter,
} from './store.js';

const CREATION_FORM_ID = 'CHR-001';
const databases: Database.Database[] = [];

const memoryDatabase = (): Database.Database => {
  const database = openPersistenceDatabase(':memory:');
  databases.push(database);
  return database;
};

const impact = (
  stateChanged: boolean,
  projectionChanged: boolean,
  actorVisibilityChanged: boolean,
) => ({ stateChanged, projectionChanged, actorVisibilityChanged });

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe(CREATION_FORM_ID, () => {
  it('creates and reads one local character with an exact payload and zero revisions', () => {
    const database = memoryDatabase();
    const payloadJson = '{ "characterDraftId": "character-1", "draftRevision": 9 }';

    expect(createLocalCharacter(database, 'character-1', 'DRAFT', payloadJson)).toEqual({
      localCharacterId: 'character-1',
      lifecycleState: 'DRAFT',
      payloadJson,
      stateRevision: 0,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
    expect(readLocalCharacter(database, 'character-1')).toEqual({
      localCharacterId: 'character-1',
      lifecycleState: 'DRAFT',
      payloadJson,
      stateRevision: 0,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
  });

  it('lists every confirmed local character in deterministic ID order', () => {
    const database = memoryDatabase();
    expect(listLocalCharacters(database)).toEqual([]);

    const second = createLocalCharacter(database, 'character-b', 'FINAL', '{"order":2}');
    const first = createLocalCharacter(database, 'character-a', 'DRAFT', '{"order":1}');

    expect(listLocalCharacters(database)).toEqual([first, second]);
  });

  it('rejects unknown lifecycle states with the complete frozen allow-list', () => {
    const database = memoryDatabase();
    const allowed = `allowed: ${V1_LIFECYCLE_STATES.localCharacter.join(', ')}`;

    expect(() =>
      createLocalCharacter(database, 'unknown-create', 'UNKNOWN' as never, '{}'),
    ).toThrow(allowed);
    expect(database.prepare('SELECT count(*) AS count FROM local_character').get()).toEqual({
      count: 0,
    });

    createLocalCharacter(database, 'character', 'DRAFT', '{}');
    expect(() =>
      updateLocalCharacter(
        database,
        'character',
        { lifecycleState: 'UNKNOWN' } as never,
        impact(true, false, false),
      ),
    ).toThrow(allowed);
    expect(readLocalCharacter(database, 'character').lifecycleState).toBe('DRAFT');
  });

  it.each([
    ['array', '[]', 'array'],
    ['string', '"payload"', 'string'],
    ['null', 'null', 'null'],
  ])('rejects a JSON %s instead of an object', (_label, payloadJson, kind) => {
    const database = memoryDatabase();

    expect(() => createLocalCharacter(database, kind, 'DRAFT', payloadJson)).toThrow(
      `must encode a JSON object, got ${kind}`,
    );
  });

  it('rejects malformed JSON explicitly', () => {
    const database = memoryDatabase();

    expect(() => createLocalCharacter(database, 'malformed', 'DRAFT', '{')).toThrow(
      /payloadJson is not valid JSON/,
    );

    const original = createLocalCharacter(database, 'character', 'DRAFT', '{"version":1}');
    expect(() =>
      updateLocalCharacter(
        database,
        'character',
        { lifecycleState: 'VALID', payloadJson: '{' },
        impact(true, true, false),
      ),
    ).toThrow(/payloadJson is not valid JSON/);
    expect(readLocalCharacter(database, 'character')).toEqual(original);
  });

  it('rejects duplicate creation and missing reads without overwriting the row', () => {
    const database = memoryDatabase();
    createLocalCharacter(database, 'character', 'DRAFT', '{"version":1}');

    expect(() => createLocalCharacter(database, 'character', 'FINAL', '{"version":2}')).toThrow(
      /localCharacter "character" already exists/,
    );
    expect(readLocalCharacter(database, 'character')).toMatchObject({
      lifecycleState: 'DRAFT',
      payloadJson: '{"version":1}',
    });
    expect(() => readLocalCharacter(database, 'missing')).toThrow(
      /localCharacter "missing" not found/,
    );
  });

  it('updates either field and advances only the caller-declared revisions', () => {
    const database = memoryDatabase();
    createLocalCharacter(database, 'character', 'DRAFT', '{"version":1}');

    expect(
      updateLocalCharacter(
        database,
        'character',
        { payloadJson: '{"version":2}' },
        impact(true, false, false),
      ),
    ).toEqual({
      localCharacterId: 'character',
      lifecycleState: 'DRAFT',
      payloadJson: '{"version":2}',
      stateRevision: 1,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });

    expect(
      updateLocalCharacter(
        database,
        'character',
        { lifecycleState: 'VALID' },
        impact(true, true, true),
      ),
    ).toEqual({
      localCharacterId: 'character',
      lifecycleState: 'VALID',
      payloadJson: '{"version":2}',
      stateRevision: 2,
      projectionRevision: 1,
      actorVisibilityRevision: 1,
    });
  });

  it('keeps revisions unchanged for a caller-declared no-op', () => {
    const database = memoryDatabase();
    createLocalCharacter(database, 'character', 'DRAFT', '{"version":1}');

    expect(
      updateLocalCharacter(
        database,
        'character',
        { payloadJson: '{"version":1}' },
        impact(false, false, false),
      ),
    ).toMatchObject({
      stateRevision: 0,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
  });

  it('rolls back the row when actor visibility advances without projection', () => {
    const database = memoryDatabase();
    const original = createLocalCharacter(database, 'character', 'DRAFT', '{"version":1}');

    expect(() =>
      updateLocalCharacter(
        database,
        'character',
        { lifecycleState: 'VALID', payloadJson: '{"version":2}' },
        impact(true, false, true),
      ),
    ).toThrow(/cannot advance without projectionRevision/);
    expect(readLocalCharacter(database, 'character')).toEqual(original);
  });

  it('rolls back payload and lifecycle changes when revision storage fails', () => {
    const database = memoryDatabase();
    const original = createLocalCharacter(database, 'character', 'DRAFT', '{"version":1}');
    database.exec(`CREATE TEMP TRIGGER interrupt_local_character_revision
      BEFORE UPDATE OF stateRevision ON local_character
      BEGIN SELECT RAISE(ABORT, 'interrupted local character revision'); END;`);

    expect(() =>
      updateLocalCharacter(
        database,
        'character',
        { lifecycleState: 'VALID', payloadJson: '{"version":2}' },
        impact(true, true, false),
      ),
    ).toThrow(/interrupted local character revision/);
    expect(readLocalCharacter(database, 'character')).toEqual(original);
  });

  it('rejects missing rows, invalid patches, and nested update transactions', () => {
    const database = memoryDatabase();
    expect(() =>
      updateLocalCharacter(database, 'missing', { payloadJson: '{}' }, impact(true, false, false)),
    ).toThrow(/localCharacter "missing" not found/);

    createLocalCharacter(database, 'character', 'DRAFT', '{}');
    expect(() =>
      updateLocalCharacter(database, 'character', {} as never, impact(false, false, false)),
    ).toThrow(/must contain lifecycleState and\/or payloadJson/);
    expect(() =>
      updateLocalCharacter(
        database,
        'character',
        { unexpected: true } as never,
        impact(false, false, false),
      ),
    ).toThrow(/unrecognized fields: unexpected/);

    const nestedUpdate = database.transaction(() =>
      updateLocalCharacter(
        database,
        'character',
        { payloadJson: '{"nested":true}' },
        impact(true, false, false),
      ),
    );
    expect(() => nestedUpdate.immediate()).toThrow(/requires a top-level transaction/);
    expect(readLocalCharacter(database, 'character').payloadJson).toBe('{}');

    const nestedCreate = database.transaction(() =>
      createLocalCharacter(database, 'nested-create', 'DRAFT', '{}'),
    );
    expect(() => nestedCreate.immediate()).toThrow(/create requires a top-level transaction/);
    expect(() => readLocalCharacter(database, 'nested-create')).toThrow(/not found/);
  });
});
