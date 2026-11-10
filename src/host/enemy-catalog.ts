import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import type { JsonValue } from '@shared/wire-protocol.js';
import type {
  EnemyCatalogEntry,
  EnemyLibraryCard,
  EnemyLibrarySelection,
} from '@shared/enemy-library.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import {
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { array, record, string } from './json-source.js';
import { ENEMY_CATALOG_SOURCE_SEALS } from './enemy-catalog-seals.js';

const PACK_PATH = 'packs/Symbiosis_V7_Default_Sentient_Enemy_Runtime_Pack_v1.2.zip';
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fail = (detail: string): never => {
  throw new Error('enemy catalog: ' + detail);
};
type Record = globalThis.Record<string, unknown>;
const text = (row: Record, key: string) => string(row[key], 'enemy source.' + key);
function rows(value: unknown): Record[] {
  return array(value, 'enemy source rows').map((x) => record(x, 'enemy source row'));
}
function unique(values: readonly string[], expected: number, label: string): void {
  if (values.length !== expected || new Set(values).size !== expected)
    fail(label + ' source roster differs');
}
export interface EnemySourceCatalog {
  readonly catalogVersion: string;
  readonly baselineVersion: string;
  readonly systemTemplates: readonly EnemyCatalogEntry[];
  readonly canonicalTemplates: readonly EnemyCatalogEntry[];
  readonly assertCurrent: () => void;
  readonly resolve: (selection: EnemyLibrarySelection) => EnemyCatalogEntry;
  readonly card: (selection: EnemyLibrarySelection) => EnemyLibraryCard;
}
/** Exact source identity, never a route/prefix/index lookup or a client-supplied catalog. */
export function loadEnemySourceCatalog(
  projectRoot: string,
  baseline: LocalCharacterExportBaseline,
): EnemySourceCatalog {
  resolveStoredLocalCharacterExportBaseline(baseline, baseline.baselineVersion);
  const read = (path: string) => readFileSync(join(projectRoot, path));
  const manifest = read('artifacts/CHECKSUMS.sha256');
  if ('sha256:' + sha256(manifest) !== baseline.baselineVersion) fail('baseline manifest changed');
  const line =
    manifest
      .toString('utf8')
      .split('\n')
      .find((x) => x.slice(66) === PACK_PATH) ??
    fail('frozen pack missing from the actual baseline');
  const packSha = line.slice(0, 64),
    packBytes = read('artifacts/' + PACK_PATH);
  if (sha256(packBytes) !== packSha) fail('frozen pack bytes differ');
  const zip = unzipSync(packBytes);
  const packed = (path: string) => zip[path] ?? fail('pack entry missing: ' + path);
  const pack = record(
    JSON.parse(Buffer.from(packed('runtime-pack/catalog.json')).toString('utf8')),
    'enemy runtime pack',
  );
  const metadata = record(pack['metadata'], 'enemy metadata');
  const catalogVersion = text(metadata, 'catalogVersion');
  const packTemplates = rows(pack['templates']);
  const source = new Map<string, unknown>();
  for (const [file, seal] of Object.entries(ENEMY_CATALOG_SOURCE_SEALS)) {
    const bytes = read('generated/spec/' + file);
    if (sha256(bytes) !== seal) fail('source output differs: ' + file);
    source.set(file, JSON.parse(bytes.toString('utf8')) as unknown);
  }
  const templates = rows(source.get('sentient/templates.json'));
  const payloads = rows(source.get('sentient/payloads.json'));
  const arts = rows(source.get('sentient/arts.json'));
  const bestiary = rows(source.get('bestiary/templates.json'));
  const species = rows(source.get('bestiary/species.json'));
  const bestiaryArts = rows(source.get('bestiary/arts.json'));
  const bestiaryVersion = text(
    record(source.get('bestiary/meta.json'), 'bestiary meta'),
    'registryVersion',
  );
  // Registry v1.2 supplies 44 frozen payloads; Bestiary v1.4 supplies 16 species / 17 statblocks.
  unique(
    templates.map((x) => text(x, 'SystemTemplateID')),
    44,
    'system',
  );
  unique(
    payloads.map((x) => text(x, 'SystemTemplateID')),
    44,
    'payload',
  );
  unique(
    packTemplates.map((x) => text(x, 'systemTemplateId')),
    44,
    'pack',
  );
  unique(
    arts.map((x) => text(x, 'ArtAssetID')),
    44,
    'art',
  );
  unique(
    bestiary.map((x) => text(x, 'Canonical Template ID')),
    17,
    'canonical',
  );
  unique(
    species.map((x) => text(x, 'Species ID')),
    16,
    'species',
  );
  const cards = new Map<string, EnemyLibraryCard>();
  const systemTemplates: EnemyCatalogEntry[] = [];
  const facts = (value: unknown, keys: string[]): JsonValue => {
    const row = record(value, 'enemy sheet fact');
    return Object.fromEntries(
      keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key] as JsonValue]),
    );
  };
  for (const template of templates) {
    const id = text(template, 'SystemTemplateID');
    const payloadRow =
      payloads.find((x) => x['SystemTemplateID'] === id) ?? fail('payload missing: ' + id);
    const payloadJson = text(payloadRow, 'SentientEnemyPayload JSON');
    const payload = record(JSON.parse(payloadJson), 'sentient payload');
    const payloadSha256 = text(payloadRow, 'Payload SHA-256');
    const original =
      packTemplates.find((x) => x['systemTemplateId'] === id) ??
      fail('pack template missing: ' + id);
    const art =
      arts.find(
        (x) => x['SystemTemplateID'] === id && x['ArtAssetID'] === template['ArtAssetID'],
      ) ?? fail('art mapping missing: ' + id);
    if (
      sha256(payloadJson) !== payloadSha256 ||
      !admissionJsonEqual(original, payload) ||
      payload['catalogVersion'] !== catalogVersion ||
      payload['systemTemplateId'] !== id ||
      payload['origin'] !== 'SYSTEM_DEFAULT_SENTIENT' ||
      template['Origin'] !== 'SYSTEM_DEFAULT_SENTIENT' ||
      template['Immutable'] !== true ||
      payload['immutableSystemTemplate'] !== true ||
      payload['progressionPolicy'] !== 'NO_XP_PROGRESSION' ||
      template['ProgressionPolicy'] !== 'NO_XP_PROGRESSION' ||
      Object.hasOwn(payload, 'symbiontXpProgressPoints') ||
      Object.hasOwn(payload, 'unallocatedSymbiontXp')
    )
      fail('payload identity or frozen policy differs: ' + id);
    const artFile = text(art, 'Runtime-файл');
    if (payload['artFile'] !== artFile || template['Файл арта'] !== artFile)
      fail('art identity differs: ' + id);
    const artBytes = packed('runtime-pack/art/' + artFile),
      artSha = text(art, 'SHA-256 PNG');
    if (sha256(artBytes) !== artSha) fail('art bytes differ: ' + id);
    const entry: EnemyCatalogEntry = {
      origin: 'SYSTEM_DEFAULT_SENTIENT',
      templateId: id,
      catalogVersion,
      artAssetKey: text(art, 'ArtAssetID'),
      displayName: text(template, 'Название для мастера'),
      speciesIdOrNull: null,
      summary: text(template, 'Боевая роль'),
    };
    systemTemplates.push(entry);
    // Only immutable sheet facts are shown; initial actor/placement/combat fields are not a library projection.
    const sheetFields = [
      'displayName',
      'race',
      'pureClass',
      'factionGroup',
      'combatRole',
      'threatTier',
      'massKg',
      'baseStats',
      'skillStageStats',
      'effectiveStats',
      'equippedStats',
      'maxHP',
      'skills',
      'symbionts',
      'symbioticMonster',
      'items',
      'progressionPolicy',
    ];
    cards.set(id, {
      template: entry,
      payloadSha256,
      art: {
        mediaType: 'image/png',
        sha256: artSha,
        bytesBase64: Buffer.from(artBytes).toString('base64'),
      },
      fields: sheetFields
        .filter((key) => Object.hasOwn(payload, key))
        .map((key) => ({
          label: key,
          value:
            key === 'skills'
              ? rows(payload[key]).map((row) =>
                  facts(row, ['skillName', 'bonus', 'slotCost', 'note']),
                )
              : key === 'symbionts'
                ? rows(payload[key]).map((row) =>
                    facts(row, ['speciesName', 'targetLevel', 'effectiveLevel', 'maxOE']),
                  )
                : key === 'items'
                  ? rows(payload[key]).map((row) =>
                      facts(row, ['itemName', 'equipSlot', 'bodyZone', 'quantity', 'currentAmmo']),
                    )
                  : key === 'symbioticMonster' && payload[key] !== null
                    ? facts(payload[key], [
                        'targetLevel',
                        'maxOE',
                        'maxHPBonus',
                        'permanentStatDelta',
                      ])
                    : (payload[key] as JsonValue),
        })),
    });
  }
  const canonicalTemplates: EnemyCatalogEntry[] = bestiary.map((template) => {
    const speciesId = text(template, 'Species ID'),
      artAssetKey = text(template, 'Art asset key');
    if (
      !species.some((x) => x['Species ID'] === speciesId && x['Art asset key'] === artAssetKey) ||
      !bestiaryArts.some((x) => x['speciesId'] === speciesId && x['artAssetKey'] === artAssetKey) ||
      template['Template origin'] !== 'CANONICAL_BESTIARY' ||
      template['Read only'] !== true
    )
      return fail('canonical source mapping differs');
    return {
      origin: 'CANONICAL_BESTIARY',
      templateId: text(template, 'Canonical Template ID'),
      catalogVersion: bestiaryVersion,
      artAssetKey,
      displayName: text(template, 'Display name'),
      speciesIdOrNull: speciesId,
      summary: 'HP: ' + String(template['Max HP']) + '; ' + text(template, 'HP model'),
    };
  });
  const detached = <T>(value: T): T => structuredClone(value);
  const resolve = (selection: EnemyLibrarySelection): EnemyCatalogEntry => {
    const entry = [...systemTemplates, ...canonicalTemplates].find(
      (x) => x.origin === selection.origin && x.templateId === selection.templateId,
    );
    if (
      entry === undefined ||
      entry.catalogVersion !== selection.catalogVersion ||
      entry.artAssetKey !== selection.artAssetKey
    )
      return fail('missing, foreign or corrupt selected identity');
    return detached(entry);
  };
  return Object.freeze({
    catalogVersion,
    baselineVersion: baseline.baselineVersion,
    get systemTemplates() {
      return detached(systemTemplates);
    },
    get canonicalTemplates() {
      return detached(canonicalTemplates);
    },
    resolve,
    assertCurrent() {
      resolveStoredLocalCharacterExportBaseline(baseline, baseline.baselineVersion);
      if (
        sha256(read('artifacts/CHECKSUMS.sha256')) !== sha256(manifest) ||
        sha256(read('artifacts/' + PACK_PATH)) !== packSha
      )
        fail('pinned source changed');
      for (const [file, seal] of Object.entries(ENEMY_CATALOG_SOURCE_SEALS))
        if (sha256(read('generated/spec/' + file)) !== seal) fail('source output changed: ' + file);
    },
    card(selection: EnemyLibrarySelection) {
      resolve(selection);
      if (selection.origin !== 'SYSTEM_DEFAULT_SENTIENT')
        return fail('canonical card requires its own source contract');
      return detached(cards.get(selection.templateId) ?? fail('system card missing'));
    },
  });
}
