import type {
  AdmissionGroupAssignment,
  AdmissionInventoryReview,
  AdmissionItem,
  AdmissionLocationAssignment,
  AdmissionMassReview,
  AdmissionMoneyReview,
  AdmissionReviewDraft,
  AdmissionReviewInputs,
  AdmissionStats,
  AdmissionWeaponDecisionRef,
  AdmissionMasterWeaponProfileInput,
  AdmissionWeaponReviewInput,
} from './campaign-admission.js';
import { redactProtocolInputRefusal, wireCodecPrimitives } from './wire-codec.js';
import type { DecodeResult } from './wire-protocol.js';

const {
  record,
  string: text,
  validated,
  abortInvalid: invalid,
  abortUnrecognized: unrecognized,
} = wireCodecPrimitives;
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
/** Compare already decoded JSON records; object member order is not a wire invariant. */
export function admissionJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => admissionJsonEqual(item, right[index]))
    );
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>,
    keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && admissionJsonEqual(a[key], b[key]))
  );
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function exact(value: unknown, fields: string, path: string): Record<string, unknown> {
  const row = record(value, path),
    keys = fields.split(' ');
  for (const key of keys)
    if (!Object.hasOwn(row, key)) invalid(`${path}.${key}`, 'required field', null);
  if (Object.keys(row).some((key) => !keys.includes(key))) unrecognized(path, null);
  return row;
}
function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  return choices.find((choice) => choice === value) ?? unrecognized(path, null);
}
function uuid(value: unknown, path: string): string {
  const id = text(value, path);
  return UUID.test(id) ? id : invalid(path, 'canonical lowercase UUID v4', null);
}
function integer(value: unknown, path: string, minimum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : invalid(path, 'safe integer within the field range', null);
}
function finite(value: unknown, path: string, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? value
    : invalid(path, 'finite number within the field range', null);
}
function raw(value: unknown, path: string): string {
  return typeof value === 'string' ? value : invalid(path, 'string', null);
}
function list(value: unknown, path: string): readonly unknown[] {
  return Array.isArray(value) ? value : invalid(path, 'array', null);
}
function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path, 'unique identities', null);
}
const nullable = <T>(
  value: unknown,
  path: string,
  reader: (v: unknown, p: string) => T,
): T | null => (value === null ? null : reader(value, path));

export function admissionStatsValue(value: unknown, path = '$.statAdjustments'): AdmissionStats {
  const row = exact(value, STATS.join(' '), path);
  for (const stat of STATS) integer(row[stat], `${path}.${stat}`, Number.MIN_SAFE_INTEGER);
  return validated(row);
}
export function admissionMassReviewValue(value: unknown, path: string): AdmissionMassReview {
  const row = exact(value, 'massKg decision', path);
  const mass = finite(row['massKg'], `${path}.massKg`, 0);
  // AQA-010: decimal tenths; comparing the rounded tenth avoids binary 0.1 drift.
  if (
    mass <= 0 ||
    !Number.isSafeInteger(Math.round(mass * 10)) ||
    Math.round(mass * 10) / 10 !== mass
  )
    invalid(`${path}.massKg`, 'positive kilograms at 0.1 precision', null);
  oneOf(row['decision'], ['PENDING_MASTER_APPROVAL', 'APPROVED'], `${path}.decision`);
  return validated(row);
}
export function admissionMoneyReviewValue(value: unknown, path: string): AdmissionMoneyReview {
  const row = exact(value, 'status amountOrNull', path);
  const status = oneOf(row['status'], ['PENDING', 'FINAL'], `${path}.status`);
  if (status === 'PENDING') {
    if (row['amountOrNull'] !== null) invalid(`${path}.amountOrNull`, 'explicit null', null);
  } else finite(row['amountOrNull'], `${path}.amountOrNull`, 0);
  return validated(row);
}
function itemValue(value: unknown, path: string): AdmissionItem {
  const kind = oneOf(record(value, path)['kind'], ['CATALOG', 'CUSTOM_ITEM'], `${path}.kind`);
  const row = exact(
    value,
    kind === 'CATALOG' ? 'kind itemTypeId' : 'kind name description statBonusOrNull',
    path,
  );
  if (kind === 'CATALOG') text(row['itemTypeId'], `${path}.itemTypeId`);
  else {
    text(row['name'], `${path}.name`);
    raw(row['description'], `${path}.description`);
    nullable(row['statBonusOrNull'], `${path}.statBonusOrNull`, (value, path) => {
      const bonus = exact(value, 'statCode positiveIntegerBonus', path);
      oneOf(bonus['statCode'], STATS, `${path}.statCode`);
      integer(bonus['positiveIntegerBonus'], `${path}.positiveIntegerBonus`, 1);
    });
  }
  return validated(row);
}
export function admissionInventoryReviewValue(
  value: unknown,
  path: string,
): AdmissionInventoryReview {
  const row = exact(value, 'status entries unresolvedSourceEntryIds', path);
  const status = oneOf(row['status'], ['PENDING', 'FINAL'], `${path}.status`);
  const entries = list(row['entries'], `${path}.entries`).map((entry, index) => {
    const p = `${path}.entries[${String(index)}]`;
    const r = exact(
      entry,
      'reviewItemId sourceEntryIdOrNull item quantity qualityLabel weaponDecisionReceiptIdOrNull',
      p,
    );
    uuid(r['reviewItemId'], `${p}.reviewItemId`);
    nullable(r['sourceEntryIdOrNull'], `${p}.sourceEntryIdOrNull`, text);
    itemValue(r['item'], `${p}.item`);
    integer(r['quantity'], `${p}.quantity`, 1);
    text(r['qualityLabel'], `${p}.qualityLabel`);
    nullable(r['weaponDecisionReceiptIdOrNull'], `${p}.weaponDecisionReceiptIdOrNull`, uuid);
    return validated<AdmissionInventoryReview['entries'][number]>(r);
  });
  unique(
    entries.map((entry) => entry.reviewItemId),
    `${path}.entries`,
  );
  unique(
    entries.flatMap((entry) =>
      entry.sourceEntryIdOrNull === null ? [] : [entry.sourceEntryIdOrNull],
    ),
    `${path}.entries`,
  );
  const unresolved = list(row['unresolvedSourceEntryIds'], `${path}.unresolvedSourceEntryIds`).map(
    (v, i) => text(v, `${path}.unresolvedSourceEntryIds[${String(i)}]`),
  );
  unique(unresolved, `${path}.unresolvedSourceEntryIds`);
  if (status === 'FINAL' && unresolved.length !== 0)
    invalid(path, 'completed source inventory review', null);
  return validated(row);
}
function weaponDecisionRefValue(value: unknown, path: string): AdmissionWeaponDecisionRef {
  const kind = oneOf(
    record(value, path)['kind'],
    ['VALIDATED_REQUEST', 'ADMISSION_GRANT'],
    `${path}.kind`,
  );
  const row = exact(
    value,
    kind === 'VALIDATED_REQUEST'
      ? 'kind requestId validationReceiptId decisionReceiptId'
      : 'kind reviewItemId decisionReceiptId',
    path,
  );
  uuid(row['decisionReceiptId'], `${path}.decisionReceiptId`);
  if (kind === 'VALIDATED_REQUEST') {
    text(row['requestId'], `${path}.requestId`);
    text(row['validationReceiptId'], `${path}.validationReceiptId`);
  } else uuid(row['reviewItemId'], `${path}.reviewItemId`);
  return validated(row);
}
export function admissionGroupAssignmentValue(
  value: unknown,
  path: string,
): AdmissionGroupAssignment {
  const kind = oneOf(record(value, path)['kind'], ['EXISTING', 'NEW', 'START'], `${path}.kind`);
  const row = exact(
    value,
    kind === 'EXISTING' ? 'kind groupId' : kind === 'NEW' ? 'kind groupDraftId name' : 'kind',
    path,
  );
  if (kind === 'EXISTING') uuid(row['groupId'], `${path}.groupId`);
  if (kind === 'NEW') {
    uuid(row['groupDraftId'], `${path}.groupDraftId`);
    text(row['name'], `${path}.name`);
  }
  return validated(row);
}
export function admissionLocationAssignmentValue(
  value: unknown,
  path: string,
): AdmissionLocationAssignment {
  const row = exact(value, 'location subLocationOrNull', path);
  text(row['location'], `${path}.location`);
  nullable(row['subLocationOrNull'], `${path}.subLocationOrNull`, text);
  return validated(row);
}

export function admissionMasterWeaponProfileInputValue(
  value: unknown,
  path = '$.typedProfile',
): AdmissionMasterWeaponProfileInput {
  const row = exact(
    value,
    'weaponVariantId damageDefinition penetrationDefinition statRequirements instanceDamageOrNull rangeMetersOrNull accuracyBonusOrNull',
    path,
  );
  oneOf(
    row['weaponVariantId'],
    ['DEFAULT', 'ONE_HAND', 'TWO_HAND', 'SWORD', 'SHIELD', 'RAPIER'],
    `${path}.weaponVariantId`,
  );
  for (const key of ['damageDefinition', 'penetrationDefinition']) {
    const p = `${path}.${key}`,
      raw = record(row[key], p);
    const kind = oneOf(raw['kind'], ['RETAIN', 'MASTER_DICE'], `${p}.kind`);
    const definition = exact(raw, kind === 'RETAIN' ? 'kind' : 'kind pattern constantOrNull', p);
    if (kind === 'MASTER_DICE') {
      const pattern = oneOf(
        definition['pattern'],
        ['R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'],
        `${p}.pattern`,
      );
      if (pattern.endsWith('+X')) {
        if (finite(definition['constantOrNull'], `${p}.constantOrNull`, 0) <= 0)
          invalid(`${p}.constantOrNull`, 'positive X', null);
      } else if (definition['constantOrNull'] !== null)
        invalid(`${p}.constantOrNull`, 'explicit null', null);
    }
  }
  const requirements = record(row['statRequirements'], `${path}.statRequirements`);
  for (const [key, n] of Object.entries(requirements)) {
    oneOf(key, STATS, `${path}.statRequirements`);
    if (finite(n, `${path}.statRequirements.${key}`, 0) <= 0)
      invalid(`${path}.statRequirements.${key}`, 'positive threshold', null);
  }
  for (const key of ['instanceDamageOrNull', 'rangeMetersOrNull', 'accuracyBonusOrNull'])
    nullable(row[key], `${path}.${key}`, (v, p) => {
      if (finite(v, p, 0) <= 0) invalid(p, 'positive value or explicit null', null);
    });
  return validated(row);
}
export function admissionWeaponReviewInputValue(
  value: unknown,
  path = '$.weaponReviewInput',
): AdmissionWeaponReviewInput {
  const kind = oneOf(
    record(value, path)['kind'],
    ['VALIDATED_REQUEST', 'ADMISSION_GRANT'],
    `${path}.kind`,
  );
  const row = exact(
    value,
    kind === 'VALIDATED_REQUEST'
      ? 'kind requestId validationReceiptId'
      : 'kind reviewItemId weaponTypeId reason profileSource',
    path,
  );
  if (kind === 'VALIDATED_REQUEST') {
    text(row['requestId'], `${path}.requestId`);
    text(row['validationReceiptId'], `${path}.validationReceiptId`);
  } else {
    uuid(row['reviewItemId'], `${path}.reviewItemId`);
    text(row['weaponTypeId'], `${path}.weaponTypeId`);
    if (text(row['reason'], `${path}.reason`).trim().length === 0)
      invalid(`${path}.reason`, 'nonempty reason', null);
    const p = `${path}.profileSource`,
      sourceKind = oneOf(
        record(row['profileSource'], p)['kind'],
        ['CATALOG_TEMPLATE', 'GM_DEFINED'],
        `${p}.kind`,
      );
    const source = exact(
      row['profileSource'],
      sourceKind === 'CATALOG_TEMPLATE' ? 'kind templateId' : 'kind typedProfile',
      p,
    );
    if (sourceKind === 'CATALOG_TEMPLATE') text(source['templateId'], `${p}.templateId`);
    else admissionMasterWeaponProfileInputValue(source['typedProfile'], `${p}.typedProfile`);
  }
  return validated(row);
}

export function decodeAdmissionWeaponReviewInput(
  source: string,
): DecodeResult<AdmissionWeaponReviewInput> {
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
  const result = wireCodecPrimitives.parse(source, admissionWeaponReviewInputValue);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}
export function admissionStartingSkillsValue(
  value: unknown,
  path: string,
): AdmissionReviewDraft['startingSkills'] {
  const skills = exact(value, 'entries', path);
  const keys = list(skills['entries'], `${path}.entries`).map((entry, index) => {
    const p = `${path}.entries[${String(index)}]`;
    const skill = exact(entry, 'skillKey targetBonus', p);
    integer(skill['targetBonus'], `${p}.targetBonus`, 1);
    return text(skill['skillKey'], `${p}.skillKey`);
  });
  unique(keys, `${path}.entries`);
  return validated(skills);
}
function reviewInputFields(row: Record<string, unknown>, path: string): void {
  admissionStatsValue(row['statAdjustments'], `${path}.statAdjustments`);
  admissionStartingSkillsValue(row['startingSkills'], `${path}.startingSkills`);
  admissionMassReviewValue(row['massReview'], `${path}.massReview`);
  admissionInventoryReviewValue(row['inventoryReview'], `${path}.inventoryReview`);
  admissionMoneyReviewValue(row['moneyReview'], `${path}.moneyReview`);
  const refs = list(row['weaponDecisionRefs'], `${path}.weaponDecisionRefs`).map((value, index) =>
    weaponDecisionRefValue(value, `${path}.weaponDecisionRefs[${String(index)}]`),
  );
  unique(
    refs.map((ref) => ref.decisionReceiptId),
    `${path}.weaponDecisionRefs`,
  );
  unique(
    refs.map((ref) =>
      ref.kind === 'VALIDATED_REQUEST' ? `request:${ref.requestId}` : `grant:${ref.reviewItemId}`,
    ),
    `${path}.weaponDecisionRefs`,
  );
}
/** Syntax only: ownership, registry membership and exact revisions are checked by the host. */
export function admissionReviewDraftValue(value: unknown, path = '$'): AdmissionReviewDraft {
  const row = exact(
    value,
    'statAdjustments startingSkills massReview inventoryReview moneyReview weaponDecisionRefs groupAssignment locationAssignment',
    path,
  );
  reviewInputFields(row, path);
  admissionGroupAssignmentValue(row['groupAssignment'], `${path}.groupAssignment`);
  admissionLocationAssignmentValue(row['locationAssignment'], `${path}.locationAssignment`);
  return validated(row);
}
export function admissionReviewInputsValue(value: unknown, path = '$'): AdmissionReviewInputs {
  const row = exact(
    value,
    'statAdjustments startingSkills massReview inventoryReview moneyReview weaponDecisionRefs groupAssignmentOrNull locationAssignmentOrNull',
    path,
  );
  reviewInputFields(row, path);
  nullable(
    row['groupAssignmentOrNull'],
    `${path}.groupAssignmentOrNull`,
    admissionGroupAssignmentValue,
  );
  nullable(
    row['locationAssignmentOrNull'],
    `${path}.locationAssignmentOrNull`,
    admissionLocationAssignmentValue,
  );
  return validated(row);
}
/** Missing assignments are a structural publication error, never a permitted lobby blocker. */
export function completeAdmissionReviewInputs(value: AdmissionReviewInputs): AdmissionReviewDraft {
  admissionReviewInputsValue(value);
  const { groupAssignmentOrNull, locationAssignmentOrNull, ...fields } = value;
  return admissionReviewDraftValue({
    ...fields,
    groupAssignment: groupAssignmentOrNull,
    locationAssignment: locationAssignmentOrNull,
  });
}
export function decodeAdmissionReviewDraft(source: string): DecodeResult<AdmissionReviewDraft> {
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
  const result = wireCodecPrimitives.parse(source, admissionReviewDraftValue);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}

/** Shared only by the closed admission input and sheet readers. */
export const admissionCodecReaders = {
  exact,
  oneOf,
  uuid,
  integer,
  finite,
  raw,
  list,
  unique,
  nullable,
  text,
  invalid,
  validated,
};
