import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { AtlasForm } from './renderer/atlas-form.js';
import { connectProjection } from './ws-client.js';
import type {
  App001Projection,
  ConfirmedProjectionSnapshot,
  IdentityDraftClientState,
  IdentityDraftValues,
  ProjectionConnection,
  RaceChoiceDraft,
  WebClientState,
} from './ws-client.js';

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
          <h1>Checkpoint отклонён хостом</h1>
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

function displayValue(value: unknown): string {
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
              <pre>{displayValue(value)}</pre>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function IdentityFields({
  draft,
  onChange,
}: {
  readonly draft: IdentityDraftClientState;
  readonly onChange: (values: IdentityDraftValues) => void;
}) {
  const values = draft.widgetValues;
  const replace = (patch: Partial<IdentityDraftValues>) => onChange({ ...values, ...patch });
  const number = (raw: string): number | null => (raw === '' ? null : Number(raw));
  return (
    <section aria-label="Черновик идентичности" data-identity-dirty={draft.dirty}>
      {(
        [
          ['Имя', 'name', 'text', undefined],
          ['Возраст', 'age', 'number', 'any'],
          ['Масса, кг', 'massKg', 'number', '0.1'],
          ['Описание', 'description', 'text', undefined],
          ['Ключ портрета', 'artAssetKeyOrLocalFile', 'text', undefined],
        ] as const
      ).map(([label, key, type, step]) => {
        const value =
          key === 'artAssetKeyOrLocalFile'
            ? values[key]?.kind === 'asset-key'
              ? values[key].assetKey
              : ''
            : (values[key] ?? '');
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
                  key === 'artAssetKeyOrLocalFile'
                    ? { [key]: raw === '' ? null : { kind: 'asset-key', assetKey: raw } }
                    : {
                        [key]: type === 'number' ? number(raw) : raw || null,
                      },
                );
              }}
            />
          </label>
        );
      })}
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
      {draft.lastRefusal === null ? null : (
        <pre role="alert">{JSON.stringify(draft.lastRefusal, null, 2)}</pre>
      )}
    </section>
  );
}

export function App(): ReactElement {
  const [state, setState] = useState<WebClientState>({ kind: 'connecting' });
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState<IdentityDraftClientState | null>(null);
  const [raceChoiceDraft, setRaceChoiceDraft] = useState<RaceChoiceDraft>(null);
  const connectionRef = useRef<ProjectionConnection | null>(null);

  useEffect(() => {
    const connection = connectProjection(setState, setIdentityDraft, setRaceChoiceDraft);
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
                onChange={(values) => connectionRef.current?.replaceIdentityDraft(values)}
              />
            ) : null}
            {snapshot.formId === 'CHR-010' ? (
              <section
                aria-label="Локальный выбор расы"
                data-race-choice-draft={raceChoiceDraft ?? 'null'}
              >
                <h2>Локальный выбор расы</h2>
                <output>{raceChoiceDraft ?? 'null'}</output>
              </section>
            ) : null}
            <AtlasForm
              availableActionKeys={snapshot.availableActionKeys}
              formId={snapshot.formId}
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
          {actionNotice === null ? null : <p role="status">{actionNotice}</p>}
        </>
      )}
    </>
  );
}
