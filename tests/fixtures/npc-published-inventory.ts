import type { NpcInventoryRequestEntry } from '../../src/domain/rules/npc-authoring/inventory.js';
import {
  buildNpcInventoryPublication,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationProof,
} from '../../src/domain/rules/npc-authoring/inventory-publication.js';
import type { NpcCleanHumanoidBuildInput } from '../../src/domain/rules/npc-authoring/clean-humanoid-sheet.js';
import type { NpcHumanoidBuildInput } from '../../src/domain/rules/npc-authoring/npc-humanoid-sheet.js';

/** The real source Kensi is an explicit fixture, not the complete inventory feature's allowlist. */
export function npcKensiRequest(itemInstanceId: string): NpcInventoryRequestEntry {
  return {
    itemInstanceId,
    itemTypeId: 'ITM-WPN-003',
    quantity: 1,
    profile: { kind: 'CATALOG' },
    equipped: false,
    equippedSlots: [],
    bodyZone: null,
    gripMode: null,
    currentAmmo: 0,
    shieldCurrentHP: null,
    broken: false,
    sealed: null,
    linkedSetInstanceId: null,
    componentRole: null,
    qualityRoll: null,
    coatingInstanceIds: [],
    issueReason: 'Начальное имущество NPC',
  };
}
/** Every identity/time reference comes from the owning test's actual accepted COMMIT/stage. */
export function npcPublishedInventoryFixture(
  catalog: NpcInventoryPublicationCatalog,
  clean: NpcCleanHumanoidBuildInput,
  proof: NpcInventoryPublicationProof,
): NpcHumanoidBuildInput {
  const publication = buildNpcInventoryPublication(catalog, proof);
  return {
    ...clean,
    input: { ...clean.input, inventory: publication.input },
    inventoryProof: publication.proof,
  };
}
