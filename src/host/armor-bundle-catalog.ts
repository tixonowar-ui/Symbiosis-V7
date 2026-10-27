import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  ARMOR_BODY_ZONES,
  type ArmorBodyZone,
  type ArmorBundleCatalog,
  type ArmorBundleCatalogEntry,
  type ArmorCoverageModel,
} from '../domain/index.js';
import { readJsonFile } from './json-source.js';

export interface ArmorQualityScaleEntry {
  readonly range: string;
  readonly label: string;
}

export interface ArmorBundleItemCatalog extends ArmorBundleCatalog {
  readonly bodyZones: readonly ArmorBodyZone[];
  readonly qualityScale: readonly ArmorQualityScaleEntry[];
}

const EXPECTED_ARMOR_ITEM_IDS = [
  'ITM-ARM-001',
  'ITM-ARM-002',
  'ITM-ARM-003',
  'ITM-ARM-004',
  'ITM-ARM-005',
  'ITM-ARM-006',
  'ITM-ARM-007',
  'ITM-ARM-008',
] as const;

const EXPECTED_BODY_ZONE_LABELS: Readonly<Record<ArmorBodyZone, string>> = {
  HEAD: 'Голова',
  TORSO: 'Корпус',
  ARM_L: 'Левая рука',
  ARM_R: 'Правая рука',
  LEG_L: 'Левая нога',
  LEG_R: 'Правая нога',
};

const EXPECTED_QUALITY_SCALE: readonly ArmorQualityScaleEntry[] = Object.freeze([
  Object.freeze({ range: '1–4', label: 'Отсутствует/непригоден' }),
  Object.freeze({ range: '5–9', label: 'Плохое' }),
  Object.freeze({ range: '10–14', label: 'Обычное' }),
  Object.freeze({ range: '15–18', label: 'Хорошее' }),
  Object.freeze({ range: '19', label: 'Исключительное' }),
  Object.freeze({ range: '20', label: 'Редкое' }),
]);

type Row = Record<string, unknown>;

export class ArmorBundleCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function fail(detail: string): never {
  throw new ArmorBundleCatalogError(`armor bundle catalog: ${detail}`);
}

function rows(value: unknown, path: string): Row[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${path}[${String(index)}] must be an object`);
    }
    return entry as Row;
  });
}

function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function literal(row: Row, key: string, expected: unknown, path: string): void {
  if (row[key] !== expected) {
    fail(`${path}.${key} must be ${JSON.stringify(expected)}`);
  }
}

function armourRows(catalogue: unknown): Row[] {
  if (Array.isArray(catalogue)) return rows(catalogue, 'catalogue');
  if (catalogue === null || typeof catalogue !== 'object') {
    fail('catalogue.json must be an array or an object keyed by row');
  }
  return rows(Object.values(catalogue), 'catalogue');
}

function dictionaryRows(dictionaries: unknown): Row[] {
  return rows(dictionaries, 'dictionaries');
}

function loadBodyZones(dictionaries: Row[]): readonly ArmorBodyZone[] {
  const byCode = new Map<string, string>();
  for (const [index, row] of dictionaries.entries()) {
    if (row['Dictionary'] !== 'BODY_ZONE') continue;
    const code = text(row, 'Code', `dictionaries[${String(index)}]`);
    byCode.set(code, text(row, 'Meaning', `dictionaries[${String(index)}]`));
  }
  for (const zone of ARMOR_BODY_ZONES) {
    if (byCode.get(zone) !== EXPECTED_BODY_ZONE_LABELS[zone]) {
      fail(`BODY_ZONE ${zone} is missing or drifted`);
    }
    byCode.delete(zone);
  }
  if (byCode.size > 0) {
    fail(`BODY_ZONE contains unexpected codes: ${[...byCode.keys()].join(', ')}`);
  }
  return ARMOR_BODY_ZONES;
}

function loadQualityScale(dictionaries: Row[]): readonly ArmorQualityScaleEntry[] {
  const labels = new Map<string, string>();
  for (const [index, row] of dictionaries.entries()) {
    if (row['Dictionary'] !== 'QUALITY') continue;
    const range = text(row, 'Code', `dictionaries[${String(index)}]`);
    labels.set(range, text(row, 'Meaning', `dictionaries[${String(index)}]`));
  }
  const result: ArmorQualityScaleEntry[] = [];
  for (const expected of EXPECTED_QUALITY_SCALE) {
    if (labels.get(expected.range) !== expected.label) {
      fail(`QUALITY ${expected.range} is missing or drifted`);
    }
    labels.delete(expected.range);
    result.push(expected);
  }
  if (labels.size > 0) {
    fail(`QUALITY contains unexpected codes: ${[...labels.keys()].join(', ')}`);
  }
  return Object.freeze(result);
}

function armourCatalogueRows(catalogueRows: Row[]): Row[] {
  const result = catalogueRows.filter(
    (row) =>
      row['ItemTypeID'] !== undefined &&
      String(row['ItemTypeID']).startsWith('ITM-ARM-') &&
      row['Категория'] === 'Броня',
  );
  const byId = new Map<string, Row>();
  for (const [index, row] of result.entries()) {
    const path = `catalogue armor row ${String(index)}`;
    const id = text(row, 'ItemTypeID', path);
    if (byId.has(id)) fail(`duplicate catalogue armor row ${id}`);
    byId.set(id, row);
    literal(row, 'Класс каталога', 'A_CANONICAL', path);
    literal(row, 'Можно в инвентарь', true, path);
    literal(row, 'Политика заявки игрока', 'TEMPLATE_FIXED', path);
    literal(row, 'Полнота механики', 'FULL', path);
    literal(row, 'Экипируется', true, path);
  }
  for (const id of EXPECTED_ARMOR_ITEM_IDS) {
    if (!byId.has(id)) fail(`canonical armor row ${id} is missing`);
    byId.delete(id);
  }
  if (byId.size > 0) {
    fail(`unexpected armor catalogue rows: ${[...byId.keys()].join(', ')}`);
  }
  return result;
}

function armorProfileRows(profileRows: Row[]): Map<string, ArmorCoverageModel> {
  const profiles = profileRows.filter((row) =>
    String(row['ItemTypeID'] ?? '').startsWith('ITM-ARM-'),
  );
  const byId = new Map<string, ArmorCoverageModel>();
  for (const [index, row] of profiles.entries()) {
    const path = `armor-profiles[${String(index)}]`;
    const id = text(row, 'ItemTypeID', path);
    const model = row['Модель покрытия'];
    if (model !== 'ZONE_ELEMENT' && model !== 'FULL_SUIT') {
      fail(`${path}.Модель покрытия must be ZONE_ELEMENT or FULL_SUIT`);
    }
    if (byId.has(id)) fail(`duplicate armor profile ${id}`);
    byId.set(id, model);
  }
  const unexpected = new Set(byId.keys());
  for (const id of EXPECTED_ARMOR_ITEM_IDS) {
    if (!byId.has(id)) fail(`armor profile ${id} is missing`);
    unexpected.delete(id);
  }
  if (unexpected.size > 0) {
    fail(`unexpected armor profiles: ${[...unexpected].join(', ')}`);
  }
  return byId;
}

export async function loadArmorBundleCatalog(projectRoot: string): Promise<ArmorBundleItemCatalog> {
  const root = await realpath(resolve(projectRoot));
  const itemsRoot = join(root, 'generated', 'spec', 'items');
  const catalogueRows = armourRows(
    await readJsonFile(join(itemsRoot, 'catalogue.json'), 'items catalogue'),
  );
  const profileRows = rows(
    await readJsonFile(join(itemsRoot, 'armor-profiles.json'), 'armor profiles'),
    'armor profiles',
  );
  const profiles = armorProfileRows(profileRows);
  const dictionaries = dictionaryRows(
    await readJsonFile(join(itemsRoot, 'dictionaries.json'), 'item dictionaries'),
  );

  const armorRows = armourCatalogueRows(catalogueRows);
  const byId = new Map(armorRows.map((row) => [String(row['ItemTypeID']), row]));
  const profileById = new Map(profileRows.map((row) => [String(row['ItemTypeID']), row]));
  const entries: ArmorBundleCatalogEntry[] = [];
  for (const id of EXPECTED_ARMOR_ITEM_IDS) {
    const row = byId.get(id)!;
    const name = text(row, 'Название', `catalogue ${id}`);
    const profileName = text(profileById.get(id)!, 'Название', `armor profile ${id}`);
    if (profileName !== name) fail(`armor profile ${id} name does not match catalogue`);
    entries.push(Object.freeze({ itemId: id, name, coverageModel: profiles.get(id)! }));
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    bodyZones: loadBodyZones(dictionaries),
    qualityScale: loadQualityScale(dictionaries),
  });
}
