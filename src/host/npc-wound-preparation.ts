import type { NpcWoundInstance } from '../domain/rules/npc-authoring/effect-types.js';
import {
  prepareNpcGmWound,
  readNpcWoundInstance,
} from '../domain/rules/npc-authoring/wound-instances.js';
import { npcPublicationData as data } from '../domain/rules/npc-authoring/inventory-publication.js';

/** All identities come from the owning transaction and its checked child allocation. */
export interface NpcWoundPreparationContext {
  readonly npcUuid: string;
  readonly operationId: string;
  readonly woundInstanceId: string;
  readonly anatomyProfileId: 'STANDARD_HUMANOID';
}
export interface NpcPreparedWoundFact {
  readonly kind: 'GM_WOUND_ASSIGNMENT';
  readonly npcUuid: string;
  readonly sourceOperationId: string;
  readonly wound: NpcWoundInstance;
}

function checkedContext(value: NpcWoundPreparationContext): NpcWoundPreparationContext {
  const row = data.record(value, ['npcUuid', 'operationId', 'woundInstanceId', 'anatomyProfileId']);
  if (row.anatomyProfileId !== 'STANDARD_HUMANOID')
    throw new Error('NPC wound preparation: expected the confirmed humanoid anatomy');
  return {
    npcUuid: data.uuid(row.npcUuid),
    operationId: data.uuid(row.operationId),
    woundInstanceId: data.uuid(row.woundInstanceId),
    anatomyProfileId: row.anatomyProfileId,
  };
}

/**
 * NPC-016 is an explicit GM assignment. It does not replay an attack, reduce HP,
 * start a combat turn, or create a natural-healing/calendar schedule.
 * The caller must prove GM authority and the actual attempt before allocating IDs.
 */
export function prepareNpcWoundFact(
  context: NpcWoundPreparationContext,
  input: unknown,
): NpcPreparedWoundFact {
  const scope = checkedContext(context);
  const row = data.record(input);
  const kind = row.woundType;
  if (kind !== 'GENERIC' && kind !== 'BLEEDING')
    throw new Error('NPC wound preparation: unknown woundType; expected GENERIC or BLEEDING');
  data.record(
    input,
    kind === 'GENERIC' ? ['woundType', 'regionId'] : ['woundType', 'regionId', 'damagePerTick'],
  );
  const wound = prepareNpcGmWound(
    { anatomyProfileId: scope.anatomyProfileId },
    {
      woundInstanceId: scope.woundInstanceId,
      woundType: kind,
      regionId: row.regionId,
      ...(kind === 'BLEEDING' ? { damagePerTick: row.damagePerTick } : {}),
    },
  );
  return data.freeze({
    kind: 'GM_WOUND_ASSIGNMENT',
    npcUuid: scope.npcUuid,
    sourceOperationId: scope.operationId,
    wound,
  });
}

/** Recompute against the stored request and owning allocation, not a self-asserted owner. */
export function readNpcPreparedWoundFact(
  context: NpcWoundPreparationContext,
  requestInput: unknown,
  value: unknown,
): NpcPreparedWoundFact {
  const expected = prepareNpcWoundFact(context, requestInput);
  const row = data.record(value, ['kind', 'npcUuid', 'sourceOperationId', 'wound']);
  readNpcWoundInstance({ anatomyProfileId: context.anatomyProfileId }, row.wound);
  data.equal(expected, value);
  return expected;
}
