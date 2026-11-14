import type { ReactNode } from 'react';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import {
  ENEMY_STATS,
  sentientEnemyAuthoringProjectionValue as enemyAuthoringProjectionValue,
  enemyAuthoringProjectionValue as anyEnemyAuthoringProjectionValue,
  type EnemyItemInput,
  type EnemySheet,
  type EnemyVersionIdentity,
  type EnemyAuthoringProjection,
  type EnemyPatchStage,
} from '@shared/enemy-authoring.js';
import {
  EnemyCompositionFields,
  EnemyCompositionFactsContent,
} from './enemy-composition-fields.js';
import {
  CustomMonsterContent,
  IdentityFields as MonsterIdentityFields,
  StatsFields as MonsterStatsFields,
  PhysicsFields as MonsterPhysicsFields,
  AttackFields as MonsterAttackFields,
  SymbiontFields as MonsterSymbiontFields,
  Sheet as MonsterSheetContent,
} from './custom-monster-content.js';
import { customMonsterProjectionValue } from '@shared/custom-monster-presentation.js';
import {
  enemyVersionConfigurationInputValue,
  type EnemyVersionConfigurationInput,
  type EnemyVersionDiffEntry,
} from '@shared/enemy-version-configuration.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import { calculateSkillSlotCost } from '../../../domain/rules/skill-stage/skills.js';

const labels: Readonly<Record<string, string>> = {
  NONE: 'Нет',
  LEFT: 'Слева',
  RIGHT: 'Справа',
  SELECTED: 'Выбранный навык',
  RACE_GRANTED: 'Расовый навык',
  CLASS_MANDATORY: 'Обязательный навык класса',
  SYMBIONT_SELECTED: 'Выбранный навык симбионта',
  SYMBIONT_GRANTED: 'Дар симбионта',
  PURE: 'Чистый',
  FREE: 'Вольный',
  UNITED: 'Единый',
  SEEKER: 'Искатель',
  STALKER: 'Сталкер',
  SOLDIER: 'Солдат',
  HAND_L: 'Левая кисть — держание оружия',
  HAND_R: 'Правая кисть — держание оружия',
  HEAD: 'Голова',
  TORSO: 'Торс',
  ARM_L: 'Левая рука',
  ARM_R: 'Правая рука',
  LEG_L: 'Левая нога',
  LEG_R: 'Правая нога',
  ONE_HAND: 'Одноручный',
  TWO_HAND: 'Двуручный',
  DEFAULT: 'Обычный',
  SWORD: 'Меч',
  RAPIER: 'Рапира',
  SHIELD: 'Щит',
  UNKNOWN: 'Неизвестно',
  COMBUSTIBLE: 'Горючая',
  NONCOMBUSTIBLE: 'Негорючая',
};
const object = (value: JsonValue | undefined): JsonObject => value as JsonObject;
const list = (value: JsonValue | undefined): readonly JsonObject[] =>
  value as readonly JsonObject[];
const text = (value: JsonValue | undefined): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  throw new Error('Не распознан примитив отображаемого факта.');
};
const statText = (value: Readonly<Record<string, number>>) =>
  Object.entries(value)
    .map(([key, value]) => key + ': ' + String(value))
    .join(' · ');
const skillRequirementText = (requirements: readonly JsonObject[]) => {
  const groups = new Map<string, string[]>();
  for (const requirement of requirements) {
    const key = text(requirement['requirementSetId']),
      values = groups.get(key) ?? [];
    values.push(text(requirement['statCode']) + ' ≥ ' + text(requirement['minValue']));
    groups.set(key, values);
  }
  return [...groups.values()].map((values) => values.join(' и ')).join(' или ') || 'Нет';
};
function ProfileFacts({ profile }: { readonly profile: JsonValue }) {
  const p = object(profile);
  return (
    <>
      {typeof p['templateProfileVersion'] === 'string' ? (
        <p>
          Версия профиля: {p['templateProfileVersion']} · {text(p['variantLabel'])}
        </p>
      ) : null}
      {p['damageDefinition'] !== undefined ? (
        <p>
          Урон: {text(object(p['damageDefinition'])['effectiveTemplateExpression'])}; пробитие:{' '}
          {text(object(p['penetrationDefinition'])['effectiveTemplateExpression'])}
        </p>
      ) : null}
      {p['statRequirements'] !== undefined ? (
        <p>
          Требования: {statText(p['statRequirements'] as Readonly<Record<string, number>>) || 'Нет'}
        </p>
      ) : null}
      {p['requiredStrength'] !== undefined ? (
        <p>Требование силы: {text(p['requiredStrength'])}</p>
      ) : null}
      {p['protectionSourceOrNull'] !== undefined && p['protectionSourceOrNull'] !== null ? (
        <p>Защиты: {text(p['protectionSourceOrNull'])}</p>
      ) : null}
      {p['conditionSourceOrNull'] !== undefined && p['conditionSourceOrNull'] !== null ? (
        <p>Условия: {text(p['conditionSourceOrNull'])}</p>
      ) : null}
    </>
  );
}
export function EnemySheetContent({
  sheet,
  catalog,
}: {
  readonly sheet: EnemySheet;
  readonly catalog: JsonObject;
}) {
  const armorPenalty = object(sheet.requirementPenalties['armor']);
  return (
    <section aria-label="Полный лист мыслящего врага" data-enemy-sheet>
      <h2>{sheet.identity.name}</h2>
      <p>{sheet.identity.description}</p>
      <dl>
        <dt>Происхождение</dt>
        <dd>{sheet.identity.origin || 'Не указано'}</dd>
        <dt>Принадлежность</dt>
        <dd>{sheet.identity.affiliation || 'Не указана'}</dd>
        <dt>Масса</dt>
        <dd>{sheet.identity.massKg} кг</dd>
        <dt>Анатомия</dt>
        <dd>Обычная анатомия мыслящего</dd>
        <dt>Раса и класс</dt>
        <dd>
          {labels[sheet.build.raceCode]} ·{' '}
          {sheet.build.pureClassOrNull === null
            ? 'Без класса'
            : labels[sheet.build.pureClassOrNull]}
        </dd>
        <dt>Базовые характеристики</dt>
        <dd>{statText(sheet.baseStats)}</dd>
        <dt>На этапе навыков</dt>
        <dd>{statText(sheet.skillStageStats)}</dd>
        <dt>Постоянные характеристики</dt>
        <dd>{statText(sheet.permanentStats)}</dd>
        <dt>С экипировкой</dt>
        <dd>{statText(sheet.effectiveStats)}</dd>
        <dt>Максимум HP</dt>
        <dd>{sheet.maxHP}</dd>
        <dt>Слоты навыков</dt>
        <dd>
          {sheet.skillSlots.used} из {sheet.skillSlots.capacity}
        </dd>
        <dt>Симбионты</dt>
        <dd>
          {sheet.compositionFacts === undefined
            ? 'Явно пустой состав'
            : 'Подтверждённый состав и приобретения'}
        </dd>
      </dl>
      {sheet.compositionFacts === undefined ? null : (
        <EnemyCompositionFactsContent facts={sheet.compositionFacts} catalog={catalog} />
      )}
      {sheet.skillPlanState?.planOrNull == null ? null : (
        <section aria-label="Фактическая оплата навыков">
          <h3>Начальный план {sheet.skillPlanState.planOrNull.revision}: фактическая оплата</h3>
          <p>
            Потеря источника или снижение вместимости не возвращает уже оплаченные слоты. Временное
            отключение навыка не забывает его.
          </p>
          <ul>
            {sheet.skillPlanState.planOrNull.accountingOrNull?.knownSkills.map((skill) => (
              <li key={skill.skillKey}>
                {text(
                  list(catalog['skills']).find((row) => row['skillKey'] === skill.skillKey)?.[
                    'name'
                  ],
                )}
                : бонус {skill.bonus}, START {skill.startSlots}, Мирный воин {skill.dolphinSlots}.
              </li>
            ))}
          </ul>
          {sheet.skillPlanState.planOrNull.accountingOrNull?.permanentLosses.length === 0 ? null : (
            <>
              <h4>Подтверждённые постоянные утраты этого плана</h4>
              <ul>
                {sheet.skillPlanState.planOrNull.accountingOrNull?.permanentLosses.map(
                  (loss, index) => (
                    <li key={index}>
                      {text(
                        list(catalog['skills']).find((row) => row['skillKey'] === loss.skillKey)?.[
                          'name'
                        ],
                      )}
                      : прежний бонус {loss.bonusBefore}; освобождено START{' '}
                      {loss.releasedStartSlots}, Мирный воин {loss.releasedDolphinSlots}. Возврат
                      требований сам по себе не обучает навыку заново.
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
        </section>
      )}
      <h3>Навыки</h3>
      <ul>
        {sheet.skills.map((skill) => (
          <li key={skill.skillKey}>
            {skill.name} · бонус {skill.bonus} · слотов {skill.slotCost}
            {skill.source === 'RACE_GRANTED'
              ? ' · расовый навык'
              : skill.source === 'CLASS_MANDATORY'
                ? ' · обязательный навык класса'
                : ''}
            <p>
              Требования:{' '}
              {skillRequirementText(
                list(
                  list(catalog['skills']).find((row) => row['skillKey'] === skill.skillKey)?.[
                    'requirements'
                  ],
                ),
              )}
            </p>
          </li>
        ))}
      </ul>
      <h3>Имущество и экипировка</h3>
      {sheet.items.length === 0 ? (
        <p>Без имущества</p>
      ) : (
        <ul>
          {sheet.items.map((item, index) => (
            <li key={item.itemTemplateKey}>
              <strong>{item.name}</strong> · количество {item.quantity} ·{' '}
              {item.equipped
                ? 'Экипирован: ' + item.equippedSlots.map((slot) => labels[slot] ?? slot).join(', ')
                : 'В инвентаре'}
              <ProfileFacts profile={item.profile} />
              {sheet.inventory.inventoryItems[index]?.qualityTier !== undefined ? (
                <p>
                  Качество:{' '}
                  {sheet.inventory.inventoryItems[index]?.qualityTier === null
                    ? 'Мастер явно не определил'
                    : text(
                        list(object(catalog['inventoryMetadata'])['qualityTiers']).find(
                          (tier) =>
                            tier['value'] === sheet.inventory.inventoryItems[index]?.qualityTier,
                        )?.['label'],
                      )}
                </p>
              ) : null}
              {sheet.inventory.inventoryItems[index]?.clothingProperties !== undefined ? (
                <p>
                  Одежда покрывает:{' '}
                  {sheet.inventory.inventoryItems[index].clothingProperties.coveredRegionIds
                    .map((region) => labels[region])
                    .join(', ')}
                  ; герметичность:{' '}
                  {sheet.inventory.inventoryItems[index].clothingProperties.hermetic === 'UNKNOWN'
                    ? 'Неизвестно'
                    : sheet.inventory.inventoryItems[index].clothingProperties.hermetic
                      ? 'Да'
                      : 'Нет'}
                  ; горючесть:{' '}
                  {labels[sheet.inventory.inventoryItems[index].clothingProperties.flammability]}.
                </p>
              ) : null}
              {sheet.inventory.inventoryItems[index]?.currentAmmo !== null ? (
                <p>Боезапас: {sheet.inventory.inventoryItems[index]?.currentAmmo}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <h3>Последствия экипировки</h3>
      <p>
        Штраф брони при дефиците силы: {text(armorPenalty['penalty'])}; дефицит:{' '}
        {text(armorPenalty['deficit'])}. Действует на физические действия, перемещение и активную
        защиту.
      </p>
      <p>
        Поправка M брони: {text(sheet.armor['mobilityModifier'])}; бег:{' '}
        {text(sheet.armor['runningModifier'])}; акробатика:{' '}
        {text(sheet.armor['acrobaticsModifier'])}; уклонение: {text(sheet.armor['dodgeModifier'])};
        классовая поправка перемещения: {sheet.classMovementModifier}.
      </p>
      <ul>
        {list(sheet.requirementPenalties['weapons']).map((weapon, index) => (
          <li key={index}>
            Оружие {index + 1}: дефицит {text(weapon['deficitTotal'])}, штраф{' '}
            {text(weapon['penalty'])}
          </li>
        ))}
      </ul>
      <p>Развитие за опыт отсутствует. Группа, размещение и боевой экземпляр не создаются.</p>
    </section>
  );
}
function MasterProfileFields({
  item,
  onChange,
  variants,
}: {
  readonly item: EnemyItemInput;
  readonly onChange: (item: EnemyItemInput) => void;
  readonly variants: readonly JsonObject[];
}) {
  const profile = item.profile;
  if (profile.kind !== 'MASTER_WEAPON') return null;
  const input = profile.inputs[0];
  if (input === undefined) return null;
  const set = (patch: Partial<typeof input>) =>
    onChange({ ...item, profile: { ...profile, inputs: [{ ...input, ...patch }] } });
  return (
    <fieldset>
      <legend>Мастерский профиль оружия</legend>
      <label>
        Основание профиля
        <input
          value={profile.reason}
          onChange={(e) => onChange({ ...item, profile: { ...profile, reason: e.target.value } })}
        />
      </label>
      <label>
        Вариант оружия
        <select
          value={input.weaponVariantId}
          onChange={(e) => set({ weaponVariantId: e.target.value as typeof input.weaponVariantId })}
        >
          {variants.map((v) => (
            <option key={text(v['weaponVariant'])} value={text(v['weaponVariant'])}>
              {text(v['variantLabel'])}
            </option>
          ))}
        </select>
      </label>
      {(['damageDefinition', 'penetrationDefinition'] as const).map((key) => (
        <fieldset key={key}>
          <legend>{key === 'damageDefinition' ? 'Урон' : 'Пробитие'}</legend>
          <select
            aria-label={key === 'damageDefinition' ? 'Выражение урона' : 'Выражение пробития'}
            value={input[key].kind === 'RETAIN' ? 'RETAIN' : input[key].pattern}
            onChange={(e) =>
              set({
                [key]:
                  e.target.value === 'RETAIN'
                    ? { kind: 'RETAIN' }
                    : { kind: 'MASTER_DICE', pattern: e.target.value, constantOrNull: null },
              })
            }
          >
            <option value="RETAIN">Сохранить исходное выражение</option>
            {['R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'].map((pattern) => (
              <option key={pattern}>{pattern}</option>
            ))}
          </select>
          {input[key].kind === 'MASTER_DICE' ? (
            <label>
              Константа X
              <input
                type="number"
                value={input[key].constantOrNull ?? ''}
                onChange={(e) =>
                  set({
                    [key]: {
                      ...input[key],
                      constantOrNull: e.target.value === '' ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ) : null}
        </fieldset>
      ))}
      <fieldset>
        <legend>Карта требований</legend>
        {ENEMY_STATS.map((stat) => (
          <label key={stat}>
            {stat}
            <input
              type="number"
              min="0"
              step="any"
              value={input.statRequirements[stat] ?? ''}
              onChange={(e) => {
                const requirements = { ...input.statRequirements };
                if (e.target.value === '') delete requirements[stat];
                else requirements[stat] = Number(e.target.value);
                set({ statRequirements: requirements });
              }}
            />
          </label>
        ))}
      </fieldset>
      {(['instanceDamageOrNull', 'rangeMetersOrNull', 'accuracyBonusOrNull'] as const).map(
        (key, index) => (
          <label key={key}>
            {['Урон экземпляра', 'Дальность, м', 'Бонус меткости'][index]}
            <input
              type="number"
              step="any"
              value={input[key] ?? ''}
              onChange={(e) =>
                set({ [key]: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>
        ),
      )}
    </fieldset>
  );
}
function InventoryFields({
  catalog,
  value,
  onChange,
}: {
  readonly catalog: JsonObject;
  readonly value: readonly EnemyItemInput[];
  readonly onChange: (items: readonly EnemyItemInput[]) => void;
}) {
  const [selected, setSelected] = useState('');
  const choices = list(catalog['items']);
  const metadata = object(catalog['inventoryMetadata']);
  const replace = (index: number, item: EnemyItemInput) =>
    onChange(value.map((old, i) => (i === index ? item : old)));
  function add() {
    const selectedItem = choices.find((item) => item['itemTypeId'] === selected);
    if (selectedItem === undefined) return;
    const components = list(selectedItem['components']);
    const group = selectedItem['composite'] === true ? crypto.randomUUID() : null;
    const roles =
      group === null
        ? [null]
        : components.map((c) => text(c['role']) as 'SWORD' | 'RAPIER' | 'SHIELD');
    onChange([
      ...value,
      ...roles.map((componentRole) => ({
        itemTypeId: selected,
        quantity: 1,
        profile: { kind: 'CATALOG' as const },
        equipped: false,
        equippedSlots: [],
        bodyZone: null,
        gripMode: null,
        currentAmmo: null,
        shieldCurrentHP: null,
        broken: false,
        sealed: null,
        linkedSetInstanceId: group,
        componentRole,
        qualityRoll: null,
        coatingInstanceIds: [],
        issueReason: '',
      })),
    ]);
  }
  return (
    <section aria-label="Имущество мыслящего врага">
      <label>
        Предмет из каталога
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Выберите предмет</option>
          {choices.map((item) => (
            <option key={text(item['itemTypeId'])} value={text(item['itemTypeId'])}>
              {text(item['name'])}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={add} disabled={selected === ''}>
        Добавить предмет
      </button>
      {value.length === 0 ? (
        <p>Имущество не добавлено. Подтверждение сохранит явно пустой инвентарь.</p>
      ) : null}
      {value.map((item, index) => {
        const definition = choices.find((row) => row['itemTypeId'] === item.itemTypeId)!;
        const variants = list(definition['weaponProfiles']);
        const armor = definition['armorOrNull'] === null ? null : object(definition['armorOrNull']);
        const slots =
          armor !== null
            ? armor['coverageModel'] === 'FULL_SUIT'
              ? ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R']
              : item.bodyZone === null
                ? []
                : [item.bodyZone]
            : definition['category'] === 'Оружие'
              ? ['HAND_L', 'HAND_R']
              : (item.clothingProperties?.coveredRegionIds ?? []);
        return (
          <fieldset key={index}>
            <legend>
              Предмет {index + 1}: {text(definition['name'])}
              {item.componentRole === null ? '' : ' · ' + labels[item.componentRole]}
            </legend>
            <label>
              Количество
              <input
                aria-label={`Количество предмета ${index + 1}`}
                type="number"
                min="1"
                step="1"
                value={item.quantity}
                onChange={(e) => replace(index, { ...item, quantity: Number(e.target.value) })}
              />
            </label>
            <label>
              Качество
              <select
                value={Object.hasOwn(item, 'qualityTier') ? (item.qualityTier ?? 'NULL') : ''}
                onChange={(e) => {
                  const without = { ...item };
                  Reflect.deleteProperty(without, 'qualityTier');
                  replace(
                    index,
                    e.target.value === ''
                      ? without
                      : {
                          ...item,
                          qualityTier:
                            e.target.value === 'NULL'
                              ? null
                              : (e.target.value as NonNullable<EnemyItemInput['qualityTier']>),
                        },
                  );
                }}
              >
                <option value="">Не задано</option>
                <option value="NULL">Мастер явно не определил качество</option>
                {list(metadata['qualityTiers']).map((tier) => (
                  <option key={text(tier['value'])} value={text(tier['value'])}>
                    {text(tier['label'])}
                  </option>
                ))}
              </select>
            </label>
            {item.itemTypeId === 'RES-EQP-001' ? (
              <fieldset>
                <legend>Свойства обычной одежды</legend>
                {item.clothingProperties === undefined ? (
                  <button
                    type="button"
                    onClick={() =>
                      replace(index, {
                        ...item,
                        clothingProperties: {
                          coveredRegionIds: [],
                          hermetic: 'UNKNOWN',
                          flammability: 'UNKNOWN',
                        },
                      })
                    }
                  >
                    Задать свойства одежды
                  </button>
                ) : (
                  <>
                    <p>Покрытие одежды не добавляет защиту брони или герметичность Нэйта.</p>
                    {(
                      metadata['clothingRegions'] as readonly NonNullable<
                        EnemyItemInput['bodyZone']
                      >[]
                    ).map((region) => (
                      <label key={region}>
                        <input
                          type="checkbox"
                          checked={item.clothingProperties!.coveredRegionIds.includes(region)}
                          onChange={(e) => {
                            const coveredRegionIds = e.target.checked
                              ? [...item.clothingProperties!.coveredRegionIds, region]
                              : item.clothingProperties!.coveredRegionIds.filter(
                                  (value) => value !== region,
                                );
                            replace(index, {
                              ...item,
                              clothingProperties: { ...item.clothingProperties!, coveredRegionIds },
                              equippedSlots: item.equipped ? coveredRegionIds : [],
                            });
                          }}
                        />
                        Покрывает: {labels[region]}
                      </label>
                    ))}
                    <label>
                      Герметичность одежды
                      <select
                        value={String(item.clothingProperties.hermetic)}
                        onChange={(e) =>
                          replace(index, {
                            ...item,
                            clothingProperties: {
                              ...item.clothingProperties!,
                              hermetic:
                                e.target.value === 'UNKNOWN'
                                  ? 'UNKNOWN'
                                  : e.target.value === 'true',
                            },
                          })
                        }
                      >
                        {(metadata['clothingHermetic'] as readonly (boolean | string)[]).map(
                          (value) => (
                            <option key={String(value)} value={String(value)}>
                              {value === 'UNKNOWN'
                                ? 'Неизвестно'
                                : value === true
                                  ? 'Герметичная'
                                  : 'Негерметичная'}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Горючесть одежды
                      <select
                        value={item.clothingProperties.flammability}
                        onChange={(e) =>
                          replace(index, {
                            ...item,
                            clothingProperties: {
                              ...item.clothingProperties!,
                              flammability: e.target.value as
                                'COMBUSTIBLE' | 'NONCOMBUSTIBLE' | 'UNKNOWN',
                            },
                          })
                        }
                      >
                        {(metadata['clothingFlammability'] as readonly string[]).map((value) => (
                          <option key={value} value={value}>
                            {labels[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </fieldset>
            ) : null}
            <label>
              Основание выдачи
              <input
                value={item.issueReason}
                onChange={(e) => replace(index, { ...item, issueReason: e.target.value })}
              />
            </label>
            <label>
              Профиль
              <select
                value={item.profile.kind}
                onChange={(e) =>
                  replace(index, {
                    ...item,
                    profile:
                      e.target.value === 'CATALOG'
                        ? { kind: 'CATALOG' }
                        : {
                            kind: 'MASTER_WEAPON',
                            reason: '',
                            inputs: [
                              {
                                weaponVariantId: text(variants[0]?.['weaponVariant']) as 'DEFAULT',
                                damageDefinition: { kind: 'RETAIN' },
                                penetrationDefinition: { kind: 'RETAIN' },
                                statRequirements: {},
                                instanceDamageOrNull: null,
                                rangeMetersOrNull: null,
                                accuracyBonusOrNull: null,
                              },
                            ],
                          },
                  })
                }
              >
                <option
                  value="CATALOG"
                  disabled={
                    item.componentRole !== 'SHIELD' &&
                    variants.some((v) => v['profileKind'] === 'FORMULA')
                  }
                >
                  Из проверенного каталога
                </option>
                {definition['category'] === 'Оружие' &&
                variants.length !== 0 &&
                item.componentRole !== 'SHIELD' ? (
                  <option value="MASTER_WEAPON">Профиль мастера</option>
                ) : null}
              </select>
            </label>
            {item.componentRole !== 'SHIELD' &&
            variants.some((v) => v['profileKind'] === 'FORMULA') ? (
              <p>
                Исходный профиль требует явных значений. Выберите профиль мастера и подтвердите его
                поля.
              </p>
            ) : null}
            {variants.map((v) => (
              <p key={text(v['weaponVariant'])}>
                {text(v['variantLabel'])} · версия {text(v['canonicalProfileVersion'])}
              </p>
            ))}
            <MasterProfileFields
              item={item}
              variants={variants}
              onChange={(next) => replace(index, next)}
            />
            {definition['equippable'] === true ? (
              <label>
                <input
                  type="checkbox"
                  checked={item.equipped}
                  onChange={(e) =>
                    replace(index, {
                      ...item,
                      equipped: e.target.checked,
                      ...(!e.target.checked
                        ? { equippedSlots: [] }
                        : item.clothingProperties !== undefined
                          ? { equippedSlots: item.clothingProperties.coveredRegionIds }
                          : {}),
                    })
                  }
                />
                Экипирован
              </label>
            ) : (
              <p>Этот предмет каталога хранится в инвентаре и не экипируется.</p>
            )}
            {item.equipped && item.clothingProperties === undefined ? (
              <fieldset>
                <legend>Занятые места</legend>
                {slots.map((slot) => (
                  <label key={slot}>
                    <input
                      type="checkbox"
                      checked={item.equippedSlots.includes(slot)}
                      onChange={(e) =>
                        replace(index, {
                          ...item,
                          equippedSlots: e.target.checked
                            ? [...item.equippedSlots, slot]
                            : item.equippedSlots.filter((value) => value !== slot),
                        })
                      }
                    />
                    {labels[slot]}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {definition['armorOrNull'] !== null &&
            object(definition['armorOrNull'])['coverageModel'] === 'ZONE_ELEMENT' ? (
              <label>
                Зона брони
                <select
                  value={item.bodyZone ?? ''}
                  onChange={(e) =>
                    replace(index, {
                      ...item,
                      bodyZone: e.target.value as EnemyItemInput['bodyZone'],
                      equippedSlots: [],
                    })
                  }
                >
                  <option value="">Выберите зону</option>
                  {['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'].map((zone) => (
                    <option key={zone} value={zone}>
                      {labels[zone]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {definition['armorOrNull'] !== null &&
            object(definition['armorOrNull'])['sealedApplicable'] === true ? (
              <label>
                Герметизация
                <select
                  value={item.sealed === null ? '' : String(item.sealed)}
                  onChange={(e) =>
                    replace(index, {
                      ...item,
                      sealed: e.target.value === '' ? null : e.target.value === 'true',
                    })
                  }
                >
                  <option value="">Укажите состояние</option>
                  <option value="true">Герметизирован</option>
                  <option value="false">Не герметизирован</option>
                </select>
              </label>
            ) : null}
            {variants.some((v) => ['ONE_HAND', 'TWO_HAND'].includes(text(v['weaponVariant']))) ? (
              <label>
                Фиксированный хват
                <select
                  value={item.gripMode ?? ''}
                  onChange={(e) =>
                    replace(index, {
                      ...item,
                      gripMode: e.target.value as EnemyItemInput['gripMode'],
                    })
                  }
                >
                  <option value="">Выберите хват</option>
                  {variants.map((v) => (
                    <option key={text(v['weaponVariant'])} value={text(v['weaponVariant'])}>
                      {text(v['variantLabel'])}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Текущий боезапас, если применим
              <input
                type="number"
                min="0"
                step="1"
                value={item.currentAmmo ?? ''}
                onChange={(e) =>
                  replace(index, {
                    ...item,
                    currentAmmo: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Текущие HP щита, если применимы
              <input
                type="number"
                min="0"
                step="1"
                value={item.shieldCurrentHP ?? ''}
                onChange={(e) =>
                  replace(index, {
                    ...item,
                    shieldCurrentHP: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={item.broken}
                onChange={(e) => replace(index, { ...item, broken: e.target.checked })}
              />
              Повреждён
            </label>
            <button
              type="button"
              onClick={() =>
                onChange(
                  value.filter((other, i) =>
                    item.linkedSetInstanceId === null
                      ? i !== index
                      : other.linkedSetInstanceId !== item.linkedSetInstanceId,
                  ),
                )
              }
            >
              Убрать предмет
            </button>
          </fieldset>
        );
      })}
    </section>
  );
}
interface SentientIdentityDraft {
  name: string;
  description: string;
  origin: string;
  affiliation: string;
  massKg: string;
}
function SentientIdentityFields({
  value,
  onChange,
}: {
  value: SentientIdentityDraft;
  onChange: (value: SentientIdentityDraft) => void;
}) {
  // HTML maxlength counts UTF-16 units; the owning identity limit counts Unicode code points.
  return (
    <fieldset>
      <legend>Идентичность</legend>
      {(['name', 'description', 'origin', 'affiliation', 'massKg'] as const).map((key, index) => (
        <label key={key}>
          {['Имя врага', 'Описание врага', 'Происхождение', 'Принадлежность', 'Масса, кг'][index]}
          <input
            type={key === 'massKg' ? 'number' : 'text'}
            min={key === 'massKg' ? 30 : undefined}
            max={key === 'massKg' ? 500 : undefined}
            step={key === 'massKg' ? 0.1 : undefined}
            maxLength={key === 'description' ? 2 * 2000 : undefined}
            value={value[key]}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          />
        </label>
      ))}
      <p>Обычная анатомия мыслящего. Масса 30–500 кг, шаг 0,1 кг. Описание — до 2000 символов.</p>
    </fieldset>
  );
}
function sentientIdentityDraft(
  value: {
    name: string;
    description: string | null;
    origin: string;
    affiliation: string;
    massKg: number | null;
  } | null,
): SentientIdentityDraft {
  return {
    name: value?.name ?? '',
    description: value?.description ?? '',
    origin: value?.origin ?? '',
    affiliation: value?.affiliation ?? '',
    massKg: value?.massKg == null ? '' : String(value.massKg),
  };
}
function sentientIdentityData(value: SentientIdentityDraft): JsonObject | null {
  return value.name.trim() === '' || [...value.description].length > 2000
    ? null
    : {
        ...value,
        description: value.description === '' ? null : value.description,
        massKg: value.massKg === '' ? null : Number(value.massKg),
        anatomyProfileId: 'ORDINARY_SENTIENT',
      };
}

const versionFieldLabels: Readonly<Record<string, string>> = {
  composition: 'Состав симбионтов',
  ordinarySymbiontInstances: 'Обыкновенные симбионты',
  symbioticMonsterInstances: 'Симбиотические монстры',
  skills: 'Навыки',
  items: 'Предметы',
  instances: 'Экземпляры симбионтов',
  speciesKey: 'Вид',
  targetLevel: 'Уровень',
  learnedNodeRefs: 'Изученные узлы дерева',
  side: 'Сторона',
  slotOrder: 'Порядок слота',
  quantity: 'Количество',
  itemTypeId: 'Предмет',
  equipped: 'Надет или взят в руки',
  equippedSlots: 'Занятые места',
  ordinary: 'Обыкновенный симбионт',
  selection: 'Выбранный состав',
  advisorSkills: 'Собственные навыки Советника',
  dolphinSkills: 'Навыки «Мирного воина»',
  status: 'Состояние',
  total: 'Всего',
  capacity: 'Ёмкость',
  used: 'Занято',
  remaining: 'Осталось',
  source: 'Источник навыка',
  profile: 'Профиль предмета',
  kind: 'Тип',
  identityOrNull: 'Идентичность',
  name: 'Имя',
  description: 'Описание',
  origin: 'Происхождение',
  affiliation: 'Принадлежность',
  massKg: 'Масса',
  baseStatsOrNull: 'Базовые характеристики',
  buildOrNull: 'Раса, класс и начальные навыки',
  raceCode: 'Раса',
  pureClassOrNull: 'Класс',
  skillSelections: 'Начальный выбор навыков',
  skillPlanState: 'Навыки и фактическая оплата',
  planOrNull: 'Начальный выбор и учёт навыков',
  accountingOrNull: 'Текущие навыки, оплата и потери',
  initialSkills: 'Начальные навыки',
  knownSkills: 'Сохранённые навыки',
  permanentLosses: 'Постоянные потери',
  startSlots: 'Оплата START',
  dolphinSlots: 'Оплата «Мирный воин»',
  bonus: 'Бонус',
  targetBonus: 'Выбранный бонус',
  skillKey: 'Навык',
  compositionOrNull: 'Состав симбионтов',
  compositionAcquisitions: 'Сохранённые приобретения',
  inventoryOrNull: 'Имущество',
  inventoryItems: 'Предметы',
  statsOrNull: 'Характеристики монстра',
  physicsOrNull: 'Тело монстра',
  attackOrNull: 'Атака монстра',
  advisorCards: 'Карты Советника',
  advisorKnowledge: 'Текущие навыки Советника',
  baseStats: 'Прямые характеристики',
  baseMaxHP: 'Базовое максимальное HP',
  ageYears: 'Возраст',
};
function versionDiffLabel(path: string): string {
  return path === ''
    ? 'Полная конфигурация'
    : path
        .split('/')
        .slice(1)
        .map((key) => {
          const decoded = key.replace(/~1/gu, '/').replace(/~0/gu, '~');
          return (
            versionFieldLabels[decoded] ??
            (/^\d+$/u.test(decoded) ? `Элемент ${String(Number(decoded) + 1)}` : decoded)
          );
        })
        .join(' / ');
}
const versionDiffArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);
function VersionDiffValue({
  side,
  names,
}: {
  side: EnemyVersionDiffEntry['before'];
  names: ReadonlyMap<string, string>;
}) {
  const show = (value: JsonValue, path = ''): ReactNode => {
    if (value === null) return 'Не задано';
    if (typeof value !== 'object')
      return typeof value === 'boolean'
        ? value
          ? 'Да'
          : 'Нет'
        : (names.get(String(value)) ?? labels[String(value)] ?? String(value));
    if (versionDiffArray(value))
      return value.length === 0 ? (
        'Нет'
      ) : (
        <ul>
          {value.map((entry, index) => (
            <li key={index}>{show(entry, path + '/' + index)}</li>
          ))}
        </ul>
      );
    const visible = Object.entries(value).filter(
      ([key]) =>
        key === 'itemTypeId' ||
        key === 'anatomyProfileId' ||
        !/(?:Id|Ids|Revision|revision|schemaVersion|CommandId|ReceiptId)$/u.test(key),
    );
    return (
      <>
        {visible.length === 0 ? (
          'Только технические привязки; полные данные ниже.'
        ) : (
          <dl>
            {visible.map(([key, entry]) => (
              <div key={key}>
                <dt>{versionDiffLabel('/' + key)}</dt>
                <dd>{show(entry, path + '/' + key)}</dd>
              </div>
            ))}
          </dl>
        )}
      </>
    );
  };
  if (!side.present) return <>Отсутствует</>;
  return (
    <>
      {show(side.value)}
      {typeof side.value !== 'object' || side.value === null ? null : (
        <details>
          <summary>Полные данные и технические привязки</summary>
          <pre>{JSON.stringify(side.value, null, 2)}</pre>
        </details>
      )}
    </>
  );
}
export function VersionChanges({
  changes,
  catalog,
}: {
  changes: readonly EnemyVersionDiffEntry[];
  catalog: JsonObject;
}) {
  const names = new Map<string, string>();
  const collectNames = (value: JsonValue): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collectNames);
      return;
    }
    const entries = Object.entries(value);
    const nodeRef = entries.find(([key]) => key === 'nodeRef')?.[1];
    const nodeLabel = entries.find(([key]) => key === 'label')?.[1];
    if (typeof nodeRef === 'string' && typeof nodeLabel === 'string') names.set(nodeRef, nodeLabel);
    const name = entries.find(([key]) => key === 'name')?.[1];
    if (typeof name === 'string')
      for (const key of [
        'skillKey',
        'speciesKey',
        'itemTypeId',
        'nodeRef',
        'raceCode',
        'classCode',
      ]) {
        const identity = entries.find(([field]) => field === key)?.[1];
        if (typeof identity === 'string') names.set(identity, name);
      }
    Object.values(value).forEach(collectNames);
  };
  collectNames(catalog);
  const ordinary = changes.filter(
    (change) =>
      !change.path
        .split('/')
        .some(
          (key) =>
            key !== 'itemTypeId' &&
            key !== 'anatomyProfileId' &&
            /(?:Id|Ids|Revision|revision|schemaVersion)$/u.test(key),
        ),
  );
  const technical = changes.filter((change) => !ordinary.includes(change));
  return (
    <section aria-label="Различия полной версии">
      {changes.length === 0 ? (
        <p>
          Полевых изменений нет. Сохраняется полная копия без замены конфигурации и сброса навыков.
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Что изменено</th>
                <th>Было</th>
                <th>Станет</th>
              </tr>
            </thead>
            <tbody>
              {ordinary.map((change) => (
                <tr key={change.path}>
                  <th>{versionDiffLabel(change.path)}</th>
                  <td>
                    <VersionDiffValue side={change.before} names={names} />
                  </td>
                  <td>
                    <VersionDiffValue side={change.after} names={names} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {technical.length === 0 ? null : (
            <details>
              <summary>Дополнительные технические привязки</summary>
              <pre>{JSON.stringify(technical, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
interface VersionSkillDraft {
  skillKey: string;
  bonus: string;
}
interface VersionConfigurationDraft {
  stats: Readonly<Record<string, string>>;
  race: string;
  pureClass: string;
  skills: readonly VersionSkillDraft[];
  advisor: readonly VersionSkillDraft[];
}
function currentVersionInput(p: EnemyAuthoringProjection): EnemyVersionConfigurationInput {
  const attempt = p.context.attemptOrNull;
  if (attempt === null) throw new Error('Нет редактируемой полной версии.');
  const state = p.context.versionAttempt;
  if (state?.ownChoicesPending === true && state.configurationConfirmation !== undefined)
    return state.configurationConfirmation.input;
  if (attempt.kind === 'CUSTOM_MONSTER')
    return { kind: attempt.kind, advisorSkills: attempt.advisorCards[0]?.knownSkills ?? [] };
  if (attempt.baseStatsOrNull === null || attempt.buildOrNull === null)
    throw new Error('Нет полного начального выбора.');
  return {
    kind: attempt.kind,
    initialInput: { baseStats: attempt.baseStatsOrNull, build: attempt.buildOrNull },
    advisorSkills:
      attempt.skillPlanState?.advisorKnowledge[0]?.knownSkills.map((skill) => ({
        skillKey: skill.skillKey,
        targetBonus: skill.bonus,
      })) ?? [],
  };
}
function configurationDraft(input: EnemyVersionConfigurationInput): VersionConfigurationDraft {
  return {
    stats:
      input.kind === 'SENTIENT'
        ? Object.fromEntries(
            ENEMY_STATS.map((key) => [key, String(input.initialInput.baseStats[key])]),
          )
        : {},
    race: input.kind === 'SENTIENT' ? input.initialInput.build.raceCode : '',
    pureClass: input.kind === 'SENTIENT' ? (input.initialInput.build.pureClassOrNull ?? '') : '',
    skills:
      input.kind === 'SENTIENT'
        ? input.initialInput.build.skillSelections.map((skill) => ({
            skillKey: skill.skillKey,
            bonus: String(skill.targetBonus),
          }))
        : [],
    advisor: input.advisorSkills.map((skill) => ({
      skillKey: skill.skillKey,
      bonus: String(skill.targetBonus),
    })),
  };
}
function VersionSkillFields({
  requirementKind,
  title,
  choices,
  value,
  onChange,
}: {
  requirementKind: 'SENTIENT' | 'CUSTOM_MONSTER';
  title: string;
  choices: readonly JsonObject[];
  value: readonly VersionSkillDraft[];
  onChange: (value: readonly VersionSkillDraft[]) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      {choices.map((choice) => {
        const key = text(choice['skillKey']),
          selected = value.find((row) => row.skillKey === key);
        let cost: number | null = null;
        if (selected !== undefined) {
          try {
            cost = calculateSkillSlotCost(Number(selected.bonus));
          } catch {
            /* Invalid local bonus remains unavailable to submit. */
          }
        }
        return (
          <fieldset key={key}>
            <legend>{text(choice['name'])}</legend>
            <p>
              Требования:{' '}
              {requirementKind === 'SENTIENT'
                ? skillRequirementText(list(choice['requirements']))
                : list(choice['requirements'])
                    .map((row) => text(row['statCode']) + ' ≥ ' + text(row['minValue']))
                    .join(' и ') || 'Нет'}
              . Предел бонуса:{' '}
              {typeof choice['maxBonus'] === 'number' ? choice['maxBonus'] : 'не задан правилом'}.
            </p>
            <label>
              Бонус{' '}
              <input
                aria-label={`${title}: ${text(choice['name'])}`}
                type="number"
                min="1"
                step="1"
                max={typeof choice['maxBonus'] === 'number' ? choice['maxBonus'] : undefined}
                value={selected?.bonus ?? ''}
                onChange={(event) => {
                  const next = event.target.value;
                  onChange(
                    next === ''
                      ? value.filter((row) => row.skillKey !== key)
                      : selected === undefined
                        ? [...value, { skillKey: key, bonus: next }]
                        : value.map((row) =>
                            row.skillKey === key ? { skillKey: key, bonus: next } : row,
                          ),
                  );
                }}
              />
            </label>
            {selected === undefined ? null : (
              <p>
                Стоимость выбранного бонуса:{' '}
                {cost === null ? 'проверьте целый положительный бонус' : cost}.
              </p>
            )}
          </fieldset>
        );
      })}
    </fieldset>
  );
}

function VersionSentientFields({
  p,
  stage,
  onValue,
  onPrepare,
}: {
  p: Extract<EnemyAuthoringProjection, { kind: 'SENTIENT_ENEMY_AUTHORING' }>;
  stage: EnemyPatchStage;
  onValue: (value: JsonObject | null) => void;
  onPrepare: (value: JsonObject) => { ok: boolean; detail?: string };
}) {
  const attempt = p.context.attemptOrNull;
  const [identity, setIdentity] = useState(() =>
    sentientIdentityDraft(attempt?.identityOrNull ?? null),
  );
  const [items, setItems] = useState(attempt?.inventoryOrNull?.inventoryItems ?? []);
  const [compatibility, setCompatibility] = useState(
    attempt?.inventoryOrNull?.armorCompatibilityReasonOrNull ?? '',
  );
  useEffect(() => {
    if (stage === 'SENTIENT_IDENTITY') onValue(sentientIdentityData(identity));
    else if (stage === 'SENTIENT_INVENTORY')
      onValue(
        structuredClone(
          w.jsonObject(
            {
              inventoryItems: items,
              armorCompatibilityReasonOrNull: compatibility === '' ? null : compatibility,
            },
            '$.versionInventory',
          ),
        ),
      );
  }, [stage, identity, items, compatibility, onValue]);
  return stage === 'SENTIENT_IDENTITY' ? (
    <SentientIdentityFields value={identity} onChange={setIdentity} />
  ) : stage === 'SENTIENT_SYMBIONTS' ? (
    <EnemyCompositionFields
      projection={p}
      onValue={onValue}
      onPrepare={onPrepare}
      requirementText={skillRequirementText}
    />
  ) : stage === 'SENTIENT_INVENTORY' ? (
    <>
      <InventoryFields catalog={p.catalog} value={items} onChange={setItems} />
      <label>
        Основание совместимости доспехов{' '}
        <input value={compatibility} onChange={(event) => setCompatibility(event.target.value)} />
      </label>
      <p>
        Окончательные постоянные требования проверяются по этому полному телу и фактически выбранной
        экипировке.
      </p>
    </>
  ) : null;
}

function EnemyVersionContent({
  projection: p,
  onValue,
  onStage,
}: {
  projection: EnemyAuthoringProjection;
  onValue: (value: JsonObject | null) => void;
  onStage:
    ((stage: EnemyPatchStage, value: JsonObject) => { ok: boolean; detail?: string }) | undefined;
}) {
  const attempt = p.context.attemptOrNull,
    state = p.context.versionAttempt,
    editor = p.versionEditor;
  if (attempt === null || state === undefined || editor === undefined)
    throw new Error('Нет подтверждённой основы новой версии.');
  const currentInput = useMemo(() => currentVersionInput(p), [p]);
  // A host PREVIEW remount must restore exactly the displayed replacement, never the unchanged base.
  const [draft, setDraft] = useState(() =>
    configurationDraft(state.replacementPreviewOrNull?.input ?? currentInput),
  );
  const [reason, setReason] = useState(state.reason);
  const [discardForReason, setDiscardForReason] = useState(false);
  const [consented, setConsented] = useState(false);
  const [section, setSection] = useState<EnemyPatchStage | 'SUMMARY'>('SUMMARY');
  const [sectionData, setSectionData] = useState<JsonObject | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useMemo(() => {
    try {
      const advisorSkills = draft.advisor.map((skill) => ({
        skillKey: skill.skillKey,
        targetBonus: Number(skill.bonus),
      }));
      return enemyVersionConfigurationInputValue(
        attempt.kind === 'CUSTOM_MONSTER'
          ? { kind: attempt.kind, advisorSkills }
          : {
              kind: attempt.kind,
              advisorSkills,
              initialInput: {
                baseStats: Object.fromEntries(
                  ENEMY_STATS.map((key) => [
                    key,
                    draft.stats[key]?.trim() === '' ? null : Number(draft.stats[key]),
                  ]),
                ),
                build: {
                  raceCode: draft.race,
                  pureClassOrNull: draft.race === 'PURE' ? draft.pureClass : null,
                  skillSelections: draft.skills.map((skill) => ({
                    skillKey: skill.skillKey,
                    targetBonus: Number(skill.bonus),
                  })),
                },
              },
            },
      );
    } catch {
      return null;
    } // Incomplete local text is not a submitted configuration.
  }, [attempt.kind, draft]);
  const reasonDirty = reason !== state.reason;
  const configDirty = input === null || !admissionJsonEqual(input, currentInput);
  const reasonWouldDiscard = configDirty || state.replacementPreviewOrNull !== null;
  const shownPreview =
    state.replacementPreviewOrNull !== null &&
    input !== null &&
    !reasonDirty &&
    admissionJsonEqual(input, state.replacementPreviewOrNull.input)
      ? state.replacementPreviewOrNull
      : null;
  const data = (value: unknown): JsonObject =>
    structuredClone(w.jsonObject(value, '$.versionInput'));
  const send = useCallback(
    (stage: EnemyPatchStage, value: JsonObject) => {
      const result = onStage?.(stage, value) ?? {
        ok: false,
        detail: 'Редактирование сейчас недоступно.',
      };
      setNotice(
        result.ok
          ? 'Команда отправлена; дождитесь подтверждения хоста.'
          : (result.detail ?? 'Изменение не отправлено.'),
      );
      return result;
    },
    [onStage],
  );
  const acceptSection = useCallback(
    (value: JsonObject | null) =>
      setSectionData((old) => (admissionJsonEqual(old, value) ? old : value)),
    [],
  );
  useEffect(() => {
    onValue(
      section === 'SUMMARY' &&
        !reasonDirty &&
        !configDirty &&
        state.replacementPreviewOrNull === null &&
        p.validationErrors.length === 0
        ? { reason: state.reason }
        : null,
    );
  }, [
    section,
    reasonDirty,
    configDirty,
    state.replacementPreviewOrNull,
    state.reason,
    p.validationErrors.length,
    onValue,
  ]);
  const changeDraft = (patch: Partial<VersionConfigurationDraft>) => {
    onValue(null);
    setConsented(false);
    setDiscardForReason(false);
    setDraft((old) => ({ ...old, ...patch }));
  };
  const allSkills =
    p.kind === 'SENTIENT_ENEMY_AUTHORING'
      ? list(p.catalog['skills'])
      : list(p.catalog['advisorSkills']);
  const choices =
    p.kind === 'SENTIENT_ENEMY_AUTHORING'
      ? allSkills.filter((row) => row['category'] === 'SELECTABLE_GENERAL')
      : allSkills;
  const skillName = (key: string) =>
    text(allSkills.find((row) => row['skillKey'] === key)?.['name']);
  const stages: readonly (readonly [EnemyPatchStage, string])[] =
    attempt.kind === 'SENTIENT'
      ? [
          ['SENTIENT_IDENTITY', 'Идентичность'],
          ['SENTIENT_SYMBIONTS', 'Состав симбионтов'],
          ['SENTIENT_INVENTORY', 'Имущество и экипировка'],
        ]
      : [
          ['MONSTER_IDENTITY', 'Идентичность'],
          ['MONSTER_STATS', 'Ручные характеристики'],
          ['MONSTER_PHYSICS', 'Тело и естественная броня'],
          ['MONSTER_ATTACK', 'Атака'],
          ['MONSTER_SYMBIONT', 'Обыкновенный симбионт'],
        ];
  const before = shownPreview?.before ?? attempt;
  const beforeAccounting =
    before.kind === 'SENTIENT' ? before.skillPlanState?.planOrNull?.accountingOrNull : null;
  const beforeSkills =
    before.kind === 'SENTIENT'
      ? (beforeAccounting?.knownSkills ?? before.skillPlanState?.planOrNull?.initialSkills ?? [])
      : [];
  const summary = shownPreview?.inputSummary ?? null;
  return (
    <section aria-label="Новая полная версия шаблона" data-enemy-authoring="ENM-017">
      <h2>Новая полная версия {state.origin.base.version + 1}</h2>
      <p>
        Тип: {attempt.kind === 'SENTIENT' ? 'мыслящий враг' : 'произвольный монстр'}. Основа —
        версия {state.origin.base.version}; текущая версия — {editor.currentVersion.version}.
        Прежние версии и их ссылки неизменяемы.
      </p>
      <img
        alt="Закреплённый портрет шаблона"
        src={`data:image/png;base64,${p.art.bytesBase64}`}
        width={180}
      />
      <p>
        Портрет наследуется. Его загрузка и очистка пока недоступны. Боевые экземпляры здесь не
        создаются.
      </p>
      {p.validationErrors.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
      <label>
        Причина новой версии{' '}
        <textarea
          aria-label="Причина новой версии"
          value={reason}
          onChange={(event) => {
            onValue(null);
            setConsented(false);
            setDiscardForReason(false);
            setReason(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        disabled={
          onStage === undefined ||
          section !== 'SUMMARY' ||
          !reasonDirty ||
          (reasonWouldDiscard && !discardForReason)
        }
        onClick={() => send('VERSION_CONFIGURATION', { operation: 'SET_REASON', reason })}
      >
        {reasonWouldDiscard ? 'Сохранить причину и отбросить новый выбор' : 'Сохранить причину'}
      </button>
      {reasonDirty ? (
        <>
          <button
            type="button"
            onClick={() => {
              setReason(state.reason);
              setConsented(false);
              setDiscardForReason(false);
            }}
          >
            Вернуть сохранённую причину и сохранить новый выбор
          </button>
          {!reasonWouldDiscard ? null : (
            <label>
              <input
                type="checkbox"
                aria-label="Подтверждаю отбрасывание нового выбора при сохранении причины"
                checked={discardForReason}
                onChange={(event) => {
                  setDiscardForReason(event.target.checked);
                  setConsented(false);
                }}
              />
              Сохранение причины отбросит неподтверждённый новый выбор и его предварительный расчёт.
              Чтобы сохранить выбор, верните прежнюю причину, подтвердите выбор, затем измените
              причину.
            </label>
          )}
        </>
      ) : null}
      <VersionChanges changes={editor.changeSet} catalog={p.catalog} />
      <section aria-label="Явная замена конфигурации новой версии">
        <h3>Явная замена конфигурации</h3>
        <p>
          Простое копирование, просмотр и обычное сохранение не сбрасывают навыки, оплату или
          потери. Даже при том же начальном вводе замена ниже выполняется только после отдельного
          точного подтверждения.
        </p>
        <fieldset disabled={onStage === undefined || section !== 'SUMMARY'}>
          <legend>Полный новый выбор</legend>
          {attempt.kind === 'SENTIENT' ? (
            <>
              <fieldset>
                <legend>Семь прямых базовых характеристик новой конфигурации</legend>
                {ENEMY_STATS.map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      aria-label={`Новая базовая ${key}`}
                      type="number"
                      min="1"
                      max="35"
                      step="1"
                      value={draft.stats[key] ?? ''}
                      onChange={(event) =>
                        changeDraft({ stats: { ...draft.stats, [key]: event.target.value } })
                      }
                    />
                  </label>
                ))}
              </fieldset>
              <label>
                Раса новой конфигурации{' '}
                <select
                  aria-label="Раса новой конфигурации"
                  value={draft.race}
                  onChange={(event) =>
                    changeDraft({ race: event.target.value, pureClass: '', skills: [] })
                  }
                >
                  {list(p.catalog['races']).map((race) => (
                    <option key={text(race['raceCode'])} value={text(race['raceCode'])}>
                      {text(race['name'])}
                    </option>
                  ))}
                </select>
              </label>
              {draft.race !== 'PURE' ? null : (
                <label>
                  Класс новой конфигурации{' '}
                  <select
                    aria-label="Класс новой конфигурации"
                    value={draft.pureClass}
                    onChange={(event) => changeDraft({ pureClass: event.target.value })}
                  >
                    <option value="">Выберите класс</option>
                    {list(p.catalog['classes']).map((row) => (
                      <option key={text(row['classCode'])} value={text(row['classCode'])}>
                        {text(row['name'])}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <VersionSkillFields
                requirementKind={attempt.kind}
                title="Новый начальный навык"
                choices={choices}
                value={draft.skills}
                onChange={(skills) => changeDraft({ skills })}
              />
              <p>
                Новый начальный выбор оплачивается полностью. Хост проверит точное заполнение до
                состава; финальные характеристики и постоянные потери разрешаются после полного тела
                и экипировки. Итоговые значения выше 35 допустимы, ниже 1 — нет.
              </p>
            </>
          ) : (
            <p>
              У монстра нет расы, класса, START, навыков владельца или имущества. Ручное тело
              редактируется отдельными полями ниже.
            </p>
          )}
          <VersionSkillFields
            requirementKind={attempt.kind}
            title="Новый собственный навык Советника"
            choices={choices}
            value={draft.advisor}
            onChange={(advisor) => changeDraft({ advisor })}
          />
          <p>
            Это новый текущий набор той же карты. Окончательная вместимость и требования проверяются
            по собственной I/W и подтверждённому телу. Неактивную карту не требуется заполнять ради
            выбора состава без Советника.
          </p>
          <button
            type="button"
            disabled={input === null || reasonDirty}
            onClick={() => {
              setConsented(false);
              if (input !== null)
                send('VERSION_CONFIGURATION', data({ operation: 'PREVIEW_REPLACEMENT', input }));
            }}
          >
            Рассчитать последствия замены конфигурации
          </button>
          <button
            type="button"
            onClick={() => {
              onValue(null);
              setConsented(false);
              setDraft(configurationDraft(currentInput));
            }}
          >
            Вернуть ввод к текущей копии
          </button>
        </fieldset>
        {state.replacementPreviewOrNull === null ? null : (
          <button
            type="button"
            disabled={onStage === undefined}
            onClick={() => {
              setConsented(false);
              send('VERSION_CONFIGURATION', {
                operation: 'DISCARD_REPLACEMENT',
                previewCommandId: state.replacementPreviewOrNull!.previewCommandId,
              });
            }}
          >
            Отменить показанную замену конфигурации
          </button>
        )}
        {shownPreview === null ? null : (
          <section aria-label="Подтверждённые последствия замены конфигурации">
            <h4>Подтверждённые хостом последствия</h4>
            <p>
              Состав станет неподтверждённым
              {shownPreview.invalidateInventory
                ? ', имущество и экипировка потребуют нового подтверждения'
                : ''}
              . Текущие собственные навыки Советника станут неактивными; исходные броски и первое
              реальное заполнение сохраняются.
            </p>
            {before.kind !== 'SENTIENT' ? null : (
              <>
                <h5>Прежние навыки и фактическая оплата, которые не переносятся в новый выбор</h5>
                <ul>
                  {beforeSkills.map((skill) => (
                    <li key={skill.skillKey}>
                      {skillName(skill.skillKey)}: бонус {skill.bonus}; START {skill.startSlots};
                      «Мирный воин» {skill.dolphinSlots}.
                    </li>
                  ))}
                </ul>
                {before.skillPlanState?.planOrNull != null ? null : (
                  <>
                    <ul>
                      {before.buildOrNull?.skillSelections.map((skill) => (
                        <li key={skill.skillKey}>
                          {skillName(skill.skillKey)}: бонус {skill.targetBonus}.
                        </li>
                      ))}
                    </ul>
                    <p>
                      Историческое распределение оплаты этих навыков отсутствует; фактические доли
                      START и «Мирный воин» не назначаются задним числом.
                    </p>
                  </>
                )}
                <h5>Прежние постоянные потери</h5>
                <ul>
                  {beforeAccounting?.permanentLosses.map((loss) => (
                    <li key={loss.skillKey}>
                      {skillName(loss.skillKey)}: прежний бонус {loss.bonusBefore}; освобождено
                      START {loss.releasedStartSlots}, «Мирный воин» {loss.releasedDolphinSlots}.
                    </li>
                  ))}
                </ul>
                {before.skillPlanState?.advisorKnowledge.map((card) => (
                  <section key={card.cardId}>
                    <h5>Прежние текущие навыки собственной карты</h5>
                    <ul>
                      {card.knownSkills.map((skill) => (
                        <li key={skill.skillKey}>
                          {skillName(skill.skillKey)}: бонус {skill.bonus}; оплачено собственных
                          слотов {skill.startSlots}.
                        </li>
                      ))}
                    </ul>
                    <p>
                      Постоянные потери:{' '}
                      {card.permanentLosses.map((loss) => skillName(loss.skillKey)).join(', ') ||
                        'нет'}
                      .
                    </p>
                  </section>
                ))}
              </>
            )}
            {before.kind !== 'CUSTOM_MONSTER'
              ? null
              : before.advisorCards.map((card) => (
                  <section key={card.cardId}>
                    <h5>Прежние текущие навыки собственной карты</h5>
                    <ul>
                      {card.knownSkills.map((skill) => (
                        <li key={skill.skillKey}>
                          {skillName(skill.skillKey)}: бонус {skill.targetBonus}; стоимость{' '}
                          {calculateSkillSlotCost(skill.targetBonus)}.
                        </li>
                      ))}
                    </ul>
                    <p>
                      Постоянные потери:{' '}
                      {card.permanentLosses.map((loss) => skillName(loss.skillKey)).join(', ') ||
                        'нет'}
                      .
                    </p>
                  </section>
                ))}
            {summary === null ? null : (
              <>
                {summary.kind !== 'SENTIENT' ? null : (
                  <section aria-label="Новый проверенный начальный выбор">
                    <p>Характеристики до состава: {statText(summary.statsBeforeComposition)}.</p>
                    <p>Начальная ёмкость START: {summary.startCapacity}.</p>
                    <ul>
                      {summary.initialSkills.map((skill) => (
                        <li key={skill.skillKey}>
                          {skill.name}: бонус {skill.bonus}, оплачено START {skill.slotCost}
                          {skill.source === 'SELECTED' ? '' : ', обязательный источник'}.
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <h5>Запрошенные новые собственные навыки Советника</h5>
                <ul>
                  {summary.advisorOwnChoices.map((skill) => (
                    <li key={skill.skillKey}>
                      {skill.name}: бонус {skill.targetBonus}, стоимость собственных слотов{' '}
                      {skill.slotCost}.
                    </li>
                  ))}
                </ul>
              </>
            )}
            <label>
              <input
                aria-label="Подтверждаю точную замену конфигурации"
                type="checkbox"
                checked={consented}
                onChange={(event) => setConsented(event.target.checked)}
              />
              Подтверждаю именно показанный полный ввод, оплату и последствия
            </label>
            <button
              type="button"
              disabled={!consented || onStage === undefined || section !== 'SUMMARY'}
              onClick={() => {
                if (input !== null)
                  send(
                    'VERSION_CONFIGURATION',
                    data({
                      operation: 'CONFIRM_REPLACEMENT',
                      previewCommandId: shownPreview.previewCommandId,
                      input,
                      displayedPreview: shownPreview,
                      consent: true,
                    }),
                  );
              }}
            >
              Подтвердить замену конфигурации
            </button>
          </section>
        )}
      </section>
      <section aria-label="Сохранённые обязательные факты">
        <h3>Приобретения, которые сохраняются без повторного броска</h3>
        {state.retainedMandatoryFacts.kind !== 'SENTIENT' ||
        state.retainedMandatoryFacts.freeSlotOrNull === null ? null : (
          <p>
            Фиксированное последствие R6:{' '}
            {statText(state.retainedMandatoryFacts.freeSlotOrNull.permanentStatConsequence)}. Оно не
            пересчитывается на новой базе.
          </p>
        )}
        {state.retainedMandatoryFacts.advisorCards.map((card) => (
          <section key={card.cardId}>
            <p>
              Сохранена та же карта Советника. Исходные R20 собственной I/W:{' '}
              {card.iwRolls.map((roll) => roll.mechanical.rawFace).join(' / ')}. Первое реальное
              заполнение: {card.initialFillOrNull === null ? 'ещё не было' : 'сохранено'}.
            </p>
            {'suppressionRollOrNull' in card && card.suppressionRollOrNull !== null ? (
              <p>
                Исторический R20 подавления: {card.suppressionRollOrNull.mechanical.rawFace};
                применяется только при соответствующем текущем составе.
              </p>
            ) : null}
          </section>
        ))}
        <button type="button" disabled>
          Заменить карту Советника
        </button>
        <p>
          Замена самой карты недоступна. Можно повторно выбрать того же Советника и явно заменить
          текущие собственные навыки.
        </p>
      </section>
      <fieldset
        disabled={
          onStage === undefined ||
          state.replacementPreviewOrNull !== null ||
          configDirty ||
          reasonDirty
        }
      >
        <legend>Обычные правки текущей копии</legend>
        {stages.map(([stage, label]) => (
          <button
            key={stage}
            type="button"
            onClick={() => {
              onValue(null);
              setConsented(false);
              setSectionData(null);
              setSection(stage);
            }}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {section === 'SUMMARY' ? null : (
        <section aria-label="Редактирование поля новой версии">
          <h3>{stages.find(([stage]) => stage === section)?.[1]}</h3>
          {p.kind === 'SENTIENT_ENEMY_AUTHORING' ? (
            <VersionSentientFields
              key={section}
              p={p}
              stage={section}
              onValue={acceptSection}
              onPrepare={(value) => send(section, value)}
            />
          ) : attempt.kind !== 'CUSTOM_MONSTER' ? null : section === 'MONSTER_IDENTITY' ? (
            <MonsterIdentityFields key={section} attempt={attempt} onValue={acceptSection} />
          ) : section === 'MONSTER_STATS' ? (
            <MonsterStatsFields key={section} attempt={attempt} onValue={acceptSection} />
          ) : section === 'MONSTER_PHYSICS' ? (
            <MonsterPhysicsFields key={section} attempt={attempt} onValue={acceptSection} />
          ) : section === 'MONSTER_ATTACK' ? (
            <MonsterAttackFields key={section} attempt={attempt} onValue={acceptSection} />
          ) : section === 'MONSTER_SYMBIONT' ? (
            <MonsterSymbiontFields
              key={section}
              p={p}
              attempt={attempt}
              onValue={acceptSection}
              onPrepare={(value) => send(section, value)}
            />
          ) : null}
          <button
            type="button"
            disabled={sectionData === null || onStage === undefined}
            onClick={() => {
              if (sectionData !== null) send(section, sectionData);
            }}
          >
            Применить поле к текущей копии
          </button>
          <button
            type="button"
            onClick={() => {
              setSectionData(null);
              setSection('SUMMARY');
            }}
          >
            Отменить несохранённый ввод поля и показать итог
          </button>
        </section>
      )}
      {attempt.kind !== 'CUSTOM_MONSTER' ? null : (
        <>
          <button type="button" disabled>
            Однократная генерация характеристик
          </button>
          <p>Однократная генерация пока недоступна; в ручном режиме бросков характеристик нет.</p>
        </>
      )}
      {notice === null ? null : <p role="status">{notice}</p>}
      {p.kind === 'SENTIENT_ENEMY_AUTHORING' ? (
        p.sheetOrNull === null ? null : (
          <EnemySheetContent sheet={p.sheetOrNull} catalog={p.catalog} />
        )
      ) : p.sheetOrNull === null ? null : (
        <MonsterSheetContent sheet={p.sheetOrNull} />
      )}
    </section>
  );
}

export function EnemyAuthoringContent(props: {
  readonly projection: JsonObject;
  readonly onValue: (data: JsonObject | null) => void;
  readonly onPrepare: (data: JsonObject) => { readonly ok: boolean; readonly detail?: string };
  readonly onSelectVersion?: (identity: EnemyVersionIdentity) => void;
  readonly onStage?: (
    stage: EnemyPatchStage,
    data: JsonObject,
  ) => { readonly ok: boolean; readonly detail?: string };
}) {
  const p = anyEnemyAuthoringProjectionValue(props.projection);
  if (p.formId === 'ENM-017')
    return <EnemyVersionContent projection={p} onValue={props.onValue} onStage={props.onStage} />;
  return (
    <>
      {p.versionHistory === undefined ? null : (
        <section aria-label="История версий шаблона">
          <p>
            Текущая версия: {p.versionHistory.current.version}. Просматривается:{' '}
            {p.versionHistory.selected.version}. Выбор истории не меняет текущую версию.
          </p>
          <ul>
            {p.versionHistory.entries.map((entry) => (
              <li key={entry.identity.versionId}>
                <button
                  type="button"
                  disabled={
                    props.onSelectVersion === undefined ||
                    entry.identity.versionId === p.versionHistory?.selected.versionId
                  }
                  onClick={() => props.onSelectVersion?.(entry.identity)}
                >
                  Просмотреть версию {entry.identity.version}
                </button>
                <span>
                  {' '}
                  {entry.timestamp} · {entry.reason ?? 'Создание полного шаблона'}
                </span>
                {entry.changeSet.length === 0 ? null : (
                  <details>
                    <summary>Изменения версии {entry.identity.version}</summary>
                    <VersionChanges changes={entry.changeSet} catalog={p.catalog} />
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p>Активные боевые привязки отсутствуют: создание боевых экземпляров пока недоступно.</p>
        </section>
      )}
      {props.projection['kind'] === 'CUSTOM_MONSTER_AUTHORING' ? (
        <CustomMonsterContent
          {...props}
          projection={customMonsterProjectionValue(props.projection)}
        />
      ) : (
        <SentientEnemyAuthoringContent {...props} />
      )}
    </>
  );
}
function SentientEnemyAuthoringContent({
  projection,
  onValue,
  onPrepare,
}: {
  readonly projection: JsonObject;
  readonly onValue: (data: JsonObject | null) => void;
  readonly onPrepare: (data: JsonObject) => { readonly ok: boolean; readonly detail?: string };
}) {
  const p = useMemo(() => enemyAuthoringProjectionValue(projection), [projection]);
  const attempt = p.context.attemptOrNull;
  const pendingBuild =
    p.formId === 'ENM-007'
      ? (attempt?.skillPlanState?.rebuildPreviewOrNull ?? attempt?.legacySkillPlanPreview)
      : null;
  const buildForFields = pendingBuild?.initialInput.build ?? attempt?.buildOrNull;
  const [identity, setIdentity] = useState(() =>
    sentientIdentityDraft(attempt?.identityOrNull ?? null),
  );
  const [stats, setStats] = useState(
    Object.fromEntries(
      ENEMY_STATS.map((key) => [
        key,
        attempt?.baseStatsOrNull === null || attempt === null
          ? ''
          : String(attempt.baseStatsOrNull[key]),
      ]),
    ) as Record<(typeof ENEMY_STATS)[number], string>,
  );
  const [race, setRace] = useState<string>(buildForFields?.raceCode ?? '');
  const [pureClass, setPureClass] = useState(buildForFields?.pureClassOrNull ?? '');
  const [skills, setSkills] = useState(buildForFields?.skillSelections ?? []);
  const [rebuildConfirmed, setRebuildConfirmed] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const initialInput = useMemo(
    () => ({
      baseStats: attempt?.baseStatsOrNull == null ? null : { ...attempt.baseStatsOrNull },
      build: {
        raceCode: race,
        pureClassOrNull: pureClass === '' ? null : pureClass,
        skillSelections: skills.map((skill) => ({ ...skill })),
      },
    }),
    [attempt, race, pureClass, skills],
  );
  const skillState = attempt?.skillPlanState;
  const skillPlan = skillState?.planOrNull;
  const rebuildPreview = skillState?.rebuildPreviewOrNull ?? attempt?.legacySkillPlanPreview;
  const shownRebuild =
    rebuildPreview != null && admissionJsonEqual(rebuildPreview.initialInput, initialInput)
      ? rebuildPreview
      : null;
  const buildData = useMemo(
    () =>
      shownRebuild !== null
        ? rebuildConfirmed
          ? {
              operation: 'CONFIRM_REBUILD',
              initialInput,
              expectedPlanRevision: shownRebuild.planRevision,
              previewCommandId: shownRebuild.previewCommandId,
              displayedConsequences: shownRebuild.consequences,
            }
          : null
        : attempt?.schemaVersion !== 2
          ? initialInput.build
          : skillPlan == null
            ? { operation: 'INITIALIZE', initialInput }
            : attempt.buildOrNull !== null &&
                admissionJsonEqual(skillPlan.initialInput, initialInput)
              ? { operation: 'SAVE_IDENTICAL', initialInput }
              : null,
    [shownRebuild, rebuildConfirmed, initialInput, attempt, skillPlan],
  );
  const [compositionInput, setCompositionInput] = useState<JsonObject | null>(null);
  const [items, setItems] = useState(attempt?.inventoryOrNull?.inventoryItems ?? []);
  const [compatibility, setCompatibility] = useState(
    attempt?.inventoryOrNull?.armorCompatibilityReasonOrNull ?? '',
  );
  useEffect(() => {
    const data =
      p.formId === 'ENM-005'
        ? sentientIdentityData(identity)
        : p.formId === 'ENM-006'
          ? Object.fromEntries(
              ENEMY_STATS.map((key) => [key, stats[key] === '' ? null : Number(stats[key])]),
            )
          : p.formId === 'ENM-007'
            ? buildData
            : p.formId === 'ENM-008'
              ? compositionInput
              : p.formId === 'ENM-009'
                ? {
                    inventoryItems: items,
                    armorCompatibilityReasonOrNull: compatibility === '' ? null : compatibility,
                  }
                : {};
    onValue(data as unknown as JsonObject | null);
  }, [p.formId, identity, stats, buildData, compositionInput, items, compatibility, onValue]);
  const races = list(p.catalog['races']),
    classes = list(p.catalog['classes']),
    skillChoices = list(p.catalog['skills']);
  const buildOption = list(p.catalog['buildOptions']).find(
    (option) =>
      option['raceCode'] === race &&
      option['pureClassOrNull'] === (pureClass === '' ? null : pureClass),
  );
  return (
    <section aria-label="Создание мыслящего врага" data-enemy-authoring={p.formId}>
      <p>
        {p.formId === 'ENM-020'
          ? `Сохранённая версия ${p.context.selectedVersionOrNull?.version}. Лист и арт неизменяемы.`
          : 'Техническая попытка. Шаблон появится в каталоге только после полного сохранения.'}
      </p>
      {p.formId === 'ENM-020' && p.versionConfigurationSummaryOrNull === null ? (
        <p>У этой сохранённой версии нет отдельного подтверждения конфигурации N+1.</p>
      ) : null}
      <img
        alt="Заглушка мыслящего врага"
        src={`data:image/png;base64,${p.art.bytesBase64}`}
        width="220"
      />
      <p>При сохранении V1 закрепляется эта заглушка. Загрузка другого арта пока недоступна.</p>
      {p.formId === 'ENM-005' ? (
        <SentientIdentityFields value={identity} onChange={setIdentity} />
      ) : null}
      {p.formId === 'ENM-006' ? (
        <fieldset>
          <legend>Семь прямых базовых характеристик</legend>
          {ENEMY_STATS.map((key) => (
            <label key={key}>
              {key}
              <input
                aria-label={`Базовая ${key}`}
                type="number"
                min="1"
                max="35"
                step="1"
                value={stats[key]}
                onChange={(e) => setStats({ ...stats, [key]: e.target.value })}
              />
            </label>
          ))}
          <p>
            Суммарного лимита и броска нет. Итог после постоянных поправок может превышать 35, но
            должен оставаться не ниже 1. Изменение базы потребует заново подтвердить навыки, состав
            и имущество.
          </p>
        </fieldset>
      ) : null}
      {p.formId === 'ENM-007' ? (
        <fieldset>
          <legend>Раса, класс и навыки</legend>
          <label>
            Раса
            <select
              value={race}
              onChange={(e) => {
                setRebuildConfirmed(false);
                setRace(e.target.value);
                setPureClass('');
                setSkills([]);
              }}
            >
              <option value="">Выберите расу</option>
              {races.map((row) => (
                <option key={text(row['raceCode'])} value={text(row['raceCode'])}>
                  {text(row['name'])}
                </option>
              ))}
            </select>
          </label>
          {race === 'PURE' ? (
            <label>
              Класс Чистого
              <select
                value={pureClass}
                onChange={(e) => {
                  setRebuildConfirmed(false);
                  setPureClass(e.target.value);
                }}
              >
                <option value="">Выберите класс</option>
                {classes.map((row) => (
                  <option key={text(row['classCode'])} value={text(row['classCode'])}>
                    {text(row['name'])}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p>
            Изменение расы, класса или навыков потребует повторно подтвердить состав и имущество.
          </p>
          {skillPlan == null ? null : (
            <p>
              Текущий начальный план: {skillPlan.revision}. Простое возвращение или сохранение
              неизменённого выбора его не пересобирает.
            </p>
          )}
          {skillPlan != null || attempt?.buildOrNull !== null ? (
            <button
              type="button"
              onClick={() => {
                setRebuildConfirmed(false);
                const result = onPrepare({
                  operation: 'PREVIEW_REBUILD',
                  expectedPlanRevision: skillPlan?.revision ?? 0,
                  initialInput,
                });
                setPlanNotice(
                  result.ok
                    ? 'Дождитесь расчёта последствий хостом.'
                    : (result.detail ?? 'Расчёт пересборки недоступен.'),
                );
              }}
            >
              {attempt?.schemaVersion === 2
                ? 'Рассчитать явную пересборку начального плана'
                : 'Рассчитать переход к новому начальному плану'}
            </button>
          ) : null}
          {shownRebuild === null ? null : (
            <section aria-label="Последствия явной пересборки">
              <h3>Подтверждённые хостом последствия</h3>
              <p>
                Прежний расчёт навыков станет неактивным. Новый начальный выбор оплачивается
                целиком; прежняя смешанная оплата и бонусы не переносятся автоматически.
              </p>
              <ul>
                {shownRebuild.consequences.abandonedSkills.map((skill) => (
                  <li key={skill.skillKey}>
                    {text(skillChoices.find((row) => row['skillKey'] === skill.skillKey)?.['name'])}
                    : бонус {skill.bonus}; START {skill.startSlots}, Мирный воин{' '}
                    {skill.dolphinSlots}.
                  </li>
                ))}
              </ul>
              <p>
                Повторно подтвердить состав:{' '}
                {shownRebuild.consequences.invalidateComposition ? 'да' : 'состав ещё не выбран'};
                имущество:{' '}
                {shownRebuild.consequences.invalidateInventory ? 'да' : 'имущество ещё не выбрано'};
                собственные навыки Советника:{' '}
                {shownRebuild.consequences.invalidateOwnAdvisorChoices
                  ? 'да'
                  : 'текущего выбора нет'}
                .
              </p>
              {skillState?.advisorKnowledge.length === 0 || skillState === undefined ? null : (
                <section aria-label="Прежние собственные навыки Советника">
                  <h4>Собственные навыки Советника, которые станут неактивными</h4>
                  <ul>
                    {skillState.advisorKnowledge.flatMap((card) =>
                      card.knownSkills.map((skill) => (
                        <li key={card.cardId + skill.skillKey}>
                          {text(
                            skillChoices.find((row) => row['skillKey'] === skill.skillKey)?.[
                              'name'
                            ],
                          )}
                          : бонус {skill.bonus}; собственные слоты {skill.startSlots}.
                        </li>
                      )),
                    )}
                  </ul>
                  <p>
                    Первоначальные подтверждения карты сохраняются. При её использовании в новом
                    плане текущие собственные навыки подтверждаются заново.
                  </p>
                </section>
              )}
              {skillState?.pendingChoicesOrNull?.advisorSkills.length ? (
                <p>
                  Ещё не проверенный по телу выбор Советника также отменяется:{' '}
                  {skillState.pendingChoicesOrNull.advisorSkills
                    .map(
                      (skill) =>
                        `${text(skillChoices.find((row) => row['skillKey'] === skill.skillKey)?.['name'])}, целевой бонус ${skill.targetBonus}`,
                    )
                    .join('; ')}
                  . Эти заявки ещё не являются подтверждённой оплатой.
                </p>
              ) : null}
              {attempt?.compositionOrNull == null ? null : 'schemaVersion' in
                attempt.compositionOrNull ? (
                <p>
                  Прежний состав:{' '}
                  {(attempt.compositionOrNull.monsterOrNull === null
                    ? attempt.compositionOrNull.ordinarySymbiontInstances
                    : [attempt.compositionOrNull.monsterOrNull]
                  )
                    .map(
                      (choice) =>
                        `${text(list(object(p.catalog['compositionCatalog'])['species']).find((row) => row['speciesKey'] === choice.speciesKey)?.['name'])}, уровень ${choice.targetLevel}`,
                    )
                    .join('; ') || 'без симбионтов'}
                  .
                </p>
              ) : (
                <p>Прежний состав явно пустой.</p>
              )}
              {attempt?.inventoryOrNull == null ? null : (
                <p>
                  Прежнее имущество:{' '}
                  {attempt.inventoryOrNull.inventoryItems
                    .map(
                      (item) =>
                        `${text(list(p.catalog['items']).find((row) => row['itemTypeId'] === item.itemTypeId)?.['name'])} × ${item.quantity}${item.equipped ? ' — экипировано' : ''}`,
                    )
                    .join('; ') || 'без имущества'}
                  . Оно будет выбрано и проверено заново.
                </p>
              )}
              {attempt?.compositionAcquisitions?.grossGrantOrNull == null ? null : (
                <p>
                  Бесплатный навык «
                  {text(skillChoices.find((row) => row['skillKey'] === 'GROSS')?.['name'])}» будет
                  рассчитан один раз по новому начальному выбору, без сложения с прежней выдачей.
                </p>
              )}
              {attempt?.compositionAcquisitions?.freeSlotOrNull == null ? null : (
                <p>
                  Сохраняется исходный R6:{' '}
                  {attempt.compositionAcquisitions.freeSlotOrNull.roll.mechanical.rawFace}.
                  Необратимые изменения: S{' '}
                  {attempt.compositionAcquisitions.freeSlotOrNull.permanentStatConsequence.S}, M{' '}
                  {attempt.compositionAcquisitions.freeSlotOrNull.permanentStatConsequence.M}, Z{' '}
                  {attempt.compositionAcquisitions.freeSlotOrNull.permanentStatConsequence.Z}; новая
                  база не возвращает эти потери.
                </p>
              )}
              {attempt?.compositionAcquisitions?.advisorCards.map((card) => (
                <p key={card.cardId}>
                  Исходная карта Советника сохраняется: исходный R20 для I —{' '}
                  {card.iwRolls[0].mechanical.rawFace}, для W — {card.iwRolls[1].mechanical.rawFace}
                  ;{' '}
                  {card.suppressionRollOrNull === null
                    ? 'подавление ещё не определялось'
                    : `исходный R20 подавления ${card.suppressionRollOrNull.mechanical.rawFace}`}
                  . Первоначальные подтверждения остаются в истории; текущие навыки выбираются
                  заново только при использовании карты.
                </p>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={rebuildConfirmed}
                  onChange={(event) => setRebuildConfirmed(event.target.checked)}
                />
                Подтверждаю показанную пересборку и повторное подтверждение зависимых этапов
              </label>
              <p>
                Для применения используйте «Сохранить расу, класс и навыки». Изменение полей требует
                нового расчёта последствий.
              </p>
              <button
                type="button"
                onClick={() => {
                  const result = onPrepare({
                    operation: 'DISCARD_REBUILD',
                    previewCommandId: shownRebuild.previewCommandId,
                  });
                  setPlanNotice(
                    result.ok
                      ? 'Дождитесь отмены расчёта хостом.'
                      : (result.detail ?? 'Отмена расчёта недоступна.'),
                  );
                }}
              >
                Отказаться от расчёта пересборки
              </button>
            </section>
          )}
          {planNotice === null ? null : <p role="status">{planNotice}</p>}
          {buildOption === undefined ? null : (
            <section aria-label="Подтверждённые хостом правила выбора">
              <p>
                Характеристики до симбионтов:{' '}
                {statText(buildOption['skillStageStats'] as Readonly<Record<string, number>>)}
              </p>
              <p>
                Начальные слоты навыков:{' '}
                {buildOption['capacityOrNull'] === null
                  ? 'Сначала исправьте постоянные характеристики'
                  : text(buildOption['capacityOrNull'])}
                . Каждый бонус до +5 стоит один слот, каждое последующее +1 — два. Необходимо
                заполнить все начальные слоты.
              </p>
              <ul>
                {list(buildOption['mandatorySkills']).map((skill) => (
                  <li key={text(skill['skillKey'])}>
                    {text(skill['name'])} · бонус {text(skill['bonus'])} · обязательных слотов{' '}
                    {text(skill['slotCost'])}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {skillChoices.map((skill) =>
            skill['category'] === 'SELECTABLE_GENERAL' ? (
              <fieldset key={text(skill['skillKey'])}>
                <legend>{text(skill['name'])}</legend>
                <p>Требования: {skillRequirementText(list(skill['requirements']))}</p>
                <label>
                  Бонус навыка
                  <input
                    aria-label={`Бонус: ${text(skill['name'])}`}
                    type="number"
                    min="1"
                    step="1"
                    value={
                      skills.find((row) => row.skillKey === skill['skillKey'])?.targetBonus ?? ''
                    }
                    onChange={(e) => {
                      setRebuildConfirmed(false);
                      setSkills([
                        ...skills.filter((row) => row.skillKey !== skill['skillKey']),
                        ...(e.target.value === ''
                          ? []
                          : [
                              {
                                skillKey: text(skill['skillKey']),
                                targetBonus: Number(e.target.value),
                              },
                            ]),
                      ]);
                    }}
                  />
                </label>
              </fieldset>
            ) : null,
          )}
        </fieldset>
      ) : null}
      {p.formId === 'ENM-008' ? (
        <EnemyCompositionFields
          projection={p}
          onValue={setCompositionInput}
          onPrepare={onPrepare}
          requirementText={skillRequirementText}
        />
      ) : null}
      {p.formId === 'ENM-009' ? (
        <>
          <InventoryFields catalog={p.catalog} value={items} onChange={setItems} />
          <label>
            Подтверждение физической совместимости слоёв костюмов, если требуется
            <textarea value={compatibility} onChange={(e) => setCompatibility(e.target.value)} />
          </label>
        </>
      ) : null}
      {p.sheetOrNull !== null ? (
        <EnemySheetContent sheet={p.sheetOrNull} catalog={p.catalog} />
      ) : null}
      {p.validationErrors.length === 0 ? null : (
        <ul role="alert">
          {p.validationErrors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
