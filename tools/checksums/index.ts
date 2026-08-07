/**
 * CLI over ./manifest.ts.
 *
 *   npm run checksums          rewrite artifacts/CHECKSUMS.sha256
 *   npm run checksums:verify   check every file against it, non-zero exit on drift
 */
import { describeFailure, verify, write } from './manifest.js';

async function runVerify(): Promise<number> {
  const result = await verify();
  const failure = describeFailure(result);
  if (failure !== null) {
    console.error(failure);
    return 1;
  }
  console.log(`CHECKSUMS.sha256: OK, ${result.tracked} file(s) verified`);
  return 0;
}

const command = process.argv[2];
const action = command === 'write' ? write : command === 'verify' ? runVerify : null;

if (!action) {
  console.error('usage: tsx tools/checksums/index.ts <write|verify>');
  process.exit(2);
}

process.exit(await action());
