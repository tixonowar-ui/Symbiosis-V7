import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  bootstrapDeviceIdentity,
  loadDeviceId,
  openPersistenceDatabase,
} from '../persistence/index.js';
import { hostEntryConfigFromEnvironment, startHostApplication } from './entry-point.js';
import type { HostEntryConfig, HostEntryDependencies } from './entry-point.js';
import { createHost, startHost } from './server.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const temporaryRoots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), label));
  temporaryRoots.push(root);
  return root;
}

async function builtHostConfig(): Promise<HostEntryConfig> {
  const root = await temporaryRoot('symbiosis-entry-');
  const staticRoot = join(root, 'web');
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, 'index.html'), '<main>built</main>', 'utf8');
  return {
    dataDirectory: join(root, 'data'),
    interface: '127.0.0.1',
    port: 0,
    projectRoot: PROJECT_ROOT,
    staticRoot,
  };
}

function dependencies(
  bootstrap: typeof bootstrapDeviceIdentity = bootstrapDeviceIdentity,
): HostEntryDependencies {
  return {
    allocateId: randomUUID,
    bootstrapDeviceIdentity: bootstrap,
    createHost,
    onFrameError: () => undefined,
    openPersistenceDatabase,
    startHost,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('host application entry point', () => {
  it('reads an explicit npm network configuration and stable LOCALAPPDATA carrier', async () => {
    const localAppData = await temporaryRoot('symbiosis-local-app-data-');
    const config = hostEntryConfigFromEnvironment(
      {
        LOCALAPPDATA: localAppData,
        npm_package_config_host_interface: '127.0.0.2',
        npm_package_config_host_port: '4123',
      },
      PROJECT_ROOT,
    );

    expect(config).toEqual({
      dataDirectory: join(localAppData, 'Symbiosis V7'),
      interface: '127.0.0.2',
      port: 4123,
      projectRoot: resolve(PROJECT_ROOT),
      staticRoot: join(PROJECT_ROOT, 'dist', 'web'),
    });
    expect(() =>
      hostEntryConfigFromEnvironment(
        {
          LOCALAPPDATA: localAppData,
          npm_package_config_host_interface: '127.0.0.1',
          npm_package_config_host_port: '4123suffix',
        },
        PROJECT_ROOT,
      ),
    ).toThrow(/decimal integer from 0 through 65535/);
    expect(() =>
      hostEntryConfigFromEnvironment(
        {
          LOCALAPPDATA: PROJECT_ROOT,
          npm_package_config_host_interface: '127.0.0.1',
          npm_package_config_host_port: '3000',
        },
        PROJECT_ROOT,
      ),
    ).toThrow(/must be outside the project root/);
  });

  it('exports database opening and migration application through the persistence barrel', () => {
    expect(openPersistenceDatabase).toBeTypeOf('function');
    expect(applyMigrations).toBeTypeOf('function');
  });

  it('refuses a missing web build before creating local data or opening SQLite', async () => {
    const root = await temporaryRoot('symbiosis-missing-build-');
    const dataDirectory = join(root, 'data');
    let databaseOpens = 0;
    const configuredDependencies: HostEntryDependencies = {
      ...dependencies(),
      openPersistenceDatabase: (filename) => {
        databaseOpens += 1;
        return openPersistenceDatabase(filename);
      },
    };

    await expect(
      startHostApplication(
        {
          dataDirectory,
          interface: '127.0.0.1',
          port: 0,
          projectRoot: PROJECT_ROOT,
          staticRoot: join(root, 'missing-web'),
        },
        configuredDependencies,
      ),
    ).rejects.toThrow(/web build is missing.*run npm run build before npm start/);
    expect(databaseOpens).toBe(0);
    await expect(access(dataDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bootstraps once per start and preserves device identity in one stable database', async () => {
    const config = await builtHostConfig();
    let bootstrapCalls = 0;
    const configuredDependencies = dependencies((database) => {
      bootstrapCalls += 1;
      return bootstrapDeviceIdentity(database);
    });

    const first = await startHostApplication(config, configuredDependencies);
    expect(first.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    await first.close();
    await first.close();

    const second = await startHostApplication(config, configuredDependencies);
    expect(second.deviceId).toBe(first.deviceId);
    await second.close();
    expect(bootstrapCalls).toBe(2);

    const database = openPersistenceDatabase(join(config.dataDirectory, 'symbiosis-v7.sqlite'));
    try {
      expect(loadDeviceId(database)).toBe(first.deviceId);
    } finally {
      database.close();
    }
  });

  it('closes the opened database when listening fails', async () => {
    const config = await builtHostConfig();
    let openedDatabase: ReturnType<typeof openPersistenceDatabase> | undefined;
    const configuredDependencies: HostEntryDependencies = {
      ...dependencies(),
      openPersistenceDatabase: (filename) => {
        openedDatabase = openPersistenceDatabase(filename);
        return openedDatabase;
      },
      startHost: () => Promise.reject(new Error('listen failed for test')),
    };

    await expect(startHostApplication(config, configuredDependencies)).rejects.toThrow(
      /listen failed for test/,
    );
    if (openedDatabase === undefined) throw new Error('test did not observe an opened database');
    expect(openedDatabase.open).toBe(false);
  });
});
