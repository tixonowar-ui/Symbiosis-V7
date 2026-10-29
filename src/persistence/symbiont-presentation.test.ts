import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import { migration0001 } from './migrations/0001-initial.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { migration0003 } from './migrations/0003-device-identity.js';
import { migration0004 } from './migrations/0004-skill-presentation.js';
import { applyMigrations, applyMigrationSequence } from './migrations/index.js';
import {
  readLocalCharacterSymbiontPresentation,
  writeLocalCharacterSymbiontPresentation,
  type SymbiontPresentationStage,
} from './symbiont-presentation.js';
import { writeLocalCharacterSkillPresentation } from './skill-presentation.js';
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

const route = (formId: string): string =>
  formId === 'CHR-018'
    ? '/player/characters/:localCharacterId/create/chr-018/:speciesKey'
    : `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`;

function stage(formId: SymbiontPresentationStage['formId']) {
  return {
    formId,
    compositionDraftRevision: 7,
    projectionRevision: 8,
    routeBindings:
      formId === 'CHR-018'
        ? [
            { parameterIndex: 0, source: 'inherited', value: 'character-draft' },
            { parameterIndex: 1, source: 'client-selected', value: 'OWL' },
          ]
        : [{ parameterIndex: 0, source: 'inherited', value: 'character-draft' }],
    routeTemplate: route(formId),
  } as const;
}

describe('local character symbiont presentation', () => {
  it('round-trips composition and correction forms while preserving the character snapshot', () => {
    const database = memoryDatabase();
    createLocalCharacter(database, 'character-draft', 'DRAFT', '{"unchanged":true}');
    const before = database
      .prepare(
        'SELECT payload_json, stateRevision FROM local_character WHERE local_character_id = ?',
      )
      .get('character-draft');
    for (const formId of [
      'CHR-001',
      'CHR-009',
      'CHR-010',
      'CHR-011',
      'CHR-020',
      'CHR-025',
      'CHR-032',
      'CHR-017',
      'CHR-018',
      'CHR-019',
      'CHR-041',
      'CHR-042',
    ] as const) {
      const value = stage(formId);
      writeLocalCharacterSymbiontPresentation(database, value);
      expect(readLocalCharacterSymbiontPresentation(database, 'character-draft')).toEqual(value);
    }
    expect(
      database
        .prepare(
          'SELECT payload_json, stateRevision FROM local_character WHERE local_character_id = ?',
        )
        .get('character-draft'),
    ).toEqual(before);
  });

  it('rejects unknown forms, wrong bindings, invalid revisions and foreign ownership', () => {
    const database = memoryDatabase();
    expect(() =>
      writeLocalCharacterSymbiontPresentation(database, {
        ...stage('CHR-018'),
        formId: 'CHR-026',
      }),
    ).toThrow('formId');
    expect(() =>
      writeLocalCharacterSymbiontPresentation(database, {
        ...stage('CHR-001'),
        routeBindings: [
          { parameterIndex: 0, source: 'executor-allocated', value: 'character-draft' },
        ],
      }),
    ).toThrow('inherited');
    expect(() =>
      writeLocalCharacterSymbiontPresentation(database, {
        ...stage('CHR-018'),
        routeBindings: [
          stage('CHR-018').routeBindings[0],
          { ...stage('CHR-018').routeBindings[1], source: 'inherited' },
        ],
      }),
    ).toThrow('client-selected');
    expect(() =>
      writeLocalCharacterSymbiontPresentation(database, {
        ...stage('CHR-019'),
        routeBindings: [stage('CHR-019').routeBindings[0], stage('CHR-019').routeBindings[0]],
      }),
    ).toThrow('routeBindings');
    expect(() =>
      writeLocalCharacterSymbiontPresentation(database, {
        ...stage('CHR-019'),
        projectionRevision: -1,
      }),
    ).toThrow('non-negative');
    expect(() => writeLocalCharacterSymbiontPresentation(database, stage('CHR-018'))).toThrow(
      'FOREIGN KEY constraint failed',
    );
    createLocalCharacter(database, 'character-draft', 'DRAFT', '{}');
    writeLocalCharacterSymbiontPresentation(database, stage('CHR-018'));
    expect(readLocalCharacterSymbiontPresentation(database, 'other-character')).toBeNull();
    const foreign = stage('CHR-018');
    database
      .prepare(
        `UPDATE local_character_symbiont_presentation
         SET presentation_json = ? WHERE local_character_id = ?`,
      )
      .run(
        JSON.stringify({
          ...foreign,
          routeBindings: [
            { ...foreign.routeBindings[0], value: 'other-character' },
            foreign.routeBindings[1],
          ],
        }),
        'character-draft',
      );
    expect(() => readLocalCharacterSymbiontPresentation(database, 'character-draft')).toThrow(
      'belongs to another character',
    );
  });

  it('upgrades an existing 0004 database without changing skill presentation', () => {
    const database = new Database(':memory:');
    databases.push(database);
    applyMigrationSequence(database, [migration0001, migration0002, migration0003, migration0004]);
    createLocalCharacter(database, 'character-draft', 'DRAFT', '{}');
    const skillStage = {
      formId: 'CHR-015',
      projectionRevision: 4,
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character-draft' }],
      routeTemplate: '/player/characters/:localCharacterId/create/chr-015',
      selectionRevision: 3,
    } as const;
    writeLocalCharacterSkillPresentation(database, skillStage);

    expect(applyMigrations(database)).toBe(6);
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name = 'local_character_symbiont_presentation'`,
        )
        .get(),
    ).toEqual({ name: 'local_character_symbiont_presentation' });
    expect(
      database
        .prepare(
          'SELECT presentation_json FROM local_character_skill_presentation WHERE local_character_id = ?',
        )
        .get('character-draft'),
    ).toEqual({ presentation_json: JSON.stringify(skillStage) });
  });
});
