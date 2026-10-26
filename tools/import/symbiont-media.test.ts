import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { embeddedMedia } from './lib/archive.js';
import { anchoredImages } from './lib/media.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';
import { planSymbiontMediaImport, selectSymbiontMediaSpeciesKeys } from './symbiont-media.js';
import type { SymbiontMediaWorkbookInput } from './symbiont-media.js';

const speciesKeys = selectSymbiontMediaSpeciesKeys(
  JSON.parse(readFileSync(join(SPEC_DIR, 'character', 'symbionts.json'), 'utf8')) as {
    SpeciesKey: string;
    Status: string;
    SymbiontKind: string;
  }[],
);

function workbookInput(archivePath: string, sheetName: string): SymbiontMediaWorkbookInput {
  return {
    archivePath,
    sheetName,
    rows: Workbook.open(archivePath, 'symbiont-media-test').absoluteRows(sheetName),
    images: anchoredImages(archivePath, sheetName, 'symbiont-media-test'),
    mediaPaths: embeddedMedia(archivePath, 'symbiont-media-test').map((entry) => entry.path),
  };
}

const artInput = workbookInput(ARTIFACT.symbiontArt, 'SymbiontArt');
const treeInput = workbookInput(ARTIFACT.symbiontDevelopmentTrees, 'DevelopmentTrees');

type MutableWorkbookInput = {
  -readonly [Key in keyof SymbiontMediaWorkbookInput]: SymbiontMediaWorkbookInput[Key];
};

function inputs(): { art: MutableWorkbookInput; trees: MutableWorkbookInput } {
  return {
    art: structuredClone(artInput),
    trees: structuredClone(treeInput),
  };
}

function setCell(input: MutableWorkbookInput, row: number, column: number, value: string): void {
  input.rows = input.rows.map((current, index) =>
    index === row
      ? current.map((cell, cellIndex) => (cellIndex === column ? value : cell))
      : current,
  );
}

function setFilename(input: MutableWorkbookInput, row: number, value: string): void {
  const column = input.rows[0]?.indexOf('FileName');
  if (column === undefined || column < 0) throw new Error('test workbook has no FileName column');
  setCell(input, row, column, value);
}

function expectRefusal(
  expected: RegExp,
  change: (art: MutableWorkbookInput, trees: MutableWorkbookInput) => void,
): void {
  const { art, trees } = inputs();
  change(art, trees);
  expect(() => planSymbiontMediaImport(speciesKeys, art, trees)).toThrow(expected);
}

describe('symbiont media SpeciesKey plan', () => {
  it('joins all 23 arts and development trees in source order with exact byte counts', () => {
    const plan = planSymbiontMediaImport(speciesKeys, artInput, treeInput);
    const expectedBytes = [...artInput.images, ...treeInput.images].reduce(
      (sum, image) => sum + image.bytes.byteLength,
      0,
    );
    expect(plan.species.map((entry) => entry.speciesKey)).toEqual(speciesKeys);
    expect(plan.species).toHaveLength(23);
    expect(plan.species[0]).toEqual({
      speciesKey: 'WEAVER',
      artFile: 'WEAVER.png',
      developmentTreeFile: 'WEAVER.png',
    });
    for (const entry of plan.species) {
      expect(entry.artFile).toBe(`${entry.speciesKey}.png`);
      expect(entry.developmentTreeFile).toBe(`${entry.speciesKey}.png`);
    }
    expect(plan.mediaBytes).toBe(expectedBytes);
  });

  it('uses SpeciesKey rather than media upload order', () => {
    const { art, trees } = inputs();
    art.images = [...art.images].reverse();
    trees.images = [...trees.images].reverse();
    const plan = planSymbiontMediaImport(speciesKeys, art, trees);
    expect(plan.species[0]?.speciesKey).toBe('WEAVER');
    expect(plan.species.at(-1)?.speciesKey).toBe('PLAGUE_DOCTOR');
  });

  it('names a missing image instead of accepting a partial set', () => {
    expectRefusal(/WEAVER/u, (art) => {
      art.images = art.images.slice(1);
    });
  });

  it('rejects an unreferenced extra media part', () => {
    expectRefusal(/unreferenced/u, (art) => {
      art.mediaPaths = [...art.mediaPaths, 'xl/media/unreferenced.png'];
    });
  });

  it('rejects an unknown SpeciesKey', () => {
    expectRefusal(/UNKNOWN_SPECIES/u, (art) => {
      setCell(art, 1, 0, 'UNKNOWN_SPECIES');
    });
  });

  it('rejects an empty SpeciesKey instead of skipping its row', () => {
    expectRefusal(/unknown SpeciesKey ""/u, (art) => {
      setCell(art, 1, 0, '');
    });
  });

  it('rejects a duplicate SpeciesKey', () => {
    expectRefusal(/duplicate SpeciesKey.*WEAVER|WEAVER.*duplicate SpeciesKey/u, (art) => {
      setCell(art, 2, 0, 'WEAVER');
    });
  });

  it('rejects a duplicate declared filename', () => {
    expectRefusal(/duplicate filename.*WEAVER\.png|WEAVER\.png.*duplicate filename/u, (art) => {
      setFilename(art, 2, 'WEAVER.png');
    });
  });

  it('rejects two anchors that resolve to the same media part', () => {
    expectRefusal(/two anchors resolve to the same media part/u, (art) => {
      const source = art.images[0]?.source;
      if (source === undefined) throw new Error('test workbook has no source image');
      art.images = art.images.map((image, index) => (index === 1 ? { ...image, source } : image));
    });
  });

  it('rejects an anchor to a header row instead of a species row', () => {
    expectRefusal(/row 0/u, (art) => {
      art.images = art.images.map((image, index) => (index === 0 ? { ...image, row: 0 } : image));
    });
  });

  it('rejects a second image anchored to another species row', () => {
    expectRefusal(/duplicate image.*TAIPAN/u, (art) => {
      art.images = art.images.map((image, index) => (index === 0 ? { ...image, row: 2 } : image));
    });
  });

  it('rejects traversal and a non-PNG extension before writing', () => {
    expectRefusal(/safe.*\.\.\/WEAVER\.png|\.\.\/WEAVER\.png.*safe/u, (art) => {
      setFilename(art, 1, '../WEAVER.png');
    });
    expectRefusal(/WEAVER\.jpg|PNG extension/u, (art) => {
      setFilename(art, 1, 'WEAVER.jpg');
    });
  });

  it('rejects bytes without the exact PNG signature', () => {
    expectRefusal(/PNG signature/u, (art) => {
      art.images = art.images.map((image, index) =>
        index === 0 ? { ...image, bytes: Uint8Array.from([0, 1, 2]) } : image,
      );
    });
  });

  it('rejects a declared filename that does not equal SpeciesKey', () => {
    expectRefusal(/TAIPAN\.png/u, (art) => {
      setFilename(art, 1, 'TAIPAN.png');
    });
  });

  it('validates the development-tree workbook independently', () => {
    expectRefusal(/PLAGUE_DOCTOR/u, (_art, trees) => {
      trees.images = trees.images.slice(0, -1);
    });
  });
});

interface GeneratedManifest {
  readonly artSource: string;
  readonly developmentTreeSource: string;
  readonly mediaDirs: { readonly art: string; readonly developmentTrees: string };
  readonly species: readonly {
    readonly speciesKey: string;
    readonly artFile: string;
    readonly developmentTreeFile: string;
  }[];
}

function generatedManifest(): GeneratedManifest {
  return JSON.parse(
    readFileSync(join(SPEC_DIR, 'symbiont-media', 'manifest.json'), 'utf8'),
  ) as GeneratedManifest;
}

function imageBytes(input: SymbiontMediaWorkbookInput, speciesKey: string): Uint8Array {
  const keyColumn = input.rows[0]?.indexOf('SpeciesKey');
  if (keyColumn === undefined || keyColumn < 0) {
    throw new Error(`${input.sheetName} has no SpeciesKey column`);
  }
  const image = input.images.find(
    (candidate) => input.rows[candidate.row]?.[keyColumn] === speciesKey,
  );
  if (image === undefined) throw new Error(`source image ${speciesKey} not found`);
  return image.bytes;
}

describe('generated symbiont media', () => {
  it('writes one exact manifest and 46 source-identical images', () => {
    const manifest = generatedManifest();
    expect(Object.keys(manifest).sort()).toEqual([
      'artSource',
      'developmentTreeSource',
      'mediaDirs',
      'species',
    ]);
    expect(manifest.artSource).toBe(
      'artifacts/symbiont-media/Symbiosis_V7_Symbiont_Art_Mapping_v1.0.xlsx',
    );
    expect(manifest.developmentTreeSource).toBe(
      'artifacts/symbiont-media/Symbiosis_V7_Symbiont_Development_Tree_Mapping_v1.0.xlsx',
    );
    expect(manifest.mediaDirs).toEqual({
      art: 'generated/media/symbionts',
      developmentTrees: 'generated/media/development-trees',
    });
    expect(manifest.species.map((entry) => entry.speciesKey)).toEqual(speciesKeys);
    expect(manifest.species).toHaveLength(23);
    const expectedArtFiles = speciesKeys.map((key) => `${key}.png`).sort();
    expect(readdirSync(join(MEDIA_DIR, 'symbionts')).sort()).toEqual(expectedArtFiles);
    expect(readdirSync(join(MEDIA_DIR, 'development-trees')).sort()).toEqual(expectedArtFiles);
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const entry of manifest.species) {
      const art = readFileSync(join(MEDIA_DIR, 'symbionts', entry.artFile));
      const tree = readFileSync(join(MEDIA_DIR, 'development-trees', entry.developmentTreeFile));
      expect(entry.artFile).toBe(`${entry.speciesKey}.png`);
      expect(entry.developmentTreeFile).toBe(`${entry.speciesKey}.png`);
      expect(art.subarray(0, 8).equals(pngSignature)).toBe(true);
      expect(tree.subarray(0, 8).equals(pngSignature)).toBe(true);
      expect(art.equals(imageBytes(artInput, entry.speciesKey))).toBe(true);
      expect(tree.equals(imageBytes(treeInput, entry.speciesKey))).toBe(true);
    }
  });
});
