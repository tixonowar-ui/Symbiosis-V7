import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { banner, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { validatePortraitCatalog } from './local-character-portraits.js';

const WHERE = 'gm-entity-portraits';
const SOURCE = 'artifacts/gm-entity-portraits/manifest.json';
/** Exact owner-approved mapping, including UNITED → unified; ADR 0077 / #186. */
const NPC_KEYS = [
  ['FREE', 'FEMALE', 'symbiosis_placeholder_free_female'],
  ['FREE', 'MALE', 'symbiosis_placeholder_free_male'],
  ['PURE', 'FEMALE', 'symbiosis_placeholder_pure_female'],
  ['PURE', 'MALE', 'symbiosis_placeholder_pure_male'],
  ['UNITED', 'FEMALE', 'symbiosis_placeholder_unified_female'],
  ['UNITED', 'MALE', 'symbiosis_placeholder_unified_male'],
] as const;
const ENEMY_KEYS = [
  [
    'SENTIENT',
    'symbiosis_placeholder_sentient_enemy',
    '5da7ee70db7c47dabfa92522e5bc8c9855c8a0c7596764d00b8b24cebd570a3f',
  ],
  [
    'CUSTOM_MONSTER',
    'symbiosis_placeholder_monster',
    '563c23e0190bff9b5498bc0ec46830f9209fa1d181fe163e3ea76edbab7e7e86',
  ],
] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(WHERE, `${path} is not an object`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort().join(',');
  if (actual !== [...keys].sort().join(','))
    fail(WHERE, `${path} has keys [${actual}], expected exactly ${keys.join(', ')}`);
  return record;
}

function rows(value: unknown, count: number, path: string): unknown[] {
  if (!Array.isArray(value)) fail(WHERE, `${path} is not an array`);
  expectCount(WHERE, path, value.length, count);
  return value as unknown[];
}

export function validateGmPortraitCatalog(
  manifest: unknown,
  media: ReadonlyMap<string, Uint8Array>,
  localManifest: unknown,
  localMedia: ReadonlyMap<string, Uint8Array>,
): JsonObject[] {
  const source = object(manifest, ['npc', 'enemy'], 'manifest.json');
  // Reuse the exact old source validator so a new GM mapping cannot redefine the six CHR assets.
  const local = validatePortraitCatalog(localManifest, localMedia);
  const catalog: JsonObject[] = [];
  rows(source['npc'], NPC_KEYS.length, 'npc').forEach((value, index) => {
    const path = `npc[${String(index)}]`;
    const row = object(value, ['raceCode', 'sex', 'assetKey', 'sha256'], path);
    const [raceCode, sex, assetKey] = NPC_KEYS[index]!;
    if (row['raceCode'] !== raceCode || row['sex'] !== sex || row['assetKey'] !== assetKey)
      fail(WHERE, `${path} must bind ${raceCode}/${sex} to ${assetKey}`);
    const prior = local.find((asset) => asset.assetKey === assetKey)!;
    if (row['sha256'] !== prior.sha256)
      fail(WHERE, `${path} must preserve the existing portrait digest ${prior.sha256}`);
    catalog.push({
      entityKind: 'NPC',
      raceCodeOrNull: raceCode,
      sexOrNull: sex,
      assetKey,
      sha256: prior.sha256,
      mediaPath: `local-character-portraits/${prior.file}`,
    });
  });
  const files = new Set<string>();
  rows(source['enemy'], ENEMY_KEYS.length, 'enemy').forEach((value, index) => {
    const path = `enemy[${String(index)}]`;
    const row = object(value, ['kind', 'assetKey', 'file', 'sha256'], path);
    const [kind, assetKey, sha256] = ENEMY_KEYS[index]!;
    const file = `${assetKey}.png`;
    // Exact basenames reject traversal, extra keys and inferred/unknown identities before any lookup.
    if (
      row['kind'] !== kind ||
      row['assetKey'] !== assetKey ||
      row['file'] !== file ||
      row['sha256'] !== sha256
    )
      fail(WHERE, `${path} does not match the approved ${kind}/${assetKey}/${file}/${sha256}`);
    const bytes = media.get(file);
    if (bytes === undefined) fail(WHERE, `${file} is missing`);
    if (PNG_SIGNATURE.some((byte, offset) => bytes[offset] !== byte))
      fail(WHERE, `${file} does not have the PNG signature`);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha256) fail(WHERE, `${file} hashes to ${actual}, expected ${sha256}`);
    files.add(file);
    catalog.push({
      entityKind: kind,
      raceCodeOrNull: null,
      sexOrNull: null,
      assetKey,
      sha256,
      mediaPath: `gm-entity-portraits/${file}`,
    });
  });
  for (const file of media.keys())
    if (!files.has(file)) fail(WHERE, `${file} is not declared by manifest.json`);
  return catalog;
}

async function readMedia(
  directory: string,
  excludeManifest: boolean,
): Promise<Map<string, Uint8Array>> {
  const files = await readdir(directory, { withFileTypes: true });
  const media = new Map<string, Uint8Array>();
  for (const entry of files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isFile()) fail(WHERE, `${directory}/${entry.name} is not a regular file`);
    if (excludeManifest && entry.name === 'manifest.json') continue;
    media.set(entry.name, await readFile(join(directory, entry.name)));
  }
  return media;
}

async function readManifest(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return fail(
      WHERE,
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function importGmEntityPortraits() {
  const media = await readMedia(ARTIFACT.gmEntityPortraitDirectory, true);
  const catalog = validateGmPortraitCatalog(
    await readManifest(ARTIFACT.gmEntityPortraitManifest),
    media,
    await readManifest(ARTIFACT.localCharacterPortraitManifest),
    await readMedia(ARTIFACT.localCharacterPortraitMedia, false),
  );
  const mediaBytes = [...media.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const directory = join(SPEC_DIR, 'gm-entity-portraits');
  let bytesWritten = await writeJson(join(directory, 'catalog.json'), catalog);
  bytesWritten += await writeJson(join(directory, 'meta.json'), {
    assets: catalog.length,
    reusedLocalCharacterAssets: NPC_KEYS.length,
    suppliedEnemyAssets: ENEMY_KEYS.length,
    totalNewMediaBytes: mediaBytes,
    source: SOURCE,
    mediaDir: 'generated/media/gm-entity-portraits',
  });
  bytesWritten += await writeText(
    join(TYPES_DIR, 'gm-entity-portraits.ts'),
    [
      banner(SOURCE),
      `export const GM_ENTITY_PORTRAIT_ASSET_KEYS = ${JSON.stringify(
        catalog.map((row) => row['assetKey']),
        null,
        2,
      )} as const;`,
      'export type GmEntityPortraitAssetKey = (typeof GM_ENTITY_PORTRAIT_ASSET_KEYS)[number];',
      '',
    ].join('\n'),
  );
  const output = join(MEDIA_DIR, 'gm-entity-portraits');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [file, bytes] of media) await writeFile(join(output, file), bytes);
  return {
    assets: catalog.length,
    mediaBytes,
    bytesWritten,
    files: [
      'generated/spec/gm-entity-portraits/catalog.json',
      'generated/spec/gm-entity-portraits/meta.json',
      'generated/types/gm-entity-portraits.ts',
    ],
  };
}
