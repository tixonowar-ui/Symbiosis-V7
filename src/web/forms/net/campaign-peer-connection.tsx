import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ActionKey } from '@generated/types/atlas.js';
import type { CampaignPeerStateV3Message } from '@shared/campaign-lifecycle.js';
import { AtlasForm } from '../../renderer/atlas-form.js';
import type { FormActionRequestResult } from '../../ws-client.js';

interface CampaignPeerConnectionProps {
  readonly state: CampaignPeerStateV3Message;
  readonly enabled: boolean;
  readonly onAction: (
    actionKey: string,
    endpoint: { readonly hostAddress: string; readonly hostPort: number } | null,
  ) => FormActionRequestResult;
}
interface ReconnectFields {
  readonly reconnectHostAddress: string;
  readonly reconnectHostPort: number;
  readonly lastAuthenticatedEndpoint: string;
}
export function CampaignPeerConnection(props: CampaignPeerConnectionProps): ReactElement {
  const { state } = props;
  const form = state.formOrNull;
  const peer =
    form?.formId === 'NET-009'
      ? (form.fields['pinnedCampaignPeerReconnectOrNull'] as unknown as ReconnectFields)
      : null;
  // A changed confirmed endpoint/context starts a new editor; status-only polls retain input.
  const editorKey = JSON.stringify([
    state.contextId,
    state.subscriptionId,
    form?.formId,
    form?.fields['commandId'] ?? null,
    peer?.reconnectHostAddress,
    peer?.reconnectHostPort,
  ]);
  return <CampaignPeerConnectionFields key={editorKey} {...props} peer={peer} />;
}
function CampaignPeerConnectionFields({
  state,
  enabled,
  onAction,
  peer,
}: CampaignPeerConnectionProps & { readonly peer: ReconnectFields | null }): ReactElement {
  const form = state.formOrNull;
  const [address, setAddress] = useState(peer?.reconnectHostAddress ?? '');
  const [port, setPort] = useState(peer === null ? '' : String(peer.reconnectHostPort));
  const [busySequence, setBusySequence] = useState<number | null>(null);
  const busy = busySequence === state.sequence;
  const [notice, setNotice] = useState<string | null>(null);
  const status = state.statusOrNull;
  return (
    <section aria-label="Связь с кампанией" data-campaign-peer-state={state.connectionState}>
      {status === null ? (
        <p>Состояние кампании пока не подтверждено.</p>
      ) : (
        <>
          <p>
            {!status.firstStartCompleted
              ? 'Кампания ожидает первого запуска.'
              : status.campaignStatus === 'PAUSED'
                ? 'Кампания на паузе.'
                : 'Кампания продолжена.'}
          </p>
          {status.pauseReasonOrNull === null ? null : (
            <p>Причина паузы: {status.pauseReasonOrNull}</p>
          )}
          {status.disconnectOrNull?.retryReceiptOrNull === null ? (
            <p>Мастер отключил устройство: {status.disconnectOrNull.reason}</p>
          ) : null}
        </>
      )}
      {state.diagnosticOrNull === null ? null : (
        <p role="status">
          {state.diagnosticOrNull === 'PEER_UNAVAILABLE'
            ? 'Связь не подтверждена. Проверьте адрес мастера и повторите подключение.'
            : 'Запрос отклонён. Проверьте текущие данные и повторите.'}
        </p>
      )}
      {form === null ? null : (
        <fieldset disabled={!enabled || busy}>
          <legend>Восстановление связи</legend>
          {form.formId === 'NET-008' ? (
            <p>Связь с мастером потеряна. Доступны последние подтверждённые данные.</p>
          ) : null}
          {form.formId === 'NET-010' ? (
            <p>Состояние сверено. Возвращаемся к вашему персонажу.</p>
          ) : null}
          {peer === null ? null : (
            <>
              <p>Последний подтверждённый адрес: {peer.lastAuthenticatedEndpoint}</p>
              <p>
                Подключение проверит сохранённую привязку к мастеру. Персонаж и незавершённые
                команды сохраняются.
              </p>
              <label>
                Адрес мастера
                <input
                  name="reconnectHostAddress"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Порт мастера
                <input
                  name="reconnectHostPort"
                  type="number"
                  min="1"
                  max="65535"
                  step="1"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
            </>
          )}
          <AtlasForm
            formId={form.formId}
            playerContentOnly
            availableActionKeys={form.availableActionKeys as readonly ActionKey[]}
            onAction={(selection) => {
              const result = onAction(
                selection.actionKey,
                peer === null ? null : { hostAddress: address, hostPort: Number(port) },
              );
              setBusySequence(result.ok ? state.sequence : null);
              setNotice(
                result.ok
                  ? null
                  : 'Подключение не отправлено. Проверьте адрес, порт и состояние связи.',
              );
            }}
          />
        </fieldset>
      )}
      {notice === null ? null : <p role="alert">{notice}</p>}
    </section>
  );
}
