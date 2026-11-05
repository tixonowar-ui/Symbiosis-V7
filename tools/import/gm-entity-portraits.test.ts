import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR } from './lib/paths.js';
import { validateGmPortraitCatalog } from './gm-entity-portraits.js';

function fixture() {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const media = (path: string) =>
    new Map(
      readdirSync(path)
        .filter((file) => file !== 'manifest.json')
        .map((file) => [file, readFileSync(join(path, file))]),
    );
  return {
    manifest: read(ARTIFACT.gmEntityPortraitManifest) as {
      npc: Record<string, unknown>[];
      enemy: Record<string, unknown>[];
    },
    localManifest: read(ARTIFACT.localCharacterPortraitManifest),
    media: media(ARTIFACT.gmEntityPortraitDirectory),
    localMedia: media(ARTIFACT.localCharacterPortraitMedia),
  };
}
const validate = (f: ReturnType<typeof fixture>) =>
  validateGmPortraitCatalog(f.manifest, f.media, f.localManifest, f.localMedia);

describe('ADR 0077 approved GM portrait delivery', () => {
  it('imports the exact eight mappings and preserves all source image bytes', () => {
    const f = fixture(),
      catalog = validate(f);
    expect(catalog).toHaveLength(8);
    expect(catalog).toEqual(
      JSON.parse(readFileSync(join(SPEC_DIR, 'gm-entity-portraits/catalog.json'), 'utf8')),
    );
    expect(
      catalog.filter((row) => row['raceCodeOrNull'] === 'UNITED').map((row) => row['assetKey']),
    ).toEqual(['symbiosis_placeholder_unified_female', 'symbiosis_placeholder_unified_male']);
    expect(
      catalog.slice(6).map((row) => [row['entityKind'], row['raceCodeOrNull'], row['sexOrNull']]),
    ).toEqual([
      ['SENTIENT', null, null],
      ['CUSTOM_MONSTER', null, null],
    ]);
    for (const row of catalog) {
      const path = row['mediaPath'] as string;
      const source = path.startsWith('gm-entity-portraits/') ? f.media : f.localMedia;
      expect(readFileSync(join(MEDIA_DIR, path)).equals(source.get(path.split('/').at(-1)!)!)).toBe(
        true,
      );
    }
  });

  it.each(['raceCode', 'sex', 'assetKey', 'sha256'])(
    'rejects remapping an existing NPC portrait through %s',
    (key) => {
      const f = fixture();
      f.manifest.npc[0]![key] = 'FOREIGN';
      expect(() => validate(f)).toThrow(/must bind|must preserve/);
    },
  );
  it.each(['kind', 'assetKey', 'file', 'sha256'])(
    'rejects an enemy %s outside the approved delivery',
    (key) => {
      const f = fixture();
      f.manifest.enemy[0]![key] = key === 'file' ? '../portrait.png' : 'FOREIGN';
      expect(() => validate(f)).toThrow(/does not match the approved/);
    },
  );
  it('rejects missing, extra and swapped source mappings', () => {
    const missing = fixture();
    missing.manifest.npc.pop();
    expect(() => validate(missing)).toThrow(/expected 6/);
    const extra = fixture();
    extra.manifest.enemy[0]!['sex'] = 'MALE';
    expect(() => validate(extra)).toThrow(/expected exactly/);
    const swapped = fixture();
    swapped.manifest.enemy.reverse();
    expect(() => validate(swapped)).toThrow(/does not match the approved/);
  });
  it('rejects missing, undeclared and corrupted physical bytes', () => {
    const missing = fixture();
    missing.media.delete('symbiosis_placeholder_monster.png');
    expect(() => validate(missing)).toThrow(/is missing/);
    const extra = fixture();
    extra.media.set('extra.png', Buffer.from('extra'));
    expect(() => validate(extra)).toThrow(/not declared/);
    const changed = fixture();
    changed.media.get('symbiosis_placeholder_monster.png')![64] =
      changed.media.get('symbiosis_placeholder_monster.png')![64]! ^ 1;
    expect(() => validate(changed)).toThrow(/hashes to/);
    const invalid = fixture();
    invalid.media.get('symbiosis_placeholder_sentient_enemy.png')![0] = 0;
    expect(() => validate(invalid)).toThrow(/PNG signature/);
  });
  it('rejects changed reused CHR bytes instead of creating a GM replacement', () => {
    const f = fixture();
    f.localMedia.get('symbiosis_placeholder_unified_male.png')![64] =
      f.localMedia.get('symbiosis_placeholder_unified_male.png')![64]! ^ 1;
    expect(() => validate(f)).toThrow(/hashes to/);
  });
});
