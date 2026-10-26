import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import {
  readLocalCharacterSkillPresentation,
  writeLocalCharacterSkillPresentation,
} from './skill-presentation.js';
import { createLocalCharacter } from './store.js';

const databases: Database.Database[] = [];
const memoryDatabase = (): Database.Database => {
  const database = openPersistenceDatabase(':memory:');
  databases.push(database);
  return database;
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const stage = {
  formId: 'CHR-014',
  projectionRevision: 8,
  routeBindings: [
    { parameterIndex: 0, source: 'inherited', value: 'character-draft' },
    { parameterIndex: 1, source: 'client-selected', value: 'ACROBATICS' },
  ],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-014/:skillId',
  selectionRevision: 7,
} as const;

describe('local character skill presentation', () => {
  it('stores and replaces the exact host-signed route without changing the character snapshot', () => {
    const database = memoryDatabase();
    createLocalCharacter(database, 'character-draft', 'DRAFT', '{"unchanged":true}');
    const before = database
      .prepare(
        'SELECT payload_json, stateRevision FROM local_character WHERE local_character_id = ?',
      )
      .get('character-draft');
    expect(readLocalCharacterSkillPresentation(database, 'character-draft')).toBeNull();

    writeLocalCharacterSkillPresentation(database, stage);
    expect(readLocalCharacterSkillPresentation(database, 'character-draft')).toEqual(stage);
    const replacement = {
      ...stage,
      formId: 'CHR-013',
      projectionRevision: 9,
      routeBindings: [stage.routeBindings[0]],
      routeTemplate: '/player/characters/:localCharacterId/create/chr-013',
    } as const;
    writeLocalCharacterSkillPresentation(database, replacement);
    expect(readLocalCharacterSkillPresentation(database, 'character-draft')).toEqual(replacement);
    expect(
      database
        .prepare(
          'SELECT payload_json, stateRevision FROM local_character WHERE local_character_id = ?',
        )
        .get('character-draft'),
    ).toEqual(before);
  });

  it('rejects malformed presentation and a missing owner without a fallback', () => {
    const database = memoryDatabase();
    expect(() =>
      writeLocalCharacterSkillPresentation(database, {
        ...stage,
        routeBindings: [stage.routeBindings[0], { ...stage.routeBindings[1], source: 'inherited' }],
      }),
    ).toThrow('client-selected');
    expect(() => writeLocalCharacterSkillPresentation(database, stage)).toThrow(
      'FOREIGN KEY constraint failed',
    );
  });
});
