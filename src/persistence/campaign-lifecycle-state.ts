import { types } from 'node:util';
import {
  campaignLifecycleClientBindingValue,
  storedCampaignLifecycleCommandValue,
  type CampaignLifecycleReceipt,
  type CampaignSettings,
  type StoredCampaignLifecycleCommand,
} from '@shared/campaign-lifecycle.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { GmRequestReviewScope, StoredPausedCampaign } from './campaign-creation.js';
import type { CampaignCheckpoint } from './store.js';
import { networkApplicationStorage as s } from './network-local-application.js';

export interface CampaignLifecycleState {
  readonly eventRevision: number;
  readonly settingsRevision: number;
  readonly pauseReasonOrNull: string | null;
  readonly settings: CampaignSettings;
  readonly activePlayerCapacity: number;
  readonly effectiveVerifier: JsonObject;
  readonly lastEventSha256OrNull: string | null;
}
export interface CampaignLifecycleEvent {
  readonly schemaVersion: 1;
  readonly eventIndex: number;
  readonly previousEventSha256OrNull: string | null;
  readonly scope: GmRequestReviewScope;
  readonly request: StoredCampaignLifecycleCommand;
  readonly clientRequestJsonOrNull: string | null;
  readonly beforeCheckpoint: CampaignCheckpoint;
  readonly beforeCheckpointSha256: string;
  readonly afterCheckpointSha256: string;
  readonly passwordTransitionOrNull: {
    readonly beforeVerifier: JsonObject;
    readonly afterVerifier: JsonObject;
  } | null;
  readonly receipt: CampaignLifecycleReceipt;
}
export interface CampaignLifecycleRules {
  /** Historical verification must not depend on today's interfaces or open sockets. */
  readonly validateSettings: (settings: CampaignSettings) => void;
  readonly validateVerifier: (verifier: JsonObject) => void;
}
export function initialCampaignLifecycleState(
  payload: StoredPausedCampaign,
  verifier: JsonObject,
): CampaignLifecycleState {
  return {
    eventRevision: 0,
    settingsRevision: 0,
    pauseReasonOrNull: null,
    settings: {
      title: payload.metadata.title,
      descriptionOrNull: payload.metadata.description,
      defaultFutureRollMode: payload.defaultFutureRollMode,
      network: {
        hostAddress: payload.host.hostAddress,
        hostPort: payload.host.hostPort,
        networkInterface: payload.host.networkInterface,
      },
    },
    activePlayerCapacity: payload.host.activePlayerCapacity,
    effectiveVerifier: verifier,
    lastEventSha256OrNull: null,
  };
}
export function campaignCheckpointParts(checkpoint: CampaignCheckpoint) {
  const snapshot = s.object(JSON.parse(checkpoint.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  const campaign = s.object(snapshot['campaign'], ['campaignId', 'lifecycleState', 'payloadJson']);
  const payload = s.object(JSON.parse(s.text(campaign['payloadJson'])) as unknown);
  if (
    campaign['campaignId'] !== checkpoint.campaignId ||
    (campaign['lifecycleState'] !== 'PAUSED' && campaign['lifecycleState'] !== 'HOSTING') ||
    !Array.isArray(snapshot['campaignCharacterCopies'])
  )
    return s.fail();
  return { snapshot, campaign, payload };
}
export function campaignCheckpointStarted(checkpoint: CampaignCheckpoint): boolean {
  return Object.hasOwn(campaignCheckpointParts(checkpoint).payload, 'peaceScene');
}

/** Validate bytes independently of the UI journal, which checks the historical vector. */
export function readCampaignLifecycleClientBinding(
  value: string | null,
  scope: GmRequestReviewScope,
  request: StoredCampaignLifecycleCommand,
) {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(s.text(value));
  if (s.canonical(parsed) !== value) return s.fail('INVALID_INPUT');
  const binding = campaignLifecycleClientBindingValue(parsed);
  if (binding.contextId !== scope.gmLocalContextId || request.campaignId !== scope.campaignId)
    return s.fail('FOREIGN_OWNER');
  if (
    !s.same(
      {
        ...binding.request.payload,
        commandId: binding.request.commandId,
        workflowCommandId: binding.request.workflowCommandId,
      },
      request,
    )
  )
    return s.fail('IDEMPOTENCY_CONFLICT');
  return binding;
}
function validateSynchronous<T>(callback: (value: T) => void, value: T): void {
  if (
    typeof callback !== 'function' ||
    Object.prototype.toString.call(callback) === '[object AsyncFunction]'
  )
    return s.fail('INVALID_INPUT');
  const before = s.canonical(value);
  let result: unknown;
  try {
    result = callback(value);
  } catch (error: unknown) {
    if (types.isPromise(error)) void error.catch(() => undefined);
    throw error;
  }
  if (types.isPromise(result)) void result.catch(() => undefined);
  if (result !== undefined) return s.fail('INVALID_INPUT');
  if (s.canonical(value) !== before) return s.fail('SOURCE_CHANGED');
}

/** Pure ordered continuation. Every copied character and the singleton scene retain exact bytes. */
export function planCampaignLifecycleEvent(
  scope: GmRequestReviewScope,
  before: CampaignCheckpoint,
  state: CampaignLifecycleState,
  requestValue: StoredCampaignLifecycleCommand,
  allocations: {
    readonly receiptId: string;
    readonly checkpointId: string;
    readonly committedAt: string;
  },
  passwordTransitionOrNull: CampaignLifecycleEvent['passwordTransitionOrNull'],
  rules: CampaignLifecycleRules,
  clientRequestJsonOrNull: string | null = null,
): {
  readonly event: CampaignLifecycleEvent;
  readonly checkpoint: CampaignCheckpoint;
  readonly state: CampaignLifecycleState;
} {
  const request = storedCampaignLifecycleCommandValue(requestValue);
  readCampaignLifecycleClientBinding(clientRequestJsonOrNull, scope, request);
  if (request.campaignId !== scope.campaignId || before.campaignId !== scope.campaignId)
    return s.fail('FOREIGN_OWNER');
  if (request.workflowCommandId === 'UI-CMD-CAMPAIGN-SETTINGS-SET') {
    if (request.expectedSettingsRevision !== state.settingsRevision)
      return s.fail('STALE_REVISION');
  } else if (request.expectedCampaignRevision !== before.stateRevision)
    return s.fail('STALE_REVISION');
  for (const id of [allocations.receiptId, allocations.checkpointId]) s.uuid(id);
  s.text(allocations.committedAt);
  const { snapshot, campaign, payload } = campaignCheckpointParts(before);
  const started = Object.hasOwn(payload, 'peaceScene');
  let status = campaign['lifecycleState'] as 'PAUSED' | 'HOSTING';
  let settings = state.settings;
  let capacity = state.activePlayerCapacity;
  let settingsRevision = state.settingsRevision;
  let pauseReasonOrNull = state.pauseReasonOrNull;
  let verifier = state.effectiveVerifier;
  if (
    (request.workflowCommandId === 'UI-CMD-MASTER-PASSWORD-CHANGE') !==
    (passwordTransitionOrNull !== null)
  )
    return s.fail();
  switch (request.workflowCommandId) {
    case 'UI-CMD-CAMPAIGN-SETTINGS-SET':
      settings = {
        title: request.title,
        descriptionOrNull: request.descriptionOrNull,
        defaultFutureRollMode: request.defaultFutureRollMode,
        network: request.network,
      };
      validateSynchronous(rules.validateSettings, settings);
      if (!s.same(settings.network, state.settings.network) && status !== 'PAUSED')
        return s.fail('UNAVAILABLE');
      settingsRevision = s.increment(settingsRevision);
      break;
    case 'UI-CMD-CAMPAIGN-CAPACITY-SET': {
      const active = (snapshot['campaignCharacterCopies'] as unknown[]).filter(
        (value) => s.object(value)['lifecycleState'] === 'ACTIVE',
      ).length;
      if (started || request.newCapacity < active) return s.fail('UNAVAILABLE');
      capacity = request.newCapacity;
      settingsRevision = s.increment(settingsRevision);
      break;
    }
    case 'UI-CMD-MASTER-PASSWORD-CHANGE': {
      const proof = passwordTransitionOrNull ?? s.fail();
      validateSynchronous(rules.validateVerifier, proof.beforeVerifier);
      validateSynchronous(rules.validateVerifier, proof.afterVerifier);
      if (!s.same(proof.beforeVerifier, verifier)) return s.fail();
      verifier = proof.afterVerifier;
      settingsRevision = s.increment(settingsRevision);
      break;
    }
    case 'UI-CMD-CAMPAIGN-PAUSE-SET':
      if (!started || (request.decision === 'PAUSE' ? status !== 'HOSTING' : status !== 'PAUSED'))
        return s.fail('UNAVAILABLE');
      status = request.decision === 'PAUSE' ? 'PAUSED' : 'HOSTING';
      pauseReasonOrNull = request.decision === 'PAUSE' ? request.reason : null;
      break;
    case 'UI-CMD-CLIENT-DISCONNECT':
      // Scope existence and pending/generation proofs are verified by the owning transaction.
      break;
  }
  const revision = s.increment(before.stateRevision);
  const metadata = s.object(payload['metadata']);
  const host = s.object(payload['host']);
  const nextPayload = {
    ...payload,
    metadata: { ...metadata, title: settings.title, description: settings.descriptionOrNull },
    host: { ...host, activePlayerCapacity: capacity, ...settings.network },
    defaultFutureRollMode: settings.defaultFutureRollMode,
    // Every committed lifecycle event changes its checkpoint, even when a later disconnect
    // leaves all game values unchanged. The reference is rebuilt from the actual journal.
    lifecycle: {
      schemaVersion: 1,
      eventRevision: s.increment(state.eventRevision),
      lastCommandId: request.commandId,
      settingsRevision,
      pauseReasonOrNull,
    },
  };
  const checkpoint: CampaignCheckpoint = {
    campaignId: before.campaignId,
    snapshotJson: JSON.stringify({
      campaign: { ...campaign, lifecycleState: status, payloadJson: s.canonical(nextPayload) },
      campaignCharacterCopies: snapshot['campaignCharacterCopies'],
    }),
    stateRevision: revision,
    projectionRevision: s.increment(before.projectionRevision),
    actorVisibilityRevision: s.increment(before.actorVisibilityRevision),
  };
  const receipt: CampaignLifecycleReceipt = {
    ...allocations,
    commandId: request.commandId,
    campaignId: request.campaignId,
    workflowCommandId: request.workflowCommandId,
    campaignRevision: revision,
    campaignStatus: status,
    pauseReasonOrNull,
    settingsRevision,
  };
  const event: CampaignLifecycleEvent = {
    schemaVersion: 1,
    eventIndex: s.increment(state.eventRevision),
    previousEventSha256OrNull: state.lastEventSha256OrNull,
    scope,
    request,
    clientRequestJsonOrNull,
    beforeCheckpoint: before,
    beforeCheckpointSha256: s.sha(s.canonical(before)),
    afterCheckpointSha256: s.sha(s.canonical(checkpoint)),
    passwordTransitionOrNull,
    receipt,
  };
  return {
    event,
    checkpoint,
    state: {
      eventRevision: event.eventIndex,
      settingsRevision,
      pauseReasonOrNull,
      settings,
      activePlayerCapacity: capacity,
      effectiveVerifier: verifier,
      lastEventSha256OrNull: s.sha(s.canonical(event)),
    },
  };
}

export function replayCampaignLifecycleEvent(
  scope: GmRequestReviewScope,
  before: CampaignCheckpoint,
  state: CampaignLifecycleState,
  event: CampaignLifecycleEvent,
  rules: CampaignLifecycleRules,
) {
  s.object(event, [
    'schemaVersion',
    'eventIndex',
    'previousEventSha256OrNull',
    'scope',
    'request',
    'clientRequestJsonOrNull',
    'beforeCheckpoint',
    'beforeCheckpointSha256',
    'afterCheckpointSha256',
    'passwordTransitionOrNull',
    'receipt',
  ]);
  if (!s.same(event.scope, scope)) return s.fail();
  const expected = planCampaignLifecycleEvent(
    scope,
    before,
    state,
    event.request,
    {
      receiptId: event.receipt.receiptId,
      checkpointId: event.receipt.checkpointId,
      committedAt: event.receipt.committedAt,
    },
    event.passwordTransitionOrNull,
    rules,
    event.clientRequestJsonOrNull,
  );
  if (!s.same(expected.event, event)) return s.fail();
  return expected;
}
