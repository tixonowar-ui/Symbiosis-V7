/** A prepared dose is a distinct identity tied to an existing physical item.
 * Its source/history remains in the closed journal; old identity rows are copied verbatim. */
export const migration0019 = {
  version: 19,
  name: 'npc-poison-coating-identities',
  sql: `CREATE TABLE npc_child_identity_next (
 child_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_npc_uuid TEXT NOT NULL,
 origin_draft_id TEXT NOT NULL,
 origin_operation_id TEXT NOT NULL REFERENCES npc_attempt_event(operation_id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=1),
 kind TEXT NOT NULL CHECK(kind IN ('ITEM','WEAPON_PROFILE_VERSION','EFFECT_INSTANCE','TRAUMA_INSTANCE','SYMBIONT_INSTANCE','WOUND_INSTANCE','LINKED_SET','CUSTOM_PROFILE','CUSTOM_PROFILE_VERSION','COATING_INSTANCE')),
 item_instance_id TEXT REFERENCES npc_child_identity_next(child_id),
 weapon_variant_id TEXT,
 UNIQUE(origin_operation_id,ordinal),
 CHECK((kind IN ('ITEM','EFFECT_INSTANCE','TRAUMA_INSTANCE','SYMBIONT_INSTANCE','WOUND_INSTANCE','LINKED_SET') AND item_instance_id IS NULL AND weapon_variant_id IS NULL) OR
       (kind='WEAPON_PROFILE_VERSION' AND item_instance_id IS NOT NULL AND child_id<>item_instance_id AND weapon_variant_id IS NOT NULL AND weapon_variant_id IN ('DEFAULT','ONE_HAND','TWO_HAND','SWORD','SHIELD','RAPIER')) OR
       (kind IN ('CUSTOM_PROFILE','CUSTOM_PROFILE_VERSION','COATING_INSTANCE') AND item_instance_id IS NOT NULL AND child_id<>item_instance_id AND weapon_variant_id IS NULL))
) STRICT;
INSERT INTO npc_child_identity_next SELECT * FROM npc_child_identity;
DROP TABLE npc_child_identity;
ALTER TABLE npc_child_identity_next RENAME TO npc_child_identity;`,
} as const;
