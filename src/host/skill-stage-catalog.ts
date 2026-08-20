import { join, resolve } from 'node:path';

import {
  createSkillStageCatalog,
  type SkillStageCatalog,
  type SkillStageCatalogSources,
} from '../domain/index.js';
import { readJsonFile } from './json-source.js';

const SOURCE_FILES = Object.freeze({
  classes: 'classes.json',
  dictionaries: 'dictionaries.json',
  modifiers: 'modifiers.json',
  races: 'races.json',
  requirements: 'skill-requirements.json',
  skills: 'skills.json',
  stats: 'stats.json',
} as const satisfies Record<keyof SkillStageCatalogSources, string>);

/** Loads the seven generated character tables validated by the pure domain catalog. */
export async function loadSkillStageCatalog(projectRoot: string): Promise<SkillStageCatalog> {
  const root = join(resolve(projectRoot), 'generated', 'spec', 'character');
  const entries = await Promise.all(
    Object.entries(SOURCE_FILES).map(async ([key, file]) => [
      key,
      await readJsonFile(join(root, file), 'skill-stage catalog source'),
    ]),
  );
  return createSkillStageCatalog(Object.fromEntries(entries) as SkillStageCatalogSources);
}
