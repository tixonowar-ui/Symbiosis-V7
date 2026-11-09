import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeNpcProjection,
  npcControlPresentation,
  NpcArtSession,
  NpcArtSessionError,
} from './npc-application.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  projectionRole: 'gm' as const,
  contextId: id(1),
  campaignId: id(2),
  stateRevision: 3,
  projectionRevision: 4,
  actorVisibilityRevision: 5,
};
function identity() {
  return {
    ...scope,
    formId: 'NPC-002',
    campaignStatus: 'PAUSED',
    campaignPhase: 'PRE_START',
    libraryRevision: 0,
    attemptOrNull: {
      npcDraftId: id(3),
      candidateNpcUuid: id(4),
      attemptRevision: 2,
      draftRevision: 2,
      stage: 'NPC-002',
      editMode: 'CREATE_V1',
      versionBindingOrNull: null,
    },
    content: {
      input: Object.fromEntries(
        'name description affiliation campaignRole sex massKg artAssetKeyOrNull'
          .split(' ')
          .map((k) => [k, { kind: 'UNSET' }]),
      ),
      errors: {},
      artOrNull: null,
    },
  };
}
const local = {
  readOnly: false,
  pending: true,
  dirty: true,
  refusalOrNull: 'Local failed request',
};
describe('NPC wire-to-leaf adapter', () => {
  it('adds only local request state and leaves decoded wire data immutable', () => {
    const p = identity(),
      before = JSON.stringify(p),
      d = decodeNpcProjection('NPC-002', p, scope);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const result = npcControlPresentation(d.value, local);
    expect(result.formId).toBe('NPC-002');
    if (result.formId !== 'NPC-002') return;
    expect(result.presentation.state).toEqual(local);
    expect(result.presentation.state).not.toBe(local);
    expect(result.presentation.input).toEqual(p.content.input);
    expect(JSON.stringify(p)).toBe(before);
    expect(d.value.content).not.toHaveProperty('state');
  });
  it('changes the file-read fence when current attempt revision changes', () => {
    const p = identity(),
      d = decodeNpcProjection('NPC-002', p, scope);
    if (!d.ok) throw Error('fixture');
    const a = npcControlPresentation(d.value, local);
    if (a.formId !== 'NPC-002') throw Error('fixture');
    p.attemptOrNull.attemptRevision++;
    p.attemptOrNull.draftRevision++;
    const e = decodeNpcProjection('NPC-002', p, scope);
    if (!e.ok) throw Error('fixture');
    const b = npcControlPresentation(e.value, local);
    if (b.formId !== 'NPC-002') throw Error('fixture');
    expect(a.presentation.bindingKey).not.toBe(b.presentation.bindingKey);
  });
  it('returns a redacted refusal and never evaluates hostile input or its toJSON', () => {
    let calls = 0;
    const p = identity();
    Object.defineProperty(p.content, 'input', {
      enumerable: true,
      get() {
        calls++;
        throw Error('PRIVATE_SECRET');
      },
    });
    const result = decodeNpcProjection('NPC-002', p, scope);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
    expect(calls).toBe(0);
  });
  it('rejects local pending/dirty/refusal data on the wire and player scope', () => {
    const p = identity();
    expect(
      decodeNpcProjection('NPC-002', { ...p, content: { ...p.content, state: local } }, scope).ok,
    ).toBe(false);
    expect(decodeNpcProjection('NPC-002', { ...p, projectionRole: 'player' }, scope).ok).toBe(
      false,
    );
  });
});

describe('private portrait browser lifetime', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reference = { assetKey: 'npc-upload:' + 'a'.repeat(64), checksum: 'a'.repeat(64) };
  const target = { kind: 'ATTEMPT' as const, npcDraftId: id(3), expectedAttemptRevision: 2 };
  function fixture() {
    const raw = identity();
    const d = decodeNpcProjection(
      'NPC-002',
      { ...raw, content: { ...raw.content, artOrNull: reference } },
      scope,
    );
    if (!d.ok) throw Error('fixture');
    const create = vi.fn((blob: Blob) => 'blob:owned-' + (blob.size === 8 ? 'image' : 'other')),
      revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const session = new NpcArtSession();
    session.setProjection(d.value);
    const request = session.begin(id(20), target, reference);
    const response = {
      ...request,
      messageType: 'network.npc-art.result',
      mediaType: 'image/png',
      bytesBase64: 'iVBORw0KGgo=',
    };
    return { session, request, response, projection: d.value, create, revoke };
  }
  it('does not turn a loading private reference into absent art or a remote URL', () => {
    const f = fixture();
    expect(npcControlPresentation(f.projection, local)).toMatchObject({
      presentation: { artOrNull: { ...reference, status: 'LOADING' } },
    });
    expect(npcControlPresentation(f.projection, local, f.session)).toMatchObject({
      presentation: { artOrNull: { ...reference, status: 'LOADING' } },
    });
    expect(f.session.accept(f.response)).toBe('LOADED');
    const value = npcControlPresentation(f.projection, local, f.session);
    if (value.formId !== 'NPC-002') throw Error('fixture');
    expect(value.presentation.artOrNull).toEqual({
      ...reference,
      status: 'READY',
      url: 'blob:owned-image',
    });
    expect(f.create).toHaveBeenCalledTimes(1);
    const blob = f.create.mock.calls[0]?.[0];
    expect(blob?.size).toBe(8);
    expect(blob?.type).toBe('image/png');
    expect(f.projection.content).not.toHaveProperty('url');
    f.session.dispose();
    expect(f.revoke).toHaveBeenCalledWith('blob:owned-image');
  });
  it.each([
    'contextId',
    'campaignId',
    'sourceFormId',
    'target',
    'expectedRevisions',
    'checksum',
  ] as const)('rejects changed response binding %s without creating a Blob', (key) => {
    const f = fixture(),
      r = {
        ...f.response,
        [key]:
          key === 'expectedRevisions'
            ? { ...f.request.expectedRevisions, stateRevision: 99 }
            : key === 'target'
              ? { ...target, expectedAttemptRevision: 99 }
              : key === 'sourceFormId'
                ? 'NPC-017'
                : key === 'checksum'
                  ? 'b'.repeat(64)
                  : id(99),
      };
    expect(() => f.session.accept(r)).toThrow();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.session.accept(f.response)).toBe('LOADED');
    f.session.dispose();
  });
  it('ignores unsolicited/duplicate reads and forbids reused correlation IDs', () => {
    const f = fixture();
    expect(f.session.accept({ ...f.response, requestId: id(99) })).toBe('IGNORED');
    expect(() => f.session.begin(id(20), target, reference)).toThrow();
    expect(f.session.accept(f.response)).toBe('LOADED');
    expect(f.session.accept(f.response)).toBe('IGNORED');
    expect(f.create).toHaveBeenCalledTimes(1);
    f.session.dispose();
  });
  it('drops pending replies across a newer projection and revokes loaded URLs', () => {
    const f = fixture();
    expect(f.session.accept(f.response)).toBe('LOADED');
    const next = { ...f.projection, projectionRevision: 5 };
    f.session.setProjection(next);
    expect(f.revoke).toHaveBeenCalledTimes(1);
    expect(f.session.accept(f.response)).toBe('IGNORED');
    expect(f.session.presentation(next, target, reference)).toEqual({
      ...reference,
      status: 'LOADING',
    });
    expect(() => f.session.begin(id(20), target, reference)).toThrow();
    f.session.dispose();
  });
  it('never installs an old response after disconnect/role loss, or after unmount', () => {
    const f = fixture();
    f.session.setProjection(null);
    expect(f.session.accept(f.response)).toBe('IGNORED');
    expect(f.create).not.toHaveBeenCalled();
    f.session.dispose();
    expect(f.session.accept(f.response)).toBe('IGNORED');
    expect(() => f.session.setProjection(f.projection)).toThrow(NpcArtSessionError);
  });
  it('consumes a closed refusal without inventing null art or retaining private error text', () => {
    const f = fixture();
    expect(
      f.session.accept({
        ...f.request,
        messageType: 'network.npc-art.refusal',
        code: 'NOT_AVAILABLE',
      }),
    ).toBe('REFUSED');
    expect(f.session.accept(f.response)).toBe('IGNORED');
    expect(f.create).not.toHaveBeenCalled();
    expect(npcControlPresentation(f.projection, local, f.session)).toMatchObject({
      presentation: { artOrNull: { ...reference, status: 'UNAVAILABLE' } },
    });
    f.session.dispose();
  });
  it('marks a transport failure unavailable without installing a late response', () => {
    const f = fixture();
    expect(f.session.fail(f.request.requestId)).toBe(true);
    expect(f.session.fail(f.request.requestId)).toBe(false);
    expect(npcControlPresentation(f.projection, local, f.session)).toMatchObject({
      presentation: { artOrNull: { ...reference, status: 'UNAVAILABLE' } },
    });
    expect(f.session.accept(f.response)).toBe('IGNORED');
    expect(f.create).not.toHaveBeenCalled();
    const retry = f.session.begin(id(21), target, reference);
    expect(npcControlPresentation(f.projection, local, f.session)).toMatchObject({
      presentation: { artOrNull: { ...reference, status: 'LOADING' } },
    });
    expect(f.session.accept({ ...f.response, requestId: retry.requestId })).toBe('LOADED');
    f.session.dispose();
  });
  it('keeps controls available if local Blob allocation fails', () => {
    const f = fixture();
    f.create.mockImplementationOnce(() => {
      throw Error('LOCAL_RESOURCE_DETAIL');
    });
    expect(f.session.accept(f.response)).toBe('UNAVAILABLE');
    expect(npcControlPresentation(f.projection, local, f.session)).toMatchObject({
      presentation: { state: local, artOrNull: { ...reference, status: 'UNAVAILABLE' } },
    });
    expect(f.session.accept(f.response)).toBe('IGNORED');
    f.session.dispose();
  });
  it('rejects getter/toJSON bodies without evaluating them or creating URLs', () => {
    const f = fixture();
    let reads = 0;
    const response = { ...f.response };
    Object.defineProperty(response, 'bytesBase64', {
      enumerable: true,
      get() {
        reads++;
        throw Error('PRIVATE');
      },
    });
    expect(() => f.session.accept(response)).toThrow();
    expect(reads).toBe(0);
    expect(() =>
      f.session.accept({
        ...f.response,
        toJSON() {
          reads++;
          return f.response;
        },
      }),
    ).toThrow();
    expect(reads).toBe(0);
    expect(f.create).not.toHaveBeenCalled();
    f.session.dispose();
  });
});
