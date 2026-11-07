import type { IdentityDraftArtValue } from './wire-v3-protocol.js';
import type {
  DecodeResult,
  WorkflowCommandRequestMessage,
  RevisionVector,
  JsonObject,
  JsonValue,
} from './wire-protocol.js';
import { redactProtocolInputRefusal, wireCodecPrimitives as w } from './wire-codec.js';

/** ADR 0077 C: phase is part of the immutable request, never a new workflow ID. */
/** Generated Effects DiseaseId vocabulary. Trace-only IDs still require the host modeled-source guard. */
export const NPC_DISEASE_IDS = [
  'DIS-FEVER',
  'DIS-FLATULENCE',
  'DIS-ITCHY_SKIN_GROWTHS',
  'DIS-MIGRAINE',
  'DIS-PESTILENCE',
  'DIS-PNEUMONIA',
  'DIS-POISONING',
  'DIS-RHINITIS',
  'DIS-SCABIES',
  'DIS-SKIN_GROWTHS',
] as const;
type NpcDiseaseId = (typeof NPC_DISEASE_IDS)[number];
export const NPC_WORKFLOW_COMMAND_IDS = ['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'] as const;

export type NpcCommitV1Payload = {
  readonly campaignId: string;
  readonly npcDraftId: string;
  readonly expectedAttemptRevision: number;
};
export type NpcVersionOpenPayload = {
  readonly phase: 'OPEN';
  readonly campaignId: string;
  /** Echo of the selected current NPC; the host matches its existing GM cursor. */
  readonly npcUuid: string;
  readonly expectedCurrentVersion: number;
};
export type NpcVersionCommitPayload = NpcCommitV1Payload & {
  readonly phase: 'COMMIT';
  readonly expectedCurrentVersion: number;
};
export type NpcWorkflowCommandRequest = (
  | WorkflowCommandRequestMessage<'UI-CMD-NPC-COMMIT-V1', NpcCommitV1Payload>
  | WorkflowCommandRequestMessage<'UI-CMD-NPC-NEW-VERSION', NpcVersionOpenPayload>
  | WorkflowCommandRequestMessage<'UI-CMD-NPC-NEW-VERSION', NpcVersionCommitPayload>
) & { readonly role: 'gm' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Read own data descriptors before any value, including an untrusted phase discriminator. */
function dataRecord(value: unknown, path: string): Record<string, unknown> {
  const row = w.record(value, path);
  const prototype = Object.getPrototypeOf(row) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    w.abortInvalid(path, 'plain JSON object', null);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(row)) {
    if (typeof key !== 'string') return w.abortUnrecognized(path, null);
    const descriptor = Object.getOwnPropertyDescriptor(row, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return w.abortInvalid(path, 'enumerable own data fields', null);
    result[key] = descriptor.value as unknown;
  }
  return result;
}
function fields(row: Record<string, unknown>, allowed: string, path: string): void {
  const keys = allowed.split(' ');
  if (Object.keys(row).some((key) => !keys.includes(key))) w.abortUnrecognized(path, null);
  for (const key of keys)
    if (!Object.hasOwn(row, key)) w.abortInvalid(`${path}.${key}`, 'required field', null);
}
function uuid(value: unknown, path: string): string {
  return typeof value === 'string' && UUID.test(value)
    ? value
    : w.abortInvalid(path, 'canonical lowercase UUID v4', null);
}
function revision(value: unknown, path: string, minimum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : w.abortInvalid(path, 'safe integer within the field range', null);
}
function literal(value: unknown, expected: string | number, path: string): void {
  if (value !== expected) w.abortUnrecognized(path, null);
}
function choice<T extends string>(value: unknown, values: readonly T[], path: string): T {
  return values.find((candidate) => candidate === value) ?? w.abortUnrecognized(path, null);
}

/** Shape only: no authority, currentness, preview, capability or persistence decision. */
export function npcWorkflowCommandRequestValue(value: unknown): NpcWorkflowCommandRequest {
  const row = dataRecord(value, '$');
  fields(
    row,
    'messageType protocolVersion commandKind role commandId workflowCommandId expectedRevisions payload',
    '$',
  );
  literal(row['messageType'], 'command.request', '$.messageType');
  literal(row['protocolVersion'], 1, '$.protocolVersion');
  literal(row['commandKind'], 'workflow-command', '$.commandKind');
  literal(row['role'], 'gm', '$.role');
  const workflow = choice(
    row['workflowCommandId'],
    NPC_WORKFLOW_COMMAND_IDS,
    '$.workflowCommandId',
  );
  const commandId = uuid(row['commandId'], '$.commandId');
  const revisions = dataRecord(row['expectedRevisions'], '$.expectedRevisions');
  fields(
    revisions,
    'stateRevision projectionRevision actorVisibilityRevision',
    '$.expectedRevisions',
  );
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])
    revision(revisions[key], `$.expectedRevisions.${key}`, 0);
  const payload = dataRecord(row['payload'], '$.payload');
  if (workflow === 'UI-CMD-NPC-COMMIT-V1') {
    fields(payload, 'campaignId npcDraftId expectedAttemptRevision', '$.payload');
  } else {
    const phase = choice(payload['phase'], ['OPEN', 'COMMIT'] as const, '$.payload.phase');
    fields(
      payload,
      phase === 'OPEN'
        ? 'phase campaignId npcUuid expectedCurrentVersion'
        : 'phase campaignId npcDraftId expectedAttemptRevision expectedCurrentVersion',
      '$.payload',
    );
    revision(payload['expectedCurrentVersion'], '$.payload.expectedCurrentVersion', 1);
    if (phase === 'OPEN') uuid(payload['npcUuid'], '$.payload.npcUuid');
  }
  uuid(payload['campaignId'], '$.payload.campaignId');
  if (workflow === 'UI-CMD-NPC-COMMIT-V1' || payload['phase'] === 'COMMIT') {
    uuid(payload['npcDraftId'], '$.payload.npcDraftId');
    revision(payload['expectedAttemptRevision'], '$.payload.expectedAttemptRevision', 0);
  }
  // Return detached scalar records so subsequent input mutation cannot change a checked request.
  return w.validated({
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    commandId,
    workflowCommandId: workflow,
    expectedRevisions: { ...revisions },
    payload: { ...payload },
  });
}

export function decodeNpcWorkflowCommandRequest(
  source: string,
): DecodeResult<NpcWorkflowCommandRequest> {
  if (typeof source !== 'string')
    return {
      ok: false,
      refusal: {
        code: 'INVALID_SHAPE',
        path: '$',
        expected: 'JSON string',
        actualType: source === null ? 'null' : typeof source,
      },
    };
  const result = w.parse(source, npcWorkflowCommandRequestValue);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}

/** Source-bound navigation only. Forward wizard guards are evaluated by the host. */
export const NPC_EDITOR_FORMS = [
  'NPC-002',
  'NPC-011',
  'NPC-012',
  'NPC-013',
  'NPC-014',
  'NPC-015',
  'NPC-016',
  'NPC-017',
] as const;
export type NpcEditorForm = (typeof NPC_EDITOR_FORMS)[number];
export const NPC_NAV_TARGETS = {
  'GM-001::CTA::004': 'NPC-001',
  'NPC-001::CTA::001': 'NPC-002',
  'NPC-001::CTA::002': 'NPC-003',
  'NPC-001::CTA::003': 'GM-001',
  'NPC-002::CTA::001': 'NPC-011',
  'NPC-002::CTA::002': 'NPC-011',
  'NPC-002::CTA::003': 'NPC-001',
  'NPC-003::CTA::001': 'NPC-007',
  'NPC-003::CTA::009': 'NPC-007',
  'NPC-003::CTA::010': 'NPC-001',
  'NPC-007::CTA::001': 'NPC-003',
  'NPC-007::CTA::003': 'NPC-003',
  'NPC-011::CTA::001': 'NPC-012',
  'NPC-011::CTA::002': 'NPC-002',
  'NPC-011::CTA::003': 'NPC-012',
  'NPC-012::CTA::001': 'NPC-013',
  'NPC-012::CTA::002': 'NPC-011',
  'NPC-012::CTA::003': 'NPC-013',
  'NPC-013::CTA::001': 'NPC-014',
  'NPC-013::CTA::002': 'NPC-012',
  'NPC-013::CTA::003': 'NPC-014',
  'NPC-014::CTA::001': 'NPC-015',
  'NPC-014::CTA::002': 'NPC-013',
  'NPC-014::CTA::003': 'NPC-015',
  'NPC-015::CTA::001': 'NPC-016',
  'NPC-015::CTA::002': 'NPC-014',
  'NPC-015::CTA::003': 'NPC-016',
  'NPC-016::CTA::001': 'NPC-017',
  'NPC-016::CTA::002': 'NPC-015',
  'NPC-016::CTA::003': 'NPC-017',
  'NPC-016::CTA::004': 'NET-016',
  'NPC-017::CTA::003': 'NPC-016',
  'NET-016::CTA::005': 'NPC-016',
} as const;

interface NpcTechnicalEnvelope {
  readonly protocolVersion: 3;
  readonly operationId: string;
  readonly campaignId: string;
  readonly expectedRevisions: RevisionVector;
}
export type NpcSelectionReplaceRequest = NpcTechnicalEnvelope & {
  readonly messageType: 'network.npc-selection.replace';
} & (
    | {
        readonly sourceFormId: 'NPC-001';
        readonly npcUuidOrNull: string | null;
      }
    | {
        readonly sourceFormId: 'NPC-007';
        readonly npcUuid: string;
        readonly version: number;
      }
  );
/** A technical attempt update. It neither creates a version nor asserts sheet validity. */
export interface NpcEditorReplaceRequest extends NpcTechnicalEnvelope {
  readonly messageType: 'network.npc-editor.replace';
  readonly sourceFormId: NpcEditorForm;
  readonly npcDraftId: string;
  readonly expectedAttemptRevision: number;
  readonly values: JsonObject;
}
/** Intent only: the host resolves the offered capability against its immutable composition prefix. */
export type NpcCompositionContinuationInput =
  | Readonly<{
      kind: 'FREE_SLOT_ROLL' | 'ADVISER_IW_ROLLS' | 'ADVISER_SUPPRESSION_ROLL';
      /** Null requests AUTO; MANUAL carries the exact source-bound face count. Neither selects the mode. */
      manualFaces: readonly number[] | null;
    }>
  | Readonly<{
      kind: 'ADVISER_SKILLS';
      selectedSkills: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
    }>
  | Readonly<{ kind: 'GROSS_SKILL_GRANT' | 'TROGR_STAT_CLOSURE' }>;

/** Technical preparation is not a workflow command or client authority to allocate identities. */
export type NpcWoundPreparationRequestInput = Readonly<{
  regionId: 'HEAD' | 'TORSO' | 'ARM_L' | 'ARM_R' | 'LEG_L' | 'LEG_R';
}> &
  (Readonly<{ woundType: 'GENERIC' }> | Readonly<{ woundType: 'BLEEDING'; damagePerTick: number }>);
export interface NpcAlcoholPreparationRequestInput {
  readonly reason: string;
}
export type NpcEquipmentCompatibilityPreparationRequestInput = {
  readonly capabilityKey: string;
  readonly reason: string;
};
export interface NpcHpModePreparationRequestInput {
  readonly capabilityKey: string;
  readonly remainingMinutes: string;
  readonly reason: string;
}
export interface NpcFormalControlPreparationRequestInput extends NpcHpModePreparationRequestInput {
  readonly controlKind: 'SLEEP' | 'PARALYSIS';
}
/** ADR 0086 formal current states; these are not played activation outcomes. */
export const NPC_WEAVER_STATE_BRANCHES = [
  'REPLACEMENT_TEMPORARY',
  'REPLACEMENT_RECOVERY',
  'DUPLICATED_ORGANS_PROTECTION',
] as const;
export type NpcWeaverStateBranch = (typeof NPC_WEAVER_STATE_BRANCHES)[number];
export interface NpcWeaverStatePreparationRequestInput extends NpcHpModePreparationRequestInput {
  readonly sourceInstanceId: string;
  readonly branch: NpcWeaverStateBranch;
}
export interface NpcWeaverStateRemovalRequestInput {
  readonly capabilityKey: string;
  readonly effectInstanceId: string;
  readonly reason: string;
}
/** ADR 0087 uses real learned profiles; the client supplies neither source L nor a poison result. */
export const NPC_TAIPAN_POISON_PROFILE_IDS = [
  'POI-TAIPAN-DEADLY',
  'POI-TAIPAN-WEAKENING',
  'POI-TAIPAN-PARALYTIC',
] as const;
export type NpcTaipanPoisonProfileId = (typeof NPC_TAIPAN_POISON_PROFILE_IDS)[number];
export interface NpcPoisonModeSetRequestInput {
  readonly capabilityKey: string;
  readonly sourceInstanceId: string;
  readonly poisonProfileId: NpcTaipanPoisonProfileId;
  readonly reason: string;
}
export interface NpcPoisonCoatingPreparationRequestInput {
  readonly capabilityKey: string;
  readonly sourceInstanceId: string;
  readonly targetItemInstanceId: string;
  readonly surfaceConfirmed: boolean;
  readonly replacesCoatingIdOrNull: string | null;
  readonly replaceConfirmed: boolean;
  readonly reason: string;
}
export interface NpcPoisonCoatingRemovalRequestInput {
  readonly capabilityKey: string;
  readonly coatingInstanceId: string;
  readonly reason: string;
}
export function npcPoisonModeSetRequestInputValue(value: unknown): NpcPoisonModeSetRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey sourceInstanceId poisonProfileId reason', '$.preparation.input');
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    sourceInstanceId: uuid(row['sourceInstanceId'], '$.preparation.input.sourceInstanceId'),
    poisonProfileId: choice(
      row['poisonProfileId'],
      NPC_TAIPAN_POISON_PROFILE_IDS,
      '$.preparation.input.poisonProfileId',
    ),
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
  };
}
export function npcPoisonCoatingPreparationRequestInputValue(
  value: unknown,
): NpcPoisonCoatingPreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(
    row,
    'capabilityKey sourceInstanceId targetItemInstanceId surfaceConfirmed replacesCoatingIdOrNull replaceConfirmed reason',
    '$.preparation.input',
  );
  for (const key of ['surfaceConfirmed', 'replaceConfirmed'] as const)
    if (typeof row[key] !== 'boolean')
      return w.abortInvalid(`$.preparation.input.${key}`, 'boolean', null);
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    sourceInstanceId: uuid(row['sourceInstanceId'], '$.preparation.input.sourceInstanceId'),
    targetItemInstanceId: uuid(
      row['targetItemInstanceId'],
      '$.preparation.input.targetItemInstanceId',
    ),
    surfaceConfirmed: row['surfaceConfirmed'] as boolean,
    replacesCoatingIdOrNull:
      row['replacesCoatingIdOrNull'] === null
        ? null
        : uuid(row['replacesCoatingIdOrNull'], '$.preparation.input.replacesCoatingIdOrNull'),
    replaceConfirmed: row['replaceConfirmed'] as boolean,
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
  };
}
export function npcPoisonCoatingRemovalRequestInputValue(
  value: unknown,
): NpcPoisonCoatingRemovalRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey coatingInstanceId reason', '$.preparation.input');
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    coatingInstanceId: uuid(row['coatingInstanceId'], '$.preparation.input.coatingInstanceId'),
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
  };
}
export function npcWeaverStatePreparationRequestInputValue(
  value: unknown,
): NpcWeaverStatePreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(
    row,
    'capabilityKey sourceInstanceId branch remainingMinutes reason',
    '$.preparation.input',
  );
  return {
    ...npcHpModePreparationRequestInputValue({
      capabilityKey: row['capabilityKey'],
      remainingMinutes: row['remainingMinutes'],
      reason: row['reason'],
    }),
    sourceInstanceId: uuid(row['sourceInstanceId'], '$.preparation.input.sourceInstanceId'),
    branch: choice(row['branch'], NPC_WEAVER_STATE_BRANCHES, '$.preparation.input.branch'),
  };
}
export function npcWeaverStateRemovalRequestInputValue(
  value: unknown,
): NpcWeaverStateRemovalRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey effectInstanceId reason', '$.preparation.input');
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    effectInstanceId: uuid(row['effectInstanceId'], '$.preparation.input.effectInstanceId'),
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
  };
}
export interface NpcLifeStateRollRequestInput {
  readonly capabilityKey: string;
  readonly reason: string;
  readonly manualFaceOrNull: number | null;
}
export interface NpcLifeStateSetRequestInput {
  readonly capabilityKey: string;
  readonly lifeKind: 'ALIVE' | 'SEVERELY_WOUNDED' | 'DEAD';
  readonly reason: string;
  /** Null for untimed states or an independently proven retained severe timer. */
  readonly remainingMinutesOrNull: string | null;
}
export function npcLifeStateRollRequestInputValue(value: unknown): NpcLifeStateRollRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey reason manualFaceOrNull', '$.preparation.input');
  const face = row['manualFaceOrNull'];
  if (
    face !== null &&
    (typeof face !== 'number' || !Number.isSafeInteger(face) || face < 1 || face > 6)
  )
    return w.abortInvalid(
      '$.preparation.input.manualFaceOrNull',
      'null or an actual D6 face',
      null,
    );
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
    manualFaceOrNull: face,
  };
}
export function npcLifeStateSetRequestInputValue(value: unknown): NpcLifeStateSetRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey lifeKind reason remainingMinutesOrNull', '$.preparation.input');
  const lifeKind = choice(
    row['lifeKind'],
    ['ALIVE', 'SEVERELY_WOUNDED', 'DEAD'] as const,
    '$.preparation.input.lifeKind',
  );
  const reason = preparationText(row['reason'], '$.preparation.input.reason');
  const capabilityKey = preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey');
  let remainingMinutesOrNull: string | null = null;
  if (row['remainingMinutesOrNull'] !== null) {
    if (lifeKind !== 'SEVERELY_WOUNDED')
      return w.abortInvalid(
        '$.preparation.input.remainingMinutesOrNull',
        'null for untimed life state',
        null,
      );
    remainingMinutesOrNull = npcHpModePreparationRequestInputValue({
      capabilityKey,
      reason,
      remainingMinutes: row['remainingMinutesOrNull'],
    }).remainingMinutes;
  }
  return { capabilityKey, lifeKind, reason, remainingMinutesOrNull };
}
function preparationText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    return w.abortInvalid(path, 'explicit nonempty text without surrounding whitespace', null);
  return value;
}
/** Item Registry canonical composite pairs; the host derives actual component identities. */
export const NPC_COMPOSITE_ITEM_TYPE_IDS = ['ITM-WPN-026', 'ITM-WPN-027'] as const;
export type NpcCompositeItemTypeId = (typeof NPC_COMPOSITE_ITEM_TYPE_IDS)[number];
export interface NpcCompositeItemReservationInput {
  readonly itemTypeId: NpcCompositeItemTypeId;
}
export function npcCompositeItemReservationInputValue(
  value: unknown,
): NpcCompositeItemReservationInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'itemTypeId', '$.preparation.input');
  return {
    itemTypeId: choice(
      row['itemTypeId'],
      NPC_COMPOSITE_ITEM_TYPE_IDS,
      '$.preparation.input.itemTypeId',
    ),
  };
}
export function equipmentCompatibilityPreparationRequestInputValue(
  value: unknown,
): NpcEquipmentCompatibilityPreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey reason', '$.preparation.input');
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
  };
}
export function npcAlcoholPreparationRequestInputValue(
  value: unknown,
): NpcAlcoholPreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'reason', '$.preparation.input');
  return { reason: preparationText(row['reason'], '$.preparation.input.reason') };
}
/** Exact decimal is preserved on the wire; the source-bound host owns its maximum. */
export function npcHpModePreparationRequestInputValue(
  value: unknown,
): NpcHpModePreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey remainingMinutes reason', '$.preparation.input');
  const remainingMinutes = row['remainingMinutes'];
  if (
    typeof remainingMinutes !== 'string' ||
    remainingMinutes === '0' ||
    !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u.test(remainingMinutes)
  )
    return w.abortInvalid(
      '$.preparation.input.remainingMinutes',
      'positive canonical exact decimal',
      null,
    );
  return {
    capabilityKey: preparationText(row['capabilityKey'], '$.preparation.input.capabilityKey'),
    remainingMinutes,
    reason: preparationText(row['reason'], '$.preparation.input.reason'),
  };
}
export function npcFormalControlPreparationRequestInputValue(
  value: unknown,
): NpcFormalControlPreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  fields(row, 'capabilityKey controlKind remainingMinutes reason', '$.preparation.input');
  return {
    ...npcHpModePreparationRequestInputValue({
      capabilityKey: row['capabilityKey'],
      remainingMinutes: row['remainingMinutes'],
      reason: row['reason'],
    }),
    controlKind: choice(
      row['controlKind'],
      ['SLEEP', 'PARALYSIS'] as const,
      '$.preparation.input.controlKind',
    ),
  };
}
/** Data grammar only; authenticated host preparation proves anatomy and allocates the identity. */
export function npcWoundPreparationRequestInputValue(
  value: unknown,
): NpcWoundPreparationRequestInput {
  const row = dataRecord(value, '$.preparation.input');
  const woundType = choice(
    row['woundType'],
    ['GENERIC', 'BLEEDING'] as const,
    '$.preparation.input.woundType',
  );
  fields(
    row,
    woundType === 'GENERIC' ? 'regionId woundType' : 'regionId woundType damagePerTick',
    '$.preparation.input',
  );
  const regionId = choice(
    row['regionId'],
    ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] as const,
    '$.preparation.input.regionId',
  );
  if (woundType === 'GENERIC') return { regionId, woundType };
  const damagePerTick = row['damagePerTick'];
  if (typeof damagePerTick !== 'number' || !Number.isFinite(damagePerTick) || damagePerTick < 0)
    return w.abortInvalid(
      '$.preparation.input.damagePerTick',
      'finite nonnegative effective damage',
      null,
    );
  return { regionId, woundType, damagePerTick };
}
export type NpcPreparationRequest = NpcTechnicalEnvelope & {
  readonly messageType: 'network.npc-preparation.request';
  readonly npcDraftId: string;
  readonly expectedAttemptRevision: number;
} & (
    | {
        readonly sourceFormId: 'NPC-013';
        readonly preparation:
          | Readonly<{ kind: 'SYMBIONT_RESERVE' | 'COMPOSITION_CONFIRM'; values: JsonObject }>
          | Readonly<{
              kind: 'COMPOSITION_RESOLVE';
              capabilityKey: string;
              input: NpcCompositionContinuationInput;
            }>;
      }
    | {
        readonly sourceFormId: 'NPC-015';
        readonly preparation:
          | {
              readonly kind: 'POISON_COATING_PREPARE';
              readonly input: NpcPoisonCoatingPreparationRequestInput;
            }
          | {
              readonly kind: 'POISON_COATING_REMOVE';
              readonly input: NpcPoisonCoatingRemovalRequestInput;
            }
          | {
              readonly kind: 'ITEM_RESERVE';
              readonly values: JsonObject;
            }
          | {
              readonly kind: 'ITEM_RESTORE';
              readonly capabilityKey: string;
              readonly itemInstanceId: string;
              readonly values: JsonObject;
            }
          | {
              readonly kind: 'CUSTOM_ITEM_RESERVE';
              readonly values: JsonObject;
            }
          | {
              readonly kind: 'CUSTOM_MODIFIER_RESERVE';
              readonly itemInstanceId: string;
              readonly values: JsonObject;
            }
          | {
              readonly kind: 'CUSTOM_PROFILE_VERSION_RESERVE';
              readonly itemInstanceId: string;
              readonly profileId: string;
              readonly expectedProfileVersionId: string;
              readonly values: JsonObject;
            }
          | {
              readonly kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM';
              readonly input: NpcEquipmentCompatibilityPreparationRequestInput;
            }
          | {
              readonly kind: 'COMPOSITE_ITEM_RESERVE';
              readonly input: NpcCompositeItemReservationInput;
            };
      }
    | {
        readonly sourceFormId: 'NPC-016';
        readonly preparation:
          | { readonly kind: 'POISON_MODE_SET'; readonly input: NpcPoisonModeSetRequestInput }
          | { readonly kind: 'DISEASE_RESERVE'; readonly diseaseId: NpcDiseaseId }
          | { readonly kind: 'TRAUMA_RESERVE' }
          | { readonly kind: 'ALCOHOL_PREPARE'; readonly input: NpcAlcoholPreparationRequestInput }
          | { readonly kind: 'HP_MODE_PREPARE'; readonly input: NpcHpModePreparationRequestInput }
          | {
              readonly kind: 'FORMAL_CONTROL_SET';
              readonly input: NpcFormalControlPreparationRequestInput;
            }
          | {
              readonly kind: 'WEAVER_STATE_PREPARE';
              readonly input: NpcWeaverStatePreparationRequestInput;
            }
          | {
              readonly kind: 'WEAVER_STATE_REMOVE';
              readonly input: NpcWeaverStateRemovalRequestInput;
            }
          | { readonly kind: 'LIFE_STATE_ROLL'; readonly input: NpcLifeStateRollRequestInput }
          | { readonly kind: 'LIFE_STATE_SET'; readonly input: NpcLifeStateSetRequestInput }
          | { readonly kind: 'WOUND_PREPARE'; readonly input: NpcWoundPreparationRequestInput };
      }
    | {
        readonly sourceFormId: 'NPC-002';
        readonly preparation:
          | { readonly kind: 'ART_CLEAR' }
          | {
              readonly kind: 'ART_UPLOAD';
              readonly file: Extract<IdentityDraftArtValue, { kind: 'local-file' }>;
            };
      }
  );
export type NpcTechnicalRequest =
  NpcSelectionReplaceRequest | NpcEditorReplaceRequest | NpcPreparationRequest;

function technicalRevisions(value: unknown, path = '$.expectedRevisions'): RevisionVector {
  const row = dataRecord(value, path);
  fields(row, 'stateRevision projectionRevision actorVisibilityRevision', path);
  return {
    stateRevision: revision(row['stateRevision'], `${path}.stateRevision`, 0),
    projectionRevision: revision(row['projectionRevision'], `${path}.projectionRevision`, 0),
    actorVisibilityRevision: revision(
      row['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
      0,
    ),
  };
}

/** Unlike stringify, this never invokes toJSON/getters or silently drops non-JSON fields. */
function detachedJson(value: unknown, path: string, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    return w.abortInvalid(path, 'finite acyclic JSON data', null);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        Reflect.ownKeys(value).length !== value.length + 1
      )
        return w.abortInvalid(path, 'dense JSON array', null);
      const result: JsonValue[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value')
        )
          return w.abortInvalid(path, 'own array data', null);
        result.push(detachedJson(descriptor.value as unknown, `${path}[${i}]`, ancestors));
      }
      return result;
    }
    const row = dataRecord(value, path);
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    // Arbitrary field names may contain private input; only static envelope paths leave the codec.
    for (const [key, entry] of Object.entries(row))
      result[key] = detachedJson(entry, path, ancestors);
    return { ...result };
  } finally {
    ancestors.delete(value);
  }
}

export function npcCompositionContinuationInputValue(
  value: unknown,
): NpcCompositionContinuationInput {
  const path = '$.preparation.input';
  const row = dataRecord(detachedJson(value, path), path);
  const kind = choice(
    row['kind'],
    [
      'FREE_SLOT_ROLL',
      'ADVISER_IW_ROLLS',
      'ADVISER_SUPPRESSION_ROLL',
      'ADVISER_SKILLS',
      'GROSS_SKILL_GRANT',
      'TROGR_STAT_CLOSURE',
    ] as const,
    path + '.kind',
  );
  if (kind === 'GROSS_SKILL_GRANT' || kind === 'TROGR_STAT_CLOSURE') {
    fields(row, 'kind', path);
    return { kind };
  }
  if (kind === 'ADVISER_SKILLS') {
    fields(row, 'kind selectedSkills', path);
    if (!Array.isArray(row['selectedSkills']))
      return w.abortInvalid(path, 'selected skills array', null);
    const selectedSkills = row['selectedSkills'].map((value: unknown) => {
      const skill = dataRecord(value, path);
      fields(skill, 'skillKey targetBonus', path);
      const skillKey = skill['skillKey'];
      if (typeof skillKey !== 'string' || skillKey.length === 0 || skillKey.trim() !== skillKey)
        return w.abortInvalid(path, 'exact skill reference', null);
      return { skillKey, targetBonus: revision(skill['targetBonus'], path, 1) };
    });
    return { kind, selectedSkills };
  }
  fields(row, 'kind manualFaces', path);
  const faces = row['manualFaces'];
  if (faces === null) return { kind, manualFaces: null };
  if (!Array.isArray(faces)) return w.abortInvalid(path, 'manual face array or null', null);
  const manualFaces = faces.map((face: unknown) =>
    typeof face === 'number' && Number.isFinite(face)
      ? face
      : w.abortInvalid(path, 'finite manual face', null),
  );
  return { kind, manualFaces };
}

/** Closed transport shape; a mandatory host stage reader must additionally validate values. */
export function npcTechnicalRequestValue(value: unknown): NpcTechnicalRequest {
  const row = dataRecord(value, '$');
  const messageType = choice(
    row['messageType'],
    [
      'network.npc-selection.replace',
      'network.npc-editor.replace',
      'network.npc-preparation.request',
    ] as const,
    '$.messageType',
  );
  const selectionForm =
    messageType === 'network.npc-selection.replace'
      ? choice(row['sourceFormId'], ['NPC-001', 'NPC-007'] as const, '$.sourceFormId')
      : null;
  fields(
    row,
    'messageType protocolVersion operationId campaignId expectedRevisions sourceFormId ' +
      (messageType === 'network.npc-selection.replace'
        ? selectionForm === 'NPC-001'
          ? 'npcUuidOrNull'
          : 'npcUuid version'
        : messageType === 'network.npc-preparation.request'
          ? 'npcDraftId expectedAttemptRevision preparation'
          : 'npcDraftId expectedAttemptRevision values'),
    '$',
  );
  literal(row['protocolVersion'], 3, '$.protocolVersion');
  const common = {
    protocolVersion: 3 as const,
    operationId: uuid(row['operationId'], '$.operationId'),
    campaignId: uuid(row['campaignId'], '$.campaignId'),
    expectedRevisions: technicalRevisions(row['expectedRevisions']),
  };
  if (messageType === 'network.npc-selection.replace') {
    if (selectionForm === 'NPC-001')
      return {
        ...common,
        messageType,
        sourceFormId: 'NPC-001',
        npcUuidOrNull:
          row['npcUuidOrNull'] === null ? null : uuid(row['npcUuidOrNull'], '$.npcUuidOrNull'),
      };
    return {
      ...common,
      messageType,
      sourceFormId: 'NPC-007',
      npcUuid: uuid(row['npcUuid'], '$.npcUuid'),
      version: revision(row['version'], '$.version', 1),
    };
  }
  if (messageType === 'network.npc-preparation.request') {
    const preparation = dataRecord(row['preparation'], '$.preparation');
    const kind = choice(
      preparation['kind'],
      [
        'ITEM_RESERVE',
        'ITEM_RESTORE',
        'CUSTOM_ITEM_RESERVE',
        'CUSTOM_MODIFIER_RESERVE',
        'CUSTOM_PROFILE_VERSION_RESERVE',
        'COMPOSITE_ITEM_RESERVE',
        'EQUIPMENT_COMPATIBILITY_CONFIRM',
        'DISEASE_RESERVE',
        'TRAUMA_RESERVE',
        'WOUND_PREPARE',
        'ALCOHOL_PREPARE',
        'HP_MODE_PREPARE',
        'FORMAL_CONTROL_SET',
        'LIFE_STATE_ROLL',
        'LIFE_STATE_SET',
        'WEAVER_STATE_PREPARE',
        'WEAVER_STATE_REMOVE',
        'POISON_MODE_SET',
        'POISON_COATING_PREPARE',
        'POISON_COATING_REMOVE',
        'ART_UPLOAD',
        'ART_CLEAR',
        'SYMBIONT_RESERVE',
        'COMPOSITION_CONFIRM',
        'COMPOSITION_RESOLVE',
      ] as const,
      '$.preparation.kind',
    );
    fields(
      preparation,
      kind === 'ITEM_RESERVE' ||
        kind === 'CUSTOM_ITEM_RESERVE' ||
        kind === 'SYMBIONT_RESERVE' ||
        kind === 'COMPOSITION_CONFIRM'
        ? 'kind values'
        : kind === 'ITEM_RESTORE'
          ? 'kind capabilityKey itemInstanceId values'
          : kind === 'CUSTOM_MODIFIER_RESERVE'
            ? 'kind itemInstanceId values'
            : kind === 'CUSTOM_PROFILE_VERSION_RESERVE'
              ? 'kind itemInstanceId profileId expectedProfileVersionId values'
              : kind === 'COMPOSITION_RESOLVE'
                ? 'kind capabilityKey input'
                : kind === 'WOUND_PREPARE' ||
                    kind === 'ALCOHOL_PREPARE' ||
                    kind === 'HP_MODE_PREPARE' ||
                    kind === 'FORMAL_CONTROL_SET' ||
                    kind === 'LIFE_STATE_ROLL' ||
                    kind === 'LIFE_STATE_SET' ||
                    kind === 'WEAVER_STATE_PREPARE' ||
                    kind === 'WEAVER_STATE_REMOVE' ||
                    kind === 'POISON_MODE_SET' ||
                    kind === 'POISON_COATING_PREPARE' ||
                    kind === 'POISON_COATING_REMOVE' ||
                    kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM' ||
                    kind === 'COMPOSITE_ITEM_RESERVE'
                  ? 'kind input'
                  : kind === 'DISEASE_RESERVE'
                    ? 'kind diseaseId'
                    : kind === 'ART_UPLOAD'
                      ? 'kind file'
                      : 'kind',
      '$.preparation',
    );
    const own = {
      ...common,
      messageType,
      npcDraftId: uuid(row['npcDraftId'], '$.npcDraftId'),
      expectedAttemptRevision: revision(
        row['expectedAttemptRevision'],
        '$.expectedAttemptRevision',
        0,
      ),
    } as const;
    if (kind === 'COMPOSITION_RESOLVE') {
      literal(row['sourceFormId'], 'NPC-013', '$.sourceFormId');
      const key = preparation['capabilityKey'];
      if (typeof key !== 'string' || key.length === 0 || key.trim() !== key)
        return w.abortInvalid('$.preparation.capabilityKey', 'exact offered capability key', null);
      return {
        ...own,
        sourceFormId: 'NPC-013',
        preparation: {
          kind,
          capabilityKey: key,
          input: npcCompositionContinuationInputValue(preparation['input']),
        },
      };
    }
    if (kind === 'SYMBIONT_RESERVE' || kind === 'COMPOSITION_CONFIRM') {
      literal(row['sourceFormId'], 'NPC-013', '$.sourceFormId');
      const values = detachedJson(preparation['values'], '$.preparation.values');
      if (values === null || typeof values !== 'object' || Array.isArray(values))
        return w.abortInvalid('$.preparation.values', 'JSON object', null);
      return {
        ...own,
        sourceFormId: 'NPC-013',
        preparation: { kind, values: values as JsonObject },
      };
    }
    if (
      kind === 'ITEM_RESERVE' ||
      kind === 'ITEM_RESTORE' ||
      kind === 'CUSTOM_ITEM_RESERVE' ||
      kind === 'CUSTOM_MODIFIER_RESERVE' ||
      kind === 'CUSTOM_PROFILE_VERSION_RESERVE'
    ) {
      literal(row['sourceFormId'], 'NPC-015', '$.sourceFormId');
      const values = detachedJson(preparation['values'], '$.preparation.values');
      if (values === null || typeof values !== 'object' || Array.isArray(values))
        return w.abortInvalid('$.preparation.values', 'JSON object', null);
      if (kind === 'ITEM_RESTORE') {
        const key = preparation['capabilityKey'];
        if (typeof key !== 'string' || key.length === 0 || key.trim() !== key)
          return w.abortInvalid(
            '$.preparation.capabilityKey',
            'exact offered capability key',
            null,
          );
        return {
          ...own,
          sourceFormId: 'NPC-015',
          preparation: {
            kind,
            capabilityKey: key,
            itemInstanceId: uuid(preparation['itemInstanceId'], '$.preparation.itemInstanceId'),
            values: values as JsonObject,
          },
        };
      }
      if (kind === 'CUSTOM_MODIFIER_RESERVE')
        return {
          ...own,
          sourceFormId: 'NPC-015',
          preparation: {
            kind,
            itemInstanceId: uuid(preparation['itemInstanceId'], '$.preparation.itemInstanceId'),
            values: values as JsonObject,
          },
        };
      if (kind === 'CUSTOM_PROFILE_VERSION_RESERVE')
        return {
          ...own,
          sourceFormId: 'NPC-015',
          preparation: {
            kind,
            itemInstanceId: uuid(preparation['itemInstanceId'], '$.preparation.itemInstanceId'),
            profileId: uuid(preparation['profileId'], '$.preparation.profileId'),
            expectedProfileVersionId: uuid(
              preparation['expectedProfileVersionId'],
              '$.preparation.expectedProfileVersionId',
            ),
            values: values as JsonObject,
          },
        };
      return {
        ...own,
        sourceFormId: 'NPC-015',
        preparation: { kind, values: values as JsonObject },
      };
    }
    if (kind === 'COMPOSITE_ITEM_RESERVE') {
      literal(row['sourceFormId'], 'NPC-015', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-015',
        preparation: { kind, input: npcCompositeItemReservationInputValue(preparation['input']) },
      };
    }
    if (kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM') {
      literal(row['sourceFormId'], 'NPC-015', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-015',
        preparation: {
          kind,
          input: equipmentCompatibilityPreparationRequestInputValue(preparation['input']),
        },
      };
    }
    if (kind === 'ALCOHOL_PREPARE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcAlcoholPreparationRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'HP_MODE_PREPARE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcHpModePreparationRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'FORMAL_CONTROL_SET') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: {
          kind,
          input: npcFormalControlPreparationRequestInputValue(preparation['input']),
        },
      };
    }
    if (kind === 'WEAVER_STATE_PREPARE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: {
          kind,
          input: npcWeaverStatePreparationRequestInputValue(preparation['input']),
        },
      };
    }
    if (kind === 'POISON_MODE_SET') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcPoisonModeSetRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'POISON_COATING_PREPARE') {
      literal(row['sourceFormId'], 'NPC-015', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-015',
        preparation: {
          kind,
          input: npcPoisonCoatingPreparationRequestInputValue(preparation['input']),
        },
      };
    }
    if (kind === 'POISON_COATING_REMOVE') {
      literal(row['sourceFormId'], 'NPC-015', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-015',
        preparation: {
          kind,
          input: npcPoisonCoatingRemovalRequestInputValue(preparation['input']),
        },
      };
    }
    if (kind === 'WEAVER_STATE_REMOVE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcWeaverStateRemovalRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'LIFE_STATE_ROLL') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcLifeStateRollRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'LIFE_STATE_SET') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcLifeStateSetRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'WOUND_PREPARE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: { kind, input: npcWoundPreparationRequestInputValue(preparation['input']) },
      };
    }
    if (kind === 'TRAUMA_RESERVE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return { ...own, sourceFormId: 'NPC-016', preparation: { kind } };
    }
    if (kind === 'DISEASE_RESERVE') {
      literal(row['sourceFormId'], 'NPC-016', '$.sourceFormId');
      return {
        ...own,
        sourceFormId: 'NPC-016',
        preparation: {
          kind,
          diseaseId: choice(preparation['diseaseId'], NPC_DISEASE_IDS, '$.preparation.diseaseId'),
        },
      };
    }
    literal(row['sourceFormId'], 'NPC-002', '$.sourceFormId');
    if (kind === 'ART_CLEAR') return { ...own, sourceFormId: 'NPC-002', preparation: { kind } };
    const file = dataRecord(preparation['file'], '$.preparation.file');
    fields(file, 'kind mediaType bytesBase64', '$.preparation.file');
    literal(file['kind'], 'local-file', '$.preparation.file.kind');
    const mediaType = choice(
      file['mediaType'],
      ['image/png', 'image/jpeg'] as const,
      '$.preparation.file.mediaType',
    );
    if (typeof file['bytesBase64'] !== 'string')
      return w.abortInvalid('$.preparation.file.bytesBase64', 'string', null);
    // The established host image validator owns canonical base64, decoded bytes, signatures and size.
    return {
      ...own,
      sourceFormId: 'NPC-002',
      preparation: {
        kind,
        file: { kind: 'local-file', mediaType, bytesBase64: file['bytesBase64'] },
      },
    };
  }
  const input = detachedJson(row['values'], '$.values');
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return w.abortInvalid('$.values', 'JSON object', null);
  return {
    ...common,
    messageType,
    sourceFormId: choice(row['sourceFormId'], NPC_EDITOR_FORMS, '$.sourceFormId'),
    npcDraftId: uuid(row['npcDraftId'], '$.npcDraftId'),
    expectedAttemptRevision: revision(
      row['expectedAttemptRevision'],
      '$.expectedAttemptRevision',
      0,
    ),
    // detachedJson already validates recursively and retains plain objects for the owning stage reader.
    values: input as JsonObject,
  };
}

export function decodeNpcTechnicalRequest(source: string): DecodeResult<NpcTechnicalRequest> {
  if (typeof source !== 'string')
    return {
      ok: false,
      refusal: {
        code: 'INVALID_SHAPE',
        path: '$',
        expected: 'JSON string',
        actualType: source === null ? 'null' : typeof source,
      },
    };
  const result = w.parse(source, npcTechnicalRequestValue);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}

/** Immutable acknowledgement only. The current form is delivered by the existing snapshot channel. */
interface NpcTechnicalResponseEnvelope {
  readonly protocolVersion: 3;
  readonly operationId: string;
  readonly campaignId: string;
  readonly projectionRole: 'gm';
}
export interface NpcEditorResult extends NpcTechnicalResponseEnvelope {
  readonly messageType: 'network.npc-editor.result';
  readonly sourceFormId: NpcEditorForm;
  readonly npcDraftId: string;
  readonly appliedAttemptRevision: number;
  readonly appliedRevisions: RevisionVector;
}
export type NpcSelectionResult = NpcTechnicalResponseEnvelope & {
  readonly messageType: 'network.npc-selection.result';
  readonly appliedRevisions: RevisionVector;
} & (
    | {
        readonly sourceFormId: 'NPC-001';
        readonly npcUuidOrNull: string | null;
      }
    | {
        readonly sourceFormId: 'NPC-007';
        readonly npcUuid: string;
        readonly version: number;
      }
  );
export const NPC_TECHNICAL_REFUSAL_CODES = [
  'INVALID_INPUT',
  'STALE_REVISION',
  'STALE_ATTEMPT',
  'IDEMPOTENCY_CONFLICT',
  'UNAVAILABLE',
  'REVISION_OVERFLOW',
] as const;
export type NpcTechnicalRefusalCode = (typeof NPC_TECHNICAL_REFUSAL_CODES)[number];
/** Refusals carry no current head or input values, including for a foreign/expired authority. */
export type NpcTechnicalRefusal = NpcTechnicalResponseEnvelope & {
  readonly presentationUnchanged: true;
  readonly refusal: { readonly code: NpcTechnicalRefusalCode };
} & (
    | {
        readonly messageType: 'network.npc-editor.refusal';
        readonly sourceFormId: NpcEditorForm;
        readonly npcDraftId: string;
      }
    | {
        readonly messageType: 'network.npc-selection.refusal';
        readonly sourceFormId: 'NPC-001' | 'NPC-007';
      }
  );
export type NpcTechnicalResponse = NpcEditorResult | NpcSelectionResult | NpcTechnicalRefusal;

export function npcTechnicalResponseValue(value: unknown): NpcTechnicalResponse {
  const row = dataRecord(value, '$');
  const messageType = choice(
    row['messageType'],
    [
      'network.npc-editor.result',
      'network.npc-selection.result',
      'network.npc-editor.refusal',
      'network.npc-selection.refusal',
    ] as const,
    '$.messageType',
  );
  const editor =
    messageType === 'network.npc-editor.result' || messageType === 'network.npc-editor.refusal';
  const result =
    messageType === 'network.npc-editor.result' || messageType === 'network.npc-selection.result';
  const sourceFormId = choice(
    row['sourceFormId'],
    editor ? NPC_EDITOR_FORMS : (['NPC-001', 'NPC-007'] as const),
    '$.sourceFormId',
  );
  fields(
    row,
    'messageType protocolVersion operationId campaignId projectionRole sourceFormId ' +
      (editor ? 'npcDraftId ' : '') +
      (result
        ? 'appliedRevisions ' +
          (editor
            ? 'appliedAttemptRevision'
            : sourceFormId === 'NPC-001'
              ? 'npcUuidOrNull'
              : 'npcUuid version')
        : 'presentationUnchanged refusal'),
    '$',
  );
  literal(row['protocolVersion'], 3, '$.protocolVersion');
  literal(row['projectionRole'], 'gm', '$.projectionRole');
  const common = {
    protocolVersion: 3 as const,
    operationId: uuid(row['operationId'], '$.operationId'),
    campaignId: uuid(row['campaignId'], '$.campaignId'),
    projectionRole: 'gm' as const,
  };
  if (!result) {
    if (row['presentationUnchanged'] !== true) w.abortUnrecognized('$.presentationUnchanged', null);
    const refusal = dataRecord(row['refusal'], '$.refusal');
    fields(refusal, 'code', '$.refusal');
    const code = choice(refusal['code'], NPC_TECHNICAL_REFUSAL_CODES, '$.refusal.code');
    const denied = {
      ...common,
      presentationUnchanged: true as const,
      refusal: { code },
    };
    return editor
      ? {
          ...denied,
          messageType: 'network.npc-editor.refusal',
          sourceFormId: choice(sourceFormId, NPC_EDITOR_FORMS, '$.sourceFormId'),
          npcDraftId: uuid(row['npcDraftId'], '$.npcDraftId'),
        }
      : {
          ...denied,
          messageType: 'network.npc-selection.refusal',
          sourceFormId: choice(sourceFormId, ['NPC-001', 'NPC-007'] as const, '$.sourceFormId'),
        };
  }
  const appliedRevisions = technicalRevisions(row['appliedRevisions'], '$.appliedRevisions');
  if (editor)
    return {
      ...common,
      messageType: 'network.npc-editor.result',
      sourceFormId: choice(sourceFormId, NPC_EDITOR_FORMS, '$.sourceFormId'),
      npcDraftId: uuid(row['npcDraftId'], '$.npcDraftId'),
      appliedAttemptRevision: revision(
        row['appliedAttemptRevision'],
        '$.appliedAttemptRevision',
        1,
      ),
      appliedRevisions,
    };
  if (sourceFormId === 'NPC-001')
    return {
      ...common,
      messageType: 'network.npc-selection.result',
      sourceFormId,
      npcUuidOrNull:
        row['npcUuidOrNull'] === null ? null : uuid(row['npcUuidOrNull'], '$.npcUuidOrNull'),
      appliedRevisions,
    };
  return {
    ...common,
    messageType: 'network.npc-selection.result',
    sourceFormId: 'NPC-007',
    npcUuid: uuid(row['npcUuid'], '$.npcUuid'),
    version: revision(row['version'], '$.version', 1),
    appliedRevisions,
  };
}
