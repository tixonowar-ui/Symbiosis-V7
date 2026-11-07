import { npcPublicationData as data } from './inventory-publication.js';
import {
  deriveNpcMonsterPassiveProfile,
  type NpcMonsterPassiveCatalog,
} from './monster-passive-profile.js';

declare const initialMonsterCatalog: unique symbol;
export interface NpcInitialMonsterCatalog {
  readonly [initialMonsterCatalog]: true;
}
const catalogs = new WeakMap<NpcInitialMonsterCatalog, NpcMonsterPassiveCatalog>();
const MONSTERS = ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'] as const;
function fail(detail: string): never {
  throw new Error(`NPC initial monster composition: ${detail}`);
}

/** The initial zero is explicit in the source; no GM thresholds or devouring leaves are invented. */
export function createNpcInitialMonsterCatalog(
  passives: NpcMonsterPassiveCatalog,
  characterSymbionts: unknown,
): NpcInitialMonsterCatalog {
  const rows = data.array(characterSymbionts).map((row) => data.record(row));
  for (const key of MONSTERS) {
    const found = rows.filter((row) => row.SpeciesKey === key);
    if (found.length !== 1) return fail(`one source row required for ${key}`);
    const source = found[0]!;
    data.equal('ACTIVE', source.Status);
    data.equal('SYMBIOTIC_MONSTER', source.SymbiontKind);
    data.equal('UNITED', source.AllowedRaceCodes);
    data.equal(4, source.SlotCost);
    data.equal(
      key === 'CHIMERA'
        ? 'ONLY_CONFIRMED_DEVOURING; initial extraSlots=0; explicit devouringHistory; max +3'
        : 'ORDINARY_ADDITIONAL_SYMBIONTS_FORBIDDEN',
      source.AdditionalSlotPolicy,
    );
  }
  const catalog = Object.freeze({}) as NpcInitialMonsterCatalog;
  catalogs.set(catalog, passives);
  return catalog;
}

/** Only the closed initial-authoring branch; an actual MON-007 history requires its own owner. */
export function deriveNpcInitialMonsterProfile(catalog: NpcInitialMonsterCatalog, input: unknown) {
  const passives = catalogs.get(catalog) ?? fail('issued initial-monster catalog required');
  const profile = deriveNpcMonsterPassiveProfile(passives, input);
  return data.freeze({ ...profile, initialExtraSlots: 0 as const });
}
