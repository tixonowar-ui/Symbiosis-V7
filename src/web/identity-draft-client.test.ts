import { describe, expect, it } from 'vitest';
import type {
  IdentityDraftRefusalV3Message,
  IdentityDraftResultV3Message,
  IdentityDraftScope,
  IdentityDraftValues,
  RevisionVector,
} from '@shared/index.js';
import { IdentityDraftClient, type IdentityDraftSnapshot } from './identity-draft-client.js';
const revisions = (value = 2): RevisionVector => ({
  stateRevision: value,
  projectionRevision: value,
  actorVisibilityRevision: value,
});
const scope = (characterDraftId = 'character-1', contextId = 'context-1'): IdentityDraftScope => ({
  sourceFormId: 'CHR-001',
  contextId,
  characterDraftId,
  wizardCheckpointId: `checkpoint-${characterDraftId}`,
});
const values = (
  name: string | null = null,
  sex: IdentityDraftValues['sex'] = null,
): IdentityDraftValues => ({
  name,
  description: null,
  artAssetKeyOrLocalFile: null,
  age: null,
  massKg: null,
  sex,
});
const snapshot = (overrides: Partial<IdentityDraftSnapshot> = {}): IdentityDraftSnapshot => ({
  scope: scope(),
  draftRevision: 0,
  revisions: revisions(),
  values: values(),
  ...overrides,
});
const allocator = () => {
  let next = 0;
  return () => `update-${(next += 1)}`;
};
const request = (
  draftUpdateId: string,
  name: string | null,
  expectedDraftRevision = 0,
  expectedRevisions = revisions(),
) => ({ draftUpdateId, expectedDraftRevision, expectedRevisions, values: values(name) });
const result = (
  draftUpdateId: string,
  draftRevision = 1,
  resultRevisions = revisions(3),
): IdentityDraftResultV3Message => ({
  protocolVersion: 3,
  messageType: 'character.identity-draft.result',
  draftUpdateId,
  scope: scope(),
  draftRevision,
  revisions: resultRevisions,
  projectionRole: 'player',
  presentation: {
    base: {
      availableActionKeys: [],
      formId: 'CHR-001',
      formType: 'screen',
      roleFilteredPayload: {},
      routeBindings: [],
      routeTemplate: '/player/character/:characterDraftId/identity',
    },
    layers: [],
  },
});
const refusal = (
  draftUpdateId: string,
  refusalRevisions = revisions(),
): IdentityDraftRefusalV3Message => ({
  protocolVersion: 3,
  messageType: 'character.identity-draft.refusal',
  draftUpdateId,
  scope: scope(),
  revisions: refusalRevisions,
  presentationUnchanged: true,
  refusal: {
    code: 'INVALID_FIELD',
    error: { field: 'name', reason: 'BLANK_AFTER_TRIM' },
  },
});
describe('IdentityDraftClient', () => {
  it('sends one full replacement and coalesces newer widget values', () => {
    const client = new IdentityDraftClient(snapshot(), allocator());
    const first = client.edit(values('Alice'));
    expect(first).toMatchObject(request('update-1', 'Alice'));
    expect(client.edit(values('Bob'))).toBeNull();
    expect(client.state).toMatchObject({
      dirty: true,
      outstanding: { draftUpdateId: 'update-1' },
      widgetValues: values('Bob'),
    });
    expect(client.receiveResult(result('update-1'), values('Alice'))).toMatchObject(
      request('update-2', 'Bob', 1, revisions(3)),
    );
  });
  it('renders canonical result values when the widget still equals the sent request', () => {
    const client = new IdentityDraftClient(snapshot(), allocator());
    client.edit(values(' Alice '));
    expect(client.receiveResult(result('update-1'), values('Alice'))).toBeNull();
    expect(client.state).toEqual({
      dirty: false,
      lastRefusal: null,
      outstanding: null,
      widgetValues: values('Alice'),
    });
  });
  it('treats a sex-only edit as a full dirty replacement and coalesces the next choice', () => {
    const client = new IdentityDraftClient(snapshot(), allocator());
    const first = client.edit(values(null, 'MALE'));
    expect(first?.values).toEqual(values(null, 'MALE'));
    expect(client.edit(values(null, 'FEMALE'))).toBeNull();
    expect(client.receiveResult(result('update-1'), values(null, 'MALE'))?.values).toEqual(
      values(null, 'FEMALE'),
    );
  });
  it('retries changed widgets after INVALID_FIELD and retains a current error otherwise', () => {
    const client = new IdentityDraftClient(snapshot(), allocator());
    client.edit(values(' '));
    client.edit(values('Alice'));
    expect(client.receiveRefusal(refusal('update-1'))).toMatchObject(request('update-2', 'Alice'));
    expect(client.state.lastRefusal).toMatchObject({ code: 'INVALID_FIELD' });
    expect(client.receiveRefusal(refusal('update-2', revisions(9)))).toBeNull();
    expect(client.state).toMatchObject({
      dirty: true,
      lastRefusal: { code: 'INVALID_FIELD' },
      outstanding: null,
    });
    expect(client.edit(values('Bob'))).toMatchObject(request('update-3', 'Bob'));
  });
  it('ignores another ID but terminal-ack-ignores a matching behind result', () => {
    const client = new IdentityDraftClient(snapshot(), allocator());
    client.edit(values('Alice'));
    expect(client.receiveResult(result('another-update'), values('Alice'))).toBeNull();
    expect(client.state.outstanding?.draftUpdateId).toBe('update-1');
    expect(client.receiveResult(result('update-1', 1, revisions(1)), values('Alice'))).toBeNull();
    expect(client.state.outstanding).toBeNull();
    expect(client.state.widgetValues).toEqual(values('Alice'));
    expect(client.state.dirty).toBe(true);
  });
  it('resends the exact request after a newer snapshot of the same draft', () => {
    const client = new IdentityDraftClient(snapshot(), allocator());
    const sent = client.edit(values('Alice'));
    const replay = client.resumeAfterSnapshot(
      snapshot({
        scope: scope('character-1', 'new-context'),
        draftRevision: 1,
        revisions: revisions(5),
        values: values('Accepted elsewhere'),
      }),
    );
    expect(replay).toEqual(sent);
    expect(client.state).toMatchObject({
      dirty: true,
      outstanding: { expectedDraftRevision: 0, expectedRevisions: revisions() },
      widgetValues: values('Alice'),
    });
    expect(client.receiveResult(result('update-1'), values('Alice'))).toBeNull();
    expect(client.edit(values('Bob'))).toMatchObject(request('update-2', 'Bob', 1, revisions(5)));
    expect(
      client.resumeAfterSnapshot(
        snapshot({ scope: scope('character-2'), values: values('Fresh character') }),
      ),
    ).toBeNull();
    expect(client.state).toMatchObject({
      dirty: false,
      outstanding: null,
      widgetValues: values('Fresh character'),
    });
  });
});
