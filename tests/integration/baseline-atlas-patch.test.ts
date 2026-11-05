import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINE_LINEAGE_SEALS } from '../../src/host/baseline-lineage-seals.js';
import {
  applyFixtureAtlasPatch,
  FIXTURE_ATLAS_PATHS,
  readFixtureAtlas,
  writeFixtureAtlas,
} from '../fixtures/baseline-atlas-patch.js';
import type { FixtureAtlasBytes } from '../fixtures/baseline-atlas-patch.js';
import {
  applyBaselineFixtureRelease,
  baselineFixtureManifest,
} from '../fixtures/baseline-lineage.js';

const [jsonPath, markdownPath] = FIXTURE_ATLAS_PATHS;
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const patchNames = [
  '177',
  '199',
  '206',
  '208',
  '186',
  '221',
  '221-transfer',
  '221-recovery',
] as const;
// The B0 seal is recorded in the frozen atlas-v1.5.checksums.sha256 manifest.
const releaseSeals = [
  {
    [jsonPath]: 'df68aab0bdc09beb5e36369ae33fd1bb293620dfc74664e91a8b95711c972ce5',
    [markdownPath]: '2514c723b92847ff3d0f392e35cfb041459b589d0ffc2f79d1b60d2e7456f03e',
  },
  BASELINE_LINEAGE_SEALS.successorAtlas,
  BASELINE_LINEAGE_SEALS.admissionAtlas,
  BASELINE_LINEAGE_SEALS.lobbyAtlas,
  BASELINE_LINEAGE_SEALS.settingsAtlas,
  BASELINE_LINEAGE_SEALS.gmSourceAtlas,
  BASELINE_LINEAGE_SEALS.queueSourceAtlas,
  BASELINE_LINEAGE_SEALS.normalTransferAtlas,
  BASELINE_LINEAGE_SEALS.recoveryAtlas,
] as const;
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const digests = (bytes: FixtureAtlasBytes): Record<string, string> =>
  Object.fromEntries(FIXTURE_ATLAS_PATHS.map((path) => [path, digest(bytes[path])]));
const pair = (text: string): FixtureAtlasBytes => ({
  [jsonPath]: Buffer.from(text),
  [markdownPath]: Buffer.from(text),
});
function expectBytes(actual: FixtureAtlasBytes, expected: FixtureAtlasBytes): void {
  for (const path of FIXTURE_ATLAS_PATHS)
    expect(actual[path].equals(expected[path]), path).toBe(true);
}
function expectSealed(bytes: FixtureAtlasBytes, release: number): void {
  expect(digests(bytes)).toEqual(releaseSeals[release]);
}
function rawRead(root: string): FixtureAtlasBytes {
  return Object.fromEntries(
    FIXTURE_ATLAS_PATHS.map((path) => [path, readFileSync(join(root, 'artifacts', path))]),
  ) as FixtureAtlasBytes;
}
function install(root: string, bytes: FixtureAtlasBytes): void {
  mkdirSync(join(root, 'artifacts/atlas'), { recursive: true });
  for (const path of FIXTURE_ATLAS_PATHS) writeFileSync(join(root, 'artifacts', path), bytes[path]);
}
function withTemporaryRoot(body: (directory: string) => void): void {
  const temporaryParent = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryParent, 'symbiosis-atlas-byte-patch-'));
  try {
    body(directory);
  } finally {
    const withinParent = relative(temporaryParent, resolve(directory));
    assert(withinParent !== '' && !isAbsolute(withinParent) && !withinParent.startsWith('..'));
    rmSync(directory, { recursive: true, force: true });
  }
}
function patchBytes(edge: number): Buffer {
  const name = patchNames[edge];
  assert(name !== undefined);
  return readFileSync(join(sourceRoot, 'tests/fixtures', `atlas-${name}-lineage.patch`));
}
function sealedInput(release: number): FixtureAtlasBytes {
  let bytes = rawRead(sourceRoot);
  expectSealed(bytes, 8);
  // Preparation may use the candidate only under independent complete release seals.
  // Expected outputs below come from a real Git apply, never from this preparation.
  for (let edge = 7; edge >= release; edge--) {
    bytes = applyFixtureAtlasPatch(bytes, patchBytes(edge), true);
    expectSealed(bytes, edge);
  }
  return bytes;
}
function section(path: string, body = '@@ -1,3 +1,3 @@\n head\n-old\n+new\n end\n'): string {
  return (
    `diff --git a/artifacts/${path} b/artifacts/${path}\n` +
    'index 1234567..abcdef0 100644\n' +
    `--- a/artifacts/${path}\n+++ b/artifacts/${path}\n` +
    body
  );
}
const smallPatch = section(jsonPath) + section(markdownPath);
const smallBefore = (): FixtureAtlasBytes => pair('head\nold\nend\n');
const smallAfter = (): FixtureAtlasBytes => pair('head\nnew\nend\n');

describe('strict fixture Atlas byte patches', () => {
  const edges = patchNames.flatMap((name, edge) =>
    [false, true].map((reverse) => ({
      name,
      edge,
      reverse,
      direction: reverse ? 'reverse' : 'forward',
    })),
  );
  it.each(edges)(
    'matches real Git for patch $name $direction with both full release seals',
    ({ edge, reverse }) => {
      withTemporaryRoot((directory) => {
        const from = edge + (reverse ? 1 : 0),
          to = edge + (reverse ? 0 : 1);
        const before = sealedInput(from);
        const patch = patchBytes(edge),
          originalPatch = Buffer.from(patch);
        const gitRoot = join(directory, 'git-oracle'),
          candidateRoot = join(directory, 'candidate');
        install(gitRoot, before);
        install(candidateRoot, before);
        const git = (args: string[], input?: Buffer): Buffer =>
          execFileSync('git', args, { cwd: gitRoot, stdio: 'pipe', ...(input ? { input } : {}) });
        git(['init', '--quiet']);
        // A temporary folder may be nested below the checkout; its own repository
        // prevents Git's parent-prefix discovery from silently skipping both files.
        // Windows TEMP can use 8.3 names; native resolution expands both aliases.
        expect(realpathSync.native(git(['rev-parse', '--show-toplevel']).toString().trim())).toBe(
          realpathSync.native(gitRoot),
        );
        expect(git(['rev-parse', '--show-prefix']).toString().trim()).toBe('');
        git(
          [
            '-c',
            'core.autocrlf=false',
            'apply',
            '--no-index',
            ...(reverse ? ['--reverse'] : []),
            '-',
          ],
          patch,
        );
        const expected = rawRead(gitRoot);
        expectSealed(expected, to);
        for (const path of FIXTURE_ATLAS_PATHS)
          expect(
            expected[path].equals(before[path]),
            `${path}: Git must actually change bytes`,
          ).toBe(false);

        const actual = applyFixtureAtlasPatch(before, patch, reverse);
        expectBytes(actual, expected);
        expectSealed(actual, to);
        writeFixtureAtlas(candidateRoot, actual, releaseSeals[to]!);
        expectBytes(rawRead(candidateRoot), expected);
        expectSealed(before, from);
        expect(patch.equals(originalPatch)).toBe(true);
      });
    },
  );

  it.each([false, true])('returns detached UTF-8 buffers in direction reverse=%s', (reverse) => {
    const source = reverse ? 'head\nновое\nend\n' : 'head\nстарое\nend\n';
    const expected = reverse ? 'head\nстарое\nend\n' : 'head\nновое\nend\n';
    const before = pair(source),
      patch = Buffer.from(smallPatch.replaceAll('-old\n+new\n', '-старое\n+новое\n'));
    const patchSeal = digest(patch),
      inputSeals = digests(before);
    const result = applyFixtureAtlasPatch(before, patch, reverse);
    expectBytes(result, pair(expected));
    expect(result[jsonPath]).not.toBe(before[jsonPath]);
    expect(result[markdownPath]).not.toBe(before[markdownPath]);
    result[jsonPath].fill(0);
    expect(result[markdownPath].equals(Buffer.from(expected))).toBe(true);
    expect(digests(before)).toEqual(inputSeals);
    expect(digest(patch)).toBe(patchSeal);
  });

  it.each([false, true])(
    'consumes bare LF only as exact in-hunk empty context, reverse=%s',
    (reverse) => {
      const body = '@@ -1,3 +1,3 @@ stateDiagram-v2\n head\n\n-old\n+new\n';
      const before = pair(reverse ? 'head\n\nnew\n' : 'head\n\nold\n');
      const patch = Buffer.from(section(jsonPath, body) + section(markdownPath, body));
      expectBytes(
        applyFixtureAtlasPatch(before, patch, reverse),
        pair(reverse ? 'head\n\nold\n' : 'head\n\nnew\n'),
      );
      const nonempty = {
        ...before,
        [markdownPath]: Buffer.from(reverse ? 'head\nspace\nnew\n' : 'head\nspace\nold\n'),
      };
      expect(() => applyFixtureAtlasPatch(nonempty, patch, reverse)).toThrow(/fixture Atlas/);
    },
  );

  const malformed = [
    { name: 'missing second file', text: section(jsonPath) },
    { name: 'duplicate second file', text: section(jsonPath) + section(jsonPath) },
    { name: 'extra third file', text: smallPatch + section('atlas/extra.json') },
    { name: 'trailing content', text: smallPatch + 'unexpected\n' },
    { name: 'out-of-hunk empty line', text: section(jsonPath) + '\n' + section(markdownPath) },
    { name: 'missing final LF', text: smallPatch.slice(0, -1) },
    { name: 'CRLF patch', text: smallPatch.replaceAll('\n', '\r\n') },
    { name: 'NUL patch', text: smallPatch.replace(' head\n', ' he\0ad\n') },
    {
      name: 'no-newline marker',
      text: smallPatch.replace(' end\n', ' end\n\\ No newline at end of file\n'),
    },
    {
      name: 'old header mismatch',
      text: smallPatch.replace(`--- a/artifacts/${jsonPath}`, `--- a/artifacts/${markdownPath}`),
    },
    {
      name: 'new header mismatch',
      text: smallPatch.replace(`+++ b/artifacts/${jsonPath}`, `+++ b/artifacts/${markdownPath}`),
    },
    { name: 'executable mode', text: smallPatch.replace('100644', '100755') },
    { name: 'symlink mode', text: smallPatch.replace('100644', '120000') },
    { name: 'unsupported index', text: smallPatch.replace('1234567..abcdef0', '123456..abcdef0') },
    { name: 'create metadata', text: smallPatch.replace('index ', 'new file mode 100644\nindex ') },
    {
      name: 'delete metadata',
      text: smallPatch.replace('index ', 'deleted file mode 100644\nindex '),
    },
    {
      name: 'rename metadata',
      text: smallPatch.replace('index ', 'rename from ignored\nrename to ignored\nindex '),
    },
    { name: 'binary metadata', text: smallPatch.replace('index ', 'GIT binary patch\nindex ') },
    { name: 'old count too small', text: smallPatch.replace('-1,3', '-1,2') },
    { name: 'old count too large', text: smallPatch.replace('-1,3', '-1,4') },
    { name: 'new count too small', text: smallPatch.replace('+1,3', '+1,2') },
    { name: 'new count too large', text: smallPatch.replace('+1,3', '+1,4') },
    { name: 'old coordinate mismatch', text: smallPatch.replace('-1,3', '-2,3') },
    { name: 'new coordinate mismatch', text: smallPatch.replace('+1,3', '+2,3') },
    { name: 'zero count', text: smallPatch.replace('-1,3', '-1,0') },
    { name: 'zero start', text: smallPatch.replace('-1,3', '-0,3') },
    { name: 'omitted count', text: smallPatch.replace('-1,3', '-1') },
    { name: 'unsafe start', text: smallPatch.replace('-1,3', '-9007199254740992,3') },
    { name: 'unsafe count', text: smallPatch.replace('+1,3', '+1,9007199254740992') },
    { name: 'range sum overflow', text: smallPatch.replace('-1,3', '-9007199254740991,3') },
    { name: 'unknown suffix', text: smallPatch.replace(' @@\n', ' @@ unknown\n') },
    { name: 'unprefixed context', text: smallPatch.replace(' head\n', 'head\n') },
    { name: 'different context', text: smallPatch.replace(' head\n', ' HEAD\n') },
    { name: 'different deletion', text: smallPatch.replace('-old\n', '-OLD\n') },
    {
      name: 'second-file context mismatch',
      text: section(jsonPath) + section(markdownPath).replace(' end\n', ' END\n'),
    },
    {
      name: 'overlapping hunks',
      text:
        section(jsonPath, '@@ -1,3 +1,3 @@\n head\n-old\n+new\n end\n@@ -2,1 +2,1 @@\n old\n') +
        section(markdownPath),
    },
    {
      name: 'out-of-order hunks',
      text:
        section(jsonPath, '@@ -2,2 +2,2 @@\n-old\n+new\n end\n@@ -1,1 +1,1 @@\n head\n') +
        section(markdownPath),
    },
    {
      name: 'second-hunk coordinate gap',
      text:
        section(jsonPath, '@@ -1,3 +1,3 @@\n head\n-old\n+new\n end\n@@ -4,1 +5,1 @@\n tail\n') +
        section(markdownPath),
    },
    {
      name: 'no context',
      text: section(jsonPath, '@@ -2,1 +2,1 @@\n-old\n+new\n') + section(markdownPath),
    },
    { name: 'no hunks', text: section(jsonPath, '') + section(markdownPath) },
  ];
  it.each(malformed)('rejects $name without changing either input or patch', ({ text }) => {
    const before = smallBefore(),
      inputSeals = digests(before),
      patch = Buffer.from(text),
      patchSeal = digest(patch);
    expect(() => applyFixtureAtlasPatch(before, patch, false)).toThrow(/fixture Atlas/);
    expect(digests(before)).toEqual(inputSeals);
    expect(digest(patch)).toBe(patchSeal);
  });

  it.each([
    '../escape.json',
    '/absolute.json',
    'C:/absolute.json',
    `${jsonPath}:alternate-stream`,
    jsonPath.toUpperCase(),
    jsonPath.replaceAll('/', '\\'),
  ])('rejects every header for unsupported path %s', (path) => {
    const patch = Buffer.from(smallPatch.replaceAll(`artifacts/${jsonPath}`, path));
    expect(() => applyFixtureAtlasPatch(smallBefore(), patch, false)).toThrow(/fixture Atlas/);
  });

  it.each(['head\r\nold\r\nend\r\n', 'head\nold\nend', 'head\nold\0\nend\n', ''])(
    'rejects invalid source bytes in the second file: %j',
    (text) => {
      const before = { ...smallBefore(), [markdownPath]: Buffer.from(text) };
      const inputSeals = digests(before);
      expect(() => applyFixtureAtlasPatch(before, Buffer.from(smallPatch), false)).toThrow(
        /fixture Atlas/,
      );
      expect(digests(before)).toEqual(inputSeals);
    },
  );

  it('requires the exact two input keys and an actual boolean direction', () => {
    const before = smallBefore(),
      patch = Buffer.from(smallPatch);
    const extra = { ...before, extra: Buffer.from('extra\n') };
    expect(() => applyFixtureAtlasPatch(extra, patch, false)).toThrow(/fixture Atlas/);
    const missing = { [jsonPath]: before[jsonPath] } as FixtureAtlasBytes;
    expect(() => applyFixtureAtlasPatch(missing, patch, false)).toThrow(/fixture Atlas/);
    expect(() => applyFixtureAtlasPatch(before, patch, 1 as unknown as boolean)).toThrow(
      /fixture Atlas/,
    );
  });

  it.each([false, true])('never searches for relocated context, reverse=%s', (reverse) => {
    const before = pair(reverse ? 'prefix\nhead\nnew\nend\n' : 'prefix\nhead\nold\nend\n');
    const originalSeals = digests(before);
    expect(() => applyFixtureAtlasPatch(before, Buffer.from(smallPatch), reverse)).toThrow(
      /fixture Atlas/,
    );
    expect(digests(before)).toEqual(originalSeals);
  });
});

describe('guarded fixture Atlas files', () => {
  it('writes both verified buffers and reads the exact bytes back', () => {
    withTemporaryRoot((directory) => {
      const root = join(directory, 'project');
      install(root, smallBefore());
      const after = smallAfter();
      writeFixtureAtlas(root, after, digests(after));
      expectBytes(readFixtureAtlas(root), after);
    });
  });

  it('does not write the first file when applying the second patch file fails', () => {
    withTemporaryRoot((directory) => {
      const root = join(directory, 'project'),
        before = smallBefore();
      install(root, before);
      const patch = Buffer.from(
        section(jsonPath) + section(markdownPath).replace('-old\n', '-wrong\n'),
      );
      expect(() => {
        const after = applyFixtureAtlasPatch(readFixtureAtlas(root), patch, false);
        writeFixtureAtlas(root, after, digests(smallAfter()));
      }).toThrow(/fixture Atlas/);
      expectBytes(rawRead(root), before);
    });
  });

  it.each([
    'second seal differs',
    'second seal malformed',
    'missing seal',
    'extra seal',
    'missing bytes',
    'extra bytes',
  ])('preserves both files when %s', (fault) => {
    withTemporaryRoot((directory) => {
      const root = join(directory, 'project'),
        before = smallBefore(),
        after: Record<string, Buffer> = smallAfter(),
        seals = digests(smallAfter());
      install(root, before);
      if (fault === 'second seal differs') seals[markdownPath] = '0'.repeat(64);
      if (fault === 'second seal malformed') seals[markdownPath] = 'invalid';
      if (fault === 'missing seal') delete seals[markdownPath];
      if (fault === 'extra seal') seals['extra'] = '0'.repeat(64);
      if (fault === 'missing bytes') delete after[markdownPath];
      if (fault === 'extra bytes') after['extra'] = Buffer.from('extra\n');
      expect(() => writeFixtureAtlas(root, after as FixtureAtlasBytes, seals)).toThrow(
        /fixture Atlas/,
      );
      expectBytes(rawRead(root), before);
    });
  });

  it.each(['missing', 'directory'])(
    'rejects a %s second target before changing the first',
    (kind) => {
      withTemporaryRoot((directory) => {
        const root = join(directory, 'project'),
          before = smallBefore(),
          after = smallAfter();
        install(root, before);
        const second = join(root, 'artifacts', markdownPath);
        unlinkSync(second);
        if (kind === 'directory') mkdirSync(second);
        expect(() => readFixtureAtlas(root)).toThrow();
        expect(() => writeFixtureAtlas(root, after, digests(after))).toThrow();
        expect(readFileSync(join(root, 'artifacts', jsonPath)).equals(before[jsonPath])).toBe(true);
      });
    },
  );

  // These are mandatory real junctions, including both file positions. They exercise
  // the common isSymbolicLink guard; no actual file-symlink coverage is claimed on
  // Windows installations where creating file symlinks requires extra privileges.
  it.each(['root', 'artifacts', 'atlas', 'json', 'markdown'] as const)(
    'rejects a real junction at %s and preserves external bytes',
    (slot) => {
      withTemporaryRoot((directory) => {
        const root = join(directory, 'project'),
          outside = join(directory, 'outside'),
          before = smallBefore(),
          after = smallAfter();
        install(root, before);
        const fileSlot = slot === 'json' ? jsonPath : slot === 'markdown' ? markdownPath : null;
        const target =
          fileSlot === null
            ? slot === 'root'
              ? root
              : join(root, slot === 'artifacts' ? 'artifacts' : 'artifacts/atlas')
            : join(root, 'artifacts', fileSlot);
        if (fileSlot === null) renameSync(target, outside);
        else {
          unlinkSync(target);
          mkdirSync(outside);
        }
        const sentinel = join(outside, 'external-sentinel');
        const sentinelBytes = Buffer.from('external bytes must remain unchanged\n');
        writeFileSync(sentinel, sentinelBytes);
        symlinkSync(outside, target, 'junction');
        try {
          expect(lstatSync(target).isSymbolicLink()).toBe(true);
          expect(() => readFixtureAtlas(root)).toThrow(/fixture Atlas/);
          expect(() => writeFixtureAtlas(root, after, digests(after))).toThrow(/fixture Atlas/);
          for (const path of FIXTURE_ATLAS_PATHS) {
            if (path !== fileSlot)
              expect(readFileSync(join(root, 'artifacts', path)).equals(before[path])).toBe(true);
          }
          expect(readFileSync(sentinel).equals(sentinelBytes)).toBe(true);
        } finally {
          // Remove only the link before recursive cleanup of this owned temporary root.
          assert(lstatSync(target).isSymbolicLink());
          unlinkSync(target);
        }
        expect(readFileSync(sentinel).equals(sentinelBytes)).toBe(true);
      });
    },
  );

  it.each(FIXTURE_ATLAS_PATHS)(
    'rejects a real hardlink at %s before writing either file',
    (path) => {
      withTemporaryRoot((directory) => {
        const root = join(directory, 'project'),
          outside = join(directory, 'outside-sentinel'),
          before = smallBefore(),
          after = smallAfter();
        install(root, before);
        writeFileSync(outside, before[path]);
        const target = join(root, 'artifacts', path);
        unlinkSync(target);
        linkSync(outside, target);
        expect(lstatSync(target).isFile()).toBe(true);
        expect(lstatSync(target).nlink).toBe(2);
        expect(() => readFixtureAtlas(root)).toThrow(/fixture Atlas/);
        expect(() => writeFixtureAtlas(root, after, digests(after))).toThrow(/fixture Atlas/);
        expectBytes(rawRead(root), before);
        expect(readFileSync(outside).equals(before[path])).toBe(true);
      });
    },
  );

  it('resolves a legitimate ancestor junction without allowing links inside the fixture', () => {
    withTemporaryRoot((directory) => {
      const canonical = join(directory, 'canonical'),
        alias = join(directory, 'ancestor-alias'),
        root = join(canonical, 'project'),
        before = smallBefore(),
        after = smallAfter();
      install(root, before);
      symlinkSync(canonical, alias, 'junction');
      try {
        expectBytes(readFixtureAtlas(join(alias, 'project')), before);
        writeFixtureAtlas(join(alias, 'project'), after, digests(after));
        expectBytes(rawRead(root), after);
      } finally {
        assert(lstatSync(alias).isSymbolicLink());
        unlinkSync(alias);
      }
    });
  });

  it('retains seals and guards across cold, intermediate and warm release paths', () => {
    withTemporaryRoot((directory) => {
      const first = join(directory, 'first'),
        second = join(directory, 'second'),
        current = sealedInput(5);
      install(first, current);
      install(second, current);
      applyBaselineFixtureRelease(first, 'B4');
      expectSealed(rawRead(first), 4);
      // B4 is cached; the second root still starts at B5 and reaches uncached B3.
      applyBaselineFixtureRelease(second, 'B3');
      expectSealed(rawRead(second), 3);
      expect(
        readFileSync(join(second, 'artifacts/CHECKSUMS.sha256')).equals(
          baselineFixtureManifest('B3'),
        ),
      ).toBe(true);
      applyBaselineFixtureRelease(second, 'B5');
      expectSealed(rawRead(second), 5);
      for (const [path, seal] of Object.entries(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts))
        expect(digest(readFileSync(join(second, 'artifacts', path)))).toBe(seal);
      const before = rawRead(second),
        manifest = readFileSync(join(second, 'artifacts/CHECKSUMS.sha256')),
        external = join(directory, 'outside-sentinel'),
        target = join(second, 'artifacts', markdownPath);
      writeFileSync(external, before[markdownPath]);
      unlinkSync(target);
      linkSync(external, target);
      expect(() => applyBaselineFixtureRelease(second, 'B3')).toThrow(/fixture Atlas/);
      expectBytes(rawRead(second), before);
      expect(readFileSync(external).equals(before[markdownPath])).toBe(true);
      expect(readFileSync(join(second, 'artifacts/CHECKSUMS.sha256')).equals(manifest)).toBe(true);
    });
  });
});
