import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  JsonObject,
  RevisionVector,
  WorkflowCommandCapabilityId,
  WorkflowCommandRequestMessage,
} from './wire-protocol.js';
import type { CampaignFutureRollMode } from './campaign-creation.js';
import { admissionCodecReaders as r } from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';

/** CMP-008/014/015/016 and NET-023 reuse the current campaign GM authority. */
export const CAMPAIGN_LIFECYCLE_WORKFLOW_IDS = [
  'UI-CMD-CAMPAIGN-SETTINGS-SET',
  'UI-CMD-CAMPAIGN-CAPACITY-SET',
  'UI-CMD-MASTER-PASSWORD-CHANGE',
  'UI-CMD-CAMPAIGN-PAUSE-SET',
  'UI-CMD-CLIENT-DISCONNECT',
] as const;
export const CAMPAIGN_LIFECYCLE_FORMS = [
  'CMP-008',
  'CMP-014',
  'CMP-015',
  'CMP-016',
  'NET-023',
] as const;
export const CAMPAIGN_LIFECYCLE_NAV_TARGETS = {
  'CMP-007::CTA::003': 'CMP-008',
  'CMP-008::CTA::004': 'CMP-016',
  'CMP-008::CTA::005': 'CMP-014',
  'CMP-008::CTA::006': 'CMP-015',
  'CMP-008::CTA::007': 'NET-023',
  'CMP-008::CTA::009': 'CMP-007',
  'CMP-014::CTA::001': 'CMP-008',
  'CMP-014::CTA::003': 'CMP-008',
  'CMP-015::CTA::001': 'CMP-008',
  'CMP-015::CTA::004': 'CMP-008',
  'CMP-016::CTA::004': 'CMP-008',
  'NET-023::CTA::001': 'GM-001',
} as const;
export const campaignLifecycleCommandForm = (
  workflow: CampaignLifecycleCommand['workflowCommandId'],
): CampaignLifecycleForm => {
  switch (workflow) {
    case 'UI-CMD-CAMPAIGN-SETTINGS-SET':
      return 'CMP-008';
    case 'UI-CMD-CAMPAIGN-CAPACITY-SET':
      return 'CMP-014';
    case 'UI-CMD-MASTER-PASSWORD-CHANGE':
      return 'CMP-015';
    case 'UI-CMD-CAMPAIGN-PAUSE-SET':
      return 'CMP-016';
    case 'UI-CMD-CLIENT-DISCONNECT':
      return 'NET-023';
  }
};
export type CampaignLifecycleForm = (typeof CAMPAIGN_LIFECYCLE_FORMS)[number];
export const isCampaignLifecycleForm = (value: string): value is CampaignLifecycleForm =>
  (CAMPAIGN_LIFECYCLE_FORMS as readonly string[]).includes(value);
export type CampaignNetworkConfiguration = {
  readonly hostAddress: string;
  readonly hostPort: number;
  readonly networkInterface: string;
};
export interface CampaignSettings {
  readonly title: string;
  readonly descriptionOrNull: string | null;
  readonly defaultFutureRollMode: CampaignFutureRollMode;
  readonly network: CampaignNetworkConfiguration;
}
interface CommandIdentity {
  readonly commandId: string;
  readonly campaignId: string;
}
interface CampaignRevisionCommand extends CommandIdentity {
  readonly expectedCampaignRevision: number;
}
export type CampaignSettingsCommand = CommandIdentity &
  CampaignSettings & {
    readonly workflowCommandId: 'UI-CMD-CAMPAIGN-SETTINGS-SET';
    readonly expectedSettingsRevision: number;
  };
export type CampaignPasswordCommand = CampaignRevisionCommand & {
  readonly workflowCommandId: 'UI-CMD-MASTER-PASSWORD-CHANGE';
  readonly currentMasterPassword: string;
  readonly newMasterPassword: string;
  readonly newMasterPasswordConfirmation: string;
};
export type CampaignLifecycleCommand =
  | CampaignSettingsCommand
  | CampaignPasswordCommand
  | (CampaignRevisionCommand & {
      readonly workflowCommandId: 'UI-CMD-CAMPAIGN-CAPACITY-SET';
      readonly newCapacity: number;
    })
  | (CampaignRevisionCommand & {
      readonly workflowCommandId: 'UI-CMD-CAMPAIGN-PAUSE-SET';
      readonly decision: 'PAUSE' | 'RESUME';
      readonly reason: string;
    })
  | (CampaignRevisionCommand & {
      readonly workflowCommandId: 'UI-CMD-CLIENT-DISCONNECT';
      readonly deviceId: string;
      readonly selectedControllerSeatOrNull: string | null;
      readonly reason: string;
    });
/** Secret commands are never persisted or logged, including their unsalted digest. */
export type StoredCampaignLifecycleCommand =
  | Exclude<CampaignLifecycleCommand, CampaignPasswordCommand>
  | Omit<
      CampaignPasswordCommand,
      'currentMasterPassword' | 'newMasterPassword' | 'newMasterPasswordConfirmation'
    >;
export function redactCampaignLifecycleCommand(
  command: CampaignLifecycleCommand,
): StoredCampaignLifecycleCommand {
  if (command.workflowCommandId !== 'UI-CMD-MASTER-PASSWORD-CHANGE') return command;
  return {
    workflowCommandId: command.workflowCommandId,
    commandId: command.commandId,
    campaignId: command.campaignId,
    expectedCampaignRevision: command.expectedCampaignRevision,
  };
}
/** Structural validation is shared; creation field/secret policy and live NIC checks stay on host. */
export function campaignSettingsValue(value: unknown): CampaignSettings {
  const row = r.exact(value, 'title descriptionOrNull defaultFutureRollMode network', '$.settings');
  r.text(row['title'], '$.title');
  if (row['descriptionOrNull'] !== null) r.text(row['descriptionOrNull'], '$.descriptionOrNull');
  r.oneOf(row['defaultFutureRollMode'], ['MANUAL', 'AUTO'] as const, '$.defaultFutureRollMode');
  const network = r.exact(row['network'], 'hostAddress hostPort networkInterface', '$.network');
  r.text(network['hostAddress'], '$.network.hostAddress');
  r.text(network['networkInterface'], '$.network.networkInterface');
  const port = r.integer(network['hostPort'], '$.network.hostPort', 1);
  if (port > 65535) r.invalid('$.network.hostPort', 'TCP port', null);
  return w.validated(row);
}
function parseCommand(
  value: unknown,
  redacted: boolean,
): CampaignLifecycleCommand | StoredCampaignLifecycleCommand {
  const row = w.record(value, '$.campaignLifecycle');
  const workflow = r.oneOf(
    row['workflowCommandId'],
    CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
    '$.workflowCommandId',
  );
  let extra: string;
  switch (workflow) {
    case 'UI-CMD-CAMPAIGN-SETTINGS-SET':
      extra = 'expectedSettingsRevision title descriptionOrNull defaultFutureRollMode network';
      break;
    case 'UI-CMD-CAMPAIGN-CAPACITY-SET':
      extra = 'expectedCampaignRevision newCapacity';
      break;
    case 'UI-CMD-MASTER-PASSWORD-CHANGE':
      extra =
        'expectedCampaignRevision' +
        (redacted ? '' : ' currentMasterPassword newMasterPassword newMasterPasswordConfirmation');
      break;
    case 'UI-CMD-CAMPAIGN-PAUSE-SET':
      extra = 'expectedCampaignRevision decision reason';
      break;
    case 'UI-CMD-CLIENT-DISCONNECT':
      extra = 'expectedCampaignRevision deviceId selectedControllerSeatOrNull reason';
      break;
  }
  r.exact(row, 'workflowCommandId commandId campaignId ' + extra, '$.campaignLifecycle');
  r.uuid(row['commandId'], '$.commandId');
  r.uuid(row['campaignId'], '$.campaignId');
  if (workflow === 'UI-CMD-CAMPAIGN-SETTINGS-SET') {
    r.integer(row['expectedSettingsRevision'], '$.expectedSettingsRevision', 0);
    campaignSettingsValue({
      title: row['title'],
      descriptionOrNull: row['descriptionOrNull'],
      defaultFutureRollMode: row['defaultFutureRollMode'],
      network: row['network'],
    });
  } else {
    r.integer(row['expectedCampaignRevision'], '$.expectedCampaignRevision', 0);
    if (workflow === 'UI-CMD-CAMPAIGN-CAPACITY-SET') {
      const capacity = r.integer(row['newCapacity'], '$.newCapacity', 1);
      // Q-CAMP-001 / CMP-014; no eviction or extra player place is implied.
      if (capacity > 5) r.invalid('$.newCapacity', 'one to five active players', null);
    } else if (workflow === 'UI-CMD-MASTER-PASSWORD-CHANGE' && !redacted) {
      for (const key of [
        'currentMasterPassword',
        'newMasterPassword',
        'newMasterPasswordConfirmation',
      ]) {
        // Never include a secret value in codec diagnostics.
        if (typeof row[key] !== 'string') r.invalid('$.secret', 'string', null);
      }
    } else if (workflow === 'UI-CMD-CAMPAIGN-PAUSE-SET') {
      r.oneOf(row['decision'], ['PAUSE', 'RESUME'] as const, '$.decision');
      reason(row['reason']);
    } else if (workflow === 'UI-CMD-CLIENT-DISCONNECT') {
      r.uuid(row['deviceId'], '$.deviceId');
      if (row['selectedControllerSeatOrNull'] !== null)
        r.uuid(row['selectedControllerSeatOrNull'], '$.selectedControllerSeatOrNull');
      reason(row['reason']);
    }
  }
  return w.validated(row);
}
function reason(value: unknown): string {
  const text = r.text(value, '$.reason');
  if (text.trim().length === 0) return r.invalid('$.reason', 'explicit nonempty reason', null);
  return text;
}
export function campaignLifecycleCommandValue(value: unknown): CampaignLifecycleCommand {
  return parseCommand(value, false) as CampaignLifecycleCommand;
}
export function storedCampaignLifecycleCommandValue(
  value: unknown,
): StoredCampaignLifecycleCommand {
  return parseCommand(value, true);
}
/** Read-only current continuation; it does not replace a saved birth/Start/PEACE observation. */
export interface CampaignLifecycleStatus {
  readonly campaignRevision: number;
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly pauseReasonOrNull: string | null;
}
export interface CampaignLifecycleReceipt extends CampaignLifecycleStatus {
  readonly receiptId: string;
  readonly commandId: string;
  readonly campaignId: string;
  readonly workflowCommandId: (typeof CAMPAIGN_LIFECYCLE_WORKFLOW_IDS)[number];
  readonly settingsRevision: number;
  readonly checkpointId: string;
  readonly committedAt: string;
}

/** A closed, redacted wire binding; the authenticated host supplies the GM context. */
export interface CampaignLifecycleClientBinding {
  readonly contextId: string;
  readonly request: {
    readonly messageType: 'command.request';
    readonly protocolVersion: 1;
    readonly commandKind: 'workflow-command';
    readonly role: 'gm';
    readonly commandId: string;
    readonly workflowCommandId: CampaignLifecycleCommand['workflowCommandId'];
    readonly expectedRevisions: {
      readonly stateRevision: number;
      readonly projectionRevision: number;
      readonly actorVisibilityRevision: number;
    };
    readonly payload: Readonly<Record<string, unknown>>;
  };
}
export function campaignLifecycleClientBindingValue(
  value: unknown,
): CampaignLifecycleClientBinding {
  const binding = r.exact(value, 'contextId request', '$.lifecycleClient');
  r.uuid(binding['contextId'], '$.contextId');
  const wire = r.exact(
    binding['request'],
    'messageType protocolVersion commandKind role commandId workflowCommandId expectedRevisions payload',
    '$.request',
  );
  r.oneOf(wire['messageType'], ['command.request'] as const, '$.messageType');
  r.oneOf(wire['commandKind'], ['workflow-command'] as const, '$.commandKind');
  r.oneOf(wire['role'], ['gm'] as const, '$.role');
  if (wire['protocolVersion'] !== 1) r.invalid('$.protocolVersion', 'version 1', null);
  const vector = r.exact(
    wire['expectedRevisions'],
    'stateRevision projectionRevision actorVisibilityRevision',
    '$.expectedRevisions',
  );
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])
    r.integer(vector[key], '$.expectedRevisions.' + key, 0);
  const payload = w.record(wire['payload'], '$.payload');
  if (Object.hasOwn(payload, 'commandId') || Object.hasOwn(payload, 'workflowCommandId'))
    r.invalid('$.payload', 'no embedded envelope identity', null);
  storedCampaignLifecycleCommandValue({
    ...payload,
    commandId: wire['commandId'],
    workflowCommandId: wire['workflowCommandId'],
  });
  return w.validated(binding);
}

export interface CampaignLifecycleGmProjection extends RevisionVector, CampaignLifecycleStatus {
  readonly contextId: string;
  readonly campaignId: string;
  readonly settingsRevision: number;
  readonly firstStartCompleted: boolean;
  readonly title: string;
  readonly descriptionOrNull: string | null;
  readonly defaultFutureRollMode: CampaignFutureRollMode;
  readonly networkForNextLaunch: CampaignNetworkConfiguration;
  readonly activeListenerEndpointOrNull: CampaignNetworkConfiguration | null;
  readonly availableNetworkInterfaces: readonly {
    readonly hostAddress: string;
    readonly networkInterface: string;
    readonly family: 'IPv4' | 'IPv6';
  }[];
  readonly campaignArtChecksumOrNull: string | null;
  readonly currentCapacity: number;
  readonly activePlayerCount: number;
  readonly safeBoundary: boolean;
  readonly pendingOperationCount: number;
  readonly clockMode: 'STOPPED' | null;
  readonly checkpointPreview: {
    readonly campaignRevision: number;
    readonly checkpointSha256: string;
  };
  readonly devices: readonly {
    readonly deviceId: string;
    readonly connected: boolean;
    readonly pendingOwnedCommandCount: number;
    readonly controllerSeats: readonly {
      readonly controllerSeat: string;
      readonly campaignCharacterId: string;
      readonly name: string;
    }[];
  }[];
  readonly commandId: null;
}
const lifecycleProjectionKeys =
  'contextId campaignId stateRevision projectionRevision actorVisibilityRevision campaignRevision campaignStatus pauseReasonOrNull settingsRevision firstStartCompleted title descriptionOrNull defaultFutureRollMode networkForNextLaunch activeListenerEndpointOrNull availableNetworkInterfaces campaignArtChecksumOrNull currentCapacity activePlayerCount safeBoundary pendingOperationCount clockMode checkpointPreview devices commandId';
function lifecycleBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return r.invalid(path, 'boolean', null);
  return value;
}
function lifecycleHash(value: unknown, path: string): string {
  const text = r.text(value, path);
  if (!/^[a-f0-9]{64}$/u.test(text)) return r.invalid(path, 'SHA-256', null);
  return text;
}
export function campaignLifecycleGmProjectionValue(value: unknown): CampaignLifecycleGmProjection {
  const row = r.exact(value, lifecycleProjectionKeys, '$.campaignLifecycleGm');
  for (const key of ['contextId', 'campaignId']) r.uuid(row[key], '$.' + key);
  for (const key of [
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
    'campaignRevision',
    'settingsRevision',
    'activePlayerCount',
    'pendingOperationCount',
  ])
    r.integer(row[key], '$.' + key, 0);
  const status = r.oneOf(row['campaignStatus'], ['PAUSED', 'HOSTING'] as const, '$.campaignStatus');
  const started = lifecycleBoolean(row['firstStartCompleted'], '$.firstStartCompleted');
  if (!started && status !== 'PAUSED') r.invalid('$.campaignStatus', 'pre-Start PAUSED', null);
  if (row['pauseReasonOrNull'] !== null) reason(row['pauseReasonOrNull']);
  if ((!started || status === 'HOSTING') && row['pauseReasonOrNull'] !== null)
    r.invalid('$.pauseReasonOrNull', 'no current pause reason', null);
  if (started && status === 'PAUSED' && row['pauseReasonOrNull'] === null)
    r.invalid('$.pauseReasonOrNull', 'committed pause reason', null);
  const settings = {
    title: row['title'],
    descriptionOrNull: row['descriptionOrNull'],
    defaultFutureRollMode: row['defaultFutureRollMode'],
    network: row['networkForNextLaunch'],
  };
  campaignSettingsValue(settings);
  if (row['activeListenerEndpointOrNull'] !== null)
    campaignSettingsValue({ ...settings, network: row['activeListenerEndpointOrNull'] });
  const interfaces: string[] = [];
  for (const value of r.list(row['availableNetworkInterfaces'], '$.availableNetworkInterfaces')) {
    const iface = r.exact(value, 'hostAddress networkInterface family', '$.interface');
    r.text(iface['hostAddress'], '$.hostAddress');
    r.text(iface['networkInterface'], '$.networkInterface');
    r.oneOf(iface['family'], ['IPv4', 'IPv6'] as const, '$.family');
    interfaces.push(
      JSON.stringify([iface['hostAddress'], iface['networkInterface'], iface['family']]),
    );
  }
  r.unique(interfaces, '$.availableNetworkInterfaces');
  if (row['campaignArtChecksumOrNull'] !== null)
    lifecycleHash(row['campaignArtChecksumOrNull'], '$.campaignArtChecksumOrNull');
  const capacity = r.integer(row['currentCapacity'], '$.currentCapacity', 1);
  if (capacity > 5 || (row['activePlayerCount'] as number) > capacity)
    r.invalid('$.currentCapacity', 'Q-CAMP-001 capacity covering ACTIVE PCs', null);
  const safe = lifecycleBoolean(row['safeBoundary'], '$.safeBoundary');
  if (safe !== (row['pendingOperationCount'] === 0))
    r.invalid('$.safeBoundary', 'no pending operation in supported PEACE/pre-Start context', null);
  w.literal(row['clockMode'], started ? 'STOPPED' : null, '$.clockMode');
  const checkpoint = r.exact(
    row['checkpointPreview'],
    'campaignRevision checkpointSha256',
    '$.checkpointPreview',
  );
  w.literal(
    checkpoint['campaignRevision'],
    row['campaignRevision'] as number,
    '$.checkpointPreview.campaignRevision',
  );
  lifecycleHash(checkpoint['checkpointSha256'], '$.checkpointSha256');
  const devices: string[] = [],
    seats: string[] = [],
    copies: string[] = [];
  for (const value of r.list(row['devices'], '$.devices')) {
    const device = r.exact(
      value,
      'deviceId connected pendingOwnedCommandCount controllerSeats',
      '$.device',
    );
    devices.push(r.uuid(device['deviceId'], '$.deviceId'));
    lifecycleBoolean(device['connected'], '$.connected');
    r.integer(device['pendingOwnedCommandCount'], '$.pendingOwnedCommandCount', 0);
    for (const value of r.list(device['controllerSeats'], '$.controllerSeats')) {
      const seat = r.exact(value, 'controllerSeat campaignCharacterId name', '$.seat');
      seats.push(r.uuid(seat['controllerSeat'], '$.controllerSeat'));
      copies.push(r.uuid(seat['campaignCharacterId'], '$.campaignCharacterId'));
      r.text(seat['name'], '$.name');
    }
  }
  r.unique(devices, '$.devices');
  r.unique(seats, '$.controllerSeats');
  r.unique(copies, '$.campaignCharacterIds');
  w.literal(row['commandId'], null, '$.commandId');
  return w.validated(row);
}
export function campaignLifecycleGmActions(
  form: CampaignLifecycleForm,
  p: CampaignLifecycleGmProjection,
  supported: readonly WorkflowCommandCapabilityId[],
): readonly ActionKey[] {
  // Viewing a panel is read-only even while another device has pending work.
  const enabled = (id: CampaignLifecycleCommand['workflowCommandId']) =>
    p.safeBoundary && supported.includes(id);
  switch (form) {
    case 'CMP-008':
      return [
        ...(p.firstStartCompleted
          ? ['CMP-008::CTA::004' as const]
          : ['CMP-008::CTA::005' as const]),
        'CMP-008::CTA::006',
        'CMP-008::CTA::007',
        ...(enabled('UI-CMD-CAMPAIGN-SETTINGS-SET') ? ['CMP-008::CTA::008' as const] : []),
        ...(p.safeBoundary ? ['CMP-008::CTA::009' as const] : []),
      ];
    case 'CMP-014':
      return [
        ...(p.safeBoundary ? ['CMP-014::CTA::001' as const] : []),
        ...(enabled('UI-CMD-CAMPAIGN-CAPACITY-SET') && !p.firstStartCompleted
          ? ['CMP-014::CTA::002' as const]
          : []),
        'CMP-014::CTA::003',
      ];
    case 'CMP-015':
      return [
        ...(p.safeBoundary ? ['CMP-015::CTA::001' as const] : []),
        ...(enabled('UI-CMD-MASTER-PASSWORD-CHANGE') ? ['CMP-015::CTA::003' as const] : []),
        'CMP-015::CTA::004',
      ];
    case 'CMP-016':
      return [
        ...(enabled('UI-CMD-CAMPAIGN-PAUSE-SET') && p.firstStartCompleted
          ? [
              p.campaignStatus === 'HOSTING'
                ? ('CMP-016::CTA::002' as const)
                : ('CMP-016::CTA::003' as const),
            ]
          : []),
        'CMP-016::CTA::004',
      ];
    case 'NET-023':
      return [
        'NET-023::CTA::001',
        ...(enabled('UI-CMD-CLIENT-DISCONNECT') &&
        p.devices.some((d) => d.connected && d.pendingOwnedCommandCount === 0)
          ? ['NET-023::CTA::002' as const]
          : []),
      ];
  }
}
export type CampaignLifecycleGmRequest = WorkflowCommandRequestMessage<
  CampaignLifecycleCommand['workflowCommandId']
>;
export function campaignLifecycleGmRequest(
  p: CampaignLifecycleGmProjection,
  action: ActionKey,
  commandId: string,
  inputs: Readonly<Record<string, unknown>>,
): CampaignLifecycleGmRequest {
  let workflowCommandId: CampaignLifecycleCommand['workflowCommandId'];
  switch (action) {
    case 'CMP-008::CTA::008':
      workflowCommandId = 'UI-CMD-CAMPAIGN-SETTINGS-SET';
      break;
    case 'CMP-014::CTA::002':
      workflowCommandId = 'UI-CMD-CAMPAIGN-CAPACITY-SET';
      break;
    case 'CMP-015::CTA::003':
      workflowCommandId = 'UI-CMD-MASTER-PASSWORD-CHANGE';
      break;
    case 'CMP-016::CTA::002':
    case 'CMP-016::CTA::003':
      workflowCommandId = 'UI-CMD-CAMPAIGN-PAUSE-SET';
      break;
    case 'NET-023::CTA::002':
      workflowCommandId = 'UI-CMD-CLIENT-DISCONNECT';
      break;
    default:
      return r.invalid('$.action', 'lifecycle command CTA', null);
  }
  const command = campaignLifecycleCommandValue({
    ...inputs,
    workflowCommandId,
    commandId,
    campaignId: p.campaignId,
    ...(workflowCommandId === 'UI-CMD-CAMPAIGN-SETTINGS-SET'
      ? { expectedSettingsRevision: p.settingsRevision }
      : { expectedCampaignRevision: p.campaignRevision }),
    ...(workflowCommandId === 'UI-CMD-CAMPAIGN-PAUSE-SET'
      ? { decision: action === 'CMP-016::CTA::002' ? 'PAUSE' : 'RESUME' }
      : {}),
  });
  const { commandId: _id, workflowCommandId: _workflow, ...payload } = command;
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

/** Retain only the redacted binding for reconnect; a password is sent exactly once from RAM. */
export function campaignLifecyclePendingRequest(
  request: CampaignLifecycleGmRequest,
): CampaignLifecycleGmRequest {
  const command = campaignLifecycleCommandValue({
    ...request.payload,
    commandId: request.commandId,
    workflowCommandId: request.workflowCommandId,
  });
  const {
    commandId: _id,
    workflowCommandId: _workflow,
    ...payload
  } = redactCampaignLifecycleCommand(command);
  return { ...request, payload };
}
export function isCampaignLifecycleWorkflow(
  value: string,
): value is CampaignLifecycleCommand['workflowCommandId'] {
  return (CAMPAIGN_LIFECYCLE_WORKFLOW_IDS as readonly string[]).includes(value);
}
export function campaignLifecycleGmReceipt(
  receipt: CommandReceipt,
  request: CampaignLifecycleGmRequest,
  source: CampaignLifecycleGmProjection,
): CommandReceipt {
  const value = r.exact(
    receipt.result,
    'contextId receiptId commandId campaignId workflowCommandId campaignRevision campaignStatus pauseReasonOrNull settingsRevision checkpointId committedAt',
    '$.receipt.result',
  );
  for (const key of ['contextId', 'receiptId', 'commandId', 'campaignId', 'checkpointId'])
    r.uuid(value[key], '$.' + key);
  w.literal(value['contextId'], source.contextId, '$.contextId');
  w.literal(value['campaignId'], source.campaignId, '$.campaignId');
  w.literal(value['commandId'], request.commandId, '$.commandId');
  w.literal(value['workflowCommandId'], request.workflowCommandId, '$.workflowCommandId');
  w.literal(receipt.commandId, request.commandId, '$.commandId');
  w.literal(receipt.receiptId, value['receiptId'] as string, '$.receiptId');
  r.text(value['committedAt'], '$.committedAt');
  w.literal(value['campaignRevision'], source.campaignRevision + 1, '$.campaignRevision');
  const changesSettings = [
    'UI-CMD-CAMPAIGN-SETTINGS-SET',
    'UI-CMD-CAMPAIGN-CAPACITY-SET',
    'UI-CMD-MASTER-PASSWORD-CHANGE',
  ].includes(request.workflowCommandId);
  w.literal(
    value['settingsRevision'],
    source.settingsRevision + (changesSettings ? 1 : 0),
    '$.settingsRevision',
  );
  const pause = request.workflowCommandId === 'UI-CMD-CAMPAIGN-PAUSE-SET';
  w.literal(
    value['campaignStatus'],
    pause
      ? request.payload['decision'] === 'PAUSE'
        ? 'PAUSED'
        : 'HOSTING'
      : source.campaignStatus,
    '$.campaignStatus',
  );
  const expectedReason = pause
    ? request.payload['decision'] === 'PAUSE'
      ? request.payload['reason']
      : null
    : source.pauseReasonOrNull;
  if (value['pauseReasonOrNull'] !== expectedReason)
    r.invalid('$.pauseReasonOrNull', 'committed command reason', null);
  for (const axis of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const)
    w.literal(receipt.revisions[axis], request.expectedRevisions[axis] + 1, '$.revisions.' + axis);
  return receipt;
}
export function campaignLifecycleGmReceiptDestination(
  form: string,
  payload: JsonObject,
  receipt: CommandReceipt,
  later: boolean,
  current: CampaignLifecycleGmAnchor,
): boolean {
  if (
    payload[form === 'CMP-006' ? 'gmLocalContextId' : 'contextId'] !==
      receipt.result['contextId'] ||
    payload['campaignId'] !== receipt.result['campaignId']
  )
    return false;
  if (
    current.contextId !== receipt.result['contextId'] ||
    current.campaignId !== receipt.result['campaignId'] ||
    current.campaignRevision < Number(receipt.result['campaignRevision']) ||
    current.settingsRevision < Number(receipt.result['settingsRevision'])
  )
    return false;
  if (
    current.campaignRevision === receipt.result['campaignRevision'] &&
    (current.campaignStatus !== receipt.result['campaignStatus'] ||
      current.pauseReasonOrNull !== receipt.result['pauseReasonOrNull'] ||
      current.settingsRevision !== receipt.result['settingsRevision'])
  )
    return false;
  if (later) return true;
  const workflow = receipt.result['workflowCommandId'];
  const destination =
    workflow === 'UI-CMD-CAMPAIGN-PAUSE-SET'
      ? 'CMP-007'
      : workflow === 'UI-CMD-CLIENT-DISCONNECT'
        ? 'NET-023'
        : 'CMP-008';
  if (form !== destination) return false;
  if (form === 'CMP-007') return payload['campaignStatus'] === receipt.result['campaignStatus'];
  try {
    const p = campaignLifecycleGmProjectionValue(payload);
    return (
      p.campaignRevision === receipt.result['campaignRevision'] &&
      p.settingsRevision === receipt.result['settingsRevision'] &&
      p.campaignStatus === receipt.result['campaignStatus'] &&
      p.pauseReasonOrNull === receipt.result['pauseReasonOrNull']
    );
  } catch {
    return false;
  }
}

/** Live journal proof in the opaque GM role payload; frozen wire v2 and saved observations stay unchanged. */
export interface CampaignLifecycleGmAnchor extends RevisionVector, CampaignLifecycleStatus {
  readonly contextId: string;
  readonly campaignId: string;
  readonly settingsRevision: number;
  readonly firstStartCompleted: boolean;
}
export function campaignLifecycleGmAnchorValue(value: unknown): CampaignLifecycleGmAnchor {
  const row = r.exact(
    value,
    'contextId campaignId stateRevision projectionRevision actorVisibilityRevision campaignRevision settingsRevision campaignStatus pauseReasonOrNull firstStartCompleted',
    '$.currentCampaignLifecycle',
  );
  r.uuid(row['contextId'], '$.contextId');
  r.uuid(row['campaignId'], '$.campaignId');
  for (const key of [
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
    'campaignRevision',
    'settingsRevision',
  ])
    r.integer(row[key], '$.' + key, 0);
  const status = r.oneOf(row['campaignStatus'], ['PAUSED', 'HOSTING'] as const, '$.campaignStatus');
  const started = lifecycleBoolean(row['firstStartCompleted'], '$.firstStartCompleted');
  if (!started && status !== 'PAUSED') r.invalid('$.campaignStatus', 'pre-Start PAUSED', null);
  if (row['pauseReasonOrNull'] !== null) reason(row['pauseReasonOrNull']);
  if ((!started || status === 'HOSTING') && row['pauseReasonOrNull'] !== null)
    r.invalid('$.pauseReasonOrNull', 'no current pause reason', null);
  if (started && status === 'PAUSED' && row['pauseReasonOrNull'] === null)
    r.invalid('$.pauseReasonOrNull', 'committed pause reason', null);
  return w.validated(row);
}
export function campaignLifecycleGmAnchorMonotonic(
  next: CampaignLifecycleGmAnchor,
  previous: CampaignLifecycleGmAnchor,
): boolean {
  if (
    next.contextId !== previous.contextId ||
    next.campaignId !== previous.campaignId ||
    next.campaignRevision < previous.campaignRevision ||
    next.settingsRevision < previous.settingsRevision ||
    (previous.firstStartCompleted && !next.firstStartCompleted)
  )
    return false;
  if (
    next.campaignRevision === previous.campaignRevision &&
    (next.settingsRevision !== previous.settingsRevision ||
      next.firstStartCompleted !== previous.firstStartCompleted ||
      next.campaignStatus !== previous.campaignStatus ||
      next.pauseReasonOrNull !== previous.pauseReasonOrNull)
  )
    return false;
  return true;
}

/** Technical reconnect acknowledgement; no campaign checkpoint or binding is replaced. */
export interface CampaignReconnectReceipt {
  readonly commandId: string;
  readonly campaignId: string;
  readonly deviceId: string;
  readonly disconnectCommandId: string;
  readonly confirmedAt: string;
}
/** Own-device continuation, separate from the immutable admitted PEACE snapshot. */
export interface CampaignConnectionStatus extends CampaignLifecycleStatus {
  readonly campaignId: string;
  readonly deviceId: string;
  readonly firstStartCompleted: boolean;
  readonly disconnectOrNull: {
    readonly disconnectCommandId: string;
    readonly reason: string;
    readonly campaignRevision: number;
    readonly retryReceiptOrNull: CampaignReconnectReceipt | null;
  } | null;
}
export function campaignReconnectReceiptValue(value: unknown): CampaignReconnectReceipt {
  const row = r.exact(
    value,
    'commandId campaignId deviceId disconnectCommandId confirmedAt',
    '$.reconnectReceipt',
  );
  for (const key of ['commandId', 'campaignId', 'deviceId', 'disconnectCommandId'])
    r.uuid(row[key], '$.' + key);
  r.text(row['confirmedAt'], '$.confirmedAt');
  return w.validated(row);
}
export function campaignConnectionStatusValue(value: unknown): CampaignConnectionStatus {
  const row = r.exact(
    value,
    'campaignId deviceId campaignRevision campaignStatus pauseReasonOrNull firstStartCompleted disconnectOrNull',
    '$.campaignConnection',
  );
  r.uuid(row['campaignId'], '$.campaignId');
  r.uuid(row['deviceId'], '$.deviceId');
  const revision = r.integer(row['campaignRevision'], '$.campaignRevision', 0);
  const status = r.oneOf(row['campaignStatus'], ['PAUSED', 'HOSTING'] as const, '$.campaignStatus');
  if (typeof row['firstStartCompleted'] !== 'boolean')
    r.invalid('$.firstStartCompleted', 'boolean', null);
  if (!row['firstStartCompleted'] && status !== 'PAUSED')
    r.invalid('$.campaignStatus', 'pre-Start PAUSED', null);
  if (
    row['pauseReasonOrNull'] !== null &&
    r.text(row['pauseReasonOrNull'], '$.pauseReasonOrNull').trim().length === 0
  )
    r.invalid('$.pauseReasonOrNull', 'nonempty reason', null);
  if ((row['firstStartCompleted'] && status === 'PAUSED') !== (row['pauseReasonOrNull'] !== null))
    r.invalid('$.pauseReasonOrNull', 'current committed pause reason', null);
  if (row['disconnectOrNull'] !== null) {
    const d = r.exact(
      row['disconnectOrNull'],
      'disconnectCommandId reason campaignRevision retryReceiptOrNull',
      '$.disconnectOrNull',
    );
    r.uuid(d['disconnectCommandId'], '$.disconnectCommandId');
    if (r.text(d['reason'], '$.reason').trim().length === 0)
      r.invalid('$.reason', 'nonempty reason', null);
    if (r.integer(d['campaignRevision'], '$.disconnect.campaignRevision', 1) > revision)
      r.invalid('$.disconnect.campaignRevision', 'committed revision', null);
    if (d['retryReceiptOrNull'] !== null) {
      const receipt = campaignReconnectReceiptValue(d['retryReceiptOrNull']);
      if (
        receipt.campaignId !== row['campaignId'] ||
        receipt.deviceId !== row['deviceId'] ||
        receipt.disconnectCommandId !== d['disconnectCommandId']
      )
        r.invalid('$.retryReceiptOrNull', 'same disconnect and own device', null);
    }
  }
  return w.validated(row);
}
export const campaignConnectionGate = (state: CampaignConnectionStatus): string | null => {
  const d = state.disconnectOrNull;
  return d === null
    ? 'INITIAL'
    : d.retryReceiptOrNull === null
      ? null
      : d.disconnectCommandId + '/' + d.retryReceiptOrNull.commandId;
};

/** New closed V3 family: opt-in technical continuation, never a change to a frozen snapshot. */
export interface CampaignPeerControlV3Message {
  readonly messageType: 'network.peer-control';
  readonly protocolVersion: 3;
  readonly requestId: string;
  readonly networkScopeId: string;
  readonly contextId: string;
  readonly expectedRevisions: RevisionVector;
  readonly operation: 'WATCH' | 'OPEN_RETRY' | 'RETRY';
  readonly expectedConnectionRevision: number | null;
  readonly commandIdOrNull: string | null;
  readonly endpointOrNull: { readonly hostAddress: string; readonly hostPort: number } | null;
}
export const CAMPAIGN_PEER_FORMS = ['NET-008', 'NET-009', 'NET-010'] as const;
export type CampaignPeerFormId = (typeof CAMPAIGN_PEER_FORMS)[number];
export interface CampaignPeerStateV3Message {
  readonly messageType: 'network.peer-state';
  readonly protocolVersion: 3;
  readonly subscriptionId: string;
  readonly requestId: string;
  readonly networkScopeId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly deviceId: string;
  readonly controllerSeat: string;
  readonly sequence: number;
  readonly revisions: RevisionVector;
  readonly connectionRevision: number;
  readonly connectionState: 'CONNECTED' | 'LOST' | 'DISCONNECTED' | 'RECONNECTING';
  readonly statusOrNull: CampaignConnectionStatus | null;
  readonly formOrNull: {
    readonly formId: CampaignPeerFormId;
    readonly fields: JsonObject;
    readonly availableActionKeys: readonly string[];
  } | null;
  readonly retryOutcome: 'NONE' | 'CONFIRMED' | 'REFUSED';
  readonly diagnosticOrNull: 'PEER_UNAVAILABLE' | 'REQUEST_REFUSED' | null;
}
function vector(value: unknown, path: string): RevisionVector {
  const v = r.exact(value, 'stateRevision projectionRevision actorVisibilityRevision', path);
  for (const key of Object.keys(v)) r.integer(v[key], path + '.' + key, 0);
  return w.validated(v);
}
export function campaignPeerControlValue(value: unknown): CampaignPeerControlV3Message {
  const v = r.exact(
    value,
    'messageType protocolVersion requestId networkScopeId contextId expectedRevisions operation expectedConnectionRevision commandIdOrNull endpointOrNull',
    '$.peerControl',
  );
  equal(v['messageType'], 'network.peer-control', '$.messageType');
  equal(v['protocolVersion'], 3, '$.protocolVersion');
  for (const key of ['requestId', 'networkScopeId', 'contextId']) r.uuid(v[key], '$.' + key);
  vector(v['expectedRevisions'], '$.expectedRevisions');
  const operation = r.oneOf(
    v['operation'],
    ['WATCH', 'OPEN_RETRY', 'RETRY'] as const,
    '$.operation',
  );
  if (operation === 'WATCH')
    equal(v['expectedConnectionRevision'], null, '$.expectedConnectionRevision');
  else r.integer(v['expectedConnectionRevision'], '$.expectedConnectionRevision', 0);
  if (operation === 'RETRY') {
    r.uuid(v['commandIdOrNull'], '$.commandIdOrNull');
    const endpoint = r.exact(v['endpointOrNull'], 'hostAddress hostPort', '$.endpointOrNull');
    r.text(endpoint['hostAddress'], '$.hostAddress');
    const port = r.integer(endpoint['hostPort'], '$.hostPort', 1);
    if (port > 65535) r.invalid('$.hostPort', 'TCP port', null);
  } else {
    if (operation === 'WATCH') nullableId(v['commandIdOrNull'], '$.commandIdOrNull');
    else equal(v['commandIdOrNull'], null, '$.commandIdOrNull');
    equal(v['endpointOrNull'], null, '$.endpointOrNull');
  }
  return w.validated(v);
}
function nullableId(value: unknown, path: string): void {
  if (value !== null) r.uuid(value, path);
}
function receiptIds(value: unknown): void {
  const values = r.list(value, '$.receiptIds');
  for (const id of values) r.uuid(id, '$.receiptId');
  r.unique(values as string[], '$.receiptIds');
}
function formValue(value: unknown, message: Record<string, unknown>): void {
  if (value === null) return;
  const form = r.exact(value, 'formId fields availableActionKeys', '$.form');
  const id = r.oneOf(form['formId'], CAMPAIGN_PEER_FORMS, '$.formId');
  const keys = r.list(form['availableActionKeys'], '$.availableActionKeys');
  const expected =
    id === 'NET-008' ? ['NET-008::CTA::002'] : id === 'NET-009' ? ['NET-009::CTA::001'] : [];
  if (JSON.stringify(keys) !== JSON.stringify(expected))
    r.invalid('$.availableActionKeys', 'own technical actions', null);
  const fields =
    id === 'NET-008'
      ? 'deviceId sessionId activeRole activeSeatOrGm connectionState lastConfirmedStateRevision lastConfirmedProjectionRevision resumeContext pendingCommandIdOrNull pendingRequestIdOrNull combatPhaseOrNull turnOrReactionWindowOrNull observerVisibilityRevisionOrNull controlLeaseIdOrNull lastReceiptIds'
      : id === 'NET-009'
        ? 'deviceId sessionId activeRole requestedSeatOrGm reconnectAttemptId deviceBindingProof lastConfirmedStateRevision lastConfirmedProjectionRevision resumeContextHint pendingCommandIdOrNull pendingRequestIdOrNull commandId pinnedCampaignPeerReconnectOrNull'
        : 'serverSnapshotId serverStateRevision serverProjectionRevision activeRole activeSeatOrGm resumeContext resumeFormId pendingCommandIdOrNull pendingRequestIdOrNull pendingCommandOwnerOrNull combatPhaseOrNull turnOrReactionWindowOrNull observerVisibilityRevisionOrNull controlLeaseIdOrNull receiptIds reconciliationResult';
  const p = r.exact(form['fields'], fields, '$.fields');
  const revisions = vector(message['revisions'], '$.revisions');
  equal(p['activeRole'], 'PLAYER', '$.activeRole');
  equal(
    p[id === 'NET-009' ? 'requestedSeatOrGm' : 'activeSeatOrGm'],
    message['controllerSeat'],
    '$.seat',
  );
  nullableId(p['pendingCommandIdOrNull'], '$.pendingCommandIdOrNull');
  nullableId(p['pendingRequestIdOrNull'], '$.pendingRequestIdOrNull');
  if (id === 'NET-010') {
    equal(
      p['serverSnapshotId'],
      campaignPeerSnapshotId(
        message['contextId'] as string,
        message['networkScopeId'] as string,
        revisions,
      ),
      '$.serverSnapshotId',
    );
    r.integer(p['serverStateRevision'], '$.serverStateRevision', 0);
    r.integer(p['serverProjectionRevision'], '$.serverProjectionRevision', 0);
    equal(p['serverStateRevision'], revisions.stateRevision, '$.serverStateRevision');
    equal(
      p['serverProjectionRevision'],
      revisions.projectionRevision,
      '$.serverProjectionRevision',
    );
    equal(p['resumeFormId'], 'PLY-001', '$.resumeFormId');
    nullableId(p['pendingCommandOwnerOrNull'], '$.pendingCommandOwnerOrNull');
    r.oneOf(
      p['reconciliationResult'],
      ['SERVER_CONFIRMED', 'IDEMPOTENT_RECEIPT', 'LOCAL_UNCONFIRMED_REJECTED'] as const,
      '$.reconciliationResult',
    );
    receiptIds(p['receiptIds']);
  } else {
    equal(p['deviceId'], message['deviceId'], '$.deviceId');
    r.uuid(p['sessionId'], '$.sessionId');
    r.integer(p['lastConfirmedStateRevision'], '$.lastConfirmedStateRevision', 0);
    r.integer(p['lastConfirmedProjectionRevision'], '$.lastConfirmedProjectionRevision', 0);
    equal(p['lastConfirmedStateRevision'], revisions.stateRevision, '$.lastConfirmedStateRevision');
    equal(
      p['lastConfirmedProjectionRevision'],
      revisions.projectionRevision,
      '$.lastConfirmedProjectionRevision',
    );
  }
  if (id === 'NET-009') {
    r.uuid(p['reconnectAttemptId'], '$.reconnectAttemptId');
    equal(p['commandId'], p['reconnectAttemptId'], '$.commandId');
    r.text(p['resumeContextHint'], '$.resumeContextHint');
    const proof = r.exact(
      p['deviceBindingProof'],
      'campaignId deviceId requestId submitCommandId technicalSessionId controllerSeat',
      '$.deviceBindingProof',
    );
    for (const key of Object.keys(proof)) r.uuid(proof[key], '$.deviceBindingProof.' + key);
    for (const key of ['campaignId', 'deviceId', 'controllerSeat'])
      equal(proof[key], message[key], '$.deviceBindingProof.' + key);
    equal(proof['technicalSessionId'], p['sessionId'], '$.deviceBindingProof.technicalSessionId');
    equal(proof['requestId'], p['pendingRequestIdOrNull'], '$.deviceBindingProof.requestId');
    const peer = r.exact(
      p['pinnedCampaignPeerReconnectOrNull'],
      'reconnectHostAddress reconnectHostPort previouslyPinnedHostIdentity lastAuthenticatedEndpoint',
      '$.pinnedPeer',
    );
    r.text(peer['reconnectHostAddress'], '$.reconnectHostAddress');
    const port = r.integer(peer['reconnectHostPort'], '$.reconnectHostPort', 1);
    if (port > 65535) r.invalid('$.reconnectHostPort', 'TCP port', null);
    r.text(peer['lastAuthenticatedEndpoint'], '$.lastAuthenticatedEndpoint');
    const identity = r.exact(
      peer['previouslyPinnedHostIdentity'],
      'ownerDeviceId keyFingerprintSha256',
      '$.pinnedIdentity',
    );
    r.uuid(identity['ownerDeviceId'], '$.pinnedIdentity.ownerDeviceId');
    if (
      !/^[0-9a-f]{64}$/u.test(
        r.text(identity['keyFingerprintSha256'], '$.pinnedIdentity.keyFingerprintSha256'),
      )
    )
      r.invalid('$.pinnedIdentity.keyFingerprintSha256', 'SHA-256', null);
  } else {
    equal(p['resumeContext'], 'PEACE', '$.resumeContext');
    for (const key of ['combatPhaseOrNull', 'turnOrReactionWindowOrNull', 'controlLeaseIdOrNull'])
      equal(p[key], null, '$.' + key);
    equal(
      p['observerVisibilityRevisionOrNull'],
      revisions.actorVisibilityRevision,
      '$.observerVisibilityRevisionOrNull',
    );
    if (id === 'NET-008') {
      equal(p['connectionState'], 'LOST', '$.connectionState');
      receiptIds(p['lastReceiptIds']);
    }
  }
}
export function campaignPeerStateValue(value: unknown): CampaignPeerStateV3Message {
  const v = r.exact(
    value,
    'messageType protocolVersion subscriptionId requestId networkScopeId contextId campaignId deviceId controllerSeat sequence revisions connectionRevision connectionState statusOrNull formOrNull retryOutcome diagnosticOrNull',
    '$.peerState',
  );
  equal(v['messageType'], 'network.peer-state', '$.messageType');
  equal(v['protocolVersion'], 3, '$.protocolVersion');
  for (const key of [
    'subscriptionId',
    'requestId',
    'networkScopeId',
    'contextId',
    'campaignId',
    'deviceId',
    'controllerSeat',
  ])
    r.uuid(v[key], '$.' + key);
  r.integer(v['sequence'], '$.sequence', 1);
  r.integer(v['connectionRevision'], '$.connectionRevision', 0);
  vector(v['revisions'], '$.revisions');
  const connection = r.oneOf(
    v['connectionState'],
    ['CONNECTED', 'LOST', 'DISCONNECTED', 'RECONNECTING'] as const,
    '$.connectionState',
  );
  if (v['statusOrNull'] !== null) {
    const status = campaignConnectionStatusValue(v['statusOrNull']);
    equal(status.campaignId, v['campaignId'], '$.status.campaignId');
    equal(status.deviceId, v['deviceId'], '$.status.deviceId');
    if (
      connection === 'CONNECTED' &&
      status.disconnectOrNull !== null &&
      status.disconnectOrNull.retryReceiptOrNull === null
    )
      r.invalid('$.connectionState', 'closed disconnect gate', null);
  } else if (connection === 'CONNECTED') r.invalid('$.statusOrNull', 'authenticated status', null);
  r.oneOf(v['retryOutcome'], ['NONE', 'CONFIRMED', 'REFUSED'] as const, '$.retryOutcome');
  if (v['diagnosticOrNull'] !== null)
    r.oneOf(
      v['diagnosticOrNull'],
      ['PEER_UNAVAILABLE', 'REQUEST_REFUSED'] as const,
      '$.diagnosticOrNull',
    );
  formValue(v['formOrNull'], v);
  const form = v['formOrNull'] as CampaignPeerStateV3Message['formOrNull'];
  if (form?.formId === 'NET-010') {
    equal(v['connectionState'], 'CONNECTED', '$.connectionState');
    equal(v['diagnosticOrNull'], null, '$.diagnosticOrNull');
    equal(form.fields['pendingCommandIdOrNull'], null, '$.pendingCommandIdOrNull');
    equal(form.fields['pendingCommandOwnerOrNull'], null, '$.pendingCommandOwnerOrNull');
    if (
      v['statusOrNull'] === null ||
      !(v['statusOrNull'] as CampaignConnectionStatus).firstStartCompleted
    )
      r.invalid('$.form', 'confirmed started PEACE', null);
  }
  if (v['retryOutcome'] === 'CONFIRMED') {
    equal(v['connectionState'], 'RECONNECTING', '$.connectionState');
    if (v['statusOrNull'] === null)
      r.invalid('$.retryOutcome', 'authenticated current status', null);
  }
  return w.validated(v);
}

function equal(value: unknown, expected: unknown, path: string): void {
  if (!Object.is(value, expected)) r.invalid(path, 'matching closed field', null);
}

/** A technical identity for the exact published context/vector, not a content checksum. */
export function campaignPeerSnapshotId(
  contextId: string,
  scopeId: string,
  revisions: RevisionVector,
): string {
  return [
    'peer-snapshot',
    contextId,
    scopeId,
    revisions.stateRevision,
    revisions.projectionRevision,
    revisions.actorVisibilityRevision,
  ].join(':');
}
export function campaignPeerMatchesSnapshot(
  message: CampaignPeerStateV3Message,
  source: {
    readonly formId: string;
    readonly revisions: RevisionVector;
    readonly projection: JsonObject;
  },
  reconciliationCommandId: string | null,
): boolean {
  if (
    message.revisions.stateRevision !== source.revisions.stateRevision ||
    message.revisions.projectionRevision !== source.revisions.projectionRevision ||
    message.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision
  )
    return false;
  const form = message.formOrNull;
  if (form === null) return true;
  const p = form.fields,
    own = source.projection;
  if (
    p['pendingRequestIdOrNull'] !== (own['requestId'] ?? own['requestIdOrNull']) ||
    p['pendingCommandIdOrNull'] !== own['pendingCommandIdOrNull']
  )
    return false;
  if (form.formId === 'NET-009') {
    const proof = p['deviceBindingProof'] as JsonObject;
    return (
      p['resumeContextHint'] === source.formId &&
      (own['sessionId'] === undefined || p['sessionId'] === own['sessionId']) &&
      (own['submitCommandId'] === undefined || proof['submitCommandId'] === own['submitCommandId'])
    );
  }
  return (
    source.formId === 'PLY-001' && (form.formId !== 'NET-010' || reconciliationCommandId !== null)
  );
}

export function campaignConnectionStatusFollows(
  after: CampaignConnectionStatus | null,
  before: CampaignConnectionStatus | null,
): boolean {
  if (before === null) return true;
  if (
    after === null ||
    after.campaignId !== before.campaignId ||
    after.deviceId !== before.deviceId ||
    after.campaignRevision < before.campaignRevision ||
    (before.firstStartCompleted && !after.firstStartCompleted)
  )
    return false;
  if (
    after.campaignRevision === before.campaignRevision &&
    (after.campaignStatus !== before.campaignStatus ||
      after.pauseReasonOrNull !== before.pauseReasonOrNull ||
      after.firstStartCompleted !== before.firstStartCompleted)
  )
    return false;
  const a = after.disconnectOrNull,
    b = before.disconnectOrNull;
  if (a === null) return b === null;
  if (b === null || a.disconnectCommandId !== b.disconnectCommandId)
    return a.campaignRevision > before.campaignRevision;
  return (
    a.campaignRevision === b.campaignRevision &&
    a.reason === b.reason &&
    (b.retryReceiptOrNull === null ||
      JSON.stringify(a.retryReceiptOrNull) === JSON.stringify(b.retryReceiptOrNull))
  );
}
