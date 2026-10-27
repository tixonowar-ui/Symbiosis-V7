import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type Snapshot = ReadonlyMap<string, string>;

export interface Difference {
  readonly added: readonly string[];
  readonly missing: readonly string[];
  readonly changed: readonly string[];
}

async function digest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Git ignores media and SQLite, so the inventory must come from the filesystem. */
export async function snapshotDirectory(directory: string): Promise<Snapshot> {
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error(`Expected a real output directory: ${directory}`);
  }

  const files = new Map<string, string>();
  async function visit(path: string, prefix: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, `${relative}/`);
      } else if (entry.isFile()) {
        files.set(relative, await digest(absolute));
      } else {
        // Links could make the comparison depend on files outside generated/.
        throw new Error(`Unsupported output entry (expected a file or directory): ${absolute}`);
      }
    }
  }
  await visit(directory, '');
  if (files.size === 0) throw new Error(`Output directory contains no files: ${directory}`);
  return files;
}

export function compareSnapshots(first: Snapshot, second: Snapshot): Difference {
  return {
    added: [...second.keys()].filter((path) => !first.has(path)).sort(),
    missing: [...first.keys()].filter((path) => !second.has(path)).sort(),
    changed: [...first.keys()]
      .filter((path) => second.has(path) && first.get(path) !== second.get(path))
      .sort(),
  };
}

/** The callback is awaited before each snapshot: partial imports are never compared. */
export async function verifyReproducibility(
  directory: string,
  runImport: () => Promise<void>,
): Promise<number> {
  await runImport();
  const first = await snapshotDirectory(directory);
  await runImport();
  const second = await snapshotDirectory(directory);
  const difference = compareSnapshots(first, second);
  const lines = [
    ...difference.added.map((path) => `added: ${path}`),
    ...difference.missing.map((path) => `missing: ${path}`),
    ...difference.changed.map((path) => `changed: ${path}`),
  ];
  if (lines.length > 0) {
    throw new Error(`Output differs between imports in ${directory}:\n${lines.join('\n')}`);
  }
  return second.size;
}
