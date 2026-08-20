import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('skill-stage catalog loader', () => {
  it('loads the seven generated sources through the domain validator', async () => {
    const catalog = await loadSkillStageCatalog(resolve(import.meta.dirname, '..', '..'));

    expect(catalog.stats.map(({ statCode }) => statCode)).toEqual([
      'S',
      'D',
      'M',
      'Z',
      'I',
      'W',
      'C',
    ]);
    expect(catalog.races.map(({ raceCode, classPolicy }) => ({ classPolicy, raceCode }))).toEqual([
      { classPolicy: 'REQUIRED_PURE_CLASS', raceCode: 'PURE' },
      { classPolicy: 'NO_CLASS', raceCode: 'FREE' },
      { classPolicy: 'NO_CLASS', raceCode: 'UNITED' },
    ]);
    expect(catalog.classes.map(({ classCode }) => classCode)).toEqual([
      'SEEKER',
      'STALKER',
      'SOLDIER',
    ]);
  });

  it('names a missing source and rejects malformed JSON before catalog construction', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-skill-stage-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'generated', 'spec', 'character');
    mkdirSync(source, { recursive: true });

    await expect(loadSkillStageCatalog(directory)).rejects.toThrow(
      'cannot read skill-stage catalog',
    );
    for (const file of [
      'classes.json',
      'dictionaries.json',
      'modifiers.json',
      'races.json',
      'skill-requirements.json',
      'skills.json',
      'stats.json',
    ]) {
      writeFileSync(join(source, file), '[]');
    }
    writeFileSync(join(source, 'classes.json'), '{');
    await expect(loadSkillStageCatalog(directory)).rejects.toThrow('malformed skill-stage catalog');
  });
});
