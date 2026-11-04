import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const FIXTURE_ATLAS_PATHS = Object.freeze([
  'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json',
  'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md',
] as const);
export type FixtureAtlasBytes = Record<(typeof FIXTURE_ATLAS_PATHS)[number], Buffer>;
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const samePath = (left: string, right: string): boolean =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

function atlasTargets(projectRoot: string): Record<(typeof FIXTURE_ATLAS_PATHS)[number], string> {
  const root = resolve(projectRoot);
  const rootStat = lstatSync(root);
  assert(!rootStat.isSymbolicLink(), 'fixture Atlas root must not be a link');
  assert(rootStat.isDirectory(), 'fixture Atlas root must be a directory');
  const canonicalRoot = realpathSync(root);
  for (const relative of ['artifacts', 'artifacts/atlas']) {
    const directory = join(root, relative),
      stat = lstatSync(directory);
    assert(!stat.isSymbolicLink(), `fixture Atlas directory must not be a link: ${relative}`);
    assert(stat.isDirectory(), `fixture Atlas directory is not a directory: ${relative}`);
    assert(
      samePath(realpathSync(directory), join(canonicalRoot, relative)),
      `fixture Atlas directory escapes its root: ${relative}`,
    );
  }
  return Object.fromEntries(
    FIXTURE_ATLAS_PATHS.map((file) => {
      const target = join(root, 'artifacts', file),
        stat = lstatSync(target);
      // A junction must hit this branch even when installed at a file position.
      assert(!stat.isSymbolicLink(), `fixture Atlas target must not be a link: ${file}`);
      assert(stat.isFile(), `fixture Atlas target must be a regular file: ${file}`);
      assert.equal(stat.nlink, 1, `fixture Atlas target must have one link: ${file}`);
      assert(
        samePath(realpathSync(target), join(canonicalRoot, 'artifacts', file)),
        `fixture Atlas target escapes its root: ${file}`,
      );
      return [file, target];
    }),
  ) as Record<(typeof FIXTURE_ATLAS_PATHS)[number], string>;
}

function atlasKeys(value: Readonly<Record<string, unknown>>): void {
  assert.deepEqual(
    Object.keys(value).sort(),
    [...FIXTURE_ATLAS_PATHS].sort(),
    'fixture Atlas requires exactly two fixed paths',
  );
}

export function readFixtureAtlas(projectRoot: string): FixtureAtlasBytes {
  const targets = atlasTargets(projectRoot);
  return Object.fromEntries(
    FIXTURE_ATLAS_PATHS.map((file) => [file, readFileSync(targets[file])]),
  ) as FixtureAtlasBytes;
}

export function writeFixtureAtlas(
  projectRoot: string,
  bytes: FixtureAtlasBytes,
  expected: Readonly<Record<string, string>>,
): void {
  const targets = atlasTargets(projectRoot);
  atlasKeys(bytes);
  atlasKeys(expected);
  for (const file of FIXTURE_ATLAS_PATHS) {
    assert(Buffer.isBuffer(bytes[file]), `fixture Atlas bytes are not a Buffer: ${file}`);
    const seal = expected[file];
    assert(
      typeof seal === 'string' && /^[a-f0-9]{64}$/u.test(seal),
      `fixture Atlas seal is invalid: ${file}`,
    );
    assert.equal(digest(bytes[file]), seal, `fixture Atlas output differs from its seal: ${file}`);
  }
  // Both path guards and both seals precede any write. This is not an I/O transaction.
  for (const file of FIXTURE_ATLAS_PATHS) writeFileSync(targets[file], bytes[file]);
}

function lfBytes(bytes: Buffer, label: string): void {
  assert(
    Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.at(-1) === 10,
    `${label} requires a final LF`,
  );
  assert(!bytes.includes(13) && !bytes.includes(0), `${label} does not support CR or NUL`);
}

/** Only the five reviewed fixture patches' two-file LF grammar, without fuzzy matching. */
export function applyFixtureAtlasPatch(
  before: FixtureAtlasBytes,
  patch: Buffer,
  reverse: boolean,
): FixtureAtlasBytes {
  atlasKeys(before);
  lfBytes(patch, 'fixture Atlas patch');
  assert.equal(typeof reverse, 'boolean', 'fixture Atlas direction must be boolean');
  let cursor = 0;
  const line = (): { body: Buffer; raw: Buffer } => {
    assert(cursor < patch.length, 'fixture Atlas patch ended before its grammar was complete');
    const end = patch.indexOf(10, cursor);
    assert(end >= cursor, 'fixture Atlas patch has an unterminated line');
    const value = { body: patch.subarray(cursor, end), raw: patch.subarray(cursor, end + 1) };
    cursor = end + 1;
    return value;
  };
  const expectLine = (expected: string): void => {
    assert.equal(
      line().body.toString('utf8'),
      expected,
      `fixture Atlas patch header must be ${expected}`,
    );
  };
  const result = {} as FixtureAtlasBytes;
  for (const file of FIXTURE_ATLAS_PATHS) {
    const input = before[file];
    lfBytes(input, `fixture Atlas input ${file}`);
    expectLine(`diff --git a/artifacts/${file} b/artifacts/${file}`);
    assert.match(
      line().body.toString('utf8'),
      /^index [a-f0-9]{7}\.\.[a-f0-9]{7} 100644$/u,
      'fixture Atlas patch has unsupported index or mode',
    );
    expectLine(`--- a/artifacts/${file}`);
    expectLine(`+++ b/artifacts/${file}`);
    const chunks: Buffer[] = [];
    let inputOffset = 0,
      inputLine = 1,
      outputLine = 1,
      outputBytes = 0,
      hunks = 0;
    const append = (bytes: Buffer): void => {
      outputBytes += bytes.length;
      assert(Number.isSafeInteger(outputBytes), 'fixture Atlas output length overflow');
      chunks.push(bytes);
    };
    const inputEnd = (): number => {
      const end = input.indexOf(10, inputOffset);
      assert(end >= inputOffset, `fixture Atlas patch exceeds input at ${file}:${inputLine}`);
      return end + 1;
    };
    while (cursor < patch.length && patch[cursor] === 64) {
      const header = line().body.toString('utf8');
      const match =
        /^@@ -([1-9]\d*),([1-9]\d*) \+([1-9]\d*),([1-9]\d*) @@(?: stateDiagram-v2)?$/u.exec(header);
      assert(match, `fixture Atlas patch has unsupported hunk header: ${header}`);
      const ranges = match.slice(1).map(Number);
      assert(ranges.every(Number.isSafeInteger), 'fixture Atlas hunk range is not a safe integer');
      const [oldStart, oldCount, newStart, newCount] = ranges as [number, number, number, number];
      assert(
        Number.isSafeInteger(oldStart + oldCount) && Number.isSafeInteger(newStart + newCount),
        'fixture Atlas hunk range overflow',
      );
      const [fromStart, fromCount, toStart, toCount]: [number, number, number, number] = reverse
        ? [newStart, newCount, oldStart, oldCount]
        : [oldStart, oldCount, newStart, newCount];
      assert(fromStart >= inputLine, `fixture Atlas hunks overlap or are out of order: ${file}`);
      const gap = fromStart - inputLine;
      assert.equal(toStart - outputLine, gap, `fixture Atlas hunk coordinates disagree: ${file}`);
      const gapStart = inputOffset;
      for (let remaining = gap; remaining > 0; remaining--) inputOffset = inputEnd();
      append(input.subarray(gapStart, inputOffset));
      inputLine += gap;
      outputLine += gap;
      let consumed = 0,
        produced = 0,
        context = 0;
      while (consumed < fromCount || produced < toCount) {
        const value = line(),
          prefix = value.body[0];
        // Three supplied Markdown patches use bare LF as exact empty context.
        const isContext = value.body.length === 0 || prefix === 32;
        assert(
          isContext || prefix === 43 || prefix === 45,
          `fixture Atlas patch has unsupported hunk content: ${file}`,
        );
        const payload = value.body.length === 0 ? value.raw : value.raw.subarray(1);
        const takesInput = isContext || prefix === (reverse ? 43 : 45);
        const givesOutput = isContext || prefix === (reverse ? 45 : 43);
        if (takesInput) {
          const end = inputEnd();
          assert(
            input.subarray(inputOffset, end).equals(payload),
            `fixture Atlas patch context or deletion mismatch at ${file}:${inputLine}`,
          );
          inputOffset = end;
          inputLine++;
          consumed++;
        }
        if (givesOutput) {
          append(payload);
          outputLine++;
          produced++;
        }
        if (isContext) context++;
        assert(
          consumed <= fromCount && produced <= toCount,
          `fixture Atlas hunk counts disagree: ${file}`,
        );
      }
      assert(context > 0, `fixture Atlas hunk has no context: ${file}`);
      hunks++;
    }
    assert(hunks > 0, `fixture Atlas patch has no hunks: ${file}`);
    append(input.subarray(inputOffset));
    // concat copies even unchanged slices: callers cannot mutate input or patch via output.
    result[file] = Buffer.concat(chunks, outputBytes);
  }
  assert.equal(cursor, patch.length, 'fixture Atlas patch has trailing or extra file content');
  return result;
}
