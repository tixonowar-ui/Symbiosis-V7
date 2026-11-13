import type { JsonObject, RevisionVector } from './wire-protocol.js';
import type { EnemyStats } from './enemy-authoring.js';
import { enemyAuthoringContextValue } from './enemy-authoring.js';
import { enemyCompositionCatalogShape } from './enemy-composition-presentation.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';
import {
  CUSTOM_MONSTER_PLACEHOLDER,
  CUSTOM_MONSTER_PLACEHOLDER_SHA256,
  CUSTOM_MONSTER_STATS,
  customMonsterIdentityValue,
  customMonsterStatsValue,
  customMonsterPhysicsValue,
  customMonsterAttackValue,
} from './custom-monster.js';
import type {
  CustomMonsterSheet,
  CustomMonsterAttempt,
  CustomMonsterVersionIdentity,
} from './custom-monster-state.js';
import { enemySymbiontChoiceValue } from './enemy-composition.js';
import type { EnemySymbiontChoice } from './enemy-composition.js';
import {
  enemyVersionHistoryValue,
  enemyVersionConfigurationSummaryValue,
  type EnemyVersionHistory,
  type EnemyVersionConfigurationSummary,
} from './enemy-version-history.js';
import { enemyVersionEditorValue, type EnemyVersionEditor } from './enemy-version-editor.js';
import type { EnemyVersionAttemptContext } from './enemy-version-configuration.js';

export const CUSTOM_MONSTER_FORMS = [
  'ENM-011',
  'ENM-012',
  'ENM-013',
  'ENM-014',
  'ENM-015',
  'ENM-016',
  'ENM-017',
  'ENM-020',
] as const;
export interface CustomMonsterProjection extends RevisionVector {
  readonly kind: 'CUSTOM_MONSTER_AUTHORING';
  readonly formId: (typeof CUSTOM_MONSTER_FORMS)[number];
  readonly contextId: string;
  readonly campaignId: string;
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly context: {
    readonly attemptOrNull: CustomMonsterAttempt | null;
    readonly selectedVersionOrNull: CustomMonsterVersionIdentity | null;
    readonly versionAttempt?: EnemyVersionAttemptContext;
  };
  readonly sheetOrNull: CustomMonsterSheet | null;
  /** Existing V1 has no separate N+1 configuration confirmation; no stored field is added. */
  readonly versionConfigurationSummaryOrNull?: EnemyVersionConfigurationSummary | null;
  readonly versionHistory?: EnemyVersionHistory;
  readonly versionEditor?: EnemyVersionEditor;
  readonly validationErrors: readonly string[];
  readonly catalog: JsonObject;
  readonly requiredRolls: readonly ('ADVISER_I' | 'ADVISER_W')[];
  readonly diceMode: 'AUTO' | 'MANUAL';
  readonly advisorPreparationOrNull: Readonly<{
    cardId: string;
    stats: EnemyStats;
    capacity: number;
    initialFilled: boolean;
  }> | null;
  readonly art: Readonly<{ mediaType: 'image/png'; sha256: string; bytesBase64: string }>;
}
function stats(value: unknown): void {
  const row = r.exact(value, CUSTOM_MONSTER_STATS.join(' '), '$.monster.permanentStats');
  for (const key of CUSTOM_MONSTER_STATS) r.integer(row[key], '$.permanentStats.' + key, 1);
}
function selectionBindings(choice: EnemySymbiontChoice, catalog: Record<string, unknown>): void {
  const species = r
    .list(catalog['species'], '$.species')
    .map((value) => r.record(value, '$.species'));
  const actual = species.find((row) => row['speciesKey'] === choice.speciesKey);
  if (
    actual === undefined ||
    actual['kind'] !== 'ORDINARY' ||
    actual['bindingPolicy'] !== choice.binding.kind
  )
    r.invalid('$.selection', 'actual ordinary species and functional binding', null);
  const levels = r.list(catalog['levels'], '$.levels').map((value) => r.record(value, '$.level'));
  if (
    !levels.some(
      (row) => row['speciesKey'] === choice.speciesKey && row['level'] === choice.targetLevel,
    )
  )
    r.invalid('$.selection.targetLevel', 'actual species level', null);
  const nodes = r.list(catalog['nodes'], '$.nodes').map((value) => r.record(value, '$.node'));
  for (const ref of choice.learnedNodeRefs)
    if (
      !nodes.some(
        (row) =>
          row['speciesKey'] === choice.speciesKey &&
          row['nodeRef'] === ref &&
          typeof row['level'] === 'number' &&
          row['level'] <= choice.targetLevel,
      )
    )
      r.invalid('$.selection.node', 'actual source node within selected level', null);
}
export function customMonsterSheetValue(value: unknown): CustomMonsterSheet {
  const row = r.exact(
    value,
    'kind identity stats physics attack permanentStats effectiveMaxHP currentHP alive conscious symbiontOrNull ruleFacts advisorOrNull progressionPolicy artAssetKey',
    '$.monsterSheet',
  );
  w.literal(row['kind'], 'CUSTOM_MONSTER', '$.kind');
  customMonsterIdentityValue(row['identity']);
  customMonsterStatsValue(row['stats']);
  customMonsterPhysicsValue(row['physics']);
  customMonsterAttackValue(row['attack']);
  stats(row['permanentStats']);
  w.literal(row['alive'], true, '$.alive');
  w.literal(row['conscious'], true, '$.conscious');
  r.integer(row['effectiveMaxHP'], '$.effectiveMaxHP', 1);
  if (row['currentHP'] !== row['effectiveMaxHP'])
    r.invalid('$.currentHP', 'CORE-202 full health', null);
  w.literal(row['progressionPolicy'], 'NO_XP_PROGRESSION', '$.progressionPolicy');
  w.literal(row['artAssetKey'], CUSTOM_MONSTER_PLACEHOLDER, '$.artAssetKey');
  if (row['symbiontOrNull'] !== null) {
    const sym = r.exact(
      row['symbiontOrNull'],
      'symbiontInstanceId speciesKey speciesName effectiveLevel levelProfileId learnedNodeRefs nativeMaxOE currentOE binding functionalInterfaceOnly',
      '$.monsterSymbiont',
    );
    r.uuid(sym['symbiontInstanceId'], '$.symbiontInstanceId');
    for (const key of ['speciesKey', 'speciesName', 'levelProfileId']) r.text(sym[key], '$.' + key);
    r.integer(sym['effectiveLevel'], '$.effectiveLevel', 1);
    r.integer(sym['nativeMaxOE'], '$.nativeMaxOE', 1);
    if (sym['currentOE'] !== sym['nativeMaxOE'])
      r.invalid('$.currentOE', 'CORE-202 full own resource', null);
    const nodes = r.list(sym['learnedNodeRefs'], '$.learnedNodeRefs');
    enemySymbiontChoiceValue({
      speciesKey: sym['speciesKey'],
      targetLevel: sym['effectiveLevel'],
      learnedNodeRefs: sym['learnedNodeRefs'],
      binding: sym['binding'],
    });
    w.literal(sym['functionalInterfaceOnly'], true, '$.functionalInterfaceOnly');
    nodes.forEach((node) => r.text(node, '$.nodeRef'));
    if (nodes.length === 0 || new Set(nodes).size !== nodes.length)
      r.invalid('$.nodes', 'distinct actual learned nodes', null);
  }
  for (const value of r.list(row['ruleFacts'], '$.ruleFacts')) {
    const fact = r.exact(
      value,
      'nodeRef ruleId name status algorithm hostSkillResultDropped',
      '$.ruleFact',
    );
    for (const key of ['nodeRef', 'ruleId', 'name', 'algorithm']) r.text(fact[key], '$.' + key);
    r.oneOf(fact['status'], ['Активно', 'Не автоматизируется'], '$.status');
    if (typeof fact['hostSkillResultDropped'] !== 'boolean')
      r.invalid('$.hostSkillResultDropped', 'boolean', null);
    if (
      row['symbiontOrNull'] === null ||
      !r
        .list(r.record(row['symbiontOrNull'], '$.symbiont')['learnedNodeRefs'], '$.nodes')
        .includes(fact['nodeRef'])
    )
      r.invalid('$.ruleFact', 'actually learned node', null);
  }
  if (row['advisorOrNull'] !== null) {
    const card = r.exact(row['advisorOrNull'], 'cardId I W capacity skills', '$.advisor');
    r.uuid(card['cardId'], '$.cardId');
    for (const key of ['I', 'W', 'capacity']) r.integer(card[key], '$.' + key, 1);
    for (const value of r.list(card['skills'], '$.advisor.skills')) {
      const skill = r.exact(value, 'skillKey name bonus slotCost', '$.advisor.skill');
      r.text(skill['skillKey'], '$.skillKey');
      r.text(skill['name'], '$.name');
      r.integer(skill['bonus'], '$.bonus', 1);
      r.integer(skill['slotCost'], '$.slotCost', 1);
    }
    if (
      row['symbiontOrNull'] === null ||
      r.record(row['symbiontOrNull'], '$.symbiont')['speciesKey'] !== 'ADVISER'
    )
      r.invalid('$.advisor', 'actual Adviser personality', null);
  }
  return w.validated(structuredClone(row));
}
export function customMonsterProjectionValue(value: unknown): CustomMonsterProjection {
  const rawProjection = w.record(value, '$.monsterProjection');
  const row = r.exact(
    value,
    'kind formId contextId campaignId campaignStatus stateRevision projectionRevision actorVisibilityRevision context sheetOrNull validationErrors catalog requiredRolls diceMode advisorPreparationOrNull art' +
      (Object.hasOwn(rawProjection, 'versionConfigurationSummaryOrNull')
        ? ' versionConfigurationSummaryOrNull'
        : '') +
      (Object.hasOwn(rawProjection, 'versionHistory') ? ' versionHistory' : '') +
      (Object.hasOwn(rawProjection, 'versionEditor') ? ' versionEditor' : ''),
    '$.monsterProjection',
  );
  w.literal(row['kind'], 'CUSTOM_MONSTER_AUTHORING', '$.kind');
  r.oneOf(row['diceMode'], ['AUTO', 'MANUAL'], '$.diceMode');
  const form = r.oneOf(row['formId'], CUSTOM_MONSTER_FORMS, '$.formId');
  if (Object.hasOwn(rawProjection, 'versionConfigurationSummaryOrNull')) {
    if (row['versionConfigurationSummaryOrNull'] !== null)
      enemyVersionConfigurationSummaryValue(row['versionConfigurationSummaryOrNull']);
    if (form !== 'ENM-020')
      r.invalid('$.versionConfigurationSummaryOrNull', 'saved ENM-020 projection only', null);
  }
  for (const key of ['contextId', 'campaignId']) r.uuid(row[key], '$.' + key);
  r.oneOf(row['campaignStatus'], ['PAUSED', 'HOSTING'], '$.campaignStatus');
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])
    r.integer(row[key], '$.' + key, 0);
  const context = enemyAuthoringContextValue(row['context']);
  if (form === 'ENM-017') enemyVersionEditorValue(row['versionEditor'], context);
  else if (Object.hasOwn(rawProjection, 'versionEditor') || context.versionAttempt !== undefined)
    r.invalid('$.versionEditor', 'own ENM-017 only', null);
  if (
    row['versionConfigurationSummaryOrNull'] != null &&
    (context.selectedVersionOrNull?.kind !== 'CUSTOM_MONSTER' ||
      context.selectedVersionOrNull.version <= 1 ||
      enemyVersionConfigurationSummaryValue(row['versionConfigurationSummaryOrNull']).input.kind !==
        'CUSTOM_MONSTER')
  )
    r.invalid(
      '$.versionConfigurationSummaryOrNull',
      'explicit CUSTOM_MONSTER N+1 confirmation only',
      null,
    );
  if (Object.hasOwn(rawProjection, 'versionHistory')) {
    const history = enemyVersionHistoryValue(row['versionHistory']);
    if (
      form !== 'ENM-020' ||
      !admissionJsonEqual(history.selected, context.selectedVersionOrNull) ||
      !admissionJsonEqual(
        history.entries.find((entry) => admissionJsonEqual(entry.identity, history.selected))
          ?.configurationSummaryOrNull,
        row['versionConfigurationSummaryOrNull'],
      )
    )
      r.invalid('$.versionHistory', 'own saved selected version and configuration summary', null);
  }
  const attempt = context.attemptOrNull;
  if (row['advisorPreparationOrNull'] !== null) {
    const preparation = r.exact(
      row['advisorPreparationOrNull'],
      'cardId stats capacity initialFilled',
      '$.advisorPreparation',
    );
    r.uuid(preparation['cardId'], '$.cardId');
    stats(preparation['stats']);
    r.integer(preparation['capacity'], '$.capacity', 1);
    if (
      typeof preparation['initialFilled'] !== 'boolean' ||
      (form !== 'ENM-015' && form !== 'ENM-017') ||
      attempt?.kind !== 'CUSTOM_MONSTER' ||
      attempt.compositionOrNull?.advisorCardIdOrNull !== preparation['cardId'] ||
      !attempt.advisorCards.some(
        (card) =>
          card.cardId === preparation['cardId'] &&
          (card.initialSkillsOrNull !== null) === preparation['initialFilled'],
      )
    )
      r.invalid('$.advisorPreparation', 'actual current own card', null);
  }
  if (form === 'ENM-020') {
    if (
      attempt !== null ||
      context.selectedVersionOrNull?.kind !== 'CUSTOM_MONSTER' ||
      context.selectedVersionOrNull.campaignId !== row['campaignId']
    )
      r.invalid('$.context', 'own saved CUSTOM_MONSTER version', null);
  } else {
    if (
      attempt?.kind !== 'CUSTOM_MONSTER' ||
      attempt.campaignId !== row['campaignId'] ||
      context.selectedVersionOrNull !== null
    )
      return r.invalid('$.context', 'own CUSTOM_MONSTER attempt', null);
    const fields = [
      'identityOrNull',
      'statsOrNull',
      'physicsOrNull',
      'attackOrNull',
      'compositionOrNull',
    ] as const;
    for (const field of fields.slice(
      0,
      form === 'ENM-017' ? 0 : CUSTOM_MONSTER_FORMS.indexOf(form),
    ))
      if (attempt[field] === null) r.invalid('$.attempt.' + field, 'preceding saved stage', null);
  }
  const catalog = r.exact(row['catalog'], 'compositionCatalog advisorSkills', '$.monsterCatalog');
  enemyCompositionCatalogShape(catalog['compositionCatalog']);
  const common = r.record(catalog['compositionCatalog'], '$.compositionCatalog');
  if (
    r.list(common['species'], '$.species').length === 0 ||
    r.list(catalog['advisorSkills'], '$.advisorSkills').length === 0
  )
    r.invalid('$.monsterCatalog', 'nonempty source-backed controls', null);
  for (const value of r.list(common['species'], '$.species'))
    w.literal(r.record(value, '$.species')['kind'], 'ORDINARY', '$.species.kind');
  // Only the separate personality uses these choices. No host skill or inventory container exists.
  for (const value of r.list(catalog['advisorSkills'], '$.advisorSkills')) {
    const skill = r.exact(value, 'skillKey name maxBonus requirements', '$.advisorSkillChoice');
    r.text(skill['skillKey'], '$.skillKey');
    r.text(skill['name'], '$.name');
    if (skill['maxBonus'] !== 'NO_RULED_UPPER_LIMIT') r.integer(skill['maxBonus'], '$.maxBonus', 1);
    for (const value of r.list(skill['requirements'], '$.requirements')) {
      const req = r.exact(value, 'statCode minValue', '$.requirement');
      r.oneOf(req['statCode'], CUSTOM_MONSTER_STATS, '$.statCode');
      r.integer(req['minValue'], '$.minValue', 1);
    }
  }
  const choices = r
    .list(catalog['advisorSkills'], '$.advisorSkills')
    .map((value) => r.record(value, '$.skill'));
  if (new Set(choices.map((row) => row['skillKey'])).size !== choices.length)
    r.invalid('$.advisorSkills', 'distinct actual choices', null);
  if (attempt?.kind === 'CUSTOM_MONSTER') {
    const composition = attempt.compositionOrNull;
    if (composition?.selection.mode === 'ORDINARY')
      selectionBindings(composition.selection.symbiont, common);
    for (const card of attempt.advisorCards) {
      selectionBindings(card.confirmedChoice, common);
      for (const selected of [...(card.initialSkillsOrNull ?? []), ...card.knownSkills]) {
        const choice = choices.find((row) => row['skillKey'] === selected.skillKey);
        if (
          choice === undefined ||
          (typeof choice['maxBonus'] === 'number' && selected.targetBonus > choice['maxBonus'])
        )
          r.invalid('$.advisorCard.skills', 'actual selectable source bonus', null);
      }
      for (const loss of card.permanentLosses)
        if (!choices.some((row) => row['skillKey'] === loss.skillKey))
          r.invalid('$.advisorLoss', 'actual source skill', null);
    }
    const preparationExpected =
      (form === 'ENM-015' || form === 'ENM-017') && composition?.advisorCardIdOrNull != null;
    if (preparationExpected !== (row['advisorPreparationOrNull'] !== null))
      r.invalid('$.advisorPreparation', 'exact current acquired personality', null);
  }
  for (const error of r.list(row['validationErrors'], '$.validationErrors'))
    r.text(error, '$.error');
  const required = r.list(row['requiredRolls'], '$.requiredRolls');
  required.forEach((value) => r.oneOf(value, ['ADVISER_I', 'ADVISER_W'], '$.requiredRoll'));
  if (
    new Set(required).size !== required.length ||
    (form !== 'ENM-015' && form !== 'ENM-017' && required.length !== 0)
  )
    r.invalid('$.requiredRolls', 'own distinct preparation only', null);
  const art = r.exact(row['art'], 'mediaType sha256 bytesBase64', '$.art');
  w.literal(art['mediaType'], 'image/png', '$.mediaType');
  w.literal(art['sha256'], CUSTOM_MONSTER_PLACEHOLDER_SHA256, '$.sha256');
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      r.text(art['bytesBase64'], '$.bytesBase64'),
    )
  )
    r.invalid('$.art', 'canonical PNG base64', null);
  if (row['sheetOrNull'] !== null) {
    const sheet = customMonsterSheetValue(row['sheetOrNull']);
    const sym = sheet.symbiontOrNull;
    if (sym !== null) {
      selectionBindings(
        {
          speciesKey: sym.speciesKey,
          targetLevel: sym.effectiveLevel,
          learnedNodeRefs: sym.learnedNodeRefs,
          binding: sym.binding,
        },
        common,
      );
      const species = r
        .list(common['species'], '$.species')
        .map((value) => r.record(value, '$.species'))
        .find((row) => row['speciesKey'] === sym.speciesKey);
      const level = r
        .list(common['levels'], '$.levels')
        .map((value) => r.record(value, '$.level'))
        .find((row) => row['speciesKey'] === sym.speciesKey && row['level'] === sym.effectiveLevel);
      if (sym.speciesName !== species?.['name'] || sym.levelProfileId !== level?.['levelProfileId'])
        r.invalid('$.sheet.symbiont', 'actual source name/profile', null);
    }
    if (sheet.advisorOrNull !== null)
      for (const selected of sheet.advisorOrNull.skills) {
        const choice = choices.find((row) => row['skillKey'] === selected.skillKey);
        if (choice === undefined || choice['name'] !== selected.name)
          r.invalid('$.sheet.advisor', 'source-backed skill label', null);
      }
    if (
      attempt?.kind === 'CUSTOM_MONSTER' &&
      (!admissionJsonEqual(sheet.identity, attempt.identityOrNull) ||
        !admissionJsonEqual(sheet.stats, attempt.statsOrNull) ||
        !admissionJsonEqual(sheet.physics, attempt.physicsOrNull) ||
        !admissionJsonEqual(sheet.attack, attempt.attackOrNull))
    )
      r.invalid('$.sheet', 'actual current attempt inputs', null);
    if (attempt?.kind === 'CUSTOM_MONSTER') {
      const composition = attempt.compositionOrNull;
      if (
        composition?.phase !== 'CONFIRMED' ||
        (composition.selection.mode === 'NONE'
          ? sym !== null
          : sym === null ||
            sym.symbiontInstanceId !== composition.symbiontInstanceIdOrNull ||
            sym.speciesKey !== composition.selection.symbiont.speciesKey ||
            sym.effectiveLevel !== composition.selection.symbiont.targetLevel ||
            sym.learnedNodeRefs.length !== composition.selection.symbiont.learnedNodeRefs.length ||
            sym.learnedNodeRefs.some(
              (ref) =>
                composition.selection.mode !== 'ORDINARY' ||
                !composition.selection.symbiont.learnedNodeRefs.includes(ref),
            ) ||
            !admissionJsonEqual(sym.binding, composition.selection.symbiont.binding)) ||
        (sheet.advisorOrNull?.cardId ?? null) !== composition.advisorCardIdOrNull
      )
        r.invalid('$.sheet', 'actually confirmed symbiont/card selection', null);
    }
  }
  if (
    (form === 'ENM-020' ||
      ((form === 'ENM-016' || form === 'ENM-017') &&
        r.list(row['validationErrors'], '$.errors').length === 0)) &&
    row['sheetOrNull'] === null
  )
    r.invalid('$.sheet', 'complete saved/valid preview sheet', null);
  return w.validated(structuredClone(row));
}
