import { expect, it } from 'vitest';
import { disposeNetworkResources } from '../../tests/fixtures/network-application-e2e.js';

it('awaits all successful cleanups in order when the scenario has no error', async () => {
  const order: string[] = [];
  await expect(
    disposeNetworkResources([
      async () => {
        order.push('first:start');
        await Promise.resolve();
        order.push('first:end');
      },
      async () => {
        order.push('second');
        await Promise.resolve();
      },
      async () => {
        order.push('third');
        await Promise.resolve();
      },
    ]),
  ).resolves.toBeUndefined();
  expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
});

it.each([new Error('original scenario failure'), { failure: 'caught non-Error value' }, null])(
  'rethrows the identical original scenario error after every successful cleanup (%j)',
  async (original) => {
    const order: number[] = [];
    await expect(
      disposeNetworkResources(
        [
          async () => {
            order.push(1);
            await Promise.resolve();
          },
          async () => {
            order.push(2);
            await Promise.resolve();
          },
          async () => {
            order.push(3);
            await Promise.resolve();
          },
        ],
        original,
      ),
    ).rejects.toBe(original);
    expect(order).toEqual([1, 2, 3]);
  },
);

it('aggregates cleanup-only errors in order without skipping later resources', async () => {
  const first = new Error('first cleanup failure'),
    last = new Error('last cleanup failure');
  const order: number[] = [];
  const caught: unknown = await disposeNetworkResources([
    () => {
      order.push(1);
      throw first;
    },
    async () => {
      order.push(2);
      await Promise.resolve();
    },
    async () => {
      order.push(3);
      await Promise.resolve();
      throw last;
    },
    async () => {
      order.push(4);
      await Promise.resolve();
    },
  ]).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(order).toEqual([1, 2, 3, 4]);
  expect(caught).toBeInstanceOf(AggregateError);
  if (!(caught instanceof AggregateError)) throw new Error('Expected aggregate cleanup failure');
  expect(caught.errors).toHaveLength(2);
  expect(caught.errors[0]).toBe(first);
  expect(caught.errors[1]).toBe(last);
});

it('preserves original identity first in the aggregate and finishes all cleanups after failures', async () => {
  const original = new Error('original scenario failure'),
    first = new Error('first cleanup failure'),
    last = new Error('last cleanup failure');
  const order: number[] = [];
  const caught: unknown = await disposeNetworkResources(
    [
      async () => {
        order.push(1);
        await Promise.resolve();
        throw first;
      },
      async () => {
        order.push(2);
        await Promise.resolve();
      },
      () => {
        order.push(3);
        throw last;
      },
      async () => {
        order.push(4);
        await Promise.resolve();
      },
    ],
    original,
  ).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(order).toEqual([1, 2, 3, 4]);
  expect(caught).toBeInstanceOf(AggregateError);
  if (!(caught instanceof AggregateError)) throw new Error('Expected aggregate cleanup failure');
  expect(caught.errors).toHaveLength(3);
  expect(caught.errors[0]).toBe(original);
  expect(caught.errors[1]).toBe(first);
  expect(caught.errors[2]).toBe(last);
});
