import { describe, expect, it } from 'vitest';
import {
  createCampaignGmScheduler,
  type CampaignGmWorkToken,
} from './campaign-network-executor.js';
import type { CampaignConnection } from './campaign-creation.js';
const connection: CampaignConnection = {
  gmLocalContextId: 'trusted-context',
  executableCreate: true,
  trusted: () => true,
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const scheduler = () =>
  createCampaignGmScheduler((c) =>
    c.trusted() && c.gmLocalContextId !== null
      ? { gmLocalContextId: c.gmLocalContextId, campaignId: 'campaign' }
      : null,
  );
describe('host-wide GM work accounting', () => {
  it('counts queued calls across tabs, excludes only the current opaque token, and ignores queued polls', async () => {
    const q = scheduler(),
      gate = deferred(),
      began = deferred();
    let token: CampaignGmWorkToken | null = null;
    const first = q.wire(connection, async () => {
      token = q.currentToken();
      began.resolve();
      await gate.promise;
      expect(q.pendingCounts('campaign', token)).toEqual({
        queuedCommandCount: 1,
        executingCommandCount: 0,
      });
      expect(() => q.pendingCounts('foreign', token)).toThrow();
      expect(() => q.pendingCounts('campaign', {} as CampaignGmWorkToken)).toThrow();
    });
    await began.promise;
    expect(q.currentToken()).toBeNull();
    const poll = q.poll(async () => {
      expect(q.currentToken()).toBeNull();
      await Promise.resolve();
    });
    const second = q.wire({ ...connection }, async () => {
      expect(q.pendingCounts('campaign', q.currentToken())).toEqual({
        queuedCommandCount: 0,
        executingCommandCount: 0,
      });
      await Promise.resolve();
    });
    expect(q.pendingCounts('campaign')).toEqual({
      queuedCommandCount: 1,
      executingCommandCount: 1,
    });
    expect(q.pendingCounts('foreign')).toEqual({ queuedCommandCount: 0, executingCommandCount: 0 });
    expect(() => q.pendingCounts('campaign', token)).toThrow();
    gate.resolve();
    await Promise.all([first, poll, second]);
    expect(q.pendingCounts('campaign')).toEqual({
      queuedCommandCount: 0,
      executingCommandCount: 0,
    });
    expect(() => q.pendingCounts('campaign', token)).toThrow();
  });
  it('clears inherited async context for a poll enqueued inside a wire call', async () => {
    const q = scheduler();
    let poll: Promise<void> | undefined;
    await q.wire(connection, () => {
      expect(q.currentToken('campaign')).not.toBeNull();
      expect(q.currentToken('foreign')).toBeNull();
      poll = q.poll(() => {
        expect(q.currentToken()).toBeNull();
        return Promise.resolve();
      });
      return Promise.resolve();
    });
    await poll;
  });
  it('does not turn an unknown scope token into a campaign exclusion', async () => {
    const q = scheduler();
    await q.wire({ ...connection, gmLocalContextId: null }, () => {
      expect(q.currentToken()).not.toBeNull();
      expect(q.currentToken('campaign')).toBeNull();
      expect(() => q.pendingCounts('campaign', q.currentToken())).toThrow();
      expect(q.pendingCounts('campaign')).toEqual({
        queuedCommandCount: 0,
        executingCommandCount: 0,
      });
      return Promise.resolve();
    });
  });
  it('removes refused work and keeps the queue usable', async () => {
    const q = scheduler();
    await expect(q.wire(connection, () => Promise.reject(new Error('refused')))).rejects.toThrow(
      'refused',
    );
    expect(q.pendingCounts('campaign')).toEqual({
      queuedCommandCount: 0,
      executingCommandCount: 0,
    });
    expect(await q.wire(connection, () => Promise.resolve('next'))).toBe('next');
  });
  it('captures trusted scope at enqueue and prevents queued work after close', async () => {
    const q = scheduler(),
      gate = deferred(),
      began = deferred();
    const mutable = { ...connection };
    let queuedRan = false;
    const first = q.wire(mutable, async () => {
      began.resolve();
      await gate.promise;
    });
    await began.promise;
    mutable.gmLocalContextId = null;
    expect(q.pendingCounts('campaign').executingCommandCount).toBe(1);
    const next = q.wire(connection, () => {
      queuedRan = true;
      return Promise.resolve();
    });
    const rejected = expect(next).rejects.toThrow();
    q.close();
    gate.resolve();
    await first;
    await rejected;
    expect(queuedRan).toBe(false);
    await expect(q.poll(() => Promise.resolve())).rejects.toThrow();
  });
});
