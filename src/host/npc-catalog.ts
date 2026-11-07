import { createNpcOrdinaryHumanoidCatalog } from '../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import { createNpcOrdinaryStatCatalog } from '../domain/rules/npc-authoring/ordinary-stat-profile.js';
import { createNpcEquipmentCatalog } from '../domain/rules/npc-authoring/equipment-profile.js';
import { createNpcInitialTraumaCatalog } from '../domain/rules/npc-authoring/initial-trauma.js';
import { join, resolve } from 'node:path';
import { createSkillStageCatalog } from '../domain/rules/skill-stage/catalog.js';
import {
  createSymbiontCatalog,
  type SymbiontCatalogSources,
} from '../domain/rules/symbiont-stage/catalog.js';
import { createNpcBaseStatCatalog } from '../domain/rules/npc-authoring/base-stats.js';
import { createNpcDevelopmentCatalog } from '../domain/rules/npc-authoring/catalog.js';
import { createNpcInitialEffectCatalog } from '../domain/rules/npc-authoring/initial-effects.js';
import { createNpcAlcoholCodecCatalog } from '../domain/rules/npc-authoring/alcohol-effects.js';
import { createNpcCombinedHpModeCatalog } from '../domain/rules/npc-authoring/combined-hp-modes.js';
import { createNpcAlcoholPoisonResponseCatalog } from '../domain/rules/npc-authoring/alcohol-response.js';
import { createNpcFormalControlCatalog } from '../domain/rules/npc-authoring/formal-control-effects.js';
import { createNpcFormalControlCompositionCatalog } from '../domain/rules/npc-authoring/formal-control-composition.js';
import { createNpcFormalLifeCatalog } from '../domain/rules/npc-authoring/formal-life-state.js';
import { createNpcFunctionalDuplicateCatalog } from '../domain/rules/npc-authoring/functional-duplicate-composition.js';
import {
  createNpcFormalWeaverCatalog,
  type NpcFormalWeaverCatalog,
} from '../domain/rules/npc-authoring/formal-weaver-effects.js';
import { createNpcInventoryCatalog } from '../domain/rules/npc-authoring/inventory.js';
import { createNpcInventoryPublicationCatalog } from '../domain/rules/npc-authoring/inventory-publication.js';
import { createNpcHumanoidCatalog } from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import { createNpcOrdinaryCompositionCatalog } from '../domain/rules/npc-authoring/ordinary-composition.js';
import { createNpcPassiveHealthCatalog } from '../domain/rules/npc-authoring/passive-health.js';
import { createNpcSymbiontNativeCatalog } from '../domain/rules/npc-authoring/symbiont-native-profile.js';
import { createNpcUntimedDiseaseCodecCatalog } from '../domain/rules/npc-authoring/untimed-disease-effects.js';
import { createNpcCompositionConsequenceCatalog } from '../domain/rules/npc-authoring/composition-consequences.js';
import { createNpcMonsterPassiveCatalog } from '../domain/rules/npc-authoring/monster-passive-profile.js';
import { createNpcInitialMonsterCatalog } from '../domain/rules/npc-authoring/initial-monster-composition.js';
import { createNpcDiseaseCodecCatalog } from '../domain/rules/npc-authoring/periodic-disease-effects.js';
import { createNpcDiseaseUnconsciousnessCatalog } from '../domain/rules/npc-authoring/disease-unconsciousness.js';
import { createNpcLifeStateCatalog } from '../domain/rules/npc-authoring/life-state.js';
import { createNpcCleanHumanoidCatalog } from '../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import { readJsonFile } from './json-source.js';
import { loadSkillStageCatalogSources } from './skill-stage-catalog.js';
import { loadWeaponProfileCatalog } from './weapon-profile-catalog.js';
import {
  npcInitialLifeSourceAvailable,
  npcInitialPoisonSourceAvailable,
} from './npc-life-source.js';
import {
  createNpcPoisonSourceCatalog,
  type NpcPoisonSourceCatalog,
} from '../domain/rules/npc-authoring/formal-poison-source.js';
import {
  createNpcFormalPoisonCatalog,
  type NpcFormalPoisonCatalog,
} from '../domain/rules/npc-authoring/formal-poison-coating.js';

/** Immutable source components only; this type does not certify a complete NPC sheet. */
export interface NpcAuthoringSourceCatalog {
  readonly initialLifeAuthoringAvailable: boolean;
  readonly poisonSource: NpcPoisonSourceCatalog | null;
  readonly poisonCoatings: NpcFormalPoisonCatalog | null;
  readonly alcoholEffects: ReturnType<typeof createNpcAlcoholCodecCatalog>;
  readonly hpModes: ReturnType<typeof createNpcCombinedHpModeCatalog>;
  readonly alcoholPoisonResponse: ReturnType<typeof createNpcAlcoholPoisonResponseCatalog>;
  readonly formalControls: ReturnType<typeof createNpcFormalControlCatalog>;
  readonly formalControlComposition: ReturnType<typeof createNpcFormalControlCompositionCatalog>;
  readonly formalLife: ReturnType<typeof createNpcFormalLifeCatalog>;
  readonly functionalDuplicate: ReturnType<typeof createNpcFunctionalDuplicateCatalog>;
  readonly formalWeaver: NpcFormalWeaverCatalog | null;
  readonly equipment: ReturnType<typeof createNpcEquipmentCatalog>;
  readonly ordinaryHumanoid: ReturnType<typeof createNpcOrdinaryHumanoidCatalog>;
  readonly classLabels: Readonly<Record<string, string>>;
  readonly initialTrauma: ReturnType<typeof createNpcInitialTraumaCatalog>;
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
  readonly initialMonsters: ReturnType<typeof createNpcInitialMonsterCatalog>;
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
    combinationRules,
    forms,
    immunities,
    effectGaps,
    itemDictionaries,
    abilityContexts,
    itemOperations,
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
    read('effects/combination-rules.json'),
    read('atlas/forms-by-id.json'),
    read('effects/immunities.json'),
    read('effects/gaps.json'),
    read('items/dictionaries.json'),
    read('character/ability-contexts.json'),
    read('items/operations.json'),
  ]);
  if (forms === null || typeof forms !== 'object' || Array.isArray(forms))
    throw new Error('NPC source catalog: forms object required');
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
  const monsterPassives = createNpcMonsterPassiveCatalog(symbionts, nativeSymbionts, rules);
  const initialMonsters = createNpcInitialMonsterCatalog(monsterPassives, symbiontRows);
  const skills = createSkillStageCatalog(skillSources);
  const ordinaryComposition = createNpcOrdinaryCompositionCatalog(
    symbionts,
    development,
    nativeSymbionts,
    rules,
    initialMonsters,
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
  const inventory = createNpcInventoryCatalog(catalogue, armor, pharmaceuticals, weapons, {
    instanceModel,
    dictionaries: itemDictionaries,
  });
  const inventoryPublication = createNpcInventoryPublicationCatalog(inventory, {
    instanceModel,
    weaponFields,
    customItemForm: (forms as Record<string, unknown>)['NPC-015'],
  });
  const ordinaryHumanoid = createNpcOrdinaryHumanoidCatalog(
    {
      baseStats,
      symbionts,
      compositionConsequences,
      cleanHumanoid,
      skills,
      passiveHealth,
      initialMonsters,
      equipment: { inventory, publication: inventoryPublication },
    },
    { rules },
  );
  const equipment = createNpcEquipmentCatalog(
    {
      inventory,
      publication: inventoryPublication,
      baseStats,
      ordinaryStats: createNpcOrdinaryStatCatalog(
        {
          baseStats,
          symbionts,
          compositionConsequences,
          initialMonsters,
          equipment: { inventory, publication: inventoryPublication },
        },
        rules,
      ),
    },
    rules,
  );
  const diseaseUnconsciousness = createNpcDiseaseUnconsciousnessCatalog(diseaseEffects, {
    rules,
    capabilityProfiles,
  });
  const initialTrauma = createNpcInitialTraumaCatalog({
    rules,
    combinationRules,
    runtimeContracts: effectRuntime,
    timerPolicies,
    npc016: (forms as Record<string, unknown>)['NPC-016'],
  });
  const alcoholEffects = createNpcAlcoholCodecCatalog(initialEffects, {
    effectTypes,
    runtimeContracts: effectRuntime,
    timerPolicies,
    npc016: (forms as Record<string, unknown>)['NPC-016'],
  });
  const hpModes = createNpcCombinedHpModeCatalog({
    native: nativeSymbionts,
    monsters: monsterPassives,
    rules,
    effectTypes,
    runtimeContracts: effectRuntime,
    timerPolicies,
    npc016: (forms as Record<string, unknown>)['NPC-016'],
  });
  const alcoholPoisonResponse = createNpcAlcoholPoisonResponseCatalog({
    compositionConsequences,
    immunities,
    rules,
  });
  const formalControls = createNpcFormalControlCatalog({
    rules,
    effectTypes,
    capabilityProfiles,
    pharmaceuticals,
    runtimeContracts: effectRuntime,
    gaps: effectGaps,
    timerPolicies,
  });
  const formalControlComposition = createNpcFormalControlCompositionCatalog({
    compositionConsequences,
    immunities,
    capabilityProfiles,
    rules,
  });
  const formalLife = createNpcFormalLifeCatalog({
    rules,
    effectTypes,
    timerPolicies,
    capabilityProfiles,
    gaps: effectGaps,
    runtimeContracts: effectRuntime,
  });
  const functionalDuplicate = createNpcFunctionalDuplicateCatalog({
    compositionConsequences,
    rules,
    developmentNodes: nodes,
  });
  const initialLifeAuthoringAvailable = npcInitialLifeSourceAvailable(
    (forms as Record<string, unknown>)['NPC-016'],
  );
  const formalWeaver = initialLifeAuthoringAvailable
    ? createNpcFormalWeaverCatalog({
        compositionConsequences,
        rules,
        developmentNodes: nodes,
        abilityContexts,
        effectTypes,
        npcInitialStateForm: (forms as Record<string, unknown>)['NPC-016'],
      })
    : null;
  const poisonSource = npcInitialPoisonSourceAvailable(
    (forms as Record<string, unknown>)['NPC-016'],
  )
    ? createNpcPoisonSourceCatalog({
        compositionConsequences,
        rules,
        developmentNodes: nodes,
        poisonProfiles: poisons,
        effectTypes,
        npcInitialStateForm: (forms as Record<string, unknown>)['NPC-016'],
      })
    : null;
  const poisonCoatings =
    poisonSource === null
      ? null
      : createNpcFormalPoisonCatalog(
          { source: poisonSource, publication: inventoryPublication },
          { poisons, operations: itemOperations },
        );
  const humanoid = createNpcHumanoidCatalog(
    {
      cleanHumanoid,
      ordinaryHumanoid,
      inventoryPublication,
      equipment,
      diseaseEffects,
      diseaseUnconsciousness,
      skills,
      initialTrauma,
      life: { formalLife, functionalDuplicate, formalWeaver },
      ...(poisonSource === null ? {} : { poisonSource }),
      runtimeEffects: {
        alcohol: alcoholEffects,
        hpModes,
        poisonResponse: alcoholPoisonResponse,
        formalControls,
        formalControlComposition,
      },
    },
    { characterDictionaries, characterRuntime },
  );
  if (!Array.isArray(skillSources.classes))
    throw new Error('NPC source catalog: class rows required');
  const classRows: unknown[] = skillSources.classes;
  const classLabels = Object.freeze(
    Object.fromEntries(
      skills.classes.map((c) => {
        const matches = classRows.filter(
          (r: unknown) =>
            r !== null &&
            typeof r === 'object' &&
            (r as Record<string, unknown>)['ClassCode'] === c.classCode,
        );
        if (matches.length !== 1) throw new Error('NPC source catalog: exact class label required');
        const label: unknown = (matches[0] as Record<string, unknown>)['Название'];
        if (typeof label !== 'string' || label.trim() === '')
          throw new Error('NPC source catalog: invalid class label');
        return [c.classCode, label];
      }),
    ),
  );
  return Object.freeze({
    alcoholEffects,
    hpModes,
    alcoholPoisonResponse,
    formalControls,
    formalControlComposition,
    initialLifeAuthoringAvailable,
    poisonSource,
    poisonCoatings,
    formalLife,
    functionalDuplicate,
    formalWeaver,
    equipment,
    classLabels,
    initialTrauma,
    cleanHumanoid,
    ordinaryHumanoid,
    inventoryPublication,
    humanoid,
    skills,
    baseStats,
    symbionts,
    development,
    nativeSymbionts,
    ordinaryComposition,
    compositionConsequences,
    monsterPassives,
    initialMonsters,
    initialEffects,
    nonperiodicDiseases,
    diseaseEffects,
    diseaseUnconsciousness,
    baseLifeState: createNpcLifeStateCatalog({ rules, effectTypes, timerPolicies }),
    passiveHealth,
    inventory,
  });
}
