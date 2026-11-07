/** Self references target the replacement table throughout the copy. This preserves existing
 * item/profile links with foreign_keys enabled; no historical event or receipt is rewritten. */
export const migration0016 = {
  version: 16,
  name: 'npc-wound-identities',
  sql: `CREATE TABLE npc_child_identity_next (
 child_id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
 owner_npc_uuid TEXT NOT NULL,
 origin_draft_id TEXT NOT NULL,
 origin_operation_id TEXT NOT NULL REFERENCES npc_attempt_event(operation_id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=1),
 kind TEXT NOT NULL CHECK(kind IN ('ITEM','WEAPON_PROFILE_VERSION','EFFECT_INSTANCE','TRAUMA_INSTANCE','SYMBIONT_INSTANCE','WOUND_INSTANCE')),
 item_instance_id TEXT REFERENCES npc_child_identity_next(child_id),
 weapon_variant_id TEXT,
 UNIQUE(origin_operation_id,ordinal),
 CHECK((kind IN ('ITEM','EFFECT_INSTANCE','TRAUMA_INSTANCE','SYMBIONT_INSTANCE','WOUND_INSTANCE') AND item_instance_id IS NULL AND weapon_variant_id IS NULL) OR
       (kind='WEAPON_PROFILE_VERSION' AND item_instance_id IS NOT NULL AND child_id<>item_instance_id AND weapon_variant_id IS NOT NULL AND weapon_variant_id IN ('DEFAULT','ONE_HAND','TWO_HAND','SWORD','SHIELD','RAPIER')))
) STRICT;
INSERT INTO npc_child_identity_next SELECT * FROM npc_child_identity;
DROP TABLE npc_child_identity;
ALTER TABLE npc_child_identity_next RENAME TO npc_child_identity;`,
} as const;
