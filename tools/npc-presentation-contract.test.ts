import { describe, expectTypeOf, it } from 'vitest';
import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
import type * as Wire from '../src/shared/npc-editor-presentation.js';
import type * as Staged from '../src/domain/rules/npc-authoring/staged-input.js';
import type * as Inventory from '../src/domain/rules/npc-authoring/inventory.js';
import type { NpcDraftSection, NpcSymbiontInput } from '../src/domain/rules/npc-authoring/types.js';
import type {
  MasterWeaponProfileInput,
  MasterWeaponExpression,
} from '../src/domain/rules/item-stage/master-weapon-profile.js';
import type { StartingWeaponVariant } from '../src/domain/rules/item-stage/starting-weapon.js';
import type { ArmorBodyZone } from '../src/domain/rules/item-stage/armor-bundle.js';
import type {
  SymbiontBinding,
  SymbiontSpeciesKey,
} from '../src/domain/rules/symbiont-stage/catalog.js';
import type {
  NpcUntimedDiseaseId,
  NpcWoundInstance,
} from '../src/domain/rules/npc-authoring/effect-types.js';

/** Erase only this serialized property; all other source members retain their exact types. */
type SerializedSkillSelection = {
  [K in keyof Staged.NpcSkillSelectionRequest]: K extends 'skillKey'
    ? string
    : Staged.NpcSkillSelectionRequest[K];
};

describe('NPC presentation source type boundary', () => {
  it('preserves every editor section and nested optional shape without importing domain into shared', () => {
    expectTypeOf<Omit<Wire.NpcEditorStages, 'NPC-014'>>().toEqualTypeOf<
      Omit<Staged.NpcEditorStages, 'NPC-014'>
    >();
    expectTypeOf<Staged.NpcEditorStages['NPC-014']>().toEqualTypeOf<
      NpcDraftSection<readonly Staged.NpcEnteredFields<Staged.NpcSkillSelectionRequest>[]>
    >();
    expectTypeOf<Wire.NpcEditorStages['NPC-014']>().toEqualTypeOf<
      NpcDraftSection<readonly Staged.NpcEnteredFields<SerializedSkillSelection>[]>
    >();
    expectTypeOf<Wire.NpcDraftSection<number>>().toEqualTypeOf<NpcDraftSection<number>>();
    expectTypeOf<Wire.NpcSymbiontInput>().toEqualTypeOf<NpcSymbiontInput>();
    expectTypeOf<Wire.NpcDiceEditor>().toEqualTypeOf<Staged.NpcDiceEditor>();
    expectTypeOf<Wire.NpcMasterWeaponEditor>().toEqualTypeOf<Staged.NpcMasterWeaponEditor>();
    expectTypeOf<Wire.NpcItemProfileEditor>().toEqualTypeOf<Staged.NpcItemProfileEditor>();
    expectTypeOf<Wire.NpcInventoryEditorRow>().toEqualTypeOf<Staged.NpcInventoryEditorRow>();
  });

  it('keeps all finite vocabularies and inventory variants tied to the accepted sources', () => {
    expectTypeOf<Wire.NpcStatCode>().toEqualTypeOf<StatCode>();
    expectTypeOf<Wire.NpcRaceCode>().toEqualTypeOf<RaceCode>();
    expectTypeOf<Wire.NpcClassCode>().toEqualTypeOf<ClassCode>();
    expectTypeOf<Wire.NpcBodyZone>().toEqualTypeOf<ArmorBodyZone>();
    expectTypeOf<Wire.NpcWoundType>().toEqualTypeOf<NpcWoundInstance['woundType']>();
    expectTypeOf<Wire.NpcUntimedDiseaseId>().toEqualTypeOf<NpcUntimedDiseaseId>();
    expectTypeOf<Wire.NpcSymbiontSpeciesKey>().toEqualTypeOf<SymbiontSpeciesKey>();
    expectTypeOf<Wire.NpcSymbiontBinding>().toEqualTypeOf<SymbiontBinding>();
    expectTypeOf<Wire.NpcStartingWeaponVariant>().toEqualTypeOf<StartingWeaponVariant>();
    expectTypeOf<Wire.NpcMasterWeaponExpression>().toEqualTypeOf<MasterWeaponExpression>();
    expectTypeOf<Wire.NpcMasterWeaponProfileInput>().toEqualTypeOf<MasterWeaponProfileInput>();
    expectTypeOf<Wire.NpcInventoryRequestEntry>().toEqualTypeOf<Inventory.NpcInventoryRequestEntry>();
    expectTypeOf<Wire.NpcItemProfileRequest>().toEqualTypeOf<Inventory.NpcItemProfileRequest>();
    expectTypeOf<Wire.NpcItemQualityTier>().toEqualTypeOf<Inventory.NpcItemQualityTier>();
    expectTypeOf<Wire.NpcClothingProperties>().toEqualTypeOf<Inventory.NpcClothingProperties>();
  });

  it('accepts validated skill keys as text but never manufactures their host-only proof', () => {
    expectTypeOf<Wire.NpcSkillSelectionRequest>().toEqualTypeOf<SerializedSkillSelection>();
    expectTypeOf<Staged.NpcSkillSelectionRequest>().toMatchTypeOf<Wire.NpcSkillSelectionRequest>();
    expectTypeOf<Wire.NpcSkillSelectionRequest>().not.toMatchTypeOf<Staged.NpcSkillSelectionRequest>();
  });
});
