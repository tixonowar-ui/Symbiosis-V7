import {
  admissionGroupLabelsValue,
  type AdmissionGroupLabel,
  type AdmissionPlayerCopyResult,
} from './campaign-admission-proposal.js';
import type { CampaignLobbyCopy } from './campaign-lobby.js';
import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  JsonObject,
  WorkflowCommandCapabilityId,
  WorkflowCommandRequestMessage,
} from './wire-protocol.js';
import {
  campaignLobbyCommandValue,
  campaignPeaceSceneValue as parseScene,
  type CampaignLobbyGmForm,
  type InitialCampaignTimeInput,
} from './campaign-lobby.js';
import type { RevisionVector } from './wire-protocol.js';
import type {
  AdmissionInitialRuntime,
  AdmissionLocationAssignment,
  AdmissionMechanicalSheetV1,
} from './campaign-admission.js';
import type {
  AdmissionBlocker,
  AdmissionControllerBinding,
} from './campaign-admission-proposal.js';
import {
  admissionCodecReaders as r,
  admissionJsonEqual,
  admissionLocationAssignmentValue,
} from './campaign-admission-codec.js';
import { admissionMechanicalSheetValue } from './campaign-admission-sheet.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import {
  campaignDayPhase,
  campaignPeaceSceneValue,
  initialCampaignTimeValue,
  lobbySnapshotRevisionValue,
  type CampaignPeaceScene,
  type CampaignStartPreflight,
  type InitialCampaignTime,
} from './campaign-lobby.js';

export interface CampaignPanelMember {
  readonly campaignCharacterId: string;
  readonly name: string;
  readonly lifecycleState: 'ACTIVE' | 'PROPOSED';
  readonly location: AdmissionLocationAssignment;
}
export interface CampaignPanelGroup {
  readonly groupId: string;
  readonly nameOrNull: string | null;
  readonly members: readonly CampaignPanelMember[];
}
export interface CampaignLobbyGmProjection extends RevisionVector {
  readonly contextId: string;
  readonly campaignId: string;
  readonly panelVariant: 'PRE_START' | 'STARTED_PEACE';
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly title: string;
  readonly descriptionOrNull: string | null;
  readonly groups: readonly CampaignPanelGroup[];
  readonly activePeaceSceneOrNull: CampaignPeaceScene | null;
  readonly campaignArtChecksumOrNull: string | null;
  readonly lobbySummary: {
    readonly activePcCount: number;
    readonly blockedPcCount: number;
    readonly readyDeviceCount: number;
  };
  readonly activePlayerCapacity: number;
  readonly admissionBatches: readonly {
    readonly admissionBatchId: string;
    readonly campaignCharacterIds: readonly string[];
  }[];
  readonly activeCampaignCharacters: readonly {
    readonly campaignCharacterId: string;
    readonly name: string;
    readonly groupId: string;
    readonly deviceId: string;
  }[];
  readonly controllingDevices: readonly string[];
  readonly readyByDevice: readonly {
    readonly deviceId: string;
    readonly includedCampaignCharacterIds: readonly string[];
    readonly ready: boolean;
  }[];
  readonly requiredFieldBlockers: readonly {
    readonly campaignCharacterId: string;
    readonly blockers: readonly AdmissionBlocker[];
  }[];
  readonly lobbySnapshotRevision: string;
  readonly readinessRevision: number;
  readonly initialTimeInput: {
    readonly dayNumber: null;
    readonly hour: null;
    readonly minute: null;
  };
  readonly initialCampaignTimeOrNull: InitialCampaignTime | null;
  readonly startPreflightStatus: CampaignStartPreflight;
  readonly conflictingOperationPending: boolean;
  readonly commandId: null;
}
const gmKeys =
  'contextId campaignId stateRevision projectionRevision actorVisibilityRevision panelVariant campaignStatus title descriptionOrNull groups activePeaceSceneOrNull campaignArtChecksumOrNull lobbySummary activePlayerCapacity admissionBatches activeCampaignCharacters controllingDevices readyByDevice requiredFieldBlockers lobbySnapshotRevision readinessRevision initialTimeInput initialCampaignTimeOrNull startPreflightStatus conflictingOperationPending commandId';
const bool = (v: unknown, p: string) => {
  if (typeof v !== 'boolean') r.invalid(p, 'boolean', null);
};
const equal = (a: unknown, b: unknown, p: string) => {
  if (!admissionJsonEqual(a, b)) r.invalid(p, 'matching committed fields', null);
};
function common(row: Record<string, unknown>) {
  for (const key of ['contextId', 'campaignId']) r.uuid(row[key], `$.${key}`);
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])
    r.integer(row[key], `$.${key}`, 0);
}
function ids(v: unknown, p: string): string[] {
  const values = r.list(v, p).map((v) => r.uuid(v, p));
  r.unique(values, p);
  return values;
}
export function campaignLobbyGmProjectionValue(value: unknown): CampaignLobbyGmProjection {
  const row = r.exact(value, gmKeys, '$.campaignLobby');
  common(row);
  const variant = r.oneOf(
    row['panelVariant'],
    ['PRE_START', 'STARTED_PEACE'] as const,
    '$.panelVariant',
  );
  if (variant === 'PRE_START') w.literal(row['campaignStatus'], 'PAUSED', '$.campaignStatus');
  else r.oneOf(row['campaignStatus'], ['HOSTING', 'PAUSED'] as const, '$.campaignStatus');
  r.text(row['title'], '$.title');
  if (row['descriptionOrNull'] !== null && typeof row['descriptionOrNull'] !== 'string')
    r.invalid('$.descriptionOrNull', 'text or null', null);
  if (row['campaignArtChecksumOrNull'] !== null)
    lobbySnapshotRevisionValue(row['campaignArtChecksumOrNull'], '$.campaignArtChecksumOrNull');
  const groupIds: string[] = [],
    memberIds: string[] = [];
  const members = new Map<
    string,
    {
      groupId: string;
      name: string;
      lifecycleState: 'ACTIVE' | 'PROPOSED';
      location: AdmissionLocationAssignment;
    }
  >();
  const groups = r.list(row['groups'], '$.groups');
  for (const entry of groups) {
    const group = r.exact(entry, 'groupId nameOrNull members', '$.group');
    groupIds.push(r.uuid(group['groupId'], '$.groupId'));
    if (group['nameOrNull'] !== null) r.text(group['nameOrNull'], '$.nameOrNull');
    for (const entry of r.list(group['members'], '$.members')) {
      const member = r.exact(entry, 'campaignCharacterId name lifecycleState location', '$.member');
      memberIds.push(r.uuid(member['campaignCharacterId'], '$.campaignCharacterId'));
      r.text(member['name'], '$.name');
      r.oneOf(member['lifecycleState'], ['ACTIVE', 'PROPOSED'] as const, '$.lifecycleState');
      admissionLocationAssignmentValue(member['location'], '$.location');
      members.set(member['campaignCharacterId'] as string, {
        groupId: group['groupId'] as string,
        name: member['name'] as string,
        lifecycleState: member['lifecycleState'] as 'ACTIVE' | 'PROPOSED',
        location: member['location'] as AdmissionLocationAssignment,
      });
    }
  }
  r.unique(groupIds, '$.groups');
  r.unique(memberIds, '$.members');
  if (variant === 'PRE_START')
    w.literal(row['activePeaceSceneOrNull'], null, '$.activePeaceSceneOrNull');
  else {
    const scene = campaignPeaceSceneValue(row['activePeaceSceneOrNull']);
    equal(scene.campaignId, row['campaignId'], '$.scene.campaignId');
    for (const copy of scene.includedCopies)
      if (!memberIds.includes(copy.campaignCharacterId) || !groupIds.includes(copy.groupId))
        r.invalid('$.scene', 'preserved groups and members', null);
  }
  const capacity = r.integer(row['activePlayerCapacity'], '$.activePlayerCapacity', 1);
  if (capacity > 5) r.invalid('$.activePlayerCapacity', 'Q-CAMP-001 capacity', null);
  const activeIds: string[] = [],
    activeDevices: string[] = [];
  for (const entry of r.list(row['activeCampaignCharacters'], '$.activeCampaignCharacters')) {
    const copy = r.exact(entry, 'campaignCharacterId name groupId deviceId', '$.activeCopy');
    const id = r.uuid(copy['campaignCharacterId'], '$.campaignCharacterId');
    activeIds.push(id);
    r.text(copy['name'], '$.name');
    if (!memberIds.includes(id) || !groupIds.includes(r.uuid(copy['groupId'], '$.groupId')))
      r.invalid('$.activeCopy', 'existing member and group', null);
    const member = members.get(id);
    if (
      member === undefined ||
      member.lifecycleState !== 'ACTIVE' ||
      member.groupId !== copy['groupId'] ||
      member.name !== copy['name']
    )
      r.invalid('$.activeCopy', 'exact ACTIVE member', null);
    activeDevices.push(r.uuid(copy['deviceId'], '$.deviceId'));
  }
  r.unique(activeIds, '$.activeCampaignCharacters');
  equal(
    activeIds,
    [...members]
      .filter(([, member]) => member.lifecycleState === 'ACTIVE')
      .map(([id]) => id)
      .sort(),
    '$.activeCampaignCharacters',
  );
  if (activeIds.length > capacity)
    r.invalid('$.activeCampaignCharacters', 'ACTIVE PCs within capacity', null);
  const devices = ids(row['controllingDevices'], '$.controllingDevices');
  equal(devices, [...new Set(activeDevices)].sort(), '$.controllingDevices');
  const ready = r.list(row['readyByDevice'], '$.readyByDevice');
  const readyIds: string[] = [];
  for (const entry of ready) {
    const proof = r.exact(entry, 'deviceId includedCampaignCharacterIds ready', '$.ready');
    const device = r.uuid(proof['deviceId'], '$.deviceId');
    readyIds.push(device);
    const expected = activeIds.filter((_id, index) => activeDevices[index] === device);
    equal(
      ids(proof['includedCampaignCharacterIds'], '$.includedCampaignCharacterIds'),
      expected,
      '$.includedCampaignCharacterIds',
    );
    bool(proof['ready'], '$.ready');
  }
  equal(readyIds, devices, '$.readyByDevice');
  const batches: string[] = [],
    batchCopies: string[] = [];
  for (const entry of r.list(row['admissionBatches'], '$.admissionBatches')) {
    const batch = r.exact(entry, 'admissionBatchId campaignCharacterIds', '$.batch');
    batches.push(r.uuid(batch['admissionBatchId'], '$.admissionBatchId'));
    batchCopies.push(...ids(batch['campaignCharacterIds'], '$.campaignCharacterIds'));
  }
  r.unique(batches, '$.admissionBatches');
  equal(batchCopies.sort(), [...memberIds].sort(), '$.admissionBatches.campaignCharacterIds');
  const blocked: string[] = [];
  for (const entry of r.list(row['requiredFieldBlockers'], '$.requiredFieldBlockers')) {
    const copy = r.exact(entry, 'campaignCharacterId blockers', '$.blockedCopy');
    const id = r.uuid(copy['campaignCharacterId'], '$.campaignCharacterId');
    blocked.push(id);
    if (!memberIds.includes(id) || activeIds.includes(id))
      r.invalid('$.blockedCopy', 'excluded admitted copy', null);
    const blockers = r.list(copy['blockers'], '$.blockers');
    if (blockers.length === 0) r.invalid('$.blockers', 'nonempty blockers', null);
    for (const value of blockers) {
      const blocker = r.exact(
        value,
        'kind reviewCopyIdOrNull campaignCharacterIdOrNull sourceEntryIdOrNull message',
        '$.blocker',
      );
      r.oneOf(
        blocker['kind'],
        ['MASS_PENDING', 'STARTING_PROPERTY_PENDING'] as const,
        '$.blocker.kind',
      );
      r.uuid(blocker['reviewCopyIdOrNull'], '$.blocker.reviewCopyIdOrNull');
      equal(blocker['campaignCharacterIdOrNull'], id, '$.blocker.campaignCharacterIdOrNull');
      if (blocker['sourceEntryIdOrNull'] !== null)
        r.text(blocker['sourceEntryIdOrNull'], '$.blocker.sourceEntryIdOrNull');
      r.text(blocker['message'], '$.blocker.message');
    }
  }
  r.unique(blocked, '$.requiredFieldBlockers');
  equal(
    [...blocked].sort(),
    [...members]
      .filter(([, member]) => member.lifecycleState === 'PROPOSED')
      .map(([id]) => id)
      .sort(),
    '$.requiredFieldBlockers',
  );
  equal(
    row['lobbySummary'],
    {
      activePcCount: activeIds.length,
      blockedPcCount: blocked.length,
      readyDeviceCount: ready.filter((entry) => (entry as { ready: boolean }).ready).length,
    },
    '$.lobbySummary',
  );
  lobbySnapshotRevisionValue(row['lobbySnapshotRevision']);
  r.integer(row['readinessRevision'], '$.readinessRevision', 0);
  equal(
    row['initialTimeInput'],
    { dayNumber: null, hour: null, minute: null },
    '$.initialTimeInput',
  );
  const time = row['initialCampaignTimeOrNull'];
  if (time !== null) {
    const v = r.exact(time, 'dayNumber hour minute campaignTimestamp', '$.initialCampaignTime');
    equal(
      time,
      initialCampaignTimeValue({ dayNumber: v['dayNumber'], hour: v['hour'], minute: v['minute'] }),
      '$.initialCampaignTime',
    );
  }
  if (variant === 'STARTED_PEACE') {
    const scene = campaignPeaceSceneValue(row['activePeaceSceneOrNull']);
    const initial = initialCampaignTimeValue(
      time === null
        ? null
        : {
            dayNumber: (time as InitialCampaignTime).dayNumber,
            hour: (time as InitialCampaignTime).hour,
            minute: (time as InitialCampaignTime).minute,
          },
    );
    equal(scene.campaignTimestamp, initial.campaignTimestamp, '$.scene.campaignTimestamp');
    equal(
      scene.includedCopies.map((copy) => copy.campaignCharacterId),
      activeIds,
      '$.scene.includedCopies',
    );
    for (const [index, copy] of scene.includedCopies.entries()) {
      const member = members.get(copy.campaignCharacterId)!;
      equal(copy.groupId, member.groupId, '$.scene.groupId');
      equal(copy.location, member.location, '$.scene.location');
      equal(copy.controller.deviceId, activeDevices[index], '$.scene.controller.deviceId');
    }
    if (!ready.every((entry) => (entry as { ready: boolean }).ready))
      r.invalid('$.readyByDevice', 'all included devices confirmed at Start', null);
  }
  const preflight =
    variant === 'STARTED_PEACE'
      ? 'STARTED'
      : activeIds.length === 0
        ? 'ZERO_ACTIVE_PLAYERS'
        : time !== null && ready.every((entry) => (entry as { ready: boolean }).ready)
          ? 'READY_TO_START'
          : 'NOT_READY';
  w.literal(row['startPreflightStatus'], preflight, '$.startPreflightStatus');
  bool(row['conflictingOperationPending'], '$.conflictingOperationPending');
  w.literal(row['commandId'], null, '$.commandId');
  return w.validated(row);
}

export type PeaceCondition = Pick<
  AdmissionInitialRuntime,
  | 'alive'
  | 'conscious'
  | 'stunned'
  | 'bound'
  | 'burning'
  | 'poisoned'
  | 'diseased'
  | 'wounds'
  | 'injuries'
  | 'bleeding'
>;
export const peaceCondition = (runtime: AdmissionInitialRuntime): PeaceCondition => ({
  alive: runtime.alive,
  conscious: runtime.conscious,
  stunned: runtime.stunned,
  bound: runtime.bound,
  burning: runtime.burning,
  poisoned: runtime.poisoned,
  diseased: runtime.diseased,
  wounds: runtime.wounds,
  injuries: runtime.injuries,
  bleeding: runtime.bleeding,
});
export interface CampaignPeaceProjection extends RevisionVector {
  readonly requestIdOrNull: string;
  readonly admissionBatchId: string;
  readonly networkScopeId: string;
  readonly deviceId: string;
  readonly controllerSeat: string;
  readonly technicalSessionAvailable: boolean;
  readonly pendingCommandIdOrNull: string | null;
  readonly itemLabels: readonly { itemTypeId: string; name: string }[];
  readonly groupLabels: readonly AdmissionGroupLabel[];
  readonly groupNameOrNull: string | null;
  readonly contextId: string;
  readonly campaignId: string;
  readonly campaignCharacterId: string;
  readonly projectionVariant: 'PEACE_SNAPSHOT';
  readonly sceneId: string;
  readonly mechanicalSheet: AdmissionMechanicalSheetV1;
  readonly currentHP: number;
  readonly maxHP: number;
  readonly derivedCondition: PeaceCondition;
  readonly symbionts: AdmissionMechanicalSheetV1['symbionts'];
  readonly temporaryEffects: AdmissionInitialRuntime['temporaryEffects'];
  readonly campaignTimestamp: number;
  readonly clockMode: 'STOPPED';
  readonly dayPhase: 'DAY' | 'NIGHT';
  readonly groupId: string;
  readonly location: AdmissionLocationAssignment;
  readonly effectiveController: AdmissionControllerBinding;
  readonly ownMarkerVisibility: 'UNKNOWN';
  readonly markerReason: 'NOT_SET';
}
export function campaignPeaceProjectionValue(value: unknown): CampaignPeaceProjection {
  const row = r.exact(
    value,
    'requestIdOrNull admissionBatchId networkScopeId deviceId controllerSeat technicalSessionAvailable pendingCommandIdOrNull itemLabels groupLabels groupNameOrNull contextId campaignId campaignCharacterId stateRevision projectionRevision actorVisibilityRevision projectionVariant sceneId mechanicalSheet currentHP maxHP derivedCondition symbionts temporaryEffects campaignTimestamp clockMode dayPhase groupId location effectiveController ownMarkerVisibility markerReason',
    '$.peaceSnapshot',
  );
  common(row);
  w.literal(row['projectionVariant'], 'PEACE_SNAPSHOT', '$.projectionVariant');
  for (const key of ['campaignCharacterId', 'sceneId', 'groupId']) r.uuid(row[key], `$.${key}`);
  const sheet = admissionMechanicalSheetValue(row['mechanicalSheet']);
  for (const key of [
    'requestIdOrNull',
    'admissionBatchId',
    'networkScopeId',
    'deviceId',
    'controllerSeat',
  ])
    r.uuid(row[key], '$.' + key);
  bool(row['technicalSessionAvailable'], '$.technicalSessionAvailable');
  if (row['pendingCommandIdOrNull'] !== null)
    r.uuid(row['pendingCommandIdOrNull'], '$.pendingCommandIdOrNull');
  if (row['groupNameOrNull'] !== null) r.text(row['groupNameOrNull'], '$.groupNameOrNull');
  const expectedItems = [
      ...new Set(
        sheet.inventoryReview.entries.flatMap((entry) =>
          entry.item.kind === 'CATALOG' ? [entry.item.itemTypeId] : [],
        ),
      ),
    ].sort(),
    actualItems: string[] = [];
  for (const entry of r.list(row['itemLabels'], '$.itemLabels')) {
    const item = r.exact(entry, 'itemTypeId name', '$.item');
    actualItems.push(r.text(item['itemTypeId'], '$.itemTypeId'));
    r.text(item['name'], '$.name');
  }
  equal(actualItems.sort(), expectedItems, '$.itemLabels');
  const requiredGroups =
    sheet.groupAssignmentOrNull?.kind === 'EXISTING' ? [sheet.groupAssignmentOrNull.groupId] : [];
  admissionGroupLabelsValue(row['groupLabels'], requiredGroups);
  equal(row['currentHP'], sheet.runtime.currentHp, '$.currentHP');
  equal(row['maxHP'], sheet.runtime.maxHp, '$.maxHP');
  equal(row['derivedCondition'], peaceCondition(sheet.runtime), '$.derivedCondition');
  equal(row['symbionts'], sheet.symbionts, '$.symbionts');
  equal(row['temporaryEffects'], sheet.runtime.temporaryEffects, '$.temporaryEffects');
  const timestamp = r.integer(row['campaignTimestamp'], '$.campaignTimestamp', 0);
  w.literal(row['clockMode'], 'STOPPED', '$.clockMode');
  w.literal(row['dayPhase'], campaignDayPhase(timestamp), '$.dayPhase');
  admissionLocationAssignmentValue(row['location'], '$.location');
  equal(row['location'], sheet.locationAssignmentOrNull, '$.location');
  const controller = r.exact(
    row['effectiveController'],
    'campaignCharacterId deviceId localControllerSeatId inputLaneId',
    '$.effectiveController',
  );
  for (const key of ['campaignCharacterId', 'deviceId', 'localControllerSeatId', 'inputLaneId'])
    r.uuid(controller[key], `$.effectiveController.${key}`);
  equal(
    controller['campaignCharacterId'],
    row['campaignCharacterId'],
    '$.effectiveController.campaignCharacterId',
  );
  equal(
    controller['inputLaneId'],
    controller['localControllerSeatId'],
    '$.effectiveController.inputLaneId',
  );
  equal(controller['deviceId'], row['deviceId'], '$.effectiveController.deviceId');
  equal(
    controller['localControllerSeatId'],
    row['controllerSeat'],
    '$.effectiveController.localControllerSeatId',
  );
  w.literal(row['ownMarkerVisibility'], 'UNKNOWN', '$.ownMarkerVisibility');
  w.literal(row['markerReason'], 'NOT_SET', '$.markerReason');
  return w.validated(row);
}

/** An exact action allowlist is checked by both projection producer and browser. */
export function campaignLobbyGmActions(
  form: CampaignLobbyGmForm,
  p: CampaignLobbyGmProjection,
  supported: readonly WorkflowCommandCapabilityId[],
): readonly ActionKey[] {
  if (p.conflictingOperationPending) return [];
  if (form === 'CMP-007')
    return p.panelVariant === 'PRE_START'
      ? [
          'CMP-007::CTA::001',
          'CMP-007::CTA::006',
          ...(supported.includes('UI-CMD-CAMPAIGN-SETTINGS-SET')
            ? ['CMP-007::CTA::003' as const]
            : []),
          'CMP-007::CTA::004',
        ]
      : [
          ...(supported.includes('UI-CMD-CAMPAIGN-SETTINGS-SET')
            ? ['CMP-007::CTA::003' as const]
            : []),
          'CMP-007::CTA::004',
        ];
  if (form === 'GM-001') return ['GM-001::CTA::006', 'GM-001::CTA::013'];
  if (form === 'GRP-001') return ['GRP-001::CTA::009'];
  if (p.panelVariant !== 'PRE_START') r.invalid('$.formId', 'pre-Start NET-016', null);
  return [
    'NET-016::CTA::001',
    ...(supported.includes('UI-CMD-CAMPAIGN-INITIAL-TIME-SET')
      ? ['NET-016::CTA::004' as const]
      : []),
    ...(p.startPreflightStatus === 'READY_TO_START' && supported.includes('UI-CMD-CAMPAIGN-START')
      ? ['NET-016::CTA::002' as const]
      : []),
  ];
}
export type CampaignLobbyGmRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CAMPAIGN-INITIAL-TIME-SET' | 'UI-CMD-CAMPAIGN-START'
>;
export function campaignLobbyGmRequest(
  p: CampaignLobbyGmProjection,
  action: ActionKey,
  commandId: string,
  time: InitialCampaignTimeInput | null,
): CampaignLobbyGmRequest {
  const workflowCommandId =
    action === 'NET-016::CTA::004'
      ? 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET'
      : action === 'NET-016::CTA::002'
        ? 'UI-CMD-CAMPAIGN-START'
        : r.invalid('$.action', 'time or Start', null);
  const request = campaignLobbyCommandValue({
    workflowCommandId,
    commandId,
    campaignId: p.campaignId,
    expectedLobbySnapshotRevision: p.lobbySnapshotRevision,
    ...(workflowCommandId === 'UI-CMD-CAMPAIGN-START'
      ? { expectedReadinessRevision: p.readinessRevision }
      : time),
  });
  const { workflowCommandId: _workflow, commandId: _command, ...payload } = request;
  return {
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    workflowCommandId,
    commandId,
    expectedRevisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
    payload,
  };
}
export function campaignLobbyGmReceipt(
  receipt: CommandReceipt,
  request: CampaignLobbyGmRequest,
  source: CampaignLobbyGmProjection,
): CommandReceipt {
  const start = request.workflowCommandId === 'UI-CMD-CAMPAIGN-START';
  const value = r.exact(
    receipt.result,
    'contextId receiptId commandId campaignId lobbySnapshotRevision readinessRevision committedAt workflowCommandId ' +
      (start ? 'scene campaignRevision checkpointSha256' : 'initialCampaignTime'),
    '$.receipt.result',
  );
  for (const key of ['receiptId', 'commandId', 'campaignId', 'contextId'])
    r.uuid(value[key], '$.receipt.' + key);
  equal(value['contextId'], source.contextId, '$.contextId');
  equal(value['campaignId'], source.campaignId, '$.campaignId');
  equal(value['workflowCommandId'], request.workflowCommandId, '$.workflowCommandId');
  equal(value['commandId'], request.commandId, '$.commandId');
  equal(receipt.commandId, request.commandId, '$.commandId');
  equal(receipt.receiptId, value['receiptId'], '$.receiptId');
  lobbySnapshotRevisionValue(value['lobbySnapshotRevision']);
  r.integer(value['readinessRevision'], '$.readinessRevision', 0);
  r.text(value['committedAt'], '$.committedAt');
  equal(
    receipt.revisions,
    {
      stateRevision: request.expectedRevisions.stateRevision + 1,
      projectionRevision: request.expectedRevisions.projectionRevision + 1,
      actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision + (start ? 1 : 0),
    },
    '$.revisions',
  );
  if (start) {
    const scene = parseScene(value['scene']);
    equal(scene.campaignId, source.campaignId, '$.scene.campaignId');
    equal(value['lobbySnapshotRevision'], source.lobbySnapshotRevision, '$.lobbySnapshotRevision');
    equal(value['readinessRevision'], source.readinessRevision, '$.readinessRevision');
    equal(
      scene.campaignTimestamp,
      source.initialCampaignTimeOrNull?.campaignTimestamp,
      '$.scene.campaignTimestamp',
    );
    equal(
      scene.includedCopies.map((copy) => copy.campaignCharacterId),
      source.activeCampaignCharacters.map((copy) => copy.campaignCharacterId),
      '$.includedCopies',
    );
    for (const member of scene.includedCopies) {
      const active = source.activeCampaignCharacters.find(
        (copy) => copy.campaignCharacterId === member.campaignCharacterId,
      )!;
      const group = source.groups.find((group) => group.groupId === active.groupId),
        copy = group?.members.find(
          (copy) => copy.campaignCharacterId === member.campaignCharacterId,
        );
      if (copy === undefined) r.invalid('$.scene', 'source member', null);
      equal(member.groupId, active.groupId, '$.scene.groupId');
      equal(member.location, copy!.location, '$.scene.location');
      equal(member.controller.deviceId, active.deviceId, '$.scene.controller.deviceId');
    }
    r.integer(value['campaignRevision'], '$.campaignRevision', 1);
    lobbySnapshotRevisionValue(value['checkpointSha256']);
  } else
    equal(
      value['initialCampaignTime'],
      initialCampaignTimeValue({
        dayNumber: request.payload['dayNumber'],
        hour: request.payload['hour'],
        minute: request.payload['minute'],
      }),
      '$.initialCampaignTime',
    );
  return receipt;
}
export function campaignLobbyGmReceiptDestination(
  form: string,
  p: JsonObject,
  receipt: CommandReceipt,
  later: boolean,
): boolean {
  if (
    p[form === 'CMP-006' ? 'gmLocalContextId' : 'contextId'] !== receipt.result['contextId'] ||
    p['campaignId'] !== receipt.result['campaignId']
  )
    return false;
  if (later) return true;
  if (receipt.result['workflowCommandId'] === 'UI-CMD-CAMPAIGN-START')
    return (
      form === 'GM-001' && admissionJsonEqual(p['activePeaceSceneOrNull'], receipt.result['scene'])
    );
  return (
    form === 'NET-016' &&
    admissionJsonEqual(p['initialCampaignTimeOrNull'], receipt.result['initialCampaignTime']) &&
    p['lobbySnapshotRevision'] === receipt.result['lobbySnapshotRevision']
  );
}

/** The remote host sends one admitted sheet. Device-wide roster summaries contain no other sheet. */
export interface CampaignLobbyOwnerObservation {
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly ownerDeviceId: string;
  readonly campaignRevision: number;
  readonly lobbyEventRevision: number;
  readonly lobbySnapshotRevision: string;
  readonly readinessRevision: number;
  readonly initialCampaignTimeOrNull: InitialCampaignTime | null;
  readonly campaignStarted: boolean;
  readonly ownCopies: readonly {
    readonly campaignCharacterId: string;
    readonly name: string;
    readonly lifecycleState: 'ACTIVE' | 'PROPOSED';
    readonly blockers: readonly AdmissionBlocker[];
  }[];
  readonly includedCampaignCharacterIds: readonly string[];
  readonly ready: boolean;
  readonly selectedCopy: CampaignLobbyCopy;
  readonly groupNameOrNull: string | null;
  readonly peaceOrNull: Readonly<{
    sceneId: string;
    campaignTimestamp: number;
    clockMode: 'STOPPED';
    dayPhase: 'DAY' | 'NIGHT';
  }> | null;
}
function ownerBlockers(value: unknown, id: string): readonly AdmissionBlocker[] {
  const blockers = r.list(value, '$.blockers');
  for (const value of blockers) {
    const b = r.exact(
      value,
      'kind reviewCopyIdOrNull campaignCharacterIdOrNull sourceEntryIdOrNull message',
      '$.blocker',
    );
    r.oneOf(b['kind'], ['MASS_PENDING', 'STARTING_PROPERTY_PENDING'] as const, '$.blocker.kind');
    r.uuid(b['reviewCopyIdOrNull'], '$.reviewCopyIdOrNull');
    equal(b['campaignCharacterIdOrNull'], id, '$.blocker.campaignCharacterIdOrNull');
    if (b['sourceEntryIdOrNull'] !== null)
      r.text(b['sourceEntryIdOrNull'], '$.sourceEntryIdOrNull');
    r.text(b['message'], '$.message');
  }
  return w.validated(blockers);
}
export function campaignLobbyOwnerObservationValue(value: unknown): CampaignLobbyOwnerObservation {
  const row = r.exact(
    value,
    'schemaVersion campaignId ownerDeviceId campaignRevision lobbyEventRevision lobbySnapshotRevision readinessRevision initialCampaignTimeOrNull campaignStarted ownCopies includedCampaignCharacterIds ready selectedCopy groupNameOrNull peaceOrNull',
    '$.ownerLobby',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  for (const key of ['campaignId', 'ownerDeviceId']) r.uuid(row[key], '$.' + key);
  for (const key of ['campaignRevision', 'lobbyEventRevision', 'readinessRevision'])
    r.integer(row[key], '$.' + key, 0);
  lobbySnapshotRevisionValue(row['lobbySnapshotRevision']);
  bool(row['campaignStarted'], '$.campaignStarted');
  bool(row['ready'], '$.ready');
  let time: InitialCampaignTime | null = null;
  if (row['initialCampaignTimeOrNull'] !== null) {
    const input = r.exact(
      row['initialCampaignTimeOrNull'],
      'dayNumber hour minute campaignTimestamp',
      '$.initialCampaignTimeOrNull',
    );
    time = initialCampaignTimeValue({
      dayNumber: input['dayNumber'],
      hour: input['hour'],
      minute: input['minute'],
    });
    equal(time, input, '$.initialCampaignTimeOrNull');
  }
  const copies = r.list(row['ownCopies'], '$.ownCopies');
  if (copies.length < 1 || copies.length > 5)
    r.invalid('$.ownCopies', 'admitted device copies', null);
  const allIds: string[] = [],
    activeIds: string[] = [];
  for (const value of copies) {
    const copy = r.exact(value, 'campaignCharacterId name lifecycleState blockers', '$.ownCopy'),
      id = r.uuid(copy['campaignCharacterId'], '$.campaignCharacterId');
    allIds.push(id);
    r.text(copy['name'], '$.name');
    r.oneOf(copy['lifecycleState'], ['ACTIVE', 'PROPOSED'] as const, '$.lifecycleState');
    const blockers = ownerBlockers(copy['blockers'], id);
    if ((copy['lifecycleState'] === 'ACTIVE') !== (blockers.length === 0))
      r.invalid('$.ownCopy', 'ACTIVE or blocked PROPOSED', null);
    if (copy['lifecycleState'] === 'ACTIVE') activeIds.push(id);
  }
  r.unique(allIds, '$.ownCopies');
  equal(allIds, [...allIds].sort(), '$.ownCopies');
  equal(
    ids(row['includedCampaignCharacterIds'], '$.includedCampaignCharacterIds'),
    activeIds,
    '$.includedCampaignCharacterIds',
  );
  if (activeIds.length === 0 && row['ready'] !== false)
    r.invalid('$.ready', 'nonempty included device set', null);
  const copy = r.exact(
    row['selectedCopy'],
    'campaignCharacterId groupId location controller admissionBatchId name lifecycleState blockers sheet',
    '$.selectedCopy',
  );
  for (const key of ['campaignCharacterId', 'groupId', 'admissionBatchId'])
    r.uuid(copy[key], '$.selectedCopy.' + key);
  const id = copy['campaignCharacterId'] as string,
    summary = copies.find(
      (value) => (value as { campaignCharacterId: string }).campaignCharacterId === id,
    );
  if (summary === undefined) r.invalid('$.selectedCopy', 'own admitted copy', null);
  equal(
    summary,
    {
      campaignCharacterId: id,
      name: copy['name'],
      lifecycleState: copy['lifecycleState'],
      blockers: copy['blockers'],
    },
    '$.selectedCopy',
  );
  const sheet = admissionMechanicalSheetValue(copy['sheet']);
  admissionLocationAssignmentValue(copy['location'], '$.location');
  equal(copy['location'], sheet.locationAssignmentOrNull, '$.location');
  const controller = r.exact(
    copy['controller'],
    'campaignCharacterId deviceId localControllerSeatId inputLaneId',
    '$.controller',
  );
  equal(controller['campaignCharacterId'], id, '$.controller.campaignCharacterId');
  equal(controller['deviceId'], row['ownerDeviceId'], '$.controller.deviceId');
  r.uuid(controller['localControllerSeatId'], '$.controller.localControllerSeatId');
  equal(controller['inputLaneId'], controller['localControllerSeatId'], '$.controller.inputLaneId');
  if (row['groupNameOrNull'] !== null) r.text(row['groupNameOrNull'], '$.groupNameOrNull');
  const included = copy['lifecycleState'] === 'ACTIVE',
    started = row['campaignStarted'] === true;
  if (started && time === null)
    r.invalid('$.initialCampaignTimeOrNull', 'confirmed Start time', null);
  if (started && activeIds.length > 0 && row['ready'] !== true)
    r.invalid('$.ready', 'device proof at Start', null);
  if (!started || !included) w.literal(row['peaceOrNull'], null, '$.peaceOrNull');
  else {
    const scene = r.exact(
      row['peaceOrNull'],
      'sceneId campaignTimestamp clockMode dayPhase',
      '$.peaceOrNull',
    );
    r.uuid(scene['sceneId'], '$.sceneId');
    equal(scene['campaignTimestamp'], time!.campaignTimestamp, '$.campaignTimestamp');
    w.literal(scene['clockMode'], 'STOPPED', '$.clockMode');
    w.literal(scene['dayPhase'], campaignDayPhase(time!.campaignTimestamp), '$.dayPhase');
  }
  return w.validated(row);
}
export type CampaignReadyBrowserRequest =
  WorkflowCommandRequestMessage<'UI-CMD-CAMPAIGN-READY-SET'>;
export function campaignReadyBrowserRequestValue(value: unknown): CampaignReadyBrowserRequest {
  const row = r.exact(
    value,
    'messageType protocolVersion commandKind role commandId workflowCommandId expectedRevisions payload',
    '$.readyRequest',
  );
  w.literal(row['messageType'], 'command.request', '$.messageType');
  w.literal(row['protocolVersion'], 1, '$.protocolVersion');
  w.literal(row['commandKind'], 'workflow-command', '$.commandKind');
  w.literal(row['role'], 'player', '$.role');
  w.literal(row['workflowCommandId'], 'UI-CMD-CAMPAIGN-READY-SET', '$.workflowCommandId');
  w.revisions(row['expectedRevisions'], '$.expectedRevisions');
  const payload = r.exact(
    row['payload'],
    'campaignId expectedLobbySnapshotRevision ready',
    '$.payload',
  );
  campaignLobbyCommandValue({
    ...payload,
    commandId: row['commandId'],
    workflowCommandId: row['workflowCommandId'],
  });
  return w.validated(row);
}

export interface CampaignLobbyPlayerProjection extends RevisionVector {
  readonly requestIdOrNull: string;
  readonly contextId: string;
  readonly networkScopeId: string;
  readonly deviceId: string;
  readonly controllerSeat: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly projectionVariant: 'LOBBY_SNAPSHOT';
  readonly ownCampaignCopies: readonly AdmissionPlayerCopyResult[];
  readonly controllerBindings: readonly AdmissionControllerBinding[];
  readonly blockers: readonly AdmissionBlocker[];
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly readyStatus: 'READY' | 'NOT_READY';
  readonly startStatus: 'STARTED' | 'NOT_STARTED';
  readonly lobby: CampaignLobbyOwnerObservation;
  readonly pendingCommandIdOrNull: string | null;
  readonly technicalSessionAvailable: boolean;
}
export function campaignLobbyPlayerProjectionValue(value: unknown): CampaignLobbyPlayerProjection {
  const row = r.exact(
    value,
    'requestIdOrNull contextId networkScopeId deviceId controllerSeat campaignId admissionBatchId projectionVariant ownCampaignCopies controllerBindings blockers campaignStatus readyStatus startStatus lobby pendingCommandIdOrNull technicalSessionAvailable stateRevision projectionRevision actorVisibilityRevision',
    '$.playerLobby',
  );
  common(row);
  for (const key of [
    'requestIdOrNull',
    'networkScopeId',
    'deviceId',
    'controllerSeat',
    'admissionBatchId',
  ])
    r.uuid(row[key], '$.' + key);
  w.literal(row['projectionVariant'], 'LOBBY_SNAPSHOT', '$.projectionVariant');
  const lobby = campaignLobbyOwnerObservationValue(row['lobby']);
  equal(row['campaignId'], lobby.campaignId, '$.campaignId');
  equal(row['deviceId'], lobby.ownerDeviceId, '$.deviceId');
  equal(
    row['controllerSeat'],
    lobby.selectedCopy.controller.localControllerSeatId,
    '$.controllerSeat',
  );
  equal(row['admissionBatchId'], lobby.selectedCopy.admissionBatchId, '$.admissionBatchId');
  if (lobby.peaceOrNull !== null)
    r.invalid('$.lobby', 'own included character enters PLY-001', null);
  w.literal(
    row['campaignStatus'],
    lobby.campaignStarted ? 'HOSTING' : 'PAUSED',
    '$.campaignStatus',
  );
  w.literal(row['readyStatus'], lobby.ready ? 'READY' : 'NOT_READY', '$.readyStatus');
  w.literal(row['startStatus'], lobby.campaignStarted ? 'STARTED' : 'NOT_STARTED', '$.startStatus');
  bool(row['technicalSessionAvailable'], '$.technicalSessionAvailable');
  if (row['pendingCommandIdOrNull'] !== null)
    r.uuid(row['pendingCommandIdOrNull'], '$.pendingCommandIdOrNull');
  const copies = r.list(row['ownCampaignCopies'], '$.ownCampaignCopies'),
    copyIds: string[] = [],
    bindings: unknown[] = [],
    blockers: AdmissionBlocker[] = [];
  if (copies.length < 1 || copies.length > 3)
    r.invalid('$.ownCampaignCopies', 'one to three admitted batch copies', null);
  for (const entry of copies) {
    const copy = r.exact(
        entry,
        'campaignCharacterId lifecycleState occupiesCampaignPlace groupIdOrNull locationAssignmentOrNull controllerBindingOrNull',
        '$.copy',
      ),
      id = r.uuid(copy['campaignCharacterId'], '$.campaignCharacterId');
    copyIds.push(id);
    const summary = lobby.ownCopies.find((copy) => copy.campaignCharacterId === id);
    if (summary === undefined) r.invalid('$.copy', 'own device copy', null);
    equal(copy['lifecycleState'], summary!.lifecycleState, '$.lifecycleState');
    w.literal(copy['occupiesCampaignPlace'], true, '$.occupiesCampaignPlace');
    r.uuid(copy['groupIdOrNull'], '$.groupIdOrNull');
    admissionLocationAssignmentValue(
      copy['locationAssignmentOrNull'],
      '$.locationAssignmentOrNull',
    );
    const binding = r.exact(
      copy['controllerBindingOrNull'],
      'campaignCharacterId deviceId localControllerSeatId inputLaneId',
      '$.binding',
    );
    equal(binding['campaignCharacterId'], id, '$.binding.campaignCharacterId');
    equal(binding['deviceId'], lobby.ownerDeviceId, '$.binding.deviceId');
    r.uuid(binding['localControllerSeatId'], '$.localControllerSeatId');
    equal(binding['inputLaneId'], binding['localControllerSeatId'], '$.inputLaneId');
    bindings.push(binding);
    blockers.push(...summary!.blockers);
    if (id === lobby.selectedCopy.campaignCharacterId) {
      equal(
        copy['controllerBindingOrNull'],
        lobby.selectedCopy.controller,
        '$.selectedCopy.controller',
      );
      equal(copy['groupIdOrNull'], lobby.selectedCopy.groupId, '$.selectedCopy.groupId');
      equal(
        copy['locationAssignmentOrNull'],
        lobby.selectedCopy.location,
        '$.selectedCopy.location',
      );
    }
  }
  r.unique(copyIds, '$.ownCampaignCopies');
  if (!copyIds.includes(lobby.selectedCopy.campaignCharacterId))
    r.invalid('$.ownCampaignCopies', 'selected admitted copy', null);
  equal(row['controllerBindings'], bindings, '$.controllerBindings');
  equal(row['blockers'], blockers, '$.blockers');
  return w.validated(row);
}
export function campaignLobbyPlayerActions(
  p: CampaignLobbyPlayerProjection,
  supported: readonly string[],
): readonly ActionKey[] {
  if (p.pendingCommandIdOrNull !== null) return [];
  return [
    'NET-006::CTA::001',
    ...(!p.lobby.campaignStarted &&
    p.lobby.includedCampaignCharacterIds.length > 0 &&
    p.technicalSessionAvailable &&
    supported.includes('UI-CMD-CAMPAIGN-READY-SET')
      ? [p.lobby.ready ? ('NET-006::CTA::004' as const) : ('NET-006::CTA::003' as const)]
      : []),
  ];
}

export const isCampaignOwnerProjection = (value: JsonObject): boolean =>
  value['projectionVariant'] === 'LOBBY_SNAPSHOT' ||
  value['projectionVariant'] === 'PEACE_SNAPSHOT';
