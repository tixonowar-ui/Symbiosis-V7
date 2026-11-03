import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { campaignPeaceSceneValue } from '@shared/campaign-lobby.js';
import {
  campaignLifecycleCommandValue,
  redactCampaignLifecycleCommand,
  type StoredCampaignLifecycleCommand,
} from '@shared/campaign-lifecycle.js';
import type { StoredPausedCampaign } from './campaign-creation.js';
import type { CampaignCheckpoint } from './store.js';
import { campaignStartCheckpoint } from './campaign-lobby-state.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  readCampaignLifecycleClientBinding,
  initialCampaignLifecycleState,
  planCampaignLifecycleEvent,
  replayCampaignLifecycleEvent,
  type CampaignLifecycleState,
  type CampaignLifecycleRules,
} from './campaign-lifecycle-state.js';

const captured = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/campaign-lobby-owner.json', import.meta.url), 'utf8'),
) as { gmStarted: { activePeaceSceneOrNull: unknown } };
const scene = campaignPeaceSceneValue(captured.gmStarted.activePeaceSceneOrNull);
const scope = {
  campaignId: scene.campaignId,
  gmLocalContextId: randomUUID(),
  ownerDeviceId: randomUUID(),
};
const birth: StoredPausedCampaign = {
  kind: 'PAUSED_CAMPAIGN',
  schemaVersion: 1,
  campaignId: scope.campaignId,
  sourceCampaignDraftId: randomUUID(),
  metadata: { title: 'Lifecycle test', description: null, art: null },
  host: {
    hostAddress: '127.0.0.1',
    hostPort: 31770,
    networkInterface: 'loopback',
    activePlayerCapacity: 5,
  },
  defaultFutureRollMode: 'MANUAL',
  status: 'PAUSED',
  createdAt: '2026-11-02T12:00:00.000Z',
  qrPayload: 'immutable birth locator',
  baselineVersion: 'sha256:' + 'a'.repeat(64),
  creationCommandId: randomUUID(),
  creationReceiptId: randomUUID(),
};
const verifier: JsonObject = { testProof: 'A' };
const rules: CampaignLifecycleRules = {
  validateSettings: (value) => {
    if (value.title.trim().length === 0) throw new Error('invalid metadata');
  },
  validateVerifier: (value) => {
    if (typeof value['testProof'] !== 'string') throw new Error('invalid verifier');
  },
};
const origin = (): CampaignCheckpoint => ({
  campaignId: scope.campaignId,
  snapshotJson: JSON.stringify({
    campaign: {
      campaignId: scope.campaignId,
      lifecycleState: 'PAUSED',
      payloadJson: s.canonical(birth),
    },
    campaignCharacterCopies: [],
  }),
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
});
const allocations = () => ({
  receiptId: randomUUID(),
  checkpointId: randomUUID(),
  committedAt: '2026-11-02T12:01:00.000Z',
});
const state = () => initialCampaignLifecycleState(birth, verifier);
const settings = (before = state()) => ({
  workflowCommandId: 'UI-CMD-CAMPAIGN-SETTINGS-SET' as const,
  commandId: randomUUID(),
  campaignId: scope.campaignId,
  expectedSettingsRevision: before.settingsRevision,
  ...before.settings,
});
const command = (
  workflowCommandId:
    | 'UI-CMD-CAMPAIGN-PAUSE-SET'
    | 'UI-CMD-CAMPAIGN-CAPACITY-SET'
    | 'UI-CMD-MASTER-PASSWORD-CHANGE'
    | 'UI-CMD-CLIENT-DISCONNECT',
  revision: number,
) => ({
  workflowCommandId,
  commandId: randomUUID(),
  campaignId: scope.campaignId,
  expectedCampaignRevision: revision,
});
function apply(
  checkpoint: CampaignCheckpoint,
  before: CampaignLifecycleState,
  request: StoredCampaignLifecycleCommand,
  proof: Parameters<typeof planCampaignLifecycleEvent>[5] = null,
) {
  return planCampaignLifecycleEvent(
    scope,
    checkpoint,
    before,
    request,
    allocations(),
    proof,
    rules,
  );
}

describe('CMP-008/014/015/016 lifecycle continuation', () => {
  it('preserves birth and old checkpoint bytes while advancing settings once', () => {
    const checkpoint = origin(),
      bytes = checkpoint.snapshotJson;
    const result = apply(checkpoint, state(), {
      ...settings(),
      title: 'Renamed',
      defaultFutureRollMode: 'AUTO',
    });
    expect(checkpoint.snapshotJson).toBe(bytes);
    expect(birth.metadata.title).toBe('Lifecycle test');
    expect(result.checkpoint.stateRevision).toBe(1);
    expect(result.state.settingsRevision).toBe(1);
    expect(result.state.settings.defaultFutureRollMode).toBe('AUTO');
    expect(replayCampaignLifecycleEvent(scope, checkpoint, state(), result.event, rules)).toEqual(
      result,
    );
    expect(JSON.stringify(result.event.receipt)).not.toContain('testProof');
  });
  it('checks the original prefix on replay after a later settings revision', () => {
    const first = apply(origin(), state(), { ...settings(), title: 'First' });
    const second = apply(first.checkpoint, first.state, {
      ...settings(first.state),
      title: 'Second',
    });
    expect(replayCampaignLifecycleEvent(scope, origin(), state(), first.event, rules)).toEqual(
      first,
    );
    expect(() =>
      replayCampaignLifecycleEvent(scope, second.checkpoint, second.state, first.event, rules),
    ).toThrow();
    expect(second.state.settings.title).toBe('Second');
  });
  it('accepts metadata in HOSTING but refuses a changed network until PAUSED', () => {
    const started = campaignStartCheckpoint(origin(), scene);
    expect(
      apply(started, state(), { ...settings(), title: 'Hosted rename' }).event.receipt
        .campaignStatus,
    ).toBe('HOSTING');
    expect(() =>
      apply(started, state(), {
        ...settings(),
        network: { ...state().settings.network, hostPort: 31771 },
      }),
    ).toThrow();
    expect(
      apply(origin(), state(), {
        ...settings(),
        network: { ...state().settings.network, hostPort: 31771 },
      }).state.settings.network.hostPort,
    ).toBe(31771);
  });
  it('pauses/resumes the same scene without changing its clock or timestamp', () => {
    const started = campaignStartCheckpoint(origin(), scene);
    const paused = apply(started, state(), {
      ...command('UI-CMD-CAMPAIGN-PAUSE-SET', 1),
      workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET',
      decision: 'PAUSE',
      reason: 'Break',
    });
    expect(paused.event.receipt).toMatchObject({
      campaignStatus: 'PAUSED',
      pauseReasonOrNull: 'Break',
      campaignRevision: 2,
    });
    const resumed = apply(paused.checkpoint, paused.state, {
      ...command('UI-CMD-CAMPAIGN-PAUSE-SET', 2),
      workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET',
      decision: 'RESUME',
      reason: 'Continue',
    });
    expect(resumed.event.receipt).toMatchObject({
      campaignStatus: 'HOSTING',
      pauseReasonOrNull: null,
      campaignRevision: 3,
    });
    const snapshot = JSON.parse(resumed.checkpoint.snapshotJson) as {
      campaign: { payloadJson: string };
    };
    expect(
      (JSON.parse(snapshot.campaign.payloadJson) as { peaceScene: unknown }).peaceScene,
    ).toEqual(scene);
    expect(() =>
      apply(paused.checkpoint, paused.state, {
        ...command('UI-CMD-CAMPAIGN-PAUSE-SET', 2),
        workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET',
        decision: 'PAUSE',
        reason: 'Again',
      }),
    ).toThrow();
  });
  it('never uses Resume to bypass first Start and never changes capacity inside a paused scene', () => {
    expect(() =>
      apply(origin(), state(), {
        ...command('UI-CMD-CAMPAIGN-PAUSE-SET', 0),
        workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET',
        decision: 'RESUME',
        reason: 'Bypass',
      }),
    ).toThrow();
    const paused = apply(campaignStartCheckpoint(origin(), scene), state(), {
      ...command('UI-CMD-CAMPAIGN-PAUSE-SET', 1),
      workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET',
      decision: 'PAUSE',
      reason: 'Break',
    });
    expect(() =>
      apply(paused.checkpoint, paused.state, {
        ...command('UI-CMD-CAMPAIGN-CAPACITY-SET', 2),
        workflowCommandId: 'UI-CMD-CAMPAIGN-CAPACITY-SET',
        newCapacity: 4,
      }),
    ).toThrow();
  });
  it('retains private verifier lineage A→B→C while old receipts contain no verifier', () => {
    const a = state(),
      b = { testProof: 'B' },
      c = { testProof: 'C' };
    const first = apply(
      origin(),
      a,
      {
        ...command('UI-CMD-MASTER-PASSWORD-CHANGE', 0),
        workflowCommandId: 'UI-CMD-MASTER-PASSWORD-CHANGE',
      },
      { beforeVerifier: verifier, afterVerifier: b },
    );
    const second = apply(
      first.checkpoint,
      first.state,
      {
        ...command('UI-CMD-MASTER-PASSWORD-CHANGE', 1),
        workflowCommandId: 'UI-CMD-MASTER-PASSWORD-CHANGE',
      },
      { beforeVerifier: b, afterVerifier: c },
    );
    expect(second.state.effectiveVerifier).toEqual(c);
    expect(replayCampaignLifecycleEvent(scope, origin(), a, first.event, rules)).toEqual(first);
    expect(() =>
      apply(
        first.checkpoint,
        first.state,
        {
          ...command('UI-CMD-MASTER-PASSWORD-CHANGE', 1),
          workflowCommandId: 'UI-CMD-MASTER-PASSWORD-CHANGE',
        },
        { beforeVerifier: verifier, afterVerifier: c },
      ),
    ).toThrow();
    expect(first.checkpoint.snapshotJson).not.toContain('testProof');
    expect(JSON.stringify(first.event.receipt)).not.toContain('testProof');
  });
  it('refuses foreign, stale and altered event proofs without mutating its inputs', () => {
    const checkpoint = origin(),
      before = state(),
      bytes = s.canonical({ checkpoint, before });
    expect(() => apply(checkpoint, before, { ...settings(), campaignId: randomUUID() })).toThrow();
    expect(() =>
      apply(checkpoint, before, { ...settings(), expectedSettingsRevision: 1 }),
    ).toThrow();
    const result = apply(checkpoint, before, settings());
    for (const mutation of [
      { eventIndex: 2 },
      { beforeCheckpointSha256: '0'.repeat(64) },
      { afterCheckpointSha256: '0'.repeat(64) },
      { previousEventSha256OrNull: '0'.repeat(64) },
      { receipt: { ...result.event.receipt, campaignRevision: 2 } },
    ])
      expect(() =>
        replayCampaignLifecycleEvent(
          scope,
          checkpoint,
          before,
          { ...result.event, ...mutation },
          rules,
        ),
      ).toThrow();
    expect(s.canonical({ checkpoint, before })).toBe(bytes);
  });
  it('redacts the three password inputs and refuses extra identity/default fields', () => {
    const request = campaignLifecycleCommandValue({
      ...command('UI-CMD-MASTER-PASSWORD-CHANGE', 0),
      currentMasterPassword: 'secret-A',
      newMasterPassword: 'secret-B',
      newMasterPasswordConfirmation: 'secret-B',
    });
    const redacted = redactCampaignLifecycleCommand(request);
    expect(Object.keys(redacted).sort()).toEqual([
      'campaignId',
      'commandId',
      'expectedCampaignRevision',
      'workflowCommandId',
    ]);
    expect(JSON.stringify(redacted)).not.toContain('secret-');
    for (const mutation of [
      { deviceIdentity: randomUUID() },
      { title: null },
      { network: { ...state().settings.network, hostPort: 0 } },
      { defaultFutureRollMode: 'DEFAULT' },
    ])
      expect(() => campaignLifecycleCommandValue({ ...settings(), ...mutation })).toThrow();
  });
});

describe('closed lifecycle client binding', () => {
  const request = settings();
  const { workflowCommandId, commandId, ...payload } = request;
  const binding = () => ({
    contextId: scope.gmLocalContextId,
    request: {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId,
      workflowCommandId,
      payload,
      expectedRevisions: { stateRevision: 2, projectionRevision: 5, actorVisibilityRevision: 1 },
    },
  });
  it('binds canonical bytes to the authenticated context and exact redacted command', () => {
    expect(readCampaignLifecycleClientBinding(s.canonical(binding()), scope, request)).toEqual(
      binding(),
    );
    expect(() =>
      readCampaignLifecycleClientBinding(JSON.stringify(binding()), scope, request),
    ).toThrow();
    expect(() =>
      readCampaignLifecycleClientBinding(
        s.canonical(binding()),
        { ...scope, gmLocalContextId: randomUUID() },
        request,
      ),
    ).toThrow();
    expect(() =>
      readCampaignLifecycleClientBinding(s.canonical(binding()), scope, {
        ...request,
        title: 'Changed',
      }),
    ).toThrow();
  });
  it.each([
    'role',
    'protocolVersion',
    'workflowCommandId',
    'commandId',
    'payload',
    'expectedRevisions',
  ])('rejects malformed %s', (key) => {
    const value = binding();
    const malformed = { ...value, request: { ...value.request, [key]: null } };
    expect(() =>
      readCampaignLifecycleClientBinding(s.canonical(malformed), scope, request),
    ).toThrow();
  });
  it('never accepts raw password fields or extra identity inside persisted payload', () => {
    const password = {
      ...command('UI-CMD-MASTER-PASSWORD-CHANGE', 0),
    } as StoredCampaignLifecycleCommand;
    const { commandId: id, workflowCommandId: workflow, ...redacted } = password;
    const value = {
      ...binding(),
      request: {
        ...binding().request,
        commandId: id,
        workflowCommandId: workflow,
        payload: redacted,
      },
    };
    expect(readCampaignLifecycleClientBinding(s.canonical(value), scope, password)).toEqual(value);
    for (const key of [
      'currentMasterPassword',
      'newMasterPassword',
      'newMasterPasswordConfirmation',
      'commandId',
      'workflowCommandId',
    ]) {
      expect(() =>
        readCampaignLifecycleClientBinding(
          s.canonical({
            ...value,
            request: { ...value.request, payload: { ...redacted, [key]: 'must-never-persist' } },
          }),
          scope,
          password,
        ),
      ).toThrow();
    }
  });
  it('rejects asynchronous validators before invoking their bodies', () => {
    let called = false;
    const invalidAsync: unknown = async () => {
      called = true;
      await Promise.resolve();
    };
    const invalidPromise: unknown = () => Promise.resolve();
    expect(() =>
      planCampaignLifecycleEvent(scope, origin(), state(), request, allocations(), null, {
        ...rules,
        validateSettings: invalidAsync as CampaignLifecycleRules['validateSettings'],
      }),
    ).toThrow();
    expect(called).toBe(false);
    expect(() =>
      planCampaignLifecycleEvent(scope, origin(), state(), request, allocations(), null, {
        ...rules,
        validateSettings: invalidPromise as CampaignLifecycleRules['validateSettings'],
      }),
    ).toThrow();
  });
});
