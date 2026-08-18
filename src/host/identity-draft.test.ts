import { Buffer } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import type { RevisionVector } from '@shared/wire-protocol.js';
import type {
  IdentityDraftReplaceV2Message,
  IdentityDraftScope,
  IdentityDraftValues,
} from '@shared/wire-v2-protocol.js';
import {
  createIdentityDraftRuntime,
  identityDraftOverflowAxis,
  type IdentityDraftApplicationContext,
  type IdentityDraftApplicationOutcome,
} from './identity-draft.js';
const SCOPE = {
  characterDraftId: 'character-draft',
  contextId: 'context',
  sourceFormId: 'CHR-001',
  wizardCheckpointId: 'checkpoint',
} as const satisfies IdentityDraftScope;
const REVISIONS = {
  actorVisibilityRevision: 3,
  projectionRevision: 5,
  stateRevision: 2,
} as const satisfies RevisionVector;
const ADVANCED = { ...REVISIONS, projectionRevision: 6 } as const satisfies RevisionVector;
const EMPTY_VALUES = {
  age: null,
  artAssetKeyOrLocalFile: null,
  description: null,
  massKg: null,
  name: null,
} as const satisfies IdentityDraftValues;
const CATALOG_KEY = 'symbiosis_placeholder_free_female';
const request = (
  draftUpdateId: string,
  values: IdentityDraftValues = EMPTY_VALUES,
  expectedDraftRevision = 0,
  expectedRevisions: RevisionVector = REVISIONS,
): IdentityDraftReplaceV2Message => ({
  draftUpdateId,
  expectedDraftRevision,
  expectedRevisions,
  messageType: 'character.identity-draft.replace',
  protocolVersion: 2,
  scope: SCOPE,
  values,
});
const context = (
  overrides: Partial<IdentityDraftApplicationContext> = {},
): IdentityDraftApplicationContext => ({
  advanceProjectionRevision: () => ADVANCED,
  capabilityAvailable: false,
  currentRevisions: () => REVISIONS,
  currentScope: () => SCOPE,
  ...overrides,
});
const registeredRuntime = (keys: readonly string[] = []) => {
  const runtime = createIdentityDraftRuntime(new Set(keys));
  runtime.registerScope(SCOPE);
  return runtime;
};
const fail = (message: string): never => {
  throw new Error(message);
};
function refusal(outcome: IdentityDraftApplicationOutcome) {
  expect(outcome.kind).toBe('refused');
  if (outcome.kind !== 'refused') throw new Error('expected identity draft refusal');
  return outcome.refusal;
}
it('canonicalizes a changed replacement, replays it before stale checks, and recognizes a no-op', () => {
  const runtime = registeredRuntime([CATALOG_KEY]);
  const advance = vi.fn(() => ADVANCED);
  const values = {
    age: -7.25,
    artAssetKeyOrLocalFile: { assetKey: CATALOG_KEY, kind: 'asset-key' },
    description: ' unchanged ',
    massKg: 70.1,
    name: ' Bob ',
  } as const satisfies IdentityDraftValues;
  const firstRequest = request('update-1', values);
  const first = runtime.apply(
    firstRequest,
    context({ advanceProjectionRevision: advance, capabilityAvailable: true }),
  );
  expect(first).toMatchObject({
    checkpointEligible: true,
    draftRevision: 1,
    kind: 'accepted',
    projectionChanged: true,
    replayed: false,
    revisions: ADVANCED,
    values: { ...values, name: 'Bob' },
  });
  if (first.kind !== 'accepted') throw new Error('expected accepted identity draft');
  expect(advance).toHaveBeenCalledOnce();
  const snapshot = runtime.readScope(SCOPE);
  expect(snapshot).toMatchObject({ draftRevision: 1, values: { name: 'Bob' } });
  expect(snapshot?.values).not.toBe(first.values);
  expect(snapshot?.values.artAssetKeyOrLocalFile).not.toBe(first.values.artAssetKeyOrLocalFile);
  expect(runtime.readScope({ ...SCOPE, contextId: 'other' })).toBeNull();
  const replay = runtime.apply(
    firstRequest,
    context({
      advanceProjectionRevision: () => fail('replay must not advance'),
      currentRevisions: () => fail('replay must not read revisions'),
      currentScope: () => null,
    }),
  );
  expect(replay).toMatchObject({ kind: 'accepted', projectionChanged: false, replayed: true });
  expect(replay.revisions).toEqual(ADVANCED);
  const conflict = runtime.apply(
    request('update-1', { ...values, name: 'Bob' }),
    context({ currentScope: () => null }),
  );
  expect(refusal(conflict)).toEqual({ code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' });
  const noAdvance = vi.fn(() => fail('canonical no-op must not advance'));
  const noOp = runtime.apply(
    request('update-2', { ...values, name: 'Bob' }, 1, ADVANCED),
    context({ advanceProjectionRevision: noAdvance, currentRevisions: () => ADVANCED }),
  );
  expect(noOp).toMatchObject({ draftRevision: 1, kind: 'accepted', projectionChanged: false });
  expect(noAdvance).not.toHaveBeenCalled();
});
it('does not mutate or journal when the projection writer throws or returns the wrong vector', () => {
  for (const advanceProjectionRevision of [() => fail('writer failed'), () => REVISIONS]) {
    const runtime = registeredRuntime();
    const replacement = request('retryable', { ...EMPTY_VALUES, name: 'Alice' });
    expect(() => runtime.apply(replacement, context({ advanceProjectionRevision }))).toThrow();
    const retried = runtime.apply(replacement, context());
    expect(retried).toMatchObject({ draftRevision: 1, kind: 'accepted', replayed: false });
  }
});
it('checks scope and both stale axes after journal lookup', () => {
  const unavailable = createIdentityDraftRuntime(new Set<string>());
  expect(refusal(unavailable.apply(request('missing'), context()))).toEqual({
    code: 'DRAFT_UNAVAILABLE',
  });
  const staleDraft = registeredRuntime();
  expect(refusal(staleDraft.apply(request('draft', EMPTY_VALUES, 1), context()))).toEqual({
    actual: 0,
    code: 'STALE_DRAFT',
    expected: 1,
  });
  const staleShell = registeredRuntime();
  const expected = { ...REVISIONS, stateRevision: 1 };
  const staleRequest = request('shell', EMPTY_VALUES, 0, expected);
  expect(refusal(staleShell.apply(staleRequest, context()))).toEqual({
    actual: REVISIONS,
    code: 'STALE_REVISION',
    expected,
  });
  staleShell.unregisterScope(SCOPE);
  expect(staleShell.apply(staleRequest, context({ currentScope: () => null }))).toMatchObject({
    kind: 'refused',
    replayed: true,
    refusal: { code: 'STALE_REVISION' },
  });
});
it('implements the exact name precedence and visible-grapheme boundaries', () => {
  const cases = [
    [' \t ', 'BLANK_AFTER_TRIM'],
    ['\u0000\ud800', 'CONTROL_CHARACTER'],
    ['\u0080', 'CONTROL_CHARACTER'],
    ['\ud800', 'UNPAIRED_SURROGATE'],
    ['\udc00', 'UNPAIRED_SURROGATE'],
    ['\u200b', 'NO_VISIBLE_GRAPHEME'],
    ['\u00ad', 'NO_VISIBLE_GRAPHEME'],
    ['a'.repeat(65), 'TOO_LONG'],
  ] as const;
  cases.forEach(([name, reason], index) => {
    const runtime = registeredRuntime();
    expect(
      refusal(
        runtime.apply(request(`name-${String(index)}`, { ...EMPTY_VALUES, name }), context()),
      ),
    ).toEqual({ code: 'INVALID_FIELD', error: { field: 'name', reason } });
  });
  for (const name of ['A', '🙂'.repeat(64)]) {
    const runtime = registeredRuntime();
    expect(
      runtime.apply(request(`valid-${name.length}`, { ...EMPTY_VALUES, name }), context()),
    ).toMatchObject({ kind: 'accepted', values: { name } });
  }
});
it('counts description code points and enforces only the declared mass constraints', () => {
  const invalid = [
    [{ ...EMPTY_VALUES, description: '' }, 'description', 'EMPTY_NOT_NULL'],
    [{ ...EMPTY_VALUES, description: '🙂'.repeat(2001) }, 'description', 'TOO_LONG'],
    [{ ...EMPTY_VALUES, massKg: 0 }, 'massKg', 'NOT_POSITIVE'],
    [{ ...EMPTY_VALUES, massKg: -1 }, 'massKg', 'NOT_POSITIVE'],
    [{ ...EMPTY_VALUES, massKg: 1.11 }, 'massKg', 'STEP_MISMATCH'],
  ] as const;
  invalid.forEach(([values, field, reason], index) => {
    const runtime = registeredRuntime();
    expect(refusal(runtime.apply(request(`field-${String(index)}`, values), context()))).toEqual({
      code: 'INVALID_FIELD',
      error: { field, reason },
    });
  });
  const runtime = registeredRuntime();
  expect(
    runtime.apply(
      request('unbounded', {
        ...EMPTY_VALUES,
        age: -0.25,
        description: '🙂'.repeat(2000),
        massKg: 1e20,
      }),
      context(),
    ),
  ).toMatchObject({ kind: 'accepted', values: { age: -0.25, massKg: 1e20 } });
});
it('validates exact catalog keys and canonical PNG/JPEG local files', () => {
  const [png, jpeg] = ['iVBORw0KGgo=', '/9j/'] as const;
  const cases = [
    [{ assetKey: '', kind: 'asset-key' }, 'EMPTY_ASSET_KEY'],
    [{ assetKey: 'unknown', kind: 'asset-key' }, 'ASSET_NOT_FOUND'],
    [{ bytesBase64: 'AA', kind: 'local-file', mediaType: 'image/png' }, 'NON_CANONICAL_BASE64'],
    [{ bytesBase64: 'AB==', kind: 'local-file', mediaType: 'image/png' }, 'NON_CANONICAL_BASE64'],
    [{ bytesBase64: png, kind: 'local-file', mediaType: 'image/jpeg' }, 'MEDIA_SIGNATURE_MISMATCH'],
    [
      {
        bytesBase64: Buffer.alloc(12 * 1024 * 1024 + 1).toString('base64'),
        kind: 'local-file',
        mediaType: 'image/png',
      },
      'FILE_TOO_LARGE',
    ],
  ] as const;
  cases.forEach(([artAssetKeyOrLocalFile, reason], index) => {
    const runtime = registeredRuntime([CATALOG_KEY]);
    expect(
      refusal(
        runtime.apply(
          request(`art-${String(index)}`, { ...EMPTY_VALUES, artAssetKeyOrLocalFile }),
          context(),
        ),
      ),
    ).toEqual({
      code: 'INVALID_FIELD',
      error: { field: 'artAssetKeyOrLocalFile', reason },
    });
  });
  for (const artAssetKeyOrLocalFile of [
    { assetKey: CATALOG_KEY, kind: 'asset-key' },
    { bytesBase64: png, kind: 'local-file', mediaType: 'image/png' },
    { bytesBase64: jpeg, kind: 'local-file', mediaType: 'image/jpeg' },
  ] as const) {
    const runtime = registeredRuntime([CATALOG_KEY]);
    expect(
      runtime.apply(
        request(`valid-art-${artAssetKeyOrLocalFile.kind}`, {
          ...EMPTY_VALUES,
          artAssetKeyOrLocalFile,
        }),
        context(),
      ),
    ).toMatchObject({ kind: 'accepted', values: { artAssetKeyOrLocalFile } });
  }
});
it('refuses projection overflow before calling the writer', () => {
  expect(identityDraftOverflowAxis(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(
    'draftRevision',
  );
  const runtime = registeredRuntime();
  const advance = vi.fn(() => fail('overflow must not advance'));
  const revisions = { ...REVISIONS, projectionRevision: Number.MAX_SAFE_INTEGER };
  const outcome = runtime.apply(
    request('overflow', { ...EMPTY_VALUES, name: 'Alice' }, 0, revisions),
    context({ advanceProjectionRevision: advance, currentRevisions: () => revisions }),
  );
  expect(refusal(outcome)).toEqual({ axis: 'projectionRevision', code: 'REVISION_OVERFLOW' });
  expect(advance).not.toHaveBeenCalled();
});
