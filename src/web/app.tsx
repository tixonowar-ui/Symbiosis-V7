import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';

import { CHARACTER_ART_ACCEPT, characterArtFromFile } from './character-art.js';
import { AtlasForm } from './renderer/atlas-form.js';
import { connectProjection } from './ws-client.js';
import type {
  App001Projection,
  CharacterCreationChoiceDraft,
  ConfirmedProjectionSnapshot,
  FormActionRequestResult,
  IdentityDraftClientState,
  IdentityDraftValues,
  ProjectionConnection,
  WebClientState,
} from './ws-client.js';

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

export function App(): ReactElement {
  const [state, setState] = useState<WebClientState>({ kind: 'connecting' });
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState<IdentityDraftClientState | null>(null);
  const [creationChoiceDraft, setCreationChoiceDraft] =
    useState<CharacterCreationChoiceDraft | null>(null);
  const [characterArtReadPending, setCharacterArtReadPending] = useState(false);
  const connectionRef = useRef<ProjectionConnection | null>(null);

  useEffect(() => {
    const connection = connectProjection(setState, setIdentityDraft, setCreationChoiceDraft);
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
          <fieldset disabled={!interactive}>
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
            {snapshot.formId === 'CHR-010' ||
            snapshot.formId === 'CHR-016' ||
            snapshot.formId === 'CHR-036' ||
            snapshot.formId === 'CHR-002' ? (
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
                  <p data-character-creation-consequence>{activeCreationChoice.consequence}</p>
                )}
              </section>
            ) : null}
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
          {actionNotice === null ? null : <p role="status">{actionNotice}</p>}
        </>
      )}
    </>
  );
}
