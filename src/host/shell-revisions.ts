import type { RevisionVector } from '@shared/index.js';

import type { RevisionImpact } from '../persistence/index.js';

const IMPACT_KEYS = ['actorVisibilityChanged', 'projectionChanged', 'stateChanged'] as const;
const REVISION_KEYS = ['actorVisibilityRevision', 'projectionRevision', 'stateRevision'] as const;

export interface ShellRevisionTracker {
  readonly advance: (impact: RevisionImpact) => RevisionVector;
  readonly read: () => RevisionVector;
}

function checkedImpact(impact: RevisionImpact): void {
  if (typeof impact !== 'object' || impact === null || Array.isArray(impact)) {
    throw new TypeError(`shell revision impact must contain exactly: ${IMPACT_KEYS.join(', ')}`);
  }
  const keys = Object.keys(impact);
  if (
    keys.length !== IMPACT_KEYS.length ||
    IMPACT_KEYS.some((key) => !Object.hasOwn(impact, key) || typeof impact[key] !== 'boolean')
  ) {
    throw new TypeError(`shell revision impact must contain exactly: ${IMPACT_KEYS.join(', ')}`);
  }
}

function checkedVector(vector: RevisionVector): void {
  const keys = Object.keys(vector);
  if (
    keys.length !== REVISION_KEYS.length ||
    REVISION_KEYS.some((key) => !Object.hasOwn(vector, key))
  ) {
    throw new TypeError(`shell revision vector must contain exactly: ${REVISION_KEYS.join(', ')}`);
  }
  for (const key of REVISION_KEYS) {
    const value = vector[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(
        `${key} is ${JSON.stringify(value)}, expected a non-negative safe integer`,
      );
    }
  }
  if (vector.actorVisibilityRevision !== 0) {
    throw new Error('shell actorVisibilityRevision must remain 0');
  }
}

function increment(name: keyof RevisionVector, value: number, changed: boolean): number {
  if (!changed) return value;
  if (value === Number.MAX_SAFE_INTEGER) {
    throw new Error(`shell ${name} cannot advance beyond Number.MAX_SAFE_INTEGER`);
  }
  return value + 1;
}

export function advanceShellRevisionVector(
  current: RevisionVector,
  impact: RevisionImpact,
): RevisionVector {
  checkedVector(current);
  checkedImpact(impact);
  if (impact.actorVisibilityChanged) {
    throw new Error('shell revisions do not support actor visibility changes');
  }

  return {
    actorVisibilityRevision: 0,
    projectionRevision: increment(
      'projectionRevision',
      current.projectionRevision,
      impact.projectionChanged,
    ),
    stateRevision: increment('stateRevision', current.stateRevision, impact.stateChanged),
  };
}

export function createShellRevisionTracker(): ShellRevisionTracker {
  let current: RevisionVector = {
    actorVisibilityRevision: 0,
    projectionRevision: 0,
    stateRevision: 0,
  };

  return {
    advance: (impact) => {
      current = advanceShellRevisionVector(current, impact);
      return { ...current };
    },
    read: () => ({ ...current }),
  };
}
