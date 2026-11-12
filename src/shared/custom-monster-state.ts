import type { EnemyWorkflowRequest, EnemyStats } from './enemy-authoring.js';
import {
  enemySymbiontChoiceValue,
  type EnemyCompositionRoll,
  type EnemySymbiontChoice,
} from './enemy-composition.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import {
  type CUSTOM_MONSTER_PLACEHOLDER,
  type CustomMonsterIdentity,
  type CustomMonsterStatsInput,
  type CustomMonsterPhysics,
  type CustomMonsterAttack,
  type CustomMonsterSymbiontSelection,
  customMonsterIdentityValue,
  customMonsterStatsValue,
  customMonsterPhysicsValue,
  customMonsterAttackValue,
  customMonsterSymbiontSelectionValue,
} from './custom-monster.js';

export interface MonsterAdvisorSkill {
  readonly skillKey: string;
  readonly targetBonus: number;
}
export interface MonsterAdvisorCard {
  readonly cardId: string;
  readonly symbiontInstanceId: string;
  readonly iwRolls: readonly [EnemyCompositionRoll, EnemyCompositionRoll];
  readonly confirmedChoice: EnemySymbiontChoice;
  readonly initialSkillsOrNull: readonly MonsterAdvisorSkill[] | null;
  readonly knownSkills: readonly MonsterAdvisorSkill[];
  readonly permanentLosses: readonly Readonly<{ skillKey: string; commandId: string }>[];
}
export interface CustomMonsterComposition {
  readonly selection: CustomMonsterSymbiontSelection;
  readonly phase: 'PREVIEW' | 'ACQUIRED' | 'CONFIRMED';
  readonly previewCommandId: string;
  readonly confirmationCommandIdOrNull: string | null;
  readonly symbiontInstanceIdOrNull: string | null;
  readonly advisorCardIdOrNull: string | null;
}
/** No optional legacy fields or SENTIENT accounting can enter this kind's durable input. */
export interface CustomMonsterAttempt {
  readonly schemaVersion: 1;
  readonly kind: 'CUSTOM_MONSTER';
  readonly attemptId: string;
  readonly campaignId: string;
  readonly revision: number;
  readonly identityOrNull: CustomMonsterIdentity | null;
  readonly statsOrNull: CustomMonsterStatsInput | null;
  readonly physicsOrNull: CustomMonsterPhysics | null;
  readonly attackOrNull: CustomMonsterAttack | null;
  readonly compositionOrNull: CustomMonsterComposition | null;
  readonly advisorCards: readonly MonsterAdvisorCard[];
  readonly activeAdvisorCardIdOrNull: string | null;
}
export interface CustomMonsterVersionIdentity {
  readonly campaignId: string;
  readonly templateId: string;
  readonly versionId: string;
  readonly version: 1;
  readonly kind: 'CUSTOM_MONSTER';
  readonly artAssetKey: typeof CUSTOM_MONSTER_PLACEHOLDER;
  readonly artSha256: string;
}
export type CustomMonsterCompositionPatch =
  | Readonly<{ operation: 'PREVIEW'; selection: CustomMonsterSymbiontSelection }>
  | Readonly<{
      operation: 'CONFIRM';
      previewCommandId: string;
      manualFacesOrNull: readonly number[] | null;
    }>
  | Readonly<{
      operation: 'FINISH';
      previewCommandId: string;
      advisorSkills: readonly MonsterAdvisorSkill[];
    }>;
export interface PreparedCustomMonsterComposition {
  readonly composition: CustomMonsterComposition;
  readonly advisorCards: readonly MonsterAdvisorCard[];
  readonly activeAdvisorCardIdOrNull: string | null;
}
export type PreparedMonsterKnowledge = Pick<
  CustomMonsterAttempt,
  'advisorCards' | 'activeAdvisorCardIdOrNull'
>;
export interface CustomMonsterSheet {
  readonly kind: 'CUSTOM_MONSTER';
  readonly identity: CustomMonsterIdentity;
  readonly stats: CustomMonsterStatsInput;
  readonly physics: CustomMonsterPhysics;
  readonly attack: CustomMonsterAttack;
  readonly permanentStats: EnemyStats;
  readonly effectiveMaxHP: number;
  readonly currentHP: number;
  readonly alive: true;
  readonly conscious: true;
  readonly symbiontOrNull: Readonly<{
    symbiontInstanceId: string;
    speciesKey: string;
    speciesName: string;
    effectiveLevel: number;
    levelProfileId: string;
    learnedNodeRefs: readonly string[];
    nativeMaxOE: number;
    currentOE: number;
    binding: EnemySymbiontChoice['binding'];
    functionalInterfaceOnly: true;
  }> | null;
  readonly ruleFacts: readonly Readonly<{
    nodeRef: string;
    ruleId: string;
    name: string;
    status: 'Активно' | 'Не автоматизируется';
    algorithm: string;
    hostSkillResultDropped: boolean;
  }>[];
  readonly advisorOrNull: Readonly<{
    cardId: string;
    I: number;
    W: number;
    capacity: number;
    skills: readonly Readonly<{
      skillKey: string;
      name: string;
      bonus: number;
      slotCost: number;
    }>[];
  }> | null;
  readonly progressionPolicy: 'NO_XP_PROGRESSION';
  readonly artAssetKey: typeof CUSTOM_MONSTER_PLACEHOLDER;
}

function skillList(value: unknown): void {
  const keys = new Set<string>();
  for (const entry of r.list(value, '$.advisorSkills')) {
    const row = r.exact(entry, 'skillKey targetBonus', '$.advisorSkill');
    const key = r.text(row['skillKey'], '$.skillKey');
    if (keys.has(key)) r.invalid('$.advisorSkills', 'distinct skills', null);
    keys.add(key);
    r.integer(row['targetBonus'], '$.targetBonus', 1);
  }
}
function roll(value: unknown): void {
  const row = r.exact(
    value,
    'factId rollRequestId rollReceiptId originatingCommandId modeSnapshot mechanical',
    '$.monsterRoll',
  );
  for (const key of ['factId', 'rollRequestId', 'rollReceiptId']) r.text(row[key], '$.' + key);
  r.uuid(row['originatingCommandId'], '$.originatingCommandId');
  r.oneOf(row['modeSnapshot'], ['AUTO', 'MANUAL'], '$.modeSnapshot');
  const mechanical = r.exact(row['mechanical'], 'dieSides rawFace', '$.mechanical');
  w.literal(mechanical['dieSides'], 20, '$.dieSides');
  if (r.integer(mechanical['rawFace'], '$.rawFace', 1) > 20)
    r.invalid('$.rawFace', 'R20 range', null);
}
export function monsterAdvisorCardsValue(value: unknown): readonly MonsterAdvisorCard[] {
  const cards = r.list(value, '$.advisorCards');
  // One optional ordinary instance can own one actual Adviser card; reselecting it reuses that card.
  if (cards.length > 1) r.invalid('$.advisorCards', 'at most one actual card', null);
  for (const value of cards) {
    const row = r.exact(
      value,
      'cardId symbiontInstanceId iwRolls confirmedChoice initialSkillsOrNull knownSkills permanentLosses',
      '$.advisorCard',
    );
    r.uuid(row['cardId'], '$.cardId');
    r.uuid(row['symbiontInstanceId'], '$.symbiontInstanceId');
    const iw = r.list(row['iwRolls'], '$.iwRolls');
    if (iw.length !== 2) r.invalid('$.iwRolls', 'exact I then W', null);
    iw.forEach(roll);
    const confirmedChoice = enemySymbiontChoiceValue(row['confirmedChoice']);
    w.literal(confirmedChoice.speciesKey, 'ADVISER', '$.confirmedChoice.speciesKey');
    if (row['initialSkillsOrNull'] !== null) skillList(row['initialSkillsOrNull']);
    skillList(row['knownSkills']);
    for (const raw of r.list(row['permanentLosses'], '$.permanentLosses')) {
      const loss = r.exact(raw, 'skillKey commandId', '$.loss');
      r.text(loss['skillKey'], '$.skillKey');
      r.uuid(loss['commandId'], '$.commandId');
    }
    if (
      row['initialSkillsOrNull'] === null &&
      (r.list(row['knownSkills'], '$.knownSkills').length !== 0 ||
        r.list(row['permanentLosses'], '$.permanentLosses').length !== 0)
    )
      r.invalid('$.advisorCard', 'no knowledge before actual initial fill', null);
  }
  return w.validated(structuredClone(cards));
}
export function customMonsterCompositionValue(value: unknown): CustomMonsterComposition {
  const row = r.exact(
    value,
    'selection phase previewCommandId confirmationCommandIdOrNull symbiontInstanceIdOrNull advisorCardIdOrNull',
    '$.monsterComposition',
  );
  const selection = customMonsterSymbiontSelectionValue(row['selection']);
  r.oneOf(row['phase'], ['PREVIEW', 'ACQUIRED', 'CONFIRMED'], '$.phase');
  r.uuid(row['previewCommandId'], '$.previewCommandId');
  for (const key of [
    'confirmationCommandIdOrNull',
    'symbiontInstanceIdOrNull',
    'advisorCardIdOrNull',
  ])
    if (row[key] !== null) r.uuid(row[key], '$.' + key);
  if ((selection.mode === 'NONE') !== (row['symbiontInstanceIdOrNull'] === null))
    r.invalid('$.symbiontInstanceId', 'actual selection identity', null);
  if ((row['phase'] === 'PREVIEW') !== (row['confirmationCommandIdOrNull'] === null))
    r.invalid('$.confirmation', 'phase bound command', null);
  if (
    (selection.mode === 'NONE' || selection.symbiont.speciesKey !== 'ADVISER') &&
    row['advisorCardIdOrNull'] !== null
  )
    r.invalid('$.advisorCardId', 'actual Adviser selection', null);
  return w.validated(structuredClone(row));
}
export function customMonsterCompositionPatchValue(value: unknown): CustomMonsterCompositionPatch {
  const raw = r.record(value, '$.monsterPatch');
  if (raw['operation'] === 'PREVIEW') {
    const row = r.exact(raw, 'operation selection', '$.monsterPatch');
    customMonsterSymbiontSelectionValue(row['selection']);
  } else {
    const confirm = raw['operation'] === 'CONFIRM';
    r.exact(
      raw,
      confirm
        ? 'operation previewCommandId manualFacesOrNull'
        : 'operation previewCommandId advisorSkills',
      '$.monsterPatch',
    );
    r.oneOf(raw['operation'], ['CONFIRM', 'FINISH'], '$.operation');
    r.uuid(raw['previewCommandId'], '$.previewCommandId');
    if (confirm && raw['manualFacesOrNull'] !== null)
      for (const face of r.list(raw['manualFacesOrNull'], '$.manualFaces'))
        if (r.integer(face, '$.manualFace', 1) > 20) r.invalid('$.manualFace', 'R20 range', null);
    if (!confirm) skillList(raw['advisorSkills']);
  }
  return w.validated(structuredClone(raw));
}
export function customMonsterAttemptValue(value: unknown): CustomMonsterAttempt {
  const row = r.exact(
    value,
    'schemaVersion kind attemptId campaignId revision identityOrNull statsOrNull physicsOrNull attackOrNull compositionOrNull advisorCards activeAdvisorCardIdOrNull',
    '$.monsterAttempt',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  w.literal(row['kind'], 'CUSTOM_MONSTER', '$.kind');
  r.uuid(row['attemptId'], '$.attemptId');
  r.uuid(row['campaignId'], '$.campaignId');
  r.integer(row['revision'], '$.revision', 0);
  if (row['identityOrNull'] !== null) customMonsterIdentityValue(row['identityOrNull']);
  if (row['statsOrNull'] !== null) customMonsterStatsValue(row['statsOrNull']);
  if (row['physicsOrNull'] !== null) customMonsterPhysicsValue(row['physicsOrNull']);
  if (row['attackOrNull'] !== null) customMonsterAttackValue(row['attackOrNull']);
  const cards = monsterAdvisorCardsValue(row['advisorCards']);
  if (
    row['activeAdvisorCardIdOrNull'] !== null &&
    !cards.some((card) => card.cardId === row['activeAdvisorCardIdOrNull'])
  )
    r.invalid('$.activeAdvisorCardIdOrNull', 'actual owned card', null);
  if (row['compositionOrNull'] !== null) {
    const composition = customMonsterCompositionValue(row['compositionOrNull']);
    if (
      composition.advisorCardIdOrNull !== null &&
      !cards.some(
        (card) =>
          card.cardId === composition.advisorCardIdOrNull &&
          card.symbiontInstanceId === composition.symbiontInstanceIdOrNull,
      )
    )
      r.invalid('$.advisorCardId', 'owned acquired card', null);
    if (
      composition.phase !== 'PREVIEW' &&
      row['activeAdvisorCardIdOrNull'] !== composition.advisorCardIdOrNull
    )
      r.invalid('$.activeAdvisorCardIdOrNull', 'last actually accepted composition', null);
  }
  return w.validated(structuredClone(row));
}
export function newCustomMonsterAttempt(
  attemptId: string,
  campaignId: string,
): CustomMonsterAttempt {
  return customMonsterAttemptValue({
    schemaVersion: 1,
    kind: 'CUSTOM_MONSTER',
    attemptId,
    campaignId,
    revision: 0,
    identityOrNull: null,
    statsOrNull: null,
    physicsOrNull: null,
    attackOrNull: null,
    compositionOrNull: null,
    advisorCards: [],
    activeAdvisorCardIdOrNull: null,
  });
}
export function preparedCustomMonsterCompositionValue(
  value: unknown,
): PreparedCustomMonsterComposition {
  const row = r.exact(
    value,
    'composition advisorCards activeAdvisorCardIdOrNull',
    '$.preparedMonsterComposition',
  );
  customMonsterCompositionValue(row['composition']);
  monsterAdvisorCardsValue(row['advisorCards']);
  preparedMonsterKnowledgeValue({
    advisorCards: row['advisorCards'],
    activeAdvisorCardIdOrNull: row['activeAdvisorCardIdOrNull'],
  });
  return w.validated(structuredClone(row));
}
export function preparedMonsterKnowledgeValue(value: unknown): PreparedMonsterKnowledge {
  const row = r.exact(
    value,
    'advisorCards activeAdvisorCardIdOrNull',
    '$.preparedMonsterKnowledge',
  );
  const cards = monsterAdvisorCardsValue(row['advisorCards']);
  if (
    row['activeAdvisorCardIdOrNull'] !== null &&
    !cards.some((card) => card.cardId === row['activeAdvisorCardIdOrNull'])
  )
    r.invalid('$.activeAdvisorCardIdOrNull', 'actual owned card', null);
  return w.validated(structuredClone(row));
}
export const CUSTOM_MONSTER_STAGE_FORMS = {
  MONSTER_IDENTITY: ['ENM-011', 'ENM-012', 'ENM-011::CTA::002'],
  MONSTER_STATS: ['ENM-012', 'ENM-013', 'ENM-012::CTA::004'],
  MONSTER_PHYSICS: ['ENM-013', 'ENM-014', 'ENM-013::CTA::003'],
  MONSTER_ATTACK: ['ENM-014', 'ENM-015', 'ENM-014::CTA::002'],
  MONSTER_SYMBIONT: ['ENM-015', 'ENM-016', 'ENM-015::CTA::003'],
} as const;
export function reduceCustomMonsterAttempt(
  attempt: CustomMonsterAttempt,
  request: EnemyWorkflowRequest,
  prepared?: PreparedCustomMonsterComposition,
  knowledge?: PreparedMonsterKnowledge,
): CustomMonsterAttempt {
  const stage = request.payload.stage;
  const data = request.payload.data;
  const base = { ...attempt, revision: attempt.revision + 1 };
  if (stage === 'MONSTER_IDENTITY') {
    const identity = customMonsterIdentityValue(data);
    return customMonsterAttemptValue({
      ...base,
      identityOrNull: { ...identity, name: identity.name.trim() },
    });
  }
  if (stage === 'MONSTER_STATS') {
    const stats = customMonsterStatsValue(data);
    if (knowledge === undefined)
      return r.invalid('$.preparedMonsterKnowledge', 'verified accepted body accounting', null);
    return customMonsterAttemptValue({
      ...base,
      ...knowledge,
      statsOrNull: stats,
      ...(admissionJsonEqual(stats, attempt.statsOrNull) ? {} : { compositionOrNull: null }),
    });
  }
  if (stage === 'MONSTER_PHYSICS')
    return customMonsterAttemptValue({ ...base, physicsOrNull: customMonsterPhysicsValue(data) });
  if (stage === 'MONSTER_ATTACK')
    return customMonsterAttemptValue({ ...base, attackOrNull: customMonsterAttackValue(data) });
  if (stage !== 'MONSTER_SYMBIONT' || prepared === undefined)
    return r.invalid('$.stage', 'own CUSTOM_MONSTER stage with host preparation', null);
  customMonsterCompositionPatchValue(data);
  return customMonsterAttemptValue({
    ...base,
    compositionOrNull: prepared.composition,
    advisorCards: prepared.advisorCards,
    activeAdvisorCardIdOrNull: prepared.activeAdvisorCardIdOrNull,
  });
}
