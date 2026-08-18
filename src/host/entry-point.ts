import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { bootstrapDeviceIdentity, openPersistenceDatabase } from '../persistence/index.js';
import type { DeviceId } from '../persistence/index.js';
import { createHost, startHost } from './server.js';
import { createShellRevisionTracker } from './shell-revisions.js';

const HOST_INTERFACE_CONFIG = 'npm_package_config_host_interface';
const HOST_PORT_CONFIG = 'npm_package_config_host_port';
const LOCAL_DATA_DIRECTORY_NAME = 'Symbiosis V7';
const DATABASE_FILENAME = 'symbiosis-v7.sqlite';

export interface HostEntryConfig {
  readonly dataDirectory: string;
  readonly interface: string;
  readonly port: number;
  readonly projectRoot: string;
  readonly staticRoot: string;
}

export interface HostEntryDependencies {
  readonly allocateId: () => string;
  readonly bootstrapDeviceIdentity: typeof bootstrapDeviceIdentity;
  readonly createHost: typeof createHost;
  readonly onFrameError: (error: unknown) => void;
  readonly openPersistenceDatabase: typeof openPersistenceDatabase;
  readonly startHost: typeof startHost;
}

export interface RunningHost {
  readonly address: string;
  readonly close: () => Promise<void>;
  readonly deviceId: DeviceId;
}

const DEFAULT_DEPENDENCIES: HostEntryDependencies = {
  allocateId: randomUUID,
  bootstrapDeviceIdentity,
  createHost,
  onFrameError: (error) => console.error('host frame processing failed', error),
  openPersistenceDatabase,
  startHost,
};

function configuredString(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be configured as a non-empty string without outer whitespace`);
  }
  return value;
}

function configuredPort(environment: NodeJS.ProcessEnv): number {
  const source = configuredString(environment, HOST_PORT_CONFIG);
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(source)) {
    throw new Error(`${HOST_PORT_CONFIG} must be a decimal integer from 0 through 65535`);
  }
  const port = Number(source);
  if (port > 65_535) {
    throw new Error(`${HOST_PORT_CONFIG} must be a decimal integer from 0 through 65535`);
  }
  return port;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  );
}

export function hostEntryConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
  projectRoot: string,
): HostEntryConfig {
  const resolvedProjectRoot = resolve(projectRoot);
  const localAppData = configuredString(environment, 'LOCALAPPDATA');
  if (!isAbsolute(localAppData)) {
    throw new Error(`LOCALAPPDATA must be an absolute path, got ${JSON.stringify(localAppData)}`);
  }
  const dataDirectory = resolve(localAppData, LOCAL_DATA_DIRECTORY_NAME);
  if (isWithin(resolvedProjectRoot, dataDirectory)) {
    throw new Error(
      `local data directory ${JSON.stringify(dataDirectory)} must be outside the project root`,
    );
  }

  return {
    dataDirectory,
    interface: configuredString(environment, HOST_INTERFACE_CONFIG),
    port: configuredPort(environment),
    projectRoot: resolvedProjectRoot,
    staticRoot: join(resolvedProjectRoot, 'dist', 'web'),
  };
}

async function requireWebBuild(staticRoot: string): Promise<void> {
  const indexPath = join(staticRoot, 'index.html');
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(indexPath);
  } catch (cause: unknown) {
    throw new Error(
      `web build is missing: expected ${JSON.stringify(indexPath)}; run npm run build before npm start`,
      { cause },
    );
  }
  if (!metadata.isFile()) {
    throw new Error(
      `web build is missing: expected ${JSON.stringify(indexPath)} to be a file; run npm run build before npm start`,
    );
  }
}

async function closeOwnedResources(
  app: Awaited<ReturnType<typeof createHost>> | undefined,
  database: ReturnType<typeof openPersistenceDatabase>,
): Promise<void> {
  try {
    if (app !== undefined) await app.close();
  } finally {
    database.close();
  }
}

export async function startHostApplication(
  config: HostEntryConfig,
  dependencies: HostEntryDependencies = DEFAULT_DEPENDENCIES,
): Promise<RunningHost> {
  await requireWebBuild(config.staticRoot);
  await mkdir(config.dataDirectory, { recursive: true });
  const database = dependencies.openPersistenceDatabase(
    join(config.dataDirectory, DATABASE_FILENAME),
  );
  let app: Awaited<ReturnType<typeof createHost>> | undefined;
  try {
    const deviceId = dependencies.bootstrapDeviceIdentity(database);
    const revisions = createShellRevisionTracker();
    app = await dependencies.createHost({
      advanceRevisions: revisions.advance,
      allocateContextId: dependencies.allocateId,
      allocateLocalCharacterId: dependencies.allocateId,
      allocateWizardCheckpointId: dependencies.allocateId,
      database,
      onFrameError: dependencies.onFrameError,
      projectRoot: config.projectRoot,
      readRevisions: revisions.read,
      staticRoot: config.staticRoot,
    });
    const address = await dependencies.startHost(app, {
      interface: config.interface,
      port: config.port,
    });
    let closePromise: Promise<void> | undefined;
    return {
      address,
      close: () => (closePromise ??= closeOwnedResources(app, database)),
      deviceId,
    };
  } catch (error: unknown) {
    await closeOwnedResources(app, database);
    throw error;
  }
}
