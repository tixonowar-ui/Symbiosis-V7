/**
 * SHA-256 manifest for artifacts/.
 *
 *   npm run checksums          rewrite artifacts/CHECKSUMS.sha256
 *   npm run checksums:verify   check every file against it, non-zero exit on drift
 *
 * artifacts/ is a read-only source of truth (see CLAUDE.md). This tool exists to
 * prove it has not drifted; it never modifies anything under artifacts/ other
 * than the manifest itself.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts');
const MANIFEST_PATH = join(ARTIFACTS_DIR, 'CHECKSUMS.sha256');
const MANIFEST_NAME = 'CHECKSUMS.sha256';

/** `<64 hex>  <path>` — the format `sha256sum -c` expects. */
const LINE = /^(?<digest>[0-9a-f]{64}) {2}(?<path>.+)$/;

interface Entry {
  readonly path: string;
  readonly digest: string;
}

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!item.isFile()) continue;
    const absolute = join(item.parentPath, item.name);
    const rel = relative(ARTIFACTS_DIR, absolute).split(sep).join(posix.sep);
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

async function scan(): Promise<Entry[]> {
  const paths = await listFiles(ARTIFACTS_DIR);
  const entries: Entry[] = [];
  for (const path of paths) {
    entries.push({ path, digest: await digestOf(path) });
  }
  return entries;
}

async function readManifest(): Promise<Entry[]> {
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

function render(entries: Entry[]): string {
  return entries.map((e) => `${e.digest}  ${e.path}`).join('\n') + '\n';
}

async function write(): Promise<number> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const entries = await scan();
  await writeFile(MANIFEST_PATH, render(entries), 'utf8');
  console.log(`wrote ${MANIFEST_NAME}: ${entries.length} file(s)`);
  return 0;
}

async function verify(): Promise<number> {
  const expected = new Map((await readManifest()).map((e) => [e.path, e.digest]));
  const actual = new Map((await scan()).map((e) => [e.path, e.digest]));

  const missing = [...expected.keys()].filter((p) => !actual.has(p));
  const added = [...actual.keys()].filter((p) => !expected.has(p));
  const changed = [...expected].filter(([p, d]) => actual.has(p) && actual.get(p) !== d);

  for (const p of missing) console.error(`MISSING   ${p}`);
  for (const p of added) console.error(`UNTRACKED ${p}`);
  for (const [p] of changed) console.error(`CHANGED   ${p}`);

  const failures = missing.length + added.length + changed.length;
  if (failures > 0) {
    console.error(
      `\n${MANIFEST_NAME}: ${failures} problem(s) across ${expected.size} tracked file(s).\n` +
        `artifacts/ is read-only. If a new artifact was delivered on purpose, ` +
        `run "npm run checksums" and commit the result.`,
    );
    return 1;
  }
  console.log(`${MANIFEST_NAME}: OK, ${expected.size} file(s) verified`);
  return 0;
}

const command = process.argv[2];
const action = command === 'write' ? write : command === 'verify' ? verify : null;

if (!action) {
  console.error('usage: tsx tools/checksums/index.ts <write|verify>');
  process.exit(2);
}

process.exit(await action());
