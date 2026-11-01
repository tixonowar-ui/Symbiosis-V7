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
    current: '# Symbiosis V7 — Web UI Screen Atlas v1.8',
    retired: '# Symbiosis V7 — Web UI Screen Atlas v1.5',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-version',
    current: '| Версия атласа | 1.8 |',
    retired: '| Версия атласа | 1.5 |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-date',
    current: '| Дата | 2026-11-02 |',
    retired: '| Дата | 2026-10-26 |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-transition-count',
    current: '1698',
    retired: '1681',
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
      'Разрешённые видимые действия/CTA именно этой формы: Зафиксировать броски I и W Советника; Зафиксировать бросок неснижаемого остатка интеллекта; Добавить или удалить допустимый навык Советника; Подтвердить навыки Советника.',
    retired:
      'Разрешённые видимые действия/CTA именно этой формы: Зафиксировать броски I и W Советника; Добавить или удалить допустимый навык Советника; Подтвердить навыки Советника.',
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
      "{'formId': 'CHR-041', 'primaryActions': ['Зафиксировать броски I и W Советника', 'Зафиксировать бросок неснижаемого остатка интеллекта', 'Добавить или удалить допустимый навык Советника', 'Подтвердить навыки Советника'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-CREATION-ROLL-COMMIT', 'UI-CMD-CHAR-WIZARD-CHECKPOINT']}",
    retired:
      "{'formId': 'CHR-041', 'primaryActions': ['Зафиксировать броски I и W Советника', 'Добавить или удалить допустимый навык Советника', 'Подтвердить навыки Советника'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-CREATION-ROLL-COMMIT', 'UI-CMD-CHAR-WIZARD-CHECKPOINT']}",
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'advisor-form-qa',
    current:
      'Проверить буквальное назначение CHR-041: После навыков выполняется ранее зафиксированный manual/random путь; Советник получает собственную карточку, а manual-конфликты показывают необратимый slot/stat/OE diff до commit. Поля: characterDraftId, advisorInstanceDraftId, advisorCard, iwRollRequestIds[2], iwRollReceiptIds[2]OrNull, advisorIPlus8OrNull, advisorWPlus8OrNull, advisorSlotsAndSkills, trogrSuppressionState, acknowledged, wizardCheckpointId, draftRevision, commandId. CTA: Зафиксировать броски I и W Советника, Зафиксировать бросок неснижаемого остатка интеллекта, Добавить или удалить допустимый навык Советника, Подтвердить навыки Советника.',
    retired:
      'Проверить буквальное назначение CHR-041: После навыков выполняется ранее зафиксированный manual/random путь; Советник получает собственную карточку, а manual-конфликты показывают необратимый slot/stat/OE diff до commit. Поля: characterDraftId, advisorInstanceDraftId, advisorCard, iwRollRequestIds[2], iwRollReceiptIds[2]OrNull, advisorIPlus8OrNull, advisorWPlus8OrNull, advisorSlotsAndSkills, trogrSuppressionState, acknowledged, wizardCheckpointId, draftRevision, commandId. CTA: Зафиксировать броски I и W Советника, Добавить или удалить допустимый навык Советника, Подтвердить навыки Советника.',
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
      'Roll variants require pending creationRollRequestId to belong to the draft, stage, branch and immutable AUTO/MANUAL diceInputModeSnapshot; manual face is in the exact die range or server RNG receipt is valid; no receipt exists for that request. CHR-041 Advisor I/W requires exactly two pending requests in I,W order. CHR-041 TROGR_SUPPRESSION_B requires persisted TROGR + ADVISER, exactly one addressed pending B request and no existing B receipt; it never substitutes I/W or creates a third I/W roll. CHR-020 binding-only instead requires randomStatus=BINDING, saved roll/result ownership and exact side snapshot; no new roll request is created.',
    retired:
      'Roll variants require pending creationRollRequestId to belong to the draft, stage, branch and immutable AUTO/MANUAL diceInputModeSnapshot; manual face is in the exact die range or server RNG receipt is valid; no receipt exists for that request. CHR-041 Advisor I/W requires exactly two pending requests in I,W order. CHR-020 binding-only instead requires randomStatus=BINDING, saved roll/result ownership and exact side snapshot; no new roll request is created.',
    expected: 9,
    section: NO_SECTION,
  },
  {
    id: 'roll-atomicity',
    current:
      'Persist exactly one stage result, one command receipt and the resulting next-state pointer; Advisor I/W is one ordered two-roll result with two immutable roll receipts, while CHR-041 TROGR_SUPPRESSION_B is one separate D20 with its own request/receipt and future minimum host intelligence, preserving both I/W and Advisor skills; CHR-020 binding-only persists only the exact side snapshot without a new face/request/sampler/random receipt; the first display crosses the no-reroll boundary and cannot be undone by Back, refresh, branch switch or replay.',
    retired:
      'Persist exactly one stage result, one command receipt and the resulting next-state pointer; Advisor I/W is one ordered two-roll result with two immutable roll receipts, while CHR-020 binding-only persists only the exact side snapshot without a new face/request/sampler/random receipt; the first display crosses the no-reroll boundary and cannot be undone by Back, refresh, branch switch or replay.',
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

/** ADR 0052 pins the v1.6 companion and the separate future-minimum B-roll. */
export const ATLAS_MARKDOWN_ADR0052_LITERALS = [
  {
    id: 'atlas-heading',
    current: '# Symbiosis V7 — Web UI Screen Atlas v1.8',
    retired: '# Symbiosis V7 — Web UI Screen Atlas v1.5',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-version',
    current: '| Версия атласа | 1.8 |',
    retired: '| Версия атласа | 1.5 |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-date',
    current: '| Дата | 2026-11-02 |',
    retired: '| Дата | 2026-10-26 |',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'atlas-transition-count',
    current: '1698',
    retired: '1681',
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'advisor-intelligence-floor-action',
    current:
      '| CHR-041::CTA::004 | Зафиксировать бросок неснижаемого остатка интеллекта | CHR-041 | UI-CMD-CHAR-CREATION-ROLL-COMMIT persisted TROGR + ADVISER; exactly one addressed pending TROGR_SUPPRESSION_B request and no existing B receipt; one D20 for future minimum intelligence; no critical chain, creation penalty, XP, I/W substitution or replacement request | workflow-command |',
    retired: '',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-intelligence-floor-transitions',
    current:
      '| CHR-041 | Зафиксировать бросок неснижаемого остатка интеллекта | UI-CMD-CHAR-CREATION-ROLL-COMMIT persisted TROGR + ADVISER; exactly one addressed pending TROGR_SUPPRESSION_B request and no existing B receipt; one D20 for future minimum intelligence; no critical chain, creation penalty, XP, I/W substitution or replacement request [workflow-command] |',
    retired: '',
    expected: 2,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-visible-allowed',
    current:
      'Разрешённые видимые действия/CTA именно этой формы: Зафиксировать броски I и W Советника; Зафиксировать бросок неснижаемого остатка интеллекта; Добавить или удалить допустимый навык Советника; Подтвердить навыки Советника.',
    retired:
      'Разрешённые видимые действия/CTA именно этой формы: Зафиксировать броски I и W Советника; Добавить или удалить допустимый навык Советника; Подтвердить навыки Советника.',
    expected: 1,
    section: CHR_041_SECTION,
  },
  {
    id: 'advisor-coverage',
    current:
      "{'formId': 'CHR-041', 'primaryActions': ['Зафиксировать броски I и W Советника', 'Зафиксировать бросок неснижаемого остатка интеллекта', 'Добавить или удалить допустимый навык Советника', 'Подтвердить навыки Советника'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-CREATION-ROLL-COMMIT', 'UI-CMD-CHAR-WIZARD-CHECKPOINT']}",
    retired:
      "{'formId': 'CHR-041', 'primaryActions': ['Зафиксировать броски I и W Советника', 'Добавить или удалить допустимый навык Советника', 'Подтвердить навыки Советника'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-CREATION-ROLL-COMMIT', 'UI-CMD-CHAR-WIZARD-CHECKPOINT']}",
    expected: 2,
    section: NO_SECTION,
  },
  {
    id: 'advisor-form-qa',
    current:
      'Проверить буквальное назначение CHR-041: После навыков выполняется ранее зафиксированный manual/random путь; Советник получает собственную карточку, а manual-конфликты показывают необратимый slot/stat/OE diff до commit. Поля: characterDraftId, advisorInstanceDraftId, advisorCard, iwRollRequestIds[2], iwRollReceiptIds[2]OrNull, advisorIPlus8OrNull, advisorWPlus8OrNull, advisorSlotsAndSkills, trogrSuppressionState, acknowledged, wizardCheckpointId, draftRevision, commandId. CTA: Зафиксировать броски I и W Советника, Зафиксировать бросок неснижаемого остатка интеллекта, Добавить или удалить допустимый навык Советника, Подтвердить навыки Советника.',
    retired:
      'Проверить буквальное назначение CHR-041: После навыков выполняется ранее зафиксированный manual/random путь; Советник получает собственную карточку, а manual-конфликты показывают необратимый slot/stat/OE diff до commit. Поля: characterDraftId, advisorInstanceDraftId, advisorCard, iwRollRequestIds[2], iwRollReceiptIds[2]OrNull, advisorIPlus8OrNull, advisorWPlus8OrNull, advisorSlotsAndSkills, trogrSuppressionState, acknowledged, wizardCheckpointId, draftRevision, commandId. CTA: Зафиксировать броски I и W Советника, Добавить или удалить допустимый навык Советника, Подтвердить навыки Советника.',
    expected: 1,
    section: NO_SECTION,
  },
  {
    id: 'roll-command-guards',
    current:
      'Roll variants require pending creationRollRequestId to belong to the draft, stage, branch and immutable AUTO/MANUAL diceInputModeSnapshot; manual face is in the exact die range or server RNG receipt is valid; no receipt exists for that request. CHR-041 Advisor I/W requires exactly two pending requests in I,W order. CHR-041 TROGR_SUPPRESSION_B requires persisted TROGR + ADVISER, exactly one addressed pending B request and no existing B receipt; it never substitutes I/W or creates a third I/W roll. CHR-020 binding-only instead requires randomStatus=BINDING, saved roll/result ownership and exact side snapshot; no new roll request is created.',
    retired:
      'Roll variants require pending creationRollRequestId to belong to the draft, stage, branch and immutable AUTO/MANUAL diceInputModeSnapshot; manual face is in the exact die range or server RNG receipt is valid; no receipt exists for that request. CHR-041 Advisor I/W requires exactly two pending requests in I,W order. CHR-020 binding-only instead requires randomStatus=BINDING, saved roll/result ownership and exact side snapshot; no new roll request is created.',
    expected: 9,
    section: NO_SECTION,
  },
  {
    id: 'roll-atomicity',
    current:
      'Persist exactly one stage result, one command receipt and the resulting next-state pointer; Advisor I/W is one ordered two-roll result with two immutable roll receipts, while CHR-041 TROGR_SUPPRESSION_B is one separate D20 with its own request/receipt and future minimum host intelligence, preserving both I/W and Advisor skills; CHR-020 binding-only persists only the exact side snapshot without a new face/request/sampler/random receipt; the first display crosses the no-reroll boundary and cannot be undone by Back, refresh, branch switch or replay.',
    retired:
      'Persist exactly one stage result, one command receipt and the resulting next-state pointer; Advisor I/W is one ordered two-roll result with two immutable roll receipts, while CHR-020 binding-only persists only the exact side snapshot without a new face/request/sampler/random receipt; the first display crosses the no-reroll boundary and cannot be undone by Back, refresh, branch switch or replay.',
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

function markdownAdrSource(markdown: string, section: readonly [string, string]): string {
  const [startMarker, endMarker] = section;
  if (startMarker === '') return markdown;
  const start = markdown.indexOf(startMarker);
  if (start === -1) return '';
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? '' : markdown.slice(start, end);
}

/** ADR 0069 checks each approved form, transition, workflow, requirement and QA rendering. */
export const ATLAS_MARKDOWN_ADR0069_LITERALS = [
  {
    id: 'request-review-0-0',
    current: '- QA-NET-005-REJECTED-RETURN',
    retired: '',
    expected: 1,
    section: [
      '### NET-003 — Выбор локальных персонажей и мест',
      '### NET-004 — Отправка запроса устройства',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-1-0',
    current:
      '| NET-005 | Вернуться к выбору персонажей | projectionRole=player; requestOwnerDeviceId matches current installation owner; requestStatus=REJECTED; technical session valid for the same campaign; no campaign copy or admission; no mutation in flight; navigation only, preserve the old request and immutable receipt. [safe-return] |',
    retired: '',
    expected: 1,
    section: [
      '### NET-003 — Выбор локальных персонажей и мест',
      '### NET-004 — Отправка запроса устройства',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-2-0',
    current: '- requestStatus=PENDING|IN_REVIEW|REJECTED|PROPOSED',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-2-0',
    current: '- requestStatus=PENDING|IN_REVIEW|REJECTED|PROPOSED',
    retired: '- requestStatus=PENDING|REJECTED|PROPOSED',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-3-0',
    current: '- Return to character selection after confirmed request rejection',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-4-0',
    current:
      '- PENDING→IN_REVIEW is a preliminary request decision; the player receives only its own request status/receipt and no GM queue data.',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-4-1',
    current:
      '- Cancellation remains legal only in PENDING. An acceptance/rejection or cancellation wins atomically by requestRevision; the other command performs no write.',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-4-2',
    current:
      '- NET-005::CTA::003 returns only the owning rejected request to NET-003 under a valid technical session; it changes only the local presentation cursor, preserves the historical request/receipt, and does not reset/delete requests, submit a new request or write local source sheets.',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-5-0',
    current: '- QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-5-1',
    current: '- QA-NET-005-REJECTED-RETURN',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-6-0',
    current: '- Вернуться к выбору персонажей',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-7-0',
    current:
      '- Разрешённые видимые действия/CTA именно этой формы: Отменить pending request; Повторить подключение после потери связи; Вернуться к выбору персонажей.',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-7-0',
    current:
      '- Разрешённые видимые действия/CTA именно этой формы: Отменить pending request; Повторить подключение после потери связи; Вернуться к выбору персонажей.',
    retired:
      '- Разрешённые видимые действия/CTA именно этой формы: Отменить pending request; Повторить подключение после потери связи.',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-8-0',
    current:
      '| NET-005::CTA::003 | Вернуться к выбору персонажей | NET-003 | projectionRole=player; requestOwnerDeviceId matches current installation owner; requestStatus=REJECTED; technical session valid for the same campaign; no campaign copy or admission; no mutation in flight; navigation only, preserve the old request and immutable receipt. | safe-return | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": []} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE | {"audience": "GM_QA_ONLY", "channel": "actionAvailabilityTrace", "fields": ["actionKey", "failedPredicate", "sourceRuleOrGuard", "evaluatedRevision"], "playerProjection": "ABSENT"} |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-9-0',
    current: '| WAITING_GM | PENDING request is read-only except owner cancellation. |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-9-1',
    current:
      '| DECISION_WON_RACE | A committed accept-to-review or reject decision wins by requestRevision; owner cancellation rejects before write. |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-9-2',
    current:
      '| IN_REVIEW | GM accepted this request for review; no campaign authority, campaign copy or capacity reservation; owner cancellation is no longer available. |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-9-3',
    current:
      '| REJECTED | The reasoned preliminary rejection is visible; the owner may return to selection while the same technical session is valid and no campaign copy/admission exists. Navigation preserves the closed request, immutable receipt and local source sheets. |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-9-0',
    current: '| WAITING_GM | PENDING request is read-only except owner cancellation. |',
    retired: '| WAITING_GM | Pending request is read-only except owner cancellation. |',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-9-1',
    current: '| WAITING_GM | PENDING request is read-only except owner cancellation. |',
    retired:
      '| DECISION_WON_RACE | A simultaneous GM decision wins by revision; cancel rejects before write. |',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-10-0',
    current:
      '| NET-017 | Server publishes request accepted to review | SERVER_ONLY_ROLE_PROJECTION; UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW committed; only request owner; requestStatus=IN_REVIEW; no copies or admission [system-event] |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-10-1',
    current:
      '| NET-017 | Server publishes preliminary request rejection | SERVER_ONLY_ROLE_PROJECTION; UI-CMD-DEVICE-REQUEST-REJECT committed with reason; only request owner; requestStatus=REJECTED; no copies or admission [system-event] |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-11-0',
    current:
      '| NET-003 | Вернуться к выбору персонажей | projectionRole=player; requestOwnerDeviceId matches current installation owner; requestStatus=REJECTED; technical session valid for the same campaign; no campaign copy or admission; no mutation in flight; navigation only, preserve the old request and immutable receipt. [safe-return] |',
    retired: '',
    expected: 1,
    section: [
      '### NET-005 — Ожидание решения мастера',
      '### NET-006 — Лобби игрока: Ready и ожидание Start',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-12-0',
    current: '- campaignId',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-1',
    current: '- requestQueueRevision',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-2',
    current: '- requests[]',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-3',
    current: '- selectedRequestIdOrNull',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-4',
    current: '- activePlayerCapacity',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-5',
    current: '- occupiedActivePcCount',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-6',
    current: '- decisionReason(required-for-reject)',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-7',
    current: '- commandId',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-12-8',
    current: '- returnContext',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-12-0',
    current: '- campaignId',
    retired: '- effectInstanceId/EffectTypeID',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-12-1',
    current: '- campaignId',
    retired: '- source',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-12-2',
    current: '- campaignId',
    retired: '- duration/stackPolicy',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-12-3',
    current: '- campaignId',
    retired: '- deviceId',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-12-4',
    current: '- campaignId',
    retired: '- controllerSeat',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-12-5',
    current: '- campaignId',
    retired: '- connectionState',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-0',
    current: '- Заголовок и подтверждённый контекст кампании',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-1',
    current: '- Очередь requests[] и явный выбор одной заявки',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-2',
    current:
      '- Read-only device ID, 1–3 candidate summaries, request status/revision and connection state',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-3',
    current: '- Прогноз вместимости без резерва и без изменения активных PC',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-4',
    current: '- Принять заявку к рассмотрению',
    retired: '',
    expected: 2,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-5',
    current: '- Причина и предварительное отклонение заявки',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-6',
    current: '- Подтверждённая квитанция решения',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-13-7',
    current: '- Безопасный возврат в исходный контекст мастера',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-13-0',
    current: '- Заголовок и подтверждённый контекст кампании',
    retired: '- Заголовок и текущий контекст',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-13-1',
    current: '- Заголовок и подтверждённый контекст кампании',
    retired:
      '- Содержательная область: DeviceId, несколько выбранных персонажей, прогноз занимаемых мест и принять к рассмотрению либо отклонить.',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-13-2',
    current: '- Заголовок и подтверждённый контекст кампании',
    retired: '- Основной CTA',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-13-3',
    current: '- Заголовок и подтверждённый контекст кампании',
    retired: '- Back/Cancel/Retry только на безопасной границе',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-13-4',
    current: '- Заголовок и подтверждённый контекст кампании',
    retired: '- Индикатор связи и ревизии',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-0',
    current:
      '- Назначение реализовано буквально: Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-1',
    current:
      '- No effect entity, EffectTypeID or duration/stackPolicy is required or fabricated for the request queue.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-2',
    current:
      '- The two request-level commands are distinct from final NET-021/NET-022 AdmissionBatch commands.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-3',
    current: '- IN_REVIEW never means admitted, Ready or PROPOSED campaign copy.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-4',
    current:
      '- CMP-006 queue entry and return retain the same campaign and sole GM authority, including an empty queue.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-5',
    current:
      '- CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-6',
    current:
      '- The PAUSED requirement belongs to the new CMP-006 ingress/return route. It does not introduce a global PAUSED-only restriction on request-level decisions or alter the guards of other NET-017 entry paths. The preliminary delivery exposes only the CMP-006 capability; other campaign phases and routes remain subject to their separately implemented source guards.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-7',
    current:
      '- Closed field composite requests: {"cardinality":"0..N; empty queue valid","closedFields":{"requestId":"opaque request ID","requestOwnerDeviceId":"verified installation device ID","requestStatus":"PENDING|IN_REVIEW|REJECTED|PROPOSED","requestRevision":"nonnegative integer","connectionState":"existing source connection-state vocabulary, no invented state","batchCharacterSummaries":"immutable 1..3 submitted candidate summaries","requestedCandidateCount":"integer exactly equal to summaries.length","gmMessageOrNull":"string|null from public preliminary decision reason","decisionReceiptIdOrNull":"receipt ID|null"},"selection":"selectedRequestIdOrNull is null or names one currently projected row; updates are navigation/draft state only"}. Unknown fields are rejected.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-8',
    current:
      '- Closed field composite batchCharacterSummaries: {"closedFields":{"sourceUuid":"immutable local FINAL source UUID","snapshotChecksum":"checksum of exact submitted snapshot","name":"submitted metadata name, may duplicate another source","sourceSnapshotId":"immutable source snapshot ID","localControllerSeatId":"real provisional input-lane ID owned by that submitting installation; never admitted campaign slot"},"mechanics":"No full unrelated local library or arbitrary effect data; full read-only submitted snapshot belongs to the later NET-018 capability"}. Unknown fields are rejected.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-9',
    current:
      '- Closed field composite capacity: {"activePlayerCapacity":"configured campaign capacity","occupiedActivePcCount":"confirmed active PC count","preview":"requestedCandidateCount compared with current occupied count/capacity; no reservation and not a preliminary decision side effect"}. Unknown fields are rejected.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-10',
    current:
      '- Closed field composite returnContext: {"variants":[{"originFormId":"CMP-006","campaignId":"same bound campaign","creationReceiptId":"confirmed original creation receipt"},{"originFormId":"GM-002","campaignId":"existing original route context"},{"originFormId":"CMP-009","campaignId":"existing original route context"}],"authority":"Host-issued saved context, not freely supplied by browser"}. Unknown fields are rejected.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-11',
    current:
      '- Closed request command UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW: payload campaignId, requestId, requestRevision; Existing commandId, expected revision vector and verified GM authority; no outer protocol bump; unknownFieldPolicy=REJECT. Receipt fields: receiptId, commandId, workflowCommandId, campaignId, requestId, requestOwnerDeviceId, beforeRequestStatus, afterRequestStatus, beforeRequestRevision, requestRevision, decisionReasonOrNull, candidateSnapshotChecksums, authoritativeGmActorId, timestamp. Original immutable receipt; current projection may be newer and is carried separately; no cursor rollback.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-14-12',
    current:
      '- Closed request command UI-CMD-DEVICE-REQUEST-REJECT: payload campaignId, requestId, requestRevision, reason; Existing commandId, expected revision vector and verified GM authority; no outer protocol bump; unknownFieldPolicy=REJECT. Receipt fields: receiptId, commandId, workflowCommandId, campaignId, requestId, requestOwnerDeviceId, beforeRequestStatus, afterRequestStatus, beforeRequestRevision, requestRevision, decisionReasonOrNull, candidateSnapshotChecksums, authoritativeGmActorId, timestamp. Original immutable receipt; current projection may be newer and is carried separately; no cursor rollback.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-14-0',
    current:
      '- Назначение реализовано буквально: Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией.',
    retired:
      '- Назначение реализовано буквально: DeviceId, несколько выбранных персонажей, прогноз занимаемых мест и принять к рассмотрению либо отклонить.',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-15-0',
    current: '- QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-15-1',
    current: '- QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-15-2',
    current: '- QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-15-3',
    current: '- QA-CMP-006-DEVICE-REQUEST-QUEUE',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-16-1',
    current: '- Отклонить заявку с причиной',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-16-2',
    current: '- Вернуться к созданной кампании',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-17-0',
    current:
      '- Разрешённые atlas workflow commands этой формы: UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-17-1',
    current:
      '- Исполняемых профильных OperationID нет; предварительные решения меняют только адресованную заявку и её журнал.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-17-2',
    current:
      '- Разрешённые видимые действия/CTA именно этой формы: Открыть «Исходный локальный лист»; Открыть «Финализация кампанийной копии»; Открыть «Итог персонажа: группа и локация»; Открыть «Принять запрос устройства»; Вернуться к «Список персонажей кампании»; Вернуться к «Клиенты и локальные места»; Принять заявку к рассмотрению; Отклонить заявку с причиной; Вернуться к созданной кампании; Начать рассмотрение кампанийных копий.',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-17-0',
    current:
      '- Разрешённые atlas workflow commands этой формы: UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN.',
    retired:
      '- Самостоятельные mutation OperationID отсутствуют; допустимы только перечисленные переходы, read-only проекция либо rule/system handler без свободной команды.',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-17-1',
    current:
      '- Разрешённые atlas workflow commands этой формы: UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN.',
    retired:
      '- Разрешённые видимые действия/CTA именно этой формы: Открыть «Исходный локальный лист»; Открыть «Финализация кампанийной копии»; Открыть «Итог персонажа: группа и локация»; Открыть «Принять запрос устройства»; Вернуться к «Список персонажей кампании»; Вернуться к «Клиенты и локальные места».',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-18-0',
    current:
      '| authoritativeSource | {"abilityIds": [], "operationIds": [], "ruleIds": ["AQA-017"], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT", "UI-CMD-ADMISSION-REVIEW-OPEN"]} |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-18-0',
    current:
      '| authoritativeSource | {"abilityIds": [], "operationIds": [], "ruleIds": ["AQA-017"], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT", "UI-CMD-ADMISSION-REVIEW-OPEN"]} |',
    retired:
      '| authoritativeSource | {"abilityIds": [], "operationIds": [], "ruleIds": ["AQA-017"], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": []} |',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-19-0',
    current:
      '| NET-017::CTA::007 | Принять заявку к рассмотрению | NET-017 | UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW guards | workflow-command | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW"]} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE | {"audience": "GM_QA_ONLY", "channel": "actionAvailabilityTrace", "fields": ["actionKey", "failedPredicate", "sourceRuleOrGuard", "evaluatedRevision"], "playerProjection": "ABSENT"} |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-19-1',
    current:
      '| NET-017::CTA::008 | Отклонить заявку с причиной | NET-017 | UI-CMD-DEVICE-REQUEST-REJECT guards | workflow-command | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-REJECT"]} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE | {"audience": "GM_QA_ONLY", "channel": "actionAvailabilityTrace", "fields": ["actionKey", "failedPredicate", "sourceRuleOrGuard", "evaluatedRevision"], "playerProjection": "ABSENT"} |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-19-2',
    current:
      '| NET-017::CTA::009 | Вернуться к созданной кампании | CMP-006 | projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; returnContext.originFormId=CMP-006; campaignId and creationReceiptId match initiating context; no mutation in flight; navigation only, no Start. | safe-return | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": []} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE | {"audience": "GM_QA_ONLY", "channel": "actionAvailabilityTrace", "fields": ["actionKey", "failedPredicate", "sourceRuleOrGuard", "evaluatedRevision"], "playerProjection": "ABSENT"} |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-20-0',
    current:
      '| UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW | Sole active GM authority for this campaign; requestStatus=PENDING; requestId and requestRevision current; selected request has 1–3 validated immutable candidates; no copy, admission or capacity mutation. | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW"]} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | GM_QA_ONLY |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-20-1',
    current:
      '| UI-CMD-DEVICE-REQUEST-REJECT | Sole active GM authority for this campaign; requestStatus=PENDING or IN_REVIEW; requestId and requestRevision current; non-empty reason; no copy, admission or capacity mutation. | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-REJECT"]} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | GM_QA_ONLY |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-21-0',
    current:
      '| QUEUE_EMPTY | No eligible requests; no decision CTA; owner-safe return remains available. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-21-1',
    current:
      '| REQUEST_PENDING | PENDING request selected; accept-to-review and reasoned reject are available only while their guards hold. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-21-2',
    current:
      '| IN_REVIEW | Accepted for preliminary review; no copy, admission, active seat or capacity reservation exists from this decision. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-21-3',
    current:
      '| REQUEST_REJECTED | The preliminary rejection reason and decision receipt are confirmed; no new decision CTA for this terminal request. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-21-4',
    current:
      '| STALE_REQUEST | Another request decision or owner cancel won by requestRevision; no write, show the current authoritative request view. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-22-0',
    current:
      '| CMP-006 | Открыть входящие запросы устройств | projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; creation receipt confirmed; request queue capability available; navigation only, no Start. [normative] |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-22-1',
    current:
      '| NET-017 | Принять заявку к рассмотрению | UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW guards [workflow-command] |',
    retired: '',
    expected: 2,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-22-2',
    current:
      '| NET-017 | Отклонить заявку с причиной | UI-CMD-DEVICE-REQUEST-REJECT guards [workflow-command] |',
    retired: '',
    expected: 2,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-23-0',
    current:
      '| CMP-006 | Вернуться к созданной кампании | projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; returnContext.originFormId=CMP-006; campaignId and creationReceiptId match initiating context; no mutation in flight; navigation only, no Start. [safe-return] |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-23-3',
    current:
      '| NET-005 | Server publishes request accepted to review | SERVER_ONLY_ROLE_PROJECTION; UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW committed; only request owner; requestStatus=IN_REVIEW; no copies or admission [system-event] |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-23-4',
    current:
      '| NET-005 | Server publishes preliminary request rejection | SERVER_ONLY_ROLE_PROJECTION; UI-CMD-DEVICE-REQUEST-REJECT committed with reason; only request owner; requestStatus=REJECTED; no copies or admission [system-event] |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-24-0',
    current:
      '| Atlas workflow command | UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-24-0',
    current:
      '| Atlas workflow command | UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN |',
    retired: '| Atlas workflow command |  |',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-25-0',
    current:
      '| Назначение | Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-25-0',
    current:
      '| Назначение | Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией. |',
    retired:
      '| Назначение | DeviceId, несколько выбранных персонажей, прогноз занимаемых мест и принять к рассмотрению либо отклонить. |',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-26-0',
    current:
      '| Владелец ввода | Sole active GM authority for the addressed campaign; no player controllerSeat is required to operate this queue. |',
    retired: '',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-26-0',
    current:
      '| Владелец ввода | Sole active GM authority for the addressed campaign; no player controllerSeat is required to operate this queue. |',
    retired: '| Владелец ввода | active controllerSeat/GM context according to roles |',
    expected: 1,
    section: ['### NET-017 — Входящие запросы устройств', '### NET-018 — Исходный локальный лист'],
    wholeLine: true,
  },
  {
    id: 'request-review-27-0',
    current: '- Open device-request queue without Start',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-28-0',
    current: '- QA-CMP-006-DEVICE-REQUEST-QUEUE',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-29-0',
    current: '- Открыть входящие запросы устройств',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-30-0',
    current:
      '- Разрешённые видимые действия/CTA именно этой формы: Открыть панель созданной кампании; Открыть входящие запросы устройств.',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-30-0',
    current:
      '- Разрешённые видимые действия/CTA именно этой формы: Открыть панель созданной кампании; Открыть входящие запросы устройств.',
    retired:
      '- Разрешённые видимые действия/CTA именно этой формы: Открыть панель созданной кампании.',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-31-0',
    current:
      '| CMP-006::CTA::002 | Открыть входящие запросы устройств | NET-017 | projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; creation receipt confirmed; request queue capability available; navigation only, no Start. | normative | actorId, effectiveController, controllerSeat, projectionRole, scene, phase, turnOrReactionWindow, stateRevision, projectionRevision, actorVisibilityRevision, HP/OE/effects/position/range, inventory/equipment/ammo/cooldowns, consent/masterPredicate state, game time/local context | {"abilityIds": [], "operationIds": [], "ruleIds": [], "service": "SERVER_ROUTE_AND_GUARD_EVALUATOR", "workflowCommandIds": []} | action budget, HP/OE/effects/death or incapacity, position/range/visibility, inventory/equipment/ammo/cooldown, symbiont composition or learned nodes, turn/phase/reaction window, controller/seat/handoff, consent/masterPredicate response, game time/campaign state, stateRevision/projectionRevision | OMIT_FROM_PLAYER_OR_EFFECTIVE_CONTROLLER_PAYLOAD_DOM_A11Y_HOTKEY_CACHE | {"audience": "GM_QA_ONLY", "channel": "actionAvailabilityTrace", "fields": ["actionKey", "failedPredicate", "sourceRuleOrGuard", "evaluatedRevision"], "playerProjection": "ABSENT"} |',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-32-0',
    current:
      '| OPENED_REQUEST_QUEUE | Read-only navigation to NET-017; same PAUSED campaign, no Start, no campaign-state mutation. |',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-33-0',
    current:
      '| NET-017 | Вернуться к созданной кампании | projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; returnContext.originFormId=CMP-006; campaignId and creationReceiptId match initiating context; no mutation in flight; navigation only, no Start. [safe-return] |',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-34-0',
    current:
      '| NET-017 | Открыть входящие запросы устройств | projectionRole=gm; sole active GM authority for this campaign; status=PAUSED; creation receipt confirmed; request queue capability available; navigation only, no Start. [normative] |',
    retired: '',
    expected: 1,
    section: ['### CMP-006 — Кампания создана', '### CMP-007 — Панель кампании и Start'],
    wholeLine: true,
  },
  {
    id: 'request-review-35-0',
    current:
      '| player, gm | CHR-043, CHR-044, CHR-045, NET-028, NET-017, NET-018, NET-019, NET-020, NET-021, NET-027 | AQ2-010, AQA-017 | OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-GM-030 | COVERED |',
    retired: '',
    expected: 1,
    section: [
      '### J-GM-IMPORT-ADMISSION — Импорт персонажа мастером с привязкой владельца',
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-35-0',
    current:
      '| player, gm | CHR-043, CHR-044, CHR-045, NET-028, NET-017, NET-018, NET-019, NET-020, NET-021, NET-027 | AQ2-010, AQA-017 | OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-GM-030 | COVERED |',
    retired:
      '| player, gm | CHR-043, CHR-044, CHR-045, NET-028, NET-017, NET-018, NET-019, NET-020, NET-021, NET-027 | AQ2-010, AQA-017 | OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-GM-030 | COVERED |',
    expected: 1,
    section: [
      '### J-GM-IMPORT-ADMISSION — Импорт персонажа мастером с привязкой владельца',
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-36-0',
    current:
      '| player, gm | NET-001, NET-002, NET-003, NET-004, CHR-027, NET-005, NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, NET-006, NET-007, GM-019, GM-020 | AQ2-010, AQA-017 | OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE, UI-CMD-CAMPAIGN-READY-SET | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-GM-030 | COVERED |',
    retired: '',
    expected: 1,
    section: [
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
      '### J-CAMPAIGN-CREATE — Создание и запуск кампании',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-36-0',
    current:
      '| player, gm | NET-001, NET-002, NET-003, NET-004, CHR-027, NET-005, NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, NET-006, NET-007, GM-019, GM-020 | AQ2-010, AQA-017 | OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE, UI-CMD-CAMPAIGN-READY-SET | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-GM-030 | COVERED |',
    retired:
      '| player, gm | NET-001, NET-002, NET-003, NET-004, CHR-027, NET-005, NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, NET-006, NET-007 | AQ2-010, AQA-017 | OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-GM-030 | COVERED |',
    expected: 1,
    section: [
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
      '### J-CAMPAIGN-CREATE — Создание и запуск кампании',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-37-0',
    current:
      '| WAIT | NET-005, NET-017 | Sole active GM and current requestRevision; PENDING accept-to-review or PENDING\\|IN_REVIEW reject with reason; no campaign copy, campaign seat, capacity reservation or player authority at either preliminary decision. | PENDING→IN_REVIEW or PENDING\\|IN_REVIEW→REJECTED; immutable decision receipt and owner-only NET-005 status. Final admission remains NET-021/NET-022. |',
    retired: '',
    expected: 1,
    section: [
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
      '### J-CAMPAIGN-CREATE — Создание и запуск кампании',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-37-0',
    current:
      '| WAIT | NET-005, NET-017 | Sole active GM and current requestRevision; PENDING accept-to-review or PENDING\\|IN_REVIEW reject with reason; no campaign copy, campaign seat, capacity reservation or player authority at either preliminary decision. | PENDING→IN_REVIEW or PENDING\\|IN_REVIEW→REJECTED; immutable decision receipt and owner-only NET-005 status. Final admission remains NET-021/NET-022. |',
    retired:
      '| WAIT | NET-005, NET-017 | До решения места и campaignCharacterId не создаются. | GM принимает к review или отклоняет с причиной. |',
    expected: 1,
    section: [
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
      '### J-CAMPAIGN-CREATE — Создание и запуск кампании',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-38-0',
    current:
      '- После REJECTED владелец заявки при действующей technical session возвращается NET-005→NET-003 для выбора персонажей. Старые request и receipt сохраняются; переход не делает новый submit, не удаляет заявку и не меняет локальные листы.',
    retired: '',
    expected: 1,
    section: [
      '### J-JOIN-REVIEW — Подключение устройства, review и допуск кампанийной копии',
      '### J-CAMPAIGN-CREATE — Создание и запуск кампании',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-39-0',
    current:
      '- Из CMP-006 единственный GM может открыть NET-017 и вернуться в CMP-006; это read-only переход к отдельному J-JOIN-REVIEW, доступный при нуле заявок и без выполнения Start. The PAUSED requirement belongs to the new CMP-006 ingress/return route. It does not introduce a global PAUSED-only restriction on request-level decisions or alter the guards of other NET-017 entry paths. The preliminary delivery exposes only the CMP-006 capability; other campaign phases and routes remain subject to their separately implemented source guards.',
    retired: '',
    expected: 1,
    section: [
      '### J-CAMPAIGN-CREATE — Создание и запуск кампании',
      '### J-CAMPAIGN-LIFECYCLE — Пауза, изменение состава, завершение и архив',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-40-0',
    current:
      '| gm | CMP-008, CMP-009, CMP-010, CMP-011, CMP-016, GM-002, NET-017, NET-018, NET-019, NET-027, CMP-013, CMP-012 | AQ2-005, AQ2-006, AQ2-013, AQ2-019, AQ2-025, AQ2-033, AQA-017, AQA-029, CORE-190, CORE-234, SYM-055 | OP-REQ-GM, SET_GM_FORMAL_STATE | UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CAMPAIGN-FINISH, UI-CMD-CAMPAIGN-PAUSE-SET, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CAMP-009, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-ENEMY-P17, Q-GM-007, Q-GM-026, Q-REST-008, Q-SYM-085 | COVERED |',
    retired: '',
    expected: 1,
    section: [
      '### J-CAMPAIGN-LIFECYCLE — Пауза, изменение состава, завершение и архив',
      '### J-LOCAL-SEATS — 0–3 локальных игрока и игрок на компьютере мастера',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-40-0',
    current:
      '| gm | CMP-008, CMP-009, CMP-010, CMP-011, CMP-016, GM-002, NET-017, NET-018, NET-019, NET-027, CMP-013, CMP-012 | AQ2-005, AQ2-006, AQ2-013, AQ2-019, AQ2-025, AQ2-033, AQA-017, AQA-029, CORE-190, CORE-234, SYM-055 | OP-REQ-GM, SET_GM_FORMAL_STATE | UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CAMPAIGN-FINISH, UI-CMD-CAMPAIGN-PAUSE-SET, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CAMP-009, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-ENEMY-P17, Q-GM-007, Q-GM-026, Q-REST-008, Q-SYM-085 | COVERED |',
    retired:
      '| gm | CMP-008, CMP-009, CMP-010, CMP-011, CMP-016, GM-002, NET-017, NET-018, NET-019, NET-027, CMP-013, CMP-012 | AQ2-005, AQ2-006, AQ2-013, AQ2-019, AQ2-025, AQ2-033, AQA-017, AQA-029, CORE-190, CORE-234, SYM-055 | OP-REQ-GM, SET_GM_FORMAL_STATE | UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CAMPAIGN-FINISH, UI-CMD-CAMPAIGN-PAUSE-SET | Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-007, Q-CAMP-009, Q-CHAR-001, Q-CHAR-010, Q-CHAR-011, Q-CHAR-012, Q-CHAR-013, Q-CHAR-014, Q-CHAR-016, Q-CHAR-018, Q-CORE-052, Q-ENEMY-P17, Q-GM-007, Q-GM-026, Q-REST-008, Q-SYM-085 | COVERED |',
    expected: 1,
    section: [
      '### J-CAMPAIGN-LIFECYCLE — Пауза, изменение состава, завершение и архив',
      '### J-LOCAL-SEATS — 0–3 локальных игрока и игрок на компьютере мастера',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-41-0',
    current:
      '| player, gm | APP-003, NET-003, CMP-009, PLY-030, APP-004, NET-004, NET-017, GM-001, PLY-001, CMB-012, CMB-020, PLY-027, PLY-028, PLY-029, CMB-050, SYS-028, GM-029 | AQ2-008, AQ2-011, AQA-017, AQA-031, AQA-040, AQA-041, CORE-066, CQA-004, CQA-011, CQA-016, CQA-023, CQA-024, CQA-036, SYM-048, SYM-113, SYM-127, SYM-163 | OP-CHAR-CREATE, OP-CONSUME, OP-PROFILE-ACTIVATE, OP-TRANSFER | UI-CMD-CONSENT-RESPOND, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-MASTER-PREDICATE-RESPOND, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | Q-APP-001, Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-006, Q-CAMP-007, Q-CHAR-009, Q-CORE-016, Q-CORE-017, Q-CORE-027, Q-CORE-036, Q-CORE-037, Q-CORE-060, Q-CORE-067, Q-GM-001, Q-GM-009, Q-GM-010, Q-GM-022, Q-GM-023, Q-GM-024, Q-GM-028, Q-GM-030, Q-GM-SYM-011, Q-MON-007, Q-MON-014, Q-MON-017, Q-MON-069, Q-MON-070, Q-MON-072, Q-MON-086, Q-MON-087, Q-PREDEV-017, Q-QA-007, Q-QA-008, Q-SYM-021, Q-SYM-034, Q-SYM-041, Q-SYM-051, Q-SYM-063, Q-SYM-069, Q-SYM-084, Q-SYM-089, Q-SYM-097, Q-SYM-099, Q-SYM-102, Q-SYM-109 | COVERED |',
    retired: '',
    expected: 1,
    section: [
      '### J-LOCAL-SEATS — 0–3 локальных игрока и игрок на компьютере мастера',
      '### J-NPC-CREATE — Полный wizard постоянного НПС',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-41-0',
    current:
      '| player, gm | APP-003, NET-003, CMP-009, PLY-030, APP-004, NET-004, NET-017, GM-001, PLY-001, CMB-012, CMB-020, PLY-027, PLY-028, PLY-029, CMB-050, SYS-028, GM-029 | AQ2-008, AQ2-011, AQA-017, AQA-031, AQA-040, AQA-041, CORE-066, CQA-004, CQA-011, CQA-016, CQA-023, CQA-024, CQA-036, SYM-048, SYM-113, SYM-127, SYM-163 | OP-CHAR-CREATE, OP-CONSUME, OP-PROFILE-ACTIVATE, OP-TRANSFER | UI-CMD-CONSENT-RESPOND, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-MASTER-PREDICATE-RESPOND, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | Q-APP-001, Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-006, Q-CAMP-007, Q-CHAR-009, Q-CORE-016, Q-CORE-017, Q-CORE-027, Q-CORE-036, Q-CORE-037, Q-CORE-060, Q-CORE-067, Q-GM-001, Q-GM-009, Q-GM-010, Q-GM-022, Q-GM-023, Q-GM-024, Q-GM-028, Q-GM-030, Q-GM-SYM-011, Q-MON-007, Q-MON-014, Q-MON-017, Q-MON-069, Q-MON-070, Q-MON-072, Q-MON-086, Q-MON-087, Q-PREDEV-017, Q-QA-007, Q-QA-008, Q-SYM-021, Q-SYM-034, Q-SYM-041, Q-SYM-051, Q-SYM-063, Q-SYM-069, Q-SYM-084, Q-SYM-089, Q-SYM-097, Q-SYM-099, Q-SYM-102, Q-SYM-109 | COVERED |',
    retired:
      '| player, gm | APP-003, NET-003, CMP-009, PLY-030, APP-004, NET-004, NET-017, GM-001, PLY-001, CMB-012, CMB-020, PLY-027, PLY-028, PLY-029, CMB-050, SYS-028, GM-029 | AQ2-008, AQ2-011, AQA-017, AQA-031, AQA-040, AQA-041, CORE-066, CQA-004, CQA-011, CQA-016, CQA-023, CQA-024, CQA-036, SYM-048, SYM-113, SYM-127, SYM-163 | OP-CHAR-CREATE, OP-CONSUME, OP-PROFILE-ACTIVATE, OP-TRANSFER | UI-CMD-CONSENT-RESPOND, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-MASTER-PREDICATE-RESPOND | Q-APP-001, Q-CAMP-001, Q-CAMP-002, Q-CAMP-004, Q-CAMP-005, Q-CAMP-006, Q-CAMP-007, Q-CHAR-009, Q-CORE-016, Q-CORE-017, Q-CORE-027, Q-CORE-036, Q-CORE-037, Q-CORE-060, Q-CORE-067, Q-GM-001, Q-GM-009, Q-GM-010, Q-GM-022, Q-GM-023, Q-GM-024, Q-GM-028, Q-GM-030, Q-GM-SYM-011, Q-MON-007, Q-MON-014, Q-MON-017, Q-MON-069, Q-MON-070, Q-MON-072, Q-MON-086, Q-MON-087, Q-PREDEV-017, Q-QA-007, Q-QA-008, Q-SYM-021, Q-SYM-034, Q-SYM-041, Q-SYM-051, Q-SYM-063, Q-SYM-069, Q-SYM-084, Q-SYM-089, Q-SYM-097, Q-SYM-099, Q-SYM-102, Q-SYM-109 | COVERED |',
    expected: 1,
    section: [
      '### J-LOCAL-SEATS — 0–3 локальных игрока и игрок на компьютере мастера',
      '### J-NPC-CREATE — Полный wizard постоянного НПС',
    ],
    wholeLine: true,
  },
  {
    id: 'request-review-42-0',
    current:
      '| REQ-004 | Подключение игрока к кампании | J-JOIN-REVIEW | NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 | AQA-017 | UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-CAMPAIGN-READY-SET | player | Роль и authority соответствуют player., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "NET-001", "primaryActions": ["Открыть «Подключение по адресу или QR»", "Открыть «Выбор локальных персонажей и мест»", "Вернуться в главное меню игрока"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-002", "primaryActions": ["Подключиться по введённому адресу или QR", "Сканировать или выбрать QR", "Вернуться в меню игрока"], "workflowCommandIds": ["UI-CMD-CONNECTION-OPEN"]}, {"executableOperationIds": [], "formId": "NET-003", "primaryActions": ["Открыть «Отправка запроса устройства»", "Открыть «Отправка сохранённого персонажа»", "Открыть «Ожидание решения мастера»", "Вернуться к «Выбор локального профиля и места»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-004", "primaryActions": ["Отправить AdmissionBatch request", "Отменить до submit"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-SUBMIT"]}, {"executableOperationIds": [], "formId": "NET-005", "primaryActions": ["Отменить pending request", "Повторить подключение после потери связи", "Вернуться к выбору персонажей"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-CANCEL"]}, {"executableOperationIds": [], "formId": "NET-006", "primaryActions": ["Вернуться к «Итог согласования персонажа»", "Start подтверждён мастером", "Готов", "Отменить готовность"], "workflowCommandIds": ["UI-CMD-CAMPAIGN-READY-SET"]} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-002": ["EMPTY_ADDRESS", "PARSE_INVALID", "READY_TO_CONNECT", "CONNECTING", "CONNECTED_TECHNICAL"], "NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "NET-005": ["WAITING_GM", "READY_TO_CANCEL", "CANCELLED", "DECISION_WON_RACE", "IN_REVIEW", "REJECTED"]}} | Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Проверить UI-CMD-CAMPAIGN-READY-SET через экранные controls, mixed ACTIVE/blocked состав, Ready отмену и initial time без defaults. | Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request., Existing authenticated admitted bindings recover both before and after Start through the same campaign transport, GM context and routes. The immutable campaign birth/old admission receipts are not rewritten. Current HOSTING/PAUSED scene state is separate from birth PAUSED; reconnect never creates a new campaign/copy/group/scene or grants late admission, NPC, local-seat or future mutation capability. | QA-REQ-004 | COVERED |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-42-0',
    current:
      '| REQ-004 | Подключение игрока к кампании | J-JOIN-REVIEW | NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 | AQA-017 | UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-CAMPAIGN-READY-SET | player | Роль и authority соответствуют player., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "NET-001", "primaryActions": ["Открыть «Подключение по адресу или QR»", "Открыть «Выбор локальных персонажей и мест»", "Вернуться в главное меню игрока"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-002", "primaryActions": ["Подключиться по введённому адресу или QR", "Сканировать или выбрать QR", "Вернуться в меню игрока"], "workflowCommandIds": ["UI-CMD-CONNECTION-OPEN"]}, {"executableOperationIds": [], "formId": "NET-003", "primaryActions": ["Открыть «Отправка запроса устройства»", "Открыть «Отправка сохранённого персонажа»", "Открыть «Ожидание решения мастера»", "Вернуться к «Выбор локального профиля и места»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-004", "primaryActions": ["Отправить AdmissionBatch request", "Отменить до submit"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-SUBMIT"]}, {"executableOperationIds": [], "formId": "NET-005", "primaryActions": ["Отменить pending request", "Повторить подключение после потери связи", "Вернуться к выбору персонажей"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-CANCEL"]}, {"executableOperationIds": [], "formId": "NET-006", "primaryActions": ["Вернуться к «Итог согласования персонажа»", "Start подтверждён мастером", "Готов", "Отменить готовность"], "workflowCommandIds": ["UI-CMD-CAMPAIGN-READY-SET"]} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-002": ["EMPTY_ADDRESS", "PARSE_INVALID", "READY_TO_CONNECT", "CONNECTING", "CONNECTED_TECHNICAL"], "NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "NET-005": ["WAITING_GM", "READY_TO_CANCEL", "CANCELLED", "DECISION_WON_RACE", "IN_REVIEW", "REJECTED"]}} | Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Проверить UI-CMD-CAMPAIGN-READY-SET через экранные controls, mixed ACTIVE/blocked состав, Ready отмену и initial time без defaults. | Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request., Existing authenticated admitted bindings recover both before and after Start through the same campaign transport, GM context and routes. The immutable campaign birth/old admission receipts are not rewritten. Current HOSTING/PAUSED scene state is separate from birth PAUSED; reconnect never creates a new campaign/copy/group/scene or grants late admission, NPC, local-seat or future mutation capability. | QA-REQ-004 | COVERED |',
    retired:
      "| REQ-004 | Подключение игрока к кампании | J-JOIN-REVIEW | NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 | AQA-017 | UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT | player | Роль и authority соответствуют player., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'NET-001', 'primaryActions': ['Открыть «Подключение по адресу или QR»', 'Открыть «Выбор локальных персонажей и мест»', 'Вернуться в главное меню игрока'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-002', 'primaryActions': ['Подключиться по введённому адресу или QR', 'Сканировать или выбрать QR', 'Вернуться в меню игрока'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CONNECTION-OPEN']}, {'formId': 'NET-003', 'primaryActions': ['Открыть «Отправка запроса устройства»', 'Открыть «Отправка сохранённого персонажа»', 'Открыть «Ожидание решения мастера»', 'Вернуться к «Выбор локального профиля и места»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-004', 'primaryActions': ['Отправить AdmissionBatch request', 'Отменить до submit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-SUBMIT']}, {'formId': 'NET-005', 'primaryActions': ['Отменить pending request', 'Повторить подключение после потери связи'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-CANCEL']}, {'formId': 'NET-006', 'primaryActions': ['Вернуться к «Итог согласования персонажа»', 'Start подтверждён мастером'], 'executableOperationIds': [], 'workflowCommandIds': []} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"NET-002\": [\"EMPTY_ADDRESS\", \"PARSE_INVALID\", \"READY_TO_CONNECT\", \"CONNECTING\", \"CONNECTED_TECHNICAL\"], \"NET-004\": [\"DRAFT_REQUEST\", \"SUBMITTED\"], \"NET-005\": [\"WAITING_GM\", \"READY_TO_CANCEL\", \"CANCELLED\", \"DECISION_WON_RACE\"]}} | Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. | QA-REQ-004 | COVERED |",
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-43-0',
    current:
      '| REQ-005 | GM review, campaign copy diff и атомарный AdmissionBatch | J-JOIN-REVIEW | NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 | AQ2-010, AQA-017, OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "NET-017", "primaryActions": ["Открыть «Исходный локальный лист»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»", "Вернуться к «Клиенты и локальные места»", "Принять заявку к рассмотрению", "Отклонить заявку с причиной", "Вернуться к созданной кампании", "Начать рассмотрение кампанийных копий"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT", "UI-CMD-ADMISSION-REVIEW-OPEN"]}, {"executableOperationIds": [], "formId": "NET-018", "primaryActions": ["Вернуться к «Входящие запросы устройств»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-019", "primaryActions": ["Рассмотреть валидированную оружейную заявку", "Подготовить новое оружие из каталога"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-020", "primaryActions": ["Вернуться к «Входящие запросы устройств»", "Вернуться к «Исходный локальный лист»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-021", "primaryActions": ["Принять весь AdmissionBatch атомарно", "Отменить до commit"], "workflowCommandIds": ["UI-CMD-ADMISSION-GM-ACCEPT"]}, {"executableOperationIds": [], "formId": "NET-022", "primaryActions": ["Отклонить весь AdmissionBatch с причиной", "Отменить"], "workflowCommandIds": ["UI-CMD-ADMISSION-GM-REJECT"]}, {"executableOperationIds": [], "formId": "NET-027", "primaryActions": ["Принять весь batch diff", "Отказаться от всего batch"], "workflowCommandIds": ["UI-CMD-ADMISSION-PLAYER-DECIDE"]}, {"executableOperationIds": ["OP-REQ-GM"], "formId": "GM-019", "primaryActions": ["Применить patch существующего оружия", "Утвердить или переопределить оружейную заявку", "Отменить", "Подтвердить профиль рабочей копии"], "workflowCommandIds": ["UI-CMD-GM-WEAPON-REQUEST-RESOLVE"]}, {"executableOperationIds": [], "formId": "GM-020", "primaryActions": ["Вернуться к review после проверки навыка"], "workflowCommandIds": []} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only. UI-CMD-ADMISSION-REVIEW-OPEN creates only separate review workspace/receipt. Uncommitted typed draft is never source mutation or confirmed mechanics. GM-ACCEPT alone publishes final IDs/PROPOSED copies. Whole-batch player ACCEPT binds admission/controller and group assignment; PAUSED goes to NET-006, not active PLY-001.", "terminalStatesByForm": {"NET-017": ["QUEUE_EMPTY", "REQUEST_PENDING", "IN_REVIEW", "REQUEST_REJECTED", "STALE_REQUEST"], "NET-021": ["BLOCKED_INVALID_BATCH", "READY_ALL_OR_NONE", "PUBLISHED"], "NET-022": ["REASON_REQUIRED", "REJECTED"], "NET-027": ["DIFF_LOADING", "READY_FOR_WHOLE_BATCH_DECISION", "ACCEPTED", "DECLINED"]}} | Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020; использовать только admission-ветви primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. PATCH_EXISTING не относится к этому requirement. | Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request., Owner decision #199 B, 2026-11-01: PROPOSED copies reserve no capacity. Whole-batch player ACCEPT occupies one campaign place for every admitted copy, including lobby-only copies with pending mass/property blockers. Those blockers still prohibit active/Ready/scene. Capacity recheck counts all occupied admission places, not only currently active PCs. DECLINE activates no copy or place. Concurrent ACCEPT operations for the last place serialize in one host transaction; the losing batch remains unadmitted with no partial controller/group assignment. | QA-REQ-005 | COVERED |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-43-0',
    current:
      '| REQ-005 | GM review, campaign copy diff и атомарный AdmissionBatch | J-JOIN-REVIEW | NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 | AQ2-010, AQA-017, OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "NET-017", "primaryActions": ["Открыть «Исходный локальный лист»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»", "Вернуться к «Клиенты и локальные места»", "Принять заявку к рассмотрению", "Отклонить заявку с причиной", "Вернуться к созданной кампании", "Начать рассмотрение кампанийных копий"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT", "UI-CMD-ADMISSION-REVIEW-OPEN"]}, {"executableOperationIds": [], "formId": "NET-018", "primaryActions": ["Вернуться к «Входящие запросы устройств»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-019", "primaryActions": ["Рассмотреть валидированную оружейную заявку", "Подготовить новое оружие из каталога"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-020", "primaryActions": ["Вернуться к «Входящие запросы устройств»", "Вернуться к «Исходный локальный лист»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-021", "primaryActions": ["Принять весь AdmissionBatch атомарно", "Отменить до commit"], "workflowCommandIds": ["UI-CMD-ADMISSION-GM-ACCEPT"]}, {"executableOperationIds": [], "formId": "NET-022", "primaryActions": ["Отклонить весь AdmissionBatch с причиной", "Отменить"], "workflowCommandIds": ["UI-CMD-ADMISSION-GM-REJECT"]}, {"executableOperationIds": [], "formId": "NET-027", "primaryActions": ["Принять весь batch diff", "Отказаться от всего batch"], "workflowCommandIds": ["UI-CMD-ADMISSION-PLAYER-DECIDE"]}, {"executableOperationIds": ["OP-REQ-GM"], "formId": "GM-019", "primaryActions": ["Применить patch существующего оружия", "Утвердить или переопределить оружейную заявку", "Отменить", "Подтвердить профиль рабочей копии"], "workflowCommandIds": ["UI-CMD-GM-WEAPON-REQUEST-RESOLVE"]}, {"executableOperationIds": [], "formId": "GM-020", "primaryActions": ["Вернуться к review после проверки навыка"], "workflowCommandIds": []} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only. UI-CMD-ADMISSION-REVIEW-OPEN creates only separate review workspace/receipt. Uncommitted typed draft is never source mutation or confirmed mechanics. GM-ACCEPT alone publishes final IDs/PROPOSED copies. Whole-batch player ACCEPT binds admission/controller and group assignment; PAUSED goes to NET-006, not active PLY-001.", "terminalStatesByForm": {"NET-017": ["QUEUE_EMPTY", "REQUEST_PENDING", "IN_REVIEW", "REQUEST_REJECTED", "STALE_REQUEST"], "NET-021": ["BLOCKED_INVALID_BATCH", "READY_ALL_OR_NONE", "PUBLISHED"], "NET-022": ["REASON_REQUIRED", "REJECTED"], "NET-027": ["DIFF_LOADING", "READY_FOR_WHOLE_BATCH_DECISION", "ACCEPTED", "DECLINED"]}} | Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020; использовать только admission-ветви primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. PATCH_EXISTING не относится к этому requirement. | Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request., Owner decision #199 B, 2026-11-01: PROPOSED copies reserve no capacity. Whole-batch player ACCEPT occupies one campaign place for every admitted copy, including lobby-only copies with pending mass/property blockers. Those blockers still prohibit active/Ready/scene. Capacity recheck counts all occupied admission places, not only currently active PCs. DECLINE activates no copy or place. Concurrent ACCEPT operations for the last place serialize in one host transaction; the losing batch remains unadmitted with no partial controller/group assignment. | QA-REQ-005 | COVERED |',
    retired:
      "| REQ-005 | GM review, campaign copy diff и атомарный AdmissionBatch | J-JOIN-REVIEW | NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027 | AQ2-010, AQA-017, OP-REQ-GM | UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'NET-017', 'primaryActions': ['Открыть «Исходный локальный лист»', 'Открыть «Финализация кампанийной копии»', 'Открыть «Итог персонажа: группа и локация»', 'Открыть «Принять запрос устройства»', 'Вернуться к «Список персонажей кампании»', 'Вернуться к «Клиенты и локальные места»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-018', 'primaryActions': ['Вернуться к «Входящие запросы устройств»', 'Открыть «Финализация кампанийной копии»', 'Открыть «Итог персонажа: группа и локация»', 'Открыть «Принять запрос устройства»', 'Вернуться к «Список персонажей кампании»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-019', 'primaryActions': ['Рассмотреть валидированную оружейную заявку'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-020', 'primaryActions': ['Вернуться к «Входящие запросы устройств»', 'Вернуться к «Исходный локальный лист»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-021', 'primaryActions': ['Принять весь AdmissionBatch атомарно', 'Отменить до commit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-ADMISSION-GM-ACCEPT']}, {'formId': 'NET-022', 'primaryActions': ['Отклонить весь AdmissionBatch с причиной', 'Отменить'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-ADMISSION-GM-REJECT']}, {'formId': 'NET-027', 'primaryActions': ['Принять весь batch diff', 'Отказаться от всего batch'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-ADMISSION-PLAYER-DECIDE']} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"NET-021\": [\"BLOCKED_INVALID_BATCH\", \"READY_ALL_OR_NONE\", \"PUBLISHED\"], \"NET-022\": [\"REASON_REQUIRED\", \"REJECTED\"], \"NET-027\": [\"DIFF_LOADING\", \"READY_FOR_WHOLE_BATCH_DECISION\", \"ACCEPTED\", \"DECLINED\"]}} | Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. | QA-REQ-005 | COVERED |",
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-44-0',
    current:
      '| REQ-006 | Master-import требует owner/device/seat link | J-GM-IMPORT-ADMISSION | CHR-043, CHR-045, NET-028, NET-017, NET-027 | AQA-017 | UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "CHR-043", "primaryActions": ["Выбрать файл и перейти к обязательной проверке", "Отменить и вернуться в меню игрока", "Отменить и вернуться в библиотеку персонажей", "Отменить импорт-кандидата и вернуться к персонажам кампании"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CHR-045", "primaryActions": ["Подтвердить независимый импорт", "Закрыть результат и вернуться в меню игрока", "Закрыть результат и вернуться в библиотеку персонажей", "Закрыть результат и вернуться к персонажам кампании"], "workflowCommandIds": ["UI-CMD-CHAR-IMPORT-COMMIT"]}, {"executableOperationIds": [], "formId": "NET-028", "primaryActions": ["Подтвердить владение и local seat", "Отклонить claim"], "workflowCommandIds": ["UI-CMD-IMPORTED-OWNER-CLAIM"]}, {"executableOperationIds": [], "formId": "NET-017", "primaryActions": ["Открыть «Исходный локальный лист»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»", "Вернуться к «Клиенты и локальные места»", "Принять заявку к рассмотрению", "Отклонить заявку с причиной", "Вернуться к созданной кампании", "Начать рассмотрение кампанийных копий"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT"]}, {"executableOperationIds": [], "formId": "NET-027", "primaryActions": ["Принять весь batch diff", "Отказаться от всего batch"], "workflowCommandIds": ["UI-CMD-ADMISSION-PLAYER-DECIDE"]} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"CHR-043": ["NO_FILE", "FILE_SELECTED", "PICKER_CANCELLED"], "CHR-045": ["IMPORTED_LOCAL_COPY", "PENDING_OWNER_LINK", "INCOMPATIBLE_REPORT", "NO_PARTIAL_COMMIT"], "NET-017": ["QUEUE_EMPTY", "REQUEST_PENDING", "IN_REVIEW", "REQUEST_REJECTED", "STALE_REQUEST"], "NET-027": ["DIFF_LOADING", "READY_FOR_WHOLE_BATCH_DECISION", "ACCEPTED", "DECLINED"], "NET-028": ["PENDING_OWNER_LINK", "CLAIM_ACCEPTED", "CLAIM_DECLINED", "ADMISSION_REQUIRED"]}} | Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-006 | COVERED |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-44-0',
    current:
      '| REQ-006 | Master-import требует owner/device/seat link | J-GM-IMPORT-ADMISSION | CHR-043, CHR-045, NET-028, NET-017, NET-027 | AQA-017 | UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "CHR-043", "primaryActions": ["Выбрать файл и перейти к обязательной проверке", "Отменить и вернуться в меню игрока", "Отменить и вернуться в библиотеку персонажей", "Отменить импорт-кандидата и вернуться к персонажам кампании"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CHR-045", "primaryActions": ["Подтвердить независимый импорт", "Закрыть результат и вернуться в меню игрока", "Закрыть результат и вернуться в библиотеку персонажей", "Закрыть результат и вернуться к персонажам кампании"], "workflowCommandIds": ["UI-CMD-CHAR-IMPORT-COMMIT"]}, {"executableOperationIds": [], "formId": "NET-028", "primaryActions": ["Подтвердить владение и local seat", "Отклонить claim"], "workflowCommandIds": ["UI-CMD-IMPORTED-OWNER-CLAIM"]}, {"executableOperationIds": [], "formId": "NET-017", "primaryActions": ["Открыть «Исходный локальный лист»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»", "Вернуться к «Клиенты и локальные места»", "Принять заявку к рассмотрению", "Отклонить заявку с причиной", "Вернуться к созданной кампании", "Начать рассмотрение кампанийных копий"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT"]}, {"executableOperationIds": [], "formId": "NET-027", "primaryActions": ["Принять весь batch diff", "Отказаться от всего batch"], "workflowCommandIds": ["UI-CMD-ADMISSION-PLAYER-DECIDE"]} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"CHR-043": ["NO_FILE", "FILE_SELECTED", "PICKER_CANCELLED"], "CHR-045": ["IMPORTED_LOCAL_COPY", "PENDING_OWNER_LINK", "INCOMPATIBLE_REPORT", "NO_PARTIAL_COMMIT"], "NET-017": ["QUEUE_EMPTY", "REQUEST_PENDING", "IN_REVIEW", "REQUEST_REJECTED", "STALE_REQUEST"], "NET-027": ["DIFF_LOADING", "READY_FOR_WHOLE_BATCH_DECISION", "ACCEPTED", "DECLINED"], "NET-028": ["PENDING_OWNER_LINK", "CLAIM_ACCEPTED", "CLAIM_DECLINED", "ADMISSION_REQUIRED"]}} | Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-006 | COVERED |',
    retired:
      "| REQ-006 | Master-import требует owner/device/seat link | J-GM-IMPORT-ADMISSION | CHR-043, CHR-045, NET-028, NET-017, NET-027 | AQA-017 | UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'CHR-043', 'primaryActions': ['Выбрать файл и перейти к обязательной проверке', 'Отменить и вернуться в меню игрока', 'Отменить и вернуться в библиотеку персонажей', 'Отменить импорт-кандидата и вернуться к персонажам кампании'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'CHR-045', 'primaryActions': ['Подтвердить независимый импорт', 'Закрыть результат и вернуться в меню игрока', 'Закрыть результат и вернуться в библиотеку персонажей', 'Закрыть результат и вернуться к персонажам кампании'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CHAR-IMPORT-COMMIT']}, {'formId': 'NET-028', 'primaryActions': ['Подтвердить владение и local seat', 'Отклонить claim'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-IMPORTED-OWNER-CLAIM']}, {'formId': 'NET-017', 'primaryActions': ['Открыть «Исходный локальный лист»', 'Открыть «Финализация кампанийной копии»', 'Открыть «Итог персонажа: группа и локация»', 'Открыть «Принять запрос устройства»', 'Вернуться к «Список персонажей кампании»', 'Вернуться к «Клиенты и локальные места»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-027', 'primaryActions': ['Принять весь batch diff', 'Отказаться от всего batch'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-ADMISSION-PLAYER-DECIDE']} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"CHR-043\": [\"NO_FILE\", \"FILE_SELECTED\", \"PICKER_CANCELLED\"], \"CHR-045\": [\"IMPORTED_LOCAL_COPY\", \"PENDING_OWNER_LINK\", \"INCOMPATIBLE_REPORT\", \"NO_PARTIAL_COMMIT\"], \"NET-027\": [\"DIFF_LOADING\", \"READY_FOR_WHOLE_BATCH_DECISION\", \"ACCEPTED\", \"DECLINED\"], \"NET-028\": [\"PENDING_OWNER_LINK\", \"CLAIM_ACCEPTED\", \"CLAIM_DECLINED\", \"ADMISSION_REQUIRED\"]}} | Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. | QA-REQ-006 | COVERED |",
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-45-0',
    current:
      '| REQ-007 | Создание/host/preflight/start кампании без выбора правил | J-CAMPAIGN-CREATE | CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 |  | UI-CMD-CAMPAIGN-CREATE | gm | Роль и authority соответствуют gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "CMP-001", "primaryActions": ["Продолжить к вместимости и host", "Отменить черновик кампании"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-002", "primaryActions": ["Назад к основным данным", "Продолжить к паролю мастера"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-003", "primaryActions": ["Назад к host", "Продолжить к режиму будущих бросков"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-004", "primaryActions": ["Назад к паролю мастера", "Перейти к итоговой проверке"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-005", "primaryActions": ["Создать кампанию атомарно", "Назад до commit"], "workflowCommandIds": ["UI-CMD-CAMPAIGN-CREATE"]}, {"executableOperationIds": [], "formId": "CMP-006", "primaryActions": ["Открыть панель созданной кампании", "Открыть входящие запросы устройств"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-007", "primaryActions": ["Открыть «Лобби подключений и Start»", "Открыть «Настройки кампании»", "Открыть активную кампанию", "Вернуться на главный экран мастера", "Подключение к кампании"], "workflowCommandIds": []} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"CMP-001": ["METADATA_INCOMPLETE", "METADATA_VALID", "DRAFT_CANCELLED"], "CMP-002": ["HOST_CONFIG_INVALID", "HOST_CONFIG_VALID", "PORT_UNAVAILABLE"], "CMP-003": ["PASSWORD_INCOMPLETE", "PASSWORD_VALID", "SECRET_HIDDEN"], "CMP-004": ["MODE_UNSELECTED", "MODE_VALID", "OPEN_REQUESTS_UNCHANGED"], "CMP-005": ["PREFLIGHT_BLOCKED", "READY_TO_CREATE", "CREATING", "CREATED", "IDEMPOTENT_REPLAY"], "CMP-006": ["RECEIPT_READY", "HOST_NOT_STARTED", "OPENED_LOBBY", "OPENED_REQUEST_QUEUE"]}} | Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-007 | COVERED |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-45-0',
    current:
      '| REQ-007 | Создание/host/preflight/start кампании без выбора правил | J-CAMPAIGN-CREATE | CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 |  | UI-CMD-CAMPAIGN-CREATE | gm | Роль и authority соответствуют gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "CMP-001", "primaryActions": ["Продолжить к вместимости и host", "Отменить черновик кампании"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-002", "primaryActions": ["Назад к основным данным", "Продолжить к паролю мастера"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-003", "primaryActions": ["Назад к host", "Продолжить к режиму будущих бросков"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-004", "primaryActions": ["Назад к паролю мастера", "Перейти к итоговой проверке"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-005", "primaryActions": ["Создать кампанию атомарно", "Назад до commit"], "workflowCommandIds": ["UI-CMD-CAMPAIGN-CREATE"]}, {"executableOperationIds": [], "formId": "CMP-006", "primaryActions": ["Открыть панель созданной кампании", "Открыть входящие запросы устройств"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "CMP-007", "primaryActions": ["Открыть «Лобби подключений и Start»", "Открыть «Настройки кампании»", "Открыть активную кампанию", "Вернуться на главный экран мастера", "Подключение к кампании"], "workflowCommandIds": []} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"CMP-001": ["METADATA_INCOMPLETE", "METADATA_VALID", "DRAFT_CANCELLED"], "CMP-002": ["HOST_CONFIG_INVALID", "HOST_CONFIG_VALID", "PORT_UNAVAILABLE"], "CMP-003": ["PASSWORD_INCOMPLETE", "PASSWORD_VALID", "SECRET_HIDDEN"], "CMP-004": ["MODE_UNSELECTED", "MODE_VALID", "OPEN_REQUESTS_UNCHANGED"], "CMP-005": ["PREFLIGHT_BLOCKED", "READY_TO_CREATE", "CREATING", "CREATED", "IDEMPOTENT_REPLAY"], "CMP-006": ["RECEIPT_READY", "HOST_NOT_STARTED", "OPENED_LOBBY", "OPENED_REQUEST_QUEUE"]}} | Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-007 | COVERED |',
    retired:
      "| REQ-007 | Создание/host/preflight/start кампании без выбора правил | J-CAMPAIGN-CREATE | CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 |  | UI-CMD-CAMPAIGN-CREATE | gm | Роль и authority соответствуют gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'CMP-001', 'primaryActions': ['Продолжить к вместимости и host', 'Отменить черновик кампании'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'CMP-002', 'primaryActions': ['Назад к основным данным', 'Продолжить к паролю мастера'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'CMP-003', 'primaryActions': ['Назад к host', 'Продолжить к режиму будущих бросков'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'CMP-004', 'primaryActions': ['Назад к паролю мастера', 'Перейти к итоговой проверке'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'CMP-005', 'primaryActions': ['Создать кампанию атомарно', 'Назад до commit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CAMPAIGN-CREATE']}, {'formId': 'CMP-006', 'primaryActions': ['Открыть панель созданной кампании'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'CMP-007', 'primaryActions': ['Открыть «Лобби подключений и Start»', 'Открыть «Настройки кампании»', 'Открыть активную кампанию', 'Вернуться на главный экран мастера'], 'executableOperationIds': [], 'workflowCommandIds': []} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"CMP-001\": [\"METADATA_INCOMPLETE\", \"METADATA_VALID\", \"DRAFT_CANCELLED\"], \"CMP-002\": [\"HOST_CONFIG_INVALID\", \"HOST_CONFIG_VALID\", \"PORT_UNAVAILABLE\"], \"CMP-003\": [\"PASSWORD_INCOMPLETE\", \"PASSWORD_VALID\", \"SECRET_HIDDEN\"], \"CMP-004\": [\"MODE_UNSELECTED\", \"MODE_VALID\", \"OPEN_REQUESTS_UNCHANGED\"], \"CMP-005\": [\"PREFLIGHT_BLOCKED\", \"READY_TO_CREATE\", \"CREATING\", \"CREATED\", \"IDEMPOTENT_REPLAY\"], \"CMP-006\": [\"RECEIPT_READY\", \"HOST_NOT_STARTED\", \"OPENED_LOBBY\"]}} | Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. | QA-REQ-007 | COVERED |",
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-46-0',
    current:
      '| REQ-010 | Первоначальное заявление local player на host до player tab | J-LOCAL-SEATS | CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 | AQ2-011, AQA-017, AQA-040, CQA-004, OP-CHAR-CREATE | UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "CMP-009", "primaryActions": ["Вернуться к «Настройки кампании»", "Вернуться к «Выбор локального профиля и места»", "Открыть «Нейтральная завеса передачи устройства»", "Передать устройство локальному кандидату"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "PLY-030", "primaryActions": ["Готов открыть следующую проекцию", "Вернуть управление инициатору после ответа"], "workflowCommandIds": ["UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK"]}, {"executableOperationIds": [], "formId": "APP-004", "primaryActions": ["Открыть «Создание персонажа: идентичность»", "Открыть «Выбор локального профиля и места»", "Открыть «Проверка совместимости сохранения»", "Открыть «Подтверждение выхода»", "Вернуться в главное меню игрока", "Импортировать персонажа"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-003", "primaryActions": ["Открыть «Отправка запроса устройства»", "Открыть «Отправка сохранённого персонажа»", "Открыть «Ожидание решения мастера»", "Вернуться к «Выбор локального профиля и места»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-004", "primaryActions": ["Отправить AdmissionBatch request", "Отменить до submit"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-SUBMIT"]}, {"executableOperationIds": [], "formId": "NET-017", "primaryActions": ["Открыть «Исходный локальный лист»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»", "Вернуться к «Клиенты и локальные места»", "Принять заявку к рассмотрению", "Отклонить заявку с причиной", "Вернуться к созданной кампании", "Начать рассмотрение кампанийных копий"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT"]} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "NET-017": ["QUEUE_EMPTY", "REQUEST_PENDING", "IN_REVIEW", "REQUEST_REJECTED", "STALE_REQUEST"], "PLY-030": ["inactive", "PRIVACY_HANDOFF", "WAITING_FOR_LOCAL_OWNER", "TARGET_CONTEXT_ACTIVE", "RETURN_TO_INITIATOR", "RECONNECT_RESTORED"]}} | Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-010 | COVERED |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-46-0',
    current:
      '| REQ-010 | Первоначальное заявление local player на host до player tab | J-LOCAL-SEATS | CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 | AQ2-011, AQA-017, AQA-040, CQA-004, OP-CHAR-CREATE | UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {"executableOperationIds": [], "formId": "CMP-009", "primaryActions": ["Вернуться к «Настройки кампании»", "Вернуться к «Выбор локального профиля и места»", "Открыть «Нейтральная завеса передачи устройства»", "Передать устройство локальному кандидату"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "PLY-030", "primaryActions": ["Готов открыть следующую проекцию", "Вернуть управление инициатору после ответа"], "workflowCommandIds": ["UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK"]}, {"executableOperationIds": [], "formId": "APP-004", "primaryActions": ["Открыть «Создание персонажа: идентичность»", "Открыть «Выбор локального профиля и места»", "Открыть «Проверка совместимости сохранения»", "Открыть «Подтверждение выхода»", "Вернуться в главное меню игрока", "Импортировать персонажа"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-003", "primaryActions": ["Открыть «Отправка запроса устройства»", "Открыть «Отправка сохранённого персонажа»", "Открыть «Ожидание решения мастера»", "Вернуться к «Выбор локального профиля и места»"], "workflowCommandIds": []}, {"executableOperationIds": [], "formId": "NET-004", "primaryActions": ["Отправить AdmissionBatch request", "Отменить до submit"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-SUBMIT"]}, {"executableOperationIds": [], "formId": "NET-017", "primaryActions": ["Открыть «Исходный локальный лист»", "Открыть «Финализация кампанийной копии»", "Открыть «Итог персонажа: группа и локация»", "Открыть «Принять запрос устройства»", "Вернуться к «Список персонажей кампании»", "Вернуться к «Клиенты и локальные места»", "Принять заявку к рассмотрению", "Отклонить заявку с причиной", "Вернуться к созданной кампании", "Начать рассмотрение кампанийных копий"], "workflowCommandIds": ["UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW", "UI-CMD-DEVICE-REQUEST-REJECT"]} | {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "NET-017": ["QUEUE_EMPTY", "REQUEST_PENDING", "IN_REVIEW", "REQUEST_REJECTED", "STALE_REQUEST"], "PLY-030": ["inactive", "PRIVACY_HANDOFF", "WAITING_FOR_LOCAL_OWNER", "TARGET_CONTEXT_ACTIVE", "RETURN_TO_INITIATOR", "RECONNECT_RESTORED"]}} | Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-010 | COVERED |',
    retired:
      "| REQ-010 | Первоначальное заявление local player на host до player tab | J-LOCAL-SEATS | CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 | AQ2-011, AQA-017, AQA-040, CQA-004, OP-CHAR-CREATE | UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'CMP-009', 'primaryActions': ['Вернуться к «Настройки кампании»', 'Вернуться к «Выбор локального профиля и места»', 'Открыть «Нейтральная завеса передачи устройства»', 'Передать устройство локальному кандидату'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'PLY-030', 'primaryActions': ['Готов открыть следующую проекцию', 'Вернуть управление инициатору после ответа'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK']}, {'formId': 'APP-004', 'primaryActions': ['Открыть «Создание персонажа: идентичность»', 'Открыть «Выбор локального профиля и места»', 'Открыть «Проверка совместимости сохранения»', 'Открыть «Подтверждение выхода»', 'Вернуться в главное меню игрока', 'Импортировать персонажа'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-003', 'primaryActions': ['Открыть «Отправка запроса устройства»', 'Открыть «Отправка сохранённого персонажа»', 'Открыть «Ожидание решения мастера»', 'Вернуться к «Выбор локального профиля и места»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-004', 'primaryActions': ['Отправить AdmissionBatch request', 'Отменить до submit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-SUBMIT']}, {'formId': 'NET-017', 'primaryActions': ['Открыть «Исходный локальный лист»', 'Открыть «Финализация кампанийной копии»', 'Открыть «Итог персонажа: группа и локация»', 'Открыть «Принять запрос устройства»', 'Вернуться к «Список персонажей кампании»', 'Вернуться к «Клиенты и локальные места»'], 'executableOperationIds': [], 'workflowCommandIds': []} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"NET-004\": [\"DRAFT_REQUEST\", \"SUBMITTED\"], \"PLY-030\": [\"inactive\", \"PRIVACY_HANDOFF\", \"WAITING_FOR_LOCAL_OWNER\", \"TARGET_CONTEXT_ACTIVE\", \"RETURN_TO_INITIATOR\", \"RECONNECT_RESTORED\"]}} | Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. | QA-REQ-010 | COVERED |",
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-47-0',
    current:
      "| REQ-031 | Waiting/connect/reconnect/connection-lost states | J-RECONNECT, J-JOIN-REVIEW | NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 | AQ2-025, AQA-017 | UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'NET-004', 'primaryActions': ['Отправить AdmissionBatch request', 'Отменить до submit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-SUBMIT']}, {'formId': 'NET-005', 'primaryActions': ['Отменить pending request', 'Повторить подключение после потери связи', 'Вернуться к выбору персонажей'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-CANCEL']}, {'formId': 'NET-008', 'primaryActions': ['Вернуться к «Соединение потеряно»', 'Повторить подключение'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-009', 'primaryActions': ['Открыть «Сверка состояния после переподключения»', 'Получен snapshot'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-011', 'primaryActions': ['Повторить прерванную сессию по тому же адресу', 'Повторить новое подключение игрока по тому же адресу', 'Изменить адрес или QR как игрок', 'Выйти в локальное меню игрока', 'Выйти в меню мастера'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CONNECTION-OPEN']}, {'formId': 'NET-012', 'primaryActions': ['Открыть «Потеря соединения»', 'Открыть «Сервер недоступен»', 'Открыть «Переподключение к игре»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-013', 'primaryActions': ['Открыть «Переподключение во время боя»', 'Открыть «Индикатор активного локального места»'], 'executableOperationIds': [], 'workflowCommandIds': []} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"NET-004\": [\"DRAFT_REQUEST\", \"SUBMITTED\"], \"NET-005\": [\"WAITING_GM\", \"READY_TO_CANCEL\", \"CANCELLED\", \"DECISION_WON_RACE\", \"IN_REVIEW\", \"REJECTED\"], \"NET-011\": [\"UNAVAILABLE\", \"RETRY_READY\", \"RETRYING\", \"EXITED_TO_LOCAL\"], \"NET-012\": [\"hidden\", \"visible\"], \"NET-013\": [\"hidden\", \"visible\"]}} | Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-031 | COVERED |",
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-47-0',
    current:
      "| REQ-031 | Waiting/connect/reconnect/connection-lost states | J-RECONNECT, J-JOIN-REVIEW | NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 | AQ2-025, AQA-017 | UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'NET-004', 'primaryActions': ['Отправить AdmissionBatch request', 'Отменить до submit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-SUBMIT']}, {'formId': 'NET-005', 'primaryActions': ['Отменить pending request', 'Повторить подключение после потери связи', 'Вернуться к выбору персонажей'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-CANCEL']}, {'formId': 'NET-008', 'primaryActions': ['Вернуться к «Соединение потеряно»', 'Повторить подключение'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-009', 'primaryActions': ['Открыть «Сверка состояния после переподключения»', 'Получен snapshot'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-011', 'primaryActions': ['Повторить прерванную сессию по тому же адресу', 'Повторить новое подключение игрока по тому же адресу', 'Изменить адрес или QR как игрок', 'Выйти в локальное меню игрока', 'Выйти в меню мастера'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CONNECTION-OPEN']}, {'formId': 'NET-012', 'primaryActions': ['Открыть «Потеря соединения»', 'Открыть «Сервер недоступен»', 'Открыть «Переподключение к игре»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-013', 'primaryActions': ['Открыть «Переподключение во время боя»', 'Открыть «Индикатор активного локального места»'], 'executableOperationIds': [], 'workflowCommandIds': []} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"NET-004\": [\"DRAFT_REQUEST\", \"SUBMITTED\"], \"NET-005\": [\"WAITING_GM\", \"READY_TO_CANCEL\", \"CANCELLED\", \"DECISION_WON_RACE\", \"IN_REVIEW\", \"REJECTED\"], \"NET-011\": [\"UNAVAILABLE\", \"RETRY_READY\", \"RETRYING\", \"EXITED_TO_LOCAL\"], \"NET-012\": [\"hidden\", \"visible\"], \"NET-013\": [\"hidden\", \"visible\"]}} | Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache., Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation., REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command., CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. | QA-REQ-031 | COVERED |",
    retired:
      "| REQ-031 | Waiting/connect/reconnect/connection-lost states | J-RECONNECT, J-JOIN-REVIEW | NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 | AQ2-025, AQA-017 | UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT | player, gm | Роль и authority соответствуют player/gm., Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм., Player/effective-controller projection содержит только CTA, для которых per-action guard=true. | {'formId': 'NET-004', 'primaryActions': ['Отправить AdmissionBatch request', 'Отменить до submit'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-SUBMIT']}, {'formId': 'NET-005', 'primaryActions': ['Отменить pending request', 'Повторить подключение после потери связи'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-DEVICE-REQUEST-CANCEL']}, {'formId': 'NET-008', 'primaryActions': ['Вернуться к «Соединение потеряно»', 'Повторить подключение'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-009', 'primaryActions': ['Открыть «Сверка состояния после переподключения»', 'Получен snapshot'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-011', 'primaryActions': ['Повторить прерванную сессию по тому же адресу', 'Повторить новое подключение игрока по тому же адресу', 'Изменить адрес или QR как игрок', 'Выйти в локальное меню игрока', 'Выйти в меню мастера'], 'executableOperationIds': [], 'workflowCommandIds': ['UI-CMD-CONNECTION-OPEN']}, {'formId': 'NET-012', 'primaryActions': ['Открыть «Потеря соединения»', 'Открыть «Сервер недоступен»', 'Открыть «Переподключение к игре»'], 'executableOperationIds': [], 'workflowCommandIds': []}, {'formId': 'NET-013', 'primaryActions': ['Открыть «Переподключение во время боя»', 'Открыть «Индикатор активного локального места»'], 'executableOperationIds': [], 'workflowCommandIds': []} | {\"audit\": \"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.\", \"mutationBoundary\": \"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.\", \"terminalStatesByForm\": {\"NET-004\": [\"DRAFT_REQUEST\", \"SUBMITTED\"], \"NET-005\": [\"WAITING_GM\", \"READY_TO_CANCEL\", \"CANCELLED\", \"DECISION_WON_RACE\"], \"NET-011\": [\"UNAVAILABLE\", \"RETRY_READY\", \"RETRYING\", \"EXITED_TO_LOCAL\"], \"NET-012\": [\"hidden\", \"visible\"], \"NET-013\": [\"hidden\", \"visible\"]}} | Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. | Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Uncommitted local input may restore as draft but never as confirmed state., Committed command restores by commandId with the same receipt/random result and no duplicate side effect., Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. | QA-REQ-031 | COVERED |",
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-48-0',
    current:
      '| UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW | Принять заявку к рассмотрению | NET-017 | Sole active GM authority for this campaign; requestStatus=PENDING; requestId and requestRevision current; selected request has 1–3 validated immutable candidates; no copy, admission or capacity mutation. | Change exactly one request PENDING→IN_REVIEW, increment requestRevision once and append one decision receipt; do not create campaign copies, campaign seats, capacity reservations or player campaign authority; do not modify campaign checkpoint or local source sheets. | Same commandId and payload return the original decision receipt; a current request view may be newer. A concurrent owner cancel or preliminary reject is serialized by requestRevision; the loser performs no write. | QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-48-1',
    current:
      '| UI-CMD-DEVICE-REQUEST-REJECT | Отклонить заявку с причиной | NET-017 | Sole active GM authority for this campaign; requestStatus=PENDING or IN_REVIEW; requestId and requestRevision current; non-empty reason; no copy, admission or capacity mutation. | Change exactly one request PENDING\\|IN_REVIEW→REJECTED with the non-empty reason, increment requestRevision once and append one decision receipt; preserve candidate snapshot and history; no campaign copy, campaign seat, capacity or local-sheet mutation. | Same commandId and payload return the original rejection receipt even if the UI has moved. A changed payload conflicts; stale requestRevision and a concurrent terminal decision perform no write. | QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-49-0',
    current:
      '| QA-FORM-NET-005 | NET-005 | Проверить буквальное назначение NET-005: Read-only состав запроса; до принятия устройство не занимает места и не меняет кампанию. Поля: requestId, requestOwnerDeviceId, batchCharacterSummaries[1..3], requestStatus=PENDING\\|IN_REVIEW\\|REJECTED\\|PROPOSED, gmMessage, connectionState, requestRevision, cancelReason(required), commandId. CTA: Отменить pending request, Повторить подключение после потери связи, Вернуться к выбору персонажей. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-49-0',
    current:
      '| QA-FORM-NET-005 | NET-005 | Проверить буквальное назначение NET-005: Read-only состав запроса; до принятия устройство не занимает места и не меняет кампанию. Поля: requestId, requestOwnerDeviceId, batchCharacterSummaries[1..3], requestStatus=PENDING\\|IN_REVIEW\\|REJECTED\\|PROPOSED, gmMessage, connectionState, requestRevision, cancelReason(required), commandId. CTA: Отменить pending request, Повторить подключение после потери связи, Вернуться к выбору персонажей. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    retired:
      '| QA-FORM-NET-005 | NET-005 | Проверить буквальное назначение NET-005: Read-only состав запроса; до принятия устройство не занимает места и не меняет кампанию. Поля: requestId, requestOwnerDeviceId, batchCharacterSummaries[1..3], requestStatus=PENDING\\|REJECTED\\|PROPOSED, gmMessage, connectionState, requestRevision, cancelReason(required), commandId. CTA: Отменить pending request, Повторить подключение после потери связи. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-50-0',
    current:
      '| QA-FORM-NET-017 | NET-017 | Проверить буквальное назначение NET-017: Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией. Поля: contextId, campaignId, stateRevision, projectionRevision, requestQueueRevision, requests[], selectedRequestIdOrNull, activePlayerCapacity, occupiedActivePcCount, decisionReason(required-for-reject), commandId, returnContext. CTA: Открыть «Исходный локальный лист», Открыть «Финализация кампанийной копии», Открыть «Итог персонажа: группа и локация», Открыть «Принять запрос устройства», Вернуться к «Список персонажей кампании», Вернуться к «Клиенты и локальные места», Принять заявку к рассмотрению, Отклонить заявку с причиной, Вернуться к созданной кампании, Начать рассмотрение кампанийных копий. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-50-0',
    current:
      '| QA-FORM-NET-017 | NET-017 | Проверить буквальное назначение NET-017: Очередь заявок устройств: подтверждённые immutable кандидаты, DeviceId и прогноз вместимости; принять заявку к рассмотрению либо отклонить с причиной без допуска, campaign copy или резерва места. Полный review и финальный AdmissionBatch остаются отдельной последующей стадией. Поля: contextId, campaignId, stateRevision, projectionRevision, requestQueueRevision, requests[], selectedRequestIdOrNull, activePlayerCapacity, occupiedActivePcCount, decisionReason(required-for-reject), commandId, returnContext. CTA: Открыть «Исходный локальный лист», Открыть «Финализация кампанийной копии», Открыть «Итог персонажа: группа и локация», Открыть «Принять запрос устройства», Вернуться к «Список персонажей кампании», Вернуться к «Клиенты и локальные места», Принять заявку к рассмотрению, Отклонить заявку с причиной, Вернуться к созданной кампании, Начать рассмотрение кампанийных копий. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    retired:
      '| QA-FORM-NET-017 | NET-017 | Проверить буквальное назначение NET-017: DeviceId, несколько выбранных персонажей, прогноз занимаемых мест и принять к рассмотрению либо отклонить. Поля: contextId, stateRevision, projectionRevision, effectInstanceId/EffectTypeID, source, duration/stackPolicy, deviceId, controllerSeat, connectionState. CTA: Открыть «Исходный локальный лист», Открыть «Финализация кампанийной копии», Открыть «Итог персонажа: группа и локация», Открыть «Принять запрос устройства», Вернуться к «Список персонажей кампании», Вернуться к «Клиенты и локальные места». | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-51-0',
    current:
      '| QA-FORM-CMP-006 | CMP-006 | Проверить буквальное назначение CMP-006: Адрес и QR подключения, переход в лобби; подготовка разрешена при нуле персонажей. Поля: campaignId, status=PAUSED, createdAt, hostAddress, hostPort, qrPayload, activePlayerCapacity, creationReceiptId. CTA: Открыть панель созданной кампании, Открыть входящие запросы устройств. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-51-0',
    current:
      '| QA-FORM-CMP-006 | CMP-006 | Проверить буквальное назначение CMP-006: Адрес и QR подключения, переход в лобби; подготовка разрешена при нуле персонажей. Поля: campaignId, status=PAUSED, createdAt, hostAddress, hostPort, qrPayload, activePlayerCapacity, creationReceiptId. CTA: Открыть панель созданной кампании, Открыть входящие запросы устройств. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    retired:
      '| QA-FORM-CMP-006 | CMP-006 | Проверить буквальное назначение CMP-006: Адрес и QR подключения, переход в лобби; подготовка разрешена при нуле персонажей. Поля: campaignId, status=PAUSED, createdAt, hostAddress, hostPort, qrPayload, activePlayerCapacity, creationReceiptId. CTA: Открыть панель созданной кампании. | Все form-specific поля/CTA/guards и loading/empty/validation/stale/connection/reconnect состояния совпадают с записью; mutation атомарна и идемпотентна. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-52-0',
    current:
      '| QA-REQ-004 | REQ-004 | Требование «Подключение игрока к кампании». Preconditions: Роль и authority соответствуют player.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Проверить UI-CMD-CAMPAIGN-READY-SET через экранные controls, mixed ACTIVE/blocked состав, Ready отмену и initial time без defaults. Error/offline: Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"NET-002":["EMPTY_ADDRESS","PARSE_INVALID","READY_TO_CONNECT","CONNECTING","CONNECTED_TECHNICAL"],"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-005":["WAITING_GM","READY_TO_CANCEL","CANCELLED","DECISION_WON_RACE","IN_REVIEW","REJECTED"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.; REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-52-0',
    current:
      '| QA-REQ-004 | REQ-004 | Требование «Подключение игрока к кампании». Preconditions: Роль и authority соответствуют player.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Проверить UI-CMD-CAMPAIGN-READY-SET через экранные controls, mixed ACTIVE/blocked состав, Ready отмену и initial time без defaults. Error/offline: Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"NET-002":["EMPTY_ADDRESS","PARSE_INVALID","READY_TO_CONNECT","CONNECTING","CONNECTED_TECHNICAL"],"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-005":["WAITING_GM","READY_TO_CANCEL","CANCELLED","DECISION_WON_RACE","IN_REVIEW","REJECTED"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.; REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired:
      '| QA-REQ-004 | REQ-004 | Требование «Подключение игрока к кампании». Preconditions: Роль и authority соответствуют player.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-001, NET-002, NET-003, NET-004, NET-005, NET-006; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для NET-001, NET-002, NET-003, NET-004, NET-005, NET-006 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-002": ["EMPTY_ADDRESS", "PARSE_INVALID", "READY_TO_CONNECT", "CONNECTING", "CONNECTED_TECHNICAL"], "NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "NET-005": ["WAITING_GM", "READY_TO_CANCEL", "CANCELLED", "DECISION_WON_RACE"]}} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-53-0',
    current:
      '| QA-REQ-005 | REQ-005 | Требование «GM review, campaign copy diff и атомарный AdmissionBatch». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020; использовать только admission-ветви primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. PATCH_EXISTING не относится к этому requirement. Error/offline: Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Все закрытые admission contracts и terminalStatesByForm соблюдены; исходные immutable FINAL неизменны. Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only. UI-CMD-ADMISSION-REVIEW-OPEN creates only separate review workspace/receipt. Uncommitted typed draft is never source mutation or confirmed mechanics. GM-ACCEPT alone publishes final IDs/PROPOSED copies. Whole-batch player ACCEPT binds admission/controller and group assignment; PAUSED goes to NET-006, not active PLY-001. Owner decision #199 B, 2026-11-01: PROPOSED copies reserve no capacity. Whole-batch player ACCEPT occupies one campaign place for every admitted copy, including lobby-only copies with pending mass/property blockers. Those blockers still prohibit active/Ready/scene. Capacity recheck counts all occupied admission places, not only currently active PCs. DECLINE activates no copy or place. Concurrent ACCEPT operations for the last place serialize in one host transaction; the losing batch remains unadmitted with no partial controller/group assignment. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-53-0',
    current:
      '| QA-REQ-005 | REQ-005 | Требование «GM review, campaign copy diff и атомарный AdmissionBatch». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020; использовать только admission-ветви primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT, UI-CMD-ADMISSION-REVIEW-OPEN, UI-CMD-GM-WEAPON-REQUEST-RESOLVE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. PATCH_EXISTING не относится к этому requirement. Error/offline: Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027, GM-019, GM-020 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Все закрытые admission contracts и terminalStatesByForm соблюдены; исходные immutable FINAL неизменны. Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only. UI-CMD-ADMISSION-REVIEW-OPEN creates only separate review workspace/receipt. Uncommitted typed draft is never source mutation or confirmed mechanics. GM-ACCEPT alone publishes final IDs/PROPOSED copies. Whole-batch player ACCEPT binds admission/controller and group assignment; PAUSED goes to NET-006, not active PLY-001. Owner decision #199 B, 2026-11-01: PROPOSED copies reserve no capacity. Whole-batch player ACCEPT occupies one campaign place for every admitted copy, including lobby-only copies with pending mass/property blockers. Those blockers still prohibit active/Ready/scene. Capacity recheck counts all occupied admission places, not only currently active PCs. DECLINE activates no copy or place. Concurrent ACCEPT operations for the last place serialize in one host transaction; the losing batch remains unadmitted with no partial controller/group assignment. |',
    retired:
      '| QA-REQ-005 | REQ-005 | Требование «GM review, campaign copy diff и атомарный AdmissionBatch». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-JOIN-REVIEW через формы NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-GM-ACCEPT, UI-CMD-ADMISSION-GM-REJECT, UI-CMD-ADMISSION-PLAYER-DECIDE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для NET-017, NET-018, NET-019, NET-020, NET-021, NET-022, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-021": ["BLOCKED_INVALID_BATCH", "READY_ALL_OR_NONE", "PUBLISHED"], "NET-022": ["REASON_REQUIRED", "REJECTED"], "NET-027": ["DIFF_LOADING", "READY_FOR_WHOLE_BATCH_DECISION", "ACCEPTED", "DECLINED"]}} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-54-0',
    current:
      '| QA-REQ-006 | REQ-006 | Требование «Master-import требует owner/device/seat link». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"CHR-043":["NO_FILE","FILE_SELECTED","PICKER_CANCELLED"],"CHR-045":["IMPORTED_LOCAL_COPY","PENDING_OWNER_LINK","INCOMPATIBLE_REPORT","NO_PARTIAL_COMMIT"],"NET-028":["PENDING_OWNER_LINK","CLAIM_ACCEPTED","CLAIM_DECLINED","ADMISSION_REQUIRED"],"NET-027":["DIFF_LOADING","READY_FOR_WHOLE_BATCH_DECISION","ACCEPTED","DECLINED"],"NET-017":["QUEUE_EMPTY","REQUEST_PENDING","IN_REVIEW","REQUEST_REJECTED","STALE_REQUEST"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-54-0',
    current:
      '| QA-REQ-006 | REQ-006 | Требование «Master-import требует owner/device/seat link». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"CHR-043":["NO_FILE","FILE_SELECTED","PICKER_CANCELLED"],"CHR-045":["IMPORTED_LOCAL_COPY","PENDING_OWNER_LINK","INCOMPATIBLE_REPORT","NO_PARTIAL_COMMIT"],"NET-028":["PENDING_OWNER_LINK","CLAIM_ACCEPTED","CLAIM_DECLINED","ADMISSION_REQUIRED"],"NET-027":["DIFF_LOADING","READY_FOR_WHOLE_BATCH_DECISION","ACCEPTED","DECLINED"],"NET-017":["QUEUE_EMPTY","REQUEST_PENDING","IN_REVIEW","REQUEST_REJECTED","STALE_REQUEST"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired:
      '| QA-REQ-006 | REQ-006 | Требование «Master-import требует owner/device/seat link». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-GM-IMPORT-ADMISSION через формы CHR-043, CHR-045, NET-028, NET-017, NET-027; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-ADMISSION-PLAYER-DECIDE, UI-CMD-CHAR-IMPORT-COMMIT, UI-CMD-IMPORTED-OWNER-CLAIM; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CHR-043, CHR-045, NET-028, NET-017, NET-027 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"CHR-043": ["NO_FILE", "FILE_SELECTED", "PICKER_CANCELLED"], "CHR-045": ["IMPORTED_LOCAL_COPY", "PENDING_OWNER_LINK", "INCOMPATIBLE_REPORT", "NO_PARTIAL_COMMIT"], "NET-027": ["DIFF_LOADING", "READY_FOR_WHOLE_BATCH_DECISION", "ACCEPTED", "DECLINED"], "NET-028": ["PENDING_OWNER_LINK", "CLAIM_ACCEPTED", "CLAIM_DECLINED", "ADMISSION_REQUIRED"]}} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-55-0',
    current:
      '| QA-REQ-007 | REQ-007 | Требование «Создание/host/preflight/start кампании без выбора правил». Preconditions: Роль и authority соответствуют gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"CMP-001":["METADATA_INCOMPLETE","METADATA_VALID","DRAFT_CANCELLED"],"CMP-002":["HOST_CONFIG_INVALID","HOST_CONFIG_VALID","PORT_UNAVAILABLE"],"CMP-003":["PASSWORD_INCOMPLETE","PASSWORD_VALID","SECRET_HIDDEN"],"CMP-004":["MODE_UNSELECTED","MODE_VALID","OPEN_REQUESTS_UNCHANGED"],"CMP-005":["PREFLIGHT_BLOCKED","READY_TO_CREATE","CREATING","CREATED","IDEMPOTENT_REPLAY"],"CMP-006":["RECEIPT_READY","HOST_NOT_STARTED","OPENED_LOBBY","OPENED_REQUEST_QUEUE"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-55-0',
    current:
      '| QA-REQ-007 | REQ-007 | Требование «Создание/host/preflight/start кампании без выбора правил». Preconditions: Роль и authority соответствуют gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"CMP-001":["METADATA_INCOMPLETE","METADATA_VALID","DRAFT_CANCELLED"],"CMP-002":["HOST_CONFIG_INVALID","HOST_CONFIG_VALID","PORT_UNAVAILABLE"],"CMP-003":["PASSWORD_INCOMPLETE","PASSWORD_VALID","SECRET_HIDDEN"],"CMP-004":["MODE_UNSELECTED","MODE_VALID","OPEN_REQUESTS_UNCHANGED"],"CMP-005":["PREFLIGHT_BLOCKED","READY_TO_CREATE","CREATING","CREATED","IDEMPOTENT_REPLAY"],"CMP-006":["RECEIPT_READY","HOST_NOT_STARTED","OPENED_LOBBY","OPENED_REQUEST_QUEUE"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired:
      '| QA-REQ-007 | REQ-007 | Требование «Создание/host/preflight/start кампании без выбора правил». Preconditions: Роль и authority соответствуют gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-CAMPAIGN-CREATE через формы CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CAMPAIGN-CREATE; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-001, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"CMP-001": ["METADATA_INCOMPLETE", "METADATA_VALID", "DRAFT_CANCELLED"], "CMP-002": ["HOST_CONFIG_INVALID", "HOST_CONFIG_VALID", "PORT_UNAVAILABLE"], "CMP-003": ["PASSWORD_INCOMPLETE", "PASSWORD_VALID", "SECRET_HIDDEN"], "CMP-004": ["MODE_UNSELECTED", "MODE_VALID", "OPEN_REQUESTS_UNCHANGED"], "CMP-005": ["PREFLIGHT_BLOCKED", "READY_TO_CREATE", "CREATING", "CREATED", "IDEMPOTENT_REPLAY"], "CMP-006": ["RECEIPT_READY", "HOST_NOT_STARTED", "OPENED_LOBBY"]}} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-56-0',
    current:
      '| QA-REQ-010 | REQ-010 | Требование «Первоначальное заявление local player на host до player tab». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"PLY-030":["inactive","PRIVACY_HANDOFF","WAITING_FOR_LOCAL_OWNER","TARGET_CONTEXT_ACTIVE","RETURN_TO_INITIATOR","RECONNECT_RESTORED"],"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-017":["QUEUE_EMPTY","REQUEST_PENDING","IN_REVIEW","REQUEST_REJECTED","STALE_REQUEST"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-56-0',
    current:
      '| QA-REQ-010 | REQ-010 | Требование «Первоначальное заявление local player на host до player tab». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK, UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW, UI-CMD-DEVICE-REQUEST-REJECT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"PLY-030":["inactive","PRIVACY_HANDOFF","WAITING_FOR_LOCAL_OWNER","TARGET_CONTEXT_ACTIVE","RETURN_TO_INITIATOR","RECONNECT_RESTORED"],"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-017":["QUEUE_EMPTY","REQUEST_PENDING","IN_REVIEW","REQUEST_REJECTED","STALE_REQUEST"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired:
      '| QA-REQ-010 | REQ-010 | Требование «Первоначальное заявление local player на host до player tab». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-LOCAL-SEATS через формы CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-DEVICE-REQUEST-SUBMIT, UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для CMP-009, PLY-030, APP-004, NET-003, NET-004, NET-017 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "PLY-030": ["inactive", "PRIVACY_HANDOFF", "WAITING_FOR_LOCAL_OWNER", "TARGET_CONTEXT_ACTIVE", "RETURN_TO_INITIATOR", "RECONNECT_RESTORED"]}} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-57-0',
    current:
      '| QA-REQ-031 | REQ-031 | Требование «Waiting/connect/reconnect/connection-lost states». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-005":["WAITING_GM","READY_TO_CANCEL","CANCELLED","DECISION_WON_RACE","IN_REVIEW","REJECTED"],"NET-011":["UNAVAILABLE","RETRY_READY","RETRYING","EXITED_TO_LOCAL"],"NET-012":["hidden","visible"],"NET-013":["hidden","visible"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.; REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-57-0',
    current:
      '| QA-REQ-031 | REQ-031 | Требование «Waiting/connect/reconnect/connection-lost states». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"terminalStatesByForm":{"NET-004":["DRAFT_REQUEST","SUBMITTED"],"NET-005":["WAITING_GM","READY_TO_CANCEL","CANCELLED","DECISION_WON_RACE","IN_REVIEW","REJECTED"],"NET-011":["UNAVAILABLE","RETRY_READY","RETRYING","EXITED_TO_LOCAL"],"NET-012":["hidden","visible"],"NET-013":["hidden","visible"]},"mutationBoundary":"Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.","audit":"Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision."} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache.; Preliminary accept/reject and owner cancel serialize by requestRevision; exact replay keeps the original receipt while the current view may be newer; no duplicate request, campaign copy, seat or capacity reservation.; REJECTED safe-return changes only the local cursor; the owning historical request and immutable receipt survive return/reconnect, and a new submit requires a fresh explicit command. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired:
      '| QA-REQ-031 | REQ-031 | Требование «Waiting/connect/reconnect/connection-lost states». Preconditions: Роль и authority соответствуют player/gm.; Загружены current server/local stateRevision, projectionRevision и все guards перечисленных форм.; Player/effective-controller projection содержит только CTA, для которых per-action guard=true. Happy: Выполнить J-RECONNECT, J-JOIN-REVIEW через формы NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013; использовать только primaryActions каждой actionSteps-записи и команды UI-CMD-CONNECTION-OPEN, UI-CMD-DEVICE-REQUEST-CANCEL, UI-CMD-DEVICE-REQUEST-SUBMIT; проверить перечисленные terminalStatesByForm и ровно один audit/receipt на mutation boundary. Error/offline: Для NET-004, NET-005, NET-008, NET-009, NET-010, NET-011, NET-012, NET-013 проверить invalid field/failed guard, stale revision, disconnect before commit, disconnect after commit-before-ack и idempotent replay: до commit — zero write, после commit — прежний receipt без повторного эффекта. | Terminal states/deltas: {"audit": "Every committed mutation records author/target/timestamp/before/after/reason/source and resulting revision.", "mutationBoundary": "Only listed executableOperationIds/workflowCommandIds may write; all other routes are navigation/read-only.", "terminalStatesByForm": {"NET-004": ["DRAFT_REQUEST", "SUBMITTED"], "NET-005": ["WAITING_GM", "READY_TO_CANCEL", "CANCELLED", "DECISION_WON_RACE"], "NET-011": ["UNAVAILABLE", "RETRY_READY", "RETRYING", "EXITED_TO_LOCAL"], "NET-012": ["hidden", "visible"], "NET-013": ["hidden", "visible"]}} Reconnect assertions: Uncommitted local input may restore as draft but never as confirmed state.; Committed command restores by commandId with the same receipt/random result and no duplicate side effect.; Fresh server projection recomputes allowed CTA/targets and omits stale or forbidden actions from payload/DOM/a11y/hotkeys/cache. |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-58-0',
    current:
      '| QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW | UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW | Выполнить UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW только из NET-017 с собственной sole-GM authority, затем exact replay, changed payload, stale request revision, restart и проигранную гонку с cancel/другим решением. | Change exactly one request PENDING→IN_REVIEW, increment requestRevision once and append one decision receipt; do not create campaign copies, campaign seats, capacity reservations or player campaign authority; do not modify campaign checkpoint or local source sheets. Same commandId and payload return the original decision receipt; a current request view may be newer. A concurrent owner cancel or preliminary reject is serialized by requestRevision; the loser performs no write. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-58-1',
    current:
      '| QA-WORKFLOW-UI-CMD-DEVICE-REQUEST-REJECT | UI-CMD-DEVICE-REQUEST-REJECT | Выполнить UI-CMD-DEVICE-REQUEST-REJECT только из NET-017 с собственной sole-GM authority, затем exact replay, changed payload, stale request revision, restart и проигранную гонку с cancel/другим решением. | Change exactly one request PENDING\\|IN_REVIEW→REJECTED with the non-empty reason, increment requestRevision once and append one decision receipt; preserve candidate snapshot and history; no campaign copy, campaign seat, capacity or local-sheet mutation. Same commandId and payload return the original rejection receipt even if the UI has moved. A changed payload conflicts; stale requestRevision and a concurrent terminal decision perform no write. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-58-2',
    current:
      '| QA-DEVICE-REQUEST-REVIEW-CANCEL-RACE | NET-005/NET-017 | Два соединения посылают owner cancellation и accept-to-review/reject с одной requestRevision; затем повторить победителя, проигравшего и изменённый payload. Повторить reject после IN_REVIEW и cancel после IN_REVIEW. | Ровно один commit на исходной revision. PENDING→IN_REVIEW делает последующий cancel недоступным; reasoned reject из IN_REVIEW разрешён новой актуальной revision. Старый receipt неизменен; source sheets/campaign checkpoint/copies/campaign seats/capacity/player authority не изменены. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-58-3',
    current:
      '| QA-CMP-006-DEVICE-REQUEST-QUEUE | CMP-006/NET-017 | Единственный GM открывает очередь из подтверждённой CMP-006 своей PAUSED кампании, включая ноль заявок, затем возвращается. Проверить чужую campaign, player role, устаревшую authority и forged returnContext. | Только CMP-006::CTA::002 и NET-017::CTA::009 нового пути; возврат к той же creation receipt/campaign. Никакого Start, CMP-007 или изменения campaign checkpoint; запрещённые CTA отсутствуют в payload/DOM/a11y/hotkeys/cache. CANCELLED requests and their immutable receipts remain in durable history but are excluded from the current requests[] queue. If a selected request becomes CANCELLED, the next authoritative queue snapshot clears selectedRequestIdOrNull to null; replay/reconnect does not restore the removed selection. REJECTED rows remain displayable under the closed row enum. This projection update does not delete or reset any request. The PAUSED requirement belongs to the new CMP-006 ingress/return route. It does not introduce a global PAUSED-only restriction on request-level decisions or alter the guards of other NET-017 entry paths. The preliminary delivery exposes only the CMP-006 capability; other campaign phases and routes remain subject to their separately implemented source guards. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-58-4',
    current:
      '| QA-NET-005-REJECTED-RETURN | NET-005/NET-003 | После подтверждённого preliminary REJECTED владелец выбирает «Вернуться к выбору персонажей», затем reconnect/restart и replay старого reject receipt. Проверить чужое устройство, PENDING/IN_REVIEW, потерянную technical session и наличие campaign copy/admission. | Новый NET-005::CTA::003 доступен только при точном guard. Меняется только local presentation cursor. Старые request/receipt сохранены без reset/delete; source sheets и campaign checkpoint не меняются; нет автоматического submit/allocation; запрещённый CTA отсутствует в payload/DOM/a11y/hotkeys/cache. |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-59-0',
    current: '# Symbiosis V7 — Web UI Screen Atlas v1.8',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-59-0',
    current: '# Symbiosis V7 — Web UI Screen Atlas v1.8',
    retired: '# Symbiosis V7 — Web UI Screen Atlas v1.5',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-60-0',
    current: '| Версия атласа | 1.8 |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-60-0',
    current: '| Версия атласа | 1.8 |',
    retired: '| Версия атласа | 1.5 |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-61-0',
    current: '| Дата | 2026-11-02 |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-61-0',
    current: '| Дата | 2026-11-02 |',
    retired: '| Дата | 2026-10-26 |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-62-0',
    current: '| Переходы | 1698 |',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-62-0',
    current: '| Переходы | 1698 |',
    retired: '| Переходы | 1681 |',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-63-0',
    current:
      'Итог: **376 форм, 1698 переходов, 66 journeys, 91 требований, 111 workflow-команд и 2448 QA-сценариев; открытых UX-вопросов нет.**',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-63-0',
    current:
      'Итог: **376 форм, 1698 переходов, 66 journeys, 91 требований, 111 workflow-команд и 2448 QA-сценариев; открытых UX-вопросов нет.**',
    retired:
      'Итог: **376 форм, 1681 переходов, 66 journeys, 91 требований; открытых UX-вопросов нет.**',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-64-0',
    current:
      'All 2448 QA scenario IDs are unique; referenced QA IDs resolve to behavior-specific scenarios.',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: false,
  },
  {
    id: 'request-review-retired-64-0',
    current:
      'All 2448 QA scenario IDs are unique; referenced QA IDs resolve to behavior-specific scenarios.',
    retired: 'All 2391 referenced QA IDs resolve to unique behavior-specific scenarios.',
    expected: 1,
    section: ['', ''],
    wholeLine: false,
  },
  {
    id: 'request-review-65-0',
    current:
      '> Нормативный человекочитаемый атлас локального web-приложения. Поля `graphDigest` и `contentDigest` сохраняют идентичность author-supplied base-v1.2 по ADR 0037/0049: алгоритмы semantic digest не поставлены. Целостность текущих JSON/Markdown байтов проверяется по `artifacts/CHECKSUMS.sha256`. Старый PDF не нужен для реализации; его страницы приведены только для трассировки.',
    retired: '',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
  {
    id: 'request-review-retired-65-0',
    current:
      '> Нормативный человекочитаемый атлас локального web-приложения. Поля `graphDigest` и `contentDigest` сохраняют идентичность author-supplied base-v1.2 по ADR 0037/0049: алгоритмы semantic digest не поставлены. Целостность текущих JSON/Markdown байтов проверяется по `artifacts/CHECKSUMS.sha256`. Старый PDF не нужен для реализации; его страницы приведены только для трассировки.',
    retired:
      '> Нормативный человекочитаемый атлас локального web-приложения. JSON-файл с тем же графом имеет указанный ниже `graphDigest`. Старый PDF не нужен для реализации; его страницы приведены только для трассировки.',
    expected: 1,
    section: ['', ''],
    wholeLine: true,
  },
] as const;

interface MarkdownAdrLiteral {
  readonly id: string;
  readonly current: string;
  readonly retired: string;
  readonly expected: number;
  readonly section: readonly [string, string];
}

function validateAtlasMarkdownTextMirrors(
  markdown: string,
  literals: readonly MarkdownAdrLiteral[],
  adr: 'ADR 0049' | 'ADR 0052',
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];

  for (const literal of literals) {
    const source = markdownAdrSource(markdown, literal.section);
    if (source === '') {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message: `${adr} Markdown section ${JSON.stringify(literal.section)} is missing`,
      });
      continue;
    }

    if (literal.retired !== '') {
      const retiredCount = countLiteral(source, literal.retired);
      if (retiredCount !== 0) {
        problems.push({
          file: ATLAS_MARKDOWN_FILE,
          id: literal.id,
          message: `retired ${adr} literal count is ${String(retiredCount)}, expected 0`,
        });
      }
    }

    const currentCount = countLiteral(source, literal.current);
    if (currentCount !== literal.expected) {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message:
          `current ${adr} literal count is ${String(currentCount)}, ` +
          `expected ${String(literal.expected)}`,
      });
    }
  }

  return problems;
}

/** ADR 0049 and ADR 0052 use finite companion registries, not a Markdown parser. */
export function validateAtlasMarkdownAdr0049TextMirrors(
  markdown: string,
): readonly AtlasValidationProblem[] {
  return validateAtlasMarkdownTextMirrors(markdown, ATLAS_MARKDOWN_ADR0049_LITERALS, 'ADR 0049');
}

export function validateAtlasMarkdownAdr0052TextMirrors(
  markdown: string,
): readonly AtlasValidationProblem[] {
  return validateAtlasMarkdownTextMirrors(markdown, ATLAS_MARKDOWN_ADR0052_LITERALS, 'ADR 0052');
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

export function validateAtlasMarkdownAdr0069TextMirrors(
  markdown: string,
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  // Each call verifies its input afresh. Scoped source and full-line counts are
  // shared only within this call, because several mirrors use the same section.
  const sources = new Map<string, string>();
  const lineCounts = new Map<string, ReadonlyMap<string, number>>();
  for (const literal of ATLAS_MARKDOWN_ADR0069_LITERALS) {
    const key = JSON.stringify(literal.section);
    let source = sources.get(key);
    if (source === undefined) {
      source = markdownAdrSource(markdown, literal.section);
      sources.set(key, source);
    }
    if (source === '') {
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message: 'ADR 0069 Markdown section ' + key + ' is missing',
      });
      continue;
    }
    let lines = lineCounts.get(key);
    if (literal.wholeLine && lines === undefined) {
      const counts = new Map<string, number>();
      for (const line of source.split(/\r?\n/u)) counts.set(line, (counts.get(line) ?? 0) + 1);
      lines = counts;
      lineCounts.set(key, lines);
    }
    const count = (text: string): number =>
      literal.wholeLine ? (lines?.get(text) ?? 0) : countLiteral(source, text);
    const currentCount = count(literal.current);
    if (currentCount !== literal.expected)
      problems.push({
        file: ATLAS_MARKDOWN_FILE,
        id: literal.id,
        message:
          'current ADR 0069 literal count is ' +
          String(currentCount) +
          ', expected ' +
          String(literal.expected),
      });
    if (literal.retired !== '') {
      const retiredCount = count(literal.retired);
      if (retiredCount !== 0)
        problems.push({
          file: ATLAS_MARKDOWN_FILE,
          id: literal.id,
          message: 'retired ADR 0069 literal count is ' + String(retiredCount) + ', expected 0',
        });
    }
  }
  return problems;
}
