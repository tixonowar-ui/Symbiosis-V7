export interface AtlasValidationProblem {
  readonly file: string;
  readonly id: string;
  readonly message: string;
}

export interface RendererFormCatalogueValidation {
  readonly forms: ReadonlySet<string>;
  readonly problems: readonly AtlasValidationProblem[];
}

const FORM_INDEX_FILE = 'atlas/renderer/forms-by-id.json';
const DETAILED_FORM_INDEX_FILE = 'atlas/forms-by-id.json';
const FORMS_FILE = DETAILED_FORM_INDEX_FILE;
const JOURNEYS_FILE = 'atlas/journeys.json';
const QA_SCENARIOS_FILE = 'atlas/qa-scenarios.json';
const TRANSITIONS_FILE = 'atlas/transitions.json';
export const ATLAS_MARKDOWN_FILE = 'artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md';

const ADR_0037_ENTRY_GUARD =
  'Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.';
const ADR_0037_CONTINUE_GUARD =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age/sex present; massKg>0 at step 0.1; immutable draft UUID committed';
const ADR_0037_IDENTITY_INCOMPLETE =
  'Continue is absent until name/age/sex/positive 0.1kg mass validate.';
const RETIRED_ENTRY_GUARD =
  'Новый immutable UUID; обязательны имя, возраст и положительная massKg 0,1; описание/арт необязательны.';
const RETIRED_CONTINUE_GUARD =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age present; massKg>0 at step 0.1; immutable draft UUID committed';
const RETIRED_IDENTITY_INCOMPLETE =
  'Continue is absent until name/age/positive 0.1kg mass validate.';

const MARKDOWN_IDENTITY_LITERALS = [
  {
    id: 'entry',
    current: ADR_0037_ENTRY_GUARD,
    retired: RETIRED_ENTRY_GUARD,
    expected: 4,
  },
  {
    id: 'continue',
    current: ADR_0037_CONTINUE_GUARD,
    retired: RETIRED_CONTINUE_GUARD,
    expected: 3,
  },
  {
    id: 'identity-incomplete',
    current: ADR_0037_IDENTITY_INCOMPLETE,
    retired: RETIRED_IDENTITY_INCOMPLETE,
    expected: 1,
  },
] as const;

const CHR_014_SECTION = ['### CHR-014 —', '### CHR-015 —'] as const;
const CHR_018_SECTION = ['### CHR-018 —', '### CHR-019 —'] as const;
const CHR_020_SECTION = ['### CHR-020 —', '### CHR-021 —'] as const;
const CHR_041_SECTION = ['### CHR-041 —', '### CHR-042 —'] as const;
const NO_SECTION = ['', ''] as const;

/** ADR 0049 names every checked companion literal and its render cardinality. */
export const ATLAS_MARKDOWN_ADR0049_LITERALS = [
  {
    id: 'atlas-heading',
    current: '# Symbiosis V7 — Web UI Screen Atlas v1.4',
    retired: '# Symbiosis V7 — Web UI Screen Atlas v1.3',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-version',
    current: '| Версия атласа | 1.4 |',
    retired: '| Версия атласа | 1.3 |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-date',
    current: '| Дата | 2026-08-21 |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-transition-count',
    current: '1680',
    retired: '1677',
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'skill-route',
    current: '/player/characters/:localCharacterId/create/chr-014/:skillId',
    retired: '',
    expected: 1,
    section: CHR_014_SECTION,
  },
  {
    id: 'species-route',
    current: '/player/characters/:localCharacterId/create/chr-018/:speciesKey',
    retired: '',
    expected: 1,
    section: CHR_018_SECTION,
  },
  {
    id: 'skill-reachability-out',
    current:
      '| CHR-014 | Адресуемый route либо server/system event текущей роли | role=player; все entryConditions и guardStates целевой формы выполнены; skillId exists in current eligible or inspectable catalog [role-state-reachability] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'skill-reachability-in',
    current:
      '| CHR-013 | Адресуемый route либо server/system event текущей роли | role=player; все entryConditions и guardStates целевой формы выполнены; skillId exists in current eligible or inspectable catalog [role-state-reachability] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'species-reachability-out',
    current:
      '| CHR-018 | Адресуемый route либо server/system event текущей роли | role=player; все entryConditions и guardStates целевой формы выполнены; speciesKey is compatible with race/manual composition [role-state-reachability] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'species-reachability-in',
    current:
      '| CHR-017 | Адресуемый route либо server/system event текущей роли | role=player; все entryConditions и guardStates целевой формы выполнены; speciesKey is compatible with race/manual composition [role-state-reachability] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'advisor-confirm-label',
    current: 'Подтвердить навыки Советника',
    retired: 'Подтвердить просмотр сохранённой карточки Советника',
    expected: 8,
    section: NO_SECTION,
  },
  {
    id: 'advisor-confirm-guard',
    current:
      'UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll',
    retired: 'Advisor card and both I/W receipts persisted; acknowledgement only; no cancel/reroll',
    expected: 3,
    section: NO_SECTION,
  },
  {
    id: 'advisor-confirm-action',
    current:
      '| CHR-041::CTA::001 | Подтвердить навыки Советника | CHR-019 | UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll | workflow-command |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-confirm-transition-out',
    current:
      '| CHR-019 | Подтвердить навыки Советника | UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll [workflow-command] |',
    retired:
      '| CHR-019 | Подтвердить навыки Советника | UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll [normative] |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'advisor-confirm-transition-in',
    current:
      '| CHR-041 | Подтвердить навыки Советника | UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll [workflow-command] |',
    retired:
      '| CHR-041 | Подтвердить навыки Советника | UI-CMD-CHAR-WIZARD-CHECKPOINT Advisor card and both I/W receipts persisted; all mandatory Advisor starting slots validate; no cancel/reroll [normative] |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'advisor-edit-action',
    current:
      '| CHR-041::CTA::002 | Добавить или удалить допустимый навык Советника | CHR-041 | iwRollReceiptIds present; selection remains within Advisor-eligible skills and mutable Advisor slot draft | local-draft-command |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-edit-transitions',
    current:
      '| CHR-041 | Добавить или удалить допустимый навык Советника | iwRollReceiptIds present; selection remains within Advisor-eligible skills and mutable Advisor slot draft [local-draft-command] |',
    retired: '',
    expected: 2,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-visible-allowed',
    current:
      'Разрешённые видимые действия/CTA именно этой формы: Зафиксировать броски I и W Советника; Добавить или удалить допустимый навык Советника; Подтвердить навыки Советника.',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-command-allowed',
    current:
      '- Разрешённые atlas workflow commands этой формы: UI-CMD-CHAR-CREATION-ROLL-COMMIT, UI-CMD-CHAR-WIZARD-CHECKPOINT.',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-availability-source',
    current:
      '| authoritativeSource | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-CHAR-CREATION-ROLL-COMMIT", "UI-CMD-CHAR-WIZARD-CHECKPOINT"]} |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-roll-availability',
    current:
      '| UI-CMD-CHAR-CREATION-ROLL-COMMIT | Roll variants require pending creationRollRequestId',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-workflow-availability',
    current: '| UI-CMD-CHAR-WIZARD-CHECKPOINT | Player owns the characterDraftId;',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-reference-command',
    current:
      '| Atlas workflow command | UI-CMD-CHAR-CREATION-ROLL-COMMIT, UI-CMD-CHAR-WIZARD-CHECKPOINT |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-coverage',
    current:
      "{'formId': 'CHR-041', 'primaryActions': ['Зафиксировать броски I и W Советника', 'Добавить или удалить допустимый навык Советника', 'Подтвердить навыки Советника'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-CREATION-ROLL-COMMIT', 'UI-CMD-CHAR-WIZARD-CHECKPOINT']}",
    retired: '',
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'advisor-form-qa',
    current:
      'Проверить буквальное назначение CHR-041: После навыков выполняется ранее зафиксированный manual/random путь; Советник получает собственную карточку, а manual-конфликты показывают необратимый slot/stat/OE diff до commit. Поля: characterDraftId, advisorInstanceDraftId, advisorCard, iwRollRequestIds[2], iwRollReceiptIds[2]OrNull, advisorIPlus8OrNull, advisorWPlus8OrNull, advisorSlotsAndSkills, trogrSuppressionState, acknowledged, wizardCheckpointId, draftRevision, commandId. CTA: Зафиксировать броски I и W Советника, Добавить или удалить допустимый навык Советника, Подтвердить навыки Советника.',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'advisor-component',
    current: '- Skills checkpoint',
    retired: '- Acknowledge only',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-state',
    current:
      '| ACKNOWLEDGED | The same Advisor draft with confirmed skills continues to CHR-019. |',
    retired: '| ACKNOWLEDGED | The same Advisor draft continues to CHR-019. |',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'random-advisor-state',
    current: '| ADVISOR_ACK_REQUIRED | CHR-041 skills must be confirmed before composition. |',
    retired: '| ADVISOR_ACK_REQUIRED | CHR-041 must be acknowledged before composition. |',
    expected: 1,
    section: CHR_020_SECTION,
  },
  {
    id: 'roll-guard',
    current:
      'UI-CMD-CHAR-CREATION-ROLL-COMMIT current roll or binding-only phase; roll variant preserves the persisted sequence and critical-monster snapshot; binding-only requires randomStatus=BINDING and exact side snapshot with a fresh commandId; server dispatches CHR-041 for Advisor or CHR-019',
    retired:
      'UI-CMD-CHAR-CREATION-ROLL-COMMIT one persisted sequence; binding and critical-monster local-draft snapshots validate at their commit boundary; server dispatches CHR-041 for Advisor or CHR-019',
    expected: 3,
    section: CHR_020_SECTION,
  },
  {
    id: 'side-action',
    current: String.raw`| CHR-020::CTA::003 | Выбрать допустимую сторону Совы или Угря | CHR-020 | randomStatus=NOT_STARTED\|PENDING\|BINDING and bindingKind=OWL_EYE\|EEL_ARM and selected side eligible | local-draft-command |`,
    retired: '',
    expected: 1,
    section: CHR_020_SECTION,
  },
  {
    id: 'side-transitions',
    current: String.raw`| CHR-020 | Выбрать допустимую сторону Совы или Угря | randomStatus=NOT_STARTED\|PENDING\|BINDING and bindingKind=OWL_EYE\|EEL_ARM and selected side eligible [local-draft-command] |`,
    retired: '',
    expected: 2,
    section: CHR_020_SECTION,
  },
  {
    id: 'monster-action',
    current:
      '| CHR-020::CTA::004 | Выбрать вид симбиотического чудовища | CHR-020 | saved UNITED critical unlocks symbiotic monster choice; selection remains within eligible monster species and mutable draft | local-draft-command |',
    retired: '',
    expected: 1,
    section: CHR_020_SECTION,
  },
  {
    id: 'monster-transitions',
    current:
      '| CHR-020 | Выбрать вид симбиотического чудовища | saved UNITED critical unlocks symbiotic monster choice; selection remains within eligible monster species and mutable draft [local-draft-command] |',
    retired: '',
    expected: 2,
    section: CHR_020_SECTION,
  },
  {
    id: 'random-visible-allowed',
    current:
      'Разрешённые видимые действия/CTA именно этой формы: Выбрать допустимую сторону Совы или Угря; Выбрать вид симбиотического чудовища; Зафиксировать случайное определение симбионтов; Вернуться к выбору ветви до показа результата.',
    retired: '',
    expected: 1,
    section: CHR_020_SECTION,
  },
  {
    id: 'random-coverage',
    current:
      "{'formId': 'CHR-020', 'primaryActions': ['Выбрать допустимую сторону Совы или Угря', 'Выбрать вид симбиотического чудовища', 'Зафиксировать случайное определение симбионтов', 'Вернуться к выбору ветви до показа результата'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-CREATION-ROLL-COMMIT']}",
    retired: '',
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'random-form-qa',
    current: String.raw`Проверить буквальное назначение CHR-020: После навыков выполняется ранее зафиксированный manual/random путь; Советник получает собственную карточку, а manual-конфликты показывают необратимый slot/stat/OE diff до commit. Поля: characterDraftId, raceChoice=UNITED\|FREE, symbiontAcquisitionMode=RANDOM, randomSequenceId, pendingRollRequestIdOrNull, diceInputModeSnapshot, seedOrManualFaces, drawnSpeciesAndBindings[], duplicateRerollReceipts[], advisorBranch, randomStatus=NOT_STARTED\|PENDING\|BINDING\|COMMITTED, wizardCheckpointId, draftRevision, commandId. CTA: Выбрать допустимую сторону Совы или Угря, Выбрать вид симбиотического чудовища, Зафиксировать случайное определение симбионтов, Вернуться к выбору ветви до показа результата.`,
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'advisor-iw-action',
    current:
      '| CHR-041::CTA::003 | Зафиксировать броски I и W Советника | CHR-041 | UI-CMD-CHAR-CREATION-ROLL-COMMIT exactly two addressed pending Advisor I/W requests in I,W order; no existing I/W receipts; no critical chain, creation penalty or XP | workflow-command |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-iw-transitions',
    current:
      '| CHR-041 | Зафиксировать броски I и W Советника | UI-CMD-CHAR-CREATION-ROLL-COMMIT exactly two addressed pending Advisor I/W requests in I,W order; no existing I/W receipts; no critical chain, creation penalty or XP [workflow-command] |',
    retired: '',
    expected: 2,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-iw-state',
    current:
      '| IW_ROLLS_REQUIRED | Two addressed I/W requests are pending; commit them in I,W order without replacement or reroll. |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-card-state',
    current:
      '| CARD_REQUIRED | Persisted Advisor data and both I/W receipts are shown; no cancel/reroll exists. |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'random-binding-state',
    current:
      '| BINDING | Displayed rolls are immutable; exact side snapshot awaits binding-only commit before dispatch. |',
    retired: '',
    expected: 1,
    section: CHR_020_SECTION,
  },
  {
    id: 'random-terminal-states',
    current:
      '"CHR-020": ["NOT_STARTED", "PENDING_INPUT", "BINDING", "COMMITTED", "ADVISOR_ACK_REQUIRED"]',
    retired: '',
    expected: 4,
    section: NO_SECTION,
  },
  {
    id: 'advisor-terminal-states',
    current: '"CHR-041": ["IW_ROLLS_REQUIRED", "CARD_REQUIRED", "ACKNOWLEDGED"]',
    retired: '',
    expected: 4,
    section: NO_SECTION,
  },
  {
    id: 'roll-form-list',
    current: 'CHR-003, CHR-004, CHR-020, CHR-041, CHR-021, CHR-022, CHR-037, CHR-038',
    retired: '',
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'roll-command-guards',
    current:
      'Roll variants require pending creationRollRequestId to belong to the draft, stage, branch and immutable AUTO/MANUAL diceInputModeSnapshot; manual face is in the exact die range or server RNG receipt is valid; no receipt exists for that request. CHR-041 Advisor I/W requires exactly two pending requests in I,W order. CHR-020 binding-only instead requires randomStatus=BINDING, saved roll/result ownership and exact side snapshot; no new roll request is created.',
    retired: '',
    expected: 9,
    section: NO_SECTION,
  },
  {
    id: 'roll-atomicity',
    current:
      'Persist exactly one stage result, one command receipt and the resulting next-state pointer; Advisor I/W is one ordered two-roll result with two immutable roll receipts, while CHR-020 binding-only persists only the exact side snapshot without a new face/request/sampler/random receipt; the first display crosses the no-reroll boundary and cannot be undone by Back, refresh, branch switch or replay.',
    retired: '',
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'manual-add-action',
    current:
      '| CHR-018::CTA::001 | Добавить симбионта в ручной состав | CHR-018 | UI-CMD-CHAR-WIZARD-CHECKPOINT compatibility/binding/slot preview valid; server dispatches CHR-041 for Advisor with two addressed pending I/W requests or CHR-019 for non-Advisor | workflow-command |',
    retired: '',
    expected: 1,
    section: CHR_018_SECTION,
  },
  {
    id: 'manual-add-transitions',
    current:
      '| CHR-018 | Добавить симбионта в ручной состав | UI-CMD-CHAR-WIZARD-CHECKPOINT compatibility/binding/slot preview valid; server dispatches CHR-041 for Advisor with two addressed pending I/W requests or CHR-019 for non-Advisor [workflow-command] |',
    retired: '',
    expected: 2,
    section: CHR_018_SECTION,
  },
  {
    id: 'manual-advisor-dispatch-out',
    current:
      '| CHR-041 | Dispatch persisted manual Advisor branch | manual composition committed; advisorBranch=true; Advisor draft and two addressed pending I/W requests preserved; no face/result or replacement request created [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'manual-advisor-dispatch-in',
    current:
      '| CHR-018 | Dispatch persisted manual Advisor branch | manual composition committed; advisorBranch=true; Advisor draft and two addressed pending I/W requests preserved; no face/result or replacement request created [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'manual-non-advisor-dispatch-out',
    current:
      '| CHR-019 | Dispatch persisted manual non-Advisor composition | manual composition committed; advisorBranch=false; full species/binding provenance attached to composition; no Advisor I/W request created [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'manual-non-advisor-dispatch-in',
    current:
      '| CHR-018 | Dispatch persisted manual non-Advisor composition | manual composition committed; advisorBranch=false; full species/binding provenance attached to composition; no Advisor I/W request created [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'random-advisor-dispatch-out',
    current:
      '| CHR-041 | Dispatch persisted Advisor branch | randomStatus=COMMITTED and binding snapshot committed; advisorBranch=true; Advisor draft and two addressed I/W results preserved; no reroll [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'random-advisor-dispatch-in',
    current:
      '| CHR-020 | Dispatch persisted Advisor branch | randomStatus=COMMITTED and binding snapshot committed; advisorBranch=true; Advisor draft and two addressed I/W results preserved; no reroll [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'random-non-advisor-dispatch-out',
    current:
      '| CHR-019 | Dispatch persisted non-Advisor random composition | randomStatus=COMMITTED and binding snapshot committed; advisorBranch=false; full species/binding/random provenance attached to composition [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'random-non-advisor-dispatch-in',
    current:
      '| CHR-020 | Dispatch persisted non-Advisor random composition | randomStatus=COMMITTED and binding snapshot committed; advisorBranch=false; full species/binding/random provenance attached to composition [system-event] |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'random-qna-reference',
    current:
      '| Q&A | Q-CHAR-002, Q-CHAR-004, Q-CHAR-007, Q-CHAR-008, Q-CHAR-010, Q-CORE-054, Q-SYM-003 |',
    retired: '',
    expected: 1,
    section: CHR_020_SECTION,
  },
  {
    id: 'aqa004-active-rules-registry',
    current: '| CHR-010, CHR-011, CHR-017, CHR-020, CHR-029 | RULE_ENGINE::AQA-004 |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qcore054-qna-registry',
    current:
      '| 54 | Q-CORE-054 | Закрыт | CHR-016, CHR-017, CHR-020, CHR-019 | SENIOR_RULE_DERIVATION |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qchar004-qna-registry',
    current:
      '| 300 | Q-CHAR-004 | Закрыт | CHR-010, CHR-011, CHR-017, CHR-020, CHR-029 | SENIOR_RULE_DERIVATION |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qchar010-qna-registry',
    current:
      '| 306 | Q-CHAR-010 | Закрыт | CHR-001, CHR-018, CHR-020, CHR-025, CHR-033, NET-019, NET-021, NPC-011, ENM-013 | CURATED_QNA_FORM_OVERRIDE |',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qcore054-scenario',
    current:
      'Подтвердить материализацию строки Q&A в CHR-016, CHR-017, CHR-020, CHR-019: Нужно ли при ручном выборе заполнить все слоты и доступно ли чудовище?',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qchar004-scenario',
    current:
      'Подтвердить материализацию строки Q&A в CHR-010, CHR-011, CHR-017, CHR-020, CHR-029: Какие данные сохраняются, пересчитываются или удаляются при смене расы, класса, ручного симбионта и возврате на предыдущий этап?',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'aqa004-scenario',
    current:
      'Проверить rule handler и проекцию «Какие данные сохраняются, пересчитываются или удаляются при смене расы, класса, ручного симбионта и возврате на предыдущий этап?» через CHR-010, CHR-011, CHR-017, CHR-020, CHR-029.',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qchar010-scenario',
    current:
      'Подтвердить материализацию строки Q&A в CHR-001, CHR-018, CHR-020, CHR-025, CHR-033, NET-019, NET-021, NPC-011, ENM-013: Где при создании задаются масса и анатомия, какие значения допустимы и как выбирается сторона для Совы и Угря?',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'qchar010-effective-suffix',
    current:
      'The original answer remains effective for CHR-018, CHR-020, CHR-033, NET-019, NET-021, NPC-011 and ENM-013.',
    retired: '',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'workflow-form-list',
    current:
      'CHR-001, CHR-009, CHR-012, CHR-014, CHR-015, CHR-018, CHR-041, CHR-019, CHR-021, CHR-022, CHR-024, CHR-025, CHR-032, CHR-037, CHR-038',
    retired: '',
    expected: 2,
    section: NO_SECTION,
  },
] as const;

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(
  row: JsonRecord,
  field: string,
  file: string,
  id: string,
  problems: AtlasValidationProblem[],
): string | null {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    problems.push({ file, id, message: `${field} is empty or not text` });
    return null;
  }
  return value;
}

function textArrayField(
  row: JsonRecord,
  field: string,
  file: string,
  id: string,
  problems: AtlasValidationProblem[],
): readonly string[] | null {
  const value = row[field];
  if (!Array.isArray(value)) {
    problems.push({ file, id, message: `${field} is not an array of text values` });
    return null;
  }
  const result: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') {
      problems.push({ file, id, message: `${field} is not an array of text values` });
      return null;
    }
    result.push(entry);
  }
  return result;
}

function recordArrayField(
  row: JsonRecord,
  field: string,
  file: string,
  id: string,
  problems: AtlasValidationProblem[],
): readonly unknown[] | null {
  const value = row[field];
  if (!Array.isArray(value)) {
    problems.push({ file, id, message: `${field} is not an array` });
    return null;
  }
  return Array.from(value as readonly unknown[]);
}

function singleRecord(
  rows: readonly unknown[],
  predicate: (row: JsonRecord) => boolean,
  file: string,
  id: string,
  description: string,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  const matches = rows.filter((row): row is JsonRecord => isRecord(row) && predicate(row));
  if (matches.length !== 1) {
    problems.push({
      file,
      id,
      message: `expected exactly one ${description}, got ${String(matches.length)}`,
    });
    return null;
  }
  return matches[0]!;
}

function expectLiteral(
  row: JsonRecord,
  field: string,
  expected: string,
  file: string,
  id: string,
  label: string,
  problems: AtlasValidationProblem[],
): void {
  const actual = row[field];
  if (actual !== expected) {
    problems.push({
      file,
      id,
      message:
        `${field} differs from ADR 0037 ${label}: expected ${JSON.stringify(expected)}, ` +
        `got ${JSON.stringify(actual)}`,
    });
  }
}

function countLiteral(source: string, literal: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= source.length - literal.length) {
    const found = source.indexOf(literal, offset);
    if (found === -1) break;
    count += 1;
    offset = found + literal.length;
  }
  return count;
}

/** ADR 0039 fixes the raw companion counts without defining a Markdown parser. */
export function validateAtlasMarkdownIdentityTextMirrors(
  markdown: string,
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];

  for (const literal of MARKDOWN_IDENTITY_LITERALS) {
    const retiredCount = countLiteral(markdown, literal.retired);
    if (retiredCount !== 0) {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message: `retired ADR 0037 literal count is ${String(retiredCount)}, expected 0`,
      });
    }

    const currentCount = countLiteral(markdown, literal.current);
    if (currentCount !== literal.expected) {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message:
          `current ADR 0037 literal count is ${String(currentCount)}, ` +
          `expected ${String(literal.expected)} by ADR 0039`,
      });
    }
  }

  return problems;
}

function markdownAdr0049Source(markdown: string, section: readonly [string, string]): string {
  const [startMarker, endMarker] = section;
  if (startMarker === '') return markdown;
  const start = markdown.indexOf(startMarker);
  if (start === -1) return '';
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? '' : markdown.slice(start, end);
}

/** ADR 0049 adds a finite companion registry, not a general Markdown parser. */
export function validateAtlasMarkdownAdr0049TextMirrors(
  markdown: string,
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];

  for (const literal of ATLAS_MARKDOWN_ADR0049_LITERALS) {
    const source = markdownAdr0049Source(markdown, literal.section);
    if (source === '') {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message: `ADR 0049 Markdown section ${JSON.stringify(literal.section)} is missing`,
      });
      continue;
    }

    if (literal.retired !== '') {
      const retiredCount = countLiteral(source, literal.retired);
      if (retiredCount !== 0) {
        problems.push({
          file: ATLAS_MARKDOWN_FILE,
          id: literal.id,
          message: `retired ADR 0049 literal count is ${String(retiredCount)}, expected 0`,
        });
      }
    }

    const currentCount = countLiteral(source, literal.current);
    if (currentCount !== literal.expected) {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message:
          `current ADR 0049 literal count is ${String(currentCount)}, ` +
          `expected ${String(literal.expected)}`,
      });
    }
  }

  return problems;
}

/**
 * The renderer index is now the form catalogue. Its object key and embedded
 * `id` are two independently consumed addresses, so require them to agree.
 */
export function validateRendererFormCatalogue(
  index: Readonly<Record<string, unknown>>,
  idPattern: RegExp,
  expectedCount: number | null,
): RendererFormCatalogueValidation {
  const problems: AtlasValidationProblem[] = [];
  const forms = new Set<string>();
  const entries = Object.entries(index);

  if (expectedCount !== null && entries.length !== expectedCount) {
    problems.push({
      file: FORM_INDEX_FILE,
      id: '-',
      message:
        `expected ${String(expectedCount)} form entries from atlas/meta.json counts.forms, ` +
        `got ${String(entries.length)}`,
    });
  }

  for (const [key, value] of entries) {
    if (!isRecord(value)) {
      problems.push({ file: FORM_INDEX_FILE, id: key, message: 'entry is not an object' });
      continue;
    }

    const embedded = value['id'];
    if (typeof embedded !== 'string' || embedded === '') {
      problems.push({ file: FORM_INDEX_FILE, id: key, message: 'id is empty or not text' });
      continue;
    }

    if (forms.has(embedded)) {
      problems.push({ file: FORM_INDEX_FILE, id: embedded, message: 'duplicate id' });
    }
    if (!idPattern.test(embedded)) {
      problems.push({
        file: FORM_INDEX_FILE,
        id: embedded,
        message: `id does not match ${String(idPattern)}`,
      });
    }
    if (key !== embedded) {
      problems.push({
        file: FORM_INDEX_FILE,
        id: key,
        message: `key does not match embedded id ${JSON.stringify(embedded)}`,
      });
    }
    forms.add(embedded);
  }

  return { forms, problems };
}

/** The retained detailed index must address exactly the compact catalogue. */
export function validateDetailedFormIndexKeys(
  detailedIndex: Readonly<Record<string, unknown>>,
  rendererForms: ReadonlySet<string>,
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const detailedKeys = new Set(Object.keys(detailedIndex));

  for (const id of rendererForms) {
    if (!detailedKeys.has(id)) {
      problems.push({
        file: DETAILED_FORM_INDEX_FILE,
        id,
        message: `key is missing for id declared in ${FORM_INDEX_FILE}`,
      });
    }
  }
  for (const key of detailedKeys) {
    if (!rendererForms.has(key)) {
      problems.push({
        file: DETAILED_FORM_INDEX_FILE,
        id: key,
        message: `key is not declared in ${FORM_INDEX_FILE}`,
      });
    }
  }

  return problems;
}

/**
 * Atlas form prose is intentionally authored once and repeated literally in
 * its QA row. Validate the declared mapping and forward-render the field list;
 * parsing the comma-separated prose back into fields would be ambiguous.
 */
export function validateAtlasFormQaMirrors(
  formRows: readonly unknown[],
  qaRows: readonly unknown[],
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const qaById = new Map<string, JsonRecord[]>();

  for (const value of qaRows) {
    if (!isRecord(value) || typeof value['qaId'] !== 'string' || value['qaId'] === '') continue;
    const matches = qaById.get(value['qaId']) ?? [];
    matches.push(value);
    qaById.set(value['qaId'], matches);
  }

  const formIds = new Set<string>();
  formRows.forEach((value, index) => {
    const rowId = `row ${String(index)}`;
    if (!isRecord(value)) {
      problems.push({ file: FORMS_FILE, id: rowId, message: 'expected a record' });
      return;
    }

    const id = textField(value, 'id', FORMS_FILE, rowId, problems);
    if (id === null) return;
    if (formIds.has(id)) {
      problems.push({ file: FORMS_FILE, id, message: 'duplicate id' });
    }
    formIds.add(id);

    const purpose = textField(value, 'purpose', FORMS_FILE, id, problems);
    const requiredFields = textArrayField(value, 'requiredFields', FORMS_FILE, id, problems);
    const qaScenarioIds = textArrayField(value, 'qaScenarioIds', FORMS_FILE, id, problems);
    const acceptance = textArrayField(value, 'acceptanceCriteria', FORMS_FILE, id, problems);
    const expectedQaId = `QA-FORM-${id}`;

    if (qaScenarioIds !== null) {
      const references = qaScenarioIds.filter((qaId) => qaId === expectedQaId).length;
      if (references !== 1) {
        problems.push({
          file: FORMS_FILE,
          id,
          message:
            `qaScenarioIds contains ${JSON.stringify(expectedQaId)} ${String(references)} times, ` +
            'expected 1',
        });
      }
    }

    if (purpose !== null && acceptance !== null) {
      const expected = `Назначение реализовано буквально: ${purpose}`;
      const matches = acceptance.filter((criterion) => criterion === expected).length;
      if (matches !== 1) {
        problems.push({
          file: FORMS_FILE,
          id,
          message:
            `acceptanceCriteria contains the literal purpose criterion ${String(matches)} times, ` +
            'expected 1',
        });
      }
    }

    const qaMatches = qaById.get(expectedQaId) ?? [];
    if (qaMatches.length !== 1) {
      problems.push({
        file: QA_SCENARIOS_FILE,
        id: expectedQaId,
        message: `expected exactly one QA row, got ${String(qaMatches.length)}`,
      });
      return;
    }

    const qa = qaMatches[0]!;
    const scope = textField(qa, 'scope', QA_SCENARIOS_FILE, expectedQaId, problems);
    if (scope !== null && scope !== id) {
      problems.push({
        file: QA_SCENARIOS_FILE,
        id: expectedQaId,
        message: `scope ${JSON.stringify(scope)} does not match form id ${JSON.stringify(id)}`,
      });
    }

    const scenario = textField(qa, 'scenario', QA_SCENARIOS_FILE, expectedQaId, problems);
    if (scenario === null) return;
    if (purpose !== null) {
      const purposeLiteral = `Проверить буквальное назначение ${id}: ${purpose}`;
      if (!scenario.includes(purposeLiteral)) {
        problems.push({
          file: QA_SCENARIOS_FILE,
          id: expectedQaId,
          message: `scenario does not contain literal purpose from ${FORMS_FILE}`,
        });
      }
    }
    if (requiredFields !== null) {
      const fieldsLiteral = `Поля: ${requiredFields.join(', ')}.`;
      if (!scenario.includes(fieldsLiteral)) {
        problems.push({
          file: QA_SCENARIOS_FILE,
          id: expectedQaId,
          message: `scenario does not contain requiredFields joined with ", " from ${FORMS_FILE}`,
        });
      }
    }
  });

  for (const qaId of qaById.keys()) {
    if (qaId.startsWith('QA-FORM-') && !formIds.has(qaId.slice('QA-FORM-'.length))) {
      problems.push({
        file: QA_SCENARIOS_FILE,
        id: qaId,
        message: 'QA-FORM row has no matching form',
      });
    }
  }

  return problems;
}

interface TransitionTuple {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
  readonly kind: string;
}

const ENTRY_TUPLE: TransitionTuple = {
  from: 'APP-004',
  to: 'CHR-001',
  trigger: 'J-CHAR-CREATE::DRAFT_IDENTITY::open',
  kind: 'subflow',
};

const CONTINUE_TUPLE: TransitionTuple = {
  from: 'CHR-001',
  to: 'CHR-010',
  trigger: 'Сохранить идентичность и продолжить',
  kind: 'workflow-command',
};

function formById(
  forms: readonly unknown[],
  id: string,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  return singleRecord(
    forms,
    (row) => row['id'] === id,
    FORMS_FILE,
    id,
    `form with id ${JSON.stringify(id)}`,
    problems,
  );
}

function actionByKey(
  form: JsonRecord,
  formId: string,
  actionKey: string,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  const actions = form['actions'];
  if (!isRecord(actions)) {
    problems.push({ file: FORMS_FILE, id: formId, message: 'actions is not an object' });
    return null;
  }
  const rows = recordArrayField(actions, 'ctaAvailabilityByAction', FORMS_FILE, formId, problems);
  if (rows === null) return null;
  return singleRecord(
    rows,
    (row) => row['actionKey'] === actionKey,
    FORMS_FILE,
    actionKey,
    `action with actionKey ${JSON.stringify(actionKey)}`,
    problems,
  );
}

function transitionFromForm(
  form: JsonRecord,
  direction: 'transitionsIn' | 'transitionsOut',
  tuple: TransitionTuple,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  const formId = direction === 'transitionsOut' ? tuple.from : tuple.to;
  const rows = recordArrayField(form, direction, FORMS_FILE, formId, problems);
  if (rows === null) return null;
  return singleRecord(
    rows,
    (row) =>
      row[direction === 'transitionsOut' ? 'to' : 'from'] ===
        (direction === 'transitionsOut' ? tuple.to : tuple.from) &&
      row['trigger'] === tuple.trigger &&
      row['kind'] === tuple.kind,
    FORMS_FILE,
    `${tuple.from}→${tuple.to}`,
    `${direction} row for ${JSON.stringify(tuple.trigger)}`,
    problems,
  );
}

function topLevelTransition(
  transitions: readonly unknown[],
  tuple: TransitionTuple,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  return singleRecord(
    transitions,
    (row) =>
      row['from'] === tuple.from &&
      row['to'] === tuple.to &&
      row['trigger'] === tuple.trigger &&
      row['kind'] === tuple.kind,
    TRANSITIONS_FILE,
    `${tuple.from}→${tuple.to}`,
    `transition tuple ${JSON.stringify([tuple.from, tuple.to, tuple.trigger, tuple.kind])}`,
    problems,
  );
}

/** ADR 0037 names the finite registry of identity prose mirrors explicitly. */
export function validateChr001IdentityTextMirrors(
  forms: readonly unknown[],
  journeys: readonly unknown[],
  transitions: readonly unknown[],
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const app004 = formById(forms, 'APP-004', problems);
  const chr001 = formById(forms, 'CHR-001', problems);
  const chr010 = formById(forms, 'CHR-010', problems);

  const journey = singleRecord(
    journeys,
    (row) => row['id'] === 'J-CHAR-CREATE',
    JOURNEYS_FILE,
    'J-CHAR-CREATE',
    'journey with id "J-CHAR-CREATE"',
    problems,
  );
  if (journey !== null) {
    const steps = recordArrayField(journey, 'steps', JOURNEYS_FILE, 'J-CHAR-CREATE', problems);
    if (steps !== null) {
      const identityStep = singleRecord(
        steps,
        (row) => row['state'] === 'DRAFT_IDENTITY',
        JOURNEYS_FILE,
        'J-CHAR-CREATE/DRAFT_IDENTITY',
        'journey step with state "DRAFT_IDENTITY"',
        problems,
      );
      if (identityStep !== null) {
        expectLiteral(
          identityStep,
          'guards',
          ADR_0037_ENTRY_GUARD,
          JOURNEYS_FILE,
          'J-CHAR-CREATE/DRAFT_IDENTITY',
          'entry guard literal',
          problems,
        );
      }
    }
  }

  if (app004 !== null) {
    const action = actionByKey(app004, 'APP-004', 'APP-004::CTA::001', problems);
    if (action !== null) {
      expectLiteral(
        action,
        'guard',
        ADR_0037_ENTRY_GUARD,
        FORMS_FILE,
        'APP-004::CTA::001',
        'entry guard literal',
        problems,
      );
    }
    const outgoing = transitionFromForm(app004, 'transitionsOut', ENTRY_TUPLE, problems);
    if (outgoing !== null) {
      expectLiteral(
        outgoing,
        'guard',
        ADR_0037_ENTRY_GUARD,
        FORMS_FILE,
        'APP-004→CHR-001',
        'entry guard literal',
        problems,
      );
    }
  }

  if (chr001 !== null) {
    const incoming = transitionFromForm(chr001, 'transitionsIn', ENTRY_TUPLE, problems);
    if (incoming !== null) {
      expectLiteral(
        incoming,
        'guard',
        ADR_0037_ENTRY_GUARD,
        FORMS_FILE,
        'APP-004→CHR-001',
        'entry guard literal',
        problems,
      );
    }
    const action = actionByKey(chr001, 'CHR-001', 'CHR-001::CTA::001', problems);
    if (action !== null) {
      expectLiteral(
        action,
        'guard',
        ADR_0037_CONTINUE_GUARD,
        FORMS_FILE,
        'CHR-001::CTA::001',
        'Continue guard literal',
        problems,
      );
    }
    const outgoing = transitionFromForm(chr001, 'transitionsOut', CONTINUE_TUPLE, problems);
    if (outgoing !== null) {
      expectLiteral(
        outgoing,
        'guard',
        ADR_0037_CONTINUE_GUARD,
        FORMS_FILE,
        'CHR-001→CHR-010',
        'Continue guard literal',
        problems,
      );
    }
    const states = chr001['states'];
    if (!isRecord(states)) {
      problems.push({ file: FORMS_FILE, id: 'CHR-001', message: 'states is not an object' });
    } else {
      expectLiteral(
        states,
        'IDENTITY_INCOMPLETE',
        ADR_0037_IDENTITY_INCOMPLETE,
        FORMS_FILE,
        'CHR-001.IDENTITY_INCOMPLETE',
        'IDENTITY_INCOMPLETE literal',
        problems,
      );
    }
  }

  if (chr010 !== null) {
    const incoming = transitionFromForm(chr010, 'transitionsIn', CONTINUE_TUPLE, problems);
    if (incoming !== null) {
      expectLiteral(
        incoming,
        'guard',
        ADR_0037_CONTINUE_GUARD,
        FORMS_FILE,
        'CHR-001→CHR-010',
        'Continue guard literal',
        problems,
      );
    }
  }

  for (const [tuple, expected, label] of [
    [ENTRY_TUPLE, ADR_0037_ENTRY_GUARD, 'entry guard literal'],
    [CONTINUE_TUPLE, ADR_0037_CONTINUE_GUARD, 'Continue guard literal'],
  ] as const) {
    const transition = topLevelTransition(transitions, tuple, problems);
    if (transition !== null) {
      expectLiteral(
        transition,
        'guard',
        expected,
        TRANSITIONS_FILE,
        `${tuple.from}→${tuple.to}`,
        label,
        problems,
      );
    }
  }

  return problems;
}

/**
 * The transition graph and renderer form catalogue must close over each other:
 * every endpoint resolves, and every indexed form participates in the graph.
 */
export function validateRendererFormGraph(
  forms: ReadonlySet<string>,
  transitions: readonly unknown[],
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const referenced = new Set<string>();

  transitions.forEach((value, index) => {
    const rowId = `row ${String(index)}`;
    if (!isRecord(value)) {
      problems.push({ file: TRANSITIONS_FILE, id: rowId, message: 'expected a record' });
      return;
    }

    for (const endpoint of ['from', 'to'] as const) {
      const reference = value[endpoint];
      if (typeof reference !== 'string' || reference === '') {
        problems.push({
          file: TRANSITIONS_FILE,
          id: rowId,
          message: `${endpoint} is empty or not text`,
        });
        continue;
      }
      referenced.add(reference);
      if (!forms.has(reference)) {
        problems.push({
          file: TRANSITIONS_FILE,
          id: rowId,
          message: `${endpoint} ${JSON.stringify(reference)} is not in the renderer form catalogue`,
        });
      }
    }
  });

  for (const id of forms) {
    if (!referenced.has(id)) {
      problems.push({
        file: FORM_INDEX_FILE,
        id,
        message: 'form is defined but never referenced',
      });
    }
  }

  return problems;
}
