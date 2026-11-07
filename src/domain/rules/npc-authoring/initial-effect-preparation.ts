import type { StatBlock } from '../skill-stage/stats.js';
import { deriveNpcBaseStatLayers, type NpcBaseStatCatalog } from './base-stats.js';
import {
  evaluateNpcCompositionConsequences,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import {
  deriveNpcOrdinaryStatProfile,
  deriveNpcOrdinaryHpModeSource,
  type NpcOrdinaryHumanoidCatalog,
} from './npc-ordinary-humanoid-sheet.js';
import {
  deriveNpcEquipmentPreparationProfile,
  type NpcEquipmentCatalog,
} from './equipment-profile.js';
import {
  previewNpcDiseaseEquippedStatContribution,
  type NpcDiseaseUnconsciousnessCatalog,
} from './disease-unconsciousness.js';
import {
  deriveNpcAlcoholPoisonResponse,
  type NpcAlcoholPoisonResponseCatalog,
} from './alcohol-response.js';
import {
  buildNpcInventoryPhysicalBasis,
  readNpcInventoryPhysicalBasis,
  npcPublicationData as data,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationContext,
} from './inventory-publication.js';
import type {
  NpcHumanoidEquipmentContext,
  NpcHumanoidEquipmentProof,
} from './npc-humanoid-sheet.js';
import { readNpcHpModeStatProfile, type NpcHpModeStatProfile } from './combined-hp-modes.js';

export interface NpcInitialEffectPreparationComponents {
  readonly baseStats: NpcBaseStatCatalog;
  readonly compositionConsequences: NpcCompositionConsequenceCatalog;
  readonly ordinaryHumanoid: NpcOrdinaryHumanoidCatalog;
  readonly inventoryPublication: NpcInventoryPublicationCatalog;
  readonly equipment: NpcEquipmentCatalog;
  readonly diseaseUnconsciousness: NpcDiseaseUnconsciousnessCatalog;
  readonly alcoholPoisonResponse: NpcAlcoholPoisonResponseCatalog;
}
export interface NpcInitialEffectPreparationInput {
  readonly npcUuid: string;
  readonly schema: unknown;
  readonly baseStats: unknown;
  readonly compositionProof: unknown;
  readonly ordinaryProofOrNull: unknown;
  readonly inventoryRequests: unknown;
  readonly diseaseAssignments: unknown;
  readonly equipmentProofOrNull: NpcHumanoidEquipmentProof | null;
  readonly equipmentContextOrNull: NpcHumanoidEquipmentContext | null;
}
export interface NpcInitialEffectPreparation {
  readonly effectiveStats: StatBlock;
  readonly poisonResponse: 'APPLICABLE' | 'IMMUNE';
}
const preparations = new WeakMap<
  NpcInitialEffectPreparation,
  Readonly<{
    input: NpcInitialEffectPreparationInput;
    modes: NpcHpModeStatProfile | null;
    inventoryContext: NpcInventoryPublicationContext | null;
  }>
>();
/** An issued basis is valid for this exact current input, never for a copied or later selection. */
export function readNpcInitialEffectPreparation(
  value: unknown,
  expectedInput: NpcInitialEffectPreparationInput,
  expectedModes: NpcHpModeStatProfile | null = null,
  expectedInventoryContext: NpcInventoryPublicationContext | null = null,
): NpcInitialEffectPreparation {
  if (value === null || typeof value !== 'object')
    throw new Error('NPC initial effect preparation: issued basis required');
  const result = value as NpcInitialEffectPreparation;
  const binding = preparations.get(result);
  if (binding === undefined)
    throw new Error('NPC initial effect preparation: issued basis required');
  data.equal(binding.input, expectedInput);
  data.equal(binding.inventoryContext, expectedInventoryContext);
  data.equal(
    binding.modes,
    expectedModes === null ? null : readNpcHpModeStatProfile(expectedModes),
  );
  return result;
}
/** This calculation does not read HP or execute an effect; preparations can precede HP validation. */
export function deriveNpcInitialEffectPreparation(
  components: NpcInitialEffectPreparationComponents,
  input: NpcInitialEffectPreparationInput,
  modes: NpcHpModeStatProfile | null = null,
  inventoryContext: NpcInventoryPublicationContext | null = null,
): NpcInitialEffectPreparation {
  data.record(input, [
    'npcUuid',
    'schema',
    'baseStats',
    'compositionProof',
    'ordinaryProofOrNull',
    'inventoryRequests',
    'diseaseAssignments',
    'equipmentProofOrNull',
    'equipmentContextOrNull',
  ]);
  const npcUuid = data.uuid(input.npcUuid);
  const base = deriveNpcBaseStatLayers(components.baseStats, {
    schema: input.schema,
    baseStats: input.baseStats,
  });
  const composition = evaluateNpcCompositionConsequences(
    components.compositionConsequences,
    input.compositionProof,
    null,
  );
  data.equal(npcUuid, composition.proof.identityKey);
  data.equal(base.schema.raceCode, composition.composition.raceCode);
  if (composition.obligationStatus !== 'RESOLVED')
    throw new Error('NPC initial effect preparation: unresolved composition');
  const physicalInventoryBasis = buildNpcInventoryPhysicalBasis(
    components.inventoryPublication,
    input.inventoryRequests,
    inventoryContext,
  );
  const inventory = readNpcInventoryPhysicalBasis(
    components.inventoryPublication,
    physicalInventoryBasis,
  );
  if (inventoryContext !== null)
    for (const previous of inventoryContext.history) data.equal(npcUuid, previous.npcUuid);
  const hasEquipped = inventory.items.some((item) => item.request.equipped);
  const hasActiveCustomItem = inventory.itemContribution.items.some((item) => item.active);
  if (input.ordinaryProofOrNull === null) {
    data.equal(null, modes);
    data.equal('PURE', base.schema.raceCode);
    data.equal([], composition.proof.confirmations);
    data.equal([], composition.proof.resolutions);
    data.equal([], composition.composition.instances);
  } else {
    const ordinary = deriveNpcOrdinaryStatProfile(components.ordinaryHumanoid, {
      npcUuid,
      compositionProof: input.compositionProof,
      ordinaryProof: input.ordinaryProofOrNull,
    });
    data.equal(base.schema, ordinary.current.schema);
    data.equal(base.baseStats, ordinary.current.stats.baseStats);
    if (modes !== null)
      data.equal(deriveNpcOrdinaryHpModeSource(ordinary), readNpcHpModeStatProfile(modes).source);
    const current = ordinary.ordinaryProof.statContexts.at(-1);
    if (current === undefined)
      throw new Error('NPC initial effect preparation: actual stat confirmation required');
    if (hasEquipped || hasActiveCustomItem || Object.hasOwn(current, 'equippedInventory'))
      data.equal(inventory.requests, current.equippedInventory);
  }
  const proof = input.equipmentProofOrNull;
  if (proof !== null) data.record(proof, ['compatibilityProofOrNull']);
  const equipment = deriveNpcEquipmentPreparationProfile(components.equipment, {
    npcUuid,
    statInput: {
      schema: input.schema,
      baseStats: input.baseStats,
      ...(base.schema.raceCode === 'PURE' ? {} : { compositionProof: input.compositionProof }),
    },
    physicalInventoryBasis,
    compatibilityProofOrNull: proof?.compatibilityProofOrNull ?? null,
  });
  if (equipment.compatibilityRequired)
    throw new Error('NPC initial effect preparation: physical armor compatibility required');
  if (equipment.compatibilityProofOrNull !== null) {
    const context = input.equipmentContextOrNull;
    if (context === null)
      throw new Error('NPC initial effect preparation: independent compatibility origin required');
    data.record(context, ['npcUuid', 'confirmations']);
    data.equal(npcUuid, data.uuid(context.npcUuid));
    const matches = data
      .array(context.confirmations)
      .filter(
        (entry) =>
          data.record(entry).confirmationId === equipment.compatibilityProofOrNull?.confirmationId,
      );
    if (matches.length !== 1)
      throw new Error('NPC initial effect preparation: unique compatibility origin required');
    data.equal(equipment.compatibilityProofOrNull, matches[0]);
  } else if (input.equipmentContextOrNull !== null) {
    data.record(input.equipmentContextOrNull, ['npcUuid', 'confirmations']);
    data.equal(npcUuid, data.uuid(input.equipmentContextOrNull.npcUuid));
    data.equal([], input.equipmentContextOrNull.confirmations);
  }
  const disease = previewNpcDiseaseEquippedStatContribution(
    components.diseaseUnconsciousness,
    {
      assignments: input.diseaseAssignments,
      equipmentProfile: equipment,
    },
    modes,
  );
  const result = data.freeze({
    effectiveStats: disease.contribution.effectiveStats,
    poisonResponse: deriveNpcAlcoholPoisonResponse(
      components.alcoholPoisonResponse,
      input.compositionProof,
    ),
  });
  preparations.set(result, data.freeze(structuredClone({ input, modes, inventoryContext })));
  return result;
}
