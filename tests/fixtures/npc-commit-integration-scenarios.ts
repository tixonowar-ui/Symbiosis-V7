import * as npcInventoryPublicationModule from '../../src/domain/rules/npc-authoring/inventory-publication.js';
import * as npcGmSourceModule from '../../src/persistence/npc-gm-source.js';
import * as npcHumanoidSheetModule from '../../src/domain/rules/npc-authoring/npc-humanoid-sheet.js';
import * as npcLibraryStoreModule from '../../src/persistence/npc-library-store.js';
import * as npcPoisonReadersModule from '../../src/host/npc-poison-readers.js';
import * as npcDomainReadersModule from '../../src/host/npc-domain-readers.js';
import { readNpcPoisonCoatingContribution } from '../../src/domain/rules/npc-authoring/formal-poison-coating.js';
import {
  createEmptyNpcTraumaEditorRow,
  type NpcTraumaEditorRow,
} from '../../src/domain/rules/npc-authoring/staged-input.js';
import { saveNpcAttemptPreparedWithEvidence } from '../../src/persistence/npc-library-store.js';
import { createNpcHostSupport } from '../../src/host/npc-application.js';
import {
  commitCampaignLobbyCommand,
  readCampaignLobby,
} from '../../src/persistence/campaign-lobby.js';
import { npcEditorForItemAttempt } from '../../src/host/npc-item-preparation.js';
import {
  npcAttemptReadContext,
  type NpcAttemptReadContext,
} from '../../src/persistence/npc-child-identities.js';
import { npcKensiRequest } from './npc-published-inventory.js';
import { npcGmProjectionValue } from '../../src/shared/npc-presentation-codec.js';
import type { NpcInventoryRequestEntry } from '../../src/domain/rules/npc-authoring/inventory.js';
import type { NpcHumanoidSnapshot } from '../../src/domain/rules/npc-authoring/npc-humanoid-sheet.js';
import { evaluateNpcSkills } from '../../src/domain/rules/npc-authoring/skill-evaluation.js';
import { previewNpcOrdinarySkills } from '../../src/domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import { npcCompositionCurrentSkillInventory } from '../../src/host/npc-composition-preparation.js';
import type { NpcPreparationRequest } from '../../src/shared/npc-command.js';
import {
  npcWorkflowCommandRequestValue,
  npcTechnicalRequestValue,
} from '../../src/shared/npc-command.js';
import {
  createNpcOrdinaryDomainReaders,
  NpcOrdinaryPreviewInputError,
} from '../../src/host/npc-domain-readers.js';
import { npcCleanHumanoidFixture } from './npc-clean-humanoid.js';
import type { NpcCleanHumanoidComponents } from '../../src/domain/rules/npc-authoring/clean-humanoid-sheet.js';
import { loadNpcArtCatalog, type NpcArtCatalog } from '../../src/host/npc-art.js';
import {
  NPC_GM_REQUEST_READERS,
  npcSourceEventId,
  readNpcVersionDerivationEvidenceInTransaction,
  readNpcCompositionDerivationEvidenceInTransaction,
  readNpcAttemptDerivationEvidenceInTransaction,
} from '../../src/persistence/npc-gm-source.js';
import {
  readCampaignAdmissionAvailability,
  admissionDecisionStorage,
  readNpcCalendarContextInTransaction,
} from '../../src/persistence/campaign-admission-decision.js';
import { readHostedCurrentPausedCampaign } from '../../src/persistence/current-paused-campaign.js';
import {
  commitNpcVersion,
  commitNpcVersionPrepared,
  type NpcCommitInput,
  type NpcCommitPreparer,
  type NpcCommitPreparationContext,
  type NpcCommitPreparationIntegration,
} from '../../src/persistence/npc-library-store.js';
import {
  npcCheckpointAfter,
  npcPendingCommitEvidenceValue,
  type NpcPendingCommitEvidence,
  type NpcVersion,
} from '../../src/persistence/npc-library-records.js';
import type { NpcWorkflowCommandRequest } from '../../src/shared/npc-command.js';
import type {
  NpcEditorDraft,
  NpcEditorCatalog,
} from '../../src/domain/rules/npc-authoring/staged-input.js';
import {
  readNpcCampaignCheckpointLedgerInTransaction,
  verifyNpcCampaignCheckpointHistory,
} from '../../src/persistence/npc-campaign-checkpoints.js';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import type { NPC_NAV_TARGETS, NpcEditorReplaceRequest } from '@shared/npc-command.js';
import {
  applyNpcStageInput,
  createEmptyNpcEditorDraft,
  readNpcEditorDraft,
} from '../../src/domain/rules/npc-authoring/staged-input.js';
import { loadNpcAuthoringSourceCatalog } from '../../src/host/npc-catalog.js';
import {
  configurePersistenceDatabase,
  openPersistenceDatabase,
} from '../../src/persistence/database.js';
import { bootstrapDeviceIdentity, loadDeviceId } from '../../src/persistence/device-identity.js';
import { loadCampaignCheckpoint } from '../../src/persistence/store.js';
import {
  NetworkApplicationStoreError,
  networkApplicationStorage as s,
} from '../../src/persistence/network-local-application.js';
import {
  appendNpcGmSourceInTransaction,
  commitCampaignCreation,
  commitCampaignDraftUpdate,
  createCampaignDraft,
  createLocalGmContext,
  ensureLocalGmProfile,
  navigateCampaignDraft,
  readActiveLocalGmContext,
  readCampaignCreationCursor,
  readCampaignDraft,
  readCampaignOwnerBinding,
  readNpcGmSourceInTransaction,
  validateNpcHistoricalGmSourcesInTransaction,
  validateNpcCommitPreparationInTransaction,
  validateNpcPreparationInTransaction,
  type CampaignPrivateOwnerValidator,
  type RedactedCampaignDraftRequest,
} from '../../src/persistence/campaign-creation.js';
import {
  commitGmRequestReviewNavigation,
  readGmRequestReviewView,
  readGmRequestReviewSource,
} from '../../src/persistence/network-device-request.js';
import {
  saveNpcAttempt,
  saveNpcAttemptPrepared,
  type NpcAttemptPreparer,
  readNpcRecoveryClosure,
  type NpcBoundary,
  type NpcTransactionIntegration,
} from '../../src/persistence/npc-library-store.js';
import type {
  NpcAttempt,
  NpcDomainReaders,
  NpcHistoricalSourceReader,
  NpcRequestReader,
  NpcScope,
  NpcStage,
} from '../../src/persistence/npc-library-records.js';

const databases: Database.Database[] = [];
let catalog: NpcEditorCatalog;
let components: NpcCleanHumanoidComponents;
let artCatalog: NpcArtCatalog;
let fullSource: Awaited<ReturnType<typeof loadNpcAuthoringSourceCatalog>>;
export function setupNpcCommitFixture() {
  afterEach(() => {
    for (const db of databases.splice(0)) if (db.open) db.close();
  });
  beforeAll(async () => {
    const source = await loadNpcAuthoringSourceCatalog(process.cwd());
    fullSource = source;
    catalog = {
      skills: source.skills,
      development: source.development,
      traumas: { catalog: source.initialTrauma, bindings: [] },
    };
    components = {
      baseStats: source.baseStats,
      skills: source.skills,
      compositionConsequences: source.compositionConsequences,
      passiveHealth: source.passiveHealth,
    };
    artCatalog = await loadNpcArtCatalog(process.cwd());
  });
}

const json = (value: unknown): JsonObject => JSON.parse(s.canonical(value)) as JsonObject;
const unavailable = (): never => {
  throw new Error('No admission candidate in the NPC-only integration phase');
};
const verifier = { fixtureVerifier: 'private campaign creation proof' };
const timestamp = '2026-11-06T00:00:00.000Z';

/** Actual campaign birth and GM queue; no opaque replacement source/mirror tables. */
function fixture(restored?: { bytes: Buffer; scope: NpcScope; profileId: string }) {
  const db =
    restored === undefined ? openPersistenceDatabase(':memory:') : new Database(restored.bytes);
  databases.push(db);
  if (restored !== undefined) configurePersistenceDatabase(db);
  const ownerDeviceId = bootstrapDeviceIdentity(db),
    scope = restored?.scope ?? {
      ownerDeviceId,
      gmLocalContextId: randomUUID(),
      campaignId: randomUUID(),
    },
    profileId = restored?.profileId ?? randomUUID();
  const validateOwner: CampaignPrivateOwnerValidator = (owner) => {
    expect([
      owner.ownerDeviceId,
      owner.gmLocalContextId,
      owner.campaignId,
      owner.masterProfileId,
    ]).toEqual([scope.ownerDeviceId, scope.gmLocalContextId, scope.campaignId, profileId]);
    expect(owner.verifier).toEqual(verifier);
  };
  if (restored === undefined) {
    // Campaign validators are the existing persistence fixture boundary, not a claimed password/WS test.
    const trusted = () => {
      expect(loadDeviceId(db)).toBe(ownerDeviceId);
    };
    ensureLocalGmProfile(db, { ownerDeviceId, masterProfileId: profileId }, trusted);
    createLocalGmContext(
      db,
      { ownerDeviceId, masterProfileId: profileId, gmLocalContextId: scope.gmLocalContextId },
      trusted,
    );
    const campaignDraftId = randomUUID();
    createCampaignDraft(
      db,
      { gmLocalContextId: scope.gmLocalContextId, campaignDraftId, expectedRevisions: s.zero() },
      trusted,
    );
    for (const stage of [
      {
        form: 'CMP-001',
        variant: 'METADATA',
        values: { title: 'NPC queue fixture', description: null, art: null },
      },
      {
        form: 'CMP-002',
        variant: 'HOST',
        values: {
          activePlayerCapacity: 5,
          hostAddress: '127.0.0.1',
          hostPort: 30111,
          networkInterface: 'loopback',
        },
      },
      { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
      { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
    ] as const) {
      let draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
      if (draft.formId !== stage.form) {
        navigateCampaignDraft(
          db,
          {
            gmLocalContextId: scope.gmLocalContextId,
            campaignDraftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: s.vectorOf(draft),
            sourceFormId: draft.formId,
            targetFormId: stage.form,
          },
          trusted,
        );
        draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
      }
      const request = {
        messageType: 'campaign.draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: scope.gmLocalContextId,
          campaignDraftId,
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
            ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: verifier } }
            : {}),
        },
        trusted,
      );
    }
    let draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId: scope.gmLocalContextId,
        campaignDraftId,
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: s.vectorOf(draft),
        sourceFormId: draft.formId,
        targetFormId: 'CMP-005',
      },
      trusted,
    );
    draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
    commitCampaignCreation(
      db,
      {
        campaignId: scope.campaignId,
        receiptId: randomUUID(),
        createdAt: timestamp,
        qrPayload: `http://127.0.0.1:30111/?campaignId=${scope.campaignId}`,
        baselineVersion: 'technical-queue-fixture',
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
            gmLocalContextId: scope.gmLocalContextId,
            campaignDraftId,
            draftRevision: draft.draftRevision,
            preflightLeaseId: randomUUID(),
          },
        },
      },
      trusted,
    );
  }
  const view = () => readGmRequestReviewView(db, scope, validateOwner);
  const ordinaryNav = (actionKey: ActionKey) => {
    const current = view(),
      cursor = readCampaignCreationCursor(db, scope.gmLocalContextId);
    return commitGmRequestReviewNavigation(
      db,
      scope,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: cursor.formId,
        actionKey,
        expectedProjectionRevision:
          current?.projectionRevision ?? cursor.revisions.projectionRevision,
      },
      validateOwner,
      (source) => {
        expect(source.scope).toEqual(scope);
      },
    );
  };
  if (restored === undefined) {
    ordinaryNav('CMP-006::CTA::001');
    ordinaryNav('CMP-007::CTA::004');
    ordinaryNav('GM-001::CTA::004');
  }
  const apply = (
    previous: JsonObject,
    stage: NpcStage,
    input: JsonObject,
    context: NpcAttemptReadContext | null = null,
  ) =>
    json(
      applyNpcStageInput(
        npcEditorForItemAttempt(catalog, fullSource.inventory, context),
        previous,
        stage,
        input,
      ),
    );
  const calendar = () =>
    readNpcCalendarContextInTransaction(db, scope, validateOwner, {
      verifyInitial: unavailable,
      reduce: unavailable,
      buildProposal: unavailable,
    });
  const ordinary = createNpcOrdinaryDomainReaders(db, fullSource, catalog, artCatalog);
  const readers: NpcDomainReaders & NpcRequestReader & NpcHistoricalSourceReader = {
    ...ordinary,
    ...NPC_GM_REQUEST_READERS,
    createReadContext(campaignId) {
      expect(campaignId).toBe(scope.campaignId);
      return calendar();
    },
    validateHistoricalGmSources(entries, calendar) {
      validateNpcHistoricalGmSourcesInTransaction(
        db,
        entries,
        apply,
        ordinary.itemPreparation.apply,
        ordinary.applyArtPreparation,
        ordinary.diseasePreparation.apply,
        ordinary.traumaPreparation.apply,
        ordinary.symbiontPreparation.apply,
        (operation, event, previous, context) =>
          ordinary.compositionPreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? unavailable(),
          ),
        ordinary.woundPreparation.apply,
        ordinary.equipmentCompatibilityPreparation.apply,
        ordinary.compositeItemPreparation.apply,
        (operation, event, previous, context) =>
          ordinary.runtimeEffectPreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? unavailable(),
          ),
        (operation, event, previous, context) =>
          ordinary.customItemPreparation.apply(operation, event, previous, context),
        (operation, event, previous, context) =>
          ordinary.lifePreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? unavailable(),
          ),
        (operation, event, previous, context) =>
          ordinary.itemRestorePreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? unavailable(),
          ),
        (operation, event, previous, context) =>
          ordinary.weaverPreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? unavailable(),
          ),
        (operation, event, previous, context) =>
          ordinary.poisonPreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? unavailable(),
          ),
      );
    },
  };
  const integration: NpcTransactionIntegration = {
    readCheckedGmSource(boundary) {
      return readNpcGmSourceInTransaction(db, boundary.scope);
    },
    validate(boundary, checkpoint, _phase, checkedClosure) {
      expect(db.inTransaction).toBe(true);
      expect(boundary.scope).toEqual(scope);
      expect(checkpoint.campaignId).toBe(scope.campaignId);
      expect(readActiveLocalGmContext(db, scope.ownerDeviceId)?.gmLocalContextId).toBe(
        scope.gmLocalContextId,
      );
      // The birth-only private-owner API deliberately refuses any nonzero aggregate revision.
      // Current ownership is paired below with the verified origin/header and complete history.
      validateOwner(readCampaignOwnerBinding(db, scope.gmLocalContextId, scope.campaignId));
      const header = readHostedCurrentPausedCampaign(db, scope.campaignId, validateOwner);
      expect(header.stateRevision).toBe(checkpoint.stateRevision);
      // The writer just proved the full NPC closure and phase-0 structure/availability.
      // Reuse only that same-phase result; the public admission readers remain tested below.
      const calendar = checkedClosure.calendarContext;
      expect(Object.isFrozen(checkedClosure)).toBe(true);
      expect(Object.isFrozen(checkedClosure.operations)).toBe(true);
      expect(calendar?.scope).toEqual(scope);
      expect(calendar?.checkpoint).toEqual(checkpoint);
    },
    writeGmMirror(operation) {
      appendNpcGmSourceInTransaction(db, scope, operation);
    },
  };
  const action = (actionKey: keyof typeof NPC_NAV_TARGETS): FormActionIntentV2Message => {
    const current = view();
    if (current === null) throw new Error('Expected actual GM queue');
    return {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: current.formId,
      actionKey,
      expectedProjectionRevision: current.projectionRevision,
    };
  };
  const boundary = (
    kind: 'CREATE' | 'REPLACE' | 'CANCEL',
    request: FormActionIntentV2Message | NpcEditorReplaceRequest | NpcPreparationRequest,
    previous: NpcAttempt | null,
  ): NpcBoundary => ({
    scope,
    kind,
    operationId:
      request.messageType === 'navigation.form-action'
        ? request.navigationRequestId
        : request.operationId,
    request: json(request),
    expectedAttemptRevisionOrNull: previous?.revision ?? null,
    expectedCurrentVersionOrNull: null,
  });
  const save = (b: NpcBoundary, attempt: NpcAttempt, selectedIntegration = integration) =>
    saveNpcAttempt(db, b, attempt, randomUUID(), timestamp, readers, selectedIntegration);
  const create = (values = json(createEmptyNpcEditorDraft())) => {
    const attempt: NpcAttempt = {
      scope,
      npcDraftId: randomUUID(),
      candidateNpcUuid: randomUUID(),
      revision: 0,
      mode: 'CREATE_V1',
      targetOrNull: null,
      stage: 'NPC-002',
      status: 'OPEN',
      values,
    };
    const b = boundary('CREATE', action('NPC-001::CTA::001'), null),
      result = save(b, attempt);
    return { attempt, boundary: b, result };
  };
  function readContext(previous: NpcAttempt): NpcAttemptReadContext {
    const read = () => {
      const closure = readNpcRecoveryClosure(db, scope.campaignId, readers);
      const event = closure.attempts.find(
        (e) =>
          e.attempt.npcDraftId === previous.npcDraftId && e.attempt.revision === previous.revision,
      );
      if (event === undefined) throw Error('Missing exact saved attempt');
      const base =
        previous.targetOrNull === null
          ? null
          : closure.versions.find(
              (v) =>
                v.npcUuid === previous.targetOrNull?.npcUuid &&
                v.version === previous.targetOrNull.expectedCurrentVersion,
            );
      if (base === undefined) throw Error('Missing exact base');
      return npcAttemptReadContext(
        previous,
        event.operationId,
        closure.children,
        base === null
          ? null
          : {
              version: base,
              graph: ordinary.publishedChildGraph(base.snapshot, closure.calendarContext, null),
            },
      );
    };
    // Timed full-sheet provenance uses the same SQL snapshot as the checked closure.
    return db.inTransaction ? read() : db.transaction(read).deferred();
  }
  // Application-level helpers need only the wire request; the owning writer derives the candidate.
  function editorRequest(previous: NpcAttempt, values: JsonObject): NpcEditorReplaceRequest {
    const current = view();
    if (current === null) throw new Error('Missing GM view');
    return {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: scope.campaignId,
      sourceFormId: previous.stage,
      expectedRevisions: s.vectorOf(current),
      npcDraftId: previous.npcDraftId,
      expectedAttemptRevision: previous.revision,
      values,
    };
  }
  const replace = (previous: NpcAttempt, values: JsonObject) => {
    const request = editorRequest(previous, values);
    return {
      boundary: boundary('REPLACE', request, previous),
      attempt: {
        ...previous,
        revision: previous.revision + 1,
        values: apply(previous.values, previous.stage, values, readContext(previous)),
      },
    };
  };
  // N+1 scenarios reuse the guarded writer's exact prior context, rather than reading the
  // complete closure solely to prepare an edit immediately before the writer reads it again.
  function saveReplacement(previous: NpcAttempt, values: JsonObject) {
    const current = view();
    if (current === null) throw new Error('Missing GM view');
    const request: NpcEditorReplaceRequest = {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: scope.campaignId,
      sourceFormId: previous.stage,
      expectedRevisions: s.vectorOf(current),
      npcDraftId: previous.npcDraftId,
      expectedAttemptRevision: previous.revision,
      values,
    };
    const b = boundary('REPLACE', request, previous);
    let next: NpcAttempt | undefined;
    const result = saveNpcAttemptPrepared(
      db,
      b,
      { kind: 'EXISTING', npcDraftId: previous.npcDraftId },
      (context) => {
        expect(db.inTransaction).toBe(true);
        expect(context.previousOrNull?.attempt).toEqual(previous);
        const checkedPrevious = context.previousOrNull?.attempt;
        const readContext = context.previousReadContextOrNull;
        if (checkedPrevious === undefined || readContext === null)
          throw new Error('Missing checked replacement source');
        next = {
          ...checkedPrevious,
          revision: checkedPrevious.revision + 1,
          values: apply(checkedPrevious.values, checkedPrevious.stage, values, readContext),
        };
        return { next, receiptId: randomUUID(), committedAt: timestamp };
      },
      readers,
      {
        ...integration,
        validatePreparation(context) {
          validateNpcPreparationInTransaction(db, context);
        },
      },
    );
    if (next === undefined) throw new Error('Fresh edit did not prepare its exact attempt');
    return { boundary: b, attempt: next, result };
  }
  const navigate = (
    previous: NpcAttempt,
    actionKey: keyof typeof NPC_NAV_TARGETS,
    stage: NpcStage,
  ) => {
    const b = boundary('REPLACE', action(actionKey), previous),
      attempt = { ...previous, revision: previous.revision + 1, stage };
    const result = save(b, attempt);
    return { boundary: b, attempt, result };
  };
  const enter = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
  // Fresh B13 fixtures explicitly confirm their positive-HP life state through
  // the same guarded SET handler; historical saved inputs are not rewritten.
  function aliveRequest(
    previous: NpcAttempt,
  ): Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }> {
    const offered = db
      .transaction(() => ordinary.lifePreparation.inspect(previous, calendar()))
      .deferred();
    if (
      offered === null ||
      !offered.canSubmit ||
      !offered.lifeChoices.some((c) => c.value === 'ALIVE')
    )
      throw Error('Actual ALIVE confirmation capability required by this fixture');
    return {
      messageType: 'network.npc-preparation.request',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: scope.campaignId,
      sourceFormId: 'NPC-016',
      npcDraftId: previous.npcDraftId,
      expectedAttemptRevision: previous.revision,
      expectedRevisions: s.vectorOf(view() ?? unavailable()),
      preparation: {
        kind: 'LIFE_STATE_SET',
        input: {
          capabilityKey: offered.capabilityKey,
          lifeKind: 'ALIVE',
          remainingMinutesOrNull: null,
          reason: 'Explicit living initial state of this positive-HP fixture',
        },
      },
    };
  }
  function confirmAlive(previous: NpcAttempt): NpcAttempt {
    if (!fullSource.initialLifeAuthoringAvailable) return previous;
    const request = aliveRequest(previous);
    return saveNpcAttemptPreparedWithEvidence(
      db,
      boundary('REPLACE', request, previous),
      { kind: 'EXISTING', npcDraftId: previous.npcDraftId },
      (context) =>
        ordinary.lifePreparation.prepare(request, context, randomUUID, unavailable, timestamp),
      readers,
      {
        ...integration,
        validatePreparation(context) {
          validateNpcPreparationInTransaction(db, context);
        },
      },
    ).attemptEvent.attempt;
  }
  function fillOrdinary(
    initial: NpcAttempt,
    paid = false,
    stopAtInventory = false,
    preparedEdits = false,
  ) {
    let attempt = initial;
    const template = npcCleanHumanoidFixture(components, {
      npcUuid: attempt.candidateNpcUuid,
      owningControllerId: scope.gmLocalContextId,
      contextFactId: randomUUID(),
      compositionJournalId: randomUUID(),
    });
    // These two fixture refs are never committed: actual confirmation operation IDs are resolved at COMMIT.
    const person = template.input.identity;
    const fields: NpcEditorDraft = {
      schemaVersion: 1,
      identity: {
        name: enter(person.name),
        description: enter(person.description),
        affiliation: enter(person.affiliation),
        campaignRole: enter(person.campaignRole),
        sex: enter(person.sex),
        massKg: enter(person.massKg),
        artAssetKeyOrNull: enter(person.artAssetKeyOrNull),
      },
      schema: {
        raceCode: enter(person.raceCode),
        pureClassOrNull: enter(paid ? 'SOLDIER' : person.pureClassOrNull),
        anatomyProfileId: enter(person.anatomyProfileId),
      },
      baseStats: {
        S: enter(template.input.baseStats.S),
        D: enter(template.input.baseStats.D),
        M: enter(template.input.baseStats.M),
        C: enter(template.input.baseStats.C),
        I: enter(template.input.baseStats.I),
        Z: enter(template.input.baseStats.Z),
        W: enter(paid ? 4 : template.input.baseStats.W),
      },
      symbionts: enter([]),
      skills: enter(
        paid
          ? [
              {
                skillKey: enter(
                  catalog.skills.skills.find((skill) => skill.skillKey === 'UNARMED')?.skillKey ??
                    unavailable(),
                ),
                targetBonus: enter(1),
                pool: enter('START' as const),
              },
            ]
          : [],
      ),
      inventory: enter([]),
      initialState: {
        currentHP: enter(template.input.initialState.currentHP),
        effectInstanceIds: enter([]),
        traumaInstanceIds: enter([]),
        woundInstanceIds: enter([]),
        sourceSpecificStateFactIds: enter([]),
        deathConsequenceFactIdOrNull: enter(null),
      },
    };
    const stages = [
      ['NPC-002', fields.identity, 'NPC-002::CTA::001', 'NPC-011'],
      ['NPC-011', fields.schema, 'NPC-011::CTA::001', 'NPC-012'],
      ['NPC-012', fields.baseStats, 'NPC-012::CTA::001', 'NPC-013'],
      ['NPC-013', fields.symbionts, 'NPC-013::CTA::001', 'NPC-014'],
      ['NPC-014', fields.skills, 'NPC-014::CTA::001', 'NPC-015'],
      ['NPC-015', fields.inventory, 'NPC-015::CTA::001', 'NPC-016'],
      [
        'NPC-016',
        { input: fields.initialState, currentOeChanges: [] },
        'NPC-016::CTA::001',
        'NPC-017',
      ],
    ] as const;
    for (const [stage, value, actionKey, target] of stages) {
      if (stopAtInventory && stage === 'NPC-015') return attempt;
      expect(attempt.stage).toBe(stage);
      const stageValue =
        stage === 'NPC-016'
          ? {
              input: { ...s.object(attempt.values['initialState']), ...fields.initialState },
              currentOeChanges: [],
            }
          : value;
      const edit = preparedEdits
        ? saveReplacement(attempt, json(stageValue))
        : replace(attempt, json(stageValue));
      if (!preparedEdits) save(edit.boundary, edit.attempt);
      const confirmed = stage === 'NPC-016' ? confirmAlive(edit.attempt) : edit.attempt;
      attempt = navigate(confirmed, actionKey, target).attempt;
    }
    return attempt;
  }
  function commitBoundary(attempt: NpcAttempt) {
    const previous =
      readNpcRecoveryClosure(db, scope.campaignId, readers)
        .versions.filter((v) => v.npcUuid === attempt.candidateNpcUuid)
        .at(-1) ?? null;
    const current = view();
    if (current === null) throw new Error('Missing GM source');
    const request: NpcWorkflowCommandRequest = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      expectedRevisions: s.vectorOf(current),
      ...(previous === null
        ? {
            workflowCommandId: 'UI-CMD-NPC-COMMIT-V1' as const,
            payload: {
              campaignId: scope.campaignId,
              npcDraftId: attempt.npcDraftId,
              expectedAttemptRevision: attempt.revision,
            },
          }
        : {
            workflowCommandId: 'UI-CMD-NPC-NEW-VERSION' as const,
            payload: {
              phase: 'COMMIT' as const,
              campaignId: scope.campaignId,
              npcDraftId: attempt.npcDraftId,
              expectedAttemptRevision: attempt.revision,
              expectedCurrentVersion: previous.version,
            },
          }),
    };
    const b: NpcBoundary = {
      scope,
      operationId: request.commandId,
      kind: previous === null ? 'COMMIT_V1' : 'COMMIT',
      request: json(request),
      expectedAttemptRevisionOrNull: attempt.revision,
      expectedCurrentVersionOrNull: previous?.version ?? null,
    };
    return { boundary: b, previous };
  }
  function prepareCommit(attempt: NpcAttempt) {
    const { boundary: b, previous } = commitBoundary(attempt);
    const built = db
      .transaction(() =>
        ordinary.prepare(attempt, b.operationId, previous, calendar(), {
          committedAt: timestamp,
          beforeGmSource: readNpcGmSourceInTransaction(db, scope),
        }),
      )
      .deferred();
    const input = {
      npcDraftId: attempt.npcDraftId,
      npcUuid: attempt.candidateNpcUuid,
      receiptId: randomUUID(),
      checkpointId: randomUUID(),
      committedAt: timestamp,
      snapshot: json(built.snapshot),
      lifetimeFacts: built.lifetimeFacts,
      art: built.art,
      preStartTimeOrNull: built.preStartTimeOrNull,
      projectionChanged: true,
      visibilityChanged: false,
    };
    return { boundary: b, input };
  }
  function commit(attempt: NpcAttempt) {
    const prepared = prepareCommit(attempt);
    return {
      ...prepared,
      result: commitNpcVersion(db, prepared.boundary, prepared.input, readers, integration),
    };
  }
  // App workflows own derivation/closure validation. Building an unused low-level
  // prepared draft here repeats that work before the real app command even starts.
  function openWorkflowRequest(version: NpcVersion): NpcWorkflowCommandRequest {
    const current = view() ?? unavailable();
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
      expectedRevisions: s.vectorOf(current),
      payload: {
        phase: 'OPEN',
        campaignId: scope.campaignId,
        npcUuid: version.npcUuid,
        expectedCurrentVersion: version.version,
      },
    };
  }
  function commitWorkflowRequest(attempt: NpcAttempt): NpcWorkflowCommandRequest {
    const current = view() ?? unavailable();
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      expectedRevisions: s.vectorOf(current),
      ...(attempt.targetOrNull === null
        ? {
            workflowCommandId: 'UI-CMD-NPC-COMMIT-V1' as const,
            payload: {
              campaignId: scope.campaignId,
              npcDraftId: attempt.npcDraftId,
              expectedAttemptRevision: attempt.revision,
            },
          }
        : {
            workflowCommandId: 'UI-CMD-NPC-NEW-VERSION' as const,
            payload: {
              phase: 'COMMIT' as const,
              campaignId: scope.campaignId,
              npcDraftId: attempt.npcDraftId,
              expectedAttemptRevision: attempt.revision,
              expectedCurrentVersion: attempt.targetOrNull.expectedCurrentVersion,
            },
          }),
    };
  }
  function prepareOpen(version: NpcVersion) {
    const current = view();
    if (current === null) throw new Error('Missing GM source');
    const previousAttempt = readNpcRecoveryClosure(db, scope.campaignId, readers).attempts.find(
      (e) => e.operationId === version.operationId,
    )?.attempt;
    if (previousAttempt === undefined) throw new Error('Missing committed attempt');
    const request: NpcWorkflowCommandRequest = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
      expectedRevisions: s.vectorOf(current),
      payload: {
        phase: 'OPEN',
        campaignId: scope.campaignId,
        npcUuid: version.npcUuid,
        expectedCurrentVersion: version.version,
      },
    };
    const attempt: NpcAttempt = {
      ...previousAttempt,
      npcDraftId: randomUUID(),
      revision: 0,
      mode: 'APPEND_N_PLUS_ONE',
      targetOrNull: { npcUuid: version.npcUuid, expectedCurrentVersion: version.version },
      stage: 'NPC-002',
      status: 'OPEN',
      values: db.transaction(() => ordinary.initializeOpen(version, calendar())).deferred(),
    };
    const b: NpcBoundary = {
      scope,
      kind: 'OPEN',
      operationId: request.commandId,
      request: json(request),
      expectedAttemptRevisionOrNull: null,
      expectedCurrentVersionOrNull: version.version,
    };
    return { boundary: b, attempt };
  }
  function openNext(version: NpcVersion) {
    const prepared = prepareOpen(version);
    save(prepared.boundary, prepared.attempt);
    return prepared.attempt;
  }
  return {
    db,
    scope,
    profileId,
    readers,
    ordinary,
    calendar,
    integration,
    action,
    boundary,
    save,
    create,
    editorRequest,
    replace,
    saveReplacement,
    navigate,
    ordinaryNav,
    view,
    validateOwner,
    fillOrdinary,
    aliveRequest,
    confirmAlive,
    commit,
    prepareCommit,
    commitBoundary,
    openNext,
    prepareOpen,
    openWorkflowRequest,
    commitWorkflowRequest,
    readContext,
  };
}

/** The full saved format requires actual SQL life/inventory contexts, even for empty inventory. */
function readFixtureHumanoidSnapshot(
  h: ReturnType<typeof fixture>,
  value: unknown,
  pending: NpcPendingCommitEvidence | null = null,
): NpcHumanoidSnapshot {
  const checked = h.db
    .transaction(() => h.ordinary.snapshot(value, h.calendar(), pending))
    .deferred();
  expect(checked['format']).toBe('NPC_HUMANOID_V1');
  // The persistence interface returns JSON; its owning reader has rebuilt and checked the whole format.
  return checked as unknown as NpcHumanoidSnapshot;
}

/** Corrupt only the final root and its reciprocal seals; every earlier journal byte stays untouched. */
function forgeLastOrigin(h: ReturnType<typeof fixture>, values: JsonObject): void {
  const row = h.db
    .prepare('SELECT * FROM npc_attempt_event WHERE campaign_id=? ORDER BY rowid DESC LIMIT 1')
    .get(h.scope.campaignId) as { record_json: string };
  const event = s.object(JSON.parse(row.record_json) as unknown);
  const attempt = s.object(event['attempt']);
  expect(attempt['revision']).toBe(0);
  expect(attempt['status']).toBe('OPEN');
  const changedEvent = { ...event, attempt: { ...attempt, values } },
    eventText = s.canonical(changedEvent),
    eventSha = s.sha(eventText);
  const operationId = s.text(event['operationId']);
  const operationRow = h.db
    .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
    .get(operationId) as { record_json: string };
  const operation = s.object(JSON.parse(operationRow.record_json) as unknown);
  expect(['CREATE', 'OPEN']).toContain(operation['kind']);
  const operationText = s.canonical({ ...operation, attemptEventSha256: eventSha }),
    operationSha = s.sha(operationText);
  const mirrorRow = h.db
    .prepare(
      'SELECT event_id,record_json FROM gm_request_queue_event WHERE context_id=? AND campaign_id=? ORDER BY event_index DESC LIMIT 1',
    )
    .get(h.scope.gmLocalContextId, h.scope.campaignId) as { event_id: string; record_json: string };
  const mirror = s.object(JSON.parse(mirrorRow.record_json) as unknown),
    mutation = s.object(mirror['mutation']);
  expect(mutation['kind']).toBe('NPC_SOURCE');
  expect(s.object(mutation['cause'])['operationId']).toBe(operationId);
  const cause = { operationId, recordSha256: operationSha },
    eventId = npcSourceEventId(h.scope, cause);
  const mirrorText = s.canonical({ ...mirror, eventId, mutation: { kind: 'NPC_SOURCE', cause } });
  h.db
    .transaction(() => {
      expect(
        h.db
          .prepare(
            'UPDATE npc_attempt_event SET record_json=?,record_sha256=? WHERE operation_id=?',
          )
          .run(eventText, eventSha, operationId).changes,
      ).toBe(1);
      expect(
        h.db
          .prepare('UPDATE npc_attempt_head SET record_sha256=? WHERE campaign_id=? AND draft_id=?')
          .run(eventSha, h.scope.campaignId, attempt['npcDraftId']).changes,
      ).toBe(1);
      expect(
        h.db
          .prepare('UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?')
          .run(operationText, operationSha, operationId).changes,
      ).toBe(1);
      expect(
        h.db
          .prepare(
            'UPDATE gm_request_queue_event SET event_id=?,record_json=?,record_sha256=? WHERE event_id=?',
          )
          .run(eventId, mirrorText, s.sha(mirrorText), mirrorRow.event_id).changes,
      ).toBe(1);
      expect(
        h.db
          .prepare(
            'UPDATE gm_request_queue_view SET head_event_id=? WHERE context_id=? AND campaign_id=?',
          )
          .run(eventId, h.scope.gmLocalContextId, h.scope.campaignId).changes,
      ).toBe(1);
    })
    .immediate();
  // Prove the actual queue's source/mirror checks pass before asking the full domain closure.
  expect(h.view()?.formId).toBe('NPC-002');
}
export function registerNpcOrdinaryCommits() {
  describe('source-backed ordinary NPC commits in the campaign aggregate', () => {
    it('rejects nonempty CREATE origin before any write', () => {
      const h = fixture(),
        draft = createEmptyNpcEditorDraft();
      const values = json({
        ...draft,
        identity: { ...draft.identity, name: { kind: 'ENTERED', value: 'Forged CREATE' } },
      });
      const before = h.db.serialize();
      expect(() => h.create(values)).toThrow();
      expect(h.db.serialize().equals(before)).toBe(true);
      expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).attempts).toEqual([]);
      expect(h.create().result.replayed).toBe(false);
    });
    it.each(['missing', 'promise', 'source mutation', 'SQL write'] as const)(
      'rejects %s origin validator without a partial CREATE',
      (fault) => {
        const h = fixture(),
          before = h.db.serialize();
        const hostile =
          fault === 'missing'
            ? undefined
            : fault === 'promise'
              ? () => Promise.resolve()
              : fault === 'source mutation'
                ? (attempt: NpcAttempt) => {
                    Object.defineProperty(attempt.values, 'schemaVersion', { value: 99 });
                  }
                : () => {
                    h.db.prepare('UPDATE schema_migration SET name=name WHERE version=15').run();
                  };
        Object.defineProperty(h.readers, 'validateAttemptOrigin', { value: hostile });
        expect(() => h.create()).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
      },
    );
    it.each(['cleared', 'changed'] as const)(
      'rejects %s OPEN origin before any write',
      (variant) => {
        const h = fixture();
        h.commit(h.fillOrdinary(h.create().attempt));
        const version = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0]!;
        const prepared = h.prepareOpen(version),
          draft = readNpcEditorDraft(catalog, prepared.attempt.values);
        const values =
          variant === 'cleared'
            ? json(createEmptyNpcEditorDraft())
            : json({
                ...draft,
                identity: { ...draft.identity, name: { kind: 'ENTERED', value: 'Forged OPEN' } },
              });
        const before = h.db.serialize();
        expect(() => h.save(prepared.boundary, { ...prepared.attempt, values })).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
        expect(h.save(prepared.boundary, prepared.attempt).replayed).toBe(false);
      },
    );
    it.each(['CREATE', 'OPEN'] as const)(
      'rejects hash-valid forged %s origin during SQLite recovery',
      (kind) => {
        const h = fixture();
        if (kind === 'CREATE') h.create();
        else {
          h.commit(h.fillOrdinary(h.create().attempt));
          h.openNext(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0]!);
        }
        const draft = createEmptyNpcEditorDraft();
        forgeLastOrigin(
          h,
          json({
            ...draft,
            identity: { ...draft.identity, name: { kind: 'ENTERED', value: 'Forged origin' } },
          }),
        );
        const bytes = h.db.serialize();
        expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers)).toThrow();
        expect(h.db.serialize().equals(bytes)).toBe(true);
        const restored = fixture({ bytes, scope: h.scope, profileId: h.profileId });
        expect(restored.view()?.formId).toBe('NPC-002');
        expect(() =>
          readNpcRecoveryClosure(restored.db, restored.scope.campaignId, restored.readers),
        ).toThrow();
        expect(restored.db.serialize().equals(bytes)).toBe(true);
      },
    );
    it('commits V1 with real staged proofs and art, replays exactly, and reopens SQLite', () => {
      const h = fixture(),
        birth = loadCampaignCheckpoint(h.db, h.scope.campaignId);
      const attempt = h.fillOrdinary(h.create().attempt),
        committed = h.commit(attempt);
      expect(committed.result.replayed).toBe(false);
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(closure.versions).toHaveLength(1);
      expect(closure.blocks).toHaveLength(1);
      expect(closure.art).toHaveLength(1);
      const version = closure.versions[0]!;
      expect(version.npcUuid).toBe(attempt.candidateNpcUuid);
      expect(version.version).toBe(1);
      expect(version.attemptRevision).toBe(attempt.revision + 1);
      const snapshot = readFixtureHumanoidSnapshot(h, version.snapshot);
      expect(snapshot.sheet.input.identity.name).toBe('Наблюдатель');
      expect(snapshot.sheet.input.initialState.currentHP).toBe(70);
      expect(snapshot.sheet.input.symbionts).toEqual([]);
      expect(snapshot.derivation.skillProof.contexts[0]!.contextFactId).not.toBe(
        committed.boundary.operationId,
      );
      const after = loadCampaignCheckpoint(h.db, h.scope.campaignId);
      expect(after?.stateRevision).toBe((birth?.stateRevision ?? -1) + 1);
      expect(after?.projectionRevision).toBe((birth?.projectionRevision ?? -1) + 1);
      expect(after?.actorVisibilityRevision).toBe(birth?.actorVisibilityRevision);
      expect(h.view()?.formId).toBe('NPC-003');
      const bytes = h.db.serialize();
      expect(
        commitNpcVersion(h.db, committed.boundary, committed.input, h.readers, h.integration),
      ).toEqual({ ...committed.result, replayed: true });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
        closure,
      );
      expect(
        readHostedCurrentPausedCampaign(reopened.db, h.scope.campaignId, reopened.validateOwner)
          .stateRevision,
      ).toBe(after?.stateRevision);
    });

    it.each([false, true])(
      'appends N+1 through the real editor without replacing V1 facts, receipt or art (paid=%s)',
      (paid) => {
        const h = fixture(),
          first = h.commit(h.fillOrdinary(h.create().attempt, paid, false, true));
        const before = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
          v1 = before.versions[0]!;
        let attempt = h.openNext(v1);
        expect(readNpcEditorDraft(catalog, attempt.values).identity.artAssetKeyOrNull).toEqual({
          kind: 'ENTERED',
          value: v1.art.assetKey,
        });
        const fields = readNpcEditorDraft(catalog, attempt.values);
        const changed = h.saveReplacement(
          attempt,
          json({
            ...fields.identity,
            name: { kind: 'ENTERED', value: 'Наблюдатель после встречи' },
          }),
        );
        attempt = changed.attempt;
        for (const [actionKey, target] of [
          ['NPC-002::CTA::001', 'NPC-011'],
          ['NPC-011::CTA::001', 'NPC-012'],
          ['NPC-012::CTA::001', 'NPC-013'],
          ['NPC-013::CTA::001', 'NPC-014'],
          ['NPC-014::CTA::001', 'NPC-015'],
          ['NPC-015::CTA::001', 'NPC-016'],
        ] as const)
          attempt = h.navigate(attempt, actionKey, target).attempt;
        const hp = h.saveReplacement(
          attempt,
          json({
            input: { ...fields.initialState, currentHP: { kind: 'ENTERED', value: 63 } },
            currentOeChanges: [],
          }),
        );
        attempt = h.navigate(hp.attempt, 'NPC-016::CTA::001', 'NPC-017').attempt;
        const second = h.commit(attempt),
          after = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
        expect(after.versions).toHaveLength(2);
        expect(after.blocks).toHaveLength(2);
        expect(after.art).toEqual(before.art);
        expect(after.versions[0]).toEqual(v1);
        expect(after.blocks[0]).toEqual(before.blocks[0]);
        const v2 = after.versions[1]!,
          oldSnapshot = readFixtureHumanoidSnapshot(h, v1.snapshot),
          newSnapshot = readFixtureHumanoidSnapshot(h, v2.snapshot);
        expect(v2.version).toBe(2);
        expect(v2.npcUuid).toBe(v1.npcUuid);
        // Acquisition and composition facts stay immutable; publication proofs target the new COMMIT.
        expect(newSnapshot.derivation.skillProof).toEqual(oldSnapshot.derivation.skillProof);
        expect(newSnapshot.derivation.compositionProof).toEqual(
          oldSnapshot.derivation.compositionProof,
        );
        expect(newSnapshot.derivation.inventoryProof.commitOperationId).toBe(
          second.boundary.operationId,
        );
        expect(newSnapshot.derivation.initialLifeProof).toEqual({
          ...oldSnapshot.derivation.initialLifeProof,
          commitOperationId: second.boundary.operationId,
          temporaryWeaverAssignments: [],
        });
        const facts = oldSnapshot.derivation.skillProof.contexts[0]!.facts;
        expect(facts).toHaveLength(paid ? 1 : 0);
        if (paid) {
          expect(facts[0]).toMatchObject({
            kind: 'PAID_ACQUISITION',
            factId: `NPC_INITIAL_SKILL/${first.boundary.operationId}/1`,
            skillKey: 'UNARMED',
            pool: 'START',
            bonusBefore: 0,
            bonusAfter: 1,
          });
          expect(newSnapshot.derivation.skillProof.contexts[0]!.facts[0]?.factId).not.toContain(
            second.boundary.operationId,
          );
        }
        expect(newSnapshot.sheet.input.identity.name).toBe('Наблюдатель после встречи');
        expect(newSnapshot.sheet.input.initialState.currentHP).toBe(63);
        expect(v2.lifetimeFacts).toEqual(v1.lifetimeFacts);
        const bytes = h.db.serialize();
        expect(
          commitNpcVersion(h.db, first.boundary, first.input, h.readers, h.integration),
        ).toEqual({
          ...first.result,
          replayed: true,
        });
        expect(
          commitNpcVersion(h.db, second.boundary, second.input, h.readers, h.integration),
        ).toEqual({ ...second.result, replayed: true });
        expect(h.db.serialize().equals(bytes)).toBe(true);
        const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
        expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
          after,
        );
      },
      60_000,
    );

    it('binds derivation evidence to an actual immutable prefix and refuses a historical hole', () => {
      const h = fixture(),
        attempt = h.fillOrdinary(h.create().attempt);
      const prepared = h.prepareCommit(attempt);
      const target = {
        scope: h.scope,
        npcUuid: attempt.candidateNpcUuid,
        npcDraftId: attempt.npcDraftId,
        openAttemptRevision: attempt.revision,
        commitOperationId: prepared.boundary.operationId,
        targetVersion: 1,
      };
      let bytes = h.db.serialize();
      expect(() => readNpcVersionDerivationEvidenceInTransaction(h.db, target)).toThrow();
      h.db
        .transaction(() => {
          const evidence = readNpcVersionDerivationEvidenceInTransaction(h.db, target);
          expect(evidence.current.openAttempt).toEqual(attempt);
          expect(evidence.committedOrNull).toBeNull();
          expect(Object.isFrozen(evidence.current.skillConfirmation.values)).toBe(true);
          for (const changed of [
            { ...target, npcUuid: randomUUID() },
            { ...target, openAttemptRevision: target.openAttemptRevision - 1 },
            { ...target, scope: { ...target.scope, gmLocalContextId: randomUUID() } },
            { ...target, commitOperationId: evidence.current.rootOperationId },
            { ...target, unexpected: true },
          ])
            expect(() => readNpcVersionDerivationEvidenceInTransaction(h.db, changed)).toThrow();
        })
        .deferred();
      expect(h.db.serialize().equals(bytes)).toBe(true);
      commitNpcVersion(h.db, prepared.boundary, prepared.input, h.readers, h.integration);
      bytes = h.db.serialize();
      h.db
        .transaction(() => {
          const evidence = readNpcVersionDerivationEvidenceInTransaction(h.db, target);
          expect(evidence.committedOrNull?.operation.operationId).toBe(
            prepared.boundary.operationId,
          );
          expect(evidence.initialOrNull).toEqual(evidence.committedOrNull);
          expect(evidence.current.openAttempt).toEqual(attempt);
          expect(evidence.current).toEqual(evidence.committedOrNull?.prefix);
          expect(Object.isFrozen(evidence.current.skillConfirmation.values)).toBe(true);
          // A real COMMIT must not make different caller coordinates authoritative.
          for (const changed of [
            { ...target, scope: { ...target.scope, campaignId: randomUUID() } },
            { ...target, scope: { ...target.scope, gmLocalContextId: randomUUID() } },
            { ...target, scope: { ...target.scope, ownerDeviceId: randomUUID() } },
            { ...target, npcUuid: randomUUID() },
            { ...target, npcDraftId: randomUUID() },
            { ...target, openAttemptRevision: target.openAttemptRevision - 1 },
            { ...target, openAttemptRevision: target.openAttemptRevision + 1 },
            { ...target, targetVersion: target.targetVersion + 1 },
            { ...target, commitOperationId: evidence.current.rootOperationId },
            { ...target, commitOperationId: evidence.current.openOperationId },
          ])
            expect(() => readNpcVersionDerivationEvidenceInTransaction(h.db, changed)).toThrow();
          // An absent operation cannot be treated as a planned save after the committed frontier.
          expect(() =>
            readNpcVersionDerivationEvidenceInTransaction(h.db, {
              ...target,
              commitOperationId: randomUUID(),
            }),
          ).toThrow();
        })
        .deferred();
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });

    it.each(['CURRENT_SQL_METADATA', 'PREVIOUS_HASH_VALID_JSON'] as const)(
      'rechecks live prefix rows after %s changes between the ordered read and cause verification',
      (fault) => {
        const h = fixture(),
          attempt = h.fillOrdinary(h.create().attempt),
          bytes = h.db.serialize(),
          rollback = new Error('Rollback intentional prefix row change');
        expect(() =>
          h.db
            .transaction(() => {
              const normal = readNpcCompositionDerivationEvidenceInTransaction(h.db, attempt);
              expect(normal.current.openAttempt).toEqual(attempt);
              expect(normal.initialOrNull).toBeNull();
              expect(normal.previousOrNull).toBeNull();
              expect(Object.isFrozen(normal.current.openAttempt.values)).toBe(true);
              expect(h.db.serialize().equals(bytes)).toBe(true);
              const rows = h.db
                .prepare(
                  'SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? ORDER BY revision',
                )
                .all(h.scope.campaignId, attempt.npcDraftId) as Record<string, unknown>[];
              expect(rows.length).toBeGreaterThan(2);
              const currentRow = rows[1] ?? s.fail(),
                previousRow = rows[0] ?? s.fail(),
                operationId = s.text(currentRow['operation_id']);
              const operationRow = h.db
                .prepare('SELECT record_json FROM npc_operation WHERE operation_id=?')
                .get(operationId) as Record<string, unknown>;
              const targetRequest = s.object(
                s.parseCanonicalObject(s.text(operationRow['record_json']))['request'],
              );
              const originalRequest = NPC_GM_REQUEST_READERS.request;
              let injections = 0,
                changedRows = 0,
                corruptBytes: Buffer | null = null;
              const spy = vi
                .spyOn(NPC_GM_REQUEST_READERS, 'request')
                .mockImplementation((kind, value) => {
                  const parsed = originalRequest(kind, value);
                  if (injections === 0 && s.same(value, targetRequest)) {
                    injections++;
                    if (fault === 'CURRENT_SQL_METADATA') {
                      // This is an intermediate row, so the actual head FK remains intact.
                      changedRows = h.db
                        .prepare(
                          'UPDATE npc_attempt_event SET revision=revision+1000 WHERE operation_id=?',
                        )
                        .run(operationId).changes;
                    } else {
                      const changed = s.parseCanonicalObject(s.text(previousRow['record_json']));
                      const savedAttempt = s.object(changed['attempt']);
                      savedAttempt['values'] = {
                        ...s.object(savedAttempt['values']),
                        forgedPrefixMarker: true,
                      };
                      const changedJson = s.canonical(changed);
                      changedRows = h.db
                        .prepare(
                          'UPDATE npc_attempt_event SET record_json=?,record_sha256=? WHERE operation_id=?',
                        )
                        .run(
                          changedJson,
                          s.sha(changedJson),
                          s.text(previousRow['operation_id']),
                        ).changes;
                    }
                    corruptBytes = h.db.serialize();
                  }
                  return parsed;
                });
              try {
                expect(() =>
                  readNpcCompositionDerivationEvidenceInTransaction(h.db, attempt),
                ).toThrow(NetworkApplicationStoreError);
                expect(injections).toBe(1);
                expect(changedRows).toBe(1);
                expect(corruptBytes).not.toBeNull();
                expect(h.db.serialize().equals(corruptBytes ?? s.fail())).toBe(true);
              } finally {
                spy.mockRestore();
              }
              throw rollback;
            })
            .immediate(),
        ).toThrow(rollback);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );

    it('refuses a changed COMMIT payload and a corrupted version without writing', () => {
      const h = fixture(),
        committed = h.commit(h.fillOrdinary(h.create().attempt));
      let bytes = h.db.serialize();
      expect(() =>
        commitNpcVersion(
          h.db,
          {
            ...committed.boundary,
            request: {
              ...committed.boundary.request,
              payload: {
                ...(committed.boundary.request['payload'] as JsonObject),
                npcDraftId: randomUUID(),
              },
            },
          },
          committed.input,
          h.readers,
          h.integration,
        ),
      ).toThrow();
      expect(h.db.serialize().equals(bytes)).toBe(true);
      h.db.prepare('UPDATE npc_version SET record_sha256=?').run('0'.repeat(64));
      bytes = h.db.serialize();
      expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers)).toThrow();
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it('rolls back a mechanically valid sheet that is not the confirmed editor input', () => {
      const h = fixture(),
        attempt = h.fillOrdinary(h.create().attempt),
        prepared = h.prepareCommit(attempt);
      const pending = h.db
        .transaction(() => {
          const calendar = h.calendar();
          return npcPendingCommitEvidenceValue({
            kind: 'PENDING_NPC_COMMIT',
            scope: h.scope,
            operationId: prepared.boundary.operationId,
            npcUuid: attempt.candidateNpcUuid,
            npcDraftId: attempt.npcDraftId,
            version: 1,
            attemptRevision: attempt.revision + 1,
            committedAt: prepared.input.committedAt,
            beforeCheckpointSha256: s.sha(s.canonical(calendar.checkpoint)),
            beforeGmSource: readNpcGmSourceInTransaction(h.db, h.scope),
          });
        })
        .deferred();
      const saved = readFixtureHumanoidSnapshot(h, prepared.input.snapshot, pending);
      const other = {
        ...saved,
        sheet: {
          ...saved.sheet,
          input: {
            ...saved.sheet.input,
            initialState: { ...saved.sheet.input.initialState, currentHP: 64 },
          },
        },
      };
      // A complete source-backed decode must succeed before the writer rejects unconfirmed HP.
      expect(readFixtureHumanoidSnapshot(h, other, pending)).toEqual(other);
      const before = h.db.serialize(),
        gm = h.view(),
        checkpoint = loadCampaignCheckpoint(h.db, h.scope.campaignId);
      expect(() =>
        commitNpcVersion(
          h.db,
          prepared.boundary,
          { ...prepared.input, snapshot: json(other) },
          h.readers,
          h.integration,
        ),
      ).toThrow();
      expect(h.db.serialize().equals(before)).toBe(true);
      expect(h.view()).toEqual(gm);
      expect(loadCampaignCheckpoint(h.db, h.scope.campaignId)).toEqual(checkpoint);
      expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions).toEqual([]);
      expect(
        commitNpcVersion(h.db, prepared.boundary, prepared.input, h.readers, h.integration)
          .replayed,
      ).toBe(false);
    });
    it('rejects a hash-valid NPC checkpoint claiming another campaign ancestry', () => {
      const h = fixture(),
        committed = h.commit(h.fillOrdinary(h.create().attempt));
      const before = committed.result.operation.beforeCheckpoint,
        after = committed.result.operation.afterCheckpoint;
      const changed = (checkpoint: typeof before) => {
        const snapshot = JSON.parse(checkpoint.snapshotJson) as Record<string, unknown>;
        const campaign = snapshot['campaign'] as Record<string, unknown>;
        const payload = JSON.parse(campaign['payloadJson'] as string) as Record<string, unknown>;
        payload['title'] = 'Forged prior title';
        campaign['payloadJson'] = s.canonical(payload);
        return { ...checkpoint, snapshotJson: s.canonical(snapshot) };
      };
      const forged = {
        ...committed.result.operation,
        beforeCheckpoint: changed(before),
        afterCheckpoint: changed(after),
      };
      const encoded = s.canonical(forged);
      h.db
        .prepare('UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?')
        .run(encoded, s.sha(encoded), forged.operationId);
      const bytes = h.db.serialize();
      h.db
        .transaction(() => {
          const ledger = readNpcCampaignCheckpointLedgerInTransaction(h.db, h.scope.campaignId);
          expect(ledger.commits).toHaveLength(1);
          // All private row/transition seals are internally valid; only reconstructed aggregate ancestry rejects this.
          expect(() =>
            verifyNpcCampaignCheckpointHistory(
              ledger,
              new Map([
                [before.stateRevision, before],
                [after.stateRevision, after],
              ]),
              after,
            ),
          ).toThrow();
        })
        .deferred();
      expect(() =>
        readCampaignAdmissionAvailability(h.db, h.scope, h.validateOwner, {
          verifyInitial: unavailable,
          reduce: unavailable,
          buildProposal: unavailable,
          npc: h.readers,
        }),
      ).toThrow();
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
  });
}

export function registerNpcLazyPreparation() {
  describe('lazy NPC COMMIT preparation at the real aggregate boundary', () => {
    function setup() {
      const h = fixture();
      const attempt = h.fillOrdinary(h.create().attempt);
      const { boundary } = h.commitBoundary(attempt);
      const integration: NpcCommitPreparationIntegration = {
        ...h.integration,
        validateCommitPreparation(context) {
          validateNpcCommitPreparationInTransaction(h.db, context);
        },
      };
      function input(context: NpcCommitPreparationContext): NpcCommitInput {
        const current = context.previous.attempt;
        const built = h.ordinary.prepare(
          current,
          context.boundary.operationId,
          context.previousVersionOrNull,
          h.calendar(),
          { committedAt: timestamp, beforeGmSource: readNpcGmSourceInTransaction(h.db, h.scope) },
        );
        return {
          npcDraftId: current.npcDraftId,
          npcUuid: current.candidateNpcUuid,
          receiptId: randomUUID(),
          checkpointId: randomUUID(),
          committedAt: timestamp,
          snapshot: json(built.snapshot),
          lifetimeFacts: built.lifetimeFacts,
          art: built.art,
          preStartTimeOrNull: null,
          projectionChanged: true,
          visibilityChanged: false,
        };
      }
      return { h, attempt, boundary, integration, input };
    }
    it('prepares V1 once in the proved source, then replays without allocation after reopen', () => {
      const { h, attempt, boundary, integration, input } = setup();
      let calls = 0;
      let allocated: NpcCommitInput | undefined;
      const result = commitNpcVersionPrepared(
        h.db,
        boundary,
        attempt.npcDraftId,
        (context) => {
          calls++;
          expect(h.db.inTransaction).toBe(true);
          expect(Object.isFrozen(context)).toBe(true);
          expect(Object.isFrozen(context.previous.attempt.values)).toBe(true);
          expect(context.previous.attempt).toEqual(attempt);
          expect(context.previousVersionOrNull).toBeNull();
          expect(context.beforeGmSource.sourceFormId).toBe('NPC-017');
          expect(context.boundary).toEqual(boundary);
          allocated = input(context);
          return allocated;
        },
        h.readers,
        integration,
      );
      expect(calls).toBe(1);
      expect(result.replayed).toBe(false);
      expect(result.operation.receiptId).toBe(allocated?.receiptId);
      expect(result.operation.anchorOrNull?.checkpointId).toBe(allocated?.checkpointId);
      const bytes = h.db.serialize();
      const unexpected: NpcCommitPreparer = () => {
        calls++;
        throw new Error('Replay allocated');
      };
      expect(
        commitNpcVersionPrepared(
          h.db,
          boundary,
          'ignored on exact replay',
          unexpected,
          h.readers,
          integration,
        ),
      ).toEqual({ ...result, replayed: true });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      const reopenedIntegration: NpcCommitPreparationIntegration = {
        ...reopened.integration,
        validateCommitPreparation() {
          throw new Error('Replay entered preparation validation');
        },
      };
      expect(
        commitNpcVersionPrepared(
          reopened.db,
          boundary,
          'ignored on exact replay',
          unexpected,
          reopened.readers,
          reopenedIntegration,
        ),
      ).toEqual({ ...result, replayed: true });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      expect(calls).toBe(1);
      expect(
        readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers).versions,
      ).toHaveLength(1);
    });
    it('prepares N+1 against the actual current version and retains the immutable prefix', () => {
      const { h, attempt, boundary, integration, input } = setup();
      commitNpcVersionPrepared(h.db, boundary, attempt.npcDraftId, input, h.readers, integration);
      const original = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      let next = h.openNext(original.versions[0]!);
      for (const [key, stage] of [
        ['NPC-002::CTA::001', 'NPC-011'],
        ['NPC-011::CTA::001', 'NPC-012'],
        ['NPC-012::CTA::001', 'NPC-013'],
        ['NPC-013::CTA::001', 'NPC-014'],
        ['NPC-014::CTA::001', 'NPC-015'],
        ['NPC-015::CTA::001', 'NPC-016'],
        ['NPC-016::CTA::001', 'NPC-017'],
      ] as const)
        next = h.navigate(next, key, stage).attempt;
      const n = h.commitBoundary(next);
      let calls = 0;
      const result = commitNpcVersionPrepared(
        h.db,
        n.boundary,
        next.npcDraftId,
        (context) => {
          calls++;
          expect(context.previousVersionOrNull).toEqual(original.versions[0]);
          expect(context.previous.attempt).toEqual(next);
          return input(context);
        },
        h.readers,
        integration,
      );
      const after = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(result.operation.versionOrNull?.version).toBe(2);
      expect(calls).toBe(1);
      expect(after.versions[0]).toEqual(original.versions[0]);
      expect(after.blocks[0]).toEqual(original.blocks[0]);
      // Recovery exposes operations sorted by identity, not append order.
      const originalIds = new Set(original.operations.map((operation) => operation.operationId));
      expect(
        after.operations.filter((operation) => originalIds.has(operation.operationId)),
      ).toEqual(original.operations);
      expect(after.versions[1]!.lifetimeFacts).toEqual(original.versions[0]!.lifetimeFacts);
      const bytes = h.db.serialize();
      expect(
        commitNpcVersionPrepared(
          h.db,
          n.boundary,
          'unused',
          () => {
            calls++;
            throw new Error('N+1 replay allocated');
          },
          h.readers,
          integration,
        ).replayed,
      ).toBe(true);
      expect(calls).toBe(1);
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it.each([
      'FOREIGN_SCOPE',
      'STALE_ATTEMPT',
      'WRONG_DRAFT',
      'STALE_GM',
      'COLLISION',
      'WRONG_WORKFLOW',
    ] as const)('rejects %s before the COMMIT factory is entered', (kind) => {
      const { h, attempt, boundary, integration, input } = setup();
      let request = boundary;
      let draftId = attempt.npcDraftId;
      if (kind === 'FOREIGN_SCOPE')
        request = { ...boundary, scope: { ...h.scope, gmLocalContextId: randomUUID() } };
      if (kind === 'STALE_ATTEMPT')
        request = { ...boundary, expectedAttemptRevisionOrNull: attempt.revision + 1 };
      if (kind === 'WRONG_DRAFT') draftId = randomUUID();
      if (kind === 'STALE_GM')
        request = {
          ...boundary,
          request: json({
            ...boundary.request,
            expectedRevisions: {
              ...s.vectorOf(h.view()!),
              projectionRevision: h.view()!.projectionRevision + 1,
            },
          }),
        };
      if (kind === 'COLLISION')
        request = {
          ...boundary,
          operationId: attempt.candidateNpcUuid,
          request: json({ ...boundary.request, commandId: attempt.candidateNpcUuid }),
        };
      if (kind === 'WRONG_WORKFLOW')
        request = {
          ...boundary,
          request: json({
            ...boundary.request,
            workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
            payload: {
              phase: 'COMMIT',
              campaignId: h.scope.campaignId,
              npcDraftId: attempt.npcDraftId,
              expectedAttemptRevision: attempt.revision,
              expectedCurrentVersion: 1,
            },
          }),
        };
      const bytes = h.db.serialize();
      let calls = 0;
      expect(() =>
        commitNpcVersionPrepared(
          h.db,
          request,
          draftId,
          (context) => {
            calls++;
            return input(context);
          },
          h.readers,
          integration,
        ),
      ).toThrow();
      expect(calls).toBe(0);
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it.each([
      'ASYNC',
      'BOUND_ASYNC',
      'GENERATOR',
      'PROMISE',
      'THEN_GETTER',
      'RESULT_GETTER',
      'DML',
      'CONTEXT_MUTATION',
    ] as const)('rejects %s preparation without an aggregate write', (kind) => {
      const { h, attempt, boundary, integration, input } = setup();
      let entered = 0,
        getterReads = 0;
      const body = (context: NpcCommitPreparationContext) => {
        entered++;
        return input(context);
      };
      let factory: unknown = body;
      if (kind === 'ASYNC' || kind === 'BOUND_ASYNC') {
        const asyncBody = async (context: NpcCommitPreparationContext) => {
          await Promise.resolve();
          return body(context);
        };
        factory = kind === 'ASYNC' ? asyncBody : asyncBody.bind(null);
      }
      if (kind === 'GENERATOR')
        factory = function* (context: NpcCommitPreparationContext) {
          yield body(context);
        };
      if (kind === 'PROMISE')
        factory = () => {
          entered++;
          return Promise.reject(new Error('Rejected preparation'));
        };
      if (kind === 'THEN_GETTER')
        factory = () => {
          entered++;
          return Object.defineProperty({}, 'then', {
            enumerable: true,
            get() {
              getterReads++;
              return undefined;
            },
          });
        };
      if (kind === 'RESULT_GETTER')
        factory = (context: NpcCommitPreparationContext) => {
          const value = body(context);
          return Object.defineProperty(value, 'snapshot', {
            enumerable: true,
            get() {
              getterReads++;
              return {};
            },
          });
        };
      if (kind === 'DML')
        factory = (context: NpcCommitPreparationContext) => {
          const value = body(context);
          h.db
            .prepare('UPDATE campaign SET payload_json=payload_json WHERE campaign_id=?')
            .run(h.scope.campaignId);
          return value;
        };
      if (kind === 'CONTEXT_MUTATION')
        factory = (context: NpcCommitPreparationContext) => {
          entered++;
          Object.assign(context.previous.attempt, { candidateNpcUuid: randomUUID() });
          return input(context);
        };
      const bytes = h.db.serialize();
      expect(() =>
        commitNpcVersionPrepared(
          h.db,
          boundary,
          attempt.npcDraftId,
          factory as NpcCommitPreparer,
          h.readers,
          integration,
        ),
      ).toThrow();
      expect(entered).toBe(['ASYNC', 'BOUND_ASYNC', 'GENERATOR'].includes(kind) ? 0 : 1);
      expect(getterReads).toBe(0);
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it('requires an own synchronous preparation validator before allocations', () => {
      const { h, attempt, boundary, integration, input } = setup();
      let calls = 0,
        getterReads = 0;
      const bad = Object.defineProperty({ ...integration }, 'validateCommitPreparation', {
        get() {
          getterReads++;
          return integration.validateCommitPreparation;
        },
      });
      const bytes = h.db.serialize();
      expect(() =>
        commitNpcVersionPrepared(
          h.db,
          boundary,
          attempt.npcDraftId,
          (context) => {
            calls++;
            return input(context);
          },
          h.readers,
          bad,
        ),
      ).toThrow();
      expect(calls).toBe(0);
      expect(getterReads).toBe(0);
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it.each(['ROOT', 'NESTED'] as const)(
      'refuses %s result Proxy before traps or a delayed SQLite write can run',
      async (kind) => {
        const { h, attempt, boundary, integration, input } = setup();
        let traps = 0;
        let delayedWrites = 0;
        function hostile<T extends object>(target: T): T {
          return new Proxy(target, {
            getPrototypeOf(value) {
              traps++;
              queueMicrotask(() => {
                delayedWrites++;
                h.db
                  .prepare('UPDATE campaign SET payload_json=payload_json WHERE campaign_id=?')
                  .run(h.scope.campaignId);
              });
              return Reflect.getPrototypeOf(value);
            },
          });
        }
        const bytes = h.db.serialize();
        expect(() =>
          commitNpcVersionPrepared(
            h.db,
            boundary,
            attempt.npcDraftId,
            (context) => {
              const value = input(context);
              return kind === 'ROOT'
                ? hostile(value)
                : { ...value, snapshot: hostile(value.snapshot) };
            },
            h.readers,
            integration,
          ),
        ).toThrow();
        await Promise.resolve();
        expect(traps).toBe(0);
        expect(delayedWrites).toBe(0);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );
  });
}

export function registerNpcItemReservation() {
  describe('actual NPC item reservation and immutable weapon publication', () => {
    let weaponV1Seed: Readonly<{
      bytesBase64: string;
      scope: NpcScope;
      profileId: string;
      itemId: string;
      closureJson: string;
    }>;
    beforeAll(() => {
      const started = performance.now(),
        { h, attempt } = stageFixture();
      try {
        const reserve = reservation(h, attempt);
        reserve.run();
        const reserved = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
          itemId = reserved.children[0]!.allocation.id,
          saved = reserved.attempts.find(
            (e) => e.operationId === reserve.boundary.operationId,
          )!.attempt;
        publication(h, filledWeapon(h, saved, itemId), itemId).run();
        const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
        expect(closure.versions).toHaveLength(1);
        weaponV1Seed = Object.freeze({
          bytesBase64: h.db.serialize().toString('base64'),
          scope: Object.freeze({ ...h.scope }),
          profileId: h.profileId,
          itemId,
          closureJson: s.canonical(closure),
        });
      } finally {
        h.db.close();
        console.info('NPC weapon V1 fixture setup ms:', performance.now() - started);
      }
    });

    function stageFixture() {
      const h = fixture(),
        attempt = h.fillOrdinary(h.create().attempt, false, true);
      expect(attempt.stage).toBe('NPC-015');
      return { h, attempt };
    }
    function reservation(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      allocate: () => string = randomUUID,
    ) {
      const current = h.view();
      if (current === null) throw Error('Missing current GM');
      const request: NpcPreparationRequest = {
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        expectedRevisions: s.vectorOf(current),
        sourceFormId: 'NPC-015',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        preparation: { kind: 'ITEM_RESERVE', values: { kind: 'ENTERED', value: [] } },
      };
      const boundary = h.boundary('REPLACE', request, attempt);
      const integration = {
        ...h.integration,
        validatePreparation(context: Parameters<typeof validateNpcPreparationInTransaction>[1]) {
          validateNpcPreparationInTransaction(h.db, context);
        },
      };
      let calls = 0;
      const prepare: NpcAttemptPreparer = (context) => {
        calls++;
        const old = context.previousOrNull?.attempt,
          readContext = context.previousReadContextOrNull;
        if (old === undefined || readContext === null) throw Error('Missing actual prior attempt');
        if (request.preparation.kind !== 'ITEM_RESERVE') throw Error('Expected item reservation');
        expect(h.db.inTransaction).toBe(true);
        expect(Object.isFrozen(readContext)).toBe(true);
        const itemInstanceId = allocate();
        return {
          next: {
            ...old,
            revision: old.revision + 1,
            values: h.ordinary.itemPreparation.apply(
              old.values,
              request.preparation.values,
              itemInstanceId,
              readContext,
              context.boundary.operationId,
            ),
          },
          receiptId: randomUUID(),
          committedAt: timestamp,
          childAllocations: [{ kind: 'ITEM', id: itemInstanceId }],
        };
      };
      const run = () =>
        saveNpcAttemptPrepared(
          h.db,
          boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          prepare,
          h.readers,
          integration,
        );
      return { boundary, request, integration, prepare, run, calls: () => calls };
    }
    function filledWeapon(
      h: ReturnType<typeof fixture>,
      reserved: NpcAttempt,
      itemInstanceId: string,
    ) {
      const { itemInstanceId: checkedItem, profile, ...input } = npcKensiRequest(itemInstanceId);
      const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
      const values = json({
        kind: 'ENTERED',
        value: [
          {
            itemInstanceId: checkedItem,
            profile: entered(profile),
            input: Object.fromEntries(
              Object.entries(input).map(([key, value]) => [key, entered(value)]),
            ),
          },
        ],
      });
      const edit = h.replace(reserved, values);
      h.save(edit.boundary, edit.attempt);
      let attempt = h.navigate(edit.attempt, 'NPC-015::CTA::001', 'NPC-016').attempt;
      const template = npcCleanHumanoidFixture(components, {
        npcUuid: attempt.candidateNpcUuid,
        owningControllerId: h.scope.gmLocalContextId,
        contextFactId: randomUUID(),
        compositionJournalId: randomUUID(),
      });
      const initial = h.replace(
        attempt,
        json({
          input: {
            currentHP: entered(template.input.initialState.currentHP),
            effectInstanceIds: entered([]),
            traumaInstanceIds: entered([]),
            woundInstanceIds: entered([]),
            sourceSpecificStateFactIds: entered([]),
            deathConsequenceFactIdOrNull: entered(null),
          },
          currentOeChanges: [],
        }),
      );
      h.save(initial.boundary, initial.attempt);
      attempt = h.navigate(h.confirmAlive(initial.attempt), 'NPC-016::CTA::001', 'NPC-017').attempt;
      return attempt;
    }
    function publication(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      itemInstanceId: string,
    ) {
      const { boundary } = h.commitBoundary(attempt);
      let calls = 0,
        profileId: string | null = null;
      const integration = {
        ...h.integration,
        validateCommitPreparation(context: NpcCommitPreparationContext) {
          validateNpcCommitPreparationInTransaction(h.db, context);
        },
      };
      const prepare: NpcCommitPreparer = (context) => {
        calls++;
        const original = context.previousVersionOrNull === null;
        if (original) profileId = randomUUID();
        const profiles =
          profileId === null ? [] : [{ itemInstanceId, weaponProfileVersionId: profileId }];
        const built = h.ordinary.prepare(
          context.previous.attempt,
          boundary.operationId,
          context.previousVersionOrNull,
          h.calendar(),
          { committedAt: timestamp, beforeGmSource: readNpcGmSourceInTransaction(h.db, h.scope) },
          original ? { committedAt: timestamp, profiles } : undefined,
        );
        return {
          npcDraftId: attempt.npcDraftId,
          npcUuid: attempt.candidateNpcUuid,
          receiptId: randomUUID(),
          checkpointId: randomUUID(),
          committedAt: timestamp,
          snapshot: built.snapshot,
          lifetimeFacts: built.lifetimeFacts,
          art: built.art,
          preStartTimeOrNull: null,
          projectionChanged: true,
          visibilityChanged: false,
          childAllocations: profiles.map((p) => ({
            kind: 'WEAPON_PROFILE_VERSION' as const,
            id: p.weaponProfileVersionId,
            itemInstanceId,
            weaponVariantId: 'DEFAULT' as const,
          })),
        };
      };
      const run = () =>
        commitNpcVersionPrepared(
          h.db,
          boundary,
          attempt.npcDraftId,
          prepare,
          h.readers,
          integration,
        );
      return {
        boundary,
        integration,
        prepare,
        run,
        calls: () => calls,
        profileId: () => profileId,
      };
    }
    it('reserves a real item before NPC015, commits the exact source weapon and replays after reopen', () => {
      const { h, attempt } = stageFixture(),
        reserve = reservation(h, attempt),
        first = reserve.run();
      expect(first.replayed).toBe(false);
      expect(reserve.calls()).toBe(1);
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(closure.children).toHaveLength(1);
      const child = closure.children[0]!;
      expect(child.allocation.kind).toBe('ITEM');
      const saved = closure.attempts.find(
        (e) => e.operationId === reserve.boundary.operationId,
      )!.attempt;
      const draft = readNpcEditorDraft(
        npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(saved)),
        saved.values,
      );
      expect(draft.inventory.kind).toBe('ENTERED');
      if (draft.inventory.kind !== 'ENTERED') throw Error('Missing reserved row');
      expect(draft.inventory.value[0]?.itemInstanceId).toBe(child.allocation.id);
      expect(draft.inventory.value[0]?.profile).toEqual({ kind: 'UNSET' });
      expect(Object.values(draft.inventory.value[0]!.input).every((v) => v.kind === 'UNSET')).toBe(
        true,
      );
      const reservedBytes = h.db.serialize();
      expect(reserve.run()).toEqual({ ...first, replayed: true });
      expect(reserve.calls()).toBe(1);
      expect(h.db.serialize().equals(reservedBytes)).toBe(true);
      const ready = filledWeapon(h, saved, child.allocation.id),
        commit = publication(h, ready, child.allocation.id),
        result = commit.run();
      expect(result.replayed).toBe(false);
      expect(commit.calls()).toBe(1);
      const current = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(current.children).toHaveLength(2);
      expect(current.versions).toHaveLength(1);
      const sheet = readFixtureHumanoidSnapshot(h, current.versions[0]!.snapshot);
      expect(sheet.derivation.inventoryProof.entries[0]?.request).toEqual(
        npcKensiRequest(child.allocation.id),
      );
      expect(sheet.derivation.inventoryProof.entries[0]?.weaponProfileVersionId).toBe(
        commit.profileId(),
      );
      expect(sheet.derivation.inventoryProof.actorId).toBe(h.profileId);
      expect(sheet.derivation.inventoryProof.commitOperationId).toBe(commit.boundary.operationId);
      expect(sheet.derivation.inventoryProof.committedAt).toBe(timestamp);
      const bytes = h.db.serialize(),
        reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      const unexpected = () => {
        throw Error('Exact replay invoked allocation');
      };
      expect(
        commitNpcVersionPrepared(
          reopened.db,
          commit.boundary,
          ready.npcDraftId,
          unexpected,
          reopened.readers,
          { ...reopened.integration, validateCommitPreparation: unexpected },
        ),
      ).toEqual({ ...result, replayed: true });
      expect(
        readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers).versions,
      ).toEqual(current.versions);
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    });
    it('preserves initial item, profile and audit bytes through a real N+1 and reopen', () => {
      const h = fixture({
          bytes: Buffer.from(weaponV1Seed.bytesBase64, 'base64'),
          scope: { ...weaponV1Seed.scope },
          profileId: weaponV1Seed.profileId,
        }),
        itemId = weaponV1Seed.itemId;
      const original = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        v1 = original.versions[0]!;
      expect(s.canonical(original)).toBe(weaponV1Seed.closureJson);
      let next = h.openNext(v1);
      const fields = readNpcEditorDraft(
        npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(next)),
        next.values,
      );
      const edit = h.replace(
        next,
        json({
          ...fields.identity,
          name: { kind: 'ENTERED', value: 'Новая версия с прежним предметом' },
        }),
      );
      h.save(edit.boundary, edit.attempt);
      next = edit.attempt;
      let inventoryConfirmationId: string | null = null;
      for (const [key, stage] of [
        ['NPC-002::CTA::001', 'NPC-011'],
        ['NPC-011::CTA::001', 'NPC-012'],
        ['NPC-012::CTA::001', 'NPC-013'],
        ['NPC-013::CTA::001', 'NPC-014'],
        ['NPC-014::CTA::001', 'NPC-015'],
        ['NPC-015::CTA::001', 'NPC-016'],
        ['NPC-016::CTA::001', 'NPC-017'],
      ] as const) {
        const navigated = h.navigate(next, key, stage);
        if (key === 'NPC-015::CTA::001') inventoryConfirmationId = navigated.boundary.operationId;
        next = navigated.attempt;
      }
      expect(inventoryConfirmationId).not.toBeNull();
      const second = publication(h, next, itemId),
        result = second.run();
      expect(second.calls()).toBe(1);
      expect(second.profileId()).toBeNull();
      expect(result.operation.versionOrNull?.version).toBe(2);
      const after = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(after.children).toEqual(original.children);
      expect(after.versions[0]).toEqual(v1);
      expect(after.blocks[0]).toEqual(original.blocks[0]);
      const old = readFixtureHumanoidSnapshot(h, v1.snapshot),
        latest = readFixtureHumanoidSnapshot(h, after.versions[1]!.snapshot);
      // N+1 retains the actual entries/profile IDs while publishing a new confirmed inventory revision.
      expect(latest.derivation.inventoryProof).toEqual({
        ...old.derivation.inventoryProof,
        commitOperationId: second.boundary.operationId,
        sourceOperationId: inventoryConfirmationId,
        committedAt: timestamp,
        previous: {
          npcUuid: v1.npcUuid,
          version: v1.version,
          sha256: s.sha(s.canonical(v1)),
          commitOperationId: v1.operationId,
        },
      });
      expect(latest.sheet.input.inventory).toEqual(old.sheet.input.inventory);
      expect(latest.sheet.itemProfiles).toEqual(old.sheet.itemProfiles);
      expect(after.versions[1]!.lifetimeFacts).toEqual(v1.lifetimeFacts);
      const bytes = h.db.serialize();
      expect(second.run()).toEqual({ ...result, replayed: true });
      expect(second.calls()).toBe(1);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(
        readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers).versions,
      ).toEqual(after.versions);
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    }, 60_000);
    it('rolls back item rows and mirrors after a late fault and protects reciprocal allocation namespaces', () => {
      const { h, attempt } = stageFixture(),
        reserve = reservation(h, attempt),
        bytes = h.db.serialize();
      expect(() =>
        saveNpcAttemptPrepared(
          h.db,
          reserve.boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          reserve.prepare,
          h.readers,
          {
            ...reserve.integration,
            writeGmMirror(operation) {
              h.integration.writeGmMirror(operation);
              expect(h.db.prepare('SELECT count(*) AS n FROM npc_child_identity').get()).toEqual({
                n: 1,
              });
              throw Error('injected after actual item and GM mirror');
            },
          },
        ),
      ).toThrow('injected after actual item and GM mirror');
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const existing = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      for (const occupied of [
        h.scope.ownerDeviceId,
        h.scope.campaignId,
        attempt.candidateNpcUuid,
        existing.operations[0]!.receiptId,
      ]) {
        const collision = reservation(h, attempt, () => occupied);
        expect(collision.run).toThrow();
        expect(collision.calls()).toBe(1);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      }
      reserve.run();
      const saved = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        id = saved.children[0]!.allocation.id;
      const protectedBytes = h.db.serialize();
      expect(() =>
        createLocalGmContext(
          h.db,
          {
            gmLocalContextId: id,
            masterProfileId: h.profileId,
            ownerDeviceId: h.scope.ownerDeviceId,
          },
          () => undefined,
        ),
      ).toThrow();
      expect(h.db.serialize().equals(protectedBytes)).toBe(true);
      const changed = {
        ...reserve.boundary,
        request: json({
          ...reserve.request,
          preparation: { kind: 'ITEM_RESERVE', values: { kind: 'UNSET' } },
        }),
      };
      let rejectedFactoryCalls = 0;
      const unexpected: NpcAttemptPreparer = () => {
        rejectedFactoryCalls++;
        throw Error('Rejected request entered factory');
      };
      expect(() =>
        saveNpcAttemptPrepared(
          h.db,
          changed,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          unexpected,
          h.readers,
          reserve.integration,
        ),
      ).toThrow();
      expect(rejectedFactoryCalls).toBe(0);
      expect(h.db.serialize().equals(protectedBytes)).toBe(true);
    });
    it('keeps a cancelled attempt reservation unavailable to a new NPC and other writers', () => {
      const { h, attempt } = stageFixture(),
        reserve = reservation(h, attempt);
      reserve.run();
      const captured = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        itemId = captured.children[0]!.allocation.id;
      let current = captured.attempts.find(
        (e) => e.operationId === reserve.boundary.operationId,
      )!.attempt;
      for (const [key, stage] of [
        ['NPC-015::CTA::002', 'NPC-014'],
        ['NPC-014::CTA::002', 'NPC-013'],
        ['NPC-013::CTA::002', 'NPC-012'],
        ['NPC-012::CTA::002', 'NPC-011'],
        ['NPC-011::CTA::002', 'NPC-002'],
      ] as const)
        current = h.navigate(current, key, stage).attempt;
      h.save(h.boundary('CANCEL', h.action('NPC-002::CTA::003'), current), {
        ...current,
        revision: current.revision + 1,
        status: 'CANCELLED',
      });
      const cancelled = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(cancelled.children).toEqual(captured.children);
      expect(cancelled.versions).toEqual([]);
      const next = h.fillOrdinary(h.create().attempt, false, true),
        bytes = h.db.serialize();
      const reuse = reservation(h, next, () => itemId);
      expect(reuse.run).toThrow();
      expect(reuse.calls()).toBe(1);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      expect(() =>
        createLocalGmContext(
          h.db,
          {
            gmLocalContextId: itemId,
            masterProfileId: h.profileId,
            ownerDeviceId: h.scope.ownerDeviceId,
          },
          () => undefined,
        ),
      ).toThrow();
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it('refuses malformed, stale, foreign and unsupported preparations before the item factory', () => {
      const { h, attempt } = stageFixture(),
        reserve = reservation(h, attempt),
        bytes = h.db.serialize();
      let calls = 0;
      const unexpected: NpcAttemptPreparer = () => {
        calls++;
        throw Error('Rejected source allocated');
      };
      const requests = [
        {
          ...reserve.request,
          preparation: { kind: 'ITEM_RESERVE', values: { unknownPrivateInput: 'must refuse' } },
        },
        {
          ...reserve.request,
          expectedRevisions: {
            ...reserve.request.expectedRevisions,
            projectionRevision: reserve.request.expectedRevisions.projectionRevision + 1,
          },
        },
        { ...reserve.request, npcDraftId: randomUUID() },
        { ...reserve.request, campaignId: randomUUID() },
        { ...reserve.request, sourceFormId: 'NPC-002', preparation: { kind: 'ART_CLEAR' } },
      ];
      for (const request of requests) {
        expect(() =>
          saveNpcAttemptPrepared(
            h.db,
            { ...reserve.boundary, request: json(request) },
            { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
            unexpected,
            h.readers,
            reserve.integration,
          ),
        ).toThrow();
        expect(calls).toBe(0);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      }
    });

    function inventoryPreview(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      previous: NpcVersion | null = null,
    ) {
      return h.db
        .transaction(() => {
          readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
          return h.ordinary.preview(attempt, previous, h.calendar());
        })
        .deferred();
    }
    it('previews actual reserved inventory in NPC016 and NPC017 after reopen without publication identities', () => {
      const { h, attempt } = stageFixture(),
        reserve = reservation(h, attempt);
      reserve.run();
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        itemId = closure.children[0]!.allocation.id;
      const reserved = closure.attempts.find(
        (e) => e.operationId === reserve.boundary.operationId,
      )!.attempt;
      const ready = filledWeapon(h, reserved, itemId),
        bytes = h.db.serialize(),
        value = inventoryPreview(h, ready);
      expect(value.sheet.input.inventory).toEqual([npcKensiRequest(itemId)]);
      expect(value.sheet.itemProfiles[0]?.request).toEqual(npcKensiRequest(itemId));
      const profile = value.sheet.itemProfiles[0];
      if (profile === undefined || !('stagedProfile' in profile))
        throw Error('Expected weapon fixture');
      expect(profile.stagedProfile).toMatchObject({
        weaponTypeId: 'ITM-WPN-003',
        statSource: 'TEMPLATE_FIXED',
      });
      expect(value.sheet.stats.equippedStats).toEqual(value.sheet.stats.effectiveStats);
      expect(value.sheet.input.initialState.currentHP).toBe(70);
      expect(JSON.stringify(value)).not.toMatch(
        /weaponProfileVersionId|definitionId|rollGroupId|commitOperationId|committedAt|NPC_INITIAL_SKILL/,
      );
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(inventoryPreview(reopened, ready)).toEqual(value);
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      const back = h.navigate(ready, 'NPC-017::CTA::003', 'NPC-016').attempt,
        before = h.db.serialize();
      expect(inventoryPreview(h, back).sheet).toEqual(value.sheet);
      expect(h.db.serialize().equals(before)).toBe(true);
      const final = h.navigate(back, 'NPC-016::CTA::001', 'NPC-017').attempt;
      expect(inventoryPreview(h, final).sheet).toEqual(value.sheet);
      expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).children).toEqual(
        closure.children,
      );
    });
    it('previews unchanged real N+1 inventory using the original immutable publication', () => {
      const h = fixture({
          bytes: Buffer.from(weaponV1Seed.bytesBase64, 'base64'),
          scope: { ...weaponV1Seed.scope },
          profileId: weaponV1Seed.profileId,
        }),
        itemId = weaponV1Seed.itemId;
      const original = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        v1 = original.versions[0]!;
      expect(s.canonical(original)).toBe(weaponV1Seed.closureJson);
      let next = h.openNext(v1);
      for (const [key, stage] of [
        ['NPC-002::CTA::001', 'NPC-011'],
        ['NPC-011::CTA::001', 'NPC-012'],
        ['NPC-012::CTA::001', 'NPC-013'],
        ['NPC-013::CTA::001', 'NPC-014'],
        ['NPC-014::CTA::001', 'NPC-015'],
        ['NPC-015::CTA::001', 'NPC-016'],
        ['NPC-016::CTA::001', 'NPC-017'],
      ] as const)
        next = h.navigate(next, key, stage).attempt;
      const bytes = h.db.serialize(),
        value = inventoryPreview(h, next, v1),
        saved = readFixtureHumanoidSnapshot(h, v1.snapshot);
      expect(value.binding.targetVersion).toBe(2);
      expect(value.sheet.input.inventory).toEqual(
        saved.derivation.inventoryProof.entries.map((e) => e.request),
      );
      expect(value.sheet.stats).toEqual(saved.sheet.stats);
      expect(value.sheet.itemProfiles[0]?.request.itemInstanceId).toBe(itemId);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(inventoryPreview(reopened, next, v1)).toEqual(value);
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      const after = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(after.versions).toEqual(original.versions);
      expect(after.children).toEqual(original.children);
    });
    it('reports unfilled real reserved inventory as incomplete without publishing or discarding its row', () => {
      const { h, attempt } = stageFixture(),
        reserve = reservation(h, attempt);
      reserve.run();
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        saved = closure.attempts.find(
          (e) => e.operationId === reserve.boundary.operationId,
        )!.attempt;
      const next = h.navigate(saved, 'NPC-015::CTA::001', 'NPC-016').attempt,
        bytes = h.db.serialize();
      let error: unknown;
      try {
        inventoryPreview(h, next);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(NpcOrdinaryPreviewInputError);
      expect(error).toMatchObject({ code: 'INCOMPLETE' });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).children).toEqual(
        closure.children,
      );
    });
    it('previews an empty confirmed N+1 inventory without changing the prior publication or SQLite', () => {
      const h = fixture({
          bytes: Buffer.from(weaponV1Seed.bytesBase64, 'base64'),
          scope: { ...weaponV1Seed.scope },
          profileId: weaponV1Seed.profileId,
        }),
        original = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        v1 = original.versions[0]!;
      expect(s.canonical(original)).toBe(weaponV1Seed.closureJson);
      let next = h.openNext(v1);
      for (const [key, stage] of [
        ['NPC-002::CTA::001', 'NPC-011'],
        ['NPC-011::CTA::001', 'NPC-012'],
        ['NPC-012::CTA::001', 'NPC-013'],
        ['NPC-013::CTA::001', 'NPC-014'],
        ['NPC-014::CTA::001', 'NPC-015'],
      ] as const)
        next = h.navigate(next, key, stage).attempt;
      const cleared = h.replace(next, json({ kind: 'ENTERED', value: [] }));
      h.save(cleared.boundary, cleared.attempt);
      next = h.navigate(cleared.attempt, 'NPC-015::CTA::001', 'NPC-016').attempt;
      next = h.navigate(next, 'NPC-016::CTA::001', 'NPC-017').attempt;
      const bytes = h.db.serialize(),
        checkpoint = loadCampaignCheckpoint(h.db, h.scope.campaignId),
        originalVersionBytes = s.canonical(v1);
      expect(s.object(s.object(v1.snapshot['sheet'])['input'])['inventory']).toHaveLength(1);
      const preview = inventoryPreview(h, next, v1);
      expect(preview.kind).toBe('UNCOMMITTED');
      expect(preview.binding).toEqual({
        scope: h.scope,
        npcUuid: v1.npcUuid,
        npcDraftId: next.npcDraftId,
        attemptRevision: next.revision,
        targetVersion: v1.version + 1,
        stage: 'NPC-017',
      });
      expect(preview.sheet.input.inventory).toEqual([]);
      expect(preview.sheet.itemProfiles).toEqual([]);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      expect(inventoryPreview(h, next, v1)).toEqual(preview);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const after = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(after.versions).toEqual(original.versions);
      expect(after.children).toEqual(original.children);
      expect(after.blocks).toEqual(original.blocks);
      expect(after.art).toEqual(original.art);
      expect(s.canonical(after.versions[0])).toBe(originalVersionBytes);
      expect(loadCampaignCheckpoint(h.db, h.scope.campaignId)).toEqual(checkpoint);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      expect(after.versions[0]).toEqual(v1);
    });

    it('rejects an item collision atomically and missing historical preparation handler', () => {
      const { h, attempt } = stageFixture(),
        bytes = h.db.serialize();
      const collide = reservation(h, attempt, () => h.scope.campaignId);
      expect(collide.run).toThrow();
      expect(collide.calls()).toBe(1);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reserve = reservation(h, attempt);
      reserve.run();
      const valid = h.db.serialize();
      const expectedApplies = readNpcRecoveryClosure(
        h.db,
        h.scope.campaignId,
        h.readers,
      ).operations.filter(
        (operation) => operation.request['messageType'] === 'network.npc-editor.replace',
      ).length;
      expect(expectedApplies).toBeGreaterThan(0);
      let applied = 0;
      const readers = {
        ...h.readers,
        validateHistoricalGmSources(
          entries: Parameters<NpcHistoricalSourceReader['validateHistoricalGmSources']>[0],
        ) {
          validateNpcHistoricalGmSourcesInTransaction(
            h.db,
            entries,
            (saved, stage, input, context) => {
              const result = json(
                applyNpcStageInput(
                  npcEditorForItemAttempt(catalog, fullSource.inventory, context ?? null),
                  saved,
                  stage,
                  input,
                ),
              );
              applied++;
              return result;
            },
          );
        },
      };
      expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, readers)).toThrow();
      expect(applied).toBe(expectedApplies);
      expect(h.db.serialize().equals(valid)).toBe(true);
      h.db.prepare('DELETE FROM npc_child_identity').run();
      const damaged = h.db.serialize();
      expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers)).toThrow();
      expect(h.db.serialize().equals(damaged)).toBe(true);
    });
  });
}

export function registerNpcReadOnlyPreview() {
  describe('read-only NPC-017 preview with actual SQLite provenance', () => {
    function preview(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      previous: NpcVersion | null = null,
    ) {
      return h.db
        .transaction(() => {
          readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
          return h.ordinary.preview(attempt, previous, h.calendar());
        })
        .deferred();
    }
    it('calculates V1 and N+1 without a prospective COMMIT, then retains the first acquisition facts', () => {
      const h = fixture(),
        first = h.fillOrdinary(h.create().attempt, true);
      const bytes = h.db.serialize(),
        value = preview(h, first);
      expect(value).toMatchObject({
        kind: 'UNCOMMITTED',
        binding: {
          scope: h.scope,
          npcUuid: first.candidateNpcUuid,
          npcDraftId: first.npcDraftId,
          attemptRevision: first.revision,
          targetVersion: 1,
        },
        sheet: {
          maxHP: 100,
          input: {
            initialState: { currentHP: 70 },
            skills: { capacity: 2, used: 2, remaining: 0 },
          },
        },
        preStartTimeOrNull: null,
      });
      expect(JSON.stringify(value)).not.toMatch(
        /NPC_INITIAL_SKILL|commitOperationId|acquisitionFactId|committedAt/,
      );
      expect(Buffer.from(value.art.bytesBase64, 'base64').byteLength).toBeGreaterThan(0);
      expect(preview(h, first)).toEqual(value);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(preview(reopened, first)).toEqual(value);
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      h.commit(first);
      const v1 = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0]!;
      const saved = readFixtureHumanoidSnapshot(h, v1.snapshot);
      expect(value.sheet.stats).toEqual({
        ...saved.sheet.stats,
        equippedStats: saved.sheet.stats.effectiveStats,
      });
      expect(saved.sheet.input.skills.learnedSkills[0]?.charges[0]?.acquisitionFactId).toBe(
        `NPC_INITIAL_SKILL/${v1.operationId}/1`,
      );
      let next = h.openNext(v1);
      for (const [key, stage] of [
        ['NPC-002::CTA::001', 'NPC-011'],
        ['NPC-011::CTA::001', 'NPC-012'],
        ['NPC-012::CTA::001', 'NPC-013'],
        ['NPC-013::CTA::001', 'NPC-014'],
        ['NPC-014::CTA::001', 'NPC-015'],
        ['NPC-015::CTA::001', 'NPC-016'],
        ['NPC-016::CTA::001', 'NPC-017'],
      ] as const)
        next = h.navigate(next, key, stage).attempt;
      const beforeNext = h.db.serialize();
      const candidate = preview(h, next, v1);
      expect(candidate.binding.targetVersion).toBe(2);
      expect(candidate.sheet).toEqual({
        ...value.sheet,
        input: {
          ...value.sheet.input,
          identity: { ...value.sheet.input.identity, artAssetKeyOrNull: value.art.assetKey },
        },
      });
      expect(h.db.serialize().equals(beforeNext)).toBe(true);
      h.commit(next);
      const v2 = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[1]!;
      const savedNext = readFixtureHumanoidSnapshot(h, v2.snapshot);
      expect(savedNext.derivation.skillProof).toEqual(saved.derivation.skillProof);
      expect(savedNext.derivation.compositionProof).toEqual(saved.derivation.compositionProof);
      expect(savedNext.derivation.inventoryProof.commitOperationId).toBe(v2.operationId);
      expect(savedNext.derivation.initialLifeProof).toEqual({
        ...saved.derivation.initialLifeProof,
        commitOperationId: v2.operationId,
        temporaryWeaverAssignments: [],
      });
    });
    it('rejects a stale/foreign/frontier request as provenance failure and never as an input blocker', () => {
      const h = fixture(),
        first = h.fillOrdinary(h.create().attempt);
      const target = {
        scope: h.scope,
        npcUuid: first.candidateNpcUuid,
        npcDraftId: first.npcDraftId,
        openAttemptRevision: first.revision,
        targetVersion: 1,
        stage: 'NPC-017' as const,
      };
      const bytes = h.db.serialize();
      expect(() => readNpcAttemptDerivationEvidenceInTransaction(h.db, target)).toThrow();
      h.db
        .transaction(() => {
          expect(
            readNpcAttemptDerivationEvidenceInTransaction(h.db, target).current.openAttempt,
          ).toEqual(first);
          for (const changed of [
            { ...target, commitOperationId: randomUUID() },
            { ...target, stage: 'NPC-016' as const },
            { ...target, npcUuid: randomUUID() },
            { ...target, openAttemptRevision: first.revision - 1 },
            { ...target, scope: { ...h.scope, gmLocalContextId: randomUUID() } },
          ])
            expect(() => readNpcAttemptDerivationEvidenceInTransaction(h.db, changed)).toThrow();
        })
        .deferred();
      expect(h.db.serialize().equals(bytes)).toBe(true);
      h.commit(first);
      const committedBytes = h.db.serialize();
      let caught: unknown;
      try {
        preview(h, first);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(NpcOrdinaryPreviewInputError);
      expect(h.db.serialize().equals(committedBytes)).toBe(true);
    });
    it('reports a saved explicit HP error as input, but rejects a damaged actual journal outside that boundary', () => {
      const h = fixture(),
        first = h.fillOrdinary(h.create().attempt);
      const back = h.navigate(first, 'NPC-017::CTA::003', 'NPC-016').attempt;
      const draft = readNpcEditorDraft(catalog, back.values);
      const edit = h.replace(
        back,
        json({
          input: { ...draft.initialState, currentHP: { kind: 'ENTERED', value: 101 } },
          currentOeChanges: [],
        }),
      );
      h.save(edit.boundary, edit.attempt);
      const candidate = h.navigate(edit.attempt, 'NPC-016::CTA::001', 'NPC-017').attempt;
      const bytes = h.db.serialize();
      let caught: unknown;
      try {
        preview(h, candidate);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NpcOrdinaryPreviewInputError);
      expect(caught).toMatchObject({ code: 'INVALID' });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      h.db
        .prepare('UPDATE npc_attempt_head SET record_sha256=? WHERE campaign_id=? AND draft_id=?')
        .run('0'.repeat(64), h.scope.campaignId, candidate.npcDraftId);
      const corruptBytes = h.db.serialize();
      caught = undefined;
      try {
        preview(h, candidate);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(NpcOrdinaryPreviewInputError);
      expect(h.db.serialize().equals(corruptBytes)).toBe(true);
    });
    it('validates actual NPC-016 before forward and still requires actual NPC-017 for COMMIT', () => {
      const h = fixture(),
        first = h.fillOrdinary(h.create().attempt);
      const expected = preview(h, first);
      const back = h.navigate(first, 'NPC-017::CTA::003', 'NPC-016').attempt;
      const bytes = h.db.serialize(),
        actual = preview(h, back);
      expect(actual.binding).toMatchObject({ stage: 'NPC-016', attemptRevision: back.revision });
      expect(actual.sheet).toEqual(expected.sheet);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      expect(() =>
        h.db
          .transaction(() =>
            h.ordinary.prepare(back, randomUUID(), null, h.calendar(), {
              committedAt: timestamp,
              beforeGmSource: readNpcGmSourceInTransaction(h.db, h.scope),
            }),
          )
          .deferred(),
      ).toThrow();
      expect(() => preview(h, { ...back, stage: 'NPC-017' })).toThrow();
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const final = h.navigate(back, 'NPC-016::CTA::001', 'NPC-017').attempt;
      expect(preview(h, final).sheet).toEqual(actual.sheet);
    });
  });
}

export function registerNpcPhaseZeroContext() {
  describe('ordinary NPC phase zero context handoff', () => {
    it('issues context once before every early snapshot/graph and origin, including N+1 and external OPEN', () => {
      const h = fixture();
      let freshCalls = 0;
      const originalSnapshot = h.readers.snapshot;
      Object.defineProperty(h.readers, 'snapshot', {
        value: (
          value: unknown,
          calendar: Parameters<NpcDomainReaders['snapshot']>[1],
          pending: Parameters<NpcDomainReaders['snapshot']>[2],
        ) => {
          if (pending !== null) {
            freshCalls++;
            expect(calendar?.operations.some((o) => o.operationId === pending.operationId)).toBe(
              false,
            );
            expect(pending.committedAt).toBe(timestamp);
            expect(pending.beforeCheckpointSha256).toBe(s.sha(s.canonical(calendar?.checkpoint)));
            expect(pending.beforeGmSource.queuePrefix).toEqual(calendar?.currentQueuePrefixOrNull);
          }
          return originalSnapshot(value, calendar, pending);
        },
      });
      h.commit(h.fillOrdinary(h.create().attempt));
      expect(freshCalls).toBe(1);
      const first = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      const version = first.versions[0]!;
      let phaseCalls = 0,
        inspectionCalls = 0;
      let issued: ReturnType<typeof h.calendar> | null = null;
      const readers = {
        ...h.readers,
        createReadContext(campaignId: string) {
          phaseCalls++;
          return h.readers.createReadContext(campaignId);
        },
        inspectStoredSnapshot(
          value: unknown,
          calendar: Parameters<NpcDomainReaders['snapshot']>[1],
        ) {
          expect(phaseCalls).toBe(1);
          expect(calendar).not.toBeNull();
          if (issued === null) issued = calendar;
          else expect(calendar).toBe(issued);
          inspectionCalls++;
          const inspection = h.ordinary.inspectStoredSnapshot(value, calendar);
          expect(inspection.snapshot).toEqual(value);
          expect(inspection.publishedChildGraph).toEqual({
            items: [],
            effects: [],
            traumas: [],
            symbionts: [],
            wounds: [],
          });
          expect(inspection.requiredPreStartTimeOrNull).toBeNull();
          return inspection;
        },
        snapshot: unavailable,
        publishedChildGraph: unavailable,
        requiredPreStartTime: unavailable,
      };
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, readers);
      expect(phaseCalls).toBe(1);
      expect(inspectionCalls).toBe(closure.versions.length);
      expect(closure.calendarContext).toBe(issued);
      expect(
        closure.calendarContext?.operations.find((o) => o.operationId === version.operationId)
          ?.versionOrNull,
      ).toEqual(
        closure.operations.find((o) => o.operationId === version.operationId)?.versionOrNull,
      );
      const context = closure.calendarContext;
      if (context === null) throw new Error('Missing actual phase zero context');
      const opened = h.db.transaction(() => h.ordinary.initializeOpen(version, context)).deferred();
      expect(opened).toEqual(h.prepareOpen(version).attempt.values);
      const before = h.db.serialize();
      expect(() => h.ordinary.snapshot(version.snapshot, null, null)).toThrow(
        'missing checked calendar read context',
      );
      // The existing SQL callback guard translates a domain refusal to its public INVALID_INPUT code.
      expect(() =>
        readNpcRecoveryClosure(h.db, h.scope.campaignId, {
          ...h.readers,
          createReadContext: () => null,
        }),
      ).toThrow('network application storage: INVALID_INPUT');
      expect(h.db.serialize().equals(before)).toBe(true);
      h.openNext(version);
      const recovered = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(recovered.calendarContext?.operations.length).toBe(recovered.operations.length);
      expect(
        recovered.calendarContext?.operations.find((o) => o.operationId === version.operationId),
      ).toEqual(context.operations.find((o) => o.operationId === version.operationId));
    });
  });
}

export function registerNpcDiseaseReservation() {
  describe('actual NPC016 disease intent reservation', () => {
    function readyForIntent() {
      const h = fixture();
      const final = h.fillOrdinary(h.create().attempt);
      return { h, attempt: h.navigate(final, 'NPC-017::CTA::003', 'NPC-016').attempt };
    }
    function reserveDisease(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      allocate: () => string = randomUUID,
    ) {
      const view = h.view();
      if (view === null) throw Error('Missing actual GM view');
      const request: NpcPreparationRequest = {
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        expectedRevisions: s.vectorOf(view),
        sourceFormId: 'NPC-016',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-RHINITIS' },
      };
      if (request.preparation.kind !== 'DISEASE_RESERVE')
        throw Error('Expected disease reservation');
      const diseaseId = request.preparation.diseaseId;
      const boundary = h.boundary('REPLACE', request, attempt),
        integration = {
          ...h.integration,
          validatePreparation(context: Parameters<typeof validateNpcPreparationInTransaction>[1]) {
            validateNpcPreparationInTransaction(h.db, context);
          },
        };
      let calls = 0;
      const prepare: NpcAttemptPreparer = (context) => {
        calls++;
        const old = context.previousOrNull?.attempt,
          readContext = context.previousReadContextOrNull;
        if (old === undefined || readContext === null)
          throw Error('Missing real previous attempt/context');
        const effectInstanceId = allocate();
        return {
          next: {
            ...old,
            revision: old.revision + 1,
            values: h.ordinary.diseasePreparation.apply(
              old.values,
              diseaseId,
              effectInstanceId,
              readContext,
              context.boundary.operationId,
            ),
          },
          receiptId: randomUUID(),
          committedAt: timestamp,
          childAllocations: [
            {
              kind: 'EFFECT_INSTANCE',
              id: effectInstanceId,
              diseaseId: diseaseId,
            },
          ],
        };
      };
      const run = () =>
        saveNpcAttemptPrepared(
          h.db,
          boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          prepare,
          h.readers,
          integration,
        );
      return { request, boundary, integration, prepare, run, calls: () => calls };
    }
    it('reserves only an owned selectable intent, replays after reopen and keeps selection separate', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveDisease(h, attempt),
        first = reserve.run();
      expect(reserve.calls()).toBe(1);
      expect(first.replayed).toBe(false);
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        child = closure.children[0]!;
      expect(child.allocation).toMatchObject({
        kind: 'EFFECT_INSTANCE',
        diseaseId: 'DIS-RHINITIS',
      });
      const current = closure.attempts.find(
        (e) => e.operationId === reserve.boundary.operationId,
      )!.attempt;
      expect(current.values).toEqual(attempt.values);
      expect(current.revision).toBe(attempt.revision + 1);
      expect(closure.versions).toEqual([]);
      expect(JSON.stringify(current.values)).not.toMatch(
        /effectTypeId|tickSchedule|startsAt|createdAt/,
      );
      const bytes = h.db.serialize();
      expect(reserve.run()).toEqual({ ...first, replayed: true });
      expect(reserve.calls()).toBe(1);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      const unexpected = () => {
        throw Error('Exact replay allocated');
      };
      expect(
        saveNpcAttemptPrepared(
          reopened.db,
          reserve.boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          unexpected,
          reopened.readers,
          { ...reopened.integration, validatePreparation: unexpected },
        ),
      ).toEqual({ ...first, replayed: true });
      expect(
        readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers).children,
      ).toEqual(closure.children);
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      const fields = readNpcEditorDraft(
        npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(current)),
        current.values,
      );
      const selection = h.replace(
        current,
        json({
          input: {
            ...fields.initialState,
            effectInstanceIds: { kind: 'ENTERED', value: [child.allocation.id] },
          },
          currentOeChanges: [],
        }),
      );
      h.save(selection.boundary, selection.attempt);
      expect(
        readNpcEditorDraft(
          npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(selection.attempt)),
          selection.attempt.values,
        ).initialState.effectInstanceIds,
      ).toEqual({ kind: 'ENTERED', value: [child.allocation.id] });
      expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions).toEqual([]);
    });
    it('rejects stale/foreign/trace-only/malformed intent and absent handler before the allocation factory', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveDisease(h, attempt),
        bytes = h.db.serialize();
      let calls = 0;
      const unexpected: NpcAttemptPreparer = () => {
        calls++;
        throw Error('Rejected source allocated');
      };
      for (const request of [
        { ...reserve.request, npcDraftId: randomUUID() },
        {
          ...reserve.request,
          expectedRevisions: {
            ...reserve.request.expectedRevisions,
            projectionRevision: reserve.request.expectedRevisions.projectionRevision + 1,
          },
        },
        {
          ...reserve.request,
          preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-PESTILENCE' },
        },
        {
          ...reserve.request,
          preparation: { ...reserve.request.preparation, startsAt: { campaignTimestamp: 1 } },
        },
      ]) {
        expect(() =>
          saveNpcAttemptPrepared(
            h.db,
            { ...reserve.boundary, request: json(request) },
            { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
            unexpected,
            h.readers,
            reserve.integration,
          ),
        ).toThrow();
        expect(calls).toBe(0);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      }
      const { validateDiseaseReservation: _omitted, ...withoutHandler } = h.readers;
      expect(() =>
        saveNpcAttemptPrepared(
          h.db,
          reserve.boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          unexpected,
          withoutHandler,
          reserve.integration,
        ),
      ).toThrow();
      expect(calls).toBe(0);
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it('keeps an unselected cancelled intent occupied without creating a version or runtime effect', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveDisease(h, attempt);
      reserve.run();
      const original = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        child = original.children[0]!;
      let current = original.attempts.find(
        (e) => e.operationId === reserve.boundary.operationId,
      )!.attempt;
      for (const [key, stage] of [
        ['NPC-016::CTA::002', 'NPC-015'],
        ['NPC-015::CTA::002', 'NPC-014'],
        ['NPC-014::CTA::002', 'NPC-013'],
        ['NPC-013::CTA::002', 'NPC-012'],
        ['NPC-012::CTA::002', 'NPC-011'],
        ['NPC-011::CTA::002', 'NPC-002'],
      ] as const)
        current = h.navigate(current, key, stage).attempt;
      h.save(h.boundary('CANCEL', h.action('NPC-002::CTA::003'), current), {
        ...current,
        revision: current.revision + 1,
        status: 'CANCELLED',
      });
      const cancelled = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        bytes = h.db.serialize();
      expect(cancelled.children).toEqual(original.children);
      expect(cancelled.versions).toEqual([]);
      expect(() =>
        createLocalGmContext(
          h.db,
          {
            gmLocalContextId: child.allocation.id,
            masterProfileId: h.profileId,
            ownerDeviceId: h.scope.ownerDeviceId,
          },
          () => undefined,
        ),
      ).toThrow();
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
    it('rolls back a late mirror fault and rejects a reciprocal preexisting identity collision', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveDisease(h, attempt),
        bytes = h.db.serialize();
      expect(() =>
        saveNpcAttemptPrepared(
          h.db,
          reserve.boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          reserve.prepare,
          h.readers,
          {
            ...reserve.integration,
            writeGmMirror(operation) {
              h.integration.writeGmMirror(operation);
              expect(
                h.db
                  .prepare(
                    "SELECT count(*) AS n FROM npc_child_identity WHERE kind='EFFECT_INSTANCE'",
                  )
                  .get(),
              ).toEqual({ n: 1 });
              throw Error('actual effect intent late fault');
            },
          },
        ),
      ).toThrow('actual effect intent late fault');
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const collision = reserveDisease(h, attempt, () => h.scope.ownerDeviceId);
      expect(collision.run).toThrow();
      expect(collision.calls()).toBe(1);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      reserve.run();
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
        child = closure.children[0]!,
        protectedBytes = h.db.serialize();
      expect(() =>
        createLocalGmContext(
          h.db,
          {
            gmLocalContextId: child.allocation.id,
            masterProfileId: h.profileId,
            ownerDeviceId: h.scope.ownerDeviceId,
          },
          () => undefined,
        ),
      ).toThrow();
      expect(h.db.serialize().equals(protectedBytes)).toBe(true);
      h.db.prepare('DELETE FROM npc_child_identity WHERE child_id=?').run(child.allocation.id);
      const damaged = h.db.serialize();
      expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers)).toThrow();
      expect(h.db.serialize().equals(damaged)).toBe(true);
    });
    function selectDisease(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      effectInstanceId: string,
    ) {
      const current = readNpcEditorDraft(
        npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(attempt)),
        attempt.values,
      );
      const edit = h.replace(
        attempt,
        json({
          input: {
            ...current.initialState,
            effectInstanceIds: { kind: 'ENTERED', value: [effectInstanceId] },
          },
          currentOeChanges: [],
        }),
      );
      h.save(edit.boundary, edit.attempt);
      return edit.attempt;
    }
    function confirmInitialTime(h: ReturnType<typeof fixture>, attempt: NpcAttempt) {
      const rules = {
        verifyInitial: unavailable,
        reduce: unavailable,
        buildProposal: unavailable,
        npc: h.readers,
      };
      const retained = h.navigate(attempt, 'NPC-016::CTA::004', 'NPC-016').attempt;
      const lobby = readCampaignLobby(h.db, h.scope, h.validateOwner, rules);
      const result = commitCampaignLobbyCommand(
        h.db,
        h.scope,
        {
          kind: 'GM',
          ownerDeviceId: h.scope.ownerDeviceId,
          gmLocalContextId: h.scope.gmLocalContextId,
        },
        {
          workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
          commandId: randomUUID(),
          campaignId: h.scope.campaignId,
          expectedLobbySnapshotRevision: lobby.lobbySnapshotRevision,
          dayNumber: 1,
          hour: 0,
          minute: 7,
        },
        {
          receiptId: randomUUID(),
          committedAt: timestamp,
          sceneIdOrNull: null,
          checkpointIdOrNull: null,
        },
        h.validateOwner,
        rules,
        () => undefined,
      );
      expect(result.replayed).toBe(false);
      h.ordinaryNav('NET-016::CTA::005');
      expect(h.view()?.formId).toBe('NPC-016');
      return retained;
    }
    function lazyDiseaseCommit(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      omitRequiredLock = false,
      committedAt = timestamp,
    ) {
      // The client already owns the checked attempt target; the writer still rechecks the actual head.
      const current = h.view();
      if (current === null) throw Error('Missing actual COMMIT source');
      const target = attempt.targetOrNull;
      expect(attempt.mode).toBe(target === null ? 'CREATE_V1' : 'APPEND_N_PLUS_ONE');
      const request: NpcWorkflowCommandRequest = {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        expectedRevisions: s.vectorOf(current),
        ...(target === null
          ? {
              workflowCommandId: 'UI-CMD-NPC-COMMIT-V1' as const,
              payload: {
                campaignId: h.scope.campaignId,
                npcDraftId: attempt.npcDraftId,
                expectedAttemptRevision: attempt.revision,
              },
            }
          : {
              workflowCommandId: 'UI-CMD-NPC-NEW-VERSION' as const,
              payload: {
                phase: 'COMMIT' as const,
                campaignId: h.scope.campaignId,
                npcDraftId: attempt.npcDraftId,
                expectedAttemptRevision: attempt.revision,
                expectedCurrentVersion: target.expectedCurrentVersion,
              },
            }),
      };
      const boundary: NpcBoundary = {
        scope: h.scope,
        operationId: request.commandId,
        kind: target === null ? 'COMMIT_V1' : 'COMMIT',
        request: json(request),
        expectedAttemptRevisionOrNull: attempt.revision,
        expectedCurrentVersionOrNull: target?.expectedCurrentVersion ?? null,
      };
      let checkedAfter: ReturnType<typeof readNpcRecoveryClosure> | undefined;
      const integration: NpcCommitPreparationIntegration = {
        ...h.integration,
        validate(boundary, checkpoint, phase, closure) {
          h.integration.validate(boundary, checkpoint, phase, closure);
          if (phase === 'AFTER') checkedAfter = closure;
        },
        validateCommitPreparation(context) {
          validateNpcCommitPreparationInTransaction(h.db, context);
        },
      };
      let calls = 0;
      let preparationError: string | null = null;
      const prepare: NpcCommitPreparer = (context) => {
        calls++;
        const previous = context.previous.attempt,
          calendar = context.calendarContext;
        if (calendar === null) throw Error('Actual calendar context missing');
        const built = (() => {
          try {
            return h.ordinary.prepare(
              previous,
              context.boundary.operationId,
              context.previousVersionOrNull,
              calendar,
              { committedAt, beforeGmSource: context.beforeGmSource },
            );
          } catch (error) {
            preparationError =
              error instanceof Error ? error.message : 'Non-Error preparation failure';
            throw error;
          }
        })();
        return {
          npcDraftId: previous.npcDraftId,
          npcUuid: previous.candidateNpcUuid,
          receiptId: randomUUID(),
          checkpointId: randomUUID(),
          committedAt,
          snapshot: built.snapshot,
          lifetimeFacts: built.lifetimeFacts,
          art: built.art,
          preStartTimeOrNull: omitRequiredLock ? null : built.preStartTimeOrNull,
          projectionChanged: true,
          visibilityChanged: false,
        };
      };
      const run = () => {
        checkedAfter = undefined;
        return commitNpcVersionPrepared(
          h.db,
          boundary,
          attempt.npcDraftId,
          prepare,
          h.readers,
          integration,
        );
      };
      return {
        boundary,
        integration,
        prepare,
        run,
        checkedAfter() {
          if (checkedAfter === undefined)
            throw Error('No checked AFTER closure for this execution');
          expect(Object.isFrozen(checkedAfter)).toBe(true);
          return checkedAfter;
        },
        calls: () => calls,
        preparationError: () => preparationError,
      };
    }
    it('refuses actual NPC016 forward navigation without confirmed time and enables it after the real NET016 command and explicit life reconfirmation', () => {
      const h = fixture(),
        initial = h.create().attempt;
      const support = createNpcHostSupport(h.db, fullSource, artCatalog, (campaignId) => {
        expect(campaignId).toBe(h.scope.campaignId);
        return h.calendar();
      });
      const app = support.connect(
        h.scope,
        () => readGmRequestReviewSource(h.db, h.scope, h.validateOwner),
        (checkpoint, closure) => {
          expect(h.db.inTransaction).toBe(true);
          expect(closure.campaignId).toBe(h.scope.campaignId);
          expect(closure.calendarContext?.scope).toEqual(h.scope);
          expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
        },
        h.validateOwner,
      );
      const initialView = h.view();
      if (initialView === null) throw Error('Expected actual NPC002 source');
      // Production rejects art changes in generic stage input; establish the explicit ART_CLEAR event first.
      const cleared = app.prepare({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-002',
        npcDraftId: initial.npcDraftId,
        expectedAttemptRevision: initial.revision,
        expectedRevisions: s.vectorOf(initialView),
        preparation: { kind: 'ART_CLEAR' },
      });
      const final = h.fillOrdinary(cleared.attemptEvent.attempt);
      const attempt = h.navigate(final, 'NPC-017::CTA::003', 'NPC-016').attempt;
      const initialStateView = h.view();
      if (initialStateView === null) throw Error('Expected actual NPC016 source');
      const reserved = app.prepare({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-016',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        expectedRevisions: s.vectorOf(initialStateView),
        preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-RHINITIS' },
      });
      const event = reserved.attemptEvent;
      if (!('childAllocations' in event)) throw Error('Expected actual child event');
      const effect = event.childAllocations.find((c) => c.kind === 'EFFECT_INSTANCE');
      if (effect === undefined) throw Error('Actual effect reservation missing');
      let selected = selectDisease(h, event.attempt, effect.id);
      const project = () =>
        h.db
          .transaction(() =>
            app.project(
              admissionDecisionStorage.readHistory(h.db, h.scope, h.validateOwner, {
                verifyInitial: unavailable,
                reduce: unavailable,
                buildProposal: unavailable,
              }),
              ['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'],
            ),
          )
          .deferred();
      const missing = project();
      expect(missing.base.formId).toBe('NPC-016');
      expect(missing.base.availableActionKeys).not.toContain('NPC-016::CTA::001');
      expect(missing.base.availableActionKeys).not.toContain('NPC-016::CTA::003');
      expect(missing.base.availableActionKeys).toContain('NPC-016::CTA::004');
      const bytes = h.db.serialize();
      const stale = h.action('NPC-016::CTA::001');
      for (const request of [stale, h.action('NPC-016::CTA::003')]) {
        expect(() => app.navigation(request)).toThrow();
        expect(h.db.serialize().equals(bytes)).toBe(true);
      }
      selected = confirmInitialTime(h, selected);
      // The real PRE_START clock change invalidates the previous explicit life confirmation.
      expect(project().base.availableActionKeys).not.toContain('NPC-016::CTA::003');
      selected = app.prepare(h.aliveRequest(selected)).attemptEvent.attempt;
      expect(selected.stage).toBe('NPC-016');
      const current = project();
      expect(current.base.availableActionKeys).not.toContain('NPC-016::CTA::001');
      expect(current.base.availableActionKeys).toContain('NPC-016::CTA::003');
      const beforeStale = h.db.serialize();
      expect(() => app.navigation(stale)).toThrow();
      expect(h.db.serialize().equals(beforeStale)).toBe(true);
      const request = h.action('NPC-016::CTA::003'),
        result = app.navigation(request);
      if (!('attemptEvent' in result)) throw Error('Expected actual attempt writer');
      expect(result.attemptEvent.attempt.stage).toBe('NPC-017');
      expect(result.replayed).toBe(false);
      expect(
        readNpcRecoveryClosure(h.db, h.scope.campaignId, support.readers).versions,
      ).toHaveLength(0);
      const after = h.db.serialize(),
        replay = app.navigation(request);
      if (!('attemptEvent' in replay)) throw Error('Expected exact attempt replay');
      expect(replay.replayed).toBe(true);
      expect(replay.attemptEvent).toEqual(result.attemptEvent);
      expect(h.db.serialize().equals(after)).toBe(true);
    });
    it('previews a reserved disease without invented runtime time, refuses missing time, then commits and recovers exact initial effect and lock', () => {
      const started = performance.now(),
        phases: Array<{ phase: string; ms: number }> = [];
      const mark = (phase: string) => {
        phases.push({ phase, ms: performance.now() - started });
      };
      mark('SETUP_START');
      try {
        const { h, attempt } = readyForIntent(),
          reservation = reserveDisease(h, attempt);
        mark('RESERVATION_START');
        reservation.run();
        mark('RESERVATION_DONE');
        const reserved = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
        const child = reserved.children.find((c) => c.allocation.kind === 'EFFECT_INSTANCE');
        if (child === undefined) throw Error('Actual reservation absent');
        const current = reserved.attempts.find(
          (e) => e.operationId === reservation.boundary.operationId,
        )?.attempt;
        if (current === undefined) throw Error('Reservation attempt absent');
        mark('SELECT_START');
        let selected = selectDisease(h, current, child.allocation.id);
        mark('SELECT_DONE');
        const preview = h.db
          .transaction(() => h.ordinary.preview(selected, null, h.calendar()))
          .deferred();
        mark('PREVIEW_DONE');
        expect(preview.sheet.preparedDiseaseState?.assignments).toEqual([
          { effectInstanceId: child.allocation.id, diseaseId: 'DIS-RHINITIS' },
        ]);
        expect(preview.sheet.input.initialState.effectInstances).toEqual([]);
        expect(preview.sheet.requiresCampaignTime).toBe(true);
        expect(preview.preStartTimeOrNull).toBeNull();
        const beforeTime = h.db.serialize();
        // Direct persistence navigation intentionally bypasses the application CTA guard to prove COMMIT independently refuses missing time.
        const missing = h.navigate(selected, 'NPC-016::CTA::001', 'NPC-017').attempt;
        const beforeMissingCommit = h.db.serialize(),
          unavailableCommit = lazyDiseaseCommit(h, missing);
        mark('MISSING_TIME_COMMIT_START');
        expect(unavailableCommit.run).toThrow();
        mark('MISSING_TIME_COMMIT_DONE');
        expect(unavailableCommit.calls()).toBe(1);
        expect(unavailableCommit.preparationError()).toContain(
          'assigned disease requires confirmed campaign time',
        );
        expect(h.db.serialize().equals(beforeMissingCommit)).toBe(true);
        selected = h.navigate(missing, 'NPC-017::CTA::003', 'NPC-016').attempt;
        expect(h.db.serialize().equals(beforeTime)).toBe(false); // Only the two actual NAV events changed.
        mark('INITIAL_TIME_START');
        selected = confirmInitialTime(h, selected);
        // Changing the PRE_START clock invalidates the earlier ALIVE confirmation.
        selected = h.confirmAlive(selected);
        mark('INITIAL_TIME_DONE');
        const final = h.navigate(selected, 'NPC-016::CTA::001', 'NPC-017').attempt;
        const broken = lazyDiseaseCommit(h, final, true),
          beforeBroken = h.db.serialize();
        mark('FAULTY_FACTORY_START');
        expect(broken.run).toThrow();
        mark('FAULTY_FACTORY_DONE');
        expect(broken.calls()).toBe(1);
        expect(h.db.serialize().equals(beforeBroken)).toBe(true);
        mark('REAL_COMMIT_START');
        const committed = lazyDiseaseCommit(h, final),
          first = committed.run();
        mark('REAL_COMMIT_DONE');
        expect(first.replayed).toBe(false);
        expect(committed.calls()).toBe(1);
        const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
        expect(closure.versions).toHaveLength(1);
        expect(closure.children).toEqual(reserved.children);
        const version = closure.versions[0]!;
        const snapshot = h.db
          .transaction(() => h.readers.snapshot(version.snapshot, h.calendar(), null))
          .deferred();
        expect(snapshot).toMatchObject({
          format: 'NPC_HUMANOID_V1',
          derivation: {
            initialStateProof: {
              commitOperationId: committed.boundary.operationId,
              assignments: [
                {
                  effectInstanceId: child.allocation.id,
                  originOperationId: committed.boundary.operationId,
                },
              ],
            },
          },
          sheet: {
            input: {
              initialState: {
                effectInstances: [
                  {
                    effectInstanceId: child.allocation.id,
                    targetActorId: final.candidateNpcUuid,
                    createdAt: timestamp,
                    startsAt: { campaignTimestamp: 7 },
                    revision: 1,
                    lastTickAt: null,
                    payload: { diseaseId: 'DIS-RHINITIS' },
                  },
                ],
              },
            },
          },
        });
        expect(closure.blocks.at(-1)?.initialTimeLockOrNull).toMatchObject({
          campaignTimestamp: 7,
          operationId: committed.boundary.operationId,
          npcUuid: final.candidateNpcUuid,
          version: 1,
        });
        const bytes = h.db.serialize();
        mark('REPLAY_START');
        expect(committed.run()).toEqual({ ...first, replayed: true });
        mark('REPLAY_DONE');
        expect(committed.calls()).toBe(1);
        expect(h.db.serialize().equals(bytes)).toBe(true);
        mark('REOPEN_START');
        const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
        expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
          closure,
        );
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        mark('REOPEN_DONE');
      } finally {
        console.info(JSON.stringify({ npcDiseaseTimedPhases: phases }));
      }
    });

    function reserveTrauma(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      allocate: () => string = randomUUID,
    ) {
      const view = h.view();
      if (view === null) throw Error('Missing actual NPC016 view');
      const request: NpcPreparationRequest = {
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-016',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        expectedRevisions: s.vectorOf(view),
        preparation: { kind: 'TRAUMA_RESERVE' },
      };
      const boundary = h.boundary('REPLACE', request, attempt),
        integration = {
          ...h.integration,
          validatePreparation(context: Parameters<typeof validateNpcPreparationInTransaction>[1]) {
            validateNpcPreparationInTransaction(h.db, context);
          },
        };
      let calls = 0;
      const prepare: NpcAttemptPreparer = (context) => {
        calls++;
        const old = context.previousOrNull?.attempt,
          proof = context.previousReadContextOrNull;
        if (old === undefined || proof === null)
          throw Error('Missing checked previous trauma attempt');
        const traumaInstanceId = allocate();
        return {
          next: {
            ...old,
            revision: old.revision + 1,
            values: h.ordinary.traumaPreparation.apply(
              old.values,
              traumaInstanceId,
              proof,
              context.boundary.operationId,
            ),
          },
          receiptId: randomUUID(),
          committedAt: timestamp,
          childAllocations: [{ kind: 'TRAUMA_INSTANCE', id: traumaInstanceId }],
        };
      };
      const run = () =>
        saveNpcAttemptPreparedWithEvidence(
          h.db,
          boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          prepare,
          h.readers,
          integration,
        );
      return { boundary, integration, prepare, run, calls: () => calls };
    }
    function traumaRow(
      traumaInstanceId: string,
      regionId: 'HEAD' | 'TORSO' | 'ARM_L',
    ): NpcTraumaEditorRow {
      const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
      return {
        traumaInstanceId,
        input: {
          regionId: entered(regionId),
          traumaValue: entered(regionId === 'TORSO' ? 3 : 7),
          reason: entered('Ранее существовавшее состояние НПС'),
        },
        head:
          regionId === 'HEAD'
            ? entered({
                penalty: entered('CONSUMED' as const),
                stun: entered({ status: 'ACTIVE' as const, remainingMinutes: entered('0.5') }),
              })
            : { kind: 'UNSET' },
      };
    }
    function setTraumaRows(
      h: ReturnType<typeof fixture>,
      attempt: NpcAttempt,
      rows: readonly NpcTraumaEditorRow[],
      selected: readonly string[],
      hp = 7,
    ) {
      return h.saveReplacement(
        attempt,
        json({
          input: {
            ...s.object(attempt.values['initialState']),
            currentHP: { kind: 'ENTERED', value: hp },
            traumaInputs: { kind: 'ENTERED', value: rows },
            traumaInstanceIds: { kind: 'ENTERED', value: selected },
          },
          currentOeChanges: [],
        }),
      ).attempt;
    }
    function savedTraumaFacts(version: NpcVersion) {
      const value = s.object(s.object(version.snapshot['derivation'])['initialTraumaProof'])[
        'facts'
      ];
      if (!Array.isArray(value)) throw Error('Missing checked initial trauma facts');
      return value.map((v: unknown) => s.object(v));
    }
    it('reserves a host trauma ID with UNSET fields, refuses missing/async preflight before allocation and replays after restart', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveTrauma(h, attempt),
        before = h.db.serialize();
      const { validateTraumaReservation: _omitted, ...without } = h.readers;
      const asyncPreflight = async () => {
        await Promise.resolve();
      };
      for (const readers of [
        without,
        { ...h.readers, validateTraumaReservation: asyncPreflight },
      ]) {
        expect(() =>
          saveNpcAttemptPreparedWithEvidence(
            h.db,
            reserve.boundary,
            { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
            reserve.prepare,
            readers,
            reserve.integration,
          ),
        ).toThrow();
        expect(reserve.calls()).toBe(0);
        expect(h.db.serialize().equals(before)).toBe(true);
      }
      const first = reserve.run(),
        event = first.attemptEvent;
      if (!('childAllocations' in event)) throw Error('Missing real child allocation');
      const allocation = event.childAllocations[0];
      if (allocation?.kind !== 'TRAUMA_INSTANCE') throw Error('Missing trauma allocation');
      expect(s.object(event.attempt.values['initialState'])['traumaInputs']).toEqual({
        kind: 'ENTERED',
        value: [createEmptyNpcTraumaEditorRow(allocation.id)],
      });
      expect(s.object(event.attempt.values['initialState'])['traumaInstanceIds']).toEqual({
        kind: 'ENTERED',
        value: [],
      });
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(closure.versions).toEqual([]);
      expect(closure.children[0]?.allocation).toEqual({
        kind: 'TRAUMA_INSTANCE',
        id: allocation.id,
      });
      const bytes = h.db.serialize(),
        reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      const unexpected = () => {
        throw Error('Replay must not prepare or allocate');
      };
      expect(
        saveNpcAttemptPreparedWithEvidence(
          reopened.db,
          reserve.boundary,
          { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
          unexpected,
          reopened.readers,
          { ...reopened.integration, validatePreparation: unexpected },
        ),
      ).toEqual({ ...first, replayed: true });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      expect(reserve.calls()).toBe(1);
      expect(() =>
        createLocalGmContext(
          reopened.db,
          {
            gmLocalContextId: allocation.id,
            masterProfileId: h.profileId,
            ownerDeviceId: h.scope.ownerDeviceId,
          },
          () => {
            expect(loadDeviceId(reopened.db)).toBe(h.scope.ownerDeviceId);
          },
        ),
      ).toThrow();
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
      let cancelledAttempt = first.attemptEvent.attempt;
      for (const [action, stage] of [
        ['NPC-016::CTA::002', 'NPC-015'],
        ['NPC-015::CTA::002', 'NPC-014'],
        ['NPC-014::CTA::002', 'NPC-013'],
        ['NPC-013::CTA::002', 'NPC-012'],
        ['NPC-012::CTA::002', 'NPC-011'],
        ['NPC-011::CTA::002', 'NPC-002'],
      ] as const)
        cancelledAttempt = reopened.navigate(cancelledAttempt, action, stage).attempt;
      reopened.save(
        reopened.boundary('CANCEL', reopened.action('NPC-002::CTA::003'), cancelledAttempt),
        { ...cancelledAttempt, revision: cancelledAttempt.revision + 1, status: 'CANCELLED' },
      );
      const cancelled = readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers);
      expect(cancelled.versions).toEqual([]);
      expect(cancelled.children).toEqual(closure.children);
      const cancelledBytes = reopened.db.serialize();
      expect(() =>
        createLocalGmContext(
          reopened.db,
          {
            gmLocalContextId: allocation.id,
            masterProfileId: h.profileId,
            ownerDeviceId: h.scope.ownerDeviceId,
          },
          () => {
            expect(loadDeviceId(reopened.db)).toBe(h.scope.ownerDeviceId);
          },
        ),
      ).toThrow();
      expect(reopened.db.serialize().equals(cancelledBytes)).toBe(true);
    });
    it('rejects malformed trauma preparation descriptors, proxies, cycles and own __proto__ without writes', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveTrauma(h, attempt),
        before = h.db.serialize();
      for (const kind of ['GETTER', 'PROXY', 'CYCLE', 'OWN_PROTO_NULL'] as const) {
        let reads = 0;
        const prepare: NpcAttemptPreparer = (context) => {
          const value = reserve.prepare(context);
          if (kind === 'GETTER')
            return Object.defineProperty(value, 'next', {
              enumerable: true,
              get() {
                reads++;
                throw Error('A preparation getter must not execute');
              },
            });
          if (kind === 'PROXY')
            return new Proxy(value, {
              ownKeys() {
                reads++;
                throw Error('A preparation proxy trap must not execute');
              },
              getPrototypeOf() {
                reads++;
                throw Error('A preparation proxy trap must not execute');
              },
            });
          // With ordinary assignment, __proto__: null would disappear and alter the result prototype.
          return Object.defineProperty(value, kind === 'CYCLE' ? 'loop' : '__proto__', {
            enumerable: true,
            configurable: true,
            writable: true,
            value: kind === 'CYCLE' ? value : null,
          });
        };
        const calls = reserve.calls();
        expect(() =>
          saveNpcAttemptPreparedWithEvidence(
            h.db,
            reserve.boundary,
            { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
            prepare,
            h.readers,
            reserve.integration,
          ),
        ).toThrow();
        expect(reserve.calls()).toBe(calls + 1);
        expect(reads).toBe(0);
        expect(h.db.serialize().equals(before)).toBe(true);
        expect(Object.getPrototypeOf({})).toBe(Object.prototype);
      }
    });
    it('commits TORSO3 with final HP7, exact NPC016 confirmation and no clock or played damage', () => {
      const { h, attempt } = readyForIntent(),
        reserve = reserveTrauma(h, attempt),
        reserved = reserve.run().attemptEvent;
      if (!('childAllocations' in reserved)) throw Error('Missing real trauma reservation');
      const child = reserved.childAllocations[0];
      if (child?.kind !== 'TRAUMA_INSTANCE') throw Error('Missing reserved trauma ID');
      const selected = setTraumaRows(
        h,
        reserved.attempt,
        [traumaRow(child.id, 'TORSO')],
        [child.id],
      );
      const confirmation = h.navigate(selected, 'NPC-016::CTA::003', 'NPC-017');
      const commit = lazyDiseaseCommit(h, confirmation.attempt);
      commit.run();
      const closure = commit.checkedAfter(),
        version = closure.versions[0]!;
      const initial = s.object(s.object(version.snapshot['sheet'])['input'])['initialState'];
      expect(initial).toMatchObject({
        currentHP: 7,
        currentTraumas: [{ traumaInstanceId: child.id, regionId: 'TORSO', traumaValue: 3 }],
        effectInstances: [],
      });
      expect(savedTraumaFacts(version)[0]).toMatchObject({
        originKind: 'INITIAL_STATE_AUTHORING',
        origin: {
          commitOperationId: commit.boundary.operationId,
          sourceOperationId: confirmation.boundary.operationId,
          version: 1,
        },
        consequence: { kind: 'TORSO', hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' },
      });
      expect(closure.blocks[0]?.initialTimeLockOrNull).toBe(null);
      const bytes = h.db.serialize(),
        reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
        closure,
      );
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    });
    describe('real timed trauma V1 reused by independent N+1 and corruption cases', () => {
      let seed: Readonly<{
        bytesBase64: string;
        scope: NpcScope;
        profileId: string;
        traumaInstanceId: string;
        closureJson: string;
      }>;
      beforeAll(() => {
        const started = performance.now(),
          { h, attempt } = readyForIntent();
        try {
          const reserve = reserveTrauma(h, attempt),
            reserved = reserve.run().attemptEvent;
          if (!('childAllocations' in reserved)) throw Error('Missing real child event');
          const child = reserved.childAllocations[0];
          if (child?.kind !== 'TRAUMA_INSTANCE') throw Error('Missing actual trauma');
          let current = setTraumaRows(
            h,
            reserved.attempt,
            [traumaRow(child.id, 'HEAD')],
            [child.id],
          );
          const beforeTime = h.db.serialize();
          expect(() =>
            h.db.transaction(() => h.ordinary.preview(current, null, h.calendar())).deferred(),
          ).toThrow(NpcOrdinaryPreviewInputError);
          expect(h.db.serialize().equals(beforeTime)).toBe(true);
          current = confirmInitialTime(h, current);
          // Changing the PRE_START clock invalidates the earlier ALIVE confirmation.
          current = h.confirmAlive(current);
          const confirmation = h.navigate(current, 'NPC-016::CTA::003', 'NPC-017');
          const beforeCommit = h.db.serialize();
          expect(() => lazyDiseaseCommit(h, confirmation.attempt, true).run()).toThrow();
          expect(h.db.serialize().equals(beforeCommit)).toBe(true);
          const commit = lazyDiseaseCommit(h, confirmation.attempt);
          commit.run();
          const closure = commit.checkedAfter(),
            version = closure.versions[0]!;
          expect(savedTraumaFacts(version)[0]).toMatchObject({
            origin: {
              commitOperationId: commit.boundary.operationId,
              sourceOperationId: confirmation.boundary.operationId,
            },
            consequence: {
              kind: 'HEAD',
              penalty: 'CONSUMED',
              stun: {
                status: 'ACTIVE',
                remainingMinutes: '0.5',
                calendarAnchor: { kind: 'PRE_START_INITIAL', campaignTimestamp: 7 },
              },
            },
          });
          expect(s.object(version.snapshot['sheet'])['traumaState']).toMatchObject({
            headStuns: [{ deadlineMinutes: '7.5', activeNow: true }],
          });
          expect(closure.blocks[0]?.initialTimeLockOrNull?.campaignTimestamp).toBe(7);
          seed = Object.freeze({
            bytesBase64: h.db.serialize().toString('base64'),
            scope: Object.freeze({ ...h.scope }),
            profileId: h.profileId,
            traumaInstanceId: child.id,
            closureJson: s.canonical(closure),
          });
        } finally {
          h.db.close();
          console.info('NPC trauma V1 shared fixture setup ms:', performance.now() - started);
        }
      });
      function restore() {
        const bytes = Buffer.from(seed.bytesBase64, 'base64'),
          h = fixture({ bytes, scope: seed.scope, profileId: seed.profileId });
        const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
        expect(s.canonical(closure)).toBe(seed.closureJson);
        expect(h.db.serialize().equals(bytes)).toBe(true);
        return { h, closure, version: closure.versions[0]! };
      }
      function openInitial(h: ReturnType<typeof fixture>, version: NpcVersion) {
        let current = h.openNext(version);
        for (const [action, stage] of [
          ['NPC-002::CTA::002', 'NPC-011'],
          ['NPC-011::CTA::003', 'NPC-012'],
          ['NPC-012::CTA::003', 'NPC-013'],
          ['NPC-013::CTA::003', 'NPC-014'],
          ['NPC-014::CTA::003', 'NPC-015'],
          ['NPC-015::CTA::003', 'NPC-016'],
        ] as const)
          current = h.navigate(current, action, stage).attempt;
        return current;
      }
      it('retains original HEAD fact and exact fractional deadline beside a new pending limb in N+1, then reopens and replays', () => {
        const { h, version } = restore(),
          firstFacts = savedTraumaFacts(version),
          firstText = s.canonical(version);
        const opened = openInitial(h, version),
          reserve = reserveTrauma(h, opened),
          reserved = reserve.run().attemptEvent;
        if (!('childAllocations' in reserved)) throw Error('Missing actual N+1 child');
        const child = reserved.childAllocations[0];
        if (child?.kind !== 'TRAUMA_INSTANCE') throw Error('Missing new trauma');
        const old = traumaRow(seed.traumaInstanceId, 'HEAD'),
          added = traumaRow(child.id, 'ARM_L');
        const edited = setTraumaRows(
          h,
          reserved.attempt,
          [old, added],
          [old.traumaInstanceId, child.id],
        );
        const final = h.navigate(edited, 'NPC-016::CTA::003', 'NPC-017').attempt,
          commit = lazyDiseaseCommit(h, final);
        const applied = commit.run(),
          after = commit.checkedAfter(),
          next = after.versions[1]!;
        expect(savedTraumaFacts(next)[0]).toEqual(firstFacts[0]);
        expect(savedTraumaFacts(next)[1]).toMatchObject({
          origin: { commitOperationId: commit.boundary.operationId, version: 2 },
        });
        expect(s.object(next.snapshot['sheet'])['traumaState']).toMatchObject({
          headStuns: [{ deadlineMinutes: '7.5', remainingMinutes: '0.5', activeNow: true }],
          globalCheckPenalty: -5,
        });
        expect(s.canonical(after.versions[0])).toBe(firstText);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          unexpected = () => {
            throw Error('Replay prepared again');
          };
        expect(
          commitNpcVersionPrepared(
            reopened.db,
            commit.boundary,
            final.npcDraftId,
            unexpected,
            reopened.readers,
            { ...reopened.integration, validateCommitPreparation: unexpected },
          ),
        ).toEqual({ ...applied, replayed: true });
        expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
          after,
        );
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      }, 60_000);
      it('removes selected trauma in N+1 without changing original bytes or releasing the first time lock', () => {
        const { h, version } = restore(),
          firstText = s.canonical(version),
          opened = openInitial(h, version);
        const edited = setTraumaRows(h, opened, [traumaRow(seed.traumaInstanceId, 'HEAD')], []),
          final = h.navigate(edited, 'NPC-016::CTA::003', 'NPC-017').attempt;
        const commit = lazyDiseaseCommit(h, final);
        commit.run();
        const after = commit.checkedAfter(),
          next = after.versions[1]!;
        expect(savedTraumaFacts(next)).toEqual([]);
        expect(s.object(s.object(next.snapshot['sheet'])['input'])['initialState']).toMatchObject({
          currentHP: 7,
          currentTraumas: [],
        });
        expect(s.canonical(after.versions[0])).toBe(firstText);
        expect(after.blocks[0]?.initialTimeLockOrNull?.campaignTimestamp).toBe(7);
        expect(after.blocks.at(-1)?.initialTimeLockOrNull).toEqual(
          after.blocks[0]?.initialTimeLockOrNull,
        );
        expect(after.children.some((c) => c.allocation.id === seed.traumaInstanceId)).toBe(true);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
        expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
          after,
        );
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      }, 60_000);
      it('refuses retained row mutation and missing real origin index without any write, then restores exact bytes', () => {
        const { h, version, closure } = restore(),
          opened = openInitial(h, version),
          before = h.db.serialize();
        const old = traumaRow(seed.traumaInstanceId, 'HEAD');
        expect(() =>
          setTraumaRows(
            h,
            opened,
            [{ ...old, input: { ...old.input, traumaValue: { kind: 'ENTERED', value: 8 } } }],
            [seed.traumaInstanceId],
          ),
        ).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
        for (const mutate of [
          (fact: Record<string, unknown>) => {
            fact['reason'] = 'Forged original reason';
          },
          (fact: Record<string, unknown>) => {
            s.object(fact['trauma'])['traumaValue'] = 8;
          },
          (fact: Record<string, unknown>) => {
            s.object(s.object(fact['consequence'])['stun'])['remainingMinutes'] = '1';
          },
        ]) {
          const candidate = json(version.snapshot),
            facts = s.object(s.object(candidate['derivation'])['initialTraumaProof'])['facts'];
          if (!Array.isArray(facts)) throw Error('Missing actual fact array');
          mutate(s.object(facts[0]));
          expect(() =>
            h.db
              .transaction(() => h.ordinary.snapshot(candidate, closure.calendarContext, null))
              .deferred(),
          ).toThrow();
          expect(h.db.serialize().equals(before)).toBe(true);
        }
        const rollback = new Error('Rollback intentional origin-index corruption');
        expect(() =>
          h.db
            .transaction(() => {
              expect(
                h.db
                  .prepare('DELETE FROM npc_child_identity WHERE child_id=?')
                  .run(seed.traumaInstanceId).changes,
              ).toBe(1);
              const corrupt = h.db.serialize();
              expect(() =>
                h.ordinary.snapshot(version.snapshot, closure.calendarContext, null),
              ).toThrow();
              expect(h.db.serialize().equals(corrupt)).toBe(true);
              throw rollback;
            })
            .immediate(),
        ).toThrow(rollback);
        expect(h.db.serialize().equals(before)).toBe(true);
      });
    });

    describe('recovery and subsequent versions from the same actual timed V1', () => {
      let seed: Readonly<{
        bytesBase64: string;
        scope: NpcScope;
        profileId: string;
        effectInstanceId: string;
        closureJson: string;
      }>;
      beforeAll(() => {
        const started = performance.now(),
          { h, attempt } = readyForIntent();
        try {
          const reserve = reserveDisease(h, attempt);
          reserve.run();
          const reserved = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
          const effect = reserved.children.find((row) => row.allocation.kind === 'EFFECT_INSTANCE');
          if (effect === undefined) throw Error('Missing actual reserved effect');
          let current = reserved.attempts.find(
            (event) => event.operationId === reserve.boundary.operationId,
          )!.attempt;
          current = selectDisease(h, current, effect.allocation.id);
          current = confirmInitialTime(h, current);
          // Changing the PRE_START clock invalidates the earlier ALIVE confirmation.
          current = h.confirmAlive(current);
          current = h.navigate(current, 'NPC-016::CTA::001', 'NPC-017').attempt;
          lazyDiseaseCommit(h, current).run();
          const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
          expect(closure.versions).toHaveLength(1);
          seed = Object.freeze({
            bytesBase64: h.db.serialize().toString('base64'),
            scope: Object.freeze({ ...h.scope }),
            profileId: h.profileId,
            effectInstanceId: effect.allocation.id,
            closureJson: s.canonical(closure),
          });
        } finally {
          h.db.close();
          console.info('NPC timed V1 shared fixture setup ms:', performance.now() - started);
        }
      });
      function restoredTimed() {
        const bytes = Buffer.from(seed.bytesBase64, 'base64'),
          h = fixture({ bytes, scope: seed.scope, profileId: seed.profileId });
        const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
        expect(s.canonical(closure)).toBe(seed.closureJson);
        expect(h.db.serialize().equals(bytes)).toBe(true);
        return { h, closure, version: closure.versions[0]! };
      }
      function retainedState(
        h: ReturnType<typeof fixture>,
        version: NpcVersion,
        mark: (phase: string) => void = () => undefined,
      ) {
        mark('OPEN_START');
        let current = h.openNext(version);
        mark('OPEN_DONE');
        for (const [action, stage] of [
          ['NPC-002::CTA::001', 'NPC-011'],
          ['NPC-011::CTA::001', 'NPC-012'],
          ['NPC-012::CTA::001', 'NPC-013'],
          ['NPC-013::CTA::001', 'NPC-014'],
          ['NPC-014::CTA::001', 'NPC-015'],
          ['NPC-015::CTA::001', 'NPC-016'],
        ] as const) {
          mark('NAV_' + stage + '_START');
          current = h.navigate(current, action, stage).attempt;
          mark('NAV_' + stage + '_DONE');
        }
        return current;
      }
      function effectRows(version: NpcVersion) {
        return s.object(s.object(s.object(version.snapshot['sheet'])['input'])['initialState'])[
          'effectInstances'
        ];
      }
      it('rechecks the same disease snapshot and calendar after SQL changes inside one transaction', () => {
        const { h, closure, version } = restoredTimed(),
          before = h.db.serialize(),
          calendar = closure.calendarContext,
          rollback = new Error('Rollback deliberate child-index corruption');
        if (calendar === null) throw Error('Missing actual calendar context');
        let caught: unknown;
        try {
          h.db
            .transaction(() => {
              const read = () => h.ordinary.snapshot(version.snapshot, calendar, null);
              expect(read()).toEqual(version.snapshot);
              expect(
                h.db
                  .prepare('DELETE FROM npc_child_identity WHERE child_id=?')
                  .run(seed.effectInstanceId).changes,
              ).toBe(1);
              const corruptBytes = h.db.serialize();
              expect(read).toThrow();
              expect(() => h.ordinary.initializeOpen(version, calendar)).toThrow();
              expect(h.db.serialize().equals(corruptBytes)).toBe(true);
              throw rollback;
            })
            .immediate();
        } catch (error) {
          caught = error;
        }
        expect(caught).toBe(rollback);
        expect(h.db.serialize().equals(before)).toBe(true);
        const reopened = fixture({ bytes: before, scope: h.scope, profileId: h.profileId });
        expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
          closure,
        );
        expect(reopened.db.serialize().equals(before)).toBe(true);
      });
      it('keeps checked inherited values private when an OPEN result is edited before another OPEN and reopen', () => {
        const { h, closure, version } = restoredTimed(),
          before = h.db.serialize(),
          calendar = closure.calendarContext;
        if (calendar === null) throw Error('Missing actual calendar context');
        const open = () =>
          h.db.transaction(() => h.ordinary.initializeOpen(version, calendar)).deferred();
        const first = open(),
          expected = json(first);
        expect(s.object(expected['initialState'])['effectInstanceIds']).toEqual({
          kind: 'ENTERED',
          value: [seed.effectInstanceId],
        });
        s.object(first['initialState'])['effectInstanceIds'] = { kind: 'ENTERED', value: [] };
        expect(first).not.toEqual(expected);
        expect(open()).toEqual(expected);
        expect(h.db.serialize().equals(before)).toBe(true);
        const reopened = fixture({ bytes: before, scope: h.scope, profileId: h.profileId }),
          recovered = readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers);
        expect(recovered).toEqual(closure);
        expect(
          reopened.db
            .transaction(() =>
              reopened.ordinary.initializeOpen(recovered.versions[0]!, recovered.calendarContext!),
            )
            .deferred(),
        ).toEqual(expected);
        expect(reopened.db.serialize().equals(before)).toBe(true);
      });
      it('inspects each stored version once per closure and independently on the next read and SQLite reopen', () => {
        const { h, closure } = restoredTimed(),
          bytes = h.db.serialize();
        let calls = 0;
        const contexts: Array<Parameters<NpcDomainReaders['inspectStoredSnapshot']>[1]> = [];
        const readers = {
          ...h.readers,
          inspectStoredSnapshot(...args: Parameters<NpcDomainReaders['inspectStoredSnapshot']>) {
            calls++;
            contexts.push(args[1]);
            return h.readers.inspectStoredSnapshot(...args);
          },
          // Stored recovery must not rebuild these selectors with a second/third full snapshot read.
          snapshot: unavailable,
          publishedChildGraph: unavailable,
          requiredPreStartTime: unavailable,
        };
        expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, readers)).toEqual(closure);
        expect(calls).toBe(closure.versions.length);
        expect(readNpcRecoveryClosure(h.db, h.scope.campaignId, readers)).toEqual(closure);
        expect(calls).toBe(closure.versions.length * 2);
        expect(contexts[0]).not.toBe(contexts[1]);
        expect(h.db.serialize().equals(bytes)).toBe(true);
        const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
        let reopenedCalls = 0;
        const reopenedReaders = {
          ...reopened.readers,
          inspectStoredSnapshot(...args: Parameters<NpcDomainReaders['inspectStoredSnapshot']>) {
            reopenedCalls++;
            return reopened.readers.inspectStoredSnapshot(...args);
          },
        };
        expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopenedReaders)).toEqual(
          closure,
        );
        expect(reopenedCalls).toBe(closure.versions.length);
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      });
      it.each([
        'missing callback',
        'callback getter',
        'proxy callback',
        'bound async callback',
        'result getter',
        'proxy result',
        'extra result field',
        'missing result field',
        'fractional time',
        'negative time',
        'foreign time',
        'omitted time',
        'changed snapshot',
        'forged child graph',
        'source mutation',
        'calendar mutation',
      ] as const)(
        'refuses malformed stored inspection %s with zero writes and no unsafe callback/getter entry',
        (fault) => {
          const { h } = restoredTimed(),
            bytes = h.db.serialize();
          let calls = 0,
            unsafeCalls = 0;
          const callback = (
            ...args: Parameters<NpcDomainReaders['inspectStoredSnapshot']>
          ): unknown => {
            calls++;
            const inspection = h.readers.inspectStoredSnapshot(...args);
            if (fault === 'result getter')
              return Object.defineProperty({ ...inspection }, 'snapshot', {
                enumerable: true,
                get() {
                  unsafeCalls++;
                  return inspection.snapshot;
                },
              });
            if (fault === 'proxy result')
              return new Proxy(inspection, {
                ownKeys() {
                  unsafeCalls++;
                  return Reflect.ownKeys(inspection);
                },
              });
            if (fault === 'extra result field') return { ...inspection, extra: true };
            if (fault === 'missing result field')
              return {
                snapshot: inspection.snapshot,
                publishedChildGraph: inspection.publishedChildGraph,
              };
            if (fault === 'fractional time')
              return { ...inspection, requiredPreStartTimeOrNull: 7.5 };
            if (fault === 'negative time') return { ...inspection, requiredPreStartTimeOrNull: -1 };
            if (fault === 'foreign time') return { ...inspection, requiredPreStartTimeOrNull: 8 };
            if (fault === 'omitted time')
              return { ...inspection, requiredPreStartTimeOrNull: null };
            if (fault === 'changed snapshot')
              return { ...inspection, snapshot: { ...inspection.snapshot, extra: true } };
            if (fault === 'forged child graph')
              return {
                ...inspection,
                publishedChildGraph: {
                  items: [],
                  effects: [],
                  traumas: [],
                  symbionts: [],
                  wounds: [],
                },
              };
            if (fault === 'source mutation') s.object(args[0])['extra'] = true;
            if (fault === 'calendar mutation') s.object(args[1])['extra'] = true;
            return inspection;
          };
          const readers = { ...h.readers };
          if (fault === 'missing callback')
            Reflect.deleteProperty(readers, 'inspectStoredSnapshot');
          else if (fault === 'callback getter')
            Object.defineProperty(readers, 'inspectStoredSnapshot', {
              get() {
                unsafeCalls++;
                return callback;
              },
            });
          else if (fault === 'proxy callback')
            Object.defineProperty(readers, 'inspectStoredSnapshot', {
              value: new Proxy(callback, {
                apply() {
                  unsafeCalls++;
                  return null;
                },
              }),
            });
          else if (fault === 'bound async callback') {
            const asyncCallback = async () => {
              unsafeCalls++;
              await Promise.resolve();
              return null;
            };
            Object.defineProperty(readers, 'inspectStoredSnapshot', {
              value: asyncCallback.bind(null),
            });
          } else Object.defineProperty(readers, 'inspectStoredSnapshot', { value: callback });
          expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, readers)).toThrow();
          expect(calls).toBe(
            [
              'missing callback',
              'callback getter',
              'proxy callback',
              'bound async callback',
            ].includes(fault)
              ? 0
              : 1,
          );
          expect(unsafeCalls).toBe(0);
          expect(h.db.serialize().equals(bytes)).toBe(true);
        },
      );
      it('retains original effect identity, audit time and origin operation through a later version and SQLite reopen', () => {
        const started = performance.now(),
          phases: Array<{ phase: string; ms: number }> = [];
        const mark = (phase: string) => phases.push({ phase, ms: performance.now() - started });
        mark('RESTORE_START');
        try {
          const { h, closure, version } = restoredTimed(),
            original = effectRows(version);
          mark('RESTORE_DONE');
          const current = retainedState(h, version, mark);
          mark('FINAL_NAV_START');
          const final = h.navigate(current, 'NPC-016::CTA::001', 'NPC-017').attempt;
          mark('FINAL_NAV_DONE');
          const committed = lazyDiseaseCommit(h, final, false, '2026-11-06T01:00:00.000Z');
          mark('COMMIT_START');
          committed.run();
          mark('COMMIT_DONE');
          const actual = committed.checkedAfter(),
            v2 = actual.versions.find((v) => v.version === 2)!;
          mark('READ_CURRENT_DONE');
          expect(v2.committedAt).not.toBe(version.committedAt);
          expect(effectRows(v2)).toEqual(original);
          expect(s.object(s.object(v2.snapshot['derivation'])['initialStateProof'])).toEqual({
            commitOperationId: committed.boundary.operationId,
            assignments: [
              { effectInstanceId: seed.effectInstanceId, originOperationId: version.operationId },
            ],
          });
          expect(actual.blocks.map((b) => b.initialTimeLockOrNull)).toEqual([
            closure.blocks[0]!.initialTimeLockOrNull,
            closure.blocks[0]!.initialTimeLockOrNull,
          ]);
          expect(actual.children).toEqual(closure.children);
          mark('REOPEN_START');
          const bytes = h.db.serialize(),
            reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
          expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
            actual,
          );
          expect(reopened.db.serialize().equals(bytes)).toBe(true);
          mark('REOPEN_DONE');
        } finally {
          console.info(JSON.stringify({ npcDiseaseRetainedPhases: phases }));
        }
      }, 60_000);
      it('removes the active effect without unlocking time or freeing its identity, and permits only a newly reserved later assignment', () => {
        const { h, closure, version } = restoredTimed();
        let current = retainedState(h, version);
        const draft = readNpcEditorDraft(
          npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(current)),
          current.values,
        );
        const edit = h.replace(
          current,
          json({
            input: { ...draft.initialState, effectInstanceIds: { kind: 'ENTERED', value: [] } },
            currentOeChanges: [],
          }),
        );
        h.save(edit.boundary, edit.attempt);
        current = h.navigate(edit.attempt, 'NPC-016::CTA::001', 'NPC-017').attempt;
        lazyDiseaseCommit(h, current, false, '2026-11-06T01:00:00.000Z').run();
        const removed = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
          v2 = removed.versions.find((v) => v.version === 2)!;
        expect(effectRows(v2)).toEqual([]);
        expect(removed.children).toEqual(closure.children);
        expect(removed.blocks.at(-1)!.initialTimeLockOrNull).toEqual(
          closure.blocks[0]!.initialTimeLockOrNull,
        );
        current = retainedState(h, v2);
        const before = h.db.serialize();
        expect(() => selectDisease(h, current, seed.effectInstanceId)).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
        const next = reserveDisease(h, current);
        next.run();
        const reserved = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers),
          newChild = reserved.children.find(
            (c) => c.originOperationId === next.boundary.operationId,
          );
        if (newChild === undefined || newChild.allocation.kind !== 'EFFECT_INSTANCE')
          throw Error('Missing actual new disease reservation');
        expect(newChild.allocation.id).not.toBe(seed.effectInstanceId);
        const attempt = reserved.attempts.find(
          (e) => e.operationId === next.boundary.operationId,
        )!.attempt;
        const selected = selectDisease(h, attempt, newChild.allocation.id);
        expect(
          readNpcEditorDraft(
            npcEditorForItemAttempt(catalog, fullSource.inventory, h.readContext(selected)),
            selected.values,
          ).initialState.effectInstanceIds,
        ).toEqual({ kind: 'ENTERED', value: [newChild.allocation.id] });
        expect(
          readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).blocks.at(-1)!
            .initialTimeLockOrNull,
        ).toEqual(closure.blocks[0]!.initialTimeLockOrNull);
      }, 300_000);
      it('rejects hash-valid omitted time-lock metadata after all reciprocal operation, checkpoint and GM seals are reconstructed', () => {
        const { h, closure, version } = restoredTimed(),
          oldBlock = closure.blocks[0]!,
          oldOperation = closure.operations.find((o) => o.operationId === version.operationId)!;
        const block = { ...oldBlock, initialTimeLockOrNull: null },
          blockText = s.canonical(block),
          blockHash = s.sha(blockText),
          anchor = {
            libraryRevision: block.libraryRevision,
            checkpointId: block.checkpointId,
            checkpointSha256: blockHash,
          };
        const after = npcCheckpointAfter(oldOperation.beforeCheckpoint, anchor, true, false),
          operation = { ...oldOperation, anchorOrNull: anchor, afterCheckpoint: after },
          operationText = s.canonical(operation),
          operationHash = s.sha(operationText);
        const mirrorRow = h.db
          .prepare(
            'SELECT event_id,record_json FROM gm_request_queue_event WHERE context_id=? AND campaign_id=? ORDER BY event_index DESC LIMIT 1',
          )
          .get(h.scope.gmLocalContextId, h.scope.campaignId) as {
          event_id: string;
          record_json: string;
        };
        const mirror = s.object(JSON.parse(mirrorRow.record_json) as unknown),
          mutation = s.object(mirror['mutation']);
        expect(mutation['kind']).toBe('NPC_SOURCE');
        expect(s.object(mutation['cause'])['operationId']).toBe(version.operationId);
        const cause = { operationId: version.operationId, recordSha256: operationHash },
          eventId = npcSourceEventId(h.scope, cause),
          mirrorText = s.canonical({ ...mirror, eventId, mutation: { kind: 'NPC_SOURCE', cause } });
        const payload = s.text(
          s.object(s.object(JSON.parse(after.snapshotJson) as unknown)['campaign'])['payloadJson'],
        );
        h.db
          .transaction(() => {
            expect(
              h.db
                .prepare(
                  'UPDATE npc_library_checkpoint SET record_json=?,record_sha256=? WHERE campaign_id=? AND library_revision=?',
                )
                .run(blockText, blockHash, h.scope.campaignId, 1).changes,
            ).toBe(1);
            expect(
              h.db
                .prepare(
                  'UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?',
                )
                .run(operationText, operationHash, version.operationId).changes,
            ).toBe(1);
            expect(
              h.db
                .prepare('UPDATE campaign SET payload_json=? WHERE campaign_id=?')
                .run(payload, h.scope.campaignId).changes,
            ).toBe(1);
            expect(
              h.db
                .prepare('UPDATE campaign_checkpoint SET snapshot_json=? WHERE campaign_id=?')
                .run(after.snapshotJson, h.scope.campaignId).changes,
            ).toBe(1);
            expect(
              h.db
                .prepare(
                  'UPDATE gm_request_queue_event SET event_id=?,record_json=?,record_sha256=? WHERE event_id=?',
                )
                .run(eventId, mirrorText, s.sha(mirrorText), mirrorRow.event_id).changes,
            ).toBe(1);
            expect(
              h.db
                .prepare(
                  'UPDATE gm_request_queue_view SET head_event_id=? WHERE context_id=? AND campaign_id=?',
                )
                .run(eventId, h.scope.gmLocalContextId, h.scope.campaignId).changes,
            ).toBe(1);
          })
          .immediate();
        expect(loadCampaignCheckpoint(h.db, h.scope.campaignId)).toEqual(after);
        expect(h.view()?.formId).toBe('NPC-003');
        let checkedTimeCalls = 0;
        const readers = {
          ...h.readers,
          inspectStoredSnapshot(...args: Parameters<NpcDomainReaders['inspectStoredSnapshot']>) {
            checkedTimeCalls++;
            const inspected = h.readers.inspectStoredSnapshot(...args);
            expect(inspected.requiredPreStartTimeOrNull).toBe(7);
            return inspected;
          },
        };
        const bytes = h.db.serialize();
        expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, readers)).toThrow();
        expect(checkedTimeCalls).toBeGreaterThan(0);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      });
      it.each(['native async', 'promise', 'nonfinite', 'SQL write'] as const)(
        'guards the actual stored inspection against %s without starting an async body or changing SQLite',
        async (fault) => {
          const { h } = restoredTimed(),
            bytes = h.db.serialize();
          let calls = 0;
          const callback =
            fault === 'native async'
              ? async () => {
                  calls++;
                  await Promise.resolve();
                  h.db.prepare('DELETE FROM npc_attempt_head').run();
                  return 7;
                }
              : () => {
                  calls++;
                  if (fault === 'promise') return Promise.resolve(7);
                  if (fault === 'SQL write') h.db.prepare('DELETE FROM npc_attempt_head').run();
                  return Number.POSITIVE_INFINITY;
                };
          const readers = Object.defineProperty({ ...h.readers }, 'inspectStoredSnapshot', {
            value: callback,
          });
          expect(() => readNpcRecoveryClosure(h.db, h.scope.campaignId, readers)).toThrow();
          await Promise.resolve();
          expect(calls).toBe(fault === 'native async' ? 0 : 1);
          expect(h.db.serialize().equals(bytes)).toBe(true);
        },
      );
    });
  });
}

export function registerNpcSourceCapture() {
  describe('NPC source and mirror callable capture at the actual writer boundary', () => {
    function editable() {
      const h = fixture(),
        created = h.create();
      const identity = readNpcEditorDraft(catalog, created.attempt.values).identity;
      const edit = h.replace(
        created.attempt,
        json({ ...identity, name: { kind: 'ENTERED', value: 'Проверка callback boundary' } }),
      );
      return { h, edit };
    }

    it('rejects DML from the first source getter read inside the read-only guard', () => {
      const { h, edit } = editable(),
        before = h.db.serialize();
      let getterReads = 0,
        sourceCalls = 0;
      const integration = Object.defineProperty({ ...h.integration }, 'readCheckedGmSource', {
        get() {
          getterReads++;
          if (getterReads === 1)
            h.db.prepare('UPDATE schema_migration SET name=name WHERE version=15').run();
          return function (
            this: NpcTransactionIntegration,
            ...args: Parameters<NpcTransactionIntegration['readCheckedGmSource']>
          ) {
            sourceCalls++;
            return h.integration.readCheckedGmSource.call(this, ...args);
          };
        },
      });
      expect(() => h.save(edit.boundary, edit.attempt, integration)).toThrow(
        'network application storage: SOURCE_CHANGED',
      );
      expect(getterReads).toBe(1);
      expect(sourceCalls).toBe(1);
      expect(h.db.inTransaction).toBe(false);
      expect(h.db.serialize().equals(before)).toBe(true);
    });

    it.each(['readCheckedGmSource', 'writeGmMirror'] as const)(
      'refuses native async %s with a forged display tag before body or delayed SQL',
      async (method) => {
        const { h, edit } = editable(),
          before = h.db.serialize();
        let bodyCalls = 0,
          delayedWrites = 0;
        const hostile = async () => {
          bodyCalls++;
          await Promise.resolve();
          h.db.prepare('UPDATE schema_migration SET name=name WHERE version=15').run();
          delayedWrites++;
        };
        Object.defineProperty(hostile, Symbol.toStringTag, { value: 'Function' });
        const integration = Object.defineProperty({ ...h.integration }, method, { value: hostile });
        expect(() => h.save(edit.boundary, edit.attempt, integration)).toThrow(
          'network application storage: INVALID_INPUT',
        );
        await Promise.resolve();
        expect(bodyCalls).toBe(0);
        expect(delayedWrites).toBe(0);
        expect(h.db.inTransaction).toBe(false);
        expect(h.db.serialize().equals(before)).toBe(true);
      },
    );

    it('captures changing source and mirror accessors once, keeps their receiver and permits the real synchronous mirror write', async () => {
      const { h, edit } = editable();
      let sourceGets = 0,
        mirrorGets = 0,
        sourceCalls = 0,
        mirrorCalls = 0,
        uncheckedAsyncCalls = 0;
      const unchecked = async () => {
        uncheckedAsyncCalls++;
        await Promise.resolve();
        h.db.prepare('UPDATE schema_migration SET name=name WHERE version=15').run();
      };
      Object.defineProperty(unchecked, Symbol.toStringTag, { value: 'Function' });
      const integration = { ...h.integration };
      Object.defineProperties(integration, {
        readCheckedGmSource: {
          get() {
            sourceGets++;
            if (sourceGets !== 1) return unchecked;
            return function (
              this: NpcTransactionIntegration,
              ...args: Parameters<NpcTransactionIntegration['readCheckedGmSource']>
            ) {
              expect(this).toBe(integration);
              sourceCalls++;
              return h.integration.readCheckedGmSource.call(this, ...args);
            };
          },
        },
        writeGmMirror: {
          get() {
            mirrorGets++;
            if (mirrorGets !== 1) return unchecked;
            return function (
              this: NpcTransactionIntegration,
              ...args: Parameters<NpcTransactionIntegration['writeGmMirror']>
            ) {
              expect(this).toBe(integration);
              mirrorCalls++;
              h.integration.writeGmMirror.call(this, ...args);
            };
          },
        },
      });
      const saved = h.save(edit.boundary, edit.attempt, integration);
      expect(saved.replayed).toBe(false);
      await Promise.resolve();
      expect([sourceGets, sourceCalls, mirrorGets, mirrorCalls, uncheckedAsyncCalls]).toEqual([
        1, 1, 1, 1, 0,
      ]);
      const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
      expect(
        closure.operations.filter(
          (operation) => operation.operationId === edit.boundary.operationId,
        ),
      ).toEqual([saved.operation]);
      expect(closure.attempts.at(-1)?.attempt).toEqual(edit.attempt);
      const written = h.db.serialize();
      expect(h.save(edit.boundary, edit.attempt, integration)).toEqual({
        ...saved,
        replayed: true,
      });
      expect([sourceGets, sourceCalls, mirrorGets, mirrorCalls, uncheckedAsyncCalls]).toEqual([
        1, 1, 1, 1, 0,
      ]);
      expect(h.db.serialize().equals(written)).toBe(true);
    });
  });
}

export function registerNpcCheckedClosure() {
  describe('same-phase checked NPC closure at the writer authority boundary', () => {
    it.each([
      'orphan terminal',
      'foreign pending scope',
      'duplicate pending identity',
      'corrupt working bytes',
    ] as const)(
      'rejects %s outside checkpoint replay before preparation and preserves bytes',
      (fault) => {
        const h = fixture();
        const boundary = h.boundary('CREATE', h.action('NPC-001::CTA::001'), null);
        const batchId = randomUUID();
        // These are deliberately corrupt on-disk rows, not a forged successful admission fixture.
        // Foreign keys are restored before either public reading or the guarded NPC writer.
        h.db.pragma('foreign_keys=OFF');
        try {
          if (fault === 'orphan terminal') {
            const record = s.canonical({ scope: h.scope });
            h.db
              .prepare('INSERT INTO campaign_admission_gm_decision VALUES (?,?,?,?,?,?,?,?,?)')
              .run(
                batchId,
                h.scope.campaignId,
                randomUUID(),
                randomUUID(),
                'REJECT',
                null,
                null,
                record,
                s.sha(record),
              );
          } else {
            const count = fault === 'duplicate pending identity' ? 2 : 1;
            for (let i = 0; i < count; i++) {
              const record = s.canonical({
                scope: h.scope,
                initialState: { admissionBatchId: batchId },
              });
              h.db
                .prepare('INSERT INTO campaign_admission_batch VALUES (?,?,?,?,?,?,?,?,?)')
                .run(
                  i === 0 ? batchId : randomUUID(),
                  fault === 'foreign pending scope' ? randomUUID() : h.scope.campaignId,
                  randomUUID(),
                  h.scope.ownerDeviceId,
                  h.scope.gmLocalContextId,
                  randomUUID(),
                  randomUUID(),
                  record,
                  fault === 'corrupt working bytes' ? '0'.repeat(64) : s.sha(record),
                );
            }
          }
        } finally {
          h.db.pragma('foreign_keys=ON');
        }
        const bytes = h.db.serialize();
        expect(() =>
          readCampaignAdmissionAvailability(h.db, h.scope, h.validateOwner, {
            verifyInitial: unavailable,
            reduce: unavailable,
            buildProposal: unavailable,
            npc: h.readers,
          }),
        ).toThrow();
        expect(h.db.serialize().equals(bytes)).toBe(true);
        expect(() => h.db.transaction(() => h.calendar()).deferred()).toThrow();
        expect(h.db.serialize().equals(bytes)).toBe(true);
        let factories = 0;
        expect(() =>
          saveNpcAttemptPrepared(
            h.db,
            boundary,
            { kind: 'CREATE' },
            () => {
              factories++;
              throw new Error('Corrupt admission state must fail before preparation');
            },
            h.readers,
            {
              ...h.integration,
              validatePreparation(context) {
                validateNpcPreparationInTransaction(h.db, context);
              },
            },
          ),
        ).toThrow();
        expect(factories).toBe(0);
        expect(h.db.inTransaction).toBe(false);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );

    it.each(['source mutation', 'SQL write', 'Promise'] as const)(
      'refuses %s from the validator receiving the exact same-phase closure',
      (fault) => {
        const h = fixture(),
          created = h.create();
        const identity = readNpcEditorDraft(catalog, created.attempt.values).identity;
        const edit = h.replace(
          created.attempt,
          json({ ...identity, name: { kind: 'ENTERED', value: 'Сохранённый ввод' } }),
        );
        const bytes = h.db.serialize();
        let calls = 0,
          injections = 0;
        let sqlChanges: number | null = null;
        const observations: {
          closure: Parameters<NpcTransactionIntegration['validate']>[3];
          expectedQueuePrefix: ReturnType<typeof readNpcGmSourceInTransaction>['queuePrefix'];
          inTransaction: boolean;
        }[] = [];
        const changedHeadSha =
          created.result.operation.attemptEventSha256 === '0'.repeat(64)
            ? 'f'.repeat(64)
            : '0'.repeat(64);
        const validate = (...args: Parameters<NpcTransactionIntegration['validate']>): unknown => {
          calls++;
          h.integration.validate(...args);
          const closure = args[3];
          observations.push({
            closure,
            expectedQueuePrefix: readNpcGmSourceInTransaction(h.db, h.scope).queuePrefix,
            inTransaction: h.db.inTransaction,
          });
          injections++;
          if (fault === 'source mutation')
            Object.defineProperty(closure, 'operations', { value: [] });
          else if (fault === 'SQL write')
            // DELETE is stopped by the reservation FK before the callback write guard can observe it.
            sqlChanges = h.db
              .prepare(
                'UPDATE npc_attempt_head SET record_sha256=? WHERE campaign_id=? AND draft_id=?',
              )
              .run(changedHeadSha, h.scope.campaignId, created.attempt.npcDraftId).changes;
          else return Promise.resolve();
          return undefined;
        };
        const integration = Object.defineProperty({ ...h.integration }, 'validate', {
          value: validate,
        });
        let failure: unknown;
        try {
          h.save(edit.boundary, edit.attempt, integration);
        } catch (error) {
          failure = error;
        }
        const expectedCode = fault === 'SQL write' ? 'SOURCE_CHANGED' : 'INVALID_INPUT';
        expect(failure).toBeInstanceOf(NetworkApplicationStoreError);
        expect(failure).toMatchObject({
          code: expectedCode,
          message: `network application storage: ${expectedCode}`,
        });
        expect(calls).toBe(1);
        expect(injections).toBe(1);
        expect(observations).toHaveLength(1);
        expect(observations[0]?.inTransaction).toBe(true);
        const closure = observations[0]?.closure;
        expect(closure?.operations).toHaveLength(1);
        expect(closure?.operations[0]?.operationId).toBe(created.boundary.operationId);
        expect(closure?.calendarContext?.currentQueuePrefixOrNull).toEqual(
          observations[0]?.expectedQueuePrefix,
        );
        expect(sqlChanges).toBe(fault === 'SQL write' ? 1 : null);
        expect(h.db.inTransaction).toBe(false);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );
  });
}

export function registerNpcForwardContext() {
  describe('same-phase NPC forward preparation context', () => {
    it('keeps both version slots absent for CREATE and its later edits', () => {
      const h = fixture();
      const boundary = h.boundary('CREATE', h.action('NPC-001::CTA::001'), null);
      const attempt: NpcAttempt = {
        scope: h.scope,
        npcDraftId: randomUUID(),
        candidateNpcUuid: randomUUID(),
        revision: 0,
        mode: 'CREATE_V1',
        targetOrNull: null,
        stage: 'NPC-002',
        status: 'OPEN',
        values: json(createEmptyNpcEditorDraft()),
      };
      const integration = {
        ...h.integration,
        validatePreparation(context: Parameters<NpcAttemptPreparer>[0]) {
          validateNpcPreparationInTransaction(h.db, context);
        },
      };
      let calls = 0;
      saveNpcAttemptPrepared(
        h.db,
        boundary,
        { kind: 'CREATE' },
        (context) => {
          calls++;
          expect(context.previousOrNull).toBeNull();
          expect(context.previousReadContextOrNull).toBeNull();
          expect(context.baseVersionOrNull).toBeNull();
          expect(context.inheritedVersionForPreviousAttemptOrNull).toBeNull();
          expect(Object.isFrozen(context)).toBe(true);
          return { next: attempt, receiptId: randomUUID(), committedAt: timestamp };
        },
        h.readers,
        integration,
      );
      const identity = readNpcEditorDraft(catalog, attempt.values).identity;
      const edit = h.replace(
        attempt,
        json({ ...identity, name: { kind: 'ENTERED', value: 'Сохранённое имя' } }),
      );
      saveNpcAttemptPrepared(
        h.db,
        edit.boundary,
        { kind: 'EXISTING', npcDraftId: attempt.npcDraftId },
        (context) => {
          calls++;
          expect(context.previousOrNull?.attempt).toEqual(attempt);
          expect(context.previousReadContextOrNull?.revision).toBe(attempt.revision);
          expect(context.baseVersionOrNull).toBeNull();
          expect(context.inheritedVersionForPreviousAttemptOrNull).toBeNull();
          return { next: edit.attempt, receiptId: randomUUID(), committedAt: timestamp };
        },
        h.readers,
        integration,
      );
      expect(calls).toBe(2);
    });

    it('separates OPEN base from the immutable inherited version on EXISTING and preserves replay', () => {
      const h = fixture();
      h.commit(h.fillOrdinary(h.create().attempt, false, false, true));
      const original = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0]!;
      const originalBytes = s.canonical(original);
      const opened = h.prepareOpen(original);
      const integration = {
        ...h.integration,
        validatePreparation(context: Parameters<NpcAttemptPreparer>[0]) {
          validateNpcPreparationInTransaction(h.db, context);
        },
      };
      saveNpcAttemptPrepared(
        h.db,
        opened.boundary,
        { kind: 'OPEN', target: opened.attempt.targetOrNull! },
        (context) => {
          expect(context.baseVersionOrNull).toEqual(original);
          expect(context.previousOrNull).toBeNull();
          expect(context.inheritedVersionForPreviousAttemptOrNull).toBeNull();
          return { next: opened.attempt, receiptId: randomUUID(), committedAt: timestamp };
        },
        h.readers,
        integration,
      );
      const edit = h.replace(
        opened.attempt,
        json({
          ...readNpcEditorDraft(catalog, opened.attempt.values).identity,
          name: { kind: 'ENTERED', value: 'Уточнённое имя' },
        }),
      );
      const before = h.db.serialize();
      let mutationCalls = 0;
      let mutationAttempts = 0;
      expect(() =>
        saveNpcAttemptPrepared(
          h.db,
          edit.boundary,
          { kind: 'EXISTING', npcDraftId: opened.attempt.npcDraftId },
          (context) => {
            mutationCalls++;
            const inherited = context.inheritedVersionForPreviousAttemptOrNull;
            expect(inherited).toEqual(original);
            expect(Object.isFrozen(inherited)).toBe(true);
            if (inherited === null) throw Error('Missing inherited version');
            mutationAttempts++;
            Object.defineProperty(inherited, 'version', { value: 99 });
            return { next: edit.attempt, receiptId: randomUUID(), committedAt: timestamp };
          },
          h.readers,
          integration,
        ),
      ).toThrow();
      expect(mutationCalls).toBe(1);
      expect(mutationAttempts).toBe(1);
      expect(h.db.inTransaction).toBe(false);
      expect(h.db.serialize().equals(before)).toBe(true);
      let calls = 0;
      const prepare: NpcAttemptPreparer = (context) => {
        calls++;
        expect(context.baseVersionOrNull).toBeNull();
        expect(s.canonical(context.inheritedVersionForPreviousAttemptOrNull)).toBe(originalBytes);
        expect(context.previousOrNull?.attempt).toEqual(opened.attempt);
        expect(context.previousReadContextOrNull?.inheritedVersionOrNull).toEqual({
          npcUuid: original.npcUuid,
          version: original.version,
          sha256: s.sha(originalBytes),
        });
        expect(context.calendarContext?.checkpoint).toEqual(context.checkpoint);
        return { next: edit.attempt, receiptId: randomUUID(), committedAt: timestamp };
      };
      const args = [
        h.db,
        edit.boundary,
        { kind: 'EXISTING' as const, npcDraftId: opened.attempt.npcDraftId },
        prepare,
        h.readers,
        integration,
      ] as const;
      const saved = saveNpcAttemptPrepared(...args);
      expect(calls).toBe(1);
      const after = h.db.serialize();
      expect(saveNpcAttemptPrepared(...args)).toEqual({ ...saved, replayed: true });
      expect(calls).toBe(1);
      expect(h.db.serialize().equals(after)).toBe(true);
      expect(
        s.canonical(readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0]),
      ).toBe(originalBytes);
    });
  });
}

export function registerNpcWoundAssignment() {
  describe('NPC actual wound assignment and publication', () => {
    it('preserves assigned bleeding and HP through commit, replay and SQLite reopen without a clock', () => {
      const h = fixture();
      const connect = (current: ReturnType<typeof fixture>) =>
        createNpcHostSupport(current.db, fullSource, artCatalog, () => current.calendar()).connect(
          current.scope,
          () => readGmRequestReviewSource(current.db, current.scope, current.validateOwner),
          (checkpoint, closure) => {
            expect(current.db.inTransaction).toBe(true);
            expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
          },
          current.validateOwner,
        );
      const app = connect(h),
        initial = h.create().attempt;
      const cleared = app.prepare({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-002',
        npcDraftId: initial.npcDraftId,
        expectedAttemptRevision: initial.revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation: { kind: 'ART_CLEAR' },
      });
      const complete = h.fillOrdinary(cleared.attemptEvent.attempt),
        attempt = h.navigate(complete, 'NPC-017::CTA::003', 'NPC-016').attempt;
      const hp = s.object(s.object(attempt.values['initialState'])['currentHP'])['value'];
      const request: NpcPreparationRequest = {
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-016',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation: {
          kind: 'WOUND_PREPARE',
          input: { woundType: 'BLEEDING', regionId: 'ARM_L', damagePerTick: 2 },
        },
      };
      const reserved = app.prepare(request);
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('actual wound allocation required');
      const wound = reserved.attemptEvent.childAllocations[0];
      if (wound?.kind !== 'WOUND_INSTANCE') throw Error('actual wound identity required');
      const preparedBytes = h.db.serialize();
      expect(app.prepare(request)).toMatchObject({ replayed: true });
      expect(h.db.serialize().equals(preparedBytes)).toBe(true);
      expect(() =>
        app.prepare({
          ...request,
          preparation: {
            kind: 'WOUND_PREPARE',
            input: { woundType: 'BLEEDING', regionId: 'ARM_L', damagePerTick: 3 },
          },
        }),
      ).toThrow();
      expect(h.db.serialize().equals(preparedBytes)).toBe(true);
      expect(() => app.prepare({ ...request, operationId: randomUUID() })).toThrow();
      expect(h.db.serialize().equals(preparedBytes)).toBe(true);
      const next = app.navigation(h.action('NPC-016::CTA::001'));
      if (!('attemptEvent' in next)) throw Error('actual final transition required');
      const command = npcWorkflowCommandRequestValue(
        h.commitBoundary(next.attemptEvent.attempt).boundary.request,
      );
      app.workflow(command);
      const closure = app.read().closure,
        version = closure.versions[0] ?? unavailable();
      expect(version.snapshot).toMatchObject({
        format: 'NPC_HUMANOID_V1',
        derivation: {
          initialWoundProof: {
            assignments: [{ woundInstanceId: wound.id, originOperationId: request.operationId }],
          },
        },
        sheet: {
          requiresCampaignTime: false,
          input: {
            initialState: {
              currentHP: hp,
              currentWounds: [
                {
                  woundInstanceId: wound.id,
                  woundType: 'BLEEDING',
                  regionId: 'ARM_L',
                  damagePerTick: 2,
                  tickPhase: 'END_OF_TARGET_TURN',
                },
              ],
              effectInstances: [],
            },
          },
        },
      });
      expect(closure.operations.find((o) => o.operationId === command.commandId)?.request).toEqual(
        command,
      );
      expect(closure.anchorOrNull).not.toBeNull();
      const bytes = h.db.serialize(),
        receipt = app.receipt(command.commandId);
      expect(app.workflow(command)).toMatchObject({ replayed: true, receipt });
      expect(app.prepare(request)).toMatchObject({ replayed: true });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure.versions).toEqual(closure.versions);
      expect(restored.workflow(command)).toMatchObject({ replayed: true, receipt });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    });
  });
}

export function registerNpcEquippedInventory() {
  describe('NPC actual equipped inventory and physical compatibility', () => {
    const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
    const connect = (h: ReturnType<typeof fixture>) =>
      createNpcHostSupport(h.db, fullSource, artCatalog, () => h.calendar()).connect(
        h.scope,
        () => readGmRequestReviewSource(h.db, h.scope, h.validateOwner),
        (checkpoint, closure) => {
          expect(h.db.inTransaction).toBe(true);
          expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
        },
        h.validateOwner,
      );
    function actualInventory() {
      const h = fixture(),
        app = connect(h);
      let attempt = h.create().attempt;
      const clear = app.prepare({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-002',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation: { kind: 'ART_CLEAR' },
      });
      attempt = h.fillOrdinary(clear.attemptEvent.attempt, false, true);
      function edit(values: unknown) {
        const request = npcTechnicalRequestValue(json(h.editorRequest(attempt, json(values))));
        if (request.messageType !== 'network.npc-editor.replace')
          throw Error('Expected editor request');
        attempt = app.replace(request).attemptEvent.attempt;
      }
      function next(action: keyof typeof NPC_NAV_TARGETS) {
        const result = app.navigation(h.action(action));
        if (!('attemptEvent' in result)) throw Error('Expected editor transition');
        attempt = result.attemptEvent.attempt;
      }
      function project() {
        return h.db
          .transaction(() =>
            app.project(
              admissionDecisionStorage.readHistory(h.db, h.scope, h.validateOwner, {
                verifyInitial: unavailable,
                reduce: unavailable,
                buildProposal: unavailable,
                npc: h.readers,
              }),
              ['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'],
            ),
          )
          .deferred();
      }
      function projectedContent(presentation: ReturnType<typeof project>) {
        return npcGmProjectionValue(
          presentation.base.formId,
          presentation.base.roleFilteredPayload,
          {
            projectionRole: 'gm',
            contextId: h.scope.gmLocalContextId,
            campaignId: h.scope.campaignId,
            ...presentation.revisions,
          },
        );
      }
      function reserveArmor(type: string, zone: NpcInventoryRequestEntry['bodyZone']) {
        const reserved = app.prepare({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-015',
          npcDraftId: attempt.npcDraftId,
          expectedAttemptRevision: attempt.revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation: { kind: 'ITEM_RESERVE', values: json(attempt.values['inventory']) },
        });
        attempt = reserved.attemptEvent.attempt;
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual item allocation required');
        const item = reserved.attemptEvent.childAllocations.find((c) => c.kind === 'ITEM');
        if (item === undefined) throw Error('Actual item identity required');
        const request: NpcInventoryRequestEntry = {
          ...npcKensiRequest(item.id),
          itemTypeId: type,
          currentAmmo: null,
          bodyZone: zone,
          profile: { kind: 'CATALOG' },
          equipped: true,
          equippedSlots:
            zone === null ? ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] : [zone],
          sealed: type === 'ITM-ARM-005' ? true : null,
        };
        const { itemInstanceId, profile, ...input } = request;
        const inventory = s.object(attempt.values['inventory'])['value'];
        if (!Array.isArray(inventory)) throw Error('Entered inventory rows required');
        edit(
          entered(
            inventory.map((row: unknown) =>
              s.object(row)['itemInstanceId'] === itemInstanceId
                ? {
                    itemInstanceId,
                    profile: entered(profile),
                    input: Object.fromEntries(
                      Object.entries(input).map(([key, value]) => [key, entered(value)]),
                    ),
                  }
                : row,
            ),
          ),
        );
        return request;
      }
      function finish() {
        next('NPC-015::CTA::001');
        edit({
          input: {
            ...s.object(attempt.values['initialState']),
            currentHP: entered(1),
            effectInstanceIds: entered([]),
            traumaInstanceIds: entered([]),
            woundInstanceIds: entered([]),
            sourceSpecificStateFactIds: entered([]),
            deathConsequenceFactIdOrNull: entered(null),
          },
          currentOeChanges: [],
        });
        if (fullSource.initialLifeAuthoringAvailable)
          attempt = app.prepare(h.aliveRequest(attempt)).attemptEvent.attempt;
        next('NPC-016::CTA::001');
        const command = h.commitWorkflowRequest(attempt);
        const committed = app.workflow(command);
        return { command, committed, version: app.read().closure.versions.at(-1) ?? unavailable() };
      }
      return {
        h,
        app,
        edit,
        next,
        project,
        projectedContent,
        reserveArmor,
        finish,
        attempt: () => attempt,
        setAttempt: (nextAttempt: NpcAttempt) => {
          attempt = nextAttempt;
        },
      };
    }

    it('appends actual inventory changes while retaining original weapon provenance across replay and reopen', () => {
      const x = actualInventory(),
        { h, app } = x;
      function reserveWeapon() {
        const reserved = app.prepare({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-015',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation: { kind: 'ITEM_RESERVE', values: json(x.attempt().values['inventory']) },
        });
        x.setAttempt(reserved.attemptEvent.attempt);
        if (!('childAllocations' in reserved.attemptEvent)) throw Error('Actual item required');
        const allocation = reserved.attemptEvent.childAllocations[0];
        if (allocation?.kind !== 'ITEM') throw Error('Physical item identity required');
        const { itemInstanceId, profile, ...input } = npcKensiRequest(allocation.id),
          rows = s.object(x.attempt().values['inventory'])['value'];
        if (!Array.isArray(rows)) throw Error('Inventory rows required');
        x.edit(
          entered(
            rows.map((row: unknown) =>
              s.object(row)['itemInstanceId'] === itemInstanceId
                ? {
                    itemInstanceId,
                    profile: entered(profile),
                    input: Object.fromEntries(
                      Object.entries(input).map(([key, value]) => [key, entered(value)]),
                    ),
                  }
                : row,
            ),
          ),
        );
        return allocation.id;
      }
      function published(version: NpcVersion, itemId: string) {
        const items = s.object(version.snapshot['sheet'])['itemProfiles'];
        if (!Array.isArray(items)) throw Error('Published item profiles required');
        return s.object(
          items.find(
            (item: unknown) => s.object(s.object(item)['item'])['itemInstanceId'] === itemId,
          ),
        );
      }
      const firstItemId = reserveWeapon(),
        first = x.finish(),
        firstBytes = s.canonical(first.version),
        firstItem = published(first.version, firstItemId),
        firstPhysical = s.object(firstItem['item']);
      const openRequest = h.openWorkflowRequest(first.version),
        opened = app.workflow(openRequest);
      x.setAttempt(opened.attemptEvent.attempt);
      for (const action of [
        'NPC-002::CTA::001',
        'NPC-011::CTA::001',
        'NPC-012::CTA::001',
        'NPC-013::CTA::001',
        'NPC-014::CTA::001',
      ] as const)
        x.next(action);
      const oldRows = s.object(x.attempt().values['inventory'])['value'];
      if (!Array.isArray(oldRows)) throw Error('Inherited inventory rows required');
      x.edit(
        entered(
          oldRows.map((row: unknown) => ({
            ...s.object(row),
            input: { ...s.object(s.object(row)['input']), broken: entered(true) },
          })),
        ),
      );
      const secondItemId = reserveWeapon(),
        second = x.finish(),
        retained = published(second.version, firstItemId),
        retainedPhysical = s.object(retained['item']),
        newItem = published(second.version, secondItemId);
      expect(second.version.version).toBe(2);
      expect(retainedPhysical['broken']).toBe(true);
      expect(firstPhysical['broken']).toBe(false);
      expect(retained['profileVersions']).toEqual(firstItem['profileVersions']);
      for (const field of [
        'provenance',
        'createdAt',
        'issuedBy',
        'issueReason',
        'activeWeaponProfileVersionIdByVariant',
      ])
        expect(retainedPhysical[field]).toEqual(firstPhysical[field]);
      expect(s.object(newItem['item'])['provenance']).toMatchObject({
        operationId: second.command.commandId,
      });
      const proof = s.object(s.object(second.version.snapshot['derivation'])['inventoryProof']);
      expect(proof['previous']).toEqual({
        npcUuid: first.version.npcUuid,
        version: 1,
        sha256: s.sha(firstBytes),
        commitOperationId: first.command.commandId,
      });
      expect(proof['commitOperationId']).toBe(second.command.commandId);
      const closure = app.read().closure,
        finalAttempt = closure.attempts.find(
          (entry) => entry.operationId === second.command.commandId,
        );
      if (finalAttempt === undefined || !('childAllocations' in finalAttempt))
        throw Error('Actual N+1 child allocation event required');
      expect(
        finalAttempt.childAllocations.filter((child) => child.kind === 'WEAPON_PROFILE_VERSION'),
      ).toMatchObject([{ itemInstanceId: secondItemId }]);
      expect(s.canonical(closure.versions[0])).toBe(firstBytes);
      const bytes = h.db.serialize();
      expect(app.workflow(second.command)).toEqual({ ...second.committed, replayed: true });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure).toEqual(closure);
      expect(restored.workflow(second.command)).toEqual({ ...second.committed, replayed: true });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    }, 180_000);

    it('restores an omitted historical physical item through an explicit no-allocation event and retains its provenance', () => {
      const x = actualInventory(),
        { h, app } = x;
      const makeRequest = (
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' }>['preparation'],
      ): NpcPreparationRequest => ({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-015',
        npcDraftId: x.attempt().npcDraftId,
        expectedAttemptRevision: x.attempt().revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation,
      });
      const reserved = app.prepare(
        makeRequest({ kind: 'ITEM_RESERVE', values: json(x.attempt().values['inventory']) }),
      );
      x.setAttempt(reserved.attemptEvent.attempt);
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('Actual reserved item required');
      const itemId = reserved.attemptEvent.childAllocations[0]?.id ?? unavailable();
      const { itemInstanceId, profile, ...input } = { ...npcKensiRequest(itemId), broken: true };
      x.edit(
        entered([
          {
            itemInstanceId,
            profile: entered(profile),
            input: Object.fromEntries(
              Object.entries(input).map(([key, value]) => [key, entered(value)]),
            ),
          },
        ]),
      );
      const first = x.finish(),
        firstBytes = s.canonical(first.version);
      const open = (version: NpcVersion) => {
        x.setAttempt(app.workflow(h.openWorkflowRequest(version)).attemptEvent.attempt);
        for (const action of [
          'NPC-002::CTA::001',
          'NPC-011::CTA::001',
          'NPC-012::CTA::001',
          'NPC-013::CTA::001',
          'NPC-014::CTA::001',
        ] as const)
          x.next(action);
      };
      open(first.version);
      x.edit(entered([]));
      const second = x.finish(),
        secondBytes = s.canonical(second.version);
      expect(s.object(second.version.snapshot['sheet'])['itemProfiles']).toEqual([]);
      open(second.version);
      const projected = x.projectedContent(x.project());
      if (projected.formId !== 'NPC-015') throw Error('Actual inventory projection required');
      const offered = projected.content.restorePreparationOrNull ?? unavailable();
      expect(offered.choices.map((choice) => choice.value)).toEqual([itemId]);
      const restore = makeRequest({
        kind: 'ITEM_RESTORE',
        capabilityKey: offered.capabilityKey,
        itemInstanceId: itemId,
        values: json(x.attempt().values['inventory']),
      });
      const before = h.db.serialize();
      expect(() =>
        app.prepare({
          ...restore,
          sourceFormId: 'NPC-015',
          operationId: randomUUID(),
          preparation: {
            kind: 'ITEM_RESTORE',
            capabilityKey: offered.capabilityKey,
            itemInstanceId: randomUUID(),
            values: json(x.attempt().values['inventory']),
          },
        }),
      ).toThrow();
      expect(h.db.serialize().equals(before)).toBe(true);
      const result = app.prepare(restore);
      x.setAttempt(result.attemptEvent.attempt);
      if (!('childAllocations' in result.attemptEvent))
        throw Error('Actual restore event required');
      expect(result.attemptEvent.childAllocations).toEqual([]);
      const rows = s.object(x.attempt().values['inventory'])['value'];
      if (!Array.isArray(rows) || rows.length !== 1)
        throw Error('One restored editor row required');
      expect(s.object(rows[0])['itemInstanceId']).toBe(itemId);
      expect(s.object(s.object(rows[0])['input'])['broken']).toEqual(entered(true));
      const restoredBytes = h.db.serialize();
      expect(app.prepare(restore)).toEqual({ ...result, replayed: true });
      expect(h.db.serialize().equals(restoredBytes)).toBe(true);
      const selectRestore = npcInventoryPublicationModule.selectNpcInventoryRestoreRequests;
      const readHistory = npcGmSourceModule.readNpcInventoryHistoryEvidenceInTransaction;
      const expectedHistory = [first, second].map(({ version, command }, index) => ({
        npcUuid: version.npcUuid,
        version: version.version,
        sha256: s.sha(index === 0 ? firstBytes : secondBytes),
        commitOperationId: command.commandId,
      }));
      const boundary = {
        selected: 0,
        nextSql: 0,
        injected: 0,
        selectorStack: '',
        sqlStack: '',
        changes: [] as number[],
        actualRefs: [] as typeof expectedHistory,
      };
      const selectorSpy = vi
        .spyOn(npcInventoryPublicationModule, 'selectNpcInventoryRestoreRequests')
        .mockImplementation(function (this: unknown, ...args: Parameters<typeof selectRestore>) {
          const actual = selectRestore.apply(this, args);
          const stack = new Error().stack ?? '';
          if (
            boundary.selected === 0 &&
            args[3] === itemId &&
            s.same(args[2], { npcUuid: first.version.npcUuid, selectedItemInstanceIds: [] }) &&
            s.same(
              args[1].history.map(({ publication: _publication, ...ref }) => ref),
              expectedHistory,
            ) &&
            s.same(
              actual.map((row) => row.itemInstanceId),
              [itemId],
            ) &&
            /\bat contextAt \(/.test(stack) &&
            !/\bat bindRestoredInventory \(/.test(stack)
          ) {
            boundary.selected++;
            boundary.selectorStack = stack;
          }
          return actual;
        });
      const historySpy = vi
        .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
        .mockImplementation(function (this: unknown, ...args: Parameters<typeof readHistory>) {
          const actual = readHistory.apply(this, args);
          if (
            boundary.selected === 1 &&
            boundary.nextSql === 0 &&
            args[0] === h.db &&
            s.same(args[1], h.scope) &&
            args[2] === first.version.npcUuid &&
            args[3] === second.version.version
          ) {
            boundary.nextSql++;
            boundary.sqlStack = new Error().stack ?? '';
            boundary.actualRefs = actual.map((entry) => ({
              ...entry.version,
              commitOperationId: entry.stored.operation.operationId,
            }));
            const binderAt = boundary.sqlStack.search(/\bat bindRestoredInventory \(/);
            const contextAt = boundary.sqlStack.search(/\bat contextAt \(/);
            // One explicit private call-chain anchor; a different next read never retries the hook.
            if (
              binderAt >= 0 &&
              contextAt > binderAt &&
              s.same(boundary.actualRefs, expectedHistory)
            ) {
              const originalHash = expectedHistory[0]!.sha256;
              const changedHash = originalHash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
              const update = h.db.prepare(
                'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
              );
              boundary.changes.push(
                update.run(changedHash, h.scope.campaignId, first.version.npcUuid).changes,
              );
              boundary.changes.push(
                update.run(originalHash, h.scope.campaignId, first.version.npcUuid).changes,
              );
              boundary.injected++;
            }
          }
          return actual;
        });
      try {
        let refusal: unknown;
        try {
          x.project();
        } catch (error) {
          refusal = error;
        }
        expect(boundary.selected).toBe(1);
        expect(boundary.selectorStack).toMatch(/\bat contextAt \(/);
        expect(boundary.selectorStack).not.toMatch(/\bat bindRestoredInventory \(/);
        expect(boundary.nextSql).toBe(1);
        expect(boundary.sqlStack).toMatch(/\bat bindRestoredInventory \(/);
        expect(boundary.sqlStack.search(/\bat contextAt \(/)).toBeGreaterThan(
          boundary.sqlStack.search(/\bat bindRestoredInventory \(/),
        );
        expect(boundary.actualRefs).toEqual(expectedHistory);
        expect(boundary.injected).toBe(1);
        expect(boundary.changes).toEqual([1, 1]);
        expect(refusal).toBeInstanceOf(NetworkApplicationStoreError);
        expect(refusal).toMatchObject({ code: 'SOURCE_CHANGED' });
        expect(h.db.inTransaction).toBe(false);
        expect(h.db.serialize().equals(restoredBytes)).toBe(true);
      } finally {
        historySpy.mockRestore();
        selectorSpy.mockRestore();
      }
      const afterProjection = x.projectedContent(x.project());
      if (afterProjection.formId !== 'NPC-015')
        throw Error('Current inventory projection required');
      expect(afterProjection.content.restorePreparationOrNull?.choices).toEqual([]);
      expect(h.db.serialize().equals(restoredBytes)).toBe(true);
      const third = x.finish();
      expect(third.version.version).toBe(3);
      const originalItems = s.object(first.version.snapshot['sheet'])['itemProfiles'];
      if (!Array.isArray(originalItems) || originalItems.length !== 1)
        throw Error('One original physical item required');
      const originalItem = s.object(originalItems[0]);
      // Restoring current selection changes item state, not its original profile audit.
      expect(s.object(third.version.snapshot['sheet'])['itemProfiles']).toEqual([
        {
          ...originalItem,
          item: { ...s.object(originalItem['item']), updatedAt: third.version.committedAt },
        },
      ]);
      const closure = app.read().closure;
      expect(s.canonical(closure.versions[0])).toBe(firstBytes);
      expect(s.canonical(closure.versions[1])).toBe(secondBytes);
      expect(closure.children.filter((child) => child.allocation.kind === 'ITEM')).toHaveLength(1);
      expect(
        closure.children.filter((child) => child.allocation.kind === 'WEAPON_PROFILE_VERSION'),
      ).toHaveLength(1);
      const bytes = h.db.serialize();
      h.db.close();
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure).toEqual(closure);
      expect(restored.prepare(restore)).toEqual({ ...result, replayed: true });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    }, 600_000);

    it('reserves real custom profile identities and publishes a carried bonus only in its actual backpack', () => {
      const x = actualInventory(),
        { h, app } = x;
      function request(
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' }>['preparation'],
      ): NpcPreparationRequest {
        return {
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-015',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        };
      }
      const backpackResult = app.prepare(
        request({ kind: 'ITEM_RESERVE', values: json(x.attempt().values['inventory']) }),
      );
      x.setAttempt(backpackResult.attemptEvent.attempt);
      if (!('childAllocations' in backpackResult.attemptEvent))
        throw Error('Actual backpack identity required');
      const backpackId = backpackResult.attemptEvent.childAllocations[0]?.id ?? unavailable();
      const {
        itemInstanceId: _item,
        profile: _profile,
        ...backpackInput
      } = {
        ...npcKensiRequest(backpackId),
        itemTypeId: 'RES-CON-001',
        currentAmmo: null,
        equipped: false,
        equippedSlots: [],
        gripMode: null,
      };
      x.edit(
        entered([
          {
            itemInstanceId: backpackId,
            input: Object.fromEntries(
              Object.entries(backpackInput).map(([k, v]) => [k, entered(v)]),
            ),
            profile: entered({ kind: 'CATALOG' }),
          },
        ]),
      );
      const reserveRequest = request({
          kind: 'CUSTOM_ITEM_RESERVE',
          values: json(x.attempt().values['inventory']),
        }),
        reserved = app.prepare(reserveRequest);
      x.setAttempt(reserved.attemptEvent.attempt);
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('Actual custom allocations required');
      expect(reserved.attemptEvent.childAllocations.map((c) => c.kind)).toEqual([
        'ITEM',
        'CUSTOM_PROFILE',
        'CUSTOM_PROFILE_VERSION',
      ]);
      const [item, profile, version] = reserved.attemptEvent.childAllocations;
      if (
        item?.kind !== 'ITEM' ||
        profile?.kind !== 'CUSTOM_PROFILE' ||
        version?.kind !== 'CUSTOM_PROFILE_VERSION'
      )
        throw Error('Exact custom allocation kinds required');
      expect(profile).toMatchObject({
        itemInstanceId: item.id,
        profileKind: 'CAMPAIGN_CUSTOM_PROFILE',
      });
      expect(version).toMatchObject({
        itemInstanceId: item.id,
        profileId: profile.id,
        version: 1,
        previousVersionIdOrNull: null,
      });
      const reservationBytes = h.db.serialize();
      expect(app.prepare(reserveRequest)).toEqual({ ...reserved, replayed: true });
      expect(h.db.serialize().equals(reservationBytes)).toBe(true);
      for (const changed of [
        { ...reserveRequest, operationId: randomUUID() },
        {
          ...reserveRequest,
          preparation: {
            kind: 'CUSTOM_MODIFIER_RESERVE',
            itemInstanceId: randomUUID(),
            values: json(x.attempt().values['inventory']),
          },
        },
      ]) {
        expect(() =>
          app.prepare(npcTechnicalRequestValue(changed) as NpcPreparationRequest),
        ).toThrow();
        expect(h.db.serialize().equals(reservationBytes)).toBe(true);
      }
      const projection = x.projectedContent(x.project());
      if (projection.formId !== 'NPC-015') throw Error('Actual NPC015 required');
      expect(projection.content.customPreparationOrNull).toMatchObject({
        canAdd: true,
        backpackChoices: [{ value: backpackId }],
        editableProfileVersionIds: [version.id],
      });
      const raw = s.object(x.attempt().values['inventory'])['value'];
      if (!Array.isArray(raw)) throw Error('Actual inventory rows required');
      const custom = s.object(raw.find((r: unknown) => s.object(r)['itemInstanceId'] === item.id));
      expect(s.object(custom['input'])['itemTypeId']).toEqual(entered(null));
      expect(custom['bonusContainerBinding']).toEqual({ kind: 'UNSET' });
      expect(custom['customProfileReason']).toEqual({ kind: 'UNSET' });
      const {
        itemInstanceId: _customId,
        profile: _oldProfile,
        ...physical
      } = {
        ...npcKensiRequest(item.id),
        itemTypeId: null,
        currentAmmo: null,
        equipped: false,
        equippedSlots: [],
        gripMode: null,
        issueReason: 'Выдан конкретный памятный предмет',
      };
      const row = {
        ...custom,
        input: Object.fromEntries(Object.entries(physical).map(([k, v]) => [k, entered(v)])),
        profile: entered({
          kind: 'STRUCTURED_CUSTOM',
          input: Object.fromEntries(
            Object.entries({
              name: 'Памятный предмет',
              description: 'Один физический экземпляр',
              massKg: 1,
              heldSizeClass: 'FITS_IN_FIST',
              armorWeightClass: 'OTHER',
              flammability: 'NONCOMBUSTIBLE',
              isIgnitionSource: false,
              isFood: false,
              canReceivePoison: false,
              canReceiveFlammableCoating: false,
            }).map(([k, v]) => [k, entered(v)]),
          ),
          customBonusOrNull: entered({
            customBonusStat: entered('C'),
            customBonusValue: entered(3),
          }),
        }),
        bonusContainerBinding: entered({ kind: 'BACKPACK', backpackItemInstanceId: backpackId }),
        customProfileReason: entered('Подтверждён профиль этого экземпляра'),
      };
      x.edit(
        entered(raw.map((r: unknown) => (s.object(r)['itemInstanceId'] === item.id ? row : r))),
      );
      const { command, committed, version: saved } = x.finish(),
        sheet = s.object(saved.snapshot['sheet']);
      const itemProfiles = sheet['itemProfiles'];
      if (!Array.isArray(itemProfiles)) throw Error('Published item profiles required');
      const published = s.object(
        itemProfiles.find(
          (p: unknown) => s.object(s.object(p)['item'])['itemInstanceId'] === item.id,
        ),
      );
      expect(published['kind']).toBe('CAMPAIGN_CUSTOM_ITEM');
      expect(s.object(published['item'])['itemTypeId']).toBeNull();
      expect(published['profileVersions']).toEqual([]);
      expect(published['customProfileVersions']).toMatchObject([
        {
          profileId: profile.id,
          profileVersionId: version.id,
          version: 1,
          itemInstanceId: item.id,
          ownerId: saved.npcUuid,
          previousVersionId: null,
          immutableAudit: true,
        },
      ]);
      const statLayers = s.object(sheet['stats']);
      expect(s.object(statLayers['effectiveStats'])['C']).toBe(
        Number(s.object(statLayers['permanentStats'])['C']) + 3,
      );
      const closure = app.read().closure,
        bytes = h.db.serialize();
      expect(app.workflow(command)).toEqual({ ...committed, replayed: true });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId });
      expect(readNpcRecoveryClosure(reopened.db, h.scope.campaignId, reopened.readers)).toEqual(
        closure,
      );
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    });
    it.each(['ITM-WPN-026', 'ITM-WPN-027'] as const)(
      'publishes actual composite %s identities and only source-defined attacking profiles',
      (itemTypeId) => {
        const x = actualInventory(),
          { h, app } = x;
        const projection = x.projectedContent(x.project());
        if (projection.formId !== 'NPC-015') throw Error('Actual inventory projection required');
        expect(
          projection.content.compositePreparationOrNull?.choices.map((choice) => choice.value),
        ).toEqual(['ITM-WPN-026', 'ITM-WPN-027']);
        const request: NpcPreparationRequest = {
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-015',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation: { kind: 'COMPOSITE_ITEM_RESERVE', input: { itemTypeId } },
        };
        const reserved = app.prepare(request);
        x.setAttempt(reserved.attemptEvent.attempt);
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual composite allocations required');
        const [set, first, second] = reserved.attemptEvent.childAllocations;
        if (set?.kind !== 'LINKED_SET' || first?.kind !== 'ITEM' || second?.kind !== 'ITEM')
          throw Error('Ordered set and both component identities required');
        expect(reserved.attemptEvent.childAllocations).toHaveLength(3);
        expect(new Set([set.id, first.id, second.id]).size).toBe(3);
        expect(x.attempt().values).toMatchObject({
          inventory: entered([
            {
              itemInstanceId: first.id,
              input: {
                itemTypeId: entered(itemTypeId),
                linkedSetInstanceId: entered(set.id),
                componentRole: entered(itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER'),
                quantity: { kind: 'UNSET' },
                equipped: { kind: 'UNSET' },
              },
            },
            {
              itemInstanceId: second.id,
              input: {
                itemTypeId: entered(itemTypeId),
                linkedSetInstanceId: entered(set.id),
                componentRole: entered('SHIELD'),
                quantity: { kind: 'UNSET' },
                equipped: { kind: 'UNSET' },
              },
            },
          ]),
        });
        const bytes = h.db.serialize();
        expect(app.prepare(request)).toMatchObject({ replayed: true });
        for (const changed of [
          { ...request, operationId: randomUUID() },
          {
            ...request,
            preparation: {
              kind: 'COMPOSITE_ITEM_RESERVE' as const,
              input: {
                itemTypeId:
                  itemTypeId === 'ITM-WPN-026'
                    ? ('ITM-WPN-027' as const)
                    : ('ITM-WPN-026' as const),
              },
            },
          },
          { ...request, campaignId: randomUUID() },
        ]) {
          expect(() => app.prepare(changed)).toThrow();
          expect(h.db.serialize().equals(bytes)).toBe(true);
        }
        const rows = [first, second].map((child, index) => {
          const closed: NpcInventoryRequestEntry = {
            ...npcKensiRequest(child.id),
            itemTypeId,
            currentAmmo: null,
            linkedSetInstanceId: set.id,
            componentRole:
              index === 1 ? 'SHIELD' : itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER',
            equipped: true,
            equippedSlots: [index === 0 ? 'HAND_L' : 'HAND_R'],
            shieldCurrentHP: index === 1 ? (itemTypeId === 'ITM-WPN-026' ? 350 : 150) : null,
          };
          const { itemInstanceId, profile, ...input } = closed;
          return {
            itemInstanceId,
            profile: entered(profile),
            input: Object.fromEntries(
              Object.entries(input).map(([key, value]) => [key, entered(value)]),
            ),
          };
        });
        expect(() =>
          x.edit(
            entered([
              { ...rows[0], input: { ...rows[0]!.input, componentRole: entered('SHIELD') } },
              rows[1],
            ]),
          ),
        ).toThrow();
        expect(h.db.serialize().equals(bytes)).toBe(true);
        x.edit(entered(rows));
        const { command, version } = x.finish();
        const snapshot = s.object(version.snapshot),
          sheet = s.object(snapshot['sheet']);
        const profiles = sheet['itemProfiles'];
        if (!Array.isArray(profiles)) throw Error('Actual published item profiles required');
        expect(profiles.map((row) => s.object(row)['kind'])).toEqual(
          itemTypeId === 'ITM-WPN-026' ? ['WEAPON', 'SHIELD_COMPONENT'] : ['WEAPON', 'WEAPON'],
        );
        expect(profiles.map((row) => s.object(row)['profileVersions'])).toMatchObject(
          itemTypeId === 'ITM-WPN-026'
            ? [[{ itemInstanceId: first.id, attackVariantId: 'SWORD' }], []]
            : [
                [{ itemInstanceId: first.id, attackVariantId: 'RAPIER' }],
                [{ itemInstanceId: second.id, attackVariantId: 'SHIELD' }],
              ],
        );
        expect(profiles.map((row) => s.object(row)['item'])).toMatchObject([
          { itemInstanceId: first.id, linkedSetInstanceId: set.id, equippedSlots: ['HAND_L'] },
          {
            itemInstanceId: second.id,
            linkedSetInstanceId: set.id,
            equippedSlots: ['HAND_R'],
            shieldCurrentHP: itemTypeId === 'ITM-WPN-026' ? 350 : 150,
          },
        ]);
        const committedBytes = h.db.serialize(),
          receipt = app.receipt(command.commandId);
        const reopened = fixture({ bytes: committedBytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(restored.prepare(request)).toMatchObject({ replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true, receipt });
        expect(reopened.db.serialize().equals(committedBytes)).toBe(true);
      },
    );

    it('binds the real physical compatibility control to the exact loadout and preserves replay after publication', () => {
      const x = actualInventory(),
        { h, app } = x;
      x.edit(entered([]));
      const suit = x.reserveArmor('ITM-ARM-006', null),
        helmet = x.reserveArmor('ITM-ARM-001', 'HEAD');
      const presentation = x.project(),
        payload = x.projectedContent(presentation);
      if (payload.formId !== 'NPC-015') throw Error('Actual inventory projection required');
      const control = payload.content.compatibilityPreparationOrNull;
      if (control == null) throw Error('Actual physical compatibility control required');
      expect(control.orderedItems.map((item) => item.itemInstanceId)).toEqual([
        suit.itemInstanceId,
        helmet.itemInstanceId,
      ]);
      expect(control.input.reason).toEqual({ kind: 'UNSET' });
      expect(presentation.base.availableActionKeys).not.toContain('NPC-015::CTA::003');
      const before = h.db.serialize();
      expect(() => app.navigation(h.action('NPC-015::CTA::001'))).toThrow();
      expect(h.db.serialize().equals(before)).toBe(true);
      const request: NpcPreparationRequest = {
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-015',
        npcDraftId: x.attempt().npcDraftId,
        expectedAttemptRevision: x.attempt().revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation: {
          kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM',
          input: {
            capabilityKey: control.capabilityKey,
            reason: 'Проверена посадка шлема поверх костюма',
          },
        },
      };
      const confirmed = app.prepare(request);
      x.setAttempt(confirmed.attemptEvent.attempt);
      const confirmedBytes = h.db.serialize();
      expect(app.prepare(request)).toMatchObject({ replayed: true });
      for (const changed of [
        {
          ...request,
          preparation: {
            kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM' as const,
            input: { capabilityKey: control.capabilityKey, reason: 'Другое основание' },
          },
        },
        { ...request, operationId: randomUUID() },
        { ...request, campaignId: randomUUID() },
      ]) {
        expect(() => app.prepare(changed)).toThrow();
        expect(h.db.serialize().equals(confirmedBytes)).toBe(true);
      }
      const acceptedProjection = x.project(),
        accepted = x.projectedContent(acceptedProjection);
      if (accepted.formId !== 'NPC-015') throw Error('Actual inventory projection required');
      expect(accepted.content.compatibilityPreparationOrNull).toBeNull();
      expect(acceptedProjection.base.availableActionKeys).toContain('NPC-015::CTA::003');
      const { command, version } = x.finish();
      expect(version.snapshot).toMatchObject({
        derivation: {
          equipmentProof: {
            compatibilityProofOrNull: {
              confirmationId: request.operationId,
              npcUuid: version.npcUuid,
              itemInstanceIds: [suit.itemInstanceId, helmet.itemInstanceId],
              reason: 'Проверена посадка шлема поверх костюма',
            },
          },
        },
        sheet: { equipmentState: { compatibilityRequired: false } },
      });
      const bytes = h.db.serialize(),
        receipt = app.receipt(command.commandId);
      expect(app.prepare(request)).toMatchObject({ replayed: true });
      expect(app.workflow(command)).toMatchObject({ replayed: true, receipt });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure.versions[0]).toEqual(version);
      expect(restored.workflow(command)).toMatchObject({ replayed: true, receipt });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    });

    it('reconfirms a real Skunk skill loss after removing Nate through Back without rewriting paid history', () => {
      const x = actualInventory(),
        { h, app } = x;
      x.edit(entered([]));
      const nate = x.reserveArmor('ITM-ARM-005', null);
      for (const action of [
        'NPC-015::CTA::002',
        'NPC-014::CTA::002',
        'NPC-013::CTA::002',
        'NPC-012::CTA::002',
      ] as const)
        x.next(action);
      x.edit({
        raceCode: entered('UNITED'),
        pureClassOrNull: entered(null),
        anatomyProfileId: entered('STANDARD_HUMANOID'),
      });
      x.next('NPC-011::CTA::001');
      x.edit(
        Object.fromEntries(
          // CORE-001 manual UNITED subtracts ten only from S/D/M/Z; INSIGHT requires C/I15.
          Object.entries({ S: 20, D: 20, M: 20, C: 20, I: 20, Z: 20, W: 2 }).map(([k, v]) => [
            k,
            entered(v),
          ]),
        ),
      );
      x.next('NPC-012::CTA::001');
      const prepare = (
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>['preparation'],
      ) =>
        app.prepare({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-013',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        });
      const reserved = prepare({ kind: 'SYMBIONT_RESERVE', values: json(entered([])) });
      x.setAttempt(reserved.attemptEvent.attempt);
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('Actual symbiont allocation required');
      const skunk = reserved.attemptEvent.childAllocations.find(
        (child) => child.kind === 'SYMBIONT_INSTANCE',
      );
      if (skunk === undefined) throw Error('Actual Skunk identity required');
      const selected = entered([
        {
          symbiontInstanceId: skunk.id,
          input: {
            speciesKey: entered('SKUNK'),
            targetLevel: entered(1),
            learnedNodeRefs: entered(
              fullSource.development.nodes
                .filter((node) => node.speciesKey === 'SKUNK' && node.level <= 1)
                .map((node) => node.nodeRef),
            ),
            binding: entered({ kind: 'NONE' }),
            currentOE: entered(0),
          },
        },
      ]);
      x.edit(selected);
      x.setAttempt(
        prepare({ kind: 'COMPOSITION_CONFIRM', values: json(selected) }).attemptEvent.attempt,
      );
      const immediatelyConfirmed = h.db
        .transaction(() => {
          const state = h.ordinary.compositionPreparation.read(
            x.attempt(),
            h.readContext(x.attempt()),
            h.calendar(),
          );
          const inventory = npcCompositionCurrentSkillInventory(fullSource, state);
          expect(state.ordinaryProof?.statContexts.at(-1)?.contextFactId).toBe(
            state.evidence.current.openOperationId,
          );
          expect(inventory).toEqual({});
          return previewNpcOrdinarySkills(fullSource.ordinaryHumanoid, {
            ...inventory,
            npcUuid: x.attempt().candidateNpcUuid,
            compositionProof: state.compositionProof,
            ordinaryProof: state.ordinaryProof,
            previousSkillProofOrNull: state.skillProofOrNull,
            selections: [{ skillKey: 'INSIGHT', targetBonus: 1, pool: 'START' }],
          });
        })
        .deferred();
      expect(immediatelyConfirmed.pools.START).toMatchObject({ used: 1, available: 0 });
      x.next('NPC-013::CTA::001');
      const insight = entered([
        { skillKey: entered('INSIGHT'), targetBonus: entered(1), pool: entered('START') },
      ]);
      x.edit(insight);
      x.next('NPC-014::CTA::001');
      const first = x.finish(),
        firstBytes = s.canonical(first.version),
        firstProof = s.object(first.version.snapshot['derivation'])['skillProof'];
      expect(first.version.snapshot).toMatchObject({
        sheet: {
          stats: { permanentStats: { C: 20 } },
          input: { inventory: [expect.objectContaining({ itemInstanceId: nate.itemInstanceId })] },
        },
      });
      const beforeSkills = evaluateNpcSkills(fullSource.skills, {
        mode: 'CREATE_V1',
        identityKey: first.version.npcUuid,
        previousConfirmedProofOrNull: null,
        proof: firstProof,
      });
      expect(beforeSkills.pools.START).toMatchObject({ used: 1, available: 0 });
      x.setAttempt(app.workflow(h.openWorkflowRequest(first.version)).attemptEvent.attempt);
      for (const action of [
        'NPC-002::CTA::001',
        'NPC-011::CTA::001',
        'NPC-012::CTA::001',
        'NPC-013::CTA::001',
        'NPC-014::CTA::001',
      ] as const)
        x.next(action);
      x.edit(entered([]));
      const invalidForward = h.action('NPC-015::CTA::001'),
        beforeRefusal = h.db.serialize();
      expect(() => app.navigation(invalidForward)).toThrow();
      expect(h.db.serialize().equals(beforeRefusal)).toBe(true);
      x.next('NPC-015::CTA::002');
      const beforePreview = h.db.serialize();
      const current = x.projectedContent(x.project());
      expect(h.db.serialize().equals(beforePreview)).toBe(true);
      if (current.formId !== 'NPC-014') throw Error('Actual skills projection required');
      expect(current.content.input).toEqual(insight);
      expect(current.content.validationSummary).toContainEqual(expect.stringContaining('CORE-166'));
      expect(current.content.validationSummary).toContainEqual(expect.stringContaining('INSIGHT'));
      expect(current.content.validationSummary).toContainEqual(
        expect.stringContaining('actual 10'),
      );
      expect(current.content.poolUsage).toContainEqual({
        label: 'START',
        value: 'Занято 0 / 1; доступно 1; переполнение 0',
      });
      const stillInvalid = h.action('NPC-014::CTA::001'),
        beforeInvalidSelection = h.db.serialize();
      expect(() => app.navigation(stillInvalid)).toThrow();
      expect(h.db.serialize().equals(beforeInvalidSelection)).toBe(true);
      x.edit(entered([]));
      const confirmation = h.action('NPC-014::CTA::001'),
        confirmed = app.navigation(confirmation);
      if (!('attemptEvent' in confirmed)) throw Error('Actual skill confirmation required');
      x.setAttempt(confirmed.attemptEvent.attempt);
      const confirmedBytes = h.db.serialize();
      expect(app.navigation(confirmation)).toEqual({ ...confirmed, replayed: true });
      expect(h.db.serialize().equals(confirmedBytes)).toBe(true);
      const second = x.finish(),
        secondProof = s.object(second.version.snapshot['derivation'])['skillProof'];
      const afterSkills = evaluateNpcSkills(fullSource.skills, {
        mode: 'APPEND_N_PLUS_ONE',
        identityKey: first.version.npcUuid,
        previousConfirmedProofOrNull: firstProof,
        proof: secondProof,
      });
      expect(afterSkills.pools.START).toMatchObject({ used: 0, available: 1 });
      expect(afterSkills.ledger.learnedSkills).toEqual([]);
      expect(
        afterSkills.proof.contexts
          .flatMap((context) => context.facts)
          .filter((fact) => fact.kind === 'PERMANENT_REQUIREMENT_LOSS'),
      ).toEqual([
        expect.objectContaining({
          kind: 'PERMANENT_REQUIREMENT_LOSS',
          sourceRuleId: 'CORE-166',
          skillKey: 'INSIGHT',
          contextFactId: confirmation.navigationRequestId,
        }),
      ]);
      expect(afterSkills.proof.contexts.slice(0, beforeSkills.proof.contexts.length)).toEqual(
        beforeSkills.proof.contexts,
      );
      expect(second.version.snapshot).toMatchObject({
        sheet: { stats: { permanentStats: { C: 10 } }, input: { inventory: [] } },
      });
      expect(s.canonical(app.read().closure.versions[0])).toBe(firstBytes);
      const bytes = h.db.serialize();
      expect(app.workflow(second.command)).toEqual({ ...second.committed, replayed: true });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure.versions).toEqual([first.version, second.version]);
      expect(restored.navigation(confirmation)).toEqual({ ...confirmed, replayed: true });
      expect(restored.workflow(second.command)).toEqual({ ...second.committed, replayed: true });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    }, 300_000);

    it('retains source-validated sealed Nate through real Back controls before confirming Skunk at C8', () => {
      const x = actualInventory(),
        { h, app } = x;
      x.edit(entered([]));
      const nate = x.reserveArmor('ITM-ARM-005', null);
      x.next('NPC-015::CTA::002');
      x.next('NPC-014::CTA::002');
      x.next('NPC-013::CTA::002');
      x.next('NPC-012::CTA::002');
      x.edit({
        raceCode: entered('UNITED'),
        pureClassOrNull: entered(null),
        anatomyProfileId: entered('STANDARD_HUMANOID'),
      });
      x.next('NPC-011::CTA::001');
      x.edit(
        Object.fromEntries(
          // CORE-001 manual UNITED subtracts ten from S/D/M/Z. C8 remains the condition under test.
          Object.entries({ S: 20, D: 20, M: 20, C: 8, I: 10, Z: 20, W: 2 }).map(([k, v]) => [
            k,
            entered(v),
          ]),
        ),
      );
      x.next('NPC-012::CTA::001');
      const prepare = (
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>['preparation'],
      ) =>
        app.prepare({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-013',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        });
      const reserved = prepare({ kind: 'SYMBIONT_RESERVE', values: json(entered([])) });
      x.setAttempt(reserved.attemptEvent.attempt);
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('Actual symbiont allocation required');
      const skunk = reserved.attemptEvent.childAllocations.find(
        (c) => c.kind === 'SYMBIONT_INSTANCE',
      );
      if (skunk === undefined) throw Error('Actual Skunk identity required');
      const selected = entered([
        {
          symbiontInstanceId: skunk.id,
          input: {
            speciesKey: entered('SKUNK'),
            targetLevel: entered(1),
            learnedNodeRefs: entered(
              fullSource.development.nodes
                .filter((n) => n.speciesKey === 'SKUNK' && n.level <= 1)
                .map((n) => n.nodeRef),
            ),
            binding: entered({ kind: 'NONE' }),
            currentOE: entered(0),
          },
        },
      ]);
      x.edit(selected);
      const confirmed = prepare({ kind: 'COMPOSITION_CONFIRM', values: json(selected) });
      x.setAttempt(confirmed.attemptEvent.attempt);
      expect(confirmed.attemptEvent).toMatchObject({
        ordinaryFact: { statContext: { equippedInventory: [nate] } },
      });
      x.next('NPC-013::CTA::001');
      x.edit(
        entered([
          { skillKey: entered('STEALTH'), targetBonus: entered(1), pool: entered('START') },
        ]),
      );
      x.next('NPC-014::CTA::001');
      const { command, version } = x.finish();
      expect(version.snapshot).toMatchObject({
        format: 'NPC_HUMANOID_V1',
        sheet: {
          stats: { permanentStats: { C: 8 } },
          equipmentState: { equippedHermeticNate: true, equippedStats: { C: 8 } },
          input: { symbionts: [{ symbiontInstanceId: skunk.id, speciesKey: 'SKUNK' }] },
        },
      });
      const bytes = h.db.serialize(),
        receipt = app.receipt(command.commandId);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure.versions[0]).toEqual(version);
      expect(restored.workflow(command)).toMatchObject({ replayed: true, receipt });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    }, 60_000);
  });
}

export function registerNpcRuntimeEffects(
  group:
    | 'ordinary'
    | 'coated-restore'
    | 'coating-removal-v3'
    | 'replacement-preparation'
    | 'pending-carrier'
    | 'stale-dose'
    | 'composite-components'
    | 'custom-food',
) {
  describe('NPC actual runtime effect preparation and publication', () => {
    const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
    const connect = (h: ReturnType<typeof fixture>) =>
      createNpcHostSupport(h.db, fullSource, artCatalog, () => h.calendar()).connect(
        h.scope,
        () => readGmRequestReviewSource(h.db, h.scope, h.validateOwner),
        (checkpoint, closure) => {
          expect(h.db.inTransaction).toBe(true);
          expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
        },
        h.validateOwner,
      );
    function setup(species?: 'WEAVER' | 'TOAD' | 'TAIPAN', currentSource = false) {
      const h = fixture(),
        app = connect(h);
      // Older cases deliberately start with the stored legacy absence shape.
      // Source-era cases must receive readonly anchors from the real CREATE handler.
      const created = currentSource ? app.navigation(h.action('NPC-001::CTA::001')) : null;
      if (created !== null && !('attemptEvent' in created)) throw Error('Actual CREATE required');
      let attempt = created === null ? h.create().attempt : created.attemptEvent.attempt;
      function preparation(
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>['preparation'],
      ): Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }> {
        return {
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-016',
          npcDraftId: attempt.npcDraftId,
          expectedAttemptRevision: attempt.revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        };
      }
      function edit(values: unknown) {
        const request = npcTechnicalRequestValue(json(h.editorRequest(attempt, json(values))));
        if (request.messageType !== 'network.npc-editor.replace')
          throw Error('Actual edit required');
        attempt = app.replace(request).attemptEvent.attempt;
      }
      function next(action: keyof typeof NPC_NAV_TARGETS) {
        const result = app.navigation(h.action(action));
        if (!('attemptEvent' in result)) throw Error('Actual transition required');
        attempt = result.attemptEvent.attempt;
      }
      attempt = app.prepare({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-002',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation: { kind: 'ART_CLEAR' },
      }).attemptEvent.attempt;
      let sourceInstanceId: string | null = null;
      if (species === undefined) {
        attempt = h.fillOrdinary(attempt);
        next('NPC-017::CTA::003');
      } else {
        edit({
          name: entered('Исходное состояние ' + species),
          description: entered(null),
          affiliation: entered('Группа'),
          campaignRole: entered('Союзник'),
          sex: entered('MALE'),
          massKg: entered(75),
          artAssetKeyOrNull: entered(null),
        });
        next('NPC-002::CTA::001');
        edit({
          raceCode: entered('UNITED'),
          pureClassOrNull: entered(null),
          anatomyProfileId: entered('STANDARD_HUMANOID'),
        });
        next('NPC-011::CTA::001');
        edit(
          Object.fromEntries(
            Object.entries({ S: 20, D: 20, M: 20, Z: 20, I: 5, W: 2, C: 20 }).map(
              ([key, value]) => [key, entered(value)],
            ),
          ),
        );
        next('NPC-012::CTA::001');
        edit(entered([]));
        const prepare = (
          preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>['preparation'],
        ) =>
          app.prepare({
            messageType: 'network.npc-preparation.request',
            protocolVersion: 3,
            operationId: randomUUID(),
            campaignId: h.scope.campaignId,
            sourceFormId: 'NPC-013',
            npcDraftId: attempt.npcDraftId,
            expectedAttemptRevision: attempt.revision,
            expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
            preparation,
          });
        const reserved = prepare({ kind: 'SYMBIONT_RESERVE', values: json(entered([])) });
        attempt = reserved.attemptEvent.attempt;
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual symbiont child required');
        const member =
          reserved.attemptEvent.childAllocations.find((row) => row.kind === 'SYMBIONT_INSTANCE') ??
          unavailable();
        sourceInstanceId = member.id;
        const symbionts = entered([
          {
            symbiontInstanceId: member.id,
            input: {
              speciesKey: entered(species),
              targetLevel: entered(5),
              learnedNodeRefs: entered(
                fullSource.development.nodes
                  .filter(
                    (node) =>
                      node.speciesKey === species &&
                      node.level <= 5 &&
                      (species !== 'WEAVER' || node.branchCodeOrNull !== 'EXTERNAL_REGENERATION'),
                  )
                  .map((node) => node.nodeRef),
              ),
              binding: entered({ kind: 'NONE' }),
              currentOE: entered(0),
            },
          },
        ]);
        edit(symbionts);
        attempt = prepare({ kind: 'COMPOSITION_CONFIRM', values: json(symbionts) }).attemptEvent
          .attempt;
        next('NPC-013::CTA::001');
        edit(
          entered([
            { skillKey: entered('STEALTH'), targetBonus: entered(1), pool: entered('START') },
          ]),
        );
        next('NPC-014::CTA::001');
        edit(entered([]));
        next('NPC-015::CTA::001');
        edit({
          input: {
            ...s.object(attempt.values['initialState']),
            currentHP: entered(1),
            effectInstanceIds: entered([]),
            traumaInstanceIds: entered([]),
            woundInstanceIds: entered([]),
            sourceSpecificStateFactIds: entered([]),
            deathConsequenceFactIdOrNull: entered(null),
          },
          currentOeChanges: [],
        });
      }
      function project() {
        const presentation = h.db
          .transaction(() =>
            app.project(
              admissionDecisionStorage.readHistory(h.db, h.scope, h.validateOwner, {
                verifyInitial: unavailable,
                reduce: unavailable,
                buildProposal: unavailable,
                npc: h.readers,
              }),
              ['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'],
            ),
          )
          .deferred();
        return npcGmProjectionValue(
          presentation.base.formId,
          presentation.base.roleFilteredPayload,
          {
            projectionRole: 'gm',
            contextId: h.scope.gmLocalContextId,
            campaignId: h.scope.campaignId,
            ...presentation.revisions,
          },
        );
      }
      function time() {
        next('NPC-016::CTA::004');
        const rules = {
            verifyInitial: unavailable,
            reduce: unavailable,
            buildProposal: unavailable,
            npc: h.readers,
          },
          lobby = readCampaignLobby(h.db, h.scope, h.validateOwner, rules);
        commitCampaignLobbyCommand(
          h.db,
          h.scope,
          {
            kind: 'GM',
            ownerDeviceId: h.scope.ownerDeviceId,
            gmLocalContextId: h.scope.gmLocalContextId,
          },
          {
            workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
            commandId: randomUUID(),
            campaignId: h.scope.campaignId,
            expectedLobbySnapshotRevision: lobby.lobbySnapshotRevision,
            dayNumber: 1,
            hour: 0,
            minute: 7,
          },
          {
            receiptId: randomUUID(),
            committedAt: timestamp,
            sceneIdOrNull: null,
            checkpointIdOrNull: null,
          },
          h.validateOwner,
          rules,
          () => undefined,
        );
        h.ordinaryNav('NET-016::CTA::005');
        expect(h.view()?.formId).toBe('NPC-016');
      }
      function commit() {
        next('NPC-016::CTA::001');
        const command = h.commitWorkflowRequest(attempt);
        app.workflow(command);
        return { command, version: app.read().closure.versions.at(-1) ?? unavailable() };
      }
      return {
        h,
        app,
        preparation,
        project,
        time,
        commit,
        edit,
        next,
        sourceInstanceId,
        attempt: () => attempt,
        setAttempt: (value: NpcAttempt) => {
          attempt = value;
        },
      };
    }
    // Install inside the actual runtime preparation describe after the approved B14 import.
    // Extend setup's species union with TAIPAN; retain its actual CREATE and existing source-backed
    // level-five selection. These tests use actual SQLite/app commands and never replace readers.
    // No execution or timeout claim. Keep the suite's existing default budget.

    function poisonSetup() {
      if (fullSource.poisonSource === null || fullSource.poisonCoatings === null)
        throw Error('Approved B14 poison sources must be imported before these tests');
      const x = setup('TAIPAN', true),
        { h, app } = x;
      function request15(
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' }>['preparation'],
      ): Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' }> {
        return {
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-015',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        };
      }
      function content16() {
        const value = x.project();
        if (value.formId !== 'NPC-016') throw Error('Actual NPC016 required');
        return value.content;
      }
      function setMode(sourceInstanceId: string, reason: string) {
        const offered =
          content16().poisonModePreparations?.find(
            (row) => row.sourceInstanceId === sourceInstanceId,
          ) ?? unavailable();
        expect(offered.canSubmit).toBe(true);
        expect(offered.profileChoices.some((row) => row.value === 'POI-TAIPAN-DEADLY')).toBe(true);
        const request = x.preparation({
          kind: 'POISON_MODE_SET',
          input: {
            capabilityKey: offered.capabilityKey,
            sourceInstanceId,
            poisonProfileId: 'POI-TAIPAN-DEADLY',
            reason,
          },
        });
        const result = app.prepare(request);
        x.setAttempt(result.attemptEvent.attempt);
        if (!('childAllocations' in result.attemptEvent))
          throw Error('Actual mode identity required');
        expect(result.attemptEvent.childAllocations).toHaveLength(1);
        expect(result.attemptEvent.childAllocations[0]).toMatchObject({
          kind: 'EFFECT_INSTANCE',
          sourceKind: 'POISON_MODE',
          sourceInstanceId,
        });
        return { request, result };
      }
      function alive() {
        const offered = content16().lifeStatePreparationOrNull ?? unavailable();
        expect(offered.lifeChoices.some((row) => row.value === 'ALIVE')).toBe(true);
        x.setAttempt(
          app.prepare(
            x.preparation({
              kind: 'LIFE_STATE_SET',
              input: {
                capabilityKey: offered.capabilityKey,
                lifeKind: 'ALIVE',
                remainingMinutesOrNull: null,
                reason: 'Явно подтверждено исходное живое состояние',
              },
            }),
          ).attemptEvent.attempt,
        );
      }
      return { ...x, request15, content16, setMode, alive };
    }

    if (group === 'ordinary') {
      it('keeps a non-last prepared Taipan mode in position across actual source removal, COMMIT, OPEN and replay', () => {
        const x = poisonSetup(),
          { h, app } = x,
          firstSource = x.sourceInstanceId ?? unavailable();
        const first = x.setMode(firstSource, 'Исходный режим первого экземпляра');
        expect(
          h.db.transaction(() => h.calendar()).deferred().currentClock.campaignTimestampOrNull,
        ).toBeNull();
        x.next('NPC-016::CTA::002');
        x.next('NPC-015::CTA::002');
        x.next('NPC-014::CTA::002');
        const request13 = (
          preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>['preparation'],
        ): Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }> => ({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-013',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        });
        const reserved = app.prepare(
          request13({ kind: 'SYMBIONT_RESERVE', values: json(x.attempt().values['symbionts']) }),
        );
        x.setAttempt(reserved.attemptEvent.attempt);
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual second source identity required');
        const second =
          reserved.attemptEvent.childAllocations.find((row) => row.kind === 'SYMBIONT_INSTANCE') ??
          unavailable();
        // The same actual confirmation removes A before adding B. No two live Taipans or invented duel.
        const rows = entered([
          {
            symbiontInstanceId: second.id,
            input: {
              speciesKey: entered('TAIPAN'),
              targetLevel: entered(5),
              currentOE: entered(0),
              binding: entered({ kind: 'NONE' }),
              learnedNodeRefs: entered(
                fullSource.development.nodes
                  .filter((node) => node.speciesKey === 'TAIPAN' && node.level <= 5)
                  .map((node) => node.nodeRef),
              ),
            },
          },
        ]);
        x.edit(rows);
        const confirmation = app.prepare(
          request13({ kind: 'COMPOSITION_CONFIRM', values: json(rows) }),
        );
        x.setAttempt(confirmation.attemptEvent.attempt);
        expect(confirmation.attemptEvent).toMatchObject({
          ordinaryFact: {
            kind: 'CONFIRMATION',
            confirmation: {
              input: {
                removals: [firstSource],
                additions: [{ symbiontInstanceId: second.id }],
              },
            },
          },
        });
        for (const action of [
          'NPC-013::CTA::001',
          'NPC-014::CTA::001',
          'NPC-015::CTA::001',
        ] as const)
          x.next(action);
        const secondMode = x.setMode(second.id, 'Исходный режим второго экземпляра');
        expect(x.content16().input.input.poisonModeFactIds).toEqual(
          entered([first.request.operationId, secondMode.request.operationId]),
        );
        const revised = x.setMode(
          firstSource,
          'Уточнено начальное состояние уже удалённого первого экземпляра',
        );
        const ordered = [revised.request.operationId, secondMode.request.operationId];
        expect(x.content16().input.input.poisonModeFactIds).toEqual(entered(ordered));
        const bytes = h.db.serialize();
        expect(app.prepare(revised.request)).toEqual({
          ...revised.result,
          replayed: true,
        });
        expect(h.db.serialize().equals(bytes)).toBe(true);
        x.alive();
        const { command, version } = x.commit();
        expect(version.snapshot).toMatchObject({
          derivation: {
            initialPoisonProof: {
              commitOperationId: command.commandId,
              modeAssignments: ordered.map((modeOperationId) => ({
                modeOperationId,
                originCommitOperationId: command.commandId,
              })),
            },
          },
        });
        const state = s.object(s.object(version.snapshot['sheet'])['input']);
        const modes = s.object(state['initialState'])['sourceSpecificStates'];
        if (!Array.isArray(modes)) throw Error('Saved source-specific states required');
        expect(
          modes.filter((row) => s.object(row)['kind'] === 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE'),
        ).toMatchObject([
          {
            sourceInstanceId: firstSource,
            currentSourceStatus: 'REMOVED',
            anchor: { modeOperationId: revised.request.operationId },
            pendingSwitchOrNull: null,
          },
          {
            sourceInstanceId: second.id,
            currentSourceStatus: 'ACTIVE',
            anchor: { modeOperationId: secondMode.request.operationId },
            pendingSwitchOrNull: null,
          },
        ]);
        const versionBytes = s.canonical(version),
          open = h.openWorkflowRequest(version),
          opened = app.workflow(open);
        x.setAttempt(opened.attemptEvent.attempt);
        expect(s.object(x.attempt().values['initialState'])['poisonModeFactIds']).toEqual(
          entered(ordered),
        );
        const afterOpen = h.db.serialize();
        expect(app.workflow(open)).toEqual({ ...opened, replayed: true });
        expect(h.db.serialize().equals(afterOpen)).toBe(true);
        const reopened = fixture({
            bytes: afterOpen,
            scope: h.scope,
            profileId: h.profileId,
          }),
          restored = connect(reopened);
        expect(s.canonical(restored.read().closure.versions[0])).toBe(versionBytes);
        expect(restored.prepare(revised.request)).toEqual({
          ...revised.result,
          replayed: true,
        });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(restored.workflow(open)).toEqual({ ...opened, replayed: true });
        expect(reopened.db.serialize().equals(afterOpen)).toBe(true);
        // The existing actual V1 has two saved modes, including a removed source. Reach
        // the real NPC014 confirmation before the inventory owner can inspect this open V2.
        for (const action of [
          'NPC-002::CTA::001',
          'NPC-011::CTA::001',
          'NPC-012::CTA::001',
          'NPC-013::CTA::001',
          'NPC-014::CTA::001',
        ] as const)
          x.next(action);
        const actualFactory = npcPoisonReadersModule.createNpcPoisonReaders;
        const issuedReaders: Array<ReturnType<typeof actualFactory>> = [];
        const factorySpy = vi
          .spyOn(npcPoisonReadersModule, 'createNpcPoisonReaders')
          .mockImplementation((options) => {
            const value = actualFactory(options);
            issuedReaders.push(value);
            return value;
          });
        const ordinary = (() => {
          try {
            return createNpcOrdinaryDomainReaders(h.db, fullSource, catalog, artCatalog);
          } finally {
            factorySpy.mockRestore();
          }
        })();
        const issued = issuedReaders[0] ?? unavailable();
        const contextReader = issued.context;
        const historyReader = npcGmSourceModule.readNpcInventoryHistoryEvidenceInTransaction;
        const evidenceReader = npcGmSourceModule.readNpcVersionDerivationEvidenceInTransaction;
        const fullDecoder = npcHumanoidSheetModule.readNpcHumanoidSnapshot;
        const calendar = h.db.transaction(() => h.calendar()).deferred();
        const stableBytes = h.db.serialize();
        const savedSnapshot = s.canonical(version.snapshot);
        function stack() {
          const limit = Error.stackTraceLimit;
          try {
            Error.stackTraceLimit = Math.max(limit, 100);
            return new Error().stack ?? '';
          } finally {
            Error.stackTraceLimit = limit;
          }
        }
        const graphPath = (text: string) =>
          /\bat snapshotPoisonState \([^\r\n]*\)\r?\n\s*at pendingInventoryGraph \(/.test(text) &&
          /\bat (?:Object\.)?inventoryPreviewForAttempt \(/.test(text);
        let anchored = false;
        let completedPoison: Parameters<typeof fullDecoder>[9] = null;
        let completedModeCount: number;
        let freshSql = 0;
        let repeatedContext = 0;
        let mutations = 0;
        let changed: boolean;
        let inject = false;
        const historySpy = vi
          .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
          .mockImplementation((...args) => {
            const actual = historyReader(...args);
            if (
              args[0] === h.db &&
              args[2] === version.npcUuid &&
              args[3] === 1 &&
              /\bat inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at (?:Object\.)?inventoryPreviewForAttempt \(/.test(
                stack(),
              )
            )
              anchored = true;
            return actual;
          });
        const decoderSpy = vi
          .spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot')
          .mockImplementation((...args) => {
            const actual = fullDecoder(...args);
            if (anchored && s.canonical(args[1]) === savedSnapshot) {
              completedPoison = args[9];
              completedModeCount = completedPoison?.modes.length ?? 0;
            }
            return actual;
          });
        const contextSpy = vi.spyOn(issued, 'context').mockImplementation((...args) => {
          if (
            anchored &&
            completedPoison != null &&
            args[2]?.operationId === version.operationId &&
            graphPath(stack())
          )
            repeatedContext++;
          return contextReader(...args);
        });
        const evidenceSpy = vi
          .spyOn(npcGmSourceModule, 'readNpcVersionDerivationEvidenceInTransaction')
          .mockImplementation((...args) => {
            const actual = evidenceReader(...args);
            if (
              anchored &&
              completedPoison != null &&
              args[0] === h.db &&
              args[1].commitOperationId === version.operationId &&
              graphPath(stack())
            ) {
              freshSql++;
              if (inject && mutations === 0 && completedPoison.modes.length === 2) {
                mutations++;
                changed = Reflect.set(completedPoison.modes, '0', completedPoison.modes[1]);
              }
            }
            return actual;
          });
        try {
          for (const fault of [false, true, false]) {
            anchored = false;
            completedPoison = null;
            completedModeCount = 0;
            freshSql = 0;
            repeatedContext = 0;
            mutations = 0;
            changed = false;
            inject = fault;
            const read = () =>
              h.db
                .transaction(() => ordinary.inventoryPreviewForAttempt(x.attempt(), calendar))
                .deferred();
            if (fault) expect(read).toThrow('network application storage: SOURCE_CHANGED');
            else expect(read()).toEqual({ items: [] });
            expect(anchored).toBe(true);
            expect(completedPoison).not.toBeNull();
            expect(completedModeCount).toBe(2);
            expect(freshSql).toBeGreaterThan(0);
            // This is the exact saved V1 graph path; other current/historical contexts stay real.
            expect(repeatedContext).toBe(0);
            expect(mutations).toBe(fault ? 1 : 0);
            expect(changed).toBe(fault);
            expect(h.db.inTransaction).toBe(false);
            expect(h.db.serialize().equals(stableBytes)).toBe(true);
          }
        } finally {
          evidenceSpy.mockRestore();
          contextSpy.mockRestore();
          decoderSpy.mockRestore();
          historySpy.mockRestore();
        }
        // Exercise the direct source-basis owner separately from inventoryPreviewForAttempt.
        // Each failed transaction removes its spies; the last call proves fresh recovery.
        for (const boundary of [
          'SOURCE_CONTEXT',
          'CONFIRMATION_EDITOR',
          'PREPARATION_READ',
          null,
        ] as const) {
          const fault = boundary !== null;
          let inPreparationModes = false;
          let preparationModeCalls = 0;
          let preparationSql = 0;
          let sourceHistory = false;
          let savedDecodes = 0;
          let savedModes = 0;
          let savedSql = 0;
          let sourceContextRepeats = 0;
          let confirmationSql = 0;
          let confirmationContextRepeats = 0;
          let savedContextCalls = 0;
          let injected = 0;
          const changedRows: number[] = [];
          const changeVersionAndRestore = () => {
            const row = s.object(
              h.db
                .prepare(
                  'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=1',
                )
                .get(h.scope.campaignId, version.npcUuid),
            );
            const hash = s.hash(row['record_sha256']);
            const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
            const update = h.db.prepare(
              'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
            );
            changedRows.push(update.run(changed, h.scope.campaignId, version.npcUuid).changes);
            changedRows.push(update.run(hash, h.scope.campaignId, version.npcUuid).changes);
            injected++;
          };
          const preparationRead = (trace: string) =>
            /\bat initialStateSourceBasis \([^\r\n]*\)\r?\n\s*at (?:Object\.)?read \([^\r\n]*npc-domain-readers\.ts:[^\r\n]*\)\r?\n\s*at read \([^\r\n]*npc-poison-preparation\.ts:/.test(
              trace,
            );
          const directGraph = (trace: string) => {
            const frames = [...trace.matchAll(/\bat (?:Object\.)?(\w+) \(/g)].map(
              (match) => match[1],
            );
            const owner = [
              'snapshotPoisonState',
              'pendingInventoryGraph',
              'snapshotChildGraph',
              'contextAt',
              'initialStateSourceBasis',
              'read',
              'read',
            ];
            return (
              preparationRead(trace) &&
              frames.some((_, index) =>
                owner.every((name, offset) => frames[index + offset] === name),
              )
            );
          };
          const confirmationGraph = (trace: string) => {
            const frames = [...trace.matchAll(/\bat (?:Object\.)?(\w+) \(/g)].map(
              (match) => match[1],
            );
            const owner = [
              'snapshotPoisonState',
              'pendingInventoryGraph',
              'snapshotChildGraph',
              'contextAt',
              'editorAt',
              'initialStateSourceBasis',
              'read',
              'read',
            ];
            return (
              preparationRead(trace) &&
              frames.some((_, index) =>
                owner.every((name, offset) => frames[index + offset] === name),
              )
            );
          };
          const sourceHistorySpy = vi
            .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
            .mockImplementation((...args) => {
              const actual = historyReader(...args);
              if (
                args[0] === h.db &&
                s.same(args[1], h.scope) &&
                args[2] === version.npcUuid &&
                args[3] === 1 &&
                /\bat inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at initialStateSourceBasis \(/.test(
                  stack(),
                ) &&
                preparationRead(stack())
              )
                sourceHistory = true;
              if (
                sourceHistory &&
                savedDecodes > 0 &&
                inPreparationModes &&
                args[0] === h.db &&
                s.same(args[1], h.scope) &&
                args[2] === version.npcUuid &&
                args[3] === 1
              ) {
                preparationSql++;
                if (boundary === 'PREPARATION_READ' && injected === 0) changeVersionAndRestore();
              }
              return actual;
            });
          const sourceDecoderSpy = vi
            .spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot')
            .mockImplementation((...args) => {
              const actual = fullDecoder(...args);
              if (sourceHistory && s.canonical(args[1]) === savedSnapshot) {
                savedDecodes++;
                savedModes = args[9]?.modes.length ?? 0;
              }
              return actual;
            });
          const sourceContextSpy = vi.spyOn(issued, 'context').mockImplementation((...args) => {
            if (
              sourceHistory &&
              savedDecodes > 0 &&
              args[2]?.operationId === version.operationId &&
              directGraph(stack())
            )
              sourceContextRepeats++;
            if (
              sourceHistory &&
              savedDecodes > 0 &&
              args[2]?.operationId === version.operationId &&
              confirmationGraph(stack())
            )
              confirmationContextRepeats++;
            const actual = contextReader(...args);
            if (sourceHistory && args[2]?.operationId === version.operationId) savedContextCalls++;
            return actual;
          });
          const sourceEvidenceSpy = vi
            .spyOn(npcGmSourceModule, 'readNpcVersionDerivationEvidenceInTransaction')
            .mockImplementation((...args) => {
              const actual = evidenceReader(...args);
              if (
                sourceHistory &&
                savedDecodes > 0 &&
                args[0] === h.db &&
                args[1].commitOperationId === version.operationId &&
                directGraph(stack())
              ) {
                savedSql++;
                if (boundary === 'SOURCE_CONTEXT' && injected === 0) changeVersionAndRestore();
              }
              if (
                sourceHistory &&
                savedDecodes > 0 &&
                args[0] === h.db &&
                args[1].commitOperationId === version.operationId &&
                confirmationGraph(stack())
              ) {
                confirmationSql++;
                if (boundary === 'CONFIRMATION_EDITOR' && injected === 0) changeVersionAndRestore();
              }
              return actual;
            });
          const actualModes = issued.modes;
          const preparationModesSpy = vi.spyOn(issued, 'modes').mockImplementation((...args) => {
            const parent = inPreparationModes;
            if (args[0] === x.attempt() && args[1] === calendar) {
              preparationModeCalls++;
              inPreparationModes = true;
            }
            try {
              return actualModes.apply(issued, args);
            } finally {
              inPreparationModes = parent;
            }
          });
          try {
            let refusal: unknown;
            let result: ReturnType<typeof ordinary.poisonPreparation.inspect> | undefined;
            try {
              result = h.db
                .transaction(() => ordinary.poisonPreparation.inspect(x.attempt(), calendar))
                .deferred();
            } catch (error) {
              refusal = error;
            }
            expect(sourceHistory).toBe(true);
            expect(savedDecodes).toBeGreaterThan(0);
            expect(savedModes).toBe(2);
            expect(savedSql).toBeGreaterThan(0);
            expect(sourceContextRepeats).toBe(0);
            expect(savedContextCalls).toBeGreaterThan(0);
            expect(confirmationContextRepeats).toBe(0);
            if (boundary === 'SOURCE_CONTEXT') expect(confirmationSql).toBe(0);
            else expect(confirmationSql).toBeGreaterThan(0);
            if (boundary === 'SOURCE_CONTEXT' || boundary === 'CONFIRMATION_EDITOR') {
              expect(preparationModeCalls).toBe(0);
              expect(preparationSql).toBe(0);
            } else {
              expect(preparationModeCalls).toBeGreaterThan(0);
              expect(preparationSql).toBeGreaterThan(0);
            }
            expect(injected).toBe(fault ? 1 : 0);
            expect(changedRows).toEqual(fault ? [1, 1] : []);
            if (fault) {
              expect(refusal).toBeInstanceOf(NetworkApplicationStoreError);
              expect(refusal).toMatchObject({ code: 'SOURCE_CHANGED' });
              expect(result).toBeUndefined();
            } else {
              expect(refusal).toBeUndefined();
              expect(
                result?.modeStates.map(({ sourceInstanceId, modeFactId }) => ({
                  sourceInstanceId,
                  modeFactId,
                })),
              ).toEqual([
                { sourceInstanceId: firstSource, modeFactId: revised.request.operationId },
                { sourceInstanceId: second.id, modeFactId: secondMode.request.operationId },
              ]);
              expect(result?.coatingStates).toEqual([]);
            }
            expect(h.db.inTransaction).toBe(false);
            expect(h.db.serialize().equals(stableBytes)).toBe(true);
          } finally {
            preparationModesSpy.mockRestore();
            sourceEvidenceSpy.mockRestore();
            sourceContextSpy.mockRestore();
            sourceDecoderSpy.mockRestore();
            sourceHistorySpy.mockRestore();
          }
        }
        expect(s.canonical(app.read().closure.versions[0])).toBe(versionBytes);
      }, 180_000);

      it('publishes one actual prepared dose with its original mode and exact physical identity through replay and SQLite reopen', () => {
        const x = poisonSetup(),
          { h, app } = x,
          sourceId = x.sourceInstanceId ?? unavailable();
        const selectedMode = x.setMode(sourceId, 'Явно выбран смертельный исходный яд');
        expect(
          h.db.transaction(() => h.calendar()).deferred().currentClock.campaignTimestampOrNull,
        ).toBeNull();
        x.time();
        x.next('NPC-016::CTA::002');
        const reserved = app.prepare(
          x.request15({
            kind: 'ITEM_RESERVE',
            values: json(x.attempt().values['inventory']),
          }),
        );
        x.setAttempt(reserved.attemptEvent.attempt);
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual individual projectile required');
        const item =
          reserved.attemptEvent.childAllocations.find((row) => row.kind === 'ITEM') ??
          unavailable();
        const { itemInstanceId, profile, ...input } = {
          ...npcKensiRequest(item.id),
          itemTypeId: 'RES-AMM-001',
          currentAmmo: null,
        };
        x.edit(
          entered([
            {
              itemInstanceId,
              profile: entered(profile),
              input: Object.fromEntries(
                Object.entries(input).map(([key, value]) => [key, entered(value)]),
              ),
            },
          ]),
        );
        const presentation = x.project();
        if (presentation.formId !== 'NPC-015') throw Error('Actual coating controls required');
        const offered =
          presentation.content.poisonCoatingPreparations?.find(
            (row) => row.sourceInstanceId === sourceId && row.targetItemInstanceId === item.id,
          ) ?? unavailable();
        expect(offered.canSubmit).toBe(true);
        expect(offered.replacesCoatingIdOrNull).toBeNull();
        const request = x.request15({
          kind: 'POISON_COATING_PREPARE',
          input: {
            capabilityKey: offered.capabilityKey,
            sourceInstanceId: sourceId,
            targetItemInstanceId: item.id,
            surfaceConfirmed: true,
            replacesCoatingIdOrNull: null,
            replaceConfirmed: false,
            reason: 'Формально подготовленная отдельная стрела без доставки яда',
          },
        });
        const before = h.db.serialize();
        expect(() =>
          app.prepare({
            ...request,
            preparation: {
              kind: 'POISON_COATING_PREPARE',
              input: {
                capabilityKey: offered.capabilityKey,
                sourceInstanceId: sourceId,
                targetItemInstanceId: randomUUID(),
                surfaceConfirmed: true,
                replacesCoatingIdOrNull: null,
                replaceConfirmed: false,
                reason: 'Чужой носитель',
              },
            },
          }),
        ).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
        // Exercise the real store parser after the actual source-backed producer, then its
        // request-specific count/target/source guards. Failed callbacks must not reserve a dose.
        const actualStorePrepared = npcLibraryStoreModule.saveNpcAttemptPreparedWithEvidence;
        for (const fault of ['missing child', 'foreign target', 'foreign source'] as const) {
          let factories = 0;
          const storeSpy = vi
            .spyOn(npcLibraryStoreModule, 'saveNpcAttemptPreparedWithEvidence')
            .mockImplementation((db, boundary, source, prepare, readers, integration) =>
              actualStorePrepared(
                db,
                boundary,
                source,
                (context) => {
                  factories++;
                  const candidate = prepare(context);
                  expect(candidate.childAllocations).toHaveLength(1);
                  const allocation = candidate.childAllocations?.[0];
                  if (allocation?.kind !== 'COATING_INSTANCE')
                    throw Error('Actual prepared coating child required');
                  expect(allocation).toMatchObject({
                    itemInstanceId: item.id,
                    sourceInstanceId: sourceId,
                  });
                  return {
                    ...candidate,
                    childAllocations:
                      fault === 'missing child'
                        ? []
                        : [
                            fault === 'foreign target'
                              ? { ...allocation, itemInstanceId: randomUUID() }
                              : { ...allocation, sourceInstanceId: randomUUID() },
                          ],
                  };
                },
                readers,
                integration,
              ),
            );
          try {
            expect(() => app.prepare(request)).toThrow(
              'network application storage: INVALID_INPUT',
            );
            expect(factories).toBe(1);
            expect(h.db.inTransaction).toBe(false);
            expect(h.db.serialize().equals(before)).toBe(true);
          } finally {
            storeSpy.mockRestore();
          }
        }
        const prepared = app.prepare(request);
        x.setAttempt(prepared.attemptEvent.attempt);
        if (!('childAllocations' in prepared.attemptEvent))
          throw Error('Actual coating allocation required');
        expect(prepared.attemptEvent.childAllocations).toHaveLength(1);
        const dose = prepared.attemptEvent.childAllocations[0] ?? unavailable();
        expect(dose).toMatchObject({
          kind: 'COATING_INSTANCE',
          itemInstanceId: item.id,
          sourceInstanceId: sourceId,
        });
        const preparedBytes = h.db.serialize();
        expect(app.prepare(request)).toEqual({ ...prepared, replayed: true });
        expect(h.db.serialize().equals(preparedBytes)).toBe(true);
        // A generic edit cannot erase the selected dose, even with otherwise identical physical fields.
        expect(() =>
          x.edit(
            entered([
              {
                itemInstanceId,
                profile: entered(profile),
                input: Object.fromEntries(
                  Object.entries(input).map(([key, value]) => [key, entered(value)]),
                ),
              },
            ]),
          ),
        ).toThrow();
        expect(h.db.serialize().equals(preparedBytes)).toBe(true);
        x.next('NPC-015::CTA::001');
        x.alive();
        x.next('NPC-016::CTA::001');
        const review = x.project();
        if (review.formId !== 'NPC-017' || review.content.previewOrNull === null)
          throw Error('Actual complete final preview required');
        const inventoryText =
          review.content.previewOrNull.sections.INVENTORY.find((row) => row.label === 'Предметы')
            ?.value ?? '';
        expect(inventoryText).toContain('Подготовленная доза:');
        expect(inventoryText).toContain('L при подготовке: 5');
        expect(inventoryText).toContain('L для доставки: 5');
        expect(inventoryText).toContain('половина периодического урона');
        expect(inventoryText).toContain('Подготовлено, ещё не сохранено');
        const command = h.commitWorkflowRequest(x.attempt());
        app.workflow(command);
        const version = app.read().closure.versions.at(-1) ?? unavailable();
        expect(version.snapshot).toMatchObject({
          derivation: {
            initialPoisonProof: {
              commitOperationId: command.commandId,
              modeAssignments: [
                {
                  modeOperationId: selectedMode.request.operationId,
                  originCommitOperationId: command.commandId,
                },
              ],
            },
            inventoryProof: {
              coatingOrigins: [
                {
                  coatingInstanceId: dose.id,
                  originCommitOperationId: command.commandId,
                },
              ],
            },
          },
          sheet: {
            requiresCampaignTime: true,
            itemProfiles: [
              {
                item: {
                  itemInstanceId: item.id,
                  quantity: 1,
                  activeCoatings: [
                    {
                      coatingInstanceId: dose.id,
                      sourceInstanceId: sourceId,
                      modeOperationId: selectedMode.request.operationId,
                      preparationOperationId: request.operationId,
                      payload: {
                        poisonProfileId: 'POI-TAIPAN-DEADLY',
                        deliveryKind: 'COATING',
                        futureDeliveryRule: 'HALF_PERIODIC_DAMAGE',
                      },
                      appliedAt: { campaignTimestamp: 7 },
                      expiry: null,
                      consumptionState: 'ACTIVE',
                      origin: {
                        kind: 'COMMITTED',
                        originCommitOperationId: command.commandId,
                      },
                    },
                  ],
                },
              },
            ],
            input: { symbionts: [{ symbiontInstanceId: sourceId, currentOE: 0 }] },
          },
        });
        // The saved V1 owns a real coating, not an empty poison context. A graph reader may
        // share its completed context only while every mutable child survives the fresh SQL read.
        const inspectSaved = () =>
          h.db
            .transaction(() => h.ordinary.inspectStoredSnapshot(version.snapshot, h.calendar()))
            .deferred();
        const checkedSaved = inspectSaved();
        expect(checkedSaved.snapshot).toEqual(version.snapshot);
        expect(checkedSaved.publishedChildGraph.coatings).toEqual([
          {
            coatingInstanceId: dose.id,
            itemInstanceId: item.id,
            sourceInstanceId: sourceId,
            originCommitOperationId: command.commandId,
          },
        ]);
        const savedBytes = h.db.serialize();
        const actualSnapshot = npcHumanoidSheetModule.readNpcHumanoidSnapshot;
        const actualEvidence = npcGmSourceModule.readNpcVersionDerivationEvidenceInTransaction;
        let poisonChild: object | undefined;
        let freshReads = 0;
        let mutations = 0;
        let changed = false;
        const decoderSpy = vi
          .spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot')
          .mockImplementation((...args) => {
            const value = actualSnapshot(...args);
            if (s.canonical(args[1]) === s.canonical(version.snapshot)) {
              const child = args[9]?.coatingContext;
              if (child != null) poisonChild = child;
            }
            return value;
          });
        const evidenceSpy = vi
          .spyOn(npcGmSourceModule, 'readNpcVersionDerivationEvidenceInTransaction')
          .mockImplementation((...args) => {
            const actual = actualEvidence(...args);
            if (poisonChild === undefined || args[1].commitOperationId !== command.commandId)
              return actual;
            const stackLimit = Error.stackTraceLimit;
            let stack: string;
            try {
              Error.stackTraceLimit = Math.max(stackLimit, 100);
              stack = new Error().stack ?? '';
            } finally {
              Error.stackTraceLimit = stackLimit;
            }
            if (
              /at snapshotPoisonState[^\n]*\n\s*at pendingInventoryGraph/.test(stack) &&
              mutations === 0
            ) {
              freshReads++;
              mutations++;
              changed = Reflect.set(
                poisonChild,
                'campaignTimestamp',
                Number(Reflect.get(poisonChild, 'campaignTimestamp')) + 1,
              );
            }
            return actual;
          });
        try {
          expect(inspectSaved).toThrow('network application storage: SOURCE_CHANGED');
          expect(poisonChild).toBeDefined();
          expect(freshReads).toBe(1);
          expect(mutations).toBe(1);
          expect(changed).toBe(true);
          expect(h.db.inTransaction).toBe(false);
          expect(h.db.serialize().equals(savedBytes)).toBe(true);
        } finally {
          evidenceSpy.mockRestore();
          decoderSpy.mockRestore();
        }
        expect(inspectSaved()).toEqual(checkedSaved);
        expect(h.db.serialize().equals(savedBytes)).toBe(true);
        // Saved validation owns its actual committed attempt and persisted child graph. Observe
        // that path separately from inspectStoredSnapshot, using the real host read above SQLite.
        {
          const factory = npcPoisonReadersModule.createNpcPoisonReaders;
          const domainFactory = npcDomainReadersModule.createNpcOrdinaryDomainReaders;
          let validationRefusal: unknown;
          const issuedReaders: Array<ReturnType<typeof factory>> = [];
          const factorySpy = vi
            .spyOn(npcPoisonReadersModule, 'createNpcPoisonReaders')
            .mockImplementation((options) => {
              const actual = factory(options);
              issuedReaders.push(actual);
              return actual;
            });
          const domainFactorySpy = vi
            .spyOn(npcDomainReadersModule, 'createNpcOrdinaryDomainReaders')
            .mockImplementation((...args) => {
              const actual = domainFactory(...args);
              // Store guarded() normalizes a thrown validator error to INVALID_INPUT.
              // Observe and rethrow the actual cause before that public boundary.
              return {
                ...actual,
                validateVersion(...values: Parameters<typeof actual.validateVersion>) {
                  try {
                    return actual.validateVersion(...values);
                  } catch (error) {
                    validationRefusal = error;
                    throw error;
                  }
                },
              };
            });
          const observedApp = (() => {
            try {
              return connect(h);
            } finally {
              domainFactorySpy.mockRestore();
              factorySpy.mockRestore();
            }
          })();
          expect(issuedReaders).toHaveLength(1);
          const issued = issuedReaders[0] ?? unavailable();
          const contextReader = issued.context;
          const builder = npcHumanoidSheetModule.buildNpcHumanoidSnapshot;
          const evidenceReader = npcGmSourceModule.readNpcVersionDerivationEvidenceInTransaction;
          const stableBytes = h.db.serialize();
          function stack() {
            const limit = Error.stackTraceLimit;
            try {
              Error.stackTraceLimit = Math.max(limit, 100);
              return new Error().stack ?? '';
            } finally {
              Error.stackTraceLimit = limit;
            }
          }
          const resolvedPath = (text: string) =>
            /\bat poisonState \([^\r\n]*\)\r?\n\s*at resolve \([^\r\n]*\)\r?\n\s*at (?:Object\.)?validateVersion \(/.test(
              text,
            );
          const builderPath = (text: string) =>
            /\bat derive \([^\r\n]*\)\r?\n\s*at resolve \([^\r\n]*\)\r?\n\s*at (?:Object\.)?validateVersion \(/.test(
              text,
            );
          const graphPath = (text: string) =>
            /\bat snapshotPoisonState \([^\r\n]*\)\r?\n\s*at pendingInventoryGraph \([^\r\n]*\)\r?\n\s*at snapshotChildGraph \([^\r\n]*\)\r?\n\s*at (?:Object\.)?validateVersion \(/.test(
              text,
            );
          for (const fault of ['BUILDER', 'GRAPH_SQL', null] as const) {
            validationRefusal = undefined;
            let resolvedChild: object | undefined;
            let poisonChild: object | undefined;
            let originalMinute: unknown;
            let resolvedContexts = 0;
            let completedBuilders = 0;
            let repeatedContext = 0;
            let freshSql = 0;
            let mutations = 0;
            let changed = false;
            let sameContext = false;
            let observedDose: string | undefined;
            function mutate(child: object) {
              originalMinute = Reflect.get(child, 'campaignTimestamp');
              mutations++;
              changed = Reflect.set(child, 'campaignTimestamp', Number(originalMinute) + 1);
              changed &&= !Object.is(Reflect.get(child, 'campaignTimestamp'), originalMinute);
            }
            const contextSpy = vi.spyOn(issued, 'context').mockImplementation((...args) => {
              const actual = contextReader(...args);
              if (actual !== null && args[2]?.operationId === version.operationId) {
                const trace = stack();
                if (resolvedPath(trace)) {
                  resolvedContexts++;
                  // Resolve builds the owning current snapshot before reconstructing historical V1.
                  // That later context can share its operation ID but is not the graph witness.
                  if (resolvedContexts === 1)
                    resolvedChild = actual.context.coatingContext ?? undefined;
                }
                if (graphPath(trace)) repeatedContext++;
              }
              return actual;
            });
            const builderSpy = vi
              .spyOn(npcHumanoidSheetModule, 'buildNpcHumanoidSnapshot')
              .mockImplementation((...args) => {
                const actual = builder(...args);
                const proof = s.object(args[1])['initialPoisonProof'];
                if (
                  proof !== undefined &&
                  s.object(proof)['commitOperationId'] === version.operationId &&
                  builderPath(stack())
                ) {
                  completedBuilders++;
                  const child = args[9]?.coatingContext;
                  if (completedBuilders === 1 && child != null) {
                    poisonChild = child;
                    sameContext = child === resolvedChild;
                    const contribution = child.contributions[0];
                    if (contribution !== undefined)
                      observedDose = readNpcPoisonCoatingContribution(child.catalog, contribution)
                        .coating.coatingInstanceId;
                    if (fault === 'BUILDER' && mutations === 0) mutate(child);
                  }
                }
                return actual;
              });
            const evidenceSpy = vi
              .spyOn(npcGmSourceModule, 'readNpcVersionDerivationEvidenceInTransaction')
              .mockImplementation((...args) => {
                const actual = evidenceReader(...args);
                if (
                  poisonChild !== undefined &&
                  args[0] === h.db &&
                  args[1].commitOperationId === version.operationId &&
                  graphPath(stack())
                ) {
                  freshSql++;
                  if (fault === 'GRAPH_SQL' && mutations === 0) mutate(poisonChild);
                }
                return actual;
              });
            try {
              if (fault === null) {
                expect(observedApp.read().closure.versions).toEqual([version]);
                expect(validationRefusal).toBeUndefined();
              } else {
                let refusal: unknown;
                try {
                  observedApp.read();
                } catch (error) {
                  refusal = error;
                }
                expect(refusal).toBeInstanceOf(NetworkApplicationStoreError);
                expect((refusal as NetworkApplicationStoreError).code).toBe('INVALID_INPUT');
                expect(validationRefusal).toBeInstanceOf(NetworkApplicationStoreError);
                expect((validationRefusal as NetworkApplicationStoreError).code).toBe(
                  'SOURCE_CHANGED',
                );
              }
              expect(resolvedContexts).toBeGreaterThan(0);
              expect(completedBuilders).toBeGreaterThan(0);
              expect(sameContext).toBe(true);
              expect(poisonChild).toBe(resolvedChild);
              expect(observedDose).toBe(dose.id);
              if (fault === 'BUILDER') expect(freshSql).toBe(0);
              else expect(freshSql).toBeGreaterThan(0);
              // The actual resolved context was observed; its direct graph must still cross SQL
              // without running that context again. Other historical readers remain delegated.
              expect(repeatedContext).toBe(0);
              expect(mutations).toBe(fault === null ? 0 : 1);
              expect(changed).toBe(fault !== null);
              expect(h.db.inTransaction).toBe(false);
              expect(h.db.serialize().equals(stableBytes)).toBe(true);
            } finally {
              evidenceSpy.mockRestore();
              builderSpy.mockRestore();
              contextSpy.mockRestore();
              if (poisonChild !== undefined && mutations !== 0)
                Reflect.set(poisonChild, 'campaignTimestamp', originalMinute);
            }
          }
        }
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(restored.prepare(request)).toEqual({ ...prepared, replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      }, 180_000);
    }

    // Install after 187-owning-poison.pending-tests.txt inside the same actual runtime describe,
    // only after approved B14 import. No runtime execution or timeout increase is implied.
    // The remove-row/re-add guard case deliberately asserts atomic readonly refusal; until run,
    // its pre-insert enforcement remains an unresolved integration verification obligation.

    function preparedIndividualDose() {
      const x = poisonSetup(),
        { h, app } = x,
        sourceId = x.sourceInstanceId ?? unavailable();
      const mode = x.setMode(sourceId, 'Подтверждён исходный вид яда');
      x.time();
      x.next('NPC-016::CTA::002');
      const reserved = app.prepare(
        x.request15({ kind: 'ITEM_RESERVE', values: json(x.attempt().values['inventory']) }),
      );
      x.setAttempt(reserved.attemptEvent.attempt);
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('Actual item allocation required');
      const item =
        reserved.attemptEvent.childAllocations.find((row) => row.kind === 'ITEM') ?? unavailable();
      const { itemInstanceId, profile, ...input } = {
        ...npcKensiRequest(item.id),
        itemTypeId: 'RES-AMM-001',
        currentAmmo: null,
      };
      const uncoatedRow = {
        itemInstanceId,
        profile: entered(profile),
        input: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [key, entered(value)]),
        ),
      };
      x.edit(entered([uncoatedRow]));
      const projection = x.project();
      if (projection.formId !== 'NPC-015') throw Error('Actual NPC015 required');
      const offered =
        projection.content.poisonCoatingPreparations?.find(
          (row) => row.sourceInstanceId === sourceId && row.targetItemInstanceId === item.id,
        ) ?? unavailable();
      const request = x.request15({
        kind: 'POISON_COATING_PREPARE',
        input: {
          capabilityKey: offered.capabilityKey,
          sourceInstanceId: sourceId,
          targetItemInstanceId: item.id,
          surfaceConfirmed: true,
          replacesCoatingIdOrNull: null,
          replaceConfirmed: false,
          reason: 'Реальная исходная подготовка отдельной стрелы',
        },
      });
      const prepared = app.prepare(request);
      x.setAttempt(prepared.attemptEvent.attempt);
      if (!('childAllocations' in prepared.attemptEvent))
        throw Error('Actual coating allocation required');
      const dose =
        prepared.attemptEvent.childAllocations.find((row) => row.kind === 'COATING_INSTANCE') ??
        unavailable();
      return { x, h, app, sourceId, mode, item, dose, request, prepared, uncoatedRow };
    }
    if (group === 'ordinary') {
      it('refuses erasing an unpublished dose by hiding and generically reintroducing its physical row', () => {
        const p = preparedIndividualDose(),
          { x, h, app } = p;
        x.edit(entered([]));
        const before = h.db.serialize();
        expect(() => x.edit(entered([p.uncoatedRow]))).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
        expect(s.object(x.attempt().values['inventory'])['value']).toEqual([]);
        expect(
          app.read().closure.children.filter((row) => row.allocation.kind === 'COATING_INSTANCE'),
        ).toMatchObject([
          {
            allocation: {
              kind: 'COATING_INSTANCE',
              id: p.dose.id,
              itemInstanceId: p.item.id,
              sourceInstanceId: p.sourceId,
            },
            originOperationId: p.request.operationId,
          },
        ]);
        expect(app.prepare(p.request)).toEqual({ ...p.prepared, replayed: true });
        expect(h.db.serialize().equals(before)).toBe(true);
      });
    }

    function publishedIndividualDose(version: NpcVersion, itemId: string) {
      const profiles = s.object(version.snapshot['sheet'])['itemProfiles'];
      if (!Array.isArray(profiles)) throw Error('Actual saved physical profiles required');
      const matches = profiles.filter(
        (row) => s.object(s.object(row)['item'])['itemInstanceId'] === itemId,
      );
      expect(matches).toHaveLength(1);
      const physical = s.object(s.object(matches[0])['item']);
      const doses = physical['activeCoatings'];
      if (!Array.isArray(doses)) throw Error('Actual saved coating array required');
      return { physical, doses };
    }

    if (group === 'ordinary') {
      it('keeps an actually prepared dose after source removal before its first SAVE using the last proven source', () => {
        const p = preparedIndividualDose(),
          { x, h, app } = p;
        x.next('NPC-015::CTA::002');
        x.next('NPC-014::CTA::002');
        x.edit(entered([]));
        const removal: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }> = {
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-013',
          npcDraftId: x.attempt().npcDraftId,
          expectedAttemptRevision: x.attempt().revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation: { kind: 'COMPOSITION_CONFIRM', values: json(entered([])) },
        };
        const removed = app.prepare(removal);
        x.setAttempt(removed.attemptEvent.attempt);
        expect(removed.attemptEvent).toMatchObject({
          ordinaryFact: {
            kind: 'CONFIRMATION',
            confirmation: { input: { additions: [], removals: [p.sourceId] } },
          },
        });
        for (const action of ['NPC-013::CTA::001', 'NPC-014::CTA::001'] as const) x.next(action);
        const current = x.project();
        if (current.formId !== 'NPC-015')
          throw Error('Actual retained coating presentation required');
        expect(current.content.poisonCoatings?.map((row) => row.coatingInstanceId)).toEqual([
          p.dose.id,
        ]);
        expect(current.content.poisonCoatingPreparations).toEqual([]);
        x.next('NPC-015::CTA::001');
        x.alive();
        const { command, version } = x.commit();
        const saved = publishedIndividualDose(version, p.item.id);
        expect(saved.doses).toHaveLength(1);
        expect(saved.doses[0]).toMatchObject({
          coatingInstanceId: p.dose.id,
          preparationOperationId: p.request.operationId,
          modeOperationId: p.mode.request.operationId,
          appliedAt: { campaignTimestamp: 7 },
          origin: { kind: 'COMMITTED', originCommitOperationId: command.commandId },
          originalSourceSnapshot: {
            symbiontInstanceId: p.sourceId,
            targetLevel: 5,
            status: 'ACTIVE',
          },
          currentSourceContext: {
            effectiveSourceSnapshot: {
              symbiontInstanceId: p.sourceId,
              targetLevel: 5,
              status: 'ACTIVE',
            },
            resolution: {
              kind: 'FROZEN',
              unavailableOperationIdOrNull: removal.operationId,
              unavailableReasonOrNull: 'SOURCE_REMOVED',
            },
          },
        });
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(restored.prepare(p.request)).toEqual({ ...p.prepared, replayed: true });
        expect(restored.prepare(removal)).toEqual({ ...removed, replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      }, 180_000);
    }

    // These user-paced workflows otherwise keep native SQLite statement finalizers waiting
    // for the whole synchronous scenario. Yield only after completed commands, outside
    // transactions and the original commit/refusal/replay bundles.
    async function nextPoisonHostTurn(target: Database.Database) {
      expect(target.inTransaction).toBe(false);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(target.inTransaction).toBe(false);
    }

    if (group === 'coated-restore') {
      it('restores the same coated physical item in N+1 and permits dose loss only through actual REMOVE', async () => {
        const p = preparedIndividualDose(),
          { x, h, app } = p;
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        const first = x.commit(),
          firstBytes = s.canonical(first.version);
        const firstDose = publishedIndividualDose(first.version, p.item.id).doses;
        await nextPoisonHostTurn(h.db);
        const opened = app.workflow(h.openWorkflowRequest(first.version));
        x.setAttempt(opened.attemptEvent.attempt);
        await nextPoisonHostTurn(h.db);
        for (const action of [
          'NPC-002::CTA::001',
          'NPC-011::CTA::001',
          'NPC-012::CTA::001',
          'NPC-013::CTA::001',
          'NPC-014::CTA::001',
        ] as const) {
          x.next(action);
          await nextPoisonHostTurn(h.db);
        }
        // OPEN and NAV alone add no current-version poison observation.
        // Confirm actual V2 life before testing its composition history consumer.
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        x.next('NPC-016::CTA::002');
        await nextPoisonHostTurn(h.db);
        {
          // The actual retained coating reaches V2 observations with a real V1 predecessor.
          // Change and restore SQL only after its composition consumer has read fresh history.
          const compositionReader =
            npcGmSourceModule.readNpcCompositionDerivationEvidenceInTransaction;
          const historyReader = npcGmSourceModule.readNpcInventoryHistoryEvidenceInTransaction;
          const compositionBytes = h.db.serialize();
          function compositionPath(names: readonly string[]) {
            const limit = Error.stackTraceLimit;
            let trace: string;
            try {
              Error.stackTraceLimit = Math.max(limit, 100);
              trace = new Error().stack ?? '';
            } finally {
              Error.stackTraceLimit = limit;
            }
            const frames = [
              ...trace.matchAll(/\bat (?:Object\.)?(\w+)(?: \[as [^\]]+\])? \(/g),
            ].map((match) => match[1]);
            return frames.some((_, index) =>
              names.every((name, offset) => frames[index + offset] === name),
            );
          }
          for (const fault of [true, false]) {
            let compositionEvidence = 0;
            let compositionDelegates = 0;
            let ownerHistory = 0;
            let consumerHistory = 0;
            let injected = 0;
            const changedRows: number[] = [];
            const compositionSpy = vi
              .spyOn(npcGmSourceModule, 'readNpcCompositionDerivationEvidenceInTransaction')
              .mockImplementation((...args) => {
                const actual = compositionReader(...args);
                if (
                  args[0] === h.db &&
                  args[1].npcDraftId === x.attempt().npcDraftId &&
                  args[1].targetOrNull?.expectedCurrentVersion === first.version.version &&
                  actual.previousOrNull !== null &&
                  s.same(actual.previousOrNull.record, first.version)
                ) {
                  compositionDelegates++;
                  if (compositionPath(['composition', 'observations'])) compositionEvidence++;
                }
                return actual;
              });
            const compositionHistorySpy = vi
              .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
              .mockImplementation((...args) => {
                const actual = historyReader(...args);
                if (
                  args[0] === h.db &&
                  s.same(args[1], h.scope) &&
                  args[2] === first.version.npcUuid &&
                  args[3] === first.version.version &&
                  actual.length === 1 &&
                  s.same(actual[0]?.stored.record, first.version)
                ) {
                  if (compositionPath(['inventoryHistoryRead', 'composition', 'observations']))
                    ownerHistory++;
                  if (
                    compositionEvidence > 0 &&
                    ownerHistory > 0 &&
                    compositionPath([
                      'inventoryHistoryRead',
                      'compositionState',
                      'composition',
                      'observations',
                    ])
                  ) {
                    consumerHistory++;
                    if (fault && injected === 0) {
                      const hash = actual[0]?.version.sha256 ?? unavailable();
                      const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
                      const update = h.db.prepare(
                        'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
                      );
                      changedRows.push(
                        update.run(changed, h.scope.campaignId, first.version.npcUuid).changes,
                      );
                      changedRows.push(
                        update.run(hash, h.scope.campaignId, first.version.npcUuid).changes,
                      );
                      injected++;
                    }
                  }
                }
                return actual;
              });
            try {
              let refusal: unknown;
              let projected: ReturnType<typeof x.project> | undefined;
              try {
                projected = x.project();
              } catch (error) {
                refusal = error;
              }
              expect(
                compositionEvidence,
                `refusal=${String(refusal).slice(0, 240)}; delegates=${compositionDelegates}; evidence=${compositionEvidence}; owner=${ownerHistory}; consumer=${consumerHistory}`,
              ).toBeGreaterThan(0);
              expect(ownerHistory).toBeGreaterThan(0);
              expect(consumerHistory).toBeGreaterThan(0);
              expect(injected).toBe(fault ? 1 : 0);
              expect(changedRows).toEqual(fault ? [1, 1] : []);
              if (fault) {
                expect(refusal).toBeInstanceOf(NetworkApplicationStoreError);
                expect(refusal).toMatchObject({ code: 'SOURCE_CHANGED' });
                expect(projected).toBeUndefined();
              } else {
                expect(refusal).toBeUndefined();
                if (projected?.formId !== 'NPC-015') throw Error('Actual V2 coating view required');
                expect(projected.content.poisonCoatings).toEqual(
                  expect.arrayContaining([
                    expect.objectContaining({
                      coatingInstanceId: p.dose.id,
                      targetItemInstanceId: p.item.id,
                    }),
                  ]),
                );
              }
              expect(h.db.inTransaction).toBe(false);
              expect(h.db.serialize().equals(compositionBytes)).toBe(true);
            } finally {
              compositionHistorySpy.mockRestore();
              compositionSpy.mockRestore();
            }
            await nextPoisonHostTurn(h.db);
          }
        }
        x.edit(entered([]));
        await nextPoisonHostTurn(h.db);
        const afterOmission = h.db.serialize();
        // The UUID already existed in this draft, but its immutable preparation cannot be erased
        // by hiding and then manually reintroducing the same physical identity with an empty array.
        expect(() => x.edit(entered([p.uncoatedRow]))).toThrow();
        expect(h.db.serialize().equals(afterOmission)).toBe(true);
        await nextPoisonHostTurn(h.db);
        const view = x.project();
        if (view.formId !== 'NPC-015') throw Error('Actual historical restore choices required');
        const restore = view.content.restorePreparationOrNull ?? unavailable();
        expect(restore.canSubmit).toBe(true);
        expect(restore.choices.some((choice) => choice.value === p.item.id)).toBe(true);
        await nextPoisonHostTurn(h.db);
        const request = x.request15({
          kind: 'ITEM_RESTORE',
          capabilityKey: restore.capabilityKey,
          itemInstanceId: p.item.id,
          values: json(x.attempt().values['inventory']),
        });
        await nextPoisonHostTurn(h.db);
        const restoredItem = app.prepare(request);
        x.setAttempt(restoredItem.attemptEvent.attempt);
        expect(
          'childAllocations' in restoredItem.attemptEvent
            ? restoredItem.attemptEvent.childAllocations
            : [],
        ).toEqual([]);
        const rows = s.object(x.attempt().values['inventory'])['value'];
        if (!Array.isArray(rows)) throw Error('Restored physical row required');
        expect(rows).toHaveLength(1);
        expect(s.object(s.object(rows[0])['input'])['coatingInstanceIds']).toEqual(
          entered([p.dose.id]),
        );
        await nextPoisonHostTurn(h.db);
        const selected = x.project();
        if (selected.formId !== 'NPC-015')
          throw Error('Actual coating removal capability required');
        const coating =
          selected.content.poisonCoatings?.find((row) => row.coatingInstanceId === p.dose.id) ??
          unavailable();
        expect(coating.canRemove).toBe(true);
        await nextPoisonHostTurn(h.db);
        const removeRequest = x.request15({
          kind: 'POISON_COATING_REMOVE',
          input: {
            capabilityKey: coating.capabilityKey,
            coatingInstanceId: p.dose.id,
            reason: 'Явно снять исходную дозу в новой версии',
          },
        });
        await nextPoisonHostTurn(h.db);
        const removed = app.prepare(removeRequest);
        x.setAttempt(removed.attemptEvent.attempt);
        expect(
          'childAllocations' in removed.attemptEvent ? removed.attemptEvent.childAllocations : [],
        ).toEqual([]);
        await nextPoisonHostTurn(h.db);
        const bytesBeforeCommit = h.db.serialize();
        expect(app.prepare(removeRequest)).toEqual({ ...removed, replayed: true });
        expect(h.db.serialize().equals(bytesBeforeCommit)).toBe(true);
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const second = x.commit();
        expect(second.version.version).toBe(2);
        expect(publishedIndividualDose(second.version, p.item.id).doses).toEqual([]);
        expect(second.version.snapshot).toMatchObject({
          derivation: {
            initialPoisonProof: {
              commitOperationId: second.command.commandId,
              modeAssignments: [
                {
                  modeOperationId: p.mode.request.operationId,
                  originCommitOperationId: first.command.commandId,
                },
              ],
            },
          },
        });
        await nextPoisonHostTurn(h.db);
        const closure = app.read().closure;
        expect(s.canonical(closure.versions[0])).toBe(firstBytes);
        expect(
          publishedIndividualDose(closure.versions[0] ?? unavailable(), p.item.id).doses,
        ).toEqual(firstDose);
        expect(
          closure.children.filter((row) => row.allocation.kind === 'COATING_INSTANCE'),
        ).toHaveLength(1);
        await nextPoisonHostTurn(h.db);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(closure);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(request)).toEqual({ ...restoredItem, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(removeRequest)).toEqual({ ...removed, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.workflow(second.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextPoisonHostTurn(reopened.db);
      }, 1_800_000);
    }

    // Install after both existing poison pending test fragments inside the actual runtime
    // preparation describe, only after approved B14 import. Default test budget unchanged.
    // This case exercises actual removal while the physical item is absent from V2.
    if (group === 'coating-removal-v3') {
      it('keeps an actual coating removal across an omitted V2 item and restores the uncoated identity in V3', async () => {
        const deepPhases: Array<[label: string, wallTimeMs: number, monotonicMs: number]> = [
          ['SETUP', Date.now(), performance.now()],
        ];
        onTestFailed(() => {
          console.error(
            'NPC deep V3 failure phases',
            JSON.stringify({ lastPhase: deepPhases.at(-1), phases: deepPhases }),
          );
        });

        // Production receives completed commands on separate event-loop turns. Let native SQLite
        // statement finalizers run between commands; keep transactions and commit/refusal bundles synchronous.
        async function nextHostTurn(target: Database.Database) {
          expect(target.inTransaction).toBe(false);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(target.inTransaction).toBe(false);
        }

        const p = preparedIndividualDose(),
          { x, h, app } = p;
        await nextHostTurn(h.db);
        deepPhases.push(['V1_COMMIT', Date.now(), performance.now()]);
        x.next('NPC-015::CTA::001');
        x.alive();
        await nextHostTurn(h.db);
        const first = x.commit(),
          firstBytes = s.canonical(first.version),
          firstItem = publishedIndividualDose(first.version, p.item.id);
        expect(firstItem.doses).toHaveLength(1);
        await nextHostTurn(h.db);
        async function openInventory(version: NpcVersion) {
          const opened = app.workflow(h.openWorkflowRequest(version));
          x.setAttempt(opened.attemptEvent.attempt);
          await nextHostTurn(h.db);
          for (const action of [
            'NPC-002::CTA::001',
            'NPC-011::CTA::001',
            'NPC-012::CTA::001',
            'NPC-013::CTA::001',
            'NPC-014::CTA::001',
          ] as const) {
            x.next(action);
            await nextHostTurn(h.db);
          }
        }
        deepPhases.push(['V2_OPEN', Date.now(), performance.now()]);
        await openInventory(first.version);
        deepPhases.push(['V2_REMOVE', Date.now(), performance.now()]);
        const selected = x.project();
        if (selected.formId !== 'NPC-015') throw Error('Actual V2 coating control required');
        const coating =
          selected.content.poisonCoatings?.find((row) => row.coatingInstanceId === p.dose.id) ??
          unavailable();
        expect(coating.canRemove).toBe(true);
        await nextHostTurn(h.db);
        const removeRequest = x.request15({
          kind: 'POISON_COATING_REMOVE',
          input: {
            capabilityKey: coating.capabilityKey,
            coatingInstanceId: p.dose.id,
            reason: 'Снять дозу до исключения предмета из второй версии',
          },
        });
        await nextHostTurn(h.db);
        const removed = app.prepare(removeRequest);
        x.setAttempt(removed.attemptEvent.attempt);
        expect(
          'childAllocations' in removed.attemptEvent ? removed.attemptEvent.childAllocations : [],
        ).toEqual([]);
        await nextHostTurn(h.db);
        deepPhases.push(['V2_COMMIT', Date.now(), performance.now()]);
        x.edit(entered([]));
        await nextHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        const second = x.commit(),
          secondBytes = s.canonical(second.version);
        expect(second.version.version).toBe(2);
        expect(s.object(s.object(second.version.snapshot)['sheet'])['itemProfiles']).toEqual([]);
        expect(
          s.object(s.object(s.object(second.version.snapshot)['derivation'])['inventoryProof'])[
            'entries'
          ],
        ).toEqual([]);
        await nextHostTurn(h.db);
        deepPhases.push(['V3_OPEN', Date.now(), performance.now()]);
        await openInventory(second.version);
        {
          // The saved V2 REMOVE is read again in V3's preparation history. Its real
          // historical basis needs V1 after this owner has fully decoded both V1 and V2.
          const historyReader = npcGmSourceModule.readNpcInventoryHistoryEvidenceInTransaction;
          const decode = npcHumanoidSheetModule.readNpcHumanoidSnapshot;
          const historyBytes = h.db.serialize();
          function historyStack() {
            const limit = Error.stackTraceLimit;
            try {
              Error.stackTraceLimit = Math.max(limit, 100);
              return new Error().stack ?? '';
            } finally {
              Error.stackTraceLimit = limit;
            }
          }
          const ownerPath =
            /\bat inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at (?:Object\.)?inventoryPreviewForAttempt \(/;
          const olderPath =
            /\bat inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at initialStateSourceBasis \([^\r\n]*\)\r?\n\s*at (?:Object\.)?poisonReadBasis(?: \[as read\])? \(/;
          const directDecoderPath =
            /\bat readSnapshotWithContexts \([^\r\n]*\)\r?\n\s*at inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at (?:Object\.)?inventoryPreviewForAttempt \(/;
          for (const fault of ['SQL ABA', 'completed V1 life', null] as const) {
            deepPhases.push([fault ?? 'ANCESTOR_RECOVERY', Date.now(), performance.now()]);
            const observed: { owner: ReturnType<typeof historyReader> | null } = { owner: null };
            let firstRaw: unknown;
            let secondRaw: unknown;
            let firstLife: Parameters<typeof decode>[8] = null;
            let firstDecoded = 0;
            let secondDecoded = 0;
            let olderSql = 0;
            let repeatedOlderDecoder = 0;
            let mutations = 0;
            const olderVersions: number[][] = [];
            const changedRows: number[] = [];
            let changedLife: Parameters<typeof decode>[8] = null;
            let oldMinute: number | null = null;
            const historySpy = vi
              .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
              .mockImplementation((...args) => {
                const actual = historyReader(...args);
                if (
                  args[0] !== h.db ||
                  !s.same(args[1], h.scope) ||
                  args[2] !== second.version.npcUuid
                )
                  return actual;
                const stack = historyStack();
                if (observed.owner === null && args[3] === 2 && ownerPath.test(stack)) {
                  observed.owner = actual;
                  firstRaw = actual[0]?.stored.record['snapshot'];
                  secondRaw = actual[1]?.stored.record['snapshot'];
                } else if (
                  observed.owner !== null &&
                  firstDecoded === 1 &&
                  secondDecoded === 1 &&
                  args[3] === 1 &&
                  olderPath.test(stack) &&
                  /\bat preparationHistory \(/.test(stack) &&
                  /\bat (?:Object\.)?inventoryPreviewForAttempt \(/.test(stack)
                ) {
                  // This is inventoryHistoryRead, not pendingInventoryGraph's raw SQL query.
                  olderSql++;
                  olderVersions.push(actual.map((entry) => entry.version.version));
                  if (fault !== null && mutations === 0) {
                    if (fault === 'SQL ABA') {
                      const hash = actual[0]?.version.sha256 ?? unavailable();
                      const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
                      const update = h.db.prepare(
                        'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
                      );
                      changedRows.push(
                        update.run(changed, h.scope.campaignId, second.version.npcUuid).changes,
                        update.run(hash, h.scope.campaignId, second.version.npcUuid).changes,
                      );
                    } else {
                      if (
                        firstLife == null ||
                        Object.getOwnPropertyDescriptor(firstLife, 'campaignTimestampOrNull')
                          ?.writable !== true
                      )
                        throw Error('Actual mutable completed V1 life context required');
                      changedLife = firstLife;
                      oldMinute = firstLife.campaignTimestampOrNull;
                      if (
                        !Reflect.set(firstLife, 'campaignTimestampOrNull', (oldMinute ?? 0) + 1) ||
                        firstLife.campaignTimestampOrNull === oldMinute
                      )
                        throw Error('Actual completed V1 life mutation did not occur');
                    }
                    mutations++;
                  }
                }
                return actual;
              });
            const decoderSpy = vi
              .spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot')
              .mockImplementation((...args) => {
                const stack = observed.owner === null ? '' : historyStack();
                const direct = directDecoderPath.test(stack);
                const earlierConsumer =
                  secondDecoded === 1 &&
                  olderPath.test(stack) &&
                  /\bat preparationHistory \(/.test(stack) &&
                  /\bat (?:Object\.)?inventoryPreviewForAttempt \(/.test(stack);
                const actual = decode(...args);
                if (direct && args[1] === firstRaw) {
                  firstDecoded++;
                  firstLife = args[8];
                } else if (direct && args[1] === secondRaw) secondDecoded++;
                if (
                  earlierConsumer &&
                  actual.derivation.inventoryProof.commitOperationId === first.command.commandId
                )
                  repeatedOlderDecoder++;
                return actual;
              });
            try {
              let refusal: unknown;
              let preview: ReturnType<typeof h.ordinary.inventoryPreviewForAttempt> | undefined;
              try {
                preview = h.db
                  .transaction(() =>
                    h.ordinary.inventoryPreviewForAttempt(x.attempt(), h.calendar()),
                  )
                  .deferred();
              } catch (error) {
                refusal = error;
              }
              expect(
                olderSql,
                `fault=${String(fault)}; refusal=${String(refusal).slice(0, 240)}; V1=${firstDecoded}; V2=${secondDecoded}`,
              ).toBeGreaterThan(0);
              expect(observed.owner?.map((entry) => entry.version.version)).toEqual([1, 2]);
              expect(observed.owner?.[0]?.stored.record).toEqual(first.version);
              expect(observed.owner?.[1]?.stored.record).toEqual(second.version);
              expect(firstDecoded).toBe(1);
              expect(secondDecoded).toBe(1);
              expect(olderVersions.every((versions) => s.same(versions, [1]))).toBe(true);
              expect(mutations).toBe(fault === null ? 0 : 1);
              expect(changedRows).toEqual(fault === 'SQL ABA' ? [1, 1] : []);
              if (fault === null) {
                expect(refusal).toBeUndefined();
                expect(preview).toEqual({ items: [] });
                expect(repeatedOlderDecoder).toBe(0);
              } else {
                expect(refusal).toBeInstanceOf(NetworkApplicationStoreError);
                expect((refusal as NetworkApplicationStoreError).code).toBe('SOURCE_CHANGED');
                expect(preview).toBeUndefined();
              }
              expect(h.db.inTransaction).toBe(false);
              expect(h.db.serialize().equals(historyBytes)).toBe(true);
            } finally {
              if (changedLife != null)
                Reflect.set(changedLife, 'campaignTimestampOrNull', oldMinute);
              decoderSpy.mockRestore();
              historySpy.mockRestore();
            }
            await nextHostTurn(h.db);
          }
        }
        deepPhases.push(['V3_RESTORE', Date.now(), performance.now()]);
        const view = x.project();
        if (view.formId !== 'NPC-015') throw Error('Actual V3 restore control required');
        const restore = view.content.restorePreparationOrNull ?? unavailable();
        expect(restore.canSubmit).toBe(true);
        expect(restore.choices.some((row) => row.value === p.item.id)).toBe(true);
        await nextHostTurn(h.db);
        const restoreRequest = x.request15({
          kind: 'ITEM_RESTORE',
          capabilityKey: restore.capabilityKey,
          itemInstanceId: p.item.id,
          values: json(x.attempt().values['inventory']),
        });
        await nextHostTurn(h.db);
        const restored = app.prepare(restoreRequest);
        x.setAttempt(restored.attemptEvent.attempt);
        expect(
          'childAllocations' in restored.attemptEvent ? restored.attemptEvent.childAllocations : [],
        ).toEqual([]);
        const restoredRows = s.object(x.attempt().values['inventory'])['value'];
        if (!Array.isArray(restoredRows)) throw Error('Actual restored physical row required');
        expect(restoredRows).toHaveLength(1);
        const restoredRow = s.object(restoredRows[0]),
          restoredInput = s.object(restoredRow['input']);
        expect(restoredRow['itemInstanceId']).toBe(p.item.id);
        expect(restoredInput['coatingInstanceIds']).toEqual(entered([]));
        await nextHostTurn(h.db);
        // Both the restore projection and a subsequent generic editor write must retain
        // the removal. The original allocated dose UUID cannot be resurrected manually.
        deepPhases.push(['V3_FORGERY', Date.now(), performance.now()]);
        const beforeForgery = h.db.serialize();
        expect(() =>
          x.edit(
            entered([
              {
                ...restoredRow,
                input: { ...restoredInput, coatingInstanceIds: entered([p.dose.id]) },
              },
            ]),
          ),
        ).toThrow();
        expect(h.db.serialize().equals(beforeForgery)).toBe(true);
        await nextHostTurn(h.db);
        deepPhases.push(['V3_EDIT', Date.now(), performance.now()]);
        x.edit(entered([{ ...restoredRow, input: { ...restoredInput, broken: entered(true) } }]));
        await nextHostTurn(h.db);
        const afterEdit = x.project();
        if (afterEdit.formId !== 'NPC-015')
          throw Error('Actual restored inventory preview required');
        expect(
          afterEdit.content.poisonCoatings?.some((row) => row.coatingInstanceId === p.dose.id),
        ).not.toBe(true);
        await nextHostTurn(h.db);
        deepPhases.push(['V3_COMMIT', Date.now(), performance.now()]);
        x.next('NPC-015::CTA::001');
        await nextHostTurn(h.db);
        deepPhases.push(['V3_NAV_PREVIEW', Date.now(), performance.now()]);
        x.next('NPC-016::CTA::001');
        await nextHostTurn(h.db);
        const thirdCommand = h.commitWorkflowRequest(x.attempt());
        deepPhases.push(['V3_WORKFLOW', Date.now(), performance.now()]);
        app.workflow(thirdCommand);
        await nextHostTurn(h.db);
        deepPhases.push(['V3_READ_RESULT', Date.now(), performance.now()]);
        const third = {
          command: thirdCommand,
          version: app.read().closure.versions.at(-1) ?? unavailable(),
        };
        expect(third.version.version).toBe(3);
        const thirdItem = publishedIndividualDose(third.version, p.item.id);
        expect(thirdItem.doses).toEqual([]);
        expect(thirdItem.physical).toMatchObject({
          itemInstanceId: p.item.id,
          broken: true,
          createdAt: firstItem.physical['createdAt'],
          provenance: firstItem.physical['provenance'],
        });
        await nextHostTurn(h.db);
        deepPhases.push(['V3_READ', Date.now(), performance.now()]);
        const closure = app.read().closure;
        expect(s.canonical(closure.versions[0])).toBe(firstBytes);
        expect(s.canonical(closure.versions[1])).toBe(secondBytes);
        expect(
          publishedIndividualDose(closure.versions[0] ?? unavailable(), p.item.id).doses,
        ).toEqual(firstItem.doses);
        expect(
          closure.children.filter((row) => row.allocation.kind === 'COATING_INSTANCE'),
        ).toHaveLength(1);
        await nextHostTurn(h.db);
        deepPhases.push(['REOPEN', Date.now(), performance.now()]);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(closure);
        await nextHostTurn(reopened.db);
        deepPhases.push(['REPLAY', Date.now(), performance.now()]);
        expect(recovered.prepare(removeRequest)).toEqual({ ...removed, replayed: true });
        await nextHostTurn(reopened.db);
        expect(recovered.prepare(restoreRequest)).toEqual({ ...restored, replayed: true });
        await nextHostTurn(reopened.db);
        expect(recovered.workflow(third.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextHostTurn(reopened.db);
        deepPhases.push(['BODY_COMPLETE', Date.now(), performance.now()]);
      }, 3_600_000);
    }

    // Install after the existing poison helper fragments only after approved B14 import.
    // These are real SQLite/app workflows. No timeout or source guard changes are implied.
    async function openPoisonInventory(x: ReturnType<typeof poisonSetup>, version: NpcVersion) {
      const opened = x.app.workflow(x.h.openWorkflowRequest(version));
      x.setAttempt(opened.attemptEvent.attempt);
      await nextPoisonHostTurn(x.h.db);
      for (const action of [
        'NPC-002::CTA::001',
        'NPC-011::CTA::001',
        'NPC-012::CTA::001',
        'NPC-013::CTA::001',
        'NPC-014::CTA::001',
      ] as const) {
        x.next(action);
        await nextPoisonHostTurn(x.h.db);
      }
    }
    function restorePoisonItem(x: ReturnType<typeof poisonSetup>, itemInstanceId: string) {
      const view = x.project();
      if (view.formId !== 'NPC-015') throw Error('Actual restore control required');
      const offered = view.content.restorePreparationOrNull ?? unavailable();
      expect(offered.canSubmit).toBe(true);
      expect(offered.choices.some((row) => row.value === itemInstanceId)).toBe(true);
      const request = x.request15({
        kind: 'ITEM_RESTORE',
        capabilityKey: offered.capabilityKey,
        itemInstanceId,
        values: json(x.attempt().values['inventory']),
      });
      const result = x.app.prepare(request);
      x.setAttempt(result.attemptEvent.attempt);
      expect(
        'childAllocations' in result.attemptEvent ? result.attemptEvent.childAllocations : [],
      ).toEqual([]);
      return { request, result };
    }
    if (group === 'replacement-preparation') {
      it('archives an omitted replacement preparation and assigns its original COMMIT only on first selected publication', async () => {
        const p = preparedIndividualDose(),
          { x, h, app } = p;
        // Real UI commands have separate turns; preserve each synchronous command and
        // let native finalizers run only after navigation or workflow has returned.
        async function commitReplacementVersion() {
          x.next('NPC-016::CTA::001');
          await nextPoisonHostTurn(h.db);
          const command = h.commitWorkflowRequest(x.attempt());
          app.workflow(command);
          await nextPoisonHostTurn(h.db);
          return { command, version: app.read().closure.versions.at(-1) ?? unavailable() };
        }
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        const first = await commitReplacementVersion(),
          firstBytes = s.canonical(first.version);
        await nextPoisonHostTurn(h.db);
        await openPoisonInventory(x, first.version);
        const view = x.project();
        if (view.formId !== 'NPC-015') throw Error('Actual replacement control required');
        const offered =
          view.content.poisonCoatingPreparations?.find(
            (row) => row.sourceInstanceId === p.sourceId && row.targetItemInstanceId === p.item.id,
          ) ?? unavailable();
        expect(offered.replacesCoatingIdOrNull).toBe(p.dose.id);
        await nextPoisonHostTurn(h.db);
        const replaceRequest = x.request15({
          kind: 'POISON_COATING_PREPARE',
          input: {
            capabilityKey: offered.capabilityKey,
            sourceInstanceId: p.sourceId,
            targetItemInstanceId: p.item.id,
            surfaceConfirmed: true,
            replacesCoatingIdOrNull: p.dose.id,
            replaceConfirmed: true,
            reason: 'Подготовить отдельную замену до исключения предмета',
          },
        });
        await nextPoisonHostTurn(h.db);
        const replacement = app.prepare(replaceRequest);
        x.setAttempt(replacement.attemptEvent.attempt);
        if (!('childAllocations' in replacement.attemptEvent))
          throw Error('Actual new coating identity required');
        const dose =
          replacement.attemptEvent.childAllocations.find(
            (row) => row.kind === 'COATING_INSTANCE',
          ) ?? unavailable();
        expect(dose.id).not.toBe(p.dose.id);
        await nextPoisonHostTurn(h.db);
        x.edit(entered([]));
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const second = await commitReplacementVersion(),
          secondBytes = s.canonical(second.version);
        expect(second.version.snapshot).toMatchObject({
          derivation: {
            inventoryProof: {
              entries: [],
              coatingOrigins: [],
              archivedCoatingPreparations: [
                { coatingInstanceId: dose.id, preparationOperationId: replaceRequest.operationId },
              ],
            },
          },
          sheet: { itemProfiles: [] },
        });
        await nextPoisonHostTurn(h.db);
        await openPoisonInventory(x, second.version);
        const restored = restorePoisonItem(x, p.item.id);
        const rows = s.object(x.attempt().values['inventory'])['value'];
        if (!Array.isArray(rows)) throw Error('Actual restored row required');
        expect(rows).toHaveLength(1);
        expect(s.object(s.object(rows[0])['input'])['coatingInstanceIds']).toEqual(
          entered([dose.id]),
        );
        await nextPoisonHostTurn(h.db);
        const shown = x.project();
        if (shown.formId !== 'NPC-015') throw Error('Actual current coating controls required');
        expect(shown.content.poisonCoatings?.map((row) => row.coatingInstanceId)).toEqual([
          dose.id,
        ]);
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const third = await commitReplacementVersion();
        expect(third.version.version).toBe(3);
        const actual = publishedIndividualDose(third.version, p.item.id);
        expect(actual.doses).toMatchObject([
          {
            coatingInstanceId: dose.id,
            replacesCoatingId: p.dose.id,
            preparationOperationId: replaceRequest.operationId,
            modeOperationId: p.mode.request.operationId,
            origin: { kind: 'COMMITTED', originCommitOperationId: third.command.commandId },
            appliedAt: { campaignTimestamp: 7 },
          },
        ]);
        expect(third.version.snapshot).toMatchObject({
          derivation: {
            inventoryProof: {
              coatingOrigins: [
                { coatingInstanceId: dose.id, originCommitOperationId: third.command.commandId },
              ],
            },
          },
        });
        expect(
          Object.hasOwn(
            s.object(s.object(s.object(third.version.snapshot)['derivation'])['inventoryProof']),
            'archivedCoatingPreparations',
          ),
        ).toBe(false);
        await nextPoisonHostTurn(h.db);
        const closure = app.read().closure;
        expect(s.canonical(closure.versions[0])).toBe(firstBytes);
        expect(s.canonical(closure.versions[1])).toBe(secondBytes);
        expect(
          closure.children.filter((row) => row.allocation.kind === 'COATING_INSTANCE'),
        ).toHaveLength(2);
        await nextPoisonHostTurn(h.db);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(closure);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(replaceRequest)).toEqual({ ...replacement, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(restored.request)).toEqual({ ...restored.result, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.workflow(third.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextPoisonHostTurn(reopened.db);
      }, 5_400_000);
    }

    // Install after the three poison helper fragments and archive fragment after approved B14 import.
    // Source-backed actual SQL; default budgets unchanged. No publication or test result is implied.
    function setPoisonInitialMinute(x: ReturnType<typeof poisonSetup>, minute: number) {
      const { h } = x;
      x.next('NPC-016::CTA::004');
      const rules = {
        verifyInitial: unavailable,
        reduce: unavailable,
        buildProposal: unavailable,
        npc: h.readers,
      };
      const lobby = readCampaignLobby(h.db, h.scope, h.validateOwner, rules);
      commitCampaignLobbyCommand(
        h.db,
        h.scope,
        {
          kind: 'GM',
          ownerDeviceId: h.scope.ownerDeviceId,
          gmLocalContextId: h.scope.gmLocalContextId,
        },
        {
          workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
          commandId: randomUUID(),
          campaignId: h.scope.campaignId,
          expectedLobbySnapshotRevision: lobby.lobbySnapshotRevision,
          dayNumber: 1,
          hour: 0,
          minute,
        },
        {
          receiptId: randomUUID(),
          committedAt: timestamp,
          sceneIdOrNull: null,
          checkpointIdOrNull: null,
        },
        h.validateOwner,
        rules,
        () => undefined,
      );
      h.ordinaryNav('NET-016::CTA::005');
      expect(h.view()?.formId).toBe('NPC-016');
    }
    if (group === 'pending-carrier') {
      it('restores a source-validated pending carrier omitted before its first item publication without allocating another item', async () => {
        const p = preparedIndividualDose(),
          { x, h, app } = p;
        await nextPoisonHostTurn(h.db);
        x.edit(entered([]));
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        const first = x.commit(),
          firstBytes = s.canonical(first.version);
        expect(first.version.snapshot).toMatchObject({
          derivation: {
            inventoryProof: {
              entries: [],
              archivedCoatingPreparations: [
                {
                  coatingInstanceId: p.dose.id,
                  preparationOperationId: p.request.operationId,
                },
              ],
            },
          },
          sheet: { itemProfiles: [], requiresCampaignTime: false },
        });
        await nextPoisonHostTurn(h.db);
        await openPoisonInventory(x, first.version);
        const restored = restorePoisonItem(x, p.item.id);
        const rows = s.object(x.attempt().values['inventory'])['value'];
        if (!Array.isArray(rows)) throw Error('Actual pending physical row required');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
          ...p.uncoatedRow,
          input: { ...p.uncoatedRow.input, coatingInstanceIds: entered([p.dose.id]) },
        });
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const second = x.commit();
        expect(second.version.version).toBe(2);
        expect(publishedIndividualDose(second.version, p.item.id).doses).toMatchObject([
          {
            coatingInstanceId: p.dose.id,
            preparationOperationId: p.request.operationId,
            origin: { kind: 'COMMITTED', originCommitOperationId: second.command.commandId },
            appliedAt: { campaignTimestamp: 7 },
          },
        ]);
        expect(s.object(second.version.snapshot['sheet'])['requiresCampaignTime']).toBe(true);
        await nextPoisonHostTurn(h.db);
        const closure = app.read().closure;
        expect(s.canonical(closure.versions[0])).toBe(firstBytes);
        expect(closure.children.filter((row) => row.allocation.kind === 'ITEM')).toHaveLength(1);
        expect(
          closure.children.filter((row) => row.allocation.kind === 'COATING_INSTANCE'),
        ).toHaveLength(1);
        await nextPoisonHostTurn(h.db);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(closure);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(restored.request)).toEqual({ ...restored.result, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.workflow(second.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextPoisonHostTurn(reopened.db);
      }, 900_000);
    }
    if (group === 'stale-dose') {
      it('shows a stale pending dose after restore and resolves it through actual reasoned REMOVE and a new preparation', async () => {
        const p = preparedIndividualDose(),
          { x, h, app } = p;
        await nextPoisonHostTurn(h.db);
        x.edit(entered([]));
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        const first = x.commit(),
          firstBytes = s.canonical(first.version);
        expect(s.object(first.version.snapshot['sheet'])['requiresCampaignTime']).toBe(false);
        await nextPoisonHostTurn(h.db);
        await openPoisonInventory(x, first.version);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        setPoisonInitialMinute(x, 8);
        await nextPoisonHostTurn(h.db);
        x.next('NPC-016::CTA::002');
        await nextPoisonHostTurn(h.db);
        const restored = restorePoisonItem(x, p.item.id);
        await nextPoisonHostTurn(h.db);
        const shown = x.project();
        if (shown.formId !== 'NPC-015') throw Error('Actual stale preparation controls required');
        const stale =
          shown.content.poisonCoatings?.find((row) => row.coatingInstanceId === p.dose.id) ??
          unavailable();
        expect(stale.canRemove).toBe(true);
        expect(stale.errors.length).toBeGreaterThan(0);
        const replacement =
          shown.content.poisonCoatingPreparations?.find(
            (row) => row.targetItemInstanceId === p.item.id && row.sourceInstanceId === p.sourceId,
          ) ?? unavailable();
        expect(replacement.canSubmit).toBe(true);
        expect(replacement.replacesCoatingIdOrNull).toBe(p.dose.id);
        await nextPoisonHostTurn(h.db);
        const blockedBytes = h.db.serialize();
        expect(() => x.next('NPC-015::CTA::001')).toThrow();
        expect(h.db.serialize().equals(blockedBytes)).toBe(true);
        await nextPoisonHostTurn(h.db);
        const removeRequest = x.request15({
          kind: 'POISON_COATING_REMOVE',
          input: {
            capabilityKey: stale.capabilityKey,
            coatingInstanceId: p.dose.id,
            reason: 'Явно снять подготовку с устаревшим временем',
          },
        });
        await nextPoisonHostTurn(h.db);
        const removed = app.prepare(removeRequest);
        x.setAttempt(removed.attemptEvent.attempt);
        expect(
          'childAllocations' in removed.attemptEvent ? removed.attemptEvent.childAllocations : [],
        ).toEqual([]);
        await nextPoisonHostTurn(h.db);
        const freshView = x.project();
        if (freshView.formId !== 'NPC-015')
          throw Error('Actual new preparation capability required');
        const fresh =
          freshView.content.poisonCoatingPreparations?.find(
            (row) => row.targetItemInstanceId === p.item.id && row.sourceInstanceId === p.sourceId,
          ) ?? unavailable();
        expect(fresh.replacesCoatingIdOrNull).toBe(null);
        await nextPoisonHostTurn(h.db);
        const prepareRequest = x.request15({
          kind: 'POISON_COATING_PREPARE',
          input: {
            capabilityKey: fresh.capabilityKey,
            sourceInstanceId: p.sourceId,
            targetItemInstanceId: p.item.id,
            surfaceConfirmed: true,
            replacesCoatingIdOrNull: null,
            replaceConfirmed: false,
            reason: 'Новая подготовка на явно подтверждённой минуте',
          },
        });
        await nextPoisonHostTurn(h.db);
        const prepared = app.prepare(prepareRequest);
        x.setAttempt(prepared.attemptEvent.attempt);
        if (!('childAllocations' in prepared.attemptEvent))
          throw Error('Actual replacement dose identity required');
        const newDose =
          prepared.attemptEvent.childAllocations.find((row) => row.kind === 'COATING_INSTANCE') ??
          unavailable();
        expect(newDose.id).not.toBe(p.dose.id);
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const second = x.commit();
        expect(publishedIndividualDose(second.version, p.item.id).doses).toMatchObject([
          {
            coatingInstanceId: newDose.id,
            replacesCoatingId: null,
            preparationOperationId: prepareRequest.operationId,
            appliedAt: { campaignTimestamp: 8 },
            origin: { kind: 'COMMITTED', originCommitOperationId: second.command.commandId },
          },
        ]);
        await nextPoisonHostTurn(h.db);
        expect(s.canonical(app.read().closure.versions[0])).toBe(firstBytes);
        await nextPoisonHostTurn(h.db);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(app.read().closure);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(restored.request)).toEqual({ ...restored.result, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(removeRequest)).toEqual({ ...removed, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(prepareRequest)).toEqual({ ...prepared, replayed: true });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.workflow(second.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextPoisonHostTurn(reopened.db);
      }, 1_800_000);
    }

    // Install with the other owning poison fragments only after actual approved B14 import.
    // Actual SQL/application workflows, default budgets unchanged; no execution claimed.
    function prepareSelectedPoisonCarrier(
      x: ReturnType<typeof poisonSetup>,
      sourceId: string,
      itemId: string,
    ) {
      const view = x.project();
      if (view.formId !== 'NPC-015') throw Error('Actual coating control required');
      const offered =
        view.content.poisonCoatingPreparations?.find(
          (row) => row.sourceInstanceId === sourceId && row.targetItemInstanceId === itemId,
        ) ?? unavailable();
      expect(offered.canSubmit).toBe(true);
      const request = x.request15({
        kind: 'POISON_COATING_PREPARE',
        input: {
          capabilityKey: offered.capabilityKey,
          sourceInstanceId: sourceId,
          targetItemInstanceId: itemId,
          surfaceConfirmed: true,
          replacesCoatingIdOrNull: null,
          replaceConfirmed: false,
          reason: 'Явная подготовка конкретной поверхности до первой публикации',
        },
      });
      const result = x.app.prepare(request);
      x.setAttempt(result.attemptEvent.attempt);
      if (!('childAllocations' in result.attemptEvent))
        throw Error('Actual dose identity required');
      const dose =
        result.attemptEvent.childAllocations.find((row) => row.kind === 'COATING_INSTANCE') ??
        unavailable();
      return { request, result, dose };
    }

    if (group === 'composite-components') {
      it('restores both original pending composite components and allocates attacking profiles only on first publication', async () => {
        const x = poisonSetup(),
          { h, app } = x,
          sourceId = x.sourceInstanceId ?? unavailable();
        await nextPoisonHostTurn(h.db);
        x.setMode(sourceId, 'Исходный режим для конкретного комплекта');
        await nextPoisonHostTurn(h.db);
        x.time();
        await nextPoisonHostTurn(h.db);
        x.next('NPC-016::CTA::002');
        await nextPoisonHostTurn(h.db);
        const reserveRequest = x.request15({
          kind: 'COMPOSITE_ITEM_RESERVE',
          input: { itemTypeId: 'ITM-WPN-026' },
        });
        await nextPoisonHostTurn(h.db);
        const reserved = app.prepare(reserveRequest);
        x.setAttempt(reserved.attemptEvent.attempt);
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual set and component identities required');
        const [set, sword, shield] = reserved.attemptEvent.childAllocations;
        if (set?.kind !== 'LINKED_SET' || sword?.kind !== 'ITEM' || shield?.kind !== 'ITEM')
          throw Error('Actual ordered composite allocation required');
        await nextPoisonHostTurn(h.db);
        const rows = [sword, shield].map((child, index) => {
          const request: NpcInventoryRequestEntry = {
            ...npcKensiRequest(child.id),
            itemTypeId: 'ITM-WPN-026',
            currentAmmo: null,
            linkedSetInstanceId: set.id,
            componentRole: index === 0 ? 'SWORD' : 'SHIELD',
            shieldCurrentHP: index === 0 ? null : 350,
          };
          const { itemInstanceId, profile, ...input } = request;
          return {
            itemInstanceId,
            profile: entered(profile),
            input: Object.fromEntries(
              Object.entries(input).map(([key, value]) => [key, entered(value)]),
            ),
          };
        });
        x.edit(entered(rows));
        await nextPoisonHostTurn(h.db);
        const prepared = prepareSelectedPoisonCarrier(x, sourceId, sword.id);
        const originalRows = s.canonical(x.attempt().values['inventory']);
        await nextPoisonHostTurn(h.db);
        x.edit(entered([]));
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        const first = x.commit(),
          firstBytes = s.canonical(first.version);
        expect(s.object(first.version.snapshot['sheet'])['itemProfiles']).toEqual([]);
        await nextPoisonHostTurn(h.db);
        expect(
          app
            .read()
            .closure.children.filter((row) => row.allocation.kind === 'WEAPON_PROFILE_VERSION'),
        ).toEqual([]);
        await nextPoisonHostTurn(h.db);
        await openPoisonInventory(x, first.version);
        const view = x.project();
        if (view.formId !== 'NPC-015')
          throw Error('Actual whole-pair restoration control required');
        const offered = view.content.restorePreparationOrNull ?? unavailable();
        expect(offered.choices).toHaveLength(1);
        expect(offered.choices[0]?.value).toBe(sword.id);
        expect(offered.choices[0]?.label).toContain('ещё не опубликован');
        await nextPoisonHostTurn(h.db);
        const bytesBeforeInvalid = h.db.serialize();
        expect(() =>
          app.prepare(
            x.request15({
              kind: 'ITEM_RESTORE',
              capabilityKey: offered.capabilityKey,
              itemInstanceId: shield.id,
              values: json(x.attempt().values['inventory']),
            }),
          ),
        ).toThrow();
        expect(h.db.serialize().equals(bytesBeforeInvalid)).toBe(true);
        await nextPoisonHostTurn(h.db);
        const restored = restorePoisonItem(x, sword.id);
        expect(s.canonical(x.attempt().values['inventory'])).toBe(originalRows);
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const second = x.commit();
        const profiles = s.object(second.version.snapshot['sheet'])['itemProfiles'];
        if (!Array.isArray(profiles)) throw Error('Actual published pair required');
        expect(profiles).toMatchObject([
          {
            kind: 'WEAPON',
            item: {
              itemInstanceId: sword.id,
              linkedSetInstanceId: set.id,
              componentRole: 'SWORD',
            },
            profileVersions: [{ itemInstanceId: sword.id, previousVersionId: null }],
          },
          {
            kind: 'SHIELD_COMPONENT',
            item: {
              itemInstanceId: shield.id,
              linkedSetInstanceId: set.id,
              componentRole: 'SHIELD',
            },
            profileVersions: [],
          },
        ]);
        expect(publishedIndividualDose(second.version, sword.id).doses).toMatchObject([
          {
            coatingInstanceId: prepared.dose.id,
            preparationOperationId: prepared.request.operationId,
            origin: {
              kind: 'COMMITTED',
              originCommitOperationId: second.command.commandId,
            },
          },
        ]);
        await nextPoisonHostTurn(h.db);
        const closure = app.read().closure;
        expect(s.canonical(closure.versions[0])).toBe(firstBytes);
        expect(closure.children.filter((row) => row.allocation.kind === 'ITEM')).toHaveLength(2);
        expect(closure.children.filter((row) => row.allocation.kind === 'LINKED_SET')).toHaveLength(
          1,
        );
        expect(
          closure.children.filter((row) => row.allocation.kind === 'COATING_INSTANCE'),
        ).toHaveLength(1);
        expect(
          closure.children.filter((row) => row.allocation.kind === 'WEAPON_PROFILE_VERSION'),
        ).toHaveLength(1);
        await nextPoisonHostTurn(h.db);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(closure);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(reserveRequest)).toEqual({
          ...reserved,
          replayed: true,
        });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(prepared.request)).toEqual({
          ...prepared.result,
          replayed: true,
        });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(restored.request)).toEqual({
          ...restored.result,
          replayed: true,
        });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.workflow(second.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextPoisonHostTurn(reopened.db);
      }, 1_800_000);
    }

    if (group === 'custom-food') {
      it('restores the actual unpublished custom food profile reservation and publishes that first version without new identities', async () => {
        const x = poisonSetup(),
          { h, app } = x,
          sourceId = x.sourceInstanceId ?? unavailable();
        await nextPoisonHostTurn(h.db);
        x.setMode(sourceId, 'Исходный режим для конкретной пищи');
        await nextPoisonHostTurn(h.db);
        x.time();
        await nextPoisonHostTurn(h.db);
        x.next('NPC-016::CTA::002');
        await nextPoisonHostTurn(h.db);
        const reserveRequest = x.request15({
          kind: 'CUSTOM_ITEM_RESERVE',
          values: json(x.attempt().values['inventory']),
        });
        await nextPoisonHostTurn(h.db);
        const reserved = app.prepare(reserveRequest);
        x.setAttempt(reserved.attemptEvent.attempt);
        if (!('childAllocations' in reserved.attemptEvent))
          throw Error('Actual custom identities required');
        const [item, profile, version] = reserved.attemptEvent.childAllocations;
        if (
          item?.kind !== 'ITEM' ||
          profile?.kind !== 'CUSTOM_PROFILE' ||
          version?.kind !== 'CUSTOM_PROFILE_VERSION'
        )
          throw Error('Actual ordered custom allocation required');
        await nextPoisonHostTurn(h.db);
        const raw = s.object(x.attempt().values['inventory'])['value'];
        if (!Array.isArray(raw) || raw.length !== 1) throw Error('Actual custom row required');
        const original = s.object(raw[0]);
        const {
          itemInstanceId: _itemId,
          profile: _profile,
          ...physical
        } = {
          ...npcKensiRequest(item.id),
          itemTypeId: null,
          currentAmmo: null,
          issueReason: 'Один явно описанный пищевой предмет',
        };
        const customProfile = {
          name: 'Подготовленная порция',
          description: 'Явно описанная мастером пища',
          massKg: 1,
          heldSizeClass: 'FITS_IN_FIST',
          armorWeightClass: 'OTHER',
          flammability: 'NONCOMBUSTIBLE',
          isIgnitionSource: false,
          isFood: true,
          canReceivePoison: true,
          canReceiveFlammableCoating: false,
        };
        x.edit(
          entered([
            {
              ...original,
              input: Object.fromEntries(
                Object.entries(physical).map(([key, value]) => [key, entered(value)]),
              ),
              profile: entered({
                kind: 'STRUCTURED_CUSTOM',
                input: Object.fromEntries(
                  Object.entries(customProfile).map(([key, value]) => [key, entered(value)]),
                ),
                customBonusOrNull: entered(null),
              }),
              bonusContainerBinding: entered({ kind: 'NOT_APPLICABLE' }),
              customProfileReason: entered('Исходный профиль конкретной пищевой порции'),
            },
          ]),
        );
        await nextPoisonHostTurn(h.db);
        const prepared = prepareSelectedPoisonCarrier(x, sourceId, item.id);
        const originalRows = s.canonical(x.attempt().values['inventory']);
        await nextPoisonHostTurn(h.db);
        x.edit(entered([]));
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        x.alive();
        await nextPoisonHostTurn(h.db);
        const first = x.commit(),
          firstBytes = s.canonical(first.version);
        expect(s.object(first.version.snapshot['sheet'])['itemProfiles']).toEqual([]);
        await nextPoisonHostTurn(h.db);
        await openPoisonInventory(x, first.version);
        const restored = restorePoisonItem(x, item.id);
        expect(s.canonical(x.attempt().values['inventory'])).toBe(originalRows);
        await nextPoisonHostTurn(h.db);
        const view = x.project();
        if (view.formId !== 'NPC-015')
          throw Error('Actual custom profile editability projection required');
        expect(view.content.customPreparationOrNull?.editableProfileVersionIds).toEqual([
          version.id,
        ]);
        expect(view.content.customPreparationOrNull?.versionTargets).toEqual([]);
        await nextPoisonHostTurn(h.db);
        x.next('NPC-015::CTA::001');
        await nextPoisonHostTurn(h.db);
        const second = x.commit();
        const profiles = s.object(second.version.snapshot['sheet'])['itemProfiles'];
        if (!Array.isArray(profiles)) throw Error('Actual custom publication required');
        expect(profiles).toHaveLength(1);
        expect(profiles[0]).toMatchObject({
          kind: 'CAMPAIGN_CUSTOM_ITEM',
          item: {
            itemInstanceId: item.id,
            itemTypeId: null,
            itemTypeReference: {
              profileId: profile.id,
              profileVersionId: version.id,
              version: 1,
            },
          },
          profileVersions: [],
          customProfileVersions: [
            {
              profileId: profile.id,
              profileVersionId: version.id,
              itemInstanceId: item.id,
              version: 1,
              previousVersionId: null,
              beforeProfile: null,
              afterProfile: customProfile,
              immutableAudit: true,
            },
          ],
        });
        expect(publishedIndividualDose(second.version, item.id).doses).toMatchObject([
          {
            coatingInstanceId: prepared.dose.id,
            preparationOperationId: prepared.request.operationId,
            consumeCondition: 'INGESTION',
            origin: {
              kind: 'COMMITTED',
              originCommitOperationId: second.command.commandId,
            },
          },
        ]);
        await nextPoisonHostTurn(h.db);
        const closure = app.read().closure;
        expect(s.canonical(closure.versions[0])).toBe(firstBytes);
        for (const kind of ['ITEM', 'CUSTOM_PROFILE', 'CUSTOM_PROFILE_VERSION', 'COATING_INSTANCE'])
          expect(closure.children.filter((row) => row.allocation.kind === kind)).toHaveLength(1);
        expect(
          closure.children.filter((row) => row.allocation.kind === 'WEAPON_PROFILE_VERSION'),
        ).toEqual([]);
        await nextPoisonHostTurn(h.db);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          recovered = connect(reopened);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.read().closure).toEqual(closure);
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(reserveRequest)).toEqual({
          ...reserved,
          replayed: true,
        });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(prepared.request)).toEqual({
          ...prepared.result,
          replayed: true,
        });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.prepare(restored.request)).toEqual({
          ...restored.result,
          replayed: true,
        });
        await nextPoisonHostTurn(reopened.db);
        expect(recovered.workflow(second.command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
        await nextPoisonHostTurn(reopened.db);
      }, 1_800_000);
    }

    // Reader-level failure-classification regression, installed after the owning poison helpers.
    // Required imports: vi; namespace npcPoisonReadersModule; readNpcPoisonCoatingContribution.
    // Real SQL journal/payload stay intact. Only the historical reader's supplied clock is corrupted.
    // The spy delegates every production factory invocation and is restored even if setup fails.
    if (group === 'ordinary') {
      it('hard-fails an inconsistent saved coating clock after proving its original preparation instead of classifying it as current input', () => {
        const actualFactory = npcPoisonReadersModule.createNpcPoisonReaders;
        const kernels = new Map<
          Database.Database,
          {
            kernel: ReturnType<typeof actualFactory>;
            historicalCalendar: Parameters<typeof actualFactory>[0]['historicalCalendar'];
          }
        >();
        const factorySpy = vi
          .spyOn(npcPoisonReadersModule, 'createNpcPoisonReaders')
          .mockImplementation((options) => {
            const kernel = actualFactory(options);
            kernels.set(options.db, {
              kernel,
              historicalCalendar: options.historicalCalendar,
            });
            return kernel;
          });
        const p = (() => {
          try {
            return preparedIndividualDose();
          } finally {
            factorySpy.mockRestore();
          }
        })();
        const { x, h } = p,
          { kernel, historicalCalendar } = kernels.get(h.db) ?? unavailable(),
          baseCalendar = h.db.transaction(() => h.calendar()).deferred(),
          baseClockBytes = s.canonical(baseCalendar);
        x.next('NPC-015::CTA::001');
        x.alive();
        const saved = x.commit(),
          actualOpenAttempt = x.attempt(),
          currentCalendar = h.db.transaction(() => h.calendar()).deferred(),
          currentCalendarBytes = s.canonical(currentCalendar);
        const bytes = h.db.serialize();
        h.db
          .transaction(() => {
            const evidence = readNpcVersionDerivationEvidenceInTransaction(h.db, {
              scope: h.scope,
              npcUuid: saved.version.npcUuid,
              npcDraftId: saved.version.npcDraftId,
              openAttemptRevision: actualOpenAttempt.revision,
              commitOperationId: saved.command.commandId,
              targetVersion: saved.version.version,
            });
            const original = evidence.committedOrNull ?? unavailable(),
              commit = {
                operationId: original.operation.operationId,
                committedAt: original.operation.committedAt,
              },
              catalog = fullSource.poisonCoatings ?? unavailable(),
              savedCalendar = historicalCalendar(original.operation, currentCalendar),
              actualMinute = savedCalendar.currentClock.campaignTimestampOrNull ?? unavailable(),
              preparationOperation =
                evidence.current.poisonOperations.find(
                  (row) => row.operation.operationId === p.request.operationId,
                )?.operation ?? unavailable(),
              preparationCalendar = historicalCalendar(preparationOperation, currentCalendar);
            const corruptedCalendar = {
              ...savedCalendar,
              currentClock: {
                ...savedCalendar.currentClock,
                campaignTimestampOrNull: actualMinute + 1,
              },
            };
            expect(evidence.current.openAttempt).toEqual(actualOpenAttempt);
            const valid = kernel.coating(
              evidence.current.openAttempt,
              p.dose.id,
              savedCalendar,
              commit,
            );
            expect(readNpcPoisonCoatingContribution(catalog, valid).coating).toEqual(
              publishedIndividualDose(saved.version, p.item.id).doses[0],
            );
            let savedFailure: unknown;
            try {
              kernel.coating(evidence.current.openAttempt, p.dose.id, corruptedCalendar, commit);
            } catch (error) {
              savedFailure = error;
            }
            expect(savedFailure).toBeInstanceOf(Error);
            expect(savedFailure).not.toBeInstanceOf(npcPoisonReadersModule.NpcPoisonReadInputError);
            expect(savedFailure).toMatchObject({
              message:
                'NPC poison owning proof: saved coating first publication differs from its actual preparation clock',
            });
            let currentFailure: unknown;
            try {
              kernel.coating(evidence.current.openAttempt, p.dose.id, corruptedCalendar, null);
            } catch (error) {
              currentFailure = error;
            }
            if (
              !(
                currentFailure instanceof
                npcPoisonReadersModule.NpcPoisonPreparationClockChangedError
              )
            )
              throw Error(
                'Only the editable current path may return a recognized stale-input status',
              );
            expect(currentFailure.originalClock).toEqual(preparationCalendar.currentClock);
            expect(
              readNpcPoisonCoatingContribution(catalog, currentFailure.original),
            ).toMatchObject({
              preparation: {
                coatingInstanceId: p.dose.id,
                preparationOperationId: p.request.operationId,
              },
              context: {
                origin: {
                  kind: 'PREPARED',
                  preparationOperationId: p.request.operationId,
                },
              },
            });
          })
          .deferred();
        expect(h.db.serialize().equals(bytes)).toBe(true);
        expect(s.canonical(baseCalendar)).toBe(baseClockBytes);
        expect(s.canonical(currentCalendar)).toBe(currentCalendarBytes);
      }, 300_000);

      it('publishes explicit severe life and both actual Weaver states without activation or rerolled D6', () => {
        const x = setup('WEAVER', true),
          { h, app } = x;
        x.time();
        const state = () => {
          const view = x.project();
          if (view.formId !== 'NPC-016') throw Error('Actual NPC016 required');
          return view.content;
        };
        expect(state().input.input.weaverEffectInstanceIds).toEqual(entered([]));
        x.edit({
          input: { ...s.object(x.attempt().values['initialState']), currentHP: entered(0) },
          currentOeChanges: [],
        });
        const assigned: Array<{ effectInstanceId: string; operationId: string }> = [];
        for (const branch of ['REPLACEMENT_TEMPORARY', 'DUPLICATED_ORGANS_PROTECTION'] as const) {
          const offered =
            state().temporaryWeaverStatePreparations?.find(
              (row) => row.sourceInstanceId === x.sourceInstanceId,
            ) ?? unavailable();
          expect(offered.canSubmit).toBe(true);
          expect(offered.branchChoices.some((row) => row.value === branch)).toBe(true);
          const request = x.preparation({
            kind: 'WEAVER_STATE_PREPARE',
            input: {
              capabilityKey: offered.capabilityKey,
              sourceInstanceId: offered.sourceInstanceId,
              branch,
              remainingMinutes: '1.5',
              reason: 'Явно введённое текущее состояние',
            },
          });
          const result = app.prepare(request);
          x.setAttempt(result.attemptEvent.attempt);
          if (!('childAllocations' in result.attemptEvent))
            throw Error('Actual child allocation required');
          expect(result.attemptEvent.childAllocations).toHaveLength(1);
          const allocation = result.attemptEvent.childAllocations[0] ?? unavailable();
          expect(allocation).toMatchObject({
            kind: 'EFFECT_INSTANCE',
            sourceKind: 'WEAVER_STATE',
            branch,
            sourceInstanceId: x.sourceInstanceId,
          });
          assigned.push({ effectInstanceId: allocation.id, operationId: request.operationId });
          const bytes = h.db.serialize();
          expect(app.prepare(request)).toEqual({ ...result, replayed: true });
          expect(h.db.serialize().equals(bytes)).toBe(true);
          expect(() => app.prepare({ ...request, operationId: randomUUID() })).toThrow();
          expect(h.db.serialize().equals(bytes)).toBe(true);
        }
        expect(state().temporaryWeaverStates?.map((row) => row.effectInstanceId)).toEqual(
          assigned.map((row) => row.effectInstanceId),
        );
        const life = state().lifeStatePreparationOrNull ?? unavailable();
        const rollRequest = x.preparation({
          kind: 'LIFE_STATE_ROLL',
          input: {
            capabilityKey: life.capabilityKey,
            reason: 'Формальная граница исходного тяжёлого ранения',
            manualFaceOrNull: life.diceMode === 'MANUAL' ? 3 : null,
          },
        });
        const rolled = app.prepare(rollRequest);
        x.setAttempt(rolled.attemptEvent.attempt);
        const rolledView = state().lifeStatePreparationOrNull ?? unavailable(),
          roll = rolledView.rollOrNull ?? unavailable();
        expect(roll.rawFace).toBeGreaterThanOrEqual(1);
        expect(roll.rawFace).toBeLessThanOrEqual(6);
        expect(rolledView.maximumRemainingMinutesOrNull).toBe(String(roll.rawFace * 5 * 4));
        const rollBytes = h.db.serialize();
        const bad = x.preparation({
          kind: 'LIFE_STATE_SET',
          input: {
            capabilityKey: rolledView.capabilityKey,
            lifeKind: 'SEVERELY_WOUNDED',
            reason: 'Недопустимый срок',
            remainingMinutesOrNull: '121',
          },
        });
        expect(() => app.prepare(bad)).toThrow();
        expect(h.db.serialize().equals(rollBytes)).toBe(true);
        expect(app.prepare(rollRequest)).toEqual({ ...rolled, replayed: true });
        expect(h.db.serialize().equals(rollBytes)).toBe(true);
        expect(state().lifeStatePreparationOrNull?.rollOrNull).toEqual(roll);
        const request = x.preparation({
          kind: 'LIFE_STATE_SET',
          input: {
            capabilityKey: rolledView.capabilityKey,
            lifeKind: 'SEVERELY_WOUNDED',
            reason: 'Подтверждено текущее исходное состояние',
            remainingMinutesOrNull: '2',
          },
        });
        const result = app.prepare(request);
        x.setAttempt(result.attemptEvent.attempt);
        const { command, version } = x.commit();
        expect(version.snapshot).toMatchObject({
          derivation: {
            initialLifeProof: {
              commitOperationId: command.commandId,
              originCommitOperationId: command.commandId,
              temporaryWeaverAssignments: assigned.map((row) => ({
                effectInstanceId: row.effectInstanceId,
                originCommitOperationId: command.commandId,
              })),
            },
          },
          sheet: {
            input: {
              symbionts: [{ symbiontInstanceId: x.sourceInstanceId, currentOE: 0 }],
              initialState: {
                currentHP: 0,
                effectInstances: [
                  {
                    effectInstanceId: assigned[0]!.effectInstanceId,
                    startsAt: { campaignTimestampExact: '7' },
                    expiresAt: { campaignTimestampExact: '8.5' },
                    payload: {
                      sourceOperationId: assigned[0]!.operationId,
                      originalR20: null,
                      assignedByGM: true,
                    },
                  },
                  {
                    effectInstanceId: assigned[1]!.effectInstanceId,
                    startsAt: { campaignTimestampExact: '7' },
                    expiresAt: { campaignTimestampExact: '8.5' },
                    payload: {
                      sourceOperationId: assigned[1]!.operationId,
                      originalR20: null,
                      assignedByGM: true,
                    },
                  },
                  {
                    effectTypeId: 'EFF-LIFE-DEATH_TIMER',
                    startsAt: { campaignTimestampExact: '7' },
                    expiresAt: { campaignTimestampExact: '9' },
                    payload: { rollFact: { roll: { rawFace: roll.rawFace } } },
                  },
                ],
              },
            },
          },
        });
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(restored.prepare(request)).toEqual({ ...result, replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      }, 60000);

      it('removes an actual prepared Weaver state without allocating or resetting its original identity', () => {
        const x = setup('WEAVER', true),
          { h, app } = x;
        x.time();
        const content = () => {
          const p = x.project();
          if (p.formId !== 'NPC-016') throw Error('Actual NPC016 required');
          return p.content;
        };
        const offered =
          content().temporaryWeaverStatePreparations?.find(
            (row) => row.sourceInstanceId === x.sourceInstanceId,
          ) ?? unavailable();
        const request = x.preparation({
          kind: 'WEAVER_STATE_PREPARE',
          input: {
            capabilityKey: offered.capabilityKey,
            sourceInstanceId: offered.sourceInstanceId,
            branch: 'DUPLICATED_ORGANS_PROTECTION',
            remainingMinutes: '2',
            reason: 'Исходная защита',
          },
        });
        const prepared = app.prepare(request);
        x.setAttempt(prepared.attemptEvent.attempt);
        const selected = content().temporaryWeaverStates?.[0] ?? unavailable();
        const before = h.db.serialize();
        const removal = x.preparation({
          kind: 'WEAVER_STATE_REMOVE',
          input: {
            capabilityKey: selected.capabilityKey,
            effectInstanceId: selected.effectInstanceId,
            reason: 'Не включать в исходное состояние',
          },
        });
        expect(() =>
          app.prepare({
            ...removal,
            preparation: {
              kind: 'WEAVER_STATE_REMOVE',
              input: {
                capabilityKey: selected.capabilityKey,
                effectInstanceId: randomUUID(),
                reason: 'Не включать в исходное состояние',
              },
            },
          }),
        ).toThrow();
        expect(h.db.serialize().equals(before)).toBe(true);
        const removed = app.prepare(removal);
        x.setAttempt(removed.attemptEvent.attempt);
        expect(
          'childAllocations' in removed.attemptEvent ? removed.attemptEvent.childAllocations : [],
        ).toEqual([]);
        expect(content().temporaryWeaverStates).toEqual([]);
        expect(content().input.input.weaverEffectInstanceIds).toEqual(entered([]));
        const bytes = h.db.serialize();
        expect(app.prepare(removal)).toEqual({ ...removed, replayed: true });
        expect(h.db.serialize().equals(bytes)).toBe(true);
        expect(
          app.read().closure.children.filter((row) => row.allocation.kind === 'EFFECT_INSTANCE'),
        ).toHaveLength(1);
      });

      it.each(['SLEEP', 'PARALYSIS'] as const)(
        'publishes formal %s from its actual preparation and preserves exact origin through replay/reopen',
        (controlKind) => {
          const x = setup(),
            { h, app } = x;
          const initial = x.project();
          if (initial.formId !== 'NPC-016') throw Error('Actual initial state form required');
          expect(
            initial.content.formalControlPreparations?.find(
              (row) => row.controlKind === controlKind,
            ),
          ).toMatchObject({ canSubmit: false });
          x.time();
          const current = x.project();
          if (current.formId !== 'NPC-016') throw Error('Actual initial state form required');
          const capability =
            current.content.formalControlPreparations?.find(
              (row) => row.controlKind === controlKind,
            ) ?? unavailable();
          expect(capability.canSubmit).toBe(true);
          const request = x.preparation({
            kind: 'FORMAL_CONTROL_SET',
            input: {
              capabilityKey: capability.capabilityKey,
              controlKind,
              remainingMinutes: '30.5',
              reason: 'Явное исходное состояние без приёма препарата',
            },
          });
          const before = h.db.serialize();
          expect(() =>
            app.prepare({
              ...request,
              preparation: {
                kind: 'FORMAL_CONTROL_SET',
                input: {
                  capabilityKey: capability.capabilityKey,
                  controlKind,
                  remainingMinutes: '60.01',
                  reason: 'Недопустимый срок',
                },
              },
            }),
          ).toThrow();
          expect(h.db.serialize().equals(before)).toBe(true);
          const prepared = app.prepare(request);
          x.setAttempt(prepared.attemptEvent.attempt);
          if (!('childAllocations' in prepared.attemptEvent))
            throw Error('Actual formal allocation required');
          expect(prepared.attemptEvent.childAllocations).toHaveLength(1);
          const allocated = prepared.attemptEvent.childAllocations[0] ?? unavailable();
          expect(allocated).toMatchObject({
            kind: 'EFFECT_INSTANCE',
            sourceKind: 'FORMAL_CONTROL',
            controlKind,
          });
          const preparedBytes = h.db.serialize();
          expect(app.prepare(request)).toMatchObject({ replayed: true });
          expect(() => app.prepare({ ...request, operationId: randomUUID() })).toThrow();
          expect(h.db.serialize().equals(preparedBytes)).toBe(true);
          x.setAttempt(app.prepare(h.aliveRequest(x.attempt())).attemptEvent.attempt);
          const { command, version } = x.commit();
          expect(version.snapshot).toMatchObject({
            derivation: {
              initialRuntimeProof: {
                commitOperationId: command.commandId,
                assignments: [
                  { effectInstanceId: allocated.id, originCommitOperationId: command.commandId },
                ],
              },
            },
            sheet: {
              input: {
                initialState: {
                  effectInstances: [
                    {
                      effectInstanceId: allocated.id,
                      effectTypeId:
                        controlKind === 'SLEEP' ? 'EFF-CONSCIOUS-SLEEP' : 'EFF-CONTROL-PARALYSIS',
                      sourceInstanceId: null,
                      sourceEntityId: null,
                      sourceSnapshot: null,
                      payload: { controlKind, assignedByGM: true },
                      startsAt: { campaignTimestampExact: '7' },
                      expiresAt: { campaignTimestampExact: '37.5' },
                      remainingExact: '30.5',
                      tickSchedule: null,
                      lastTickAt: null,
                    },
                  ],
                },
              },
            },
          });
          const bytes = h.db.serialize(),
            reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
            restored = connect(reopened);
          expect(restored.read().closure.versions[0]).toEqual(version);
          expect(restored.prepare(request)).toMatchObject({ replayed: true });
          expect(restored.workflow(command)).toMatchObject({ replayed: true });
          expect(reopened.db.serialize().equals(bytes)).toBe(true);
        },
      );
      it('records source immune formal control without a fabricated effect or clock lock', () => {
        const x = setup('TOAD'),
          { h, app } = x,
          presentation = x.project();
        if (presentation.formId !== 'NPC-016') throw Error('Actual initial state form required');
        const control =
          presentation.content.formalControlPreparations?.find(
            (row) => row.controlKind === 'SLEEP',
          ) ?? unavailable();
        expect(control.canSubmit).toBe(true);
        const request = x.preparation({
          kind: 'FORMAL_CONTROL_SET',
          input: {
            capabilityKey: control.capabilityKey,
            controlKind: 'SLEEP',
            remainingMinutes: '1',
            reason: 'Подтверждён иммунитет исходного состава',
          },
        });
        const values = x.attempt().values,
          prepared = app.prepare(request);
        x.setAttempt(prepared.attemptEvent.attempt);
        expect(prepared.attemptEvent.attempt.values).toEqual(values);
        if ('childAllocations' in prepared.attemptEvent)
          expect(prepared.attemptEvent.childAllocations).toEqual([]);
        x.setAttempt(app.prepare(h.aliveRequest(x.attempt())).attemptEvent.attempt);
        const { command, version } = x.commit();
        expect(version.snapshot['derivation']).not.toHaveProperty('initialRuntimeProof');
        const closure = app.read().closure;
        expect(
          closure.children.filter((child) => child.allocation.kind === 'EFFECT_INSTANCE'),
        ).toEqual([]);
        expect(closure.blocks.every((block) => block.initialTimeLockOrNull === null)).toBe(true);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.prepare(request)).toMatchObject({ replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      });
      it('binds positive alcohol to real initial time and original COMMIT across replay and SQLite reopen', () => {
        const x = setup(),
          { h, app } = x;
        const before = x.project();
        if (before.formId !== 'NPC-016') throw Error('Actual initial form required');
        expect(before.content.alcoholPreparationOrNull).toMatchObject({ canSubmit: false });
        const missing = x.preparation({
            kind: 'ALCOHOL_PREPARE',
            input: { reason: 'Явное исходное отравление' },
          }),
          bytes = h.db.serialize();
        expect(() => app.prepare(missing)).toThrow();
        expect(h.db.serialize().equals(bytes)).toBe(true);
        x.time();
        const request = x.preparation({
            kind: 'ALCOHOL_PREPARE',
            input: { reason: 'Явное исходное отравление' },
          }),
          prepared = app.prepare(request);
        x.setAttempt(prepared.attemptEvent.attempt);
        if (!('childAllocations' in prepared.attemptEvent))
          throw Error('Actual effect allocation required');
        expect(prepared.attemptEvent.childAllocations).toHaveLength(1);
        const effect = prepared.attemptEvent.childAllocations[0] ?? unavailable();
        expect(effect).toMatchObject({ kind: 'EFFECT_INSTANCE', sourceKind: 'ALCOHOL' });
        const preparedBytes = h.db.serialize();
        expect(app.prepare(request)).toMatchObject({ replayed: true });
        expect(h.db.serialize().equals(preparedBytes)).toBe(true);
        for (const changed of [
          {
            ...request,
            preparation: {
              kind: 'ALCOHOL_PREPARE' as const,
              input: { reason: 'Другое основание' },
            },
          },
          { ...request, operationId: randomUUID() },
          { ...request, operationId: randomUUID(), campaignId: randomUUID() },
        ]) {
          expect(() => app.prepare(changed)).toThrow();
          expect(h.db.serialize().equals(preparedBytes)).toBe(true);
        }
        const projection = x.project();
        if (projection.formId !== 'NPC-016') throw Error('Actual initial form required');
        expect(projection.content.alcoholPreparationOrNull).toMatchObject({ canSubmit: false });
        expect(
          projection.content.choices.effectInstanceIds.some((row) => row.value === effect.id),
        ).toBe(true);
        x.setAttempt(app.prepare(h.aliveRequest(x.attempt())).attemptEvent.attempt);
        const { command, version } = x.commit();
        expect(version.snapshot).toMatchObject({
          format: 'NPC_HUMANOID_V1',
          derivation: {
            initialRuntimeProof: {
              commitOperationId: command.commandId,
              assignments: [
                { effectInstanceId: effect.id, originCommitOperationId: command.commandId },
              ],
            },
          },
          sheet: {
            requiresCampaignTime: true,
            input: {
              initialState: {
                effectInstances: [
                  {
                    effectInstanceId: effect.id,
                    effectTypeId: 'EFF-POISON-INSTANCE',
                    startsAt: { campaignTimestamp: 7 },
                    tickSchedule: { nextTickAt: { campaignTimestamp: 67 } },
                    revision: 1,
                  },
                ],
              },
            },
          },
        });
        const snapshot = s.object(version.snapshot['sheet']),
          initial = s.object(s.object(snapshot['input'])['initialState']);
        expect(initial['currentHP']).toBe(
          s.object(s.object(prepared.attemptEvent.attempt.values['initialState'])['currentHP'])[
            'value'
          ],
        );
        const savedBytes = h.db.serialize(),
          receipt = app.receipt(command.commandId);
        expect(app.workflow(command)).toMatchObject({ replayed: true, receipt });
        expect(h.db.serialize().equals(savedBytes)).toBe(true);
        const reopened = fixture({ bytes: savedBytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(restored.prepare(request)).toMatchObject({ replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true, receipt });
        expect(reopened.db.serialize().equals(savedBytes)).toBe(true);
      });
      it('records source-proven Toad NO_EFFECT without an effect identity or initial time lock', () => {
        const x = setup('TOAD'),
          { h, app } = x,
          before = x.project();
        if (before.formId !== 'NPC-016') throw Error('Actual initial form required');
        expect(before.content.alcoholPreparationOrNull).toMatchObject({ canSubmit: true });
        const request = x.preparation({
            kind: 'ALCOHOL_PREPARE',
            input: { reason: 'Проверено исходное состояние и иммунитет' },
          }),
          values = x.attempt().values,
          prepared = app.prepare(request);
        x.setAttempt(prepared.attemptEvent.attempt);
        expect(prepared.attemptEvent.attempt.values).toEqual(values);
        if ('childAllocations' in prepared.attemptEvent)
          expect(prepared.attemptEvent.childAllocations).toEqual([]);
        x.setAttempt(app.prepare(h.aliveRequest(x.attempt())).attemptEvent.attempt);
        const { command, version } = x.commit();
        expect(s.object(version.snapshot['derivation'])).not.toHaveProperty('initialRuntimeProof');
        expect(version.snapshot).toMatchObject({
          sheet: { requiresCampaignTime: false, input: { initialState: { effectInstances: [] } } },
        });
        const closure = app.read().closure;
        expect(
          closure.children.filter((child) => child.allocation.kind === 'EFFECT_INSTANCE'),
        ).toEqual([]);
        expect(closure.blocks.every((block) => block.initialTimeLockOrNull === null)).toBe(true);
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.prepare(request)).toMatchObject({ replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      });
      it('publishes actual Weaver initial regeneration with explicit HP1000 and the original remaining timer', () => {
        const x = setup('WEAVER'),
          { h, app } = x;
        x.time();
        const projection = x.project();
        if (projection.formId !== 'NPC-016') throw Error('Actual initial form required');
        const control =
          projection.content.hpModePreparations?.find((row) => row.mode === 'REGENERATION') ??
          unavailable();
        expect(control.canSubmit).toBe(true);
        const originalState = s.object(x.attempt().values['initialState']);
        x.edit({ input: { ...originalState, currentHP: entered(1000) }, currentOeChanges: [] });
        const refreshed = x.project();
        if (refreshed.formId !== 'NPC-016') throw Error('Actual initial form required');
        const current =
          refreshed.content.hpModePreparations?.find((row) => row.mode === 'REGENERATION') ??
          unavailable();
        const request = x.preparation({
            kind: 'HP_MODE_PREPARE',
            input: {
              capabilityKey: current.capabilityKey,
              remainingMinutes: '2.5',
              reason: 'Уже действующий режим с явным остатком',
            },
          }),
          prepared = app.prepare(request);
        x.setAttempt(prepared.attemptEvent.attempt);
        if (!('childAllocations' in prepared.attemptEvent))
          throw Error('Actual mode allocation required');
        const effect = prepared.attemptEvent.childAllocations[0] ?? unavailable();
        expect(effect).toMatchObject({
          kind: 'EFFECT_INSTANCE',
          sourceKind: 'HP_MODE',
          mode: 'REGENERATION',
          sourceInstanceId: x.sourceInstanceId,
        });
        x.setAttempt(app.prepare(h.aliveRequest(x.attempt())).attemptEvent.attempt);
        const { command, version } = x.commit();
        expect(version.snapshot).toMatchObject({
          derivation: {
            initialRuntimeProof: {
              commitOperationId: command.commandId,
              assignments: [
                { effectInstanceId: effect.id, originCommitOperationId: command.commandId },
              ],
            },
          },
          sheet: {
            input: {
              initialState: {
                currentHP: 1000,
                effectInstances: [
                  {
                    effectInstanceId: effect.id,
                    sourceInstanceId: x.sourceInstanceId,
                    payload: { mode: 'REGENERATION' },
                    startsAt: { campaignTimestampExact: '7' },
                    expiresAt: { campaignTimestampExact: '9.5' },
                    remainingExact: '2.5',
                    revision: 1,
                  },
                ],
              },
              symbionts: [{ symbiontInstanceId: x.sourceInstanceId, currentOE: 0 }],
            },
          },
        });
        const bytes = h.db.serialize(),
          reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
          restored = connect(reopened);
        expect(restored.read().closure.versions[0]).toEqual(version);
        expect(restored.prepare(request)).toMatchObject({ replayed: true });
        expect(restored.workflow(command)).toMatchObject({ replayed: true });
        expect(reopened.db.serialize().equals(bytes)).toBe(true);
      });
    }
  });
}

export function registerNpcCompositionPaidPools() {
  describe('NPC actual nonempty ordinary composition and paid pools', () => {
    it('commits an admitted Dolphin with actual START/SYM-166 charges and restores exact receipts', () => {
      const h = fixture();
      const connect = (current: ReturnType<typeof fixture>) =>
        createNpcHostSupport(current.db, fullSource, artCatalog, () => current.calendar()).connect(
          current.scope,
          () => readGmRequestReviewSource(current.db, current.scope, current.validateOwner),
          (checkpoint, closure) => {
            expect(current.db.inTransaction).toBe(true);
            expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
          },
          current.validateOwner,
        );
      const app = connect(h);
      let attempt = h.create().attempt;
      const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
      const prepare = (
        preparation: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>['preparation'],
      ) =>
        app.prepare({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-013',
          npcDraftId: attempt.npcDraftId,
          expectedAttemptRevision: attempt.revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation,
        });
      const edit = (values: unknown) => {
        const request = npcTechnicalRequestValue(json(h.editorRequest(attempt, json(values))));
        if (request.messageType !== 'network.npc-editor.replace')
          throw Error('Expected editor request');
        // Use the production handler so the saved history is also replayed by its exact source validator.
        attempt = app.replace(request).attemptEvent.attempt;
      };
      const next = (action: keyof typeof NPC_NAV_TARGETS) => {
        const result = app.navigation(h.action(action));
        if (!('attemptEvent' in result)) throw Error('Expected editor transition');
        attempt = result.attemptEvent.attempt;
      };
      const cleared = app.prepare({
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: randomUUID(),
        campaignId: h.scope.campaignId,
        sourceFormId: 'NPC-002',
        npcDraftId: attempt.npcDraftId,
        expectedAttemptRevision: attempt.revision,
        expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
        preparation: { kind: 'ART_CLEAR' },
      });
      attempt = cleared.attemptEvent.attempt;
      edit({
        name: entered('Обычный НПС с Дельфином'),
        description: entered(null),
        affiliation: entered('Группа'),
        campaignRole: entered('Союзник'),
        sex: entered('MALE'),
        massKg: entered(75),
        artAssetKeyOrNull: entered(null),
      });
      next('NPC-002::CTA::001');
      edit({
        raceCode: entered('UNITED'),
        pureClassOrNull: entered(null),
        anatomyProfileId: entered('STANDARD_HUMANOID'),
      });
      next('NPC-011::CTA::001');
      edit(
        Object.fromEntries(
          Object.entries({ S: 20, D: 20, M: 20, Z: 20, I: 4, W: 2, C: 20 }).map(([k, v]) => [
            k,
            entered(v),
          ]),
        ),
      );
      next('NPC-012::CTA::001');
      edit(entered([]));
      const reserved = prepare({ kind: 'SYMBIONT_RESERVE', values: json(entered([])) });
      attempt = reserved.attemptEvent.attempt;
      if (!('childAllocations' in reserved.attemptEvent))
        throw Error('Missing reservation allocation');
      const allocation = reserved.attemptEvent.childAllocations.find(
        (c) => c.kind === 'SYMBIONT_INSTANCE',
      );
      if (allocation === undefined) throw Error('Missing actual symbiont identity');
      const dolphin = entered([
        {
          symbiontInstanceId: allocation.id,
          input: {
            speciesKey: entered('DOLPHIN'),
            targetLevel: entered(6),
            learnedNodeRefs: entered(
              fullSource.development.nodes
                .filter((n) => n.speciesKey === 'DOLPHIN' && n.level <= 6)
                .map((n) => n.nodeRef),
            ),
            binding: entered({ kind: 'NONE' }),
            currentOE: entered(0),
          },
        },
      ]);
      edit(dolphin);
      const confirmed = prepare({ kind: 'COMPOSITION_CONFIRM', values: json(dolphin) });
      attempt = confirmed.attemptEvent.attempt;
      expect('ordinaryFact' in confirmed.attemptEvent).toBe(true);
      next('NPC-013::CTA::001');
      edit(
        entered([
          { skillKey: entered('STEALTH'), targetBonus: entered(1), pool: entered('START') },
          { skillKey: entered('ACROBATICS'), targetBonus: entered(3), pool: entered('SYM-166') },
        ]),
      );
      next('NPC-014::CTA::001');
      edit(entered([]));
      next('NPC-015::CTA::001');
      edit({
        input: {
          currentHP: entered(1),
          effectInstanceIds: entered([]),
          traumaInstanceIds: entered([]),
          woundInstanceIds: entered([]),
          sourceSpecificStateFactIds: entered([]),
          deathConsequenceFactIdOrNull: entered(null),
        },
        currentOeChanges: [],
      });
      attempt = app.prepare(h.aliveRequest(attempt)).attemptEvent.attempt;
      next('NPC-016::CTA::001');
      const request = npcWorkflowCommandRequestValue(h.commitBoundary(attempt).boundary.request);
      const committed = app.workflow(request);
      expect('receipt' in committed).toBe(true);
      const closure = app.read().closure;
      expect(closure.versions).toHaveLength(1);
      const version = closure.versions[0]!;
      const snapshot = h.db
        .transaction(() => h.ordinary.snapshot(version.snapshot, h.calendar(), null))
        .deferred();
      expect(snapshot).toMatchObject({
        format: 'NPC_HUMANOID_V1',
        sheet: {
          stats: { permanentStats: { I: 30 } },
          input: {
            symbionts: [
              { symbiontInstanceId: allocation.id, speciesKey: 'DOLPHIN', targetLevel: 6 },
            ],
            initialState: { currentHP: 1 },
            skills: { sym166Pool: { capacity: 5, used: 3, available: 2 } },
          },
        },
      });
      const bytes = h.db.serialize(),
        receipt = app.receipt(request.commandId);
      expect(app.workflow(request)).toMatchObject({ replayed: true, receipt });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const reopened = fixture({ bytes, scope: h.scope, profileId: h.profileId }),
        restored = connect(reopened);
      expect(restored.read().closure.versions).toEqual(closure.versions);
      expect(restored.workflow(request)).toMatchObject({ replayed: true, receipt });
      expect(reopened.db.serialize().equals(bytes)).toBe(true);
    });
  });
}

export function registerNpcPreviousLifeSidecarGuards() {
  describe('same-call previous life read with actual history and mutable callbacks', () => {
    let seed: Readonly<{
      bytes: Buffer;
      scope: NpcScope;
      profileId: string;
      attempt: NpcAttempt;
      version: NpcVersion;
      preview: ReturnType<ReturnType<typeof fixture>['ordinary']['preview']>;
    }>;
    beforeAll(() => {
      const h = fixture();
      try {
        h.commit(h.fillOrdinary(h.create().attempt));
        const version = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0];
        if (version === undefined) throw Error('Actual committed ALIVE predecessor required');
        let attempt = h.openNext(version);
        for (const [action, stage] of [
          ['NPC-002::CTA::001', 'NPC-011'],
          ['NPC-011::CTA::001', 'NPC-012'],
          ['NPC-012::CTA::001', 'NPC-013'],
          ['NPC-013::CTA::001', 'NPC-014'],
          ['NPC-014::CTA::001', 'NPC-015'],
          ['NPC-015::CTA::001', 'NPC-016'],
        ] as const)
          attempt = h.navigate(attempt, action, stage).attempt;
        const preview = h.db
          .transaction(() => h.ordinary.preview(attempt, version, h.calendar()))
          .deferred();
        expect(preview.binding.targetVersion).toBe(2);
        seed = {
          bytes: h.db.serialize(),
          scope: h.scope,
          profileId: h.profileId,
          attempt,
          version,
          preview,
        };
      } finally {
        h.db.close();
      }
    });
    it.each(['SQL write then restore', 'calendar', 'selection identity'] as const)(
      'refuses changed %s before reusing independently checked previous life',
      (fault) => {
        const h = fixture({ bytes: seed.bytes, scope: seed.scope, profileId: seed.profileId });
        const life = h.ordinary.lifePreparation,
          weaver = h.ordinary.weaverPreparation;
        const originalLife = life.selection,
          originalWeaver = weaver.selection;
        const bytes = h.db.serialize();
        const issuedCalendar = h.db.transaction(() => h.calendar()).deferred();
        const calendar = { ...issuedCalendar, currentClock: { ...issuedCalendar.currentClock } };
        const originalMinute = calendar.currentClock.campaignTimestampOrNull;
        let calls = 0;
        const changedRows: number[] = [];
        Object.defineProperty(life, 'selection', {
          configurable: true,
          value(...args: Parameters<typeof originalLife>) {
            const result = originalLife.apply(life, args);
            calls++;
            if (fault === 'SQL write then restore') {
              const row = s.object(
                h.db
                  .prepare(
                    'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=1',
                  )
                  .get(h.scope.campaignId, seed.version.npcUuid),
              );
              const hash = s.hash(row['record_sha256']);
              const differentHash = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
              changedRows.push(
                h.db
                  .prepare(
                    'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
                  )
                  .run(differentHash, h.scope.campaignId, seed.version.npcUuid).changes,
              );
              changedRows.push(
                h.db
                  .prepare(
                    'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
                  )
                  .run(hash, h.scope.campaignId, seed.version.npcUuid).changes,
              );
            } else if (fault === 'calendar') {
              calendar.currentClock.campaignTimestampOrNull =
                (calendar.currentClock.campaignTimestampOrNull ?? 0) + 1;
            } else {
              Object.defineProperty(weaver, 'selection', {
                configurable: true,
                value(...parameters: Parameters<typeof originalWeaver>) {
                  return originalWeaver.apply(weaver, parameters);
                },
              });
            }
            return result;
          },
        });
        try {
          expect(() =>
            h.db
              .transaction(() => h.ordinary.preview(seed.attempt, seed.version, calendar))
              .deferred(),
          ).toThrow('network application storage: SOURCE_CHANGED');
          expect(calls).toBeGreaterThan(0);
          if (fault === 'SQL write then restore') {
            expect(changedRows).toHaveLength(calls * 2);
            expect(changedRows.every((count) => count === 1)).toBe(true);
          }
          expect(h.db.inTransaction).toBe(false);
          expect(h.db.serialize().equals(bytes)).toBe(true);
        } finally {
          Object.defineProperty(life, 'selection', { configurable: true, value: originalLife });
          Object.defineProperty(weaver, 'selection', { configurable: true, value: originalWeaver });
          calendar.currentClock.campaignTimestampOrNull = originalMinute;
        }
        // A separate owning read must rebuild from fresh input after the rejected call.
        expect(
          h.db
            .transaction(() => h.ordinary.preview(seed.attempt, seed.version, calendar))
            .deferred(),
        ).toEqual(seed.preview);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );
    it('guards a mutable source array below a frozen catalog holder during the same previous-life read', () => {
      const h = fixture({ bytes: seed.bytes, scope: seed.scope, profileId: seed.profileId });
      const originalSkills = [...catalog.skills.skills];
      const mutableSkills = [...originalSkills];
      const frozenSkills = Object.freeze({ ...catalog.skills, skills: mutableSkills });
      const ordinary = createNpcOrdinaryDomainReaders(
        h.db,
        fullSource,
        { ...catalog, skills: frozenSkills },
        artCatalog,
      );
      const bytes = h.db.serialize();
      expect(originalSkills.length).toBeGreaterThan(1);
      expect(Object.isFrozen(frozenSkills)).toBe(true);
      expect(Object.isFrozen(mutableSkills)).toBe(false);
      expect(
        h.db
          .transaction(() => ordinary.preview(seed.attempt, seed.version, h.calendar()))
          .deferred(),
      ).toEqual(seed.preview);
      expect(h.db.serialize().equals(bytes)).toBe(true);
      const life = ordinary.lifePreparation,
        original = life.selection;
      let mutations = 0;
      const mutationOrders: (typeof originalSkills)[] = [];
      Object.defineProperty(life, 'selection', {
        configurable: true,
        value(...args: Parameters<typeof original>) {
          const result = original.apply(life, args);
          // Earlier V1 validation can call selection before the N+1 guard exists.
          // Keep changing the real child on every call, without a reverse/reverse ABA.
          const first = mutableSkills.shift();
          if (first === undefined) throw Error('Actual multi-row skill catalog required');
          mutableSkills.push(first);
          mutations++;
          mutationOrders.push([...mutableSkills]);
          return result;
        },
      });
      try {
        expect(() =>
          h.db
            .transaction(() => ordinary.preview(seed.attempt, seed.version, h.calendar()))
            .deferred(),
        ).toThrow('network application storage: SOURCE_CHANGED');
        expect(mutations).toBeGreaterThan(0);
        expect(mutations).toBeLessThan(originalSkills.length);
        expect(mutationOrders).toHaveLength(mutations);
        for (const [index, order] of mutationOrders.entries())
          expect(order).toEqual([
            ...originalSkills.slice(index + 1),
            ...originalSkills.slice(0, index + 1),
          ]);
        expect(mutableSkills).not.toEqual(originalSkills);
        expect(h.db.inTransaction).toBe(false);
        expect(h.db.serialize().equals(bytes)).toBe(true);
      } finally {
        Object.defineProperty(life, 'selection', { configurable: true, value: original });
        mutableSkills.splice(0, mutableSkills.length, ...originalSkills);
      }
      expect(
        h.db
          .transaction(() => ordinary.preview(seed.attempt, seed.version, h.calendar()))
          .deferred(),
      ).toEqual(seed.preview);
      expect(h.db.serialize().equals(bytes)).toBe(true);
    });
  });
}

export function registerNpcLocalSnapshotReadGuards() {
  describe('local completed snapshots through actual N+1 validation and OPEN callbacks', () => {
    type Readers = ReturnType<typeof createNpcOrdinaryDomainReaders>;
    type Alias = 'validateVersion' | 'initializeOpen';
    type Token = NonNullable<Parameters<Readers['initializeOpen']>[4]>;
    type ObservedCall = Readonly<{
      token: Token;
      returned: unknown;
      decodedInside: number;
      repeat: () => unknown;
      foreign: (readers: Readers) => unknown;
      withoutToken: () => unknown;
      forged: () => unknown;
    }>;
    type Seed = Readonly<{
      bytes: Buffer;
      scope: NpcScope;
      profileId: string;
      attemptOrNull: NpcAttempt | null;
      version: NpcVersion;
      expected: ReturnType<Readers['preview']> | ReturnType<Readers['initializeOpen']>;
    }>;
    let seeds: Readonly<Record<Alias, Seed>>;
    function readSeed(
      readers: Readers,
      seed: Seed,
      calendar: ReturnType<ReturnType<typeof fixture>['calendar']>,
    ) {
      return seed.attemptOrNull === null
        ? readers.initializeOpen(seed.version, calendar)
        : readers.preview(seed.attemptOrNull, seed.version, calendar);
    }
    beforeAll(() => {
      const h = fixture();
      try {
        // The real workflow writer derives OPEN/COMMIT once inside its checked transaction.
        // The low-level helpers also prepare a candidate before the writer validates it again.
        const app = createNpcHostSupport(h.db, fullSource, artCatalog, () => h.calendar()).connect(
          h.scope,
          () => readGmRequestReviewSource(h.db, h.scope, h.validateOwner),
          (checkpoint, closure) => {
            expect(h.db.inTransaction).toBe(true);
            expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
          },
          h.validateOwner,
        );
        const created = h.create().attempt;
        const cleared = app.prepare({
          messageType: 'network.npc-preparation.request',
          protocolVersion: 3,
          operationId: randomUUID(),
          campaignId: h.scope.campaignId,
          sourceFormId: 'NPC-002',
          npcDraftId: created.npcDraftId,
          expectedAttemptRevision: created.revision,
          expectedRevisions: s.vectorOf(h.view() ?? unavailable()),
          preparation: { kind: 'ART_CLEAR' },
        });
        const initial = h.fillOrdinary(cleared.attemptEvent.attempt, false, false, true);
        app.workflow(h.commitWorkflowRequest(initial));
        const first = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[0];
        if (first === undefined) throw Error('Actual V1 required');
        let attempt = app.workflow(h.openWorkflowRequest(first)).attemptEvent.attempt;
        for (const [action, stage] of [
          ['NPC-002::CTA::001', 'NPC-011'],
          ['NPC-011::CTA::001', 'NPC-012'],
          ['NPC-012::CTA::001', 'NPC-013'],
          ['NPC-013::CTA::001', 'NPC-014'],
          ['NPC-014::CTA::001', 'NPC-015'],
          ['NPC-015::CTA::001', 'NPC-016'],
        ] as const)
          attempt = h.navigate(attempt, action, stage).attempt;
        // preview of open V2 exercises OPEN_VERSION using the actual saved V1.
        const preview = h.db
          .transaction(() => h.ordinary.preview(attempt, first, h.calendar()))
          .deferred();
        expect(preview.binding.targetVersion).toBe(2);
        const openSeed: Seed = {
          bytes: h.db.serialize(),
          scope: h.scope,
          profileId: h.profileId,
          attemptOrNull: attempt,
          version: first,
          expected: preview,
        };
        const complete = h.navigate(attempt, 'NPC-016::CTA::001', 'NPC-017').attempt;
        app.workflow(h.commitWorkflowRequest(complete));
        const version = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers).versions[1];
        if (version === undefined || version.version !== 2) throw Error('Actual V2 required');
        // initializeOpen of saved V2 exercises PREVIOUS_VERSION through actual validateVersion.
        // No V3 writer or its six navigation steps are needed for either local caller boundary.
        const initialized = h.db
          .transaction(() => h.ordinary.initializeOpen(version, h.calendar()))
          .deferred();
        seeds = {
          initializeOpen: openSeed,
          validateVersion: {
            bytes: h.db.serialize(),
            scope: h.scope,
            profileId: h.profileId,
            attemptOrNull: null,
            version,
            expected: initialized,
          },
        };
      } finally {
        h.db.close();
      }
    }, 60_000);

    // These wrappers always call the actual factory methods. Only the optional
    // trailing transport argument can be dropped; no decoded result is supplied.
    function observe(
      readers: Readers,
      alias: Alias,
      after: (call: ObservedCall) => void,
      dropToken = false,
      decoderCount: () => number = () => 0,
    ): () => void {
      const validate = readers.validateVersion,
        initialize = readers.initializeOpen;
      if (alias === 'validateVersion') {
        Object.defineProperty(readers, alias, {
          configurable: true,
          value(this: Readers, ...args: Parameters<typeof validate>) {
            expect(this).toBe(readers);
            const [version, committed, previous, calendar, pending, graph, token] = args;
            const before = decoderCount();
            const returned = dropToken
              ? validate.call(readers, version, committed, previous, calendar, pending, graph)
              : validate.apply(readers, args);
            if (token !== undefined)
              after({
                token,
                returned,
                decodedInside: decoderCount() - before,
                repeat: () => validate.apply(readers, args),
                foreign: (other) => other.validateVersion(...args),
                withoutToken: () =>
                  validate.call(readers, version, committed, previous, calendar, pending, graph),
                forged: () =>
                  validate.call(
                    readers,
                    version,
                    committed,
                    previous,
                    calendar,
                    pending,
                    graph,
                    Object.freeze({ kind: 'NPC_LOCAL_SNAPSHOT_READ' }),
                  ),
              });
            return returned;
          },
        });
      } else {
        Object.defineProperty(readers, alias, {
          configurable: true,
          value(this: Readers, ...args: Parameters<typeof initialize>) {
            expect(this).toBe(readers);
            const [version, calendar, weaver, poison, token] = args;
            const before = decoderCount();
            const returned = dropToken
              ? initialize.call(readers, version, calendar, weaver, poison)
              : initialize.apply(readers, args);
            if (token !== undefined)
              after({
                token,
                returned,
                decodedInside: decoderCount() - before,
                repeat: () => initialize.apply(readers, args),
                foreign: (other) => other.initializeOpen(...args),
                withoutToken: () => initialize.call(readers, version, calendar, weaver, poison),
                forged: () =>
                  initialize.call(
                    readers,
                    version,
                    calendar,
                    weaver,
                    poison,
                    Object.freeze({ kind: 'NPC_LOCAL_SNAPSHOT_READ' }),
                  ),
              });
            return returned;
          },
        });
      }
      return () => {
        Object.defineProperty(readers, 'validateVersion', { configurable: true, value: validate });
        Object.defineProperty(readers, 'initializeOpen', { configurable: true, value: initialize });
      };
    }

    it.each(['validateVersion', 'initializeOpen'] as const)(
      'keeps actual %s and full decoding, with a fresh fallback when its token is dropped',
      (alias) => {
        const seed = seeds[alias];
        const h = fixture(seed);
        const bytes = h.db.serialize();
        const decoder = vi.spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot');
        const counts: number[] = [];
        try {
          for (const drop of [false, true]) {
            let callbacks = 0;
            decoder.mockClear();
            const restore = observe(
              h.ordinary,
              alias,
              (call) => {
                callbacks++;
                expect(call.decodedInside).toBeGreaterThan(0);
              },
              drop,
              () => decoder.mock.calls.length,
            );
            try {
              expect(
                h.db.transaction(() => readSeed(h.ordinary, seed, h.calendar())).deferred(),
              ).toEqual(seed.expected);
              expect(callbacks).toBeGreaterThan(0);
              // Prove the spy sees real decoder calls before comparing the omitted duplicate.
              expect(decoder.mock.calls.length).toBeGreaterThan(0);
              counts.push(decoder.mock.calls.length);
              expect(h.db.serialize().equals(bytes)).toBe(true);
            } finally {
              restore();
            }
          }
        } finally {
          decoder.mockRestore();
        }
        expect(counts).toHaveLength(2);
        expect(counts[1]).toBeGreaterThan(counts[0]!);
      },
    );

    it.each(['validateVersion', 'initializeOpen'] as const)(
      'refuses live foreign, reentered, closed and forged %s tokens while retaining the default path',
      (alias) => {
        const seed = seeds[alias];
        const h = fixture(seed);
        const bytes = h.db.serialize();
        const foreign = createNpcOrdinaryDomainReaders(h.db, fullSource, catalog, artCatalog);
        const captured: ObservedCall[] = [];
        const restore = observe(h.ordinary, alias, (call) => {
          if (captured.length !== 0) return;
          captured.push(call);
          expect(Object.isFrozen(call.token)).toBe(true);
          expect(Reflect.ownKeys(call.token)).toEqual(['kind']);
          expect(call.token).toEqual({ kind: 'NPC_LOCAL_SNAPSHOT_READ' });
          expect(() => call.foreign(foreign)).toThrow(
            'network application storage: SOURCE_CHANGED',
          );
          expect(call.repeat).toThrow('network application storage: SOURCE_CHANGED');
        });
        try {
          expect(
            h.db.transaction(() => readSeed(h.ordinary, seed, h.calendar())).deferred(),
          ).toEqual(seed.expected);
          expect(captured).toHaveLength(1);
          const call = captured[0]!;
          expect(() => h.db.transaction(call.repeat).deferred()).toThrow(
            'network application storage: SOURCE_CHANGED',
          );
          expect(() => h.db.transaction(call.forged).deferred()).toThrow(
            'network application storage: SOURCE_CHANGED',
          );
          expect(h.db.transaction(call.withoutToken).deferred()).toEqual(call.returned);
          expect(h.db.inTransaction).toBe(false);
          expect(h.db.serialize().equals(bytes)).toBe(true);
        } finally {
          restore();
        }
        expect(h.db.transaction(() => readSeed(h.ordinary, seed, h.calendar())).deferred()).toEqual(
          seed.expected,
        );
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );

    it.each(
      (['validateVersion', 'initializeOpen'] as const).flatMap((alias) =>
        (['SQL', 'calendar', 'source', 'method', 'request reader'] as const).map((fault) => ({
          alias,
          fault,
        })),
      ),
    )(
      'refuses $fault changed after actual $alias before local reuse and rolls back',
      ({ alias, fault }) => {
        const seed = seeds[alias];
        const h = fixture(seed);
        const source = { ...fullSource };
        const ordinary = createNpcOrdinaryDomainReaders(h.db, source, catalog, artCatalog);
        const bytes = h.db.serialize();
        const issued = h.db.transaction(() => h.calendar()).deferred();
        const calendar = { ...issued, currentClock: { ...issued.currentClock } };
        const minute = calendar.currentClock.campaignTimestampOrNull;
        const available = source.initialLifeAuthoringAvailable;
        const initialize = ordinary.initializeOpen;
        const requestReader = NPC_GM_REQUEST_READERS.request;
        let mutations = 0;
        const changedRows: number[] = [];
        const restore = observe(ordinary, alias, () => {
          if (mutations !== 0) return;
          mutations++;
          if (fault === 'SQL') {
            const row = s.object(
              h.db
                .prepare(
                  'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=1',
                )
                .get(h.scope.campaignId, seed.version.npcUuid),
            );
            const hash = s.hash(row['record_sha256']);
            const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
            const statement = h.db.prepare(
              'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
            );
            changedRows.push(
              statement.run(changed, h.scope.campaignId, seed.version.npcUuid).changes,
            );
            changedRows.push(statement.run(hash, h.scope.campaignId, seed.version.npcUuid).changes);
          } else if (fault === 'calendar') {
            calendar.currentClock.campaignTimestampOrNull = (minute ?? 0) + 1;
          } else if (fault === 'source') {
            source.initialLifeAuthoringAvailable = !available;
          } else if (fault === 'method') {
            Object.defineProperty(ordinary, 'initializeOpen', {
              configurable: true,
              value(...args: Parameters<typeof initialize>) {
                return initialize.apply(ordinary, args);
              },
            });
          } else {
            Object.defineProperty(NPC_GM_REQUEST_READERS, 'request', {
              configurable: true,
              value(...args: Parameters<typeof requestReader>) {
                return requestReader.apply(NPC_GM_REQUEST_READERS, args);
              },
            });
          }
        });
        try {
          expect(() =>
            h.db.transaction(() => readSeed(ordinary, seed, calendar)).deferred(),
          ).toThrow('network application storage: SOURCE_CHANGED');
          expect(mutations).toBe(1);
          if (fault === 'SQL') expect(changedRows).toEqual([1, 1]);
          expect(h.db.inTransaction).toBe(false);
          expect(h.db.serialize().equals(bytes)).toBe(true);
        } finally {
          restore();
          calendar.currentClock.campaignTimestampOrNull = minute;
          source.initialLifeAuthoringAvailable = available;
          Object.defineProperty(NPC_GM_REQUEST_READERS, 'request', {
            configurable: true,
            value: requestReader,
          });
        }
        expect(h.db.transaction(() => readSeed(ordinary, seed, calendar)).deferred()).toEqual(
          seed.expected,
        );
        expect(h.db.serialize().equals(bytes)).toBe(true);
      },
    );

    function openHistoryPreview() {
      const seed = seeds.validateVersion;
      const h = fixture(seed);
      const app = createNpcHostSupport(h.db, fullSource, artCatalog, () => h.calendar()).connect(
        h.scope,
        () => readGmRequestReviewSource(h.db, h.scope, h.validateOwner),
        (checkpoint, closure) => {
          expect(h.db.inTransaction).toBe(true);
          expect(closure.calendarContext?.checkpoint).toEqual(checkpoint);
        },
        h.validateOwner,
      );
      let attempt = app.workflow(h.openWorkflowRequest(seed.version)).attemptEvent.attempt;
      expect(attempt.targetOrNull?.expectedCurrentVersion).toBe(2);
      // Poison inventory reads require the actual NPC014 confirmation, even for no coatings.
      for (const [action, stage] of [
        ['NPC-002::CTA::001', 'NPC-011'],
        ['NPC-011::CTA::001', 'NPC-012'],
        ['NPC-012::CTA::001', 'NPC-013'],
        ['NPC-013::CTA::001', 'NPC-014'],
        ['NPC-014::CTA::001', 'NPC-015'],
      ] as const)
        attempt = h.navigate(attempt, action, stage).attempt;
      const source = { ...fullSource };
      const ordinary = createNpcOrdinaryDomainReaders(h.db, source, catalog, artCatalog);
      const issued = h.db.transaction(() => h.calendar()).deferred();
      const calendar = { ...issued, operations: [...issued.operations] };
      return {
        h,
        source,
        ordinary,
        calendar,
        bytes: h.db.serialize(),
        read: () =>
          h.db.transaction(() => ordinary.inventoryPreviewForAttempt(attempt, calendar)).deferred(),
      };
    }

    function observeCompletedPrefix(
      opened: Pick<ReturnType<typeof openHistoryPreview>, 'h' | 'ordinary'>,
      afterNestedSql?: (
        life: Parameters<typeof npcHumanoidSheetModule.readNpcHumanoidSnapshot>[8],
      ) => void,
      boundary: 'LOOP' | 'STANDALONE' = 'LOOP',
    ) {
      const history = npcGmSourceModule.readNpcInventoryHistoryEvidenceInTransaction;
      const decode = npcHumanoidSheetModule.readNpcHumanoidSnapshot;
      const selection = opened.ordinary.lifePreparation.selection;
      const seen = {
        anchored: false,
        done: false,
        firstText: '',
        secondText: '',
        firstDecoded: 0,
        secondDecoded: 0,
        nestedSql: 0,
        life: null as Parameters<typeof decode>[8],
        events: [] as string[],
        calendars: [] as {
          footprint: string;
          pointers: string;
          clock: string;
          value: Parameters<typeof selection>[2];
        }[],
      };
      const historySpy = vi
        .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
        .mockImplementation(function (this: unknown, ...args: Parameters<typeof history>) {
          const actual = history.apply(this, args);
          if (args[0] !== opened.h.db) return actual;
          if (!seen.anchored && args[3] === (boundary === 'LOOP' ? 2 : 1)) {
            expect(args[1]).toEqual(opened.h.scope);
            expect(args[2]).toBe(seeds.validateVersion.version.npcUuid);
            expect(actual.map((entry) => entry.version.version)).toEqual(
              boundary === 'LOOP' ? [1, 2] : [1],
            );
            seen.firstText = s.canonical(actual[0]!.stored.record['snapshot']);
            seen.secondText = s.canonical(
              boundary === 'LOOP'
                ? actual[1]!.stored.record['snapshot']
                : seeds.validateVersion.version.snapshot,
            );
            expect(seen.firstText).not.toBe(seen.secondText);
            if (boundary === 'STANDALONE') {
              const proof = s.object(
                s.object(seeds.validateVersion.version.snapshot['derivation'])['inventoryProof'],
              );
              expect({
                ...actual[0]!.version,
                commitOperationId: actual[0]!.stored.operation.operationId,
              }).toEqual(proof['previous']);
            }
            seen.anchored = true;
            seen.events.push(boundary === 'LOOP' ? 'SQL_THROUGH_2' : 'SQL_THROUGH_1_INITIAL');
          } else if (seen.anchored && !seen.done && seen.firstDecoded > 0 && args[3] === 1) {
            // The actual SQL reader has returned; the private prefix guard runs next.
            seen.nestedSql++;
            seen.events.push('SQL_THROUGH_1_AFTER_V1');
            afterNestedSql?.(seen.life);
          }
          return actual;
        });
      const decoderSpy = vi
        .spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot')
        .mockImplementation(function (this: unknown, ...args: Parameters<typeof decode>) {
          const text = seen.anchored && !seen.done ? s.canonical(args[1]) : null;
          const actual = decode.apply(this, args);
          if (text === seen.firstText) {
            seen.firstDecoded++;
            seen.life = args[8];
            seen.events.push('V1_FULL_DECODER_COMPLETED');
          } else if (text === seen.secondText) {
            seen.secondDecoded++;
            seen.events.push('V2_FULL_DECODER_COMPLETED');
            seen.done = true;
          }
          return actual;
        });
      const selectionSpy = vi
        .spyOn(opened.ordinary.lifePreparation, 'selection')
        .mockImplementation(function (this: unknown, ...args: Parameters<typeof selection>) {
          if (seen.anchored && !seen.done) {
            const calendar = args[2];
            seen.calendars.push({
              footprint: s.canonical({ scope: calendar.scope, operations: calendar.operations }),
              pointers: s.canonical([calendar.checkpoint, calendar.currentQueuePrefixOrNull]),
              clock: s.canonical(calendar.currentClock),
              value: calendar,
            });
          }
          return selection.apply(this, args);
        });
      return {
        seen,
        restore() {
          selectionSpy.mockRestore();
          decoderSpy.mockRestore();
          historySpy.mockRestore();
        },
      };
    }

    it('reuses the completed V1 prefix only inside the actual V2 walk, with fresh SQL and historical pointers', () => {
      const opened = openHistoryPreview();
      const footprint = s.canonical({
        scope: opened.calendar.scope,
        operations: opened.calendar.operations,
      });
      const pointers = s.canonical([
        opened.calendar.checkpoint,
        opened.calendar.currentQueuePrefixOrNull,
      ]);
      let historical: Parameters<Readers['snapshot']>[1] = null;
      const snapshot = seeds.validateVersion.version.snapshot;
      const snapshotText = s.canonical(snapshot);
      for (let call = 0; call < 2; call++) {
        const observer = observeCompletedPrefix(opened);
        try {
          expect(opened.read()).toEqual({ items: [] });
          const { seen } = observer;
          expect(seen.anchored).toBe(true);
          expect(seen.done).toBe(true);
          expect(seen.firstDecoded).toBe(1);
          expect(seen.secondDecoded).toBe(1);
          expect(seen.nestedSql).toBeGreaterThan(0);
          expect(seen.events[0]).toBe('SQL_THROUGH_2');
          expect(seen.events.indexOf('SQL_THROUGH_1_AFTER_V1')).toBeGreaterThan(
            seen.events.indexOf('V1_FULL_DECODER_COMPLETED'),
          );
          expect(seen.events.at(-1)).toBe('V2_FULL_DECODER_COMPLETED');
          const historicalCall = seen.calendars.find(
            (calendar) => calendar.footprint === footprint && calendar.pointers !== pointers,
          );
          expect(historicalCall).toBeDefined();
          historical ??= historicalCall?.value ?? null;
          // This empty ALIVE seed proves changed historical pointers, not a changed minute.
          expect(seen.calendars.every((calendar) => calendar.footprint === footprint)).toBe(true);
          expect(opened.h.db.inTransaction).toBe(false);
          expect(opened.h.db.serialize().equals(opened.bytes)).toBe(true);
        } finally {
          observer.restore();
        }
      }
      if (historical === null) throw Error('Actual historical selection calendar required');
      const historicalCalendar = historical;
      // Reuse is observed above; this separate full decode proves saved-calendar equivalence.
      // Retained ALIVE may skip a new selection, so no hidden hit-calendar is inferred.
      const current = opened.h.db
        .transaction(() => opened.ordinary.snapshot(snapshot, opened.calendar, null))
        .deferred();
      const earlier = opened.h.db
        .transaction(() => opened.ordinary.snapshot(snapshot, historicalCalendar, null))
        .deferred();
      expect(current).toEqual(snapshot);
      expect(earlier).toEqual(current);
      expect(s.canonical(snapshot)).toBe(snapshotText);
      expect(opened.h.db.inTransaction).toBe(false);
      expect(opened.h.db.serialize().equals(opened.bytes)).toBe(true);
    }, 60_000);

    it.each(['SQL ABA', 'source', 'operations', 'completed life result'] as const)(
      'refuses %s changed after fresh nested SQL before completed-prefix reuse and rolls back',
      (fault) => {
        const opened = openHistoryPreview();
        const { h, source, calendar } = opened;
        const operations = [...calendar.operations];
        const available = source.initialLifeAuthoringAvailable;
        let mutations = 0;
        const changedRows: number[] = [];
        let changedLife: Parameters<typeof npcHumanoidSheetModule.readNpcHumanoidSnapshot>[8] =
          null;
        let oldLifeMinute: number | null | undefined;
        const observer = observeCompletedPrefix(opened, (life) => {
          if (mutations !== 0) return;
          mutations++;
          if (fault === 'SQL ABA') {
            const npcUuid = seeds.validateVersion.version.npcUuid;
            const row = s.object(
              h.db
                .prepare(
                  'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=1',
                )
                .get(h.scope.campaignId, npcUuid),
            );
            const hash = s.hash(row['record_sha256']);
            const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
            const statement = h.db.prepare(
              'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
            );
            changedRows.push(statement.run(changed, h.scope.campaignId, npcUuid).changes);
            changedRows.push(statement.run(hash, h.scope.campaignId, npcUuid).changes);
          } else if (fault === 'source') {
            source.initialLifeAuthoringAvailable = !available;
          } else if (fault === 'operations') {
            expect(calendar.operations.length).toBeGreaterThan(1);
            calendar.operations.reverse();
            expect(calendar.operations).not.toEqual(operations);
          } else {
            if (life == null) throw Error('Actual completed V1 life context required');
            expect(Object.getOwnPropertyDescriptor(life, 'campaignTimestampOrNull')?.writable).toBe(
              true,
            );
            changedLife = life;
            oldLifeMinute = life.campaignTimestampOrNull;
            expect(Reflect.set(life, 'campaignTimestampOrNull', (oldLifeMinute ?? 0) + 1)).toBe(
              true,
            );
            expect(life.campaignTimestampOrNull).not.toBe(oldLifeMinute);
          }
        });
        try {
          expect(opened.read).toThrow('network application storage: SOURCE_CHANGED');
          expect(observer.seen.anchored).toBe(true);
          expect(observer.seen.firstDecoded).toBe(1);
          expect(observer.seen.nestedSql).toBeGreaterThan(0);
          expect(mutations).toBe(1);
          if (fault === 'SQL ABA') expect(changedRows).toEqual([1, 1]);
          expect(h.db.inTransaction).toBe(false);
          expect(h.db.serialize().equals(opened.bytes)).toBe(true);
        } finally {
          observer.restore();
          source.initialLifeAuthoringAvailable = available;
          calendar.operations.splice(0, calendar.operations.length, ...operations);
          if (changedLife != null)
            Reflect.set(changedLife, 'campaignTimestampOrNull', oldLifeMinute);
        }
        expect(opened.read()).toEqual({ items: [] });
        expect(h.db.serialize().equals(opened.bytes)).toBe(true);
      },
      60_000,
    );

    it('fences the owning inventory preview poison reread after SQL ABA and recovers with fresh SQL without repeating the completed decoder', () => {
      const opened = openHistoryPreview();
      const npcUuid = seeds.validateVersion.version.npcUuid;
      const previousText = s.canonical(seeds.validateVersion.version.snapshot);
      function observe(inject: boolean) {
        const history = npcGmSourceModule.readNpcInventoryHistoryEvidenceInTransaction;
        const decode = npcHumanoidSheetModule.readNpcHumanoidSnapshot;
        const seen = {
          owningReads: 0,
          owningVersions: [] as number[],
          fullDecoders: 0,
          completedPrevious: 0,
          decodersAtFirstNested: -1,
          completedAtFirstNested: -1,
          branches: [] as string[],
          nestedVersions: [] as number[][],
          injected: 0,
          changedRows: [] as number[],
        };
        const historySpy = vi
          .spyOn(npcGmSourceModule, 'readNpcInventoryHistoryEvidenceInTransaction')
          .mockImplementation(function (this: unknown, ...args: Parameters<typeof history>) {
            const actual = history.apply(this, args);
            if (
              args[0] !== opened.h.db ||
              !s.same(args[1], opened.h.scope) ||
              args[2] !== npcUuid ||
              args[3] !== 2
            )
              return actual;
            const previousStackLimit = Error.stackTraceLimit;
            let stack: string;
            try {
              Error.stackTraceLimit = Math.max(previousStackLimit, 100);
              stack = new Error().stack ?? '';
            } finally {
              Error.stackTraceLimit = previousStackLimit;
            }
            const owner = /\bat (?:Object\.)?inventoryPreviewForAttempt \(/.test(stack);
            const poison = /\bat (?:Object\.)?poisonReadBasis(?: \[as read\])? \(/.test(stack);
            if (!owner) return actual;
            // Raw contextAt/editorAt reads also retain the poison ancestor; count only
            // the direct completed-history issuer and each direct poison-basis consumer.
            const directOwner =
              /\bat inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at (?:Object\.)?inventoryPreviewForAttempt \(/.test(
                stack,
              );
            const directBasis =
              /\bat inventoryHistoryRead \([^\r\n]*\)\r?\n\s*at initialStateSourceBasis \([^\r\n]*\)\r?\n\s*at (?:Object\.)?poisonReadBasis(?: \[as read\])? \(/.test(
                stack,
              );
            if (seen.owningReads === 0 && !poison && directOwner) {
              seen.owningReads++;
              seen.owningVersions = actual.map((entry) => entry.version.version);
            } else if (seen.owningReads === 1 && poison && directBasis) {
              const branch = /\bat selectedCoatingIds \(/.test(stack)
                ? 'SELECTED'
                : /\bat timeline \(/.test(stack)
                  ? 'TIMELINE'
                  : 'OTHER';
              seen.branches.push(branch);
              seen.nestedVersions.push(actual.map((entry) => entry.version.version));
              if (seen.decodersAtFirstNested === -1) {
                seen.decodersAtFirstNested = seen.fullDecoders;
                seen.completedAtFirstNested = seen.completedPrevious;
              }
              // The owning history has decoded V2; this exact poison consumer has now
              // returned fresh SQL. Never inject into an earlier nested LOOP read.
              if (
                inject &&
                seen.branches.length === 1 &&
                branch === 'SELECTED' &&
                seen.completedPrevious === 1 &&
                s.same(seen.nestedVersions[0], [1, 2])
              ) {
                const row = s.object(
                  opened.h.db
                    .prepare(
                      'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=1',
                    )
                    .get(opened.h.scope.campaignId, npcUuid),
                );
                const hash = s.hash(row['record_sha256']);
                const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
                const update = opened.h.db.prepare(
                  'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
                );
                seen.changedRows.push(
                  update.run(changed, opened.h.scope.campaignId, npcUuid).changes,
                );
                seen.changedRows.push(update.run(hash, opened.h.scope.campaignId, npcUuid).changes);
                seen.injected++;
              }
            }
            return actual;
          });
        const decoderSpy = vi
          .spyOn(npcHumanoidSheetModule, 'readNpcHumanoidSnapshot')
          .mockImplementation(function (this: unknown, ...args: Parameters<typeof decode>) {
            seen.fullDecoders++;
            const actual = decode.apply(this, args);
            if (seen.owningReads === 1 && s.canonical(args[1]) === previousText)
              seen.completedPrevious++;
            return actual;
          });
        return {
          seen,
          restore() {
            decoderSpy.mockRestore();
            historySpy.mockRestore();
          },
        };
      }

      const rejected = observe(true);
      try {
        let refusal: unknown;
        try {
          opened.read();
        } catch (error) {
          refusal = error;
        }
        expect(rejected.seen.owningReads).toBe(1);
        expect(rejected.seen.owningVersions).toEqual([1, 2]);
        expect(rejected.seen.completedAtFirstNested).toBe(1);
        expect(rejected.seen.decodersAtFirstNested).toBeGreaterThan(0);
        expect(rejected.seen.branches).toEqual(['SELECTED']);
        expect(rejected.seen.nestedVersions).toEqual([[1, 2]]);
        expect(rejected.seen.injected).toBe(1);
        expect(rejected.seen.changedRows).toEqual([1, 1]);
        expect(refusal).toBeInstanceOf(NetworkApplicationStoreError);
        expect(refusal).toMatchObject({ code: 'SOURCE_CHANGED' });
        expect(opened.h.db.inTransaction).toBe(false);
        expect(opened.h.db.serialize().equals(opened.bytes)).toBe(true);
      } finally {
        rejected.restore();
      }

      const recovered = observe(false);
      try {
        expect(opened.read()).toEqual({ items: [] });
        expect(recovered.seen.owningReads).toBe(1);
        expect(recovered.seen.owningVersions).toEqual([1, 2]);
        expect(recovered.seen.completedAtFirstNested).toBe(1);
        expect(recovered.seen.decodersAtFirstNested).toBeGreaterThan(0);
        expect(recovered.seen.branches).toEqual(['SELECTED', 'TIMELINE']);
        expect(recovered.seen.nestedVersions).toEqual([
          [1, 2],
          [1, 2],
        ]);
        expect(recovered.seen.completedPrevious - recovered.seen.completedAtFirstNested).toBe(0);
        expect(recovered.seen.injected).toBe(0);
        expect(opened.h.db.inTransaction).toBe(false);
        expect(opened.h.db.serialize().equals(opened.bytes)).toBe(true);
      } finally {
        recovered.restore();
      }
    }, 60_000);

    function standaloneHistorySnapshot() {
      const seed = seeds.validateVersion;
      const h = fixture(seed);
      const source = { ...fullSource };
      const ordinary = createNpcOrdinaryDomainReaders(h.db, source, catalog, artCatalog);
      const issued = h.db.transaction(() => h.calendar()).deferred();
      const calendar = { ...issued, operations: [...issued.operations] };
      const snapshot = seed.version.snapshot;
      return {
        h,
        source,
        ordinary,
        calendar,
        snapshot,
        bytes: h.db.serialize(),
        read: () => h.db.transaction(() => ordinary.snapshot(snapshot, calendar, null)).deferred(),
      };
    }

    it('reuses the standalone saved V2 predecessor after full V1 decoding and fresh nested SQL only within each call', () => {
      const opened = standaloneHistorySnapshot();
      const snapshotText = s.canonical(opened.snapshot);
      for (let call = 0; call < 2; call++) {
        const observer = observeCompletedPrefix(opened, undefined, 'STANDALONE');
        try {
          expect(opened.read()).toEqual(opened.snapshot);
          const { seen } = observer;
          expect(seen.anchored).toBe(true);
          expect(seen.done).toBe(true);
          expect(seen.firstDecoded).toBe(1);
          expect(seen.secondDecoded).toBe(1);
          expect(seen.nestedSql).toBeGreaterThan(0);
          expect(seen.events[0]).toBe('SQL_THROUGH_1_INITIAL');
          expect(seen.events.indexOf('SQL_THROUGH_1_AFTER_V1')).toBeGreaterThan(
            seen.events.indexOf('V1_FULL_DECODER_COMPLETED'),
          );
          expect(seen.events.at(-1)).toBe('V2_FULL_DECODER_COMPLETED');
          expect(s.canonical(opened.snapshot)).toBe(snapshotText);
          expect(opened.h.db.inTransaction).toBe(false);
          expect(opened.h.db.serialize().equals(opened.bytes)).toBe(true);
        } finally {
          observer.restore();
        }
      }
    });

    it.each(['SQL ABA', 'source', 'operations', 'completed life result'] as const)(
      'refuses %s after fresh nested SQL inside the standalone saved-snapshot issuer and rolls back',
      (fault) => {
        const opened = standaloneHistorySnapshot();
        const { h, source, calendar } = opened;
        const snapshotText = s.canonical(opened.snapshot);
        const operations = [...calendar.operations];
        const available = source.initialLifeAuthoringAvailable;
        let mutations = 0;
        const changedRows: number[] = [];
        let changedLife: Parameters<typeof npcHumanoidSheetModule.readNpcHumanoidSnapshot>[8] =
          null;
        let oldLifeMinute: number | null | undefined;
        const observer = observeCompletedPrefix(
          opened,
          (life) => {
            if (mutations !== 0) return;
            mutations++;
            if (fault === 'SQL ABA') {
              const npcUuid = seeds.validateVersion.version.npcUuid;
              const row = s.object(
                h.db
                  .prepare(
                    'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=1',
                  )
                  .get(h.scope.campaignId, npcUuid),
              );
              const hash = s.hash(row['record_sha256']);
              const changed = hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
              const statement = h.db.prepare(
                'UPDATE npc_version SET record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=1',
              );
              changedRows.push(statement.run(changed, h.scope.campaignId, npcUuid).changes);
              changedRows.push(statement.run(hash, h.scope.campaignId, npcUuid).changes);
            } else if (fault === 'source') {
              source.initialLifeAuthoringAvailable = !available;
            } else if (fault === 'operations') {
              expect(calendar.operations.length).toBeGreaterThan(1);
              calendar.operations.reverse();
              expect(calendar.operations).not.toEqual(operations);
            } else {
              if (life == null) throw Error('Actual standalone predecessor life context required');
              expect(
                Object.getOwnPropertyDescriptor(life, 'campaignTimestampOrNull')?.writable,
              ).toBe(true);
              changedLife = life;
              oldLifeMinute = life.campaignTimestampOrNull;
              expect(Reflect.set(life, 'campaignTimestampOrNull', (oldLifeMinute ?? 0) + 1)).toBe(
                true,
              );
              expect(life.campaignTimestampOrNull).not.toBe(oldLifeMinute);
            }
          },
          'STANDALONE',
        );
        try {
          expect(opened.read).toThrow('network application storage: SOURCE_CHANGED');
          expect(observer.seen.anchored).toBe(true);
          expect(observer.seen.events[0]).toBe('SQL_THROUGH_1_INITIAL');
          expect(observer.seen.firstDecoded).toBe(1);
          expect(observer.seen.nestedSql).toBeGreaterThan(0);
          expect(mutations).toBe(1);
          if (fault === 'SQL ABA') expect(changedRows).toEqual([1, 1]);
          expect(s.canonical(opened.snapshot)).toBe(snapshotText);
          expect(h.db.inTransaction).toBe(false);
          expect(h.db.serialize().equals(opened.bytes)).toBe(true);
        } finally {
          observer.restore();
          source.initialLifeAuthoringAvailable = available;
          calendar.operations.splice(0, calendar.operations.length, ...operations);
          if (changedLife != null)
            Reflect.set(changedLife, 'campaignTimestampOrNull', oldLifeMinute);
        }
        expect(opened.read()).toEqual(opened.snapshot);
        expect(s.canonical(opened.snapshot)).toBe(snapshotText);
        expect(h.db.serialize().equals(opened.bytes)).toBe(true);
      },
    );
  });
}
