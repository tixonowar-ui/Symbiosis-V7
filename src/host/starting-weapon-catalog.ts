import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  CANONICAL_STARTING_WEAPON_CATALOG,
  type StartingWeaponCatalog,
  type StartingWeaponCatalogEntry,
  type StartingWeaponVariant,
} from '../domain/rules/item-stage/starting-weapon.js';
import { readJsonFile } from './json-source.js';

export interface StartingWeaponRequirementPreview {
  readonly requirements: string;
  readonly skillOrClass: string;
  readonly missingSkillOrClassPenalty: string;
}

export interface StartingWeaponItemCatalogEntry extends StartingWeaponCatalogEntry {
  readonly variantLabel: string;
  readonly requirementPreview: StartingWeaponRequirementPreview;
}

export interface StartingWeaponQualityScaleEntry {
  readonly range: string;
  readonly label: string;
}

export interface StartingWeaponItemCatalog extends StartingWeaponCatalog {
  readonly entries: readonly StartingWeaponItemCatalogEntry[];
  readonly qualityScale: readonly StartingWeaponQualityScaleEntry[];
}

/**
 * Item Registry 01 and 02 deliver exactly these 27 canonical types. The 07A
 * definitions address attack variants, not additional starting inventory items.
 * ATTACK_VARIANT names SWORD as Cornadora and SHIELD/RAPIER as Blarade; there
 * is no Cornadora SHIELD attack to invent from its defensive shield HP.
 */
const EXPECTED_VARIANTS: Readonly<Record<string, readonly StartingWeaponVariant[]>> =
  Object.fromEntries(
    CANONICAL_STARTING_WEAPON_CATALOG.entries.map(({ weaponTypeId }) => [
      weaponTypeId,
      CANONICAL_STARTING_WEAPON_CATALOG.entries
        .filter((entry) => entry.weaponTypeId === weaponTypeId)
        .map((entry) => entry.weaponVariant),
    ]),
  );

const FIXED_TEMPLATE_IDS = new Set(
  CANONICAL_STARTING_WEAPON_CATALOG.entries
    .filter((entry) => entry.profileKind === 'FIXED')
    .map((entry) => entry.weaponTypeId),
);

// Item Registry 10 dictionaries QUALITY; CORE-172/173 keep this descriptive.
const EXPECTED_QUALITY_SCALE: readonly StartingWeaponQualityScaleEntry[] = [
  { range: '1–4', label: 'Отсутствует/непригоден' },
  { range: '5–9', label: 'Плохое' },
  { range: '10–14', label: 'Обычное' },
  { range: '15–18', label: 'Хорошее' },
  { range: '19', label: 'Исключительное' },
  { range: '20', label: 'Редкое' },
];

type Row = Record<string, unknown>;

export class StartingWeaponCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function fail(detail: string): never {
  throw new StartingWeaponCatalogError(`starting weapon catalog: ${detail}`);
}

function rows(value: unknown, path: string): Row[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      fail(`${path}[${String(index)}] must be an object`);
    }
    return row as Row;
  });
}

function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function literal(row: Row, key: string, expected: unknown, path: string): void {
  if (row[key] !== expected) fail(`${path}.${key} must be ${JSON.stringify(expected)}`);
}

function playerText(row: Row, key: string, path: string): string {
  const value = text(row, key, path);
  if (/\b[A-Z][A-Z0-9]*-\d+\b|Источник|availabilityTrace/.test(value)) {
    fail(`${path}.${key} contains internal provenance in player text`);
  }
  return value;
}

function requirementText(profile: Row, id: string): string {
  const source = playerText(profile, 'Требования', `weapon-profiles ${id}`);
  if (FIXED_TEMPLATE_IDS.has(id)) {
    if (/PROFILE|statRequirements|instanceDamage|rangeMeters|gripMode/.test(source)) {
      fail(`weapon-profiles ${id} has a formula requirement in a fixed profile`);
    }
    return source;
  }
  // These are the three delivered requirement literals, not a formula parser.
  // No finalized numeric requirements exist until the separate profile stage.
  switch (source) {
    case 'PROFILE: statRequirements{S:Rs,D:Rd}':
      return 'Требования к силе и ловкости определяются готовым профилем оружия.';
    case 'PROFILE: statRequirements{S:Rs,D:Rd}; instanceDamage=Dm; rangeMeters=Rn':
      return 'Требования к силе и ловкости, урон и дальность определяются готовым профилем оружия.';
    case 'PROFILE: statRequirements{S:Rs(хват),D:Rd}; gripMode фиксирован':
      return 'Требования к силе и ловкости определяются готовым профилем оружия. Требование к силе зависит от выбранного хвата; хват фиксируется.';
    default:
      return fail(
        `weapon-profiles ${id} has an unrecognized formula requirement ${JSON.stringify(source)}`,
      );
  }
}

function canonicalRows(source: Row[], path: string): Map<string, Row> {
  const byId = new Map<string, Row>();
  for (const row of source) {
    const id = text(row, 'ItemTypeID', path);
    if (path === 'catalogue' && row['Категория'] !== 'Оружие' && !id.startsWith('ITM-WPN-')) {
      continue;
    }
    if (!Object.hasOwn(EXPECTED_VARIANTS, id)) fail(`${path} has unexpected weapon ${id}`);
    if (byId.has(id)) fail(`${path} has duplicate weapon ${id}`);
    byId.set(id, row);
  }
  for (const id of Object.keys(EXPECTED_VARIANTS)) {
    if (!byId.has(id)) fail(`${path} is missing canonical weapon ${id}`);
  }
  return byId;
}

function dictionary(source: Row[], name: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of source) {
    if (row['Dictionary'] !== name) continue;
    const code = text(row, 'Code', `${name} dictionary`);
    if (result.has(code)) fail(`duplicate ${name} code ${code}`);
    result.set(code, text(row, 'Meaning', `${name} dictionary ${code}`));
  }
  return result;
}

function validateVariantContract(fields: Row[], instances: Row[], dictionaries: Row[]): void {
  const variants = fields.filter((row) => row['Field'] === 'attackVariantId');
  if (variants.length !== 1) fail('weapon-fields must contain exactly one attackVariantId');
  literal(
    variants[0]!,
    'Validation / constraint',
    'DEFAULT|ONE_HAND|TWO_HAND|SWORD|SHIELD|RAPIER; для многовариантного оружия обязателен',
    'weapon-fields attackVariantId',
  );
  const grip = instances.filter((row) => row['Field'] === 'gripMode');
  if (grip.length !== 1) fail('instance-model must contain exactly one gripMode');
  literal(
    grip[0]!,
    'Validation / constraint',
    'ONE_HAND | TWO_HAND; обязателен для полуторного меча; после выдачи не меняется CORE-188',
    'instance-model gripMode',
  );
  const expected = new Map([
    ['DEFAULT', 'Единственный/обычный вариант атаки'],
    ['SWORD', 'Меч Корнадоры'],
    ['SHIELD', 'Щит Бларадэ'],
    ['RAPIER', 'Шпага Бларадэ'],
    ['ONE_HAND', 'Полуторный меч, фиксированный хват одной рукой.'],
    ['TWO_HAND', 'Полуторный меч, фиксированный хват двумя руками.'],
  ]);
  const actual = dictionary(dictionaries, 'ATTACK_VARIANT');
  if (actual.size !== expected.size) fail('ATTACK_VARIANT dictionary changed');
  for (const [code, label] of expected) {
    if (actual.get(code) !== label) fail(`ATTACK_VARIANT ${code} is missing or drifted`);
  }
}

function validateCombatJoins(source: Row[], profiles: Map<string, Row>): void {
  const keys = new Set<string>();
  for (const row of source) {
    const id = text(row, 'ItemTypeID', 'combat-values');
    if (!id.startsWith('ITM-WPN-')) continue;
    const variants = EXPECTED_VARIANTS[id];
    const variant = text(row, 'attackVariantId', `combat-values ${id}`);
    const kind = text(row, 'valueKind', `combat-values ${id}/${variant}`);
    if (
      variants === undefined ||
      !(variants as readonly string[]).includes(variant) ||
      (kind !== 'DAMAGE' && kind !== 'PENETRATION')
    ) {
      fail(`unknown combat definition ${id}/${variant}/${kind}`);
    }
    const key = `${id}/${variant}/${kind}`;
    if (keys.has(key)) fail(`duplicate combat definition ${key}`);
    keys.add(key);
    literal(row, 'Название', profiles.get(id)!['Название'], `combat-values ${key}`);
  }
  for (const [id, variants] of Object.entries(EXPECTED_VARIANTS)) {
    for (const variant of variants) {
      for (const kind of ['DAMAGE', 'PENETRATION']) {
        const key = `${id}/${variant}/${kind}`;
        if (!keys.has(key)) fail(`missing combat definition ${key}`);
      }
    }
  }
}

function validateFormulaJoins(source: Row[], catalogue: Map<string, Row>): void {
  const pairs = new Set<string>();
  const formulaIds = new Set<string>();
  for (const row of source) {
    const id = text(row, 'ItemTypeID', 'formulas');
    const variant = text(row, 'Вариант', `formulas ${id}`);
    const formulaId = text(row, 'FormulaID', `formulas ${id}/${variant}`);
    const variants = EXPECTED_VARIANTS[id];
    if (
      variants === undefined ||
      FIXED_TEMPLATE_IDS.has(id) ||
      !(variants as readonly string[]).includes(variant)
    ) {
      fail(`unknown formula selection ${id}/${variant}`);
    }
    const key = `${id}/${variant}`;
    if (pairs.has(key) || formulaIds.has(formulaId)) fail(`duplicate formula selection ${key}`);
    pairs.add(key);
    formulaIds.add(formulaId);
    literal(row, 'Execution mode', 'VALIDATION_ONLY', `formulas ${key}`);
    literal(row, 'Generation enabled', false, `formulas ${key}`);
    const declared = text(catalogue.get(id)!, 'Formula ID', `catalogue ${id}`).split('; ');
    if (!declared.includes(formulaId))
      fail(`formula ${formulaId} is not declared by catalogue ${id}`);
    if (id === 'ITM-WPN-012') {
      literal(
        row,
        'FormulaID',
        variant === 'ONE_HAND' ? 'F-WPN-008A' : 'F-WPN-008B',
        `formulas ${key}`,
      );
    }
  }
  for (const [id, variants] of Object.entries(EXPECTED_VARIANTS)) {
    if (FIXED_TEMPLATE_IDS.has(id)) continue;
    for (const variant of variants) {
      if (!pairs.has(`${id}/${variant}`)) fail(`missing formula selection ${id}/${variant}`);
    }
    const declared = text(catalogue.get(id)!, 'Formula ID', `catalogue ${id}`).split('; ');
    if (declared.length !== variants.length || declared.some((id) => !formulaIds.has(id))) {
      fail(`catalogue ${id} declares unknown formula IDs`);
    }
  }
}

export async function loadStartingWeaponCatalog(
  projectRoot: string,
): Promise<StartingWeaponItemCatalog> {
  const root = await realpath(resolve(projectRoot));
  const itemsRoot = join(root, 'generated', 'spec', 'items');
  const readRows = async (file: string): Promise<Row[]> =>
    rows(await readJsonFile(join(itemsRoot, `${file}.json`), `items ${file}`), file);
  const [catalogueRows, profileRows, definitions, fields, instances, dictionaries, formulas] =
    await Promise.all([
      readRows('catalogue'),
      readRows('weapon-profiles'),
      readRows('combat-values'),
      readRows('weapon-fields'),
      readRows('instance-model'),
      readRows('dictionaries'),
      readRows('formulas'),
    ]);
  const catalogue = canonicalRows(catalogueRows, 'catalogue');
  const profiles = canonicalRows(profileRows, 'weapon-profiles');
  validateVariantContract(fields, instances, dictionaries);
  validateCombatJoins(definitions, profiles);
  validateFormulaJoins(formulas, catalogue);
  const variantLabels = dictionary(dictionaries, 'ATTACK_VARIANT');
  const entries: StartingWeaponItemCatalogEntry[] = [];
  for (const [id, variants] of Object.entries(EXPECTED_VARIANTS)) {
    const row = catalogue.get(id)!;
    const profile = profiles.get(id)!;
    const path = `catalogue ${id}`;
    literal(row, 'Категория', 'Оружие', path);
    literal(row, 'Класс каталога', 'A_CANONICAL', path);
    literal(row, 'Можно в инвентарь', true, path);
    literal(row, 'Полнота механики', 'FULL', path);
    literal(row, 'Экипируется', true, path);
    literal(row, 'Составной', id === 'ITM-WPN-026' || id === 'ITM-WPN-027', path);
    literal(
      row,
      'Политика заявки игрока',
      FIXED_TEMPLATE_IDS.has(id) ? 'TEMPLATE_FIXED' : 'EXACT_JOINT_FORMULA',
      path,
    );
    const name = playerText(row, 'Название', path);
    const canonicalName = CANONICAL_STARTING_WEAPON_CATALOG.entries.find(
      (entry) => entry.weaponTypeId === id,
    )!.name;
    literal(row, 'Название', canonicalName, path);
    literal(profile, 'Название', name, `weapon-profiles ${id}`);
    const requirementPreview = Object.freeze({
      requirements: requirementText(profile, id),
      skillOrClass: playerText(profile, 'Навык/класс', `weapon-profiles ${id}`),
      missingSkillOrClassPenalty: playerText(
        profile,
        'Штраф без навыка/класса',
        `weapon-profiles ${id}`,
      ),
    });
    for (const weaponVariant of variants) {
      entries.push(
        Object.freeze({
          weaponTypeId: id,
          weaponVariant,
          name,
          profileKind: FIXED_TEMPLATE_IDS.has(id) ? 'FIXED' : 'FORMULA',
          variantLabel: variantLabels.get(weaponVariant)!,
          requirementPreview,
        }),
      );
    }
  }
  const quality = dictionary(dictionaries, 'QUALITY');
  if (quality.size !== EXPECTED_QUALITY_SCALE.length) fail('QUALITY dictionary changed');
  const qualityScale = EXPECTED_QUALITY_SCALE.map(({ range, label }) => {
    if (quality.get(range) !== label) fail(`QUALITY ${range} is missing or drifted`);
    return Object.freeze({ range, label });
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    qualityScale: Object.freeze(qualityScale),
  });
}
