/**
 * artifacts/ → generated/
 *
 *   npm run import
 *
 * Order matters. The checksum gate runs before a single artifact byte is read:
 * importing from a drifted source would produce a `generated/` that looks valid
 * and is not. Everything downstream fails closed — see tools/import/lib/fail.ts.
 */
import { describeFailure, verify } from '../checksums/manifest.js';
import { importAtlas } from './atlas.js';
import { ImportError } from './lib/fail.js';

async function gate(): Promise<void> {
  const result = await verify();
  const failure = describeFailure(result);
  if (failure !== null) {
    console.error(failure);
    throw new ImportError('checksums', 'artifacts/ failed verification; import aborted');
  }
  console.log(`checksums: OK, ${result.tracked} artifact(s) verified`);
}

async function main(): Promise<number> {
  await gate();

  const atlas = await importAtlas();
  console.log(`atlas:     ${String(atlas.formIds.length)} forms`);
  for (const file of atlas.files) {
    console.log(`           ${file}`);
  }

  const kib = (atlas.bytesWritten / 1024).toFixed(1);
  console.log(`written:   ${kib} KiB across ${String(atlas.files.length)} file(s)`);
  return 0;
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof ImportError) {
    console.error(`\nimport failed — ${error.message}`);
    process.exit(1);
  }
  throw error;
}
