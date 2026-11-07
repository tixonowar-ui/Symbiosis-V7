import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadNpcArtCatalog,
  readNpcRetainedArt,
  resolveNpcVersionArt,
  type NpcArtCatalog,
} from './npc-art.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
let catalog: NpcArtCatalog;
beforeAll(async () => {
  catalog = await loadNpcArtCatalog(root);
});
const scope = { raceCode: 'FREE' as const, sex: 'MALE' as const, previousArtOrNull: null };

describe('NPC-002/017 version-bound art (ADR 0077)', () => {
  it('resolves every explicit source race/sex mapping on clear without inferring UNITED spelling', () => {
    expect(catalog.defaults).toHaveLength(6);
    for (const entry of catalog.defaults) {
      const result = resolveNpcVersionArt(
        catalog,
        { kind: 'REPLACE', value: null },
        { ...scope, raceCode: entry.raceCode, sex: entry.sex },
      );
      expect(result).toEqual(entry.art);
      expect(readNpcRetainedArt(catalog, result)).toEqual(result);
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect(
      resolveNpcVersionArt(
        catalog,
        { kind: 'REPLACE', value: null },
        { ...scope, raceCode: 'UNITED' },
      ).assetKey,
    ).toBe('symbiosis_placeholder_unified_male');
  });
  it('keeps the previous default through a changed N+1 race/sex until explicit clear', () => {
    const original = resolveNpcVersionArt(catalog, { kind: 'REPLACE', value: null }, scope);
    const next = { raceCode: 'PURE' as const, sex: 'FEMALE' as const, previousArtOrNull: original };
    expect(resolveNpcVersionArt(catalog, { kind: 'INHERIT' }, next)).toEqual(original);
    expect(resolveNpcVersionArt(catalog, { kind: 'REPLACE', value: null }, next).assetKey).toBe(
      'symbiosis_placeholder_pure_female',
    );
    expect(readNpcRetainedArt(catalog, original)).toEqual(original);
  });
  it('accepts a real upload of default bytes with a distinct key and the same checksum', () => {
    const original = catalog.defaults[0]!.art;
    const uploaded = resolveNpcVersionArt(
      catalog,
      {
        kind: 'REPLACE',
        value: {
          kind: 'local-file',
          mediaType: original.mediaType,
          bytesBase64: original.bytesBase64,
        },
      },
      scope,
    );
    expect(uploaded.assetKey).toBe(`npc-upload:${original.sha256}`);
    expect(uploaded.assetKey).not.toBe(original.assetKey);
    expect(uploaded.sha256).toBe(original.sha256);
    expect(readNpcRetainedArt(catalog, uploaded)).toEqual(uploaded);
    expect(
      resolveNpcVersionArt(catalog, { kind: 'INHERIT' }, { ...scope, previousArtOrNull: uploaded }),
    ).toEqual(uploaded);
  });
  it('rejects invalid/unknown input without falling back to the default', () => {
    expect(() => resolveNpcVersionArt(catalog, { kind: 'INHERIT' }, scope)).toThrow('absent art');
    expect(() =>
      resolveNpcVersionArt(
        catalog,
        {
          kind: 'REPLACE',
          value: { kind: 'asset-key', assetKey: 'symbiosis_placeholder_united_male' },
        },
        scope,
      ),
    ).toThrow('unknown');
    expect(() =>
      resolveNpcVersionArt(
        catalog,
        {
          kind: 'REPLACE',
          value: { kind: 'asset-key', assetKey: 'symbiosis_placeholder_monster' },
        },
        scope,
      ),
    ).toThrow('unknown');
    for (const bytesBase64 of ['not base64', Buffer.from('not a PNG').toString('base64')]) {
      expect(() =>
        resolveNpcVersionArt(
          catalog,
          { kind: 'REPLACE', value: { kind: 'local-file', mediaType: 'image/png', bytesBase64 } },
          scope,
        ),
      ).toThrow();
    }
    expect(() =>
      resolveNpcVersionArt(catalog, { kind: 'REPLACE', value: null, extra: true }, scope),
    ).toThrow('unexpected');
    expect(() =>
      resolveNpcVersionArt({ defaults: catalog.defaults }, { kind: 'REPLACE', value: null }, scope),
    ).toThrow('host-loaded');
  });
  it('rejects corrupt saved bytes, hashes and substituted keys without reading a new default', () => {
    const art = catalog.defaults[0]!.art;
    expect(() => readNpcRetainedArt(catalog, { ...art, sha256: '0'.repeat(64) })).toThrow(
      'checksum',
    );
    expect(() =>
      readNpcRetainedArt(catalog, { ...art, assetKey: catalog.defaults[1]!.art.assetKey }),
    ).toThrow('default bytes');
    expect(() => readNpcRetainedArt(catalog, { ...art, assetKey: 'unrecognized-upload' })).toThrow(
      'unknown',
    );
    expect(() =>
      readNpcRetainedArt(catalog, { ...art, bytesBase64: art.bytesBase64.slice(4) }),
    ).toThrow();
    let getterCalls = 0;
    const malicious = { ...art };
    Object.defineProperty(malicious, 'bytesBase64', {
      enumerable: true,
      get: () => {
        getterCalls++;
        return art.bytesBase64;
      },
    });
    expect(() => readNpcRetainedArt(catalog, malicious)).toThrow('own data');
    expect(getterCalls).toBe(0);
  });
  it('rejects changed generated media at catalog load instead of repinning its checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'symbiosis-npc-art-'));
    try {
      await mkdir(join(directory, 'generated/spec/gm-entity-portraits'), { recursive: true });
      await mkdir(join(directory, 'generated/media/local-character-portraits'), {
        recursive: true,
      });
      await writeFile(
        join(directory, 'generated/spec/gm-entity-portraits/catalog.json'),
        await readFile(join(root, 'generated/spec/gm-entity-portraits/catalog.json')),
      );
      await Promise.all(
        catalog.defaults.map(async (entry, index) => {
          const bytes = Buffer.from(entry.art.bytesBase64, 'base64');
          if (index === 0) bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
          await writeFile(
            join(
              directory,
              'generated/media/local-character-portraits',
              `${entry.art.assetKey}.png`,
            ),
            bytes,
          );
        }),
      );
      await expect(loadNpcArtCatalog(directory)).rejects.toThrow('source bytes differ');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
