import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { IdentityDraftValues } from '@shared/wire-v3-protocol.js';

export const CHR_001_FORM_ID = 'CHR-001' as const;
export const CHR_001_ROUTE = '/player/characters/:localCharacterId/create/chr-001' as const;
export const CHR_001_CANCEL_ACTION_KEY = 'CHR-001::CTA::002' as const satisfies ActionKey;
/** Continue remains guard-hidden until its required identity fields are confirmed. */
export const CHR_001_INITIAL_ACTION_KEYS = [
  CHR_001_CANCEL_ACTION_KEY,
] as const satisfies readonly ActionKey[];

export function projectChr001(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  values: IdentityDraftValues,
): JsonObject {
  return {
    ...values,
    anatomyProfile: 'STANDARD_HUMANOID',
    characterDraftId,
    commandId: null,
    draftRevision,
    massApprovalStatus: 'PENDING_GM',
    wizardCheckpointId,
  };
}

export function projectInitialChr001(
  characterDraftId: string,
  wizardCheckpointId: string,
): JsonObject {
  return projectChr001(characterDraftId, wizardCheckpointId, 0, {
    age: null,
    artAssetKeyOrLocalFile: null,
    description: null,
    massKg: null,
    name: null,
    sex: null,
  });
}
