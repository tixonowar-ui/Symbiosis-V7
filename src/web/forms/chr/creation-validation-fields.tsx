import type { ReactElement } from 'react';
import type { JsonObject, JsonValue } from '@shared/index.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import type { Chr032Projection, Chr025Projection } from './creation-validation.js';

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function label(value: JsonValue | undefined): string {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? text((value as JsonObject)['label'])
    : '';
}
export function CreationValidationFields({
  snapshot,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId === 'CHR-032') {
    const p = snapshot.projection as Chr032Projection;
    const pieces = p.armorBundle['armorPieces'] as readonly JsonObject[];
    return (
      <section aria-label="Итог восьми имущественных операций">
        <h2>Восемь имущественных операций подтверждены</h2>
        <p>
          Предметы принадлежат персонажу и не экипированы. Результаты качества и денег остаются
          рекомендациями для мастера.
        </p>
        <h3>Комплект брони</h3>
        {p.nextFormId === 'CHR-041' ? (
          <p>
            После подтверждения нужно заполнить освободившиеся слоты навыков Советника. Его прежние
            броски I и W сохраняются.
          </p>
        ) : null}
        <ul>
          {pieces.map((piece) => (
            <li key={text(piece['itemId']) + text(piece['bodyZone'])}>
              {text(piece['name'])} {text(piece['bodyZone'])}
            </li>
          ))}
        </ul>
        <p>Качество: {label(p.armorBundle['qualityRecommendation'])}</p>
        <h3>Оружие: {text(p.weapon['name'])}</h3>
        <p>Качество: {label(p.weapon['qualityRecommendation'])}</p>
        <dl>
          {(p.weapon['profileFacts'] as readonly JsonObject[]).map((f) => (
            <div key={text(f['label'])}>
              <dt>{text(f['label'])}</dt>
              <dd>
                {typeof f['value'] === 'boolean' ? (f['value'] ? 'Да' : 'Нет') : text(f['value'])}
              </dd>
            </div>
          ))}
        </dl>
        <h3>Деньги</h3>
        <p>{label(p.moneyRecommendation['wealthRecommendation'])}. Требуется решение мастера.</p>
        <h3>Пять позиций</h3>
        <ol>
          {p.fivePositions.map((position) => (
            <li key={text(position['positionId'])}>
              {text(position['name'])} × {text(position['quantity'])}:{' '}
              {label(position['qualityRecommendation'])}
              {position['storyDescriptionOrNull'] === null
                ? ''
                : ` — ${text(position['storyDescriptionOrNull'])}`}
            </li>
          ))}
        </ol>
        <p>
          Количество операций: {p.exactOperationCount}. Проверка массы:{' '}
          {p.massAndMandatoryRowsStatus['valid'] ? 'пройдена' : 'требует исправления'}. Утверждение
          массы мастером ожидается.
        </p>
      </section>
    );
  }
  if (snapshot.formId !== 'CHR-025') return null;
  const p = snapshot.projection as Chr025Projection;
  const checks = [
    ['Идентичность и масса', p.identityAndMassStatus['valid']],
    ['Семь характеристик не ниже единицы', p.sevenStatsMinOne],
    ['Навыки и слоты', p.skillsAndSlotsStatus['valid']],
    ['Состав симбионтов', p.symbiontCompositionStatus['valid']],
    ['Восемь имущественных квитанций', p.startingPropertyEightReceiptsStatus['valid']],
    ['Начальное состояние', p.cleanRuntimeState],
    ['Целостность сохранённых ветвей', p.branchCacheIntegrity],
  ] as const;
  return (
    <section aria-label="Итог создания и валидация">
      <h2>
        {p.finalSaveStatus === 'COMMITTED'
          ? 'Персонаж окончательно сохранён'
          : 'Итоговая проверка персонажа'}
      </h2>
      <p>
        {text(p.identity['name'])}, {text(p.identity['age'])} лет. Масса:{' '}
        {text(p.identity['massKg'])} кг.
      </p>
      <p>
        Допустимая масса: {text(p.identityAndMassStatus['minimumKg'])}–
        {text(p.identityAndMassStatus['maximumKg'])} кг включительно. Утверждение мастером
        ожидается.
      </p>
      <ul>
        {checks.map(([name, valid]) => (
          <li key={name}>
            {name}: {valid ? 'пройдено' : 'требует исправления'}
          </li>
        ))}
      </ul>
      <p>
        Слоты навыков: {text(p.skillsAndSlotsStatus['used'])} /{' '}
        {text(p.skillsAndSlotsStatus['required'])}.
      </p>
      {p.effectiveStatsOrNull === null ? null : (
        <table>
          <caption>Итоговые характеристики</caption>
          <thead>
            <tr>
              <th>Характеристика</th>
              <th>До симбионтов</th>
              <th>Итог</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(p.effectiveStatsOrNull).map(([code, value]) => (
              <tr key={code}>
                <th>{code}</th>
                <td>{text(p.skillStageStatsOrNull?.[code])}</td>
                <td>{text(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.validationBlockers.length === 0 ? (
        <p>
          {p.finalSaveStatus === 'COMMITTED'
            ? 'Создание завершено. Данные доступны только для чтения.'
            : 'Все обязательные проверки пройдены. Можно сохранить персонажа.'}
        </p>
      ) : (
        <ul aria-label="Что требуется исправить">
          {p.validationBlockers.map((b) => (
            <li key={b.code}>{b.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
