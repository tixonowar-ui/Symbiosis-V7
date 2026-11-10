import { useEffect, useState } from 'react';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import {
  ENEMY_STATS,
  enemyAuthoringProjectionValue,
  type EnemyItemInput,
  type EnemySheet,
} from '@shared/enemy-authoring.js';

const labels: Readonly<Record<string, string>> = {
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
        <dd>Явно пустой состав</dd>
      </dl>
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
export function EnemyAuthoringContent({
  projection,
  onValue,
}: {
  readonly projection: JsonObject;
  readonly onValue: (data: JsonObject) => void;
}) {
  const p = enemyAuthoringProjectionValue(projection),
    attempt = p.context.attemptOrNull;
  const [identity, setIdentity] = useState({
    name: attempt?.identityOrNull?.name ?? '',
    description: attempt?.identityOrNull?.description ?? '',
    origin: attempt?.identityOrNull?.origin ?? '',
    affiliation: attempt?.identityOrNull?.affiliation ?? '',
    massKg:
      attempt?.identityOrNull === null || attempt === null
        ? ''
        : String(attempt.identityOrNull.massKg),
  });
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
  const [race, setRace] = useState<string>(attempt?.buildOrNull?.raceCode ?? '');
  const [pureClass, setPureClass] = useState(attempt?.buildOrNull?.pureClassOrNull ?? '');
  const [skills, setSkills] = useState(attempt?.buildOrNull?.skillSelections ?? []);
  const [emptyConfirmed, setEmptyConfirmed] = useState(
    attempt?.compositionOrNull !== null && attempt?.compositionOrNull !== undefined,
  );
  const [items, setItems] = useState(attempt?.inventoryOrNull?.inventoryItems ?? []);
  const [compatibility, setCompatibility] = useState(
    attempt?.inventoryOrNull?.armorCompatibilityReasonOrNull ?? '',
  );
  useEffect(() => {
    const data =
      p.formId === 'ENM-005'
        ? {
            ...identity,
            description: identity.description === '' ? null : identity.description,
            massKg: identity.massKg === '' ? null : Number(identity.massKg),
            anatomyProfileId: 'ORDINARY_SENTIENT',
          }
        : p.formId === 'ENM-006'
          ? Object.fromEntries(
              ENEMY_STATS.map((key) => [key, stats[key] === '' ? null : Number(stats[key])]),
            )
          : p.formId === 'ENM-007'
            ? {
                raceCode: race,
                pureClassOrNull: pureClass === '' ? null : pureClass,
                skillSelections: skills,
              }
            : p.formId === 'ENM-008'
              ? {
                  symbiontCompositionMode: emptyConfirmed ? 'ORDINARY_SYMBIONTS' : 'UNCONFIRMED',
                  ordinarySymbiontInstances: [],
                  symbioticMonsterProfileIdOrNull: null,
                }
              : p.formId === 'ENM-009'
                ? {
                    inventoryItems: items,
                    armorCompatibilityReasonOrNull: compatibility === '' ? null : compatibility,
                  }
                : {};
    onValue(data as unknown as JsonObject);
  }, [
    p.formId,
    identity,
    stats,
    race,
    pureClass,
    skills,
    emptyConfirmed,
    items,
    compatibility,
    onValue,
  ]);
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
          ? 'Сохранённая версия 1. Лист и арт неизменяемы.'
          : 'Техническая попытка. Шаблон появится в каталоге только после полного сохранения.'}
      </p>
      <img
        alt="Заглушка мыслящего врага"
        src={`data:image/png;base64,${p.art.bytesBase64}`}
        width="220"
      />
      <p>При сохранении V1 закрепляется эта заглушка. Загрузка другого арта пока недоступна.</p>
      {p.formId === 'ENM-005' ? (
        <fieldset>
          <legend>Идентичность</legend>
          {(['name', 'description', 'origin', 'affiliation', 'massKg'] as const).map(
            (key, index) => (
              <label key={key}>
                {
                  ['Имя врага', 'Описание врага', 'Происхождение', 'Принадлежность', 'Масса, кг'][
                    index
                  ]
                }
                <input
                  type={key === 'massKg' ? 'number' : 'text'}
                  min={key === 'massKg' ? 30 : undefined}
                  max={key === 'massKg' ? 500 : undefined}
                  step={key === 'massKg' ? 0.1 : undefined}
                  maxLength={key === 'description' ? 2000 : undefined}
                  value={identity[key]}
                  onChange={(e) => setIdentity({ ...identity, [key]: e.target.value })}
                />
              </label>
            ),
          )}
          <p>Обычная анатомия мыслящего. Масса 30–500 кг, шаг 0,1 кг.</p>
        </fieldset>
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
              <select value={pureClass} onChange={(e) => setPureClass(e.target.value)}>
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
                    onChange={(e) =>
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
                      ])
                    }
                  />
                </label>
              </fieldset>
            ) : null,
          )}
        </fieldset>
      ) : null}
      {p.formId === 'ENM-008' ? (
        <fieldset>
          <legend>Состав симбионтов</legend>
          <label>
            <input
              type="checkbox"
              checked={emptyConfirmed}
              onChange={(e) => setEmptyConfirmed(e.target.checked)}
            />
            Подтверждаю явно пустой состав симбионтов
          </label>
          <p>
            Непустой состав и симбиотическое чудовище пока недоступны: их добавит следующий этап.
            Скрытого назначения симбионта или опыта нет.
          </p>
        </fieldset>
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
