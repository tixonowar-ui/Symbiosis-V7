import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCoverage, loadCatalog, renderReport, scanRepository } from './traceability.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT = join(REPO_ROOT, 'docs', 'TRACEABILITY.md');

function commitDate(): string {
  const value = execFileSync('git', ['log', '-1', '--format=%cs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`git returned an invalid commit date: ${JSON.stringify(value)}`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.length > 1) {
    throw new Error('usage: npm run traceability [-- --check]');
  }

  const catalog = loadCatalog(join(REPO_ROOT, 'generated', 'spec'));
  const scans = scanRepository(REPO_ROOT);
  const model = buildCoverage(catalog, scans.implementation, scans.tests, scans.source);
  const report = await renderReport(model, commitDate());

  if (args[0] === '--check') {
    if (readFileSync(OUTPUT, 'utf8') !== report) {
      throw new Error('docs/TRACEABILITY.md is stale; run npm run traceability');
    }
    if (model.discrepancies.length > 0) {
      throw new Error('docs/TRACEABILITY.md contains source/spec discrepancies');
    }
    console.log('traceability matrix is current');
    return;
  }

  writeFileSync(OUTPUT, report, 'utf8');
  console.log('wrote docs/TRACEABILITY.md');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
