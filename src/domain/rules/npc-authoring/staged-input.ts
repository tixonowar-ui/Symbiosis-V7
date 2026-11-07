import type { DiseaseId } from '@generated/types/effects.js';
import {
  readNpcInitialTraumaChoices,
  type NpcInitialTraumaCatalog,
  type NpcInitialTraumaChoice,
  type NpcInitialTraumaFact,
} from './initial-trauma.js';
import type { NpcTraumaInstance } from './effect-types.js';
import type { ArmorBodyZone } from '../item-stage/armor-bundle.js';
import type { StatCode } from '@generated/types/character.js';
import { ARMOR_BODY_ZONES } from '../item-stage/armor-bundle.js';
import { STARTING_WEAPON_VARIANTS } from '../item-stage/starting-weapon.js';
import type { MasterWeaponProfileInput } from '../item-stage/master-weapon-profile.js';
import type { SkillKey, SkillStageCatalog } from '../skill-stage/catalog.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { SymbiontBinding } from '../symbiont-stage/catalog.js';
import type { NpcDevelopmentCatalog } from './catalog.js';
import { validateNpcDevelopmentSelection } from './development-selection.js';
import {
  readNpcInventoryRequest,
  readNpcItemQualityTier,
  npcInventoryMetadataChoices,
  type NpcItemQualityTier,
  type NpcClothingProperties,
  readNpcInventoryRestorationRows,
  readNpcCustomProfileReference,
  readNpcCustomBonusContainerBinding,
  readNpcCustomProfileContent,
  type NpcInventoryRequestEntry,
  type NpcItemProfileRequest,
  type NpcInventoryCatalog,
  type NpcCatalogueInventoryRequestEntry,
  type NpcCampaignCustomProfileReference,
  type NpcCatalogueCustomModifierReference,
  type NpcCustomBonusContainerBinding,
  type NpcCustomProfileContent,
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
  /** Host identity ancestry and the replayed current composition; never supplied in stage JSON. */
  readonly composition?: readonly Readonly<{
    symbiontInstanceId: string;
    speciesKeyOrNull: NpcSymbiontInput['speciesKey'] | null;
    retired: boolean;
  }>[];

  /** Required for nonempty NPC-015 input; the host reconstructs it from its attempt journal. */
  readonly inventory?: NpcInventoryEditorContext;
  /** Required for selected prepared diseases; scoped host bindings, not a client allowlist. */
  readonly effects?: readonly (Readonly<{ effectInstanceId: string }> &
    (
      | Readonly<{ diseaseId: DiseaseId }>
      | Readonly<{ sourceKind: 'ALCOHOL' }>
      | Readonly<{ sourceKind: 'FORMAL_CONTROL'; controlKind: 'SLEEP' | 'PARALYSIS' }>
      | Readonly<{
          sourceKind: 'HP_MODE';
          mode: 'HUNGER' | 'REGENERATION';
          sourceInstanceId: string;
        }>
    ))[];
  readonly wounds?: readonly string[];
  readonly traumas?: Readonly<{
    catalog: NpcInitialTraumaCatalog;
    bindings: readonly Readonly<{
      traumaInstanceId: string;
      retainedRowOrNull: NpcTraumaEditorRow | null;
    }>[];
  }>;
}
export interface NpcSymbiontEditorRow {
  /** Assigned by the owning attempt; existence/ownership is checked by the host. */
  readonly symbiontInstanceId: string;
  readonly input: NpcEnteredFields<Omit<NpcSymbiontInput, 'symbiontInstanceId'>>;
}
export interface NpcSkillSelectionRequest {
  readonly skillKey: SkillKey;
  readonly targetBonus: number;
  readonly pool: 'START' | 'TRAINING' | 'SYM-166';
}
export interface NpcTraumaEditorRow {
  readonly traumaInstanceId: string;
  readonly input: NpcEnteredFields<{
    regionId: ArmorBodyZone;
    traumaValue: number;
    reason: string;
  }>;
  readonly head: NpcDraftSection<{
    readonly penalty: NpcDraftSection<'PENDING' | 'CONSUMED'>;
    readonly stun: NpcDraftSection<
      | Readonly<{ status: 'ABSENT' }>
      | Readonly<{ status: 'ACTIVE'; remainingMinutes: NpcDraftSection<string> }>
    >;
  }>;
}
/** References select existing prepared consequences; they cannot manufacture their payload or authority. */
export interface NpcInitialStateEditorInput {
  readonly currentHP: number;
  readonly effectInstanceIds: readonly string[];
  readonly traumaInstanceIds: readonly string[];
  readonly woundInstanceIds: readonly string[];
  readonly sourceSpecificStateFactIds: readonly string[];
  readonly deathConsequenceFactIdOrNull: string | null;
  readonly lifeStateConfirmationId?: string;
  readonly weaverEffectInstanceIds?: readonly string[];
  readonly poisonModeFactIds?: readonly string[];
  /** Absent only in the exact legacy no-trauma shape; old bytes are not normalized. */
  readonly traumaInputs?: readonly NpcTraumaEditorRow[];
}
export type NpcInitialStateFields = NpcEnteredFields<
  Omit<
    NpcInitialStateEditorInput,
    'traumaInputs' | 'lifeStateConfirmationId' | 'weaverEffectInstanceIds' | 'poisonModeFactIds'
  >
> &
  Readonly<{
    traumaInputs?: NpcDraftSection<readonly NpcTraumaEditorRow[]>;
    lifeStateConfirmationId?: NpcDraftSection<string>;
    weaverEffectInstanceIds?: NpcDraftSection<readonly string[]>;
    poisonModeFactIds?: NpcDraftSection<readonly string[]>;
  }>;
export interface NpcInitialStageRequest {
  readonly input: NpcInitialStateFields;
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
export interface NpcCatalogueCustomModifierEditor {
  readonly reference: NpcDraftSection<NpcCatalogueCustomModifierReference>;
  readonly profile: NpcDraftSection<Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }>>;
  readonly bonusContainerBinding: NpcDraftSection<NpcCustomBonusContainerBinding>;
  readonly reason: NpcDraftSection<string>;
}
export type NpcCatalogueInventoryEditorInput = NpcEnteredFields<
  Omit<
    NpcCatalogueInventoryRequestEntry,
    'itemInstanceId' | 'profile' | 'customModifier' | 'qualityTier' | 'clothingProperties'
  >
>;
export interface NpcInventoryMetadataEditor {
  readonly qualityTier?: NpcDraftSection<NpcItemQualityTier | null>;
  readonly clothingProperties?: NpcDraftSection<NpcEnteredFields<NpcClothingProperties>>;
}
export interface NpcCatalogueInventoryEditorRow extends NpcInventoryMetadataEditor {
  readonly itemInstanceId: string;
  readonly input: NpcCatalogueInventoryEditorInput;
  readonly profile: NpcDraftSection<NpcItemProfileEditor>;
  readonly customModifier?: NpcCatalogueCustomModifierEditor;
}
export interface NpcCampaignCustomInventoryEditorRow extends NpcInventoryMetadataEditor {
  readonly itemInstanceId: string;
  readonly input: Omit<NpcCatalogueInventoryEditorInput, 'itemTypeId'> &
    Readonly<{ itemTypeId: NpcDraftSection<null> }>;
  readonly itemTypeReference: NpcDraftSection<NpcCampaignCustomProfileReference>;
  readonly profile: NpcDraftSection<Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }>>;
  readonly bonusContainerBinding: NpcDraftSection<NpcCustomBonusContainerBinding>;
  readonly customProfileReason: NpcDraftSection<string>;
}
export type NpcInventoryEditorRow =
  NpcCatalogueInventoryEditorRow | NpcCampaignCustomInventoryEditorRow;

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
  readonly initialState: NpcInitialStateFields;
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
const initialReaders: Readers<
  Omit<
    NpcInitialStateEditorInput,
    'traumaInputs' | 'lifeStateConfirmationId' | 'weaverEffectInstanceIds' | 'poisonModeFactIds'
  >
> = {
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
  return entered(value, (v) => {
    const rows = unique(
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
    );
    if (rows.length === 0) return rows;
    const context = catalog.composition ?? fail('symbiont input requires checked host bindings');
    for (const row of rows) {
      const matches = context.filter((b) => b.symbiontInstanceId === row.symbiontInstanceId),
        own = matches[0];
      if (matches.length !== 1 || own === undefined)
        fail('symbiont is not a unique binding of this attempt');
      if (own.retired) fail('retired symbiont identity cannot be selected again');
      if (
        own.speciesKeyOrNull !== null &&
        (row.input.speciesKey.kind !== 'ENTERED' ||
          row.input.speciesKey.value !== own.speciesKeyOrNull)
      )
        fail('confirmed symbiont species is immutable; reserve a new identity');
    }
    return rows;
  });
}
/** Complete explicit choices only; current OE and binding constraints are then checked by the composition fold. */
export function projectNpcSymbiontInputs(
  catalog: NpcEditorCatalog,
  value: unknown,
): readonly NpcSymbiontInput[] {
  const stage = symbionts(value, catalog);
  if (stage.kind !== 'ENTERED') return fail('symbiont selection is unset');
  return Object.freeze(
    stage.value.map((row) => {
      const input = completeFields(row.input, 'symbiont input');
      validateNpcDevelopmentSelection(catalog.development, {
        speciesKey: input.speciesKey,
        targetLevel: input.targetLevel,
        learnedNodeRefs: input.learnedNodeRefs,
      });
      return Object.freeze({ symbiontInstanceId: row.symbiontInstanceId, ...input });
    }),
  );
}
/** Host allocation is required before adding this technical row; no species/level/OE or learned node is inferred. */
export function createEmptyNpcSymbiontEditorRow(
  catalog: NpcEditorCatalog,
  hostSymbiontInstanceId: string,
): NpcSymbiontEditorRow {
  const unset = Object.freeze({ kind: 'UNSET' as const });
  const stage = symbionts(
    {
      kind: 'ENTERED',
      value: [
        {
          symbiontInstanceId: hostSymbiontInstanceId,
          input: {
            speciesKey: unset,
            targetLevel: unset,
            learnedNodeRefs: unset,
            binding: unset,
            currentOE: unset,
          },
        },
      ],
    },
    catalog,
  );
  if (stage.kind !== 'ENTERED' || stage.value[0] === undefined)
    return fail('missing reserved symbiont row');
  return stage.value[0];
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
        pool: (v) => choice(v, ['START', 'TRAINING', 'SYM-166']),
      }),
    ),
  );
}
/** Closed partial input: invalid finite values and decimal text remain visible for correction. */
export function readNpcTraumaEditorRow(value: unknown): NpcTraumaEditorRow {
  const row = object(value, ['traumaInstanceId', 'input', 'head']);
  const input = fields<{ regionId: ArmorBodyZone; traumaValue: number; reason: string }>(
    row['input'],
    {
      regionId: (v) => choice(v, ARMOR_BODY_ZONES),
      traumaValue: finite,
      reason: text,
    },
  );
  const head = entered(row['head'], (v) => {
    const h = object(v, ['penalty', 'stun']);
    return Object.freeze({
      penalty: entered(h['penalty'], (v) => choice(v, ['PENDING', 'CONSUMED'] as const)),
      stun: entered(h['stun'], (v) => {
        const descriptor =
          v !== null && typeof v === 'object'
            ? Object.getOwnPropertyDescriptor(v, 'status')
            : undefined;
        const status: unknown =
          descriptor !== undefined && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined;
        if (status === 'ABSENT') {
          object(v, ['status']);
          return Object.freeze({ status: 'ABSENT' as const });
        }
        const r = object(v, ['status', 'remainingMinutes']);
        if (r['status'] !== 'ACTIVE') return fail('unknown head stun input');
        return Object.freeze({
          status: 'ACTIVE' as const,
          remainingMinutes: entered(r['remainingMinutes'], text),
        });
      }),
    });
  });
  if (
    (input.regionId.kind !== 'ENTERED' || input.regionId.value !== 'HEAD') &&
    head.kind !== 'UNSET'
  )
    fail('HEAD input requires explicitly selected HEAD region');
  return Object.freeze({ traumaInstanceId: id(row['traumaInstanceId']), input, head });
}
export function createEmptyNpcTraumaEditorRow(hostTraumaInstanceId: string): NpcTraumaEditorRow {
  const unset = Object.freeze({ kind: 'UNSET' } as const);
  return readNpcTraumaEditorRow({
    traumaInstanceId: hostTraumaInstanceId,
    input: { regionId: unset, traumaValue: unset, reason: unset },
    head: unset,
  });
}
/** The owning caller has already verified this immutable fact; this copies only editable-field values. */
export function npcTraumaEditorRowFromFact(fact: NpcInitialTraumaFact): NpcTraumaEditorRow {
  const entry = <T>(value: T): NpcDraftSection<T> => ({ kind: 'ENTERED', value });
  const consequence = fact.consequence;
  return readNpcTraumaEditorRow({
    traumaInstanceId: fact.trauma.traumaInstanceId,
    input: {
      regionId: entry(fact.trauma.regionId),
      traumaValue: entry(fact.trauma.traumaValue),
      reason: entry(fact.reason),
    },
    head:
      consequence.kind !== 'HEAD'
        ? { kind: 'UNSET' }
        : entry({
            penalty: entry(consequence.penalty),
            stun: entry(
              consequence.stun.status === 'ABSENT'
                ? { status: 'ABSENT' }
                : { status: 'ACTIVE', remainingMinutes: entry(consequence.stun.remainingMinutes) },
            ),
          }),
  });
}
function traumaRows(catalog: NpcEditorCatalog, value: unknown): readonly NpcTraumaEditorRow[] {
  const rows = unique(array(value, readNpcTraumaEditorRow), (r) => r.traumaInstanceId);
  if (rows.length === 0) return rows;
  const context = catalog.traumas ?? fail('trauma input requires checked host bindings');
  for (const row of rows) {
    const matches = context.bindings.filter((b) => b.traumaInstanceId === row.traumaInstanceId);
    const binding = matches[0];
    if (matches.length !== 1 || binding === undefined)
      fail('trauma is not a unique binding of this attempt');
    if (
      binding.retainedRowOrNull !== null &&
      JSON.stringify(readNpcTraumaEditorRow(binding.retainedRowOrNull)) !== JSON.stringify(row)
    )
      fail('retained trauma input is immutable; prepare a new identity for a new value');
  }
  return rows;
}
/** Complete selected rows pass the real source component; a client flag cannot promote a draft. */
export function projectNpcInitialTraumaInput(
  catalog: NpcEditorCatalog,
  value: unknown,
): Readonly<{
  currentTraumas: readonly NpcTraumaInstance[];
  choices: readonly NpcInitialTraumaChoice[];
}> {
  const input = initialFields(catalog, value),
    selected = required(input.traumaInstanceIds, 'traumaInstanceIds');
  if (selected.length === 0)
    return Object.freeze({ currentTraumas: Object.freeze([]), choices: Object.freeze([]) });
  const rows = required(input.traumaInputs ?? fail('missing trauma input'), 'traumaInputs');
  const currentTraumas: NpcTraumaInstance[] = [],
    choices: NpcInitialTraumaChoice[] = [];
  for (const traumaInstanceId of selected) {
    const row =
      rows.find((r) => r.traumaInstanceId === traumaInstanceId) ??
      fail('selected trauma has no input');
    const result = completeNpcTraumaEditorRow(
      catalog.traumas?.catalog ?? fail('missing trauma catalog'),
      row,
    );
    currentTraumas.push(result.trauma);
    choices.push(result.choice);
  }
  const context = catalog.traumas ?? fail('missing trauma catalog');
  return Object.freeze({
    currentTraumas: Object.freeze(currentTraumas),
    choices: readNpcInitialTraumaChoices(context.catalog, currentTraumas, choices),
  });
}
/** Source completion only. The host separately proves the row identity and original prefix. */
export function completeNpcTraumaEditorRow(
  catalog: NpcInitialTraumaCatalog,
  value: unknown,
): Readonly<{ trauma: NpcTraumaInstance; choice: NpcInitialTraumaChoice }> {
  const row = readNpcTraumaEditorRow(value),
    traumaInstanceId = row.traumaInstanceId;
  const values = completeFields(row.input, 'trauma.' + traumaInstanceId),
    regionId = values.regionId;
  const trauma = { traumaInstanceId, regionId, traumaValue: values.traumaValue };
  let consequence: NpcInitialTraumaChoice['consequence'];
  if (regionId === 'HEAD') {
    const head = required(row.head, 'head'),
      stun = required(head.stun, 'head.stun');
    consequence = {
      kind: 'HEAD',
      penalty: required(head.penalty, 'head.penalty'),
      stun:
        stun.status === 'ABSENT'
          ? stun
          : {
              status: 'ACTIVE',
              remainingMinutes: required(stun.remainingMinutes, 'head.remainingMinutes'),
            },
    };
  } else
    consequence =
      regionId === 'TORSO'
        ? { kind: 'TORSO', hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' }
        : { kind: 'LIMB' };
  const choice =
    readNpcInitialTraumaChoices(
      catalog,
      [trauma],
      [{ traumaInstanceId, reason: values.reason, consequence }],
    )[0] ?? fail('missing source trauma choice');
  return Object.freeze({ trauma: Object.freeze(trauma), choice });
}
function initialFields(catalog: NpcEditorCatalog, value: unknown): NpcInitialStateFields {
  const withTrauma =
    value !== null && typeof value === 'object' && Object.hasOwn(value, 'traumaInputs');
  const withLife =
    value !== null && typeof value === 'object' && Object.hasOwn(value, 'lifeStateConfirmationId');
  const withWeaver =
    value !== null && typeof value === 'object' && Object.hasOwn(value, 'weaverEffectInstanceIds');
  const withPoisonModes =
    value !== null && typeof value === 'object' && Object.hasOwn(value, 'poisonModeFactIds');
  const input: NpcInitialStateFields = fields(value, {
    ...initialReaders,
    ...(withTrauma ? { traumaInputs: (v: unknown) => traumaRows(catalog, v) } : {}),
    ...(withLife ? { lifeStateConfirmationId: id } : {}),
    ...(withWeaver ? { weaverEffectInstanceIds: ids } : {}),
    ...(withPoisonModes ? { poisonModeFactIds: ids } : {}),
  });
  // This readonly reference is produced only by the owning LIFE_STATE_SET/OPEN adapters.
  // Its UUID shape is not provenance: the journal/whole-sheet reader proves the actual SET.
  if (input.traumaInstanceIds.kind === 'ENTERED' && input.traumaInstanceIds.value.length !== 0) {
    const rows = input.traumaInputs;
    if (
      rows === undefined ||
      rows.kind !== 'ENTERED' ||
      input.traumaInstanceIds.value.some((id) => !rows.value.some((r) => r.traumaInstanceId === id))
    )
      fail('selected trauma requires an explicit host-bound input row');
  }
  if (input.woundInstanceIds.kind === 'ENTERED' && input.woundInstanceIds.value.length !== 0) {
    const bindings =
      catalog.wounds ?? fail('selected wounds require this attempt prepared bindings');
    for (const id of input.woundInstanceIds.value)
      if (bindings.filter((bound) => bound === id).length !== 1)
        fail('wound is not a unique prepared binding of this attempt');
  }
  const selected = input.effectInstanceIds;
  if (selected.kind === 'ENTERED' && selected.value.length !== 0) {
    const bindings =
      catalog.effects ?? fail('selected effects require this attempt prepared bindings');
    const diseases = new Set<string>();
    for (const effectInstanceId of selected.value) {
      const found = bindings.filter((b) => b.effectInstanceId === effectInstanceId);
      if (found.length !== 1 || found[0] === undefined)
        fail('effect is not a unique prepared binding of this attempt');
      const binding = found[0];
      const key =
        'diseaseId' in binding
          ? binding.diseaseId
          : binding.sourceKind === 'ALCOHOL'
            ? 'ALCOHOL'
            : binding.sourceKind === 'FORMAL_CONTROL'
              ? binding.controlKind
              : binding.mode;
      if (diseases.has(key)) fail('duplicate selected active disease or runtime mode');
      diseases.add(key);
    }
  }
  return input;
}
function initial(catalog: NpcEditorCatalog, value: unknown): NpcInitialStageRequest {
  const row = object(value, ['input', 'currentOeChanges']);
  return Object.freeze({
    input: initialFields(catalog, row['input']),
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
  readonly linkedSets?: readonly Readonly<{
    linkedSetInstanceId: string;
    itemTypeId: string;
    components: readonly Readonly<{
      itemInstanceId: string;
      componentRole: 'SWORD' | 'RAPIER' | 'SHIELD';
    }>[];
  }>[];
  readonly coatingBindings: readonly Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
  }>[];
  readonly qualityBindings: readonly Readonly<{ itemInstanceId: string; qualityRoll: number }>[];
  /** Actual reservation ancestry and immutable confirmed content; never a browser allowlist. */
  readonly customProfiles?: readonly Readonly<{
    itemInstanceId: string;
    reference: NpcCampaignCustomProfileReference | NpcCatalogueCustomModifierReference;
    confirmedContentOrNull: NpcCustomProfileContent | null;
  }>[];
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
  NpcCatalogueInventoryEditorInput extends NpcEnteredFields<infer T> ? T : never
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
const clothingReaders: Readers<NpcClothingProperties> = {
  coveredRegionIds: (v) =>
    unique(
      array(v, (region) => choice(region, ARMOR_BODY_ZONES)),
      (region) => region,
    ),
  hermetic: (v) => (v === 'UNKNOWN' ? 'UNKNOWN' : booleanInput(v)),
  flammability: (v) => choice(v, ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN']),
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
function customProfileEditor(
  value: unknown,
): Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }> {
  const profile = profileEditor(value);
  if (profile.kind !== 'STRUCTURED_CUSTOM')
    return fail('custom identity requires its structured profile editor');
  return profile;
}
function catalogueModifierEditor(value: unknown): NpcCatalogueCustomModifierEditor {
  const row = object(value, ['reference', 'profile', 'bonusContainerBinding', 'reason']);
  return Object.freeze({
    reference: entered(row['reference'], (v) =>
      readNpcCustomProfileReference(v, 'CATALOG_CUSTOM_MODIFIER'),
    ),
    profile: entered(row['profile'], customProfileEditor),
    bonusContainerBinding: entered(
      row['bonusContainerBinding'],
      readNpcCustomBonusContainerBinding,
    ),
    reason: entered(row['reason'], text),
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
  const linkedSets =
    context.linkedSets === undefined
      ? undefined
      : unique(
          array(context.linkedSets, (value) => {
            const row = object(value, ['linkedSetInstanceId', 'itemTypeId', 'components']);
            const linkedSetInstanceId = id(row['linkedSetInstanceId']),
              itemTypeId = choice(row['itemTypeId'], ['ITM-WPN-026', 'ITM-WPN-027']);
            if (!linkedSetInstanceIds.includes(linkedSetInstanceId))
              fail('unallocated set binding');
            const components = unique(
              array(row['components'], (value) => {
                const part = object(value, ['itemInstanceId', 'componentRole']);
                const itemInstanceId = id(part['itemInstanceId']);
                if (!itemInstanceIds.includes(itemInstanceId))
                  fail('set component is not allocated');
                return Object.freeze({
                  itemInstanceId,
                  componentRole: choice(part['componentRole'], ['SWORD', 'RAPIER', 'SHIELD']),
                });
              }),
              (part) => part.itemInstanceId,
            );
            if (
              components.length !== 2 ||
              components[0]?.componentRole !==
                (itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER') ||
              components[1]?.componentRole !== 'SHIELD'
            )
              fail('source pair roles differ');
            return Object.freeze({ linkedSetInstanceId, itemTypeId, components });
          }),
          (set) => set.linkedSetInstanceId,
        );
  const customProfiles =
    context.customProfiles === undefined
      ? undefined
      : unique(
          array(context.customProfiles, (value) => {
            const row = object(value, ['itemInstanceId', 'reference', 'confirmedContentOrNull']);
            const itemInstanceId = id(row['itemInstanceId']);
            if (!itemInstanceIds.includes(itemInstanceId))
              fail('custom profile targets an unallocated item');
            const kind = dataKind(row['reference']);
            if (kind !== 'CAMPAIGN_CUSTOM_PROFILE' && kind !== 'CATALOG_CUSTOM_MODIFIER')
              fail('unknown custom profile purpose');
            const reference =
              kind === 'CAMPAIGN_CUSTOM_PROFILE'
                ? readNpcCustomProfileReference(row['reference'], 'CAMPAIGN_CUSTOM_PROFILE')
                : readNpcCustomProfileReference(row['reference'], 'CATALOG_CUSTOM_MODIFIER');
            return Object.freeze({
              itemInstanceId,
              reference,
              confirmedContentOrNull:
                row['confirmedContentOrNull'] === null
                  ? null
                  : readNpcCustomProfileContent(row['confirmedContentOrNull']),
            });
          }),
          (row) => row.reference.profileVersionId,
        );
  return Object.freeze({
    catalog: context.catalog,
    itemInstanceIds,
    linkedSetInstanceIds,
    coatingBindings,
    qualityBindings,
    ...(linkedSets === undefined ? {} : { linkedSets }),
    ...(customProfiles === undefined ? {} : { customProfiles }),
  });
}
/** Restores partial input, not a mechanical item or a proof that a browser owns these IDs. */
export function readNpcInventoryEditorInput(
  catalog: NpcEditorCatalog,
  value: unknown,
): NpcEditorStages['NPC-015'] {
  return entered(value, (value) => {
    const rows = unique(
      array(value, (value): NpcInventoryEditorRow => {
        const custom =
          value !== null && typeof value === 'object' && Object.hasOwn(value, 'itemTypeReference');
        const modifier =
          !custom &&
          value !== null &&
          typeof value === 'object' &&
          Object.hasOwn(value, 'customModifier');
        const row = object(value, [
          'itemInstanceId',
          'input',
          'profile',
          ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'qualityTier')
            ? ['qualityTier']
            : []),
          ...(value !== null &&
          typeof value === 'object' &&
          Object.hasOwn(value, 'clothingProperties')
            ? ['clothingProperties']
            : []),
          ...(custom
            ? ['itemTypeReference', 'bonusContainerBinding', 'customProfileReason']
            : modifier
              ? ['customModifier']
              : []),
        ]);
        const metadata: NpcInventoryMetadataEditor = {
          ...(Object.hasOwn(row, 'qualityTier')
            ? { qualityTier: entered(row['qualityTier'], readNpcItemQualityTier) }
            : {}),
          ...(Object.hasOwn(row, 'clothingProperties')
            ? {
                clothingProperties: entered(row['clothingProperties'], (v) =>
                  fields(v, clothingReaders),
                ),
              }
            : {}),
        };
        if (custom && metadata.clothingProperties !== undefined)
          return fail('arbitrary item cannot use clothing properties');
        if (custom)
          return Object.freeze({
            ...metadata,
            itemInstanceId: id(row['itemInstanceId']),
            input: fields(row['input'], {
              ...inventoryInputReaders,
              itemTypeId: (v: unknown): null =>
                v === null ? null : fail('campaign item catalogue identity must be absent'),
            }),
            profile: entered(row['profile'], customProfileEditor),
            itemTypeReference: entered(row['itemTypeReference'], (v) =>
              readNpcCustomProfileReference(v, 'CAMPAIGN_CUSTOM_PROFILE'),
            ),
            bonusContainerBinding: entered(
              row['bonusContainerBinding'],
              readNpcCustomBonusContainerBinding,
            ),
            customProfileReason: entered(row['customProfileReason'], text),
          });
        return Object.freeze({
          ...metadata,
          itemInstanceId: id(row['itemInstanceId']),
          input: fields(row['input'], inventoryInputReaders),
          profile: entered(row['profile'], profileEditor),
          ...(modifier ? { customModifier: catalogueModifierEditor(row['customModifier']) } : {}),
        });
      }),
      (row) => row.itemInstanceId,
    );
    if (rows.length === 0) return rows;
    const context = inventoryContext(catalog);
    for (const row of rows) {
      const input = row.input;
      if (
        (Object.hasOwn(row, 'qualityTier') || Object.hasOwn(row, 'clothingProperties')) &&
        npcInventoryMetadataChoices(context.catalog) === null
      )
        fail('metadata source capability is unavailable');
      if (
        row.clothingProperties !== undefined &&
        (input.itemTypeId.kind !== 'ENTERED' || input.itemTypeId.value !== 'RES-EQP-001')
      )
        fail('clothing properties require explicit catalogue clothing type');
      if (!context.itemInstanceIds.includes(row.itemInstanceId))
        fail('foreign or unallocated item identity');
      const itemTypeId = input.itemTypeId,
        qualityRoll = input.qualityRoll;
      const customReference =
        'itemTypeReference' in row
          ? required(row.itemTypeReference, 'inventory.itemTypeReference')
          : row.customModifier === undefined
            ? null
            : required(row.customModifier.reference, 'inventory.customModifier.reference');
      const ownedCustom =
        customReference === null
          ? undefined
          : context.customProfiles?.find(
              (binding) =>
                binding.itemInstanceId === row.itemInstanceId &&
                binding.reference.profileVersionId === customReference.profileVersionId,
            );
      if (
        customReference !== null &&
        (ownedCustom === undefined ||
          JSON.stringify(ownedCustom.reference) !== JSON.stringify(customReference))
      )
        fail('custom profile reference differs from actual host reservation');
      const hasArbitraryIdentity =
        context.customProfiles?.some(
          (binding) =>
            binding.itemInstanceId === row.itemInstanceId &&
            binding.reference.kind === 'CAMPAIGN_CUSTOM_PROFILE',
        ) ?? false;
      if (hasArbitraryIdentity !== 'itemTypeReference' in row)
        fail('physical catalogue/custom identity is immutable');
      if (
        !('itemTypeReference' in row) &&
        row.customModifier === undefined &&
        context.customProfiles?.some(
          (binding) =>
            binding.itemInstanceId === row.itemInstanceId &&
            binding.reference.kind === 'CATALOG_CUSTOM_MODIFIER' &&
            binding.confirmedContentOrNull !== null,
        )
      )
        fail('confirmed custom modifier cannot be removed from the selected physical item');
      if (
        itemTypeId.kind === 'ENTERED' &&
        !('itemTypeReference' in row) &&
        !context.catalog.definitions.some((d) => d.itemTypeId === itemTypeId.value)
      )
        fail('unknown source item type');
      if (
        input.linkedSetInstanceId.kind === 'ENTERED' &&
        input.linkedSetInstanceId.value !== null &&
        !context.linkedSetInstanceIds.includes(input.linkedSetInstanceId.value)
      )
        fail('foreign or unallocated linked set identity');
      const allocatedSet = context.linkedSets?.find((set) =>
        set.components.some((part) => part.itemInstanceId === row.itemInstanceId),
      );
      if (allocatedSet !== undefined) {
        const part =
          allocatedSet.components.find((part) => part.itemInstanceId === row.itemInstanceId) ??
          fail('missing set component');
        if (
          input.linkedSetInstanceId.kind !== 'ENTERED' ||
          input.linkedSetInstanceId.value !== allocatedSet.linkedSetInstanceId ||
          input.itemTypeId.kind !== 'ENTERED' ||
          input.itemTypeId.value !== allocatedSet.itemTypeId ||
          input.componentRole.kind !== 'ENTERED' ||
          input.componentRole.value !== part.componentRole
        )
          fail('allocated pair identity/type/role is immutable');
      } else if (
        input.linkedSetInstanceId.kind === 'ENTERED' &&
        input.linkedSetInstanceId.value !== null
      )
        fail('linked set lacks exact component provenance');
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
  return projectInventoryRequest(catalog, value, readNpcInventoryRequest);
}
function projectInventoryRequest(
  catalog: NpcEditorCatalog,
  value: unknown,
  readRequests: (value: unknown) => readonly NpcInventoryRequestEntry[],
): readonly NpcInventoryRequestEntry[] {
  const stage = readNpcInventoryEditorInput(catalog, value),
    rows = required(stage, 'inventory');
  const result = readRequests(
    rows.map((row, index) => {
      const path = `inventory.${String(index)}`;
      const metadata = {
        ...(row.qualityTier === undefined
          ? {}
          : { qualityTier: required(row.qualityTier, `${path}.qualityTier`) }),
        ...(row.clothingProperties === undefined
          ? {}
          : {
              clothingProperties: completeFields(
                required(row.clothingProperties, `${path}.clothingProperties`),
                `${path}.clothingProperties`,
              ),
            }),
      };
      if ('itemTypeReference' in row)
        return {
          ...metadata,
          itemInstanceId: row.itemInstanceId,
          ...completeFields(row.input, `${path}.input`),
          profile: completeProfile(row.profile, `${path}.profile`),
          itemTypeReference: required(row.itemTypeReference, `${path}.itemTypeReference`),
          bonusContainerBinding: required(
            row.bonusContainerBinding,
            `${path}.bonusContainerBinding`,
          ),
          customProfileReason: required(row.customProfileReason, `${path}.customProfileReason`),
        };
      const common = {
        ...metadata,
        itemInstanceId: row.itemInstanceId,
        ...completeFields(row.input, `${path}.input`),
        profile: completeProfile(row.profile, `${path}.profile`),
      };
      const modifier = row.customModifier;
      return modifier === undefined
        ? common
        : {
            ...common,
            customModifier: {
              reference: required(modifier.reference, `${path}.customModifier.reference`),
              profile: completeProfile(modifier.profile, `${path}.customModifier.profile`),
              bonusContainerBinding: required(
                modifier.bonusContainerBinding,
                `${path}.customModifier.bonusContainerBinding`,
              ),
              reason: required(modifier.reason, `${path}.customModifier.reason`),
            },
          };
    }),
  );
  // A new reservation may be incomplete; a confirmed version may never be edited in place.
  // Container membership is current item state, deliberately outside immutable profile content.
  for (const item of result) {
    const custom =
      item.itemTypeId === null
        ? {
            reference: item.itemTypeReference,
            profile: item.profile,
            reason: item.customProfileReason,
          }
        : item.customModifier;
    if (custom === undefined) continue;
    const binding = inventoryContext(catalog).customProfiles?.find(
      (entry) =>
        entry.itemInstanceId === item.itemInstanceId &&
        entry.reference.profileVersionId === custom.reference.profileVersionId,
    );
    if (binding === undefined) return fail('custom profile lacks owning context');
    const confirmed = binding.confirmedContentOrNull;
    const content = readNpcCustomProfileContent({ profile: custom.profile, reason: custom.reason });
    if (confirmed !== null && JSON.stringify(content) !== JSON.stringify(confirmed))
      return fail('confirmed custom profile version is immutable; reserve a new version');
  }
  return result;
}
function restoredValue<T>(value: T): NpcDraftSection<T> {
  return Object.freeze({ kind: 'ENTERED', value });
}
function restoredFields<T extends object>(value: T): NpcEnteredFields<T> {
  const result = {} as { [K in keyof T]: NpcDraftSection<T[K]> };
  for (const key of Object.keys(value) as (keyof T & string)[])
    result[key] = restoredValue(value[key]);
  return Object.freeze(result);
}
function restoredDice(value: MasterWeaponProfileInput['damageDefinition']): NpcDiceEditor {
  return value.kind === 'RETAIN'
    ? { kind: 'RETAIN' }
    : {
        kind: 'MASTER_DICE',
        pattern: restoredValue(value.pattern),
        constantOrNull: restoredValue(value.constantOrNull),
      };
}
function restoredCustomProfile(
  value: CustomProfile,
): Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }> {
  const { kind, customBonusOrNull, ...input } = value;
  return {
    kind,
    input: restoredFields(input),
    customBonusOrNull: restoredValue(
      customBonusOrNull === null
        ? null
        : restoredFields({
            customBonusStat: customBonusOrNull.customBonusStat,
            customBonusValue: customBonusOrNull.customBonusValue,
          }),
    ),
  };
}
function restoredProfile(value: NpcItemProfileRequest): NpcItemProfileEditor {
  if (value.kind === 'CATALOG') return { kind: 'CATALOG' };
  if (value.kind === 'STRUCTURED_CUSTOM') return restoredCustomProfile(value);
  return {
    kind: 'MASTER_WEAPON',
    reason: restoredValue(value.reason),
    inputs: value.inputs.map((entry) => ({
      input: restoredFields({
        weaponVariantId: entry.weaponVariantId,
        instanceDamageOrNull: entry.instanceDamageOrNull,
        rangeMetersOrNull: entry.rangeMetersOrNull,
        accuracyBonusOrNull: entry.accuracyBonusOrNull,
      }),
      damageDefinition: restoredValue(restoredDice(entry.damageDefinition)),
      penetrationDefinition: restoredValue(restoredDice(entry.penetrationDefinition)),
      // Sparse source requirements map to explicit editor absence, never a new zero requirement.
      statRequirements: restoredFields({
        S: entry.statRequirements.S ?? null,
        D: entry.statRequirements.D ?? null,
        M: entry.statRequirements.M ?? null,
        Z: entry.statRequirements.Z ?? null,
        I: entry.statRequirements.I ?? null,
        W: entry.statRequirements.W ?? null,
        C: entry.statRequirements.C ?? null,
      }),
    })),
  };
}
function restoredInventoryRow(request: NpcInventoryRequestEntry): NpcInventoryEditorRow {
  const metadata: NpcInventoryMetadataEditor = {
    ...(request.qualityTier === undefined
      ? {}
      : { qualityTier: restoredValue(request.qualityTier) }),
    ...(request.clothingProperties === undefined
      ? {}
      : { clothingProperties: restoredValue(restoredFields(request.clothingProperties)) }),
  };
  const input = restoredFields({
    quantity: request.quantity,
    equipped: request.equipped,
    equippedSlots: request.equippedSlots,
    bodyZone: request.bodyZone,
    gripMode: request.gripMode,
    currentAmmo: request.currentAmmo,
    shieldCurrentHP: request.shieldCurrentHP,
    broken: request.broken,
    sealed: request.sealed,
    linkedSetInstanceId: request.linkedSetInstanceId,
    componentRole: request.componentRole,
    qualityRoll: request.qualityRoll,
    coatingInstanceIds: request.coatingInstanceIds,
    issueReason: request.issueReason,
  });
  if (request.itemTypeId === null)
    return {
      ...metadata,
      itemInstanceId: request.itemInstanceId,
      input: { ...input, itemTypeId: restoredValue(null) },
      itemTypeReference: restoredValue(request.itemTypeReference),
      profile: restoredValue(restoredCustomProfile(request.profile)),
      bonusContainerBinding: restoredValue(request.bonusContainerBinding),
      customProfileReason: restoredValue(request.customProfileReason),
    };
  const modifier = request.customModifier;
  return {
    ...metadata,
    itemInstanceId: request.itemInstanceId,
    input: { ...input, itemTypeId: restoredValue(request.itemTypeId) },
    profile: restoredValue(restoredProfile(request.profile)),
    ...(modifier === undefined
      ? {}
      : {
          customModifier: {
            reference: restoredValue(modifier.reference),
            profile: restoredValue(restoredCustomProfile(modifier.profile)),
            bonusContainerBinding: restoredValue(modifier.bonusContainerBinding),
            reason: restoredValue(modifier.reason),
          },
        }),
  };
}
/**
 * The owning accepted restore event supplies only its selected latest historical
 * request/group and bindings. This factory neither authorizes history nor mints
 * identities, profiles, state defaults, containers or compatibility receipts.
 */
export function restoreNpcInventoryEditorRows(
  catalog: NpcEditorCatalog,
  current: unknown,
  requests: readonly NpcInventoryRequestEntry[],
): NpcEditorStages['NPC-015'] {
  const stage = readNpcInventoryEditorInput(catalog, current);
  const rows = stage.kind === 'ENTERED' ? stage.value : [];
  const selected = new Set(rows.map((row) => row.itemInstanceId));
  const restored = readNpcInventoryRestorationRows(requests);
  const first = restored[0];
  if (first === undefined) return fail('restore requires one explicit historical choice');
  if (restored.some((item) => selected.has(item.itemInstanceId)))
    return fail('restore cannot replace a currently selected physical item');
  if (first.linkedSetInstanceId === null) {
    if (restored.length !== 1) return fail('restore cannot combine unrelated historical choices');
  } else {
    const set = inventoryContext(catalog).linkedSets?.find(
      (set) => set.linkedSetInstanceId === first.linkedSetInstanceId,
    );
    if (
      set === undefined ||
      restored.length !== set.components.length ||
      restored.some(
        (item) =>
          item.linkedSetInstanceId !== set.linkedSetInstanceId ||
          item.itemTypeId !== set.itemTypeId,
      ) ||
      set.components.some(
        (part) =>
          restored.filter(
            (item) =>
              item.itemInstanceId === part.itemInstanceId &&
              item.componentRole === part.componentRole,
          ).length !== 1,
      )
    )
      return fail('restore requires the whole actual source composite binding');
  }
  const added = restored.map(restoredInventoryRow);
  // Current rows may still be incomplete. Validate and round-trip just the new
  // group, retaining its exact equipment/container values for normal UI guards.
  const roundTrip = projectInventoryRequest(
    catalog,
    restoredValue(added),
    readNpcInventoryRestorationRows,
  );
  if (JSON.stringify(roundTrip) !== JSON.stringify(restored))
    return fail('restored inventory request changed during editor conversion');
  return readNpcInventoryEditorInput(catalog, restoredValue([...rows, ...added]));
}
/** Only an accepted owning PREPARE/REMOVE event supplies this exact selection change. */
export function replaceNpcInventoryCoatingSelection(
  catalog: NpcEditorCatalog,
  current: unknown,
  itemInstanceId: string,
  expectedCoatingInstanceIds: readonly string[],
  coatingInstanceIds: readonly string[],
): NpcEditorStages['NPC-015'] {
  const stage = readNpcInventoryEditorInput(catalog, current);
  const target = id(itemInstanceId),
    expected = ids(expectedCoatingInstanceIds),
    next = ids(coatingInstanceIds);
  if (next.length > 1 || stage.kind !== 'ENTERED')
    return fail('one actual coating selection requires an existing physical inventory row');
  const found = stage.value.find((row) => row.itemInstanceId === target);
  if (
    found === undefined ||
    found.input.coatingInstanceIds.kind !== 'ENTERED' ||
    JSON.stringify(found.input.coatingInstanceIds.value) !== JSON.stringify(expected)
  )
    return fail('coating operation selection is stale');
  return readNpcInventoryEditorInput(
    catalog,
    restoredValue(
      stage.value.map((row) =>
        row === found
          ? { ...row, input: { ...row.input, coatingInstanceIds: restoredValue(next) } }
          : row,
      ),
    ),
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
): NpcCatalogueInventoryEditorRow {
  const set = catalog.inventory?.linkedSets?.find((set) =>
    set.components.some((part) => part.itemInstanceId === hostItemInstanceId),
  );
  const part = set?.components.find((part) => part.itemInstanceId === hostItemInstanceId);
  const row = {
    itemInstanceId: hostItemInstanceId,
    input: {
      ...emptyFields(inventoryInputReaders),
      ...(set === undefined || part === undefined
        ? {}
        : {
            itemTypeId: { kind: 'ENTERED' as const, value: set.itemTypeId },
            linkedSetInstanceId: { kind: 'ENTERED' as const, value: set.linkedSetInstanceId },
            componentRole: { kind: 'ENTERED' as const, value: part.componentRole },
          }),
    },
    profile: { kind: 'UNSET' } as const,
  };
  const stage = readNpcInventoryEditorInput(catalog, { kind: 'ENTERED', value: [row] });
  if (
    stage.kind !== 'ENTERED' ||
    stage.value[0] === undefined ||
    'itemTypeReference' in stage.value[0]
  )
    return fail('missing empty row after read');
  return stage.value[0];
}
function emptyCustomProfileEditor(): Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }> {
  return Object.freeze({
    kind: 'STRUCTURED_CUSTOM',
    input: emptyFields(customInputReaders),
    customBonusOrNull: Object.freeze({ kind: 'UNSET' }),
  });
}
/** Only actual host reservation references are entered; no physical properties or bonus default is selected. */
export function createEmptyNpcCampaignCustomInventoryEditorRow(
  catalog: NpcEditorCatalog,
  hostItemInstanceId: string,
  hostReference: NpcCampaignCustomProfileReference,
): NpcCampaignCustomInventoryEditorRow {
  const row = {
    itemInstanceId: hostItemInstanceId,
    input: {
      ...emptyFields(inventoryInputReaders),
      itemTypeId: { kind: 'ENTERED', value: null } as const,
    },
    itemTypeReference: { kind: 'ENTERED', value: hostReference } as const,
    profile: { kind: 'ENTERED', value: emptyCustomProfileEditor() } as const,
    bonusContainerBinding: { kind: 'UNSET' } as const,
    customProfileReason: { kind: 'UNSET' } as const,
  };
  const stage = readNpcInventoryEditorInput(catalog, { kind: 'ENTERED', value: [row] });
  const saved = stage.kind === 'ENTERED' ? stage.value[0] : undefined;
  if (saved === undefined || !('itemTypeReference' in saved))
    return fail('missing host-reserved custom row');
  return saved;
}
/** Attaches a distinct modifier without changing any catalogue profile or physical field. */
export function addEmptyNpcCatalogueCustomModifier(
  catalog: NpcEditorCatalog,
  value: NpcCatalogueInventoryEditorRow,
  hostReference: NpcCatalogueCustomModifierReference,
): NpcCatalogueInventoryEditorRow {
  if (value.customModifier !== undefined)
    return fail('catalogue item already has a custom modifier identity');
  const row = {
    ...value,
    customModifier: {
      reference: { kind: 'ENTERED', value: hostReference } as const,
      profile: { kind: 'ENTERED', value: emptyCustomProfileEditor() } as const,
      bonusContainerBinding: { kind: 'UNSET' } as const,
      reason: { kind: 'UNSET' } as const,
    },
  };
  const stage = readNpcInventoryEditorInput(catalog, { kind: 'ENTERED', value: [row] });
  const saved = stage.kind === 'ENTERED' ? stage.value[0] : undefined;
  if (saved === undefined || 'itemTypeReference' in saved)
    return fail('missing catalogue custom modifier row');
  return saved;
}
/** Version reservation changes only the checked reference; the GM edits the copied content afterwards. */
export function replaceNpcInventoryCustomProfileVersion(
  catalog: NpcEditorCatalog,
  row: NpcInventoryEditorRow,
  hostReference: NpcCampaignCustomProfileReference | NpcCatalogueCustomModifierReference,
): NpcInventoryEditorRow {
  const current =
    'itemTypeReference' in row
      ? required(row.itemTypeReference, 'inventory.itemTypeReference')
      : row.customModifier === undefined
        ? fail('item has no custom profile')
        : required(row.customModifier.reference, 'inventory.customModifier.reference');
  if (
    current.kind !== hostReference.kind ||
    current.profileId !== hostReference.profileId ||
    current.profileVersionId === hostReference.profileVersionId ||
    hostReference.version !== current.version + 1
  )
    return fail('new reservation must be the next version of the same physical custom profile');
  const updated =
    'itemTypeReference' in row && hostReference.kind === 'CAMPAIGN_CUSTOM_PROFILE'
      ? { ...row, itemTypeReference: { kind: 'ENTERED', value: hostReference } }
      : !('itemTypeReference' in row) &&
          row.customModifier !== undefined &&
          hostReference.kind === 'CATALOG_CUSTOM_MODIFIER'
        ? {
            ...row,
            customModifier: {
              ...row.customModifier,
              reference: { kind: 'ENTERED', value: hostReference },
            },
          }
        : fail('profile purpose changed');
  const stage = readNpcInventoryEditorInput(catalog, { kind: 'ENTERED', value: [updated] });
  return stage.kind === 'ENTERED' && stage.value[0] !== undefined
    ? stage.value[0]
    : fail('missing reserved profile version row');
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
      result = initial(catalog, value);
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
    initialState: initialFields(catalog, row['initialState']),
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
    case 'NPC-015': {
      const inventory = readNpcStageInput(catalog, form, value);
      const before = draft.inventory.kind === 'ENTERED' ? draft.inventory.value : [];
      for (const row of inventory.kind === 'ENTERED' ? inventory.value : []) {
        const prior = before.find((item) => item.itemInstanceId === row.itemInstanceId);
        const oldCoatings = prior?.input.coatingInstanceIds;
        const nextCoatings = row.input.coatingInstanceIds;
        // Completing a previously empty editor field remains possible. Once an
        // actual dose exists, only its owning operation can change the selection.
        if (
          ((oldCoatings?.kind === 'ENTERED' && oldCoatings.value.length !== 0) ||
            (nextCoatings.kind === 'ENTERED' && nextCoatings.value.length !== 0)) &&
          JSON.stringify(oldCoatings) !== JSON.stringify(nextCoatings)
        )
          return fail('coating selection is read-only; use the actual prepare or remove operation');
      }
      return Object.freeze({ ...draft, inventory });
    }
    case 'NPC-016': {
      const request = readNpcStageInput(catalog, form, value);
      const beforeLife = draft.initialState.lifeStateConfirmationId,
        afterLife = request.input.lifeStateConfirmationId;
      if (
        beforeLife?.kind !== afterLife?.kind ||
        (beforeLife?.kind === 'ENTERED' &&
          (afterLife?.kind !== 'ENTERED' || beforeLife.value !== afterLife.value))
      )
        fail('life confirmation is read-only; use the actual life preparation');
      if (
        JSON.stringify(draft.initialState.weaverEffectInstanceIds) !==
        JSON.stringify(request.input.weaverEffectInstanceIds)
      )
        fail('Weaver state selection is read-only; use the actual prepare or remove operation');
      if (
        JSON.stringify(draft.initialState.poisonModeFactIds) !==
        JSON.stringify(request.input.poisonModeFactIds)
      )
        fail('poison mode selection is read-only; use the actual mode preparation');
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
