import type { StatCode } from '@generated/types/character.js';
import { ARMOR_BODY_ZONES } from '../item-stage/armor-bundle.js';
import { STARTING_WEAPON_VARIANTS } from '../item-stage/starting-weapon.js';
import type { MasterWeaponProfileInput } from '../item-stage/master-weapon-profile.js';
import type { SkillKey, SkillStageCatalog } from '../skill-stage/catalog.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { SymbiontBinding } from '../symbiont-stage/catalog.js';
import type { NpcDevelopmentCatalog } from './catalog.js';
import {
  readNpcInventoryRequest,
  type NpcInventoryRequestEntry,
  type NpcItemProfileRequest,
  type NpcInventoryCatalog,
} from './inventory.js';
import type {
  NpcDraftSection,
  NpcIdentityStageInput,
  NpcSchemaStageInput,
  NpcSymbiontInput,
} from './types.js';

/** Atlas NPC-002 and NPC-011..017: seven editable sections, followed by read-only final review. */
export const NPC_EDITOR_FORM_IDS = [
  'NPC-002',
  'NPC-011',
  'NPC-012',
  'NPC-013',
  'NPC-014',
  'NPC-015',
  'NPC-016',
  'NPC-017',
] as const;
export type NpcEditorFormId = (typeof NPC_EDITOR_FORM_IDS)[number];
export type NpcEnteredFields<T> = { readonly [K in keyof T]: NpcDraftSection<T[K]> };
export interface NpcEditorCatalog {
  readonly skills: SkillStageCatalog;
  readonly development: NpcDevelopmentCatalog;
  /** Required for nonempty NPC-015 input; the host reconstructs it from its attempt journal. */
  readonly inventory?: NpcInventoryEditorContext;
}
export interface NpcSymbiontEditorRow {
  /** Assigned by the owning attempt; existence/ownership is checked by the host. */
  readonly symbiontInstanceId: string;
  readonly input: NpcEnteredFields<Omit<NpcSymbiontInput, 'symbiontInstanceId'>>;
}
export interface NpcSkillSelectionRequest {
  readonly skillKey: SkillKey;
  readonly targetBonus: number;
  readonly pool: 'START' | 'TRAINING';
}
/** References select existing prepared consequences; they cannot manufacture their payload or authority. */
export interface NpcInitialStateEditorInput {
  readonly currentHP: number;
  readonly effectInstanceIds: readonly string[];
  readonly traumaInstanceIds: readonly string[];
  readonly woundInstanceIds: readonly string[];
  readonly sourceSpecificStateFactIds: readonly string[];
  readonly deathConsequenceFactIdOrNull: string | null;
}
export interface NpcInitialStageRequest {
  readonly input: NpcEnteredFields<NpcInitialStateEditorInput>;
  /** NPC-013 and NPC-016 edit the same stored OE field, not two competing copies. */
  readonly currentOeChanges: readonly Readonly<{
    symbiontInstanceId: string;
    currentOE: NpcDraftSection<number>;
  }>[];
}
type CustomProfile = Extract<NpcItemProfileRequest, { kind: 'STRUCTURED_CUSTOM' }>;
export type NpcDiceEditor =
  | Readonly<{ kind: 'RETAIN' }>
  | Readonly<{
      kind: 'MASTER_DICE';
      pattern: NpcDraftSection<
        Extract<MasterWeaponProfileInput['damageDefinition'], { kind: 'MASTER_DICE' }>['pattern']
      >;
      constantOrNull: NpcDraftSection<number | null>;
    }>;
export interface NpcMasterWeaponEditor {
  readonly input: NpcEnteredFields<
    Pick<
      MasterWeaponProfileInput,
      'weaponVariantId' | 'instanceDamageOrNull' | 'rangeMetersOrNull' | 'accuracyBonusOrNull'
    >
  >;
  readonly damageDefinition: NpcDraftSection<NpcDiceEditor>;
  readonly penetrationDefinition: NpcDraftSection<NpcDiceEditor>;
  readonly statRequirements: Readonly<Record<StatCode, NpcDraftSection<number | null>>>;
}
export type NpcItemProfileEditor =
  | Readonly<{ kind: 'CATALOG' }>
  | Readonly<{
      kind: 'MASTER_WEAPON';
      reason: NpcDraftSection<string>;
      inputs: readonly NpcMasterWeaponEditor[];
    }>
  | Readonly<{
      kind: 'STRUCTURED_CUSTOM';
      input: NpcEnteredFields<Omit<CustomProfile, 'kind' | 'customBonusOrNull'>>;
      customBonusOrNull: NpcDraftSection<null | NpcEnteredFields<{
        customBonusStat: StatCode;
        customBonusValue: number;
      }>>;
    }>;
/** Incomplete technical input, intentionally not an NpcInventoryRequestEntry cast. */
export interface NpcInventoryEditorRow {
  readonly itemInstanceId: string;
  readonly input: NpcEnteredFields<Omit<NpcInventoryRequestEntry, 'itemInstanceId' | 'profile'>>;
  readonly profile: NpcDraftSection<NpcItemProfileEditor>;
}

export interface NpcEditorStages {
  readonly 'NPC-002': NpcEnteredFields<NpcIdentityStageInput>;
  readonly 'NPC-011': NpcEnteredFields<NpcSchemaStageInput>;
  readonly 'NPC-012': NpcEnteredFields<StatBlock>;
  readonly 'NPC-013': NpcDraftSection<readonly NpcSymbiontEditorRow[]>;
  readonly 'NPC-014': NpcDraftSection<readonly NpcEnteredFields<NpcSkillSelectionRequest>[]>;
  readonly 'NPC-015': NpcDraftSection<readonly NpcInventoryEditorRow[]>;
  readonly 'NPC-016': NpcInitialStageRequest;
  readonly 'NPC-017': Readonly<Record<string, never>>;
}
/** Saved technical editor input only: not NpcSheetInput, a validated snapshot, or an authenticated binding. */
export interface NpcEditorDraft {
  readonly schemaVersion: 1;
  readonly identity: NpcEditorStages['NPC-002'];
  readonly schema: NpcEditorStages['NPC-011'];
  readonly baseStats: NpcEditorStages['NPC-012'];
  readonly symbionts: NpcEditorStages['NPC-013'];
  readonly skills: NpcEditorStages['NPC-014'];
  readonly inventory: NpcEditorStages['NPC-015'];
  readonly initialState: NpcEnteredFields<NpcInitialStateEditorInput>;
}

export class NpcStagedInputError extends Error {
  constructor(detail: string) {
    super(`NPC staged input: ${detail}`);
    this.name = new.target.name;
  }
}
type Reader<T> = (value: unknown) => T;
type Readers<T> = { readonly [K in keyof T]: Reader<T[K]> };
function fail(detail: string): never {
  throw new NpcStagedInputError(detail);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail('expected plain object');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((k) => typeof k !== 'string' || !keys.includes(k))
  )
    fail('unexpected or missing fields');
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail(`expected own data field ${key}`);
    out[key] = d.value as unknown;
  }
  return out;
}
function array<T>(value: unknown, read: Reader<T>): readonly T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    fail('expected plain dense array');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(value).length !== length + 1
  )
    fail('sparse or extended array');
  return Object.freeze(
    Array.from({ length }, (_, index) => {
      const d = Object.getOwnPropertyDescriptor(value, String(index));
      if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
        fail('expected own array index');
      return read(d.value as unknown);
    }),
  );
}
function text(v: unknown): string {
  return typeof v === 'string' ? v : fail('expected text');
}
function id(v: unknown): string {
  return typeof v === 'string' && UUID.test(v) ? v : fail('expected canonical UUID v4');
}
function reference(v: unknown): string {
  return typeof v === 'string' && v.length > 0 && v.trim() === v
    ? v
    : fail('expected exact reference');
}
function finite(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fail('expected finite input number');
}
function integer(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : fail('expected safe integer input');
}
function nullable<T>(read: Reader<T>): Reader<T | null> {
  return (v) => (v === null ? null : read(v));
}
function choice<T extends string>(v: unknown, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) fail('unrecognized input choice');
  return v as T;
}
function unique<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  if (new Set(values.map(key)).size !== values.length) fail('duplicate input reference');
  return values;
}
function ids(v: unknown): readonly string[] {
  return unique(array(v, id), (v) => v);
}
function entered<T>(value: unknown, read: Reader<T>): NpcDraftSection<T> {
  const d =
    value !== null && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'kind')
      : undefined;
  const kind: unknown = d !== undefined && Object.hasOwn(d, 'value') ? d.value : undefined;
  if (kind === 'UNSET') {
    object(value, ['kind']);
    return Object.freeze({ kind: 'UNSET' });
  }
  if (kind !== 'ENTERED') fail('expected UNSET or ENTERED marker');
  const row = object(value, ['kind', 'value']);
  return Object.freeze({ kind: 'ENTERED', value: read(row['value']) });
}
function fields<T extends object>(value: unknown, readers: Readers<T>): NpcEnteredFields<T> {
  const row = object(value, Object.keys(readers));
  const result = {} as { [K in keyof T]: NpcDraftSection<T[K]> };
  for (const key of Object.keys(readers) as (keyof T & string)[])
    result[key] = entered(row[key], readers[key]);
  return Object.freeze(result);
}
function binding(value: unknown): SymbiontBinding {
  const d =
    value !== null && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'kind')
      : undefined;
  const kind: unknown = d !== undefined && Object.hasOwn(d, 'value') ? d.value : undefined;
  if (kind === 'OWL_EYE' || kind === 'EEL_ARM') {
    const row = object(value, ['kind', 'side']);
    return Object.freeze({ kind, side: choice(row['side'], ['LEFT', 'RIGHT']) });
  }
  if (
    kind === 'NONE' ||
    kind === 'TICK_RIGHT_HAND' ||
    kind === 'SPIDER_BOTH_WRISTS' ||
    kind === 'MANTIS_BOTH_FOREARMS'
  ) {
    object(value, ['kind']);
    return Object.freeze({ kind });
  }
  return fail('unknown source binding shape');
}
const identityReaders: Readers<NpcIdentityStageInput> = {
  name: text,
  description: nullable(text),
  affiliation: text,
  campaignRole: text,
  sex: (v) => choice(v, ['MALE', 'FEMALE']),
  massKg: finite,
  artAssetKeyOrNull: nullable(reference),
};
const statReaders: Readers<StatBlock> = {
  S: integer,
  D: integer,
  M: integer,
  Z: integer,
  I: integer,
  W: integer,
  C: integer,
};
const initialReaders: Readers<NpcInitialStateEditorInput> = {
  currentHP: finite,
  effectInstanceIds: ids,
  traumaInstanceIds: ids,
  woundInstanceIds: ids,
  sourceSpecificStateFactIds: ids,
  deathConsequenceFactIdOrNull: nullable(id),
};
function schema(value: unknown, catalog: NpcEditorCatalog): NpcEditorStages['NPC-011'] {
  return fields<NpcSchemaStageInput>(value, {
    raceCode: (v) =>
      choice(
        v,
        catalog.skills.races.map((r) => r.raceCode),
      ),
    pureClassOrNull: nullable((v) =>
      choice(
        v,
        catalog.skills.classes.map((c) => c.classCode),
      ),
    ),
    anatomyProfileId: (v) => choice(v, ['STANDARD_HUMANOID']),
  });
}
function symbionts(value: unknown, catalog: NpcEditorCatalog): NpcEditorStages['NPC-013'] {
  return entered(value, (v) =>
    unique(
      array(v, (raw) => {
        const row = object(raw, ['symbiontInstanceId', 'input']);
        return Object.freeze({
          symbiontInstanceId: id(row['symbiontInstanceId']),
          input: fields<Omit<NpcSymbiontInput, 'symbiontInstanceId'>>(row['input'], {
            speciesKey: (v) =>
              choice(
                v,
                catalog.development.levels.map((l) => l.speciesKey),
              ),
            targetLevel: integer,
            learnedNodeRefs: (v) =>
              unique(
                array(v, (ref) => {
                  const node = reference(ref);
                  if (!catalog.development.nodes.some((n) => n.nodeRef === node))
                    fail('unknown development node reference');
                  return node;
                }),
                (v) => v,
              ),
            binding,
            currentOE: finite,
          }),
        });
      }),
      (row) => row.symbiontInstanceId,
    ),
  );
}
function skills(value: unknown, catalog: NpcEditorCatalog): NpcEditorStages['NPC-014'] {
  return entered(value, (v) =>
    array(v, (row) =>
      fields<NpcSkillSelectionRequest>(row, {
        skillKey: (v) => {
          const key = reference(v),
            source = catalog.skills.skills.find((s) => s.skillKey === key);
          if (source === undefined || source.category !== 'SELECTABLE_GENERAL')
            return fail('expected source selectable skill');
          return source.skillKey;
        },
        targetBonus: integer,
        pool: (v) => choice(v, ['START', 'TRAINING']),
      }),
    ),
  );
}
function initial(value: unknown): NpcInitialStageRequest {
  const row = object(value, ['input', 'currentOeChanges']);
  return Object.freeze({
    input: fields(row['input'], initialReaders),
    currentOeChanges: unique(
      array(row['currentOeChanges'], (value) => {
        const row = object(value, ['symbiontInstanceId', 'currentOE']);
        return Object.freeze({
          symbiontInstanceId: id(row['symbiontInstanceId']),
          currentOE: entered(row['currentOE'], finite),
        });
      }),
      (row) => row.symbiontInstanceId,
    ),
  });
}

/** Exact host-owned allocations/prepared facts for this attempt, never a browser-supplied allowlist. */
export interface NpcInventoryEditorContext {
  readonly catalog: NpcInventoryCatalog;
  readonly itemInstanceIds: readonly string[];
  readonly linkedSetInstanceIds: readonly string[];
  readonly coatingBindings: readonly Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
  }>[];
  readonly qualityBindings: readonly Readonly<{ itemInstanceId: string; qualityRoll: number }>[];
}
function booleanInput(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail('expected boolean input');
}
function dataKind(value: unknown): unknown {
  const d =
    value !== null && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'kind')
      : undefined;
  return d !== undefined && Object.hasOwn(d, 'value') ? (d.value as unknown) : undefined;
}
const inventoryInputReaders: Readers<
  NpcInventoryEditorRow['input'] extends NpcEnteredFields<infer T> ? T : never
> = {
  itemTypeId: reference,
  quantity: finite,
  equipped: booleanInput,
  equippedSlots: (v) => unique(array(v, reference), (v) => v),
  bodyZone: nullable((v) => choice(v, ARMOR_BODY_ZONES)),
  gripMode: nullable((v) => choice(v, ['ONE_HAND', 'TWO_HAND'])),
  currentAmmo: nullable(finite),
  shieldCurrentHP: nullable(finite),
  broken: booleanInput,
  sealed: nullable(booleanInput),
  linkedSetInstanceId: nullable(id),
  componentRole: nullable((v) => choice(v, ['SWORD', 'RAPIER', 'SHIELD'])),
  qualityRoll: nullable(finite),
  coatingInstanceIds: ids,
  issueReason: text,
};
const nullableStatReaders: Readers<Record<StatCode, number | null>> = {
  S: nullable(finite),
  D: nullable(finite),
  M: nullable(finite),
  Z: nullable(finite),
  I: nullable(finite),
  W: nullable(finite),
  C: nullable(finite),
};
const masterInputReaders: Readers<
  NpcMasterWeaponEditor['input'] extends NpcEnteredFields<infer T> ? T : never
> = {
  weaponVariantId: (v) => choice(v, STARTING_WEAPON_VARIANTS),
  instanceDamageOrNull: nullable(finite),
  rangeMetersOrNull: nullable(finite),
  accuracyBonusOrNull: nullable(finite),
};
const customInputReaders: Readers<Omit<CustomProfile, 'kind' | 'customBonusOrNull'>> = {
  name: text,
  description: text,
  massKg: nullable(finite),
  heldSizeClass: (v) => choice(v, ['FITS_IN_FIST', 'LARGE', 'UNKNOWN']),
  armorWeightClass: (v) => choice(v, ['LIGHT', 'OTHER', 'UNKNOWN']),
  flammability: (v) => choice(v, ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN']),
  isIgnitionSource: booleanInput,
  isFood: booleanInput,
  canReceivePoison: booleanInput,
  canReceiveFlammableCoating: booleanInput,
};
function diceEditor(value: unknown): NpcDiceEditor {
  const kind = dataKind(value);
  if (kind === 'RETAIN') {
    object(value, ['kind']);
    return Object.freeze({ kind });
  }
  if (kind !== 'MASTER_DICE') return fail('unknown weapon expression input kind');
  const row = object(value, ['kind', 'pattern', 'constantOrNull']);
  return Object.freeze({
    kind,
    // Same closed Item Registry MasterDiceGrammarTable as readNpcInventoryRequest.
    pattern: entered(row['pattern'], (v) =>
      choice(v, ['R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'] as const),
    ),
    constantOrNull: entered(row['constantOrNull'], nullable(finite)),
  });
}
function weaponEditor(value: unknown): NpcMasterWeaponEditor {
  const row = object(value, [
    'input',
    'damageDefinition',
    'penetrationDefinition',
    'statRequirements',
  ]);
  return Object.freeze({
    input: fields(row['input'], masterInputReaders),
    damageDefinition: entered(row['damageDefinition'], diceEditor),
    penetrationDefinition: entered(row['penetrationDefinition'], diceEditor),
    statRequirements: fields(row['statRequirements'], nullableStatReaders),
  });
}
function profileEditor(value: unknown): NpcItemProfileEditor {
  const kind = dataKind(value);
  if (kind === 'CATALOG') {
    object(value, ['kind']);
    return Object.freeze({ kind });
  }
  if (kind === 'MASTER_WEAPON') {
    const row = object(value, ['kind', 'reason', 'inputs']);
    return Object.freeze({
      kind,
      reason: entered(row['reason'], text),
      inputs: array(row['inputs'], weaponEditor),
    });
  }
  if (kind !== 'STRUCTURED_CUSTOM') return fail('unknown item profile input kind');
  const row = object(value, ['kind', 'input', 'customBonusOrNull']);
  return Object.freeze({
    kind,
    input: fields(row['input'], customInputReaders),
    customBonusOrNull: entered(
      row['customBonusOrNull'],
      nullable((v) =>
        fields(v, {
          customBonusStat: (v) => choice(v, ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const),
          customBonusValue: finite,
        }),
      ),
    ),
  });
}
function inventoryContext(catalog: NpcEditorCatalog): NpcInventoryEditorContext {
  const context = catalog.inventory;
  if (context === undefined) return fail('nonempty inventory requires host-owned attempt bindings');
  // Snapshot only these narrow lists: no reference to a mutable caller array escapes the read.
  const itemInstanceIds = ids(context.itemInstanceIds),
    linkedSetInstanceIds = ids(context.linkedSetInstanceIds);
  const coatingBindings = unique(
    array(context.coatingBindings, (v) => {
      const r = object(v, ['coatingInstanceId', 'itemInstanceId']);
      const itemInstanceId = id(r['itemInstanceId']);
      if (!itemInstanceIds.includes(itemInstanceId))
        fail('prepared coating targets an unallocated item');
      return Object.freeze({ coatingInstanceId: id(r['coatingInstanceId']), itemInstanceId });
    }),
    (v) => v.coatingInstanceId,
  );
  const qualityBindings = unique(
    array(context.qualityBindings, (v) => {
      const r = object(v, ['itemInstanceId', 'qualityRoll']);
      const itemInstanceId = id(r['itemInstanceId']),
        qualityRoll = integer(r['qualityRoll']);
      if (!itemInstanceIds.includes(itemInstanceId) || qualityRoll < 1 || qualityRoll > 20)
        fail('invalid prepared R20 quality binding');
      return Object.freeze({ itemInstanceId, qualityRoll });
    }),
    (v) => v.itemInstanceId,
  );
  return Object.freeze({
    catalog: context.catalog,
    itemInstanceIds,
    linkedSetInstanceIds,
    coatingBindings,
    qualityBindings,
  });
}
/** Restores partial input, not a mechanical item or a proof that a browser owns these IDs. */
export function readNpcInventoryEditorInput(
  catalog: NpcEditorCatalog,
  value: unknown,
): NpcEditorStages['NPC-015'] {
  return entered(value, (value) => {
    const rows = unique(
      array(value, (value) => {
        const row = object(value, ['itemInstanceId', 'input', 'profile']);
        return Object.freeze({
          itemInstanceId: id(row['itemInstanceId']),
          input: fields(row['input'], inventoryInputReaders),
          profile: entered(row['profile'], profileEditor),
        });
      }),
      (row) => row.itemInstanceId,
    );
    if (rows.length === 0) return rows;
    const context = inventoryContext(catalog);
    for (const row of rows) {
      const input = row.input;
      if (!context.itemInstanceIds.includes(row.itemInstanceId))
        fail('foreign or unallocated item identity');
      const itemTypeId = input.itemTypeId,
        qualityRoll = input.qualityRoll;
      if (
        itemTypeId.kind === 'ENTERED' &&
        !context.catalog.definitions.some((d) => d.itemTypeId === itemTypeId.value)
      )
        fail('unknown source item type');
      if (
        input.linkedSetInstanceId.kind === 'ENTERED' &&
        input.linkedSetInstanceId.value !== null &&
        !context.linkedSetInstanceIds.includes(input.linkedSetInstanceId.value)
      )
        fail('foreign or unallocated linked set identity');
      if (
        input.coatingInstanceIds.kind === 'ENTERED' &&
        input.coatingInstanceIds.value.some(
          (id) =>
            !context.coatingBindings.some(
              (c) => c.coatingInstanceId === id && c.itemInstanceId === row.itemInstanceId,
            ),
        )
      )
        fail('coating is not prepared for this item');
      if (
        qualityRoll.kind === 'ENTERED' &&
        qualityRoll.value !== null &&
        !context.qualityBindings.some(
          (q) => q.itemInstanceId === row.itemInstanceId && q.qualityRoll === qualityRoll.value,
        )
      )
        fail('quality is not a prepared result for this item');
    }
    return rows;
  });
}
function required<T>(input: NpcDraftSection<T>, path: string): T {
  if (input.kind !== 'ENTERED') return fail(`${path} remains UNSET`);
  return input.value;
}
function completeFields<T extends object>(input: NpcEnteredFields<T>, path: string): T {
  const result = {} as T;
  for (const key of Object.keys(input) as (keyof T & string)[])
    result[key] = required(input[key], `${path}.${key}`);
  return result;
}
function completeDice(
  input: NpcDraftSection<NpcDiceEditor>,
  path: string,
): MasterWeaponProfileInput['damageDefinition'] {
  const value = required(input, path);
  return value.kind === 'RETAIN'
    ? { kind: 'RETAIN' }
    : {
        kind: 'MASTER_DICE',
        pattern: required(value.pattern, `${path}.pattern`),
        constantOrNull: required(value.constantOrNull, `${path}.constantOrNull`),
      };
}
function completeProfile(
  input: NpcDraftSection<NpcItemProfileEditor>,
  path: string,
): NpcItemProfileRequest {
  const profile = required(input, path);
  if (profile.kind === 'CATALOG') return { kind: 'CATALOG' };
  if (profile.kind === 'MASTER_WEAPON')
    return {
      kind: 'MASTER_WEAPON',
      reason: required(profile.reason, `${path}.reason`),
      inputs: profile.inputs.map((input, index) => {
        const p = `${path}.inputs.${String(index)}`,
          requirements = completeFields(input.statRequirements, `${p}.statRequirements`),
          statRequirements: Partial<Record<StatCode, number>> = {};
        // Explicit null means absence in the existing sparse request map, not a default numeric requirement.
        for (const key of Object.keys(requirements) as StatCode[])
          if (requirements[key] !== null) statRequirements[key] = requirements[key];
        return {
          ...completeFields(input.input, p),
          statRequirements,
          damageDefinition: completeDice(input.damageDefinition, `${p}.damageDefinition`),
          penetrationDefinition: completeDice(
            input.penetrationDefinition,
            `${p}.penetrationDefinition`,
          ),
        };
      }),
    };
  const bonus = required(profile.customBonusOrNull, `${path}.customBonusOrNull`);
  return {
    kind: 'STRUCTURED_CUSTOM',
    ...completeFields(profile.input, path),
    // The existing structured custom request requires this condition; it is not a client-controlled flag.
    customBonusOrNull:
      bonus === null
        ? null
        : { ...completeFields(bonus, `${path}.customBonusOrNull`), activeOnlyInBackpack: true },
  };
}
/** All fields must be entered before the existing strict request reader runs. Still not a full NPC/source validator. */
export function projectNpcInventoryRequest(
  catalog: NpcEditorCatalog,
  value: unknown,
): readonly NpcInventoryRequestEntry[] {
  const stage = readNpcInventoryEditorInput(catalog, value),
    rows = required(stage, 'inventory');
  return readNpcInventoryRequest(
    rows.map((row, index) => ({
      itemInstanceId: row.itemInstanceId,
      ...completeFields(row.input, `inventory.${String(index)}.input`),
      profile: completeProfile(row.profile, `inventory.${String(index)}.profile`),
    })),
  );
}
function emptyFields<T extends object>(readers: Readers<T>): NpcEnteredFields<T> {
  const result = {} as { [K in keyof T]: NpcDraftSection<T[K]> };
  for (const key of Object.keys(readers) as (keyof T & string)[])
    result[key] = Object.freeze({ kind: 'UNSET' });
  return Object.freeze(result);
}
/** The supplied ID must already be allocated by the host; this factory never creates an identity or game value. */
export function createEmptyNpcInventoryEditorRow(
  catalog: NpcEditorCatalog,
  hostItemInstanceId: string,
): NpcInventoryEditorRow {
  const row = {
    itemInstanceId: hostItemInstanceId,
    input: emptyFields(inventoryInputReaders),
    profile: { kind: 'UNSET' } as const,
  };
  const stage = readNpcInventoryEditorInput(catalog, { kind: 'ENTERED', value: [row] });
  if (stage.kind !== 'ENTERED' || stage.value[0] === undefined)
    return fail('missing empty row after read');
  return stage.value[0];
}
/** Only technical absence: no sex, race, mass, time, HP, quantity or equipment defaults. */
export function createEmptyNpcEditorDraft(): NpcEditorDraft {
  const unset = Object.freeze({ kind: 'UNSET' } as const);
  return Object.freeze({
    schemaVersion: 1,
    identity: emptyFields(identityReaders),
    schema: Object.freeze({ raceCode: unset, pureClassOrNull: unset, anatomyProfileId: unset }),
    baseStats: emptyFields(statReaders),
    symbionts: unset,
    skills: unset,
    inventory: unset,
    initialState: emptyFields(initialReaders),
  });
}

/**
 * Closed editor shape only. Invalid-but-finite numeric/text input can survive back navigation;
 * source constraints and full readiness are separate guards. This cannot authorize persistence,
 * resolve a prepared reference, accept caller-derived values, or mint rolls/lifetime facts.
 */
export function readNpcStageInput<F extends NpcEditorFormId>(
  catalog: NpcEditorCatalog,
  form: F,
  value: unknown,
): NpcEditorStages[F] {
  let result: NpcEditorStages[NpcEditorFormId];
  switch (form) {
    case 'NPC-002':
      result = fields(value, identityReaders);
      break;
    case 'NPC-011':
      result = schema(value, catalog);
      break;
    case 'NPC-012':
      result = fields(value, statReaders);
      break;
    case 'NPC-013':
      result = symbionts(value, catalog);
      break;
    case 'NPC-014':
      result = skills(value, catalog);
      break;
    case 'NPC-015':
      result = readNpcInventoryEditorInput(catalog, value);
      break;
    case 'NPC-016':
      result = initial(value);
      break;
    case 'NPC-017':
      object(value, []);
      result = Object.freeze({});
      break;
    default:
      return fail('unknown NPC editor form');
  }
  return result as NpcEditorStages[F];
}

/** This reader deliberately has no FINAL/valid/success branch. An editor draft is never a saved NPC version. */
export function readNpcEditorDraft(catalog: NpcEditorCatalog, value: unknown): NpcEditorDraft {
  const row = object(value, [
    'schemaVersion',
    'identity',
    'schema',
    'baseStats',
    'symbionts',
    'skills',
    'inventory',
    'initialState',
  ]);
  if (row['schemaVersion'] !== 1) fail('unknown editor draft schema');
  return Object.freeze({
    schemaVersion: 1,
    identity: readNpcStageInput(catalog, 'NPC-002', row['identity']),
    schema: readNpcStageInput(catalog, 'NPC-011', row['schema']),
    baseStats: readNpcStageInput(catalog, 'NPC-012', row['baseStats']),
    symbionts: readNpcStageInput(catalog, 'NPC-013', row['symbionts']),
    skills: readNpcStageInput(catalog, 'NPC-014', row['skills']),
    inventory: readNpcStageInput(catalog, 'NPC-015', row['inventory']),
    initialState: fields(row['initialState'], initialReaders),
  });
}

/** A pure edit; caller must guard authority/current attempt and preserve mechanical receipt closure separately. */
export function applyNpcStageInput(
  catalog: NpcEditorCatalog,
  saved: unknown,
  form: NpcEditorFormId,
  value: unknown,
): NpcEditorDraft {
  const draft = readNpcEditorDraft(catalog, saved);
  switch (form) {
    case 'NPC-002':
      return Object.freeze({ ...draft, identity: readNpcStageInput(catalog, form, value) });
    case 'NPC-011':
      return Object.freeze({ ...draft, schema: readNpcStageInput(catalog, form, value) });
    case 'NPC-012':
      return Object.freeze({ ...draft, baseStats: readNpcStageInput(catalog, form, value) });
    case 'NPC-013':
      return Object.freeze({ ...draft, symbionts: readNpcStageInput(catalog, form, value) });
    case 'NPC-014':
      return Object.freeze({ ...draft, skills: readNpcStageInput(catalog, form, value) });
    case 'NPC-015':
      return Object.freeze({ ...draft, inventory: readNpcStageInput(catalog, form, value) });
    case 'NPC-016': {
      const request = readNpcStageInput(catalog, form, value);
      let composition = draft.symbionts;
      if (request.currentOeChanges.length !== 0) {
        if (composition.kind !== 'ENTERED')
          return fail('OE change requires existing composition input');
        const changes = new Map(
          request.currentOeChanges.map((c) => [c.symbiontInstanceId, c.currentOE]),
        );
        if (
          request.currentOeChanges.some(
            (c) =>
              composition.kind !== 'ENTERED' ||
              !composition.value.some((s) => s.symbiontInstanceId === c.symbiontInstanceId),
          )
        )
          fail('OE change references an absent symbiont input');
        composition = Object.freeze({
          kind: 'ENTERED',
          value: Object.freeze(
            composition.value.map((s) =>
              Object.freeze({
                ...s,
                input: Object.freeze({
                  ...s.input,
                  currentOE: changes.get(s.symbiontInstanceId) ?? s.input.currentOE,
                }),
              }),
            ),
          ),
        });
      }
      return Object.freeze({ ...draft, symbionts: composition, initialState: request.input });
    }
    case 'NPC-017':
      readNpcStageInput(catalog, form, value);
      return draft;
    default:
      return fail('unknown NPC editor form');
  }
}
