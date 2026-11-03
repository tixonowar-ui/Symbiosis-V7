import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
  campaignLifecycleGmActions,
  campaignLifecycleGmProjectionValue,
  campaignLifecycleGmRequest,
  type CampaignLifecycleGmProjection,
} from './campaign-lifecycle.js';
const p: CampaignLifecycleGmProjection = {
  contextId: randomUUID(),
  campaignId: randomUUID(),
  stateRevision: 4,
  projectionRevision: 9,
  actorVisibilityRevision: 3,
  campaignRevision: 2,
  settingsRevision: 0,
  campaignStatus: 'PAUSED',
  pauseReasonOrNull: null,
  firstStartCompleted: false,
  title: 'Settings fixture',
  descriptionOrNull: null,
  defaultFutureRollMode: 'MANUAL',
  networkForNextLaunch: { hostAddress: '127.0.0.1', hostPort: 31770, networkInterface: 'loopback' },
  activeListenerEndpointOrNull: null,
  availableNetworkInterfaces: [
    { hostAddress: '127.0.0.1', networkInterface: 'loopback', family: 'IPv4' },
  ],
  campaignArtChecksumOrNull: null,
  currentCapacity: 3,
  activePlayerCount: 0,
  safeBoundary: true,
  pendingOperationCount: 0,
  clockMode: null,
  checkpointPreview: { campaignRevision: 2, checkpointSha256: 'a'.repeat(64) },
  devices: [],
  commandId: null,
};
const started = (paused = false): CampaignLifecycleGmProjection => ({
  ...p,
  firstStartCompleted: true,
  campaignStatus: paused ? 'PAUSED' : 'HOSTING',
  pauseReasonOrNull: paused ? 'Break' : null,
  clockMode: 'STOPPED',
});
describe('closed campaign lifecycle GM presentation', () => {
  it('keeps pre-Start, running and paused states distinct without changing the stopped clock', () => {
    for (const value of [p, started(), started(true)])
      expect(campaignLifecycleGmProjectionValue(value)).toEqual(value);
    expect(() => campaignLifecycleGmProjectionValue({ ...p, campaignStatus: 'HOSTING' })).toThrow();
    expect(() =>
      campaignLifecycleGmProjectionValue({ ...started(true), pauseReasonOrNull: null }),
    ).toThrow();
    expect(() =>
      campaignLifecycleGmProjectionValue({ ...started(), clockMode: 'RUNNING' }),
    ).toThrow();
  });
  it.each([
    'verifier',
    'currentMasterPassword',
    'newMasterPassword',
    'privateOwner',
    'foreignSheet',
  ])('refuses non-allowlisted %s', (key) => {
    expect(() =>
      campaignLifecycleGmProjectionValue({ ...p, [key]: 'must not be serialized' }),
    ).toThrow();
  });
  it('validates real count, checkpoint and device/seat consistency', () => {
    expect(() => campaignLifecycleGmProjectionValue({ ...p, pendingOperationCount: 1 })).toThrow();
    expect(() => campaignLifecycleGmProjectionValue({ ...p, activePlayerCount: 4 })).toThrow();
    expect(() =>
      campaignLifecycleGmProjectionValue({
        ...p,
        checkpointPreview: { ...p.checkpointPreview, campaignRevision: 1 },
      }),
    ).toThrow();
    const device = {
      deviceId: randomUUID(),
      connected: true,
      pendingOwnedCommandCount: 0,
      controllerSeats: [
        { controllerSeat: randomUUID(), campaignCharacterId: randomUUID(), name: 'Owned copy' },
      ],
    };
    expect(campaignLifecycleGmProjectionValue({ ...p, devices: [device] }).devices).toEqual([
      device,
    ]);
    expect(() => campaignLifecycleGmProjectionValue({ ...p, devices: [device, device] })).toThrow();
    expect(() =>
      campaignLifecycleGmProjectionValue({
        ...p,
        devices: [
          { ...device, controllerSeats: [...device.controllerSeats, ...device.controllerSeats] },
        ],
      }),
    ).toThrow();
  });
  it('only exposes current supported controls and has no future NPC/map/transfer actions', () => {
    expect(campaignLifecycleGmActions('CMP-008', p, CAMPAIGN_LIFECYCLE_WORKFLOW_IDS)).toEqual([
      'CMP-008::CTA::005',
      'CMP-008::CTA::006',
      'CMP-008::CTA::007',
      'CMP-008::CTA::008',
      'CMP-008::CTA::009',
    ]);
    expect(
      campaignLifecycleGmActions('CMP-014', started(true), CAMPAIGN_LIFECYCLE_WORKFLOW_IDS),
    ).not.toContain('CMP-014::CTA::002');
    expect(
      campaignLifecycleGmActions('CMP-016', started(), CAMPAIGN_LIFECYCLE_WORKFLOW_IDS),
    ).toEqual(['CMP-016::CTA::002', 'CMP-016::CTA::004']);
    expect(
      campaignLifecycleGmActions('CMP-016', started(true), CAMPAIGN_LIFECYCLE_WORKFLOW_IDS),
    ).toEqual(['CMP-016::CTA::003', 'CMP-016::CTA::004']);
    expect(campaignLifecycleGmActions('CMP-015', p, [])).toEqual([
      'CMP-015::CTA::001',
      'CMP-015::CTA::004',
    ]);
    expect(
      campaignLifecycleGmActions(
        'CMP-008',
        { ...p, safeBoundary: false, pendingOperationCount: 2 },
        CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
      ),
    ).toEqual(['CMP-008::CTA::005', 'CMP-008::CTA::006', 'CMP-008::CTA::007']);
    expect(
      campaignLifecycleGmActions(
        'CMP-016',
        { ...started(), safeBoundary: false, pendingOperationCount: 1 },
        CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
      ),
    ).toEqual(['CMP-016::CTA::004']);
  });
  it('builds exact command envelopes with current server revisions and explicit reason', () => {
    const id = randomUUID();
    expect(
      campaignLifecycleGmRequest(started(), 'CMP-016::CTA::002', id, { reason: 'Break' }),
    ).toMatchObject({
      commandId: id,
      workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET',
      role: 'gm',
      expectedRevisions: { stateRevision: 4, projectionRevision: 9, actorVisibilityRevision: 3 },
      payload: {
        campaignId: p.campaignId,
        expectedCampaignRevision: 2,
        decision: 'PAUSE',
        reason: 'Break',
      },
    });
    expect(() =>
      campaignLifecycleGmRequest(started(), 'CMP-016::CTA::002', id, { reason: '' }),
    ).toThrow();
    expect(() =>
      campaignLifecycleGmRequest(p, 'CMP-014::CTA::002', id, { newCapacity: 6 }),
    ).toThrow();
    expect(() =>
      campaignLifecycleGmRequest(p, 'CMP-008::CTA::008', id, { title: 'Incomplete' }),
    ).toThrow();
    expect(
      campaignLifecycleGmRequest(p, 'CMP-008::CTA::008', id, {
        title: p.title,
        descriptionOrNull: null,
        defaultFutureRollMode: 'AUTO',
        network: p.networkForNextLaunch,
      }).payload,
    ).toEqual({
      campaignId: p.campaignId,
      expectedSettingsRevision: 0,
      title: p.title,
      descriptionOrNull: null,
      defaultFutureRollMode: 'AUTO',
      network: p.networkForNextLaunch,
    });
  });
});
