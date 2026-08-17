export { bootstrapDeviceIdentity, loadDeviceId, resetDeviceIdentity } from './device-identity.js';
export type { DeviceBindingsInvalidator, DeviceId } from './device-identity.js';
export { advanceRevisions, readRevisions } from './store.js';
export type {
  CampaignCheckpoint,
  LocalCharacter,
  LocalCharacterCheckpoint,
  LocalCharacterCheckpointCreator,
  LocalCharacterCheckpointWriter,
  LocalCharacterLifecycleState,
  LocalCharacterPatch,
  RevisionImpact,
  RevisionScope,
  RevisionTriple,
} from './store.js';
