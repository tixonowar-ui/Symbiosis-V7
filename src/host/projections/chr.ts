import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';

export const CHR_001_FORM_ID = 'CHR-001' as const;
export const CHR_001_ROUTE = '/player/characters/:localCharacterId/create/chr-001' as const;
/** Continue is guard-hidden; Cancel targets APP-004, which this vertical does not implement. */
export const CHR_001_INITIAL_ACTION_KEYS = [] as const satisfies readonly ActionKey[];

export function projectInitialChr001(
  characterDraftId: string,
  wizardCheckpointId: string,
): JsonObject {
  return {
    age: null,
    anatomyProfile: 'STANDARD_HUMANOID',
    artAssetKeyOrLocalFile: null,
    characterDraftId,
    commandId: null,
    description: null,
    draftRevision: 0,
    massApprovalStatus: 'PENDING_GM',
    massKg: null,
    name: null,
    wizardCheckpointId,
  };
}
