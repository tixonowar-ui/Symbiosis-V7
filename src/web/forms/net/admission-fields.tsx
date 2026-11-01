import { useState, type ReactElement } from 'react';
import type { JsonObject } from '@shared/wire-protocol.js';
import type {
  AdmissionMechanicalSheetV1,
  AdmissionMechanicalCore,
  AdmissionPublicWeaponProfile,
  AdmissionReviewInputs,
  AdmissionWeaponResolutionInput,
  AdmissionMasterWeaponProfileInput,
} from '@shared/campaign-admission.js';
import {
  admissionMechanicalSheetValue,
  admissionMechanicalCoreValue,
} from '@shared/campaign-admission-sheet.js';
import {
  admissionFullCopyDiffValue,
  type AdmissionFullCopyDiff,
} from '@shared/campaign-admission-proposal.js';
import {
  admissionCodecReaders as r,
  admissionJsonEqual,
  admissionReviewInputsValue,
} from '@shared/campaign-admission-codec.js';
import {
  admissionGmViewValuesValue,
  type AdmissionGmViewFormId,
} from '@shared/campaign-admission-review.js';
import {
  admissionGmProjectionValue,
  admissionOwnerProjectionValue,
  type AdmissionOwnerFormId,
} from '@shared/campaign-admission-presentation.js';
import {
  admissionOwnerPublicationValue,
  admissionPlayerDecisionReceiptValue,
} from '@shared/campaign-admission-proposal.js';
import type { AdmissionBrowserEdit } from './admission-client.js';

const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
// Character registry Stats, imported as generated/spec/character/stats.json.
const STAT_LABELS = {
  S: 'Сила',
  D: 'Ловкость',
  M: 'Метаболизм',
  Z: 'Здоровье',
  I: 'Интеллект',
  W: 'Мудрость',
  C: 'Харизма',
};
type ItemLabel = { readonly itemTypeId: string; readonly name: string };
const labels = (value: unknown): readonly ItemLabel[] =>
  r.list(value, '$.itemLabels').map((v) => {
    const row = r.exact(v, 'itemTypeId name', '$.itemLabel');
    return {
      itemTypeId: r.text(row['itemTypeId'], '$.itemTypeId'),
      name: r.text(row['name'], '$.name'),
    };
  });
function itemName(
  item: AdmissionReviewInputs['inventoryReview']['entries'][number]['item'],
  items: readonly ItemLabel[],
): string {
  if (item.kind === 'CUSTOM_ITEM') return item.name;
  const name = items.find((entry) => entry.itemTypeId === item.itemTypeId)?.name;
  if (name === undefined) throw new Error('Admission item label is missing');
  return name;
}
const yes = (value: boolean) => (value ? 'да' : 'нет');
function WeaponProfile({
  profile,
}: {
  readonly profile: AdmissionPublicWeaponProfile;
}): ReactElement {
  return (
    <section aria-label="Профиль оружия">
      <h4>
        {profile.name} — {profile.variantLabel}
      </h4>
      <dl>
        <dt>Урон</dt>
        <dd>
          {profile.damageDefinition.effectiveTemplateExpression}
          {profile.instanceDamageOrNull === null
            ? ''
            : `; значение экземпляра ${profile.instanceDamageOrNull}`}
        </dd>
        <dt>Пробитие</dt>
        <dd>{profile.penetrationDefinition.effectiveTemplateExpression}</dd>
        <dt>Требования</dt>
        <dd>
          {STATS.filter((stat) => profile.statRequirements[stat] !== undefined)
            .map((stat) => `${STAT_LABELS[stat]} ${profile.statRequirements[stat]}`)
            .join(', ') || 'Нет'}
        </dd>
        <dt>Дальность</dt>
        <dd>
          {profile.rangeMetersOrNull === null ? 'Не применяется' : `${profile.rangeMetersOrNull} м`}
        </dd>
        <dt>Точность</dt>
        <dd>{profile.accuracyBonusOrNull ?? 'Не применяется'}</dd>
        {Object.entries(profile.properties).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
        <dt>Развитие от урона и пробития</dt>
        <dd>
          {profile.damageDefinition.progressionEligibility === 'NO_DIRECT_BUT_POOL'
            ? 'Прямого развития нет; учитывается общий пул.'
            : 'Развитие не начисляется.'}
        </dd>
      </dl>
    </section>
  );
}
/** Only named mechanical fields are rendered; receipt/instance/source IDs never become prose. */
function CoreSheet({ core }: { readonly core: AdmissionMechanicalCore }): ReactElement {
  const s = core,
    runtime = s.runtime;
  return (
    <>
      <h3>{s.identity.name}</h3>
      <p>
        Возраст: {s.identity.age}. Пол: {s.identity.sex === 'MALE' ? 'мужской' : 'женский'}. Масса:{' '}
        {s.identity.massKg} кг.
      </p>
      <p>
        Раса: {s.race.label}. Класс: {s.classOrNull?.label ?? 'Не применяется'}. Способ создания:{' '}
        {s.creationMode === 'MANUAL'
          ? 'ручной'
          : s.creationMode === 'RANDOM'
            ? 'случайный'
            : 'без выбора способа'}
        .
      </p>
      <h4>Характеристики</h4>
      <table>
        <thead>
          <tr>
            <th>Характеристика</th>
            <th>Исходная</th>
            <th>Правка мастера</th>
            <th>Рюкзак</th>
            <th>Для навыков</th>
            <th>Итог</th>
          </tr>
        </thead>
        <tbody>
          {STATS.map((stat) => (
            <tr key={stat}>
              <th>{STAT_LABELS[stat]}</th>
              <td>{s.stats.acceptedBase[stat]}</td>
              <td>{s.stats.permanentGmAdjustments[stat]}</td>
              <td>{s.stats.backpackItemAdjustments[stat]}</td>
              <td>{s.stats.skillStageStats[stat]}</td>
              <td>{s.stats.effectiveStats[stat]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Расчёт ограничений характеристик</summary>
        <ul>
          {s.stats.statProof.map((p) => (
            <li key={p.statCode}>
              {STAT_LABELS[p.statCode]}: до ограничений {p.beforeLimits}; положительные эффекты{' '}
              {p.positiveSymbiontDelta}, отрицательные {p.negativeSymbiontDelta}, применено{' '}
              {p.appliedNegativeDelta}; минимум {p.minimumOrNull ?? 'нет'}, максимум{' '}
              {p.maximumOrNull ?? 'нет'}; итог {p.effectiveValue}.
            </li>
          ))}
        </ul>
      </details>
      <h4>Навыки</h4>
      <p>
        Занято {s.skills.usedSlots} из {s.skills.maxSlots}; свободно {s.skills.remainingSlots}.
        Требования выполнены.
      </p>
      <ul>
        {s.skills.entries.map((skill) => (
          <li key={`${skill.source}:${skill.skillKey}`}>
            {skill.label}: +{skill.bonus}; слотов {skill.slotCost};{' '}
            {skill.source === 'SELECTED'
              ? 'выбранный'
              : skill.source === 'RACE_GRANTED'
                ? 'расовый'
                : skill.source === 'CLASS_MANDATORY'
                  ? 'обязательный классовый'
                  : 'постоянный эффект симбионта'}
            .
          </li>
        ))}
      </ul>
      <h4>Симбионты</h4>
      {s.symbionts.length === 0 ? (
        <p>Нет.</p>
      ) : (
        <ul>
          {s.symbionts.map((sym) => (
            <li key={sym.acceptedIndex}>
              {sym.label}, уровень {sym.level}, ОЭ {sym.currentOe}/{sym.maxOe}, опыт {sym.xp}.{' '}
              {sym.status === 'ACTIVE'
                ? 'Активен'
                : sym.status === 'SUPPRESSED'
                  ? 'Подавлен'
                  : sym.status === 'ABSORBED'
                    ? 'Поглощён'
                    : 'Уничтожен'}
              . Эффекты: {yes(sym.effectsEnabled)}; развитие: {yes(sym.xpEligible)}. Привязка:{' '}
              {sym.binding.kind === 'NONE'
                ? 'нет'
                : sym.binding.kind === 'OWL_EYE'
                  ? `глаз, ${sym.binding.side === 'LEFT' ? 'левый' : 'правый'}`
                  : sym.binding.kind === 'EEL_ARM'
                    ? `рука, ${sym.binding.side === 'LEFT' ? 'левая' : 'правая'}`
                    : sym.binding.kind === 'TICK_RIGHT_HAND'
                      ? 'правая кисть'
                      : sym.binding.kind === 'SPIDER_BOTH_WRISTS'
                        ? 'оба запястья'
                        : 'оба предплечья'}
              . Узлы:{' '}
              {sym.learnedNodes.map((node) => `${node.label}, уровень ${node.level}`).join('; ') ||
                'нет'}
              .
            </li>
          ))}
        </ul>
      )}
      <h4>Советник</h4>
      {s.advisorOrNull === null ? (
        <p>Нет.</p>
      ) : (
        <p>
          Интеллект {s.advisorOrNull.intelligence}, мудрость {s.advisorOrNull.wisdom}, бонус
          подавления {s.advisorOrNull.suppressionBonusOrNull ?? 'не применяется'}. Навыки:{' '}
          {s.advisorOrNull.skills.map((skill) => `${skill.label} +${skill.bonus}`).join(', ') ||
            'нет'}
          .
        </p>
      )}
      <h4>Постоянные приобретения</h4>
      <p>
        {s.permanentGrants
          .map((grant) => `Грубость: ${grant.bonusBefore} → ${grant.bonusAfter}`)
          .join('; ') || 'Нет.'}
      </p>
      <h4>Обучающие слоты</h4>
      <p>
        Максимальная постоянная мудрость {s.trainingSlotLedger.maxPermanentWisdom}; выдано за всё
        время {s.trainingSlotLedger.everIssued}.
      </p>
      <h4>Начальное состояние</h4>
      <p>
        ОЗ {runtime.currentHp}/{runtime.maxHp}. Жив, в сознании. Оглушение, связывание, горение,
        отравление и болезнь отсутствуют.
      </p>
      <p>
        Раны, травмы, кровотечения, временные эффекты, перезарядки, подготовки, инициатива и боевая
        сцена отсутствуют. Боевые лимиты ещё не использованы. Экипированных предметов, созданных
        объектов, внешних сущностей и истории поглощения нет.
      </p>
      <p>
        Счётчики развития:{' '}
        {STATS.map((stat) => `${STAT_LABELS[stat]} ${runtime.statProgressionCounters[stat]}`).join(
          ', ',
        )}
        . Очки опыта симбионтов: {runtime.symbiontXpProgressPoints}; нераспределённый опыт:{' '}
        {runtime.unallocatedSymbiontXp}; дополнительные слоты химеры: {runtime.chimeraExtraSlots}.
      </p>
      <p>
        Яд тайпана: {runtime.taipanPoisonOrNull === 'DEADLY' ? 'смертельный' : 'нет'}; Ми-ми-ми:{' '}
        {yes(runtime.penguinMiMiMiActive)}; крыса внутри: {yes(runtime.ratInsideHost)}; хранитель
        внутри: {yes(runtime.keeperInsideHost)}; клинки богомола:{' '}
        {runtime.mantisBladeStateOrNull === 'ORDINARY' ? 'обычные' : 'нет'}.
      </p>
    </>
  );
}
export function AdmissionSheet({
  sheet,
  items,
}: {
  readonly sheet: AdmissionMechanicalSheetV1;
  readonly items: readonly ItemLabel[];
}): ReactElement {
  const s = admissionMechanicalSheetValue(sheet);
  return (
    <section aria-label="Полный лист персонажа">
      <CoreSheet core={s} />
      <h4>Проверка массы</h4>
      <p>
        {s.massReview.massKg} кг —{' '}
        {s.massReview.decision === 'APPROVED' ? 'одобрена' : 'ожидает мастера'}.
      </p>
      <h4>Стартовое имущество</h4>
      <p>
        {s.inventoryReview.status === 'FINAL' ? 'Подтверждено' : 'Ожидает мастера'}. Неразрешённых
        позиций: {s.inventoryReview.unresolvedSourceEntryIds.length}.
      </p>
      <ul>
        {s.inventoryReview.entries.map((entry, index) => (
          <li key={index}>
            {itemName(entry.item, items)} × {entry.quantity}; качество: {entry.qualityLabel}. В
            рюкзаке.
            {entry.item.kind === 'CUSTOM_ITEM' ? (
              <p>
                {entry.item.description}
                {entry.item.statBonusOrNull === null
                  ? ''
                  : `; ${STAT_LABELS[entry.item.statBonusOrNull.statCode]} +${entry.item.statBonusOrNull.positiveIntegerBonus}`}
              </p>
            ) : null}
            {entry.weaponProfileOrNull === null ? null : (
              <WeaponProfile profile={entry.weaponProfileOrNull} />
            )}
          </li>
        ))}
      </ul>
      <h4>Стартовые деньги</h4>
      <p>
        {s.moneyReview.status === 'FINAL'
          ? s.moneyReview.amountOrNull
          : 'Ожидают определения мастером'}
        .
      </p>
      <h4>Группа</h4>
      <p>
        {s.groupAssignmentOrNull === null
          ? 'Не назначена'
          : s.groupAssignmentOrNull.kind === 'START'
            ? 'Стартовая группа'
            : s.groupAssignmentOrNull.kind === 'NEW'
              ? s.groupAssignmentOrNull.name
              : 'Существующая группа кампании'}
        .
      </p>
      <h4>Местоположение</h4>
      <p>
        {s.locationAssignmentOrNull === null
          ? 'Не назначено'
          : [s.locationAssignmentOrNull.location, s.locationAssignmentOrNull.subLocationOrNull]
              .filter(Boolean)
              .join(' / ')}
        .
      </p>
    </section>
  );
}
export function AdmissionDiff({
  diff,
  items,
}: {
  readonly diff: AdmissionFullCopyDiff;
  readonly items: readonly ItemLabel[];
}): ReactElement {
  const d = admissionFullCopyDiffValue(diff);
  return (
    <section aria-label={`Изменения: ${d.characterName}`}>
      <h3>{d.characterName}</h3>
      <p>
        Изменённых полей: {d.changes.length}.{' '}
        {d.blockers.length === 0
          ? 'Блокирующих условий нет.'
          : 'После принятия персонаж останется в лобби до решения блокирующих условий.'}
      </p>
      <ul>
        {d.blockers.map((blocker, index) => (
          <li key={index}>{blocker.message}</li>
        ))}
      </ul>
      <details>
        <summary>До — неизменяемый локальный лист</summary>
        <AdmissionSheet sheet={d.beforeSheet} items={items} />
      </details>
      <details open>
        <summary>После — полный кампанийный лист</summary>
        <AdmissionSheet sheet={d.afterSheet} items={items} />
      </details>
    </section>
  );
}

interface Props {
  readonly formId: AdmissionGmViewFormId;
  readonly projection: JsonObject;
  readonly onEdit: (edit: AdmissionBrowserEdit) => void;
}
export function AdmissionOwnerFields({
  formId,
  projection,
}: {
  formId: AdmissionOwnerFormId;
  projection: JsonObject;
}): ReactElement {
  const p = admissionOwnerProjectionValue(formId, projection),
    publication = admissionOwnerPublicationValue(p['publication']),
    proposal = publication.proposalOrNull;
  const receipt =
      p['receiptOrNull'] === null
        ? null
        : admissionPlayerDecisionReceiptValue(p['receiptOrNull'], publication),
    items = labels(p['itemLabels']);
  return (
    <section aria-label="Согласование набора персонажей">
      <p>
        Локальные листы сохраняются без изменений. Решение относится ко всему набору этой кампании.
      </p>
      {p['technicalSessionAvailable'] !== true ? (
        <p role="status">
          Связь с мастером восстанавливается. Показано последнее подтверждённое состояние.
        </p>
      ) : null}
      {p['pendingCommandIdOrNull'] !== null ? (
        <p role="status">
          Решение отправлено. Ожидаем подтверждение мастера; повторный выбор пока недоступен.
        </p>
      ) : null}
      {formId === 'NET-027' ? (
        <>
          <p>
            {receipt === null
              ? 'Проверьте все изменения перед принятием или отказом от всего набора.'
              : receipt.decision === 'ACCEPT'
                ? 'Весь набор принят.'
                : 'От всего набора отказались.'}
          </p>
          {proposal?.fullCampaignCopyDiffs.map((diff) => (
            <AdmissionDiff key={diff.campaignCharacterIdOrNull} diff={diff} items={items} />
          ))}
          {p['capacityRecheck'] === null ? (
            <p>Актуальная вместимость ещё не подтверждена.</p>
          ) : (
            <p>
              Занято мест:{' '}
              {Number((p['capacityRecheck'] as JsonObject)['occupiedCampaignPlaceCount'])} из{' '}
              {Number((p['capacityRecheck'] as JsonObject)['activePlayerCapacity'])}. В наборе:{' '}
              {proposal?.fullCampaignCopyDiffs.length}. Вместимость и управление повторно проверяет
              мастер при принятии.
            </p>
          )}
        </>
      ) : formId === 'NET-007' ? (
        <>
          <p>
            {publication.gmDecision.decision === 'REJECT'
              ? 'Мастер отклонил весь набор.'
              : 'Вы отказались от всего набора. Ни один персонаж не активирован.'}
          </p>
          {publication.gmDecision.reasonOrNull === null ? null : (
            <p>Причина: {publication.gmDecision.reasonOrNull}</p>
          )}
        </>
      ) : (
        <>
          <p>
            Кампания на паузе. Персонажи приняты и занимают места. Готовность ещё не объявлена;
            запуск сцены выполняет мастер.
          </p>
          {proposal?.fullCampaignCopyDiffs.map((diff) => {
            const copy = receipt?.copies.find(
              (c) => c.campaignCharacterId === diff.campaignCharacterIdOrNull,
            );
            if (copy === undefined) throw new Error('Accepted copy is missing');
            return (
              <section key={copy.campaignCharacterId}>
                <h3>{diff.characterName}</h3>
                <p>
                  {copy.lifecycleState === 'ACTIVE'
                    ? 'Допущен. Блокирующих условий нет.'
                    : 'Остаётся в лобби до подтверждения блокирующих условий.'}
                </p>
                <ul>
                  {diff.blockers.map((b, index) => (
                    <li key={index}>{b.message}</li>
                  ))}
                </ul>
                <p>Управление закреплено за вашим устройством. Место занято.</p>
                <details>
                  <summary>Полный кампанийный лист</summary>
                  <AdmissionSheet sheet={diff.afterSheet} items={items} />
                </details>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
export function AdmissionGmFields({ formId, projection, onEdit }: Props): ReactElement {
  const p = admissionGmProjectionValue(formId, projection),
    items = labels(p['itemLabels']);
  const [inputs, setInputs] = useState<AdmissionReviewInputs | null>(() =>
    p['reviewDraft'] === undefined
      ? null
      : structuredClone(admissionReviewInputsValue(p['reviewDraft'])),
  );
  const [viewValues, setViewValues] = useState(() =>
    structuredClone(admissionGmViewValuesValue(p['viewValues'])),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const dirty = inputs !== null && !admissionJsonEqual(inputs, p['reviewDraft']);
  const edit = (next: AdmissionBrowserEdit) => {
    setLocalError(null);
    if (dirty && (next.kind === 'VIEW' || next.intent.kind !== 'EDIT')) {
      setLocalError('Сначала сохраните введённые правки копии.');
      return;
    }
    try {
      onEdit(next);
    } catch {
      setLocalError('Проверьте введённые значения.');
    }
  };
  const saveInputs = () => {
    if (inputs !== null) {
      try {
        admissionReviewInputsValue(inputs);
        edit({
          kind: 'REVIEW',
          intent: { kind: 'EDIT', reviewCopyId: p.selectedReviewCopyId, inputs },
        });
      } catch {
        setLocalError('Проверьте числа, назначения и состав имущества.');
      }
    }
  };
  const copies = p['batchReviewCopies'] as readonly { reviewCopyId: string; name: string }[];
  const selectedSkills = inputs?.startingSkills.entries ?? [];
  const skillOptions = (
    formId === 'GM-020'
      ? p['selectableSkills']
      : (p['catalogs'] as JsonObject | undefined)?.['skills']
  ) as
    | readonly {
        skillId: string;
        skillLabel: string;
        requirements: readonly { minValue: number; statLabel: string }[];
      }[]
    | undefined;
  return (
    <section aria-label="Допуск персонажей">
      <label>
        Персонаж набора
        <select
          disabled={dirty}
          value={p.selectedReviewCopyId}
          onChange={(event) =>
            edit({
              kind: 'VIEW',
              values: {
                ...viewValues,
                selectedReviewCopyId: event.target.value,
                weaponDraftOrNull: null,
              },
            })
          }
        >
          {copies.map((copy) => (
            <option key={copy.reviewCopyId} value={copy.reviewCopyId}>
              {copy.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        {p.editable
          ? 'Правки относятся только к кампанийной копии. Локальный источник неизменяем.'
          : 'Решение зафиксировано. Доступен просмотр.'}
      </p>
      {dirty ? (
        <p role="status">
          Есть несохранённые правки. Сохраните их перед переходом к другому персонажу или
          подготовкой новых предметов и групп.
        </p>
      ) : null}
      {formId === 'NET-018' ? (
        <>
          <AdmissionSheet
            sheet={p['immutableSourceSnapshot'] as unknown as AdmissionMechanicalSheetV1}
            items={items}
          />
          <details>
            <summary>Происхождение и натуральные броски</summary>
            <dl>
              {Object.entries({
                registryVersion: 'Версия реестра',
                catalogVersion: 'Версия каталога',
                builtAgainstTuple: 'Совместимость',
                sourceUuid: 'UUID локального источника',
                sourceSnapshotId: 'Снимок FINAL',
                sourceChecksum: 'Контрольная сумма источника',
                metadataRevision: 'Ревизия метаданных',
                finalSnapshotVersion: 'Версия FINAL',
              }).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {
                      (
                        (p['sourceProvenanceAndNaturalRolls'] as JsonObject)[
                          'provenance'
                        ] as JsonObject
                      )[key] as string | number
                    }
                  </dd>
                </div>
              ))}
            </dl>
            <ul>
              {(
                (p['sourceProvenanceAndNaturalRolls'] as JsonObject)['naturalRolls'] as readonly {
                  kind: string;
                  faces: number[];
                  diceInputMode: string;
                }[]
              ).map((roll, index) => (
                <li key={index}>
                  {roll.kind}: {roll.faces.join(', ')};{' '}
                  {roll.diceInputMode === 'AUTO' ? 'автоматический' : 'ручной'} ввод.
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      {formId === 'NET-019' ? (
        <>
          <details>
            <summary>Неизменяемый исходный лист</summary>
            <AdmissionSheet
              sheet={p['localSourceSnapshot'] as unknown as AdmissionMechanicalSheetV1}
              items={items}
            />
          </details>
          <details>
            <summary>Текущий расчёт копии</summary>
            <CoreSheet core={admissionMechanicalCoreValue(p['afterCore'])} />
          </details>
        </>
      ) : null}
      {inputs !== null ? (
        <fieldset disabled={!p.editable}>
          <legend>Правки копии</legend>
          {formId === 'NET-019' ? (
            <>
              <h3>Постоянные поправки характеристик</h3>
              {STATS.map((stat) => (
                <label key={stat}>
                  {STAT_LABELS[stat]}
                  <input
                    type="number"
                    step="1"
                    value={inputs.statAdjustments[stat]}
                    onChange={(e) =>
                      setInputs({
                        ...inputs,
                        statAdjustments: {
                          ...inputs.statAdjustments,
                          [stat]: e.target.valueAsNumber,
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Масса, кг
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={inputs.massReview.massKg}
                  onChange={(e) =>
                    setInputs({
                      ...inputs,
                      massReview: { ...inputs.massReview, massKg: e.target.valueAsNumber },
                    })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={inputs.massReview.decision === 'APPROVED'}
                  onChange={(e) =>
                    setInputs({
                      ...inputs,
                      massReview: {
                        ...inputs.massReview,
                        decision: e.target.checked ? 'APPROVED' : 'PENDING_MASTER_APPROVAL',
                      },
                    })
                  }
                />
                Масса одобрена
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={inputs.moneyReview.status === 'FINAL'}
                  onChange={(e) =>
                    setInputs({
                      ...inputs,
                      moneyReview: e.target.checked
                        ? { status: 'FINAL', amountOrNull: 0 }
                        : { status: 'PENDING', amountOrNull: null },
                    })
                  }
                />
                Деньги определены
              </label>
              {inputs.moneyReview.status === 'FINAL' ? (
                <label>
                  Сумма стартовых денег
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={inputs.moneyReview.amountOrNull}
                    onChange={(e) =>
                      setInputs({
                        ...inputs,
                        moneyReview: { status: 'FINAL', amountOrNull: e.target.valueAsNumber },
                      })
                    }
                  />
                </label>
              ) : null}
              <InventoryEditor
                inputs={inputs}
                items={items}
                projection={p}
                onChange={setInputs}
                onAllocate={() =>
                  edit({
                    kind: 'REVIEW',
                    intent: { kind: 'ALLOCATE_ITEM', reviewCopyId: p.selectedReviewCopyId },
                  })
                }
              />
            </>
          ) : null}
          {formId === 'NET-019' || formId === 'GM-020' ? (
            <>
              <h3>Выбранные стартовые навыки</h3>
              <p>
                Расовые и обязательные классовые навыки сохраняются. Стоимость и требования
                пересчитает хост.
              </p>
              {skillOptions?.map((skill) => {
                const current = selectedSkills.find((entry) => entry.skillKey === skill.skillId);
                return (
                  <label key={skill.skillId}>
                    {skill.skillLabel}
                    {skill.requirements.length === 0
                      ? ' — без требований'
                      : ` — ${skill.requirements.map((r) => `${r.statLabel} ≥ ${r.minValue}`).join(', ')}`}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={current?.targetBonus ?? 0}
                      onChange={(e) =>
                        setInputs({
                          ...inputs,
                          startingSkills: {
                            entries: [
                              ...selectedSkills.filter((entry) => entry.skillKey !== skill.skillId),
                              ...(e.target.valueAsNumber === 0
                                ? []
                                : [
                                    {
                                      skillKey: skill.skillId,
                                      targetBonus: e.target.valueAsNumber,
                                    },
                                  ]),
                            ],
                          },
                        })
                      }
                    />
                  </label>
                );
              })}
            </>
          ) : null}
          {formId === 'NET-020' ? (
            <GroupEditor
              inputs={inputs}
              projection={p}
              onChange={setInputs}
              onAllocate={() => edit({ kind: 'REVIEW', intent: { kind: 'ALLOCATE_GROUP' } })}
            />
          ) : null}
          <button type="button" onClick={saveInputs}>
            Сохранить правки копии
          </button>
        </fieldset>
      ) : null}
      {formId === 'NET-022' ? (
        <fieldset disabled={!p.editable}>
          <legend>Причина окончательного отказа</legend>
          <textarea
            aria-label="Причина окончательного отказа"
            value={viewValues.rejectionReason}
            onChange={(e) => setViewValues({ ...viewValues, rejectionReason: e.target.value })}
          />
          <button type="button" onClick={() => edit({ kind: 'VIEW', values: viewValues })}>
            Сохранить причину
          </button>
        </fieldset>
      ) : null}
      {formId === 'GM-019' ? (
        <WeaponEditor
          projection={p}
          items={items}
          onChange={(input) =>
            edit({ kind: 'VIEW', values: { ...viewValues, weaponDraftOrNull: input } })
          }
        />
      ) : null}
      {formId === 'NET-021' ? (
        <>
          <p>
            {p['allRequiredFieldsValid'] === true
              ? 'Полный набор готов к решению мастера.'
              : 'Обязательные поля ещё не заполнены. Принятие недоступно.'}
          </p>
          {(p['fullCampaignCopyDiffs'] as unknown as readonly AdmissionFullCopyDiff[]).map(
            (diff) => (
              <AdmissionDiff key={diff.reviewCopyIdOrNull} diff={diff} items={items} />
            ),
          )}
          {(
            p['incompleteReviews'] as unknown as readonly {
              reviewCopyId: string;
              beforeSheet: AdmissionMechanicalSheetV1;
              afterCore: AdmissionMechanicalCore;
            }[]
          ).map((copy) => (
            <section key={copy.reviewCopyId}>
              <h3>{copy.beforeSheet.identity.name}</h3>
              <details>
                <summary>Исходный лист</summary>
                <AdmissionSheet sheet={copy.beforeSheet} items={items} />
              </details>
              <details open>
                <summary>Текущий расчёт рабочей копии; обязательные поля ещё не завершены</summary>
                <CoreSheet core={copy.afterCore} />
              </details>
            </section>
          ))}
        </>
      ) : null}
      {formId === 'GM-020' ? (
        <section>
          <h3>Проверка исходного пула навыков</h3>
          <p>
            Занято {Number((p['skillRequirementsAndPoolValidation'] as JsonObject)['usedSlots'])} из{' '}
            {Number((p['skillRequirementsAndPoolValidation'] as JsonObject)['maxSlots'])}; свободно{' '}
            {Number((p['skillRequirementsAndPoolValidation'] as JsonObject)['remainingSlots'])}.
            Требования выполнены.
          </p>
          <h4>Неизменяемые выданные навыки</h4>
          <ul>
            {(p['immutableRaceAndClassGrants'] as readonly { label: string; bonus: number }[]).map(
              (s, index) => (
                <li key={index}>
                  {s.label} +{s.bonus}
                </li>
              ),
            )}
          </ul>
          <h4>Исходные навыки</h4>
          <ul>
            {(
              (p['originalStartingSkills'] as JsonObject)['entries'] as readonly {
                label: string;
                bonus: number;
              }[]
            ).map((s, index) => (
              <li key={index}>
                {s.label} +{s.bonus}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {p['campaignCopyDiff'] != null ? (
        <AdmissionDiff
          diff={p['campaignCopyDiff'] as unknown as AdmissionFullCopyDiff}
          items={items}
        />
      ) : null}
      {p['blockers'] === undefined ? null : (
        <>
          <h3>Условия, удерживающие в лобби</h3>
          {(p['blockers'] as readonly { message: string }[]).length === 0 ? (
            <p>Нет.</p>
          ) : (
            <ul>
              {(p['blockers'] as readonly { message: string }[]).map((b, index) => (
                <li key={index}>{b.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {p['missingRequiredFields'] === undefined ? null : (
        <ul>
          {(p['missingRequiredFields'] as readonly { code: string }[]).map((gap, index) => (
            <li key={index}>
              {
                (
                  {
                    GROUP_REQUIRED: 'Назначьте группу.',
                    LOCATION_REQUIRED: 'Укажите местоположение.',
                    WEAPON_REQUEST_REQUIRED: 'Примите решение по заявке оружия.',
                    WEAPON_PROFILE_REQUIRED: 'Определите профиль выданного оружия.',
                    GROUP_UNAVAILABLE: 'Выберите существующую группу кампании.',
                  } as Record<string, string>
                )[gap.code]
              }
            </li>
          ))}
        </ul>
      )}
      {localError === null ? null : <p role="alert">{localError}</p>}
    </section>
  );
}

function InventoryEditor({
  inputs,
  items,
  projection,
  onChange,
  onAllocate,
}: {
  inputs: AdmissionReviewInputs;
  items: readonly ItemLabel[];
  projection: JsonObject;
  onChange: (value: AdmissionReviewInputs) => void;
  onAllocate: () => void;
}): ReactElement {
  const inventory = inputs.inventoryReview,
    identities = projection['reviewItemIdentities'] as readonly {
      reviewItemId: string;
      sourceEntryIdOrNull: string | null;
    }[];
  const available = identities.filter(
    (row) =>
      row.sourceEntryIdOrNull === null &&
      !inventory.entries.some((entry) => entry.reviewItemId === row.reviewItemId),
  );
  const [selectedItem, setSelectedItem] = useState(items[0]?.itemTypeId ?? ''),
    [customName, setCustomName] = useState(''),
    [customDescription, setCustomDescription] = useState('');
  const replace = (entries: AdmissionReviewInputs['inventoryReview']['entries']) =>
    onChange({ ...inputs, inventoryReview: { ...inventory, entries } });
  const add = (custom: boolean) => {
    const id = available[0]?.reviewItemId;
    if (id === undefined) return;
    replace([
      ...inventory.entries,
      {
        reviewItemId: id,
        sourceEntryIdOrNull: null,
        item: custom
          ? {
              kind: 'CUSTOM_ITEM',
              name: customName,
              description: customDescription,
              statBonusOrNull: null,
            }
          : { kind: 'CATALOG', itemTypeId: selectedItem },
        quantity: 1,
        qualityLabel: (
          (projection['catalogs'] as JsonObject)['qualities'] as readonly string[]
        )[0]!,
        weaponDecisionReceiptIdOrNull: null,
      },
    ]);
  };
  return (
    <section>
      <h3>Имущество</h3>
      <label>
        <input
          type="checkbox"
          checked={inventory.status === 'FINAL'}
          onChange={(e) =>
            onChange({
              ...inputs,
              inventoryReview: { ...inventory, status: e.target.checked ? 'FINAL' : 'PENDING' },
            })
          }
        />
        Состав имущества подтверждён
      </label>
      <ul>
        {inventory.entries.map((entry) => (
          <li key={entry.reviewItemId}>
            {itemName(entry.item, items)}
            <label>
              Количество
              <input
                type="number"
                min="1"
                step="1"
                value={entry.quantity}
                onChange={(e) =>
                  replace(
                    inventory.entries.map((row) =>
                      row === entry ? { ...row, quantity: e.target.valueAsNumber } : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Качество
              <select
                value={entry.qualityLabel}
                onChange={(e) =>
                  replace(
                    inventory.entries.map((row) =>
                      row === entry ? { ...row, qualityLabel: e.target.value } : row,
                    ),
                  )
                }
              >
                {!(
                  (projection['catalogs'] as JsonObject)['qualities'] as readonly string[]
                ).includes(entry.qualityLabel) ? (
                  <option>{entry.qualityLabel}</option>
                ) : null}
                {((projection['catalogs'] as JsonObject)['qualities'] as readonly string[]).map(
                  (quality) => (
                    <option key={quality}>{quality}</option>
                  ),
                )}
              </select>
            </label>
            {entry.item.kind === 'CUSTOM_ITEM' ? (
              <>
                <label>
                  Название предмета
                  <input
                    value={entry.item.name}
                    onChange={(e) =>
                      replace(
                        inventory.entries.map((row) =>
                          row === entry && row.item.kind === 'CUSTOM_ITEM'
                            ? { ...row, item: { ...row.item, name: e.target.value } }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Описание предмета
                  <textarea
                    value={entry.item.description}
                    onChange={(e) =>
                      replace(
                        inventory.entries.map((row) =>
                          row === entry && row.item.kind === 'CUSTOM_ITEM'
                            ? { ...row, item: { ...row.item, description: e.target.value } }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Бонус характеристики у предмета
                  <select
                    value={entry.item.statBonusOrNull?.statCode ?? ''}
                    onChange={(e) =>
                      replace(
                        inventory.entries.map((row) =>
                          row === entry && row.item.kind === 'CUSTOM_ITEM'
                            ? {
                                ...row,
                                item: {
                                  ...row.item,
                                  statBonusOrNull:
                                    e.target.value === ''
                                      ? null
                                      : {
                                          statCode: r.oneOf(e.target.value, STATS, '$.stat'),
                                          positiveIntegerBonus:
                                            row.item.statBonusOrNull?.positiveIntegerBonus ?? 1,
                                        },
                                },
                              }
                            : row,
                        ),
                      )
                    }
                  >
                    <option value="">Нет бонуса</option>
                    {STATS.map((stat) => (
                      <option key={stat} value={stat}>
                        {STAT_LABELS[stat]}
                      </option>
                    ))}
                  </select>
                </label>
                {entry.item.statBonusOrNull === null ? null : (
                  <label>
                    Положительный бонус за единицу
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={entry.item.statBonusOrNull.positiveIntegerBonus}
                      onChange={(e) =>
                        replace(
                          inventory.entries.map((row) =>
                            row === entry &&
                            row.item.kind === 'CUSTOM_ITEM' &&
                            row.item.statBonusOrNull !== null
                              ? {
                                  ...row,
                                  item: {
                                    ...row.item,
                                    statBonusOrNull: {
                                      ...row.item.statBonusOrNull,
                                      positiveIntegerBonus: e.target.valueAsNumber,
                                    },
                                  },
                                }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                )}
              </>
            ) : null}
            <button
              type="button"
              onClick={() => replace(inventory.entries.filter((row) => row !== entry))}
            >
              Убрать из копии
            </button>
          </li>
        ))}
      </ul>
      {inventory.unresolvedSourceEntryIds.length > 0 ? (
        <>
          <p>
            Неразрешённых исходных позиций: {inventory.unresolvedSourceEntryIds.length}. Определите
            замену или явно подтвердите отсутствие выдачи.
          </p>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...inputs,
                inventoryReview: { ...inventory, unresolvedSourceEntryIds: [] },
              })
            }
          >
            Исходные неопределённые позиции разобраны
          </button>
        </>
      ) : null}
      <button type="button" onClick={onAllocate}>
        Подготовить новую позицию
      </button>
      <p>Подготовлено свободных позиций: {available.length}.</p>
      <label>
        Предмет каталога
        <select value={selectedItem} onChange={(e) => setSelectedItem(e.target.value)}>
          {items.map((item) => (
            <option key={item.itemTypeId} value={item.itemTypeId}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={available.length === 0} onClick={() => add(false)}>
        Добавить предмет
      </button>
      <label>
        Название собственного предмета
        <input value={customName} onChange={(e) => setCustomName(e.target.value)} />
      </label>
      <label>
        Описание собственного предмета
        <textarea
          value={customDescription}
          onChange={(e) => setCustomDescription(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={available.length === 0 || customName.trim() === ''}
        onClick={() => add(true)}
      >
        Добавить собственный предмет
      </button>
    </section>
  );
}
function GroupEditor({
  inputs,
  projection,
  onChange,
  onAllocate,
}: {
  inputs: AdmissionReviewInputs;
  projection: JsonObject;
  onChange: (value: AdmissionReviewInputs) => void;
  onAllocate: () => void;
}): ReactElement {
  const group = inputs.groupAssignmentOrNull,
    ids = projection['groupDraftIds'] as readonly string[],
    existing = projection['existingGroups'] as readonly { groupId: string; name: string }[];
  return (
    <section>
      <h3>Группа и местоположение</h3>
      <label>
        Группа
        <select
          value={
            group === null
              ? ''
              : group.kind === 'START'
                ? 'START'
                : group.kind === 'EXISTING'
                  ? group.groupId
                  : group.groupDraftId
          }
          onChange={(e) => {
            const id = e.target.value;
            onChange({
              ...inputs,
              groupAssignmentOrNull:
                id === ''
                  ? null
                  : id === 'START'
                    ? { kind: 'START' }
                    : ids.includes(id)
                      ? { kind: 'NEW', groupDraftId: id, name: '' }
                      : { kind: 'EXISTING', groupId: id },
            });
          }}
        >
          <option value="">Не назначена</option>
          <option value="START">Стартовая группа</option>
          {existing.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.name}
            </option>
          ))}
          {ids.map((id, index) => (
            <option key={id} value={id}>
              Новая группа {index + 1}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onAllocate}>
        Подготовить новую группу
      </button>
      {group?.kind === 'NEW' ? (
        <label>
          Название группы
          <input
            value={group.name}
            onChange={(e) =>
              onChange({ ...inputs, groupAssignmentOrNull: { ...group, name: e.target.value } })
            }
          />
        </label>
      ) : null}
      <label>
        Локация
        <input
          value={inputs.locationAssignmentOrNull?.location ?? ''}
          onChange={(e) =>
            onChange({
              ...inputs,
              locationAssignmentOrNull: {
                location: e.target.value,
                subLocationOrNull: inputs.locationAssignmentOrNull?.subLocationOrNull ?? null,
              },
            })
          }
        />
      </label>
      <label>
        Подлокация
        <input
          value={inputs.locationAssignmentOrNull?.subLocationOrNull ?? ''}
          onChange={(e) =>
            onChange({
              ...inputs,
              locationAssignmentOrNull: {
                location: inputs.locationAssignmentOrNull?.location ?? '',
                subLocationOrNull: e.target.value === '' ? null : e.target.value,
              },
            })
          }
        />
      </label>
    </section>
  );
}
function WeaponEditor({
  projection: p,
  items,
  onChange,
}: {
  projection: JsonObject;
  items: readonly ItemLabel[];
  onChange: (value: AdmissionWeaponResolutionInput) => void;
}): ReactElement {
  const requests = p['validatedWeaponRequests'] as unknown as readonly {
      requestId: string;
      validationReceiptId: string;
      proposedWeaponProfile: AdmissionPublicWeaponProfile | null;
    }[],
    grants = (
      p['grantItems'] as unknown as AdmissionReviewInputs['inventoryReview']['entries']
    ).filter(
      (entry) => entry.item.kind === 'CATALOG' && entry.item.itemTypeId.startsWith('ITM-WPN-'),
    ),
    templates = p['weaponTemplates'] as unknown as readonly {
      templateId: string;
      profile: AdmissionPublicWeaponProfile;
    }[];
  const [input, setInput] = useState<AdmissionWeaponResolutionInput | null>(
    () => p['weaponDraftOrNull'] as unknown as AdmissionWeaponResolutionInput | null,
  );
  const [reason, setReason] = useState('');
  const [template, setTemplate] = useState('');
  const [grant, setGrant] = useState('');
  const [override, setOverride] = useState<AdmissionMasterWeaponProfileInput | null>(
    () => input?.overrideProfileOrNull ?? null,
  );
  const [grantProfile, setGrantProfile] = useState<AdmissionMasterWeaponProfileInput | null>(null);
  const variants = p['weaponVariants'] as unknown as readonly {
    weaponTypeId: string;
    weaponVariantId: AdmissionMasterWeaponProfileInput['weaponVariantId'];
    name: string;
    variantLabel: string;
  }[];
  const stageGrant = () => {
    const entry = grants.find((row) => row.reviewItemId === grant),
      profile = templates.find((row) => row.templateId === template);
    if (
      entry?.item.kind !== 'CATALOG' ||
      (grantProfile === null &&
        (profile === undefined || profile.profile.weaponTypeId !== entry.item.itemTypeId))
    )
      return;
    setInput({
      weaponReviewInput: {
        kind: 'ADMISSION_GRANT',
        reviewItemId: entry.reviewItemId,
        weaponTypeId: entry.item.itemTypeId,
        reason,
        profileSource:
          grantProfile === null
            ? { kind: 'CATALOG_TEMPLATE', templateId: template }
            : { kind: 'GM_DEFINED', typedProfile: grantProfile },
      },
      decision: 'MASTER_OVERRIDE',
      overrideProfileOrNull: null,
      reasonOrNull: null,
    });
  };
  return (
    <fieldset disabled={p['editable'] !== true}>
      <legend>Решение по оружию</legend>
      <label>
        Исходная заявка
        <select
          value={
            input?.weaponReviewInput.kind === 'VALIDATED_REQUEST'
              ? input.weaponReviewInput.requestId
              : ''
          }
          onChange={(e) => {
            const request = requests.find((row) => row.requestId === e.target.value);
            if (request !== undefined)
              setInput({
                weaponReviewInput: {
                  kind: 'VALIDATED_REQUEST',
                  requestId: request.requestId,
                  validationReceiptId: request.validationReceiptId,
                },
                decision: 'APPROVE',
                overrideProfileOrNull: null,
                reasonOrNull: null,
              });
          }}
        >
          <option value="">Выберите заявку</option>
          {requests.map((request, index) => (
            <option key={request.requestId} value={request.requestId}>
              {request.proposedWeaponProfile?.name ?? `Заявка ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      {grants.length > 0 ? (
        <>
          <label>
            Выданное оружие
            <select value={grant} onChange={(e) => setGrant(e.target.value)}>
              <option value="">Выберите предмет</option>
              {grants.map((entry) => (
                <option key={entry.reviewItemId} value={entry.reviewItemId}>
                  {itemName(entry.item, items)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Готовый профиль
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Выберите профиль</option>
              {templates
                .filter((row) => {
                  const entry = grants.find((g) => g.reviewItemId === grant);
                  return (
                    entry?.item.kind === 'CATALOG' &&
                    row.profile.weaponTypeId === entry.item.itemTypeId
                  );
                })
                .map((row) => (
                  <option key={row.templateId} value={row.templateId}>
                    {row.profile.name} — {row.profile.variantLabel}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Основание выдачи
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            Собственный профиль мастера — вариант оружия
            <select
              value={grantProfile?.weaponVariantId ?? ''}
              onChange={(e) => {
                const entry = grants.find((v) => v.reviewItemId === grant);
                const variant = variants.find(
                  (v) =>
                    entry?.item.kind === 'CATALOG' &&
                    v.weaponTypeId === entry.item.itemTypeId &&
                    v.weaponVariantId === e.target.value,
                );
                setGrantProfile(
                  variant === undefined
                    ? null
                    : {
                        weaponVariantId: variant.weaponVariantId,
                        damageDefinition: { kind: 'RETAIN' },
                        penetrationDefinition: { kind: 'RETAIN' },
                        statRequirements: {},
                        instanceDamageOrNull: null,
                        rangeMetersOrNull: null,
                        accuracyBonusOrNull: null,
                      },
                );
              }}
            >
              <option value="">Использовать готовый профиль</option>
              {variants
                .filter((v) => {
                  const entry = grants.find((g) => g.reviewItemId === grant);
                  return entry?.item.kind === 'CATALOG' && v.weaponTypeId === entry.item.itemTypeId;
                })
                .map((v) => (
                  <option key={v.weaponVariantId} value={v.weaponVariantId}>
                    {v.variantLabel}
                  </option>
                ))}
            </select>
          </label>
          {grantProfile === null ? null : (
            <ProfileEditor value={grantProfile} onChange={setGrantProfile} />
          )}
          <button type="button" onClick={stageGrant}>
            Выбрать профиль выдачи
          </button>
        </>
      ) : null}
      {input !== null ? (
        <>
          {input.weaponReviewInput.kind === 'VALIDATED_REQUEST' ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={input.decision === 'MASTER_OVERRIDE'}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      setInput({
                        ...input,
                        decision: 'APPROVE',
                        overrideProfileOrNull: null,
                        reasonOrNull: null,
                      });
                      return;
                    }
                    const weaponInput = input.weaponReviewInput;
                    const current =
                      weaponInput.kind === 'VALIDATED_REQUEST'
                        ? requests.find((row) => row.requestId === weaponInput.requestId)
                            ?.proposedWeaponProfile
                        : templates.find(
                            (row) =>
                              input.weaponReviewInput.kind === 'ADMISSION_GRANT' &&
                              input.weaponReviewInput.profileSource.kind === 'CATALOG_TEMPLATE' &&
                              row.templateId === input.weaponReviewInput.profileSource.templateId,
                          )?.profile;
                    if (current == null) return;
                    const typed: AdmissionMasterWeaponProfileInput = {
                      weaponVariantId: current.weaponVariantId,
                      damageDefinition: { kind: 'RETAIN' },
                      penetrationDefinition: { kind: 'RETAIN' },
                      statRequirements: current.statRequirements,
                      instanceDamageOrNull: current.instanceDamageOrNull,
                      rangeMetersOrNull: current.rangeMetersOrNull,
                      accuracyBonusOrNull: current.accuracyBonusOrNull,
                    };
                    setOverride(typed);
                    setInput({
                      ...input,
                      decision: 'MASTER_OVERRIDE',
                      overrideProfileOrNull: typed,
                      reasonOrNull: reason,
                    });
                  }}
                />
                Заменить механический профиль решением мастера
              </label>
              {input.decision === 'MASTER_OVERRIDE' && override !== null ? (
                <>
                  <ProfileEditor
                    value={override}
                    onChange={(value) => {
                      setOverride(value);
                      setInput({ ...input, overrideProfileOrNull: value });
                    }}
                  />
                  <label>
                    Причина изменения профиля
                    <input
                      value={input.reasonOrNull ?? ''}
                      onChange={(e) => setInput({ ...input, reasonOrNull: e.target.value })}
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : (
            <p>Подготовлено выданное оружие. Основание: {input.weaponReviewInput.reason}</p>
          )}
          <button type="button" onClick={() => onChange(input)}>
            Проверить и сохранить решение по оружию
          </button>
        </>
      ) : null}
      {p['profileVersionOrStagedDecisionPreview'] === null ? (
        <p>Подтверждённого предварительного профиля ещё нет.</p>
      ) : (
        <WeaponProfile
          profile={
            p['profileVersionOrStagedDecisionPreview'] as unknown as AdmissionPublicWeaponProfile
          }
        />
      )}
    </fieldset>
  );
}
function ProfileEditor({
  value,
  onChange,
}: {
  value: AdmissionMasterWeaponProfileInput;
  onChange: (value: AdmissionMasterWeaponProfileInput) => void;
}): ReactElement {
  return (
    <section>
      {(['damageDefinition', 'penetrationDefinition'] as const).map((key) => {
        const expression = value[key];
        return (
          <fieldset key={key}>
            <legend>{key === 'damageDefinition' ? 'Урон' : 'Пробитие'}</legend>
            <select
              aria-label={key === 'damageDefinition' ? 'Формула урона' : 'Формула пробития'}
              value={expression.kind === 'RETAIN' ? 'RETAIN' : expression.pattern}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]:
                    e.target.value === 'RETAIN'
                      ? { kind: 'RETAIN' }
                      : {
                          kind: 'MASTER_DICE',
                          pattern: e.target.value,
                          constantOrNull: e.target.value.includes('+X') ? 1 : null,
                        },
                })
              }
            >
              {['RETAIN', 'R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'].map(
                (pattern) => (
                  <option key={pattern} value={pattern}>
                    {pattern === 'RETAIN' ? 'Сохранить исходное' : pattern}
                  </option>
                ),
              )}
            </select>
            {expression.kind === 'MASTER_DICE' && expression.constantOrNull !== null ? (
              <label>
                Положительное X
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={expression.constantOrNull}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [key]: { ...expression, constantOrNull: e.target.valueAsNumber },
                    })
                  }
                />
              </label>
            ) : null}
          </fieldset>
        );
      })}
      {STATS.map((stat) => (
        <label key={stat}>
          Требование: {STAT_LABELS[stat]}
          <input
            type="number"
            min="0"
            step="1"
            value={value.statRequirements[stat] ?? ''}
            onChange={(e) => {
              const next = { ...value.statRequirements };
              if (e.target.value === '') delete next[stat];
              else next[stat] = e.target.valueAsNumber;
              onChange({ ...value, statRequirements: next });
            }}
          />
        </label>
      ))}
      {(['instanceDamageOrNull', 'rangeMetersOrNull', 'accuracyBonusOrNull'] as const).map(
        (key) => (
          <label key={key}>
            {key === 'instanceDamageOrNull'
              ? 'Значение урона экземпляра'
              : key === 'rangeMetersOrNull'
                ? 'Дальность, м'
                : 'Бонус точности'}
            <input
              type="number"
              step="any"
              value={value[key] ?? ''}
              onChange={(e) =>
                onChange({ ...value, [key]: e.target.value === '' ? null : e.target.valueAsNumber })
              }
            />
          </label>
        ),
      )}
    </section>
  );
}
