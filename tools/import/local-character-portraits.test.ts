import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT } from './lib/paths.js';
import { validatePortraitCatalog } from './local-character-portraits.js';

const NAMES = [
  'symbiosis_placeholder_free_female',
  'symbiosis_placeholder_free_male',
  'symbiosis_placeholder_pure_female',
  'symbiosis_placeholder_pure_male',
  'symbiosis_placeholder_unified_female',
  'symbiosis_placeholder_unified_male',
] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

interface Fixture {
  manifest: Record<string, unknown>[];
  media: Map<string, Uint8Array>;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function fixture(): Fixture {
  const media = new Map<string, Uint8Array>();
  const manifest = NAMES.map((assetKey, index) => {
    const file = `${assetKey}.png`;
    const bytes = Uint8Array.from([...PNG, index]);
    media.set(file, bytes);
    return { assetKey, file, sha256: sha256(bytes) };
  });
  return { manifest, media };
}

function rejects({ manifest, media }: Fixture, pattern: RegExp): void {
  expect(() => validatePortraitCatalog(manifest, media)).toThrow(pattern);
}

describe('ADR 0036 local-character portrait catalogue', () => {
  it('accepts the exact supplied manifest and six physical PNG files', () => {
    const manifest = JSON.parse(
      readFileSync(ARTIFACT.localCharacterPortraitManifest, 'utf8'),
    ) as unknown;
    const media = new Map(
      readdirSync(ARTIFACT.localCharacterPortraitMedia).map((file) => [
        file,
        readFileSync(join(ARTIFACT.localCharacterPortraitMedia, file)),
      ]),
    );

    const assets = validatePortraitCatalog(manifest, media);
    expect(assets.map((asset) => asset.assetKey)).toEqual(NAMES);
    expect(assets).toHaveLength(6);
  });

  it('requires a top-level array of exactly six rows', () => {
    const good = fixture();
    expect(() => validatePortraitCatalog({}, good.media)).toThrow(/top-level array/);
    good.manifest.pop();
    rejects(good, /expected 6 manifest rows, got 5/);
  });

  it('requires recursively exact row objects', () => {
    const missing = fixture();
    delete missing.manifest[0]!['sha256'];
    rejects(missing, /expected exactly assetKey, file, sha256/);

    const extra = fixture();
    extra.manifest[0]!['race'] = 'FREE';
    expect(() => validatePortraitCatalog(extra.manifest, extra.media)).toThrow(/has keys .*race/);
  });

  it('pins exact source order, keys and filenames', () => {
    const good = fixture();
    [good.manifest[0], good.manifest[1]] = [good.manifest[1]!, good.manifest[0]!];
    rejects(good, /manifest\.json\[0\].*expected/);
  });

  it('rejects duplicate keys and filenames explicitly', () => {
    const duplicateKey = fixture();
    duplicateKey.manifest[1]!['assetKey'] = duplicateKey.manifest[0]!['assetKey'];
    rejects(duplicateKey, /duplicate assetKey/);

    const duplicateFile = fixture();
    duplicateFile.manifest[1]!['file'] = duplicateFile.manifest[0]!['file'];
    rejects(duplicateFile, /duplicate filename/);
  });

  it('rejects missing and extra physical media', () => {
    const missing = fixture();
    missing.media.delete(`${NAMES[0]}.png`);
    expect(() => validatePortraitCatalog(missing.manifest, missing.media)).toThrow(/is missing/);

    const extra = fixture();
    extra.media.set('not-declared.png', Uint8Array.from(PNG));
    rejects(extra, /not declared by manifest/);
  });

  it('rejects traversal before resolving a filename', () => {
    const good = fixture();
    good.manifest[0]!['file'] = '../portrait.png';
    expect(() => validatePortraitCatalog(good.manifest, good.media)).toThrow(/safe.*basename/);
  });

  it('rejects bytes without the exact PNG signature', () => {
    const good = fixture();
    const file = `${NAMES[0]}.png`;
    const bytes = Uint8Array.from([0, ...PNG.slice(1), 0]);
    good.media.set(file, bytes);
    good.manifest[0]!['sha256'] = sha256(bytes);
    expect(() => validatePortraitCatalog(good.manifest, good.media)).toThrow(/PNG signature/);
  });

  it('rejects a digest that disagrees with the exact source bytes', () => {
    const good = fixture();
    good.manifest[0]!['sha256'] = '0'.repeat(64);
    expect(() => validatePortraitCatalog(good.manifest, good.media)).toThrow(/hashes to/);
  });
});
