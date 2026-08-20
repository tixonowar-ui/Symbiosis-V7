import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';

import { CHARACTER_ART_ACCEPT, characterArtFromFile } from './character-art.js';
import { AtlasForm } from './renderer/atlas-form.js';
import { connectProjection } from './ws-client.js';
import type {
  App001Projection,
  CharacterCreationChoiceDraft,
  CharacterCreationRollDraft,
  CharacterSkillSelectionDraft,
  CharacterStatAssignmentDraft,
  CharacterSetDecisionProjection,
  Chr002Projection,
  Chr003Projection,
  Chr004Projection,
  Chr009Projection,
  Chr010Projection,
  Chr011Projection,
  Chr012Projection,
  Chr013Projection,
  Chr015Projection,
  Chr016Projection,
  ConfirmedPresentationLayer,
  ConfirmedProjectionSnapshot,
  FormActionRequestResult,
  IdentityDraftClientState,
  IdentityDraftValues,
  MethodConsequencesProjection,
  ModeConsequencesProjection,
  RaceConsequencesPreviewProjection,
  ProjectionConnection,
  StatCode,
  StatModifierEffectProjection,
  WebClientState,
} from './ws-client.js';

const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const satisfies readonly StatCode[];

const LOCAL_CHARACTER_PORTRAIT_ASSET_KEY_SET: ReadonlySet<string> = new Set(
  LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS,
);
const CHR_001_CHECKPOINT_ACTION_KEY = 'CHR-001::CTA::001';

const ART_REFUSAL_MESSAGES = {
  ASSET_NOT_FOUND: 'Выбранная заглушка отсутствует в каталоге хоста.',
  EMPTY_ASSET_KEY: 'Выберите непустой ключ заглушки.',
  FILE_TOO_LARGE: 'Файл превышает допустимый размер 12 МБ.',
  MEDIA_SIGNATURE_MISMATCH: 'Сигнатура файла не совпала с подтверждённым типом PNG или JPEG.',
  NON_CANONICAL_BASE64: 'Хост не смог подтвердить каноническое содержимое файла.',
} as const;

function ConnectionBanner({ state }: { readonly state: WebClientState }): ReactElement {
  switch (state.kind) {
    case 'connecting':
      return (
        <section role="status" data-client-state={state.kind}>
          <h1>Подключение к хосту</h1>
          <p>Снимок APP-001 ещё не получен; обязательные поля не подставляются.</p>
        </section>
      );
    case 'awaiting-snapshot':
      return (
        <section role="status" data-client-state={state.kind}>
          <h1>Ожидание APP-001</h1>
          <p>session.reconnect отправлен; клиент ждёт проверенную пару хоста.</p>
        </section>
      );
    case 'ready':
      return (
        <section role="status" data-client-state={state.kind}>
          <h1>{state.snapshot.formId} получена от хоста</h1>
          <p>Показана последняя подтверждённая проекция.</p>
        </section>
      );
    case 'navigation-refusal':
      return (
        <section role="alert" data-client-state={state.kind}>
          <h1>Переход отклонён хостом</h1>
          <pre>{JSON.stringify(state.refusal, null, 2)}</pre>
        </section>
      );
    case 'command-refusal':
      return (
        <section role="alert" data-client-state={state.kind}>
          <h1>Шаг создания отклонён хостом</h1>
          <pre>{JSON.stringify(state.refusal, null, 2)}</pre>
        </section>
      );
    case 'host-refusal':
      return (
        <section role="alert" data-client-state={state.kind}>
          <h1>Хост отказал в подключении</h1>
          <pre>{JSON.stringify(state.refusal, null, 2)}</pre>
        </section>
      );
    case 'protocol-error':
      return (
        <section role="alert" data-client-state={state.kind}>
          <h1>Ошибка wire-протокола</h1>
          <p>{state.detail}</p>
          <pre>{JSON.stringify(state.refusal, null, 2)}</pre>
        </section>
      );
    case 'disconnected':
      return (
        <section role="alert" data-client-state={state.kind}>
          <h1>Связь с хостом оборвана</h1>
          <p>{state.detail}</p>
          <p>
            {state.snapshot === null
              ? 'Подтверждённые данные APP-001 не были получены.'
              : 'Последняя подтверждённая проекция оставлена только для чтения.'}
          </p>
        </section>
      );
    case 'client-error':
      return (
        <section role="alert" data-client-state={state.kind}>
          <h1>Веб-клиент не запустился</h1>
          <p>{state.detail}</p>
          <p>Данные APP-001 отсутствуют и не заменены значениями по умолчанию.</p>
        </section>
      );
  }
}

function confirmedSnapshot(state: WebClientState): ConfirmedProjectionSnapshot | null {
  switch (state.kind) {
    case 'ready':
    case 'command-refusal':
    case 'navigation-refusal':
    case 'disconnected':
    case 'host-refusal':
    case 'protocol-error':
      return state.snapshot;
    case 'awaiting-snapshot':
    case 'client-error':
    case 'connecting':
      return null;
  }
}

function displayValue(key: string, value: unknown): string {
  if (
    key === 'artAssetKeyOrLocalFile' &&
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['kind'] === 'local-file'
  ) {
    const localFile = value as Record<string, unknown>;
    return JSON.stringify(
      {
        bytesBase64: '[omitted from presentation]',
        kind: localFile['kind'],
        mediaType: localFile['mediaType'],
      },
      null,
      2,
    );
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function HostProjection({ snapshot }: { readonly snapshot: ConfirmedProjectionSnapshot }) {
  if (snapshot.formId === 'APP-001') {
    const projection = snapshot.projection as App001Projection;
    return (
      <section aria-labelledby="app-001-host-data" data-app-001-host-data>
        <h2 id="app-001-host-data">Обязательные поля из projection.snapshot</h2>
        <dl>
          <dt>buildVersion</dt>
          <dd data-host-field="buildVersion">{projection.buildVersion}</dd>
          <dt>baselineCompatibility</dt>
          <dd data-host-field="baselineCompatibility">
            <pre>{JSON.stringify(projection.baselineCompatibility, null, 2)}</pre>
          </dd>
          <dt>integrityStatus</dt>
          <dd data-host-field="integrityStatus">
            <pre>{JSON.stringify(projection.integrityStatus, null, 2)}</pre>
          </dd>
          <dt>bootState</dt>
          <dd data-host-field="bootState">{projection.bootState}</dd>
        </dl>
      </section>
    );
  }
  return (
    <section aria-labelledby="host-projection-data" data-host-projection={snapshot.formId}>
      <h2 id="host-projection-data">Поля из projection.snapshot</h2>
      <dl>
        {Object.entries(snapshot.projection).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd data-host-field={key}>
              <pre>{displayValue(key, value)}</pre>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function IdentityRefusalAlert({
  refusal,
}: {
  readonly refusal: NonNullable<IdentityDraftClientState['lastRefusal']>;
}): ReactElement {
  if (refusal.code === 'INVALID_FIELD' && refusal.error.field === 'artAssetKeyOrLocalFile') {
    return (
      <section role="alert" data-identity-refusal-field="artAssetKeyOrLocalFile">
        <strong>Поле «Арт персонажа» отклонено хостом.</strong>
        <p>{ART_REFUSAL_MESSAGES[refusal.error.reason]}</p>
      </section>
    );
  }
  return <pre role="alert">{JSON.stringify(refusal, null, 2)}</pre>;
}

function IdentityFields({
  draft,
  fileReadPending,
  onChange,
  onFileReadPendingChange,
}: {
  readonly draft: IdentityDraftClientState;
  readonly fileReadPending: boolean;
  readonly onChange: (values: IdentityDraftValues) => FormActionRequestResult;
  readonly onFileReadPendingChange: (pending: boolean) => void;
}) {
  const values = draft.widgetValues;
  const valuesRef = useRef(values);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileReadRef = useRef<object | null>(null);
  const [localArtError, setLocalArtError] = useState<string | null>(null);
  const [localArtStatus, setLocalArtStatus] = useState<string | null>(null);
  const replace = (patch: Partial<IdentityDraftValues>) => {
    const next = { ...valuesRef.current, ...patch };
    valuesRef.current = next;
    return onChange(next);
  };
  const number = (raw: string): number | null => (raw === '' ? null : Number(raw));
  const art = values.artAssetKeyOrLocalFile;
  const invalidatePendingFileRead = () => {
    pendingFileReadRef.current = null;
    onFileReadPendingChange(false);
    setLocalArtStatus(null);
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
  };
  const artRefusal =
    draft.lastRefusal?.code === 'INVALID_FIELD' &&
    draft.lastRefusal.error.field === 'artAssetKeyOrLocalFile'
      ? draft.lastRefusal
      : null;
  const artFeedbackId =
    localArtError === null && artRefusal === null ? undefined : 'chr-001-character-art-feedback';
  useLayoutEffect(() => {
    valuesRef.current = values;
  }, [values]);
  useEffect(() => {
    return () => {
      pendingFileReadRef.current = null;
      onFileReadPendingChange(false);
    };
  }, [onFileReadPendingChange]);
  return (
    <section aria-label="Черновик идентичности" data-identity-dirty={draft.dirty}>
      {(
        [
          ['Имя', 'name', 'text', undefined],
          ['Возраст', 'age', 'number', 'any'],
          ['Масса, кг', 'massKg', 'number', '0.1'],
          ['Описание', 'description', 'text', undefined],
        ] as const
      ).map(([label, key, type, step]) => {
        const value = values[key] ?? '';
        return (
          <label key={key}>
            {label}{' '}
            <input
              data-identity-field={key}
              type={type}
              step={step}
              value={value}
              onChange={(event) => {
                const raw = event.target.value;
                replace(
                  type === 'number'
                    ? { [key]: number(raw) }
                    : {
                        [key]: raw || null,
                      },
                );
              }}
            />
          </label>
        );
      })}
      <fieldset aria-busy={fileReadPending}>
        <legend>Арт персонажа</legend>
        <label>
          Заглушка из каталога{' '}
          <select
            aria-describedby={artFeedbackId}
            aria-invalid={artFeedbackId === undefined ? undefined : true}
            data-character-art-placeholder
            value={art?.kind === 'asset-key' ? art.assetKey : ''}
            onChange={(event) => {
              const assetKey = event.target.value;
              if (assetKey !== '' && !LOCAL_CHARACTER_PORTRAIT_ASSET_KEY_SET.has(assetKey)) {
                throw new Error(
                  `unrecognized CHR-001 portrait asset key ${JSON.stringify(assetKey)}`,
                );
              }
              invalidatePendingFileRead();
              setLocalArtError(null);
              replace({
                artAssetKeyOrLocalFile: assetKey === '' ? null : { assetKey, kind: 'asset-key' },
              });
            }}
          >
            <option value="">—</option>
            {LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS.map((assetKey) => (
              <option key={assetKey} value={assetKey}>
                {assetKey}
              </option>
            ))}
          </select>
        </label>
        <label>
          Файл PNG или JPEG{' '}
          <input
            ref={fileInputRef}
            accept={CHARACTER_ART_ACCEPT}
            aria-describedby={artFeedbackId}
            aria-invalid={artFeedbackId === undefined ? undefined : true}
            data-character-art-file
            type="file"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (file === undefined) return;
              const readToken = {};
              pendingFileReadRef.current = readToken;
              onFileReadPendingChange(true);
              setLocalArtError(null);
              setLocalArtStatus('Чтение файла…');
              void characterArtFromFile(file)
                .then((result) => {
                  if (pendingFileReadRef.current !== readToken) return;
                  pendingFileReadRef.current = null;
                  if (!result.ok) {
                    onFileReadPendingChange(false);
                    setLocalArtStatus(null);
                    setLocalArtError(
                      result.reason === 'FILE_TOO_LARGE'
                        ? 'Поле «Арт персонажа»: файл превышает допустимый размер 12 МБ.'
                        : 'Поле «Арт персонажа»: содержимое файла не является PNG или JPEG.',
                    );
                    return;
                  }
                  const update = replace({ artAssetKeyOrLocalFile: result.value });
                  onFileReadPendingChange(false);
                  if (!update.ok) {
                    setLocalArtStatus(null);
                    setLocalArtError(
                      'Поле «Арт персонажа»: изменение не отправлено; черновик недоступен.',
                    );
                  } else {
                    setLocalArtStatus('Файл прочитан и отправлен хосту.');
                  }
                })
                .catch(() => {
                  if (pendingFileReadRef.current !== readToken) return;
                  pendingFileReadRef.current = null;
                  onFileReadPendingChange(false);
                  setLocalArtStatus(null);
                  setLocalArtError('Поле «Арт персонажа»: файл не удалось прочитать.');
                });
            }}
          />
        </label>
        <p data-character-art-current>
          {art === null
            ? 'Арт не выбран.'
            : art.kind === 'asset-key'
              ? `Заглушка: ${art.assetKey}`
              : `Локальный файл: ${art.mediaType}`}
        </p>
        <button
          data-character-art-clear
          type="button"
          onClick={() => {
            invalidatePendingFileRead();
            setLocalArtError(null);
            replace({ artAssetKeyOrLocalFile: null });
          }}
        >
          Снять арт
        </button>
        {localArtStatus === null ? null : (
          <p aria-live="polite" data-character-art-status role="status">
            {localArtStatus}
          </p>
        )}
        {artFeedbackId === undefined ? null : (
          <div id={artFeedbackId}>
            {localArtError === null ? null : (
              <p role="alert" data-character-art-local-error>
                {localArtError}
              </p>
            )}
            {artRefusal === null ? null : <IdentityRefusalAlert refusal={artRefusal} />}
          </div>
        )}
      </fieldset>
      <label>
        Пол{' '}
        <select
          data-identity-field="sex"
          value={values.sex ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw !== '' && raw !== 'MALE' && raw !== 'FEMALE') {
              throw new Error(`unrecognized CHR-001 sex value ${JSON.stringify(raw)}`);
            }
            replace({ sex: raw === '' ? null : raw });
          }}
        >
          <option value="">—</option>
          <option value="MALE">MALE</option>
          <option value="FEMALE">FEMALE</option>
        </select>
      </label>
      {draft.lastRefusal === null || artRefusal !== null ? null : (
        <IdentityRefusalAlert refusal={draft.lastRefusal} />
      )}
    </section>
  );
}

function CharacterCreationRollFields({
  draft,
  onConfirmationFaceChange,
  onSetFaceChange,
  snapshot,
}: {
  readonly draft: CharacterCreationRollDraft | null;
  readonly onConfirmationFaceChange: (value: number | null) => void;
  readonly onSetFaceChange: (index: number, value: number | null) => void;
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  const number = (raw: string): number | null => (raw === '' ? null : Number(raw));
  if (snapshot.formId === 'CHR-003') {
    const projection = snapshot.projection as Chr003Projection;
    if (projection.setRollReceiptId !== null) {
      return (
        <section data-stat-roll-committed data-shown-result-locked={projection.shownResultLocked}>
          <h2>Зафиксированный набор характеристик</h2>
          <ol>
            {projection.facesOrManualInputs.map((face, index) => (
              <li key={index} data-stat-roll-face={index}>
                {face}
              </li>
            ))}
          </ol>
          <pre data-natural-critical-queue>
            {JSON.stringify(projection.naturalCriticalQueue, null, 2)}
          </pre>
        </section>
      );
    }
    if (projection.diceInputModeSnapshot === 'AUTO') {
      return <p data-roll-input-mode="AUTO">Семь граней создаст хост при фиксации.</p>;
    }
    const faces = draft?.formId === 'CHR-003' ? draft.faces : [];
    return (
      <fieldset data-roll-input-mode="MANUAL">
        <legend>Семь граней D20</legend>
        {Array.from({ length: 7 }, (_, index) => (
          <label key={index}>
            Грань {index + 1}{' '}
            <input
              data-stat-roll-input={index}
              max={20}
              min={1}
              step={1}
              type="number"
              value={faces[index] ?? ''}
              onChange={(event) => onSetFaceChange(index, number(event.target.value))}
            />
          </label>
        ))}
      </fieldset>
    );
  }
  if (snapshot.formId !== 'CHR-004') return null;
  const projection = snapshot.projection as Chr004Projection;
  const complete = projection.confirmationReceiptId !== null;
  return (
    <section data-critical-chain-status={complete ? 'CHAIN_COMPLETE' : 'CRITICALS_PENDING'}>
      <h2>Подтверждение натуральной грани</h2>
      <p>
        Очередь {projection.criticalQueueIndex}, исходная грань {projection.originFace}
      </p>
      {complete ? (
        <p data-confirmation-face>{projection.confirmationFace}</p>
      ) : projection.diceInputModeSnapshot === 'AUTO' ? (
        <p data-roll-input-mode="AUTO">Подтверждающую грань создаст хост при фиксации.</p>
      ) : (
        <label>
          Подтверждающая грань{' '}
          <input
            data-confirmation-roll-input
            max={20}
            min={1}
            step={1}
            type="number"
            value={draft?.formId === 'CHR-004' ? (draft.face ?? '') : ''}
            onChange={(event) => onConfirmationFaceChange(number(event.target.value))}
          />
        </label>
      )}
    </section>
  );
}

function signedInteger(value: number): string {
  return value < 0 ? `−${String(Math.abs(value))}` : `+${String(value)}`;
}

function StatModifierEffectFields({
  effect,
}: {
  readonly effect: StatModifierEffectProjection;
}): ReactElement {
  if (effect.kind === 'NO_STAT_MODIFIERS') {
    return (
      <p data-stat-modifier-kind={effect.kind}>
        Поправки характеристик: <strong>Нет</strong>
      </p>
    );
  }
  return (
    <table data-stat-modifier-kind={effect.kind}>
      <thead>
        <tr>
          <th>Характеристика</th>
          <th>Код</th>
          <th>Изменение</th>
        </tr>
      </thead>
      <tbody>
        {effect.entries.map((entry) => (
          <tr key={entry.statCode} data-stat-modifier={entry.statCode}>
            <th>{entry.statLabel}</th>
            <td>{entry.statCode}</td>
            <td>{signedInteger(entry.delta)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModeConsequencesFields({
  consequences,
}: {
  readonly consequences: ModeConsequencesProjection;
}): ReactElement {
  return (
    <section data-mode-consequences={consequences.raceChoice}>
      <dl>
        <dt>Раса</dt>
        <dd>{consequences.raceLabel}</dd>
        <dt>Слоты симбионтов</dt>
        <dd>{consequences.baseSymbiontSlots}</dd>
      </dl>
      <StatModifierEffectFields effect={consequences.statModifiers} />
    </section>
  );
}

function RaceConsequencesFields({
  consequences,
}: {
  readonly consequences: RaceConsequencesPreviewProjection;
}): ReactElement {
  return (
    <section data-race-consequences={consequences.raceLabel}>
      <dl>
        <dt>Раса</dt>
        <dd>{consequences.raceLabel}</dd>
        <dt>Слоты симбионтов</dt>
        <dd>{consequences.baseSymbiontSlots}</dd>
        <dt>Политика класса</dt>
        <dd>{consequences.classPolicy}</dd>
        <dt>Множитель распределения опыта</dt>
        <dd>×{consequences.allocationXpMultiplier}</dd>
        <dt>Множитель прямого опыта</dt>
        <dd>×{consequences.directXpMultiplier}</dd>
        <dt>Политика опыта симбионтов</dt>
        <dd>{consequences.symbiontXpPolicy}</dd>
        <dt>Симбионтный монстр</dt>
        <dd>{consequences.symbioticMonsterAllowed ? 'Да' : 'Нет'}</dd>
      </dl>
      {consequences.raceStatModifiersByAcquisitionMode.kind === 'NOT_APPLICABLE' ? (
        <p data-race-stat-modifiers-by-acquisition-mode="NOT_APPLICABLE">
          Расовые поправки по способу получения симбионтов: не применяются
        </p>
      ) : (
        <section data-race-stat-modifiers-by-acquisition-mode="DEPENDS_ON_SYMBIONT_ACQUISITION_MODE">
          <h3>Зависит от способа получения симбионтов</h3>
          {consequences.raceStatModifiersByAcquisitionMode.alternatives.map((option) => (
            <article
              key={option.symbiontAcquisitionMode}
              data-mode-alternative={option.symbiontAcquisitionMode}
            >
              <h4>{option.symbiontAcquisitionMode}</h4>
              <ModeConsequencesFields consequences={option.modeConsequences} />
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function MethodConsequencesFields({
  consequences,
}: {
  readonly consequences: MethodConsequencesProjection;
}): ReactElement {
  return (
    <section data-method-consequences>
      <dl>
        <dt>Максимум попыток</dt>
        <dd>{consequences.maximumAttempts}</dd>
        <dt>Отказ необратим</dt>
        <dd>{consequences.rejectedSet.irreversible ? 'Да' : 'Нет'}</dd>
        <dt>Значения набора отбрасываются</dt>
        <dd>{consequences.rejectedSet.setValuesDiscarded ? 'Да' : 'Нет'}</dd>
        <dt>Критические последствия отбрасываются</dt>
        <dd>{consequences.rejectedSet.creationCriticalConsequencesDiscarded ? 'Да' : 'Нет'}</dd>
      </dl>
      {consequences.terminalRule.kind === 'POINT_BUY_AFTER_REJECTION' ? (
        <dl data-terminal-rule={consequences.terminalRule.kind}>
          <dt>После попытки</dt>
          <dd>{consequences.terminalRule.afterAttempt}</dd>
          <dt>Точная сумма</dt>
          <dd>{consequences.terminalRule.exactTotal}</dd>
        </dl>
      ) : (
        <dl data-terminal-rule={consequences.terminalRule.kind}>
          <dt>Обязательное принятие попытки</dt>
          <dd>{consequences.terminalRule.attemptIndex}</dd>
        </dl>
      )}
    </section>
  );
}

function DecisionConsequenceOptions({
  snapshot,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId === 'CHR-010') {
    const projection = snapshot.projection as Chr010Projection;
    return (
      <section data-character-consequence-options={snapshot.formId}>
        <h2>Последствия выбора расы</h2>
        {projection.raceConsequenceOptions.map((option) => (
          <article key={option.raceChoice} data-race-consequence-option={option.raceChoice}>
            <h3>{option.raceConsequencesPreview.raceLabel}</h3>
            <RaceConsequencesFields consequences={option.raceConsequencesPreview} />
          </article>
        ))}
      </section>
    );
  }
  if (snapshot.formId === 'CHR-016') {
    const projection = snapshot.projection as Chr016Projection;
    return (
      <section data-character-consequence-options={snapshot.formId}>
        <h2>Последствия способа получения симбионтов</h2>
        {projection.modeConsequenceOptions.map((option) => (
          <article
            key={option.symbiontAcquisitionMode}
            data-mode-consequence-option={option.symbiontAcquisitionMode}
          >
            <h3>{option.symbiontAcquisitionMode}</h3>
            <ModeConsequencesFields consequences={option.modeConsequences} />
          </article>
        ))}
      </section>
    );
  }
  if (snapshot.formId === 'CHR-002') {
    const projection = snapshot.projection as Chr002Projection;
    return (
      <section data-character-consequence-options={snapshot.formId}>
        <h2>Последствия метода характеристик</h2>
        {projection.methodConsequenceOptions.map((option) => (
          <article key={option.statMethod} data-method-consequence-option={option.statMethod}>
            <h3>{option.statMethod}</h3>
            <MethodConsequencesFields consequences={option.methodConsequences} />
          </article>
        ))}
      </section>
    );
  }
  return null;
}

function SelectedDecisionConsequences({
  choice,
}: {
  readonly choice: CharacterCreationChoiceDraft;
}): ReactElement | null {
  switch (choice.formId) {
    case 'CHR-010':
      return <RaceConsequencesFields consequences={choice.consequence} />;
    case 'CHR-016':
      return <ModeConsequencesFields consequences={choice.consequence} />;
    case 'CHR-002':
      return <MethodConsequencesFields consequences={choice.consequence} />;
    case 'CHR-036':
    case 'CHR-011':
      return null;
  }
}

function CharacterSetDecisionFields({
  snapshot,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (
    snapshot.formId !== 'CHR-005' &&
    snapshot.formId !== 'CHR-006' &&
    snapshot.formId !== 'CHR-007' &&
    snapshot.formId !== 'CHR-008'
  ) {
    return null;
  }
  const projection = snapshot.projection as CharacterSetDecisionProjection;
  const setReceiptId = projection.acceptedSetReceiptId ?? projection.setReceiptId;
  return (
    <section
      aria-labelledby="character-set-decision-title"
      data-character-set-decision={projection.decision}
      data-character-set-decision-form={snapshot.formId}
    >
      <h2 id="character-set-decision-title">Зафиксированный набор</h2>
      <dl>
        <dt>statMethod</dt>
        <dd>{projection.statMethod}</dd>
        {projection.attemptIndex === undefined ? null : (
          <>
            <dt>attemptIndex</dt>
            <dd>{projection.attemptIndex}</dd>
          </>
        )}
        <dt>setReceiptId</dt>
        <dd data-character-set-receipt>{setReceiptId}</dd>
        <dt>decision</dt>
        <dd>{projection.decision}</dd>
      </dl>
      {projection.fifthAttemptMandatoryAccept === true ? (
        <p data-fifth-attempt-mandatory-accept>Пятая попытка допускает только принятие.</p>
      ) : null}
    </section>
  );
}

function StatAssignmentFields({
  draft,
  onChange,
  snapshot,
}: {
  readonly draft: CharacterStatAssignmentDraft | null;
  readonly onChange: (statCode: StatCode, value: number | null) => void;
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId !== 'CHR-009') return null;
  const projection = snapshot.projection as Chr009Projection;
  const values = draft?.valuesByStat;
  const rolled = projection.assignmentMode === 'ROLLED_BIJECTION';
  const sourceEntries =
    projection.bijectionProofOrExactSum.kind === 'ROLLED_BIJECTION'
      ? projection.bijectionProofOrExactSum.sourceEntries
      : [];
  const total = rolled
    ? null
    : STAT_CODES.reduce((sum, statCode) => sum + (values?.[statCode] ?? 0), 0);
  return (
    <section
      aria-labelledby="chr-009-assignment-title"
      data-stat-assignment-mode={projection.assignmentMode}
    >
      <h2 id="chr-009-assignment-title">Распределение характеристик</h2>
      {STAT_CODES.map((statCode) => (
        <label key={statCode}>
          {statCode}{' '}
          {rolled ? (
            <select
              data-stat-assignment={statCode}
              value={values?.[statCode] ?? ''}
              onChange={(event) =>
                onChange(statCode, event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">—</option>
              {sourceEntries.map((entry) => (
                <option key={entry.setEntryIndex} value={entry.setEntryIndex}>
                  #{entry.setEntryIndex + 1}: {entry.value}
                  {entry.creationCriticalPenaltyOrNull === null
                    ? ''
                    : ` (${entry.creationCriticalPenaltyOrNull})`}
                </option>
              ))}
            </select>
          ) : (
            <input
              data-stat-assignment={statCode}
              max={20}
              min={1}
              step={1}
              type="number"
              value={values?.[statCode] ?? ''}
              onChange={(event) =>
                onChange(statCode, event.target.value === '' ? null : Number(event.target.value))
              }
            />
          )}
        </label>
      ))}
      {total === null ? null : (
        <p data-stat-assignment-total>
          Сумма: {total} /{' '}
          {projection.bijectionProofOrExactSum.kind === 'EXACT_SUM'
            ? projection.bijectionProofOrExactSum.requiredTotal
            : ''}
        </p>
      )}
      <p data-stat-assignment-validation={draft?.validation ?? 'ASSIGNMENT_INVALID'}>
        {draft?.validation ?? 'ASSIGNMENT_INVALID'}
      </p>
    </section>
  );
}

function PureClassFields({
  choice,
  snapshot,
}: {
  readonly choice: CharacterCreationChoiceDraft | null;
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId !== 'CHR-011') return null;
  const projection = snapshot.projection as Chr011Projection;
  return (
    <section aria-labelledby="chr-011-class-title" data-pure-class={choice?.value ?? 'null'}>
      <h2 id="chr-011-class-title">Класс Чистого</h2>
      {projection.classOptions.map((option) => (
        <article key={option.pureClass} data-pure-class-option={option.pureClass}>
          <h3>{option.pureClass}</h3>
          <pre>{JSON.stringify(option.classConsequences, null, 2)}</pre>
          <pre>{JSON.stringify(option.mandatoryClassSkill, null, 2)}</pre>
        </article>
      ))}
      {choice?.formId === 'CHR-011' ? (
        <output data-selected-pure-class>{choice.value}</output>
      ) : null}
    </section>
  );
}

function StatBreakdownFields({
  snapshot,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId !== 'CHR-012') return null;
  const projection = snapshot.projection as Chr012Projection;
  const delta = (rows: Chr012Projection['raceModifiers'], statCode: StatCode) =>
    rows.find((row) => row.statCode === statCode)?.delta ?? 0;
  return (
    <section aria-labelledby="chr-012-summary-title" data-stat-breakdown>
      <h2 id="chr-012-summary-title">Характеристики на этапе навыков</h2>
      <table>
        <thead>
          <tr>
            <th>Код</th>
            <th>База</th>
            <th>Раса</th>
            <th>Класс</th>
            <th>Итого</th>
          </tr>
        </thead>
        <tbody>
          {STAT_CODES.map((statCode) => (
            <tr key={statCode}>
              <th>{statCode}</th>
              <td>{projection.baseStats[statCode]}</td>
              <td>{delta(projection.raceModifiers, statCode)}</td>
              <td>{delta(projection.classModifiersOrNull ?? [], statCode)}</td>
              <td>{projection.skillStageStats[statCode]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {projection.mandatoryClassSkillOrNull === null ? null : (
        <pre data-mandatory-class-skill>
          {JSON.stringify(projection.mandatoryClassSkillOrNull, null, 2)}
        </pre>
      )}
    </section>
  );
}

function SkillCatalogFields({
  snapshot,
}: {
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId !== 'CHR-013') return null;
  const projection = snapshot.projection as Chr013Projection;
  return (
    <section aria-labelledby="chr-013-catalog-title" data-skill-catalog>
      <h2 id="chr-013-catalog-title">Каталог стартовых навыков</h2>
      <p data-required-skill-slots>
        Требуется платных слотов: {projection.slotSources.requiredSlotCount}
      </p>
      {projection.slotSources.mandatoryClassSkillOrNull === null ? null : (
        <p data-catalog-mandatory-class-skill>
          Классовый навык: {projection.slotSources.mandatoryClassSkillOrNull.skillLabel} +
          {projection.slotSources.mandatoryClassSkillOrNull.bonus}
        </p>
      )}
      {projection.slotSources.racialFreeSkills.map((skill) => (
        <p key={skill.skillId} data-catalog-racial-free-skill={skill.skillId}>
          Бесплатный расовый навык: {skill.skillLabel} +{skill.bonus}
        </p>
      ))}
      <div data-skill-card-count={projection.skillCardSummaries.length}>
        {projection.skillCardSummaries.map((card) => (
          <article
            key={card.skillId}
            data-skill-card={card.skillId}
            data-skill-eligibility={card.eligibility}
          >
            <h3>{card.skillLabel}</h3>
            <p>{card.eligibility}</p>
            {card.requirements.length === 0 ? (
              <p>Требования отсутствуют.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Характеристика</th>
                    <th>Текущее</th>
                    <th>Требуется</th>
                    <th>Выполнено</th>
                  </tr>
                </thead>
                <tbody>
                  {card.requirements.map((requirement) => (
                    <tr
                      key={requirement.statCode}
                      data-skill-requirement={requirement.statCode}
                      data-skill-requirement-satisfied={requirement.satisfied}
                    >
                      <th>{requirement.statLabel}</th>
                      <td>{requirement.currentValue}</td>
                      <td>{requirement.minValue}</td>
                      <td>{requirement.satisfied ? 'Да' : 'Нет'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ul data-skill-level-options>
              {card.levelOptions.map((level) => (
                <li key={level.targetBonus}>
                  +{level.targetBonus}: {level.slotCost} сл.
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function SkillSelectionFields({
  draft,
  onCandidateChange,
  snapshot,
}: {
  readonly draft: CharacterSkillSelectionDraft | null;
  readonly onCandidateChange: (skillId: string | null, targetBonus: number | null) => void;
  readonly snapshot: ConfirmedProjectionSnapshot;
}): ReactElement | null {
  if (snapshot.formId !== 'CHR-015') return null;
  const projection = snapshot.projection as Chr015Projection;
  const selectedSkills = draft?.selectedSkills ?? projection.selectedSkills;
  const paidSlotUsage = draft?.paidSlotUsage ?? projection.paidSlotUsage;
  const validation = draft?.selectionValidation ?? projection.selectionValidation;
  const candidateSkillId = draft?.candidateSkillIdOrNull ?? null;
  const candidateTargetBonus = draft?.candidateTargetBonusOrNull ?? null;
  const candidateOption = projection.skillOptions.find(
    ({ skillId }) => skillId === candidateSkillId,
  );
  const selectedCandidate = selectedSkills.find(({ skillId }) => skillId === candidateSkillId);
  const mutable = draft !== null && projection.commandId === null;
  return (
    <section aria-labelledby="chr-015-selection-title" data-skill-selection>
      <h2 id="chr-015-selection-title">Стартовые навыки</h2>
      <p data-skill-slot-usage>
        Платные слоты: {paidSlotUsage.usedSlotCount} / {projection.requiredSlotCount}
      </p>
      <p data-skill-selection-validation={validation.kind}>
        {validation.kind}
        {validation.kind === 'UNDERFILLED'
          ? `: не хватает ${String(validation.missingSlotCount)}`
          : validation.kind === 'OVERFILLED'
            ? `: превышение ${String(validation.excessSlotCount)}`
            : ''}
      </p>
      {projection.mandatoryClassSkillOrNull === null ? null : (
        <p data-selection-mandatory-class-skill>
          Классовый: {projection.mandatoryClassSkillOrNull.skillLabel} +
          {projection.mandatoryClassSkillOrNull.bonus} (
          {projection.mandatoryClassSkillOrNull.slotCost} сл.)
        </p>
      )}
      {projection.racialFreeSkills.map((skill) => (
        <p key={skill.skillId} data-selection-racial-free-skill={skill.skillId}>
          Расовый бесплатный: {skill.skillLabel} +{skill.bonus}
        </p>
      ))}
      <ul data-selected-skills>
        {selectedSkills.map((skill) => {
          const option = projection.skillOptions.find(({ skillId }) => skillId === skill.skillId)!;
          return (
            <li key={skill.skillId} data-selected-skill={skill.skillId}>
              {option.skillLabel} +{skill.targetBonus} ({skill.slotCost} сл.)
            </li>
          );
        })}
      </ul>
      <ol data-paid-slot-usage>
        {paidSlotUsage.entries.map((entry) => (
          <li key={`${entry.source}:${entry.skillId}`} data-paid-slot-source={entry.source}>
            {entry.skillLabel} +{entry.bonus}: {entry.slotCost} сл.
          </li>
        ))}
      </ol>
      {mutable ? (
        <fieldset data-skill-selection-controls>
          <legend>Локальное добавление или удаление</legend>
          <label>
            Навык{' '}
            <select
              data-skill-candidate
              value={candidateSkillId ?? ''}
              onChange={(event) => {
                const skillId = event.target.value || null;
                const selected = selectedSkills.find((entry) => entry.skillId === skillId);
                onCandidateChange(skillId, selected?.targetBonus ?? null);
              }}
            >
              <option value="">—</option>
              {projection.skillOptions.map((option) => (
                <option key={option.skillId} value={option.skillId}>
                  {option.skillLabel}
                  {selectedSkills.some(({ skillId }) => skillId === option.skillId)
                    ? ' — удалить'
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Целевой бонус{' '}
            <select
              data-skill-target-bonus
              disabled={candidateOption === undefined || selectedCandidate !== undefined}
              value={candidateTargetBonus ?? ''}
              onChange={(event) =>
                onCandidateChange(
                  candidateSkillId,
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            >
              <option value="">—</option>
              {(candidateOption?.levelOptions ?? []).map((level) => (
                <option key={level.targetBonus} value={level.targetBonus}>
                  +{level.targetBonus} — {level.slotCost} сл.
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      ) : (
        <p data-skill-selection-checkpointed>Выбор зафиксирован.</p>
      )}
    </section>
  );
}

function AbandonmentDialogFields({
  layer,
}: {
  readonly layer: ConfirmedPresentationLayer;
}): ReactElement {
  const projection = layer.projection;
  return (
    <section
      aria-labelledby="chr-028-warning-title"
      data-chr-028-decision={projection.decision ?? 'WARNING'}
    >
      <h2 id="chr-028-warning-title">
        {projection.decision === null ? 'Необратимый отказ от набора' : 'Отказ подтверждён'}
      </h2>
      <dl>
        <dt>originDecisionFormId</dt>
        <dd>{projection.originDecisionFormId}</dd>
        <dt>transitionKind</dt>
        <dd>{projection.transitionKind}</dd>
        <dt>abandonedSetReceiptIds</dt>
        <dd>
          <pre>{JSON.stringify(projection.abandonedSetReceiptIds, null, 2)}</pre>
        </dd>
        <dt>irreversibleConsequences</dt>
        <dd>
          <pre>{JSON.stringify(projection.irreversibleConsequences, null, 2)}</pre>
        </dd>
      </dl>
    </section>
  );
}

export function App(): ReactElement {
  const [state, setState] = useState<WebClientState>({ kind: 'connecting' });
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState<IdentityDraftClientState | null>(null);
  const [creationChoiceDraft, setCreationChoiceDraft] =
    useState<CharacterCreationChoiceDraft | null>(null);
  const [creationRollDraft, setCreationRollDraft] = useState<CharacterCreationRollDraft | null>(
    null,
  );
  const [statAssignmentDraft, setStatAssignmentDraft] =
    useState<CharacterStatAssignmentDraft | null>(null);
  const [skillSelectionDraft, setSkillSelectionDraft] =
    useState<CharacterSkillSelectionDraft | null>(null);
  const [characterArtReadPending, setCharacterArtReadPending] = useState(false);
  const connectionRef = useRef<ProjectionConnection | null>(null);

  useEffect(() => {
    const connection = connectProjection(
      setState,
      setIdentityDraft,
      setCreationChoiceDraft,
      setCreationRollDraft,
      setStatAssignmentDraft,
      setSkillSelectionDraft,
    );
    connectionRef.current = connection;
    return () => {
      connectionRef.current = null;
      connection.disconnect();
    };
  }, []);

  const snapshot = confirmedSnapshot(state);
  const interactive =
    state.kind === 'ready' ||
    state.kind === 'command-refusal' ||
    state.kind === 'navigation-refusal';
  useEffect(() => {
    if (state.kind !== 'ready') return;
    window.history.replaceState(null, '', state.snapshot.path);
  }, [state]);
  const availableActionKeys =
    characterArtReadPending && snapshot?.formId === 'CHR-001'
      ? snapshot.availableActionKeys.filter(
          (actionKey) => actionKey !== CHR_001_CHECKPOINT_ACTION_KEY,
        )
      : snapshot?.availableActionKeys;
  const layers = snapshot?.layers ?? [];
  const activeCreationChoice =
    creationChoiceDraft?.formId === snapshot?.formId ? creationChoiceDraft : null;
  return (
    <>
      <ConnectionBanner state={state} />
      {state.kind === 'disconnected' ? (
        <button onClick={() => connectionRef.current?.reconnect()}>Переподключиться</button>
      ) : null}
      {snapshot === null ? (
        <section data-app-001-data="missing">
          <h2>Данные APP-001 отсутствуют</h2>
          <p>Клиент не вычисляет и не кэширует обязательные поля вместо хоста.</p>
        </section>
      ) : (
        <>
          <HostProjection snapshot={snapshot} />
          <fieldset disabled={!interactive || layers.length > 0}>
            <legend>AtlasForm {snapshot.formId}</legend>
            {snapshot.formId === 'CHR-001' && identityDraft !== null ? (
              <IdentityFields
                draft={identityDraft}
                fileReadPending={characterArtReadPending}
                onChange={(values) =>
                  connectionRef.current?.replaceIdentityDraft(values) ?? {
                    detail: 'projection connection is not ready',
                    ok: false,
                  }
                }
                onFileReadPendingChange={setCharacterArtReadPending}
              />
            ) : null}
            <DecisionConsequenceOptions snapshot={snapshot} />
            {snapshot.formId === 'CHR-010' ||
            snapshot.formId === 'CHR-016' ||
            snapshot.formId === 'CHR-036' ||
            snapshot.formId === 'CHR-002' ||
            snapshot.formId === 'CHR-011' ? (
              <section
                aria-label={
                  snapshot.formId === 'CHR-010'
                    ? 'Локальный выбор расы'
                    : 'Локальный выбор этапа создания'
                }
                data-character-creation-choice={activeCreationChoice?.value ?? 'null'}
                data-character-creation-choice-form={snapshot.formId}
                data-race-choice-draft={
                  snapshot.formId === 'CHR-010'
                    ? (activeCreationChoice?.value ?? 'null')
                    : undefined
                }
              >
                <h2>
                  {snapshot.formId === 'CHR-010'
                    ? 'Локальный выбор расы'
                    : 'Локальный выбор этапа создания'}
                </h2>
                <output>{activeCreationChoice?.value ?? 'null'}</output>
                {activeCreationChoice?.consequence === null ||
                activeCreationChoice?.consequence === undefined ? null : (
                  <div data-character-creation-consequence>
                    <SelectedDecisionConsequences choice={activeCreationChoice} />
                  </div>
                )}
              </section>
            ) : null}
            <CharacterCreationRollFields
              draft={creationRollDraft}
              snapshot={snapshot}
              onConfirmationFaceChange={(value) => {
                const result = connectionRef.current?.replaceConfirmationManualFace(value);
                setActionNotice(
                  result === undefined || result.ok ? null : `Ввод не сохранён: ${result.detail}.`,
                );
              }}
              onSetFaceChange={(index, value) => {
                const result = connectionRef.current?.replaceSetManualFace(index, value);
                setActionNotice(
                  result === undefined || result.ok ? null : `Ввод не сохранён: ${result.detail}.`,
                );
              }}
            />
            <CharacterSetDecisionFields snapshot={snapshot} />
            <StatAssignmentFields
              draft={statAssignmentDraft}
              snapshot={snapshot}
              onChange={(statCode, value) => {
                const result = connectionRef.current?.replaceStatAssignmentValue(statCode, value);
                setActionNotice(
                  result === undefined || result.ok ? null : `Ввод не сохранён: ${result.detail}.`,
                );
              }}
            />
            <PureClassFields choice={activeCreationChoice} snapshot={snapshot} />
            <StatBreakdownFields snapshot={snapshot} />
            <SkillCatalogFields snapshot={snapshot} />
            <SkillSelectionFields
              draft={skillSelectionDraft}
              snapshot={snapshot}
              onCandidateChange={(skillId, targetBonus) => {
                const result = connectionRef.current?.replaceSkillSelectionCandidate(
                  skillId,
                  targetBonus,
                );
                setActionNotice(
                  result === undefined || result.ok ? null : `Ввод не сохранён: ${result.detail}.`,
                );
              }}
            />
            <AtlasForm
              availableActionKeys={availableActionKeys ?? []}
              formId={snapshot.formId}
              onAction={(selection) => {
                if (
                  characterArtReadPending &&
                  selection.actionKey === CHR_001_CHECKPOINT_ACTION_KEY
                ) {
                  setActionNotice('Переход не отправлен: дождитесь чтения файла арта.');
                  return;
                }
                const connection = connectionRef.current;
                if (connection === null) {
                  setActionNotice('Переход не отправлен: соединение ещё не готово.');
                  return;
                }
                const result = connection.requestFormAction(selection.actionKey);
                setActionNotice(result.ok ? null : `Переход не отправлен: ${result.detail}.`);
              }}
            />
          </fieldset>
          {layers.map((layer) => (
            <fieldset key={layer.formId} disabled={!interactive} data-presentation-layer>
              <legend>AtlasForm {layer.formId}</legend>
              <AtlasForm
                availableActionKeys={layer.availableActionKeys}
                formId={layer.formId}
                projectionContent={<AbandonmentDialogFields layer={layer} />}
                onAction={(selection) => {
                  const connection = connectionRef.current;
                  if (connection === null) {
                    setActionNotice('Переход не отправлен: соединение ещё не готово.');
                    return;
                  }
                  const result = connection.requestFormAction(selection.actionKey);
                  setActionNotice(result.ok ? null : `Переход не отправлен: ${result.detail}.`);
                }}
              />
            </fieldset>
          ))}
          {actionNotice === null ? null : <p role="status">{actionNotice}</p>}
        </>
      )}
    </>
  );
}
