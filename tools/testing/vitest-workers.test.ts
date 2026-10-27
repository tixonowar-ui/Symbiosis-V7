import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createVitest } from 'vitest/node';
import type { PoolRunnerInitializer, PoolWorker, WorkerRequest, WorkerResponse } from 'vitest/node';

it('schedules every selected node/web suite within the measured Atlas memory budget', async () => {
  let active = 0;
  let peak = 0;
  const scheduled: string[] = [];

  // Exercise the real scheduler without starting a second memory-heavy test pool.
  // The real Atlas mutation tests still execute in the ordinary outer test run.
  class ProbeWorker extends EventEmitter implements PoolWorker {
    readonly name = 'worker-budget-probe';

    start(): Promise<void> {
      return Promise.resolve();
    }

    stop(): Promise<void> {
      return Promise.resolve();
    }

    deserialize(data: unknown): unknown {
      return data;
    }

    send(message: WorkerRequest): void {
      if (!message.__vitest_worker_request__) return;
      const reply = (type: WorkerResponse['type']): void => {
        this.emit('message', { __vitest_worker_response__: true, type });
      };
      if (message.type === 'start') reply('started');
      else if (message.type === 'stop') reply('stopped');
      else if (message.type === 'run') {
        scheduled.push(...message.context.files.map((file) => file.filepath));
        active += 1;
        peak = Math.max(peak, active);
        // Let every available scheduler slot start before releasing this one.
        setImmediate(() => {
          active -= 1;
          reply('testfileFinished');
        });
      }
    }
  }

  const probe: PoolRunnerInitializer = {
    name: 'worker-budget-probe',
    createPoolWorker: () => new ProbeWorker(),
  };
  const runner = await createVitest('test', {
    config: fileURLToPath(new URL('../../vitest.config.ts', import.meta.url)),
    watch: false,
    reporters: [{}],
    pool: probe,
  });
  try {
    await runner.standalone();
    const specifications = await runner.globTestSpecifications();
    const atlas = specifications.find((spec) =>
      spec.moduleId.endsWith('/tools/import/atlas.test.ts'),
    );
    expect(atlas, 'the real Atlas suite remains discoverable').toBeDefined();
    if (atlas === undefined) throw new Error('Atlas suite was not discovered');
    const node = specifications.filter((spec) => spec.project.name === 'node' && spec !== atlas);
    const web = specifications.filter((spec) => spec.project.name === 'web');
    const selected = [atlas, ...node.slice(0, 4), ...web.slice(0, 4)];
    expect(selected).toHaveLength(9);

    const result = await runner.runTestSpecifications(selected);

    expect(result.unhandledErrors).toEqual([]);
    expect(scheduled.toSorted()).toEqual(selected.map((spec) => spec.moduleId).toSorted());
    expect(active).toBe(0);
    // Issue #160: seven simultaneous suites exhausted native clone allocations
    // on Windows 8 CPU / 16 GiB; the measured safe execution budget is four.
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
  } finally {
    await runner.close();
  }
});
