import { join, resolve } from 'node:path';
import { createSkillStageCatalog } from '../domain/rules/skill-stage/catalog.js';
import {
  createSymbiontCatalog,
  type SymbiontCatalogSources,
} from '../domain/rules/symbiont-stage/catalog.js';
import { createNpcBaseStatCatalog } from '../domain/rules/npc-authoring/base-stats.js';
import { createNpcDevelopmentCatalog } from '../domain/rules/npc-authoring/catalog.js';
import { createNpcInitialEffectCatalog } from '../domain/rules/npc-authoring/initial-effects.js';
import { createNpcInventoryCatalog } from '../domain/rules/npc-authoring/inventory.js';
import { createNpcInventoryPublicationCatalog } from '../domain/rules/npc-authoring/inventory-publication.js';
import { createNpcHumanoidCatalog } from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import { createNpcOrdinaryCompositionCatalog } from '../domain/rules/npc-authoring/ordinary-composition.js';
import { createNpcPassiveHealthCatalog } from '../domain/rules/npc-authoring/passive-health.js';
import { createNpcSymbiontNativeCatalog } from '../domain/rules/npc-authoring/symbiont-native-profile.js';
import { createNpcUntimedDiseaseCodecCatalog } from '../domain/rules/npc-authoring/untimed-disease-effects.js';
import { createNpcCompositionConsequenceCatalog } from '../domain/rules/npc-authoring/composition-consequences.js';
import { createNpcMonsterPassiveCatalog } from '../domain/rules/npc-authoring/monster-passive-profile.js';
import { createNpcDiseaseCodecCatalog } from '../domain/rules/npc-authoring/periodic-disease-effects.js';
import { createNpcDiseaseUnconsciousnessCatalog } from '../domain/rules/npc-authoring/disease-unconsciousness.js';
import { createNpcLifeStateCatalog } from '../domain/rules/npc-authoring/life-state.js';
import { createNpcCleanHumanoidCatalog } from '../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import { readJsonFile } from './json-source.js';
import { loadSkillStageCatalogSources } from './skill-stage-catalog.js';
import { loadWeaponProfileCatalog } from './weapon-profile-catalog.js';

/** Immutable source components only; this type does not certify a complete NPC sheet. */
export interface NpcAuthoringSourceCatalog {
  readonly inventoryPublication: ReturnType<typeof createNpcInventoryPublicationCatalog>;
  readonly humanoid: ReturnType<typeof createNpcHumanoidCatalog>;
  readonly cleanHumanoid: ReturnType<typeof createNpcCleanHumanoidCatalog>;
  readonly skills: ReturnType<typeof createSkillStageCatalog>;
  readonly baseStats: ReturnType<typeof createNpcBaseStatCatalog>;
  readonly symbionts: ReturnType<typeof createSymbiontCatalog>;
  readonly development: ReturnType<typeof createNpcDevelopmentCatalog>;
  readonly nativeSymbionts: ReturnType<typeof createNpcSymbiontNativeCatalog>;
  readonly ordinaryComposition: ReturnType<typeof createNpcOrdinaryCompositionCatalog>;
  readonly compositionConsequences: ReturnType<typeof createNpcCompositionConsequenceCatalog>;
  readonly monsterPassives: ReturnType<typeof createNpcMonsterPassiveCatalog>;
  readonly diseaseUnconsciousness: ReturnType<typeof createNpcDiseaseUnconsciousnessCatalog>;
  readonly diseaseEffects: ReturnType<typeof createNpcDiseaseCodecCatalog>;
  readonly initialEffects: ReturnType<typeof createNpcInitialEffectCatalog>;
  readonly nonperiodicDiseases: ReturnType<typeof createNpcUntimedDiseaseCodecCatalog>;
  readonly baseLifeState: ReturnType<typeof createNpcLifeStateCatalog>;
  readonly passiveHealth: ReturnType<typeof createNpcPassiveHealthCatalog>;
  readonly inventory: ReturnType<typeof createNpcInventoryCatalog>;
}

/** Load once at host initialization; no file reads belong inside the NPC SQL transaction. */
export async function loadNpcAuthoringSourceCatalog(
  projectRoot: string,
): Promise<NpcAuthoringSourceCatalog> {
  const root = resolve(projectRoot);
  const read = (path: string): Promise<unknown> =>
    readJsonFile(join(root, 'generated', 'spec', path), 'NPC source catalog');
  const [
    skillSources,
    symbiontRows,
    incompatibilities,
    nodes,
    levels,
    rules,
    characterRuntime,
    diseases,
    poisons,
    timerPolicies,
    effectTypes,
    effectOperations,
    effectRuntime,
    capabilityProfiles,
    catalogue,
    armor,
    pharmaceuticals,
    weapons,
    instanceModel,
    weaponFields,
    characterDictionaries,
  ] = await Promise.all([
    loadSkillStageCatalogSources(root),
    read('character/symbionts.json'),
    read('character/incompatibilities.json'),
    read('character/development-nodes.json'),
    read('character/symbiont-levels.json'),
    read('rules/rules.json'),
    read('character/runtime-contracts.json'),
    read('effects/diseases.json'),
    read('effects/poisons.json'),
    read('effects/timer-policies.json'),
    read('effects/effect-types.json'),
    read('effects/operations.json'),
    read('effects/runtime-contracts.json'),
    read('effects/capability-profiles.json'),
    read('items/catalogue.json'),
    read('items/armor-profiles.json'),
    read('items/pharmaceuticals.json'),
    loadWeaponProfileCatalog(root),
    read('items/instance-model.json'),
    read('items/weapon-fields.json'),
    read('character/dictionaries.json'),
  ]);
  if (!Array.isArray(rules)) throw new Error('NPC source catalog: expected imported rule rows');
  const manualStatRules = rules.filter(
    (row: unknown) =>
      row !== null &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      (row as Record<string, unknown>)['Rule ID'] === 'CORE-078',
  );
  if (manualStatRules.length !== 1)
    throw new Error('NPC source catalog: expected exactly one CORE-078 rule');
  const symbiontSources: SymbiontCatalogSources = {
    ...skillSources,
    symbionts: symbiontRows,
    incompatibilities,
  };
  const symbionts = createSymbiontCatalog(symbiontSources);
  const development = createNpcDevelopmentCatalog(symbionts.species, nodes, levels);
  const initialEffects = createNpcInitialEffectCatalog({ diseases, poisons, timerPolicies, rules });
  const nativeSymbionts = createNpcSymbiontNativeCatalog(symbionts, development, rules);
  const skills = createSkillStageCatalog(skillSources);
  const ordinaryComposition = createNpcOrdinaryCompositionCatalog(
    symbionts,
    development,
    nativeSymbionts,
    rules,
  );
  const nonperiodicDiseases = createNpcUntimedDiseaseCodecCatalog(initialEffects, {
    diseases,
    effectTypes,
    operations: effectOperations,
  });
  const diseaseEffects = createNpcDiseaseCodecCatalog(nonperiodicDiseases, {
    diseases,
    timerPolicies,
    runtimeContracts: effectRuntime,
  });
  const baseStats = createNpcBaseStatCatalog(skillSources, manualStatRules[0]);
  const compositionConsequences = createNpcCompositionConsequenceCatalog(
    ordinaryComposition,
    skills,
    rules,
  );
  const passiveHealth = createNpcPassiveHealthCatalog({
    rules,
    symbiontSources,
    developmentNodes: nodes,
    characterRuntime,
  });
  const cleanHumanoid = createNpcCleanHumanoidCatalog(
    { baseStats, skills, compositionConsequences, passiveHealth },
    { capabilityProfiles, effectRuntimeFields: effectRuntime, rules, characterRuntime },
  );
  const inventory = createNpcInventoryCatalog(catalogue, armor, pharmaceuticals, weapons);
  const inventoryPublication = createNpcInventoryPublicationCatalog(inventory, {
    instanceModel,
    weaponFields,
  });
  const diseaseUnconsciousness = createNpcDiseaseUnconsciousnessCatalog(diseaseEffects, {
    rules,
    capabilityProfiles,
  });
  const humanoid = createNpcHumanoidCatalog(
    { cleanHumanoid, inventoryPublication, diseaseEffects, diseaseUnconsciousness, skills },
    { characterDictionaries, characterRuntime },
  );
  return Object.freeze({
    cleanHumanoid,
    inventoryPublication,
    humanoid,
    skills,
    baseStats,
    symbionts,
    development,
    nativeSymbionts,
    ordinaryComposition,
    compositionConsequences,
    monsterPassives: createNpcMonsterPassiveCatalog(symbionts, nativeSymbionts, rules),
    initialEffects,
    nonperiodicDiseases,
    diseaseEffects,
    diseaseUnconsciousness,
    baseLifeState: createNpcLifeStateCatalog({ rules, effectTypes, timerPolicies }),
    passiveHealth,
    inventory,
  });
}
