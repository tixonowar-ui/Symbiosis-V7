import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { AtlasForm } from './renderer/atlas-form.js';
import { connectApp001Projection } from './ws-client.js';
import type { ConfirmedApp001Snapshot, WebClientState } from './ws-client.js';

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
          <p>projection.reconnect отправлен; клиент ждёт проверенный snapshot хоста.</p>
        </section>
      );
    case 'ready':
      return (
        <section role="status" data-client-state={state.kind}>
          <h1>APP-001 получен от хоста</h1>
          <p>Показана последняя подтверждённая проекция player.</p>
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
          <h1>Ошибка wire v1</h1>
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

function confirmedSnapshot(state: WebClientState): ConfirmedApp001Snapshot | null {
  switch (state.kind) {
    case 'ready':
      return state.snapshot;
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

function HostProjection({ snapshot }: { readonly snapshot: ConfirmedApp001Snapshot }) {
  const { projection } = snapshot;
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

export function App(): ReactElement {
  const [state, setState] = useState<WebClientState>({ kind: 'connecting' });
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    const connection = connectApp001Projection(setState);
    return () => {
      connection.disconnect();
    };
  }, []);

  const snapshot = confirmedSnapshot(state);
  return (
    <>
      <ConnectionBanner state={state} />
      {snapshot === null ? (
        <section data-app-001-data="missing">
          <h2>Данные APP-001 отсутствуют</h2>
          <p>Клиент не вычисляет и не кэширует обязательные поля вместо хоста.</p>
        </section>
      ) : (
        <>
          <HostProjection snapshot={snapshot} />
          <fieldset disabled={state.kind !== 'ready'}>
            <legend>AtlasForm APP-001</legend>
            <AtlasForm
              formId="APP-001"
              onAction={(selection) => {
                setActionNotice(
                  `Переход «${selection.label}» не отправлен: маршрутизация и CTA не входят в issue #36.`,
                );
              }}
            />
          </fieldset>
          {actionNotice === null ? null : <p role="status">{actionNotice}</p>}
        </>
      )}
    </>
  );
}
