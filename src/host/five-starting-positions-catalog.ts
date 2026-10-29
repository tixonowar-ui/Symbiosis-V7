import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recommendPositionQuality,
  validateFiveStartingPositionsCatalog,
  type FiveStartingPositionsCatalog,
  type FiveStartingPositionsCatalogEntry,
} from '../domain/rules/item-stage/five-starting-positions.js';
import { array, readJsonFile, record, string, type JsonRecord } from './json-source.js';

export type { FiveStartingPositionsCatalog } from '../domain/rules/item-stage/five-starting-positions.js';

const FILES = [
  'catalogue',
  'open-catalogue',
  'rule-trace',
  'instance-model',
  'dictionaries',
] as const;
type Sources = Readonly<Record<(typeof FILES)[number], unknown>>;

// Item Registry v1.6, 11_Трассировка_правил: full algorithm + NUL + exception text.
// These fingerprints check the complete source contract without copying unrelated rule prose.
const RULE_CONTRACTS = {
  'CORE-172': '3e4e6fff1111e8d2b3f57452c643bb3b34433dd1e8f3188bbfb9448e9c3f061c',
  'CORE-173': '30515a8840ebbb0c14d98acfe1f4f25e90bf07e08a498661833c44a2a943b742',
  'AQA-011': 'f3e0fcce88ed17d294a0921ef187ba60e23e3c79fe512adab33fbb4c94b47640',
  'AQA-012': '01c6625138c2ae7e2512fd734b8e61b5ab366572ebc7e8d892d1f351a2495587',
  'AQ2-003': 'ec17bf805a1f8e451148eda0e631a430fefea2ed3fa1dde6418a3d95b9902c4e',
  'AQ2-004': 'a59b46360c20c8e46efef357d0c0261720a65020ba152bf0171f0d835e2ae7e5',
  'AQ2-005': 'd81a0612293cf1173944f9336d97caa133dde37afd772e5c871c6776beefd370',
} as const;
// 01_Каталог, all 64 rows: [ItemTypeID, name, inventory permission, catalogue class].
const CATALOGUE_CONTRACT = 'dee425d4377b0e47444d3622c8d8d494e4b928917dd61ef1e7b31d993dada366';
const UNRESOLVED_INVENTORY_TYPES = new Set(['RES-MAG-001', 'RES-MAG-002']);

export class FiveStartingPositionsCatalogError extends Error {
  constructor(detail: string) {
    super(`five starting positions catalog: ${detail}`);
    this.name = new.target.name;
  }
}
function fail(detail: string): never {
  throw new FiveStartingPositionsCatalogError(detail);
}
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function one(
  rows: readonly JsonRecord[],
  predicate: (row: JsonRecord) => boolean,
  label: string,
): JsonRecord {
  const selected = rows.filter(predicate);
  if (selected.length !== 1) return fail(`${label}: expected one source row`);
  return selected[0]!;
}
function literal(row: JsonRecord, key: string, expected: unknown, label: string): void {
  if (row[key] !== expected) fail(`${label}.${key} differs from the supplied contract`);
}

function buildCatalog(sources: Sources): FiveStartingPositionsCatalog {
  const rows = (name: (typeof FILES)[number]) =>
    array(sources[name], name).map((value, index) => record(value, `${name}[${String(index)}]`));
  const rules = rows('rule-trace');
  for (const [id, expected] of Object.entries(RULE_CONTRACTS)) {
    const row = one(rules, (candidate) => candidate['Rule ID'] === id, id);
    literal(row, 'Статус', 'Активно', id);
    const contract = `${string(row['Итоговый алгоритм'], id)}\0${string(row['Исключения / приоритет'], id)}`;
    if (digest(contract) !== expected) fail(`${id}: normative rule contract changed`);
  }
  const catalogue = rows('catalogue');
  const catalogueFacts = catalogue.map((row) => [
    row['ItemTypeID'],
    row['Название'],
    row['Можно в инвентарь'],
    row['Класс каталога'],
  ]);
  if (digest(JSON.stringify(catalogueFacts)) !== CATALOGUE_CONTRACT)
    fail('catalogue identities, names or inventory permissions changed');
  const entries: FiveStartingPositionsCatalogEntry[] = [];
  for (const row of catalogue) {
    const id = string(row['ItemTypeID'], 'catalogue.ItemTypeID');
    if (UNRESOLVED_INVENTORY_TYPES.has(id)) {
      literal(row, 'Можно в инвентарь', 'UNKNOWN', id);
      continue;
    }
    literal(row, 'Можно в инвентарь', true, id);
    entries.push(
      Object.freeze({
        itemTypeIdOrStoryType: id,
        kind: 'CATALOGUE',
        name: string(row['Название'], `${id}.name`),
      }),
    );
  }
  const story = one(rows('open-catalogue'), (row) => row['RefID'] === 'GEN-010', 'GEN-010');
  for (const [key, expected] of [
    ['Класс', 'C_OPEN_CATALOG'],
    ['Название/упоминание', 'Любой заявленный стартовый предмет'],
    ['Рекомендуемое представление', 'Свободное описание → согласование мастером'],
    ['Граница автоматизации', 'До структурирования не имеет механики.'],
  ] as const)
    literal(story, key, expected, 'GEN-010');
  entries.push(
    Object.freeze({
      itemTypeIdOrStoryType: 'GEN-010',
      kind: 'STORY',
      name: string(story['Название/упоминание'], 'GEN-010.name'),
    }),
  );

  const instances = rows('instance-model');
  const quantity = one(instances, (row) => row['Field'] === 'quantity', 'quantity');
  for (const [key, expected] of [
    ['Data type', 'INTEGER'],
    ['Required', true],
    ['Scope', 'STACK'],
    ['Validation / constraint', '≥1; изменение атомарно'],
  ] as const)
    literal(quantity, key, expected, 'quantity');
  const qualityRoll = one(instances, (row) => row['Field'] === 'qualityRoll', 'qualityRoll');
  literal(qualityRoll, 'Data type', 'INTEGER', 'qualityRoll');
  literal(
    qualityRoll,
    'Validation / constraint',
    '1..20; рекомендация, не меняет механику автоматически',
    'qualityRoll',
  );
  const dictionaries = rows('dictionaries');
  const quality = dictionaries.filter((row) => row['Dictionary'] === 'QUALITY');
  const domainScale = new Map(
    Array.from({ length: 20 }, (_, index) => {
      const recommendation = recommendPositionQuality(index + 1);
      return [recommendation.range, recommendation.label] as const;
    }),
  );
  if (quality.length !== domainScale.size) fail('QUALITY must contain exactly the supplied ranges');
  for (const [range, label] of domainScale) {
    const row = one(quality, (entry) => entry['Code'] === range, `QUALITY.${range}`);
    literal(row, 'Meaning', label, `QUALITY.${range}`);
  }
  const progression = one(
    dictionaries,
    (row) => row['Dictionary'] === 'ProgressionEligibility' && row['Code'] === 'NEVER_PROGRESSION',
    'NEVER_PROGRESSION',
  );
  literal(progression, 'Meaning', 'Ни XP, ни баллы общего счётчика.', 'NEVER_PROGRESSION');
  const catalog = Object.freeze({ entries: Object.freeze(entries) });
  validateFiveStartingPositionsCatalog(catalog);
  return catalog;
}

export async function loadFiveStartingPositionsCatalog(
  projectRoot: string,
): Promise<FiveStartingPositionsCatalog> {
  const sources = await Promise.all(
    FILES.map((file) =>
      readJsonFile(
        join(projectRoot, 'generated', 'spec', 'items', `${file}.json`),
        `five starting positions ${file}`,
      ),
    ),
  );
  return buildCatalog(
    Object.fromEntries(FILES.map((file, index) => [file, sources[index]])) as Sources,
  );
}

let cached: FiveStartingPositionsCatalog | undefined;
/** History validation reads the immutable delivery synchronously; it never allocates or writes. */
export function canonicalFiveStartingPositionsCatalog(): FiveStartingPositionsCatalog {
  if (cached === undefined) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    cached = buildCatalog(
      Object.fromEntries(
        FILES.map((file) => [
          file,
          JSON.parse(
            readFileSync(join(root, 'generated', 'spec', 'items', `${file}.json`), 'utf8'),
          ) as unknown,
        ]),
      ) as Sources,
    );
  }
  return cached;
}
