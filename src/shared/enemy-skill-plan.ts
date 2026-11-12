import type { EnemyBuild, EnemyStats } from './enemy-authoring.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';

export interface EnemyInitialSkillInput {
  readonly baseStats: EnemyStats;
  readonly build: EnemyBuild;
}
/** Actual payments, never a retrospective price calculated from the current bonus. */
export interface EnemyPaidSkill {
  readonly skillKey: string;
  readonly bonus: number;
  readonly source:
    'SELECTED' | 'RACE_GRANTED' | 'CLASS_MANDATORY' | 'SYMBIONT_SELECTED' | 'SYMBIONT_GRANTED';
  readonly startSlots: number;
  readonly dolphinSlots: number;
}
export interface EnemyPermanentSkillLoss {
  readonly skillKey: string;
  readonly commandId: string;
  readonly bonusBefore: number;
  readonly releasedStartSlots: number;
  readonly releasedDolphinSlots: number;
}
export interface EnemySkillAccounting {
  readonly schemaVersion: 1;
  readonly resolvedAtCommandId: string;
  readonly knownSkills: readonly EnemyPaidSkill[];
  readonly permanentLosses: readonly EnemyPermanentSkillLoss[];
  readonly grossGrantOrNull: Readonly<{
    commandId: string;
    bonusBefore: number;
    bonusAfter: number;
  }> | null;
}
/** ADR0092: this technical plan is absent in delivered legacy attempts and V1. */
export interface EnemyInitialSkillPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly revision: number;
  readonly initialInput: EnemyInitialSkillInput;
  readonly initialStartCapacity: number;
  readonly initialSkills: readonly EnemyPaidSkill[];
  readonly accountingOrNull: EnemySkillAccounting | null;
}
export interface EnemySkillRebuildPreview {
  readonly schemaVersion: 1;
  readonly previewCommandId: string;
  readonly attemptId: string;
  readonly sourceAttemptRevision: number;
  readonly planIdOrNull: string | null;
  readonly planRevision: number;
  readonly initialInput: EnemyInitialSkillInput;
  readonly consequences: Readonly<{
    abandonedSkills: readonly EnemyPaidSkill[];
    invalidateComposition: boolean;
    invalidateInventory: boolean;
    invalidateOwnAdvisorChoices: boolean;
    retainedRollReceiptIds: readonly string[];
  }>;
}
export type EnemyBuildPlanPatch =
  | Readonly<{ operation: 'DISCARD_REBUILD'; previewCommandId: string }>
  | Readonly<{ operation: 'INITIALIZE'; initialInput: EnemyInitialSkillInput }>
  | Readonly<{ operation: 'SAVE_IDENTICAL'; initialInput: EnemyInitialSkillInput }>
  | Readonly<{
      operation: 'PREVIEW_REBUILD';
      initialInput: EnemyInitialSkillInput;
      expectedPlanRevision: number;
    }>
  | Readonly<{
      operation: 'CONFIRM_REBUILD';
      previewCommandId: string;
      expectedPlanRevision: number;
      initialInput: EnemyInitialSkillInput;
      displayedConsequences: EnemySkillRebuildPreview['consequences'];
    }>;
export interface EnemyAdvisorKnowledge {
  readonly cardId: string;
  readonly initialFillCommandId: string;
  readonly resolvedAtCommandId: string;
  readonly initialSkills: readonly EnemyPaidSkill[];
  readonly knownSkills: readonly EnemyPaidSkill[];
  readonly permanentLosses: readonly EnemyPermanentSkillLoss[];
}
export interface EnemySkillPlanState {
  readonly schemaVersion: 1;
  readonly planOrNull: EnemyInitialSkillPlan | null;
  readonly rebuildPreviewOrNull: EnemySkillRebuildPreview | null;
  readonly pendingChoicesOrNull: Readonly<{
    commandId: string;
    compositionPreviewCommandId: string;
    advisorSkills: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
    dolphinSkills: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
  }> | null;
  readonly advisorKnowledge: readonly EnemyAdvisorKnowledge[];
  readonly advisorInitialFillHistory: readonly Readonly<{
    cardId: string;
    planId: string;
    commandId: string;
    skills: readonly EnemyPaidSkill[];
  }>[];
}
export const emptyEnemySkillPlanState = (): EnemySkillPlanState => ({
  schemaVersion: 1,
  planOrNull: null,
  rebuildPreviewOrNull: null,
  pendingChoicesOrNull: null,
  advisorKnowledge: [],
  advisorInitialFillHistory: [],
});

export function enemyInitialSkillInputValue(value: unknown): EnemyInitialSkillInput {
  const row = r.exact(value, 'baseStats build', '$.initialInput');
  const stats = r.exact(row['baseStats'], 'S D M Z I W C', '$.baseStats');
  for (const key of Object.keys(stats)) {
    if (r.integer(stats[key], '$.baseStats.' + key, 1) > 35)
      r.invalid('$.baseStats.' + key, 'base integer 1..35', null);
  }
  const build = r.exact(row['build'], 'raceCode pureClassOrNull skillSelections', '$.build');
  r.oneOf(build['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.raceCode');
  if (build['pureClassOrNull'] !== null)
    r.oneOf(build['pureClassOrNull'], ['SEEKER', 'STALKER', 'SOLDIER'], '$.pureClass');
  const selected = r.list(build['skillSelections'], '$.skillSelections');
  for (const raw of selected) {
    const skill = r.exact(raw, 'skillKey targetBonus', '$.selection');
    r.text(skill['skillKey'], '$.skillKey');
    r.integer(skill['targetBonus'], '$.targetBonus', 1);
  }
  if (
    new Set(selected.map((skill) => r.record(skill, '$.skill')['skillKey'])).size !==
    selected.length
  )
    r.invalid('$.skillSelections', 'distinct initial choices', null);
  return w.validated(row);
}
function paidSkills(value: unknown): readonly EnemyPaidSkill[] {
  const rows = r.list(value, '$.paidSkills');
  for (const raw of rows) {
    const row = r.exact(raw, 'skillKey bonus source startSlots dolphinSlots', '$.paidSkill');
    r.text(row['skillKey'], '$.skillKey');
    r.integer(row['bonus'], '$.bonus', 1);
    r.oneOf(
      row['source'],
      ['SELECTED', 'RACE_GRANTED', 'CLASS_MANDATORY', 'SYMBIONT_SELECTED', 'SYMBIONT_GRANTED'],
      '$.source',
    );
    r.integer(row['startSlots'], '$.startSlots', 0);
    r.integer(row['dolphinSlots'], '$.dolphinSlots', 0);
  }
  if (new Set(rows.map((skill) => r.record(skill, '$.skill')['skillKey'])).size !== rows.length)
    r.invalid('$.paidSkills', 'distinct known skills', null);
  return w.validated(rows);
}
function losses(value: unknown): void {
  for (const raw of r.list(value, '$.permanentLosses')) {
    const loss = r.exact(
      raw,
      'skillKey commandId bonusBefore releasedStartSlots releasedDolphinSlots',
      '$.loss',
    );
    r.text(loss['skillKey'], '$.skillKey');
    r.uuid(loss['commandId'], '$.commandId');
    r.integer(loss['bonusBefore'], '$.bonusBefore', 1);
    r.integer(loss['releasedStartSlots'], '$.releasedStartSlots', 0);
    r.integer(loss['releasedDolphinSlots'], '$.releasedDolphinSlots', 0);
  }
}
export function enemySkillAccountingValue(value: unknown): EnemySkillAccounting {
  const row = r.exact(
    value,
    'schemaVersion resolvedAtCommandId knownSkills permanentLosses grossGrantOrNull',
    '$.skillAccounting',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  r.uuid(row['resolvedAtCommandId'], '$.resolvedAtCommandId');
  paidSkills(row['knownSkills']);
  losses(row['permanentLosses']);
  if (row['grossGrantOrNull'] !== null) {
    const grant = r.exact(
      row['grossGrantOrNull'],
      'commandId bonusBefore bonusAfter',
      '$.grossGrant',
    );
    r.uuid(grant['commandId'], '$.commandId');
    const before = r.integer(grant['bonusBefore'], '$.bonusBefore', 0);
    if (grant['bonusAfter'] !== (before === 0 ? 3 : before >= 5 ? before : Math.min(5, before + 3)))
      r.invalid('$.grossGrant', 'one source SYM079 grant', null);
  }
  return w.validated(row);
}
function consequences(value: unknown): void {
  const row = r.exact(
    value,
    'abandonedSkills invalidateComposition invalidateInventory invalidateOwnAdvisorChoices retainedRollReceiptIds',
    '$.consequences',
  );
  paidSkills(row['abandonedSkills']);
  for (const key of ['invalidateComposition', 'invalidateInventory', 'invalidateOwnAdvisorChoices'])
    if (typeof row[key] !== 'boolean') r.invalid('$.' + key, 'boolean', null);
  const receipts = r.list(row['retainedRollReceiptIds'], '$.retainedRollReceiptIds');
  receipts.forEach((id) => r.text(id, '$.rollReceiptId'));
  if (new Set(receipts).size !== receipts.length)
    r.invalid('$.retainedRollReceiptIds', 'distinct receipts', null);
}
export function enemySkillRebuildPreviewValue(value: unknown): EnemySkillRebuildPreview {
  const row = r.exact(
    value,
    'schemaVersion previewCommandId attemptId sourceAttemptRevision planIdOrNull planRevision initialInput consequences',
    '$.rebuildPreview',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  r.uuid(row['previewCommandId'], '$.previewCommandId');
  r.uuid(row['attemptId'], '$.attemptId');
  r.integer(row['sourceAttemptRevision'], '$.sourceAttemptRevision', 0);
  if (row['planIdOrNull'] !== null) r.uuid(row['planIdOrNull'], '$.planIdOrNull');
  r.integer(row['planRevision'], '$.planRevision', 0);
  enemyInitialSkillInputValue(row['initialInput']);
  consequences(row['consequences']);
  return w.validated(row);
}
export function enemyBuildPlanPatchValue(value: unknown): EnemyBuildPlanPatch {
  const raw = r.record(value, '$.buildPatch');
  const operation = r.oneOf(
    raw['operation'],
    ['INITIALIZE', 'SAVE_IDENTICAL', 'PREVIEW_REBUILD', 'CONFIRM_REBUILD', 'DISCARD_REBUILD'],
    '$.operation',
  );
  if (operation === 'DISCARD_REBUILD') {
    const row = r.exact(raw, 'operation previewCommandId', '$.buildPatch');
    r.uuid(row['previewCommandId'], '$.previewCommandId');
    return w.validated(row);
  }
  const row = r.exact(
    raw,
    'operation initialInput' +
      (operation === 'PREVIEW_REBUILD' || operation === 'CONFIRM_REBUILD'
        ? ' expectedPlanRevision'
        : '') +
      (operation === 'CONFIRM_REBUILD' ? ' previewCommandId displayedConsequences' : ''),
    '$.buildPatch',
  );
  enemyInitialSkillInputValue(row['initialInput']);
  if (operation === 'PREVIEW_REBUILD' || operation === 'CONFIRM_REBUILD')
    r.integer(row['expectedPlanRevision'], '$.expectedPlanRevision', 0);
  if (operation === 'CONFIRM_REBUILD') {
    r.uuid(row['previewCommandId'], '$.previewCommandId');
    consequences(row['displayedConsequences']);
  }
  return w.validated(row);
}
export function enemySkillPlanStateValue(value: unknown): EnemySkillPlanState {
  const row = r.exact(
    value,
    'schemaVersion planOrNull rebuildPreviewOrNull pendingChoicesOrNull advisorKnowledge advisorInitialFillHistory',
    '$.skillPlanState',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  const plan = row['planOrNull'] === null ? null : enemyInitialSkillPlanValue(row['planOrNull']);
  if (row['rebuildPreviewOrNull'] !== null) {
    const preview = enemySkillRebuildPreviewValue(row['rebuildPreviewOrNull']);
    if (
      preview.planIdOrNull !== (plan?.planId ?? null) ||
      preview.planRevision !== (plan?.revision ?? 0)
    )
      r.invalid('$.rebuildPreview', 'own current plan', null);
    if (
      plan !== null &&
      !admissionJsonEqual(
        preview.consequences.abandonedSkills,
        plan.accountingOrNull?.knownSkills ?? plan.initialSkills,
      )
    )
      r.invalid('$.rebuildPreview.consequences', 'actual abandoned current-plan payments', null);
  }
  if (row['pendingChoicesOrNull'] !== null) {
    const pending = r.exact(
      row['pendingChoicesOrNull'],
      'commandId compositionPreviewCommandId advisorSkills dolphinSkills',
      '$.pendingChoices',
    );
    r.uuid(pending['commandId'], '$.commandId');
    r.uuid(pending['compositionPreviewCommandId'], '$.compositionPreviewCommandId');
    for (const key of ['advisorSkills', 'dolphinSkills']) {
      const rows = r.list(pending[key], '$.' + key);
      for (const raw of rows) {
        const choice = r.exact(raw, 'skillKey targetBonus', '$.choice');
        r.text(choice['skillKey'], '$.skillKey');
        r.integer(choice['targetBonus'], '$.targetBonus', 1);
      }
      if (new Set(rows.map((raw) => r.record(raw, '$.choice')['skillKey'])).size !== rows.length)
        r.invalid('$.' + key, 'distinct choices', null);
    }
  }
  const knowledge = r.list(row['advisorKnowledge'], '$.advisorKnowledge');
  for (const raw of knowledge) {
    const card = r.exact(
      raw,
      'cardId initialFillCommandId resolvedAtCommandId initialSkills knownSkills permanentLosses',
      '$.advisorKnowledge',
    );
    for (const key of ['cardId', 'initialFillCommandId', 'resolvedAtCommandId'])
      r.uuid(card[key], '$.' + key);
    for (const key of ['initialSkills', 'knownSkills']) {
      if (paidSkills(card[key]).some((skill) => skill.dolphinSlots !== 0))
        r.invalid('$.advisorKnowledge', 'own-card payments only', null);
    }
    losses(card['permanentLosses']);
  }
  if (new Set(knowledge.map((raw) => r.record(raw, '$.card')['cardId'])).size !== knowledge.length)
    r.invalid('$.advisorKnowledge', 'distinct cards', null);
  const fillKeys = new Set<string>();
  for (const raw of r.list(row['advisorInitialFillHistory'], '$.advisorInitialFillHistory')) {
    const fill = r.exact(raw, 'cardId planId commandId skills', '$.initialFill');
    for (const key of ['cardId', 'planId', 'commandId']) r.uuid(fill[key], '$.' + key);
    paidSkills(fill['skills']);
    const key = String(fill['planId']) + '/' + String(fill['cardId']);
    if (fillKeys.has(key))
      r.invalid('$.initialFillHistory', 'one initial fill per actual card and plan', null);
    fillKeys.add(key);
  }
  for (const raw of knowledge) {
    const card = r.record(raw, '$.card');
    const fill = r.list(row['advisorInitialFillHistory'], '$.fills').find((raw) => {
      const fill = r.record(raw, '$.fill');
      return fill['cardId'] === card['cardId'] && fill['planId'] === plan?.planId;
    });
    if (
      fill === undefined ||
      r.record(fill, '$.fill')['commandId'] !== card['initialFillCommandId'] ||
      !admissionJsonEqual(r.record(fill, '$.fill')['skills'], card['initialSkills'])
    )
      r.invalid('$.advisorKnowledge', 'own immutable initial fill', null);
  }
  if (plan === null && (knowledge.length !== 0 || row['pendingChoicesOrNull'] !== null))
    r.invalid('$.skillPlanState', 'choices require an initial plan', null);
  return w.validated(row);
}
/** Every rendered lookup is closed against the actual confirmed catalogue before React reads it. */
export function enemySkillPlanCatalogBindings(
  state: EnemySkillPlanState,
  catalogValue: unknown,
): void {
  const catalog = r.list(catalogValue, '$.skills').map((raw) => r.record(raw, '$.skill'));
  const known = (key: string): void => {
    if (!catalog.some((row) => row['skillKey'] === key))
      r.invalid('$.skillPlan.skillKey', 'actual catalogue skill', null);
  };
  const plan = state.planOrNull;
  if (plan !== null) {
    plan.initialInput.build.skillSelections.forEach((row) => known(row.skillKey));
    plan.initialSkills.forEach((row) => known(row.skillKey));
    plan.accountingOrNull?.knownSkills.forEach((row) => known(row.skillKey));
    plan.accountingOrNull?.permanentLosses.forEach((row) => known(row.skillKey));
  }
  state.rebuildPreviewOrNull?.initialInput.build.skillSelections.forEach((row) =>
    known(row.skillKey),
  );
  state.rebuildPreviewOrNull?.consequences.abandonedSkills.forEach((row) => known(row.skillKey));
  state.pendingChoicesOrNull?.advisorSkills.forEach((row) => known(row.skillKey));
  state.pendingChoicesOrNull?.dolphinSkills.forEach((row) => known(row.skillKey));
  for (const card of state.advisorKnowledge) {
    card.initialSkills.forEach((row) => known(row.skillKey));
    card.knownSkills.forEach((row) => known(row.skillKey));
    card.permanentLosses.forEach((row) => known(row.skillKey));
  }
  state.advisorInitialFillHistory.forEach((fill) =>
    fill.skills.forEach((row) => known(row.skillKey)),
  );
}
export function enemyInitialSkillPlanValue(value: unknown): EnemyInitialSkillPlan {
  const row = r.exact(
    value,
    'schemaVersion planId revision initialInput initialStartCapacity initialSkills accountingOrNull',
    '$.skillPlan',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  r.uuid(row['planId'], '$.planId');
  r.integer(row['revision'], '$.revision', 1);
  enemyInitialSkillInputValue(row['initialInput']);
  const capacity = r.integer(row['initialStartCapacity'], '$.initialStartCapacity', 1);
  const initial = paidSkills(row['initialSkills']);
  if (
    initial.some((skill) => skill.dolphinSlots !== 0) ||
    initial.reduce((sum, skill) => sum + skill.startSlots, 0) !== capacity
  )
    r.invalid('$.initialSkills', 'exact initial START payments', null);
  if (row['accountingOrNull'] !== null) enemySkillAccountingValue(row['accountingOrNull']);
  return w.validated(row);
}
