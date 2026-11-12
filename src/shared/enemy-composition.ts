import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';

export interface EnemySymbiontChoice {
  readonly speciesKey: string;
  readonly targetLevel: number;
  readonly learnedNodeRefs: readonly string[];
  readonly binding: Readonly<{ kind: string; side?: 'LEFT' | 'RIGHT' }>;
}
export interface EnemyCompositionSelection {
  readonly symbiontCompositionMode: 'ORDINARY_SYMBIONTS' | 'SYMBIOTIC_MONSTER';
  readonly ordinarySymbiontInstances: readonly EnemySymbiontChoice[];
  /** Actual imported LevelProfileID; never a route, display index or guessed species prefix. */
  readonly symbioticMonsterProfileIdOrNull: string | null;
  readonly monsterOrNull: EnemySymbiontChoice | null;
}
export interface EnemyCompositionRoll {
  readonly factId: string;
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly originatingCommandId: string;
  readonly modeSnapshot: 'AUTO' | 'MANUAL';
  readonly mechanical: Readonly<{ dieSides: 6 | 20; rawFace: number }>;
}
export interface EnemyCompositionSkills {
  readonly advisorSkills: readonly { readonly skillKey: string; readonly targetBonus: number }[];
  readonly dolphinSkills: readonly { readonly skillKey: string; readonly targetBonus: number }[];
}
export interface EnemyCompositionAcquisitions {
  readonly schemaVersion: 1;
  readonly freeSlotOrNull: Readonly<{
    roll: EnemyCompositionRoll;
    statsBefore: Readonly<{ S: number; M: number; Z: number }>;
    permanentStatConsequence: Readonly<{ S: number; M: number; Z: number }>;
  }> | null;
  readonly advisorCards: readonly Readonly<{
    cardId: string;
    symbiontInstanceId: string;
    iwRolls: readonly [EnemyCompositionRoll, EnemyCompositionRoll];
    suppressionRollOrNull: EnemyCompositionRoll | null;
    skillsOrNull: EnemyCompositionSkills['advisorSkills'] | null;
  }>[];
  readonly activeAdvisorCardIdOrNull: string | null;
  readonly grossGrantOrNull: Readonly<{
    sourceCommandId: string;
    symbiontInstanceId: string;
    bonusBefore: number;
    bonusAfter: number;
    lostAtCommandIdOrNull: string | null;
  }> | null;
}
export const emptyEnemyCompositionAcquisitions = (): EnemyCompositionAcquisitions => ({
  schemaVersion: 1,
  freeSlotOrNull: null,
  advisorCards: [],
  activeAdvisorCardIdOrNull: null,
  grossGrantOrNull: null,
});
/** New closed initial-composition form. The delivered empty form has no discriminator or new keys. */
export interface EnemyComposedComposition extends EnemyCompositionSelection {
  readonly schemaVersion: 1;
  readonly phase: 'PREVIEW' | 'ACQUIRED' | 'CONFIRMED';
  readonly previewCommandId: string;
  readonly confirmationCommandIdOrNull: string | null;
  readonly lifecycleSourceCommandIdOrNull: string | null;
  readonly diceModeSnapshot: 'AUTO' | 'MANUAL';
  readonly instanceIds: readonly string[];
  readonly advisorCardIdOrNull: string | null;
  readonly acquisitions: EnemyCompositionAcquisitions;
  readonly rolls: readonly EnemyCompositionRoll[];
  readonly skills: EnemyCompositionSkills;
}
export type EnemyCompositionPatch =
  | Readonly<{
      operation: 'PREVIEW';
      selection: EnemyCompositionSelection;
      advisorRemovalConfirmed: boolean;
    }>
  | Readonly<{
      operation: 'CONFIRM';
      previewCommandId: string;
      interactionsConfirmed: true;
      manualFacesOrNull: readonly number[] | null;
    }>
  | Readonly<{
      operation: 'FINISH';
      previewCommandId: string;
      skills: EnemyCompositionSkills;
    }>;

function choice(value: unknown): EnemySymbiontChoice {
  const row = r.exact(value, 'speciesKey targetLevel learnedNodeRefs binding', '$.symbiont');
  r.text(row['speciesKey'], '$.speciesKey');
  r.integer(row['targetLevel'], '$.targetLevel', 1);
  const nodes = r.list(row['learnedNodeRefs'], '$.learnedNodeRefs');
  nodes.forEach((ref) => r.text(ref, '$.nodeRef'));
  if (new Set(nodes).size !== nodes.length) r.invalid('$.nodes', 'distinct node references', null);
  const raw = r.record(row['binding'], '$.binding');
  const sided = raw['kind'] === 'OWL_EYE' || raw['kind'] === 'EEL_ARM';
  const binding = r.exact(raw, 'kind' + (sided ? ' side' : ''), '$.binding');
  r.oneOf(
    binding['kind'],
    ['NONE', 'OWL_EYE', 'EEL_ARM', 'TICK_RIGHT_HAND', 'SPIDER_BOTH_WRISTS', 'MANTIS_BOTH_FOREARMS'],
    '$.binding.kind',
  );
  if (sided) r.oneOf(binding['side'], ['LEFT', 'RIGHT'], '$.side');
  return w.validated(row);
}
/** Shape only: callers still prove source species, kind, graph, interfaces and native resources. */
export const enemySymbiontChoiceValue = choice;
export function enemyCompositionSelectionValue(value: unknown): EnemyCompositionSelection {
  const row = r.exact(
    value,
    'symbiontCompositionMode ordinarySymbiontInstances symbioticMonsterProfileIdOrNull monsterOrNull',
    '$.selection',
  );
  r.oneOf(row['symbiontCompositionMode'], ['ORDINARY_SYMBIONTS', 'SYMBIOTIC_MONSTER'], '$.mode');
  const ordinary = r.list(row['ordinarySymbiontInstances'], '$.ordinary');
  ordinary.forEach(choice);
  if (
    ordinary.length > 4 ||
    new Set(ordinary.map((entry) => choice(entry).speciesKey)).size !== ordinary.length
  )
    r.invalid('$.ordinary', 'at most four distinct species', null);
  if (row['symbioticMonsterProfileIdOrNull'] !== null)
    r.text(row['symbioticMonsterProfileIdOrNull'], '$.profile');
  if (row['monsterOrNull'] !== null) choice(row['monsterOrNull']);
  if (
    row['symbiontCompositionMode'] === 'ORDINARY_SYMBIONTS'
      ? row['monsterOrNull'] !== null || row['symbioticMonsterProfileIdOrNull'] !== null
      : ordinary.length !== 0 ||
        row['monsterOrNull'] === null ||
        row['symbioticMonsterProfileIdOrNull'] === null
  )
    r.invalid('$.mode', 'mutually exclusive complete composition mode', null);
  return w.validated(row);
}
export function enemyCompositionSkillsValue(value: unknown): EnemyCompositionSkills {
  const row = r.exact(value, 'advisorSkills dolphinSkills', '$.compositionSkills');
  for (const key of ['advisorSkills', 'dolphinSkills']) {
    const skills = r.list(row[key], '$.' + key);
    for (const raw of skills) {
      const skill = r.exact(raw, 'skillKey targetBonus', '$.skill');
      r.text(skill['skillKey'], '$.skillKey');
      r.integer(skill['targetBonus'], '$.targetBonus', 1);
    }
    if (
      new Set(skills.map((value) => r.record(value, '$.skill')['skillKey'])).size !== skills.length
    )
      r.invalid('$.' + key, 'distinct skill selections', null);
  }
  return w.validated(row);
}
export function enemyComposedCompositionValue(value: unknown): EnemyComposedComposition {
  const row = r.exact(
    value,
    'schemaVersion phase previewCommandId confirmationCommandIdOrNull lifecycleSourceCommandIdOrNull diceModeSnapshot instanceIds advisorCardIdOrNull acquisitions rolls skills symbiontCompositionMode ordinarySymbiontInstances symbioticMonsterProfileIdOrNull monsterOrNull',
    '$.composition',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  r.oneOf(row['phase'], ['PREVIEW', 'ACQUIRED', 'CONFIRMED'], '$.phase');
  r.uuid(row['previewCommandId'], '$.previewCommandId');
  for (const key of ['confirmationCommandIdOrNull', 'lifecycleSourceCommandIdOrNull'])
    if (row[key] !== null) r.uuid(row[key], '$.' + key);
  r.oneOf(row['diceModeSnapshot'], ['AUTO', 'MANUAL'], '$.diceMode');
  const selection = enemyCompositionSelectionValue(
    Object.fromEntries(
      [
        'symbiontCompositionMode',
        'ordinarySymbiontInstances',
        'symbioticMonsterProfileIdOrNull',
        'monsterOrNull',
      ].map((key) => [key, row[key]]),
    ),
  );
  const ids = r.list(row['instanceIds'], '$.instanceIds');
  ids.forEach((id) => r.uuid(id, '$.instanceId'));
  if (row['advisorCardIdOrNull'] !== null) r.uuid(row['advisorCardIdOrNull'], '$.advisorCardId');
  if (
    new Set(ids).size !== ids.length ||
    ids.length !==
      (selection.monsterOrNull === null ? selection.ordinarySymbiontInstances.length : 1)
  )
    r.invalid('$.instanceIds', 'one distinct host identity per selected specimen', null);
  r.list(row['rolls'], '$.rolls').forEach(rollShape);
  const acquisitions = enemyCompositionAcquisitionsValue(row['acquisitions']);
  if (row['advisorCardIdOrNull'] !== acquisitions.activeAdvisorCardIdOrNull)
    r.invalid('$.advisorCardId', 'active acquired card', null);
  const advisorIndex = selection.ordinarySymbiontInstances.findIndex(
    (choice) => choice.speciesKey === 'ADVISER',
  );
  const activeCard = acquisitions.advisorCards.find(
    (card) => card.cardId === row['advisorCardIdOrNull'],
  );
  if (
    activeCard !== undefined &&
    (advisorIndex < 0 || ids[advisorIndex] !== activeCard.symbiontInstanceId)
  )
    r.invalid('$.advisorCard', 'current selected adviser specimen', null);
  if (row['phase'] !== 'PREVIEW' && advisorIndex >= 0 && activeCard === undefined)
    r.invalid('$.advisorCard', 'mandatory acquired adviser card', null);
  const skills = enemyCompositionSkillsValue(row['skills']);
  if (
    row['phase'] === 'CONFIRMED' &&
    activeCard !== undefined &&
    (activeCard.skillsOrNull === null ||
      !admissionJsonEqual(activeCard.skillsOrNull, skills.advisorSkills))
  )
    r.invalid('$.advisorSkills', 'current confirmed card allocation', null);
  if (
    row['phase'] === 'PREVIEW'
      ? row['confirmationCommandIdOrNull'] !== null
      : row['confirmationCommandIdOrNull'] === null
  )
    r.invalid('$.confirmation', 'phase-bound acquisition command', null);
  return w.validated(row);
}
function rollShape(raw: unknown): void {
  const roll = r.exact(
    raw,
    'factId rollRequestId rollReceiptId originatingCommandId modeSnapshot mechanical',
    '$.roll',
  );
  for (const key of ['factId', 'rollRequestId', 'rollReceiptId']) r.text(roll[key], '$.' + key);
  r.uuid(roll['originatingCommandId'], '$.originatingCommandId');
  r.oneOf(roll['modeSnapshot'], ['AUTO', 'MANUAL'], '$.modeSnapshot');
  const mechanical = r.exact(roll['mechanical'], 'dieSides rawFace', '$.mechanical');
  const sides = r.integer(mechanical['dieSides'], '$.dieSides', 1);
  if (sides !== 6 && sides !== 20) r.invalid('$.dieSides', '6 or 20', null);
  if (r.integer(mechanical['rawFace'], '$.rawFace', 1) > sides)
    r.invalid('$.rawFace', 'die range', null);
}
export function enemyCompositionAcquisitionsValue(value: unknown): EnemyCompositionAcquisitions {
  const row = r.exact(
    value,
    'schemaVersion freeSlotOrNull advisorCards activeAdvisorCardIdOrNull grossGrantOrNull',
    '$.acquisitions',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  if (row['freeSlotOrNull'] !== null) {
    const free = r.exact(
      row['freeSlotOrNull'],
      'roll statsBefore permanentStatConsequence',
      '$.freeSlot',
    );
    rollShape(free['roll']);
    const before = r.exact(free['statsBefore'], 'S M Z', '$.freeStats'),
      delta = r.exact(free['permanentStatConsequence'], 'S M Z', '$.freeDelta');
    const roll = r.record(free['roll'], '$.roll'),
      mechanical = r.record(roll['mechanical'], '$.mechanical');
    w.literal(mechanical['dieSides'], 6, '$.dieSides');
    for (const stat of ['S', 'M', 'Z']) {
      const basis = r.integer(before[stat], '$.freeStats.' + stat, 1),
        face = r.integer(mechanical['rawFace'], '$.face', 1);
      if (delta[stat] !== Math.max(1, basis - face) - basis)
        r.invalid('$.freeDelta', 'source R6 consequence', null);
    }
  }
  const cards = r.list(row['advisorCards'], '$.advisorCards');
  for (const raw of cards) {
    const card = r.exact(
      raw,
      'cardId symbiontInstanceId iwRolls suppressionRollOrNull skillsOrNull',
      '$.advisorCard',
    );
    r.uuid(card['cardId'], '$.cardId');
    r.uuid(card['symbiontInstanceId'], '$.symbiontInstanceId');
    const rolls = r.list(card['iwRolls'], '$.iwRolls');
    if (rolls.length !== 2) r.invalid('$.iwRolls', 'I then W', null);
    rolls.forEach(rollShape);
    for (const rawRoll of rolls)
      w.literal(
        r.record(r.record(rawRoll, '$.roll')['mechanical'], '$.mechanical')['dieSides'],
        20,
        '$.adviserDie',
      );
    if (card['suppressionRollOrNull'] !== null) {
      rollShape(card['suppressionRollOrNull']);
      w.literal(
        r.record(r.record(card['suppressionRollOrNull'], '$.roll')['mechanical'], '$.mechanical')[
          'dieSides'
        ],
        20,
        '$.suppressionDie',
      );
    }
    if (card['skillsOrNull'] !== null)
      enemyCompositionSkillsValue({ advisorSkills: card['skillsOrNull'], dolphinSkills: [] });
  }
  if (new Set(cards.map((card) => r.record(card, '$.card')['cardId'])).size !== cards.length)
    r.invalid('$.advisorCards', 'distinct card identities', null);
  if (
    row['activeAdvisorCardIdOrNull'] !== null &&
    !cards.some(
      (card) =>
        r.record(card, '$.card')['cardId'] ===
        r.uuid(row['activeAdvisorCardIdOrNull'], '$.activeAdvisorCardId'),
    )
  )
    r.invalid('$.activeAdvisorCardId', 'own acquired card', null);
  if (row['grossGrantOrNull'] !== null) {
    const gross = r.exact(
      row['grossGrantOrNull'],
      'sourceCommandId symbiontInstanceId bonusBefore bonusAfter lostAtCommandIdOrNull',
      '$.gross',
    );
    r.uuid(gross['sourceCommandId'], '$.sourceCommandId');
    r.uuid(gross['symbiontInstanceId'], '$.symbiontInstanceId');
    if (gross['lostAtCommandIdOrNull'] !== null)
      r.uuid(gross['lostAtCommandIdOrNull'], '$.lostAtCommandId');
    const before = r.integer(gross['bonusBefore'], '$.bonusBefore', 0),
      after = r.integer(gross['bonusAfter'], '$.bonusAfter', 1);
    if (after !== (before === 0 ? 3 : before >= 5 ? before : Math.min(5, before + 3)))
      r.invalid('$.gross', 'single SYM079 grant', null);
  }
  return w.validated(row);
}
export function enemyCompositionPatchValue(value: unknown): EnemyCompositionPatch {
  const raw = r.record(value, '$.compositionPatch');
  if (raw['operation'] === 'PREVIEW') {
    const row = r.exact(raw, 'operation selection advisorRemovalConfirmed', '$.compositionPatch');
    enemyCompositionSelectionValue(row['selection']);
    if (typeof row['advisorRemovalConfirmed'] !== 'boolean')
      r.invalid('$.advisorRemovalConfirmed', 'boolean', null);
  } else if (raw['operation'] === 'CONFIRM') {
    const row = r.exact(
      raw,
      'operation previewCommandId interactionsConfirmed manualFacesOrNull',
      '$.compositionPatch',
    );
    r.uuid(row['previewCommandId'], '$.previewCommandId');
    w.literal(row['interactionsConfirmed'], true, '$.interactionsConfirmed');
    if (row['manualFacesOrNull'] !== null)
      r.list(row['manualFacesOrNull'], '$.manualFaces').forEach((face) =>
        r.integer(face, '$.face', 1),
      );
  } else {
    const row = r.exact(raw, 'operation previewCommandId skills', '$.compositionPatch');
    w.literal(row['operation'], 'FINISH', '$.operation');
    r.uuid(row['previewCommandId'], '$.previewCommandId');
    enemyCompositionSkillsValue(row['skills']);
  }
  return w.validated(raw);
}
