import { createHash } from 'node:crypto';
import {
  readNpcInventoryRequest,
  npcInventoryMetadata,
  validateNpcInventoryMetadata,
  type NpcInventoryMetadata,
  readNpcInventoryRestorationRows,
  resolveNpcWeaponProfiles,
  validateNpcCatalogueItemState,
  resolveNpcArmorProfile,
  resolveNpcCatalogueItemProfile,
  resolveNpcNonattackingShieldProfile,
  type NpcInventoryCatalog,
  type NpcInventoryRequestEntry,
  type NpcArmorProfile,
  type NpcCatalogueItemProfile,
  type NpcNonattackingShieldProfile,
  type NpcCatalogueInventoryRequestEntry,
  type NpcCampaignCustomInventoryRequestEntry,
  type NpcStructuredCustomProfile,
  type NpcCatalogueCustomModifierRequest,
  type NpcCampaignCustomProfileReference,
  type NpcCustomProfileVersionReference,
  type NpcCustomBonusContainerBinding,
  deriveNpcArmorContribution,
  type NpcArmorContribution,
} from './inventory.js';
import { ARMOR_BODY_ZONES } from '../item-stage/armor-bundle.js';
import type { StagedWeaponProfile } from '../item-stage/master-weapon-profile.js';
import { stageValidatedWeaponProfile } from '../item-stage/master-weapon-profile.js';
import type { WeaponCombatDefinition } from '../item-stage/weapon-profile.js';
import type { StartingWeaponVariant } from '../item-stage/starting-weapon.js';
import type { NpcInventoryItemInput } from './types.js';
import type { StatBlock } from '../skill-stage/stats.js';
import {
  readNpcInventoryCoatingSelection,
  type NpcInventoryCoatingContext,
  type NpcInventoryCoatingOriginReference,
  type NpcFormalPoisonCoatingInstance,
  type NpcPoisonCoatingRemoval,
  type NpcArchivedCoatingPreparationReference,
  type NpcPoisonPreparationSelection,
} from './formal-poison-coating.js';
export type { NpcInventoryCoatingContext } from './formal-poison-coating.js';

/** The host proves these original operation references; a pure reader proves no authority. */
export interface NpcInventoryPublicationProof {
  readonly npcUuid: string;
  readonly commitOperationId: string;
  readonly sourceOperationId: string;
  readonly actorId: string;
  readonly committedAt: string;
  readonly previous?: NpcInventoryVersionReference;
  readonly coatingOrigins?: readonly NpcInventoryCoatingOriginReference[];
  /** References to real preparations on omitted carriers, without a published-dose claim. */
  readonly archivedCoatingPreparations?: readonly NpcArchivedCoatingPreparationReference[];
  readonly entries: readonly Readonly<{
    request: NpcInventoryRequestEntry;
    weaponProfileVersionId: string | null;
  }>[];
}
/** Existing NPC version identity, not a newly invented inventory-version UUID. */
export interface NpcInventoryVersionReference {
  readonly npcUuid: string;
  readonly version: number;
  readonly sha256: string;
  readonly commitOperationId: string;
}
export interface NpcInventoryHistoryEntry extends NpcInventoryVersionReference {
  readonly publication: NpcInventoryPublication | null;
}
/** Actual owner-resolved prefix; never serialized inside the candidate publication. */
export interface NpcInventoryPublicationContext {
  readonly history: readonly NpcInventoryHistoryEntry[];
}
export interface NpcInventoryRestoreScope {
  readonly npcUuid: string;
  /** Current owner-parsed draft selection, including newly reserved items. */
  readonly selectedItemInstanceIds: readonly string[];
}
export interface NpcInventoryRestoreChoice {
  /** One offered choice restores the entire source pair, never a second partial copy. */
  readonly itemInstanceId: string;
  readonly itemInstanceIds: readonly string[];
  readonly linkedSetInstanceIdOrNull: string | null;
  /** Absent for published history; no implied saved item/profile for pending rows. */
  readonly originKind?: 'PENDING_PREPARATION';
}
export interface NpcPublishedWeaponProfile extends Omit<
  StagedWeaponProfile,
  'damageDefinition' | 'penetrationDefinition'
> {
  readonly damageDefinition: WeaponCombatDefinition;
  readonly penetrationDefinition: WeaponCombatDefinition;
}
export interface NpcWeaponInstancePatch {
  readonly damageDefinition?: WeaponCombatDefinition;
  readonly penetrationDefinition?: WeaponCombatDefinition;
  readonly statRequirements: StagedWeaponProfile['statRequirements'];
  readonly instanceDamage?: number;
  readonly rangeMeters?: number;
  readonly accuracyBonus: number | null;
}
export interface NpcWeaponProfileVersion {
  readonly weaponProfileVersionId: string;
  readonly previousVersionId: string | null;
  readonly itemInstanceId: string;
  readonly ownerId: string;
  readonly ownerType: 'CHARACTER';
  readonly attackVariantId: StartingWeaponVariant;
  readonly statSource: 'TEMPLATE_FIXED' | 'MASTER_OVERRIDE';
  readonly templateProfileVersion: string;
  readonly validationStatus: 'NOT_APPLICABLE' | 'OVERRIDDEN';
  readonly instanceProfilePatch: NpcWeaponInstancePatch | null;
  readonly effectiveProfile: NpcPublishedWeaponProfile;
  readonly damageDefinition: WeaponCombatDefinition;
  readonly penetrationDefinition: WeaponCombatDefinition;
  readonly statRequirements: StagedWeaponProfile['statRequirements'];
  readonly instanceDamageOrNull: number | null;
  readonly rangeMetersOrNull: number | null;
  readonly accuracyBonusOrNull: number | null;
  readonly actorId: string;
  readonly actorRole: 'MASTER';
  readonly reason: string;
  readonly createdAt: string;
  readonly beforeProfile: NpcPublishedWeaponProfile | null;
  readonly afterProfile: NpcPublishedWeaponProfile;
  readonly effectiveFrom: 'NEXT_RESOLVED_ATTACK';
  readonly active: true;
  readonly immutableAudit: true;
}
export interface NpcPublishedWeaponItem {
  readonly kind: 'WEAPON';
  readonly customModifier?: NpcCatalogueCustomModifierRequest;
  readonly customProfileVersions?: readonly NpcCustomProfileVersion[];
  readonly item: Readonly<
    NpcInventoryMetadata & {
      itemInstanceId: string;
      itemTypeId: string;
      ownerType: 'CHARACTER';
      ownerId: string;
      quantity: number;
      stackKey: string;
      activeWeaponProfileVersionIdByVariant: Readonly<
        Partial<Record<StartingWeaponVariant, string>>
      >;
      equipped: boolean;
      equippedSlots: readonly string[];
      bodyZone: null;
      gripMode: 'ONE_HAND' | 'TWO_HAND' | null;
      currentAmmo: number | null;
      shieldCurrentHP: number | null;
      broken: boolean;
      sealed: null;
      linkedSetInstanceId: string | null;
      componentRole: NpcInventoryRequestEntry['componentRole'];
      qualityRoll: number | null;
      activeCoatings: readonly NpcFormalPoisonCoatingInstance[];
      provenance: Readonly<{
        source: 'NPC_INITIAL_COMMIT';
        sourceOperationId: string;
        previousOwner: null;
        operationId: string;
      }>;
      issuedBy: string;
      issueReason: string;
      createdAt: string;
      updatedAt: string;
      cloneWriteBack: 'NONE';
    }
  >;
  readonly profileVersions: readonly NpcWeaponProfileVersion[];
}
export interface NpcInventoryPublication {
  readonly format: 'NPC_INVENTORY_PUBLICATION_V1' | 'NPC_INVENTORY_PUBLICATION_V2';
  readonly proof: NpcInventoryPublicationProof;
  readonly items: readonly NpcPublishedInventoryItem[];
  readonly input: readonly NpcInventoryItemInput[];
}
/** Armor uses its checked source profile, never a fictitious attack-profile version. */
export interface NpcPublishedArmorItem {
  readonly kind: 'ARMOR';
  readonly customModifier?: NpcCatalogueCustomModifierRequest;
  readonly customProfileVersions?: readonly NpcCustomProfileVersion[];
  readonly item: Readonly<
    Omit<
      NpcPublishedWeaponItem['item'],
      'equipped' | 'equippedSlots' | 'bodyZone' | 'sealed' | 'activeWeaponProfileVersionIdByVariant'
    > & {
      equipped: boolean;
      equippedSlots: readonly string[];
      bodyZone: NpcInventoryRequestEntry['bodyZone'];
      sealed: boolean | null;
      activeWeaponProfileVersionIdByVariant: Readonly<Record<string, never>>;
    }
  >;
  readonly sourceProfile: NpcArmorProfile;
  readonly profileVersions: readonly NpcWeaponProfileVersion[];
}
export interface NpcPublishedCatalogueItem {
  readonly kind: 'CATALOG_ITEM';
  readonly customModifier?: NpcCatalogueCustomModifierRequest;
  readonly customProfileVersions?: readonly NpcCustomProfileVersion[];
  readonly item: NpcPublishedWeaponItem['item'];
  readonly sourceProfile: NpcCatalogueItemProfile;
  readonly profileVersions: readonly [];
}
export interface NpcPublishedShieldComponent {
  readonly kind: 'SHIELD_COMPONENT';
  readonly customModifier?: NpcCatalogueCustomModifierRequest;
  readonly customProfileVersions?: readonly NpcCustomProfileVersion[];
  readonly item: NpcPublishedWeaponItem['item'];
  readonly sourceProfile: NpcNonattackingShieldProfile;
  readonly profileVersions: readonly [];
}
export interface NpcCustomProfileVersion extends NpcCustomProfileVersionReference {
  readonly itemInstanceId: string;
  readonly ownerId: string;
  readonly previousVersionId: string | null;
  readonly actorId: string;
  readonly createdAt: string;
  readonly reason: string;
  readonly beforeProfile: NpcStructuredCustomProfile | null;
  readonly afterProfile: NpcStructuredCustomProfile;
  readonly immutableAudit: true;
}
export interface NpcPublishedCampaignCustomItem {
  readonly kind: 'CAMPAIGN_CUSTOM_ITEM';
  readonly item: Omit<NpcPublishedWeaponItem['item'], 'itemTypeId'> &
    Readonly<{
      itemTypeId: null;
      itemTypeReference: NpcCampaignCustomProfileReference;
      bonusContainerBinding: NpcCustomBonusContainerBinding;
    }>;
  readonly customProfileVersions: readonly NpcCustomProfileVersion[];
  readonly profileVersions: readonly [];
}
export type NpcPublishedInventoryItem =
  | NpcPublishedWeaponItem
  | NpcPublishedArmorItem
  | NpcPublishedCatalogueItem
  | NpcPublishedShieldComponent
  | NpcPublishedCampaignCustomItem;
/** Only common current-state fields may change; each physical discriminator stays correlated. */
function withCurrentItemFields(
  item: NpcPublishedInventoryItem,
  fields: NpcInventoryMetadata &
    Readonly<{ stackKey: string; activeCoatings?: readonly NpcFormalPoisonCoatingInstance[] }>,
): NpcPublishedInventoryItem {
  switch (item.kind) {
    case 'ARMOR':
      return { ...item, item: { ...item.item, ...fields } };
    case 'CAMPAIGN_CUSTOM_ITEM':
      return { ...item, item: { ...item.item, ...fields } };
    case 'CATALOG_ITEM':
      return { ...item, item: { ...item.item, ...fields } };
    case 'SHIELD_COMPONENT':
      return { ...item, item: { ...item.item, ...fields } };
    case 'WEAPON':
      return { ...item, item: { ...item.item, ...fields } };
  }
}
export interface NpcInventoryPublicationCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_INVENTORY_PUBLICATION';
}
export class NpcInventoryPublicationError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_YET_SUPPORTED',
    detail: string,
  ) {
    super(`NPC inventory publication ${code}: ${detail}`);
    this.name = new.target.name;
  }
}
const catalogs = new WeakMap<NpcInventoryPublicationCatalog, NpcInventoryCatalog>();
const campaignCustomCatalogs = new WeakSet<NpcInventoryPublicationCatalog>();
const poisonCatalogs = new WeakSet<NpcInventoryPublicationCatalog>();
const publications = new WeakMap<NpcInventoryPublication, NpcInventoryPublicationCatalog>();
const publicationRemovals = new WeakMap<
  NpcInventoryPublication,
  readonly NpcPoisonCoatingRemoval[]
>();
const publicationPreparations = new WeakMap<
  NpcInventoryPublication,
  readonly NpcPoisonPreparationSelection[]
>();
const publicationPendingRestoreRequests = new WeakMap<
  NpcInventoryPublication,
  readonly NpcInventoryRequestEntry[]
>();
/** Owner-resolved facts attached to the issued result, never candidate-supplied history. */
export function readNpcInventoryPublicationRemovals(
  catalog: NpcInventoryPublicationCatalog,
  publication: NpcInventoryPublication,
): readonly NpcPoisonCoatingRemoval[] {
  if (!catalogs.has(catalog) || publications.get(publication) !== catalog)
    return fail('coating removals require an issued publication from the same catalog');
  return publicationRemovals.get(publication) ?? Object.freeze([]);
}
export function readNpcInventoryPublicationPreparationSelections(
  catalog: NpcInventoryPublicationCatalog,
  publication: NpcInventoryPublication,
): readonly NpcPoisonPreparationSelection[] | null {
  if (!catalogs.has(catalog) || publications.get(publication) !== catalog)
    return fail('preparation selections require an issued publication from the same catalog');
  return publicationPreparations.get(publication) ?? null;
}
/** Original PREPARE carrier rows are draft evidence, never published item/profile versions. */
export function readNpcInventoryPublicationPendingRestoreRequests(
  catalog: NpcInventoryPublicationCatalog,
  publication: NpcInventoryPublication,
): readonly NpcInventoryRequestEntry[] {
  if (!catalogs.has(catalog) || publications.get(publication) !== catalog)
    return fail('pending restoration requires an issued publication from the same catalog');
  return publicationPendingRestoreRequests.get(publication) ?? Object.freeze([]);
}
const previews = new WeakMap<
  NpcInventoryPreview,
  Readonly<{
    catalog: NpcInventoryPublicationCatalog;
    context: NpcInventoryPublicationContext | null;
    coatingContext: NpcInventoryCoatingContext | null;
  }>
>();
/** Capability is issued by the exact source constructor; a caller-created shape is never sufficient. */
export function isNpcCampaignCustomPublicationAvailable(
  catalog: NpcInventoryPublicationCatalog,
): boolean {
  if (!catalogs.has(catalog)) return fail('unrecognized publication catalog');
  return campaignCustomCatalogs.has(catalog);
}
/** A source reader, not an alternate way to mint a publication capability. */
export function npcInventoryPublicationSource(
  catalog: NpcInventoryPublicationCatalog,
): NpcInventoryCatalog {
  return catalogs.get(catalog) ?? fail('unrecognized publication catalog');
}
export function isNpcPoisonPublicationAvailable(catalog: NpcInventoryPublicationCatalog): boolean {
  npcInventoryPublicationSource(catalog);
  return poisonCatalogs.has(catalog);
}
/** Only the delivered explicit backpack type is eligible; owner/physical bindings stay in the attempt. */
export function npcCustomBackpackTypeIds(
  catalog: NpcInventoryPublicationCatalog,
): readonly string[] {
  return isNpcCampaignCustomPublicationAvailable(catalog)
    ? Object.freeze(['RES-CON-001'])
    : Object.freeze([]);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function fail(detail: string): never {
  throw new NpcInventoryPublicationError('INVALID', detail);
}
function unsupported(detail: string): never {
  throw new NpcInventoryPublicationError('NOT_YET_SUPPORTED', detail);
}

/** Closed data inspection is shared with the full-sheet adapter; errors never echo supplied data. */
export const npcPublicationData = Object.freeze({
  record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
    if (
      value === null ||
      typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return fail('expected plain record');
    const own = Reflect.ownKeys(value);
    if (
      own.some((k) => typeof k !== 'string') ||
      (keys !== undefined &&
        (own.length !== keys.length || own.some((k) => !keys.includes(String(k)))))
    )
      return fail('unexpected record fields');
    const result: Record<string, unknown> = {};
    for (const key of own) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value') || d.value === undefined)
        return fail('expected explicit own data field');
      Object.defineProperty(result, key, {
        value: d.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  },
  array(value: unknown): readonly unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return fail('expected plain array');
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      Reflect.ownKeys(value).length !== length + 1
    )
      return fail('sparse or extended array');
    return Array.from({ length }, (_, index) => {
      const d = Object.getOwnPropertyDescriptor(value, String(index));
      return d === undefined || !d.enumerable || !Object.hasOwn(d, 'value') || d.value === undefined
        ? fail('expected explicit array data')
        : (d.value as unknown);
    });
  },
  text(value: unknown): string {
    return typeof value === 'string' && value.length > 0 && value.trim() === value
      ? value
      : fail('expected exact text');
  },
  uuid(value: unknown): string {
    return typeof value === 'string' && UUID.test(value)
      ? value
      : fail('expected canonical UUID v4');
  },
  equal(expected: unknown, actual: unknown): void {
    if (Array.isArray(expected)) {
      const entries = npcPublicationData.array(actual);
      if (entries.length !== expected.length) return fail('array differs');
      expected.forEach((entry, index) => npcPublicationData.equal(entry, entries[index]));
    } else if (expected !== null && typeof expected === 'object') {
      const row = npcPublicationData.record(actual, Object.keys(expected));
      for (const [key, value] of Object.entries(expected))
        npcPublicationData.equal(value, row[key]);
    } else if (!Object.is(expected, actual)) fail('derived value differs');
  },
  freeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) npcPublicationData.freeze(child);
      Object.freeze(value);
    }
    return value;
  },
});

// Source seals below are exact delivered Item Registry fields used by the published graph.
const FIELD_SEALS = {
  instanceModel: [
    {
      'Data type': 'UUID',
      Default: '—',
      Field: 'itemInstanceId',
      Purpose: 'Идентичность физического экземпляра',
      Required: true,
      Scope: 'ITEM_INSTANCE',
      'Validation / constraint': 'Уникален; неизменяем',
    },
    {
      'Data type': 'ID',
      Default: '—',
      Field: 'itemTypeId',
      Purpose: 'Канонический механический тип',
      Required: true,
      Scope: 'ITEM_INSTANCE',
      'Validation / constraint':
        'FK → 01_Каталог.ItemTypeID; после создания экземпляра не изменяется',
    },
    {
      'Data type': 'MAP<ATTACK_VARIANT,UUID>',
      Default: '{}',
      Field: 'activeWeaponProfileVersionIdByVariant',
      Purpose: 'Активные версии эффективного профиля',
      Required: 'CONDITIONAL',
      Scope: 'ITEM_INSTANCE',
      'Validation / constraint':
        'Обязательно для оружия; DEFAULT для обычного, ONE_HAND/TWO_HAND для полуторного, SWORD/SHIELD/RAPIER для составного; FK → 07B',
    },
    {
      'Data type': 'ENUM',
      Field: 'gripMode',
      Purpose: 'Фиксированный хват и формульный вариант',
      Required: 'CONDITIONAL',
      Scope: 'ITEM_INSTANCE',
      'Validation / constraint':
        'ONE_HAND | TWO_HAND; обязателен для полуторного меча; после выдачи не меняется CORE-188',
    },
    {
      'Data type': 'ENUM',
      Default: 'CHARACTER',
      Field: 'ownerType',
      Purpose: 'Ровно один владелец или сцена',
      Required: true,
      Scope: 'OWNERSHIP',
      'Validation / constraint':
        'CHARACTER | CORPSE | BATTLE_SCENE; доступ к CORPSE разрешается только при внешнем lootPolicy=LOOTABLE.',
    },
    {
      'Data type': 'ID',
      Default: '—',
      Field: 'ownerId',
      Purpose: 'Текущий владелец',
      Required: true,
      Scope: 'OWNERSHIP',
      'Validation / constraint': 'Согласован с ownerType; CHARACTER включает игрока и НПС',
    },
    {
      'Data type': 'INTEGER',
      Default: 1,
      Field: 'quantity',
      Purpose: 'Количество',
      Required: true,
      Scope: 'STACK',
      'Validation / constraint': '≥1; изменение атомарно',
    },
    {
      'Data type': 'STRING',
      Default: '—',
      Field: 'stackKey',
      Purpose: 'Группировка идентичных экземпляров',
      Required: true,
      Scope: 'STACK',
      'Validation / constraint':
        'Учитывает itemType, активный effective profile, качество, покрытия, HP и sealed state',
    },
    {
      'Data type': 'INTEGER',
      Field: 'qualityRoll',
      Purpose: 'Стартовая оценка',
      Required: false,
      Scope: 'ITEM_INSTANCE',
      'Validation / constraint': '1..20; рекомендация, не меняет механику автоматически',
    },
    {
      'Data type': 'BOOLEAN',
      Default: false,
      Field: 'equipped',
      Purpose: 'Состояние экипировки',
      Required: true,
      Scope: 'EQUIPMENT',
      'Validation / constraint': 'Выданный предмет не экипируется автоматически',
    },
    {
      'Data type': 'ARRAY<ENUM>',
      Default: '[]',
      Field: 'equippedSlots',
      Purpose: 'Занятые слоты',
      Required: false,
      Scope: 'EQUIPMENT',
      'Validation / constraint': 'Руки или зоны тела',
    },
    {
      'Data type': 'ENUM',
      Field: 'bodyZone',
      Purpose: 'Зона брони',
      Required: false,
      Scope: 'EQUIPMENT',
      'Validation / constraint': 'HEAD|TORSO|ARM_L|ARM_R|LEG_L|LEG_R',
    },
    {
      'Data type': 'INTEGER',
      Field: 'currentAmmo',
      Purpose: 'Заряженный боезапас',
      Required: false,
      Scope: 'WEAPON_STATE',
      'Validation / constraint': '0..magazineCapacity; ёмкость не меняется CORE-188',
    },
    {
      'Data type': 'INTEGER',
      Field: 'shieldCurrentHP',
      Purpose: 'Текущее HP щита',
      Required: false,
      Scope: 'WEAPON_STATE',
      'Validation / constraint': '0..shieldMaxHP; max HP не меняется CORE-188',
    },
    {
      'Data type': 'BOOLEAN',
      Default: false,
      Field: 'broken',
      Purpose: 'Неисправность',
      Required: true,
      Scope: 'ITEM_STATE',
      'Validation / constraint': 'При 0 HP щит не даёт бонусов; ремонт MANUAL_ONLY',
    },
    {
      'Data type': 'BOOLEAN',
      Field: 'sealed',
      Purpose: 'Герметичность',
      Required: false,
      Scope: 'ITEM_STATE',
      'Validation / constraint': 'Только Нэйт; true при выдаче',
    },
    {
      'Data type': 'ID',
      Field: 'linkedSetInstanceId',
      Purpose: 'Связанный комплект',
      Required: false,
      Scope: 'COMPOSITE',
      'Validation / constraint': 'Обязателен для компонентов Корнадоры/Бларадэ',
    },
    {
      'Data type': 'ENUM',
      Field: 'componentRole',
      Purpose: 'Роль компонента',
      Required: false,
      Scope: 'COMPOSITE',
      'Validation / constraint': 'SWORD | RAPIER | SHIELD',
    },
    {
      'Data type': 'ARRAY<OBJECT>',
      Default: '[]',
      Field: 'activeCoatings',
      Purpose:
        'Яд/горючая слюна; любой ALL_POISON иммунитет блокирует обычный и симбиотический poison payload.',
      Required: false,
      Scope: 'ITEM_STATE',
      'Validation / constraint':
        'Каждый объект: effectFamily, poisonSourceKind, sourceAbilityId/sourceItemId, payload, appliedAt, expiry/consumeCondition. Для яда effectFamily=POISON обязателен.',
    },
    {
      'Data type': 'JSON',
      Default: '—',
      Field: 'provenance',
      Purpose: 'Происхождение, deep-clone и доказательство отсутствия write-back.',
      Required: true,
      Scope: 'AUDIT',
      'Validation / constraint':
        'source, previousOwner, operationId; при клонировании: templateOrigin, templateId, templateVersionId|catalogVersion, sourceItemKey, cloneGraphId.',
    },
    {
      'Data type': 'ID',
      Default: '—',
      Field: 'issuedBy',
      Purpose: 'Кто выдал',
      Required: true,
      Scope: 'AUDIT',
      'Validation / constraint': 'Мастер либо процесс согласования',
    },
    {
      'Data type': 'STRING',
      Default: '—',
      Field: 'issueReason',
      Purpose: 'Причина выдачи',
      Required: true,
      Scope: 'AUDIT',
      'Validation / constraint': 'Не пусто для мастерской операции',
    },
    {
      'Data type': 'DATETIME',
      Default: '—',
      Field: 'createdAt',
      Purpose: 'Время создания экземпляра',
      Required: true,
      Scope: 'AUDIT',
      'Validation / constraint': 'Неизменяемо после создания',
    },
    {
      'Data type': 'DATETIME',
      Default: '—',
      Field: 'updatedAt',
      Purpose: 'Последнее изменение состояния',
      Required: true,
      Scope: 'AUDIT',
      'Validation / constraint': 'Меняется при операции с состоянием; не подменяет аудит профиля',
    },
    {
      'Data type': 'ENUM',
      Default: 'NONE',
      Field: 'cloneWriteBack',
      Purpose: 'Запрет изменения шаблона из экземпляра',
      Required: true,
      Scope: 'AUDIT',
      'Validation / constraint': 'Единственное допустимое значение NONE.',
    },
  ],
  weaponFields: [
    {
      'Data type': 'UUID',
      Default: '—',
      Field: 'weaponProfileVersionId',
      Purpose: 'Идентичность версии',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint': 'Уникален; неизменяем',
    },
    {
      'Data type': 'UUID',
      Field: 'previousVersionId',
      Purpose: 'Цепочка версий',
      Required: false,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint': 'FK на предыдущую версию того же itemInstanceId+attackVariantId',
    },
    {
      'Data type': 'UUID',
      Default: '—',
      Field: 'itemInstanceId',
      Purpose: 'Конкретный экземпляр',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint': 'FK → 07_Модель_экземпляра.itemInstanceId',
    },
    {
      'Data type': 'ID',
      Default: '—',
      Field: 'ownerId',
      Purpose: 'Аудит области действия',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint':
        'Снимок владельца на момент создания версии; CHARACTER включает игрока и НПС',
    },
    {
      'Data type': 'ENUM',
      Default: 'CHARACTER',
      Field: 'ownerType',
      Purpose: 'Тип владельца',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint':
        'CHARACTER | CORPSE | BATTLE_SCENE; для master patch существующего оружия обычно CHARACTER',
    },
    {
      'Data type': 'ENUM',
      Default: 'DEFAULT',
      Field: 'attackVariantId',
      Purpose: 'Вариант профиля/атаки',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint':
        'DEFAULT|ONE_HAND|TWO_HAND|SWORD|SHIELD|RAPIER; для многовариантного оружия обязателен',
    },
    {
      'Data type': 'ENUM',
      Default: 'TEMPLATE_FIXED',
      Field: 'statSource',
      Purpose: 'Происхождение профиля',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint': 'TEMPLATE_FIXED | PLAYER_FORMULA_VALIDATED | MASTER_OVERRIDE',
    },
    {
      'Data type': 'STRING',
      Default: 'ITEM_REGISTRY_V1.2',
      Field: 'templateProfileVersion',
      Purpose: 'Трассировка шаблона',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint':
        'Версия канонического шаблона, от которого строится effective profile',
    },
    {
      'Data type': 'ID',
      Field: 'formulaId',
      Purpose: 'Использованная формула',
      Required: 'CONDITIONAL',
      Scope: 'PLAYER_VALIDATION',
      'Validation / constraint':
        'Обязателен для PLAYER_FORMULA_VALIDATED; FK → 05_Формулы_валидации',
    },
    {
      'Data type': 'STRING',
      Field: 'formulaVersion',
      Purpose: 'Воспроизводимость валидатора',
      Required: 'CONDITIONAL',
      Scope: 'PLAYER_VALIDATION',
      'Validation / constraint': 'Для PLAYER_FORMULA_VALIDATED = ITEM_FORMULAS_V1.2',
    },
    {
      'Data type': 'ENUM',
      Default: 'NOT_APPLICABLE',
      Field: 'validationStatus',
      Purpose: 'Итог проверки',
      Required: true,
      Scope: 'PLAYER_VALIDATION',
      'Validation / constraint':
        'PLAYER_FORMULA_VALIDATED→VALID; MASTER_OVERRIDE→OVERRIDDEN; TEMPLATE_FIXED→NOT_APPLICABLE',
    },
    {
      'Data type': 'JSON',
      Field: 'validationWitness',
      Purpose: 'Доказательство joint feasibility',
      Required: 'CONDITIONAL',
      Scope: 'PLAYER_VALIDATION',
      'Validation / constraint':
        'Обязателен для PLAYER_FORMULA_VALIDATED; L/Lw/Ls и каждый независимый производственный дайс',
    },
    {
      'Data type': 'JSON',
      Default: '{}',
      Field: 'instanceProfilePatch',
      Purpose: 'Дельта к шаблону/предыдущей версии',
      Required: 'CONDITIONAL',
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint':
        'Для PLAYER_FORMULA_VALIDATED содержит только формульные выходы; для MASTER_OVERRIDE — только поля MasterPatchFieldsTable',
    },
    {
      'Data type': 'JSON',
      Default: '—',
      Field: 'effectiveProfile',
      Purpose: 'Единый runtime-снимок профиля',
      Required: true,
      Scope: 'WEAPON_PROFILE_VERSION',
      'Validation / constraint':
        'Полный результат templateProfile + instanceProfilePatch; совпадает с afterProfile и структурированными полями версии',
    },
    {
      'Data type': 'OBJECT',
      Default: '—',
      Field: 'damageDefinition',
      Purpose: 'Базовое определение урона',
      Required: true,
      Scope: 'EFFECTIVE_PROFILE',
      'Validation / constraint':
        'definitionId,valueMode,sourceNotation,baseExpression,sourceScope,evaluationScope,rollGroupId; master dice — только по закрытой грамматике',
    },
    {
      'Data type': 'OBJECT',
      Default: '—',
      Field: 'penetrationDefinition',
      Purpose: 'Базовое определение пробития',
      Required: true,
      Scope: 'EFFECTIVE_PROFILE',
      'Validation / constraint':
        'Та же структура; rollGroupId независим от DAMAGE, если обе величины бросаются',
    },
    {
      'Data type': 'NUMBER',
      Field: 'instanceDamage',
      Purpose: 'Готовое Dm',
      Required: 'CONDITIONAL',
      Scope: 'EFFECTIVE_PROFILE',
      'Validation / constraint':
        'Обязателен и >0 только когда effective damageDefinition.valueMode=INSTANCE_VALUE; никогда не хранит исход боя',
    },
    {
      'Data type': 'MAP<STAT,NUMBER>',
      Default: '{}',
      Field: 'statRequirements',
      Purpose: 'Требования для использования без штрафа',
      Required: true,
      Scope: 'EFFECTIVE_PROFILE',
      'Validation / constraint':
        'Ключи S/D/I/W/M/Z/C; значения конечные >0; пустая карта = нет требований',
    },
    {
      'Data type': 'DECIMAL',
      Field: 'rangeMeters',
      Purpose: 'Предельная дальность',
      Required: 'CONDITIONAL',
      Scope: 'EFFECTIVE_PROFILE',
      'Validation / constraint':
        'Для дальнобойного attackVariantId конечное >0; для ближнего отсутствует',
    },
    {
      'Data type': 'DECIMAL',
      Field: 'accuracyBonus',
      Purpose: 'Мастерский бонус точности',
      Required: false,
      Scope: 'EFFECTIVE_PROFILE',
      'Validation / constraint':
        'Отсутствует либо конечное >0; аддитивно к обычной проверке точности',
    },
    {
      'Data type': 'ID',
      Default: '—',
      Field: 'actorId',
      Purpose: 'Кто инициировал версию',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint': 'Игрок, мастер или системный актор',
    },
    {
      'Data type': 'ENUM',
      Default: '—',
      Field: 'actorRole',
      Purpose: 'Роль инициатора',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint': 'PLAYER | MASTER | SYSTEM',
    },
    {
      'Data type': 'STRING',
      Field: 'reason',
      Purpose: 'Основание изменения',
      Required: 'CONDITIONAL',
      Scope: 'VERSION_AUDIT',
      'Validation / constraint': 'Обязателен для MASTER_OVERRIDE',
    },
    {
      'Data type': 'DATETIME',
      Default: '—',
      Field: 'createdAt',
      Purpose: 'Время версии',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint': 'Неизменяемо',
    },
    {
      'Data type': 'JSON',
      Field: 'beforeProfile',
      Purpose: 'Снимок до операции',
      Required: 'CONDITIONAL',
      Scope: 'VERSION_AUDIT',
      'Validation / constraint':
        'Обязателен для изменения существующего MASTER_OVERRIDE; null при первичном создании',
    },
    {
      'Data type': 'JSON',
      Default: '—',
      Field: 'afterProfile',
      Purpose: 'Снимок после операции',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint': 'Полный effective profile после patch',
    },
    {
      'Data type': 'ENUM',
      Default: 'NEXT_RESOLVED_ATTACK',
      Field: 'effectiveFrom',
      Purpose: 'Граница активации',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint': 'Новая версия не меняет уже начатую атаку',
    },
    {
      'Data type': 'BOOLEAN',
      Default: false,
      Field: 'active',
      Purpose: 'Текущая версия',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint':
        'В каждый момент одна активная версия на itemInstanceId+attackVariantId',
    },
    {
      'Data type': 'BOOLEAN',
      Default: true,
      Field: 'immutableAudit',
      Purpose: 'Запрет ретроспективной мутации',
      Required: true,
      Scope: 'VERSION_AUDIT',
      'Validation / constraint':
        'Всегда true; версия, before/after и ссылки боевого лога не переписываются',
    },
  ],
} as const;

const SOURCE_FIELD_KEYS = {
  instanceModel: [
    'AUDIT:cloneGraphId',
    'AUDIT:cloneSourceItemInstanceId',
    'AUDIT:cloneWriteBack',
    'AUDIT:createdAt',
    'AUDIT:issueReason',
    'AUDIT:issuedBy',
    'AUDIT:provenance',
    'AUDIT:sourceItemKey',
    'AUDIT:templateOrigin',
    'AUDIT:templateVersionRef',
    'AUDIT:updatedAt',
    'COMPOSITE:componentRole',
    'COMPOSITE:linkedSetInstanceId',
    'CUSTOM_ITEM:activeOnlyInBackpack',
    'CUSTOM_ITEM:customBonusStat',
    'CUSTOM_ITEM:customBonusValue',
    'EQUIPMENT:bodyZone',
    'EQUIPMENT:equipped',
    'EQUIPMENT:equippedSlots',
    'ITEM_INSTANCE:activeWeaponProfileVersionIdByVariant',
    'ITEM_INSTANCE:gripMode',
    'ITEM_INSTANCE:itemInstanceId',
    'ITEM_INSTANCE:itemTypeId',
    'ITEM_INSTANCE:qualityRoll',
    'ITEM_INSTANCE:qualityTier',
    'ITEM_STATE:activeCoatings',
    'ITEM_STATE:broken',
    'ITEM_STATE:sealed',
    'OWNERSHIP:battleSceneId',
    'OWNERSHIP:containerId',
    'OWNERSHIP:originalThrowerId',
    'OWNERSHIP:ownerId',
    'OWNERSHIP:ownerType',
    'OWNERSHIP:scenePointId',
    'STACK:quantity',
    'STACK:stackKey',
    'TEMPLATE:armorWeightClass',
    'TEMPLATE:canReceiveFlammableCoating',
    'TEMPLATE:canReceivePoison',
    'TEMPLATE:isFood',
    'TEMPLATE:isIgnitionSource',
    'TEMPLATE_OR_INSTANCE:flammability',
    'TEMPLATE_OR_INSTANCE:heldSizeClass',
    'TEMPLATE_OR_INSTANCE:massKg',
    'WEAPON_STATE:currentAmmo',
    'WEAPON_STATE:shieldCurrentHP',
  ],
  weaponFields: [
    'Actor:Patch field',
    'EFFECTIVE_PROFILE:accuracyBonus',
    'EFFECTIVE_PROFILE:damageDefinition',
    'EFFECTIVE_PROFILE:instanceDamage',
    'EFFECTIVE_PROFILE:penetrationDefinition',
    'EFFECTIVE_PROFILE:rangeMeters',
    'EFFECTIVE_PROFILE:statRequirements',
    'MASTER:accuracyBonus',
    'MASTER:damageDefinition',
    'MASTER:instanceDamage',
    'MASTER:penetrationDefinition',
    'MASTER:rangeMeters',
    'MASTER:statRequirements',
    'PLAYER_VALIDATION:formulaId',
    'PLAYER_VALIDATION:formulaVersion',
    'PLAYER_VALIDATION:validationStatus',
    'PLAYER_VALIDATION:validationWitness',
    'VERSION_AUDIT:active',
    'VERSION_AUDIT:actorId',
    'VERSION_AUDIT:actorRole',
    'VERSION_AUDIT:afterProfile',
    'VERSION_AUDIT:beforeProfile',
    'VERSION_AUDIT:createdAt',
    'VERSION_AUDIT:effectiveFrom',
    'VERSION_AUDIT:immutableAudit',
    'VERSION_AUDIT:reason',
    'WEAPON_PROFILE_VERSION:attackVariantId',
    'WEAPON_PROFILE_VERSION:effectiveProfile',
    'WEAPON_PROFILE_VERSION:instanceProfilePatch',
    'WEAPON_PROFILE_VERSION:itemInstanceId',
    'WEAPON_PROFILE_VERSION:ownerId',
    'WEAPON_PROFILE_VERSION:ownerType',
    'WEAPON_PROFILE_VERSION:previousVersionId',
    'WEAPON_PROFILE_VERSION:statSource',
    'WEAPON_PROFILE_VERSION:templateProfileVersion',
    'WEAPON_PROFILE_VERSION:weaponProfileVersionId',
    'X required:sourceNotation',
  ],
} as const;

export function createNpcInventoryPublicationCatalog(
  inventory: NpcInventoryCatalog,
  source: Readonly<{ instanceModel: unknown; weaponFields: unknown; customItemForm?: unknown }>,
): NpcInventoryPublicationCatalog {
  npcPublicationData.record(source, [
    'instanceModel',
    'weaponFields',
    ...(source.customItemForm === undefined ? [] : ['customItemForm']),
  ]);
  for (const key of ['instanceModel', 'weaponFields'] as const) {
    const rows = npcPublicationData.array(source[key]).map((r) => npcPublicationData.record(r));
    npcPublicationData.equal(
      SOURCE_FIELD_KEYS[key],
      rows
        .filter((r) => typeof r['Scope'] === 'string')
        .map((r) => `${npcPublicationData.text(r['Scope'])}:${npcPublicationData.text(r['Field'])}`)
        .sort(),
    );
    const expected = FIELD_SEALS[key];
    for (const seal of expected) {
      const found = rows.filter(
        (r) => r['Field'] === seal['Field'] && r['Scope'] === seal['Scope'],
      );
      if (found.length !== 1) return fail('missing or repeated Item Registry field');
      npcPublicationData.equal(seal, found[0]);
    }
  }
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_INVENTORY_PUBLICATION' as const });
  if (source.customItemForm !== undefined) {
    const form = npcPublicationData.record(source.customItemForm);
    npcPublicationData.equal('NPC-015', form.id);
    // Exact delivered forms: the B14 state adds the accepted coating guard;
    // a prefix match would silently authorize unrelated future source changes.
    const formSeal = createHash('sha256').update(canonical(form)).digest('hex');
    const hasPoison =
      formSeal === '85347ca3044663d33da9026234ea3f3f76c3a4ac1812f12f7a234c53ccf45f98';
    if (
      !hasPoison &&
      formSeal !== 'ac31c32acf591f06808c167057251ddcf6b1e8f23a1f53cd4cd4b9880231ec27'
    )
      return fail('unrecognized custom inventory source form');
    const states = npcPublicationData.record(form.states);
    npcPublicationData.equal(
      'Все предметы типизированы и имеют полные профили. ADR0084 custom item closure: closed CATALOG_ITEM FK or campaign-bound CAMPAIGN_CUSTOM_PROFILE identity; explicit structured fields and NONE or one positive integer stat bonus; quantity=1 for each bonus instance; actual same-owner backpack or explicit outside state; immutable profile/version/provenance and separate source-derived item layer; no invented catalogue IDs, containers, defaults or replaced canonical mechanics.' +
        (hasPoison
          ? ' ADR0087 coating inventory closure: selected preparations bind actual typed individual carriers/surfaces and one host-issued dose per surface; no ranged currentAmmo identity, stack replication, hidden replacement or synthetic item graph; incomplete initial Taipan mode may be completed in NPC-016 before final closure.'
          : ''),
      states.INVENTORY_VALID,
    );
    if (hasPoison) poisonCatalogs.add(catalog);
    const fields = npcPublicationData.array(form.requiredFields);
    for (const field of [
      'itemTypeReference',
      'customProfileOrNull',
      'customBonusChoice',
      'bonusContainerBinding',
      'customProfileReasonOrNull',
      'effectiveItemModifierSummary',
    ])
      if (fields.filter((value) => value === field).length !== 1)
        return fail('missing exact custom item source field');
    const backpack = inventory.definitions.find((item) => item.itemTypeId === 'RES-CON-001');
    if (backpack === undefined) return fail('missing source backpack type');
    npcPublicationData.equal(
      {
        'Generation enabled': false,
        'ID уникален': 'PASS',
        ItemTypeID: 'RES-CON-001',
        'Master profile override allowed': false,
        'Rule ID': 'AQ2-005',
        'UI-группировка по stackKey': true,
        Единица: 'экземпляр',
        Источник: 'PDF с. 94, 97, 128; AQ2-005',
        'Источник готовых параметров экземпляра': 'MASTER_DEFINED_OR_PARTIAL',
        Категория: 'Контейнер',
        'Класс каталога': 'B_EXPLICIT',
        'Можно в инвентарь': true,
        Название: 'Рюкзак',
        Подкатегория: 'Контейнер',
        'Политика заявки игрока': 'TEMPLATE_OR_DESCRIPTION_ONLY',
        'Полнота механики': 'PARTIAL',
        Примечание:
          'Вместимость и масса не заданы; вложенные бонусные customItem действуют только внутри рюкзака.',
        Составной: false,
        'Физически взаимозаменяем': false,
        Экипируется: false,
      },
      backpack.catalogueSource,
    );
    campaignCustomCatalogs.add(catalog);
  }
  catalogs.set(catalog, inventory);
  return catalog;
}
function proof(value: unknown): NpcInventoryPublicationProof {
  const d = npcPublicationData;
  const candidate = d.record(value);
  const hasPrevious = Object.hasOwn(candidate, 'previous');
  const hasCoatings = Object.hasOwn(candidate, 'coatingOrigins');
  const hasArchive = Object.hasOwn(candidate, 'archivedCoatingPreparations');
  const row = d.record(value, [
    'npcUuid',
    'commitOperationId',
    'sourceOperationId',
    'actorId',
    'committedAt',
    'entries',
    ...(hasPrevious ? ['previous'] : []),
    ...(hasCoatings ? ['coatingOrigins'] : []),
    ...(hasArchive ? ['archivedCoatingPreparations'] : []),
  ]);
  const npcUuid = d.uuid(row.npcUuid),
    commitOperationId = d.uuid(row.commitOperationId);
  const sourceOperationId = d.text(row.sourceOperationId),
    actorId = d.text(row.actorId);
  const committedAt = d.text(row.committedAt);
  // Audit DATETIME only; it is never a virtual calendar anchor and never reads the current clock.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(committedAt) ||
    !Number.isFinite(Date.parse(committedAt)) ||
    new Date(committedAt).toISOString() !== committedAt
  )
    return fail('expected canonical stored audit DATETIME');
  const rawEntries = d
    .array(row.entries)
    .map((raw) => d.record(raw, ['request', 'weaponProfileVersionId']));
  const requests = readNpcInventoryRequest(rawEntries.map((entry) => entry.request));
  const entries = rawEntries.map((entry, index) => {
    return {
      request: requests[index]!,
      weaponProfileVersionId:
        entry.weaponProfileVersionId === null ? null : d.uuid(entry.weaponProfileVersionId),
    };
  });
  const coatingOrigins = hasCoatings
    ? d.array(row.coatingOrigins).map((value) => {
        const reference = d.record(value, ['coatingInstanceId', 'originCommitOperationId']);
        return {
          coatingInstanceId: d.uuid(reference.coatingInstanceId),
          originCommitOperationId: d.uuid(reference.originCommitOperationId),
        };
      })
    : undefined;
  const archivedCoatingPreparations = hasArchive
    ? d.array(row.archivedCoatingPreparations).map((value) => {
        const reference = d.record(value, ['coatingInstanceId', 'preparationOperationId']);
        return {
          coatingInstanceId: d.uuid(reference.coatingInstanceId),
          preparationOperationId: d.uuid(reference.preparationOperationId),
        };
      })
    : undefined;
  if (
    archivedCoatingPreparations !== undefined &&
    (new Set(archivedCoatingPreparations.map((entry) => entry.preparationOperationId)).size !==
      archivedCoatingPreparations.length ||
      archivedCoatingPreparations.some(
        (entry) => entry.coatingInstanceId === entry.preparationOperationId,
      ))
  )
    return fail('archive preparation references repeat or overlap');
  const ids = [
    npcUuid,
    commitOperationId,
    sourceOperationId,
    actorId,
    ...(coatingOrigins?.map((reference) => reference.coatingInstanceId) ?? []),
    ...(archivedCoatingPreparations?.map((reference) => reference.coatingInstanceId) ?? []),
    ...entries.flatMap((e) => [
      e.request.itemInstanceId,
      ...(e.weaponProfileVersionId === null ? [] : [e.weaponProfileVersionId]),
      ...(e.request.itemTypeId === null
        ? [e.request.itemTypeReference.profileId, e.request.itemTypeReference.profileVersionId]
        : e.request.customModifier === undefined
          ? []
          : [
              e.request.customModifier.reference.profileId,
              e.request.customModifier.reference.profileVersionId,
            ]),
    ]),
    ...new Set(
      entries.flatMap((e) =>
        e.request.linkedSetInstanceId === null ? [] : [e.request.linkedSetInstanceId],
      ),
    ),
  ];
  if (new Set(ids).size !== ids.length) return fail('identity domains overlap');
  return d.freeze({
    npcUuid,
    commitOperationId,
    sourceOperationId,
    actorId,
    committedAt,
    entries,
    ...(hasPrevious ? { previous: versionReference(row.previous) } : {}),
    ...(coatingOrigins === undefined ? {} : { coatingOrigins }),
    ...(archivedCoatingPreparations === undefined ? {} : { archivedCoatingPreparations }),
  });
}
function versionReference(value: unknown): NpcInventoryVersionReference {
  const d = npcPublicationData;
  const row = d.record(value, ['npcUuid', 'version', 'sha256', 'commitOperationId']);
  if (
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    typeof row.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(row.sha256)
  )
    return fail('invalid prior NPC version reference');
  return d.freeze({
    npcUuid: d.uuid(row.npcUuid),
    version: row.version,
    sha256: row.sha256,
    commitOperationId: d.uuid(row.commitOperationId),
  });
}
interface HistoricalItem {
  readonly published: NpcPublishedInventoryItem;
  readonly request: NpcInventoryRequestEntry;
  readonly input: NpcInventoryItemInput;
  readonly activeCoatings: readonly NpcFormalPoisonCoatingInstance[];
}
interface InventoryHistory {
  readonly previous: NpcInventoryVersionReference;
  readonly items: ReadonlyMap<string, HistoricalItem>;
  readonly pendingRequests: ReadonlyMap<string, NpcInventoryRequestEntry>;
  readonly reservedProfileOwners: ReadonlyMap<string, string>;
  readonly profileIds: ReadonlySet<string>;
  readonly selectedItemIds: ReadonlySet<string>;
}
function readHistory(
  catalog: NpcInventoryPublicationCatalog,
  value: NpcInventoryPublicationContext,
): InventoryHistory {
  const d = npcPublicationData;
  const context = d.record(value, ['history']);
  const rows = d.array(context.history);
  if (rows.length === 0) return fail('revision requires an independently read prior NPC prefix');
  const references: NpcInventoryVersionReference[] = [];
  const items = new Map<string, HistoricalItem>();
  const pendingRequests = new Map<string, NpcInventoryRequestEntry>();
  const reservedProfileOwners = new Map<string, string>();
  const profileIds = new Set<string>();
  let selectedItemIds = new Set<string>();
  for (const [index, raw] of rows.entries()) {
    const row = d.record(raw, ['npcUuid', 'version', 'sha256', 'commitOperationId', 'publication']);
    const reference = versionReference({
      npcUuid: row.npcUuid,
      version: row.version,
      sha256: row.sha256,
      commitOperationId: row.commitOperationId,
    });
    if (
      reference.version !== index + 1 ||
      (references[0] !== undefined && reference.npcUuid !== references[0].npcUuid) ||
      references.some((entry) => entry.commitOperationId === reference.commitOperationId)
    )
      return fail('prior NPC history must be one exact ordered complete version prefix');
    references.push(reference);
    if (row.publication === null) {
      selectedItemIds = new Set();
      continue;
    }
    const publication = row.publication as NpcInventoryPublication;
    if (
      publications.get(publication) !== catalog ||
      publication.proof.npcUuid !== reference.npcUuid
    )
      return fail(
        'prior publication must be an independently issued result for the same catalog and NPC',
      );
    selectedItemIds = new Set(publication.items.map((item) => item.item.itemInstanceId));
    const originIndex = references.findIndex(
      (entry) => entry.commitOperationId === publication.proof.commitOperationId,
    );
    if (originIndex < 0) return fail('prior publication originates outside the actual NPC prefix');
    if (publication.proof.previous !== undefined) {
      if (originIndex === 0) return fail('revision publication has no previous NPC version');
      d.equal(references[originIndex - 1], publication.proof.previous);
    }
    for (const [itemIndex, published] of publication.items.entries()) {
      const request = publication.proof.entries[itemIndex]?.request,
        input = publication.input[itemIndex];
      if (request === undefined || input === undefined)
        return fail('incomplete issued historical item');
      items.set(published.item.itemInstanceId, {
        published,
        request,
        input,
        activeCoatings: published.item.activeCoatings,
      });
      pendingRequests.delete(published.item.itemInstanceId);
      for (const version of published.profileVersions)
        profileIds.add(version.weaponProfileVersionId);
      for (const version of published.customProfileVersions ?? []) {
        profileIds.add(version.profileId);
        profileIds.add(version.profileVersionId);
      }
    }
    for (const request of readNpcInventoryPublicationPendingRestoreRequests(catalog, publication)) {
      const reference =
        request.itemTypeId === null ? request.itemTypeReference : request.customModifier?.reference;
      if (reference !== undefined)
        for (const id of [reference.profileId, reference.profileVersionId]) {
          const owner = reservedProfileOwners.get(id);
          if (owner !== undefined && owner !== request.itemInstanceId)
            return fail('pending profile reservation belongs to another physical identity');
          reservedProfileOwners.set(id, request.itemInstanceId);
        }
      if (!items.has(request.itemInstanceId)) pendingRequests.set(request.itemInstanceId, request);
    }
    // REMOVE can be committed in the same version that omits the physical row.
    // Keep the old immutable item, but fold that actual removal into restoration
    // and later retention checks; item omission alone never removes a dose.
    for (const removal of readNpcInventoryPublicationRemovals(catalog, publication)) {
      const prior = items.get(removal.targetItemInstanceId);
      if (prior === undefined) {
        const pending = pendingRequests.get(removal.targetItemInstanceId);
        if (pending !== undefined)
          pendingRequests.set(removal.targetItemInstanceId, {
            ...pending,
            coatingInstanceIds: pending.coatingInstanceIds.filter(
              (id) => id !== removal.coatingInstanceId,
            ),
          });
        continue;
      }
      const ids = prior.request.coatingInstanceIds.filter((id) => id !== removal.coatingInstanceId);
      if (ids.length === prior.request.coatingInstanceIds.length) continue;
      items.set(removal.targetItemInstanceId, {
        ...prior,
        request: { ...prior.request, coatingInstanceIds: ids },
        activeCoatings: prior.activeCoatings.filter(
          (coating) => coating.coatingInstanceId !== removal.coatingInstanceId,
        ),
      });
    }
    // A replacement can also be prepared and then omitted before this COMMIT.
    // Its refs follow the complete actual timeline, without inventing a current
    // physical row or a published payload. Prior immutable versions stay intact.
    for (const selection of readNpcInventoryPublicationPreparationSelections(
      catalog,
      publication,
    ) ?? []) {
      const prior = items.get(selection.targetItemInstanceId);
      const ids =
        selection.preparationOrNull === null ? [] : [selection.preparationOrNull.coatingInstanceId];
      if (prior === undefined) {
        const pending = pendingRequests.get(selection.targetItemInstanceId);
        if (pending !== undefined)
          pendingRequests.set(selection.targetItemInstanceId, {
            ...pending,
            coatingInstanceIds: ids,
          });
        continue;
      }
      items.set(selection.targetItemInstanceId, {
        ...prior,
        request: { ...prior.request, coatingInstanceIds: ids },
        activeCoatings: prior.activeCoatings.filter((coating) =>
          ids.includes(coating.coatingInstanceId),
        ),
      });
    }
  }
  return {
    previous: references.at(-1)!,
    items,
    pendingRequests,
    reservedProfileOwners,
    profileIds,
    selectedItemIds,
  };
}
function inventoryRestoreGroups(
  catalog: NpcInventoryPublicationCatalog,
  context: NpcInventoryPublicationContext,
  scope: NpcInventoryRestoreScope,
): readonly Readonly<{
  choice: NpcInventoryRestoreChoice;
  requests: readonly NpcInventoryRequestEntry[];
}>[] {
  const source = catalogs.get(catalog) ?? fail('unrecognized publication catalog');
  const history = readHistory(catalog, context);
  const d = npcPublicationData;
  const own = d.record(scope, ['npcUuid', 'selectedItemInstanceIds']);
  if (d.uuid(own.npcUuid) !== history.previous.npcUuid)
    return fail('restore history belongs to another NPC');
  const selected = d.array(own.selectedItemInstanceIds).map((id) => d.uuid(id));
  if (new Set(selected).size !== selected.length)
    return fail('current restore selection repeats a physical identity');
  const visited = new Set<string>();
  const result: {
    choice: NpcInventoryRestoreChoice;
    requests: readonly NpcInventoryRequestEntry[];
  }[] = [];
  const restoreRequests = [
    ...[...history.items.values()].map((item) => item.request),
    ...history.pendingRequests.values(),
  ];
  for (const request of restoreRequests) {
    if (visited.has(request.itemInstanceId)) continue;
    let requests: readonly NpcInventoryRequestEntry[] = [request];
    if (request.linkedSetInstanceId !== null) {
      const definition = source.definitions.find((row) => row.itemTypeId === request.itemTypeId);
      const members = restoreRequests.filter(
        (item) => item.linkedSetInstanceId === request.linkedSetInstanceId,
      );
      if (
        definition === undefined ||
        !definition.composite ||
        members.length !== definition.components.length ||
        members.some((item) => item.itemTypeId !== request.itemTypeId)
      )
        return fail('restore requires the complete actual source composite');
      requests = definition.components.map((part) => {
        const matching = members.filter((item) => item.componentRole === part.role);
        if (matching.length !== 1) return fail('restore composite role differs from its source');
        return matching[0]!;
      });
    }
    const ids = requests.map((item) => item.itemInstanceId);
    for (const id of ids) visited.add(id);
    // A selected secondary component also excludes the entire pair. No silent
    // removal or replacement of the current draft occurs during restoration.
    if (ids.some((id) => selected.includes(id))) continue;
    result.push({
      choice: {
        itemInstanceId: requests[0]!.itemInstanceId,
        itemInstanceIds: ids,
        linkedSetInstanceIdOrNull: request.linkedSetInstanceId,
        ...(ids.some((id) => history.pendingRequests.has(id))
          ? { originKind: 'PENDING_PREPARATION' as const }
          : {}),
      },
      requests: readNpcInventoryRestorationRows(requests),
    });
  }
  return d.freeze(result);
}
/** Read-only choices are not an ownership allowlist. The host binds the exact selected event and revision. */
export function listNpcInventoryRestoreChoices(
  catalog: NpcInventoryPublicationCatalog,
  context: NpcInventoryPublicationContext,
  scope: NpcInventoryRestoreScope,
): readonly NpcInventoryRestoreChoice[] {
  return npcPublicationData.freeze(
    inventoryRestoreGroups(catalog, context, scope).map((group) => group.choice),
  );
}
/** Returns only the explicit offered group from latest issued same-NPC history; no allocation or publication. */
export function selectNpcInventoryRestoreRequests(
  catalog: NpcInventoryPublicationCatalog,
  context: NpcInventoryPublicationContext,
  scope: NpcInventoryRestoreScope,
  itemInstanceId: string,
): readonly NpcInventoryRequestEntry[] {
  const selected = npcPublicationData.uuid(itemInstanceId);
  return (
    inventoryRestoreGroups(catalog, context, scope).find(
      (group) => group.choice.itemInstanceId === selected,
    )?.requests ?? fail('item is not an offered unselected historical restore choice')
  );
}
function assertHistoricalItemIdentity(
  history: InventoryHistory,
  request: NpcInventoryRequestEntry,
): void {
  if (
    history.profileIds.has(request.itemInstanceId) ||
    history.reservedProfileOwners.has(request.itemInstanceId)
  )
    return fail('historical profile identity cannot become a physical item');
  const prior =
    history.items.get(request.itemInstanceId)?.request ??
    history.pendingRequests.get(request.itemInstanceId);
  if (prior === undefined) return;
  for (const key of [
    'itemTypeId',
    'gripMode',
    'linkedSetInstanceId',
    'componentRole',
    'issueReason',
  ] as const)
    npcPublicationData.equal(prior[key], request[key]);
  if (request.itemTypeId === null) {
    if (prior.itemTypeId !== null)
      return fail('catalogue physical identity cannot become arbitrary');
    npcPublicationData.equal(
      prior.itemTypeReference.profileId,
      request.itemTypeReference.profileId,
    );
  } else if (
    prior.itemTypeId !== null &&
    prior.customModifier !== undefined &&
    request.customModifier === undefined
  )
    return fail(
      'confirmed custom profile identity cannot be erased; change its bonus through a new version',
    );
}
export type NpcInventoryWeaponVersionPlan = readonly (
  | Readonly<{ itemInstanceId: string; kind: 'ABSENT' }>
  | Readonly<{ itemInstanceId: string; kind: 'RETAIN'; weaponProfileVersionId: string }>
  | Readonly<{ itemInstanceId: string; kind: 'ALLOCATE'; previousVersionIdOrNull: string | null }>
)[];
/** No IDs are minted here. The owner allocates only entries explicitly requiring a new immutable version. */
export function planNpcInventoryWeaponVersions(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
  context: NpcInventoryPublicationContext | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcInventoryWeaponVersionPlan {
  const history = context === null ? null : readHistory(catalog, context);
  const inventory = buildNpcInventoryPreview(catalog, value, context, coatingContext);
  return npcPublicationData.freeze(
    inventory.items.map((item) => {
      if (history !== null) assertHistoricalItemIdentity(history, item.request);
      if (!('stagedProfile' in item))
        return { itemInstanceId: item.request.itemInstanceId, kind: 'ABSENT' as const };
      const previous = history?.items.get(item.request.itemInstanceId)?.published
        .profileVersions[0];
      const reason =
        item.request.profile.kind === 'MASTER_WEAPON'
          ? item.request.profile.reason
          : item.request.issueReason;
      if (
        previous !== undefined &&
        canonical(stageValidatedWeaponProfile(previous.effectiveProfile)) ===
          canonical(item.stagedProfile) &&
        previous.reason === reason
      )
        return {
          itemInstanceId: item.request.itemInstanceId,
          kind: 'RETAIN' as const,
          weaponProfileVersionId: previous.weaponProfileVersionId,
        };
      return {
        itemInstanceId: item.request.itemInstanceId,
        kind: 'ALLOCATE' as const,
        previousVersionIdOrNull: previous?.weaponProfileVersionId ?? null,
      };
    }),
  );
}
function publishProfile(staged: StagedWeaponProfile, id: string): NpcPublishedWeaponProfile {
  const definition = (
    kind: 'DAMAGE' | 'PENETRATION',
    value: StagedWeaponProfile['damageDefinition'],
  ): WeaponCombatDefinition => ({
    ...value,
    definitionId: `NPC_WEAPON_DEFINITION/${id}/${staged.weaponVariantId}/${kind}`,
    ...(value.valueMode === 'PER_ATTACK_ROLL'
      ? { rollGroupId: `NPC_WEAPON_ROLL/${id}/${staged.weaponVariantId}/${kind}` }
      : {}),
  });
  return {
    ...staged,
    damageDefinition: definition('DAMAGE', staged.damageDefinition),
    penetrationDefinition: definition('PENETRATION', staged.penetrationDefinition),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${npcPublicationData.array(value).map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = npcPublicationData.record(value);
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return JSON.stringify(value);
  return fail('noncanonical source signature');
}
export interface NpcInventoryPreview {
  readonly items: readonly ((
    | Readonly<{
        request: NpcCatalogueInventoryRequestEntry &
          Readonly<{
            profile: Exclude<NpcInventoryRequestEntry['profile'], { kind: 'STRUCTURED_CUSTOM' }>;
          }>;
        stagedProfile: StagedWeaponProfile &
          Readonly<{ statSource: 'TEMPLATE_FIXED' | 'MASTER_OVERRIDE' }>;
      }>
    | Readonly<{
        request: NpcCatalogueInventoryRequestEntry &
          Readonly<{ profile: Readonly<{ kind: 'CATALOG' }> }>;
        armorProfile: NpcArmorProfile;
      }>
    | Readonly<{
        request: NpcCatalogueInventoryRequestEntry &
          Readonly<{ profile: Readonly<{ kind: 'CATALOG' }> }>;
        catalogProfile: NpcCatalogueItemProfile;
      }>
    | Readonly<{
        request: NpcCatalogueInventoryRequestEntry &
          Readonly<{ profile: Readonly<{ kind: 'CATALOG' }> }>;
        shieldProfile: NpcNonattackingShieldProfile;
      }>
    | Readonly<{
        request: NpcCampaignCustomInventoryRequestEntry;
        customProfile: NpcStructuredCustomProfile;
      }>
  ) &
    Readonly<{ activeCoatings?: readonly NpcFormalPoisonCoatingInstance[] }>)[];
}
declare const physicalBasisBrand: unique symbol;
export interface NpcInventoryPhysicalBasis {
  readonly [physicalBasisBrand]: true;
}
interface PhysicalInventory {
  readonly requests: readonly NpcInventoryRequestEntry[];
  readonly items: NpcInventoryPreview['items'];
  readonly itemContribution: NpcCustomItemContribution;
  readonly history: NpcInventoryPublicationContext | null;
}
const physicalInventories = new WeakMap<
  NpcInventoryPhysicalBasis,
  Readonly<{ catalog: NpcInventoryPublicationCatalog; value: PhysicalInventory }>
>();
/**
 * Coating preparation needs the actual carrier and life-state stat basis before
 * the coating itself exists. This issued boundary checks the physical graph,
 * retaining its exact coating references separately; it is not a full inventory
 * preview and never authorizes those references as effects or saved coatings.
 */
export function buildNpcInventoryPhysicalBasis(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
  history: NpcInventoryPublicationContext | null = null,
): NpcInventoryPhysicalBasis {
  const requests = readNpcInventoryRequest(value);
  const physical = buildNpcInventoryPreview(
    catalog,
    requests.map((request) => ({ ...request, coatingInstanceIds: [] })),
    history,
  );
  const token = Object.freeze({}) as NpcInventoryPhysicalBasis;
  physicalInventories.set(token, {
    catalog,
    value: npcPublicationData.freeze({
      requests,
      items: physical.items,
      itemContribution: customContribution(requests),
      history,
    }),
  });
  return token;
}
export function readNpcInventoryPhysicalBasis(
  catalog: NpcInventoryPublicationCatalog,
  token: unknown,
): PhysicalInventory {
  const issued =
    token !== null && typeof token === 'object'
      ? physicalInventories.get(token as NpcInventoryPhysicalBasis)
      : undefined;
  if (issued?.catalog !== catalog) return fail('unissued or foreign physical inventory basis');
  return issued.value;
}
/** Complete source mechanics only. Existing reserved item IDs remain inputs; no new IDs/audit exist here. */
export function buildNpcInventoryPreview(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
  context: NpcInventoryPublicationContext | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcInventoryPreview {
  const source = catalogs.get(catalog) ?? fail('unrecognized publication catalog');
  const history = context === null ? null : readHistory(catalog, context);
  const requests = readNpcInventoryRequest(value);
  const items = requests.map((r): NpcInventoryPreview['items'][number] => {
    validateNpcInventoryMetadata(source, r);
    if (r.itemTypeId === null || r.customModifier !== undefined) {
      if (!campaignCustomCatalogs.has(catalog))
        return unsupported('campaign custom profile requires its supplied Atlas contract');
    }
    if (r.itemTypeId === null) {
      // An arbitrary story profile is neither weapon nor armor. Its declared
      // properties do not manufacture unsupported combat, slots, quality or effects.
      if (
        r.equipped ||
        r.equippedSlots.length !== 0 ||
        r.bodyZone !== null ||
        r.gripMode !== null ||
        r.currentAmmo !== null ||
        r.shieldCurrentHP !== null ||
        r.sealed !== null ||
        r.linkedSetInstanceId !== null ||
        r.componentRole !== null
      )
        return fail('arbitrary item cannot substitute weapon, armor or composite state');
      if ((r.coatingInstanceIds.length !== 0 && coatingContext === null) || r.qualityRoll !== null)
        return unsupported(
          'custom quality/coating requires its separately proven source operation',
        );
      return { request: r, customProfile: r.profile };
    }
    const definition = source.definitions.find((d) => d.itemTypeId === r.itemTypeId);
    if (definition === undefined || definition.inventoryAllowed !== true)
      return fail('unknown inventory type');
    if (definition.category === 'Броня') {
      if (r.profile.kind !== 'CATALOG') return fail('armor requires its source catalog profile');
      validateNpcCatalogueItemState(definition, r, [], requests);
      if (r.quantity !== 1) return unsupported('physical armor needs one identity per piece');
      if (r.coatingInstanceIds.length !== 0 && coatingContext === null)
        return unsupported('prepared coatings require their actual effect proof');
      const armorProfile = resolveNpcArmorProfile(source, r.itemTypeId);
      const occupied = r.equipped
        ? r.bodyZone === null
          ? [...ARMOR_BODY_ZONES]
          : [r.bodyZone]
        : [];
      // BODY_ZONE codes are the source's actual occupied slots; a whole suit has six.
      if (
        r.equippedSlots.length !== occupied.length ||
        occupied.some((zone) => !r.equippedSlots.includes(zone))
      )
        return fail('armor occupied slots differ from its exact source coverage');
      return { request: { ...r, profile: r.profile }, armorProfile };
    }
    if (definition.category !== 'Оружие') {
      if (r.profile.kind !== 'CATALOG')
        return fail('catalogue item requires its actual source profile');
      validateNpcCatalogueItemState(definition, r, [], requests);
      if (r.equipped && r.itemTypeId !== 'RES-EQP-001')
        return unsupported('equipped nonweapon item needs its exact source coverage/properties');
      if (r.quantity !== 1 && definition.catalogueSource['Физически взаимозаменяем'] !== true)
        return fail('noninterchangeable catalogue item needs a separate physical identity');
      if (r.coatingInstanceIds.length !== 0 && coatingContext === null)
        return unsupported('prepared coatings require their actual effect proof');
      if (r.qualityRoll !== null)
        return unsupported('catalogue quality requires its actual applicable source proof');
      return {
        request: { ...r, profile: r.profile },
        catalogProfile: resolveNpcCatalogueItemProfile(source, r.itemTypeId),
      };
    }
    if (r.profile.kind === 'STRUCTURED_CUSTOM')
      return unsupported('structured custom types require their independent source profile');
    if (r.quantity !== 1)
      return unsupported('physical weapon stacks need their separate identity/split proof');
    if (r.coatingInstanceIds.length !== 0 && coatingContext === null)
      return unsupported('prepared coatings need their complete current-state evaluator');
    const component = definition.components.find((part) => part.role === r.componentRole);
    if (definition.composite && component === undefined)
      return fail('missing source component role');
    if (component !== undefined && r.qualityRoll !== null)
      return unsupported('composite quality requires an applicable source proof');
    if (component !== undefined && component.attackVariants.length === 0) {
      if (r.profile.kind !== 'CATALOG')
        return fail('nonattacking shield cannot have an attack override');
      validateNpcCatalogueItemState(definition, r, [], requests);
      if (r.shieldCurrentHP === null || r.currentAmmo !== null)
        return fail('shield current HP must be explicit');
      if (r.qualityRoll !== null)
        return unsupported('composite quality requires an applicable source proof');
      if (
        r.equipped &&
        (r.equippedSlots.length !== 1 ||
          r.equippedSlots.some((slot) => slot !== 'HAND_L' && slot !== 'HAND_R'))
      )
        return fail('composite shield occupies exactly one of the pair hands');
      return {
        request: { ...r, profile: r.profile },
        shieldProfile: resolveNpcNonattackingShieldProfile(source, r.itemTypeId),
      };
    }
    const available = source.weapons.entries.filter((e) => e.weaponTypeId === r.itemTypeId);
    const variants = available.map((e) => e.weaponVariant);
    const variant =
      component !== undefined
        ? component.attackVariants[0]!
        : variants.includes('ONE_HAND') || variants.includes('TWO_HAND')
          ? (r.gripMode ?? fail('fixed grip is required'))
          : variants.length === 1
            ? variants[0]!
            : fail('one physical attack variant is required');
    const staged =
      resolveNpcWeaponProfiles(
        source.weapons,
        r.itemTypeId,
        [variant],
        r.profile,
        history?.items
          .get(r.itemInstanceId)
          ?.published.profileVersions.map((version) => version.effectiveProfile) ?? [],
      )[0] ?? fail('missing complete weapon profile');
    validateNpcCatalogueItemState(definition, r, [staged], requests);
    if (r.equipped) {
      // Item Registry 02 "Руки" supplies the count. HAND_* are technical holding
      // slots, distinct from ARM_* armor coverage on the same physical limb.
      const hands = staged.properties['Руки'];
      const count =
        component !== undefined
          ? 1
          : hands === '1'
            ? 1
            : hands === '2'
              ? 2
              : hands === '1 или 2, фиксировано'
                ? r.gripMode === 'ONE_HAND'
                  ? 1
                  : r.gripMode === 'TWO_HAND'
                    ? 2
                    : fail('source fixed grip is missing')
                : fail('unknown source hand count');
      if (
        r.equippedSlots.length !== count ||
        r.equippedSlots.some((slot) => slot !== 'HAND_L' && slot !== 'HAND_R')
      )
        return fail('weapon occupied slots differ from its exact source hand count');
    }
    const has = (key: string) => Object.hasOwn(staged.properties, key);
    if (
      has('Ёмкость') !== (r.currentAmmo !== null) ||
      (component !== undefined ? component.shieldMaxHPOrNull !== null : has('Shield max HP')) !==
        (r.shieldCurrentHP !== null)
    )
      return fail('applicable current ammo/shield HP must be explicit');
    if (staged.statSource !== 'TEMPLATE_FIXED' && staged.statSource !== 'MASTER_OVERRIDE')
      return unsupported('initial NPC publication has no player-formula receipt');

    return {
      request: { ...r, profile: r.profile },
      stagedProfile: { ...staged, statSource: staged.statSource },
    };
  });
  const heldSlots = items.flatMap((item) =>
    'stagedProfile' in item || 'shieldProfile' in item ? item.request.equippedSlots : [],
  );
  if (new Set(heldSlots).size !== heldSlots.length)
    return fail('equipped weapons occupy the same hand');
  const sets = new Map<string, NpcInventoryPreview['items'][number][]>();
  for (const item of items) {
    const id = item.request.linkedSetInstanceId;
    if (id !== null) sets.set(id, [...(sets.get(id) ?? []), item]);
  }
  for (const parts of sets.values()) {
    const first = parts[0]!.request;
    const definition = source.definitions.find((d) => d.itemTypeId === first.itemTypeId)!;
    if (
      parts.length !== definition.components.length ||
      parts.length !== 2 ||
      parts.some(
        ({ request }) =>
          request.itemTypeId !== first.itemTypeId || request.equipped !== first.equipped,
      ) ||
      definition.components.some(
        (part) => parts.filter(({ request }) => request.componentRole === part.role).length !== 1,
      )
    )
      return fail('composite requires its exact source pair with the same equipped state');
  }
  if (items.some(({ request }) => sets.has(request.itemInstanceId)))
    return fail('linked set and component identity domains overlap');
  const coatings =
    coatingContext === null
      ? null
      : readNpcInventoryCoatingSelection(catalog, coatingContext, requests);
  const result = npcPublicationData.freeze({
    items: items.map((item) => {
      const activeCoatings = coatings?.byItem.get(item.request.itemInstanceId);
      // Only already validated payloads enter the existing preview item. Legacy
      // empty items retain their exact shape; no second whole-sheet coating state.
      return activeCoatings === undefined ? item : { ...item, activeCoatings };
    }),
  });
  previews.set(result, { catalog, context, coatingContext });
  return result;
}
/** Exact result recomputation, never a shape-only claim of a committed item. */
export function readNpcInventoryPreview(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
  context: NpcInventoryPublicationContext | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcInventoryPreview {
  const issued =
    value !== null && typeof value === 'object'
      ? previews.get(value as NpcInventoryPreview)
      : undefined;
  if (
    issued?.catalog === catalog &&
    context === null &&
    (coatingContext === null || issued.coatingContext === coatingContext)
  )
    return value as NpcInventoryPreview;
  const row = npcPublicationData.record(value, ['items']);
  const requests = npcPublicationData.array(row.items).map((raw) => {
    const item = npcPublicationData.record(raw);
    npcPublicationData.record(raw, [
      ...(Object.hasOwn(item, 'armorProfile')
        ? ['request', 'armorProfile']
        : Object.hasOwn(item, 'catalogProfile')
          ? ['request', 'catalogProfile']
          : Object.hasOwn(item, 'shieldProfile')
            ? ['request', 'shieldProfile']
            : Object.hasOwn(item, 'customProfile')
              ? ['request', 'customProfile']
              : ['request', 'stagedProfile']),
      ...(Object.hasOwn(item, 'activeCoatings') ? ['activeCoatings'] : []),
    ]);
    return item.request;
  });
  const expected = buildNpcInventoryPreview(catalog, requests, context, coatingContext);
  npcPublicationData.equal(expected, value);
  return expected;
}
export interface NpcCustomItemContribution {
  readonly totals: StatBlock;
  readonly items: readonly Readonly<{
    itemInstanceId: string;
    profileVersionId: string;
    bonusOrNull: NpcStructuredCustomProfile['customBonusOrNull'];
    containerBinding: NpcCustomBonusContainerBinding;
    active: boolean;
    reason: 'NO_BONUS' | 'OUTSIDE_BACKPACK' | 'IN_BACKPACK';
  }>[];
}
/** ADR 0084 / AQ2-005: one declared bonus per physical identity, before general final limits. */
export function deriveNpcCustomItemContribution(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): NpcCustomItemContribution {
  const inventory = readNpcInventoryPreview(catalog, value);
  return customContribution(inventory.items.map((item) => item.request));
}
function customContribution(
  requests: readonly NpcInventoryRequestEntry[],
): NpcCustomItemContribution {
  const totals: Record<keyof StatBlock, number> = { S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 };
  const items: NpcCustomItemContribution['items'][number][] = [];
  for (const request of requests) {
    const custom =
      request.itemTypeId === null
        ? {
            reference: request.itemTypeReference,
            profile: request.profile,
            bonusContainerBinding: request.bonusContainerBinding,
          }
        : request.customModifier;
    if (custom === undefined) continue;
    const bonus = custom.profile.customBonusOrNull;
    // readNpcInventoryPreview already proves that BACKPACK resolves to a real
    // selected RES-CON-001 of this inventory, independently of row ordering.
    const active = bonus !== null && custom.bonusContainerBinding.kind === 'BACKPACK';
    if (active) {
      totals[bonus.customBonusStat] += bonus.customBonusValue;
      if (!Number.isSafeInteger(totals[bonus.customBonusStat]))
        return fail('item bonus total overflow');
    }
    items.push({
      itemInstanceId: request.itemInstanceId,
      profileVersionId: custom.reference.profileVersionId,
      bonusOrNull: bonus,
      containerBinding: custom.bonusContainerBinding,
      active,
      reason: bonus === null ? 'NO_BONUS' : active ? 'IN_BACKPACK' : 'OUTSIDE_BACKPACK',
    });
  }
  return npcPublicationData.freeze({ totals, items });
}
export interface NpcInventoryStatContributions {
  readonly armor: NpcArmorContribution;
  readonly itemContribution: NpcCustomItemContribution;
  readonly equippedHermeticNate: boolean;
}
/** Historical stat facts do not publish weapons. RETAIN resolution belongs to the owning version context. */
export function deriveNpcInventoryStatContributions(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): NpcInventoryStatContributions {
  const source = catalogs.get(catalog) ?? fail('unrecognized publication catalog');
  const requests = readNpcInventoryRequest(value);
  const statItems = requests.filter((request) => {
    validateNpcInventoryMetadata(source, request);
    if (request.itemTypeId === null || request.customModifier !== undefined) {
      if (!campaignCustomCatalogs.has(catalog))
        return unsupported('campaign custom profile requires its supplied Atlas contract');
    }
    if (request.itemTypeId === null) return true;
    const definition = source.definitions.find((item) => item.itemTypeId === request.itemTypeId);
    if (definition === undefined || definition.inventoryAllowed !== true)
      return fail('unknown inventory type');
    return definition.category !== 'Оружие';
  });
  // Poison carrier references do not alter characteristic requirements. Their
  // actual effects are closed by the owning publication, never by this narrow
  // historical stat replay (which also deliberately does not publish weapons).
  const checked = buildNpcInventoryPreview(
    catalog,
    statItems.map((request) => ({ ...request, coatingInstanceIds: [] })),
  );
  const armor = deriveNpcArmorContribution(
    source,
    checked.items.flatMap((item) =>
      'armorProfile' in item && item.request.equipped
        ? [
            {
              itemInstanceId: item.request.itemInstanceId,
              itemTypeId: item.request.itemTypeId,
              bodyZoneOrNull: item.request.bodyZone,
              sealedOrNull: item.request.sealed,
            },
          ]
        : [],
    ),
  );
  return npcPublicationData.freeze({
    armor,
    itemContribution: customContribution(requests),
    equippedHermeticNate: armor.pieces.some(
      ({ piece, profile }) => profile.sourceRuleId === 'CORE-053' && piece.sealedOrNull === true,
    ),
  });
}

/** Complete initial item/version candidates; actual COMMIT/child-index provenance is mandatory at the host. */
export function buildNpcInventoryPublication(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
  context: NpcInventoryPublicationContext | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcInventoryPublication {
  const binding = proof(value),
    items: NpcPublishedInventoryItem[] = [],
    input: NpcInventoryItemInput[] = [];
  const history =
    binding.previous === undefined
      ? context === null
        ? null
        : fail('initial inventory proof must not silently consume a prior version context')
      : context === null
        ? fail('revision inventory requires independently read prior history')
        : readHistory(catalog, context);
  if (history !== null) {
    npcPublicationData.equal(history.previous, binding.previous);
    if (
      binding.npcUuid !== history.previous.npcUuid ||
      context?.history.some((entry) => entry.commitOperationId === binding.commitOperationId)
    )
      return fail('revision commit must follow the same actual NPC history');
    for (const entry of binding.entries) {
      assertHistoricalItemIdentity(history, entry.request);
      if (
        entry.weaponProfileVersionId !== null &&
        (history.items.has(entry.weaponProfileVersionId) ||
          history.pendingRequests.has(entry.weaponProfileVersionId))
      )
        return fail('historical physical item identity cannot become a weapon profile');
    }
  }
  const resolved = buildNpcInventoryPreview(
    catalog,
    binding.entries.map((entry) => entry.request),
    context,
    coatingContext,
  );
  const coatings =
    coatingContext === null
      ? null
      : readNpcInventoryCoatingSelection(
          catalog,
          coatingContext,
          binding.entries.map((entry) => entry.request),
          binding,
        );
  if (binding.coatingOrigins !== undefined) {
    if (coatings === null)
      return fail('coating origins require independently resolved owning context');
    npcPublicationData.equal(coatings.origins, binding.coatingOrigins);
  } else if (coatings !== null && coatings.origins.length !== 0)
    return fail('selected coatings require their exact original COMMIT references');
  if (binding.archivedCoatingPreparations !== undefined) {
    if (coatings === null || coatings.preparationSelections === null)
      return fail('archive references require independently issued preparation history');
    npcPublicationData.equal(coatings.archivedPreparations, binding.archivedCoatingPreparations);
  } else if (coatings !== null && coatings.archivedPreparations.length !== 0)
    return fail('omitted preparations require exact archive references');
  for (const [index, entry] of binding.entries.entries()) {
    const item = resolved.items[index] ?? fail('missing complete weapon preview');
    if ('customProfile' in item) {
      if (entry.weaponProfileVersionId !== null)
        return fail('arbitrary item has no weapon profile identity');
      const r = item.request;
      const version = customVersion(
        binding,
        r.itemInstanceId,
        r.itemTypeReference,
        r.profile,
        r.customProfileReason,
        history?.items.get(r.itemInstanceId)?.published.customProfileVersions?.[0],
        history,
      );
      items.push({
        kind: 'CAMPAIGN_CUSTOM_ITEM',
        item: {
          itemInstanceId: r.itemInstanceId,
          itemTypeId: null,
          itemTypeReference: r.itemTypeReference,
          bonusContainerBinding: r.bonusContainerBinding,
          ownerType: 'CHARACTER',
          ownerId: binding.npcUuid,
          quantity: r.quantity,
          stackKey: canonical({
            itemTypeReference: r.itemTypeReference,
            profile: r.profile,
            broken: r.broken,
            bonusContainerBinding: r.bonusContainerBinding,
          }),
          activeWeaponProfileVersionIdByVariant: {},
          equipped: r.equipped,
          equippedSlots: r.equippedSlots,
          bodyZone: null,
          gripMode: r.gripMode,
          currentAmmo: r.currentAmmo,
          shieldCurrentHP: r.shieldCurrentHP,
          broken: r.broken,
          sealed: null,
          linkedSetInstanceId: r.linkedSetInstanceId,
          componentRole: r.componentRole,
          qualityRoll: r.qualityRoll,
          activeCoatings: [],
          provenance: {
            source: 'NPC_INITIAL_COMMIT',
            sourceOperationId: binding.sourceOperationId,
            previousOwner: null,
            operationId: binding.commitOperationId,
          },
          issuedBy: binding.actorId,
          issueReason: r.issueReason,
          createdAt: binding.committedAt,
          updatedAt: binding.committedAt,
          cloneWriteBack: 'NONE',
        },
        customProfileVersions: [version],
        profileVersions: [],
      });
      input.push({
        itemInstanceId: r.itemInstanceId,
        itemTypeId: null,
        itemTypeReference: r.itemTypeReference,
        quantity: r.quantity,
        profile: r.profile,
        bonusContainerBinding: r.bonusContainerBinding,
        customProfileReason: r.customProfileReason,
        equipment: { equipped: false, equippedSlots: [] },
        bodyZone: r.bodyZone,
        gripMode: r.gripMode,
        currentAmmo: r.currentAmmo,
        shieldCurrentHP: r.shieldCurrentHP,
        broken: r.broken,
        sealed: r.sealed,
        linkedSetInstanceId: r.linkedSetInstanceId,
        componentRole: r.componentRole,
        qualityRoll: r.qualityRoll,
        coatings: [],
        issueReason: r.issueReason,
      });
      continue;
    }
    if ('catalogProfile' in item || 'shieldProfile' in item) {
      if (entry.weaponProfileVersionId !== null)
        return fail('nonweapon item must not have a weapon profile identity');
      const r = item.request,
        sourceProfile = 'catalogProfile' in item ? item.catalogProfile : item.shieldProfile;
      // Initial carrying stores its exact catalogue facts. It is not consumption,
      // a pharmacological assignment, a fabricated container, or future equipment use.
      const physical: NpcPublishedWeaponItem['item'] = {
        itemInstanceId: r.itemInstanceId,
        itemTypeId: r.itemTypeId,
        ownerType: 'CHARACTER',
        ownerId: binding.npcUuid,
        quantity: r.quantity,
        stackKey: canonical({
          itemTypeId: r.itemTypeId,
          sourceProfile,
          qualityRoll: null,
          broken: r.broken,
          ...(r.componentRole === null
            ? {}
            : { componentRole: r.componentRole, shieldCurrentHP: r.shieldCurrentHP }),
          coatings: [],
        }),
        activeWeaponProfileVersionIdByVariant: {},
        equipped: r.equipped,
        equippedSlots: r.equippedSlots,
        bodyZone: null,
        gripMode: null,
        currentAmmo: null,
        shieldCurrentHP: r.shieldCurrentHP,
        broken: r.broken,
        sealed: null,
        linkedSetInstanceId: r.linkedSetInstanceId,
        componentRole: r.componentRole,
        qualityRoll: null,
        activeCoatings: [],
        provenance: {
          source: 'NPC_INITIAL_COMMIT',
          sourceOperationId: binding.sourceOperationId,
          previousOwner: null,
          operationId: binding.commitOperationId,
        },
        issuedBy: binding.actorId,
        issueReason: r.issueReason,
        createdAt: binding.committedAt,
        updatedAt: binding.committedAt,
        cloneWriteBack: 'NONE',
      };
      items.push(
        'catalogProfile' in item
          ? {
              kind: 'CATALOG_ITEM',
              sourceProfile: item.catalogProfile,
              profileVersions: [],
              item: physical,
            }
          : {
              kind: 'SHIELD_COMPONENT',
              sourceProfile: item.shieldProfile,
              profileVersions: [],
              item: physical,
            },
      );
      input.push({
        itemInstanceId: r.itemInstanceId,
        itemTypeId: r.itemTypeId,
        quantity: r.quantity,
        profile:
          'catalogProfile' in item
            ? { kind: 'ITEM_CATALOG', sourceProfile: item.catalogProfile }
            : { kind: 'SHIELD_COMPONENT', sourceProfile: item.shieldProfile },
        equipment: r.equipped
          ? { equipped: true, equippedSlots: r.equippedSlots }
          : { equipped: false, equippedSlots: [] },
        bodyZone: null,
        gripMode: null,
        currentAmmo: null,
        shieldCurrentHP: r.shieldCurrentHP,
        broken: r.broken,
        sealed: null,
        linkedSetInstanceId: r.linkedSetInstanceId,
        componentRole: r.componentRole,
        qualityRoll: null,
        coatings: [],
        issueReason: r.issueReason,
      });
      continue;
    }
    if ('armorProfile' in item) {
      if (entry.weaponProfileVersionId !== null)
        return fail('armor must not have a weapon profile identity');
      const r = item.request;
      const sourceProfile = item.armorProfile;
      const equipment = r.equipped
        ? { equipped: true as const, equippedSlots: r.equippedSlots }
        : { equipped: false as const, equippedSlots: [] as const };
      items.push({
        kind: 'ARMOR',
        sourceProfile,
        profileVersions: [],
        item: {
          itemInstanceId: r.itemInstanceId,
          itemTypeId: r.itemTypeId,
          ownerType: 'CHARACTER',
          ownerId: binding.npcUuid,
          quantity: r.quantity,
          stackKey: canonical({
            itemTypeId: r.itemTypeId,
            sourceProfile,
            bodyZone: r.bodyZone,
            qualityRoll: r.qualityRoll,
            broken: r.broken,
            sealed: r.sealed,
            coatings: [],
          }),
          activeWeaponProfileVersionIdByVariant: {},
          ...equipment,
          bodyZone: r.bodyZone,
          gripMode: null,
          currentAmmo: null,
          shieldCurrentHP: null,
          broken: r.broken,
          sealed: r.sealed,
          linkedSetInstanceId: null,
          componentRole: null,
          qualityRoll: r.qualityRoll,
          activeCoatings: [],
          provenance: {
            source: 'NPC_INITIAL_COMMIT',
            sourceOperationId: binding.sourceOperationId,
            previousOwner: null,
            operationId: binding.commitOperationId,
          },
          issuedBy: binding.actorId,
          issueReason: r.issueReason,
          createdAt: binding.committedAt,
          updatedAt: binding.committedAt,
          cloneWriteBack: 'NONE',
        },
      });
      input.push({
        itemInstanceId: r.itemInstanceId,
        itemTypeId: r.itemTypeId,
        quantity: r.quantity,
        profile: { kind: 'ARMOR_CATALOG', sourceRuleId: sourceProfile.sourceRuleId, sourceProfile },
        equipment,
        bodyZone: r.bodyZone,
        gripMode: null,
        currentAmmo: null,
        shieldCurrentHP: null,
        broken: r.broken,
        sealed: r.sealed,
        linkedSetInstanceId: r.linkedSetInstanceId,
        componentRole: r.componentRole,
        qualityRoll: r.qualityRoll,
        coatings: [],
        issueReason: r.issueReason,
      });
      continue;
    }
    if (entry.weaponProfileVersionId === null)
      return fail('weapon requires its actual profile version identity');
    const r = item.request,
      staged = item.stagedProfile,
      variant = staged.weaponVariantId;
    const effective = publishProfile(staged, entry.weaponProfileVersionId);
    const requested = r.profile.kind === 'MASTER_WEAPON' ? r.profile.inputs[0] : undefined;
    const instanceProfilePatch: NpcWeaponInstancePatch | null =
      staged.statSource === 'TEMPLATE_FIXED'
        ? null
        : {
            ...(requested?.damageDefinition.kind === 'MASTER_DICE'
              ? { damageDefinition: effective.damageDefinition }
              : {}),
            ...(requested?.penetrationDefinition.kind === 'MASTER_DICE'
              ? { penetrationDefinition: effective.penetrationDefinition }
              : {}),
            statRequirements: effective.statRequirements,
            ...(effective.instanceDamage === undefined
              ? {}
              : { instanceDamage: effective.instanceDamage }),
            ...(effective.rangeMeters === undefined ? {} : { rangeMeters: effective.rangeMeters }),
            accuracyBonus: effective.accuracyBonus ?? null,
          };
    const previousWeapon = history?.items.get(r.itemInstanceId)?.published.profileVersions[0];
    if (previousWeapon !== undefined && previousWeapon.attackVariantId !== variant)
      return fail('physical weapon variant changed');
    const reason = r.profile.kind === 'MASTER_WEAPON' ? r.profile.reason : r.issueReason;
    let version: NpcWeaponProfileVersion = {
      weaponProfileVersionId: entry.weaponProfileVersionId,
      previousVersionId: previousWeapon?.weaponProfileVersionId ?? null,
      itemInstanceId: r.itemInstanceId,
      ownerId: binding.npcUuid,
      ownerType: 'CHARACTER',
      attackVariantId: variant,
      statSource: staged.statSource,
      templateProfileVersion: staged.templateProfileVersion,
      validationStatus: staged.statSource === 'TEMPLATE_FIXED' ? 'NOT_APPLICABLE' : 'OVERRIDDEN',
      instanceProfilePatch,
      effectiveProfile: effective,
      damageDefinition: effective.damageDefinition,
      penetrationDefinition: effective.penetrationDefinition,
      statRequirements: effective.statRequirements,
      instanceDamageOrNull: effective.instanceDamage ?? null,
      rangeMetersOrNull: effective.rangeMeters ?? null,
      accuracyBonusOrNull: effective.accuracyBonus ?? null,
      actorId: binding.actorId,
      actorRole: 'MASTER',
      reason,
      createdAt: binding.committedAt,
      beforeProfile: previousWeapon?.effectiveProfile ?? null,
      afterProfile: effective,
      effectiveFrom: 'NEXT_RESOLVED_ATTACK',
      active: true,
      immutableAudit: true,
    };
    if (previousWeapon?.weaponProfileVersionId === entry.weaponProfileVersionId) {
      npcPublicationData.equal(
        stageValidatedWeaponProfile(previousWeapon.effectiveProfile),
        staged,
      );
      npcPublicationData.equal(previousWeapon.reason, reason);
      version = previousWeapon;
    } else if (
      history?.profileIds.has(entry.weaponProfileVersionId) ||
      history?.reservedProfileOwners.has(entry.weaponProfileVersionId)
    )
      return fail('historical weapon profile version cannot be reused');
    // Grouping excludes instance UUIDs but retains the entire effective profile and mutable signature.
    const stackKey = canonical({
      itemTypeId: r.itemTypeId,
      effectiveProfile: staged,
      qualityRoll: r.qualityRoll,
      currentAmmo: r.currentAmmo,
      shieldCurrentHP: r.shieldCurrentHP,
      broken: r.broken,
      sealed: r.sealed,
      coatings: [],
    });
    items.push({
      kind: 'WEAPON',
      item: {
        itemInstanceId: r.itemInstanceId,
        itemTypeId: r.itemTypeId,
        ownerType: 'CHARACTER',
        ownerId: binding.npcUuid,
        quantity: r.quantity,
        stackKey,
        activeWeaponProfileVersionIdByVariant: { [variant]: entry.weaponProfileVersionId },
        equipped: r.equipped,
        equippedSlots: r.equippedSlots,
        bodyZone: null,
        gripMode: r.gripMode,
        currentAmmo: r.currentAmmo,
        shieldCurrentHP: r.shieldCurrentHP,
        broken: r.broken,
        sealed: null,
        linkedSetInstanceId: r.linkedSetInstanceId,
        componentRole: r.componentRole,
        qualityRoll: r.qualityRoll,
        activeCoatings: [],
        provenance: {
          source: 'NPC_INITIAL_COMMIT',
          sourceOperationId: binding.sourceOperationId,
          previousOwner: null,
          operationId: binding.commitOperationId,
        },
        issuedBy: binding.actorId,
        issueReason: r.issueReason,
        createdAt: binding.committedAt,
        updatedAt: binding.committedAt,
        cloneWriteBack: 'NONE',
      },
      profileVersions: [version],
    });
    input.push({
      itemInstanceId: r.itemInstanceId,
      itemTypeId: r.itemTypeId,
      quantity: r.quantity,
      profile:
        r.profile.kind === 'CATALOG'
          ? { kind: 'CATALOG', profileVersion: entry.weaponProfileVersionId }
          : {
              kind: 'MASTER_WEAPON',
              profileVersion: entry.weaponProfileVersionId,
              profiles: [staged],
              reason: r.profile.reason,
            },
      equipment: r.equipped
        ? { equipped: true, equippedSlots: r.equippedSlots }
        : { equipped: false, equippedSlots: [] },
      bodyZone: null,
      gripMode: r.gripMode,
      currentAmmo: r.currentAmmo,
      shieldCurrentHP: r.shieldCurrentHP,
      broken: r.broken,
      sealed: null,
      linkedSetInstanceId: r.linkedSetInstanceId,
      componentRole: r.componentRole,
      qualityRoll: r.qualityRoll,
      coatings: [],
      issueReason: r.issueReason,
    });
  }
  const publishedItems = items.map((item, index): NpcPublishedInventoryItem => {
    if (item.kind === 'CAMPAIGN_CUSTOM_ITEM') return item;
    const request = binding.entries[index]!.request;
    if (request.itemTypeId === null) return fail('catalogue/custom publication identity differs');
    const customModifier = request.customModifier;
    if (customModifier === undefined) return item;
    const version = customVersion(
      binding,
      request.itemInstanceId,
      customModifier.reference,
      customModifier.profile,
      customModifier.reason,
      history?.items.get(request.itemInstanceId)?.published.customProfileVersions?.[0],
      history,
    );
    const previousInput = input[index]!;
    if (previousInput.itemTypeId === null) return fail('catalogue/custom input identity differs');
    input[index] = { ...previousInput, customModifier };
    if (item.kind === 'ARMOR')
      return {
        ...item,
        item: {
          ...item.item,
          stackKey: canonical({ baseStackKey: item.item.stackKey, customModifier }),
        },
        customModifier,
        customProfileVersions: [version],
      };
    return {
      ...item,
      item: {
        ...item.item,
        stackKey: canonical({ baseStackKey: item.item.stackKey, customModifier }),
      },
      customModifier,
      customProfileVersions: [version],
    };
  });
  const metadataItems = publishedItems.map((item, index): NpcPublishedInventoryItem => {
    const metadata = npcInventoryMetadata(binding.entries[index]!.request);
    if (Object.keys(metadata).length === 0) return item;
    input[index] = { ...input[index]!, ...metadata };
    return withCurrentItemFields(item, {
      ...metadata,
      stackKey: canonical({ baseStackKey: item.item.stackKey, ...metadata }),
    });
  });
  const coatedItems = metadataItems.map((item, index): NpcPublishedInventoryItem => {
    const selected = coatings?.byItem.get(item.item.itemInstanceId) ?? [];
    const previous = history?.items.get(item.item.itemInstanceId)?.activeCoatings ?? [];
    for (const prior of previous) {
      const same = selected.find(
        (coating) => coating.coatingInstanceId === prior.coatingInstanceId,
      );
      if (same !== undefined) {
        // CURRENT/FROZEN source resolution is recomputed at this version. The
        // original dose identity, mode, payload, time and provenance never change.
        npcPublicationData.equal(
          { ...prior, currentSourceContext: same.currentSourceContext },
          same,
        );
      } else if (
        !selected.some((coating) => coating.replacesCoatingId === prior.coatingInstanceId) &&
        !coatings?.removals.some(
          (removal) =>
            removal.coatingInstanceId === prior.coatingInstanceId &&
            removal.targetItemInstanceId === item.item.itemInstanceId,
        )
      )
        return fail('retained physical item cannot silently lose its prepared coating');
    }
    if (selected.length === 0) return item;
    input[index] = { ...input[index]!, coatings: selected };
    return withCurrentItemFields(item, {
      activeCoatings: selected,
      stackKey: canonical({ baseStackKey: item.item.stackKey, activeCoatings: selected }),
    });
  });
  const finalItems = coatedItems.map((item): NpcPublishedInventoryItem => {
    const prior = history?.items.get(item.item.itemInstanceId);
    if (prior === undefined) return item;
    if (prior.published.kind !== item.kind) return fail('physical item source category changed');
    const physical = {
      ...item.item,
      provenance: prior.published.item.provenance,
      issuedBy: prior.published.item.issuedBy,
      issueReason: prior.published.item.issueReason,
      createdAt: prior.published.item.createdAt,
      updatedAt: prior.published.item.updatedAt,
    };
    const changed =
      history?.selectedItemIds.has(item.item.itemInstanceId) !== true ||
      canonical(physical) !== canonical(prior.published.item);
    return {
      ...item,
      item: {
        ...physical,
        updatedAt: changed ? binding.committedAt : prior.published.item.updatedAt,
      },
    } as NpcPublishedInventoryItem;
  });
  const result: NpcInventoryPublication = npcPublicationData.freeze({
    format:
      binding.previous === undefined
        ? 'NPC_INVENTORY_PUBLICATION_V1'
        : 'NPC_INVENTORY_PUBLICATION_V2',
    proof: binding,
    items: finalItems,
    input,
  });
  publications.set(result, catalog);
  if (coatings !== null) publicationRemovals.set(result, coatings.removals);
  if (coatings?.preparationSelections !== null && coatings?.preparationSelections !== undefined)
    publicationPreparations.set(result, coatings.preparationSelections);
  if (coatings !== null)
    publicationPendingRestoreRequests.set(result, coatings.pendingRestoreRequests);
  return result;
}
function customVersion(
  binding: NpcInventoryPublicationProof,
  itemInstanceId: string,
  reference: NpcCustomProfileVersionReference,
  profile: NpcStructuredCustomProfile,
  reason: string,
  previous: NpcCustomProfileVersion | undefined,
  history: InventoryHistory | null | undefined,
): NpcCustomProfileVersion {
  for (const id of [reference.profileId, reference.profileVersionId]) {
    const owner = history?.reservedProfileOwners.get(id);
    if (owner !== undefined && owner !== itemInstanceId)
      return fail('pending custom profile belongs to another physical identity');
  }
  if (
    history?.items.has(reference.profileId) ||
    history?.items.has(reference.profileVersionId) ||
    history?.pendingRequests.has(reference.profileId) ||
    history?.pendingRequests.has(reference.profileVersionId)
  )
    return fail('historical physical item identity cannot become a custom profile');
  if (previous === undefined) {
    if (reference.version !== 1)
      return fail('initial custom profile version must be its first actual reservation');
    if (
      history?.profileIds.has(reference.profileId) ||
      history?.profileIds.has(reference.profileVersionId)
    )
      return fail('historical custom profile belongs to another physical identity');
  } else {
    npcPublicationData.equal(previous.profileId, reference.profileId);
    if (previous.profileVersionId === reference.profileVersionId) {
      npcPublicationData.equal(previous.version, reference.version);
      npcPublicationData.equal(previous.reservationOperationId, reference.reservationOperationId);
      npcPublicationData.equal(previous.afterProfile, profile);
      npcPublicationData.equal(previous.reason, reason);
      return previous;
    }
    if (
      reference.version !== previous.version + 1 ||
      history?.profileIds.has(reference.profileVersionId)
    )
      return fail('custom profile requires the next actual unused version');
  }
  return {
    profileId: reference.profileId,
    profileVersionId: reference.profileVersionId,
    version: reference.version,
    reservationOperationId: reference.reservationOperationId,
    itemInstanceId,
    ownerId: binding.npcUuid,
    previousVersionId: previous?.profileVersionId ?? null,
    actorId: binding.actorId,
    createdAt: binding.committedAt,
    reason,
    beforeProfile: previous?.afterProfile ?? null,
    afterProfile: profile,
    immutableAudit: true,
  };
}
export function readNpcInventoryPublication(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
  context: NpcInventoryPublicationContext | null = null,
  coatingContext: NpcInventoryCoatingContext | null = null,
): NpcInventoryPublication {
  const row = npcPublicationData.record(value, ['format', 'proof', 'items', 'input']);
  const expected = buildNpcInventoryPublication(catalog, row.proof, context, coatingContext);
  npcPublicationData.equal(expected, value);
  return expected;
}
