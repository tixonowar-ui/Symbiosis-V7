import {
  readNpcInventoryRequest,
  resolveNpcWeaponProfiles,
  validateNpcCatalogueItemState,
  type NpcInventoryCatalog,
  type NpcInventoryRequestEntry,
} from './inventory.js';
import type { StagedWeaponProfile } from '../item-stage/master-weapon-profile.js';
import type { WeaponCombatDefinition } from '../item-stage/weapon-profile.js';
import type { StartingWeaponVariant } from '../item-stage/starting-weapon.js';
import type { NpcInventoryItemInput } from './types.js';

/** The host proves these original operation references; a pure reader proves no authority. */
export interface NpcInventoryPublicationProof {
  readonly npcUuid: string;
  readonly commitOperationId: string;
  readonly sourceOperationId: string;
  readonly actorId: string;
  readonly committedAt: string;
  readonly entries: readonly Readonly<{
    request: NpcInventoryRequestEntry;
    weaponProfileVersionId: string;
  }>[];
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
  readonly previousVersionId: null;
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
  readonly beforeProfile: null;
  readonly afterProfile: NpcPublishedWeaponProfile;
  readonly effectiveFrom: 'NEXT_RESOLVED_ATTACK';
  readonly active: true;
  readonly immutableAudit: true;
}
export interface NpcPublishedWeaponItem {
  readonly kind: 'WEAPON';
  readonly item: Readonly<{
    itemInstanceId: string;
    itemTypeId: string;
    ownerType: 'CHARACTER';
    ownerId: string;
    quantity: number;
    stackKey: string;
    activeWeaponProfileVersionIdByVariant: Readonly<Partial<Record<StartingWeaponVariant, string>>>;
    equipped: false;
    equippedSlots: readonly [];
    bodyZone: null;
    gripMode: 'ONE_HAND' | 'TWO_HAND' | null;
    currentAmmo: number | null;
    shieldCurrentHP: number | null;
    broken: boolean;
    sealed: null;
    linkedSetInstanceId: null;
    componentRole: null;
    qualityRoll: number | null;
    activeCoatings: readonly [];
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
  }>;
  readonly profileVersions: readonly NpcWeaponProfileVersion[];
}
export interface NpcInventoryPublication {
  readonly format: 'NPC_INVENTORY_PUBLICATION_V1';
  readonly proof: NpcInventoryPublicationProof;
  readonly items: readonly NpcPublishedWeaponItem[];
  readonly input: readonly NpcInventoryItemInput[];
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
  source: Readonly<{ instanceModel: unknown; weaponFields: unknown }>,
): NpcInventoryPublicationCatalog {
  npcPublicationData.record(source, ['instanceModel', 'weaponFields']);
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
  catalogs.set(catalog, inventory);
  return catalog;
}
function proof(value: unknown): NpcInventoryPublicationProof {
  const d = npcPublicationData;
  const row = d.record(value, [
    'npcUuid',
    'commitOperationId',
    'sourceOperationId',
    'actorId',
    'committedAt',
    'entries',
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
  const entries = d.array(row.entries).map((raw) => {
    const entry = d.record(raw, ['request', 'weaponProfileVersionId']);
    return {
      request: readNpcInventoryRequest([entry.request])[0]!,
      weaponProfileVersionId: d.uuid(entry.weaponProfileVersionId),
    };
  });
  const ids = [
    npcUuid,
    commitOperationId,
    sourceOperationId,
    actorId,
    ...entries.flatMap((e) => [e.request.itemInstanceId, e.weaponProfileVersionId]),
  ];
  if (new Set(ids).size !== ids.length) return fail('identity domains overlap');
  return d.freeze({ npcUuid, commitOperationId, sourceOperationId, actorId, committedAt, entries });
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
  readonly items: readonly Readonly<{
    request: NpcInventoryRequestEntry &
      Readonly<{
        profile: Exclude<NpcInventoryRequestEntry['profile'], { kind: 'STRUCTURED_CUSTOM' }>;
      }>;
    stagedProfile: StagedWeaponProfile &
      Readonly<{ statSource: 'TEMPLATE_FIXED' | 'MASTER_OVERRIDE' }>;
  }>[];
}
/** Complete source mechanics only. Existing reserved item IDs remain inputs; no new IDs/audit exist here. */
export function buildNpcInventoryPreview(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): NpcInventoryPreview {
  const source = catalogs.get(catalog) ?? fail('unrecognized publication catalog');
  const items = readNpcInventoryRequest(value).map((r) => {
    const definition = source.definitions.find((d) => d.itemTypeId === r.itemTypeId);
    if (definition === undefined || definition.inventoryAllowed !== true)
      return fail('unknown inventory type');
    if (
      definition.category !== 'Оружие' ||
      definition.composite ||
      r.profile.kind === 'STRUCTURED_CUSTOM'
    )
      return unsupported(
        'only proved non-composite source weapon profiles are published by this branch',
      );
    if (r.quantity !== 1)
      return unsupported('physical weapon stacks need their separate identity/split proof');
    if (r.equipped || r.coatingInstanceIds.length !== 0)
      return unsupported(
        'equipment and prepared coatings need their complete current-state evaluator',
      );
    const available = source.weapons.entries.filter((e) => e.weaponTypeId === r.itemTypeId);
    const variants = available.map((e) => e.weaponVariant);
    const variant =
      variants.includes('ONE_HAND') || variants.includes('TWO_HAND')
        ? (r.gripMode ?? fail('fixed grip is required'))
        : variants.length === 1
          ? variants[0]!
          : fail('one physical attack variant is required');
    const staged =
      resolveNpcWeaponProfiles(source.weapons, r.itemTypeId, [variant], r.profile)[0] ??
      fail('missing complete weapon profile');
    validateNpcCatalogueItemState(definition, r, [staged]);
    const has = (key: string) => Object.hasOwn(staged.properties, key);
    if (
      has('Ёмкость') !== (r.currentAmmo !== null) ||
      has('Shield max HP') !== (r.shieldCurrentHP !== null)
    )
      return fail('applicable current ammo/shield HP must be explicit');
    if (staged.statSource !== 'TEMPLATE_FIXED' && staged.statSource !== 'MASTER_OVERRIDE')
      return unsupported('initial NPC publication has no player-formula receipt');

    return {
      request: { ...r, profile: r.profile },
      stagedProfile: { ...staged, statSource: staged.statSource },
    };
  });
  return npcPublicationData.freeze({ items });
}
/** Exact result recomputation, never a shape-only claim of a committed item. */
export function readNpcInventoryPreview(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): NpcInventoryPreview {
  const row = npcPublicationData.record(value, ['items']);
  const requests = npcPublicationData.array(row.items).map((raw) => {
    const item = npcPublicationData.record(raw, ['request', 'stagedProfile']);
    return item.request;
  });
  const expected = buildNpcInventoryPreview(catalog, requests);
  npcPublicationData.equal(expected, value);
  return expected;
}

/** Complete initial item/version candidates; actual COMMIT/child-index provenance is mandatory at the host. */
export function buildNpcInventoryPublication(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): NpcInventoryPublication {
  const binding = proof(value),
    items: NpcPublishedWeaponItem[] = [],
    input: NpcInventoryItemInput[] = [];
  const resolved = buildNpcInventoryPreview(
    catalog,
    binding.entries.map((entry) => entry.request),
  );
  for (const [index, entry] of binding.entries.entries()) {
    const item = resolved.items[index] ?? fail('missing complete weapon preview');
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
    const version: NpcWeaponProfileVersion = {
      weaponProfileVersionId: entry.weaponProfileVersionId,
      previousVersionId: null,
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
      reason: r.profile.kind === 'MASTER_WEAPON' ? r.profile.reason : r.issueReason,
      createdAt: binding.committedAt,
      beforeProfile: null,
      afterProfile: effective,
      effectiveFrom: 'NEXT_RESOLVED_ATTACK',
      active: true,
      immutableAudit: true,
    };
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
        equipped: false,
        equippedSlots: [],
        bodyZone: null,
        gripMode: r.gripMode,
        currentAmmo: r.currentAmmo,
        shieldCurrentHP: r.shieldCurrentHP,
        broken: r.broken,
        sealed: null,
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
      equipment: { equipped: false, equippedSlots: [] },
      bodyZone: null,
      gripMode: r.gripMode,
      currentAmmo: r.currentAmmo,
      shieldCurrentHP: r.shieldCurrentHP,
      broken: r.broken,
      sealed: null,
      linkedSetInstanceId: null,
      componentRole: null,
      qualityRoll: r.qualityRoll,
      coatings: [],
      issueReason: r.issueReason,
    });
  }
  return npcPublicationData.freeze({
    format: 'NPC_INVENTORY_PUBLICATION_V1',
    proof: binding,
    items,
    input,
  });
}
export function readNpcInventoryPublication(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): NpcInventoryPublication {
  const row = npcPublicationData.record(value, ['format', 'proof', 'items', 'input']);
  const expected = buildNpcInventoryPublication(catalog, row.proof);
  npcPublicationData.equal(expected, value);
  return expected;
}
