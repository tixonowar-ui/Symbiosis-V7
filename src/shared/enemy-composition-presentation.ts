import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import type { EnemyComposedComposition } from './enemy-composition.js';
import type { JsonObject } from './wire-protocol.js';
import type { EnemySkillPlanState } from './enemy-skill-plan.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';

export function enemyCompositionCatalogShape(value: unknown): void {
  const catalog = r.exact(value, 'species races levels nodes', '$.compositionCatalog');
  for (const raw of r.list(catalog['species'], '$.species')) {
    const row = r.exact(
      raw,
      'speciesKey name kind allowedRaceCodes slotCost bindingPolicy',
      '$.species',
    );
    for (const key of ['speciesKey', 'name']) r.text(row[key], '$.' + key);
    r.oneOf(row['kind'], ['ORDINARY', 'SYMBIOTIC_MONSTER'], '$.kind');
    r.list(row['allowedRaceCodes'], '$.races').forEach((race) =>
      r.oneOf(race, ['PURE', 'FREE', 'UNITED'], '$.race'),
    );
    r.integer(row['slotCost'], '$.slotCost', 1);
    r.oneOf(
      row['bindingPolicy'],
      [
        'NONE',
        'OWL_EYE',
        'EEL_ARM',
        'TICK_RIGHT_HAND',
        'SPIDER_BOTH_WRISTS',
        'MANTIS_BOTH_FOREARMS',
      ],
      '$.bindingPolicy',
    );
  }
  for (const raw of r.list(catalog['races'], '$.races')) {
    const row = r.exact(
      raw,
      'raceCode raceLabel baseSymbiontSlots symbioticMonsterAllowed',
      '$.race',
    );
    r.oneOf(row['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.raceCode');
    r.text(row['raceLabel'], '$.label');
    r.integer(row['baseSymbiontSlots'], '$.slots', 0);
    boolean(row['symbioticMonsterAllowed']);
  }
  for (const raw of r.list(catalog['levels'], '$.levels')) {
    const row = r.exact(raw, 'speciesKey levelProfileId level baseMaxOE', '$.level');
    for (const key of ['speciesKey', 'levelProfileId']) r.text(row[key], '$.' + key);
    for (const key of ['level', 'baseMaxOE']) r.integer(row[key], '$.' + key, 1);
    if (
      !r
        .list(catalog['species'], '$.species')
        .some((raw) => r.record(raw, '$.species')['speciesKey'] === row['speciesKey'])
    )
      r.invalid('$.level', 'own catalogue species', null);
  }
  for (const raw of r.list(catalog['nodes'], '$.nodes')) {
    const row = r.exact(
      raw,
      'speciesKey nodeRef abilityIdOrNull level parentMode parentNodeRefs nodeKind automationStatus branchCodeOrNull choiceGroupIdOrNull selectionConstraint ruleIds sourceQuestionIds label',
      '$.node',
    );
    for (const key of ['speciesKey', 'nodeRef', 'selectionConstraint', 'label'])
      r.text(row[key], '$.' + key);
    for (const key of ['abilityIdOrNull', 'branchCodeOrNull', 'choiceGroupIdOrNull'])
      if (row[key] !== null) r.text(row[key], '$.' + key);
    r.integer(row['level'], '$.level', 1);
    r.oneOf(row['parentMode'], ['ALL', 'ANY'], '$.parentMode');
    r.oneOf(row['nodeKind'], ['AUTOMATED_ABILITY_NODE', 'STRUCTURAL_NODE_ONLY'], '$.nodeKind');
    r.oneOf(
      row['automationStatus'],
      ['AUTOMATED_ACCEPTED', 'NODE_ONLY_MANUAL'],
      '$.automationStatus',
    );
    for (const key of ['parentNodeRefs', 'ruleIds', 'sourceQuestionIds'])
      r.list(row[key], '$.' + key).forEach((ref) => r.text(ref, '$.reference'));
  }
  const species = r.list(catalog['species'], '$.species').map((raw) => r.record(raw, '$.species')),
    levels = r.list(catalog['levels'], '$.levels').map((raw) => r.record(raw, '$.level')),
    nodes = r.list(catalog['nodes'], '$.nodes').map((raw) => r.record(raw, '$.node'));
  for (const [rows, key] of [
    [species, 'speciesKey'],
    [levels, 'levelProfileId'],
    [nodes, 'nodeRef'],
  ] as const)
    if (new Set(rows.map((row) => row[key])).size !== rows.length)
      r.invalid('$.compositionCatalog', 'unique source identities', null);
  for (const row of species)
    if (
      !levels.some((level) => level['speciesKey'] === row['speciesKey'] && level['level'] === 1) ||
      !nodes.some((node) => node['speciesKey'] === row['speciesKey'] && node['level'] === 1)
    )
      r.invalid('$.species', 'actual L1 level and mandatory nodes', null);
  for (const node of nodes) {
    if (
      !levels.some(
        (level) => level['speciesKey'] === node['speciesKey'] && level['level'] === node['level'],
      )
    )
      r.invalid('$.node', 'own species/level', null);
    for (const parent of r.list(node['parentNodeRefs'], '$.parents'))
      if (
        !nodes.some((row) => row['speciesKey'] === node['speciesKey'] && row['nodeRef'] === parent)
      )
        r.invalid('$.parent', 'own species prerequisite', null);
  }
}
export function enemyCompositionBindings(
  composition: EnemyComposedComposition,
  value: unknown,
): void {
  const catalog = r.record(value, '$.compositionCatalog'),
    choices =
      composition.monsterOrNull === null
        ? composition.ordinarySymbiontInstances
        : [composition.monsterOrNull];
  for (const choice of choices) {
    const species = r
      .list(catalog['species'], '$.species')
      .map((raw) => r.record(raw, '$.species'))
      .find((row) => row['speciesKey'] === choice.speciesKey);
    const level = r
      .list(catalog['levels'], '$.levels')
      .map((raw) => r.record(raw, '$.level'))
      .find(
        (row) => row['speciesKey'] === choice.speciesKey && row['level'] === choice.targetLevel,
      );
    if (
      species === undefined ||
      level === undefined ||
      species['bindingPolicy'] !== choice.binding.kind ||
      (species['kind'] === 'SYMBIOTIC_MONSTER') !== (composition.monsterOrNull !== null) ||
      (composition.monsterOrNull !== null &&
        level['levelProfileId'] !== composition.symbioticMonsterProfileIdOrNull)
    )
      r.invalid('$.composition', 'actual selected source species/binding/level profile', null);
    for (const ref of choice.learnedNodeRefs)
      if (
        !r.list(catalog['nodes'], '$.nodes').some((raw) => {
          const node = r.record(raw, '$.node');
          return node['speciesKey'] === choice.speciesKey && node['nodeRef'] === ref;
        })
      )
        r.invalid('$.learnedNode', 'own species source reference', null);
  }
}
function boolean(value: unknown): void {
  if (typeof value !== 'boolean') r.invalid('$', 'boolean', null);
}
function skills(value: unknown): void {
  for (const raw of r.list(value, '$.skills')) {
    const row = r.exact(raw, 'skillKey bonus slotCost', '$.skill');
    r.text(row['skillKey'], '$.skillKey');
    r.integer(row['bonus'], '$.bonus', 1);
    r.integer(row['slotCost'], '$.slotCost', 0);
  }
}
export function enemyCompositionFactsShape(
  value: unknown,
  composition: EnemyComposedComposition,
  catalogValue: unknown,
  skillState?: EnemySkillPlanState,
): JsonObject {
  const catalog = r.record(catalogValue, '$.catalog');
  const row = r.exact(
    value,
    'specimens occupiedSlots capacity interactions learnedRuleFacts advisorOrNull lostSkills temporarilyUnavailableSkills temporarilyUnavailableAdvisorSkills startSkillSlots dolphinSkillSlots',
    '$.compositionFacts',
  );
  r.integer(row['occupiedSlots'], '$.occupiedSlots', 0);
  r.integer(row['capacity'], '$.capacity', 0);
  const choices =
    composition.monsterOrNull === null
      ? composition.ordinarySymbiontInstances
      : [composition.monsterOrNull];
  const specimens = r.list(row['specimens'], '$.specimens');
  for (const raw of specimens) {
    const specimen = r.exact(
      raw,
      'symbiontInstanceId speciesKey name targetLevel learnedNodeRefs status effectsEnabled currentOE maxOE slotCost specialHistories',
      '$.specimen',
    );
    r.uuid(specimen['symbiontInstanceId'], '$.instanceId');
    for (const key of ['speciesKey', 'name']) r.text(specimen[key], '$.' + key);
    for (const key of ['targetLevel', 'maxOE', 'currentOE', 'slotCost'])
      r.integer(specimen[key], '$.' + key, 1);
    r.oneOf(specimen['status'], ['ACTIVE', 'SUPPRESSED'], '$.status');
    boolean(specimen['effectsEnabled']);
    if (
      specimen['currentOE'] !== specimen['maxOE'] ||
      specimen['effectsEnabled'] !== (specimen['status'] === 'ACTIVE')
    )
      r.invalid('$.specimen', 'full initial OE and resolved status', null);
    const index = composition.instanceIds.indexOf(String(specimen['symbiontInstanceId'])),
      choice = choices[index] ?? r.invalid('$.specimen', 'own selected specimen', null);
    const species = r
      .list(catalog['species'], '$.species')
      .map((raw) => r.record(raw, '$.species'))
      .find((row) => row['speciesKey'] === specimen['speciesKey']);
    if (
      choice === undefined ||
      choice.speciesKey !== specimen['speciesKey'] ||
      choice.targetLevel !== specimen['targetLevel'] ||
      species?.['name'] !== specimen['name']
    )
      r.invalid('$.specimen', 'own selected source specimen', null);
    const learned = r.list(specimen['learnedNodeRefs'], '$.nodes');
    if (
      new Set(learned).size !== learned.length ||
      choice.learnedNodeRefs.some((ref) => !learned.includes(ref))
    )
      r.invalid('$.nodes', 'distinct selected learned nodes retained', null);
    for (const ref of learned)
      if (
        !r.list(catalog['nodes'], '$.nodes').some((raw) => {
          const node = r.record(raw, '$.node');
          return node['speciesKey'] === specimen['speciesKey'] && node['nodeRef'] === ref;
        })
      )
        r.invalid('$.node', 'own species node', null);
    const histories = r.exact(
      specimen['specialHistories'],
      'devourings companions ratpack',
      '$.histories',
    );
    for (const key of Object.keys(histories))
      if (r.list(histories[key], '$.' + key).length !== 0)
        r.invalid('$.histories', 'empty initial histories', null);
  }
  if (
    new Set(specimens.map((raw) => r.record(raw, '$.specimen')['symbiontInstanceId'])).size !==
    specimens.length
  )
    r.invalid('$.specimens', 'distinct own specimens', null);
  for (const raw of r.list(row['interactions'], '$.interactions')) {
    const interaction = r.exact(raw, 'kind description', '$.interaction');
    r.oneOf(
      interaction['kind'],
      [
        'ABSORPTION',
        'DOLPHIN_LEARNED_GRANT',
        'CURRENT_OE_DUEL',
        'SPECIES_SUPPRESSION',
        'ABILITY_SUPPRESSION',
        'NATIVE_OE_CLAMP',
      ],
      '$.interaction',
    );
    r.text(interaction['description'], '$.description');
  }
  for (const raw of r.list(row['learnedRuleFacts'], '$.learnedRuleFacts')) {
    const fact = r.exact(
      raw,
      'symbiontInstanceId nodeRef ruleId name description sourceEnabled automationStatus',
      '$.learnedFact',
    );
    r.uuid(fact['symbiontInstanceId'], '$.symbiontInstanceId');
    boolean(fact['sourceEnabled']);
    for (const key of ['nodeRef', 'ruleId', 'name', 'description']) r.text(fact[key], '$.' + key);
    r.oneOf(
      fact['automationStatus'],
      ['AUTOMATED_ACCEPTED', 'NODE_ONLY_MANUAL'],
      '$.automationStatus',
    );
    const specimen =
      specimens
        .map((raw) => r.record(raw, '$.specimen'))
        .find((row) => row['symbiontInstanceId'] === fact['symbiontInstanceId']) ??
      r.invalid('$.fact', 'own selected specimen', null);
    if (
      specimen === undefined ||
      (specimen['effectsEnabled'] === false && fact['sourceEnabled'] !== false) ||
      !r.list(specimen['learnedNodeRefs'], '$.learned').includes(fact['nodeRef'])
    )
      r.invalid('$.fact', 'own learned specimen/status', null);
    if (
      !r.list(catalog['nodes'], '$.nodes').some((raw) => {
        const node = r.record(raw, '$.node');
        return (
          node['speciesKey'] === specimen['speciesKey'] &&
          node['nodeRef'] === fact['nodeRef'] &&
          node['automationStatus'] === fact['automationStatus'] &&
          r.list(node['ruleIds'], '$.ruleIds').includes(fact['ruleId'])
        );
      })
    )
      r.invalid('$.fact', 'actual learned source node/rule', null);
  }
  if (row['advisorOrNull'] !== null) {
    const advisor = r.exact(row['advisorOrNull'], 'I W capacity used skills active', '$.advisor');
    for (const key of ['I', 'W', 'capacity']) r.integer(advisor[key], '$.' + key, 1);
    r.integer(advisor['used'], '$.used', 0);
    boolean(advisor['active']);
    skills(advisor['skills']);
    const card =
      composition.acquisitions.advisorCards.find(
        (card) => card.cardId === composition.advisorCardIdOrNull,
      ) ?? r.invalid('$.advisor', 'own acquired card', null);
    if (
      card === undefined ||
      advisor['I'] !== card.iwRolls[0].mechanical.rawFace + 8 ||
      advisor['W'] !== card.iwRolls[1].mechanical.rawFace + 8 ||
      advisor['capacity'] !== Math.ceil(Number(advisor['W']) / 2)
    )
      r.invalid('$.advisor', 'original acquired I/W card', null);
    const specimen = specimens
      .map((raw) => r.record(raw, '$.specimen'))
      .find(
        (row) =>
          row['symbiontInstanceId'] === card.symbiontInstanceId && row['speciesKey'] === 'ADVISER',
      );
    if (specimen === undefined || advisor['active'] !== specimen['effectsEnabled'])
      r.invalid('$.advisor', 'actual selected card/specimen status', null);
    const used = r
      .list(advisor['skills'], '$.advisorSkills')
      .reduce<number>(
        (sum, raw) => sum + r.integer(r.record(raw, '$.skill')['slotCost'], '$.slotCost', 0),
        0,
      );
    const retained = skillState?.advisorKnowledge.find((row) => row.cardId === card.cardId);
    if (
      advisor['used'] !== used ||
      used > Number(advisor['capacity']) ||
      (composition.phase === 'CONFIRMED' && retained === undefined && used !== advisor['capacity'])
    )
      r.invalid('$.advisor', 'actual card allocation or pending acquisition', null);
    if (
      retained !== undefined &&
      !admissionJsonEqual(
        advisor['skills'],
        retained.knownSkills.map((skill) => ({
          skillKey: skill.skillKey,
          bonus: skill.bonus,
          slotCost: skill.startSlots,
        })),
      )
    )
      r.invalid('$.advisor.skills', 'retained current-plan card knowledge', null);
  }
  r.list(row['lostSkills'], '$.lostSkills').forEach((key) => r.text(key, '$.skillKey'));
  for (const key of ['temporarilyUnavailableSkills', 'temporarilyUnavailableAdvisorSkills'])
    r.list(row[key], '$.' + key).forEach((skill) => r.text(skill, '$.skillKey'));
  const start = r.exact(
    row['startSkillSlots'],
    'capacity used overflow available',
    '$.startSkillSlots',
  );
  for (const key of Object.keys(start)) r.integer(start[key], '$.startSkillSlots.' + key, 0);
  if (
    start['overflow'] !== Math.max(0, Number(start['used']) - Number(start['capacity'])) ||
    start['available'] !== Math.max(0, Number(start['capacity']) - Number(start['used']))
  )
    r.invalid('$.startSkillSlots', 'retained charges/current capacity', null);
  const pool = r.exact(row['dolphinSkillSlots'], 'capacity used', '$.dolphinPool');
  r.integer(pool['capacity'], '$.capacity', 0);
  r.integer(pool['used'], '$.used', 0);
  const plan = skillState?.planOrNull;
  if (plan == null) {
    if (Number(pool['used']) > Number(pool['capacity']))
      r.invalid('$.dolphinPool', 'source slot budget', null);
  } else {
    const paid = plan.accountingOrNull?.knownSkills ?? plan.initialSkills;
    if (
      pool['used'] !== paid.reduce((sum, skill) => sum + skill.dolphinSlots, 0) ||
      start['used'] !== paid.reduce((sum, skill) => sum + skill.startSlots, 0)
    )
      r.invalid('$.skillPools', 'actual retained plan payments, including overflow', null);
  }
  return w.validated(row);
}
export function enemyCompositionSkillBindings(value: JsonObject, skillCatalog: unknown): void {
  const known = (key: unknown) =>
    r.list(skillCatalog, '$.skills').some((raw) => r.record(raw, '$.skill')['skillKey'] === key);
  for (const key of [
    'lostSkills',
    'temporarilyUnavailableSkills',
    'temporarilyUnavailableAdvisorSkills',
  ])
    for (const skill of r.list(value[key], '$.' + key))
      if (!known(skill)) r.invalid('$.compositionFacts.' + key, 'actual source skill', null);
  if (value['advisorOrNull'] !== null)
    for (const raw of r.list(
      r.record(value['advisorOrNull'], '$.advisor')['skills'],
      '$.advisorSkills',
    ))
      if (!known(r.record(raw, '$.skill')['skillKey']))
        r.invalid('$.advisorSkills', 'actual source skill', null);
}
