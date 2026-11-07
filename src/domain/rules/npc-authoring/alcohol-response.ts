import {
  evaluateNpcCompositionConsequences,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import { npcPublicationData as data } from './inventory-publication.js';

export interface NpcAlcoholPoisonResponseCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_ALCOHOL_RESPONSE';
}
const catalogs = new WeakMap<NpcAlcoholPoisonResponseCatalog, NpcCompositionConsequenceCatalog>();
function fail(detail: string): never {
  throw new Error(`NPC alcohol response: ${detail}`);
}
export function createNpcAlcoholPoisonResponseCatalog(
  source: Readonly<{
    compositionConsequences: NpcCompositionConsequenceCatalog;
    immunities: unknown;
    rules: unknown;
  }>,
): NpcAlcoholPoisonResponseCatalog {
  data.record(source, ['compositionConsequences', 'immunities', 'rules']);
  const responses = data.array(source.immunities).map((r) => data.record(r));
  const toad = responses.filter((r) => r.ResponseProfileID === 'RSP-TOAD-SYMBIONT-POISON');
  data.equal(
    [
      {
        'Blocked payload': 'poison damage and poison CONTROL-tagged effects',
        'Effect family': 'POISON_OR_DECOCTION',
        'Existing effect policy / note': 'SYM-042 stat debuff is not blocked',
        Modifier: '—',
        Provider: 'SYM:TOAD',
        Response: 'IMMUNE_DAMAGE_AND_CONTROL',
        ResponseProfileID: 'RSP-TOAD-SYMBIONT-POISON',
        'Rule refs': 'SYM-144',
        'Source scope': 'ANY',
      },
    ],
    toad,
  );
  const rules = data.array(source.rules).map((r) => data.record(r));
  const rule = rules.filter((r) => r['Rule ID'] === 'SYM-144' && r['Статус'] === 'Активно');
  if (rule.length !== 1) return fail('exact active SYM-144 source required');
  data.equal(
    'отменить урон от яда; отменить эффекты контроля, вызванные ядами или отварами, включая обезболивание.',
    rule[0]!['Итоговый алгоритм'],
  );
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_ALCOHOL_RESPONSE' as const });
  catalogs.set(catalog, source.compositionConsequences);
  return catalog;
}

/** Only the complete supported composition can establish absence of an applicable immunity. */
export function deriveNpcAlcoholPoisonResponse(
  catalog: NpcAlcoholPoisonResponseCatalog,
  compositionProof: unknown,
): 'APPLICABLE' | 'IMMUNE' {
  const source = catalogs.get(catalog) ?? fail('issued source catalog required');
  const composition = evaluateNpcCompositionConsequences(source, compositionProof, null);
  if (composition.obligationStatus !== 'RESOLVED') return fail('complete composition required');
  // SYM-144 blocks the entire CORE-110 damage payload, not arbitrary poison stat debuffs.
  // Sealed Nate excludes ingested poison; Taipan self-poison immunity is not alcohol immunity.
  return composition.composition.instances.some(
    (instance) =>
      instance.speciesKey === 'TOAD' &&
      instance.effectsEnabled &&
      instance.learnedNodeRefs.includes('SYM-144'),
  )
    ? 'IMMUNE'
    : 'APPLICABLE';
}
