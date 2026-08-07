/**
 * SHA-256 manifest for artifacts/ — reusable core.
 *
 * artifacts/ is a read-only source of truth (see CLAUDE.md). This module proves
 * it has not drifted; it never modifies anything under artifacts/ other than the
 * manifest itself. The CLI lives in ./index.ts, the import pipeline gates on
 * `verify()` before it reads a single byte.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts');

const MANIFEST_NAME = 'CHECKSUMS.sha256';
const MANIFEST_PATH = join(ARTIFACTS_DIR, MANIFEST_NAME);

/** `<64 hex>  <path>` — the format `sha256sum -c` expects. */
const LINE = /^(?<digest>[0-9a-f]{64}) {2}(?<path>.+)$/;

export interface Entry {
  readonly path: string;
  readonly digest: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly tracked: number;
  readonly missing: readonly string[];
  readonly untracked: readonly string[];
  readonly changed: readonly string[];
}

async function listFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(ARTIFACTS_DIR, { withFileTypes: true, recursive: true })) {
    if (!item.isFile()) continue;
    const rel = relative(ARTIFACTS_DIR, join(item.parentPath, item.name))
      .split(sep)
      .join(posix.sep);
    if (rel === MANIFEST_NAME) continue;
    found.push(rel);
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function digestOf(relPath: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash('sha256');
    createReadStream(join(ARTIFACTS_DIR, relPath))
      .on('error', rej)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => {
        res(hash.digest('hex'));
      });
  });
}

export async function scan(): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const path of await listFiles()) {
    entries.push({ path, digest: await digestOf(path) });
  }
  return entries;
}

export async function readManifest(): Promise<Entry[]> {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  const entries: Entry[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '' || line.startsWith('#')) return;
    const match = LINE.exec(line);
    if (!match?.groups) {
      throw new Error(`${MANIFEST_NAME}:${index + 1}: malformed line: ${line}`);
    }
    entries.push({ digest: match.groups['digest']!, path: match.groups['path']! });
  });
  return entries;
}

export function render(entries: readonly Entry[]): string {
  return entries.map((e) => `${e.digest}  ${e.path}`).join('\n') + '\n';
}

export async function write(): Promise<number> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const entries = await scan();
  await writeFile(MANIFEST_PATH, render(entries), 'utf8');
  console.log(`wrote ${MANIFEST_NAME}: ${entries.length} file(s)`);
  return 0;
}

export async function verify(): Promise<VerifyResult> {
  const expected = new Map((await readManifest()).map((e) => [e.path, e.digest]));
  const actual = new Map((await scan()).map((e) => [e.path, e.digest]));

  const missing = [...expected.keys()].filter((p) => !actual.has(p));
  const untracked = [...actual.keys()].filter((p) => !expected.has(p));
  const changed = [...expected]
    .filter(([p, d]) => actual.has(p) && actual.get(p) !== d)
    .map(([p]) => p);

  return {
    ok: missing.length + untracked.length + changed.length === 0,
    tracked: expected.size,
    missing,
    untracked,
    changed,
  };
}

/** Human-readable failure report, or `null` when the manifest verifies. */
export function describeFailure(result: VerifyResult): string | null {
  if (result.ok) return null;
  const lines = [
    ...result.missing.map((p) => `MISSING   ${p}`),
    ...result.untracked.map((p) => `UNTRACKED ${p}`),
    ...result.changed.map((p) => `CHANGED   ${p}`),
  ];
  const count = result.missing.length + result.untracked.length + result.changed.length;
  lines.push(
    '',
    `${MANIFEST_NAME}: ${count} problem(s) across ${result.tracked} tracked file(s).`,
    'artifacts/ is read-only. If a new artifact was delivered on purpose, ' +
      'run "npm run checksums" and commit the result.',
  );
  return lines.join('\n');
}
