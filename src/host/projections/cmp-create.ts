import { array, record, string } from '../json-source.js';

/** Literal Atlas annotations remain intact; these are not DTO field aliases. */
export const CAMPAIGN_CREATE_SCREEN_CONTRACTS = [
  {
    formId: 'APP-011',
    title: 'Главное меню мастера',
    route: '/master',
    contexts: ['local-app'],
    requiredFields: ['hostDeviceId', 'campaignLibraryState', 'masterAuthorityState'],
  },
  {
    formId: 'CMP-001',
    title: 'Новая кампания: основные данные',
    route: '/master/campaigns/:campaignId/campaign/cmp-001',
    contexts: ['campaign'],
    requiredFields: [
      'campaignDraftId',
      'title(required)',
      'description(optional)',
      'artFilePickerState(optional)',
      'artAssetChecksumOrNull',
      'draftRevision',
    ],
  },
  {
    formId: 'CMP-002',
    title: 'Новая кампания: вместимость и хост',
    route: '/master/campaigns/:campaignId/campaign/cmp-002',
    contexts: ['campaign'],
    requiredFields: [
      'campaignDraftId',
      'activePlayerCapacity[1..5]',
      'hostAddress',
      'hostPort',
      'networkInterface',
      'playerPassword=absent',
      'draftRevision',
    ],
  },
  {
    formId: 'CMP-003',
    title: 'Новая кампания: пароль смены мастера',
    route: '/master/campaigns/:campaignId/campaign/cmp-003',
    contexts: ['campaign'],
    requiredFields: [
      'campaignDraftId',
      'masterTransferPassword',
      'masterTransferPasswordConfirmation',
      'passwordStrengthLocal',
      'secretPersistencePolicy',
      'draftRevision',
    ],
  },
  {
    formId: 'CMP-004',
    title: 'Новая кампания: режим будущих бросков',
    route: '/master/campaigns/:campaignId/campaign/cmp-004',
    contexts: ['campaign'],
    requiredFields: [
      'campaignDraftId',
      'defaultFutureRollMode=MANUAL|AUTO',
      'openRollRequestsUnaffected=true',
      'rulesetSelection=absent',
      'draftRevision',
    ],
  },
  {
    formId: 'CMP-005',
    title: 'Новая кампания: итог',
    route: '/master/campaigns/:campaignId/campaign/cmp-005',
    contexts: ['campaign'],
    requiredFields: [
      'campaignDraftId',
      'fullDraftSummary',
      'baselineVersion',
      'catalogCompatibility',
      'hostBindPreflight',
      'activePlayerCount=0 allowed',
      'validationStatus',
      'commandId',
    ],
  },
  {
    formId: 'CMP-006',
    title: 'Кампания создана',
    route: '/master/campaigns/:campaignId/campaign/cmp-006',
    contexts: ['campaign'],
    requiredFields: [
      'campaignId',
      'status=PAUSED',
      'createdAt',
      'hostAddress',
      'hostPort',
      'qrPayload',
      'activePlayerCapacity',
      'creationReceiptId',
    ],
  },
] as const;

/** Includes the excluded terminal target so source drift cannot silently add Start. */
export const CAMPAIGN_CREATE_ACTION_CONTRACTS = [
  [
    'APP-001',
    'APP-001::CTA::002',
    'Мастер',
    'APP-011',
    'role-branch',
    'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=GM; bootState=READY and no unauthorized active-host takeover',
  ],
  [
    'APP-011',
    'APP-011::CTA::001',
    'Сменить режим',
    'APP-001',
    'normative',
    'launch-shell exception only: no active campaign/host/player projection, no pending command or authority handoff; complete GM DOM/a11y/hotkey/cache namespace disposed before APP-001; no game data mutation',
  ],
  [
    'APP-011',
    'APP-011::CTA::006',
    'Создать кампанию',
    'CMP-001',
    'normative',
    'master launch-mode',
  ],
  [
    'CMP-001',
    'CMP-001::CTA::001',
    'Продолжить к вместимости и host',
    'CMP-002',
    'normative',
    'METADATA_VALID',
  ],
  [
    'CMP-001',
    'CMP-001::CTA::002',
    'Отменить черновик кампании',
    'APP-011',
    'normative',
    'campaignDraftId not committed',
  ],
  [
    'CMP-002',
    'CMP-002::CTA::001',
    'Назад к основным данным',
    'CMP-001',
    'normative',
    'draft cached',
  ],
  [
    'CMP-002',
    'CMP-002::CTA::002',
    'Продолжить к паролю мастера',
    'CMP-003',
    'normative',
    'HOST_CONFIG_VALID',
  ],
  [
    'CMP-003',
    'CMP-003::CTA::001',
    'Назад к host',
    'CMP-002',
    'normative',
    'draft cached and secret cleared from DOM',
  ],
  [
    'CMP-003',
    'CMP-003::CTA::002',
    'Продолжить к режиму будущих бросков',
    'CMP-004',
    'normative',
    'PASSWORD_VALID',
  ],
  [
    'CMP-004',
    'CMP-004::CTA::001',
    'Назад к паролю мастера',
    'CMP-003',
    'normative',
    'draft cached; secret must be re-entered only if policy requires',
  ],
  [
    'CMP-004',
    'CMP-004::CTA::002',
    'Перейти к итоговой проверке',
    'CMP-005',
    'normative',
    'MODE_VALID',
  ],
  [
    'CMP-005',
    'CMP-005::CTA::001',
    'Создать кампанию атомарно',
    'CMP-006',
    'workflow-command',
    'UI-CMD-CAMPAIGN-CREATE guards',
  ],
  [
    'CMP-005',
    'CMP-005::CTA::002',
    'Назад до commit',
    'CMP-004',
    'normative',
    'creation not committed',
  ],
  [
    'CMP-006',
    'CMP-006::CTA::001',
    'Открыть панель созданной кампании',
    'CMP-007',
    'normative',
    'creation receipt confirmed; this does not Start the campaign',
  ],
] as const;

function sameStrings(actual: unknown, expected: readonly string[], path: string): boolean {
  const values = array(actual, path);
  return (
    values.length === expected.length && values.every((value, index) => value === expected[index])
  );
}

export function assertCampaignCreateScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    fields: readonly string[],
    route: string,
    type?: 'screen' | 'dialog',
    roles?: readonly ('player' | 'gm')[],
  ) => void,
): void {
  for (const contract of CAMPAIGN_CREATE_SCREEN_CONTRACTS) {
    assert(forms, contract.formId, contract.requiredFields, contract.route, 'screen', ['gm']);
    const form = record(forms[contract.formId], contract.formId);
    if (
      form['title'] !== contract.title ||
      !sameStrings(form['contexts'], contract.contexts, `${contract.formId}.contexts`)
    )
      throw new Error(`${contract.formId} differs from its campaign creation screen contract`);
  }
  for (const [
    formId,
    actionKey,
    label,
    targetFormId,
    kind,
    guard,
  ] of CAMPAIGN_CREATE_ACTION_CONTRACTS) {
    const form = record(forms[formId], formId);
    const actions = array(
      record(form['actions'], `${formId}.actions`)['ctaAvailabilityByAction'],
      `${formId}.actions.ctaAvailabilityByAction`,
    );
    const matches = actions
      .map((value) => record(value, actionKey))
      .filter((action) => action['actionKey'] === actionKey);
    if (matches.length !== 1) throw new Error(`${actionKey} is missing or duplicated`);
    const action = matches[0]!;
    const source = record(action['authoritativeSource'], `${actionKey}.authoritativeSource`);
    if (
      string(action['label'], actionKey) !== label ||
      action['targetFormId'] !== targetFormId ||
      action['kind'] !== kind ||
      action['guard'] !== guard ||
      !sameStrings(
        source['workflowCommandIds'],
        formId === 'CMP-005' ? ['UI-CMD-CAMPAIGN-CREATE'] : [],
        `${actionKey}.workflowCommandIds`,
      )
    )
      throw new Error(`${actionKey} differs from its campaign creation action contract`);
  }
}
