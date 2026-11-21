import type Database from 'better-sqlite3';
import {
  readActiveLocalGmContext,
  readCampaignCreationCursor,
  readHostedCampaignCreationOrigin,
} from '../persistence/campaign-creation.js';
import { loadDeviceId } from '../persistence/device-identity.js';
import { validateMasterSecretVerifier } from './campaign-secret.js';

export function confirmedHostedContext(
  database: Database.Database,
  connection: {
    readonly gmLocalContextId: string | null;
    readonly networkScopeId: string | null;
    readonly ordinaryParticipant: boolean;
  },
): boolean {
  const { gmLocalContextId, networkScopeId, ordinaryParticipant } = connection;
  if (gmLocalContextId === null || networkScopeId !== null || ordinaryParticipant) return false;
  try {
    const owner = loadDeviceId(database);
    if (readActiveLocalGmContext(database, owner)?.gmLocalContextId !== gmLocalContextId)
      return false;
    const cursor = readCampaignCreationCursor(database, gmLocalContextId);
    if (cursor.kind !== 'CAMPAIGN' && cursor.kind !== 'QUEUE' && cursor.kind !== 'ADMISSION')
      return false;
    const origin = readHostedCampaignCreationOrigin(database, cursor.targetId, (binding): void => {
      validateMasterSecretVerifier(binding.verifier);
    });
    return (
      cursor.ownerDeviceId === owner &&
      origin.command.request.payload.gmLocalContextId === gmLocalContextId
    );
  } catch {
    return false;
  }
}
