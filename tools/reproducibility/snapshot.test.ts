import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareSnapshots, snapshotDirectory, verifyReproducibility } from './snapshot.js';

let temporaryDirectory: string;
let output: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'symbiosis-reproducibility-'));
  output = join(temporaryDirectory, 'generated');
  await mkdir(output);
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function write(path: string, bytes: string | Uint8Array): Promise<void> {
  const file = join(output, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

describe('complete output snapshots', () => {
  it('includes hidden files and binary output in a stable, relative inventory', async () => {
    await write('types/z.ts', 'export {};\n');
    await write('seed/seed.sqlite', new Uint8Array([0, 255, 1]));
    await write('media/items/icon.png', new Uint8Array([137, 80, 78, 71]));
    await write('spec/a.json', '{}\n');
    await write('seed/.gitkeep', '');
    const snapshot = await snapshotDirectory(output);
    expect([...snapshot.keys()]).toEqual([
      'media/items/icon.png',
      'seed/.gitkeep',
      'seed/seed.sqlite',
      'spec/a.json',
      'types/z.ts',
    ]);
    expect(snapshot.get('seed/.gitkeep')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(compareSnapshots(snapshot, new Map([...snapshot].reverse()))).toEqual({
      added: [],
      missing: [],
      changed: [],
    });
  });

  it.each(['media/items/icon.png', 'seed/seed.sqlite'])(
    'detects changed bytes in %s',
    async (path) => {
      await write(path, new Uint8Array([0, 255, 1]));
      const first = await snapshotDirectory(output);
      await write(path, new Uint8Array([0, 254, 1]));
      expect(compareSnapshots(first, await snapshotDirectory(output))).toEqual({
        added: [],
        missing: [],
        changed: [path],
      });
    },
  );

  it('detects added and missing paths even when their content is identical', async () => {
    await write('media/old.png', 'same bytes');
    const first = await snapshotDirectory(output);
    await rm(join(output, 'media/old.png'));
    await write('media/new.png', 'same bytes');
    expect(compareSnapshots(first, await snapshotDirectory(output))).toEqual({
      added: ['media/new.png'],
      missing: ['media/old.png'],
      changed: [],
    });
  });

  it('rejects empty output instead of confirming two empty inventories', async () => {
    await expect(verifyReproducibility(output, () => Promise.resolve())).rejects.toThrow(
      'contains no files',
    );
  });

  it('rejects a missing output directory', async () => {
    await expect(snapshotDirectory(join(output, 'missing'))).rejects.toThrow('ENOENT');
  });

  it('rejects directory links instead of omitting or following external output', async () => {
    const outside = join(temporaryDirectory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'external.png'), 'outside output');
    await symlink(outside, join(output, 'linked'), 'junction');
    await expect(snapshotDirectory(output)).rejects.toThrow('Unsupported output entry');
    await expect(snapshotDirectory(join(output, 'linked'))).rejects.toThrow(
      'Expected a real output directory',
    );
  });
});

describe('consecutive imports', () => {
  it('awaits each complete import and accepts identical bytes', async () => {
    let imports = 0;
    const count = await verifyReproducibility(output, async () => {
      imports += 1;
      await write('seed/seed.sqlite', new Uint8Array([0, 255]));
      await write('media/a.png', 'image');
    });
    expect(imports).toBe(2);
    expect(count).toBe(2);
  });

  it('rejects nondeterministic output with the changed filename', async () => {
    let imports = 0;
    await expect(
      verifyReproducibility(output, async () => {
        imports += 1;
        await write('seed/seed.sqlite', new Uint8Array([imports]));
      }),
    ).rejects.toThrow('changed: seed/seed.sqlite');
    expect(imports).toBe(2);
  });

  it.each([1, 2])(
    'propagates failure of import %i without accepting existing output',
    async (failingImport) => {
      await write('spec/existing.json', '{}');
      let imports = 0;
      await expect(
        verifyReproducibility(output, () => {
          imports += 1;
          return imports === failingImport
            ? Promise.reject(new Error(`import ${String(imports)} failed`))
            : Promise.resolve();
        }),
      ).rejects.toThrow(`import ${String(failingImport)} failed`);
      expect(imports).toBe(failingImport);
    },
  );
});
