import {
  evaluateNpcCompositionConsequences,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import { npcPublicationData as data } from './inventory-publication.js';
import type { NpcAdvisorCard } from './types.js';

export interface NpcFormalControlCompositionCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_FORMAL_CONTROL_COMPOSITION';
}
export interface NpcFormalControlComposition {
  readonly npcUuid: string;
  readonly poisonControlResponse: 'APPLICABLE' | 'IMMUNE';
  /** Availability only. Physical incapacity and an external controller still take precedence. */
  readonly automaticAdviserOrNull: Readonly<{
    cardId: string;
    symbiontInstanceId: string;
    sourceRuleId: 'SYM-100';
    iw: NpcAdvisorCard['iw'];
    skills: NpcAdvisorCard['skills'];
  }> | null;
}
const catalogs = new WeakMap<
  NpcFormalControlCompositionCatalog,
  NpcCompositionConsequenceCatalog
>();
const issued = new WeakSet<NpcFormalControlComposition>();
function fail(detail: string): never {
  throw new Error(`NPC formal control composition: ${detail}`);
}
function row(value: unknown, key: string, id: string) {
  const matches = data
    .array(value)
    .map((entry) => data.record(entry))
    .filter((entry) => entry[key] === id);
  return matches.length === 1 ? matches[0]! : fail(`exact source ${id} required`);
}
export function createNpcFormalControlCompositionCatalog(
  source: Readonly<{
    compositionConsequences: NpcCompositionConsequenceCatalog;
    immunities: unknown;
    capabilityProfiles: unknown;
    rules: unknown;
  }>,
): NpcFormalControlCompositionCatalog {
  data.record(source, ['compositionConsequences', 'immunities', 'capabilityProfiles', 'rules']);
  const immunity = row(source.immunities, 'ResponseProfileID', 'RSP-TOAD-SYMBIONT-POISON');
  for (const [key, expected] of Object.entries({
    Provider: 'SYM:TOAD',
    'Effect family': 'POISON_OR_DECOCTION',
    'Source scope': 'ANY',
    Response: 'IMMUNE_DAMAGE_AND_CONTROL',
    'Blocked payload': 'poison damage and poison CONTROL-tagged effects',
    'Rule refs': 'SYM-144',
  }))
    data.equal(expected, immunity[key]);
  for (const [id, expected] of [
    [
      'SYM-144',
      'отменить урон от яда; отменить эффекты контроля, вызванные ядами или отварами, включая обезболивание.',
    ],
    [
      'SYM-100',
      'автоматически передать управление Советнику без расхода ОЭ до возвращения ясного сознания носителя.',
    ],
  ] as const) {
    const actual = row(source.rules, 'Rule ID', id);
    data.equal('Активно', actual['Статус']);
    data.equal(expected, actual['Итоговый алгоритм']);
  }
  const adviser = row(source.rules, 'Rule ID', 'SYM-100');
  data.equal('тело физически дееспособно; Советник активен.', adviser['Предусловия']);
  data.equal(
    'носитель оглушён, уснул/потерял сознание, самоконтроль либо ментальный контроль.',
    adviser['Runtime-триггер'],
  );
  data.equal(
    'не действует при тяжёлом ранении, физическом параличе, разрушении нужных органов или полном обездвиживании.',
    adviser['Исключения / приоритет'],
  );
  for (const [id, controller, mental, physical] of [
    ['PRF-ADVISOR-UNCONSCIOUS', 'Advisor', 'YES', 'YES_IF_BODY_CAPABLE'],
    ['PRF-ADVISOR-PARALYZED', 'owningController', 'CONDITIONAL', 'NO'],
  ] as const) {
    const profile = row(source.capabilityProfiles, 'ProfileID', id);
    data.equal('DEFINED', profile.Status);
    data.equal(controller, profile['Контроллер']);
    data.equal(mental, profile['Ментальные действия']);
    data.equal(physical, profile['Физические действия']);
  }
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_FORMAL_CONTROL_COMPOSITION' as const });
  catalogs.set(catalog, source.compositionConsequences);
  return catalog;
}
/** Replays complete real source membership and the independent Advisor acquisition/skill facts. */
export function deriveNpcFormalControlComposition(
  catalog: NpcFormalControlCompositionCatalog,
  compositionProof: unknown,
): NpcFormalControlComposition {
  const source = catalogs.get(catalog) ?? fail('issued source catalog required');
  const result = evaluateNpcCompositionConsequences(source, compositionProof, null);
  if (result.obligationStatus !== 'RESOLVED') return fail('complete current composition required');
  const active = (species: string, node: string) =>
    result.composition.instances.find(
      (instance) =>
        instance.speciesKey === species &&
        instance.effectsEnabled &&
        instance.learnedNodeRefs.includes(node),
    );
  const adviser = active('ADVISER', 'SYM-100');
  const card =
    adviser === undefined
      ? null
      : result.advisorContinuations.find(
          (entry) => entry.symbiontInstanceId === adviser.symbiontInstanceId,
        );
  if (adviser !== undefined && (card == null || card.skillsOrNull === null))
    return fail('actual Advisor personality and skill history required');
  const composition: NpcFormalControlComposition = data.freeze({
    npcUuid: data.uuid(result.proof.identityKey),
    poisonControlResponse: active('TOAD', 'SYM-144') === undefined ? 'APPLICABLE' : 'IMMUNE',
    automaticAdviserOrNull:
      card == null || card.skillsOrNull === null
        ? null
        : {
            cardId: card.cardId,
            symbiontInstanceId: card.symbiontInstanceId,
            sourceRuleId: 'SYM-100',
            iw: card.iw,
            skills: card.skillsOrNull,
          },
  });
  issued.add(composition);
  return composition;
}
export function readNpcFormalControlComposition(value: unknown): NpcFormalControlComposition {
  if (
    value === null ||
    typeof value !== 'object' ||
    !issued.has(value as NpcFormalControlComposition)
  )
    return fail('issued actual composition required');
  return value as NpcFormalControlComposition;
}
