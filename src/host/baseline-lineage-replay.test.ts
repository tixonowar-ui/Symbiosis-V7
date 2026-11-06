import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createBaselineLineageFixture,
  BASELINE_FIXTURE_IDS,
} from '../../tests/fixtures/baseline-lineage.js';

const run = promisify(execFile);
it.each([
  ['B0', 'B1'],
  ['B0', 'B2'],
  ['B1', 'B2'],
  ['B0', 'B3'],
  ['B1', 'B3'],
  ['B2', 'B3'],
  ['B0', 'B4'],
  ['B1', 'B4'],
  ['B2', 'B4'],
  ['B3', 'B4'],
  ['B0', 'B5'],
  ['B1', 'B5'],
  ['B2', 'B5'],
  ['B3', 'B5'],
  ['B4', 'B5'],
  ['B5', 'B6'],
  ['B6', 'B7'],
  ['B7', 'B8'],
  ['B8', 'B9'],
  ['B9', 'B10'],
  ['B10', 'B11'],
  ['B11', 'B12'],
] as const)(
  'reopens actual %s FINAL/DRAFT, archive and export/candidate bytes under %s in a fresh Node process',
  async (sourceRelease, targetRelease) => {
    const fixture = createBaselineLineageFixture(sourceRelease);
    const probe = fileURLToPath(
      new URL('../../tests/fixtures/baseline-lineage-probe.ts', import.meta.url),
    );
    const phase = (name: string) =>
      run(
        process.execPath,
        ['--import', 'tsx', probe, name, fixture.directory, sourceRelease, targetRelease],
        {
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
        },
      );
    try {
      const old = JSON.parse((await phase('create-old')).stdout) as {
        baselineVersion: string;
        pid: number;
      };
      expect(old.baselineVersion).toBe(BASELINE_FIXTURE_IDS[sourceRelease]);
      fixture.apply(targetRelease);
      const next = JSON.parse((await phase('verify-new')).stdout) as {
        baselineVersion: string;
        pid: number;
      };
      expect(next.baselineVersion).toBe(BASELINE_FIXTURE_IDS[targetRelease]);
      expect(next.pid).not.toBe(old.pid);
    } finally {
      fixture.close();
    }
  },
  60_000,
);
