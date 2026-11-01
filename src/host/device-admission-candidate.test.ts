import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import type { PostSaveMetadata, PostSaveRequest } from '@shared/local-character-post-save.js';
import type {
  AdmissionReviewDraft,
  AdmissionMechanicalSheetV1,
} from '@shared/campaign-admission.js';
import {
  admissionMechanicalChanges,
  admissionMechanicalChangesValue,
  decodeAdmissionMechanicalSheet,
} from '@shared/campaign-admission-sheet.js';
import {
  admissionSourceMechanicsInput,
  deriveAdmissionMechanicalCores,
  projectAdmissionWeaponProfile,
} from './campaign-admission-mechanics.js';
import { canonicalWeaponProfileCatalog } from './weapon-profile-catalog.js';
import {
  deriveAdmissionSourceProperties,
  initialAdmissionInventoryReview,
  admissionSourceInventorySheet,
  validateAdmissionInventorySelection,
} from './campaign-admission-inventory.js';
import { canonicalFiveStartingPositionsCatalog } from './five-starting-positions-catalog.js';
import {
  admissionWeaponTemplateId,
  deriveAdmissionWeaponResolution,
  admissionStagedWeaponDecision,
  type AdmissionWeaponResolutionInput,
  type VerifiedAdmissionWeaponDecision,
} from './campaign-admission-weapon.js';
import {
  deriveAdmissionFullCopyDiff,
  deriveAdmissionReviewMechanicalSheets,
  sealAdmissionProposal,
  validateAdmissionProposal,
  verifyAdmissionProposalSources,
  type AdmissionCopyPublicationInput,
} from './campaign-admission-proposal.js';
import {
  createCampaignAdmissionRules,
  admissionSelectedGroupLabels,
} from './campaign-admission-service.js';
import { projectGmAdmission } from './projections/net-application.js';
import { admissionGmProjectionValue } from '@shared/campaign-admission-presentation.js';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import {
  decodeAdmissionProposal,
  type AdmissionProposalBody,
  type AdmissionPlayerDecisionRequest,
  admissionGmDecisionNotice,
  admissionOwnerPublicationValue,
  admissionPlayerDecisionReceiptValue,
} from '@shared/campaign-admission-proposal.js';
import { commitAdmissionPlayerDecision } from '../persistence/campaign-admission-player.js';
import {
  createAdmissionReviewState,
  verifyInitialAdmissionReviewState,
  applyAdmissionReviewMutation,
  admissionReviewPublicationInputs,
} from './campaign-admission-review.js';
import type { AdmissionReviewMutation } from '@shared/campaign-admission-review.js';
import {
  createAdmissionStoreFixture,
  createAdmissionOwnerFixture,
  prepareAdmissionOwnerFixture,
} from '../../tests/fixtures/admission-store.js';
import {
  receiveLocalAdmissionPublication,
  readLocalAdmission,
  readLocalAdmissionPresentation,
  readLocalAdmissionDelivery,
  prepareLocalAdmissionDecision,
  acknowledgeLocalAdmissionDecision,
  returnFromLocalAdmission,
} from '../persistence/local-campaign-admission.js';
import {
  commitLocalNetworkTabEntry,
  commitLocalNetworkTabClose,
  readOwnedLocalNetworkTab,
  readActiveLocalNetworkTab,
} from '../persistence/network-local-tab.js';
import {
  commitLocalNetworkMutation,
  readLocalNetworkApplication,
  readLocalNetworkDeliverySnapshot,
  readLocalNetworkRequestDeliverySnapshot,
} from '../persistence/network-local-application.js';
import {
  commitAdmissionReviewOpen,
  commitAdmissionReviewOpenWithView,
  commitAdmissionReviewEdit,
  commitAdmissionViewValues,
  commitAdmissionViewNavigation,
  readAdmissionReview,
} from '../persistence/campaign-admission-review.js';
import {
  commitAdmissionGmDecision,
  readAdmissionDecision,
  readAdmissionDecisionDeliveryByRequest,
  readCampaignAdmissionAvailability,
  enterPublishedAdmissionView,
  admissionDecisionStorage,
  type AdmissionPublicationRules,
} from '../persistence/campaign-admission-decision.js';
import {
  commitGmDeviceRequestDecision,
  readGmRequestReviewView,
  commitHostedNetworkCommand,
  commitGmRequestReviewConnectionRefresh,
  commitGmRequestReviewDraft,
} from '../persistence/network-device-request.js';
import {
  readCampaignCreationCursor,
  readGmAdmissionViewStateInTransaction,
  appendGmAdmissionViewEventInTransaction,
  returnGmAdmissionViewInTransaction,
} from '../persistence/campaign-creation.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import { deviceAdmissionSubmitSemanticBody } from './device-admission-peer-response.js';
import { loadCampaignCheckpoint, readRevisions } from '../persistence/store.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import {
  loadDeviceId,
  openPersistenceDatabase,
  type LocalCharacter,
  type LocalCharacterCheckpoint,
} from '../persistence/index.js';
import { commitCreationFinalization } from './creation-finalization.js';
import { commitManualComposition } from './creation-manual-composition.js';
import { manualCompositionRequest } from '../../tests/fixtures/manual-symbiont-stage.js';
import { creationFinalizationHash } from './creation-finalization-contract.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  canonicalPostSaveJson,
  loadLocalCharacterExportBaseline,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { validateArchivedLocalExportDocument } from './local-character-archive-export.js';
import {
  commitLocalPostSave,
  openPlayerPostSave,
  postSaveCommon,
  postSaveRevisions,
  type LocalPostSaveDependencies,
} from './local-character-post-save.js';
import {
  DeviceAdmissionCandidateError,
  prepareOwnedFinalAdmissionCandidate,
  validateFinalAdmissionCandidate,
  validateFinalAdmissionReviewSource,
  type PreparedOwnedFinalAdmissionCandidate,
  type FinalAdmissionCandidateDescriptor,
} from './device-admission-candidate.js';

const limits = { maxWitnessBytes: 16 * 1024 * 1024 };
let baseline: LocalCharacterExportBaseline;
const databases: LocalPostSaveDependencies['database'][] = [];
const admissionDatabases: LocalPostSaveDependencies['database'][] = [];
const directories: string[] = [];
type Source = Awaited<ReturnType<typeof source>>;
const fixtures = new Map<string, Source>();
function dependencies(
  database: LocalPostSaveDependencies['database'],
  catalog: LocalPostSaveDependencies['symbiontCatalog'],
): LocalPostSaveDependencies {
  return {
    database,
    baseline,
    symbiontCatalog: catalog,
    loadCheckpoint: (id) => loadCreationWizardCheckpoint(database, id, catalog.skillStage, catalog),
    resumeForm: (c) => c.nextStageEnvelope.formId,
  };
}
async function source(
  race: 'FREE' | 'PURE' | 'UNITED' = 'FREE',
  mode: 'AUTO' | 'MANUAL' = 'AUTO',
  databasePath = ':memory:',
  final = true,
  commandPrefix = 'candidate',
) {
  return finishSource(
    await prepareSource(race, mode, databasePath, commandPrefix),
    final,
    commandPrefix,
  );
}
async function prepareSource(
  race: 'FREE' | 'PURE' | 'UNITED',
  mode: 'AUTO' | 'MANUAL',
  databasePath: string,
  commandPrefix: string,
) {
  const p = await createCreationFinalizationSetup({
    prefix: `${commandPrefix}-${race}-${mode}`,
    raceChoice: race,
    diceInputMode: mode,
    databasePath,
    ...(race === 'UNITED'
      ? {
          prepareManualComposition: (setup: Parameters<typeof manualCompositionRequest>[0]) =>
            commitManualComposition(
              setup.database,
              manualCompositionRequest(
                setup,
                setup.checkpoint,
                'united-composition',
                ['OWL', 'TICK', 'SPIDER', 'MANTIS'],
                [{ speciesKey: 'OWL', side: 'LEFT' }],
              ),
              'united-composition-receipt',
              {
                catalog: setup.catalog,
                allocateRollRequestId: () => {
                  throw new Error('no Advisor allocation');
                },
                sampleD20: () => {
                  throw new Error('no Advisor roll');
                },
              },
            ),
        }
      : {}),
  });
  databases.push(p.setup.database);
  return p;
}
function finishSource(
  p: Awaited<ReturnType<typeof prepareSource>>,
  final: boolean,
  commandPrefix: string,
) {
  let current = commitCreationFinalization(
    p.setup.database,
    creationPropertySummaryRequest(p.current, `${commandPrefix}-summary`),
    `${commandPrefix}-summary-receipt`,
    p.dependencies,
  );
  if (final)
    current = commitCreationFinalization(
      p.setup.database,
      creationFinalSaveRequest(current, `${commandPrefix}-final`),
      `${commandPrefix}-final-receipt`,
      p.dependencies,
    );
  const d = dependencies(p.setup.database, p.setup.catalog);
  const owner = loadDeviceId(d.database);
  const id = current.localCharacter.localCharacterId;
  return { p, d, owner, id, current };
}
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  for (const race of ['FREE', 'PURE', 'UNITED'] as const)
    for (const mode of ['AUTO', 'MANUAL'] as const)
      fixtures.set(`${race}/${mode}`, await source(race, mode));
});
afterAll(() => {
  for (const db of databases) if (db.open) db.close();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});
afterEach(() => {
  // Campaign fixtures contain full submitted witnesses; retaining every SQLite
  // connection until this file finishes multiplies their external memory use.
  for (const db of admissionDatabases.splice(0)) if (db.open) db.close();
});
function fixture() {
  return fixtures.get(['FREE', 'AUTO'].join('/'))!;
}
function prepared(s = fixture()) {
  return prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, limits);
}
function receive(
  c: PreparedOwnedFinalAdmissionCandidate,
  witness: unknown = c.canonicalWitnessText,
  descriptor: unknown = c.descriptor,
  document: unknown = c.exportDocument,
  owner: string = fixture().owner,
  useBaseline = baseline,
  maxWitnessBytes = limits.maxWitnessBytes,
) {
  return validateFinalAdmissionCandidate(witness, owner, descriptor, document, useBaseline, {
    maxWitnessBytes,
  });
}
function error(run: () => unknown) {
  try {
    run();
  } catch (caught) {
    expect(caught).toBeInstanceOf(DeviceAdmissionCandidateError);
    const e = caught as DeviceAdmissionCandidateError;
    expect(e.message).toBe(`device admission candidate: ${e.code}:${e.field}`);
    expect(e.cause).toBeUndefined();
    return e;
  }
  throw new Error('candidate unexpectedly accepted');
}
interface Witness {
  schemaVersion: number;
  ownerDeviceId: string;
  localCharacter: LocalCharacter;
  checkpoint: LocalCharacterCheckpoint;
  skillPresentationStage: JsonObject | null;
  symbiontPresentationStage: JsonObject | null;
}
function witness(c: PreparedOwnedFinalAdmissionCandidate): Witness {
  return JSON.parse(c.canonicalWitnessText) as Witness;
}
type MutableJson = { [key: string]: JsonValue };
function row(value: unknown): MutableJson {
  return value as MutableJson;
}
function assertClosedAdmissionSheet(value: AdmissionMechanicalSheetV1): void {
  const paths = (
    v: unknown,
    path: readonly (string | number)[] = [],
  ): (readonly (string | number)[])[] => {
    if (v === null || typeof v !== 'object') return [];
    if (Array.isArray(v)) return v.flatMap((entry, index) => paths(entry, [...path, index]));
    return [path, ...Object.entries(v).flatMap(([key, entry]) => paths(entry, [...path, key]))];
  };
  const at = (v: unknown, path: readonly (string | number)[]) =>
    path.reduce<unknown>((r, key) => row(r)[key], v) as MutableJson;
  for (const path of paths(value)) {
    const changed = structuredClone(value);
    at(changed, path)['privateReplayWitness'] = 'secret';
    const decoded = decodeAdmissionMechanicalSheet(JSON.stringify(changed));
    expect(decoded.ok, `unknown key at ${path.join('.')}`).toBe(false);
    expect(JSON.stringify(decoded)).not.toMatch(/secret|privateReplayWitness/);
    // CORE-188 permits an empty stat-requirement map; catalog properties are
    // also a closed optional-key map. The containers themselves remain required.
    if (path.at(-1) === 'statRequirements' || path.at(-1) === 'properties') continue;
    for (const key of Object.keys(at(value, path))) {
      const omitted = structuredClone(value);
      delete at(omitted, path)[key];
      expect(
        decodeAdmissionMechanicalSheet(JSON.stringify(omitted)).ok,
        `missing ${path.join('.')}.${key}`,
      ).toBe(false);
    }
  }
}
function snapshot(w: Witness) {
  w.checkpoint.snapshotJson = JSON.stringify({
    localCharacter: {
      localCharacterId: w.localCharacter.localCharacterId,
      lifecycleState: w.localCharacter.lifecycleState,
      payloadJson: w.localCharacter.payloadJson,
    },
  });
  w.checkpoint.snapshotSha256 = postSaveSha256(w.checkpoint.snapshotJson);
}
function alterPayload(w: Witness, mutate: (payload: MutableJson) => void) {
  const payload = JSON.parse(w.localCharacter.payloadJson) as MutableJson;
  mutate(payload);
  w.localCharacter.payloadJson = JSON.stringify(payload);
  snapshot(w);
}
function alteredExport(
  c: PreparedOwnedFinalAdmissionCandidate,
  mutate: (document: MutableJson) => void,
) {
  const document = row(structuredClone(c.exportDocument));
  mutate(document);
  delete document['checksum'];
  document['checksum'] = postSaveSha256(canonicalPostSaveJson(document));
  const descriptor: FinalAdmissionCandidateDescriptor = {
    ...c.descriptor,
    exportChecksum: document['checksum'],
    exportBytesSha256: postSaveSha256(`${canonicalPostSaveJson(document)}\n`),
  };
  return { document, descriptor };
}

const admissionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function publicationFixture(s = fixture(), offset = 100): AdmissionCopyPublicationInput {
  const c = prepared(s),
    source = validateFinalAdmissionReviewSource(
      c.canonicalWitnessText,
      s.owner,
      c.descriptor,
      c.exportDocument,
      baseline,
      limits,
    );
  const properties = deriveAdmissionSourceProperties(source),
    identities = properties.map((property, index) => ({
      reviewItemId: admissionId(offset + index),
      sourceEntryIdOrNull: property.sourceEntryId,
    }));
  const original = admissionSourceMechanicsInput(source);
  const draft: AdmissionReviewDraft = {
    statAdjustments: { S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 },
    startingSkills: {
      entries: original.learnedSkills
        .filter((entry) => entry.source === 'SELECTED')
        .map((entry) => ({ skillKey: entry.skillKey, targetBonus: entry.bonus })),
    },
    massReview: {
      massKg: source.checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!.identity.massKg,
      decision: 'PENDING_MASTER_APPROVAL',
    },
    inventoryReview: initialAdmissionInventoryReview(properties, identities),
    moneyReview: { status: 'PENDING', amountOrNull: null },
    weaponDecisionRefs: [],
    groupAssignment: { kind: 'START' },
    locationAssignment: { location: 'Город', subLocationOrNull: null },
  };
  const reviewCopyId = admissionId(offset + 50);
  const decisions: VerifiedAdmissionWeaponDecision[] = properties.flatMap((property, index) => {
    if (property.weaponRequestOrNull === null) return [];
    return [
      {
        reviewCopyId,
        ...admissionStagedWeaponDecision(
          admissionId(offset + 100 + index),
          deriveAdmissionWeaponResolution(
            source,
            canonicalWeaponProfileCatalog(),
            identities,
            draft,
            {
              weaponReviewInput: { kind: 'VALIDATED_REQUEST', ...property.weaponRequestOrNull },
              decision: 'APPROVE',
              overrideProfileOrNull: null,
              reasonOrNull: null,
            },
          ),
        ),
      },
    ];
  });
  return {
    source,
    reviewCopyId,
    campaignCharacterIdOrNull: admissionId(offset + 51),
    identities,
    decisions,
    draft: {
      ...draft,
      weaponDecisionRefs: decisions.map((decision) => {
        const input = decision.input.weaponReviewInput;
        if (input.kind !== 'VALIDATED_REQUEST') throw new Error('fixture request required');
        return { ...input, decisionReceiptId: decision.receiptId };
      }),
      inventoryReview: {
        ...draft.inventoryReview,
        entries: draft.inventoryReview.entries.map((entry) => {
          const property = properties.find((p) => p.sourceEntryId === entry.sourceEntryIdOrNull)!;
          const decision = decisions.find((d) => {
            const input = d.input.weaponReviewInput;
            return (
              input.kind === 'VALIDATED_REQUEST' &&
              input.requestId === property.weaponRequestOrNull?.requestId
            );
          });
          return { ...entry, weaponDecisionReceiptIdOrNull: decision?.receiptId ?? null };
        }),
      },
    },
  };
}
function proposalBody(inputs: readonly AdmissionCopyPublicationInput[]): AdmissionProposalBody {
  const diffs = inputs.map((input) =>
    deriveAdmissionFullCopyDiff(input, baseline, canonicalFiveStartingPositionsCatalog()),
  );
  return {
    campaignId: admissionId(1),
    admissionBatchId: admissionId(2),
    admissionOrigin: 'DEVICE_REQUEST',
    ownerProvenance: {
      kind: 'DEVICE_REQUEST',
      requestId: admissionId(3),
      requestOwnerDeviceId: fixture().owner,
    },
    reviewRevision: 4,
    proposalRevision: 1,
    fullCampaignCopyDiffs: diffs,
    blockers: diffs.flatMap((diff) => diff.blockers),
  };
}

interface PublicationTestContext {
  readonly store: ReturnType<typeof createAdmissionStoreFixture>;
  readonly sourcesByRequest: Map<
    string,
    readonly {
      candidate: PreparedOwnedFinalAdmissionCandidate;
      source: ReturnType<typeof validateFinalAdmissionReviewSource>;
    }[]
  >;
}
function publicationStoreFixture(
  filename = ':memory:',
  options: {
    source?: Source;
    sources?: readonly Source[];
    context?: PublicationTestContext;
    capacity?: number;
    approve?: boolean;
    approveIndices?: readonly number[];
    legacy?: boolean;
    existingGroupId?: string;
  } = {},
) {
  const originals = options.sources ?? [options.source ?? fixture()],
    src = originals[0]!,
    selected = originals.map((original) => {
      const candidate = prepared(original);
      return {
        candidate,
        source: validateFinalAdmissionReviewSource(
          candidate.canonicalWitnessText,
          src.owner,
          candidate.descriptor,
          candidate.exportDocument,
          baseline,
          limits,
        ),
      };
    }),
    candidate = selected[0]!.candidate,
    store =
      options.context?.store ??
      createAdmissionStoreFixture(
        src.owner,
        candidate.descriptor.baselineVersion,
        selected.map((s) => s.candidate),
        filename,
        options.capacity ?? 5,
        options.legacy ?? false,
      ),
    f =
      options.context === undefined
        ? store
        : {
            ...store,
            ...store.addRequest(
              src.owner,
              selected.map((s) => s.candidate),
              createCampaignAdmissionRules(baseline, limits.maxWitnessBytes).rules,
            ),
          },
    sources = selected.map((s) => s.source),
    catalogs = {
      baseline,
      items: canonicalFiveStartingPositionsCatalog(),
      weapons: canonicalWeaponProfileCatalog(),
    };
  if (options.context === undefined) admissionDatabases.push(f.db);
  const context: PublicationTestContext = {
    store,
    sourcesByRequest:
      options.context?.sourcesByRequest ??
      new Map<
        string,
        readonly {
          candidate: PreparedOwnedFinalAdmissionCandidate;
          source: ReturnType<typeof validateFinalAdmissionReviewSource>;
        }[]
      >(),
  };
  context.sourcesByRequest.set(f.openRequest.payload.requestId, selected);
  const forRequest = (id: string) => {
    const selected = context.sourcesByRequest.get(id);
    if (selected === undefined) throw new Error('missing fixture request source');
    return selected;
  };
  const rules: AdmissionPublicationRules = {
    verifyInitial: (request, state) => {
      const selected = forRequest(request.submittedRequest.requestId);
      expect(request.submittedRequest.batch.candidates).toEqual(selected.map((s) => s.candidate));
      verifyInitialAdmissionReviewState(
        state,
        selected.map((s) => s.source),
      );
    },
    reduce: (request, before, mutation, receiptId) =>
      applyAdmissionReviewMutation(
        before,
        forRequest(request.submittedRequest.requestId).map((s) => s.source),
        mutation,
        receiptId,
        catalogs,
      ),
    buildProposal: (review, ids) => {
      const inputs = admissionReviewPublicationInputs(
        review.current,
        forRequest(review.current.requestId).map((s) => s.source),
        ids.every((id) => id === null)
          ? null
          : ids.map((id) => {
              if (id === null) throw new Error('mixed publication');
              return id;
            }),
      );
      const fullCampaignCopyDiffs = inputs.map((input) =>
        deriveAdmissionFullCopyDiff(input, baseline, catalogs.items),
      );
      return sealAdmissionProposal({
        campaignId: f.scope.campaignId,
        admissionBatchId: review.current.admissionBatchId,
        admissionOrigin: 'DEVICE_REQUEST',
        ownerProvenance: {
          kind: 'DEVICE_REQUEST',
          requestId: review.current.requestId,
          requestOwnerDeviceId: review.open.receipt.requestOwnerDeviceId,
        },
        reviewRevision: review.current.reviewRevision,
        proposalRevision: 1,
        fullCampaignCopyDiffs,
        blockers: fullCampaignCopyDiffs.flatMap((d) => d.blockers),
      });
    },
  };
  let review = commitAdmissionReviewOpen(
    f.db,
    f.scope,
    { request: f.openRequest, receiptId: randomUUID(), timestamp: '2026-11-01T00:02:00.000Z' },
    f.allow,
    rules,
    (request) =>
      createAdmissionReviewState(sources, request.submittedRequest.requestId, randomUUID),
    f.allow,
  ).review;
  const edit = (mutation: Extract<AdmissionReviewMutation, { kind: 'EDIT' | 'WEAPON' }>) => {
    review = commitAdmissionReviewEdit(
      f.db,
      f.scope,
      {
        request: {
          commandId: randomUUID(),
          admissionBatchId: review.current.admissionBatchId,
          expectedReviewRevision: review.current.reviewRevision,
          intent: mutation,
        },
        receiptId: randomUUID(),
        timestamp: '2026-11-01T00:03:00.000Z',
      },
      f.allow,
      rules,
      () => mutation,
      f.allow,
    ).review;
  };
  for (const [index, source] of sources.entries()) {
    const first = review.current.copies[index]!;
    edit({
      kind: 'EDIT',
      reviewCopyId: first.reviewCopyId,
      inputs: {
        ...first.inputs,
        groupAssignmentOrNull:
          options.existingGroupId === undefined
            ? { kind: 'START' }
            : { kind: 'EXISTING', groupId: options.existingGroupId },
        locationAssignmentOrNull: { location: 'Город', subLocationOrNull: null },
      },
    });
    for (const p of deriveAdmissionSourceProperties(source))
      if (p.weaponRequestOrNull !== null)
        edit({
          kind: 'WEAPON',
          reviewCopyId: first.reviewCopyId,
          input: {
            weaponReviewInput: { kind: 'VALIDATED_REQUEST', ...p.weaponRequestOrNull },
            decision: 'APPROVE',
            overrideProfileOrNull: null,
            reasonOrNull: null,
          },
        });
    if (options.approve === true || options.approveIndices?.includes(index) === true) {
      const current = review.current.copies[index]!;
      edit({
        kind: 'EDIT',
        reviewCopyId: current.reviewCopyId,
        inputs: {
          ...current.inputs,
          massReview: { ...current.inputs.massReview, decision: 'APPROVED' },
          inventoryReview: {
            ...current.inputs.inventoryReview,
            status: 'FINAL',
            unresolvedSourceEntryIds: [],
          },
          moneyReview: { status: 'FINAL', amountOrNull: 0 },
        },
      });
    }
  }
  const preview = rules.buildProposal(
    review,
    sources.map(() => null),
  );
  const input = {
    request: {
      commandId: randomUUID(),
      campaignId: f.scope.campaignId,
      admissionBatchId: review.current.admissionBatchId,
      reviewRevision: review.current.reviewRevision,
      expectedCampaignRevision: loadCampaignCheckpoint(f.db, f.scope.campaignId).stateRevision,
      decision: 'ACCEPT' as const,
      previewChecksumOrNull: preview.proposalChecksum,
      reasonOrNull: null,
    },
    receiptId: randomUUID(),
    timestamp: '2026-11-01T00:04:00.000Z',
  };
  return { ...f, src, rules, review, input, preview, context };
}

function playerDecisionFixture(
  decision: 'ACCEPT' | 'DECLINE' = 'ACCEPT',
  f = publicationStoreFixture(),
) {
  const published = commitAdmissionGmDecision(
    f.db,
    f.scope,
    f.input,
    f.allow,
    f.rules,
    randomUUID,
    f.allow,
  ).current;
  const gm = published.gmDecisionOrNull!,
    proposal = gm.proposalOrNull!,
    lane = published.review.request.proof.laneProvenance;
  if (lane === null) throw new Error('fixture has no verified original lane');
  const originalSeat =
    lane.kind === 'SUBMITTED_BATCH'
      ? lane.localControllerSeatId
      : lane.receipt.binding.localControllerSeatId;
  const request: AdmissionPlayerDecisionRequest = {
    commandId: randomUUID(),
    campaignId: f.scope.campaignId,
    admissionBatchId: gm.request.admissionBatchId,
    expectedCampaignRevision: loadCampaignCheckpoint(f.db, f.scope.campaignId).stateRevision,
    proposalRevision: proposal.proposalRevision,
    proposalChecksum: proposal.proposalChecksum,
    decision,
    controllerPreparationOrNull:
      decision === 'DECLINE'
        ? null
        : {
            schemaVersion: 1,
            preparationId: randomUUID(),
            requestId: proposal.ownerProvenance.requestId,
            ownerDeviceId: f.src.owner,
            campaignId: proposal.campaignId,
            admissionBatchId: proposal.admissionBatchId,
            proposalRevision: proposal.proposalRevision,
            proposalChecksum: proposal.proposalChecksum,
            controllerBindings: gm.copies.map((copy) => ({
              campaignCharacterId: copy.campaignCharacterId,
              deviceId: f.src.owner,
              localControllerSeatId: originalSeat,
              inputLaneId: originalSeat,
            })),
          },
  };
  const input = { request, receiptId: randomUUID(), timestamp: '2026-11-01T00:05:00.000Z' };
  const decide = (
    value = input,
    allocate: () => string = randomUUID,
    guard: Parameters<typeof commitAdmissionPlayerDecision>[7] = f.allow,
  ) =>
    commitAdmissionPlayerDecision(
      f.db,
      f.scope,
      f.src.owner,
      value,
      f.allow,
      f.rules,
      allocate,
      guard,
    );
  return { ...f, published, playerInput: input, decide };
}
function admissionReturnInput(
  owner: ReturnType<typeof createAdmissionOwnerFixture>,
  requestId: string,
  mode: 'RESELECT' | 'MENU' = 'RESELECT',
) {
  const current = readLocalNetworkApplication(owner.db, owner.scope);
  return {
    requestId,
    mode,
    expectedRevisions: {
      stateRevision: current.stateRevision,
      projectionRevision: current.projectionRevision,
      actorVisibilityRevision: current.actorVisibilityRevision,
    },
    expectedDraftRevision: current.draftRevision,
    clientRequestJson: canonicalPostSaveJson({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: 'NET-007',
      actionKey: mode === 'RESELECT' ? 'NET-007::CTA::002' : 'NET-007::CTA::003',
      expectedProjectionRevision: current.projectionRevision,
    }),
  };
}

describe('NET-027 whole-batch decision from a real immutable FINAL', () => {
  describe('durable GM admission presentation', () => {
    let f: ReturnType<typeof createAdmissionStoreFixture>,
      service: ReturnType<typeof createCampaignAdmissionRules>;
    let originalQueueHead: { head_event_id: string; record_json: string; record_sha256: string },
      originalCursor: {
        kind: string;
        target_id: string;
        form_id: string;
        record_json: string;
        record_sha256: string;
      };
    beforeEach(() => {
      const src = fixture(),
        candidate = prepared(src);
      f = createAdmissionStoreFixture(src.owner, candidate.descriptor.baselineVersion, [candidate]);
      admissionDatabases.push(f.db);
      service = createCampaignAdmissionRules(baseline, limits.maxWitnessBytes);
      originalQueueHead = f.db
        .prepare('SELECT head_event_id,record_json,record_sha256 FROM gm_request_queue_view')
        .get() as typeof originalQueueHead;
      originalCursor = f.db
        .prepare(
          'SELECT kind,target_id,form_id,record_json,record_sha256 FROM campaign_creation_cursor',
        )
        .get() as typeof originalCursor;
    });
    const open = (request = f.openRequest) =>
      commitAdmissionReviewOpenWithView(
        f.db,
        f.scope,
        { request, receiptId: randomUUID(), timestamp: '2026-11-01T03:20:00.000Z' },
        f.allow,
        service.rules,
        (request) => service.initial(request, randomUUID),
        f.allow,
      );
    const state = () =>
      f.db.transaction(() => readGmAdmissionViewStateInTransaction(f.db, f.scope)).deferred();
    const navigation = (
      actionKey: FormActionIntentV2Message['actionKey'],
    ): FormActionIntentV2Message => {
      const current = state().viewOrNull!;
      return {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: current.formId,
        actionKey,
        expectedProjectionRevision: current.projectionRevision,
      };
    };
    const nav = (actionKey: FormActionIntentV2Message['actionKey']) => {
      const request = navigation(actionKey);
      return f.db
        .transaction(() =>
          appendGmAdmissionViewEventInTransaction(f.db, f.scope, {
            eventId: request.navigationRequestId,
            mutation: { kind: 'NAV', request },
          }),
        )
        .immediate();
    };
    it('rolls back the first working copies when their initial view cannot be committed', () => {
      f.db.exec(
        "CREATE TRIGGER fail_admission_view BEFORE INSERT ON gm_admission_view BEGIN SELECT RAISE(ABORT,'view failure'); END",
      );
      const before = f.db.serialize();
      expect(() => open()).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
      expect(f.db.prepare('SELECT count(*) AS n FROM campaign_admission_batch').get()).toEqual({
        n: 0,
      });
      expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId).kind).toBe('QUEUE');
    });
    describe('after actual review OPEN', () => {
      beforeEach(() => {
        open();
      });
      const project = () =>
        f.db
          .transaction(() => {
            const view = readGmAdmissionViewStateInTransaction(f.db, f.scope).viewOrNull!,
              header = readHostedCurrentPausedCampaign(f.db, f.scope.campaignId, f.allow),
              current = readAdmissionDecision(
                f.db,
                f.scope,
                view.admissionBatchId,
                f.allow,
                service.rules,
              ),
              history = admissionDecisionStorage.readHistory(f.db, f.scope, f.allow, service.rules);
            return projectGmAdmission({
              view,
              current,
              history,
              service,
              campaign: {
                ...header,
                activePlayerCapacity: header.activePlayerCapacity as 1 | 2 | 3 | 4 | 5,
                revisions: {
                  stateRevision: header.stateRevision,
                  projectionRevision: header.projectionRevision,
                  actorVisibilityRevision: header.actorVisibilityRevision,
                },
              },
              supported: [
                'UI-CMD-ADMISSION-GM-ACCEPT',
                'UI-CMD-ADMISSION-GM-REJECT',
                'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
              ],
            });
          })
          .deferred();
      const replaceView = (
        values: NonNullable<ReturnType<typeof state>['viewOrNull']>['values'],
      ) => {
        const view = state().viewOrNull!;
        return {
          messageType: 'network.admission-view.replace' as const,
          protocolVersion: 3 as const,
          draftUpdateId: randomUUID(),
          contextId: f.scope.gmLocalContextId,
          campaignId: f.scope.campaignId,
          admissionBatchId: view.admissionBatchId,
          sourceFormId: view.formId,
          expectedRevisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
          values,
        };
      };
      const validateViewValues = (
        review: Parameters<typeof service.weaponPreview>[0],
        values: ReturnType<typeof replaceView>['values'],
      ) => {
        if (values.weaponDraftOrNull !== null)
          service.weaponPreview(review, values.selectedReviewCopyId, values.weaponDraftOrNull);
      };
      it('rejects a foreign weapon view before writing a projection that cannot be rendered', () => {
        nav('NET-018::CTA::002');
        nav('NET-019::CTA::004');
        const request = replaceView({
          ...state().viewOrNull!.values,
          weaponDraftOrNull: {
            weaponReviewInput: {
              kind: 'VALIDATED_REQUEST',
              requestId: randomUUID(),
              validationReceiptId: randomUUID(),
            },
            decision: 'APPROVE',
            overrideProfileOrNull: null,
            reasonOrNull: null,
          },
        });
        const before = f.db.serialize(),
          guard = vi.fn();
        expect(() =>
          commitAdmissionViewValues(
            f.db,
            f.scope,
            request,
            f.allow,
            service.rules,
            validateViewValues,
            guard,
          ),
        ).toThrow();
        expect(guard).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
        expect(project().base.formId).toBe('GM-019');
      });
      it('replays bound VALUES after navigation without validating a new input or selecting its old view', () => {
        nav('NET-018::CTA::004');
        nav('NET-021::CTA::002');
        const request = replaceView({
          ...state().viewOrNull!.values,
          rejectionReason: 'Неполная заявка',
        });
        const saved = commitAdmissionViewValues(
          f.db,
          f.scope,
          request,
          f.allow,
          service.rules,
          validateViewValues,
          f.allow,
        );
        nav('NET-022::CTA::001');
        const before = f.db.serialize(),
          validate = vi.fn();
        const replay = commitAdmissionViewValues(
          f.db,
          f.scope,
          request,
          f.allow,
          service.rules,
          validate,
          f.allow,
        );
        expect(replay.event).toEqual(saved.event);
        expect(replay.current.formId).toBe('NET-021');
        expect(validate).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
        expect(() =>
          commitAdmissionViewValues(
            f.db,
            f.scope,
            { ...request, values: { ...request.values, rejectionReason: 'Другая' } },
            f.allow,
            service.rules,
            validate,
            f.allow,
          ),
        ).toThrow();
        expect(validate).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
      });
      it('parses admission NAV before callbacks and refuses stale VALUES before semantic validation', () => {
        const guard = vi.fn(),
          before = f.db.serialize(),
          request = navigation('NET-018::CTA::002');
        expect(() =>
          commitAdmissionViewNavigation(
            f.db,
            f.scope,
            { ...request, extra: true } as typeof request,
            false,
            f.allow,
            service.rules,
            guard,
          ),
        ).toThrow();
        expect(guard).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
        const values = replaceView(state().viewOrNull!.values);
        expect(() =>
          commitAdmissionViewValues(
            f.db,
            f.scope,
            {
              ...values,
              expectedRevisions: { ...values.expectedRevisions, projectionRevision: 0 },
            },
            f.allow,
            service.rules,
            guard,
            guard,
          ),
        ).toThrow();
        expect(guard).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
      });
      it('projects the source and its rolls without exposing private replay history or allocating identities', () => {
        const before = f.db.serialize(),
          p = project();
        expect(p.base.formId).toBe('NET-018');
        expect(p.layers).toEqual([]);
        expect(p.base.roleFilteredPayload['sourceProvenanceAndNaturalRolls']).toMatchObject({
          provenance: { sourceUuid: prepared(fixture()).descriptor.sourceUuid },
        });
        expect(p.base.roleFilteredPayload['immutableSourceSnapshot']).toBeDefined();
        const bytes = JSON.stringify(p);
        for (const privateKey of [
          'canonicalWitnessText',
          'authoritativeGmActorId',
          'wizardCheckpointId',
          'privateOwner',
          'recordSha256',
          'branchCacheHash',
        ])
          expect(bytes).not.toContain(privateKey);
        expect(f.db.serialize().equals(before)).toBe(true);
      });
      it('opens incomplete NET-021 and NET-022 as dialogs while withholding publication and retaining rejection', () => {
        nav('NET-018::CTA::004');
        const first = project();
        expect(first.base.formId).toBe('NET-018');
        expect(first.base.availableActionKeys).toEqual([]);
        expect(first.layers.map((layer) => [layer.formId, layer.formType])).toEqual([
          ['NET-021', 'dialog'],
        ]);
        expect(first.layers[0]!.roleFilteredPayload).toMatchObject({
          allRequiredFieldsValid: false,
          proposalChecksum: null,
          fullCampaignCopyDiffs: [],
        });
        expect(first.layers[0]!.availableActionKeys).toContain('NET-021::CTA::002');
        expect(first.layers[0]!.availableActionKeys).not.toContain('NET-021::CTA::005');
        nav('NET-021::CTA::002');
        const second = project();
        expect(second.layers.map((layer) => layer.formId)).toEqual(['NET-021', 'NET-022']);
        expect(second.layers[0]!.availableActionKeys).toEqual([]);
        expect(second.layers[1]!.availableActionKeys).not.toContain('NET-022::CTA::003');
      });
      const editInput = () => {
        const current = readAdmissionReview(
          f.db,
          f.scope,
          state().viewOrNull!.admissionBatchId,
          f.allow,
          service.rules,
        ).current;
        const copy = current.copies[0]!;
        return {
          request: {
            commandId: randomUUID(),
            admissionBatchId: current.admissionBatchId,
            expectedReviewRevision: current.reviewRevision,
            intent: {
              kind: 'EDIT' as const,
              reviewCopyId: copy.reviewCopyId,
              inputs: { ...copy.inputs, groupAssignmentOrNull: { kind: 'START' as const } },
            },
          },
          receiptId: randomUUID(),
          timestamp: '2026-11-01T03:21:00.000Z',
        };
      };
      const edit = (
        input: ReturnType<typeof editInput> & {
          readonly clientRequestJsonOrNull?: string | null;
        } = editInput(),
      ) =>
        commitAdmissionReviewEdit(
          f.db,
          f.scope,
          input,
          f.allow,
          service.rules,
          () => input.request.intent,
          f.allow,
        );
      describe('browser edits bound to their original presentation', () => {
        beforeEach(() => {
          nav('NET-018::CTA::002');
        });
        const bound = () => {
          const input = editInput(),
            view = state().viewOrNull!;
          const client = {
            messageType: 'network.admission-review.edit',
            protocolVersion: 3,
            draftUpdateId: input.request.commandId,
            contextId: f.scope.gmLocalContextId,
            campaignId: f.scope.campaignId,
            admissionBatchId: input.request.admissionBatchId,
            sourceFormId: view.formId,
            expectedRevisions: {
              stateRevision: view.stateRevision,
              projectionRevision: view.projectionRevision,
              actorVisibilityRevision: view.actorVisibilityRevision,
            },
            expectedReviewRevision: input.request.expectedReviewRevision,
            intent: input.request.intent,
          };
          return {
            input: { ...input, clientRequestJsonOrNull: canonicalPostSaveJson(client) },
            client,
          };
        };
        it('replays after navigation and refuses a changed or removed original browser binding', () => {
          const { input, client } = bound(),
            saved = edit(input);
          expect(saved.event.clientRequestJsonOrNull).toBe(input.clientRequestJsonOrNull);
          nav('NET-019::CTA::002');
          const before = f.db.serialize();
          expect(edit(input)).toMatchObject({ event: saved.event, replayed: true });
          client.expectedRevisions.projectionRevision++;
          expect(() =>
            edit({ ...input, clientRequestJsonOrNull: canonicalPostSaveJson(client) }),
          ).toThrow('IDEMPOTENCY_CONFLICT');
          const { clientRequestJsonOrNull: _binding, ...unbound } = input;
          expect(() => edit(unbound)).toThrow('IDEMPOTENCY_CONFLICT');
          expect(f.db.serialize().equals(before)).toBe(true);
        });
        it.each(['revision', 'form', 'scope', 'semantic'] as const)(
          'refuses a fresh browser edit with a mismatched %s before writing',
          (mismatch) => {
            const { input, client } = bound();
            if (mismatch === 'revision') client.expectedRevisions.projectionRevision++;
            if (mismatch === 'form') client.sourceFormId = 'NET-020';
            if (mismatch === 'scope') client.contextId = randomUUID();
            if (mismatch === 'semantic')
              client.intent = {
                ...client.intent,
                inputs: {
                  ...client.intent.inputs,
                  statAdjustments: {
                    ...client.intent.inputs.statAdjustments,
                    S: client.intent.inputs.statAdjustments.S + 1,
                  },
                },
              };
            const before = f.db.serialize();
            expect(() =>
              edit({ ...input, clientRequestJsonOrNull: canonicalPostSaveJson(client) }),
            ).toThrow();
            expect(f.db.serialize().equals(before)).toBe(true);
          },
        );
        it('does not upgrade an internally recorded edit to a browser command on replay', () => {
          const { input } = bound(),
            { clientRequestJsonOrNull: _binding, ...unbound } = input;
          edit(unbound);
          const before = f.db.serialize();
          expect(() => edit(input)).toThrow('IDEMPOTENCY_CONFLICT');
          expect(f.db.serialize().equals(before)).toBe(true);
        });
        it('checks the original view even when a forged browser revision and every companion hash are rewritten', () => {
          const { input, client } = bound();
          edit(input);
          client.expectedRevisions.projectionRevision++;
          const stored = f.db
            .prepare('SELECT record_json FROM campaign_admission_event WHERE command_id=?')
            .get(input.request.commandId) as { record_json: string };
          const document = JSON.parse(stored.record_json) as Record<string, unknown>;
          document['clientRequestJsonOrNull'] = canonicalPostSaveJson(client);
          const json = canonicalPostSaveJson(document),
            hash = postSaveSha256(json);
          f.db
            .prepare(
              'UPDATE campaign_admission_event SET record_json=?,record_sha256=? WHERE command_id=?',
            )
            .run(json, hash, input.request.commandId);
          const queueRow = f.db
            .prepare(
              "SELECT event_id,record_json FROM gm_request_queue_event WHERE kind='SOURCE_ADVANCE'",
            )
            .get() as { event_id: string; record_json: string };
          const queue = JSON.parse(queueRow.record_json) as {
            eventId: string;
            scope: unknown;
            mutation: { cause: { recordSha256: string } };
          };
          queue.mutation.cause.recordSha256 = hash;
          queue.eventId = `gm-admission-source:${postSaveSha256(canonicalPostSaveJson({ scope: queue.scope, cause: queue.mutation.cause }))}`;
          const queueJson = canonicalPostSaveJson(queue),
            queueHash = postSaveSha256(queueJson);
          f.db
            .prepare(
              'UPDATE gm_request_queue_event SET event_id=?,record_json=?,record_sha256=? WHERE event_id=?',
            )
            .run(queue.eventId, queueJson, queueHash, queueRow.event_id);
          f.db.prepare('UPDATE gm_request_queue_view SET head_event_id=?').run(queue.eventId);
          const viewRow = f.db
            .prepare(
              "SELECT event_id,record_json FROM gm_admission_view_event WHERE kind='SOURCE_ADVANCE'",
            )
            .get() as { event_id: string; record_json: string };
          const view = JSON.parse(viewRow.record_json) as {
            eventId: string;
            mutation: { queuePrefix: { eventId: string; recordSha256: string } };
          };
          view.eventId = `gm-admission-view-source:${queue.eventId}`;
          view.mutation.queuePrefix = { eventId: queue.eventId, recordSha256: queueHash };
          const viewJson = canonicalPostSaveJson(view);
          f.db
            .prepare(
              'UPDATE gm_admission_view_event SET event_id=?,record_json=?,record_sha256=? WHERE event_id=?',
            )
            .run(view.eventId, viewJson, postSaveSha256(viewJson), viewRow.event_id);
          f.db.prepare('UPDATE gm_admission_view SET head_event_id=?').run(view.eventId);
          const before = f.db.serialize();
          expect(() =>
            readAdmissionReview(
              f.db,
              f.scope,
              input.request.admissionBatchId,
              f.allow,
              service.rules,
            ),
          ).toThrow();
          expect(f.db.serialize().equals(before)).toBe(true);
        });
      });
      it('advances both presentation journals with an edit and preserves the exact replay after navigation', () => {
        const initial = state().viewOrNull!,
          queue = readGmRequestReviewView(f.db, f.scope, f.allow)!;
        const input = editInput(),
          saved = edit(input);
        expect(state().viewOrNull).toMatchObject({
          formId: initial.formId,
          values: initial.values,
          stateRevision: initial.stateRevision + 1,
          projectionRevision: initial.projectionRevision + 1,
          actorVisibilityRevision: initial.actorVisibilityRevision,
        });
        expect(readGmRequestReviewView(f.db, f.scope, f.allow)).toMatchObject({
          stateRevision: queue.stateRevision + 1,
          projectionRevision: queue.projectionRevision + 1,
          actorVisibilityRevision: queue.actorVisibilityRevision,
        });
        expect(
          readCampaignCreationCursor(f.db, f.scope.gmLocalContextId).revisions.projectionRevision,
        ).toBe(initial.projectionRevision + 1);
        nav('NET-018::CTA::002');
        const bytes = f.db.serialize(),
          cursor = readCampaignCreationCursor(f.db, f.scope.gmLocalContextId);
        expect(edit(input)).toMatchObject({ replayed: true, event: saved.event });
        expect(f.db.serialize().equals(bytes)).toBe(true);
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toEqual(cursor);
      });
      it('rolls back the actual edit and queue companion if its admission companion fails', () => {
        const input = editInput();
        f.db.exec(
          "CREATE TRIGGER fail_source_view BEFORE INSERT ON gm_admission_view_event WHEN NEW.kind='SOURCE_ADVANCE' BEGIN SELECT RAISE(ABORT,'source view failure'); END",
        );
        const bytes = f.db.serialize();
        expect(() => edit(input)).toThrow();
        expect(f.db.serialize().equals(bytes)).toBe(true);
        expect(state().events).toHaveLength(1);
      });
      it.each(['queue', 'view', 'both'] as const)(
        'rejects lost %s source companions with authentic previous heads and cursor restored',
        (lost) => {
          const heads = ['gm_request_queue_view', 'gm_admission_view'].map(
            (table) =>
              f.db
                .prepare(`SELECT head_event_id,record_json,record_sha256 FROM ${table}`)
                .get() as { head_event_id: string; record_json: string; record_sha256: string },
          );
          const cursor = f.db
            .prepare(
              'SELECT kind,target_id,form_id,record_json,record_sha256 FROM campaign_creation_cursor',
            )
            .get() as typeof originalCursor;
          const saved = edit();
          for (const [index, family] of ['queue', 'view'].entries()) {
            if (lost !== 'both' && lost !== family) continue;
            const table = index === 0 ? 'gm_request_queue' : 'gm_admission_view',
              head = heads[index]!;
            f.db.prepare(`DELETE FROM ${table}_event WHERE kind='SOURCE_ADVANCE'`).run();
            f.db
              .prepare(
                `UPDATE ${index === 0 ? 'gm_request_queue_view' : 'gm_admission_view'} SET head_event_id=?,record_json=?,record_sha256=?`,
              )
              .run(head.head_event_id, head.record_json, head.record_sha256);
          }
          f.db
            .prepare(
              'UPDATE campaign_creation_cursor SET kind=?,target_id=?,form_id=?,record_json=?,record_sha256=?',
            )
            .run(
              cursor.kind,
              cursor.target_id,
              cursor.form_id,
              cursor.record_json,
              cursor.record_sha256,
            );
          const damaged = f.db.serialize();
          expect(() =>
            readAdmissionReview(
              f.db,
              f.scope,
              saved.review.current.admissionBatchId,
              f.allow,
              service.rules,
            ),
          ).toThrow();
          expect(() => open()).toThrow();
          expect(f.db.serialize().equals(damaged)).toBe(true);
        },
      );
      it('advances an inactive admission view on preliminary rejection and keeps the queue selected', () => {
        f.db
          .transaction(() =>
            returnGmAdmissionViewInTransaction(f.db, f.scope, navigation('NET-018::CTA::001')),
          )
          .immediate();
        let queue = readGmRequestReviewView(f.db, f.scope, f.allow)!;
        const reason = 'Пересобрать заявку';
        commitGmRequestReviewDraft(
          f.db,
          f.scope,
          {
            messageType: 'network.gm-request-draft.replace',
            protocolVersion: 3,
            draftUpdateId: randomUUID(),
            scope: {
              gmLocalContextId: f.scope.gmLocalContextId,
              campaignId: f.scope.campaignId,
              sourceFormId: 'NET-017',
            },
            expectedRevisions: {
              stateRevision: queue.stateRevision,
              projectionRevision: queue.projectionRevision,
              actorVisibilityRevision: queue.actorVisibilityRevision,
            },
            expectedRequestQueueRevision: queue.requestQueueRevision,
            values: { ...queue.values, decisionReason: reason },
          },
          f.allow,
          f.allow,
        );
        queue = readGmRequestReviewView(f.db, f.scope, f.allow)!;
        const before = state().viewOrNull!;
        commitGmDeviceRequestDecision(
          f.db,
          f.scope,
          {
            request: {
              ...f.openRequest,
              commandId: randomUUID(),
              workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
              expectedRevisions: {
                stateRevision: queue.stateRevision,
                projectionRevision: queue.projectionRevision,
                actorVisibilityRevision: queue.actorVisibilityRevision,
              },
              payload: { ...f.openRequest.payload, reason },
            },
            receiptId: randomUUID(),
            timestamp: '2026-11-01T03:22:00.000Z',
          },
          f.allow,
          f.allow,
        );
        expect(state().viewOrNull).toMatchObject({
          active: false,
          stateRevision: before.stateRevision + 1,
          projectionRevision: before.projectionRevision + 1,
          actorVisibilityRevision: before.actorVisibilityRevision,
        });
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId).kind).toBe('QUEUE');
        expect(
          readAdmissionReview(f.db, f.scope, before.admissionBatchId, f.allow, service.rules)
            .editable,
        ).toBe(false);
      });
      it('rejects a lost RETURN companion even when genuine earlier queue head and cursor bytes are restored', () => {
        const request = navigation('NET-018::CTA::001');
        f.db
          .transaction(() => returnGmAdmissionViewInTransaction(f.db, f.scope, request))
          .immediate();
        f.db
          .prepare('DELETE FROM gm_request_queue_event WHERE event_id=?')
          .run(`gm-admission-return:${request.navigationRequestId}`);
        f.db
          .prepare('UPDATE gm_request_queue_view SET head_event_id=?,record_json=?,record_sha256=?')
          .run(
            originalQueueHead.head_event_id,
            originalQueueHead.record_json,
            originalQueueHead.record_sha256,
          );
        f.db
          .prepare(
            'UPDATE campaign_creation_cursor SET kind=?,target_id=?,form_id=?,record_json=?,record_sha256=?',
          )
          .run(
            originalCursor.kind,
            originalCursor.target_id,
            originalCursor.form_id,
            originalCursor.record_json,
            originalCursor.record_sha256,
          );
        const damaged = f.db.serialize();
        expect(state).toThrow();
        expect(() => readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toThrow();
        expect(() => readGmRequestReviewView(f.db, f.scope, f.allow)).toThrow();
        expect(() => open()).toThrow();
        expect(f.db.serialize().equals(damaged)).toBe(true);
      });
      it('restores its actual saved view after reopening SQLite and rejects a missing journal tail', async () => {
        nav('NET-018::CTA::002');
        const saved = state(),
          directory = mkdtempSync(join(tmpdir(), 'admission-gm-view-'));
        directories.push(directory);
        const filename = join(directory, 'campaign.sqlite');
        await f.db.backup(filename);
        f.db.close();
        const reopened = openPersistenceDatabase(filename);
        admissionDatabases.push(reopened);
        f = { ...f, db: reopened };
        expect(state()).toEqual(saved);
        expect(open().kind).toBe('REPLAYED');
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId).formId).toBe('NET-019');
        f.db
          .prepare('DELETE FROM gm_admission_view_event WHERE event_id=?')
          .run(saved.events.at(-1)!.eventId);
        const damaged = f.db.serialize();
        expect(state).toThrow();
        expect(() => open()).toThrow();
        expect(f.db.serialize().equals(damaged)).toBe(true);
      });
      it('keeps source/copies untouched while preserving selected form and rejection draft', () => {
        const initial = state().viewOrNull!,
          before = readAdmissionReview(
            f.db,
            f.scope,
            initial.admissionBatchId,
            f.allow,
            service.rules,
          );
        nav('NET-018::CTA::004');
        nav('NET-021::CTA::002');
        const current = state().viewOrNull!,
          updateId = randomUUID();
        f.db
          .transaction(() =>
            appendGmAdmissionViewEventInTransaction(f.db, f.scope, {
              eventId: updateId,
              mutation: {
                kind: 'VALUES',
                updateId,
                sourceFormId: current.formId,
                expectedRevisions: {
                  stateRevision: current.stateRevision,
                  projectionRevision: current.projectionRevision,
                  actorVisibilityRevision: current.actorVisibilityRevision,
                },
                values: { ...current.values, rejectionReason: 'Обсудим имущество перед допуском' },
              },
            }),
          )
          .immediate();
        const saved = state().viewOrNull!;
        expect(saved).toMatchObject({
          formId: 'NET-022',
          values: { rejectionReason: 'Обсудим имущество перед допуском' },
        });
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toMatchObject({
          kind: 'ADMISSION',
          formId: 'NET-022',
          revisions: { projectionRevision: saved.projectionRevision },
        });
        expect(
          readAdmissionReview(f.db, f.scope, initial.admissionBatchId, f.allow, service.rules)
            .current,
        ).toEqual(before.current);
        expect(f.db.prepare('SELECT count(*) AS n FROM campaign_character_copy').get()).toEqual({
          n: 0,
        });
        const bytes = f.db.serialize();
        expect(open().kind).toBe('REPLAYED');
        expect(f.db.serialize().equals(bytes)).toBe(true);
        expect(state().viewOrNull).toEqual(saved);
      });
      it('returns above a newer background queue revision and never switches cursor on an old OPEN or RETURN replay', () => {
        nav('NET-018::CTA::002');
        const departing = state().viewOrNull!;
        for (let n = 0; n < 5; n++)
          commitGmRequestReviewConnectionRefresh(
            f.db,
            f.scope,
            { eventId: randomUUID(), connectionFactsSha256: postSaveSha256(String(n)) },
            f.allow,
            f.allow,
          );
        const queued = readGmRequestReviewView(f.db, f.scope, f.allow)!;
        expect(queued.projectionRevision).toBeGreaterThan(departing.projectionRevision);
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId).kind).toBe('ADMISSION');
        const request = navigation('NET-019::CTA::001');
        const returned = f.db
          .transaction(() => returnGmAdmissionViewInTransaction(f.db, f.scope, request))
          .immediate();
        expect(returned.current.projectionRevision).toBe(
          Math.max(queued.projectionRevision, departing.projectionRevision) + 1,
        );
        expect(returned.current.stateRevision).toBe(
          Math.max(queued.stateRevision, departing.stateRevision),
        );
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toMatchObject({
          kind: 'QUEUE',
          formId: 'NET-017',
        });
        const recoveryRequest = {
          ...f.openRequest,
          commandId: randomUUID(),
          expectedRevisions: {
            stateRevision: returned.current.stateRevision,
            projectionRevision: returned.current.projectionRevision,
            actorVisibilityRevision: returned.current.actorVisibilityRevision,
          },
        };
        const reopened = open(recoveryRequest);
        expect(reopened.kind).toBe('RECOVERED');
        expect(reopened.viewOrNull?.admissionBatchId).toBe(departing.admissionBatchId);
        expect(reopened.entryOrNull?.mutation).toMatchObject({
          kind: 'ENTER',
          clientRequestJson: canonicalPostSaveJson(recoveryRequest),
        });
        if (reopened.entryOrNull?.mutation.kind !== 'ENTER')
          throw new Error('missing recovery receipt');
        expect(reopened.entryOrNull.mutation.receiptId).not.toBe(
          reopened.review.open.receipt.receiptId,
        );
        expect(reopened.review.open.receipt.commandId).toBe(f.openRequest.commandId);
        nav('NET-018::CTA::003');
        const cursor = readCampaignCreationCursor(f.db, f.scope.gmLocalContextId),
          bytes = f.db.serialize();
        expect(open().kind).toBe('REPLAYED');
        const recoveredReplay = open(recoveryRequest);
        expect(recoveredReplay.entryOrNull).toEqual(reopened.entryOrNull);
        expect(recoveredReplay.review.open).toEqual(reopened.review.open);
        expect(
          f.db
            .transaction(() => returnGmAdmissionViewInTransaction(f.db, f.scope, request))
            .immediate().replayed,
        ).toBe(true);
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toEqual(cursor);
        expect(f.db.serialize().equals(bytes)).toBe(true);
      });
      it('rolls back RETURN if its queue companion fails', () => {
        const request = navigation('NET-018::CTA::001');
        f.db.exec(
          "CREATE TRIGGER fail_admission_return BEFORE INSERT ON gm_request_queue_event WHEN NEW.kind='ADMISSION_RETURN' BEGIN SELECT RAISE(ABORT,'return failure'); END",
        );
        const before = f.db.serialize();
        expect(() =>
          f.db
            .transaction(() => returnGmAdmissionViewInTransaction(f.db, f.scope, request))
            .immediate(),
        ).toThrow();
        expect(f.db.serialize().equals(before)).toBe(true);
        expect(state().viewOrNull?.active).toBe(true);
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId).kind).toBe('ADMISSION');
      });
      it('captures recovery receipt metadata before a guard can redirect the caller object', () => {
        const original = readAdmissionReview(
          f.db,
          f.scope,
          state().viewOrNull!.admissionBatchId,
          f.allow,
          service.rules,
        ).open;
        const returned = f.db
          .transaction(() =>
            returnGmAdmissionViewInTransaction(f.db, f.scope, navigation('NET-018::CTA::001')),
          )
          .immediate();
        const input = {
          request: {
            ...f.openRequest,
            commandId: randomUUID(),
            expectedRevisions: {
              stateRevision: returned.current.stateRevision,
              projectionRevision: returned.current.projectionRevision,
              actorVisibilityRevision: returned.current.actorVisibilityRevision,
            },
          },
          receiptId: randomUUID(),
          timestamp: '2026-11-01T03:30:00.000Z',
        };
        const receiptId = input.receiptId,
          timestamp = input.timestamp;
        const saved = commitAdmissionReviewOpenWithView(
          f.db,
          f.scope,
          input,
          f.allow,
          service.rules,
          () => {
            throw new Error('recovery must not allocate');
          },
          () => {
            input.receiptId = randomUUID();
            input.timestamp = '2026-11-01T03:31:00.000Z';
          },
        );
        expect(saved.kind).toBe('RECOVERED');
        expect(saved.entryOrNull?.mutation).toMatchObject({ kind: 'ENTER', receiptId, timestamp });
        expect(saved.review.open).toEqual(original);
        const bytes = f.db.serialize();
        expect(open(input.request).entryOrNull).toEqual(saved.entryOrNull);
        expect(f.db.serialize().equals(bytes)).toBe(true);
      });
      it('rejects nested accessors and foreign copy selection without invoking or writing', () => {
        const current = state().viewOrNull!,
          getter = vi.fn(() => current.values.selectedReviewCopyId),
          updateId = randomUUID();
        const common = {
          kind: 'VALUES' as const,
          updateId,
          sourceFormId: current.formId,
          expectedRevisions: {
            stateRevision: current.stateRevision,
            projectionRevision: current.projectionRevision,
            actorVisibilityRevision: current.actorVisibilityRevision,
          },
        };
        const before = f.db.serialize();
        for (const values of [
          Object.defineProperty({ ...current.values }, 'selectedReviewCopyId', {
            enumerable: true,
            get: getter,
          }),
          { ...current.values, selectedReviewCopyId: randomUUID() },
        ])
          expect(() =>
            f.db
              .transaction(() =>
                appendGmAdmissionViewEventInTransaction(f.db, f.scope, {
                  eventId: updateId,
                  mutation: { ...common, values },
                }),
              )
              .immediate(),
          ).toThrow();
        expect(getter).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
      });
    });
  });
  describe('source advances after entering a prepared real review', () => {
    let f: ReturnType<typeof publicationStoreFixture>;
    const state = () =>
      f.db.transaction(() => readGmAdmissionViewStateInTransaction(f.db, f.scope)).deferred();
    beforeEach(() => {
      f = publicationStoreFixture();
    });
    beforeEach(() => {
      const queue = readGmRequestReviewView(f.db, f.scope, f.allow)!;
      commitAdmissionReviewOpenWithView(
        f.db,
        f.scope,
        {
          request: {
            ...f.openRequest,
            commandId: randomUUID(),
            expectedRevisions: {
              stateRevision: queue.stateRevision,
              projectionRevision: queue.projectionRevision,
              actorVisibilityRevision: queue.actorVisibilityRevision,
            },
          },
          receiptId: randomUUID(),
          timestamp: '2026-11-01T03:25:00.000Z',
        },
        f.allow,
        f.rules,
        () => {
          throw new Error('recovery must reuse original copies');
        },
        f.allow,
      );
    });
    describe('browser publication commands', () => {
      const navigate = (actionKey: FormActionIntentV2Message['actionKey']) => {
        const view = state().viewOrNull!,
          request: FormActionIntentV2Message = {
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: view.formId,
            actionKey,
            expectedProjectionRevision: view.projectionRevision,
          };
        return f.db
          .transaction(() =>
            appendGmAdmissionViewEventInTransaction(f.db, f.scope, {
              eventId: request.navigationRequestId,
              mutation: { kind: 'NAV', request },
            }),
          )
          .immediate();
      };
      beforeEach(() => {
        navigate('NET-018::CTA::004');
      });
      const bound = (decision: 'ACCEPT' | 'REJECT') => {
        if (decision === 'REJECT') {
          navigate('NET-021::CTA::002');
          const view = state().viewOrNull!;
          f.db
            .transaction(() => {
              const id = randomUUID();
              appendGmAdmissionViewEventInTransaction(f.db, f.scope, {
                eventId: id,
                mutation: {
                  kind: 'VALUES',
                  updateId: id,
                  sourceFormId: view.formId,
                  expectedRevisions: {
                    stateRevision: view.stateRevision,
                    projectionRevision: view.projectionRevision,
                    actorVisibilityRevision: view.actorVisibilityRevision,
                  },
                  values: { ...view.values, rejectionReason: 'Набор требует исправлений' },
                },
              });
            })
            .immediate();
        }
        const view = state().viewOrNull!,
          request = {
            ...f.input.request,
            decision,
            previewChecksumOrNull:
              decision === 'ACCEPT' ? f.input.request.previewChecksumOrNull : null,
            reasonOrNull: decision === 'ACCEPT' ? null : view.values.rejectionReason,
          },
          { commandId, decision: _decision, ...payload } = request;
        const client = {
          messageType: 'command.request',
          protocolVersion: 1,
          commandKind: 'workflow-command',
          role: 'gm',
          workflowCommandId:
            decision === 'ACCEPT' ? 'UI-CMD-ADMISSION-GM-ACCEPT' : 'UI-CMD-ADMISSION-GM-REJECT',
          commandId,
          expectedRevisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
          payload: { ...payload, contextId: f.scope.gmLocalContextId },
        };
        return {
          input: { ...f.input, request, clientRequestJsonOrNull: canonicalPostSaveJson(client) },
          client,
        };
      };
      it.each(['ACCEPT', 'REJECT'] as const)(
        'preserves the exact browser %s receipt after leaving its form',
        (decision) => {
          const { input, client } = bound(decision),
            saved = commitAdmissionGmDecision(
              f.db,
              f.scope,
              input,
              f.allow,
              f.rules,
              randomUUID,
              f.allow,
            ),
            view = state().viewOrNull!;
          expect(saved.current.gmDecisionOrNull!.clientRequestJsonOrNull).toBe(
            input.clientRequestJsonOrNull,
          );
          f.db
            .transaction(() =>
              returnGmAdmissionViewInTransaction(f.db, f.scope, {
                messageType: 'navigation.form-action',
                protocolVersion: 2,
                navigationRequestId: randomUUID(),
                sourceFormId: view.formId,
                actionKey: decision === 'ACCEPT' ? 'NET-021::CTA::001' : 'NET-022::CTA::002',
                expectedProjectionRevision: view.projectionRevision,
              }),
            )
            .immediate();
          const before = f.db.serialize(),
            allocate = vi.fn(randomUUID);
          expect(
            commitAdmissionGmDecision(f.db, f.scope, input, f.allow, f.rules, allocate, f.allow),
          ).toMatchObject({
            replayed: true,
            current: { gmDecisionOrNull: saved.current.gmDecisionOrNull },
          });
          client.expectedRevisions.projectionRevision++;
          expect(() =>
            commitAdmissionGmDecision(
              f.db,
              f.scope,
              { ...input, clientRequestJsonOrNull: canonicalPostSaveJson(client) },
              f.allow,
              f.rules,
              allocate,
              f.allow,
            ),
          ).toThrow('IDEMPOTENCY_CONFLICT');
          const { clientRequestJsonOrNull: _binding, ...unbound } = input;
          expect(() =>
            commitAdmissionGmDecision(f.db, f.scope, unbound, f.allow, f.rules, allocate, f.allow),
          ).toThrow('IDEMPOTENCY_CONFLICT');
          expect(allocate).not.toHaveBeenCalled();
          expect(f.db.serialize().equals(before)).toBe(true);
        },
      );
      it('rejects stale outer publication revisions before allocating copies', () => {
        const { input, client } = bound('ACCEPT');
        client.expectedRevisions.projectionRevision++;
        const before = f.db.serialize(),
          allocate = vi.fn(randomUUID);
        expect(() =>
          commitAdmissionGmDecision(
            f.db,
            f.scope,
            { ...input, clientRequestJsonOrNull: canonicalPostSaveJson(client) },
            f.allow,
            f.rules,
            allocate,
            f.allow,
          ),
        ).toThrow('STALE_REVISION');
        expect(allocate).not.toHaveBeenCalled();
        expect(f.db.serialize().equals(before)).toBe(true);
      });
    });
    it.each(['ACCEPT', 'REJECT'] as const)(
      'refuses a fresh review OPEN after GM %s while retaining the original OPEN replay',
      (decision) => {
        const input =
          decision === 'ACCEPT'
            ? f.input
            : {
                ...f.input,
                request: {
                  ...f.input.request,
                  decision,
                  previewChecksumOrNull: null,
                  reasonOrNull: 'Набор не допущен',
                },
              };
        commitAdmissionGmDecision(f.db, f.scope, input, f.allow, f.rules, randomUUID, f.allow);
        const view = state().viewOrNull!;
        const returned = f.db
          .transaction(() =>
            returnGmAdmissionViewInTransaction(f.db, f.scope, {
              messageType: 'navigation.form-action',
              protocolVersion: 2,
              navigationRequestId: randomUUID(),
              sourceFormId: 'NET-018',
              actionKey: 'NET-018::CTA::001',
              expectedProjectionRevision: view.projectionRevision,
            }),
          )
          .immediate();
        const bytes = f.db.serialize();
        expect(() =>
          commitAdmissionReviewOpenWithView(
            f.db,
            f.scope,
            {
              request: {
                ...f.openRequest,
                commandId: randomUUID(),
                expectedRevisions: {
                  stateRevision: returned.current.stateRevision,
                  projectionRevision: returned.current.projectionRevision,
                  actorVisibilityRevision: returned.current.actorVisibilityRevision,
                },
              },
              receiptId: randomUUID(),
              timestamp: '2026-11-01T03:26:00.000Z',
            },
            f.allow,
            f.rules,
            () => {
              throw new Error('terminal cannot allocate');
            },
            f.allow,
          ),
        ).toThrow('STALE_REVISION');
        const replay = commitAdmissionReviewOpen(
          f.db,
          f.scope,
          {
            request: f.openRequest,
            receiptId: randomUUID(),
            timestamp: '2026-11-01T03:27:00.000Z',
          },
          f.allow,
          f.rules,
          () => {
            throw new Error('replay cannot allocate');
          },
          f.allow,
        );
        expect(replay.kind).toBe('REPLAYED');
        expect(replay.review.open.receipt).toEqual(f.review.open.receipt);
        expect(f.db.serialize().equals(bytes)).toBe(true);
      },
    );
    it.each(['ACCEPT', 'DECLINE'] as const)(
      'preserves the active form while GM ACCEPT and player %s each advance visibility once',
      (decision) => {
        const before = state().viewOrNull!;
        const player = playerDecisionFixture(decision, f);
        expect(state().viewOrNull).toMatchObject({
          formId: before.formId,
          values: before.values,
          active: true,
          stateRevision: before.stateRevision + 1,
          projectionRevision: before.projectionRevision + 1,
          actorVisibilityRevision: before.actorVisibilityRevision + 1,
        });
        const accepted = player.decide();
        expect(state().viewOrNull).toMatchObject({
          formId: before.formId,
          values: before.values,
          active: true,
          stateRevision: before.stateRevision + 2,
          projectionRevision: before.projectionRevision + 2,
          actorVisibilityRevision: before.actorVisibilityRevision + 2,
        });
        const bytes = f.db.serialize();
        expect(player.decide()).toEqual({ ...accepted, replayed: true });
        expect(f.db.serialize().equals(bytes)).toBe(true);
        expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toMatchObject({
          kind: 'ADMISSION',
          revisions: { actorVisibilityRevision: before.actorVisibilityRevision + 2 },
        });
      },
    );
    it('keeps visibility unchanged for GM REJECT while advancing the reviewed presentation', () => {
      const before = state().viewOrNull!;
      commitAdmissionGmDecision(
        f.db,
        f.scope,
        {
          ...f.input,
          request: {
            ...f.input.request,
            decision: 'REJECT',
            previewChecksumOrNull: null,
            reasonOrNull: 'Набор не допущен',
          },
        },
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      );
      expect(state().viewOrNull).toMatchObject({
        stateRevision: before.stateRevision + 1,
        projectionRevision: before.projectionRevision + 1,
        actorVisibilityRevision: before.actorVisibilityRevision,
      });
      expect(f.db.prepare('SELECT count(*) AS n FROM campaign_character_copy').get()).toEqual({
        n: 0,
      });
    });
  });
  describe('published-copy navigation without a prior admission view', () => {
    let f: ReturnType<typeof playerDecisionFixture>;
    beforeEach(() => {
      f = playerDecisionFixture('DECLINE');
    });
    const state = () =>
      f.db.transaction(() => readGmAdmissionViewStateInTransaction(f.db, f.scope)).deferred();
    const request = (
      actionKey: FormActionIntentV2Message['actionKey'] = 'NET-017::CTA::001',
    ): FormActionIntentV2Message => ({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: 'NET-017',
      actionKey,
      expectedProjectionRevision: readGmRequestReviewView(f.db, f.scope, f.allow)!
        .projectionRevision,
    });
    const enter = (value = request()) =>
      enterPublishedAdmissionView(f.db, f.scope, value, f.allow, f.rules, f.allow);
    it.each([
      ['NET-017::CTA::001', 'NET-018'],
      ['NET-017::CTA::002', 'NET-019'],
      ['NET-017::CTA::003', 'NET-020'],
      ['NET-017::CTA::004', 'NET-021'],
    ] as const)(
      'opens %s as immutable published history without another OPEN receipt',
      (actionKey, formId) => {
        const publication = f.published.gmDecisionOrNull;
        const opened = enter(request(actionKey));
        expect(opened.current.review.editable).toBe(false);
        expect(opened.current.gmDecisionOrNull).toEqual(publication);
        expect(state().viewOrNull).toMatchObject({
          active: true,
          formId,
          admissionBatchId: f.review.current.admissionBatchId,
        });
        expect(state().events[0]?.mutation.kind).toBe('ENTER_PUBLISHED');
        expect(
          f.db
            .prepare(
              'SELECT count(*) AS n FROM gm_admission_view_event WHERE open_command_id IS NOT NULL OR open_receipt_id IS NOT NULL',
            )
            .get(),
        ).toEqual({ n: 0 });
        expect(f.db.prepare('SELECT count(*) AS n FROM campaign_admission_batch').get()).toEqual({
          n: 1,
        });
      },
    );
    it('retains a published navigation replay after the owner declines, without reopening the view', () => {
      const nav = request(),
        opened = enter(nav);
      const view = state().viewOrNull!;
      f.db
        .transaction(() =>
          returnGmAdmissionViewInTransaction(f.db, f.scope, {
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: 'NET-018',
            actionKey: 'NET-018::CTA::001',
            expectedProjectionRevision: view.projectionRevision,
          }),
        )
        .immediate();
      f.decide();
      const bytes = f.db.serialize(),
        cursor = readCampaignCreationCursor(f.db, f.scope.gmLocalContextId);
      expect(enter(nav)).toMatchObject({ replayed: true, event: opened.event });
      expect(() => enter()).toThrow('STALE_REVISION');
      expect(readCampaignCreationCursor(f.db, f.scope.gmLocalContextId)).toEqual(cursor);
      expect(state().viewOrNull?.active).toBe(false);
      expect(f.db.serialize().equals(bytes)).toBe(true);
    });
    it('rolls back the complete navigation on a failed view insert and rejects stale projection without writes', () => {
      const nav = request();
      expect(() =>
        enter({ ...nav, expectedProjectionRevision: nav.expectedProjectionRevision - 1 }),
      ).toThrow('STALE_REVISION');
      f.db.exec(
        "CREATE TRIGGER fail_published_enter BEFORE INSERT ON gm_admission_view BEGIN SELECT RAISE(ABORT,'published entry failure'); END",
      );
      const bytes = f.db.serialize();
      expect(() => enter(nav)).toThrow();
      expect(f.db.serialize().equals(bytes)).toBe(true);
      expect(state().viewOrNull).toBeNull();
    });
  });
  describe('published navigation for an accepted mixed two-copy batch', () => {
    const sources: Source[] = [];
    let filename: string,
      f: ReturnType<typeof publicationStoreFixture>,
      owner: ReturnType<typeof createAdmissionOwnerFixture>;
    let published: ReturnType<typeof commitAdmissionGmDecision>['current'];
    let pending: ReturnType<typeof prepareLocalAdmissionDecision>,
      accepted: ReturnType<typeof commitAdmissionPlayerDecision>['current'];
    beforeAll(() => {
      const directory = mkdtempSync(join(tmpdir(), 'admission-mixed-history-'));
      directories.push(directory);
      filename = join(directory, 'player.sqlite');
    });
    for (const index of [1, 2])
      beforeAll(async () => {
        sources.push(
          await source('PURE', 'AUTO', filename, true, `mixed-history-${String(index)}`),
        );
      });
    beforeEach(() => {
      f = publicationStoreFixture(':memory:', { sources, approveIndices: [0] });
    });
    beforeEach(() => {
      owner = createAdmissionOwnerFixture(
        sources[0]!.d.database,
        f,
        f.review.request.proof,
        filename + '.owner.sqlite',
      );
      admissionDatabases.push(owner.db);
    });
    beforeEach(() => {
      published = commitAdmissionGmDecision(
        f.db,
        f.scope,
        f.input,
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      ).current;
      const publicationBody = {
        schemaVersion: 1 as const,
        gmDecision: admissionGmDecisionNotice(published.gmDecisionOrNull!.receipt),
        groupLabels: [],
        proposalOrNull: published.gmDecisionOrNull!.proposalOrNull,
      };
      receiveLocalAdmissionPublication(
        owner.db,
        owner.scope,
        owner.hostIdentity,
        {
          ...publicationBody,
          publicationChecksum: postSaveSha256(canonicalPostSaveJson(publicationBody)),
        },
        f.allow,
      );
    });
    beforeEach(() => {
      pending = prepareLocalAdmissionDecision(
        owner.db,
        owner.scope,
        {
          requestId: f.batch.requestId,
          commandId: randomUUID(),
          decision: 'ACCEPT',
          expectedCampaignRevision: loadCampaignCheckpoint(f.db, f.scope.campaignId).stateRevision,
        },
        randomUUID,
        f.allow,
      );
    });
    beforeEach(() => {
      accepted = commitAdmissionPlayerDecision(
        f.db,
        f.scope,
        f.src.owner,
        {
          request: pending.pendingDecisionOrNull!,
          receiptId: randomUUID(),
          timestamp: '2026-11-01T03:40:00.000Z',
        },
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      ).current;
    });
    it('selects the first actual PROPOSED copy and preserves the original whole-batch order', () => {
      expect(
        accepted.playerDecisionOrNull!.receipt.copies.map((copy) => copy.lifecycleState),
      ).toEqual(['ACTIVE', 'PROPOSED']);
      const queue = readGmRequestReviewView(f.db, f.scope, f.allow)!;
      const saved = enterPublishedAdmissionView(
        f.db,
        f.scope,
        {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId: 'NET-017',
          actionKey: 'NET-017::CTA::001',
          expectedProjectionRevision: queue.projectionRevision,
        },
        f.allow,
        f.rules,
        f.allow,
      );
      expect(saved.event.view.values.selectedReviewCopyId).toBe(
        f.review.current.copies[1]!.reviewCopyId,
      );
      expect(saved.event.mutation).toMatchObject({
        kind: 'ENTER_PUBLISHED',
        selectedReviewCopyId: f.review.current.copies[1]!.reviewCopyId,
      });
      expect(saved.current.gmDecisionOrNull).toEqual(published.gmDecisionOrNull);
    });
  });
  describe('a final GM refusal before copies exist', () => {
    let f: ReturnType<typeof publicationStoreFixture>;
    beforeEach(() => {
      f = publicationStoreFixture();
      commitAdmissionGmDecision(
        f.db,
        f.scope,
        {
          ...f.input,
          request: {
            ...f.input.request,
            decision: 'REJECT',
            previewChecksumOrNull: null,
            reasonOrNull: 'Исправьте заявку и отправьте повторно',
          },
        },
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      );
    });
    it('permits the same immutable FINAL in a new request in the original actual session', () => {
      expect(readCampaignAdmissionAvailability(f.db, f.scope, f.allow, f.rules)).toMatchObject({
        occupiedCampaignPlaceCount: 0,
        activePcCount: 0,
        releasedRequestIds: [f.batch.requestId],
        importedSources: [],
      });
      const before = readAdmissionDecision(
          f.db,
          f.scope,
          f.review.current.admissionBatchId,
          f.allow,
          f.rules,
        ),
        { batchSha256: _old, ...original } = f.batch,
        body = { ...original, requestId: randomUUID() },
        batch = { ...body, batchSha256: postSaveSha256(canonicalPostSaveJson(body)) },
        commandId = randomUUID();
      const next = commitHostedNetworkCommand(
        f.db,
        f.principal,
        {
          operation: 'SUBMIT',
          commandId,
          receiptId: randomUUID(),
          requestId: batch.requestId,
          technicalSessionId: batch.technicalSessionId,
          expectedConnectionRevision: batch.connectionRevision,
          batch,
          semanticBodyJson: deviceAdmissionSubmitSemanticBody(commandId, batch.batchSha256),
        },
        f.allow,
        f.allow,
        undefined,
        f.rules,
      );
      expect(next.receipt.operation).toBe('SUBMIT');
      if (next.receipt.operation !== 'SUBMIT') throw new Error('Expected SUBMIT');
      expect(next.receipt.request.technicalSessionId).toBe(f.batch.technicalSessionId);
      expect(next.receipt.request.requestId).not.toBe(f.batch.requestId);
      expect(batch.candidates).toEqual(f.batch.candidates);
      expect(
        readAdmissionDecision(f.db, f.scope, f.review.current.admissionBatchId, f.allow, f.rules)
          .gmDecisionOrNull,
      ).toEqual(before.gmDecisionOrNull);
      expect(f.db.prepare('SELECT count(*) AS n FROM campaign_character_copy').get()).toEqual({
        n: 0,
      });
    });
  });
  describe('fresh request availability from complete admission history', () => {
    let f: ReturnType<typeof playerDecisionFixture>;
    const sources: Source[] = [];
    let filename: string;
    beforeAll(() => {
      const directory = mkdtempSync(join(tmpdir(), 'symbiosis-admission-retry-'));
      directories.push(directory);
      filename = join(directory, 'player.sqlite');
    });
    for (const index of [0, 1])
      beforeAll(async () => {
        sources.push(await source('PURE', 'AUTO', filename, true, `retry-source-${String(index)}`));
      });
    beforeEach(() => {
      f = playerDecisionFixture(
        'ACCEPT',
        publicationStoreFixture(':memory:', { capacity: 1, source: sources[0]! }),
      );
    });
    const available = () => readCampaignAdmissionAvailability(f.db, f.scope, f.allow, f.rules);
    const resubmit = (withRules = true, sameSource = false) => {
      const selectedSource = sources[sameSource ? 0 : 1];
      if (selectedSource === undefined) throw new Error('Missing actual retry source');
      const checkpoint = loadCampaignCheckpoint(f.db, f.scope.campaignId),
        commandId = randomUUID(),
        body = {
          ...f.batch,
          candidates: [prepared(selectedSource)],
          requestId: randomUUID(),
          campaignProof: {
            campaignId: f.scope.campaignId,
            checkpointSha256: postSaveSha256(checkpoint.snapshotJson),
            revisions: {
              stateRevision: checkpoint.stateRevision,
              projectionRevision: checkpoint.projectionRevision,
              actorVisibilityRevision: checkpoint.actorVisibilityRevision,
            },
          },
        };
      const { batchSha256: _old, ...canonicalBody } = body,
        batch = {
          ...canonicalBody,
          batchSha256: postSaveSha256(canonicalPostSaveJson(canonicalBody)),
        };
      return commitHostedNetworkCommand(
        f.db,
        f.principal,
        {
          operation: 'SUBMIT',
          commandId,
          receiptId: randomUUID(),
          requestId: batch.requestId,
          technicalSessionId: batch.technicalSessionId,
          expectedConnectionRevision: batch.connectionRevision,
          batch,
          semanticBodyJson: deviceAdmissionSubmitSemanticBody(commandId, batch.batchSha256),
        },
        f.allow,
        f.allow,
        undefined,
        withRules ? f.rules : undefined,
      );
    };
    it('does not reserve a place for PROPOSED and does not release its still-pending original request', () => {
      expect(available()).toMatchObject({
        occupiedCampaignPlaceCount: 0,
        activePcCount: 0,
        releasedRequestIds: [],
      });
      const before = f.db.serialize();
      expect(() => resubmit()).toThrow(/UNAVAILABLE/);
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    describe('after player ACCEPT with lobby blockers', () => {
      beforeEach(() => {
        f.decide();
      });
      it('counts the occupied place, refuses a new SUBMIT and still replays the exact original receipt', () => {
        expect(available()).toMatchObject({
          occupiedCampaignPlaceCount: 1,
          activePcCount: 0,
          releasedRequestIds: [],
        });
        const before = f.db.serialize();
        expect(() => resubmit()).toThrow(/CAPACITY_EXCEEDED/);
        const replay = commitHostedNetworkCommand(
          f.db,
          f.principal,
          f.submitted.input,
          f.allow,
          f.allow,
          undefined,
          f.rules,
        );
        expect(replay.receipt).toEqual(f.submitted.receipt);
        expect(f.db.serialize().equals(before)).toBe(true);
      });
    });
    describe('after player DECLINE', () => {
      beforeEach(() => {
        f.decide({
          ...f.playerInput,
          request: {
            ...f.playerInput.request,
            decision: 'DECLINE',
            controllerPreparationOrNull: null,
          },
        });
      });
      it('allows a new request in the same actual session without rewriting terminal receipts', () => {
        expect(available()).toMatchObject({
          occupiedCampaignPlaceCount: 0,
          activePcCount: 0,
          releasedRequestIds: [f.batch.requestId],
        });
        const old = readAdmissionDecision(
            f.db,
            f.scope,
            f.review.current.admissionBatchId,
            f.allow,
            f.rules,
          ),
          next = resubmit();
        expect(next.receipt.operation).toBe('SUBMIT');
        if (next.receipt.operation !== 'SUBMIT') throw new Error('Expected SUBMIT');
        expect(next.receipt.request.technicalSessionId).toBe(f.batch.technicalSessionId);
        expect(next.receipt.request.requestId).not.toBe(f.batch.requestId);
        expect(
          readAdmissionDecision(f.db, f.scope, f.review.current.admissionBatchId, f.allow, f.rules)
            .playerDecisionOrNull,
        ).toEqual(old.playerDecisionOrNull);
      });
      it('refuses a caller without final-admission rules instead of treating a completed history as empty', () => {
        const before = f.db.serialize();
        expect(() => resubmit(false)).toThrow(/UNAVAILABLE/);
        expect(f.db.serialize().equals(before)).toBe(true);
      });
      it('keeps a DECLINED copy source UUID reserved by its one permitted campaign import', () => {
        const before = f.db.serialize();
        expect(() => resubmit(true, true)).toThrow(/IDEMPOTENCY_CONFLICT/);
        expect(f.db.serialize().equals(before)).toBe(true);
      });
      it('refuses a lost player history tail instead of releasing its original request', () => {
        f.db.pragma('foreign_keys = OFF');
        f.db.prepare('DELETE FROM campaign_admission_player_decision').run();
        expect(() => available()).toThrow();
        expect(() => resubmit()).toThrow();
      });
    });
  });
  describe('the owning installation admission journal', () => {
    let f: ReturnType<typeof playerDecisionFixture>,
      owner: ReturnType<typeof createAdmissionOwnerFixture>;
    beforeEach(() => {
      f = playerDecisionFixture();
      owner = createAdmissionOwnerFixture(f.src.d.database, f, f.published.review.request.proof);
      admissionDatabases.push(owner.db);
    });
    const receivePublication = () => {
      const gm = f.published.gmDecisionOrNull!,
        body = {
          schemaVersion: 1 as const,
          gmDecision: admissionGmDecisionNotice(gm.receipt),
          groupLabels: [],
          proposalOrNull: gm.proposalOrNull,
        },
        publication = { ...body, publicationChecksum: postSaveSha256(canonicalPostSaveJson(body)) };
      return receiveLocalAdmissionPublication(
        owner.db,
        owner.scope,
        owner.hostIdentity,
        publication,
        f.allow,
      );
    };
    const prepare = (decision: 'ACCEPT' | 'DECLINE' = 'ACCEPT', commandId: string = randomUUID()) =>
      prepareLocalAdmissionDecision(
        owner.db,
        owner.scope,
        {
          requestId: f.batch.requestId,
          commandId,
          decision,
          expectedCampaignRevision: loadCampaignCheckpoint(f.db, f.scope.campaignId).stateRevision,
        },
        randomUUID,
        f.allow,
      );
    const acknowledge = (request: AdmissionPlayerDecisionRequest) => {
      const result = f.decide({ ...f.playerInput, request });
      return {
        result,
        input: { kind: 'ACK' as const, receipt: result.current.playerDecisionOrNull!.receipt },
      };
    };
    describe('a receipt and admission projection in one read snapshot', () => {
      it.each([false, true])(
        'preserves the complete checked view with publication=%s',
        (published) => {
          if (published) receivePublication();
          const commandId = f.submitted.receipt.commandId,
            before = owner.db.serialize(),
            expectedDelivery = readLocalNetworkDeliverySnapshot(owner.db, owner.scope, commandId),
            expectedPresentation = readLocalAdmissionPresentation(owner.db, owner.scope);
          const prepare = vi.spyOn(owner.db, 'prepare');
          try {
            const actual = readLocalAdmissionDelivery(owner.db, owner.scope, commandId);
            expect(actual).toEqual({
              delivery: expectedDelivery,
              presentation: expectedPresentation,
            });
            expect(actual.presentation !== null).toBe(published);
            expect(
              prepare.mock.calls.filter(([sql]) =>
                sql.includes(
                  'SELECT * FROM local_network_application_event WHERE network_scope_id=? ORDER BY event_index',
                ),
              ),
            ).toHaveLength(1);
          } finally {
            prepare.mockRestore();
          }
          expect(readLocalAdmissionDelivery(owner.db, owner.scope)).toEqual({
            delivery: readLocalNetworkRequestDeliverySnapshot(owner.db, owner.scope),
            presentation: expectedPresentation,
          });
          for (const invalid of [null, undefined])
            expect(() =>
              readLocalNetworkDeliverySnapshot(owner.db, owner.scope, invalid as unknown as string),
            ).toThrow();
          expect(() =>
            readLocalAdmissionDelivery(owner.db, owner.scope, null as unknown as string),
          ).toThrow();
          expect(owner.db.serialize().equals(before)).toBe(true);
        },
      );
      it.each(['missing-publication', 'corrupt-network-head', 'foreign-outbox'] as const)(
        'still rejects %s without a partial result or write',
        (corruption) => {
          receivePublication();
          const commandId = f.submitted.receipt.commandId;
          if (corruption === 'missing-publication')
            owner.db.prepare('DELETE FROM local_admission_publication').run();
          else if (corruption === 'corrupt-network-head')
            owner.db
              .prepare('UPDATE local_network_application SET record_sha256=?')
              .run('0'.repeat(64));
          else
            owner.db
              .prepare('UPDATE local_network_outbox SET owner_device_id=? WHERE command_id=?')
              .run(randomUUID(), commandId);
          const before = owner.db.serialize();
          expect(() => readLocalAdmissionDelivery(owner.db, owner.scope, commandId)).toThrow();
          expect(owner.db.serialize().equals(before)).toBe(true);
        },
      );
    });
    describe('the ordering of owner-to-network mirrors', () => {
      beforeEach(() => {
        receivePublication();
      });
      beforeEach(() => {
        prepare('DECLINE');
      });
      it('rejects reversed publication/INTENT mirrors even when every local hash is valid', () => {
        type Event = {
          input: Parameters<typeof commitLocalNetworkMutation>[1];
          receipt: ReturnType<typeof commitLocalNetworkMutation>['receipt'];
          previousSha256: string;
          nextSha256: string;
        };
        type Row = {
          event_id: string;
          receipt_id: string;
          network_scope_id: string;
          owner_device_id: string;
          event_index: number;
          record_json: string;
          record_sha256: string;
        };
        const rows = (
          owner.db
            .prepare(
              'SELECT * FROM local_network_application_event WHERE network_scope_id=? ORDER BY event_index',
            )
            .all(owner.scope.networkScopeId) as Row[]
        ).filter((row) => {
          const event = JSON.parse(row.record_json) as Event;
          return (
            event.input.mutation.kind === 'ADMISSION_ADVANCE' &&
            event.input.mutation.requestId === f.batch.requestId
          );
        });
        expect(rows).toHaveLength(2);
        const first = JSON.parse(rows[0]!.record_json) as Event;
        const second = JSON.parse(rows[1]!.record_json) as Event;
        expect(first.input.mutation).toMatchObject({ ownerEventIdOrNull: null });
        expect(second.input.mutation.kind).toBe('ADMISSION_ADVANCE');
        expect(rows[1]!.event_index).toBe(rows[0]!.event_index + 1);

        const ownerRows = owner.db
          .prepare('SELECT * FROM local_admission_publication ORDER BY request_id')
          .all();
        const ownerEvents = owner.db
          .prepare('SELECT * FROM local_admission_event ORDER BY event_id')
          .all();
        const originalHead = owner.db
          .prepare('SELECT * FROM local_network_application WHERE network_scope_id=?')
          .get(owner.scope.networkScopeId) as {
          head_event_id: string;
          record_json: string;
          record_sha256: string;
        };
        expect(originalHead.head_event_id).toBe(second.input.eventId);

        // Both ADMISSION_ADVANCE operations have exactly the same state effect (+1 S/P),
        // so their before/after state hashes remain valid when only mirror identities move.
        // Each position retains its own expected vector and receipt revisions. The owner
        // journal remains byte-for-byte unchanged; only chronological mirror order is wrong.
        const reversed = [
          {
            ...first,
            input: {
              ...first.input,
              eventId: second.input.eventId,
              receiptId: second.input.receiptId,
              mutation: second.input.mutation,
            },
            receipt: {
              ...first.receipt,
              eventId: second.input.eventId,
              receiptId: second.input.receiptId,
            },
          },
          {
            ...second,
            input: {
              ...second.input,
              eventId: first.input.eventId,
              receiptId: first.input.receiptId,
              mutation: first.input.mutation,
            },
            receipt: {
              ...second.receipt,
              eventId: first.input.eventId,
              receiptId: first.input.receiptId,
            },
          },
        ];
        owner.db.transaction(() => {
          for (const row of rows)
            owner.db
              .prepare('DELETE FROM local_network_application_event WHERE event_id=?')
              .run(row.event_id);
          reversed.forEach((event, i) => {
            const json = canonicalPostSaveJson(event);
            owner.db
              .prepare('INSERT INTO local_network_application_event VALUES (?,?,?,?,?,?,?)')
              .run(
                event.input.eventId,
                event.input.receiptId,
                event.input.networkScopeId,
                event.input.ownerDeviceId,
                rows[i]!.event_index,
                json,
                postSaveSha256(json),
              );
          });
          owner.db
            .prepare(
              'UPDATE local_network_application SET head_event_id=? WHERE network_scope_id=?',
            )
            .run(first.input.eventId, owner.scope.networkScopeId);
        })();

        expect(
          owner.db.prepare('SELECT * FROM local_admission_publication ORDER BY request_id').all(),
        ).toEqual(ownerRows);
        expect(
          owner.db.prepare('SELECT * FROM local_admission_event ORDER BY event_id').all(),
        ).toEqual(ownerEvents);
        const damagedHead = owner.db
          .prepare('SELECT * FROM local_network_application WHERE network_scope_id=?')
          .get(owner.scope.networkScopeId) as { record_json: string; record_sha256: string };
        expect(damagedHead.record_json).toBe(originalHead.record_json);
        expect(damagedHead.record_sha256).toBe(originalHead.record_sha256);
        const damagedBytes = owner.db.serialize();
        expect(() => readLocalAdmission(owner.db, owner.scope, f.batch.requestId)).toThrow(
          /CORRUPT_STORAGE/,
        );
        expect(owner.db.serialize().equals(damagedBytes)).toBe(true);
      });
    });
    describe('the original identity and transport fence of an absence proof', () => {
      let state: ReturnType<typeof prepare>;
      beforeEach(() => {
        receivePublication();
      });
      beforeEach(() => {
        state = prepare();
      });
      it.each([
        ['requestId', admissionId(800)],
        ['technicalSessionId', admissionId(801)],
        ['submitCommandId', 'different-original-submit'],
        ['fenced', false],
        ['generation', 0],
      ] as const)(
        'rejects a mismatched %s without releasing the pending intent',
        (field, value) => {
          const request = state.pendingDecisionOrNull!,
            proof = {
              operation: 'ADMISSION_PLAYER_DECISION_ABSENT' as const,
              commandId: request.commandId,
              semanticBodySha256: postSaveSha256(canonicalPostSaveJson(request)),
              campaignId: request.campaignId,
              admissionBatchId: request.admissionBatchId,
              campaignRevision: request.expectedCampaignRevision,
              requestId: f.batch.requestId,
              technicalSessionId: state.record.technicalSessionId,
              submitCommandId: state.record.submitCommandId,
              fenced: true as const,
              generation: 1,
              code: 'NOT_APPLIED' as const,
            },
            before = owner.db.serialize();
          expect(() =>
            acknowledgeLocalAdmissionDecision(
              owner.db,
              owner.scope,
              f.batch.requestId,
              randomUUID(),
              owner.hostIdentity,
              { kind: 'FENCED_ABSENT', proof: { ...proof, [field]: value } },
              f.allow,
            ),
          ).toThrow();
          expect(owner.db.serialize().equals(before)).toBe(true);
          expect(
            readLocalAdmission(owner.db, owner.scope, f.batch.requestId)!.pendingDecisionOrNull,
          ).toEqual(request);
        },
      );
    });

    describe('NET-007 after the authenticated whole-batch DECLINE', () => {
      beforeEach(() => {
        receivePublication();
      });
      beforeEach(() => {
        prepare('DECLINE');
      });
      beforeEach(() => {
        const pending = readLocalAdmission(
          owner.db,
          owner.scope,
          f.batch.requestId,
        )!.pendingDecisionOrNull!;
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          acknowledge(pending).input,
          f.allow,
        );
      });
      it.each(['RESELECT', 'MENU'] as const)(
        'returns with %s while preserving the original tab, session and immutable source',
        (mode) => {
          const before = readLocalNetworkApplication(owner.db, owner.scope),
            input = admissionReturnInput(owner, f.batch.requestId, mode),
            finals = owner.db
              .prepare('SELECT * FROM local_character ORDER BY local_character_id')
              .all(),
            outboxes = owner.db
              .prepare('SELECT * FROM local_network_outbox ORDER BY command_id')
              .all();
          const saved = returnFromLocalAdmission(owner.db, owner.scope, input, randomUUID, f.allow),
            after = readLocalNetworkApplication(owner.db, owner.scope);
          expect(saved.returnedOrNull?.mode).toBe(mode);
          expect(after).toMatchObject({
            tabId: before.tabId,
            sessionOrNull: before.sessionOrNull,
            requestOrNull: null,
            requestReviewOrNull: null,
            formId: 'NET-003',
            selectedCandidates: [],
            preparedBatchOrNull: null,
            stateRevision: before.stateRevision + 1,
            projectionRevision: before.projectionRevision + 1,
            actorVisibilityRevision: 0,
            draftRevision: before.draftRevision + 1,
          });
          expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)?.tabId).toBe(
            owner.tabId,
          );
          expect(
            owner.db.prepare('SELECT * FROM local_character ORDER BY local_character_id').all(),
          ).toEqual(finals);
          expect(
            owner.db.prepare('SELECT * FROM local_network_outbox ORDER BY command_id').all(),
          ).toEqual(outboxes);
          const bytes = owner.db.serialize(),
            allocate = vi.fn(randomUUID);
          expect(returnFromLocalAdmission(owner.db, owner.scope, input, allocate, f.allow)).toEqual(
            saved,
          );
          expect(allocate).not.toHaveBeenCalled();
          expect(owner.db.serialize().equals(bytes)).toBe(true);
        },
      );
      it('rolls back both journals on a post-write guard failure', () => {
        const input = admissionReturnInput(owner, f.batch.requestId),
          before = owner.db.serialize();
        const phases: boolean[] = [];
        expect(() =>
          returnFromLocalAdmission(owner.db, owner.scope, input, randomUUID, (state) => {
            phases.push(state.returnedOrNull !== null);
            if (state.returnedOrNull !== null) throw new Error('return post-write guard');
          }),
        ).toThrow(/INVALID_INPUT/);
        expect(phases).toEqual([false, true]);
        expect(owner.db.serialize().equals(before)).toBe(true);
      });
      it('rejects a stale revision before allocating or releasing anything', () => {
        const input = admissionReturnInput(owner, f.batch.requestId),
          before = owner.db.serialize(),
          allocate = vi.fn(randomUUID);
        expect(() =>
          returnFromLocalAdmission(
            owner.db,
            owner.scope,
            { ...input, expectedDraftRevision: input.expectedDraftRevision - 1 },
            allocate,
            f.allow,
          ),
        ).toThrow(/STALE_REVISION/);
        expect(allocate).not.toHaveBeenCalled();
        expect(owner.db.serialize().equals(before)).toBe(true);
      });
      describe('a later local presentation', () => {
        let input: ReturnType<typeof admissionReturnInput>,
          saved: ReturnType<typeof returnFromLocalAdmission>;
        beforeEach(() => {
          input = admissionReturnInput(owner, f.batch.requestId);
          saved = returnFromLocalAdmission(owner.db, owner.scope, input, randomUUID, f.allow);
        });
        it('allows subsequent selection and preserves it on exact RETURN replay', () => {
          const current = readLocalNetworkApplication(owner.db, owner.scope),
            selectedCandidates = f.batch.candidates.map((c) => ({
              sourceUuid: c.descriptor.sourceUuid,
              finalSnapshotVersion: c.descriptor.finalSnapshotVersion,
              metadataRevision: c.descriptor.metadataRevision,
              candidateSnapshotChecksum: c.descriptor.sourceChecksum,
              requestedControllerSeat: owner.tabId,
            })),
            event = commitLocalNetworkMutation(
              owner.db,
              {
                ...owner.scope,
                eventId: randomUUID(),
                receiptId: randomUUID(),
                expectedRevisions: {
                  stateRevision: current.stateRevision,
                  projectionRevision: current.projectionRevision,
                  actorVisibilityRevision: 0,
                },
                expectedDraftRevision: current.draftRevision,
                clientRequestJsonOrNull: canonicalPostSaveJson({
                  messageType: 'network.draft.replace',
                  protocolVersion: 3,
                  draftUpdateId: randomUUID(),
                  variant: 'SELECTION',
                  expectedDraftRevision: current.draftRevision,
                  expectedRevisions: {
                    stateRevision: current.stateRevision,
                    projectionRevision: current.projectionRevision,
                    actorVisibilityRevision: 0,
                  },
                  scope: {
                    networkScopeId: owner.scope.networkScopeId,
                    contextId: randomUUID(),
                    sourceFormId: 'NET-003',
                  },
                  values: { selectedCandidates },
                }),
                mutation: { kind: 'SELECTION', selectedCandidates },
              },
              f.allow,
            );
          const bytes = owner.db.serialize(),
            allocation = vi.fn(randomUUID);
          expect(
            returnFromLocalAdmission(owner.db, owner.scope, input, allocation, f.allow),
          ).toEqual(saved);
          expect(allocation).not.toHaveBeenCalled();
          expect(readLocalNetworkApplication(owner.db, owner.scope)).toEqual(event.current);
          expect(event.current.selectedCandidates).toEqual(selectedCandidates);
          expect(event.current.projectionRevision).toBe(current.projectionRevision + 1);
          expect(owner.db.serialize().equals(bytes)).toBe(true);
        });
        it('preserves audited root closure and a later active tab on exact RETURN replay', () => {
          const current = readLocalNetworkApplication(owner.db, owner.scope);
          commitLocalNetworkTabClose(
            owner.db,
            {
              ...owner.scope,
              closeCommandId: randomUUID(),
              closeReceiptId: randomUUID(),
              expectedRevisions: {
                stateRevision: current.stateRevision,
                projectionRevision: current.projectionRevision,
                actorVisibilityRevision: 0,
              },
            },
            f.allow,
          );
          const next = commitLocalNetworkTabEntry(
            owner.db,
            {
              ownerDeviceId: owner.scope.ownerDeviceId,
              networkScopeId: randomUUID(),
              tabId: randomUUID(),
              entryCommandId: randomUUID(),
              entryReceiptId: randomUUID(),
              sourceContextId: randomUUID(),
              sourceRevisions: {
                stateRevision: 0,
                projectionRevision: 0,
                actorVisibilityRevision: 0,
              },
            },
            f.allow,
          ).currentTab;
          const bytes = owner.db.serialize();
          expect(
            returnFromLocalAdmission(owner.db, owner.scope, input, randomUUID, f.allow),
          ).toEqual(saved);
          expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)).toEqual(next);
          expect(owner.db.serialize().equals(bytes)).toBe(true);
        });
      });
    });
    it('rejects accessors before cloning and never accepts an INTENT through the ACK API', () => {
      const received = receivePublication();
      const before = owner.db.serialize(),
        getter = vi.fn(() => 'ACK'),
        accessor = Object.defineProperty({}, 'kind', { enumerable: true, get: getter });
      expect(() =>
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          accessor as Parameters<typeof acknowledgeLocalAdmissionDecision>[5],
          f.allow,
        ),
      ).toThrow();
      const nested = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
      expect(() =>
        prepareLocalAdmissionDecision(
          owner.db,
          owner.scope,
          {
            requestId: nested,
            commandId: randomUUID(),
            decision: 'ACCEPT',
            expectedCampaignRevision: 1,
          } as unknown as Parameters<typeof prepareLocalAdmissionDecision>[2],
          randomUUID,
          f.allow,
        ),
      ).toThrow();
      expect(getter).not.toHaveBeenCalled();
      const publication = structuredClone(received.record.publication);
      Object.defineProperty(publication.gmDecision, 'commandId', { enumerable: true, get: getter });
      expect(() =>
        receiveLocalAdmissionPublication(
          owner.db,
          owner.scope,
          owner.hostIdentity,
          publication,
          f.allow,
        ),
      ).toThrow();
      const arrayPublication = structuredClone(received.record.publication);
      Object.defineProperty(arrayPublication.proposalOrNull!.fullCampaignCopyDiffs, '0', {
        enumerable: true,
        get: getter,
      });
      expect(() =>
        receiveLocalAdmissionPublication(
          owner.db,
          owner.scope,
          owner.hostIdentity,
          arrayPublication,
          f.allow,
        ),
      ).toThrow();
      const receipt = structuredClone(f.decide().current.playerDecisionOrNull!.receipt);
      Object.defineProperty(receipt, 'commandId', { enumerable: true, get: getter });
      expect(() =>
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          { kind: 'ACK', receipt },
          f.allow,
        ),
      ).toThrow();
      expect(getter).not.toHaveBeenCalled();
      expect(() =>
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          f.playerInput.request.commandId,
          owner.hostIdentity,
          {
            kind: 'INTENT',
            request: f.playerInput.request,
            additionalTabs: [],
          } as unknown as Parameters<typeof acknowledgeLocalAdmissionDecision>[5],
          f.allow,
        ),
      ).toThrow();
      expect(owner.db.serialize().equals(before)).toBe(true);
    });
    it('rejects nested GM and player request accessors before executing a callback or opening a write', () => {
      const before = f.db.serialize(),
        getter = vi.fn(() => randomUUID()),
        guard = vi.fn(f.allow),
        gm = structuredClone(f.input),
        player = structuredClone(f.playerInput);
      Object.defineProperty(gm.request, 'commandId', { enumerable: true, get: getter });
      Object.defineProperty(player.request.controllerPreparationOrNull!.controllerBindings, '0', {
        enumerable: true,
        get: getter,
      });
      expect(() =>
        commitAdmissionGmDecision(f.db, f.scope, gm, f.allow, f.rules, randomUUID, guard),
      ).toThrow();
      expect(() => f.decide(player, randomUUID, guard)).toThrow();
      expect(getter).not.toHaveBeenCalled();
      expect(guard).not.toHaveBeenCalled();
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    describe('the exact ACCEPT intent until the host ACK', () => {
      let state: ReturnType<typeof receivePublication>,
        first: ReturnType<typeof prepare>,
        request: AdmissionPlayerDecisionRequest;
      beforeEach(() => {
        state = receivePublication();
      });
      beforeEach(() => {
        first = prepare();
        request = first.pendingDecisionOrNull!;
      });
      it('binds the real local SUBMIT and replays its original preparation without allocation', () => {
        expect(state.record.originalTabId).toBe(owner.tabId);
        expect(first.receiptOrNull).toBeNull();
        expect(request.controllerPreparationOrNull!.controllerBindings[0]!.inputLaneId).toBe(
          owner.tabId,
        );
        const allocation = vi.fn(randomUUID);
        expect(
          prepareLocalAdmissionDecision(
            owner.db,
            owner.scope,
            {
              requestId: f.batch.requestId,
              commandId: request.commandId,
              decision: 'ACCEPT',
              expectedCampaignRevision: request.expectedCampaignRevision,
            },
            allocation,
            f.allow,
          ),
        ).toEqual(first);
        expect(allocation).not.toHaveBeenCalled();
        expect(() => prepare('DECLINE')).toThrow(/UNAVAILABLE/);
      });
      it('refuses ordinary mutations of the possibly accepted original seat', () => {
        const before = owner.db.serialize(),
          app = readLocalNetworkApplication(owner.db, owner.scope);
        expect(() =>
          commitLocalNetworkMutation(
            owner.db,
            {
              ...owner.scope,
              eventId: randomUUID(),
              receiptId: randomUUID(),
              expectedRevisions: {
                stateRevision: app.stateRevision,
                projectionRevision: app.projectionRevision,
                actorVisibilityRevision: app.actorVisibilityRevision,
              },
              expectedDraftRevision: app.draftRevision,
              clientRequestJsonOrNull: null,
              mutation: { kind: 'DIAGNOSTIC', code: 'PEER_UNAVAILABLE' },
            },
            f.allow,
          ),
        ).toThrow(/UNAVAILABLE/);
        expect(owner.db.serialize().equals(before)).toBe(true);
      });
      it('stores and exactly replays the authenticated host ACK', () => {
        const ack = acknowledge(request),
          eventId = randomUUID();
        const saved = acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          eventId,
          owner.hostIdentity,
          ack.input,
          f.allow,
        );
        expect(saved.receiptOrNull).toEqual(ack.input.receipt);
        expect(saved.pendingDecisionOrNull).toBeNull();
        expect(ack.input.receipt.copies[0]!.occupiesCampaignPlace).toBe(true);
        expect(
          acknowledgeLocalAdmissionDecision(
            owner.db,
            owner.scope,
            f.batch.requestId,
            eventId,
            owner.hostIdentity,
            ack.input,
            f.allow,
          ),
        ).toEqual(saved);
      });
    });
    describe('a decision pending when another actual tab is selected', () => {
      let first: ReturnType<typeof prepare>;
      let next: ReturnType<typeof commitLocalNetworkTabEntry>['currentTab'];
      beforeEach(receivePublication);
      beforeEach(() => {
        first = prepare();
      });
      beforeEach(() => {
        next = commitLocalNetworkTabEntry(
          owner.db,
          {
            ownerDeviceId: owner.scope.ownerDeviceId,
            networkScopeId: randomUUID(),
            tabId: randomUUID(),
            entryCommandId: randomUUID(),
            entryReceiptId: randomUUID(),
            sourceContextId: randomUUID(),
            sourceRevisions: {
              stateRevision: 0,
              projectionRevision: 0,
              actorVisibilityRevision: 0,
            },
          },
          f.allow,
        ).currentTab;
      });
      it('preserves a later active-tab choice when recovering and acknowledging the original intent', () => {
        const request = first.pendingDecisionOrNull!;
        expect(prepare('ACCEPT', request.commandId)).toEqual(first);
        const ack = acknowledge(request);
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          ack.input,
          f.allow,
        );
        expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)).toEqual(next);
      });
    });
    describe('replacement after a fenced absence', () => {
      let first: ReturnType<typeof prepare>;
      beforeEach(receivePublication);
      beforeEach(() => {
        first = prepare();
      });
      it('permits replacement only after a matching fenced absence and reuses the prepared seat identities', () => {
        const request = first.pendingDecisionOrNull!,
          proof = {
            operation: 'ADMISSION_PLAYER_DECISION_ABSENT' as const,
            commandId: request.commandId,
            semanticBodySha256: postSaveSha256(canonicalPostSaveJson(request)),
            campaignId: request.campaignId,
            admissionBatchId: request.admissionBatchId,
            campaignRevision: request.expectedCampaignRevision,
            requestId: first.record.publication.gmDecision.requestId,
            submitCommandId: first.record.submitCommandId,
            technicalSessionId: first.record.technicalSessionId,
            fenced: true as const,
            generation: 1,
            code: 'CAPACITY_EXCEEDED' as const,
          };
        const before = owner.db.serialize();
        expect(() =>
          acknowledgeLocalAdmissionDecision(
            owner.db,
            owner.scope,
            f.batch.requestId,
            randomUUID(),
            owner.hostIdentity,
            { kind: 'FENCED_ABSENT', proof: { ...proof, commandId: randomUUID() } },
            f.allow,
          ),
        ).toThrow();
        expect(owner.db.serialize().equals(before)).toBe(true);
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          { kind: 'FENCED_ABSENT', proof },
          f.allow,
        );
        const second = prepare();
        expect(second.preparationOrNull).toEqual(first.preparationOrNull);
        expect(second.pendingDecisionOrNull!.commandId).not.toBe(request.commandId);
      });
    });
    it('rolls back the local ACK if delivery validation fails and refuses a missing history tail', () => {
      receivePublication();
      const first = prepare(),
        ack = acknowledge(first.pendingDecisionOrNull!),
        before = owner.db.serialize();
      expect(() =>
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          ack.input,
          (state) => {
            if (state.receiptOrNull !== null) throw new Error('response verification');
          },
        ),
      ).toThrow();
      expect(owner.db.serialize().equals(before)).toBe(true);
      expect(readLocalAdmission(owner.db, owner.scope, f.batch.requestId)).toEqual(first);
      owner.db.pragma('foreign_keys = OFF');
      owner.db.prepare('DELETE FROM local_admission_event').run();
      expect(() => readLocalAdmission(owner.db, owner.scope, f.batch.requestId)).toThrow();
    });
    it('records a whole DECLINE without preparing a controller or inventing a GM reason', () => {
      receivePublication();
      const first = prepare('DECLINE');
      expect(first.preparationOrNull).toBeNull();
      const ack = acknowledge(first.pendingDecisionOrNull!);
      const saved = acknowledgeLocalAdmissionDecision(
        owner.db,
        owner.scope,
        f.batch.requestId,
        randomUUID(),
        owner.hostIdentity,
        ack.input,
        f.allow,
      );
      expect(saved.receiptOrNull!.decision).toBe('DECLINE');
      expect(saved.receiptOrNull!.controllerProofOrNull).toBeNull();
      expect(saved.receiptOrNull!.copies[0]!.occupiesCampaignPlace).toBe(false);
    });
  });
  describe('three real FINALs from one owning installation', () => {
    const sources: Source[] = [];
    let filename: string,
      f: ReturnType<typeof playerDecisionFixture>,
      ownerPreparation: ReturnType<typeof prepareAdmissionOwnerFixture>,
      owner: ReturnType<typeof createAdmissionOwnerFixture>;
    beforeAll(() => {
      const directory = mkdtempSync(join(tmpdir(), 'symbiosis-admission-batch-'));
      directories.push(directory);
      filename = join(directory, 'player.sqlite');
    });
    for (const index of [1, 2, 3]) {
      let setup: Awaited<ReturnType<typeof prepareSource>>;
      beforeAll(async () => {
        setup = await prepareSource('PURE', 'AUTO', filename, `admission-batch-${String(index)}`);
      });
      beforeAll(() => {
        // Keep actual creation and FINAL commits, but budget these distinct fixture phases separately.
        sources.push(finishSource(setup, true, `admission-batch-${String(index)}`));
      });
    }
    let publication: ReturnType<typeof publicationStoreFixture>;
    beforeEach(() => {
      publication = publicationStoreFixture(':memory:', { sources });
    });
    beforeEach(() => {
      f = playerDecisionFixture('ACCEPT', publication);
    });
    beforeEach(() => {
      const directory = mkdtempSync(join(tmpdir(), 'symbiosis-admission-owner-'));
      directories.push(directory);
      ownerPreparation = prepareAdmissionOwnerFixture(
        sources[0]!.d.database,
        f,
        f.published.review.request.proof,
        join(directory, 'owner.sqlite'),
      );
      admissionDatabases.push(ownerPreparation.db);
    });
    beforeEach(() => {
      owner = ownerPreparation.submit();
    });
    beforeEach(() => {
      const gm = f.published.gmDecisionOrNull!,
        body = {
          schemaVersion: 1 as const,
          gmDecision: admissionGmDecisionNotice(gm.receipt),
          groupLabels: [],
          proposalOrNull: gm.proposalOrNull,
        };
      receiveLocalAdmissionPublication(
        owner.db,
        owner.scope,
        owner.hostIdentity,
        { ...body, publicationChecksum: postSaveSha256(canonicalPostSaveJson(body)) },
        f.allow,
      );
    });
    let prepared: ReturnType<typeof prepareLocalAdmissionDecision>;
    beforeEach(() => {
      prepared = prepareLocalAdmissionDecision(
        owner.db,
        owner.scope,
        {
          requestId: f.batch.requestId,
          commandId: randomUUID(),
          decision: 'ACCEPT',
          expectedCampaignRevision: loadCampaignCheckpoint(f.db, f.scope.campaignId).stateRevision,
        },
        randomUUID,
        f.allow,
      );
    });
    describe('NET-007 releases a preparation after a fenced absence and real DECLINE', () => {
      beforeEach(() => {
        const request = prepared.pendingDecisionOrNull!;
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          {
            kind: 'FENCED_ABSENT',
            proof: {
              operation: 'ADMISSION_PLAYER_DECISION_ABSENT',
              commandId: request.commandId,
              semanticBodySha256: postSaveSha256(canonicalPostSaveJson(request)),
              campaignId: request.campaignId,
              admissionBatchId: request.admissionBatchId,
              campaignRevision: request.expectedCampaignRevision,
              requestId: prepared.record.publication.gmDecision.requestId,
              submitCommandId: prepared.record.submitCommandId,
              technicalSessionId: prepared.record.technicalSessionId,
              fenced: true,
              generation: 1,
              code: 'CAPACITY_EXCEEDED',
            },
          },
          f.allow,
        );
      });
      let declined: ReturnType<typeof prepareLocalAdmissionDecision>;
      beforeEach(() => {
        declined = prepareLocalAdmissionDecision(
          owner.db,
          owner.scope,
          {
            requestId: f.batch.requestId,
            commandId: randomUUID(),
            decision: 'DECLINE',
            expectedCampaignRevision: loadCampaignCheckpoint(f.db, f.scope.campaignId)
              .stateRevision,
          },
          randomUUID,
          f.allow,
        );
      });
      beforeEach(() => {
        const receipt = f.decide({ ...f.playerInput, request: declined.pendingDecisionOrNull! })
          .current.playerDecisionOrNull!.receipt;
        acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          { kind: 'ACK', receipt },
          f.allow,
        );
      });
      let input: ReturnType<typeof admissionReturnInput>;
      beforeEach(() => {
        input = admissionReturnInput(owner, f.batch.requestId);
      });
      describe('the completed return', () => {
        let saved: ReturnType<typeof returnFromLocalAdmission>;
        beforeEach(() => {
          saved = returnFromLocalAdmission(owner.db, owner.scope, input, randomUUID, f.allow);
        });
        it('retires only the two extra tabs while preserving the original actual tab', () => {
          expect(saved.returnedOrNull!.additionalClosures).toHaveLength(2);
          for (const entry of prepared.additionalTabs)
            expect(
              readOwnedLocalNetworkTab(owner.db, owner.scope.ownerDeviceId, entry.networkScopeId),
            ).toBeNull();
          expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)?.tabId).toBe(
            owner.tabId,
          );
        });
        it('retains exact identities and replay across real SQLite reopen', () => {
          const filename = owner.db.name;
          owner.db.close();
          const reopened = openPersistenceDatabase(filename);
          admissionDatabases.push(reopened);
          expect(readLocalAdmission(reopened, owner.scope, f.batch.requestId)).toEqual(saved);
          const before = reopened.serialize(),
            allocate = vi.fn(randomUUID);
          expect(returnFromLocalAdmission(reopened, owner.scope, input, allocate, f.allow)).toEqual(
            saved,
          );
          expect(allocate).not.toHaveBeenCalled();
          expect(reopened.serialize().equals(before)).toBe(true);
        });
      });
      it('rolls back extra closures and both journals if the final owner guard fails', () => {
        const before = owner.db.serialize(),
          phases: boolean[] = [];
        expect(() =>
          returnFromLocalAdmission(owner.db, owner.scope, input, randomUUID, (state) => {
            phases.push(state.returnedOrNull !== null);
            if (state.returnedOrNull !== null) throw new Error('post close guard');
          }),
        ).toThrow(/INVALID_INPUT/);
        expect(phases).toEqual([false, true]);
        expect(owner.db.serialize().equals(before)).toBe(true);
      });
    });
    it('prepares three actual exclusive tabs without issuing admission authority or changing the active tab', () => {
      const bindings = prepared.preparationOrNull!.controllerBindings;
      expect(bindings).toHaveLength(3);
      expect(new Set(bindings.map((b) => b.inputLaneId)).size).toBe(3);
      expect(prepared.additionalTabs).toHaveLength(2);
      for (const entry of prepared.additionalTabs) {
        expect(
          readOwnedLocalNetworkTab(owner.db, owner.scope.ownerDeviceId, entry.networkScopeId)
            ?.tabId,
        ).toBe(entry.tabId);
      }
      expect(prepared.receiptOrNull).toBeNull();
      expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)?.tabId).toBe(
        owner.tabId,
      );
    });
    it('protects both extra prepared tabs from ordinary close commands', () => {
      const before = owner.db.serialize();
      for (const entry of prepared.additionalTabs) {
        expect(() =>
          commitLocalNetworkTabClose(
            owner.db,
            {
              ownerDeviceId: owner.scope.ownerDeviceId,
              networkScopeId: entry.networkScopeId,
              closeCommandId: randomUUID(),
              closeReceiptId: randomUUID(),
              expectedRevisions: {
                stateRevision: 0,
                projectionRevision: 0,
                actorVisibilityRevision: 0,
              },
            },
            f.allow,
          ),
        ).toThrow(/CLOSE_UNAVAILABLE/);
      }
      expect(owner.db.serialize().equals(before)).toBe(true);
    });
    it('counts both extra tabs against the limit before the host has accepted', () => {
      expect(() =>
        commitLocalNetworkTabEntry(
          owner.db,
          {
            ownerDeviceId: owner.scope.ownerDeviceId,
            tabId: randomUUID(),
            networkScopeId: randomUUID(),
            entryCommandId: randomUUID(),
            entryReceiptId: randomUUID(),
            sourceContextId: randomUUID(),
            sourceRevisions: {
              stateRevision: 0,
              projectionRevision: 0,
              actorVisibilityRevision: 0,
            },
          },
          f.allow,
        ),
      ).toThrow(/TAB_LIMIT/);
    });
    describe('acknowledging the accepted whole batch', () => {
      let original: ReturnType<typeof readActiveLocalNetworkTab>,
        originals: unknown[],
        receipt: NonNullable<
          ReturnType<typeof f.decide>['current']['playerDecisionOrNull']
        >['receipt'];
      beforeEach(() => {
        original = readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId);
        originals = owner.db
          .prepare('SELECT * FROM local_character ORDER BY local_character_id')
          .all();
        receipt = f.decide({ ...f.playerInput, request: prepared.pendingDecisionOrNull! }).current
          .playerDecisionOrNull!.receipt;
      });
      it('admits the whole batch with the prepared mapping and one START identity without changing FINAL sources', () => {
        const bindings = prepared.preparationOrNull!.controllerBindings;
        expect(receipt.copies).toHaveLength(3);
        expect(receipt.copies.every((c) => c.occupiesCampaignPlace)).toBe(true);
        expect(new Set(receipt.copies.map((c) => c.groupIdOrNull)).size).toBe(1);
        const saved = acknowledgeLocalAdmissionDecision(
          owner.db,
          owner.scope,
          f.batch.requestId,
          randomUUID(),
          owner.hostIdentity,
          { kind: 'ACK', receipt },
          f.allow,
        );
        expect(saved.receiptOrNull!.controllerProofOrNull!.controllerBindings).toEqual(bindings);
        expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)).toEqual({
          ...original,
          stateRevision: original!.stateRevision + 1,
          projectionRevision: original!.projectionRevision + 1,
        });
        expect(
          owner.db.prepare('SELECT * FROM local_character ORDER BY local_character_id').all(),
        ).toEqual(originals);
      });
    });
    it('refuses a missing extra tab instead of retaining partial controller authority', () => {
      owner.db.pragma('foreign_keys = OFF');
      owner.db
        .prepare('DELETE FROM local_network_tab WHERE network_scope_id=?')
        .run(prepared.additionalTabs[1]!.networkScopeId);
      expect(() => readLocalAdmission(owner.db, owner.scope, f.batch.requestId)).toThrow();
    });
  });
  describe('NET-007 after GM rejection without a player intent', () => {
    let f: ReturnType<typeof publicationStoreFixture>,
      owner: ReturnType<typeof createAdmissionOwnerFixture>;
    beforeEach(() => {
      f = publicationStoreFixture();
    });
    beforeEach(() => {
      const result = commitAdmissionGmDecision(
        f.db,
        f.scope,
        {
          ...f.input,
          request: {
            ...f.input.request,
            decision: 'REJECT',
            previewChecksumOrNull: null,
            reasonOrNull: 'Отказ при финальном допуске',
          },
        },
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      ).current;
      owner = createAdmissionOwnerFixture(f.src.d.database, f, result.review.request.proof);
      admissionDatabases.push(owner.db);
      const gm = result.gmDecisionOrNull!,
        body = {
          schemaVersion: 1 as const,
          gmDecision: admissionGmDecisionNotice(gm.receipt),
          groupLabels: [],
          proposalOrNull: gm.proposalOrNull,
        };
      receiveLocalAdmissionPublication(
        owner.db,
        owner.scope,
        owner.hostIdentity,
        {
          ...body,
          publicationChecksum: postSaveSha256(canonicalPostSaveJson(body)),
        },
        f.allow,
      );
    });
    it.each(['RESELECT', 'MENU'] as const)(
      'returns with %s without allocating seats or changing original session',
      (mode) => {
        const before = readLocalNetworkApplication(owner.db, owner.scope),
          allocation = vi.fn(randomUUID),
          input = admissionReturnInput(owner, f.batch.requestId, mode),
          result = returnFromLocalAdmission(owner.db, owner.scope, input, allocation, f.allow),
          after = readLocalNetworkApplication(owner.db, owner.scope);
        expect(result.events.map((e) => e.payload.kind)).toEqual(['RETURN']);
        expect(result.preparationOrNull).toBeNull();
        expect(result.returnedOrNull!.additionalClosures).toEqual([]);
        expect(result.record.publication.gmDecision.reasonOrNull).toBe(
          'Отказ при финальном допуске',
        );
        expect(allocation).not.toHaveBeenCalled();
        expect(after.sessionOrNull).toEqual(before.sessionOrNull);
        expect(after.requestOrNull).toBeNull();
        expect(readActiveLocalNetworkTab(owner.db, owner.scope.ownerDeviceId)?.tabId).toBe(
          owner.tabId,
        );
      },
    );
  });
  describe('the closed owner publication', () => {
    let f: ReturnType<typeof playerDecisionFixture>;
    beforeEach(() => {
      f = playerDecisionFixture();
    });
    it('reconstructs the exact stored publication using the production rule composition', () => {
      const { rules } = createCampaignAdmissionRules(baseline, limits.maxWitnessBytes);
      expect(
        readAdmissionDecision(f.db, f.scope, f.input.request.admissionBatchId, f.allow, rules),
      ).toEqual(f.published);
      expect(
        rules.buildProposal(
          f.review,
          f.preview.fullCampaignCopyDiffs.map(() => null),
        ),
      ).toEqual(f.preview);
    });
    it('binds the complete result and excludes private GM authority and working metadata', () => {
      const gm = f.published.gmDecisionOrNull!,
        receipt = { ...gm.receipt, privateWorkingNote: 'private working note' };
      const body = {
        schemaVersion: 1 as const,
        gmDecision: admissionGmDecisionNotice(receipt),
        groupLabels: [],
        proposalOrNull: gm.proposalOrNull,
      };
      const publication = {
        ...body,
        publicationChecksum: postSaveSha256(canonicalPostSaveJson(body)),
      };
      expect(admissionOwnerPublicationValue(publication)).toEqual(publication);
      const encoded = JSON.stringify(publication);
      expect(encoded).not.toContain(gm.receipt.authoritativeGmActorId);
      expect(encoded).not.toMatch(
        /privateWorkingNote|private working note|privateOwner|canonicalWitnessText|reviewStateSha256/u,
      );
      expect(() =>
        admissionOwnerPublicationValue({ ...publication, privateWorkingNote: 'secret' }),
      ).toThrow();
      expect(() =>
        admissionOwnerPublicationValue({
          ...publication,
          gmDecision: {
            ...publication.gmDecision,
            authoritativeGmActorId: gm.receipt.authoritativeGmActorId,
          },
        }),
      ).toThrow();
      const accepted = f.decide().current.playerDecisionOrNull!.receipt;
      expect(admissionPlayerDecisionReceiptValue(accepted, publication)).toEqual(accepted);
      for (const changed of [
        { ...accepted, gmReason: 'invented' },
        { ...accepted, requestOwnerDeviceId: randomUUID() },
        { ...accepted, copies: [] },
        {
          ...accepted,
          copies: accepted.copies.map((copy) => ({ ...copy, lifecycleState: 'ACTIVE' })),
        },
        {
          ...accepted,
          copies: accepted.copies.map((copy) => ({ ...copy, occupiesCampaignPlace: false })),
        },
        {
          ...accepted,
          capacityProofOrNull: { ...accepted.capacityProofOrNull!, occupiedCampaignPlaceCount: 5 },
        },
        {
          ...accepted,
          capacityProofOrNull: {
            ...accepted.capacityProofOrNull!,
            activePlayerCapacity: 6,
            occupiedCampaignPlaceCount: 5,
          },
        },
        {
          ...accepted,
          controllerProofOrNull: { ...accepted.controllerProofOrNull!, controllerBindings: [] },
        },
        {
          ...accepted,
          copies: accepted.copies.map((copy) => ({
            ...copy,
            locationAssignmentOrNull: { location: 'Elsewhere', subLocationOrNull: null },
          })),
        },
      ])
        expect(() => admissionPlayerDecisionReceiptValue(changed, publication)).toThrow();
    });
  });
  describe('a schema10 request with an explicit migrated lane binding', () => {
    let f: ReturnType<typeof playerDecisionFixture>;
    beforeEach(() => {
      f = playerDecisionFixture('ACCEPT', publicationStoreFixture(':memory:', { legacy: true }));
    });
    it('admits the proven legacy lane while preserving the original SUBMIT and BIND receipts', () => {
      expect(f.published.review.request.submittedRequest.batch.schemaVersion).toBeUndefined();
      expect(f.published.review.request.proof.laneProvenance?.kind).toBe('BIND_LANE');
      const oldCommands = f.db
          .prepare('SELECT * FROM hosted_network_command ORDER BY command_id')
          .all(),
        oldBinding = f.db.prepare('SELECT * FROM hosted_device_request_lane_binding').all();
      const accepted = f.decide().current.playerDecisionOrNull!;
      expect(accepted.receipt.controllerProofOrNull?.controllerBindings).toEqual(
        f.playerInput.request.controllerPreparationOrNull!.controllerBindings,
      );
      expect(f.decide().current.playerDecisionOrNull).toEqual(accepted);
      expect(
        f.db.prepare('SELECT * FROM hosted_network_command ORDER BY command_id').all(),
      ).toEqual(oldCommands);
      expect(f.db.prepare('SELECT * FROM hosted_device_request_lane_binding').all()).toEqual(
        oldBinding,
      );
    });
  });
  it('keeps the detached player command when a pre-apply callback changes only the caller command ID', () => {
    const f = playerDecisionFixture(),
      original = structuredClone(f.playerInput.request);
    const result = f.decide(f.playerInput, randomUUID, (current) => {
      if (current.playerDecisionOrNull === null)
        Reflect.set(f.playerInput.request, 'commandId', randomUUID());
    });
    expect(result.current.playerDecisionOrNull!.request).toEqual(original);
    expect(result.current.playerDecisionOrNull!.receipt.commandId).toBe(original.commandId);
    expect(f.playerInput.request.commandId).not.toBe(original.commandId);
  });
  it('rolls back an allocator that redirects the original player command through a caller alias', () => {
    const f = playerDecisionFixture(),
      before = f.db.serialize();
    expect(() =>
      f.decide(f.playerInput, () => {
        Reflect.set(f.playerInput.request, 'commandId', randomUUID());
        return randomUUID();
      }),
    ).toThrow(/SOURCE_CHANGED/u);
    expect(f.db.serialize().equals(before)).toBe(true);
  });
  describe('two proposals competing for one place', () => {
    let first: ReturnType<typeof playerDecisionFixture>,
      second: ReturnType<typeof playerDecisionFixture>;
    beforeEach(() => {
      first = playerDecisionFixture('ACCEPT', publicationStoreFixture(':memory:', { capacity: 1 }));
    });
    beforeEach(() => {
      second = playerDecisionFixture(
        'ACCEPT',
        publicationStoreFixture(':memory:', {
          context: first.context,
          source: fixtures.get('PURE/AUTO')!,
        }),
      );
    });
    it('serializes two decisions for the last place and counts the accepted blocked copy', () => {
      const firstInput = {
        ...first.playerInput,
        request: { ...first.playerInput.request, expectedCampaignRevision: 2 },
      };
      first.decide(firstInput);
      const before = first.db.serialize(),
        allocate = vi.fn(() => {
          throw new Error('losing allocation');
        });
      expect(() => second.decide(second.playerInput, allocate)).toThrow(/STALE_REVISION/u);
      expect(() =>
        second.decide(
          {
            ...second.playerInput,
            request: { ...second.playerInput.request, expectedCampaignRevision: 3 },
          },
          allocate,
        ),
      ).toThrow(/CAPACITY_EXCEEDED/u);
      expect(allocate).not.toHaveBeenCalled();
      expect(first.db.serialize().equals(before)).toBe(true);
      expect(
        first.db.prepare('SELECT count(*) AS n FROM campaign_admission_controller').get(),
      ).toEqual({ n: 1 });
      expect(
        first.db
          .prepare(
            "SELECT count(*) AS n FROM campaign_character_copy WHERE lifecycle_state='ACTIVE'",
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(
        readAdmissionDecision(
          second.db,
          second.scope,
          second.review.current.admissionBatchId,
          second.allow,
          second.rules,
        ).playerDecisionOrNull,
      ).toBeNull();
    });
  });
  describe.each(['START', 'EXISTING'] as const)(
    'a campaign with an admitted owner (%s assignment)',
    (assignment) => {
      let first: ReturnType<typeof playerDecisionFixture>,
        second: ReturnType<typeof playerDecisionFixture>;
      let accepted: NonNullable<
        ReturnType<typeof commitAdmissionPlayerDecision>['current']['playerDecisionOrNull']
      >;
      beforeEach(() => {
        first = playerDecisionFixture(
          'ACCEPT',
          publicationStoreFixture(':memory:', { approve: true }),
        );
      });
      beforeEach(() => {
        accepted = first.decide().current.playerDecisionOrNull!;
      });
      beforeEach(() => {
        second = playerDecisionFixture(
          'ACCEPT',
          publicationStoreFixture(':memory:', {
            context: first.context,
            source: fixtures.get('PURE/AUTO')!,
            ...(assignment === 'EXISTING'
              ? { existingGroupId: accepted.receipt.copies[0]!.groupIdOrNull! }
              : {}),
          }),
        );
      });
      it('activates a fully approved copy and reuses the same campaign START group for a later owner', () => {
        expect(accepted.receipt.copies[0]!.lifecycleState).toBe('ACTIVE');
        const later = second.decide().current.playerDecisionOrNull!;
        expect(later.receipt.capacityProofOrNull).toMatchObject({
          occupiedCampaignPlaceCount: 1,
          activePcCount: 1,
          candidateCount: 1,
        });
        expect(later.createdGroups).toEqual([]);
        expect(later.receipt.copies[0]!.groupIdOrNull).toBe(
          accepted.receipt.copies[0]!.groupIdOrNull,
        );
        expect(
          first.db.prepare('SELECT count(*) AS n FROM campaign_admission_group').get(),
        ).toEqual({
          n: 1,
        });
        const delivery = readAdmissionDecisionDeliveryByRequest(
          second.db,
          second.scope,
          second.batch.requestId,
          second.allow,
          second.rules,
        )!;
        expect(delivery.current.playerDecisionOrNull).toEqual(later);
        const gm = delivery.current.gmDecisionOrNull!;
        const groupLabels = admissionSelectedGroupLabels(
          gm.proposalOrNull!.fullCampaignCopyDiffs,
          delivery.groups,
        );
        expect(groupLabels).toEqual(
          assignment === 'EXISTING'
            ? [{ groupId: accepted.receipt.copies[0]!.groupIdOrNull, name: 'Стартовая группа' }]
            : [],
        );
        const body = {
          schemaVersion: 1 as const,
          gmDecision: admissionGmDecisionNotice(gm.receipt),
          proposalOrNull: gm.proposalOrNull,
          groupLabels,
        };
        expect(
          admissionOwnerPublicationValue({
            ...body,
            publicationChecksum: postSaveSha256(canonicalPostSaveJson(body)),
          }).groupLabels,
        ).toEqual(groupLabels);
        if (assignment === 'EXISTING') {
          enterPublishedAdmissionView(
            second.db,
            second.scope,
            {
              messageType: 'navigation.form-action',
              protocolVersion: 2,
              navigationRequestId: randomUUID(),
              sourceFormId: 'NET-017',
              actionKey: 'NET-017::CTA::004',
              expectedProjectionRevision: readGmRequestReviewView(
                second.db,
                second.scope,
                second.allow,
              )!.projectionRevision,
            },
            second.allow,
            second.rules,
            second.allow,
          );
          const projected = second.db
            .transaction(() => {
              const view = readGmAdmissionViewStateInTransaction(
                second.db,
                second.scope,
              ).viewOrNull!;
              const header = readHostedCurrentPausedCampaign(
                second.db,
                second.scope.campaignId,
                second.allow,
              );
              return projectGmAdmission({
                view,
                current: readAdmissionDecision(
                  second.db,
                  second.scope,
                  view.admissionBatchId,
                  second.allow,
                  second.rules,
                ),
                history: admissionDecisionStorage.readHistory(
                  second.db,
                  second.scope,
                  second.allow,
                  second.rules,
                ),
                service: createCampaignAdmissionRules(baseline, limits.maxWitnessBytes),
                campaign: {
                  ...header,
                  activePlayerCapacity: header.activePlayerCapacity as 1 | 2 | 3 | 4 | 5,
                  revisions: {
                    stateRevision: header.stateRevision,
                    projectionRevision: header.projectionRevision,
                    actorVisibilityRevision: header.actorVisibilityRevision,
                  },
                },
                supported: [],
              });
            })
            .deferred();
          const payload = projected.layers[0]!.roleFilteredPayload;
          expect(admissionGmProjectionValue('NET-021', payload)['groupLabels']).toEqual(
            groupLabels,
          );
          expect(() =>
            admissionGmProjectionValue('NET-021', { ...payload, groupLabels: [] }),
          ).toThrow();
          expect(() =>
            admissionGmProjectionValue('NET-021', {
              ...payload,
              groupLabels: [...groupLabels, { groupId: randomUUID(), name: 'Чужая группа' }],
            }),
          ).toThrow();
          expect(() =>
            admissionSelectedGroupLabels(gm.proposalOrNull!.fullCampaignCopyDiffs, []),
          ).toThrow('group is missing');
          expect(() =>
            admissionOwnerPublicationValue({
              ...body,
              groupLabels: [],
              publicationChecksum: '0'.repeat(64),
            }),
          ).toThrow();
        }
      });
    },
  );
  it('occupies a place for a blocked lobby copy and recovers the same group, controller and receipts', () => {
    const f = playerDecisionFixture(),
      sourceBefore = f.src.d.database.serialize(),
      accepted = f.decide();
    const receipt = accepted.current.playerDecisionOrNull!.receipt;
    expect(receipt.decision).toBe('ACCEPT');
    expect(receipt.capacityProofOrNull).toMatchObject({
      occupiedCampaignPlaceCount: 0,
      candidateCount: 1,
      evaluatedCampaignRevision: 1,
      fitsCurrentCapacity: true,
    });
    expect(receipt.copies).toEqual([
      expect.objectContaining({
        lifecycleState: 'PROPOSED',
        occupiesCampaignPlace: true,
      }),
    ]);
    expect(receipt.copies[0]!.groupIdOrNull).toEqual(expect.any(String));
    expect(receipt.controllerProofOrNull?.controllerBindings).toEqual(
      f.playerInput.request.controllerPreparationOrNull!.controllerBindings,
    );
    expect(f.db.prepare('SELECT count(*) AS n FROM campaign_admission_group').get()).toEqual({
      n: 1,
    });
    expect(f.db.prepare('SELECT count(*) AS n FROM campaign_admission_controller').get()).toEqual({
      n: 1,
    });
    expect(loadCampaignCheckpoint(f.db, f.scope.campaignId).stateRevision).toBe(2);
    const before = f.db.serialize(),
      allocate = vi.fn(() => {
        throw new Error('must not allocate again');
      });
    expect(f.decide(f.playerInput, allocate)).toEqual({ ...accepted, replayed: true });
    expect(
      readAdmissionDecision(f.db, f.scope, f.review.current.admissionBatchId, f.allow, f.rules)
        .playerDecisionOrNull?.receipt,
    ).toEqual(receipt);
    expect(allocate).not.toHaveBeenCalled();
    expect(f.db.serialize().equals(before)).toBe(true);
    expect(f.src.d.database.serialize().equals(sourceBefore)).toBe(true);
  });
  it('declines without a place, group or controller and rejects a new or opposite answer', () => {
    const f = playerDecisionFixture('DECLINE'),
      allocate = vi.fn(() => {
        throw new Error('decline allocation');
      });
    const declined = f.decide(f.playerInput, allocate);
    expect(declined.current.playerDecisionOrNull!.receipt.copies).toEqual([
      expect.objectContaining({
        lifecycleState: 'DECLINED',
        occupiesCampaignPlace: false,
        groupIdOrNull: null,
        controllerBindingOrNull: null,
      }),
    ]);
    expect(f.db.prepare('SELECT count(*) AS n FROM campaign_admission_group').get()).toEqual({
      n: 0,
    });
    expect(f.db.prepare('SELECT count(*) AS n FROM campaign_admission_controller').get()).toEqual({
      n: 0,
    });
    const before = f.db.serialize();
    expect(f.decide(f.playerInput, allocate).current.playerDecisionOrNull).toEqual(
      declined.current.playerDecisionOrNull,
    );
    expect(() =>
      f.decide({
        ...f.playerInput,
        request: { ...f.playerInput.request, commandId: randomUUID() },
      }),
    ).toThrow(/IDEMPOTENCY_CONFLICT/u);
    expect(f.db.serialize().equals(before)).toBe(true);
    expect(allocate).not.toHaveBeenCalled();
  });
  it('rolls back all groups, controllers and copies if final encoding fails', () => {
    const f = playerDecisionFixture(),
      before = f.db.serialize();
    expect(() =>
      f.decide(f.playerInput, randomUUID, (current) => {
        if (current.playerDecisionOrNull !== null) throw new Error('final encoding');
      }),
    ).toThrow();
    expect(f.db.serialize().equals(before)).toBe(true);
  });
  it('refuses stale, foreign and partial controller preparations without writes', () => {
    const f = playerDecisionFixture(),
      before = f.db.serialize(),
      preparation = f.playerInput.request.controllerPreparationOrNull!;
    for (const request of [
      { ...f.playerInput.request, expectedCampaignRevision: 0 },
      {
        ...f.playerInput.request,
        proposalChecksum: 'f'.repeat(64),
        controllerPreparationOrNull: { ...preparation, proposalChecksum: 'f'.repeat(64) },
      },
      {
        ...f.playerInput.request,
        controllerPreparationOrNull: { ...preparation, controllerBindings: [] },
      },
      {
        ...f.playerInput.request,
        controllerPreparationOrNull: {
          ...preparation,
          controllerBindings: preparation.controllerBindings.map((b) => ({
            ...b,
            localControllerSeatId: randomUUID(),
            inputLaneId: randomUUID(),
          })),
        },
      },
    ])
      expect(() => f.decide({ ...f.playerInput, request })).toThrow();
    expect(() =>
      commitAdmissionPlayerDecision(
        f.db,
        f.scope,
        randomUUID(),
        f.playerInput,
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      ),
    ).toThrow(/FOREIGN_OWNER/u);
    expect(f.db.serialize().equals(before)).toBe(true);
  });
  it.each(['group', 'controller', 'checkpoint', 'receipt'] as const)(
    'refuses a missing %s after acceptance instead of reconstructing authority',
    (kind) => {
      const f = playerDecisionFixture();
      f.decide();
      if (kind === 'receipt') f.db.pragma('foreign_keys = OFF');
      const table = {
        group: 'campaign_admission_group',
        controller: 'campaign_admission_controller',
        checkpoint: 'campaign_admission_checkpoint_event',
        receipt: 'campaign_admission_player_decision',
      }[kind];
      f.db.prepare(`DELETE FROM ${table}`).run();
      const before = f.db.serialize();
      expect(() =>
        readAdmissionDecision(f.db, f.scope, f.review.current.admissionBatchId, f.allow, f.rules),
      ).toThrow();
      expect(() => f.decide()).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
    },
  );
});

describe('NET-021 complete publication from a real immutable FINAL', () => {
  it('shows the immutable source and recalculated core before group or location is supplied', () => {
    const input = publicationFixture(),
      before = canonicalPostSaveJson(input.source),
      { groupAssignment: _group, locationAssignment: _location, ...fields } = input.draft,
      draft = {
        ...fields,
        groupAssignmentOrNull: null,
        locationAssignmentOrNull: null,
        statAdjustments: { ...fields.statAdjustments, S: fields.statAdjustments.S + 1 },
      };
    const sheets = deriveAdmissionReviewMechanicalSheets(
        input.source,
        baseline,
        draft,
        input.identities,
      ),
      complete = deriveAdmissionFullCopyDiff(
        { ...input, draft: { ...input.draft, statAdjustments: draft.statAdjustments } },
        baseline,
        canonicalFiveStartingPositionsCatalog(),
      );
    expect(sheets.beforeSheet).toEqual(complete.beforeSheet);
    expect(sheets.afterCore.stats).toEqual(complete.afterSheet.stats);
    expect(sheets.beforeSheet.groupAssignmentOrNull).toBeNull();
    expect(sheets.beforeSheet.locationAssignmentOrNull).toBeNull();
    expect(draft.groupAssignmentOrNull).toBeNull();
    expect(draft.locationAssignmentOrNull).toBeNull();
    expect(canonicalPostSaveJson(input.source)).toBe(before);
  });
  describe('from a prepared real review', () => {
    let preparedReview: ReturnType<typeof publicationStoreFixture>;
    beforeEach(() => {
      preparedReview = publicationStoreFixture();
    });
    it('rejects a proposal callback result accessor before it can hide a SQLite mutation', () => {
      const f = preparedReview,
        getter = vi.fn(),
        before = f.db.serialize();
      const rules: AdmissionPublicationRules = {
        ...f.rules,
        buildProposal: (...args) => {
          const result = f.rules.buildProposal(...args),
            checksum = result.proposalChecksum;
          Object.defineProperty(result, 'proposalChecksum', {
            enumerable: true,
            configurable: true,
            get: () => {
              getter();
              Object.defineProperty(result, 'proposalChecksum', {
                value: checksum,
                enumerable: true,
              });
              f.db.pragma('user_version = 19');
              return checksum;
            },
          });
          return result;
        },
      };
      expect(() =>
        commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, rules, randomUUID, f.allow),
      ).toThrow();
      expect(getter).not.toHaveBeenCalled();
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('keeps the detached GM command when a pre-apply callback changes only the caller command ID', () => {
      const f = preparedReview,
        original = structuredClone(f.input.request);
      const result = commitAdmissionGmDecision(
        f.db,
        f.scope,
        f.input,
        f.allow,
        f.rules,
        randomUUID,
        (current) => {
          if (current.gmDecisionOrNull === null) f.input.request.commandId = randomUUID();
        },
      );
      expect(result.current.gmDecisionOrNull!.request).toEqual(original);
      expect(result.current.gmDecisionOrNull!.receipt.commandId).toBe(original.commandId);
      expect(f.input.request.commandId).not.toBe(original.commandId);
    });
    it('rolls back an allocator that redirects the original GM command through the public input', () => {
      const f = preparedReview,
        before = f.db.serialize(),
        original = f.input.request;
      expect(() =>
        commitAdmissionGmDecision(
          f.db,
          f.scope,
          f.input,
          f.allow,
          f.rules,
          () => {
            original.commandId = randomUUID();
            return randomUUID();
          },
          f.allow,
        ),
      ).toThrow(/SOURCE_CHANGED/u);
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('binds a rejection to its original campaign revision without changing the campaign', () => {
      const f = preparedReview;
      commitAdmissionGmDecision(
        f.db,
        f.scope,
        {
          ...f.input,
          request: {
            ...f.input.request,
            decision: 'REJECT',
            previewChecksumOrNull: null,
            reasonOrNull: 'Причина',
          },
        },
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      );
      const stored = f.db
        .prepare('SELECT record_json FROM campaign_admission_gm_decision')
        .get() as {
        record_json: string;
      };
      const record = JSON.parse(stored.record_json) as {
        request: { expectedCampaignRevision: number };
      };
      record.request.expectedCampaignRevision = 7;
      const json = canonicalPostSaveJson(record);
      f.db
        .prepare('UPDATE campaign_admission_gm_decision SET record_json=?,record_sha256=?')
        .run(json, postSaveSha256(json));
      const before = f.db.serialize();
      expect(() =>
        readAdmissionDecision(f.db, f.scope, f.input.request.admissionBatchId, f.allow, f.rules),
      ).toThrow(/CORRUPT_STORAGE/);
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('rejects the entire working batch with its immutable reason and no campaign mutation', () => {
      const f = preparedReview,
        checkpoint = loadCampaignCheckpoint(f.db, f.scope.campaignId);
      const input = {
        ...f.input,
        request: {
          ...f.input.request,
          decision: 'REJECT' as const,
          previewChecksumOrNull: null,
          reasonOrNull: 'Не подходит для кампании',
        },
      };
      const result = commitAdmissionGmDecision(
        f.db,
        f.scope,
        input,
        f.allow,
        f.rules,
        () => {
          throw new Error('reject allocation');
        },
        f.allow,
      );
      expect(result.current.gmDecisionOrNull!.receipt.reasonOrNull).toBe(
        input.request.reasonOrNull,
      );
      expect(result.current.gmDecisionOrNull!.copies).toEqual([]);
      expect(loadCampaignCheckpoint(f.db, f.scope.campaignId)).toEqual(checkpoint);
      const frozen = f.db.serialize();
      expect(
        commitAdmissionGmDecision(f.db, f.scope, input, f.allow, f.rules, randomUUID, f.allow)
          .replayed,
      ).toBe(true);
      expect(() =>
        commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, f.allow),
      ).toThrow(/IDEMPOTENCY_CONFLICT/);
      expect(f.db.serialize().equals(frozen)).toBe(true);
    });
    it('rolls back every copy/profile/checkpoint when the final encoding guard fails', () => {
      const f = preparedReview,
        before = f.db.serialize();
      expect(() =>
        commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, (view) => {
          if (view.gmDecisionOrNull !== null) throw new Error('cannot serialize publication');
        }),
      ).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('keeps the whole identity allocation batch read-only and rolls back allocator writes', () => {
      const f = preparedReview,
        before = f.db.serialize(),
        version = f.db.pragma('user_version', { simple: true });
      let calls = 0;
      expect(() =>
        commitAdmissionGmDecision(
          f.db,
          f.scope,
          f.input,
          f.allow,
          f.rules,
          () => {
            calls += 1;
            if (calls === 2) f.db.pragma('user_version = 31');
            return randomUUID();
          },
          f.allow,
        ),
      ).toThrow(/SOURCE_CHANGED/);
      expect(calls).toBeGreaterThan(1);
      expect(f.db.pragma('user_version', { simple: true })).toBe(version);
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('refuses changed preview, stale revision, identity collision and old preliminary reject with zero writes', () => {
      const f = preparedReview,
        before = f.db.serialize();
      for (const patch of [
        { previewChecksumOrNull: '0'.repeat(64) },
        { reviewRevision: f.input.request.reviewRevision + 1 },
        { expectedCampaignRevision: 1 },
      ]) {
        expect(() =>
          commitAdmissionGmDecision(
            f.db,
            f.scope,
            { ...f.input, request: { ...f.input.request, ...patch } },
            f.allow,
            f.rules,
            randomUUID,
            f.allow,
          ),
        ).toThrow(/STALE_REVISION/);
        expect(f.db.serialize().equals(before)).toBe(true);
      }
      expect(() =>
        commitAdmissionGmDecision(
          f.db,
          f.scope,
          f.input,
          f.allow,
          f.rules,
          () => f.input.receiptId,
          f.allow,
        ),
      ).toThrow(/IDEMPOTENCY_CONFLICT/);
      expect(f.db.serialize().equals(before)).toBe(true);
      commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, f.allow);
      const view = readGmRequestReviewView(f.db, f.scope, f.allow)!,
        published = f.db.serialize();
      expect(() =>
        commitGmDeviceRequestDecision(
          f.db,
          f.scope,
          {
            request: {
              ...f.preliminary.command.request,
              commandId: randomUUID(),
              workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
              expectedRevisions: {
                stateRevision: view.stateRevision,
                projectionRevision: view.projectionRevision,
                actorVisibilityRevision: view.actorVisibilityRevision,
              },
              payload: {
                campaignId: f.scope.campaignId,
                requestId: f.openRequest.payload.requestId,
                requestRevision: 1,
                reason: 'late rejection',
              },
            },
            receiptId: randomUUID(),
            timestamp: f.input.timestamp,
          },
          f.allow,
          f.allow,
        ),
      ).toThrow(/STALE_REVISION/);
      expect(f.db.serialize().equals(published)).toBe(true);
      expect(
        readRevisions(f.db, { entity: 'campaign', entityId: f.scope.campaignId }).stateRevision,
      ).toBe(1);
    });
    it('rebuilds the full sheet and receipt instead of trusting rehashed stored JSON', () => {
      const f = preparedReview;
      commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, f.allow);
      const stored = f.db
        .prepare('SELECT record_json FROM campaign_admission_gm_decision')
        .get() as {
        record_json: string;
      };
      const wrong = JSON.parse(stored.record_json) as { receipt: { reasonOrNull: string | null } };
      wrong.receipt.reasonOrNull = 'forged';
      const json = canonicalPostSaveJson(wrong);
      f.db
        .prepare('UPDATE campaign_admission_gm_decision SET record_json=?,record_sha256=?')
        .run(json, postSaveSha256(json));
      const before = f.db.serialize();
      expect(() =>
        readAdmissionDecision(f.db, f.scope, f.input.request.admissionBatchId, f.allow, f.rules),
      ).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('refuses mechanically different final output even when its own complete checksum is valid', () => {
      const f = preparedReview,
        before = f.db.serialize();
      const rules: AdmissionPublicationRules = {
        ...f.rules,
        buildProposal: (review, ids) => {
          const normal = f.rules.buildProposal(review, ids);
          if (ids.every((id) => id === null)) return normal;
          const fullCampaignCopyDiffs = normal.fullCampaignCopyDiffs.map((diff) => {
            const afterSheet = {
              ...diff.afterSheet,
              locationAssignmentOrNull: { location: 'Другой город', subLocationOrNull: null },
            };
            return {
              ...diff,
              afterSheet,
              changes: admissionMechanicalChanges(diff.beforeSheet, afterSheet),
            };
          });
          const { proposalChecksum: _checksum, ...body } = normal;
          return sealAdmissionProposal({ ...body, fullCampaignCopyDiffs });
        },
      };
      expect(() =>
        commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, rules, randomUUID, f.allow),
      ).toThrow(/SOURCE_CHANGED/);
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it('keeps a rejected review terminal when its decision row is lost', () => {
      const f = preparedReview;
      commitAdmissionGmDecision(
        f.db,
        f.scope,
        {
          ...f.input,
          request: {
            ...f.input.request,
            decision: 'REJECT',
            previewChecksumOrNull: null,
            reasonOrNull: 'Причина',
          },
        },
        f.allow,
        f.rules,
        randomUUID,
        f.allow,
      );
      expect(() => f.db.exec('DELETE FROM campaign_admission_gm_decision')).toThrow(/FOREIGN KEY/);
      // Simulate damaged storage, not a supported deletion path.
      f.db.pragma('foreign_keys = OFF');
      f.db.exec('DELETE FROM campaign_admission_gm_decision');
      f.db.pragma('foreign_keys = ON');
      const before = f.db.serialize();
      expect(() =>
        readAdmissionDecision(f.db, f.scope, f.input.request.admissionBatchId, f.allow, f.rules),
      ).toThrow(/CORRUPT_STORAGE/);
      expect(() =>
        readAdmissionReview(f.db, f.scope, f.input.request.admissionBatchId, f.allow, f.rules),
      ).toThrow(/CORRUPT_STORAGE/);
      expect(() =>
        commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, f.allow),
      ).toThrow(/CORRUPT_STORAGE/);
      expect(f.db.serialize().equals(before)).toBe(true);
    });
    it.each(['missing checkpoint event', 'changed checkpoint link', 'changed historical revision'])(
      'rejects %s even when independent record hashes are recomputed',
      (damage) => {
        const f = preparedReview;
        commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, f.allow);
        if (damage === 'missing checkpoint event')
          f.db.exec('DELETE FROM campaign_admission_checkpoint_event');
        else {
          const table =
            damage === 'changed checkpoint link'
              ? 'campaign_admission_checkpoint_event'
              : 'campaign_admission_gm_decision';
          const stored = f.db.prepare(`SELECT record_json FROM ${table}`).get() as {
            record_json: string;
          };
          const value = JSON.parse(stored.record_json) as Record<string, unknown>;
          if (damage === 'changed checkpoint link')
            value['beforeCheckpointSha256'] = 'f'.repeat(64);
          else (value['request'] as Record<string, unknown>)['expectedCampaignRevision'] = 7;
          const json = canonicalPostSaveJson(value);
          f.db
            .prepare(`UPDATE ${table} SET record_json=?,record_sha256=?`)
            .run(json, postSaveSha256(json));
        }
        const before = f.db.serialize();
        expect(() =>
          readAdmissionDecision(f.db, f.scope, f.input.request.admissionBatchId, f.allow, f.rules),
        ).toThrow(/CORRUPT_STORAGE/);
        expect(() =>
          commitAdmissionGmDecision(f.db, f.scope, f.input, f.allow, f.rules, randomUUID, f.allow),
        ).toThrow(/CORRUPT_STORAGE/);
        expect(f.db.serialize().equals(before)).toBe(true);
      },
    );
  });
  it('commits stable copy/profile IDs, freezes review, and replays without allocations or writes across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'admission-publish-'));
    directories.push(dir);
    const filename = join(dir, 'campaign.sqlite'),
      f = publicationStoreFixture(filename),
      sourceBytes = f.src.d.database.serialize();
    const before = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    const published = commitAdmissionGmDecision(
      f.db,
      f.scope,
      f.input,
      f.allow,
      f.rules,
      randomUUID,
      f.allow,
    );
    const record = published.current.gmDecisionOrNull!;
    expect(published.replayed).toBe(false);
    expect(record.proposalOrNull!.fullCampaignCopyDiffs[0]!.campaignCharacterIdOrNull).toBe(
      record.copies[0]!.campaignCharacterId,
    );
    expect(record.copies[0]!.inventoryInstances.length).toBeGreaterThan(0);
    expect(record.copies[0]!.inventoryInstances.some((i) => i.weaponProfileOrNull !== null)).toBe(
      true,
    );
    expect(record.proposalOrNull!.blockers.length).toBeGreaterThan(0);
    const after = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    expect(after.stateRevision).toBe(before.stateRevision + 1);
    expect(f.db.prepare('SELECT lifecycle_state FROM campaign_character_copy').all()).toEqual([
      { lifecycle_state: 'PROPOSED' },
    ]);
    for (const table of ['campaign_admission_group', 'campaign_admission_controller'])
      expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(
      readAdmissionReview(f.db, f.scope, f.input.request.admissionBatchId, f.allow, f.rules)
        .editable,
    ).toBe(false);
    const frozen = f.db.serialize(),
      forbidden = () => {
        throw new Error('replay allocated an identity');
      };
    expect(
      commitAdmissionGmDecision(
        f.db,
        f.scope,
        { ...f.input, receiptId: 'ignored-on-replay' },
        f.allow,
        f.rules,
        forbidden,
        f.allow,
      ),
    ).toEqual({ ...published, replayed: true });
    expect(f.db.serialize().equals(frozen)).toBe(true);
    f.db.close();
    const reopened = openPersistenceDatabase(filename);
    admissionDatabases.push(reopened);
    expect(
      readAdmissionDecision(reopened, f.scope, f.input.request.admissionBatchId, f.allow, f.rules),
    ).toEqual(published.current);
    const currentCopy = f.review.current.copies[0]!;
    const unchanged = reopened.serialize();
    expect(() =>
      commitAdmissionReviewEdit(
        reopened,
        f.scope,
        {
          request: {
            commandId: randomUUID(),
            admissionBatchId: f.input.request.admissionBatchId,
            expectedReviewRevision: f.review.current.reviewRevision,
            intent: {
              kind: 'EDIT',
              reviewCopyId: currentCopy.reviewCopyId,
              inputs: currentCopy.inputs,
            },
          },
          receiptId: randomUUID(),
          timestamp: f.input.timestamp,
        },
        f.allow,
        f.rules,
        forbidden,
        f.allow,
      ),
    ).toThrow(/STALE_REVISION/);
    expect(reopened.serialize().equals(unchanged)).toBe(true);
    expect(f.src.d.database.serialize().equals(sourceBytes)).toBe(true);
  });
});

describe('private FINAL admission candidate evidence', () => {
  it.each(['FREE/AUTO', 'FREE/MANUAL', 'PURE/AUTO', 'PURE/MANUAL', 'UNITED/AUTO', 'UNITED/MANUAL'])(
    'NET-018/019 replays %s incomplete review, staged decisions and removed grants without touching FINAL',
    (key) => {
      const s = fixtures.get(key)!,
        source = publicationFixture(s).source,
        sources = [source],
        catalogs = {
          baseline,
          items: canonicalFiveStartingPositionsCatalog(),
          weapons: canonicalWeaponProfileCatalog(),
        },
        before = s.d.database.serialize();
      let idCounter = 10000;
      const initial = createAdmissionReviewState(sources, admissionId(9999), () =>
        admissionId(idCounter++),
      );
      const initialBytes = canonicalPostSaveJson(initial);
      verifyInitialAdmissionReviewState(initial, sources);
      const copyId = initial.copies[0]!.reviewCopyId;
      expect(initial.copies[0]!.inputs.groupAssignmentOrNull).toBeNull();
      expect(initial.copies[0]!.inputs.locationAssignmentOrNull).toBeNull();
      expect(() => admissionReviewPublicationInputs(initial, sources, null)).toThrow();
      expect(() =>
        verifyInitialAdmissionReviewState({ ...initial, reviewRevision: 1 }, sources),
      ).toThrow();
      let state = initial;
      const history: { mutation: AdmissionReviewMutation; receiptId: string }[] = [];
      const apply = (mutation: AdmissionReviewMutation) => {
        const receiptId = admissionId(idCounter++);
        state = applyAdmissionReviewMutation(state, sources, mutation, receiptId, catalogs);
        history.push({ mutation, receiptId });
      };
      for (const property of deriveAdmissionSourceProperties(source)) {
        if (property.weaponRequestOrNull === null) continue;
        const mutation: AdmissionReviewMutation = {
          kind: 'WEAPON',
          reviewCopyId: copyId,
          input: {
            weaponReviewInput: { kind: 'VALIDATED_REQUEST', ...property.weaponRequestOrNull },
            decision: 'APPROVE',
            overrideProfileOrNull: null,
            reasonOrNull: null,
          },
        };
        apply(mutation);
        expect(() =>
          applyAdmissionReviewMutation(state, sources, mutation, admissionId(90000), catalogs),
        ).toThrow(/terminal staged/);
      }
      const itemId = admissionId(idCounter++),
        groupId = admissionId(idCounter++);
      apply({ kind: 'ALLOCATE_ITEM', reviewCopyId: copyId, reviewItemId: itemId });
      apply({ kind: 'ALLOCATE_GROUP', groupDraftId: groupId });
      const template = catalogs.weapons.entries.find((entry) => entry.profileKind === 'FIXED')!;
      const currentInputs = state.copies[0]!.inputs;
      apply({
        kind: 'EDIT',
        reviewCopyId: copyId,
        inputs: {
          ...currentInputs,
          groupAssignmentOrNull: { kind: 'NEW', groupDraftId: groupId, name: 'Группа' },
          locationAssignmentOrNull: { location: 'Город', subLocationOrNull: null },
          inventoryReview: {
            ...currentInputs.inventoryReview,
            entries: [
              ...currentInputs.inventoryReview.entries,
              {
                reviewItemId: itemId,
                sourceEntryIdOrNull: null,
                item: { kind: 'CATALOG', itemTypeId: template.weaponTypeId },
                quantity: 1,
                qualityLabel: currentInputs.inventoryReview.entries[0]!.qualityLabel,
                weaponDecisionReceiptIdOrNull: null,
              },
            ],
          },
        },
      });
      apply({
        kind: 'WEAPON',
        reviewCopyId: copyId,
        input: {
          weaponReviewInput: {
            kind: 'ADMISSION_GRANT',
            reviewItemId: itemId,
            weaponTypeId: template.weaponTypeId,
            profileSource: {
              kind: 'CATALOG_TEMPLATE',
              templateId: admissionWeaponTemplateId(template),
            },
            reason: 'Согласованная замена',
          },
          decision: 'MASTER_OVERRIDE',
          overrideProfileOrNull: null,
          reasonOrNull: null,
        },
      });
      const removed = {
        ...state.copies[0]!.inputs,
        inventoryReview: { status: 'FINAL' as const, entries: [], unresolvedSourceEntryIds: [] },
        massReview: { ...state.copies[0]!.inputs.massReview, decision: 'APPROVED' as const },
        moneyReview: { status: 'FINAL' as const, amountOrNull: 0 },
      };
      apply({ kind: 'EDIT', reviewCopyId: copyId, inputs: removed });
      const proposalInputs = admissionReviewPublicationInputs(state, sources, [admissionId(80000)]);
      const proposal = sealAdmissionProposal(proposalBody(proposalInputs));
      expect(proposal.blockers).toEqual([]);
      expect(proposal.fullCampaignCopyDiffs[0]!.afterSheet.inventoryReview.entries).toEqual([]);
      expect(state.copies[0]!.weaponDecisions.at(-1)!.input.weaponReviewInput.kind).toBe(
        'ADMISSION_GRANT',
      );
      expect(() =>
        applyAdmissionReviewMutation(
          state,
          sources,
          { kind: 'EDIT', reviewCopyId: copyId, inputs: { ...removed, weaponDecisionRefs: [] } },
          admissionId(90000),
          catalogs,
        ),
      ).toThrow(/read-only/);
      const replayed = history.reduce(
        (current, event) =>
          applyAdmissionReviewMutation(current, sources, event.mutation, event.receiptId, catalogs),
        initial,
      );
      expect(replayed).toEqual(state);
      expect(state.reviewRevision).toBe(history.length);
      expect(canonicalPostSaveJson(initial)).toBe(initialBytes);
      expect(s.d.database.serialize().equals(before)).toBe(true);
    },
  );

  it.each(['FREE/AUTO', 'FREE/MANUAL', 'PURE/AUTO', 'PURE/MANUAL', 'UNITED/AUTO', 'UNITED/MANUAL'])(
    'NET-021/027 seals complete %s sheets with explicit lobby blockers and unchanged source',
    (key) => {
      const s = fixtures.get(key)!,
        input = publicationFixture(s),
        beforeBytes = s.d.database.serialize(),
        beforeInput = canonicalPostSaveJson(input),
        proposal = sealAdmissionProposal(proposalBody([input]));
      const diff = proposal.fullCampaignCopyDiffs[0]!;
      expect(diff.changes.map((change) => change.section)).toEqual(
        expect.arrayContaining(['GROUP_LOCATION']),
      );
      expect(
        diff.changes.every((change) =>
          ['STATS', 'SKILLS', 'MASS', 'INVENTORY', 'MONEY', 'GROUP_LOCATION'].includes(
            change.section,
          ),
        ),
      ).toBe(true);
      expect(diff.beforeSheet.stats).toEqual(diff.afterSheet.stats);
      expect(diff.beforeSheet.runtime).toEqual(diff.afterSheet.runtime);
      expect(diff.beforeSheet.skills).toEqual(diff.afterSheet.skills);
      expect(diff.blockers).toContainEqual({
        kind: 'MASS_PENDING',
        reviewCopyIdOrNull: input.reviewCopyId,
        campaignCharacterIdOrNull: input.campaignCharacterIdOrNull,
        sourceEntryIdOrNull: null,
        message: 'Масса персонажа не согласована.',
      });
      expect(
        diff.blockers
          .filter((b) => b.sourceEntryIdOrNull !== null)
          .map((b) => b.sourceEntryIdOrNull),
      ).toEqual(input.draft.inventoryReview.unresolvedSourceEntryIds);
      expect(decodeAdmissionProposal(JSON.stringify(proposal))).toEqual({
        ok: true,
        value: proposal,
      });
      expect(validateAdmissionProposal(proposal)).toEqual(proposal);
      verifyAdmissionProposalSources(
        proposal,
        [input],
        baseline,
        canonicalFiveStartingPositionsCatalog(),
      );
      expect(canonicalPostSaveJson(input)).toBe(beforeInput);
      expect(s.d.database.serialize().equals(beforeBytes)).toBe(true);
      expect(JSON.stringify(proposal)).not.toMatch(
        /CORE-\d|SYM-\d|privateReplayWitness|snapshotJson|correctionHeadHash|CVD-WPN-|RG-WPN-/,
      );
      const changedChecksum = { ...proposal, reviewRevision: proposal.reviewRevision + 1 };
      expect(() => validateAdmissionProposal(changedChecksum)).toThrow(/checksum/);
      const wrongSource = sealAdmissionProposal({
        ...proposalBody([input]),
        fullCampaignCopyDiffs: [{ ...diff, sourceSnapshotChecksum: 'f'.repeat(64) }],
      });
      expect(() =>
        verifyAdmissionProposalSources(
          wrongSource,
          [input],
          baseline,
          canonicalFiveStartingPositionsCatalog(),
        ),
      ).toThrow(/verified sources/);
      expect(decodeAdmissionProposal(JSON.stringify({ ...proposal, blockers: [] })).ok).toBe(false);
      expect(
        decodeAdmissionProposal(
          JSON.stringify({ ...proposal, fullCampaignCopyDiffs: [{ ...diff, changes: [] }] }),
        ).ok,
      ).toBe(false);
    },
  );

  it('NET-019 blocks publication of an unresolved source weapon even after complete inventory removal', () => {
    const input = publicationFixture(fixtures.get('FREE/AUTO'));
    expect(input.decisions.length).toBeGreaterThan(0);
    const empty = { status: 'FINAL' as const, entries: [], unresolvedSourceEntryIds: [] };
    const draft: AdmissionReviewDraft = {
      ...input.draft,
      inventoryReview: empty,
      weaponDecisionRefs: [],
    };
    expect(() =>
      deriveAdmissionFullCopyDiff(
        { ...input, draft, decisions: [] },
        baseline,
        canonicalFiveStartingPositionsCatalog(),
      ),
    ).toThrow(/unresolved typed weapon/);
    const valid = {
      ...input,
      draft: {
        ...draft,
        weaponDecisionRefs: input.draft.weaponDecisionRefs,
        massReview: { ...draft.massReview, decision: 'APPROVED' as const },
        moneyReview: { status: 'FINAL' as const, amountOrNull: 0 },
      },
    };
    const diff = deriveAdmissionFullCopyDiff(
      valid,
      baseline,
      canonicalFiveStartingPositionsCatalog(),
    );
    expect(diff.blockers).toEqual([]);
    expect(diff.afterSheet.inventoryReview.entries).toEqual([]);
    expect(diff.beforeSheet.inventoryReview.entries.length).toBeGreaterThan(0);
    expect(diff.changes.some((change) => change.section === 'INVENTORY')).toBe(true);
    expect(() =>
      deriveAdmissionFullCopyDiff(
        { ...valid, draft },
        baseline,
        canonicalFiveStartingPositionsCatalog(),
      ),
    ).toThrow(/complete staged weapon decision history/);
  });

  it('NET-019 refuses foreign/changed decisions, wrong item binding and mechanical invalidity instead of adding a blocker', () => {
    const input = publicationFixture(fixtures.get('FREE/AUTO')),
      catalog = canonicalFiveStartingPositionsCatalog();
    const run = (changed: AdmissionCopyPublicationInput) =>
      deriveAdmissionFullCopyDiff(changed, baseline, catalog);
    const first = input.decisions[0]!;
    const armor = input.draft.inventoryReview.entries.find(
      (entry) => entry.item.kind === 'CATALOG' && entry.item.itemTypeId.startsWith('ITM-ARM-'),
    )!;
    expect(armor).toBeDefined();
    expect(() =>
      run({
        ...input,
        draft: {
          ...input.draft,
          inventoryReview: {
            ...input.draft.inventoryReview,
            entries: input.draft.inventoryReview.entries.map((entry) =>
              entry.reviewItemId === armor.reviewItemId
                ? {
                    ...entry,
                    item: { kind: 'CATALOG', itemTypeId: 'ITM-WPN-001' },
                    weaponDecisionReceiptIdOrNull: null,
                  }
                : entry,
            ),
          },
        },
      }),
    ).toThrow(/complete bound profile/);
    expect(() =>
      run({ ...input, decisions: [{ ...first, reviewCopyId: admissionId(9999) }] }),
    ).toThrow(/foreign/);
    expect(() => run({ ...input, decisions: [first, first] })).toThrow(/repeated/);
    expect(() =>
      run({
        ...input,
        draft: {
          ...input.draft,
          weaponDecisionRefs: input.draft.weaponDecisionRefs.map((ref) =>
            ref.kind === 'VALIDATED_REQUEST' ? { ...ref, validationReceiptId: 'foreign' } : ref,
          ),
        },
      }),
    ).toThrow(/changed staged/);
    expect(() =>
      run({
        ...input,
        draft: {
          ...input.draft,
          inventoryReview: {
            ...input.draft.inventoryReview,
            entries: input.draft.inventoryReview.entries.map((entry) => ({
              ...entry,
              weaponDecisionReceiptIdOrNull: null,
            })),
          },
        },
      }),
    ).toThrow(/resolved decision/);
    expect(() =>
      run({
        ...input,
        draft: { ...input.draft, statAdjustments: { ...input.draft.statAdjustments, S: -1000 } },
      }),
    ).toThrow();
  });

  it('NET-021 binds the ordered whole batch, mappings and review revision without allocating IDs for preview', () => {
    const inputs = ['FREE/AUTO', 'PURE/AUTO', 'UNITED/AUTO'].map((key, i) =>
      publicationFixture(fixtures.get(key), 1000 + i * 1000),
    );
    const original = sealAdmissionProposal(proposalBody(inputs));
    const reverse = sealAdmissionProposal(proposalBody([...inputs].reverse()));
    expect(original.proposalChecksum).not.toBe(reverse.proposalChecksum);
    const preview = sealAdmissionProposal(
      proposalBody(inputs.map((input) => ({ ...input, campaignCharacterIdOrNull: null }))),
    );
    expect(
      preview.fullCampaignCopyDiffs.every((diff) => diff.campaignCharacterIdOrNull === null),
    ).toBe(true);
    expect(preview.proposalChecksum).not.toBe(original.proposalChecksum);
    expect(() => sealAdmissionProposal(proposalBody([inputs[0]!, inputs[0]!]))).toThrow();
    expect(() =>
      sealAdmissionProposal(
        proposalBody([inputs[0]!, { ...inputs[1]!, campaignCharacterIdOrNull: null }]),
      ),
    ).toThrow();
    expect(() => sealAdmissionProposal(proposalBody([]))).toThrow();
    const sharedGroup = { kind: 'NEW' as const, groupDraftId: admissionId(9900), name: 'Группа' };
    const grouped = inputs.map((input) => ({
      ...input,
      draft: { ...input.draft, groupAssignment: sharedGroup },
    }));
    expect(sealAdmissionProposal(proposalBody(grouped)).fullCampaignCopyDiffs).toHaveLength(3);
    expect(() =>
      sealAdmissionProposal(
        proposalBody(
          grouped.map((input, index) =>
            index === 1
              ? {
                  ...input,
                  draft: {
                    ...input.draft,
                    groupAssignment: { ...sharedGroup, name: 'Другое имя' },
                  },
                }
              : input,
          ),
        ),
      ),
    ).toThrow();
  });

  it.each(
    ['FREE', 'PURE', 'UNITED'].flatMap((race) =>
      ['AUTO', 'MANUAL'].map((mode) => `${race}/${mode}`),
    ),
  )(
    'replays the original source-backed %s FINAL and exports the same bytes without writes',
    (key) => {
      const s = fixtures.get(key)!;
      const before = s.d.database.serialize();
      const changes = s.d.database.prepare('SELECT total_changes() AS n').get();
      const c = prepared(s);
      const result = receive(c, undefined, undefined, undefined, s.owner);
      expect(result).toEqual({ descriptor: c.descriptor, exportDocument: c.exportDocument });
      expect(Object.keys(result).sort()).toEqual(['descriptor', 'exportDocument']);
      expect(postSaveSha256(c.canonicalWitnessText)).toBe(c.witnessSha256);
      expect(Buffer.byteLength(c.canonicalWitnessText, 'utf8')).toBe(c.byteLength);
      const w = witness(c);
      expect(Object.keys(w).sort()).toEqual(
        [
          'schemaVersion',
          'ownerDeviceId',
          'localCharacter',
          'checkpoint',
          'skillPresentationStage',
          'symbiontPresentationStage',
        ].sort(),
      );
      expect(w.localCharacter).toEqual(s.current.localCharacter);
      expect(w.checkpoint).toEqual(s.current.checkpoint);
      expect(s.d.database.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
      expect(s.d.database.serialize().equals(before)).toBe(true);
      expect(Object.isFrozen(c)).toBe(true);
      expect(Object.isFrozen(c.exportDocument['mechanicsSnapshot'])).toBe(true);
    },
  );

  it.each(['FREE/AUTO', 'FREE/MANUAL', 'PURE/AUTO', 'PURE/MANUAL', 'UNITED/AUTO', 'UNITED/MANUAL'])(
    'NET-018 exposes a frozen private review source only after complete %s FINAL replay',
    (key) => {
      const s = fixtures.get(key)!;
      const c = prepared(s);
      const before = s.d.database.serialize();
      const result = validateFinalAdmissionReviewSource(
        c.canonicalWitnessText,
        s.owner,
        c.descriptor,
        c.exportDocument,
        baseline,
        limits,
      );
      expect(result.candidate).toEqual({
        descriptor: c.descriptor,
        exportDocument: c.exportDocument,
      });
      expect(result.checkpoint.localCharacter).toEqual(s.current.localCharacter);
      expect(result.checkpoint.checkpoint).toEqual(s.current.checkpoint);
      expect(result.checkpoint.finalizationStage).toEqual(s.current.finalizationStage);
      const mechanics =
        result.checkpoint.finalizationStage?.finalMechanicsSnapshotOrNull?.mechanics;
      expect(mechanics).toBeDefined();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.checkpoint)).toBe(true);
      expect(Object.isFrozen(mechanics!.effectiveStats)).toBe(true);
      expect(Reflect.set(mechanics!.effectiveStats, 'S', 999)).toBe(false);
      expect(s.d.database.serialize().equals(before)).toBe(true);
      // The existing peer-facing validator still returns only its two public fields.
      expect(Object.keys(receive(c, undefined, undefined, undefined, s.owner)).sort()).toEqual([
        'descriptor',
        'exportDocument',
      ]);
    },
  );

  it('NET-018 refuses foreign ownership or a mismatched descriptor before exposing private review input', () => {
    const s = fixture();
    const c = prepared(s);
    const before = s.d.database.serialize();
    for (const [owner, descriptor] of [
      ['foreign-owner', c.descriptor],
      [s.owner, { ...c.descriptor, exportBytesSha256: 'f'.repeat(64) }],
    ] as const)
      error(() =>
        validateFinalAdmissionReviewSource(
          c.canonicalWitnessText,
          owner,
          descriptor,
          c.exportDocument,
          baseline,
          limits,
        ),
      );
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it.each(['FREE/AUTO', 'FREE/MANUAL', 'PURE/AUTO', 'PURE/MANUAL', 'UNITED/AUTO', 'UNITED/MANUAL'])(
    'NET-019 derives complete public mechanical cores from verified %s without writing the source',
    (key) => {
      const s = fixtures.get(key)!,
        c = prepared(s);
      const source = validateFinalAdmissionReviewSource(
        c.canonicalWitnessText,
        s.owner,
        c.descriptor,
        c.exportDocument,
        baseline,
        limits,
      );
      const input = admissionSourceMechanicsInput(source),
        bytes = s.d.database.serialize();
      const zero = { S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 };
      const draft: AdmissionReviewDraft = {
        statAdjustments: { ...zero, S: 1 },
        startingSkills: { entries: [] },
        massReview: {
          massKg:
            source.checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!.identity.massKg,
          decision: 'APPROVED',
        },
        inventoryReview: {
          status: 'FINAL',
          entries: [
            {
              reviewItemId: '00000000-0000-4000-8000-000000000001',
              sourceEntryIdOrNull: null,
              item: {
                kind: 'CUSTOM_ITEM',
                name: 'Предмет',
                description: '',
                statBonusOrNull: { statCode: 'S', positiveIntegerBonus: 3 },
              },
              quantity: 2,
              qualityLabel: 'Обычное',
              weaponDecisionReceiptIdOrNull: null,
            },
          ],
          unresolvedSourceEntryIds: [],
        },
        moneyReview: { status: 'FINAL', amountOrNull: 0 },
        weaponDecisionRefs: [],
        groupAssignment: { kind: 'START' },
        locationAssignment: { location: 'Город', subLocationOrNull: null },
      };
      const result = deriveAdmissionMechanicalCores(source, baseline, draft);
      expect(result.before.stats.acceptedBase).toEqual(input.baseStats);
      expect(result.after.stats.acceptedBase).toEqual(input.baseStats);
      expect(result.after.stats.backpackItemAdjustments.S).toBe(6);
      expect(result.after.stats.skillStageStats.S).toBe(result.before.stats.skillStageStats.S + 1);
      expect(result.after.skills.entries.every((skill) => skill.source !== 'SELECTED')).toBe(true);
      expect(result.after.skills.maxSlots).toBe(result.before.skills.maxSlots);
      expect(result.before.runtime).toEqual(result.after.runtime);
      expect(result.before.symbionts).toEqual(result.after.symbionts);
      expect(result.before.advisorOrNull).toEqual(result.after.advisorOrNull);
      expect(result.before.permanentGrants).toEqual(result.after.permanentGrants);
      const text = JSON.stringify(result);
      expect(text).not.toMatch(
        /CORE-\d|SYM-\d|privateReplayWitness|snapshotJson|localCharacterId|checkpointId|correctionHeadHash|sourceChecksum/,
      );
      const properties = deriveAdmissionSourceProperties(source);
      const identities = properties.map((entry, index) => ({
        reviewItemId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        sourceEntryIdOrNull: entry.sourceEntryId,
      }));
      expect(deriveAdmissionSourceProperties(source)).toEqual(properties);
      expect(properties).toHaveLength(
        source.checkpoint.armorBundleStage!.qualityRollRecordOrNull!.armorPieces.length + 1 + 5,
      );
      const initialInventory = initialAdmissionInventoryReview(properties, identities);
      expect(initialInventory.status).toBe('PENDING');
      expect(initialInventory.unresolvedSourceEntryIds).toEqual(
        properties.map((entry) => entry.sourceEntryId),
      );
      const catalog = canonicalFiveStartingPositionsCatalog();
      expect(
        validateAdmissionInventorySelection(properties, identities, initialInventory, catalog),
      ).toEqual(initialInventory);
      const withNewIdentity = [
        ...identities,
        { reviewItemId: draft.inventoryReview.entries[0]!.reviewItemId, sourceEntryIdOrNull: null },
      ];
      expect(
        validateAdmissionInventorySelection(
          properties,
          withNewIdentity,
          draft.inventoryReview,
          catalog,
        ),
      ).toEqual(draft.inventoryReview);
      expect(() =>
        validateAdmissionInventorySelection(properties, identities, draft.inventoryReview, catalog),
      ).toThrow();
      expect(() =>
        validateAdmissionInventorySelection(
          properties,
          identities.slice(1),
          { status: 'FINAL', entries: [], unresolvedSourceEntryIds: [] },
          catalog,
        ),
      ).toThrow();
      expect(
        validateAdmissionInventorySelection(
          properties,
          identities,
          { status: 'FINAL', entries: [], unresolvedSourceEntryIds: [] },
          catalog,
        ).entries,
      ).toEqual([]);
      expect(() =>
        validateAdmissionInventorySelection(
          properties,
          identities,
          { ...initialInventory, unresolvedSourceEntryIds: ['foreign'] },
          catalog,
        ),
      ).toThrow();
      const sourceWeapon = initialInventory.entries.find(
        (entry) => entry.item.kind === 'CATALOG' && entry.item.itemTypeId.startsWith('ITM-WPN-'),
      )!;
      expect(() =>
        validateAdmissionInventorySelection(
          properties,
          identities,
          {
            ...initialInventory,
            entries: [
              { ...sourceWeapon, item: { kind: 'CATALOG', itemTypeId: 'ITM-WPN-unknown' } },
            ],
          },
          catalog,
        ),
      ).toThrow(/distinct new review item/);
      expect(() =>
        validateAdmissionInventorySelection(
          properties,
          identities,
          {
            ...initialInventory,
            entries: [{ ...sourceWeapon, qualityLabel: 'invented mechanical +999' }],
          },
          catalog,
        ),
      ).toThrow(/quality/);
      expect(() => initialAdmissionInventoryReview(properties, identities.slice(1))).toThrow();
      expect(() =>
        initialAdmissionInventoryReview(
          properties,
          identities.map((entry) => ({ ...entry, reviewItemId: identities[0]!.reviewItemId })),
        ),
      ).toThrow();
      expect(() =>
        initialAdmissionInventoryReview(
          properties,
          identities.map((entry, index) =>
            index === 0 ? { ...entry, sourceEntryIdOrNull: 'foreign' } : entry,
          ),
        ),
      ).toThrow();
      const weaponRequest = properties.find(
        (entry) => entry.weaponRequestOrNull !== null,
      )?.weaponRequestOrNull;
      if (source.checkpoint.weaponProfileStage!.kind === 'FORMULA')
        expect(weaponRequest).toEqual({
          requestId: source.checkpoint.weaponProfileStage!.requestId,
          validationReceiptId:
            source.checkpoint.weaponProfileStage!.records.at(-1)!.receipt.receiptId,
        });
      else expect(weaponRequest).toBeUndefined();
      const weaponCatalog = canonicalWeaponProfileCatalog();
      if (weaponRequest !== undefined && weaponRequest !== null) {
        const approve: AdmissionWeaponResolutionInput = {
          weaponReviewInput: { kind: 'VALIDATED_REQUEST', ...weaponRequest },
          decision: 'APPROVE',
          overrideProfileOrNull: null,
          reasonOrNull: null,
        };
        const decision = deriveAdmissionWeaponResolution(
          source,
          weaponCatalog,
          withNewIdentity,
          draft,
          approve,
        );
        expect(decision.afterProfile).toEqual(decision.beforeProfileOrNull);
        expect(decision.afterProfile.statSource).toBe('PLAYER_FORMULA_VALIDATED');
        expect(() =>
          deriveAdmissionWeaponResolution(source, weaponCatalog, withNewIdentity, draft, {
            ...approve,
            weaponReviewInput: {
              kind: 'VALIDATED_REQUEST',
              requestId: weaponRequest.requestId,
              validationReceiptId: 'foreign',
            },
          }),
        ).toThrow(/validated source request/);
        expect(() =>
          deriveAdmissionWeaponResolution(source, weaponCatalog, withNewIdentity, draft, {
            ...approve,
            reasonOrNull: 'fabricated',
          }),
        ).toThrow(/approval/);
      }
      const fixedTemplate = weaponCatalog.entries.find((entry) => entry.profileKind === 'FIXED')!;
      const grantDraft: AdmissionReviewDraft = {
        ...draft,
        inventoryReview: {
          ...draft.inventoryReview,
          entries: [
            {
              ...draft.inventoryReview.entries[0]!,
              item: { kind: 'CATALOG', itemTypeId: fixedTemplate.weaponTypeId },
            },
          ],
        },
      };
      const grant: AdmissionWeaponResolutionInput = {
        weaponReviewInput: {
          kind: 'ADMISSION_GRANT',
          reviewItemId: grantDraft.inventoryReview.entries[0]!.reviewItemId,
          weaponTypeId: fixedTemplate.weaponTypeId,
          reason: 'Выдача при согласовании',
          profileSource: {
            kind: 'CATALOG_TEMPLATE',
            templateId: admissionWeaponTemplateId(fixedTemplate),
          },
        },
        decision: 'MASTER_OVERRIDE',
        overrideProfileOrNull: null,
        reasonOrNull: null,
      };
      const granted = deriveAdmissionWeaponResolution(
        source,
        weaponCatalog,
        withNewIdentity,
        grantDraft,
        grant,
      );
      expect(granted.beforeProfileOrNull).toBeNull();
      expect(granted.afterProfile.statSource).toBe('TEMPLATE_FIXED');
      expect(granted.afterProfile.weaponTypeId).toBe(fixedTemplate.weaponTypeId);
      expect(granted.input).toEqual(grant);
      expect(granted.input).not.toBe(grant);
      expect(() =>
        deriveAdmissionWeaponResolution(source, weaponCatalog, identities, grantDraft, grant),
      ).toThrow(/new owned/);
      expect(() =>
        deriveAdmissionWeaponResolution(source, weaponCatalog, withNewIdentity, draft, grant),
      ).toThrow(/catalog weapon/);
      expect(() =>
        deriveAdmissionWeaponResolution(source, weaponCatalog, withNewIdentity, grantDraft, {
          ...grant,
          decision: 'APPROVE',
        }),
      ).toThrow(/grant uses/);
      const before: AdmissionMechanicalSheetV1 = {
        ...result.before,
        massReview: { massKg: result.before.identity.massKg, decision: 'PENDING_MASTER_APPROVAL' },
        inventoryReview: admissionSourceInventorySheet(properties, identities),
        moneyReview: { status: 'PENDING', amountOrNull: null },
        groupAssignmentOrNull: null,
        locationAssignmentOrNull: null,
      };
      const after: AdmissionMechanicalSheetV1 = {
        ...result.after,
        massReview: draft.massReview,
        inventoryReview: {
          ...draft.inventoryReview,
          entries: draft.inventoryReview.entries.map((entry) => ({
            ...entry,
            weaponProfileOrNull: null,
            equipmentState: 'UNEQUIPPED',
          })),
        },
        moneyReview: draft.moneyReview,
        groupAssignmentOrNull: draft.groupAssignment,
        locationAssignmentOrNull: draft.locationAssignment,
      };
      expect(decodeAdmissionMechanicalSheet(JSON.stringify(before))).toEqual({
        ok: true,
        value: before,
      });
      expect(decodeAdmissionMechanicalSheet(JSON.stringify(after))).toEqual({
        ok: true,
        value: after,
      });
      expect(admissionMechanicalChanges(before, before)).toEqual([]);
      const changes = admissionMechanicalChanges(before, after);
      expect(changes).toContainEqual({
        section: 'STATS',
        fieldPath: '/stats/permanentGmAdjustments/S',
        beforeValue: 0,
        afterValue: 1,
      });
      expect(changes).toContainEqual({
        section: 'STATS',
        fieldPath: '/stats/backpackItemAdjustments/S',
        beforeValue: 0,
        afterValue: 6,
      });
      expect(changes.some((change) => change.section === 'SKILLS')).toBe(true);
      expect(changes.some((change) => change.section === 'INVENTORY')).toBe(true);
      expect(changes.some((change) => change.section === 'MONEY')).toBe(true);
      expect(admissionMechanicalChangesValue(changes, before, after)).toEqual(changes);
      expect(() => admissionMechanicalChangesValue(changes.slice(1), before, after)).toThrow();
      expect(() =>
        admissionMechanicalChangesValue([...changes, changes[0]], before, after),
      ).toThrow();
      expect(() =>
        admissionMechanicalChangesValue(
          [{ ...changes[0], afterValue: 999 }, ...changes.slice(1)],
          before,
          after,
        ),
      ).toThrow();
      expect(() =>
        admissionMechanicalChangesValue(
          [{ ...changes[0], fieldPath: '/runtime/private' }, ...changes.slice(1)],
          before,
          after,
        ),
      ).toThrow();
      assertClosedAdmissionSheet(before);
      assertClosedAdmissionSheet(after);
      expect(s.d.database.serialize().equals(bytes)).toBe(true);
    },
  );

  it('NET-019 projects every complete canonical fixed profile without definition IDs or hidden provenance', () => {
    for (const entry of canonicalWeaponProfileCatalog().entries.filter(
      (entry) => entry.profileKind === 'FIXED',
    )) {
      const profile = projectAdmissionWeaponProfile(entry.template);
      expect(profile.weaponTypeId).toBe(entry.weaponTypeId);
      expect(profile.damageDefinition.sourceNotation).toBe(
        entry.template.damageDefinition.sourceNotation,
      );
      expect(profile.statRequirements).toEqual(entry.template.statRequirements);
      expect(profile.properties).toEqual(entry.template.properties);
      expect(JSON.stringify(profile)).not.toMatch(
        /CVD-WPN|RG-WPN|CORE-\d|F-WPN|definitionId|rollGroupId|templateProfileVersion/,
      );
    }
  });

  it('does not allocate a scope/export record and reuses an enclosing read transaction without committing it', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const sentinel = new Error('outer rollback');
    expect(() =>
      s.d.database.transaction(() => {
        expect(s.d.database.inTransaction).toBe(true);
        prepared(s);
        expect(s.d.database.inTransaction).toBe(true);
        throw sentinel;
      })(),
    ).toThrow(sentinel);
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('preserves original payload/snapshot strings and actual presentation rows without a copied Durable envelope', () => {
    const s = fixture();
    const c = prepared(s);
    const w = witness(c);
    expect(w.localCharacter.payloadJson).toBe(s.current.localCharacter.payloadJson);
    expect(w.checkpoint.snapshotJson).toBe(s.current.checkpoint.snapshotJson);
    expect(c.canonicalWitnessText).not.toContain('privateKeyPkcs8Base64');
    expect(c.canonicalWitnessText).not.toContain('masterAuthorityRevision');
    expect(c.canonicalWitnessText).not.toContain('sessionTicket');
    expect(row(w)['durablePayload']).toBeUndefined();
  });

  it('reads actual latest metadata, pins its revision and reproduces unchanged bytes after SQLite reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'candidate-reopen-'));
    directories.push(directory);
    const path = join(directory, 'source.sqlite');
    const s = await source('PURE', 'MANUAL', path);
    const original = prepared(s);
    const head = openPlayerPostSave(s.d, s.id, 'CHR-040');
    const values: PostSaveMetadata = {
      name: 'Источник CORE-159 fan',
      description: 'Private own metadata',
      artAssetKeyOrLocalFile: null,
    };
    const request: PostSaveRequest = {
      protocolVersion: 1,
      messageType: 'command.request',
      role: 'player',
      commandKind: 'workflow-command',
      commandId: 'candidate-metadata',
      workflowCommandId: 'UI-CMD-CHAR-LOCAL-METADATA-PATCH',
      expectedRevisions: postSaveRevisions(head),
      payload: {
        ...postSaveCommon(head),
        stage: 'LOCAL_CHARACTER_POST_SAVE',
        variant: 'METADATA_PATCH',
        sourceFormId: 'CHR-040',
        expectedMetadataRevisionOrNull: 0,
        values,
      },
    };
    commitLocalPostSave(s.d, request, 'candidate-metadata-receipt', () => {
      throw new Error('must not allocate');
    });
    const changed = prepared(s);
    expect(changed.descriptor.metadataRevision).toBe(1);
    expect(changed.exportDocument['metadata']).toEqual(values);
    expect(changed.descriptor.sourceChecksum).toBe(original.descriptor.sourceChecksum);
    expect(changed.canonicalWitnessText).toBe(original.canonicalWitnessText);
    expect(changed.descriptor.exportChecksum).not.toBe(original.descriptor.exportChecksum);
    // An immutable old request can still replay its pinned DTO after later metadata writes.
    expect(receive(original, undefined, undefined, undefined, s.owner).descriptor).toEqual(
      original.descriptor,
    );
    s.d.database.close();
    const reopened = openPersistenceDatabase(path);
    databases.push(reopened);
    const d = dependencies(reopened, s.p.setup.catalog);
    expect(prepareOwnedFinalAdmissionCandidate(d, s.owner, s.id, limits)).toEqual(changed);
    expect(receive(changed, undefined, undefined, undefined, s.owner).exportDocument).toEqual(
      changed.exportDocument,
    );
  });

  it('accepts existing non-v4 source and receipt identifiers rather than inventing a UUID filter', () => {
    const c = prepared();
    expect(c.descriptor.sourceUuid).toBe(['candidate', 'FREE', 'AUTO', 'character'].join('-'));
    expect(c.descriptor.sourceSnapshotId).toBe('candidate-final-receipt');
    expect(receive(c).descriptor).toEqual(c.descriptor);
  });

  it('enforces exact UTF-8 size bounds on both sides without truncating the original witness', () => {
    const s = fixture();
    const c = prepared(s);
    expect(
      prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, { maxWitnessBytes: c.byteLength }),
    ).toEqual(c);
    expect(
      receive(c, undefined, undefined, undefined, s.owner, baseline, c.byteLength).descriptor,
    ).toEqual(c.descriptor);
    expect(
      error(() =>
        prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, {
          maxWitnessBytes: c.byteLength - 1,
        }),
      ).code,
    ).toBe('WITNESS_TOO_LARGE');
    expect(
      error(() => receive(c, undefined, undefined, undefined, s.owner, baseline, c.byteLength - 1))
        .code,
    ).toBe('WITNESS_TOO_LARGE');
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid explicit size limit %s',
    (maximum) => {
      const s = fixture();
      const c = prepared(s);
      expect(
        error(() =>
          prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, { maxWitnessBytes: maximum }),
        ).field,
      ).toBe('limits');
      expect(
        error(() => receive(c, undefined, undefined, undefined, s.owner, baseline, maximum)).field,
      ).toBe('limits');
    },
  );

  it('rejects a foreign device without writes', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    error(() => prepareOwnedFinalAdmissionCandidate(s.d, 'foreign-device', s.id, limits));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('rejects a missing source without writes', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    error(() => prepareOwnedFinalAdmissionCandidate(s.d, s.owner, 'unknown-source', limits));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('rejects a real DRAFT after the complete creation path without writes', async () => {
    const draft = await source('FREE', 'MANUAL', ':memory:', false);
    const draftBefore = draft.d.database.serialize();
    error(() => prepared(draft));
    expect(draft.d.database.serialize().equals(draftBefore)).toBe(true);
  });

  it('rejects a checksum-valid VARIANT witness without writes', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const c = prepared();
    const w = witness(c);
    w.localCharacter.lifecycleState = 'VARIANT';
    snapshot(w);
    error(() => receive(c, canonicalPostSaveJson(w)));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('refuses a loader returning another actual character/checkpoint and redacts thrown private errors', () => {
    const s = fixture();
    const other = fixtures.get(['PURE', 'AUTO'].join('/'))!;
    const foreign = { ...s.d, loadCheckpoint: () => other.current };
    error(() => prepareOwnedFinalAdmissionCandidate(foreign, s.owner, s.id, limits));
    const secret = 'PRIVATE_OLD_ART_AND_INVALID_INPUT';
    const e = error(() =>
      prepareOwnedFinalAdmissionCandidate(
        {
          ...s.d,
          loadCheckpoint: () => {
            throw new Error(secret);
          },
        },
        s.owner,
        s.id,
        limits,
      ),
    );
    expect(`${e.message}${e.stack}${JSON.stringify(e)}`).not.toContain(secret);
  });

  it('rejects a loader changing the actual source inside the read transaction and rolls it back', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const d = {
      ...s.d,
      loadCheckpoint: () => {
        s.d.database
          .prepare(
            'UPDATE local_character SET projectionRevision = projectionRevision + 1 WHERE local_character_id = ?',
          )
          .run(s.id);
        return s.current;
      },
    };
    error(() => prepareOwnedFinalAdmissionCandidate(d, s.owner, s.id, limits));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('checks the actual owner binding, not just the singleton device or a supplied owner argument', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const rollback = new Error('test rollback');
    expect(() =>
      s.d.database.transaction(() => {
        s.d.database
          .prepare(
            'UPDATE local_character_owner SET owner_device_id = ? WHERE local_character_id = ?',
          )
          .run('foreign-device', s.id);
        error(() => prepared(s));
        throw rollback;
      })(),
    ).toThrow(rollback);
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it.each([
    [
      'owner',
      (w: Witness) => {
        w.ownerDeviceId = 'foreign-owner';
      },
    ],
    [
      'schema',
      (w: Witness) => {
        w.schemaVersion = 2;
      },
    ],
    [
      'row ID',
      (w: Witness) => {
        w.localCharacter.localCharacterId = 'foreign-source';
        snapshot(w);
      },
    ],
    [
      'checkpoint owner',
      (w: Witness) => {
        w.checkpoint.localCharacterId = 'foreign-source';
      },
    ],
    [
      'snapshot hash',
      (w: Witness) => {
        w.checkpoint.snapshotSha256 = '0'.repeat(64);
      },
    ],
    [
      'rehashed unrelated snapshot',
      (w: Witness) => {
        w.checkpoint.snapshotJson = '{"localCharacter":{}}';
        w.checkpoint.snapshotSha256 = postSaveSha256(w.checkpoint.snapshotJson);
      },
    ],
    [
      'snapshot field order',
      (w: Witness) => {
        w.checkpoint.snapshotJson = JSON.stringify({
          localCharacter: {
            payloadJson: w.localCharacter.payloadJson,
            lifecycleState: 'FINAL',
            localCharacterId: w.localCharacter.localCharacterId,
          },
        });
        w.checkpoint.snapshotSha256 = postSaveSha256(w.checkpoint.snapshotJson);
      },
    ],
    [
      'state vector',
      (w: Witness) => {
        w.checkpoint.stateRevision++;
      },
    ],
    [
      'both state vectors',
      (w: Witness) => {
        w.checkpoint.stateRevision++;
        w.localCharacter.stateRevision++;
      },
    ],
    [
      'draft revision',
      (w: Witness) => {
        w.checkpoint.checkpointRevision++;
      },
    ],
    [
      'foreign presentation',
      (w: Witness) => {
        w.symbiontPresentationStage = {
          formId: 'CHR-025',
          compositionDraftRevision: 0,
          projectionRevision: 0,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'foreign' }],
          routeTemplate: '/player/characters/:localCharacterId/create/chr-025',
        };
      },
    ],
  ] as const)('rejects %s even with a canonical wrapper', (_label, mutate) => {
    const c = prepared();
    const w = witness(c);
    mutate(w);
    error(() => receive(c, canonicalPostSaveJson(w)));
  });

  it.each([
    'runtime HP',
    'effective stat',
    'skill bonus',
    'weapon facts',
    'physical receipt',
    'provenance',
    'metadata revision',
  ])('rejects rechecksummed safe DTO %s that has no exact original replay', (target) => {
    const c = prepared();
    const altered = alteredExport(c, (doc) => {
      const mechanics = row(doc['mechanicsSnapshot']);
      if (target === 'runtime HP') row(mechanics['runtime'])['maxHp'] = 99999;
      if (target === 'effective stat') row(mechanics['effectiveStats'])['S'] = 99999;
      if (target === 'skill bonus') row((mechanics['skills'] as JsonObject[])[0])['bonus'] = 99999;
      if (target === 'weapon facts')
        row(row(mechanics['property'])['weapon'])['name'] = 'Unrelated weapon';
      if (target === 'physical receipt')
        row((doc['creationRandomReceipts'] as JsonObject[])[0])['faces'] = [2, 2, 2, 2, 2, 2, 2];
      if (target === 'provenance') row(doc['provenance'])['finalSnapshotVersion'] = 999;
      if (target === 'metadata revision') {
        doc['metadataRevision'] = 1;
        row(doc['provenance'])['metadataRevision'] = 1;
      }
    });
    // These finite, known-schema values are insufficient evidence by themselves.
    validateArchivedLocalExportDocument(altered.document, baseline);
    error(() => receive(c, undefined, altered.descriptor, altered.document));
  });

  it('rejects rewritten mechanics even after the private snapshot and FINAL mechanics hashes are recomputed', () => {
    const c = prepared();
    const w = witness(c);
    alterPayload(w, (payload) => {
      const stage = row(payload['finalizationStage']);
      const finalSnapshot = row(stage['finalMechanicsSnapshotOrNull']);
      row(row(finalSnapshot['mechanics'])['effectiveStats'])['S'] = 99999;
      const snapshotHash = creationFinalizationHash(finalSnapshot);
      row(row(payload['receipt'])['result'])['mechanicsSnapshotHashOrNull'] = snapshotHash;
      const last = (stage['records'] as JsonObject[]).at(-1)!;
      row(row(last['receipt'])['result'])['mechanicsSnapshotHashOrNull'] = snapshotHash;
    });
    error(() => receive(c, canonicalPostSaveJson(w)));
  });

  it('rejects a rechecksummed changed metadata baseline at revision zero', () => {
    const c = prepared();
    const changed = alteredExport(c, (doc) => {
      row(doc['metadata'])['name'] = 'Different baseline name';
    });
    validateArchivedLocalExportDocument(changed.document, baseline);
    error(() => receive(c, undefined, changed.descriptor, changed.document));
  });

  it.each([
    'schemaVersion',
    'sourceUuid',
    'sourceSnapshotId',
    'metadataRevision',
    'sourceChecksum',
    'exportChecksum',
    'exportBytesSha256',
    'baselineVersion',
  ])('rejects a changed or extra descriptor field %s', (key) => {
    const c = prepared();
    error(() =>
      receive(c, undefined, {
        ...c.descriptor,
        [key]: key === 'metadataRevision' ? 999 : 'foreign',
      }),
    );
  });
  it('rejects unknown fields at the wrapper, original row, checkpoint and expected export boundaries', () => {
    const c = prepared();
    for (const target of ['wrapper', 'row', 'checkpoint', 'export'] as const) {
      const w = witness(c);
      const doc = row(structuredClone(c.exportDocument));
      if (target === 'wrapper') row(w)['sessionTicket'] = 'private-foreign';
      if (target === 'row') row(w.localCharacter)['ownerDeviceId'] = 'foreign';
      if (target === 'checkpoint') row(w.checkpoint)['privateKeyPkcs8Base64'] = 'foreign';
      if (target === 'export') doc['privateWitness'] = w.localCharacter.payloadJson;
      error(() => receive(c, canonicalPostSaveJson(w), undefined, doc));
    }
  });
  it('rejects unknown baseline, mixed expected owner and malformed/noncanonical JSON with fixed private errors', () => {
    const c = prepared();
    error(() => receive(c, undefined, undefined, undefined, 'another-owner'));
    error(() =>
      receive(c, undefined, undefined, undefined, fixture().owner, {
        ...baseline,
        baselineVersion: 'foreign-baseline',
      }),
    );
    for (const value of [
      null,
      {},
      'PRIVATE_BAD_INPUT',
      '[1]',
      `${c.canonicalWitnessText}\n`,
      c.canonicalWitnessText.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    ]) {
      const e = error(() => receive(c, value));
      expect(JSON.stringify(e)).not.toContain('PRIVATE_BAD_INPUT');
      expect(e.cause).toBeUndefined();
    }
  });
  it('never invokes caller-supplied export/descriptor accessors and does not return private witness fields', () => {
    const c = prepared();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_ACCESSOR');
    });
    const doc = { ...c.exportDocument };
    Object.defineProperty(doc, 'metadata', { get: getter, enumerable: true });
    error(() => receive(c, undefined, undefined, doc));
    const d = { ...c.descriptor };
    Object.defineProperty(d, 'sourceUuid', { get: getter, enumerable: true });
    error(() => receive(c, undefined, d));
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(receive(c))).not.toContain('payloadJson');
    expect(JSON.stringify(receive(c))).not.toContain('canonicalWitnessText');
  });
});
