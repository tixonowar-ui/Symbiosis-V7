import { previewNpcOrdinarySkills } from '../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import { npcCompositionCurrentSkillInventory } from './npc-composition-preparation.js';
import { randomUUID, randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CommandReceipt,
  FormActionIntentV2Message,
  JsonObject,
  RevisionVector,
} from '@shared/index.js';
import {
  NPC_EDITOR_FORMS,
  NPC_NAV_TARGETS,
  npcTechnicalRequestValue,
  npcWorkflowCommandRequestValue,
  type NpcEditorReplaceRequest,
  type NpcSelectionReplaceRequest,
  type NpcPreparationRequest,
} from '@shared/npc-command.js';
import type {
  NpcArtReadRequest,
  NpcArtReadResult,
  NpcGmProjection,
  NpcEquipmentCompatibilityPreparation,
} from '@shared/npc-presentation.js';
import {
  npcArtReadMessageValue,
  npcArtReadRequestForProjection,
} from '@shared/npc-presentation-codec.js';
import { NpcStagedInputError } from '../domain/rules/npc-authoring/staged-input.js';
import { NpcInventoryPublicationError } from '../domain/rules/npc-authoring/inventory-publication.js';
import {
  appendNpcGmSourceInTransaction,
  appendNpcSelectionInTransaction,
  readGmRequestReviewViewStateInTransaction,
  readNpcGmSourceInTransaction,
  validateNpcPreparationInTransaction,
  validateNpcCommitPreparationInTransaction,
  type CampaignPrivateOwnerValidator,
} from '../persistence/campaign-creation.js';
import {
  commitGmRequestReviewNavigation,
  type GmRequestReviewSource,
} from '../persistence/network-device-request.js';
import { loadCampaignCheckpoint, type CampaignCheckpoint } from '../persistence/store.js';
import {
  saveNpcAttemptPreparedWithEvidence,
  commitNpcVersionPreparedWithEvidence,
  verifyCurrentNpcRead,
  type NpcBoundary,
  type NpcPreparationIntegration,
  type NpcAttemptPreparationContext,
  type NpcCommitPreparationIntegration,
  type NpcRecoveryClosure,
  type NpcRecoveryRead,
} from '../persistence/npc-library-store.js';
import type {
  NpcAttempt,
  NpcAttemptEvent,
  NpcCalendarReadContext,
  NpcDomainReaders,
  NpcHistoricalSourceReader,
  NpcRequestReader,
  NpcOperation,
  NpcScope,
} from '../persistence/npc-library-records.js';
import type { NpcOrdinaryDomainReaders } from './npc-domain-readers.js';
import {
  readNpcRetainedArt,
  readNpcUploadedArt,
  type NpcArtCatalog,
  type NpcResolvedArt,
} from './npc-art.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  createNpcOrdinaryDomainReaders,
  NpcOrdinaryPreviewInputError,
} from './npc-domain-readers.js';
import type { NpcAuthoringSourceCatalog } from './npc-catalog.js';
import { npcEditorForItemAttempt } from './npc-item-preparation.js';
import type { NpcAttemptReadContext } from '../persistence/npc-child-identities.js';
import { NPC_GM_REQUEST_READERS } from '../persistence/npc-gm-source.js';
import { validateNpcHistoricalGmSourcesInTransaction } from '../persistence/campaign-creation.js';
import {
  readNpcEditorDraft,
  applyNpcStageInput,
} from '../domain/rules/npc-authoring/staged-input.js';
import { readNpcIdentityMetadata } from '../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import {
  validateNpcSchema,
  deriveNpcBaseStatLayers,
} from '../domain/rules/npc-authoring/base-stats.js';
import { validateSkillSelection } from '../domain/rules/skill-stage/skills.js';
import type { NpcDraftSection } from '../domain/rules/npc-authoring/types.js';
import {
  projectNpcGm,
  npcEditorPresentation,
  npcPreviewSheetSections,
  type NpcProjectionRead,
  type NpcCheckedPreviewDisplay,
} from './projections/npc.js';
import type { AdmissionHistory } from '../persistence/campaign-admission-player.js';
import { resolveNpcVersionArt } from './npc-art.js';

type Readers = NpcDomainReaders & NpcRequestReader & NpcHistoricalSourceReader;
interface NpcApplicationDependencies {
  readonly database: Database.Database;
  readonly scope: NpcScope;
  readonly readers: Readers;
  readonly domain: Pick<
    NpcOrdinaryDomainReaders,
    | 'initializeOpen'
    | 'prepare'
    | 'itemPreparation'
    | 'compositeItemPreparation'
    | 'customItemPreparation'
    | 'itemRestorePreparation'
    | 'runtimeEffectPreparation'
    | 'lifePreparation'
    | 'initializeNew'
    | 'weaverPreparation'
    | 'poisonPreparation'
    | 'inventoryPreviewForAttempt'
    | 'diseasePreparation'
    | 'traumaPreparation'
    | 'symbiontPreparation'
    | 'woundPreparation'
    | 'equipmentCompatibilityPreparation'
    | 'equipmentForAttempt'
    | 'compositionPreparation'
    | 'applyArtPreparation'
    | 'initialInventoryProfiles'
  >;
  readonly art: NpcArtCatalog;
  readonly validateOwner: CampaignPrivateOwnerValidator;
  /** Rechecks the actual connection, active GM and current campaign history on every entry. */
  readonly readCurrent: () => GmRequestReviewSource;
  /** The real admission/lifecycle/NPC aggregate validator, including AFTER and REPLAY. */
  readonly validateCheckpoint: (
    checkpoint: CampaignCheckpoint,
    checkedClosure: NpcRecoveryClosure,
  ) => void;
  readonly applyStage: (
    previous: JsonObject,
    form: NpcAttempt['stage'],
    values: JsonObject,
    context: NpcAttemptReadContext | null,
  ) => JsonObject;
  readonly validateForward: (
    attempt: NpcAttempt,
    destination: NpcAttempt['stage'],
    context: NpcAttemptPreparationContext,
  ) => void;
}

const json = (value: unknown): JsonObject => JSON.parse(s.canonical(value)) as JsonObject;
function equal(a: unknown, b: unknown): void {
  if (!s.same(a, b)) return s.fail('SOURCE_CHANGED');
}
function stage(value: string): NpcAttempt['stage'] {
  return NPC_EDITOR_FORMS.find((form) => form === value) ?? s.fail('INVALID_INPUT');
}
function vector(value: RevisionVector): RevisionVector {
  return {
    stateRevision: value.stateRevision,
    projectionRevision: value.projectionRevision,
    actorVisibilityRevision: value.actorVisibilityRevision,
  };
}

/** A successful public writer has committed; delivery failure must never become a no-write refusal. */
export class NpcApplicationPublicationError extends Error {
  constructor(cause: unknown) {
    super('NPC committed operation publication failed', { cause });
    this.name = 'NpcApplicationPublicationError';
  }
}
function publication<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new NpcApplicationPublicationError(error);
  }
}

/** One existing authenticated QUEUE and scheduler own this adapter; it creates neither. */
export function createNpcApplication(d: NpcApplicationDependencies) {
  const db = d.database,
    own = d.scope;
  const current = () => {
    const source = d.readCurrent();
    equal(source.scope, own);
    return source;
  };
  const integration: NpcPreparationIntegration & NpcCommitPreparationIntegration = {
    readCheckedGmSource(boundary) {
      equal(boundary.scope, own);
      current();
      return readNpcGmSourceInTransaction(db, own);
    },
    validate(boundary, checkpoint, _phase, checkedClosure) {
      equal(boundary.scope, own);
      const source = current();
      if (source.currentCampaign.stateRevision !== checkpoint.stateRevision)
        return s.fail('SOURCE_CHANGED');
      d.validateCheckpoint(checkpoint, checkedClosure);
    },
    validatePreparation(context) {
      current();
      validateNpcPreparationInTransaction(db, context);
    },
    validateCommitPreparation(context) {
      current();
      validateNpcCommitPreparationInTransaction(db, context);
    },
    writeGmMirror(operation) {
      appendNpcGmSourceInTransaction(db, own, operation);
    },
  };
  function readInTransaction() {
    const source = current(),
      checkpoint = loadCampaignCheckpoint(db, own.campaignId);
    const read = verifyCurrentNpcRead(db, checkpoint, d.readers);
    const { closure } = read;
    d.validateCheckpoint(checkpoint, closure);
    if (source.currentCampaign.stateRevision !== checkpoint.stateRevision)
      return s.fail('SOURCE_CHANGED');
    return { source, checkpoint, ...read };
  }
  function read() {
    return db.inTransaction ? readInTransaction() : db.transaction(readInTransaction).deferred();
  }
  function eventFor(closure: NpcRecoveryClosure, operationId: string) {
    return (
      closure.attempts.find((event) => event.operationId === operationId) ?? s.fail('NOT_FOUND')
    );
  }
  function applied(operation: NpcOperation) {
    const state = db.inTransaction
      ? readGmRequestReviewViewStateInTransaction(db, own)
      : db.transaction(() => readGmRequestReviewViewStateInTransaction(db, own)).deferred();
    const events = state.events.filter(
      (event) =>
        event.mutation.kind === 'NPC_SOURCE' &&
        event.mutation.cause.operationId === operation.operationId,
    );
    if (events.length !== 1) return s.fail('SOURCE_CHANGED');
    return vector((events[0] ?? s.fail()).view);
  }
  function boundary(
    kind: NpcBoundary['kind'],
    operationId: string,
    request: JsonObject,
    attemptRevision: number | null,
    currentVersion: number | null,
  ): NpcBoundary {
    return {
      scope: own,
      kind,
      operationId,
      request,
      expectedAttemptRevisionOrNull: attemptRevision,
      expectedCurrentVersionOrNull: currentVersion,
    };
  }
  function saved(
    kind: 'CREATE' | 'OPEN',
    request: JsonObject,
    operationId: string,
    target: NpcAttempt['targetOrNull'],
  ) {
    return saveNpcAttemptPreparedWithEvidence(
      db,
      boundary(kind, operationId, request, null, target?.expectedCurrentVersion ?? null),
      kind === 'CREATE' ? { kind: 'CREATE' } : { kind: 'OPEN', target: target ?? s.fail() },
      (context) => ({
        next: {
          scope: own,
          npcDraftId: randomUUID(),
          candidateNpcUuid: kind === 'CREATE' ? randomUUID() : (target ?? s.fail()).npcUuid,
          revision: 0,
          mode: kind === 'CREATE' ? 'CREATE_V1' : 'APPEND_N_PLUS_ONE',
          targetOrNull: target,
          stage: 'NPC-002',
          status: 'OPEN',
          values:
            kind === 'CREATE'
              ? d.domain.initializeNew()
              : d.domain.initializeOpen(
                  context.baseVersionOrNull ?? s.fail(),
                  context.calendarContext ?? s.fail(),
                ),
        },
        receiptId: randomUUID(),
        committedAt: new Date().toISOString(),
      }),
      d.readers,
      integration,
    );
  }
  function navigation(request: FormActionIntentV2Message) {
    // This public QUEUE writer owns its IMMEDIATE transaction; nesting is refused.
    if (
      request.actionKey !== 'NPC-001::CTA::001' &&
      !NPC_EDITOR_FORMS.some((form) => form === request.sourceFormId)
    ) {
      const value = commitGmRequestReviewNavigation(db, own, request, d.validateOwner, (actual) => {
        equal(actual.scope, own);
        current();
      });
      return { navigation: value };
    }
    const { source, closure } = read();
    const destination = NPC_NAV_TARGETS[request.actionKey as keyof typeof NPC_NAV_TARGETS];
    if (destination === undefined || request.sourceFormId !== request.actionKey.split('::')[0])
      return s.fail('INVALID_INPUT');
    const previousOperation = closure.operations.find(
      (operation) => operation.operationId === request.navigationRequestId,
    );
    // The immutable event provides the old attempt identity for exact replay after cancel/commit.
    if (request.actionKey === 'NPC-001::CTA::001') {
      const result = saved('CREATE', json(request), request.navigationRequestId, null);
      return publication(() => ({ ...result, appliedRevisions: applied(result.operation) }));
    }
    const old =
      previousOperation === undefined
        ? closure.attempts
            .filter(
              (event) =>
                event.attempt.npcDraftId === source.viewOrNull?.npc?.attemptOrNull?.npcDraftId,
            )
            .at(-1)?.attempt
        : eventFor(closure, previousOperation.operationId).attempt;
    if (old === undefined) return s.fail('UNAVAILABLE');
    const revision = previousOperation === undefined ? old.revision : old.revision - 1;
    const kind = request.actionKey === 'NPC-002::CTA::003' ? 'CANCEL' : 'REPLACE';
    const result = saveNpcAttemptPreparedWithEvidence(
      db,
      boundary(kind, request.navigationRequestId, json(request), revision, null),
      { kind: 'EXISTING', npcDraftId: old.npcDraftId },
      (context) => {
        const previous = (context.previousOrNull ?? s.fail()).attempt;
        const nextStage =
          destination === 'NET-016' || kind === 'CANCEL' ? previous.stage : stage(destination);
        if (NPC_EDITOR_FORMS.indexOf(nextStage) > NPC_EDITOR_FORMS.indexOf(previous.stage))
          d.validateForward(previous, nextStage, context);
        return {
          next: {
            ...previous,
            revision: previous.revision + 1,
            stage: nextStage,
            status: kind === 'CANCEL' ? 'CANCELLED' : 'OPEN',
          },
          receiptId: randomUUID(),
          committedAt: new Date().toISOString(),
        };
      },
      d.readers,
      integration,
    );
    return publication(() => ({ ...result, appliedRevisions: applied(result.operation) }));
  }
  function replace(value: NpcEditorReplaceRequest) {
    const request = npcTechnicalRequestValue(value);
    if (request.messageType !== 'network.npc-editor.replace') return s.fail('INVALID_INPUT');
    equal(request.campaignId, own.campaignId);
    current();
    const result = saveNpcAttemptPreparedWithEvidence(
      db,
      boundary(
        'REPLACE',
        request.operationId,
        json(request),
        request.expectedAttemptRevision,
        null,
      ),
      { kind: 'EXISTING', npcDraftId: request.npcDraftId },
      (context) => {
        const previous = (context.previousOrNull ?? s.fail()).attempt;
        return {
          next: {
            ...previous,
            revision: previous.revision + 1,
            values: d.applyStage(
              previous.values,
              request.sourceFormId,
              request.values,
              context.previousReadContextOrNull ?? s.fail(),
            ),
          },
          receiptId: randomUUID(),
          committedAt: new Date().toISOString(),
        };
      },
      d.readers,
      integration,
    );
    return publication(() => ({
      ...result,
      appliedAttemptRevision: result.attemptEvent.attempt.revision,
      appliedRevisions: applied(result.operation),
    }));
  }
  function prepare(value: NpcPreparationRequest) {
    const request = npcTechnicalRequestValue(value);
    if (request.messageType !== 'network.npc-preparation.request') return s.fail('INVALID_INPUT');
    equal(request.campaignId, own.campaignId);
    current();
    const result = saveNpcAttemptPreparedWithEvidence(
      db,
      boundary(
        'REPLACE',
        request.operationId,
        json(request),
        request.expectedAttemptRevision,
        null,
      ),
      { kind: 'EXISTING', npcDraftId: request.npcDraftId },
      (context) => {
        const previous = (context.previousOrNull ?? s.fail()).attempt;
        const proof = context.previousReadContextOrNull ?? s.fail();
        if (
          request.sourceFormId === 'NPC-013' &&
          (request.preparation.kind === 'COMPOSITION_CONFIRM' ||
            request.preparation.kind === 'COMPOSITION_RESOLVE')
        ) {
          const prepared = d.domain.compositionPreparation.prepare(request, context, (sides) =>
            randomInt(1, sides + 1),
          );
          return {
            next: {
              ...previous,
              revision: s.increment(previous.revision),
              values: prepared.values,
            },
            ordinaryFact: prepared.ordinaryFact,
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.sourceFormId === 'NPC-013' && request.preparation.kind === 'SYMBIONT_RESERVE') {
          const symbiontInstanceId = randomUUID();
          return {
            next: {
              ...previous,
              revision: s.increment(previous.revision),
              values: d.domain.symbiontPreparation.apply(
                previous.values,
                request.preparation.values,
                symbiontInstanceId,
                proof,
                request.operationId,
              ),
            },
            childAllocations: [{ kind: 'SYMBIONT_INSTANCE', id: symbiontInstanceId }],
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.preparation.kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM') {
          return {
            next: {
              ...previous,
              revision: s.increment(previous.revision),
              values: d.domain.equipmentCompatibilityPreparation.apply(
                previous.values,
                request.preparation.input,
                proof,
              ),
            },
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.sourceFormId === 'NPC-015' && request.preparation.kind === 'ITEM_RESERVE') {
          const itemId = randomUUID();
          return {
            next: {
              ...previous,
              revision: previous.revision + 1,
              values: d.domain.itemPreparation.apply(
                previous.values,
                request.preparation.values,
                itemId,
                proof,
                request.operationId,
              ),
            },
            childAllocations: [{ kind: 'ITEM', id: itemId }],
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.preparation.kind === 'ITEM_RESTORE')
          return d.domain.itemRestorePreparation.prepare(
            request,
            context,
            randomUUID(),
            new Date().toISOString(),
          );
        if (
          request.preparation.kind === 'CUSTOM_ITEM_RESERVE' ||
          request.preparation.kind === 'CUSTOM_MODIFIER_RESERVE' ||
          request.preparation.kind === 'CUSTOM_PROFILE_VERSION_RESERVE'
        )
          return d.domain.customItemPreparation.prepare(
            request,
            context,
            randomUUID,
            new Date().toISOString(),
          );
        if (request.preparation.kind === 'COMPOSITE_ITEM_RESERVE') {
          const itemTypeId = request.preparation.input.itemTypeId,
            linkedSetInstanceId = randomUUID();
          const components = [
            {
              itemInstanceId: randomUUID(),
              componentRole:
                itemTypeId === 'ITM-WPN-026' ? ('SWORD' as const) : ('RAPIER' as const),
            },
            { itemInstanceId: randomUUID(), componentRole: 'SHIELD' as const },
          ];
          return {
            next: {
              ...previous,
              revision: s.increment(previous.revision),
              values: d.domain.compositeItemPreparation.apply(
                previous.values,
                request.preparation.input,
                { linkedSetInstanceId, itemTypeId, components },
                proof,
                request.operationId,
              ),
            },
            childAllocations: [
              { kind: 'LINKED_SET', id: linkedSetInstanceId, itemTypeId },
              ...components.map((component) => ({
                kind: 'ITEM' as const,
                id: component.itemInstanceId,
              })),
            ],
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.sourceFormId === 'NPC-016' && request.preparation.kind === 'WOUND_PREPARE') {
          const woundInstanceId = randomUUID();
          return {
            next: {
              ...previous,
              revision: s.increment(previous.revision),
              values: d.domain.woundPreparation.apply(
                previous.values,
                request.preparation.input,
                woundInstanceId,
                proof,
                request.operationId,
              ),
            },
            childAllocations: [{ kind: 'WOUND_INSTANCE', id: woundInstanceId }],
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (
          request.sourceFormId === 'NPC-016' &&
          (request.preparation.kind === 'ALCOHOL_PREPARE' ||
            request.preparation.kind === 'HP_MODE_PREPARE' ||
            request.preparation.kind === 'FORMAL_CONTROL_SET')
        )
          return d.domain.runtimeEffectPreparation.prepare(
            request,
            context,
            randomUUID,
            new Date().toISOString(),
          );
        if (
          request.sourceFormId === 'NPC-016' &&
          (request.preparation.kind === 'LIFE_STATE_ROLL' ||
            request.preparation.kind === 'LIFE_STATE_SET')
        )
          return d.domain.lifePreparation.prepare(
            request,
            context,
            randomUUID,
            (sides) => randomInt(1, sides + 1),
            new Date().toISOString(),
          );
        if (
          request.sourceFormId === 'NPC-016' &&
          (request.preparation.kind === 'WEAVER_STATE_PREPARE' ||
            request.preparation.kind === 'WEAVER_STATE_REMOVE')
        )
          return d.domain.weaverPreparation.prepare(
            request,
            context,
            randomUUID,
            new Date().toISOString(),
          );
        if (
          (request.sourceFormId === 'NPC-016' && request.preparation.kind === 'POISON_MODE_SET') ||
          (request.sourceFormId === 'NPC-015' &&
            (request.preparation.kind === 'POISON_COATING_PREPARE' ||
              request.preparation.kind === 'POISON_COATING_REMOVE'))
        )
          return d.domain.poisonPreparation.prepare(
            request,
            context,
            randomUUID,
            new Date().toISOString(),
          );
        if (request.sourceFormId === 'NPC-016' && request.preparation.kind === 'TRAUMA_RESERVE') {
          const traumaInstanceId = randomUUID();
          return {
            next: {
              ...previous,
              revision: previous.revision + 1,
              values: d.domain.traumaPreparation.apply(
                previous.values,
                traumaInstanceId,
                proof,
                request.operationId,
              ),
            },
            childAllocations: [{ kind: 'TRAUMA_INSTANCE', id: traumaInstanceId }],
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.sourceFormId === 'NPC-016' && request.preparation.kind === 'DISEASE_RESERVE') {
          const effectInstanceId = randomUUID();
          return {
            next: {
              ...previous,
              revision: previous.revision + 1,
              values: d.domain.diseasePreparation.apply(
                previous.values,
                request.preparation.diseaseId,
                effectInstanceId,
                proof,
                request.operationId,
              ),
            },
            childAllocations: [
              {
                kind: 'EFFECT_INSTANCE',
                id: effectInstanceId,
                diseaseId: request.preparation.diseaseId,
              },
            ],
            receiptId: randomUUID(),
            committedAt: new Date().toISOString(),
          };
        }
        if (request.sourceFormId !== 'NPC-002') return s.fail('UNAVAILABLE');
        return {
          next: {
            ...previous,
            revision: previous.revision + 1,
            values: d.domain.applyArtPreparation(previous.values, request.preparation, proof),
          },
          receiptId: randomUUID(),
          committedAt: new Date().toISOString(),
        };
      },
      d.readers,
      integration,
    );
    return publication(() => ({
      ...result,
      appliedAttemptRevision: result.attemptEvent.attempt.revision,
      appliedRevisions: applied(result.operation),
    }));
  }
  function select(value: NpcSelectionReplaceRequest) {
    const request = npcTechnicalRequestValue(value);
    if (request.messageType !== 'network.npc-selection.replace') return s.fail('INVALID_INPUT');
    equal(request.campaignId, own.campaignId);
    return db
      .transaction(() => {
        readInTransaction();
        const before = readGmRequestReviewViewStateInTransaction(db, own);
        const known = before.events.find((event) => event.eventId === request.operationId);
        if (known !== undefined) {
          equal(known.mutation, { kind: 'NPC_SELECTION', request });
          return { replayed: true, appliedRevisions: vector(known.view) };
        }
        const result = appendNpcSelectionInTransaction(db, own, request);
        readInTransaction();
        return { replayed: false, appliedRevisions: vector(result.view) };
      })
      .immediate();
  }
  function workflow(value: unknown) {
    const request = npcWorkflowCommandRequestValue(value);
    equal(request.payload.campaignId, own.campaignId);
    current();
    if (
      request.workflowCommandId === 'UI-CMD-NPC-NEW-VERSION' &&
      request.payload.phase === 'OPEN'
    ) {
      const result = saved('OPEN', json(request), request.commandId, {
        npcUuid: request.payload.npcUuid,
        expectedCurrentVersion: request.payload.expectedCurrentVersion,
      });
      return publication(() => ({
        ...result,
        receipt: receipt(result.operation, result.attemptEvent),
      }));
    }
    const kind = request.workflowCommandId === 'UI-CMD-NPC-COMMIT-V1' ? 'COMMIT_V1' : 'COMMIT';
    if (
      request.workflowCommandId === 'UI-CMD-NPC-NEW-VERSION' &&
      request.payload.phase !== 'COMMIT'
    )
      return s.fail('INVALID_INPUT');
    const payload = request.payload;
    if ('phase' in payload && payload.phase === 'OPEN') return s.fail('INVALID_INPUT');
    const result = commitNpcVersionPreparedWithEvidence(
      db,
      boundary(
        kind,
        request.commandId,
        json(request),
        payload.expectedAttemptRevision,
        request.workflowCommandId === 'UI-CMD-NPC-NEW-VERSION'
          ? request.payload.expectedCurrentVersion
          : null,
      ),
      payload.npcDraftId,
      (context) => {
        const committedAt = new Date().toISOString();
        const profiles = d.domain
          .initialInventoryProfiles(
            context.previous.attempt,
            context.attemptReadContext,
            context.previousVersionOrNull,
            context.calendarContext ?? s.fail(),
          )
          .map((entry) => ({ ...entry, weaponProfileVersionId: randomUUID() }));
        const prepared = d.domain.prepare(
          context.previous.attempt,
          request.commandId,
          context.previousVersionOrNull,
          context.calendarContext ?? s.fail(),
          { committedAt, beforeGmSource: context.beforeGmSource },
          profiles.length === 0
            ? undefined
            : {
                committedAt,
                profiles: profiles.map(({ itemInstanceId, weaponProfileVersionId }) => ({
                  itemInstanceId,
                  weaponProfileVersionId,
                })),
              },
        );
        return {
          ...prepared,
          ...(profiles.length === 0
            ? {}
            : {
                childAllocations: profiles.map((profile) => ({
                  kind: 'WEAPON_PROFILE_VERSION' as const,
                  id: profile.weaponProfileVersionId,
                  itemInstanceId: profile.itemInstanceId,
                  weaponVariantId: profile.weaponVariantId,
                })),
              }),
          npcDraftId: context.previous.attempt.npcDraftId,
          npcUuid: context.previous.attempt.candidateNpcUuid,
          receiptId: randomUUID(),
          checkpointId: randomUUID(),
          committedAt,
          projectionChanged: true,
          visibilityChanged: false,
        };
      },
      d.readers,
      integration,
    );
    return publication(() => ({
      ...result,
      receipt: receipt(result.operation, result.attemptEvent),
    }));
  }
  function receipt(operation: NpcOperation, event: NpcAttemptEvent): CommandReceipt {
    if (operation.kind !== 'OPEN' && operation.kind !== 'COMMIT' && operation.kind !== 'COMMIT_V1')
      return s.fail('INVALID_INPUT');
    const request = npcWorkflowCommandRequestValue(operation.request);
    equal(
      [event.operationId, s.sha(s.canonical(event)), event.attempt.scope],
      [operation.operationId, operation.attemptEventSha256, own],
    );
    const attempt = event.attempt;
    return {
      commandId: operation.operationId,
      receiptId: operation.receiptId,
      revisions: applied(operation),
      result: {
        workflowCommandId: request.workflowCommandId,
        contextId: own.gmLocalContextId,
        campaignId: own.campaignId,
        npcDraftId: attempt.npcDraftId,
        npcUuid: attempt.candidateNpcUuid,
        versionOrNull: operation.versionOrNull?.version ?? null,
        operationKind: operation.kind,
        committedAt: operation.committedAt,
      },
    };
  }
  /** Membership is checked against this synchronous current projection, not merely a known hash. */
  function artRead(
    value: NpcArtReadRequest,
    projection: () => NpcGmProjection,
    attemptArt: (attempt: NpcAttempt, read: NpcRecoveryRead) => NpcResolvedArt | null,
  ): NpcArtReadResult {
    return db
      .transaction(() => {
        const request = npcArtReadMessageValue(value);
        if (request.messageType !== 'network.npc-art.read') return s.fail('INVALID_INPUT');
        const state = readInTransaction(),
          p = projection();
        equal([p.contextId, p.campaignId], [own.gmLocalContextId, own.campaignId]);
        const expected = npcArtReadRequestForProjection(request, p);
        equal(request, expected);
        let art: NpcResolvedArt;
        if (request.target.kind === 'VERSION') {
          const target = request.target;
          const version =
            state.closure.versions.find(
              (v) => v.npcUuid === target.npcUuid && v.version === target.version,
            ) ?? s.fail('NOT_FOUND');
          equal(version.scope, own);
          const blob =
            state.closure.art.find((entry) => entry.sha256 === version.art.sha256) ?? s.fail();
          art = readNpcRetainedArt(d.art, { ...blob, assetKey: version.art.assetKey });
        } else {
          const target = request.target;
          const attempt =
            state.closure.attempts.filter((e) => e.attempt.npcDraftId === target.npcDraftId).at(-1)
              ?.attempt ?? s.fail('NOT_FOUND');
          if (attempt.status !== 'OPEN' || attempt.revision !== target.expectedAttemptRevision)
            return s.fail('STALE_REVISION');
          art = attemptArt(attempt, state) ?? s.fail('NOT_FOUND');
        }
        equal([art.assetKey, art.sha256], [request.assetKey, request.checksum]);
        const { messageType: _requestType, ...binding } = request;
        return npcArtReadMessageValue({
          ...binding,
          messageType: 'network.npc-art.result',
          mediaType: art.mediaType,
          bytesBase64: art.bytesBase64,
        }) as NpcArtReadResult;
      })
      .deferred();
  }
  return {
    read,
    navigation,
    replace,
    prepare,
    select,
    workflow,
    artRead,
    receipt(operationId: string): CommandReceipt | null {
      return db
        .transaction(() => {
          const closure = readInTransaction().closure;
          const found = closure.operations.find(
            (operation) => operation.operationId === operationId,
          );
          return found === undefined || !['OPEN', 'COMMIT', 'COMMIT_V1'].includes(found.kind)
            ? null
            : receipt(found, eventFor(closure, found.operationId));
        })
        .deferred();
    },
  };
}

/** Source catalogs are loaded once by the server; every data read still proves the current journal. */
export function createNpcHostSupport(
  database: Database.Database,
  catalog: NpcAuthoringSourceCatalog,
  art: NpcArtCatalog,
  createReadContext: (campaignId: string) => NpcCalendarReadContext,
) {
  const editor = {
    skills: catalog.skills,
    development: catalog.development,
    traumas: { catalog: catalog.initialTrauma, bindings: [] },
  };
  const domain = createNpcOrdinaryDomainReaders(database, catalog, editor, art);
  const applyStage = (
    previous: JsonObject,
    form: NpcAttempt['stage'],
    values: JsonObject,
    context: NpcAttemptReadContext | null = null,
  ) => {
    const scoped = npcEditorForItemAttempt(editor, catalog.inventory, context);
    const before = readNpcEditorDraft(scoped, previous);
    const next = applyNpcStageInput(scoped, previous, form, values);
    if (form === 'NPC-015' && context !== null)
      domain.validateInventoryCoatingSelection(previous, next, context);
    // Portrait changes have their own closed preparation; a generic stage edit cannot forge a key.
    equal(next.identity.artAssetKeyOrNull, before.identity.artAssetKeyOrNull);
    return json(next);
  };
  const readers: Readers = {
    ...domain,
    ...NPC_GM_REQUEST_READERS,
    createReadContext,
    validateHistoricalGmSources(entries, calendar) {
      validateNpcHistoricalGmSourcesInTransaction(
        database,
        entries,
        applyStage,
        domain.itemPreparation.apply,
        domain.applyArtPreparation,
        domain.diseasePreparation.apply,
        domain.traumaPreparation.apply,
        domain.symbiontPreparation.apply,
        (operation, event, previous, context) =>
          domain.compositionPreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? s.fail(),
          ),
        domain.woundPreparation.apply,
        domain.equipmentCompatibilityPreparation.apply,
        domain.compositeItemPreparation.apply,
        (operation, event, previous, context) =>
          domain.runtimeEffectPreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? s.fail(),
          ),
        (operation, event, previous, context) =>
          domain.customItemPreparation.apply(operation, event, previous, context),
        (operation, event, previous, context) =>
          domain.lifePreparation.apply(operation, event, previous, context, calendar ?? s.fail()),
        (operation, event, previous, context) =>
          domain.itemRestorePreparation.apply(
            operation,
            event,
            previous,
            context,
            calendar ?? s.fail(),
          ),
        (operation, event, previous, context) =>
          domain.weaverPreparation.apply(operation, event, previous, context, calendar ?? s.fail()),
        (operation, event, previous, context) =>
          domain.poisonPreparation.apply(operation, event, previous, context, calendar ?? s.fail()),
      );
    },
  };
  function previousVersion(attempt: NpcAttempt, closure: NpcRecoveryClosure) {
    const target = attempt.targetOrNull;
    return target === null
      ? null
      : (closure.versions.find(
          (v) => v.npcUuid === target.npcUuid && v.version === target.expectedCurrentVersion,
        ) ?? s.fail());
  }
  function currentAttemptContext(attempt: NpcAttempt, read: NpcRecoveryRead) {
    const event =
      read.closure.attempts.find(
        (e) =>
          e.attempt.npcDraftId === attempt.npcDraftId && e.attempt.revision === attempt.revision,
      ) ?? s.fail();
    equal(event.attempt, attempt);
    const context =
      read.attemptReadContexts.find((row) => row.operationId === event.operationId) ?? s.fail();
    equal(
      [context.scope, context.npcDraftId, context.candidateNpcUuid, context.revision],
      [attempt.scope, attempt.npcDraftId, attempt.candidateNpcUuid, attempt.revision],
    );
    return context;
  }
  function draftFor(attempt: NpcAttempt, read: NpcRecoveryRead) {
    return readNpcEditorDraft(
      npcEditorForItemAttempt(editor, catalog.inventory, currentAttemptContext(attempt, read)),
      attempt.values,
    );
  }
  function attemptArt(attempt: NpcAttempt, read: NpcRecoveryRead): NpcResolvedArt | null {
    const { closure } = read;
    const draft = draftFor(attempt, read),
      chosen = draft.identity.artAssetKeyOrNull;
    if (chosen.kind === 'UNSET') return null;
    if (chosen.value !== null) {
      const defaultArt = art.defaults.find((d) => d.art.assetKey === chosen.value)?.art;
      if (defaultArt !== undefined) return readNpcRetainedArt(art, defaultArt);
      const previous = previousVersion(attempt, closure);
      if (previous !== null && previous.art.assetKey === chosen.value) {
        const bytes = closure.art.find((b) => b.sha256 === previous.art.sha256) ?? s.fail();
        return readNpcRetainedArt(art, { ...bytes, assetKey: previous.art.assetKey });
      }
      const ids = new Set(
        closure.attempts
          .filter(
            (e) =>
              e.attempt.npcDraftId === attempt.npcDraftId && e.attempt.revision <= attempt.revision,
          )
          .map((e) => e.operationId),
      );
      for (const operation of closure.operations) {
        if (
          !ids.has(operation.operationId) ||
          operation.request['messageType'] !== 'network.npc-preparation.request'
        )
          continue;
        const request = npcTechnicalRequestValue(operation.request);
        if (request.messageType !== 'network.npc-preparation.request') return s.fail();
        if (request.sourceFormId === 'NPC-002' && request.preparation.kind === 'ART_UPLOAD') {
          const uploaded = readNpcUploadedArt(request.preparation.file);
          if (uploaded.assetKey === chosen.value) return uploaded;
        }
      }
      return s.fail('SOURCE_CHANGED');
    }
    const race = draft.schema.raceCode,
      sex = draft.identity.sex;
    if (race.kind === 'UNSET' || sex.kind === 'UNSET') return null;
    return resolveNpcVersionArt(
      art,
      { kind: 'REPLACE', value: null },
      { raceCode: race.value, sex: sex.value, previousArtOrNull: null },
    );
  }
  const entered = <T>(field: NpcDraftSection<T>): T =>
    field.kind === 'ENTERED' ? field.value : s.fail('INVALID_INPUT');
  const enteredFields = <T extends Readonly<Record<string, NpcDraftSection<unknown>>>>(value: T) =>
    Object.fromEntries(Object.entries(value).map(([key, field]) => [key, entered(field)]));
  function forward(attempt: NpcAttempt, context: NpcAttemptPreparationContext) {
    const previous = context.previousOrNull ?? s.fail();
    equal(previous.attempt, attempt);
    const readContext = context.previousReadContextOrNull ?? s.fail();
    equal(
      [
        readContext.scope,
        readContext.npcDraftId,
        readContext.candidateNpcUuid,
        readContext.revision,
        readContext.operationId,
      ],
      [
        attempt.scope,
        attempt.npcDraftId,
        attempt.candidateNpcUuid,
        attempt.revision,
        previous.operationId,
      ],
    );
    const scoped = npcEditorForItemAttempt(editor, catalog.inventory, readContext);
    const draft = readNpcEditorDraft(scoped, attempt.values);
    if (attempt.stage === 'NPC-002') {
      readNpcIdentityMetadata(catalog.cleanHumanoid, enteredFields(draft.identity));
      return;
    }
    const schema = {
      ...enteredFields(draft.schema),
      sex: entered(draft.identity.sex),
      massKg: entered(draft.identity.massKg),
    };
    validateNpcSchema(catalog.baseStats, schema);
    if (attempt.stage === 'NPC-011') return;
    const layers = deriveNpcBaseStatLayers(catalog.baseStats, {
      schema,
      baseStats: enteredFields(draft.baseStats),
    });
    if (attempt.stage === 'NPC-012') return;
    const composition = domain.compositionPreparation.read(
      attempt,
      readContext,
      context.calendarContext ?? s.fail(),
    );
    domain.compositionPreparation.forward(composition);
    if (attempt.stage === 'NPC-013') return;
    if (composition.ordinaryProof !== null)
      previewNpcOrdinarySkills(catalog.ordinaryHumanoid, {
        ...npcCompositionCurrentSkillInventory(catalog, composition),
        npcUuid: attempt.candidateNpcUuid,
        compositionProof: composition.compositionProof,
        ordinaryProof: composition.ordinaryProof,
        previousSkillProofOrNull: composition.skillProofOrNull,
        selections: entered(draft.skills).map((skill) => ({
          skillKey: entered(skill.skillKey),
          targetBonus: entered(skill.targetBonus),
          pool: entered(skill.pool),
        })),
      });
    else {
      const selectedSkills = entered(draft.skills).map((skill) => {
        if (entered(skill.pool) !== 'START') return s.fail('UNAVAILABLE');
        return { skillKey: entered(skill.skillKey), targetBonus: entered(skill.targetBonus) };
      });
      validateSkillSelection(catalog.skills, {
        raceCode: layers.schema.raceCode,
        classCode: layers.schema.pureClassOrNull,
        skillStageStats: layers.skillStageStats,
        selectedSkills,
      });
    }
    if (attempt.stage === 'NPC-014') return;
    domain.inventoryPreviewForAttempt(attempt, context.calendarContext ?? s.fail());
    if (attempt.stage === 'NPC-015') {
      const equipment = domain.equipmentCompatibilityPreparation.inspect(
        attempt.values,
        readContext,
      );
      if (
        equipment.orderedItems.length !== 0 &&
        domain.equipmentForAttempt(attempt, context.calendarContext ?? s.fail())?.proof
          .compatibilityProofOrNull == null
      )
        return s.fail('INVALID_INPUT');
      return;
    }
    const calendar = context.calendarContext ?? s.fail();
    const preview = domain.preview(
      attempt,
      context.inheritedVersionForPreviousAttemptOrNull,
      calendar,
    );
    // NPC016 may preview an uncommitted selection without time; its forward CTA has the stricter Atlas guard.
    if (
      preview.sheet.requiresCampaignTime &&
      calendar.currentClock.campaignTimestampOrNull === null
    )
      return s.fail('INVALID_INPUT');
  }
  function openAttempt(
    source: GmRequestReviewSource,
    closure: NpcRecoveryClosure,
  ): NpcAttempt | null {
    const ref = source.viewOrNull?.npc?.attemptOrNull;
    if (ref === null || ref === undefined) return null;
    const attempt =
      closure.attempts.find(
        (e) => e.attempt.npcDraftId === ref.npcDraftId && e.attempt.revision === ref.revision,
      )?.attempt ?? s.fail();
    if (attempt.status !== 'OPEN') return s.fail();
    equal(
      [attempt.candidateNpcUuid, attempt.mode, attempt.targetOrNull, attempt.stage],
      [ref.candidateNpcUuid, ref.mode, ref.targetOrNull, ref.stage],
    );
    return attempt;
  }
  function lobbyFields(source: GmRequestReviewSource, closure: NpcRecoveryClosure) {
    const lock = closure.blocks.at(-1)?.initialTimeLockOrNull ?? null;
    return {
      initialTimeLockOrNull:
        lock === null
          ? null
          : {
              campaignTimestamp: lock.campaignTimestamp,
              sourceNpcUuid: lock.npcUuid,
              sourceVersion: lock.version,
            },
      npcInitialTimeReturnContextOrNull:
        source.viewOrNull?.npc?.initialTimeReturnContextOrNull ?? null,
    };
  }
  function connect(
    scope: NpcScope,
    readCurrent: NpcApplicationDependencies['readCurrent'],
    validateCheckpoint: NpcApplicationDependencies['validateCheckpoint'],
    validateOwner: CampaignPrivateOwnerValidator,
  ) {
    const app = createNpcApplication({
      database,
      scope,
      readers,
      domain,
      art,
      validateOwner,
      readCurrent,
      validateCheckpoint,
      applyStage,
      validateForward(attempt, _destination, context) {
        forward(attempt, context);
      },
    });
    return {
      ...app,
      project(history: AdmissionHistory, supported: readonly string[]) {
        const state = app.read(),
          view = state.source.viewOrNull ?? s.fail();
        equal(history.checkpoint, state.checkpoint);
        const attempt = openAttempt(state.source, state.closure);
        const attemptContext = attempt === null ? null : currentAttemptContext(attempt, state);
        const draft =
          attempt === null
            ? null
            : readNpcEditorDraft(
                npcEditorForItemAttempt(editor, catalog.inventory, attemptContext),
                attempt.values,
              );
        const resolvedArt = attempt === null ? null : attemptArt(attempt, state);
        const fields = lobbyFields(state.source, state.closure);
        const clockContext = state.closure.calendarContext ?? s.fail();
        equal(clockContext.scope, scope);
        equal(clockContext.checkpoint, state.checkpoint);
        const selectedTraumaIds =
          draft?.initialState.traumaInstanceIds.kind === 'ENTERED'
            ? draft.initialState.traumaInstanceIds.value
            : [];
        const needsTime =
          (draft?.inventory.kind === 'ENTERED' &&
            draft.inventory.value.some(
              (row) =>
                row.input.coatingInstanceIds.kind === 'ENTERED' &&
                row.input.coatingInstanceIds.value.length !== 0,
            )) ||
          (draft?.initialState.weaverEffectInstanceIds?.kind === 'ENTERED' &&
            draft.initialState.weaverEffectInstanceIds.value.length !== 0) ||
          (attempt !== null && domain.lifePreparation.requiresTime(attempt, clockContext)) ||
          (draft?.initialState.effectInstanceIds.kind === 'ENTERED' &&
            draft.initialState.effectInstanceIds.value.length !== 0) ||
          (draft?.initialState.traumaInputs?.kind === 'ENTERED' &&
            draft.initialState.traumaInputs.value.some(
              (r) =>
                selectedTraumaIds.includes(r.traumaInstanceId) &&
                r.head.kind === 'ENTERED' &&
                r.head.value.stun.kind === 'ENTERED' &&
                r.head.value.stun.value.status === 'ACTIVE',
            ));
        const clock = clockContext.currentClock;
        let clockBinding: NpcProjectionRead['calendar']['bindingOrNull'] = null;
        if (needsTime && clock.campaignTimestampOrNull !== null) {
          if (clock.phase === 'PRE_START') {
            const lobby = history.lobbyOrNull ?? s.fail();
            equal(
              lobby.initialCampaignTimeOrNull?.campaignTimestamp,
              clock.campaignTimestampOrNull,
            );
            clockBinding = {
              kind: 'PRE_START_INITIAL',
              campaignTimestamp: clock.campaignTimestampOrNull,
              lobbySnapshotRevision: lobby.lobbySnapshotRevision,
            };
          } else
            clockBinding = {
              kind: 'CURRENT_CAMPAIGN',
              campaignTimestamp: clock.campaignTimestampOrNull,
              stateRevision: view.stateRevision,
            };
        }
        const calendar: NpcProjectionRead['calendar'] = {
          requiresCampaignTime: needsTime,
          validationStatus: !needsTime
            ? 'NOT_REQUIRED'
            : clockBinding === null
              ? 'MISSING'
              : 'CURRENT',
          bindingOrNull: clockBinding,
          initialTimeLockOrNull: fields.initialTimeLockOrNull,
          messages:
            needsTime && clockBinding === null
              ? ['Для выбранного начального состояния подтвердите время кампании.']
              : [],
        };
        const read: NpcProjectionRead = {
          view,
          closure: state.closure,
          campaignStatus: state.source.currentCampaign.status,
          campaignPhase: state.source.currentCampaign.firstStartCompleted ? 'STARTED' : 'PRE_START',
          attemptOrNull: attempt,
          draftOrNull: draft,
          attemptArtOrNull:
            resolvedArt === null
              ? null
              : { assetKey: resolvedArt.assetKey, checksum: resolvedArt.sha256 },
          versions: state.closure.versions.map((record) => ({
            record,
            snapshot: domain.snapshot(
              record.snapshot,
              state.closure.calendarContext,
              null,
            ) as unknown as NpcProjectionRead['versions'][number]['snapshot'],
          })),
          calendar,
        };
        let preview: NpcCheckedPreviewDisplay = {
          kind: 'INCOMPLETE',
          detail: 'Завершите обязательные этапы редактора',
        };
        if (attempt !== null && (attempt.stage === 'NPC-016' || attempt.stage === 'NPC-017')) {
          try {
            const checked = domain.preview(
              attempt,
              previousVersion(attempt, state.closure),
              state.closure.calendarContext ?? s.fail(),
            );
            equal(
              [
                checked.binding.scope,
                checked.binding.npcDraftId,
                checked.binding.npcUuid,
                checked.binding.attemptRevision,
                checked.binding.stage,
              ],
              [
                scope,
                attempt.npcDraftId,
                attempt.candidateNpcUuid,
                attempt.revision,
                attempt.stage,
              ],
            );
            preview = {
              kind: 'VALID',
              name: checked.sheet.input.identity.name,
              sections: npcPreviewSheetSections(checked.sheet, catalog),
              art: { assetKey: checked.art.assetKey, checksum: checked.art.sha256 },
            };
          } catch (error) {
            if (!(error instanceof NpcOrdinaryPreviewInputError)) throw error;
            preview = { kind: error.code, detail: error.message };
          }
        }
        let compositionOrNull: Parameters<typeof npcEditorPresentation>[0]['compositionOrNull'] =
          null;
        if (
          attempt !== null &&
          attemptContext !== null &&
          ['NPC-013', 'NPC-014', 'NPC-015', 'NPC-016', 'NPC-017'].includes(attempt.stage)
        ) {
          const compositionState = domain.compositionPreparation.read(
            attempt,
            attemptContext,
            state.closure.calendarContext ?? s.fail(),
          );
          try {
            compositionOrNull = {
              state: compositionState,
              candidateOrNull: domain.compositionPreparation.candidate(compositionState),
              errorOrNull: null,
            };
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            compositionOrNull = {
              state: compositionState,
              candidateOrNull: null,
              errorOrNull: error.message,
            };
          }
        }
        let equipmentCompatibilityPreparationOrNull: NpcEquipmentCompatibilityPreparation | null =
          null;
        if (draft !== null && attemptContext !== null && attempt?.stage === 'NPC-015') {
          try {
            const equipment = domain.equipmentCompatibilityPreparation.inspect(
              json(draft),
              attemptContext,
            );
            if (
              equipment.orderedItems.length !== 0 &&
              domain.equipmentForAttempt(attempt, state.closure.calendarContext ?? s.fail())?.proof
                .compatibilityProofOrNull == null
            )
              equipmentCompatibilityPreparationOrNull = {
                capabilityKey: equipment.capabilityKey,
                orderedItems: equipment.orderedItems,
                input: { reason: { kind: 'UNSET' as const } },
                errors: [],
                canSubmit: true,
                explanation:
                  'Мастер явно подтверждает физическую совместимость указанных слоёв экипировки и указывает основание. Подтверждение связано с точным текущим набором.',
              };
          } catch (error) {
            if (
              !(error instanceof NpcStagedInputError) &&
              !(error instanceof NpcInventoryPublicationError)
            )
              throw error;
          }
        }
        let poisonPreparationOrNull: ReturnType<typeof domain.poisonPreparation.inspect> | null =
          null;
        if (
          (attempt?.stage === 'NPC-015' || attempt?.stage === 'NPC-016') &&
          catalog.poisonSource !== null
        ) {
          try {
            poisonPreparationOrNull = domain.poisonPreparation.inspect(
              attempt,
              state.closure.calendarContext ?? s.fail(),
            );
          } catch (error) {
            // A newly reserved, still incomplete physical row cannot supply a carrier capability.
            // Historical/source failures remain hard; normal inventory validation displays missing fields.
            if (!(error instanceof NpcStagedInputError)) throw error;
          }
        }
        const editorOrNull =
          draft === null
            ? null
            : npcEditorPresentation({
                read,
                catalog,
                preview,
                canReserveItem: true,
                compositionOrNull,
                runtimePreparationOrNull:
                  attempt?.stage === 'NPC-016' && attemptContext !== null
                    ? domain.runtimeEffectPreparation.inspect(
                        attempt,
                        attemptContext,
                        state.closure.calendarContext ?? s.fail(),
                      )
                    : null,
                runtimeEffectBindings: attemptContext?.runtimeEffectBindings ?? [],
                lifeStatePreparationOrNull:
                  attempt?.stage === 'NPC-016'
                    ? domain.lifePreparation.inspect(
                        attempt,
                        state.closure.calendarContext ?? s.fail(),
                      )
                    : null,
                weaverPreparationOrNull:
                  attempt?.stage === 'NPC-016'
                    ? domain.weaverPreparation.inspect(
                        attempt,
                        state.closure.calendarContext ?? s.fail(),
                      )
                    : null,
                inventoryOrNull: null,
                poisonPreparationOrNull,
                customPreparationOrNull:
                  attempt?.stage === 'NPC-015' && attemptContext !== null
                    ? domain.customItemPreparation.inspect(attempt.values, attemptContext)
                    : null,
                restorePreparationOrNull:
                  attempt?.stage === 'NPC-015' && attemptContext !== null
                    ? domain.itemRestorePreparation.inspect(
                        attempt,
                        attemptContext,
                        state.closure.calendarContext ?? s.fail(),
                      )
                    : null,
                equipmentCompatibilityPreparationOrNull,
                compositeSets: attemptContext?.linkedSets ?? [],
                compositePreparationOrNull:
                  attemptContext === null
                    ? null
                    : {
                        capabilityKey: s.sha(
                          s.canonical({
                            scope: attemptContext.scope,
                            npcDraftId: attemptContext.npcDraftId,
                            revision: attemptContext.revision,
                          }),
                        ),
                        choices: (['ITM-WPN-026', 'ITM-WPN-027'] as const).map((value) => ({
                          value,
                          label:
                            catalog.inventory.definitions.find((item) => item.itemTypeId === value)
                              ?.name ?? s.fail(),
                        })),
                        errors: [],
                        canSubmit: true,
                        explanation:
                          'Создать обе составные части выбранного комплекта с общей связью. Количество, состояние и экипировка заполняются явно.',
                      },
                woundPreparationOrNull:
                  attemptContext === null ? null : { woundBindings: attemptContext.woundBindings },
                traumaPreparationOrNull:
                  attemptContext === null
                    ? null
                    : {
                        traumaBindings: attemptContext.traumaBindings,
                        retainedIds: attemptContext.traumaBindings
                          .filter((b) => b.retainedRowOrNull !== null)
                          .map((b) => b.traumaInstanceId),
                      },
                diseasePreparationOrNull:
                  attemptContext === null
                    ? null
                    : {
                        choices: domain.diseasePreparation.choices,
                        effectBindings: attemptContext.effectBindings,
                      },
              });
        return projectNpcGm({ read, catalog, editorOrNull, supported });
      },
      lobbyFields() {
        const state = app.read();
        return lobbyFields(state.source, state.closure);
      },
      readArt(request: NpcArtReadRequest, projection: () => NpcGmProjection) {
        return app.artRead(request, projection, attemptArt);
      },
    };
  }
  return { readers, connect };
}
