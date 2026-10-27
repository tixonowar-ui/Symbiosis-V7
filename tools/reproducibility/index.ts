import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from '../checksums/manifest.js';
import { verifyReproducibility } from './snapshot.js';

let attempt = 0;
async function runImport(): Promise<void> {
  attempt += 1;
  console.log(`reproducibility: import ${String(attempt)}/2`);
  await new Promise<void>((resolve, reject) => {
    // Invoke Node directly so paths with spaces and Windows npm.cmd need no shell.
    const child = spawn(process.execPath, ['--import', 'tsx', 'tools/import/index.ts'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Import ${String(attempt)} failed (exit ${String(code)}, signal ${String(signal)})`,
          ),
        );
    });
  });
}

try {
  if (process.argv.length > 2) throw new Error('usage: npm run import:verify');
  const files = await verifyReproducibility(join(REPO_ROOT, 'generated'), runImport);
  console.log(
    `reproducibility: ${String(files)} files have identical paths and SHA-256 bytes across two imports (including media and seed)`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
