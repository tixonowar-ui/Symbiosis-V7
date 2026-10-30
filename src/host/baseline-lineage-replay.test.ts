import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createBaselineLineageFixture,
  BASELINE_FIXTURE_IDS,
} from '../../tests/fixtures/baseline-lineage.js';

const run = promisify(execFile);
it('reopens actual B0 FINAL/DRAFT, archive and export/candidate bytes under B1 in a fresh Node process', async () => {
  const fixture = createBaselineLineageFixture();
  const probe = fileURLToPath(
    new URL('../../tests/fixtures/baseline-lineage-probe.ts', import.meta.url),
  );
  const phase = (name: string) =>
    run(process.execPath, ['--import', 'tsx', probe, name, fixture.directory], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  try {
    const old = JSON.parse((await phase('create-old')).stdout) as {
      baselineVersion: string;
      pid: number;
    };
    expect(old.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B0);
    fixture.apply('B1');
    const next = JSON.parse((await phase('verify-new')).stdout) as {
      baselineVersion: string;
      pid: number;
    };
    expect(next.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B1);
    expect(next.pid).not.toBe(old.pid);
  } finally {
    fixture.close();
  }
}, 60_000);
