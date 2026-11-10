import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  configurePersistenceDatabase,
  openPersistenceDatabase,
} from '../../src/persistence/database.js';
import { bootstrapDeviceIdentity } from '../../src/persistence/device-identity.js';
import { networkApplicationStorage as s } from '../../src/persistence/network-local-application.js';
import {
  ensureLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  readCampaignCreationCursor,
  readActiveLocalGmContext,
  type RedactedCampaignDraftRequest,
  type GmRequestReviewViewState,
} from '../../src/persistence/campaign-creation.js';
import {
  commitGmRequestReviewNavigation,
  readGmRequestReviewSourceWith,
  type GmRequestReviewSource,
} from '../../src/persistence/network-device-request.js';
import { createEnemyLibraryApplication } from '../../src/host/enemy-library-application.js';
import type { EnemySourceCatalog } from '../../src/host/enemy-catalog.js';
import type { LocalCharacterExportBaseline } from '../../src/host/local-character-export.js';

/** Real campaign/QUEUE storage, with a source fixture verifier instead of password KDF work. */
export function createEnemyLibraryFixture(
  catalog: EnemySourceCatalog,
  baseline: LocalCharacterExportBaseline,
  legacy = false,
) {
  let db = openPersistenceDatabase(':memory:');
  const ownerDeviceId = bootstrapDeviceIdentity(db),
    masterProfileId = randomUUID(),
    gmLocalContextId = randomUUID();
  const campaignId = randomUUID(),
    campaignDraftId = randomUUID();
  const scope = { ownerDeviceId, gmLocalContextId, campaignId };
  const allow = () => undefined;
  ensureLocalGmProfile(db, { ownerDeviceId, masterProfileId }, allow);
  createLocalGmContext(db, { ownerDeviceId, masterProfileId, gmLocalContextId }, allow);
  createCampaignDraft(
    db,
    { gmLocalContextId, campaignDraftId, expectedRevisions: s.zero() },
    allow,
  );
  const draft = () => readCampaignDraft(db, gmLocalContextId, campaignDraftId);
  const navDraft = (targetFormId: ReturnType<typeof draft>['formId']) => {
    const old = draft();
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId,
        campaignDraftId,
        expectedDraftRevision: old.draftRevision,
        expectedRevisions: s.vectorOf(old),
        sourceFormId: old.formId,
        targetFormId,
      },
      allow,
    );
  };
  const update = (variant: 'METADATA' | 'HOST' | 'SECRET' | 'MODE', values: JsonObject) => {
    const old = draft();
    commitCampaignDraftUpdate(
      db,
      {
        request: {
          messageType: 'campaign.draft.replace',
          protocolVersion: 3,
          draftUpdateId: randomUUID(),
          expectedDraftRevision: old.draftRevision,
          expectedRevisions: s.vectorOf(old),
          scope: { gmLocalContextId, campaignDraftId, sourceFormId: old.formId },
          variant,
          values,
        } as RedactedCampaignDraftRequest,
        ...(variant === 'SECRET'
          ? {
              secretUpdate: {
                kind: 'REPLACE' as const,
                preparedVerifier: { fixture: 'enemy library' },
              },
            }
          : {}),
      },
      allow,
    );
  };
  update('METADATA', { title: 'Каталог до Start', description: null, art: null });
  navDraft('CMP-002');
  update('HOST', {
    activePlayerCapacity: 3,
    hostAddress: '127.0.0.1',
    hostPort: 30111,
    networkInterface: 'loopback',
  });
  navDraft('CMP-003');
  update('SECRET', { secretProvided: true });
  navDraft('CMP-004');
  update('MODE', { defaultFutureRollMode: 'MANUAL' });
  navDraft('CMP-005');
  const before = draft();
  const creation = commitCampaignCreation(
    db,
    {
      campaignId,
      receiptId: randomUUID(),
      createdAt: '2026-11-10T00:00:00.000Z',
      qrPayload: `http://127.0.0.1:30111/?campaignId=${campaignId}`,
      baselineVersion: baseline.baselineVersion,
      ...(legacy ? {} : { defaultSentientCatalogVersion: catalog.catalogVersion }),
      request: {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
        role: 'gm',
        commandId: randomUUID(),
        expectedRevisions: s.vectorOf(before),
        payload: {
          stage: 'CAMPAIGN_CREATE',
          sourceFormId: 'CMP-005',
          gmLocalContextId,
          campaignDraftId,
          draftRevision: before.draftRevision,
          preflightLeaseId: randomUUID(),
        },
      },
    },
    allow,
  );
  const validateOwner = () => undefined;
  let trusted = true;
  const readCurrent = (
    observe: (source: GmRequestReviewSource, state: GmRequestReviewViewState) => void = () =>
      undefined,
  ) => {
    if (
      !trusted ||
      readActiveLocalGmContext(db, ownerDeviceId)?.gmLocalContextId !== gmLocalContextId
    )
      return s.fail('FOREIGN_OWNER');
    return readGmRequestReviewSourceWith(db, scope, validateOwner, observe).source;
  };
  const app = () =>
    createEnemyLibraryApplication({
      database: db,
      scope,
      catalog,
      baseline,
      validateOwner,
      readCurrent,
    });
  const nav = (actionKey: ActionKey) => {
    const cursor = readCampaignCreationCursor(db, gmLocalContextId);
    const request = {
      messageType: 'navigation.form-action' as const,
      protocolVersion: 2 as const,
      navigationRequestId: randomUUID(),
      sourceFormId: cursor.formId,
      expectedProjectionRevision: cursor.revisions.projectionRevision,
      actionKey,
    };
    return actionKey.startsWith('ENM-') || actionKey === 'GM-001::CTA::005'
      ? app().navigation(request)
      : commitGmRequestReviewNavigation(db, scope, request, validateOwner, () => {
          readCurrent();
        });
  };
  nav('CMP-006::CTA::001');
  nav('CMP-007::CTA::004');
  nav('GM-001::CTA::005');
  return {
    get db() {
      return db;
    },
    scope,
    creation,
    app,
    nav,
    readCurrent,
    loseAuthority() {
      trusted = false;
    },
    restart() {
      const bytes = db.serialize();
      db.close();
      db = new Database(bytes);
      configurePersistenceDatabase(db);
    },
    close() {
      if (db.open) db.close();
    },
  };
}
