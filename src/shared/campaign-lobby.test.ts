import { describe, expect, it } from 'vitest';
import {
  campaignDayPhase,
  campaignLobbyCommandValue,
  initialCampaignTimeValue,
} from './campaign-lobby.js';

const scope = {
  commandId: '11111111-1111-4111-8111-111111111111',
  campaignId: '22222222-2222-4222-8222-222222222222',
  expectedLobbySnapshotRevision: 'a'.repeat(64),
};
describe('ADR 0073 explicit initial campaign time and closed lobby intents', () => {
  it('preserves the explicit first virtual minute and crosses a day without a timezone', () => {
    expect(initialCampaignTimeValue({ dayNumber: 1, hour: 0, minute: 0 })).toEqual({
      dayNumber: 1,
      hour: 0,
      minute: 0,
      campaignTimestamp: 0,
    });
    expect(initialCampaignTimeValue({ dayNumber: 2, hour: 0, minute: 1 }).campaignTimestamp).toBe(
      1441,
    );
  });
  it.each([
    {},
    { dayNumber: 1, hour: 0 },
    { dayNumber: 0, hour: 0, minute: 0 },
    { dayNumber: 1, hour: 24, minute: 0 },
    { dayNumber: 1, hour: 0, minute: 60 },
    { dayNumber: 1.5, hour: 0, minute: 0 },
    { dayNumber: 1, hour: -1, minute: 0 },
    { dayNumber: Number.MAX_SAFE_INTEGER, hour: 0, minute: 0 },
    { dayNumber: 1, hour: 0, minute: 0, timezone: 'UTC' },
    { dayNumber: 1, hour: 0, minute: 0, campaignTimestamp: 100 },
  ])('refuses missing, invented or unrepresentable calendar input %j', (input) => {
    expect(() => initialCampaignTimeValue(input)).toThrow();
  });
  it.each([
    [359, 'NIGHT'],
    [360, 'DAY'],
    [1259, 'DAY'],
    [1260, 'NIGHT'],
    [1800, 'DAY'],
  ] as const)('applies AQ2-008 at virtual minute %i', (minute, expected) => {
    expect(campaignDayPhase(minute)).toBe(expected);
  });
  it('accepts Ready intent but rejects client-selected device/controller authority', () => {
    const request = { ...scope, workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET', ready: true };
    expect(campaignLobbyCommandValue(request)).toEqual(request);
    for (const extra of [{ ownerDeviceId: scope.campaignId }, { controller: 'gm' }, { role: 'gm' }])
      expect(() => campaignLobbyCommandValue({ ...request, ...extra })).toThrow();
    expect(() => campaignLobbyCommandValue({ ...request, ready: 1 })).toThrow();
  });
  it('keeps Start distinct from pause/resume and requires both exact revision inputs', () => {
    const request = {
      ...scope,
      workflowCommandId: 'UI-CMD-CAMPAIGN-START',
      expectedReadinessRevision: 0,
    };
    expect(campaignLobbyCommandValue(request)).toEqual(request);
    expect(() =>
      campaignLobbyCommandValue({ ...request, expectedReadinessRevision: -1 }),
    ).toThrow();
    expect(() =>
      campaignLobbyCommandValue({ ...request, workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET' }),
    ).toThrow();
    expect(() =>
      campaignLobbyCommandValue({ ...request, expectedLobbySnapshotRevision: 'current' }),
    ).toThrow();
  });
});
