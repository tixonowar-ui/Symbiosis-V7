import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Browser } from '@playwright/test';
import {
  createCreationFinalizationSetup,
  creationFinalSaveRequest,
  creationPropertySummaryRequest,
} from './creation-finalization-stage.js';
import { commitCreationFinalization } from '../../src/host/creation-finalization.js';
import { loadNetworkApplicationConfig } from '../../src/host/network-application-config.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
interface Ready {
  readonly kind: 'READY';
  readonly address: string;
  readonly deviceId: string;
  readonly pid: number;
}

/** Each side executes the normal application entry point in its own Node process and disk DB. */
export async function createNetworkBrowserProcess(finalCount: number) {
  const config = await loadNetworkApplicationConfig(ROOT);
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-network-e2e-'));
  const databasePath = join(directory, 'symbiosis-v7.sqlite');
  const sourceIds: string[] = [];
  let child: ChildProcess | undefined, ready: Ready | undefined;
  let port = 0;
  const errors: string[] = [];
  const start = async () => {
    const environment = { ...process.env };
    delete environment['FORCE_COLOR'];
    const next = fork(
      fileURLToPath(new URL('./network-application-process.ts', import.meta.url)),
      [
        JSON.stringify({
          dataDirectory: directory,
          interface: '127.0.0.1',
          port,
          projectRoot: ROOT,
          staticRoot: join(ROOT, 'dist/web'),
        }),
      ],
      { execArgv: ['--import', 'tsx'], env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    child = next;
    next.stdout?.on('data', () => undefined);
    next.stderr?.on('data', (data: Buffer) => errors.push(data.toString('utf8')));
    next.on('error', (error) => errors.push(error.message));
    ready = await new Promise<Ready>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        next.off('error', failure);
        next.off('exit', exit);
        next.off('message', message);
      };
      const failure = (error: Error) => {
        cleanup();
        reject(error);
      };
      const exit = (code: number | null) =>
        failure(new Error(`Network host startup exited: ${String(code)}; ${errors.join('')}`));
      const message = (value: unknown) => {
        if (value === null || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        if (
          record['kind'] !== 'READY' ||
          typeof record['address'] !== 'string' ||
          typeof record['deviceId'] !== 'string' ||
          typeof record['pid'] !== 'number'
        )
          return;
        cleanup();
        resolve(value as Ready);
      };
      const timer = setTimeout(() => failure(new Error('Network host did not start')), 30_000);
      next.once('error', failure);
      next.once('exit', exit);
      next.on('message', message);
    });
    port = Number(new URL(ready.address).port);
  };
  const stop = async () => {
    const previous = child;
    if (previous === undefined) return;
    if (previous.exitCode !== null || previous.signalCode !== null) {
      if (previous.exitCode === 0) return;
      throw new Error(
        `Network host already exited ${String(previous.exitCode)}/${String(previous.signalCode)}`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new Error('Network host failed to release listeners on shutdown');
        previous.kill();
      }, 15_000);
      previous.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (failure !== undefined) reject(failure);
        else if (code === 0) resolve();
        else reject(new Error(`Network host shutdown exited ${String(code)}/${String(signal)}`));
      });
      if (!previous.connected) {
        failure = new Error('Network host IPC disconnected before shutdown');
        previous.kill();
        return;
      }
      previous.send('CLOSE', (error) => {
        if (error !== null) {
          failure = error;
          previous.kill();
        }
      });
    });
  };
  try {
    for (let index = 0; index < finalCount; index++) {
      const sourceUuid = randomUUID();
      const setup = await createCreationFinalizationSetup({
        prefix: `network-source-${String(index)}`,
        characterDraftId: sourceUuid,
        databasePath,
        raceChoice: 'FREE',
        diceInputMode: 'AUTO',
      });
      try {
        const summary = commitCreationFinalization(
          setup.setup.database,
          creationPropertySummaryRequest(setup.current, randomUUID()),
          randomUUID(),
          setup.dependencies,
        );
        commitCreationFinalization(
          setup.setup.database,
          creationFinalSaveRequest(summary, randomUUID()),
          randomUUID(),
          setup.dependencies,
        );
        sourceIds.push(sourceUuid);
      } finally {
        setup.setup.database.close();
      }
    }
    await start();
    return {
      sourceIds,
      errors,
      operationTimeoutMs: config.transfer.timeoutMs + config.channel.rpcTimeoutMs,
      get baseURL() {
        return ready!.address;
      },
      get deviceId() {
        return ready!.deviceId;
      },
      get pid() {
        return ready!.pid;
      },
      inspect() {
        const db = new Database(databasePath, { readonly: true, fileMustExist: true });
        try {
          const rows = (table: string) =>
            db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
          return {
            campaigns: rows('campaign'),
            checkpoints: rows('campaign_checkpoint'),
            sources: rows('local_character'),
            copies: rows('campaign_character_copy'),
            requests: rows('hosted_device_request'),
            decisions: rows('hosted_device_request_decision'),
            queueViews: rows('gm_request_queue_view'),
            sessions: rows('hosted_technical_session'),
            commands: rows('hosted_network_command'),
            outbox: rows('local_network_outbox'),
            tabs: rows('local_network_tab'),
          };
        } finally {
          db.close();
        }
      },
      async restart() {
        await stop();
        await start();
      },
      async close() {
        try {
          await stop();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await disposeNetworkResources(
      [stop, () => rm(directory, { recursive: true, force: true })],
      error,
    );
    throw error;
  }
}

async function disposeNetworkResources(
  resources: readonly (() => Promise<unknown>)[],
  originalError?: unknown,
) {
  const failures: unknown[] = [];
  for (const close of resources) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      originalError === undefined ? failures : [originalError, ...failures],
      'Network test resource cleanup failed',
    );
}

export async function createNetworkBrowserScenario(browser: Browser, finalCount: number) {
  const resources: (() => Promise<unknown>)[] = [];
  try {
    const gm = await createNetworkBrowserProcess(0);
    resources.unshift(() => gm.close());
    const player = await createNetworkBrowserProcess(finalCount);
    resources.unshift(() => player.close());
    const masterContext = await browser.newContext();
    resources.unshift(() => masterContext.close());
    const playerContext = await browser.newContext();
    resources.unshift(() => playerContext.close());
    const masterPage = await masterContext.newPage(),
      playerPage = await playerContext.newPage();
    return {
      gm,
      player,
      masterPage,
      playerPage,
      close: (originalError?: unknown) => disposeNetworkResources(resources, originalError),
    };
  } catch (error) {
    await disposeNetworkResources(resources, error);
    throw error;
  }
}

export function safeNetworkInspection(
  process: Awaited<ReturnType<typeof createNetworkBrowserProcess>>,
) {
  const keys = [
    'campaign_id',
    'local_character_id',
    'campaign_character_id',
    'request_id',
    'technical_session_id',
    'command_id',
    'tab_id',
    'network_scope_id',
    'retirement_command_id',
    'lifecycle_state',
    'closed',
    'acknowledged',
    'operation',
  ];
  const state = process.inspect();
  return Object.fromEntries(
    Object.entries(state).map(([table, rows]) => [
      table,
      rows.map((row) => ({
        ...Object.fromEntries(
          keys
            .filter((key) => typeof row[key] === 'string' || typeof row[key] === 'number')
            .map((key) => [key, row[key]]),
        ),
        sha256: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
      })),
    ]),
  );
}
