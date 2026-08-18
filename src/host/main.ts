import { fileURLToPath } from 'node:url';

import { hostEntryConfigFromEnvironment, startHostApplication } from './entry-point.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;

async function main(): Promise<void> {
  const config = hostEntryConfigFromEnvironment(process.env, PROJECT_ROOT);
  const running = await startHostApplication(config);
  console.log(`Symbiosis V7 host listening at ${running.address}`);

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      console.log(`Symbiosis V7 host received ${signal}; closing`);
      void running.close().catch((error: unknown) => {
        console.error('Symbiosis V7 host shutdown failed', error);
        process.exitCode = 1;
      });
    });
  }
}

void main().catch((error: unknown) => {
  console.error('Symbiosis V7 host failed to start', error);
  process.exitCode = 1;
});
