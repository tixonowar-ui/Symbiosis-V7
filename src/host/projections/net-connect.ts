import { array, record, string } from '../json-source.js';

/** Literal source contracts, including future recovery surfaces; this does not publish forms. */
export const NET_CONNECT_FORM_CONTRACTS = [
  {
    formId: 'NET-001',
    title: 'Обнаружение кампаний в локальной сети',
    route: '/player/campaigns/:campaignId/network/net-001',
    type: 'screen',
    roles: ['player'],
    contexts: ['network'],
    requiredFields: [
      'activeRole=PLAYER',
      'discoveryState',
      'discoveredHosts[]',
      'lastAddressOrNull',
      'returnContext=PLAYER_MENU',
      'connectionAttemptIdOrNull',
      'stateRevision',
    ],
  },
  {
    formId: 'NET-002',
    title: 'Подключение по адресу или QR',
    route: '/player/campaigns/:campaignId/network/net-002',
    type: 'screen',
    roles: ['player'],
    contexts: ['network'],
    requiredFields: [
      'deviceId',
      'addressOrQrPayload',
      'parsedHost',
      'parsedPort',
      'protocolVersion',
      'campaignHintOrNull',
      'parseStatus',
      'connectionState',
      'attemptId',
      'commandId',
    ],
  },
  {
    formId: 'NET-003',
    title: 'Выбор локальных персонажей и мест',
    route: '/player/campaigns/:campaignId/network/net-003',
    type: 'screen',
    roles: ['player'],
    contexts: ['network'],
    requiredFields: [
      'contextId',
      'stateRevision',
      'projectionRevision',
      'deviceId',
      'controllerSeat',
      'connectionState',
      'campaignId',
      'campaignStatus',
    ],
  },
  {
    formId: 'NET-004',
    title: 'Отправка запроса устройства',
    route: '/player/campaigns/:campaignId/network/net-004',
    type: 'screen',
    roles: ['player'],
    contexts: ['network'],
    requiredFields: [
      'requestId',
      'deviceId',
      'selectedLocalCharacterUuids[1..3]',
      'snapshotChecksums',
      'campaignId',
      'connectionRevision',
      'commandId',
    ],
  },
  {
    formId: 'NET-005',
    title: 'Ожидание решения мастера',
    route: '/player/campaigns/:campaignId/network/net-005',
    type: 'screen',
    roles: ['player'],
    contexts: ['network'],
    requiredFields: [
      'requestId',
      'requestOwnerDeviceId',
      'batchCharacterSummaries[1..3]',
      'requestStatus=PENDING|REJECTED|PROPOSED',
      'gmMessage',
      'connectionState',
      'requestRevision',
      'cancelReason(required)',
      'commandId',
    ],
  },
  {
    formId: 'CHR-027',
    title: 'Отправка сохранённого персонажа',
    route: '/player/characters/:localCharacterId/create/chr-027',
    type: 'screen',
    roles: ['player'],
    contexts: ['character-creation'],
    requiredFields: [
      'localCharacterUuid',
      'finalSnapshotVersion',
      'candidateSnapshotChecksum',
      'eligibleCampaignIds[]',
      'selectedCampaignId',
      'requestedControllerSeat',
      'sourceUuidAndProvenance(read-only)',
      'submissionStatus=DRAFT|SUBMITTED',
      'commandId',
    ],
  },
  {
    formId: 'NET-009',
    title: 'Переподключение к игре',
    route: '/player/campaigns/:campaignId/network/net-009',
    type: 'screen',
    roles: ['player', 'gm'],
    contexts: ['network'],
    requiredFields: [
      'deviceId',
      'sessionId',
      'activeRole=PLAYER|GM',
      'requestedSeatOrGm',
      'reconnectAttemptId',
      'deviceBindingProof',
      'lastConfirmedStateRevision',
      'lastConfirmedProjectionRevision',
      'resumeContextHint(non-authoritative)',
      'pendingCommandIdOrNull',
      'pendingRequestIdOrNull',
      'commandId',
    ],
  },
  {
    formId: 'NET-010',
    title: 'Сверка состояния после переподключения',
    route: '/player/campaigns/:campaignId/network/net-010',
    type: 'screen',
    roles: ['player', 'gm'],
    contexts: ['network'],
    requiredFields: [
      'serverSnapshotId',
      'serverStateRevision',
      'serverProjectionRevision',
      'activeRole=PLAYER|GM',
      'activeSeatOrGm',
      'resumeContext=PEACE|COMBAT|LOCAL_HANDOFF',
      'resumeFormId(server-authoritative)',
      'pendingCommandIdOrNull',
      'pendingRequestIdOrNull',
      'pendingCommandOwnerOrNull',
      'combatPhaseOrNull',
      'turnOrReactionWindowOrNull',
      'observerVisibilityRevisionOrNull',
      'controlLeaseIdOrNull',
      'receiptIds[]',
      'reconciliationResult=SERVER_CONFIRMED|IDEMPOTENT_RECEIPT|LOCAL_UNCONFIRMED_REJECTED',
    ],
  },
  {
    formId: 'NET-011',
    title: 'Сервер недоступен',
    route: '/player/campaigns/:campaignId/network/net-011',
    type: 'screen',
    roles: ['player', 'gm'],
    contexts: ['network'],
    requiredFields: [
      'attemptId',
      'activeRole=PLAYER|GM',
      'activeSeatOrGm',
      'lastAddressOrQrPayload',
      'lastParsedHostPort',
      'errorCode',
      'humanDiagnostic',
      'retryCount',
      'connectionState=UNAVAILABLE',
      'lastConfirmedStateRevision',
      'lastConfirmedProjectionRevision',
      'resumeContextOrNull',
      'localDataUntouched=true',
      'commandId',
    ],
  },
  {
    formId: 'NET-012',
    title: 'Соединение потеряно',
    route: '@banner/net-012',
    type: 'banner',
    roles: ['player', 'gm'],
    contexts: ['network'],
    requiredFields: [
      'contextId',
      'stateRevision',
      'projectionRevision',
      'effectInstanceId/EffectTypeID',
      'source',
      'duration/stackPolicy',
      'deviceId',
      'controllerSeat',
      'connectionState',
      'originatingCommandId/requestId',
    ],
  },
] as const;

/** Workflow references belong to the source form even on its navigation-only actions. */
export const NET_CONNECT_ACTION_CONTRACTS = [
  [
    'APP-002',
    'APP-002::CTA::003',
    'Подключиться',
    'NET-001',
    'normative',
    'player launch-mode',
    [],
  ],
  [
    'NET-001',
    'NET-001::CTA::001',
    'Открыть «Подключение по адресу или QR»',
    'NET-002',
    'subflow',
    'LAN discovery/address/QR; отдельного пароля игрока нет.',
    [],
  ],
  [
    'NET-001',
    'NET-001::CTA::002',
    'Открыть «Выбор локальных персонажей и мест»',
    'NET-003',
    'journey',
    '1–3 финальных локальных персонажа; кампания максимум 5 PC; четвёртый local seat запрещён.',
    [],
  ],
  [
    'NET-001',
    'NET-001::CTA::003',
    'Вернуться в главное меню игрока',
    'APP-002',
    'safe-return',
    'activeRole=PLAYER; returnContext=PLAYER_MENU; no admission request submitted and no technical session created; local data preserved',
    [],
  ],
  [
    'NET-002',
    'NET-002::CTA::001',
    'Вернуться к «Обнаружение кампаний в локальной сети»',
    'NET-001',
    'subflow-return',
    'safe boundary or completed child context',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-002',
    'NET-002::CTA::002',
    'Техническое подключение установлено',
    'NET-003',
    'normative',
    'UI-CMD-CONNECTION-OPEN receipt committed',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-002',
    'NET-002::CTA::003',
    'Подключиться по введённому адресу или QR',
    'NET-003',
    'workflow-command',
    'UI-CMD-CONNECTION-OPEN guards',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-002',
    'NET-002::CTA::004',
    'Вернуться в меню игрока',
    'APP-002',
    'normative',
    'no technical session created',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-002',
    'NET-002::CTA::005',
    'Сканировать или выбрать QR',
    'NET-002',
    'local-command',
    'local camera/file picker permission; no connection yet',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-003',
    'NET-003::CTA::001',
    'Открыть «Отправка запроса устройства»',
    'NET-004',
    'subflow',
    '1–3 финальных локальных персонажа; кампания максимум 5 PC; четвёртый local seat запрещён.',
    [],
  ],
  [
    'NET-003',
    'NET-003::CTA::002',
    'Открыть «Отправка сохранённого персонажа»',
    'CHR-027',
    'subflow',
    '1–3 финальных локальных персонажа; кампания максимум 5 PC; четвёртый local seat запрещён.',
    [],
  ],
  [
    'NET-003',
    'NET-003::CTA::003',
    'Открыть «Ожидание решения мастера»',
    'NET-005',
    'journey',
    'До решения места и campaignCharacterId не создаются.',
    [],
  ],
  [
    'NET-003',
    'NET-003::CTA::004',
    'Вернуться к «Выбор локального профиля и места»',
    'APP-003',
    'subflow-return',
    'safe boundary or completed child context',
    [],
  ],
  [
    'NET-004',
    'NET-004::CTA::001',
    'Вернуться к «Выбор локальных персонажей и мест»',
    'NET-003',
    'subflow-return',
    'safe boundary or completed child context',
    ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
  ],
  [
    'NET-004',
    'NET-004::CTA::002',
    'Отправить AdmissionBatch request',
    'NET-005',
    'workflow-command',
    'UI-CMD-DEVICE-REQUEST-SUBMIT guards',
    ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
  ],
  [
    'NET-004',
    'NET-004::CTA::003',
    'Отменить до submit',
    'NET-003',
    'normative',
    'request not submitted',
    ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
  ],
  [
    'NET-005',
    'NET-005::CTA::001',
    'Отменить pending request',
    'NET-003',
    'workflow-command',
    'UI-CMD-DEVICE-REQUEST-CANCEL guards',
    ['UI-CMD-DEVICE-REQUEST-CANCEL'],
  ],
  [
    'NET-005',
    'NET-005::CTA::002',
    'Повторить подключение после потери связи',
    'NET-009',
    'normative',
    'connectionState=LOST and transport available',
    ['UI-CMD-DEVICE-REQUEST-CANCEL'],
  ],
  [
    'CHR-027',
    'CHR-027::CTA::001',
    'Продолжить к заявке AdmissionBatch',
    'NET-004',
    'normative',
    'selected eligible campaign/seat and immutable candidate snapshot enter the ordinary 1–3 device request draft; submit still requires NET-004 command',
    [],
  ],
  [
    'CHR-027',
    'CHR-027::CTA::002',
    'Вернуться к финальному локальному листу',
    'CHR-040',
    'safe-return',
    'no request submitted',
    [],
  ],
  [
    'NET-009',
    'NET-009::CTA::001',
    'Открыть «Сверка состояния после переподключения»',
    'NET-010',
    'journey',
    'Server is normative; local unconfirmed command reconciled by commandId.',
    [],
  ],
  [
    'NET-009',
    'NET-009::CTA::002',
    'Получен snapshot',
    'NET-010',
    'normative',
    'device identity accepted',
    [],
  ],
  [
    'NET-010',
    'NET-010::CTA::001',
    'Открыть «Снимки и синхронизация кампании»',
    'CMP-010',
    'normative',
    'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=GM; activeRole=GM; confirmed sole master authority; server snapshot loaded; otherwise this diagnostic CTA and GM snapshot data are absent from player payload/DOM/a11y/cache',
    [],
  ],
  [
    'NET-011',
    'NET-011::CTA::001',
    'Вернуться к «Соединение потеряно»',
    'NET-012',
    'subflow-return',
    'safe boundary or completed child context',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-011',
    'NET-011::CTA::002',
    'Повторить прерванную сессию по тому же адресу',
    'NET-009',
    'workflow-command',
    'UI-CMD-CONNECTION-OPEN retry guards; interrupted session/device binding and resumeContext exist for activeRole=PLAYER|GM; transport receipt committed before reconciliation',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-011',
    'NET-011::CTA::003',
    'Повторить новое подключение игрока по тому же адресу',
    'NET-003',
    'workflow-command',
    'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=PLAYER; UI-CMD-CONNECTION-OPEN retry guards; activeRole=PLAYER; no interrupted session/device binding/resumeContext; fresh technical connection receipt committed',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-011',
    'NET-011::CTA::004',
    'Изменить адрес или QR как игрок',
    'NET-002',
    'normative',
    'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=PLAYER; activeRole=PLAYER; local data untouched; CTA absent from GM projection',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-011',
    'NET-011::CTA::005',
    'Выйти в локальное меню игрока',
    'APP-002',
    'normative',
    'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=PLAYER; activeRole=PLAYER; local drafts/sheets unchanged; CTA absent from GM projection',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-011',
    'NET-011::CTA::006',
    'Выйти в меню мастера',
    'APP-011',
    'normative',
    'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=GM; activeRole=GM; host/campaign checkpoint unchanged; no player route or GM-authority takeover',
    ['UI-CMD-CONNECTION-OPEN'],
  ],
  [
    'NET-012',
    'NET-012::CTA::001',
    'Открыть «Потеря соединения»',
    'NET-008',
    'subflow',
    'Server heartbeat lost; no unsafe mutation offline.',
    [],
  ],
  [
    'NET-012',
    'NET-012::CTA::002',
    'Открыть «Сервер недоступен»',
    'NET-011',
    'subflow',
    'Server heartbeat lost; no unsafe mutation offline.',
    [],
  ],
  [
    'NET-012',
    'NET-012::CTA::003',
    'Открыть «Переподключение к игре»',
    'NET-009',
    'journey',
    'Device/session identity and allowed seats revalidated.',
    [],
  ],
] as const;

function sameStrings(actual: unknown, expected: readonly string[], path: string): boolean {
  const values = array(actual, path);
  return (
    values.length === expected.length && values.every((value, index) => value === expected[index])
  );
}

export function assertNetConnectScreenContracts(forms: Readonly<Record<string, unknown>>): void {
  for (const contract of NET_CONNECT_FORM_CONTRACTS) {
    const { formId } = contract;
    const form = record(forms[formId], formId);
    if (
      form['id'] !== formId ||
      form['title'] !== contract.title ||
      form['route'] !== contract.route ||
      form['type'] !== contract.type ||
      !sameStrings(form['roles'], contract.roles, `${formId}.roles`) ||
      !sameStrings(form['contexts'], contract.contexts, `${formId}.contexts`) ||
      !sameStrings(form['requiredFields'], contract.requiredFields, `${formId}.requiredFields`)
    )
      throw new Error(`${formId} differs from its connection source contract`);
    const actions = array(
      record(form['actions'], `${formId}.actions`)['ctaAvailabilityByAction'],
      `${formId}.actions.ctaAvailabilityByAction`,
    );
    const expectedKeys = NET_CONNECT_ACTION_CONTRACTS.filter(([source]) => source === formId).map(
      ([, key]) => key,
    );
    if (
      !sameStrings(
        actions.map((value) => record(value, formId)['actionKey']),
        expectedKeys,
        `${formId}.actionKeys`,
      )
    )
      throw new Error(`${formId} differs from its exhaustive connection action keys`);
  }
  for (const [formId, key, label, target, kind, guard, workflows] of NET_CONNECT_ACTION_CONTRACTS) {
    const form = record(forms[formId], formId);
    const actions = array(
      record(form['actions'], `${formId}.actions`)['ctaAvailabilityByAction'],
      `${formId}.actions.ctaAvailabilityByAction`,
    );
    const matches = actions
      .map((value) => record(value, key))
      .filter((action) => action['actionKey'] === key);
    if (matches.length !== 1) throw new Error(`${key} is missing or duplicated`);
    const action = matches[0]!;
    const source = record(action['authoritativeSource'], `${key}.authoritativeSource`);
    if (
      string(action['label'], key) !== label ||
      action['targetFormId'] !== target ||
      action['kind'] !== kind ||
      action['guard'] !== guard ||
      !sameStrings(source['workflowCommandIds'], workflows, `${key}.workflowCommandIds`)
    )
      throw new Error(`${key} differs from its connection action contract`);
  }
}
