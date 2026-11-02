import type {
  AdmissionLocationAssignment,
  AdmissionMechanicalSheetV1,
} from './campaign-admission.js';
import type {
  AdmissionBlocker,
  AdmissionControllerBinding,
} from './campaign-admission-proposal.js';
import {
  admissionCodecReaders as r,
  admissionLocationAssignmentValue,
} from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';

/** ADR 0073: these capabilities extend the existing campaign authority and transport. */
export const CAMPAIGN_LOBBY_WORKFLOW_IDS = [
  'UI-CMD-CAMPAIGN-READY-SET',
  'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
  'UI-CMD-CAMPAIGN-START',
] as const;
export const CAMPAIGN_LOBBY_GM_FORMS = ['CMP-007', 'NET-016', 'GM-001', 'GRP-001'] as const;
export type CampaignLobbyGmForm = (typeof CAMPAIGN_LOBBY_GM_FORMS)[number];
export const isCampaignLobbyGmForm = (value: string): value is CampaignLobbyGmForm =>
  (CAMPAIGN_LOBBY_GM_FORMS as readonly string[]).includes(value);

export interface InitialCampaignTimeInput {
  readonly dayNumber: number;
  readonly hour: number;
  readonly minute: number;
}
export interface InitialCampaignTime extends InitialCampaignTimeInput {
  readonly campaignTimestamp: number;
}
export type CampaignDayPhase = 'DAY' | 'NIGHT';
interface CommandScope {
  readonly commandId: string;
  readonly campaignId: string;
  readonly expectedLobbySnapshotRevision: string;
}
export type CampaignLobbyCommand = CommandScope &
  (
    | { readonly workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET'; readonly ready: boolean }
    | ({
        readonly workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET';
      } & InitialCampaignTimeInput)
    | {
        readonly workflowCommandId: 'UI-CMD-CAMPAIGN-START';
        readonly expectedReadinessRevision: number;
      }
  );

export interface CampaignPeaceMember {
  readonly campaignCharacterId: string;
  readonly groupId: string;
  readonly location: AdmissionLocationAssignment;
  readonly controller: AdmissionControllerBinding;
}
/** No combat actor, marker, coordinates or inferred lighting is present in this variant. */
export interface CampaignPeaceScene {
  readonly schemaVersion: 1;
  readonly sceneId: string;
  readonly campaignId: string;
  readonly sceneContext: 'PEACE';
  readonly checkpointId: string;
  readonly includedCopies: readonly CampaignPeaceMember[];
  readonly campaignTimestamp: number;
  readonly clockMode: 'STOPPED';
  readonly dayPhase: CampaignDayPhase;
}
/** Private host input; projection builders explicitly select their permitted fields. */
export interface CampaignLobbyCopy extends CampaignPeaceMember {
  readonly admissionBatchId: string;
  readonly name: string;
  readonly lifecycleState: 'ACTIVE' | 'PROPOSED';
  readonly blockers: readonly AdmissionBlocker[];
  readonly sheet: AdmissionMechanicalSheetV1;
}
export interface CampaignReadyProof {
  readonly ownerDeviceId: string;
  readonly includedCampaignCharacterIds: readonly string[];
  readonly lobbySnapshotRevision: string;
  readonly ready: boolean;
}
interface ReceiptBase {
  readonly receiptId: string;
  readonly commandId: string;
  readonly campaignId: string;
  readonly lobbySnapshotRevision: string;
  readonly readinessRevision: number;
  readonly committedAt: string;
}
export type CampaignLobbyReceipt = ReceiptBase &
  (
    | ({ readonly workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET' } & CampaignReadyProof)
    | {
        readonly workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET';
        readonly initialCampaignTime: InitialCampaignTime;
      }
    | {
        readonly workflowCommandId: 'UI-CMD-CAMPAIGN-START';
        readonly scene: CampaignPeaceScene;
        readonly campaignRevision: number;
        readonly checkpointSha256: string;
      }
  );
export type CampaignStartPreflight =
  'ZERO_ACTIVE_PLAYERS' | 'NOT_READY' | 'READY_TO_START' | 'STARTED';

export function initialCampaignTimeValue(value: unknown): InitialCampaignTime {
  const row = r.exact(value, 'dayNumber hour minute', '$.initialCampaignTime');
  const dayNumber = r.integer(row['dayNumber'], '$.dayNumber', 1);
  const hour = r.integer(row['hour'], '$.hour', 0);
  const minute = r.integer(row['minute'], '$.minute', 0);
  // Approved virtual calendar, ADR 0073; never derived from the host's wall clock.
  const campaignTimestamp = (dayNumber - 1) * 1440 + hour * 60 + minute;
  if (hour > 23 || minute > 59 || !Number.isSafeInteger(campaignTimestamp))
    r.invalid(
      '$.initialCampaignTime',
      'explicit valid virtual day and minute without overflow',
      null,
    );
  return { dayNumber, hour, minute, campaignTimestamp };
}
export function campaignDayPhase(campaignTimestamp: number): CampaignDayPhase {
  r.integer(campaignTimestamp, '$.campaignTimestamp', 0);
  const minuteOfDay = campaignTimestamp % 1440;
  // AQ2-008: day begins at 06:00 and night begins at 21:00.
  return minuteOfDay >= 6 * 60 && minuteOfDay < 21 * 60 ? 'DAY' : 'NIGHT';
}
export function lobbySnapshotRevisionValue(
  value: unknown,
  path = '$.lobbySnapshotRevision',
): string {
  const text = r.text(value, path);
  return /^[0-9a-f]{64}$/u.test(text)
    ? text
    : r.invalid(path, 'exact lobby snapshot revision', null);
}
export function campaignPeaceSceneValue(value: unknown): CampaignPeaceScene {
  const row = r.exact(
    value,
    'schemaVersion sceneId campaignId sceneContext checkpointId includedCopies campaignTimestamp clockMode dayPhase',
    '$.peaceScene',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  w.literal(row['sceneContext'], 'PEACE', '$.sceneContext');
  w.literal(row['clockMode'], 'STOPPED', '$.clockMode');
  for (const key of ['sceneId', 'campaignId', 'checkpointId']) r.uuid(row[key], `$.${key}`);
  const timestamp = r.integer(row['campaignTimestamp'], '$.campaignTimestamp', 0);
  w.literal(row['dayPhase'], campaignDayPhase(timestamp), '$.dayPhase');
  const members = r.list(row['includedCopies'], '$.includedCopies');
  // Q-CAMP-001 limits a campaign to five active PCs; singleton Start requires at least one.
  if (members.length < 1 || members.length > 5)
    r.invalid('$.includedCopies', 'one to five included active PCs', null);
  const ids: string[] = [],
    seats: string[] = [],
    lanes: string[] = [];
  for (const member of members) {
    const copy = r.exact(
      member,
      'campaignCharacterId groupId location controller',
      '$.includedCopy',
    );
    const id = r.uuid(copy['campaignCharacterId'], '$.campaignCharacterId');
    ids.push(id);
    r.uuid(copy['groupId'], '$.groupId');
    admissionLocationAssignmentValue(copy['location'], '$.location');
    const controller = r.exact(
      copy['controller'],
      'campaignCharacterId deviceId localControllerSeatId inputLaneId',
      '$.controller',
    );
    for (const key of ['campaignCharacterId', 'deviceId', 'localControllerSeatId', 'inputLaneId'])
      r.uuid(controller[key], `$.controller.${key}`);
    w.literal(controller['campaignCharacterId'], id, '$.controller.campaignCharacterId');
    if (controller['inputLaneId'] !== controller['localControllerSeatId'])
      r.invalid('$.controller.inputLaneId', 'admitted local tab lane', null);
    seats.push(`${String(controller['deviceId'])}:${String(controller['localControllerSeatId'])}`);
    lanes.push(`${String(controller['deviceId'])}:${String(controller['inputLaneId'])}`);
  }
  for (const values of [ids, seats, lanes]) r.unique(values, '$.includedCopies');
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id))
    r.invalid('$.includedCopies', 'canonical character ID order', null);
  return w.validated(row);
}
/** Identities of devices, controllers and authority are deliberately absent from requests. */
export function campaignLobbyCommandValue(value: unknown): CampaignLobbyCommand {
  const row = w.record(value, '$.lobbyCommand');
  const workflow = r.oneOf(
    row['workflowCommandId'],
    CAMPAIGN_LOBBY_WORKFLOW_IDS,
    '$.workflowCommandId',
  );
  const extra =
    workflow === 'UI-CMD-CAMPAIGN-READY-SET'
      ? 'ready'
      : workflow === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET'
        ? 'dayNumber hour minute'
        : 'expectedReadinessRevision';
  r.exact(
    row,
    `workflowCommandId commandId campaignId expectedLobbySnapshotRevision ${extra}`,
    '$.lobbyCommand',
  );
  r.uuid(row['commandId'], '$.commandId');
  r.uuid(row['campaignId'], '$.campaignId');
  lobbySnapshotRevisionValue(
    row['expectedLobbySnapshotRevision'],
    '$.expectedLobbySnapshotRevision',
  );
  if (workflow === 'UI-CMD-CAMPAIGN-READY-SET') {
    if (typeof row['ready'] !== 'boolean') r.invalid('$.ready', 'boolean', null);
  } else if (workflow === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET') {
    initialCampaignTimeValue({
      dayNumber: row['dayNumber'],
      hour: row['hour'],
      minute: row['minute'],
    });
  } else r.integer(row['expectedReadinessRevision'], '$.expectedReadinessRevision', 0);
  return w.validated(row);
}

export const CAMPAIGN_LOBBY_GM_NAV_TARGETS = {
  'CMP-006::CTA::001': 'CMP-007',
  'CMP-007::CTA::001': 'NET-016',
  'CMP-007::CTA::004': 'GM-001',
  'CMP-007::CTA::006': 'CMP-006',
  'NET-016::CTA::001': 'CMP-007',
  'GM-001::CTA::006': 'GRP-001',
  'GM-001::CTA::013': 'CMP-007',
  'GRP-001::CTA::009': 'GM-001',
} as const;

export type CampaignReadyCommand = Extract<
  CampaignLobbyCommand,
  { workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET' }
>;
export type CampaignReadyReceipt = Extract<
  CampaignLobbyReceipt,
  { workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET' }
>;
export function campaignReadyReceiptValue(value: unknown): CampaignReadyReceipt {
  const row = r.exact(
    value,
    'receiptId commandId campaignId lobbySnapshotRevision readinessRevision committedAt workflowCommandId ownerDeviceId includedCampaignCharacterIds ready',
    '$.readyReceipt',
  );
  for (const key of ['receiptId', 'commandId', 'campaignId', 'ownerDeviceId'])
    r.uuid(row[key], '$.readyReceipt.' + key);
  w.literal(row['workflowCommandId'], 'UI-CMD-CAMPAIGN-READY-SET', '$.workflowCommandId');
  lobbySnapshotRevisionValue(row['lobbySnapshotRevision']);
  r.integer(row['readinessRevision'], '$.readinessRevision', 1);
  r.text(row['committedAt'], '$.committedAt');
  const ids = r
    .list(row['includedCampaignCharacterIds'], '$.includedCampaignCharacterIds')
    .map((id) => r.uuid(id, '$.campaignCharacterId'));
  if (
    ids.length < 1 ||
    ids.length > 5 ||
    ids.some((id, i) => i > 0 && ids[i - 1]! >= id) ||
    typeof row['ready'] !== 'boolean'
  )
    r.invalid('$.readyReceipt', 'exact nonempty device roster', null);
  return w.validated(row);
}
