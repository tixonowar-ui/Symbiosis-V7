import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSymbiontCatalog } from '../domain/rules/symbiont-stage/catalog.js';
import {
  createCreationFinalizationCatalog,
  CreationFinalizationError,
} from '../domain/rules/creation-finalization/catalog.js';
import type { CreationFinalizationCatalog } from '../domain/rules/creation-finalization/types.js';
import { array, record, readJsonFile } from './json-source.js';

// SHA-256 of each exact supplied Итоговый алгоритм, not a rule version invented
// by the application. A changed source requires a new review of the implementation.
const ALGORITHM_DIGESTS = Object.freeze({
  'CORE-159': '24374d09c59703b1ccf2eb5cd3747e50f79a66df9448b5b6e415180fc6d2c160',
  'CORE-164': '525e242020b10afda5e676e5a1969ab700cdb1e4db0fee7c9241349db750f0ed',
  'CORE-081': '17082a01ad9e150002e1d740d5147f7c9766590549a89e65dd6396083fa68510',
  'CORE-165': '78e6a73c705ce5e497bcaa8728fa26df38ba33605cf6579c15fa03cb828961dd',
  'CORE-166': '9b8239d245e65ba9ba882968768978542913658fb819975697ad24ce0b4a92db',
  'AQA-004': '1fd29cfbb230ea0e23da1255fc2b0a3799f0f1891fce57b32794c34fd9b310b6',
  'AQA-005': '2699bc7ed60b97220bd3ddbd9ca51e6ac263ac2c30fb353dcd1afd9836285a7c',
  'AQA-007': '2038b18c0e091d5748b6acb2c95751c5e1b18e61eaf89cc05bf6952a71dad707',
  'AQA-008': 'f65da00c5c546f5e237f7d608f86a3502a93e4afef6aaaf0fcad8f9f64a0f3e6',
  'AQA-009': 'ab8c65e7dbb23efb13fa35dd4f2e107624bd055e0b4a96a92bf99f6d682b9814',
  'SYM-182': 'bd313ddae40ee6861aae0ff443f67f2171c846728d4a2213f3979a0407a21f14',
  'SYM-038': '4a4423fbe2460b27b87608d1891359151c9478084b7785c852035a269c1bb6d2',
  'SYM-054': 'bdc862b44d0d4712827fc4991688909831e06f8807068f6752ca5f5bd7468700',
  'SYM-074': '87d0bc5c8399d8ef5114501c1fc071c65efa8462c784fea5bb9635cc5bbf9eaa',
  'SYM-075': 'be0a6700b407b6088b587ecf6a0c09fdf56c5d15b007b28a820e2c304ef78ec7',
  'SYM-076': 'e9a0bf8c3d41328c3f9994124b3c41173422c97c6c76cbdac0fb9b5622caf691',
  'SYM-079': 'cdd52f9ce56713d007e68225f87a3e85744b9f58788814cb1e998188c7f63e18',
  'SYM-162': '9861adfbeee184c2e821e8b1eb494fdf7c6d188220ec7df2b05ab075becdb9d7',
  'SYM-185': '64f0f023b57422fff456b23aeb83adc56e31b32c9f7855773fc840b97ca81f08',
  'AQ2-003': 'c6172d964dbaa801215ed5638d99e69e50c1fc455c84967393e768ab43d5319b',
  'AQ2-004': '0739d18bb86ac2896eee78797546956843b6b4465ab2706dd45d0008bd002d79',
  'AQA-014': 'f1f11df1761b2905b252b8063647c33cc342062ad5fc2102174762c21753f109',
});
const FILES = Object.freeze({
  classes: 'character/classes',
  dictionaries: 'character/dictionaries',
  modifiers: 'character/modifiers',
  races: 'character/races',
  requirements: 'character/skill-requirements',
  skills: 'character/skills',
  stats: 'character/stats',
  symbionts: 'character/symbionts',
  incompatibilities: 'character/incompatibilities',
  developmentNodes: 'character/development-nodes',
  rules: 'rules/rules',
});
type Sources = Readonly<Record<keyof typeof FILES, unknown>>;

function build(sources: Sources): CreationFinalizationCatalog {
  const rules = array(sources.rules, 'finalization rules').map((row) =>
    record(row, 'finalization rule'),
  );
  for (const [id, digest] of Object.entries(ALGORITHM_DIGESTS)) {
    const matches = rules.filter((row) => row['Rule ID'] === id);
    const row = matches[0];
    if (
      matches.length !== 1 ||
      row === undefined ||
      row['Статус'] !== 'Активно' ||
      typeof row['Итоговый алгоритм'] !== 'string' ||
      createHash('sha256').update(row['Итоговый алгоритм']).digest('hex') !== digest
    )
      throw new CreationFinalizationError(
        `source algorithm ${id} differs from the reviewed contract`,
      );
  }
  const { developmentNodes, rules: _rules, ...symbiontSources } = sources;
  return createCreationFinalizationCatalog(
    createSymbiontCatalog(symbiontSources),
    developmentNodes,
  );
}

export async function loadCreationFinalizationCatalog(
  projectRoot: string,
): Promise<CreationFinalizationCatalog> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([name, relative]) => [
      name,
      await readJsonFile(
        join(projectRoot, 'generated', 'spec', `${relative}.json`),
        'creation finalization source',
      ),
    ]),
  );
  return build(Object.fromEntries(entries) as Sources);
}

let cached: CreationFinalizationCatalog | undefined;
/** Synchronous immutable source catalog for durable history replay; no allocation or writes. */
export function canonicalCreationFinalizationCatalog(): CreationFinalizationCatalog {
  if (cached === undefined) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    cached = build(
      Object.fromEntries(
        Object.entries(FILES).map(([name, relative]) => [
          name,
          JSON.parse(
            readFileSync(join(root, 'generated', 'spec', `${relative}.json`), 'utf8'),
          ) as unknown,
        ]),
      ) as Sources,
    );
  }
  return cached;
}
