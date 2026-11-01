import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { AdmissionPublicationRules } from '../../src/persistence/campaign-admission-decision.js';
import { writeFileSync } from 'node:fs';
import {
  openPersistenceDatabase,
  configurePersistenceDatabase,
} from '../../src/persistence/database.js';
import { applyMigrationSequence, applyMigrations } from '../../src/persistence/migrations/index.js';
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
import { bootstrapDeviceIdentity } from '../../src/persistence/device-identity.js';
import {
  ensureLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  type RedactedCampaignDraftRequest,
} from '../../src/persistence/campaign-creation.js';
import { readHostedCurrentPausedCampaign } from '../../src/persistence/current-paused-campaign.js';
import {
  commitHostedNetworkCommand,
  commitHostedRequestLaneBinding,
  commitGmRequestReviewNavigation,
  commitGmRequestReviewDraft,
  commitGmDeviceRequestDecision,
  readGmRequestReviewView,
  type HostedNetworkPrincipal,
} from '../../src/persistence/network-device-request.js';
import {
  networkApplicationStorage as s,
  commitLocalNetworkMutation,
  commitLocalNetworkHostPin,
  commitLocalNetworkRequestAdvance,
  readLocalNetworkApplication,
  type LocalNetworkMutation,
  type NetworkPublicIdentity,
  type VerifiedRequestReviewProof,
  type NetworkPreparedCandidate,
} from '../../src/persistence/network-local-application.js';
import { commitLocalNetworkTabEntry } from '../../src/persistence/network-local-tab.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import type { AdmissionReviewOpenRequest } from '../../src/persistence/campaign-admission-review.js';

function openFixtureDatabase(filename: string, legacy: boolean): Database.Database {
  if (!legacy) return openPersistenceDatabase(filename);
  const db = new Database(filename);
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, [
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
    ]);
    return db;
  } catch (error: unknown) {
    db.close();
    throw error;
  }
}

/** A separate installation snapshot, with real local entry/outbox/ACK and the GM's actual receipts. */
export function createAdmissionOwnerFixture(
  sourceDatabase: Database.Database,
  hosted: ReturnType<typeof createAdmissionStoreFixture>,
  proof: VerifiedRequestReviewProof,
  filename = ':memory:',
) {
  return prepareAdmissionOwnerFixture(sourceDatabase, hosted, proof, filename).submit();
}

/** OPEN and SUBMIT are distinct fixture phases; both still use the actual durable writers. */
export function prepareAdmissionOwnerFixture(
  sourceDatabase: Database.Database,
  hosted: ReturnType<typeof createAdmissionStoreFixture>,
  proof: VerifiedRequestReviewProof,
  filename = ':memory:',
) {
  // A WAL-mode image needs an actual filename when reopened; its immutable bytes stay intact.
  const snapshot = sourceDatabase.serialize();
  if (filename !== ':memory:') writeFileSync(filename, snapshot);
  const db = filename === ':memory:' ? new Database(snapshot) : new Database(filename);
  try {
    configurePersistenceDatabase(db);
    const ownerDeviceId = hosted.principal.peerIdentity.ownerDeviceId,
      scope = { ownerDeviceId, networkScopeId: randomUUID() },
      tabId = hosted.localControllerSeatId,
      entry = commitLocalNetworkTabEntry(
        db,
        {
          ...scope,
          tabId,
          entryCommandId: randomUUID(),
          entryReceiptId: randomUUID(),
          sourceContextId: randomUUID(),
          sourceRevisions: s.zero(),
        },
        hosted.allow,
      );
    let current = readLocalNetworkApplication(db, scope);
    const mutate = (mutation: LocalNetworkMutation) => {
      current = commitLocalNetworkMutation(
        db,
        {
          ...scope,
          eventId: randomUUID(),
          receiptId: randomUUID(),
          expectedRevisions: s.vectorOf(current),
          expectedDraftRevision: current.draftRevision,
          clientRequestJsonOrNull:
            mutation.kind === 'INTENT'
              ? mutation.intent.clientRequestJson
              : ['ACKNOWLEDGE', 'DIAGNOSTIC', 'PREPARE_BATCH'].includes(mutation.kind)
                ? null
                : s.canonical({ mutation }),
          mutation,
        },
        hosted.allow,
      ).current;
    };
    const opened = hosted.opened,
      submitted = hosted.submitted;
    if (
      opened.receipt.operation !== 'OPEN' ||
      opened.input.operation !== 'OPEN' ||
      submitted.receipt.operation !== 'SUBMIT' ||
      submitted.input.operation !== 'SUBMIT'
    )
      throw new Error('owner fixture requires the actual OPEN and SUBMIT');
    mutate({
      kind: 'NAVIGATE',
      targetFormId: 'NET-002',
      plannedAttemptIdOrNull: opened.input.attemptId,
      singleCandidateOrNull: null,
    });
    mutate({ kind: 'ADDRESS', addressOrQrPayload: '127.0.0.1:30111' });
    mutate({
      kind: 'INTENT',
      intent: {
        operation: 'OPEN',
        commandId: opened.input.commandId,
        attemptId: opened.input.attemptId,
        clientRequestJson: s.canonical({ sourceFormId: 'NET-002' }),
        campaignId: hosted.scope.campaignId,
        canonicalOrigin: 'http://127.0.0.1:30111',
        semanticBodyJson: opened.input.semanticBodyJson,
      },
    });
    mutate({
      kind: 'ACKNOWLEDGE',
      acknowledgement: {
        operation: 'OPEN',
        commandId: opened.input.commandId,
        semanticBodySha256: opened.receipt.semanticBodySha256,
        session: {
          technicalSessionId: opened.receipt.session.technicalSessionId,
          attemptId: opened.receipt.session.attemptId,
          campaignProof: opened.receipt.session.campaignProof,
          connectionRevision: opened.receipt.session.connectionRevision,
          receiptId: opened.receipt.session.receiptId,
        },
        verifiedReceipt: JSON.parse(s.canonical(opened.receipt)) as JsonObject,
      },
    });
    return {
      db,
      submit: () => {
        try {
          mutate({
            kind: 'SELECTION',
            selectedCandidates: hosted.batch.candidates.map((candidate) => ({
              sourceUuid: candidate.descriptor.sourceUuid,
              finalSnapshotVersion: candidate.descriptor.finalSnapshotVersion,
              metadataRevision: candidate.descriptor.metadataRevision,
              candidateSnapshotChecksum: candidate.descriptor.sourceChecksum,
              requestedControllerSeat: tabId,
            })),
          });
          mutate({ kind: 'PREPARE_BATCH', batch: hosted.batch });
          mutate({
            kind: 'INTENT',
            intent: {
              operation: 'SUBMIT',
              commandId: submitted.input.commandId,
              requestId: hosted.batch.requestId,
              clientRequestJson: s.canonical({ sourceFormId: 'NET-004' }),
              batch: hosted.batch,
              semanticBodyJson: submitted.input.semanticBodyJson,
            },
          });
          mutate({
            kind: 'ACKNOWLEDGE',
            acknowledgement: {
              operation: 'SUBMIT',
              commandId: submitted.input.commandId,
              semanticBodySha256: submitted.receipt.semanticBodySha256,
              request: proof.submittedReceipt.request,
              verifiedReceipt: JSON.parse(s.canonical(submitted.receipt)) as JsonObject,
            },
          });
          const key = generateKeyPairSync('ed25519').publicKey.export({
              format: 'der',
              type: 'spki',
            }),
            hostIdentity: NetworkPublicIdentity = {
              schemaVersion: 1,
              algorithm: 'ED25519',
              ownerDeviceId: hosted.scope.ownerDeviceId,
              publicKeySpkiBase64: key.toString('base64'),
              keyFingerprintSha256: createHash('sha256').update(key).digest('hex'),
            };
          commitLocalNetworkHostPin(
            db,
            scope,
            {
              ownerDeviceId,
              campaignId: hosted.scope.campaignId,
              identity: hostIdentity,
              initialCanonicalOrigin: 'http://127.0.0.1:30111',
              entryCommandId: entry.request.entryCommandId,
            },
            hosted.allow,
          );
          commitLocalNetworkRequestAdvance(
            db,
            {
              ...scope,
              expectedRevisions: s.vectorOf(current),
              expectedDraftRevision: current.draftRevision,
            },
            { eventId: randomUUID(), receiptId: randomUUID(), proof },
            hosted.allow,
          );
          return { db, scope, hostIdentity, tabId };
        } catch (error: unknown) {
          db.close();
          throw error;
        }
      },
    };
  } catch (error: unknown) {
    db.close();
    throw error;
  }
}

/** Real creation/SUBMIT/preliminary receipts. Only secret verification/socket leasing are fixture boundaries. */
export function createAdmissionStoreFixture(
  sourceOwnerDeviceId: string,
  baselineVersion: string,
  candidates: readonly NetworkPreparedCandidate[],
  filename = ':memory:',
  activePlayerCapacity = 5,
  legacy = false,
) {
  const db = openFixtureDatabase(filename, legacy),
    owner = bootstrapDeviceIdentity(db),
    campaignId = randomUUID(),
    contextId = randomUUID(),
    draftId = randomUUID(),
    allow = () => undefined,
    zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
  try {
    const profileId = randomUUID();
    ensureLocalGmProfile(db, { ownerDeviceId: owner, masterProfileId: profileId }, allow);
    createLocalGmContext(
      db,
      { ownerDeviceId: owner, masterProfileId: profileId, gmLocalContextId: contextId },
      allow,
    );
    createCampaignDraft(
      db,
      { gmLocalContextId: contextId, campaignDraftId: draftId, expectedRevisions: zero },
      allow,
    );
    for (const stage of [
      {
        form: 'CMP-001',
        variant: 'METADATA',
        values: { title: 'Admission', description: null, art: null },
      },
      {
        form: 'CMP-002',
        variant: 'HOST',
        values: {
          activePlayerCapacity,
          hostAddress: '127.0.0.1',
          hostPort: 30111,
          networkInterface: 'loopback',
        },
      },
      { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
      { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
    ] as const) {
      let draft = readCampaignDraft(db, contextId, draftId);
      if (draft.formId !== stage.form) {
        navigateCampaignDraft(
          db,
          {
            gmLocalContextId: contextId,
            campaignDraftId: draftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: s.vectorOf(draft),
            sourceFormId: draft.formId,
            targetFormId: stage.form,
          },
          allow,
        );
        draft = readCampaignDraft(db, contextId, draftId);
      }
      const request = {
        messageType: 'campaign.draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: contextId,
          campaignDraftId: draftId,
          sourceFormId: draft.formId,
        },
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: s.vectorOf(draft),
        variant: stage.variant,
        values: stage.values,
      } as RedactedCampaignDraftRequest;
      commitCampaignDraftUpdate(
        db,
        {
          request,
          ...(stage.variant === 'SECRET'
            ? {
                secretUpdate: {
                  kind: 'REPLACE' as const,
                  preparedVerifier: { privateVerifier: 'fixture secret verifier' },
                },
              }
            : {}),
        },
        allow,
      );
    }
    let draft = readCampaignDraft(db, contextId, draftId);
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId: contextId,
        campaignDraftId: draftId,
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: s.vectorOf(draft),
        sourceFormId: draft.formId,
        targetFormId: 'CMP-005',
      },
      allow,
    );
    draft = readCampaignDraft(db, contextId, draftId);
    commitCampaignCreation(
      db,
      {
        campaignId,
        receiptId: randomUUID(),
        createdAt: '2026-11-01T00:00:00.000Z',
        qrPayload: `http://127.0.0.1:30111/?campaignId=${campaignId}`,
        baselineVersion,
        request: {
          messageType: 'command.request',
          protocolVersion: 1,
          commandKind: 'workflow-command',
          workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
          role: 'gm',
          commandId: randomUUID(),
          expectedRevisions: s.vectorOf(draft),
          payload: {
            stage: 'CAMPAIGN_CREATE',
            sourceFormId: 'CMP-005',
            gmLocalContextId: contextId,
            campaignDraftId: draftId,
            draftRevision: draft.draftRevision,
            preflightLeaseId: randomUUID(),
          },
        },
      },
      allow,
    );
    const scope = { ownerDeviceId: owner, gmLocalContextId: contextId, campaignId };
    const principals = new Map<string, HostedNetworkPrincipal>();
    const addRequest = (
      requestOwner: string,
      requestCandidates: readonly NetworkPreparedCandidate[],
      admissionRules?: AdmissionPublicationRules,
    ) => {
      const key = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
      const principal: HostedNetworkPrincipal = principals.get(requestOwner) ?? {
        hostOwnerDeviceId: owner,
        campaignId,
        peerIdentity: {
          schemaVersion: 1,
          algorithm: 'ED25519',
          ownerDeviceId: requestOwner,
          publicKeySpkiBase64: key.toString('base64'),
          keyFingerprintSha256: createHash('sha256').update(key).digest('hex'),
        },
      };
      principals.set(requestOwner, principal);
      const header = readHostedCurrentPausedCampaign(db, campaignId, allow),
        commandId = randomUUID(),
        attemptId = randomUUID();
      const opened = commitHostedNetworkCommand(
        db,
        principal,
        {
          operation: 'OPEN',
          commandId,
          receiptId: randomUUID(),
          attemptId,
          technicalSessionId: randomUUID(),
          campaignProof: {
            campaignId,
            revisions: s.vectorOf(header),
            checkpointSha256: header.checkpointSha256,
          },
          semanticBodyJson: s.canonical({ operation: 'CONNECTION_OPEN', commandId, attemptId }),
        },
        allow,
        allow,
      );
      if (opened.receipt.operation !== 'OPEN') throw new Error('fixture OPEN receipt');
      const session = opened.receipt.session,
        requestId = randomUUID(),
        submitId = randomUUID();
      const localControllerSeatId = randomUUID();
      const common = {
        requestId,
        technicalSessionId: session.technicalSessionId,
        connectionRevision: 0,
        campaignProof: session.campaignProof,
        candidates: requestCandidates,
      };
      const schema = db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as {
        version: number;
      };
      const body =
        schema.version === 10
          ? common
          : { schemaVersion: 2 as const, localControllerSeatId, ...common };
      const batch = { ...body, batchSha256: s.sha(s.canonical(body)) };
      const submitted = commitHostedNetworkCommand(
        db,
        principal,
        {
          operation: 'SUBMIT',
          commandId: submitId,
          receiptId: randomUUID(),
          requestId,
          technicalSessionId: session.technicalSessionId,
          expectedConnectionRevision: 0,
          batch,
          semanticBodyJson: s.canonical({
            requestId,
            commandId: submitId,
            candidates: requestCandidates,
          }),
        },
        allow,
        allow,
        undefined,
        admissionRules,
      );
      if (schema.version === 10) {
        const original = db
          .prepare('SELECT * FROM hosted_network_command WHERE command_id=?')
          .get(submitId);
        applyMigrations(db);
        commitHostedRequestLaneBinding(
          db,
          principal,
          {
            request: {
              schemaVersion: 1,
              operation: 'DEVICE_REQUEST_BIND_LANE',
              commandId: randomUUID(),
              requestId,
              technicalSessionId: session.technicalSessionId,
              submitCommandId: submitId,
              batchSha256: batch.batchSha256,
              localControllerSeatId,
            },
            receiptId: randomUUID(),
          },
          allow,
          allow,
        );
        if (
          !s.same(
            original,
            db.prepare('SELECT * FROM hosted_network_command WHERE command_id=?').get(submitId),
          )
        )
          throw new Error('legacy fixture rewrote SUBMIT');
      }
      let view = readGmRequestReviewView(db, scope, allow);
      if (view === null) {
        commitGmRequestReviewNavigation(
          db,
          scope,
          {
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: 'CMP-006',
            actionKey: 'CMP-006::CTA::002',
            expectedProjectionRevision: 0,
          },
          allow,
          allow,
        );
        view = readGmRequestReviewView(db, scope, allow)!;
      }
      view = commitGmRequestReviewDraft(
        db,
        scope,
        {
          messageType: 'network.gm-request-draft.replace',
          protocolVersion: 3,
          draftUpdateId: randomUUID(),
          scope: { gmLocalContextId: contextId, campaignId, sourceFormId: 'NET-017' },
          expectedRevisions: s.vectorOf(view),
          expectedRequestQueueRevision: view.requestQueueRevision,
          values: { selectedRequestIdOrNull: requestId, decisionReason: '' },
        },
        allow,
        allow,
      ).current;
      const preliminary = commitGmDeviceRequestDecision(
        db,
        scope,
        {
          request: {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'gm',
            workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
            commandId: randomUUID(),
            expectedRevisions: s.vectorOf(view),
            payload: { campaignId, requestId, requestRevision: 0 },
          },
          receiptId: randomUUID(),
          timestamp: '2026-11-01T00:01:00.000Z',
        },
        allow,
        allow,
      );
      const openRequest: AdmissionReviewOpenRequest = {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
        commandId: randomUUID(),
        expectedRevisions: s.vectorOf(preliminary.current),
        payload: { campaignId, requestId, requestRevision: 1 },
      };
      return {
        principal,
        opened,
        submitted,
        batch,
        localControllerSeatId,
        preliminary,
        openRequest,
      };
    };
    return { db, scope, allow, addRequest, ...addRequest(sourceOwnerDeviceId, candidates) };
  } catch (error: unknown) {
    db.close();
    throw error;
  }
}
