import Database from 'better-sqlite3';
import { configurePersistenceDatabase } from '../../src/persistence/database.js';
import { applyMigrationSequence } from '../../src/persistence/migrations/index.js';
import { migration0001 } from '../../src/persistence/migrations/0001-initial.js';
import { migration0002 } from '../../src/persistence/migrations/0002-local-character-checkpoint.js';
import { migration0003 } from '../../src/persistence/migrations/0003-device-identity.js';
import { migration0004 } from '../../src/persistence/migrations/0004-skill-presentation.js';
import { migration0005 } from '../../src/persistence/migrations/0005-symbiont-presentation.js';
import { migration0006 } from '../../src/persistence/migrations/0006-local-character-post-save.js';
import { migration0007 } from '../../src/persistence/migrations/0007-campaign-creation.js';
import { migration0008 } from '../../src/persistence/migrations/0008-network-installation-identity.js';
import { migration0009 } from '../../src/persistence/migrations/0009-device-admission.js';
import { migration0010 } from '../../src/persistence/migrations/0010-network-application.js';
import { migration0011 } from '../../src/persistence/migrations/0011-device-request-review.js';
import { migration0012 } from '../../src/persistence/migrations/0012-campaign-admission.js';
import { migration0013 } from '../../src/persistence/migrations/0013-campaign-lobby.js';
import { migration0014 } from '../../src/persistence/migrations/0014-campaign-lifecycle.js';
import { migration0015 } from '../../src/persistence/migrations/0015-persistent-npc.js';
import { migration0016 } from '../../src/persistence/migrations/0016-npc-wound-identities.js';
import { migration0017 } from '../../src/persistence/migrations/0017-npc-linked-sets.js';
import { migration0018 } from '../../src/persistence/migrations/0018-npc-custom-profile-identities.js';
import { migration0019 } from '../../src/persistence/migrations/0019-npc-poison-coating-identities.js';

export const LEGACY_SCHEMA_19_MIGRATIONS = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
] as const;

export function openLegacySchema19Database(path = ':memory:') {
  const db = new Database(path);
  configurePersistenceDatabase(db);
  applyMigrationSequence(db, LEGACY_SCHEMA_19_MIGRATIONS);
  return db;
}
