import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { banner, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
const WHERE = 'local-character-portraits';
const SOURCE = 'artifacts/local-character-portraits/manifest.json';
const GENERATED_MEDIA = 'generated/media/local-character-portraits';
const EXPECTED = [
  ['symbiosis_placeholder_free_female', 'symbiosis_placeholder_free_female.png'],
  ['symbiosis_placeholder_free_male', 'symbiosis_placeholder_free_male.png'],
  ['symbiosis_placeholder_pure_female', 'symbiosis_placeholder_pure_female.png'],
  ['symbiosis_placeholder_pure_male', 'symbiosis_placeholder_pure_male.png'],
  ['symbiosis_placeholder_unified_female', 'symbiosis_placeholder_unified_female.png'],
  ['symbiosis_placeholder_unified_male', 'symbiosis_placeholder_unified_male.png'],
] as const;
const ROW_KEYS = ['assetKey', 'file', 'sha256'] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
type PortraitAsset = JsonObject & Record<(typeof ROW_KEYS)[number], string>;
export function validatePortraitCatalog(
  manifest: unknown,
  media: ReadonlyMap<string, Uint8Array>,
): PortraitAsset[] {
  if (!Array.isArray(manifest)) fail(WHERE, 'manifest.json is not a top-level array');
  expectCount(WHERE, 'manifest rows', manifest.length, EXPECTED.length);
  const assets: PortraitAsset[] = [];
  const keys = new Set<string>();
  const files = new Set<string>();
  manifest.forEach((value, index) => {
    const path = `manifest.json[${String(index)}]`;
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      fail(WHERE, `${path} is not an object`);
    const record = value as Record<string, unknown>;
    const actualKeys = Object.keys(record).sort().join(',');
    if (actualKeys !== ROW_KEYS.join(','))
      fail(WHERE, `${path} has keys [${actualKeys}], expected exactly ${ROW_KEYS.join(', ')}`);
    for (const field of ROW_KEYS) {
      if (typeof record[field] !== 'string') fail(WHERE, `${path}.${field} is not a string`);
    }
    const { assetKey, file, sha256 } = record as Record<(typeof ROW_KEYS)[number], string>;
    if (file.includes('\u0000') || !/^(?![A-Za-z]:)[^/\\]+\.png$/u.test(file)) {
      fail(WHERE, `${path}.file is not a safe lowercase-PNG basename: ${JSON.stringify(file)}`);
    }
    if (keys.has(assetKey)) fail(WHERE, `${path}: duplicate assetKey ${JSON.stringify(assetKey)}`);
    if (files.has(file)) fail(WHERE, `${path}: duplicate filename ${JSON.stringify(file)}`);
    keys.add(assetKey);
    files.add(file);
    if (file.slice(0, -4) !== assetKey)
      fail(WHERE, `${path}: assetKey must equal the exact filename stem`);
    if (!/^[0-9a-f]{64}$/u.test(sha256)) fail(WHERE, `${path}.sha256 is not lowercase 64-hex`);
    const expected = EXPECTED[index]!;
    if (assetKey !== expected[0] || file !== expected[1])
      fail(WHERE, `${path} is ${assetKey}/${file}, expected ${expected.join('/')}`);
    const bytes = media.get(file);
    if (bytes === undefined) fail(WHERE, `${path}: media/${file} is missing`);
    if (PNG_SIGNATURE.some((byte, position) => bytes[position] !== byte))
      fail(WHERE, `${path}: media/${file} does not have the PNG signature`);
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    if (actualDigest !== sha256)
      fail(WHERE, `${path}: media/${file} hashes to ${actualDigest}, expected ${sha256}`);
    assets.push({ assetKey, file, sha256 });
  });
  for (const file of [...media.keys()].sort()) {
    if (!files.has(file)) fail(WHERE, `media/${file} is not declared by manifest.json`);
  }
  return assets;
}
function parseManifest(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(WHERE, `manifest.json is not valid JSON: ${detail}`);
  }
}
export async function importLocalCharacterPortraits() {
  const raw = await readFile(ARTIFACT.localCharacterPortraitManifest, 'utf8');
  const entries = await readdir(ARTIFACT.localCharacterPortraitMedia, { withFileTypes: true });
  const media = new Map<string, Uint8Array>();
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isFile()) fail(WHERE, `media/${entry.name} is not a regular file`);
    media.set(entry.name, await readFile(join(ARTIFACT.localCharacterPortraitMedia, entry.name)));
  }
  const assets = validatePortraitCatalog(parseManifest(raw), media);
  const mediaBytes = [...media.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const specDir = join(SPEC_DIR, 'local-character-portraits');
  let bytesWritten = await writeJson(join(specDir, 'catalog.json'), assets);
  bytesWritten += await writeJson(join(specDir, 'meta.json'), {
    assets: assets.length,
    totalBytes: mediaBytes,
    source: SOURCE,
    mediaDir: GENERATED_MEDIA,
  });
  bytesWritten += await writeText(
    join(TYPES_DIR, 'local-character-portraits.ts'),
    [
      banner(SOURCE),
      `export const LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS = ${JSON.stringify(
        assets.map((asset) => asset.assetKey),
        null,
        2,
      )} as const;`,
      'export type LocalCharacterPortraitAssetKey = (typeof LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS)[number];',
      '',
    ].join('\n'),
  );
  const outDir = join(MEDIA_DIR, 'local-character-portraits');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const asset of assets) {
    await writeFile(join(outDir, asset.file), media.get(asset.file)!);
  }
  return {
    assets: assets.length,
    bytesWritten,
    mediaBytes,
    files: [
      'generated/spec/local-character-portraits/catalog.json',
      'generated/spec/local-character-portraits/meta.json',
      'generated/types/local-character-portraits.ts',
    ],
  };
}
