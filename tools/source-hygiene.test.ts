/**
 * Source files must stay text.
 *
 * One NUL byte flips a file into git's "binary" class, and the damage is
 * silent: `git diff` degrades to "Binary files differ", `rg` and `grep` skip
 * the file without saying so, and any merge touching it from both sides
 * becomes an unresolvable binary conflict. `tools/validate/index.ts` carried
 * such a byte from its first commit and nobody noticed until a PR touching it
 * had to be reviewed by hand — see issue #18.
 *
 * The check is cheap because it covers only hand-written TypeScript.
 * `generated/` is pipeline output written through one serialiser, and
 * `artifacts/` is binary by nature.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['tools', 'src'] as const;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
  }
  return found;
}

describe('hand-written sources carry no NUL bytes', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)));

  it('finds sources to check, so the test cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('leaves every source file readable by git, grep and diff', () => {
    const offenders = files
      .map((path) => ({ path, offset: readFileSync(path).indexOf(0) }))
      .filter((file) => file.offset >= 0)
      .map((file) => `${file.path.slice(REPO_ROOT.length)} at byte ${String(file.offset)}`);
    expect(offenders).toEqual([]);
  });
});
