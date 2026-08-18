import { describe, expect, it } from 'vitest';

import type { RevisionImpact } from '../persistence/index.js';
import { advanceShellRevisionVector, createShellRevisionTracker } from './shell-revisions.js';

const impact = (
  stateChanged: boolean,
  projectionChanged: boolean,
  actorVisibilityChanged = false,
): RevisionImpact => ({ actorVisibilityChanged, projectionChanged, stateChanged });

describe('ADR 0031 host shell revision tracker', () => {
  it('starts at 0/0/0 and does not expose mutable internal state', () => {
    const tracker = createShellRevisionTracker();
    const first = tracker.read();

    expect(first).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 0,
      stateRevision: 0,
    });
    (first as { projectionRevision: number }).projectionRevision = 99;
    expect(tracker.read()).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 0,
      stateRevision: 0,
    });
  });

  it('applies only the declared state and projection dimensions', () => {
    const tracker = createShellRevisionTracker();

    expect(tracker.advance(impact(false, true))).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 1,
      stateRevision: 0,
    });
    expect(tracker.advance(impact(true, false))).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 1,
      stateRevision: 1,
    });
    expect(tracker.advance(impact(true, true))).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 2,
      stateRevision: 2,
    });
    expect(tracker.advance(impact(false, false))).toEqual(tracker.read());
  });

  it('rejects unknown or malformed impact shapes', () => {
    const tracker = createShellRevisionTracker();

    expect(() => tracker.advance({ projectionChanged: true } as never)).toThrow(
      /must contain exactly/,
    );
    expect(() =>
      tracker.advance({
        actorVisibilityChanged: false,
        projectionChanged: true,
        stateChanged: false,
        unexpected: false,
      } as never),
    ).toThrow(/must contain exactly/);
    expect(() => tracker.advance(null as never)).toThrow(/must contain exactly/);
    expect(tracker.read()).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 0,
      stateRevision: 0,
    });
  });

  it('refuses actor visibility changes instead of ignoring them', () => {
    const tracker = createShellRevisionTracker();

    expect(() => tracker.advance(impact(false, true, true))).toThrow(
      /do not support actor visibility changes/,
    );
    expect(tracker.read()).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 0,
      stateRevision: 0,
    });
  });

  it.each([
    ['stateRevision', impact(true, false)],
    ['projectionRevision', impact(false, true)],
  ] as const)('refuses %s overflow before producing a partial vector', (name, change) => {
    const current = {
      actorVisibilityRevision: 0,
      projectionRevision: name === 'projectionRevision' ? Number.MAX_SAFE_INTEGER : 7,
      stateRevision: name === 'stateRevision' ? Number.MAX_SAFE_INTEGER : 7,
    };

    expect(() => advanceShellRevisionVector(current, change)).toThrow(
      `shell ${name} cannot advance beyond Number.MAX_SAFE_INTEGER`,
    );
    expect(current[name]).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('keeps one axis across reconnect and resets only with a new host tracker', () => {
    const runningHost = createShellRevisionTracker();
    runningHost.advance(impact(false, true));

    expect(runningHost.read().projectionRevision).toBe(1);
    expect(runningHost.read().projectionRevision).toBe(1);
    expect(createShellRevisionTracker().read()).toEqual({
      actorVisibilityRevision: 0,
      projectionRevision: 0,
      stateRevision: 0,
    });
  });
});
