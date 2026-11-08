import { types } from 'node:util';
import {
  readNpcCompositionAuthoring,
  prepareNpcCompositionConfirmation,
  prepareNpcCompositionResolution,
  deriveNpcCompositionSkills,
  npcCompositionConfirmedStats,
  npcCompositionInventoryStats,
  assertNpcCompositionConfirmed,
  previewNpcCompositionCandidate,
  validateNpcCompositionContinuation,
  type NpcCompositionAuthoringState,
  type NpcCompositionAuthoringBase,
} from './npc-composition-preparation.js';
import type {
  NpcAttemptPreparationContext,
  NpcPreparedAttempt,
} from '../persistence/npc-library-store.js';
import { deriveNpcInitialEffectPreparation } from '../domain/rules/npc-authoring/initial-effect-preparation.js';
import { createNpcCustomItemPreparation } from './npc-custom-item-preparation.js';
import { createNpcItemRestorePreparation } from './npc-item-restore-preparation.js';
import { createNpcPoisonPreparation } from './npc-poison-preparation.js';
import {
  createNpcPoisonReaders,
  NpcPoisonReadInputError,
  type NpcPoisonReadBasis,
} from './npc-poison-readers.js';
import { readNpcHumanoidPoisonProof } from '../domain/rules/npc-authoring/taipan-mode-state.js';
import {
  readNpcInventoryCoatingSelection,
  readNpcPoisonPreparationEvidence,
  type NpcInventoryCoatingContext,
} from '../domain/rules/npc-authoring/formal-poison-coating.js';
import type { NpcInventoryRequestEntry } from '../domain/rules/npc-authoring/inventory.js';
import {
  createNpcLifePreparation,
  NpcLifePreparationError,
  type NpcLifePreparationBasis,
} from './npc-life-preparation.js';
import { verifyNpcLifeRollOutcome } from './npc-life-roll.js';
import {
  createNpcWeaverPreparation,
  type NpcWeaverPreparationBasis,
} from './npc-weaver-preparation.js';
import {
  deriveNpcFormalWeaverEffectContribution,
  readNpcFormalWeaverEffectContribution,
  validateNpcFormalWeaverEffectContribution,
  NpcFormalWeaverCurrentUnavailableError,
  type NpcFormalWeaverHistoryAnchor,
  type NpcFormalWeaverEffectContribution,
} from '../domain/rules/npc-authoring/formal-weaver-effects.js';
import { npcCompositionDiceMode } from './npc-composition-preparation.js';
import {
  createNpcFormalLifeState,
  NpcFormalLifeError,
  deriveNpcRetainedFormalLifeState,
  previewNpcFormalLifeTimerBasis,
  NpcFormalLifeTimerDisplayUnavailableError,
  type NpcFormalLifeHistoryAnchor,
  type NpcFormalLifeState,
} from '../domain/rules/npc-authoring/formal-life-state.js';
import {
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
  type NpcFunctionalDuplicateProof,
} from '../domain/rules/npc-authoring/functional-duplicate-composition.js';
import {
  createNpcFormalControlEffect,
  npcFormalControlMaximumRemainingMinutes,
  readNpcFormalControlRemaining,
  type NpcFormalControlEffectInstance,
  type NpcFormalControlHistoryAnchor,
} from '../domain/rules/npc-authoring/formal-control-effects.js';
import { deriveNpcFormalControlComposition } from '../domain/rules/npc-authoring/formal-control-composition.js';
import {
  createNpcAlcoholEffect,
  type NpcAlcoholEffectInstance,
  type NpcAlcoholHistoryAnchor,
} from '../domain/rules/npc-authoring/alcohol-effects.js';
import { prepareNewNpcAlcoholSchedule } from '../domain/rules/npc-authoring/initial-effects.js';
import {
  createNpcInitialHpModeEffect,
  deriveNpcHpModeStatProfile,
  npcHpModeMaximumRemainingMinutes,
  validateNpcHpModeRemainingMinutes,
  type NpcHpModeHistoryAnchor,
  type NpcHpModeEffectInstance,
} from '../domain/rules/npc-authoring/combined-hp-modes.js';
import type { NpcCompositionAuthoringApply } from '../persistence/npc-gm-source.js';
import type { NpcPreparationRequest } from '@shared/npc-command.js';
import type {
  NpcAlcoholPreparation,
  NpcHpModePreparation,
  NpcFormalControlPreparation,
} from '../shared/npc-presentation.js';
import {
  npcTechnicalRequestValue,
  npcAlcoholPreparationRequestInputValue,
  npcHpModePreparationRequestInputValue,
  npcFormalControlPreparationRequestInputValue,
  npcLifeStateRollRequestInputValue,
  npcLifeStateSetRequestInputValue,
} from '@shared/npc-command.js';
import type { RollFaceSampler } from '../domain/entities/roll-request/roll-model.js';
import {
  deriveNpcOrdinaryStatProfile,
  deriveNpcOrdinaryHpModeSource,
  NpcOrdinarySkillReconfirmationRequiredError,
} from '../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import { readNpcGmSourceInTransaction } from '../persistence/campaign-creation.js';
import {
  prepareNpcInitialTraumaFact,
  readNpcInitialTraumaFact,
  NpcInitialTraumaError,
  type NpcInitialTraumaEvidence,
  type NpcInitialTraumaCalendarAnchor,
} from '../domain/rules/npc-authoring/initial-trauma.js';
import type Database from 'better-sqlite3';
import { prepareNpcWoundFact } from './npc-wound-preparation.js';
import { NpcEquipmentValidationError } from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import { NpcBaseStatRuleError } from '../domain/rules/npc-authoring/base-stats.js';
import { SkillStageRuleError } from '../domain/rules/skill-stage/catalog.js';
import {
  buildNpcHumanoidSnapshot,
  previewNpcHumanoid,
  type NpcHumanoidPreview,
  readNpcHumanoidSnapshot,
  type NpcHumanoidSnapshot,
  type NpcHumanoidInitialStateContext,
  type NpcHumanoidTraumaContext,
  type NpcHumanoidTraumaPreview,
  type NpcHumanoidWoundContext,
  type NpcHumanoidEquipmentContext,
  type NpcHumanoidEquipmentProof,
  type NpcHumanoidRuntimeEffectContext,
  type NpcHumanoidRuntimeEffectPreview,
  type NpcHumanoidLifeContext,
  type NpcHumanoidLifePreview,
  type NpcHumanoidWeaverEffectContext,
} from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import {
  buildNpcInventoryPublication,
  buildNpcInventoryPreview,
  buildNpcInventoryPhysicalBasis,
  planNpcInventoryWeaponVersions,
  selectNpcInventoryRestoreRequests,
  NpcInventoryPublicationError,
  type NpcInventoryPublicationProof,
  type NpcInventoryPublicationContext,
  type NpcInventoryHistoryEntry,
} from '../domain/rules/npc-authoring/inventory-publication.js';
import {
  projectNpcInventoryRequest,
  applyNpcStageInput,
  projectNpcInitialTraumaInput,
  completeNpcTraumaEditorRow,
  readNpcTraumaEditorRow,
  npcTraumaEditorRowFromFact,
  NpcStagedInputError,
} from '../domain/rules/npc-authoring/staged-input.js';
import {
  createNpcDiseasePreparation,
  createNpcTraumaPreparation,
  createNpcWoundPreparation,
  createNpcEquipmentCompatibilityPreparation,
  createNpcItemPreparation,
  createNpcCompositeItemPreparation,
  createNpcSymbiontPreparation,
  npcEditorForItemAttempt,
} from './npc-item-preparation.js';
import { createNpcPneumoniaEffect } from '../domain/rules/npc-authoring/periodic-disease-effects.js';
import { createNpcUntimedDiseaseEffect } from '../domain/rules/npc-authoring/untimed-disease-effects.js';
import type {
  NpcAttemptReadContext,
  NpcPublishedChildGraph,
} from '../persistence/npc-child-identities.js';
import {
  npcLinkedSetBindingValue,
  npcRuntimeEffectAllocationSource,
} from '../persistence/npc-child-identities.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  buildNpcCleanHumanoidSnapshot,
  NpcCleanHumanoidError,
  deriveNpcPureInitialSkills,
  readNpcCleanHumanoidSnapshot,
  type NpcCleanHumanoidSnapshot,
} from '../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import {
  evaluateNpcCompositionConsequences,
  readNpcOrdinaryLifetimeFacts,
} from '../domain/rules/npc-authoring/composition-consequences.js';
import {
  createEmptyNpcEditorDraft,
  readNpcEditorDraft,
  type NpcEditorCatalog,
  type NpcEditorDraft,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcDraftSection } from '../domain/rules/npc-authoring/types.js';
import {
  NPC_GM_REQUEST_READERS,
  readNpcVersionDerivationEvidenceInTransaction,
  readNpcInventoryHistoryEvidenceInTransaction,
  readNpcAttemptDerivationEvidenceInTransaction,
  readNpcDiseaseReservationEvidenceInTransaction,
  readNpcEffectAllocationInTransaction,
  readNpcRuntimeEffectReservationEvidenceInTransaction,
  readNpcCoatingReservationEvidenceInTransaction,
  readNpcPoisonPreparationEvidenceInTransaction,
  readNpcCustomProfileReservationEvidenceInTransaction,
  readNpcTraumaReservationEvidenceInTransaction,
  readNpcWoundReservationEvidenceInTransaction,
  readNpcEquipmentCompatibilityEvidenceInTransaction,
  readNpcSymbiontReservationEvidenceInTransaction,
  readNpcCompositionDerivationEvidenceInTransaction,
  readNpcCalculationMutationStamp,
  readNpcLifeStatePreparationEvidenceInTransaction,
  readNpcWeaverStatePreparationEvidenceInTransaction,
  readNpcGmPrimitiveCause,
  type NpcDerivationTarget,
  type NpcStoredDerivationVersion,
  type NpcVersionDerivationEvidence,
  type NpcDerivationPrefix,
} from '../persistence/npc-gm-source.js';
import type {
  NpcAttempt,
  NpcCalendarReadContext,
  NpcPendingCommitEvidence,
  NpcGmSource,
  NpcDomainReaders,
  NpcVersion,
  NpcCalendarClock,
  NpcOperation,
} from '../persistence/npc-library-records.js';
import {
  npcVersionValue,
  npcPendingCommitEvidenceValue,
} from '../persistence/npc-library-records.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  readNpcRetainedArt,
  readNpcUploadedArt,
  resolveNpcVersionArt,
  type NpcArtCatalog,
  type NpcResolvedArt,
} from './npc-art.js';
import type { NpcAuthoringSourceCatalog } from './npc-catalog.js';
import type { StartingWeaponVariant } from '../domain/rules/item-stage/starting-weapon.js';

type Sources = Pick<
  NpcAuthoringSourceCatalog,
  | 'ordinaryComposition'
  | 'ordinaryHumanoid'
  | 'cleanHumanoid'
  | 'humanoid'
  | 'inventoryPublication'
  | 'inventory'
  | 'skills'
  | 'baseStats'
  | 'compositionConsequences'
  | 'diseaseEffects'
  | 'nonperiodicDiseases'
  | 'initialTrauma'
  | 'initialEffects'
  | 'equipment'
  | 'diseaseUnconsciousness'
  | 'alcoholEffects'
  | 'hpModes'
  | 'alcoholPoisonResponse'
  | 'formalControls'
  | 'formalControlComposition'
  | 'formalLife'
  | 'formalWeaver'
  | 'poisonSource'
  | 'poisonCoatings'
  | 'functionalDuplicate'
  | 'initialLifeAuthoringAvailable'
>;
export interface NpcCommitAudit {
  readonly committedAt: string;
  readonly beforeGmSource: NpcGmSource;
}
export interface NpcInitialInventoryPreparation {
  readonly committedAt: string;
  readonly profiles: readonly Readonly<{
    itemInstanceId: string;
    weaponProfileVersionId: string;
  }>[];
}
export interface NpcOrdinaryPreparedVersion {
  readonly snapshot: JsonObject;
  readonly lifetimeFacts: JsonObject;
  readonly art: NpcResolvedArt;
  readonly preStartTimeOrNull: number | null;
}
export interface NpcOrdinaryPreview {
  readonly kind: 'UNCOMMITTED';
  readonly binding: Readonly<{
    scope: NpcAttempt['scope'];
    npcUuid: string;
    npcDraftId: string;
    attemptRevision: number;
    targetVersion: number;
    stage: 'NPC-016' | 'NPC-017';
  }>;
  readonly sheet: NpcHumanoidPreview['sheet'];
  readonly art: NpcResolvedArt;
  readonly preStartTimeOrNull: number | null;
}
/** Input blockers are distinct from corrupt prefix/storage or lost authority. */
export class NpcOrdinaryPreviewInputError extends Error {
  constructor(
    readonly code: 'INCOMPLETE' | 'INVALID' | 'NOT_YET_SUPPORTED',
    detail: string,
  ) {
    super(detail);
    this.name = new.target.name;
  }
}
function previewEntered<T>(value: NpcDraftSection<T>, field: string): T {
  if (value.kind !== 'ENTERED') throw new NpcOrdinaryPreviewInputError('INCOMPLETE', field);
  return value.value;
}
function previewSections(value: Readonly<Record<string, NpcDraftSection<unknown>>>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, section]) => [key, previewEntered(section, key)]),
  );
}
function previewEmpty(value: NpcDraftSection<readonly unknown[]>, field: string) {
  if (previewEntered(value, field).length !== 0)
    throw new NpcOrdinaryPreviewInputError('NOT_YET_SUPPORTED', field);
}
type NpcLocalSnapshotRead = Readonly<{ kind: 'NPC_LOCAL_SNAPSHOT_READ' }>;
export interface NpcOrdinaryDomainReaders extends NpcDomainReaders {
  readonly validateVersion: (
    ...args: [
      ...Parameters<NpcDomainReaders['validateVersion']>,
      snapshotRead?: NpcLocalSnapshotRead,
    ]
  ) => void;
  /** Called only after the same checked closure and current GM scope as the projection. No write/ID factory. */
  readonly preview: (
    attempt: NpcAttempt,
    previousVersionOrNull: NpcVersion | null,
    calendar: NpcCalendarReadContext,
  ) => NpcOrdinaryPreview;
  readonly itemPreparation: ReturnType<typeof createNpcItemPreparation>;
  readonly symbiontPreparation: ReturnType<typeof createNpcSymbiontPreparation>;
  readonly compositionPreparation: {
    readonly read: (
      attempt: NpcAttempt,
      context: NpcAttemptReadContext,
      calendar: NpcCalendarReadContext,
    ) => NpcCompositionAuthoringState;
    readonly candidate: (
      state: NpcCompositionAuthoringState,
    ) => ReturnType<typeof previewNpcCompositionCandidate>;
    readonly forward: (state: NpcCompositionAuthoringState) => void;
    readonly prepare: (
      request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>,
      context: NpcAttemptPreparationContext,
      sample: RollFaceSampler,
    ) => ReturnType<typeof prepareNpcCompositionConfirmation>;
    readonly apply: (
      ...args: [...Parameters<NpcCompositionAuthoringApply>, NpcCalendarReadContext]
    ) => JsonObject;
  };
  readonly diseasePreparation: ReturnType<typeof createNpcDiseasePreparation>;
  readonly compositeItemPreparation: ReturnType<typeof createNpcCompositeItemPreparation>;
  readonly customItemPreparation: ReturnType<typeof createNpcCustomItemPreparation>;
  readonly itemRestorePreparation: ReturnType<typeof createNpcItemRestorePreparation>;
  readonly lifePreparation: ReturnType<typeof createNpcLifePreparation>;
  readonly weaverPreparation: ReturnType<typeof createNpcWeaverPreparation>;
  readonly poisonPreparation: ReturnType<typeof createNpcPoisonPreparation>;
  readonly validateInventoryCoatingSelection: ReturnType<
    typeof createNpcPoisonReaders
  >['validateEditorSelection'];
  readonly inventoryPreviewForAttempt: (
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
  ) => ReturnType<typeof buildNpcInventoryPreview>;
  readonly runtimeEffectPreparation: {
    readonly inspect: (
      attempt: NpcAttempt,
      context: NpcAttemptReadContext,
      calendar: NpcCalendarReadContext,
    ) => {
      alcohol: NpcAlcoholPreparation;
      hpModes: readonly NpcHpModePreparation[];
      formalControls: readonly NpcFormalControlPreparation[];
    };
    readonly prepare: (
      request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>,
      context: NpcAttemptPreparationContext,
      allocate: () => string,
      committedAt: string,
    ) => NpcPreparedAttempt;
    readonly apply: (
      ...args: [...Parameters<NpcCompositionAuthoringApply>, NpcCalendarReadContext]
    ) => JsonObject;
  };
  readonly traumaPreparation: ReturnType<typeof createNpcTraumaPreparation>;
  readonly woundPreparation: ReturnType<typeof createNpcWoundPreparation>;
  readonly equipmentCompatibilityPreparation: ReturnType<
    typeof createNpcEquipmentCompatibilityPreparation
  >;
  readonly equipmentForAttempt: (
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
  ) => { proof: NpcHumanoidEquipmentProof; context: NpcHumanoidEquipmentContext } | null;
  /** Exact source profile plan; the guarded host factory alone allocates publication IDs. */
  readonly initialInventoryProfiles: (
    attempt: NpcAttempt,
    context: NpcAttemptReadContext,
    previousVersionOrNull: NpcVersion | null,
    calendar: NpcCalendarReadContext,
  ) => readonly Readonly<{ itemInstanceId: string; weaponVariantId: StartingWeaponVariant }>[];
  readonly applyArtPreparation: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => JsonObject;
  /** OPEN retains the resolved asset identity; null remains the later explicit Clear operation. */
  readonly initializeNew: () => JsonObject;
  readonly initializeOpen: (
    version: NpcVersion,
    calendar: NpcCalendarReadContext,
    preserveLegacyWeaverAbsence?: boolean,
    preserveLegacyPoisonAbsence?: boolean,
    snapshotRead?: NpcLocalSnapshotRead,
  ) => JsonObject;
  /** Called only by the host's guarded lazy COMMIT factory, after current authority/source checks. */
  readonly prepare: (
    attempt: NpcAttempt,
    operationId: string,
    previousVersionOrNull: NpcVersion | null,
    calendar: NpcCalendarReadContext,
    audit: NpcCommitAudit,
    inventory?: NpcInitialInventoryPreparation,
  ) => NpcOrdinaryPreparedVersion;
}
function fail(detail: string): never {
  throw new Error(`NPC ordinary version: ${detail}`);
}
function entered<T>(value: NpcDraftSection<T>, field: string): T {
  return value.kind === 'ENTERED' ? value.value : fail(`unentered ${field}`);
}
function empty(value: NpcDraftSection<readonly unknown[]>, field: string): void {
  if (entered(value, field).length !== 0) fail(`unsupported ${field}`);
}
function equal(actual: unknown, expected: unknown, field: string): void {
  if (!s.same(actual, expected)) fail(`different ${field}`);
}
function json(value: unknown): JsonObject {
  const text = s.canonical(value);
  return s.object(JSON.parse(text) as unknown) as JsonObject;
}
function identity(draft: NpcEditorDraft) {
  return {
    name: entered(draft.identity.name, 'name'),
    description: entered(draft.identity.description, 'description'),
    affiliation: entered(draft.identity.affiliation, 'affiliation'),
    campaignRole: entered(draft.identity.campaignRole, 'campaignRole'),
    sex: entered(draft.identity.sex, 'sex'),
    massKg: entered(draft.identity.massKg, 'massKg'),
    artAssetKeyOrNull: entered(draft.identity.artAssetKeyOrNull, 'art'),
    raceCode: entered(draft.schema.raceCode, 'race'),
    pureClassOrNull: entered(draft.schema.pureClassOrNull, 'class'),
    anatomyProfileId: entered(draft.schema.anatomyProfileId, 'anatomy'),
  };
}
function stats(draft: NpcEditorDraft) {
  return {
    S: entered(draft.baseStats.S, 'S'),
    D: entered(draft.baseStats.D, 'D'),
    M: entered(draft.baseStats.M, 'M'),
    C: entered(draft.baseStats.C, 'C'),
    I: entered(draft.baseStats.I, 'I'),
    Z: entered(draft.baseStats.Z, 'Z'),
    W: entered(draft.baseStats.W, 'W'),
  };
}
function supported(draft: NpcEditorDraft, ordinary = false): void {
  if (!ordinary) empty(draft.symbionts, 'symbionts');
  // Inventory is checked independently against its exact preparation/confirmation/publication proof.
  // Disease selection is proved separately against this exact attempt and its reservation origins.
  entered(draft.initialState.traumaInstanceIds, 'traumas');
  entered(draft.initialState.woundInstanceIds, 'wounds');
  empty(draft.initialState.sourceSpecificStateFactIds, 'source-specific state');
  if (entered(draft.initialState.deathConsequenceFactIdOrNull, 'death consequence') !== null)
    fail('unsupported death consequence');
}
function sameMechanics(a: NpcEditorDraft, b: NpcEditorDraft): void {
  for (const key of ['schema', 'baseStats', 'symbionts', 'skills'] as const)
    equal(a[key], b[key], `confirmed ${key}`);
}
/**
 * Production bridge for the supported PURE/initial-START branch. SQL remains in persistence;
 * authority, current cursor and batch GM-mirror verification remain mandatory writer boundaries.
 * This is not a fallback for other compositions, trained skills, items or prepared effects.
 */
export function createNpcOrdinaryDomainReaders(
  db: Database.Database,
  sources: Sources,
  inputEditor: NpcEditorCatalog,
  artCatalog: NpcArtCatalog,
): NpcOrdinaryDomainReaders {
  const editor: NpcEditorCatalog = {
    ...inputEditor,
    traumas: { catalog: sources.initialTrauma, bindings: [] },
  };
  const traumaPreparation = createNpcTraumaPreparation(editor, sources.inventory);
  const woundPreparation = createNpcWoundPreparation(editor, sources.inventory);
  const equipmentCompatibilityPreparation = createNpcEquipmentCompatibilityPreparation(
    editor,
    sources.inventory,
  );
  const itemPreparation = createNpcItemPreparation(editor, sources.inventory);
  const compositeItemPreparation = createNpcCompositeItemPreparation(editor, sources.inventory);
  const customItemPreparation = createNpcCustomItemPreparation(
    editor,
    sources.inventory,
    sources.inventoryPublication,
  );
  const symbiontPreparation = createNpcSymbiontPreparation(editor, sources.inventory);
  const diseasePreparation = createNpcDiseasePreparation(
    editor,
    sources.inventory,
    sources.diseaseEffects,
  );
  function applyArtPreparation(
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ): JsonObject {
    const draft = readNpcEditorDraft(
      npcEditorForItemAttempt(editor, sources.inventory, context),
      previous,
    );
    const kind = s.object(input)['kind'];
    let assetKeyOrNull: string | null;
    if (kind === 'ART_CLEAR') {
      s.object(input, ['kind']);
      assetKeyOrNull = null;
    } else if (kind === 'ART_UPLOAD') {
      const request = s.object(input, ['kind', 'file']);
      assetKeyOrNull = readNpcUploadedArt(request['file']).assetKey;
    } else return fail('unknown art preparation');
    return json({
      ...draft,
      identity: {
        ...draft.identity,
        artAssetKeyOrNull: { kind: 'ENTERED', value: assetKeyOrNull },
      },
    });
  }
  function requireCalendar(
    calendar: NpcCalendarReadContext | null,
    scope?: NpcAttempt['scope'],
  ): NpcCalendarReadContext {
    if (calendar?.format !== 'NPC_CALENDAR_READ_V1')
      return fail('missing checked calendar read context');
    if (scope !== undefined) equal(calendar.scope, scope, 'calendar scope');
    return calendar;
  }
  function selectedEffects(prefix: Pick<NpcDerivationPrefix, 'openAttempt'>): readonly string[] {
    const initial = s.object(prefix.openAttempt.values['initialState']);
    const selected = s.object(initial['effectInstanceIds'], ['kind', 'value']);
    if (selected['kind'] !== 'ENTERED' || !Array.isArray(selected['value']))
      return fail('exact confirmed effect selection required');
    const ids = selected['value'].map((value: unknown) => s.uuid(value));
    if (new Set(ids).size !== ids.length) return fail('duplicate selected effect');
    return ids;
  }
  function selectedDiseaseEffects(prefix: NpcDerivationPrefix): readonly string[] {
    return selectedEffects(prefix).filter(
      (effectInstanceId) =>
        'diseaseId' in
        readNpcEffectAllocationInTransaction(
          db,
          prefix.openAttempt.scope,
          prefix.openAttempt.candidateNpcUuid,
          effectInstanceId,
        ),
    );
  }
  function evidenceClock(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ) {
    requireCalendar(calendar, evidence.target.scope);
    if (evidence.committedOrNull !== null) {
      const operation = evidence.committedOrNull.operation;
      const proof =
        calendar.operations.find((o) => o.operationId === operation.operationId) ??
        fail('missing historical COMMIT calendar proof');
      equal(
        [
          proof.operationSha256,
          proof.beforeCheckpointSha256,
          proof.beforeGmSource,
          proof.kind,
          proof.committedAt,
          proof.versionOrNull,
        ],
        [
          s.sha(s.canonical(operation)),
          s.sha(s.canonical(operation.beforeCheckpoint)),
          operation.beforeGmSource,
          operation.kind,
          operation.committedAt,
          operation.versionOrNull,
        ],
        'historical COMMIT calendar binding',
      );
      return { clock: proof.clock, committedAt: operation.committedAt };
    }
    if (pending === null) return fail('missing actual pending COMMIT evidence');
    equal(
      [
        pending.scope,
        pending.operationId,
        pending.npcUuid,
        pending.npcDraftId,
        pending.version,
        pending.attemptRevision,
        pending.beforeCheckpointSha256,
        pending.beforeGmSource.queuePrefix,
      ],
      [
        evidence.target.scope,
        evidence.target.commitOperationId,
        evidence.target.npcUuid,
        evidence.target.npcDraftId,
        evidence.target.targetVersion,
        evidence.target.openAttemptRevision + 1,
        s.sha(s.canonical(calendar.checkpoint)),
        calendar.currentQueuePrefixOrNull,
      ],
      'actual pending COMMIT calendar binding',
    );
    return { clock: calendar.currentClock, committedAt: pending.committedAt };
  }
  function diseaseContext(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidInitialStateContext {
    const current = evidenceClock(evidence, calendar, pending);
    const origins = selectedDiseaseEffects(evidence.current).map((effectInstanceId) => {
      const reservation = readNpcDiseaseReservationEvidenceInTransaction(
        db,
        evidence.target.scope,
        evidence.target.npcUuid,
        effectInstanceId,
        pending,
      );
      const origin = reservation.origin;
      if (!selectedEffects(origin.current).includes(effectInstanceId))
        return fail('effect was never selected by its reservation draft COMMIT');
      const fact =
        origin.current.diseaseReservations.find((f) => f.effectInstanceId === effectInstanceId) ??
        fail('missing original disease reservation prefix');
      equal(
        [fact.diseaseId, fact.operationId, fact.npcDraftId, fact.attemptRevision, fact.eventSha256],
        [
          reservation.diseaseId,
          reservation.operationId,
          reservation.npcDraftId,
          reservation.attemptRevision,
          reservation.eventSha256,
        ],
        'original disease reservation binding',
      );
      const original = evidenceClock(origin, calendar, pending);
      if (original.clock.campaignTimestampOrNull === null)
        return fail('assigned disease requires confirmed campaign time');
      return {
        effectInstanceId,
        diseaseId: reservation.diseaseId,
        originOperationId: origin.target.commitOperationId,
        targetActorId: evidence.target.npcUuid,
        committedAt: original.committedAt,
        campaignTimestamp: original.clock.campaignTimestampOrNull,
      };
    });
    return {
      npcUuid: evidence.target.npcUuid,
      commitOperationId: evidence.target.commitOperationId,
      campaignTimestampOrNull: current.clock.campaignTimestampOrNull,
      origins,
    };
  }
  function selectedTraumas(prefix: NpcDerivationPrefix): readonly string[] {
    const selected = s.object(
      s.object(prefix.openAttempt.values['initialState'])['traumaInstanceIds'],
      ['kind', 'value'],
    );
    if (selected['kind'] !== 'ENTERED' || !Array.isArray(selected['value']))
      return fail('confirmed trauma selection required');
    const ids = selected['value'].map((v: unknown) => s.uuid(v));
    if (new Set(ids).size !== ids.length) return fail('duplicate selected trauma');
    return ids;
  }
  function traumaRowFromValues(values: JsonObject, id: string) {
    const field = s.object(s.object(values['initialState'])['traumaInputs'], ['kind', 'value']);
    if (field['kind'] !== 'ENTERED' || !Array.isArray(field['value']))
      return fail('confirmed trauma rows required');
    const rows = field['value']
      .map((v: unknown) => readNpcTraumaEditorRow(v))
      .filter((r) => r.traumaInstanceId === id);
    if (rows.length !== 1 || rows[0] === undefined)
      return fail('exact confirmed trauma row required');
    return rows[0];
  }
  function traumaAnchor(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcInitialTraumaCalendarAnchor {
    const { clock } = evidenceClock(evidence, calendar, pending);
    if (clock.campaignTimestampOrNull === null)
      return fail('trauma ACTIVE requires confirmed campaign time');
    if (clock.phase === 'PRE_START')
      return {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: clock.campaignTimestampOrNull,
        lobbySnapshotRevision:
          clock.lobbySnapshotRevisionOrNull ?? fail('missing historical lobby snapshot revision'),
      };
    const beforeGmSource =
      evidence.committedOrNull?.operation.beforeGmSource ??
      pending?.beforeGmSource ??
      fail('missing actual before GM source');
    return {
      kind: 'CURRENT_CAMPAIGN',
      campaignTimestamp: clock.campaignTimestampOrNull,
      stateRevision: beforeGmSource.revisions.stateRevision,
    };
  }
  function traumaState(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ) {
    const current = evidenceClock(evidence, calendar, pending);
    const bindings: NpcInitialTraumaEvidence[] = [],
      facts = selectedTraumas(evidence.current).map((traumaInstanceId) => {
        const reservation = readNpcTraumaReservationEvidenceInTransaction(
          db,
          evidence.target.scope,
          evidence.target.npcUuid,
          traumaInstanceId,
          pending,
        );
        const origin = reservation.origin,
          confirmation =
            origin.current.initialStateConfirmationOrNull ??
            fail('missing original NPC016 confirmation');
        if (!selectedTraumas(origin.current).includes(traumaInstanceId))
          return fail('trauma was not selected by original reservation COMMIT');
        const row = traumaRowFromValues(confirmation.values, traumaInstanceId);
        equal(
          row,
          traumaRowFromValues(origin.current.openAttempt.values, traumaInstanceId),
          'original confirmed trauma input',
        );
        equal(
          row,
          traumaRowFromValues(evidence.current.openAttempt.values, traumaInstanceId),
          'retained trauma input',
        );
        const completed = completeNpcTraumaEditorRow(sources.initialTrauma, row);
        const original = evidenceClock(origin, calendar, pending),
          choice = completed.choice;
        const binding: NpcInitialTraumaEvidence = {
          phase: origin.committedOrNull === null ? 'PENDING_COMMIT' : 'COMMITTED',
          scope: origin.target.scope,
          npcUuid: origin.target.npcUuid,
          origin: {
            commitOperationId: origin.target.commitOperationId,
            sourceOperationId: confirmation.operationId,
            version: origin.target.targetVersion,
            committedAt: original.committedAt,
          },
          trauma: completed.trauma,
          choice,
          calendarAnchorOrNull:
            choice.consequence.kind === 'HEAD' && choice.consequence.stun.status === 'ACTIVE'
              ? traumaAnchor(origin, calendar, pending)
              : null,
        };
        bindings.push(binding);
        if (origin.committedOrNull === null)
          return prepareNpcInitialTraumaFact(sources.initialTrauma, binding);
        const snapshot = s.object(origin.committedOrNull.record['snapshot']),
          proof = s.object(s.object(snapshot['derivation'])['initialTraumaProof']);
        if (!Array.isArray(proof['facts'])) return fail('missing original committed trauma facts');
        const candidates = proof['facts'].filter(
          (v: unknown) => s.object(s.object(v)['trauma'])['traumaInstanceId'] === traumaInstanceId,
        );
        if (candidates.length !== 1) return fail('exact original committed trauma fact required');
        return readNpcInitialTraumaFact(sources.initialTrauma, candidates[0], binding, 'COMMITTED');
      });
    const context: NpcHumanoidTraumaContext = {
      scope: evidence.target.scope,
      npcUuid: evidence.target.npcUuid,
      commitOperationId: evidence.target.commitOperationId,
      campaignTimestampOrNull: current.clock.campaignTimestampOrNull,
      evidence: bindings,
      boundary:
        evidence.committedOrNull === null
          ? {
              kind: 'PENDING_COMMIT',
              commitOperationId: evidence.target.commitOperationId,
              version: evidence.target.targetVersion,
              committedAt: current.committedAt,
            }
          : { kind: 'HISTORICAL' },
    };
    return { context, facts, proof: { commitOperationId: context.commitOperationId, facts } };
  }
  function snapshotDiseaseContext(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidInitialStateContext | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'initialStateProof')) return null;
    const operationId = s.uuid(s.object(derivation['initialStateProof'])['commitOperationId']);
    const npcUuid = s.uuid(snapshot['npcUuid']);
    let target: NpcDerivationTarget;
    if (pending !== null && pending.operationId === operationId) {
      target = {
        scope: pending.scope,
        npcUuid: pending.npcUuid,
        npcDraftId: pending.npcDraftId,
        openAttemptRevision: pending.attemptRevision - 1,
        commitOperationId: operationId,
        targetVersion: pending.version,
      };
    } else {
      const operation =
        calendar.operations.find((o) => o.operationId === operationId) ??
        fail('missing snapshot COMMIT calendar proof');
      const cause = readNpcGmPrimitiveCause(db, calendar.scope, {
        operationId,
        recordSha256: operation.operationSha256,
      });
      if (cause.operation.kind !== 'COMMIT' && cause.operation.kind !== 'COMMIT_V1')
        return fail('snapshot proof is not a COMMIT');
      const version = cause.operation.versionOrNull ?? fail('COMMIT version reference missing');
      target = {
        scope: calendar.scope,
        npcUuid: version.npcUuid,
        npcDraftId: cause.event.ref.npcDraftId,
        openAttemptRevision: cause.event.ref.revision - 1,
        commitOperationId: operationId,
        targetVersion: version.version,
      };
    }
    equal(target.npcUuid, npcUuid, 'snapshot effect owner');
    const evidence = readNpcVersionDerivationEvidenceInTransaction(db, target);
    return diseaseContext(evidence, calendar, pending);
  }
  function snapshotTraumaContext(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidTraumaContext | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'initialTraumaProof')) return null;
    const operationId = s.uuid(s.object(derivation['initialTraumaProof'])['commitOperationId']);
    const npcUuid = s.uuid(snapshot['npcUuid']);
    let target: NpcDerivationTarget;
    if (pending !== null && pending.operationId === operationId) {
      target = {
        scope: pending.scope,
        npcUuid: pending.npcUuid,
        npcDraftId: pending.npcDraftId,
        openAttemptRevision: pending.attemptRevision - 1,
        commitOperationId: operationId,
        targetVersion: pending.version,
      };
    } else {
      const operation =
        calendar.operations.find((o) => o.operationId === operationId) ??
        fail('missing snapshot COMMIT calendar proof');
      const cause = readNpcGmPrimitiveCause(db, calendar.scope, {
        operationId,
        recordSha256: operation.operationSha256,
      });
      if (cause.operation.kind !== 'COMMIT' && cause.operation.kind !== 'COMMIT_V1')
        return fail('snapshot proof is not a COMMIT');
      const version = cause.operation.versionOrNull ?? fail('COMMIT version reference missing');
      target = {
        scope: calendar.scope,
        npcUuid: version.npcUuid,
        npcDraftId: cause.event.ref.npcDraftId,
        openAttemptRevision: cause.event.ref.revision - 1,
        commitOperationId: operationId,
        targetVersion: version.version,
      };
    }
    equal(target.npcUuid, npcUuid, 'snapshot effect owner');
    const evidence = readNpcVersionDerivationEvidenceInTransaction(db, target);
    return traumaState(evidence, calendar, pending).context;
  }
  function selectedWounds(prefix: NpcDerivationPrefix): readonly string[] {
    const section = s.object(
      s.object(prefix.openAttempt.values['initialState'])['woundInstanceIds'],
    );
    if (section['kind'] !== 'ENTERED' || !Array.isArray(section['value']))
      return fail('explicit selected wounds required');
    return section['value'].map((v) => s.uuid(v));
  }
  function woundFactFromReservation(prefix: NpcDerivationPrefix, woundInstanceId: string) {
    const facts = prefix.woundReservations.filter((r) => r.woundInstanceId === woundInstanceId);
    if (facts.length !== 1) return fail('exact wound reservation required');
    const fact = facts[0]!;
    return prepareNpcWoundFact(
      {
        npcUuid: prefix.openAttempt.candidateNpcUuid,
        operationId: fact.operationId,
        woundInstanceId,
        anatomyProfileId: 'STANDARD_HUMANOID',
      },
      fact.input,
    );
  }
  function retainedWoundFact(
    scope: NpcCalendarReadContext['scope'],
    npcUuid: string,
    woundInstanceId: string,
    pending: NpcPendingCommitEvidence | null,
  ) {
    const reservation = readNpcWoundReservationEvidenceInTransaction(
      db,
      scope,
      npcUuid,
      woundInstanceId,
      pending,
    );
    if (!selectedWounds(reservation.origin.current).includes(woundInstanceId))
      return fail('wound absent from original publication selection');
    const fact = woundFactFromReservation(reservation.origin.current, woundInstanceId);
    equal(fact.sourceOperationId, reservation.operationId, 'wound reservation origin');
    return fact;
  }
  function woundState(
    evidence: {
      readonly current: NpcDerivationPrefix;
      readonly target: Pick<NpcDerivationTarget, 'scope' | 'npcUuid'>;
    },
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidWoundContext | null {
    const selected = selectedWounds(evidence.current);
    if (selected.length === 0) return null;
    return {
      npcUuid: evidence.target.npcUuid,
      facts: selected.map((id) =>
        evidence.current.woundReservations.some((r) => r.woundInstanceId === id)
          ? woundFactFromReservation(evidence.current, id)
          : retainedWoundFact(evidence.target.scope, evidence.target.npcUuid, id, pending),
      ),
    };
  }
  function snapshotWoundContext(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidWoundContext | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'initialWoundProof')) return null;
    const proof = s.object(derivation['initialWoundProof'], ['assignments']);
    if (!Array.isArray(proof['assignments'])) return fail('wound proof assignments required');
    const npcUuid = s.uuid(snapshot['npcUuid']);
    const facts = proof['assignments'].map((a) => {
      const row = s.object(a, ['woundInstanceId', 'originOperationId']);
      const fact = retainedWoundFact(
        calendar.scope,
        npcUuid,
        s.uuid(row['woundInstanceId']),
        pending,
      );
      equal(fact.sourceOperationId, s.uuid(row['originOperationId']), 'snapshot wound origin');
      return fact;
    });
    return { npcUuid, facts };
  }
  function equipmentConfirmation(
    scope: NpcAttempt['scope'],
    npcUuid: string,
    operationId: string,
    calendar: NpcCalendarReadContext,
  ) {
    const source = readNpcEquipmentCompatibilityEvidenceInTransaction(
      db,
      scope,
      npcUuid,
      operationId,
    );
    const prior =
      source.evidence.previousOrNull === null
        ? null
        : readSnapshot(source.evidence.previousOrNull.record['snapshot'], calendar);
    const prefix = source.evidence.current;
    const context = contextAt(source.evidence, prefix, calendar, prior);
    return {
      inspected: equipmentCompatibilityPreparation.inspect(prefix.openAttempt.values, context),
      proof: equipmentCompatibilityPreparation.proof(
        prefix.openAttempt.values,
        source.input,
        context,
        operationId,
      ),
    };
  }
  function snapshotEquipmentContext(
    value: unknown,
    calendar: NpcCalendarReadContext,
  ): NpcHumanoidEquipmentContext | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'equipmentProof')) return null;
    const proof = s.object(derivation['equipmentProof'], ['compatibilityProofOrNull'])[
      'compatibilityProofOrNull'
    ];
    if (proof === null) return null;
    const npcUuid = s.uuid(snapshot['npcUuid']),
      confirmation = equipmentConfirmation(
        calendar.scope,
        npcUuid,
        s.uuid(s.object(proof)['confirmationId']),
        calendar,
      );
    equal(confirmation.proof, proof, 'actual physical compatibility confirmation');
    const entries = s.object(derivation['inventoryProof'])['entries'];
    if (!Array.isArray(entries)) return fail('missing exact published loadout');
    equal(
      confirmation.inspected.request,
      entries.map((e) => s.object(e)['request']),
      'physical compatibility loadout',
    );
    return { npcUuid, confirmations: [confirmation.proof] };
  }
  function equipmentForDraft(
    evidence: Pick<
      ReturnType<typeof readNpcCompositionDerivationEvidenceInTransaction>,
      'current' | 'initialOrNull' | 'previousOrNull'
    >,
    draft: NpcEditorDraft,
    calendar: NpcCalendarReadContext,
    previous: ReturnType<typeof readSnapshot> | null,
  ): { proof: NpcHumanoidEquipmentProof; context: NpcHumanoidEquipmentContext } | null {
    return equipmentForDraftWithContext(
      evidence,
      draft,
      calendar,
      previous,
      contextAt(evidence, evidence.current, calendar, previous),
    );
  }
  function equipmentForDraftWithContext(
    evidence: Parameters<typeof equipmentForDraft>[0],
    draft: NpcEditorDraft,
    calendar: NpcCalendarReadContext,
    previous: ReturnType<typeof readSnapshot> | null,
    context: NpcAttemptReadContext,
  ): ReturnType<typeof equipmentForDraft> {
    const prefix = evidence.current;
    const current = equipmentCompatibilityPreparation.inspect(json(draft), context);
    if (!current.request.some((r) => r.equipped)) return null;
    const priorProof =
      previous?.format === 'NPC_HUMANOID_V1'
        ? previous.derivation.equipmentProof?.compatibilityProofOrNull
        : null;
    const candidates = [...prefix.equipmentConfirmations].reverse();
    if (priorProof != null && !candidates.includes(priorProof.confirmationId))
      candidates.push(priorProof.confirmationId);
    for (const operationId of candidates) {
      const confirmation = equipmentConfirmation(
        prefix.openAttempt.scope,
        prefix.openAttempt.candidateNpcUuid,
        operationId,
        calendar,
      );
      if (s.same(confirmation.inspected.request, current.request))
        return {
          proof: { compatibilityProofOrNull: confirmation.proof },
          context: { npcUuid: context.candidateNpcUuid, confirmations: [confirmation.proof] },
        };
    }
    return {
      proof: { compatibilityProofOrNull: null },
      context: { npcUuid: context.candidateNpcUuid, confirmations: [] },
    };
  }
  function inventoryHistoryContext(
    scope: NpcAttempt['scope'],
    npcUuid: string,
    throughVersion: number,
    calendar: NpcCalendarReadContext,
  ): NpcInventoryPublicationContext {
    return inventoryHistoryRead(scope, npcUuid, throughVersion, calendar).context;
  }
  type InventoryHistoryData = Readonly<{
    context: NpcInventoryPublicationContext;
    last: Readonly<{
      record: JsonObject;
      snapshot: ReturnType<typeof readSnapshot>;
      life: NpcHumanoidLifeContext | null;
      poison: SnapshotPoisonRead | null;
    }> | null;
    actual: ReturnType<typeof readNpcInventoryHistoryEvidenceInTransaction>;
  }>;
  type InventoryHistoryRead = InventoryHistoryData &
    Readonly<{
      earlier: CompletedInventoryPrefix | null;
      poisonNodes: readonly PriorLifeInputNode[];
      poisonContext: unknown;
    }>;
  type CompletedInventoryPrefix = Readonly<{
    scopeText: string;
    npcUuid: string;
    footprintText: string;
    calendar: NpcCalendarReadContext;
    guard: ReturnType<typeof capturePriorLifeReadGuard>;
    request: unknown;
    result: InventoryHistoryData;
    earlier: CompletedInventoryPrefix | null;
    nodes: readonly PriorLifeInputNode[];
    poisonNodes: readonly PriorLifeInputNode[];
    poisonContext: unknown;
  }>;
  // Only checked synchronous reads issue completed predecessors. Earlier links retain actual
  // checked frames, never reconstructed subprefixes; only the active synchronous owner exposes them.
  let completedInventoryPrefix: CompletedInventoryPrefix | null = null;
  function inventoryCalendarFootprint(calendar: NpcCalendarReadContext): string {
    return s.canonical({ scope: calendar.scope, operations: calendar.operations });
  }
  function assertCompletedInventoryPrefix(prefix: CompletedInventoryPrefix): void {
    assertPriorLifeReadGuard(prefix.guard, prefix.calendar);
    if (
      priorLifeCallable(NPC_GM_REQUEST_READERS, 'request') !== prefix.request ||
      priorLifeCallable(poisonReaders, 'context') !== prefix.poisonContext
    )
      return s.fail('SOURCE_CHANGED');
    assertPriorLifeInputs(prefix.poisonNodes);
    assertPriorLifeInputs(prefix.nodes);
  }
  function createCompletedInventoryPrefix(
    scope: NpcAttempt['scope'],
    npcUuid: string,
    calendar: NpcCalendarReadContext,
    guard: ReturnType<typeof capturePriorLifeReadGuard>,
    request: unknown,
    history: InventoryHistoryRead,
  ): CompletedInventoryPrefix {
    assertPriorLifeReadGuard(guard, calendar);
    if (priorLifeCallable(NPC_GM_REQUEST_READERS, 'request') !== request)
      return s.fail('SOURCE_CHANGED');
    if (priorLifeCallable(poisonReaders, 'context') !== history.poisonContext)
      return s.fail('SOURCE_CHANGED');
    // Check the pre-decoder witness before issuing a frame; never bless an intervening mutation.
    assertPriorLifeInputs(history.poisonNodes);
    // Guard metadata contains prototype references and stays outside the checked data graph.
    const result: InventoryHistoryData = {
      context: { history: [...history.context.history] },
      last: history.last,
      actual: history.actual,
    };
    const scopeText = s.canonical(scope),
      footprintText = inventoryCalendarFootprint(calendar),
      earlier = history.earlier;
    if (earlier !== null) {
      assertCompletedInventoryPrefix(earlier);
      if (
        earlier.result.actual.length !== history.actual.length - 1 ||
        earlier.npcUuid !== npcUuid ||
        earlier.scopeText !== scopeText ||
        earlier.footprintText !== footprintText ||
        !s.same(earlier.result.actual, history.actual.slice(0, -1))
      )
        return s.fail('SOURCE_CHANGED');
    }
    return {
      scopeText,
      npcUuid,
      footprintText,
      calendar,
      guard,
      request,
      result,
      earlier,
      nodes: captureReadGraph([{ value: result }]),
      poisonNodes: history.poisonNodes,
      poisonContext: history.poisonContext,
    };
  }
  function inventoryHistoryRead(
    scope: NpcAttempt['scope'],
    npcUuid: string,
    throughVersion: number,
    calendar: NpcCalendarReadContext,
  ): InventoryHistoryRead {
    requireCalendar(calendar, scope);
    const active = completedInventoryPrefix;
    if (active !== null) assertCompletedInventoryPrefix(active);
    let candidate = active;
    while (candidate !== null && candidate.result.actual.length > throughVersion)
      candidate = candidate.earlier;
    const inherited = candidate;
    const reuse =
      inherited !== null &&
      inherited.npcUuid === npcUuid &&
      inherited.result.actual.length === throughVersion &&
      inherited.scopeText === s.canonical(scope) &&
      inherited.footprintText === inventoryCalendarFootprint(calendar);
    if (reuse && inherited !== active) assertCompletedInventoryPrefix(inherited);
    const calendarText = reuse ? s.canonical(calendar) : null;
    // Capture before SQL callbacks and the first decode; never refresh a witness after mutation.
    // A standalone one-entry history cannot offer a completed predecessor and needs no owner.
    const guard = !reuse && throughVersion > 1 ? capturePriorLifeReadGuard(calendar) : null;
    const request =
      guard === null ? undefined : priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
    const poisonContext = priorLifeCallable(poisonReaders, 'context');
    const actual = readNpcInventoryHistoryEvidenceInTransaction(db, scope, npcUuid, throughVersion);
    if (reuse) {
      if (active !== null) assertCompletedInventoryPrefix(active);
      if (inherited !== active) assertCompletedInventoryPrefix(inherited);
      if (s.canonical(calendar) !== calendarText) return s.fail('SOURCE_CHANGED');
      equal(actual, inherited.result.actual, 'fresh complete chronological predecessor');
      return {
        context: inherited.result.context,
        last: inherited.result.last,
        actual,
        earlier: inherited.earlier,
        poisonNodes: inherited.poisonNodes,
        poisonContext: inherited.poisonContext,
      };
    }
    const history: NpcInventoryHistoryEntry[] = [];
    let last: InventoryHistoryRead['last'] = null;
    let poisonNodes: readonly PriorLifeInputNode[] = [];
    let earlier: CompletedInventoryPrefix | null = null;
    for (const entry of actual) {
      const rawSnapshot = entry.stored.record['snapshot'];
      const derivation = s.object(s.object(rawSnapshot)['derivation']);
      const needsHistory =
        Object.hasOwn(derivation, 'inventoryProof') &&
        Object.hasOwn(s.object(derivation['inventoryProof']), 'previous');
      const context = needsHistory ? { history: [...history] } : null;
      const prefix: CompletedInventoryPrefix | null =
        guard === null || last === null
          ? null
          : createCompletedInventoryPrefix(scope, npcUuid, calendar, guard, request, {
              context: { history },
              last,
              actual: actual.slice(0, history.length),
              earlier,
              poisonNodes,
              poisonContext,
            });
      const parent = completedInventoryPrefix;
      completedInventoryPrefix = prefix;
      let checked: ReturnType<typeof readSnapshotWithContexts>;
      let publication: NpcInventoryHistoryEntry['publication'];
      try {
        // Saved COMMIT decoders derive their clocks from full operation proofs. Only that
        // committed predecessor is reusable across outer pointers; SET/current/pending work is not.
        checked = readSnapshotWithContexts(rawSnapshot, calendar, null, context, true);
        const snapshot = checked.snapshot;
        publication =
          snapshot.format === 'NPC_HUMANOID_V1'
            ? buildNpcInventoryPublication(
                sources.inventoryPublication,
                snapshot.derivation.inventoryProof,
                context,
                checked.poison?.context.coatingContext ?? null,
              )
            : null;
        if (guard !== null) {
          assertPriorLifeReadGuard(guard, calendar);
          if (priorLifeCallable(NPC_GM_REQUEST_READERS, 'request') !== request)
            return s.fail('SOURCE_CHANGED');
        }
        if (priorLifeCallable(poisonReaders, 'context') !== poisonContext)
          return s.fail('SOURCE_CHANGED');
        assertPriorLifeInputs(checked.poisonNodes ?? []);
        if (prefix !== null) assertCompletedInventoryPrefix(prefix);
      } finally {
        completedInventoryPrefix = parent;
      }
      history.push({
        ...entry.version,
        commitOperationId: entry.stored.operation.operationId,
        publication,
      });
      last = {
        record: entry.stored.record,
        snapshot: checked.snapshot,
        life: checked.life,
        poison: checked.poison,
      };
      poisonNodes = checked.poisonNodes ?? [];
      earlier = prefix;
    }
    return { context: { history }, last, actual, earlier, poisonNodes, poisonContext };
  }
  function bindRestoredInventory(
    attempt: NpcAttempt,
    context: NpcAttemptReadContext,
    requests: readonly NpcInventoryRequestEntry[],
    calendar: NpcCalendarReadContext,
  ): NpcAttemptReadContext {
    const target = attempt.targetOrNull ?? fail('restore requires a committed predecessor');
    const history = inventoryHistoryContext(
      attempt.scope,
      attempt.candidateNpcUuid,
      target.expectedCurrentVersion,
      calendar,
    );
    const first = requests[0] ?? fail('restored item group is empty');
    // Selection/availability was checked by the owning restore operation. This
    // independent history read proves the exact whole group, including removals
    // made while a physical row was absent from an intermediate publication.
    equal(
      requests,
      selectNpcInventoryRestoreRequests(
        sources.inventoryPublication,
        history,
        { npcUuid: attempt.candidateNpcUuid, selectedItemInstanceIds: [] },
        first.itemInstanceId,
      ),
      'actual latest restored group',
    );
    const prefixes = readNpcInventoryHistoryEvidenceInTransaction(
      db,
      attempt.scope,
      attempt.candidateNpcUuid,
      target.expectedCurrentVersion,
    ).map((entry) => entry.stored.prefix);
    const itemBindings = [...context.itemBindings],
      linkedSets = [...(context.linkedSets ?? [])],
      customProfiles = [...(context.customProfiles ?? [])],
      coatingBindings = [...(context.coatingBindings ?? [])];
    for (const request of requests) {
      const origin =
        prefixes
          .flatMap((prefix) => prefix.itemReservations)
          .find((row) => row.itemInstanceId === request.itemInstanceId) ??
        fail('restored item has no original physical reservation');
      const binding = {
        itemInstanceId: origin.itemInstanceId,
        originOperationId: origin.operationId,
        originDraftId: origin.npcDraftId,
        originEventSha256: origin.eventSha256,
      };
      const current = itemBindings.find((row) => row.itemInstanceId === binding.itemInstanceId);
      if (current === undefined) itemBindings.push(binding);
      else equal(current, binding, 'restored physical origin');
      for (const coatingInstanceId of request.coatingInstanceIds) {
        const actual = readNpcCoatingReservationEvidenceInTransaction(
          db,
          attempt.scope,
          attempt.candidateNpcUuid,
          coatingInstanceId,
        );
        const input = actual.request.preparation.input;
        equal(input.targetItemInstanceId, request.itemInstanceId, 'restored coating carrier');
        const saved = poisonReaders.firstPublishedCoating(attempt, coatingInstanceId);
        const archived = history.history.some((entry) =>
          entry.publication?.proof.archivedCoatingPreparations?.some(
            (ref) =>
              ref.coatingInstanceId === coatingInstanceId &&
              ref.preparationOperationId === actual.operationId,
          ),
        );
        if (saved === null && !archived) return fail('restored preparation has no actual archive');
        const coating = {
          coatingInstanceId,
          itemInstanceId: request.itemInstanceId,
          sourceInstanceId: input.sourceInstanceId,
          originOperationId: actual.operationId,
          originDraftId: actual.npcDraftId,
          originEventSha256: actual.eventSha256,
          retainedOriginCommitOperationIdOrNull: saved?.operation.operationId ?? null,
          ...(archived ? { retainedPreparationOperationIdOrNull: actual.operationId } : {}),
        };
        const existing = coatingBindings.find((row) => row.coatingInstanceId === coatingInstanceId);
        if (existing === undefined) coatingBindings.push(coating);
        else {
          const { retainedPreparationOperationIdOrNull: existingArchive, ...existingOrigin } =
            existing;
          const { retainedPreparationOperationIdOrNull: restoredArchive, ...restoredOrigin } =
            coating;
          equal(existingOrigin, restoredOrigin, 'restored coating origin');
          if (existingArchive != null)
            equal(existingArchive, actual.operationId, 'existing archived preparation');
          if (restoredArchive !== undefined && existingArchive == null)
            coatingBindings[coatingBindings.indexOf(existing)] = {
              ...existing,
              retainedPreparationOperationIdOrNull: restoredArchive,
            };
        }
      }
      if (request.linkedSetInstanceId !== null) {
        const set =
          prefixes
            .flatMap((prefix) => prefix.compositeReservations)
            .find((row) => row.binding.linkedSetInstanceId === request.linkedSetInstanceId)
            ?.binding ?? fail('restored linked set has no origin');
        if (
          !set.components.every((part) =>
            requests.some(
              (row) =>
                row.itemInstanceId === part.itemInstanceId &&
                row.componentRole === part.componentRole &&
                row.linkedSetInstanceId === set.linkedSetInstanceId,
            ),
          )
        )
          return fail('restored source pair must be complete');
        const existing = linkedSets.find(
          (row) => row.linkedSetInstanceId === set.linkedSetInstanceId,
        );
        if (existing === undefined) linkedSets.push(set);
        else equal(existing, set, 'restored source pair');
      }
      const custom =
        request.itemTypeId === null
          ? {
              reference: request.itemTypeReference,
              profile: request.profile,
              reason: request.customProfileReason,
            }
          : request.customModifier;
      if (custom !== undefined) {
        const actual = readNpcCustomProfileReservationEvidenceInTransaction(
          db,
          attempt.scope,
          attempt.candidateNpcUuid,
          custom.reference.profileVersionId,
        );
        equal(
          [actual.binding.itemInstanceId, actual.binding.reference],
          [request.itemInstanceId, custom.reference],
          'restored custom identity',
        );
        const known = {
          itemInstanceId: request.itemInstanceId,
          reference: custom.reference,
          confirmedContentOrNull: history.history.some((entry) =>
            entry.publication?.items.some((item) =>
              item.customProfileVersions?.some(
                (version) => version.profileVersionId === custom.reference.profileVersionId,
              ),
            ),
          )
            ? { profile: custom.profile, reason: custom.reason }
            : null,
        };
        const existing = customProfiles.find(
          (row) => row.reference.profileVersionId === custom.reference.profileVersionId,
        );
        if (existing === undefined) customProfiles.push(known);
        else equal(existing, known, 'restored immutable custom content');
      }
    }
    return {
      ...context,
      itemBindings,
      ...(linkedSets.length === 0 ? {} : { linkedSets }),
      ...(customProfiles.length === 0 ? {} : { customProfiles }),
      ...(coatingBindings.length === 0 ? {} : { coatingBindings }),
    };
  }
  const itemRestorePreparation = createNpcItemRestorePreparation({
    editor,
    inventory: sources.inventory,
    publication: sources.inventoryPublication,
    history(attempt, calendar) {
      return inventoryHistoryContext(
        attempt.scope,
        attempt.candidateNpcUuid,
        attempt.targetOrNull?.expectedCurrentVersion ?? fail('restore requires a prior version'),
        calendar,
      );
    },
    bind: bindRestoredInventory,
  });
  function snapshotInventoryPrefix(
    value: unknown,
    calendar: NpcCalendarReadContext,
  ): CompletedInventoryPrefix | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    const proof = s.object(derivation['inventoryProof']);
    if (!Object.hasOwn(proof, 'previous')) return null;
    const previous = s.object(proof['previous'], [
      'npcUuid',
      'version',
      'sha256',
      'commitOperationId',
    ]);
    const npcUuid = s.uuid(snapshot['npcUuid']);
    equal(previous['npcUuid'], npcUuid, 'inventory prior NPC identity');
    const guard = capturePriorLifeReadGuard(calendar);
    const request = priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
    const history = inventoryHistoryRead(
      calendar.scope,
      npcUuid,
      s.integer(previous['version']),
      calendar,
    );
    const last = history.context.history.at(-1) ?? fail('missing actual inventory predecessor');
    equal(
      previous,
      {
        npcUuid: last.npcUuid,
        version: last.version,
        sha256: last.sha256,
        commitOperationId: last.commitOperationId,
      },
      'actual previous inventory version',
    );
    return createCompletedInventoryPrefix(
      calendar.scope,
      npcUuid,
      calendar,
      guard,
      request,
      history,
    );
  }
  function readSnapshot(
    value: unknown,
    calendar: NpcCalendarReadContext | null,
    pending: NpcPendingCommitEvidence | null = null,
    inventoryContext: NpcInventoryPublicationContext | null | undefined = undefined,
  ): NpcCleanHumanoidSnapshot | NpcHumanoidSnapshot {
    return readSnapshotWithContexts(value, calendar, pending, inventoryContext).snapshot;
  }
  function readSnapshotWithContexts(
    value: unknown,
    calendar: NpcCalendarReadContext | null,
    pending: NpcPendingCommitEvidence | null = null,
    inventoryContext: NpcInventoryPublicationContext | null | undefined = undefined,
    captureSavedPoison = false,
  ): Readonly<{
    snapshot: NpcCleanHumanoidSnapshot | NpcHumanoidSnapshot;
    poison: ReturnType<typeof snapshotPoisonState>;
    life: NpcHumanoidLifeContext | null;
    poisonNodes?: readonly PriorLifeInputNode[];
  }> {
    const checkedCalendar = requireCalendar(calendar);
    if (pending !== null) {
      equal(pending.scope, checkedCalendar.scope, 'pending calendar scope');
      equal(
        [s.object(value)['npcUuid'], s.object(value)['owningControllerId']],
        [pending.npcUuid, pending.scope.gmLocalContextId],
        'pending snapshot identity',
      );
    }
    const format = s.object(value)['format'];
    if (format === 'NPC_CLEAN_HUMANOID_V1')
      return {
        snapshot: readNpcCleanHumanoidSnapshot(sources.cleanHumanoid, value),
        poison: null,
        life: null,
      };
    if (format === 'NPC_HUMANOID_V1') {
      const catalog = sources.humanoid;
      const disease = snapshotDiseaseContext(value, checkedCalendar, pending);
      const trauma = snapshotTraumaContext(value, checkedCalendar, pending);
      const equipment = snapshotEquipmentContext(value, checkedCalendar);
      const wounds = snapshotWoundContext(value, checkedCalendar, pending);
      const runtime = snapshotRuntimeContext(value, checkedCalendar, pending);
      const prefix =
        inventoryContext === undefined ? snapshotInventoryPrefix(value, checkedCalendar) : null;
      const inventory =
        inventoryContext === undefined ? (prefix?.result.context ?? null) : inventoryContext;
      const parent = completedInventoryPrefix;
      if (prefix !== null) completedInventoryPrefix = prefix;
      try {
        // Only the actual committed predecessor is shared. These current/pending contexts
        // keep their own calendar and evidence, after all earlier contexts in the original order.
        const life = snapshotLifeContext(value, checkedCalendar, pending);
        const poison = snapshotPoisonState(value, checkedCalendar, pending);
        const poisonNodes =
          captureSavedPoison && poison !== null ? captureReadGraph([{ value: poison }]) : undefined;
        const snapshot = readNpcHumanoidSnapshot(
          catalog,
          value,
          disease,
          trauma,
          equipment,
          wounds,
          runtime,
          inventory,
          life,
          poison?.context ?? null,
        );
        if (prefix !== null) assertCompletedInventoryPrefix(prefix);
        if (poisonNodes !== undefined) assertPriorLifeInputs(poisonNodes);
        // Keep this checked context only beside its decoded snapshot for the same history entry.
        return { snapshot, poison, life, ...(poisonNodes === undefined ? {} : { poisonNodes }) };
      } finally {
        completedInventoryPrefix = parent;
      }
    }
    return fail('unknown complete NPC snapshot format');
  }
  function contextAt(
    evidence: Pick<NpcVersionDerivationEvidence, 'initialOrNull' | 'previousOrNull'>,
    prefix: ReturnType<typeof readNpcCompositionDerivationEvidenceInTransaction>['current'],
    calendar: NpcCalendarReadContext,
    inheritedSnapshotOrNull: ReturnType<typeof readSnapshot> | null,
    revision = prefix.openAttempt.revision,
    operationId = prefix.openOperationId,
  ): NpcAttemptReadContext {
    const a = prefix.openAttempt;
    requireCalendar(calendar, a.scope);
    if (a.targetOrNull === null && inheritedSnapshotOrNull !== null)
      return fail('unexpected checked inherited snapshot');
    const rows = prefix.itemReservations.filter((r) => r.attemptRevision <= revision);
    const coatingBindings: NonNullable<NpcAttemptReadContext['coatingBindings']>[number][] =
      prefix.poisonOperations
        .filter((row) => row.event.attempt.revision <= revision)
        .flatMap((row) =>
          'format' in row.event
            ? row.event.childAllocations.flatMap((child) =>
                child.kind !== 'COATING_INSTANCE'
                  ? []
                  : [
                      {
                        coatingInstanceId: child.id,
                        itemInstanceId: child.itemInstanceId,
                        sourceInstanceId: child.sourceInstanceId,
                        originOperationId: row.operation.operationId,
                        originDraftId: row.event.attempt.npcDraftId,
                        originEventSha256: s.sha(s.canonical(row.event)),
                        retainedOriginCommitOperationIdOrNull: null,
                      },
                    ],
              )
            : [],
        );
    const linkedSets = prefix.compositeReservations
      .filter((r) => r.attemptRevision <= revision)
      .map((r) => r.binding);
    const customProfiles: NonNullable<NpcPublishedChildGraph['customProfiles']>[number][] =
      prefix.customProfileReservations
        .filter((row) => row.attemptRevision <= revision)
        .map((row) => {
          const actual = readNpcCustomProfileReservationEvidenceInTransaction(
            db,
            a.scope,
            a.candidateNpcUuid,
            row.profileVersionId,
          );
          equal(
            [actual.operationId, actual.npcDraftId, actual.attemptRevision, actual.eventSha256],
            [row.operationId, row.npcDraftId, row.attemptRevision, row.eventSha256],
            'actual custom profile reservation',
          );
          return actual.binding;
        });
    for (const binding of inheritedSnapshotOrNull === null
      ? []
      : snapshotCustomProfiles(inheritedSnapshotOrNull)) {
      if (
        !customProfiles.some(
          (row) => row.reference.profileVersionId === binding.reference.profileVersionId,
        )
      )
        customProfiles.push(binding);
    }
    const bindings = rows.map((r) => ({
      itemInstanceId: r.itemInstanceId,
      originOperationId: r.operationId,
      originDraftId: r.npcDraftId,
      originEventSha256: r.eventSha256,
    }));
    const effectBindings = prefix.diseaseReservations
      .filter((r) => r.attemptRevision <= revision)
      .map((r) => ({
        effectInstanceId: r.effectInstanceId,
        diseaseId: r.diseaseId,
        originOperationId: r.operationId,
        originDraftId: r.npcDraftId,
        originEventSha256: r.eventSha256,
      }));
    const runtimeEffectBindings: NonNullable<
      NpcAttemptReadContext['runtimeEffectBindings']
    >[number][] = prefix.runtimeEffectReservations
      .filter((row) => row.attemptRevision <= revision)
      .map((row) => ({
        effectInstanceId: row.effectInstanceId,
        ...(row.sourceKind === 'ALCOHOL' || row.sourceKind === 'LIFE_TIMER'
          ? { sourceKind: row.sourceKind }
          : row.sourceKind === 'POISON_MODE'
            ? { sourceKind: 'POISON_MODE' as const, sourceInstanceId: row.sourceInstanceId }
            : row.sourceKind === 'WEAVER_STATE'
              ? {
                  sourceKind: 'WEAVER_STATE' as const,
                  branch: row.branch,
                  sourceInstanceId: row.sourceInstanceId,
                }
              : row.sourceKind === 'FORMAL_CONTROL'
                ? { sourceKind: 'FORMAL_CONTROL' as const, controlKind: row.controlKind }
                : {
                    sourceKind: 'HP_MODE' as const,
                    mode: row.mode,
                    sourceInstanceId: row.sourceInstanceId,
                  }),
        originOperationId: row.operationId,
        originDraftId: row.npcDraftId,
        originEventSha256: row.eventSha256,
      }));
    const traumaBindings: Array<NpcAttemptReadContext['traumaBindings'][number]> =
      prefix.traumaReservations
        .filter((r) => r.attemptRevision <= revision)
        .map((r) => ({
          traumaInstanceId: r.traumaInstanceId,
          originOperationId: r.operationId,
          originDraftId: r.npcDraftId,
          originEventSha256: r.eventSha256,
          retainedRowOrNull: null,
        }));
    const symbiontBindings: Array<NpcAttemptReadContext['symbiontBindings'][number]> =
      prefix.symbiontReservations
        .filter((r) => r.attemptRevision <= revision)
        .map((r) => ({
          symbiontInstanceId: r.symbiontInstanceId,
          originOperationId: r.operationId,
          originDraftId: r.npcDraftId,
          originEventSha256: r.eventSha256,
          retainedSpeciesKeyOrNull: null,
        }));
    const woundBindings: Array<NpcAttemptReadContext['woundBindings'][number]> =
      prefix.woundReservations
        .filter((r) => r.attemptRevision <= revision)
        .map((r) => ({
          woundInstanceId: r.woundInstanceId,
          originOperationId: r.operationId,
          originDraftId: r.npcDraftId,
          originEventSha256: r.eventSha256,
        }));
    let inheritedVersionOrNull: NpcAttemptReadContext['inheritedVersionOrNull'] = null;
    if (a.targetOrNull !== null) {
      const previous = evidence.previousOrNull ?? fail('missing exact inherited inventory version');
      equal(
        [previous.record['npcUuid'], previous.record['version']],
        [a.targetOrNull.npcUuid, a.targetOrNull.expectedCurrentVersion],
        'inherited version',
      );
      const prior = inheritedSnapshotOrNull ?? fail('missing checked inherited snapshot');
      const priorGraph = snapshotChildGraph(prior, calendar);
      for (const coating of priorGraph.coatings ?? []) {
        const actual = readNpcCoatingReservationEvidenceInTransaction(
          db,
          a.scope,
          a.candidateNpcUuid,
          coating.coatingInstanceId,
        );
        coatingBindings.push({
          coatingInstanceId: coating.coatingInstanceId,
          itemInstanceId: coating.itemInstanceId,
          sourceInstanceId: coating.sourceInstanceId,
          originOperationId: actual.operationId,
          originDraftId: actual.npcDraftId,
          originEventSha256: actual.eventSha256,
          retainedOriginCommitOperationIdOrNull: coating.originCommitOperationId,
        });
      }
      for (const archived of priorGraph.archivedCoatingPreparations ?? []) {
        const actual = readNpcCoatingReservationEvidenceInTransaction(
          db,
          a.scope,
          a.candidateNpcUuid,
          archived.coatingInstanceId,
        );
        equal(archived.preparationOperationId, actual.operationId, 'archived preparation origin');
        coatingBindings.push({
          coatingInstanceId: archived.coatingInstanceId,
          itemInstanceId: archived.itemInstanceId,
          sourceInstanceId: archived.sourceInstanceId,
          originOperationId: actual.operationId,
          originDraftId: actual.npcDraftId,
          originEventSha256: actual.eventSha256,
          retainedOriginCommitOperationIdOrNull: archived.publishedOriginCommitOperationIdOrNull,
          retainedPreparationOperationIdOrNull: archived.preparationOperationId,
        });
      }
      for (const mode of (priorGraph.runtimeEffects ?? []).filter(
        (row) => row.sourceKind === 'POISON_MODE',
      )) {
        if (mode.sourceKind !== 'POISON_MODE') return fail('mode source discriminator');
        const actual = readNpcRuntimeEffectReservationEvidenceInTransaction(
          db,
          a.scope,
          a.candidateNpcUuid,
          mode.effectInstanceId,
        );
        if (!runtimeEffectBindings.some((row) => row.effectInstanceId === mode.effectInstanceId))
          runtimeEffectBindings.push({
            sourceKind: 'POISON_MODE',
            sourceInstanceId: mode.sourceInstanceId,
            effectInstanceId: mode.effectInstanceId,
            originOperationId: actual.operationId,
            originDraftId: actual.npcDraftId,
            originEventSha256: actual.eventSha256,
          });
      }
      // This private value belongs to the exact previous version in this invocation, not merely its NPC.
      equal(json(prior), previous.record['snapshot'], 'checked inherited snapshot');
      inheritedVersionOrNull = {
        npcUuid: a.targetOrNull.npcUuid,
        version: a.targetOrNull.expectedCurrentVersion,
        sha256: s.sha(s.canonical(previous.record)),
      };
      const priorPrefixes = readNpcInventoryHistoryEvidenceInTransaction(
        db,
        a.scope,
        a.candidateNpcUuid,
        a.targetOrNull.expectedCurrentVersion,
      ).map((entry) => entry.stored.prefix);
      for (const set of priorPrefixes.flatMap((p) =>
        p.compositeReservations.map((r) => r.binding),
      )) {
        if (
          prior.sheet.input.inventory.some(
            (item) => item.linkedSetInstanceId === set.linkedSetInstanceId,
          ) &&
          !linkedSets.some((current) => current.linkedSetInstanceId === set.linkedSetInstanceId)
        )
          linkedSets.push(set);
      }
      for (const item of prior.sheet.itemProfiles) {
        const fact =
          priorPrefixes
            .flatMap((p) => p.itemReservations)
            .find((r) => r.itemInstanceId === item.item.itemInstanceId) ??
          fail('physical item absent from original reservation prefix');
        if (!bindings.some((r) => r.itemInstanceId === fact.itemInstanceId))
          bindings.push({
            itemInstanceId: fact.itemInstanceId,
            originOperationId: fact.operationId,
            originDraftId: fact.npcDraftId,
            originEventSha256: fact.eventSha256,
          });
      }
      if (prior.format === 'NPC_HUMANOID_V1')
        for (const trauma of prior.derivation.initialTraumaProof?.facts ?? []) {
          const fact = readNpcTraumaReservationEvidenceInTransaction(
            db,
            a.scope,
            a.candidateNpcUuid,
            trauma.trauma.traumaInstanceId,
          );
          if (!traumaBindings.some((b) => b.traumaInstanceId === fact.traumaInstanceId))
            traumaBindings.push({
              traumaInstanceId: fact.traumaInstanceId,
              originOperationId: fact.operationId,
              originDraftId: fact.npcDraftId,
              originEventSha256: fact.eventSha256,
              retainedRowOrNull: npcTraumaEditorRowFromFact(trauma),
            });
        }
      for (const symbiont of prior.sheet.symbionts) {
        const fact = readNpcSymbiontReservationEvidenceInTransaction(
          db,
          a.scope,
          a.candidateNpcUuid,
          symbiont.symbiontInstanceId,
        );
        if (!symbiontBindings.some((b) => b.symbiontInstanceId === fact.symbiontInstanceId))
          symbiontBindings.push({
            symbiontInstanceId: fact.symbiontInstanceId,
            originOperationId: fact.operationId,
            originDraftId: fact.npcDraftId,
            originEventSha256: fact.eventSha256,
            retainedSpeciesKeyOrNull: symbiont.speciesKey,
          });
      }
      for (const wound of prior.sheet.input.initialState.currentWounds) {
        const fact = readNpcWoundReservationEvidenceInTransaction(
          db,
          a.scope,
          a.candidateNpcUuid,
          wound.woundInstanceId,
        );
        if (!woundBindings.some((b) => b.woundInstanceId === fact.woundInstanceId))
          woundBindings.push({
            woundInstanceId: fact.woundInstanceId,
            originOperationId: fact.operationId,
            originDraftId: fact.npcDraftId,
            originEventSha256: fact.eventSha256,
          });
      }
      for (const effect of prior.sheet.input.initialState.effectInstances) {
        if (effect.effectTypeId !== 'EFF-DISEASE-INSTANCE') {
          const fact = readNpcRuntimeEffectReservationEvidenceInTransaction(
            db,
            a.scope,
            a.candidateNpcUuid,
            effect.effectInstanceId,
          );
          if (!runtimeEffectBindings.some((row) => row.effectInstanceId === fact.effectInstanceId))
            runtimeEffectBindings.push({
              effectInstanceId: fact.effectInstanceId,
              ...(fact.sourceKind === 'ALCOHOL' || fact.sourceKind === 'LIFE_TIMER'
                ? { sourceKind: fact.sourceKind }
                : fact.sourceKind === 'POISON_MODE'
                  ? { sourceKind: 'POISON_MODE' as const, sourceInstanceId: fact.sourceInstanceId }
                  : fact.sourceKind === 'WEAVER_STATE'
                    ? {
                        sourceKind: 'WEAVER_STATE' as const,
                        branch: fact.branch,
                        sourceInstanceId: fact.sourceInstanceId,
                      }
                    : fact.sourceKind === 'FORMAL_CONTROL'
                      ? { sourceKind: 'FORMAL_CONTROL' as const, controlKind: fact.controlKind }
                      : {
                          sourceKind: 'HP_MODE' as const,
                          mode: fact.mode,
                          sourceInstanceId: fact.sourceInstanceId,
                        }),
              originOperationId: fact.operationId,
              originDraftId: fact.npcDraftId,
              originEventSha256: fact.eventSha256,
            });
          continue;
        }
        const fact = readNpcDiseaseReservationEvidenceInTransaction(
          db,
          a.scope,
          a.candidateNpcUuid,
          effect.effectInstanceId,
        );
        if (!effectBindings.some((r) => r.effectInstanceId === fact.effectInstanceId))
          effectBindings.push({
            effectInstanceId: fact.effectInstanceId,
            diseaseId: fact.diseaseId,
            originOperationId: fact.operationId,
            originDraftId: fact.npcDraftId,
            originEventSha256: fact.eventSha256,
          });
      }
    }
    let result: NpcAttemptReadContext = {
      scope: a.scope,
      npcDraftId: a.npcDraftId,
      candidateNpcUuid: a.candidateNpcUuid,
      revision,
      operationId,
      inheritedVersionOrNull,
      itemBindings: bindings,
      pendingItemOrNull: null,
      effectBindings,
      ...(runtimeEffectBindings.length === 0 ? {} : { runtimeEffectBindings }),
      ...(coatingBindings.length === 0 ? {} : { coatingBindings }),
      ...(linkedSets.length === 0 ? {} : { linkedSets }),
      ...(customProfiles.length === 0 ? {} : { customProfiles }),
      pendingEffectOrNull: null,
      traumaBindings,
      pendingTraumaOrNull: null,
      symbiontBindings,
      pendingSymbiontOrNull: null,
      woundBindings,
      pendingWoundOrNull: null,
    };
    for (const restored of prefix.itemRestorations.filter(
      (row) => row.event.attempt.revision <= revision,
    )) {
      const request = npcTechnicalRequestValue(restored.operation.request);
      if (
        request.messageType !== 'network.npc-preparation.request' ||
        request.preparation.kind !== 'ITEM_RESTORE'
      )
        return fail('actual restore operation required');
      const before = contextAt(
        evidence,
        prefix,
        calendar,
        inheritedSnapshotOrNull,
        restored.previous.revision,
        restored.previousOperationId,
      );
      const scoped = npcEditorForItemAttempt(editor, sources.inventory, before);
      const draft = applyNpcStageInput(
        scoped,
        restored.previous.values,
        'NPC-015',
        request.preparation.values,
      );
      const guard = capturePriorLifeReadGuard(calendar);
      const requestReader = priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
      const history = inventoryHistoryRead(
        a.scope,
        a.candidateNpcUuid,
        a.targetOrNull?.expectedCurrentVersion ?? fail('restore has no previous version'),
        calendar,
      );
      const completed = createCompletedInventoryPrefix(
        a.scope,
        a.candidateNpcUuid,
        calendar,
        guard,
        requestReader,
        history,
      );
      const parent = completedInventoryPrefix;
      completedInventoryPrefix = completed;
      try {
        // Selection and the internal binder consume this same completed history. The binder
        // still reads fresh SQL and verifies the whole restored group and every origin.
        const selected = selectNpcInventoryRestoreRequests(
          sources.inventoryPublication,
          completed.result.context,
          {
            npcUuid: a.candidateNpcUuid,
            selectedItemInstanceIds:
              draft.inventory.kind === 'ENTERED'
                ? draft.inventory.value.map((row) => row.itemInstanceId)
                : [],
          },
          request.preparation.itemInstanceId,
        );
        result = bindRestoredInventory(a, result, selected, calendar);
        assertCompletedInventoryPrefix(completed);
      } finally {
        completedInventoryPrefix = parent;
      }
    }
    return result;
  }
  function editorAt(
    evidence: Pick<NpcVersionDerivationEvidence, 'initialOrNull' | 'previousOrNull'>,
    prefix: ReturnType<typeof readNpcCompositionDerivationEvidenceInTransaction>['current'],
    calendar: NpcCalendarReadContext,
    inheritedSnapshotOrNull: ReturnType<typeof readSnapshot> | null,
    revision = prefix.openAttempt.revision,
    operationId = prefix.openOperationId,
  ): NpcEditorCatalog {
    return npcEditorForItemAttempt(
      editor,
      sources.inventory,
      contextAt(evidence, prefix, calendar, inheritedSnapshotOrNull, revision, operationId),
    );
  }
  function compositionBase(
    snapshot: ReturnType<typeof readSnapshot> | null,
  ): NpcCompositionAuthoringBase | null {
    if (snapshot === null) return null;
    if (snapshot.format === 'NPC_HUMANOID_V1' && snapshot.derivation.ordinaryProof !== undefined)
      return {
        compositionProof: snapshot.derivation.compositionProof,
        ordinaryProof: snapshot.derivation.ordinaryProof,
        skillProofOrNull: snapshot.derivation.skillProof,
      };
    const input = snapshot.sheet.input,
      initial =
        snapshot.derivation.skillProof.contexts[0] ?? fail('missing original skill context');
    // A legacy clean version has a real confirmed NPC014 context. It is retained as a
    // stat proof when that saved version first enters ordinary composition authoring.
    const ordinaryProof = {
      currentStatContextFactId: initial.contextFactId,
      statContexts: [
        {
          contextFactId: initial.contextFactId,
          schema: {
            raceCode: input.identity.raceCode,
            pureClassOrNull: input.identity.pureClassOrNull,
            anatomyProfileId: input.identity.anatomyProfileId,
            sex: input.identity.sex,
            massKg: input.identity.massKg,
          },
          baseStats: input.baseStats,
          compositionOrdinal: 0,
          resolutionOrdinal: 0,
        },
      ],
    };
    const checked = deriveNpcOrdinaryStatProfile(sources.ordinaryHumanoid, {
      npcUuid: snapshot.npcUuid,
      compositionProof: snapshot.derivation.compositionProof,
      ordinaryProof,
    });
    return {
      compositionProof: checked.compositionProof,
      ordinaryProof: checked.ordinaryProof,
      skillProofOrNull: snapshot.derivation.skillProof,
    };
  }
  function compositionState(
    attempt: NpcAttempt,
    context: NpcAttemptReadContext,
    calendar: NpcCalendarReadContext,
  ): NpcCompositionAuthoringState {
    requireCalendar(calendar, attempt.scope);
    const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, attempt);
    const previousHistory =
      evidence.previousOrNull === null
        ? null
        : inventoryHistoryRead(
            attempt.scope,
            attempt.candidateNpcUuid,
            s.integer(evidence.previousOrNull.record['version']),
            calendar,
          );
    const previousEntry = previousHistory?.last ?? null;
    if (evidence.previousOrNull !== null) {
      if (previousEntry === null) return fail('missing checked composition predecessor');
      equal(
        previousEntry.record,
        evidence.previousOrNull.record,
        'composition history predecessor',
      );
    }
    const previous = previousEntry?.snapshot ?? null;
    // Reuse only the exact completed predecessor through the fresh SQL history reader.
    // The current composition still uses its own independently checked attempt and context.
    return readNpcCompositionAuthoring(
      sources,
      editor,
      evidence,
      context,
      compositionBase(previous),
    );
  }
  const compositionPreparation: NpcOrdinaryDomainReaders['compositionPreparation'] = {
    read: compositionState,
    candidate(state) {
      return previewNpcCompositionCandidate(sources, editor, state);
    },
    forward(state) {
      assertNpcCompositionConfirmed(sources, editor, state);
    },
    prepare(request, context, sample) {
      const previous =
        context.previousOrNull?.attempt ??
        fail('composition preparation requires previous attempt');
      const state = compositionState(
        previous,
        context.previousReadContextOrNull ?? fail('missing preparation context'),
        requireCalendar(context.calendarContext, previous.scope),
      );
      if (request.preparation.kind === 'COMPOSITION_CONFIRM')
        return prepareNpcCompositionConfirmation(
          sources,
          editor,
          state,
          request,
          context.checkpoint,
        );
      if (request.preparation.kind === 'COMPOSITION_RESOLVE')
        return prepareNpcCompositionResolution(sources, state, request, sample);
      return fail('composition preparation kind required');
    },
    apply(operation, event, previous, context, calendar) {
      equal(
        [operation.operationId, event.operationId, event.attempt.revision],
        [event.operationId, event.operationId, previous.attempt.revision + 1],
        'composition historical transition',
      );
      const state = compositionState(
        event.attempt,
        { ...context, revision: event.attempt.revision, operationId: operation.operationId },
        calendar,
      );
      const last =
        state.evidence.current.ordinaryFacts.at(-1) ?? fail('missing actual composition fact');
      equal(last.event, event, 'exact composition event');
      return json(state.draft);
    },
  };
  /** Source/physical preparation must be readable before NPC015 creates its confirmation. */
  function initialStateSourceBasis(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, attempt);
    const guard = evidence.previousOrNull === null ? null : capturePriorLifeReadGuard(calendar);
    const requestReader =
      guard === null ? undefined : priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
    const priorHistory =
      evidence.previousOrNull === null
        ? null
        : inventoryHistoryRead(
            attempt.scope,
            attempt.candidateNpcUuid,
            s.integer(evidence.previousOrNull.record['version']),
            calendar,
          );
    const prior = priorHistory?.last ?? null;
    if (evidence.previousOrNull !== null) {
      if (prior === null) return fail('missing checked source inventory predecessor');
      // The chronology walk checked this exact saved record with its complete prior inventory.
      // Keep the independently read composition predecessor as the authoritative equality anchor.
      equal(prior.record, evidence.previousOrNull.record, 'source inventory predecessor');
    }
    const previous = prior?.snapshot ?? null;
    const completed =
      guard === null || priorHistory === null
        ? null
        : createCompletedInventoryPrefix(
            attempt.scope,
            attempt.candidateNpcUuid,
            calendar,
            guard,
            requestReader,
            priorHistory,
          );
    const parent = completedInventoryPrefix;
    if (completed !== null) completedInventoryPrefix = completed;
    let context: NpcAttemptReadContext;
    try {
      // The inherited child graph consumes this exact checked predecessor; current and
      // historical editor reads outside contextAt keep their independent validation.
      context = contextAt(evidence, evidence.current, calendar, previous);
      if (completed !== null) assertCompletedInventoryPrefix(completed);
    } finally {
      completedInventoryPrefix = parent;
    }
    const scoped = npcEditorForItemAttempt(editor, sources.inventory, context);
    const draft = readNpcEditorDraft(scoped, attempt.values);
    const confirmation =
      evidence.current.skillConfirmation ??
      fail('runtime effect requires actual NPC014 confirmation');
    let confirmationEditor: NpcEditorCatalog;
    if (completed !== null) assertCompletedInventoryPrefix(completed);
    const confirmationParent = completedInventoryPrefix;
    if (completed !== null) completedInventoryPrefix = completed;
    try {
      // The confirmation has an earlier current revision, but its saved predecessor is the
      // same checked snapshot. Keep editorAt and its fresh SQL; share only that saved graph.
      confirmationEditor = editorAt(
        evidence,
        evidence.current,
        calendar,
        previous,
        confirmation.attemptRevision,
        confirmation.operationId,
      );
      if (completed !== null) assertCompletedInventoryPrefix(completed);
    } finally {
      completedInventoryPrefix = confirmationParent;
    }
    const confirmed = readNpcEditorDraft(confirmationEditor, confirmation.values);
    sameMechanics(draft, confirmed);
    // This invocation already checked the exact attempt prefix and its committed predecessor.
    // Replay composition with those inputs; standalone composition readers retain their own reads.
    const ordinaryState =
      evidence.current.ordinaryFacts.length !== 0 ||
      (previous?.format === 'NPC_HUMANOID_V1' && previous.derivation.ordinaryProof !== undefined)
        ? readNpcCompositionAuthoring(sources, editor, evidence, context, compositionBase(previous))
        : null;
    const ordinary =
      ordinaryState === null
        ? null
        : npcCompositionConfirmedStats(sources, ordinaryState, confirmed, confirmation.operationId);
    const schema = {
      raceCode: entered(draft.schema.raceCode, 'race'),
      pureClassOrNull: entered(draft.schema.pureClassOrNull, 'class'),
      anatomyProfileId: entered(draft.schema.anatomyProfileId, 'anatomy'),
      sex: entered(draft.identity.sex, 'sex'),
      massKg: entered(draft.identity.massKg, 'mass'),
    };
    const composition =
      ordinary?.current.composition ??
      evaluateNpcCompositionConsequences(
        sources.compositionConsequences,
        {
          identityKey: attempt.candidateNpcUuid,
          binding: {
            journalId: (evidence.initialOrNull?.prefix ?? evidence.current).rootOperationId,
            raceCode: schema.raceCode,
          },
          confirmations: [],
          resolutions: [],
        },
        null,
      );
    const input = {
      npcUuid: attempt.candidateNpcUuid,
      schema,
      baseStats: stats(draft),
      compositionProof: composition.proof,
      inventoryRequests: projectNpcInventoryRequest(scoped, draft.inventory),
    };
    const inventoryContext = priorHistory?.context ?? null;
    return {
      evidence,
      previous,
      context,
      scoped,
      draft,
      ordinaryState,
      ordinary,
      input,
      inventoryContext,
      priorHistory,
      completedPrefix: completed,
    };
  }
  function effectInputBasis(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    return effectInputBasisFromSource(
      attempt,
      calendar,
      initialStateSourceBasis(attempt, calendar),
    );
  }
  function effectInputBasisFromSource(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    source: ReturnType<typeof initialStateSourceBasis>,
  ) {
    const { evidence, previous, context, scoped, draft, inventoryContext } = source;
    const ordinary =
      source.ordinaryState === null || source.ordinary === null
        ? null
        : npcCompositionInventoryStats(
            sources,
            source.ordinaryState,
            source.ordinary.ordinaryProof,
          );
    const selected =
      draft.initialState.effectInstanceIds.kind === 'ENTERED'
        ? draft.initialState.effectInstanceIds.value
        : [];
    const diseaseAssignments = selected.flatMap((effectInstanceId) => {
      const actual = readNpcEffectAllocationInTransaction(
        db,
        attempt.scope,
        attempt.candidateNpcUuid,
        effectInstanceId,
      );
      return 'diseaseId' in actual ? [{ effectInstanceId, diseaseId: actual.diseaseId }] : [];
    });
    const equipment = equipmentForDraftWithContext(evidence, draft, calendar, previous, context);
    const input = {
      npcUuid: source.input.npcUuid,
      schema: source.input.schema,
      baseStats: source.input.baseStats,
      compositionProof: ordinary?.current.composition.proof ?? source.input.compositionProof,
      ordinaryProofOrNull: ordinary?.ordinaryProof ?? null,
      inventoryRequests: source.input.inventoryRequests,
      diseaseAssignments,
      equipmentProofOrNull: equipment?.proof ?? null,
      equipmentContextOrNull: equipment?.context ?? null,
    };
    const hpSource =
      ordinary === null || ordinary.compositionProof.confirmations.length === 0
        ? null
        : deriveNpcOrdinaryHpModeSource(ordinary);
    return {
      evidence,
      previous,
      context,
      scoped,
      draft,
      selected,
      input,
      hpSource,
      inventoryContext,
    };
  }
  function poisonReadBasis(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
  ): NpcPoisonReadBasis {
    return poisonReadBasisFromSource(attempt, initialStateSourceBasis(attempt, calendar));
  }
  function poisonReadBasisFromSource(
    attempt: NpcAttempt,
    source: ReturnType<typeof initialStateSourceBasis>,
  ): NpcPoisonReadBasis {
    return {
      attempt,
      draft: source.draft,
      editor: source.scoped,
      readContext: source.context,
      evidence: source.evidence,
      compositionProof: source.input.compositionProof,
      previousVersionCompositionProofOrNull: source.previous?.derivation.compositionProof ?? null,
      inventoryHistory: source.inventoryContext,
      physicalInventory: buildNpcInventoryPhysicalBasis(
        sources.inventoryPublication,
        source.input.inventoryRequests,
        source.inventoryContext,
      ),
    };
  }
  const poisonReaders = createNpcPoisonReaders({
    db,
    source: sources.poisonSource,
    catalog: sources.poisonCoatings,
    publication: sources.inventoryPublication,
    read: poisonReadBasis,
    composition(attempt, calendar) {
      // Historical observations may request an older predecessor than the surrounding frame.
      // Capture before the first evidence read; share only this call's fully checked history.
      const guard = attempt.targetOrNull === null ? null : capturePriorLifeReadGuard(calendar);
      const request =
        guard === null ? undefined : priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
      const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, attempt);
      const previousHistory =
        evidence.previousOrNull === null
          ? null
          : inventoryHistoryRead(
              attempt.scope,
              attempt.candidateNpcUuid,
              s.integer(evidence.previousOrNull.record['version']),
              calendar,
            );
      const previousEntry = previousHistory?.last ?? null;
      if (evidence.previousOrNull !== null) {
        if (previousEntry === null) return fail('missing checked poison composition predecessor');
        equal(
          previousEntry.record,
          evidence.previousOrNull.record,
          'poison composition predecessor',
        );
      }
      const prior = previousEntry?.snapshot ?? null;
      const completed =
        guard === null || previousHistory === null
          ? null
          : createCompletedInventoryPrefix(
              attempt.scope,
              attempt.candidateNpcUuid,
              calendar,
              guard,
              request,
              previousHistory,
            );
      const parent = completedInventoryPrefix;
      if (completed !== null) completedInventoryPrefix = completed;
      try {
        // Current composition and its fresh SQL remain independent; only its exact saved
        // predecessor is available to contextAt and the nested history reader.
        const result =
          evidence.current.ordinaryFacts.length === 0 &&
          !(prior?.format === 'NPC_HUMANOID_V1' && prior.derivation.ordinaryProof !== undefined)
            ? initialStateSourceBasis(attempt, calendar).input.compositionProof
            : compositionState(
                attempt,
                contextAt(evidence, evidence.current, calendar, prior),
                calendar,
              ).compositionProof;
        if (completed !== null) assertCompletedInventoryPrefix(completed);
        return result;
      } finally {
        completedInventoryPrefix = parent;
      }
    },
    life: (attempt, calendar, commit) => preparedLife(attempt, calendar, commit)?.state ?? null,
    historicalCalendar,
    calendarAnchor: currentRuntimeCalendarAnchor,
  });
  const poisonPreparation = createNpcPoisonPreparation({
    source: sources.poisonSource,
    catalog: sources.poisonCoatings,
    publication: sources.inventoryPublication,
    historicalCalendar,
    validateCandidate: poisonReaders.validateCandidate,
    read(attempt, calendar) {
      const source = initialStateSourceBasis(attempt, calendar);
      const basis = poisonReadBasisFromSource(attempt, source);
      const completed = source.completedPrefix;
      // Keep the pre-history witness: later preparation reads may reuse only this checked
      // predecessor, while current modes/coatings/life and their fresh SQL still run.
      if (completed !== null) assertCompletedInventoryPrefix(completed);
      const parent = completedInventoryPrefix;
      if (completed !== null) completedInventoryPrefix = completed;
      try {
        const result = {
          ...basis,
          modes: poisonReaders.modes(attempt, calendar),
          ...poisonReaders.preparationSelection(attempt, calendar),
          lifeStateOrNull: preparedLife(attempt, calendar, null)?.state ?? null,
          sourceSignature: {
            composition: basis.compositionProof,
            inventory: projectNpcInventoryRequest(basis.editor, basis.draft.inventory),
            initialState: basis.draft.initialState,
            clock: calendar.currentClock,
          },
        };
        if (completed !== null) assertCompletedInventoryPrefix(completed);
        return result;
      } finally {
        completedInventoryPrefix = parent;
      }
    },
  });
  function poisonState(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ) {
    if (
      !Object.hasOwn(
        s.object(s.object(evidence.current.openAttempt.values)['initialState']),
        'poisonModeFactIds',
      )
    )
      return null;
    const time = evidenceClock(evidence, calendar, pending);
    const current =
      evidence.committedOrNull === null
        ? calendar
        : historicalCalendar(evidence.committedOrNull.operation, calendar);
    return poisonReaders.context(evidence.current.openAttempt, current, {
      operationId: evidence.target.commitOperationId,
      committedAt: time.committedAt,
    });
  }
  type SnapshotPoisonRead = NonNullable<ReturnType<typeof poisonState>> & {
    readonly evidence: NpcVersionDerivationEvidence;
  };
  type CompletedSavedPoisonRead = Readonly<{
    snapshot: ReturnType<typeof readSnapshot>;
    poison: SnapshotPoisonRead;
    calendar: NpcCalendarReadContext;
    guard: ReturnType<typeof capturePriorLifeReadGuard>;
    request: unknown;
    poisonContext: unknown;
    nodes: readonly PriorLifeInputNode[];
  }>;
  function assertCompletedSavedPoisonRead(
    completed: CompletedSavedPoisonRead,
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): void {
    if (pending !== null || completed.snapshot !== value || completed.calendar !== calendar)
      return s.fail('SOURCE_CHANGED');
    assertPriorLifeReadGuard(completed.guard, calendar);
    if (
      priorLifeCallable(NPC_GM_REQUEST_READERS, 'request') !== completed.request ||
      priorLifeCallable(poisonReaders, 'context') !== completed.poisonContext
    )
      return s.fail('SOURCE_CHANGED');
    assertPriorLifeInputs(completed.nodes);
  }
  function snapshotPoisonState(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
    completed?: CompletedSavedPoisonRead,
  ): SnapshotPoisonRead | null {
    if (completed !== undefined)
      assertCompletedSavedPoisonRead(completed, value, calendar, pending);
    const inherited = completed === undefined && pending === null ? completedInventoryPrefix : null;
    if (inherited !== null) assertCompletedInventoryPrefix(inherited);
    const last = inherited?.result.last;
    const priorPoison =
      inherited !== null &&
      last !== undefined &&
      last !== null &&
      last.snapshot === value &&
      last.poison !== null &&
      inherited.scopeText === s.canonical(calendar.scope) &&
      inherited.footprintText === inventoryCalendarFootprint(calendar)
        ? { prefix: inherited, last, poison: last.poison, calendarText: s.canonical(calendar) }
        : null;
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'initialPoisonProof')) return null;
    const proof = readNpcHumanoidPoisonProof(derivation['initialPoisonProof']);
    let target: NpcDerivationTarget;
    if (pending !== null && pending.operationId === proof.commitOperationId)
      target = {
        scope: pending.scope,
        npcUuid: pending.npcUuid,
        npcDraftId: pending.npcDraftId,
        openAttemptRevision: pending.attemptRevision - 1,
        commitOperationId: pending.operationId,
        targetVersion: pending.version,
      };
    else {
      const audit =
        calendar.operations.find((row) => row.operationId === proof.commitOperationId) ??
        fail('actual poison COMMIT audit missing');
      const cause = readNpcGmPrimitiveCause(db, calendar.scope, {
        operationId: proof.commitOperationId,
        recordSha256: audit.operationSha256,
      });
      if (cause.operation.kind !== 'COMMIT' && cause.operation.kind !== 'COMMIT_V1')
        return fail('poison target must be actual COMMIT');
      const version = cause.operation.versionOrNull ?? fail('poison target version missing');
      target = {
        scope: calendar.scope,
        npcUuid: version.npcUuid,
        npcDraftId: cause.event.ref.npcDraftId,
        openAttemptRevision: cause.event.ref.revision - 1,
        commitOperationId: proof.commitOperationId,
        targetVersion: version.version,
      };
    }
    equal(target.npcUuid, s.uuid(snapshot['npcUuid']), 'actual poison NPC');
    // Even a completed local result must cross the actual COMMIT and full SQL evidence again.
    const evidence = readNpcVersionDerivationEvidenceInTransaction(db, target);
    let actual: NonNullable<ReturnType<typeof poisonState>>;
    if (completed === undefined && priorPoison === null) {
      actual = poisonState(evidence, calendar, pending) ?? fail('actual poison selection missing');
    } else if (priorPoison !== null) {
      assertCompletedInventoryPrefix(priorPoison.prefix);
      if (s.canonical(calendar) !== priorPoison.calendarText) return s.fail('SOURCE_CHANGED');
      const committed = evidence.committedOrNull ?? fail('completed poison requires saved COMMIT');
      const original =
        priorPoison.poison.evidence.committedOrNull ?? fail('saved poison COMMIT missing');
      equal(committed.record, priorPoison.last.record, 'completed poison exact saved record');
      equal(evidence, priorPoison.poison.evidence, 'fresh completed poison derivation');
      evidenceClock(evidence, calendar, null);
      // Outer pointers may differ; the complete actual saved-COMMIT calendar must not.
      equal(
        historicalCalendar(committed.operation, calendar),
        historicalCalendar(original.operation, priorPoison.prefix.calendar),
        'completed poison effective saved calendar',
      );
      assertCompletedInventoryPrefix(priorPoison.prefix);
      actual = priorPoison.poison;
    } else {
      if (completed === undefined) return s.fail('SOURCE_CHANGED');
      assertCompletedSavedPoisonRead(completed, value, calendar, pending);
      equal(evidence, completed.poison.evidence, 'fresh saved poison derivation');
      actual = completed.poison;
    }
    equal(actual.proof, proof, 'actual poison target and mode origins');
    return { ...actual, evidence };
  }
  function currentRuntimeCalendarAnchor(
    calendar: NpcCalendarReadContext,
  ): NpcInitialTraumaCalendarAnchor {
    const clock = calendar.currentClock;
    const campaignTimestamp =
      clock.campaignTimestampOrNull ?? fail('initial HP mode requires confirmed time');
    return clock.phase === 'PRE_START'
      ? {
          kind: 'PRE_START_INITIAL',
          campaignTimestamp,
          lobbySnapshotRevision:
            clock.lobbySnapshotRevisionOrNull ?? fail('missing current lobby revision'),
        }
      : {
          kind: 'CURRENT_CAMPAIGN',
          campaignTimestamp,
          stateRevision: calendar.checkpoint.stateRevision,
        };
  }
  function preparedRuntimeCause(
    prepared: NpcDerivationPrefix['runtimeEffectReservations'][number],
    scope: NpcAttempt['scope'],
    calendar: NpcCalendarReadContext,
  ) {
    const operation =
      calendar.operations.find((row) => row.operationId === prepared.operationId) ??
      fail('missing real effect preparation audit');
    const cause = readNpcGmPrimitiveCause(db, scope, {
      operationId: prepared.operationId,
      recordSha256: operation.operationSha256,
    });
    equal(
      [cause.operation.operationId, cause.event.sha256, cause.event.ref.revision],
      [prepared.operationId, prepared.eventSha256, prepared.attemptRevision],
      'actual effect preparation',
    );
    return cause;
  }
  /** Resolve selected modes without evaluating alcohol or HP, so CORE-079 has no circular dependency. */
  function selectedHpModes(
    input: ReturnType<typeof effectInputBasis>,
    calendar: NpcCalendarReadContext,
  ) {
    const entries: NpcHumanoidRuntimeEffectPreview['hpModes'][number][] = [],
      histories: NpcHpModeHistoryAnchor[] = [];
    const effects = [] as ReturnType<typeof createNpcInitialHpModeEffect>[];
    for (const effectInstanceId of input.selected) {
      const allocation = readNpcEffectAllocationInTransaction(
        db,
        input.context.scope,
        input.context.candidateNpcUuid,
        effectInstanceId,
      );
      if (!('sourceKind' in allocation) || allocation.sourceKind !== 'HP_MODE') continue;
      const prepared = input.evidence.current.runtimeEffectReservations.find(
        (row) => row.effectInstanceId === effectInstanceId,
      );
      if (prepared === undefined) {
        const retained = originalRuntimeEffect(
          effectInstanceId,
          input.context.scope,
          input.context.candidateNpcUuid,
          calendar,
          null,
        );
        if (retained.kind !== 'HP_MODE') return fail('retained HP mode source mismatch');
        entries.push({
          kind: 'RETAINED',
          effect: retained.effect,
          history: retained.history,
          originCommitOperationId: retained.originCommitOperationId,
        });
        histories.push(retained.history);
        effects.push(retained.effect);
        continue;
      }
      if (prepared.sourceKind !== 'HP_MODE') return fail('prepared HP mode source mismatch');
      const cause = preparedRuntimeCause(prepared, input.context.scope, calendar),
        request = npcHpModePreparationRequestInputValue(prepared.input);
      const history: NpcHpModeHistoryAnchor = {
        effectInstanceId,
        npcUuid: input.context.candidateNpcUuid,
        sourceInstanceId: prepared.sourceInstanceId,
        mode: prepared.mode,
        initialStateConfirmationId: prepared.operationId,
        reason: request.reason,
        createdAt: cause.operation.committedAt,
        calendarAnchor: currentRuntimeCalendarAnchor(calendar),
        remainingMinutes: request.remainingMinutes,
        revision: 1,
      };
      const effect = createNpcInitialHpModeEffect(
        sources.hpModes,
        history,
        input.hpSource ?? fail('actual complete HP mode source required'),
      );
      histories.push(history);
      effects.push(effect);
      entries.push({
        kind: 'PREPARED',
        sourceOperationId: prepared.operationId,
        preparedAt: cause.operation.committedAt,
        effectInstanceId,
        reason: request.reason,
        remainingMinutes: request.remainingMinutes,
        mode: prepared.mode,
        sourceInstanceId: prepared.sourceInstanceId,
      });
    }
    return { entries, histories, effects };
  }
  function effectBasis(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    committed: Readonly<{
      evidence: NpcVersionDerivationEvidence;
      pending: NpcPendingCommitEvidence | null;
    }> | null = null,
  ) {
    const input = effectInputBasis(attempt, calendar);
    const hpModes =
      committed === null
        ? selectedHpModes(input, calendar)
        : (() => {
            const entries = input.selected.flatMap((id) => {
              const allocation = readNpcEffectAllocationInTransaction(
                db,
                attempt.scope,
                attempt.candidateNpcUuid,
                id,
              );
              if (!('sourceKind' in allocation) || allocation.sourceKind !== 'HP_MODE') return [];
              const entry = originalRuntimeEffect(
                id,
                attempt.scope,
                attempt.candidateNpcUuid,
                calendar,
                committed.pending,
              );
              if (entry.kind !== 'HP_MODE') return fail('committed HP mode source mismatch');
              return [entry];
            });
            return {
              effects: entries.map((e) => e.effect),
              histories: entries.map((e) => e.history),
              entries: [],
            };
          })();
    const minute =
      committed === null
        ? calendar.currentClock.campaignTimestampOrNull
        : evidenceClock(committed.evidence, calendar, committed.pending).clock
            .campaignTimestampOrNull;
    const profile =
      hpModes.effects.length === 0
        ? null
        : deriveNpcHpModeStatProfile(sources.hpModes, {
            modes: hpModes.effects,
            histories: hpModes.histories,
            source: input.hpSource ?? fail('actual complete HP mode source required'),
            campaignTimestamp: minute ?? fail('HP mode requires actual campaign time'),
          });
    return {
      ...input,
      basis: deriveNpcInitialEffectPreparation(
        sources,
        input.input,
        profile,
        input.inventoryContext,
      ),
      hpModes,
    };
  }
  function hpCapabilities(basis: ReturnType<typeof effectInputBasis>, clock: NpcCalendarClock) {
    const ordinary = (basis.hpSource?.ordinarySymbionts ?? [])
      .filter(
        (source) =>
          source.speciesKey === 'WEAVER' &&
          source.learnedNodeRefs.includes('SYM-034') &&
          !basis.hpSource!.unavailableSourceInstanceIds.includes(source.symbiontInstanceId),
      )
      .map((source) => ({
        mode: 'REGENERATION' as const,
        sourceInstanceId: source.symbiontInstanceId,
      }));
    const monster = basis.hpSource?.monsterOrNull;
    const hunger =
      monster?.speciesKey === 'CHIMERA' &&
      monster.learnedNodeRefs.includes('MON-023') &&
      !basis.hpSource!.unavailableSourceInstanceIds.includes(monster.symbiontInstanceId)
        ? [{ mode: 'HUNGER' as const, sourceInstanceId: monster.symbiontInstanceId }]
        : [];
    return [...ordinary, ...hunger].map((source) => ({
      sourceKind: 'HP_MODE' as const,
      mode: source.mode,
      sourceInstanceId: source.sourceInstanceId,
      capabilityKey: s.sha(
        s.canonical({
          scope: basis.context.scope,
          npcDraftId: basis.context.npcDraftId,
          revision: basis.context.revision,
          composition: basis.input.compositionProof,
          sourceInstanceId: source.sourceInstanceId,
          mode: source.mode,
          clock,
        }),
      ),
    }));
  }
  function historicalCalendar(
    operation: NpcOperation,
    calendar: NpcCalendarReadContext,
  ): NpcCalendarReadContext {
    const proof =
      calendar.operations.find((row) => row.operationId === operation.operationId) ??
      fail('missing runtime preparation calendar proof');
    equal(
      [
        proof.operationSha256,
        proof.beforeCheckpointSha256,
        proof.beforeGmSource,
        proof.kind,
        proof.committedAt,
        proof.versionOrNull,
      ],
      [
        s.sha(s.canonical(operation)),
        s.sha(s.canonical(operation.beforeCheckpoint)),
        operation.beforeGmSource,
        operation.kind,
        operation.committedAt,
        operation.versionOrNull,
      ],
      'actual runtime preparation calendar',
    );
    return {
      ...calendar,
      checkpoint: operation.beforeCheckpoint,
      currentQueuePrefixOrNull: operation.beforeGmSource.queuePrefix,
      currentClock: proof.clock,
    };
  }
  function formalCapabilities(basis: ReturnType<typeof effectInputBasis>, clock: NpcCalendarClock) {
    const composition = deriveNpcFormalControlComposition(
      sources.formalControlComposition,
      basis.input.compositionProof,
    );
    equal(composition.npcUuid, basis.context.candidateNpcUuid, 'formal control source owner');
    return (['SLEEP', 'PARALYSIS'] as const).map((controlKind) => ({
      controlKind,
      response: composition.poisonControlResponse,
      capabilityKey: s.sha(
        s.canonical({
          scope: basis.context.scope,
          npcDraftId: basis.context.npcDraftId,
          revision: basis.context.revision,
          composition: basis.input.compositionProof,
          controlKind,
          clock,
        }),
      ),
    }));
  }
  function runtimeSelection(
    request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>,
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
  ) {
    if (attempt.status !== 'OPEN' || attempt.stage !== 'NPC-016')
      return fail('runtime preparation requires open NPC016');
    const basis = effectBasis(attempt, calendar);
    const selectedSources = basis.selected.map((id) =>
      readNpcEffectAllocationInTransaction(db, attempt.scope, attempt.candidateNpcUuid, id),
    );
    if (request.preparation.kind === 'ALCOHOL_PREPARE') {
      const input = npcAlcoholPreparationRequestInputValue(request.preparation.input);
      if (selectedSources.some((row) => 'sourceKind' in row && row.sourceKind === 'ALCOHOL'))
        return fail('alcohol already selected');
      const noEffect =
        basis.basis.poisonResponse === 'IMMUNE' ||
        basis.basis.effectiveStats.Z >= sources.initialEffects.alcohol.durationHoursOffset;
      if (noEffect) {
        const result = createNpcAlcoholEffect(
          sources.alcoholEffects,
          {
            effectInstanceIdOrNull: null,
            createdAtOrNull: null,
            effectiveZ: basis.basis.effectiveStats.Z,
            reason: input.reason,
          },
          {
            kind: 'NEW_FORMAL_ASSIGNMENT',
            targetActorId: attempt.candidateNpcUuid,
            campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
            dead: false,
            poisonResponse: basis.basis.poisonResponse,
          },
        );
        if (result.kind !== 'NO_EFFECT') return fail('actual no-effect preparation mismatch');
        return { basis, input, source: null };
      }
      prepareNewNpcAlcoholSchedule(sources.initialEffects, {
        kind: 'ALCOHOL',
        effectiveZ: basis.basis.effectiveStats.Z,
        assignment: {
          kind: 'NEW_FORMAL_ASSIGNMENT',
          campaignTimestamp:
            calendar.currentClock.campaignTimestampOrNull ??
            fail('positive alcohol effect requires confirmed time'),
        },
      });
      return { basis, input, source: { sourceKind: 'ALCOHOL' as const } };
    }
    if (request.preparation.kind === 'FORMAL_CONTROL_SET') {
      const input = npcFormalControlPreparationRequestInputValue(request.preparation.input);
      readNpcFormalControlRemaining(input.remainingMinutes);
      const capability =
        formalCapabilities(basis, calendar.currentClock).find(
          (entry) =>
            entry.controlKind === input.controlKind && entry.capabilityKey === input.capabilityKey,
        ) ?? fail('formal control source capability changed');
      if (
        selectedSources.some(
          (row) =>
            'sourceKind' in row &&
            row.sourceKind === 'FORMAL_CONTROL' &&
            row.controlKind === capability.controlKind,
        )
      )
        return fail('formal control already selected');
      if (capability.response === 'IMMUNE') return { basis, input, source: null };
      if (calendar.currentClock.campaignTimestampOrNull === null)
        return fail('initial formal control requires confirmed time');
      return {
        basis,
        input,
        source: { sourceKind: 'FORMAL_CONTROL' as const, controlKind: capability.controlKind },
      };
    }
    if (request.preparation.kind !== 'HP_MODE_PREPARE')
      return fail('runtime preparation kind required');
    const input = npcHpModePreparationRequestInputValue(request.preparation.input);
    validateNpcHpModeRemainingMinutes(sources.hpModes, input.remainingMinutes);
    const capability =
      hpCapabilities(basis, calendar.currentClock).find(
        (row) => row.capabilityKey === input.capabilityKey,
      ) ?? fail('HP mode source capability changed');
    if (
      selectedSources.some(
        (row) =>
          'sourceKind' in row && row.sourceKind === 'HP_MODE' && row.mode === capability.mode,
      )
    )
      return fail('HP mode already selected');
    if (calendar.currentClock.campaignTimestampOrNull === null)
      return fail('initial HP mode requires confirmed time');
    return {
      basis,
      input,
      source: {
        sourceKind: 'HP_MODE' as const,
        mode: capability.mode,
        sourceInstanceId: capability.sourceInstanceId,
      },
    };
  }
  function runtimeValues(
    selection: ReturnType<typeof runtimeSelection>,
    effectInstanceId: string | null,
    operationId: string,
  ): JsonObject {
    if (selection.source === null) {
      if (effectInstanceId !== null) return fail('NO_EFFECT allocated an effect identity');
      return json(selection.basis.draft);
    }
    const id = s.uuid(effectInstanceId),
      context: NpcAttemptReadContext = {
        ...selection.basis.context,
        revision: s.increment(selection.basis.context.revision),
        operationId,
        pendingRuntimeEffectOrNull: {
          ...selection.source,
          effectInstanceId: id,
          operationId,
          npcDraftId: selection.basis.context.npcDraftId,
        },
      };
    const next = {
      ...selection.basis.draft,
      initialState: {
        ...selection.basis.draft.initialState,
        effectInstanceIds: { kind: 'ENTERED' as const, value: [...selection.basis.selected, id] },
      },
    };
    return json(
      readNpcEditorDraft(npcEditorForItemAttempt(editor, sources.inventory, context), next),
    );
  }
  const runtimeEffectPreparation: NpcOrdinaryDomainReaders['runtimeEffectPreparation'] = {
    inspect(attempt, context, calendar) {
      const prepared = effectBasis(attempt, calendar);
      equal(
        [context.scope, context.npcDraftId, context.revision],
        [attempt.scope, attempt.npcDraftId, attempt.revision],
        'runtime presentation context',
      );
      const clock = calendar.currentClock,
        selected = prepared.selected.map((id) =>
          readNpcEffectAllocationInTransaction(db, attempt.scope, attempt.candidateNpcUuid, id),
        );
      const noEffect =
        prepared.basis.poisonResponse === 'IMMUNE' ||
        prepared.basis.effectiveStats.Z >= sources.initialEffects.alcohol.durationHoursOffset;
      const canTime = noEffect || clock.campaignTimestampOrNull !== null;
      return {
        alcohol: {
          capabilityKey: s.sha(
            s.canonical({
              scope: attempt.scope,
              draft: attempt.npcDraftId,
              revision: attempt.revision,
              clock,
            }),
          ),
          input: { reason: { kind: 'UNSET' } },
          errors: {},
          canSubmit:
            attempt.stage === 'NPC-016' &&
            canTime &&
            !selected.some((row) => 'sourceKind' in row && row.sourceKind === 'ALCOHOL'),
          explanation: noEffect
            ? 'Текущее состояние не создаёт алкогольного отравления. Сохранится подтверждение без эффекта и таймера.'
            : canTime
              ? 'Подтвердите исходное алкогольное отравление и основание. Урон при подготовке не применяется.'
              : 'Для исходного отравления сначала подтвердите время кампании.',
          derivedRows: [
            { label: 'Эффективное Z', value: String(prepared.basis.effectiveStats.Z) },
            {
              label: 'Ответ на яд',
              value: prepared.basis.poisonResponse === 'IMMUNE' ? 'Иммунитет' : 'Применим',
            },
          ],
        },
        hpModes: hpCapabilities(prepared, clock).map((capability) => ({
          capabilityKey: capability.capabilityKey,
          mode: capability.mode,
          sourceLabel:
            capability.mode === 'HUNGER' ? 'Химера — Ведомый голодом' : 'Ткач — Регенерация',
          input: { remainingMinutes: { kind: 'UNSET' }, reason: { kind: 'UNSET' } },
          maximumRemainingMinutes: npcHpModeMaximumRemainingMinutes(sources.hpModes),
          errors: {},
          canSubmit:
            attempt.stage === 'NPC-016' &&
            clock.campaignTimestampOrNull !== null &&
            !selected.some(
              (row) =>
                'sourceKind' in row && row.sourceKind === 'HP_MODE' && row.mode === capability.mode,
            ),
          explanation:
            clock.campaignTimestampOrNull === null
              ? 'Для действующего режима сначала подтвердите время кампании.'
              : 'Введите точный оставшийся срок действующего режима и основание. HP, ОЭ и таймеры активации не переигрываются.',
          derivedRows: [],
        })),
        formalControls: formalCapabilities(prepared, clock).map((capability) => ({
          capabilityKey: capability.capabilityKey,
          controlKind: capability.controlKind,
          sourceLabel: capability.controlKind === 'SLEEP' ? 'Исходный сон' : 'Исходный паралич',
          input: { remainingMinutes: { kind: 'UNSET' }, reason: { kind: 'UNSET' } },
          maximumRemainingMinutes: npcFormalControlMaximumRemainingMinutes(sources.formalControls),
          errors: {},
          canSubmit:
            attempt.stage === 'NPC-016' &&
            (capability.response === 'IMMUNE' || clock.campaignTimestampOrNull !== null) &&
            !selected.some(
              (row) =>
                'sourceKind' in row &&
                row.sourceKind === 'FORMAL_CONTROL' &&
                row.controlKind === capability.controlKind,
            ),
          explanation:
            capability.response === 'IMMUNE'
              ? 'Иммунитет исключает это состояние. Подтверждение сохранится без эффекта и таймера.'
              : clock.campaignTimestampOrNull === null
                ? 'Сначала подтвердите время кампании.'
                : 'Введите точный остаток и причину текущего состояния. Приём препарата и проверка сопротивления не создаются.',
          derivedRows: [
            {
              label: 'Ответ на состояние',
              value: capability.response === 'IMMUNE' ? 'Иммунитет' : 'Применимо',
            },
          ],
        })),
      };
    },
    prepare(request, context, allocate, committedAt) {
      const previous =
        context.previousOrNull?.attempt ?? fail('missing runtime preparation attempt');
      const selection = runtimeSelection(
        request,
        previous,
        requireCalendar(context.calendarContext, previous.scope),
      );
      const effectInstanceId = selection.source === null ? null : allocate();
      return {
        next: {
          ...previous,
          revision: s.increment(previous.revision),
          values: runtimeValues(selection, effectInstanceId, request.operationId),
        },
        receiptId: allocate(),
        committedAt,
        ...(selection.source === null
          ? {}
          : {
              childAllocations: [
                { kind: 'EFFECT_INSTANCE' as const, id: effectInstanceId!, ...selection.source },
              ],
            }),
      };
    },
    apply(operation, event, previous, context, calendar) {
      const request = npcTechnicalRequestValue(operation.request);
      if (
        request.messageType !== 'network.npc-preparation.request' ||
        request.sourceFormId !== 'NPC-016' ||
        (request.preparation.kind !== 'ALCOHOL_PREPARE' &&
          request.preparation.kind !== 'HP_MODE_PREPARE' &&
          request.preparation.kind !== 'FORMAL_CONTROL_SET')
      )
        return fail('actual runtime preparation request required');
      equal(
        [context.scope, context.npcDraftId, context.revision],
        [previous.attempt.scope, previous.attempt.npcDraftId, previous.attempt.revision],
        'runtime predecessor',
      );
      const selection = runtimeSelection(
        request,
        previous.attempt,
        historicalCalendar(operation, calendar),
      );
      const children = 'format' in event ? event.childAllocations : [];
      if (selection.source === null) equal(children, [], 'NO_EFFECT children');
      else {
        if (children.length !== 1) return fail('exact one runtime effect child required');
        equal(
          children[0],
          { kind: 'EFFECT_INSTANCE', id: children[0]!.id, ...selection.source },
          'runtime source allocation',
        );
      }
      equal(
        [event.operationId, event.attempt.revision],
        [operation.operationId, previous.attempt.revision + 1],
        'runtime historical transition',
      );
      return runtimeValues(selection, children[0]?.id ?? null, operation.operationId);
    },
  };
  function snapshotLifeState(snapshot: ReturnType<typeof readSnapshot>): NpcFormalLifeState | null {
    if (snapshot.format !== 'NPC_HUMANOID_V1' || snapshot.derivation.initialLifeProof === undefined)
      return null;
    const states = snapshot.sheet.input.initialState.sourceSpecificStates.filter(
      (state): state is NpcFormalLifeState =>
        'lifeKind' in state && state.anchor.kind === 'GM_FORMAL_INITIAL_LIFE',
    );
    if (states.length !== 1) return fail('one checked formal life state required');
    return states[0]!;
  }
  function selectedWeaverIds(attempt: NpcAttempt): readonly string[] | null {
    const state = s.object(s.object(attempt.values)['initialState']);
    if (!Object.hasOwn(state, 'weaverEffectInstanceIds')) return null;
    const section = s.object(state['weaverEffectInstanceIds'], ['kind', 'value']);
    if (section['kind'] !== 'ENTERED' || !Array.isArray(section['value']))
      return fail('explicit Weaver selection required');
    const ids = section['value'].map((id: unknown) => s.uuid(id));
    if (new Set(ids).size !== ids.length) return fail('duplicate selected Weaver identity');
    return ids;
  }
  function weaverSelection(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Readonly<{ operationId: string; committedAt: string }> | null = null,
    allowCurrentUnavailable = false,
  ): Readonly<{
    entries: readonly NpcHumanoidWeaverEffectContext[];
    contributions: readonly NpcFormalWeaverEffectContribution[];
    selected: NpcWeaverPreparationBasis['selected'];
  }> | null {
    return weaverSelectionFromSource(attempt, calendar, commit, allowCurrentUnavailable, () =>
      commit === null
        ? initialStateSourceBasis(attempt, calendar)
        : effectInputBasis(attempt, calendar),
    );
  }
  function weaverSelectionFromSource(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Readonly<{ operationId: string; committedAt: string }> | null,
    allowCurrentUnavailable: boolean,
    readSource: () =>
      ReturnType<typeof initialStateSourceBasis> | ReturnType<typeof effectInputBasis>,
  ): ReturnType<typeof weaverSelection> {
    const ids = selectedWeaverIds(attempt);
    if (ids === null) return null;
    const catalog = sources.formalWeaver ?? fail('approved Weaver source unavailable');
    const source = readSource();
    const entries: NpcHumanoidWeaverEffectContext[] = [],
      contributions: NpcFormalWeaverEffectContribution[] = [];
    const selected: NpcWeaverPreparationBasis['selected'][number][] = [];
    for (const id of ids) {
      const allocation = readNpcEffectAllocationInTransaction(
        db,
        attempt.scope,
        attempt.candidateNpcUuid,
        id,
      );
      if (!('sourceKind' in allocation) || allocation.sourceKind !== 'WEAVER_STATE')
        return fail('selected identity is not a Weaver state');
      const own = source.evidence.current.runtimeEffectReservations.find(
        (row) => row.effectInstanceId === id,
      );
      let entry: NpcHumanoidWeaverEffectContext;
      if (own !== undefined) {
        if (own.sourceKind !== 'WEAVER_STATE') return fail('Weaver preparation source mismatch');
        const actual = readNpcWeaverStatePreparationEvidenceInTransaction(
          db,
          attempt.scope,
          attempt.candidateNpcUuid,
          own.operationId,
        );
        const atPrepare = historicalCalendar(actual.operation, calendar);
        const chosen = weaverPreparation.selection(
          actual.request,
          actual.evidence.current.openAttempt,
          atPrepare,
        );
        if (chosen.kind !== 'PREPARE') return fail('actual Weaver PREPARE required');
        equal(
          [own.sourceInstanceId, own.branch],
          [chosen.input.sourceInstanceId, chosen.input.branch],
          'Weaver original allocation',
        );
        const originalHistory: NpcFormalWeaverHistoryAnchor = {
          kind: 'GM_FORMAL_INITIAL_WEAVER',
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          effectInstanceId: id,
          sourceInstanceId: chosen.input.sourceInstanceId,
          sourceOperationId: actual.operation.operationId,
          branch: chosen.input.branch,
          reason: chosen.input.reason,
          createdAt: actual.operation.committedAt,
          calendarAnchor: currentRuntimeCalendarAnchor(atPrepare),
          remainingMinutes: chosen.input.remainingMinutes,
          revision: 1,
        };
        // Prove the original preparation before treating later draft changes as removable blockers.
        const originalPrepared = deriveNpcFormalWeaverEffectContribution(catalog, originalHistory, {
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          campaignTimestamp:
            atPrepare.currentClock.campaignTimestampOrNull ??
            fail('original Weaver minute missing'),
          origin: { kind: 'PREPARED', preparationOperationId: actual.operation.operationId },
          originalCompositionProof: chosen.basis.compositionProof,
          currentCompositionProof: chosen.basis.compositionProof,
        });
        if (
          !s.same(
            [
              atPrepare.currentClock.phase,
              atPrepare.currentClock.campaignTimestampOrNull,
              atPrepare.currentClock.lobbySnapshotRevisionOrNull,
              chosen.basis.compositionProof,
            ],
            [
              calendar.currentClock.phase,
              calendar.currentClock.campaignTimestampOrNull,
              calendar.currentClock.lobbySnapshotRevisionOrNull,
              source.input.compositionProof,
            ],
          )
        ) {
          const detail =
            'После назначения состояния Ткача изменился состав или время. Удалите исходное назначение и подтвердите его заново.';
          if (!allowCurrentUnavailable) throw new NpcOrdinaryPreviewInputError('INVALID', detail);
          selected.push({
            history: originalHistory,
            origin: { kind: 'PREPARED', preparationOperationId: actual.operation.operationId },
            originalEffect: readNpcFormalWeaverEffectContribution(originalPrepared).effect,
            currentEffectOrNull: null,
            currentErrorOrNull: detail,
          });
          continue;
        }
        const history: NpcFormalWeaverHistoryAnchor = {
          kind: 'GM_FORMAL_INITIAL_WEAVER',
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          effectInstanceId: id,
          sourceInstanceId: chosen.input.sourceInstanceId,
          sourceOperationId: actual.operation.operationId,
          branch: chosen.input.branch,
          reason: chosen.input.reason,
          createdAt: commit?.committedAt ?? actual.operation.committedAt,
          calendarAnchor: currentRuntimeCalendarAnchor(calendar),
          remainingMinutes: chosen.input.remainingMinutes,
          revision: 1,
        };
        const context = {
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          campaignTimestamp:
            calendar.currentClock.campaignTimestampOrNull ?? fail('Weaver minute missing'),
          originalCompositionProof: source.input.compositionProof,
          currentCompositionProof: source.input.compositionProof,
          origin:
            commit === null
              ? { kind: 'PREPARED' as const, preparationOperationId: actual.operation.operationId }
              : { kind: 'COMMITTED' as const, originCommitOperationId: commit.operationId },
        };
        const contribution = deriveNpcFormalWeaverEffectContribution(catalog, history, context);
        contributions.push(contribution);
        entry =
          commit === null
            ? {
                history,
                originalCompositionProof: context.originalCompositionProof,
                origin: { kind: 'PREPARED', preparationOperationId: actual.operation.operationId },
              }
            : {
                history,
                originalCompositionProof: context.originalCompositionProof,
                origin: { kind: 'COMMITTED', originCommitOperationId: commit.operationId },
                effect: readNpcFormalWeaverEffectContribution(contribution).effect,
              };
        selected.push({
          history,
          origin: entry.origin,
          originalEffect: readNpcFormalWeaverEffectContribution(contribution).effect,
          currentEffectOrNull: readNpcFormalWeaverEffectContribution(contribution).effect,
          currentErrorOrNull: null,
        });
      } else {
        const reservation = readNpcRuntimeEffectReservationEvidenceInTransaction(
          db,
          attempt.scope,
          attempt.candidateNpcUuid,
          id,
        );
        if (reservation.sourceKind !== 'WEAVER_STATE')
          return fail('retained Weaver source mismatch');
        const origin = reservation.origin,
          originalCommit =
            origin.committedOrNull ?? fail('retained Weaver needs real original COMMIT');
        const originalCalendar = historicalCalendar(originalCommit.operation, calendar);
        const original =
          weaverSelection(origin.current.openAttempt, originalCalendar, {
            operationId: origin.target.commitOperationId,
            committedAt: originalCommit.operation.committedAt,
          })?.entries.find((row) => row.history.effectInstanceId === id) ??
          fail('Weaver absent from original COMMIT');
        if (original.origin.kind !== 'COMMITTED' || !('effect' in original))
          return fail('original committed Weaver context required');
        const originalRaw = s.object(originalCommit.record['snapshot']),
          sheet = s.object(originalRaw['sheet']);
        const rawEffects = s.object(s.object(sheet['input'])['initialState'])['effectInstances'];
        if (!Array.isArray(rawEffects)) return fail('original saved effect list missing');
        const candidates = rawEffects.filter(
          (row: unknown) => s.object(row)['effectInstanceId'] === id,
        );
        if (candidates.length !== 1) return fail('one original saved Weaver effect required');
        // Integrity is checked at the actual saved minute before any recoverable current-state catch.
        validateNpcFormalWeaverEffectContribution(catalog, candidates[0], original.history, {
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          campaignTimestamp:
            originalCalendar.currentClock.campaignTimestampOrNull ??
            fail('original Weaver minute missing'),
          origin: original.origin,
          originalCompositionProof: original.originalCompositionProof,
          currentCompositionProof: original.originalCompositionProof,
        });
        try {
          const contribution = deriveNpcFormalWeaverEffectContribution(catalog, original.history, {
            campaignId: attempt.scope.campaignId,
            npcUuid: attempt.candidateNpcUuid,
            campaignTimestamp:
              calendar.currentClock.campaignTimestampOrNull ??
              fail('current Weaver minute missing'),
            origin: original.origin,
            originalCompositionProof: original.originalCompositionProof,
            currentCompositionProof: source.input.compositionProof,
          });
          contributions.push(contribution);
          entry = {
            ...original,
            effect: readNpcFormalWeaverEffectContribution(contribution).effect,
          };
          selected.push({
            history: original.history,
            origin: original.origin,
            originalEffect: original.effect,
            currentEffectOrNull: readNpcFormalWeaverEffectContribution(contribution).effect,
            currentErrorOrNull: null,
          });
        } catch (error) {
          if (
            !(error instanceof NpcFormalWeaverCurrentUnavailableError) ||
            !allowCurrentUnavailable
          )
            throw error;
          selected.push({
            history: original.history,
            origin: original.origin,
            originalEffect: original.effect,
            currentEffectOrNull: null,
            currentErrorOrNull: error.message,
          });
          continue;
        }
      }
      entries.push(entry);
    }
    return { entries, contributions, selected };
  }
  const weaverPreparation = createNpcWeaverPreparation({
    catalog: sources.formalWeaver,
    historicalCalendar,
    readTimerBasis: inspectLifeTimerBasis,
    read(attempt, calendar) {
      const source = initialStateSourceBasis(attempt, calendar);
      return {
        attempt,
        draft: source.draft,
        editor: source.scoped,
        compositionProof: source.input.compositionProof,
        sourceSignature: lifeSourceSignature(source, calendar),
        selected:
          weaverSelection(attempt, calendar, null, true)?.selected ??
          fail('owning Weaver selection absent'),
      };
    },
  });
  function selectedLifeId(draft: NpcEditorDraft): string | null {
    const section = draft.initialState.lifeStateConfirmationId;
    return section?.kind === 'ENTERED' ? s.uuid(section.value) : null;
  }
  function checkedLifeRoll(prefix: Pick<NpcDerivationPrefix, 'lifeStateRollFacts'>) {
    const rows = prefix.lifeStateRollFacts;
    if (rows.length > 1) return fail('multiple life D6 facts in one attempt');
    const row = rows[0];
    if (row === undefined) return null;
    const request = npcTechnicalRequestValue(row.operation.request);
    if (
      request.messageType !== 'network.npc-preparation.request' ||
      request.preparation.kind !== 'LIFE_STATE_ROLL'
    )
      return fail('missing original life roll request');
    const input = npcLifeStateRollRequestInputValue(request.preparation.input);
    verifyNpcLifeRollOutcome(
      row.fact,
      npcCompositionDiceMode(row.operation.beforeCheckpoint),
      input.manualFaceOrNull,
    );
    return row.fact;
  }
  function lifeSourceSignature(
    basis: ReturnType<typeof initialStateSourceBasis>,
    calendar: NpcCalendarReadContext,
  ) {
    // CURRENT_CAMPAIGN stateRevision also changes for unrelated edits; only the actual clock
    // changes its minute. PRE_START has a dedicated initial-time snapshot revision.
    return {
      composition: basis.input.compositionProof,
      schema: basis.draft.schema,
      baseStats: basis.draft.baseStats,
      symbionts: basis.draft.symbionts,
      clock: {
        phase: calendar.currentClock.phase,
        campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
        lobbySnapshotRevisionOrNull: calendar.currentClock.lobbySnapshotRevisionOrNull,
      },
    };
  }
  function lifeBasis(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
  ): NpcLifePreparationBasis {
    return lifeBasisFromSource(attempt, calendar, initialStateSourceBasis(attempt, calendar));
  }
  function lifeBasisFromSource(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    source: ReturnType<typeof initialStateSourceBasis>,
  ): NpcLifePreparationBasis {
    const previous = source.previous;
    const previousState = previous === null ? null : snapshotLifeState(previous);
    const id = selectedLifeId(source.draft);
    const actual =
      id === null
        ? null
        : readNpcLifeStatePreparationEvidenceInTransaction(
            db,
            attempt.scope,
            attempt.candidateNpcUuid,
            id,
          );
    if (
      actual !== null &&
      !source.evidence.current.lifeStateOperations.some((row) => row.operation.operationId === id)
    ) {
      const previousDraft =
        source.evidence.previousOrNull?.prefix.openAttempt.values ??
        fail('foreign life confirmation');
      equal(
        s.object(s.object(previousDraft)['initialState'])['lifeStateConfirmationId'],
        source.draft.initialState.lifeStateConfirmationId,
        'retained life confirmation',
      );
    }
    let rollFactOrNull = checkedLifeRoll(source.evidence.current);
    if (previousState?.lifeKind === 'SEVERELY_WOUNDED') {
      const original = readNpcLifeStatePreparationEvidenceInTransaction(
        db,
        attempt.scope,
        attempt.candidateNpcUuid,
        previousState.anchor.initialStateConfirmationId,
      );
      rollFactOrNull =
        checkedLifeRoll(original.evidence.current) ?? fail('retained life D6 missing');
      equal(
        rollFactOrNull.fact,
        previousState.anchor.severeWoundOrNull?.rollFact,
        'retained original life D6',
      );
    }
    const minute = calendar.currentClock.campaignTimestampOrNull;
    const weaver = weaverSelectionFromSource(attempt, calendar, null, true, () => source);
    const unavailableReasonOrNull =
      weaver?.selected.find((row) => row.currentErrorOrNull !== null)?.currentErrorOrNull ?? null;
    return {
      attempt,
      draft: source.draft,
      editor: source.scoped,
      clock: calendar.currentClock,
      mode: npcCompositionDiceMode(calendar.checkpoint),
      sourceSignature: {
        ...lifeSourceSignature(source, calendar),
        ...(weaver === null
          ? {}
          : {
              temporaryWeaverStates: weaver.selected.map(({ history }) => ({
                effectInstanceId: history.effectInstanceId,
                sourceInstanceId: history.sourceInstanceId,
                sourceOperationId: history.sourceOperationId,
                branch: history.branch,
                reason: history.reason,
                remainingMinutes: history.remainingMinutes,
              })),
            }),
      },
      duplicateOrNull:
        minute === null || unavailableReasonOrNull !== null
          ? null
          : deriveNpcFunctionalDuplicateProof(sources.functionalDuplicate, {
              npcUuid: attempt.candidateNpcUuid,
              campaignTimestamp: minute,
              compositionProof: source.input.compositionProof,
              temporaryEffects: weaver?.contributions ?? [],
              ...(weaver === null ? {} : { campaignId: attempt.scope.campaignId }),
            }),
      previousKindOrNull: previousState?.lifeKind ?? null,
      rollFactOrNull,
      selectedInputOrNull:
        actual === null ? null : npcLifeStateSetRequestInputValue(actual.request.preparation.input),
      unavailableReasonOrNull,
    };
  }
  const lifePreparation = createNpcLifePreparation({
    enabled: sources.initialLifeAuthoringAvailable,
    catalog: sources.formalLife,
    read: lifeBasis,
    historicalCalendar,
  });
  /** Diagnostic-only evidence from an actual SET. It never authorizes preview or COMMIT. */
  function inspectLifeTimerBasis(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    const basis = lifeBasis(attempt, calendar),
      id = selectedLifeId(basis.draft);
    if (id === null || basis.selectedInputOrNull?.lifeKind !== 'SEVERELY_WOUNDED') return null;
    if (basis.unavailableReasonOrNull != null)
      return { kind: 'UNAVAILABLE' as const, reason: basis.unavailableReasonOrNull };
    if (
      basis.draft.initialState.currentHP.kind !== 'ENTERED' ||
      basis.draft.initialState.currentHP.value !== 0 ||
      basis.duplicateOrNull === null
    )
      return {
        kind: 'UNAVAILABLE' as const,
        reason:
          'Для сравнения сроков нужны явные HP=0, подтверждённое время и действительный текущий состав.',
      };
    const source = initialStateSourceBasis(attempt, calendar);
    const previousRaw = source.evidence.previousOrNull?.record['snapshot'];
    const prior =
      previousRaw === undefined ? null : snapshotLifeContext(previousRaw, calendar, null);
    const actual = readNpcLifeStatePreparationEvidenceInTransaction(
      db,
      attempt.scope,
      attempt.candidateNpcUuid,
      id,
    );
    const own = source.evidence.current.lifeStateOperations.some(
      (row) => row.operation.operationId === id,
    );
    let history: NpcFormalLifeHistoryAnchor, entryDuplicate: NpcFunctionalDuplicateProof;
    if (!own || prior?.history.lifeKind === 'SEVERELY_WOUNDED') {
      if (
        prior === null ||
        prior.history.lifeKind !== 'SEVERELY_WOUNDED' ||
        prior.entryDuplicateProofOrNull === null
      )
        return fail('retained timer diagnostic has no original severe history');
      history = prior.history;
      entryDuplicate = prior.entryDuplicateProofOrNull;
    } else {
      const atSet = historicalCalendar(actual.operation, calendar);
      const chosen = lifePreparation.selection(
        actual.request,
        actual.evidence.current.openAttempt,
        atSet,
      );
      if (
        chosen.kind !== 'SET' ||
        !chosen.allocateTimer ||
        chosen.input.lifeKind !== 'SEVERELY_WOUNDED'
      )
        return fail('timer diagnostic requires actual severe SET');
      const timer = actual.event.childAllocations[0];
      if (
        actual.event.childAllocations.length !== 1 ||
        timer?.kind !== 'EFFECT_INSTANCE' ||
        !('sourceKind' in timer) ||
        timer.sourceKind !== 'LIFE_TIMER'
      )
        return fail('timer diagnostic original allocation missing');
      entryDuplicate = chosen.basis.duplicateOrNull ?? fail('timer diagnostic entry proof missing');
      history = {
        kind: 'GM_FORMAL_INITIAL_LIFE',
        campaignId: attempt.scope.campaignId,
        npcUuid: attempt.candidateNpcUuid,
        lifeKind: 'SEVERELY_WOUNDED',
        initialStateConfirmationId: id,
        reason: chosen.input.reason,
        createdAt: actual.operation.committedAt,
        severeWoundOrNull: {
          effectInstanceId: timer.id,
          calendarAnchor: currentRuntimeCalendarAnchor(atSet),
          rollFact: (chosen.basis.rollFactOrNull ?? fail('timer diagnostic actual D6 missing'))
            .fact,
          remainingMinutes:
            chosen.input.remainingMinutesOrNull ?? fail('timer diagnostic remaining missing'),
          duplicateAtEntry: readNpcFunctionalDuplicateProof(entryDuplicate),
        },
      };
    }
    try {
      return previewNpcFormalLifeTimerBasis(
        sources.formalLife,
        history,
        {
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          currentHP: basis.draft.initialState.currentHP.value,
          campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
        },
        entryDuplicate,
        basis.duplicateOrNull,
      );
    } catch (error) {
      if (!(error instanceof NpcFormalLifeTimerDisplayUnavailableError)) throw error;
      return {
        kind: 'UNAVAILABLE' as const,
        reason:
          'Исходный срок таймера смерти истёк; действующее состояние не подтверждено. Исходные данные и сроки не переписаны.',
      };
    }
  }
  // Opaque issued catalogs have equal JSON shapes but distinct authority identities. Capture
  // descriptors as well as primitive fields; never invoke a getter to inspect trusted inputs.
  type PriorLifeInputNode = Readonly<{
    value: object;
    prototype: unknown;
    complete: boolean;
    keys: readonly PropertyKey[];
    values: readonly unknown[];
  }>;
  // Only fully visited immutable data graphs qualify. Partial roots and cycles never issue a fact.
  // Weak membership keeps no graph alive and cannot authorize a SQL or history read.
  const immutableReadGraphs = new WeakSet<object>();
  function captureReadGraph(
    roots: readonly Readonly<{ value: unknown; keys?: readonly PropertyKey[] }>[],
  ) {
    const nodes: PriorLifeInputNode[] = [],
      seen = new Set<object>();
    function visit(value: unknown, selected?: readonly PropertyKey[]): boolean {
      if (value === null || typeof value !== 'object') {
        if (typeof value === 'function') return s.fail('SOURCE_CHANGED');
        return true;
      }
      if (types.isProxy(value)) return s.fail('SOURCE_CHANGED');
      if (seen.has(value)) return selected === undefined && immutableReadGraphs.has(value);
      seen.add(value);
      if (selected === undefined && immutableReadGraphs.has(value)) return true;
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype)
        return s.fail('SOURCE_CHANGED');
      const keys = selected ?? Reflect.ownKeys(value);
      const values = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          typeof key !== 'string' ||
          descriptor === undefined ||
          !Object.hasOwn(descriptor, 'value') ||
          (!descriptor.enumerable && !(Array.isArray(value) && key === 'length'))
        )
          return s.fail('SOURCE_CHANGED');
        const entry: unknown = descriptor.value;
        return entry;
      });
      // Frozen own data slots cannot change, but their children may still be mutable.
      const frozen = Object.isFrozen(value);
      if (!frozen) nodes.push({ value, prototype, complete: selected === undefined, keys, values });
      let immutable = frozen && selected === undefined;
      for (const entry of values) if (!visit(entry)) immutable = false;
      if (immutable) immutableReadGraphs.add(value);
      return immutable;
    }
    for (const root of roots) visit(root.value, root.keys);
    return nodes;
  }
  function capturePriorLifeInputs() {
    return captureReadGraph([
      {
        value: sources,
        keys: [
          'ordinaryComposition',
          'ordinaryHumanoid',
          'cleanHumanoid',
          'humanoid',
          'inventoryPublication',
          'inventory',
          'skills',
          'baseStats',
          'compositionConsequences',
          'diseaseEffects',
          'nonperiodicDiseases',
          'initialTrauma',
          'initialEffects',
          'equipment',
          'diseaseUnconsciousness',
          'alcoholEffects',
          'hpModes',
          'alcoholPoisonResponse',
          'formalControls',
          'formalControlComposition',
          'formalLife',
          'formalWeaver',
          'poisonSource',
          'poisonCoatings',
          'functionalDuplicate',
          'initialLifeAuthoringAvailable',
        ] satisfies readonly (keyof Sources)[],
      },
      { value: editor },
    ]);
  }
  function assertPriorLifeInputs(nodes: readonly PriorLifeInputNode[]): void {
    for (const node of nodes) {
      if (Object.getPrototypeOf(node.value) !== node.prototype) return s.fail('SOURCE_CHANGED');
      if (node.complete) {
        const keys = Reflect.ownKeys(node.value);
        if (keys.length !== node.keys.length || keys.some((key, index) => key !== node.keys[index]))
          return s.fail('SOURCE_CHANGED');
      }
      for (const [index, key] of node.keys.entries()) {
        const descriptor = Object.getOwnPropertyDescriptor(node.value, key);
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, 'value') ||
          (!descriptor.enumerable && !(Array.isArray(node.value) && key === 'length')) ||
          !Object.is(descriptor.value, node.values[index])
        )
          return s.fail('SOURCE_CHANGED');
      }
    }
  }
  function priorLifeCallable(owner: object, key: string): unknown {
    if (types.isProxy(owner)) return s.fail('SOURCE_CHANGED');
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const value: unknown = descriptor?.value;
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof value !== 'function' ||
      types.isProxy(value) ||
      types.isAsyncFunction(value)
    )
      return s.fail('SOURCE_CHANGED');
    return value;
  }
  function capturePriorLifeReadGuard(calendar: NpcCalendarReadContext) {
    return {
      stamp: readNpcCalculationMutationStamp(db),
      calendarText: s.canonical(calendar),
      inputs: capturePriorLifeInputs(),
      lifeSelection: priorLifeCallable(lifePreparation, 'selection'),
      weaverSelection: priorLifeCallable(weaverPreparation, 'selection'),
      equipmentInspect: priorLifeCallable(equipmentCompatibilityPreparation, 'inspect'),
    };
  }
  function assertPriorLifeReadGuard(
    guard: ReturnType<typeof capturePriorLifeReadGuard>,
    calendar: NpcCalendarReadContext,
  ): void {
    if (
      readNpcCalculationMutationStamp(db) !== guard.stamp ||
      s.canonical(calendar) !== guard.calendarText ||
      priorLifeCallable(lifePreparation, 'selection') !== guard.lifeSelection ||
      priorLifeCallable(weaverPreparation, 'selection') !== guard.weaverSelection ||
      priorLifeCallable(equipmentCompatibilityPreparation, 'inspect') !== guard.equipmentInspect
    )
      return s.fail('SOURCE_CHANGED');
    assertPriorLifeInputs(guard.inputs);
  }
  type LocalSnapshot = ReturnType<typeof readSnapshot>;
  type LocalSnapshotReadCell = {
    readonly kind: 'PREVIOUS_VERSION' | 'OPEN_VERSION';
    readonly bindingText: string;
    readonly snapshotText: string;
    readonly calendar: NpcCalendarReadContext;
    readonly guard: ReturnType<typeof capturePriorLifeReadGuard>;
    readonly validateVersion: unknown;
    readonly initializeOpen: unknown;
    readonly request: unknown;
    entered: boolean;
    result?: Readonly<{ snapshot: LocalSnapshot; nodes: readonly PriorLifeInputNode[] }>;
  };
  // Only a live synchronous caller owns a result cell. The transported token exposes no writer.
  // This transports one completed decoder result; it never indexes or retains history across calls.
  const localSnapshotReads = new WeakMap<NpcLocalSnapshotRead, LocalSnapshotReadCell>();
  function assertLocalSnapshotRead(
    cell: LocalSnapshotReadCell,
    binding: unknown,
    calendar: NpcCalendarReadContext,
  ): void {
    if (cell.calendar !== calendar || cell.bindingText !== s.canonical(binding))
      return s.fail('SOURCE_CHANGED');
    assertPriorLifeReadGuard(cell.guard, calendar);
    if (
      priorLifeCallable(readers, 'validateVersion') !== cell.validateVersion ||
      priorLifeCallable(readers, 'initializeOpen') !== cell.initializeOpen ||
      priorLifeCallable(NPC_GM_REQUEST_READERS, 'request') !== cell.request
    )
      return s.fail('SOURCE_CHANGED');
  }
  function beginLocalSnapshotRead(
    token: NpcLocalSnapshotRead | undefined,
    kind: LocalSnapshotReadCell['kind'],
    binding: unknown,
    calendar: NpcCalendarReadContext,
  ): LocalSnapshotReadCell | undefined {
    if (token === undefined) return undefined;
    if (token === null || typeof token !== 'object' || types.isProxy(token))
      return s.fail('SOURCE_CHANGED');
    const cell = localSnapshotReads.get(token);
    if (cell === undefined || cell.kind !== kind || cell.entered) return s.fail('SOURCE_CHANGED');
    assertLocalSnapshotRead(cell, binding, calendar);
    cell.entered = true;
    return cell;
  }
  function completeLocalSnapshotRead(
    cell: LocalSnapshotReadCell | undefined,
    binding: unknown,
    calendar: NpcCalendarReadContext,
    snapshot: LocalSnapshot,
  ): void {
    if (cell === undefined) return;
    assertLocalSnapshotRead(cell, binding, calendar);
    if (cell.result !== undefined || cell.snapshotText !== s.canonical(snapshot))
      return s.fail('SOURCE_CHANGED');
    cell.result = { snapshot, nodes: captureReadGraph([{ value: snapshot }]) };
  }
  function snapshotFromLocalCall(
    kind: LocalSnapshotReadCell['kind'],
    binding: unknown,
    expectedSnapshot: unknown,
    calendar: NpcCalendarReadContext,
    call: (token: NpcLocalSnapshotRead) => void,
    fresh: () => LocalSnapshot,
  ): LocalSnapshot {
    const token: NpcLocalSnapshotRead = Object.freeze({ kind: 'NPC_LOCAL_SNAPSHOT_READ' });
    const cell: LocalSnapshotReadCell = {
      kind,
      bindingText: s.canonical(binding),
      snapshotText: s.canonical(expectedSnapshot),
      calendar,
      guard: capturePriorLifeReadGuard(calendar),
      validateVersion: priorLifeCallable(readers, 'validateVersion'),
      initializeOpen: priorLifeCallable(readers, 'initializeOpen'),
      request: priorLifeCallable(NPC_GM_REQUEST_READERS, 'request'),
      entered: false,
    };
    localSnapshotReads.set(token, cell);
    try {
      call(token);
      assertLocalSnapshotRead(cell, binding, calendar);
      // An existing wrapper may deliberately forward only the original arguments.
      if (cell.result === undefined) return fresh();
      assertPriorLifeInputs(cell.result.nodes);
      if (cell.snapshotText !== s.canonical(cell.result.snapshot)) return s.fail('SOURCE_CHANGED');
      return cell.result.snapshot;
    } finally {
      localSnapshotReads.delete(token);
      delete cell.result;
    }
  }
  function checkedPriorLife(
    source: ReturnType<typeof initialStateSourceBasis>,
    previousRaw: unknown,
    calendar: NpcCalendarReadContext,
    guard: ReturnType<typeof capturePriorLifeReadGuard>,
    lifeText: string,
  ): NpcHumanoidLifeContext | null {
    assertPriorLifeReadGuard(guard, calendar);
    const previous = source.evidence.previousOrNull ?? fail('missing actual life predecessor');
    const history = source.priorHistory ?? fail('missing checked life history');
    const last = history.last ?? fail('missing checked previous life');
    const fresh = readNpcInventoryHistoryEvidenceInTransaction(
      db,
      previous.prefix.openAttempt.scope,
      previous.prefix.openAttempt.candidateNpcUuid,
      s.integer(previous.record['version']),
    );
    equal(fresh, history.actual, 'fresh complete prior life history');
    equal(last.record, previous.record, 'actual prior life record');
    equal(last.record['snapshot'], previousRaw, 'actual prior life snapshot');
    assertPriorLifeReadGuard(guard, calendar);
    if (s.canonical(last.life) !== lifeText) return s.fail('SOURCE_CHANGED');
    return last.life;
  }
  function preparedLife(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    commit: Readonly<{ operationId: string; committedAt: string }> | null,
  ): Readonly<{
    preview: NpcHumanoidLifePreview;
    state: NpcFormalLifeState;
    originCommitOperationId: string | null;
  }> | null {
    const rawSection = s.object(s.object(attempt.values)['initialState'])[
      'lifeStateConfirmationId'
    ];
    if (rawSection === undefined || s.object(rawSection)['kind'] === 'UNSET') return null;
    // V1 has no prior-life recomputation; its original path pays no sidecar guard cost.
    const priorGuard = attempt.targetOrNull === null ? null : capturePriorLifeReadGuard(calendar);
    // Reuse only this synchronous invocation's checked source. Original SET and saved origins
    // below keep their own historical attempt/calendar reads.
    const initialSource = initialStateSourceBasis(attempt, calendar);
    const priorLifeText =
      priorGuard === null ? null : s.canonical(initialSource.priorHistory?.last?.life ?? null);
    const basis = lifeBasisFromSource(attempt, calendar, initialSource),
      id = selectedLifeId(basis.draft);
    if (id === null) return null;
    const source =
      commit === null
        ? initialSource
        : effectInputBasisFromSource(attempt, calendar, initialSource);
    const previousRaw = source.evidence.previousOrNull?.record['snapshot'];
    const prior =
      previousRaw === undefined
        ? null
        : checkedPriorLife(
            initialSource,
            previousRaw,
            calendar,
            priorGuard ?? fail('missing prior life guard'),
            priorLifeText ?? fail('missing checked prior life text'),
          );
    const own = source.evidence.current.lifeStateOperations.find(
      (row) => row.operation.operationId === id,
    );
    const actual = readNpcLifeStatePreparationEvidenceInTransaction(
      db,
      attempt.scope,
      attempt.candidateNpcUuid,
      id,
    );
    const requested = npcLifeStateSetRequestInputValue(actual.request.preparation.input);
    const retain =
      own === undefined ||
      (requested.lifeKind === 'SEVERELY_WOUNDED' && prior?.history.lifeKind === 'SEVERELY_WOUNDED');
    const currentHP =
      commit === null
        ? previewEntered(basis.draft.initialState.currentHP, 'currentHP')
        : entered(basis.draft.initialState.currentHP, 'currentHP');
    const weaver = weaverSelectionFromSource(attempt, calendar, commit, false, () => source);
    const currentDuplicate =
      calendar.currentClock.campaignTimestampOrNull === null
        ? null
        : deriveNpcFunctionalDuplicateProof(sources.functionalDuplicate, {
            npcUuid: attempt.candidateNpcUuid,
            campaignTimestamp: calendar.currentClock.campaignTimestampOrNull,
            compositionProof: source.input.compositionProof,
            temporaryEffects: weaver?.contributions ?? [],
            ...(weaver === null ? {} : { campaignId: attempt.scope.campaignId }),
          });
    if (retain) {
      if (prior === null) return fail('life confirmation has no independently saved origin');
      if (own !== undefined) {
        const chosen = lifePreparation.selection(
          actual.request,
          actual.evidence.current.openAttempt,
          historicalCalendar(actual.operation, calendar),
        );
        if (chosen.kind !== 'SET' || chosen.allocateTimer)
          return fail('retained life SET changed origin');
      }
      const state = deriveNpcRetainedFormalLifeState(
        sources.formalLife,
        prior.history,
        {
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          currentHP,
          campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
        },
        prior.entryDuplicateProofOrNull,
        prior.history.lifeKind === 'SEVERELY_WOUNDED' ? currentDuplicate : null,
      );
      return {
        state,
        originCommitOperationId: prior.originCommitOperationId,
        preview: {
          kind: 'RETAINED',
          campaignId: attempt.scope.campaignId,
          npcUuid: attempt.candidateNpcUuid,
          campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
          history: prior.history,
          originCommitOperationId: prior.originCommitOperationId,
          entryDuplicateProofOrNull: prior.entryDuplicateProofOrNull,
          previousLifeKindOrNull: basis.previousKindOrNull,
          ...(weaver === null ? {} : { temporaryWeaverEffects: weaver.entries }),
        },
      };
    }
    const atSet = historicalCalendar(actual.operation, calendar);
    const chosen = lifePreparation.selection(
      actual.request,
      actual.evidence.current.openAttempt,
      atSet,
    );
    if (chosen.kind !== 'SET') return fail('life SET required');
    if (!s.same(chosen.basis.sourceSignature, basis.sourceSignature))
      throw new NpcOrdinaryPreviewInputError(
        'INVALID',
        'Состав или время после подтверждения состояния изменились. Подтвердите состояние заново; сохранённый D6 не перебрасывается.',
      );
    const children = actual.event.childAllocations;
    const severe = chosen.input.lifeKind === 'SEVERELY_WOUNDED';
    if (severe) {
      if (
        children.length !== 1 ||
        children[0]?.kind !== 'EFFECT_INSTANCE' ||
        !('sourceKind' in children[0]) ||
        children[0].sourceKind !== 'LIFE_TIMER'
      )
        return fail('actual severe timer allocation missing');
    } else equal(children, [], 'untimed initial life children');
    // PREPARE intent was checked above; a new saved boundary now names the actual COMMIT
    // for its selected Weaver origins instead of serializing a future origin at SET time.
    const duplicate = severe ? currentDuplicate : null;
    const history: NpcFormalLifeHistoryAnchor = {
      kind: 'GM_FORMAL_INITIAL_LIFE',
      campaignId: attempt.scope.campaignId,
      npcUuid: attempt.candidateNpcUuid,
      lifeKind: chosen.input.lifeKind,
      initialStateConfirmationId: id,
      reason: chosen.input.reason,
      createdAt: commit?.committedAt ?? actual.operation.committedAt,
      severeWoundOrNull: !severe
        ? null
        : {
            effectInstanceId: children[0]!.id,
            calendarAnchor: currentRuntimeCalendarAnchor(atSet),
            rollFact: (chosen.basis.rollFactOrNull ?? fail('missing real life D6')).fact,
            remainingMinutes:
              chosen.input.remainingMinutesOrNull ?? fail('missing explicit remaining life time'),
            duplicateAtEntry: readNpcFunctionalDuplicateProof(
              duplicate ?? fail('missing actual entry duplicate proof'),
            ),
          },
    };
    const state = createNpcFormalLifeState(
      sources.formalLife,
      history,
      {
        campaignId: attempt.scope.campaignId,
        npcUuid: attempt.candidateNpcUuid,
        currentHP,
        campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
      },
      duplicate,
    );
    return {
      state,
      originCommitOperationId: commit?.operationId ?? null,
      preview: {
        kind: 'PREPARED',
        sourceOperationId: id,
        campaignId: attempt.scope.campaignId,
        npcUuid: attempt.candidateNpcUuid,
        campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
        history,
        entryDuplicateProofOrNull: duplicate,
        previousLifeKindOrNull: basis.previousKindOrNull,
        ...(weaver === null ? {} : { temporaryWeaverEffects: weaver.entries }),
      },
    };
  }
  function lifeState(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ) {
    const time = evidenceClock(evidence, calendar, pending);
    const current =
      evidence.committedOrNull === null
        ? calendar
        : historicalCalendar(evidence.committedOrNull.operation, calendar);
    const prepared = preparedLife(evidence.current.openAttempt, current, {
      operationId: evidence.target.commitOperationId,
      committedAt: time.committedAt,
    });
    if (prepared === null) return null;
    const originCommitOperationId =
      prepared.originCommitOperationId ?? fail('committed life origin missing');
    const { preview, state } = prepared;
    const context: NpcHumanoidLifeContext = {
      campaignId: preview.campaignId,
      npcUuid: preview.npcUuid,
      campaignTimestampOrNull: preview.campaignTimestampOrNull,
      history: preview.history,
      entryDuplicateProofOrNull: preview.entryDuplicateProofOrNull,
      previousLifeKindOrNull: preview.previousLifeKindOrNull,
      commitOperationId: evidence.target.commitOperationId,
      originCommitOperationId,
      state,
      ...(preview.temporaryWeaverEffects === undefined
        ? {}
        : { temporaryWeaverEffects: preview.temporaryWeaverEffects }),
    };
    return {
      context,
      state,
      effects:
        preview.temporaryWeaverEffects?.map((entry) =>
          'effect' in entry ? entry.effect : fail('saved Weaver origin must be COMMITTED'),
        ) ?? [],
      proof: {
        commitOperationId: evidence.target.commitOperationId,
        originCommitOperationId,
        ...(preview.temporaryWeaverEffects === undefined
          ? {}
          : {
              temporaryWeaverAssignments: preview.temporaryWeaverEffects.map((entry) => ({
                effectInstanceId: entry.history.effectInstanceId,
                originCommitOperationId:
                  entry.origin.kind === 'COMMITTED'
                    ? entry.origin.originCommitOperationId
                    : fail('saved Weaver origin must be COMMITTED'),
              })),
            }),
      },
    };
  }
  function snapshotLifeContext(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidLifeContext | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'initialLifeProof')) return null;
    const proof = s.object(derivation['initialLifeProof'], [
      'commitOperationId',
      'originCommitOperationId',
      ...(Object.hasOwn(s.object(derivation['initialLifeProof']), 'temporaryWeaverAssignments')
        ? ['temporaryWeaverAssignments']
        : []),
    ]);
    const operationId = s.uuid(proof['commitOperationId']);
    let target: NpcDerivationTarget;
    if (pending !== null && pending.operationId === operationId)
      target = {
        scope: pending.scope,
        npcUuid: pending.npcUuid,
        npcDraftId: pending.npcDraftId,
        openAttemptRevision: pending.attemptRevision - 1,
        commitOperationId: operationId,
        targetVersion: pending.version,
      };
    else {
      const audit =
        calendar.operations.find((row) => row.operationId === operationId) ??
        fail('missing actual life COMMIT audit');
      const cause = readNpcGmPrimitiveCause(db, calendar.scope, {
        operationId,
        recordSha256: audit.operationSha256,
      });
      if (cause.operation.kind !== 'COMMIT' && cause.operation.kind !== 'COMMIT_V1')
        return fail('life owner must be COMMIT');
      const version = cause.operation.versionOrNull ?? fail('missing actual life version');
      target = {
        scope: calendar.scope,
        npcUuid: version.npcUuid,
        npcDraftId: cause.event.ref.npcDraftId,
        openAttemptRevision: cause.event.ref.revision - 1,
        commitOperationId: operationId,
        targetVersion: version.version,
      };
    }
    equal(target.npcUuid, s.uuid(snapshot['npcUuid']), 'actual life NPC identity');
    const actual =
      lifeState(readNpcVersionDerivationEvidenceInTransaction(db, target), calendar, pending) ??
      fail('life proof has no actual SET');
    equal(actual.proof, proof, 'actual life origin/target COMMIT');
    return actual.context;
  }
  function originalRuntimeEffect(
    effectInstanceId: string,
    scope: NpcAttempt['scope'],
    npcUuid: string,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ):
    | Readonly<{
        kind: 'ALCOHOL';
        effect: NpcAlcoholEffectInstance;
        history: NpcAlcoholHistoryAnchor;
        originCommitOperationId: string;
      }>
    | Readonly<{
        kind: 'HP_MODE';
        effect: NpcHpModeEffectInstance;
        history: NpcHpModeHistoryAnchor;
        originCommitOperationId: string;
      }>
    | Readonly<{
        kind: 'FORMAL_CONTROL';
        effect: NpcFormalControlEffectInstance;
        history: NpcFormalControlHistoryAnchor;
        originCommitOperationId: string;
      }> {
    const reservation = readNpcRuntimeEffectReservationEvidenceInTransaction(
        db,
        scope,
        npcUuid,
        effectInstanceId,
        pending,
      ),
      origin = reservation.origin;
    if (!selectedEffects(origin.current).includes(effectInstanceId))
      return fail('runtime effect absent from original COMMIT selection');
    const fact =
      origin.current.runtimeEffectReservations.find(
        (row) => row.effectInstanceId === effectInstanceId,
      ) ?? fail('missing original runtime preparation');
    equal(
      [fact.operationId, fact.npcDraftId, fact.attemptRevision, fact.eventSha256],
      [
        reservation.operationId,
        reservation.npcDraftId,
        reservation.attemptRevision,
        reservation.eventSha256,
      ],
      'runtime reservation origin',
    );
    const time = evidenceClock(origin, calendar, pending);
    if (
      fact.sourceKind === 'LIFE_TIMER' ||
      fact.sourceKind === 'WEAVER_STATE' ||
      fact.sourceKind === 'POISON_MODE'
    )
      return fail('source-specific state requires its separate original proof');
    const confirmation =
      origin.current.initialStateConfirmationOrNull ??
      fail('missing original initial-state confirmation');
    equal(
      s.object(confirmation.values)['initialState'],
      origin.current.openAttempt.values['initialState'],
      'original confirmed runtime input',
    );
    if (fact.sourceKind === 'ALCOHOL') {
      const basis = effectBasis(origin.current.openAttempt, calendar, {
        evidence: origin,
        pending,
      });
      const input = npcAlcoholPreparationRequestInputValue(fact.input);
      const result = createNpcAlcoholEffect(
        sources.alcoholEffects,
        {
          effectInstanceIdOrNull: effectInstanceId,
          createdAtOrNull: time.committedAt,
          effectiveZ: basis.basis.effectiveStats.Z,
          reason: input.reason,
        },
        {
          kind: 'NEW_FORMAL_ASSIGNMENT',
          targetActorId: npcUuid,
          campaignTimestampOrNull: time.clock.campaignTimestampOrNull,
          dead: false,
          poisonResponse: basis.basis.poisonResponse,
        },
      );
      if (result.kind !== 'ACTIVE')
        return fail('reserved alcohol no longer applicable at original COMMIT');
      const effect = result.effect;
      const history: NpcAlcoholHistoryAnchor = {
        effectInstanceId,
        targetActorId: npcUuid,
        createdAt: time.committedAt,
        effectiveZAtAssignment: basis.basis.effectiveStats.Z,
        startsAt: effect.startsAt,
        expiresAt: effect.expiresAt,
        nextTickAt: effect.tickSchedule.nextTickAt,
        lastTickAt: null,
        remainingExact: effect.remainingExact,
        revision: 1,
      };
      return {
        kind: 'ALCOHOL' as const,
        effect,
        history,
        originCommitOperationId: origin.target.commitOperationId,
      };
    }
    if (fact.sourceKind === 'FORMAL_CONTROL') {
      const input = npcFormalControlPreparationRequestInputValue(fact.input);
      equal(input.controlKind, fact.controlKind, 'formal control original kind');
      const basis = effectInputBasis(origin.current.openAttempt, calendar);
      const response = deriveNpcFormalControlComposition(
        sources.formalControlComposition,
        basis.input.compositionProof,
      );
      if (response.poisonControlResponse !== 'APPLICABLE')
        return fail('formal control immune at original COMMIT');
      const history: NpcFormalControlHistoryAnchor = {
        kind: 'GM_FORMAL_INITIAL_CONTROL',
        effectInstanceId,
        npcUuid,
        controlKind: fact.controlKind,
        initialStateConfirmationId: confirmation.operationId,
        reason: input.reason,
        createdAt: time.committedAt,
        calendarAnchor: traumaAnchor(origin, calendar, pending),
        remainingMinutes: input.remainingMinutes,
        revision: 1,
      };
      return {
        kind: 'FORMAL_CONTROL',
        history,
        originCommitOperationId: origin.target.commitOperationId,
        effect: createNpcFormalControlEffect(sources.formalControls, history, {
          npcUuid,
          campaignTimestamp:
            time.clock.campaignTimestampOrNull ?? fail('formal control origin time required'),
          dead: false,
        }),
      };
    }
    const input = npcHpModePreparationRequestInputValue(fact.input);
    const basis = effectInputBasis(origin.current.openAttempt, calendar);
    const history: NpcHpModeHistoryAnchor = {
      effectInstanceId,
      npcUuid,
      sourceInstanceId: fact.sourceInstanceId,
      mode: fact.mode,
      initialStateConfirmationId: confirmation.operationId,
      reason: input.reason,
      createdAt: time.committedAt,
      calendarAnchor: traumaAnchor(origin, calendar, pending),
      remainingMinutes: input.remainingMinutes,
      revision: 1,
    };
    const effect = createNpcInitialHpModeEffect(
      sources.hpModes,
      history,
      basis.hpSource ?? fail('actual complete HP mode source required'),
    );
    return {
      kind: 'HP_MODE' as const,
      effect,
      history,
      originCommitOperationId: origin.target.commitOperationId,
    };
  }
  function runtimeState(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ) {
    const ids = selectedEffects(evidence.current).filter(
      (id) =>
        !(
          'diseaseId' in
          readNpcEffectAllocationInTransaction(
            db,
            evidence.target.scope,
            evidence.target.npcUuid,
            id,
          )
        ),
    );
    if (ids.length === 0) return null;
    const entries = ids.map((id) =>
      originalRuntimeEffect(id, evidence.target.scope, evidence.target.npcUuid, calendar, pending),
    );
    const alcohol = entries.flatMap((entry) =>
      entry.kind === 'ALCOHOL'
        ? [
            {
              effect: entry.effect,
              history: entry.history,
              originCommitOperationId: entry.originCommitOperationId,
            },
          ]
        : [],
    );
    const hpModes = entries.flatMap((entry) =>
      entry.kind === 'HP_MODE'
        ? [
            {
              effect: entry.effect,
              history: entry.history,
              originCommitOperationId: entry.originCommitOperationId,
            },
          ]
        : [],
    );
    const context: NpcHumanoidRuntimeEffectContext = {
      npcUuid: evidence.target.npcUuid,
      commitOperationId: evidence.target.commitOperationId,
      campaignTimestampOrNull: evidenceClock(evidence, calendar, pending).clock
        .campaignTimestampOrNull,
      alcohol,
      hpModes,
      ...(entries.some((entry) => entry.kind === 'FORMAL_CONTROL')
        ? {
            formalControls: entries.flatMap((entry) =>
              entry.kind === 'FORMAL_CONTROL'
                ? [
                    {
                      effect: entry.effect,
                      history: entry.history,
                      originCommitOperationId: entry.originCommitOperationId,
                    },
                  ]
                : [],
            ),
          }
        : {}),
      hpModeSourceOrNull:
        hpModes.length === 0
          ? null
          : effectInputBasis(evidence.current.openAttempt, calendar).hpSource,
      provenHealingTimers: [],
    };
    return {
      context,
      effects: entries.map((entry) => entry.effect),
      proof: {
        commitOperationId: evidence.target.commitOperationId,
        assignments: entries.map((entry) => ({
          effectInstanceId: entry.effect.effectInstanceId,
          originCommitOperationId: entry.originCommitOperationId,
        })),
      },
    };
  }
  function snapshotRuntimeContext(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): NpcHumanoidRuntimeEffectContext | null {
    const snapshot = s.object(value),
      derivation = s.object(snapshot['derivation']);
    if (!Object.hasOwn(derivation, 'initialRuntimeProof')) return null;
    const operationId = s.uuid(s.object(derivation['initialRuntimeProof'])['commitOperationId']);
    let target: NpcDerivationTarget;
    if (pending !== null && pending.operationId === operationId)
      target = {
        scope: pending.scope,
        npcUuid: pending.npcUuid,
        npcDraftId: pending.npcDraftId,
        openAttemptRevision: pending.attemptRevision - 1,
        commitOperationId: operationId,
        targetVersion: pending.version,
      };
    else {
      const proof =
        calendar.operations.find((row) => row.operationId === operationId) ??
        fail('missing runtime snapshot COMMIT proof');
      const cause = readNpcGmPrimitiveCause(db, calendar.scope, {
        operationId,
        recordSha256: proof.operationSha256,
      });
      if (cause.operation.kind !== 'COMMIT' && cause.operation.kind !== 'COMMIT_V1')
        return fail('runtime snapshot owner is not COMMIT');
      const version =
        cause.operation.versionOrNull ?? fail('runtime snapshot version reference missing');
      target = {
        scope: calendar.scope,
        npcUuid: version.npcUuid,
        npcDraftId: cause.event.ref.npcDraftId,
        openAttemptRevision: cause.event.ref.revision - 1,
        commitOperationId: operationId,
        targetVersion: version.version,
      };
    }
    equal(target.npcUuid, s.uuid(snapshot['npcUuid']), 'runtime snapshot owner');
    return (
      runtimeState(readNpcVersionDerivationEvidenceInTransaction(db, target), calendar, pending)
        ?.context ?? fail('empty runtime snapshot origin')
    );
  }
  function runtimePreview(
    attempt: NpcAttempt,
    calendar: NpcCalendarReadContext,
    calendarAnchorOrNull: NpcInitialTraumaCalendarAnchor | null,
  ): NpcHumanoidRuntimeEffectPreview | null {
    const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, attempt);
    const ids = selectedEffects(evidence.current).filter(
      (id) =>
        !(
          'diseaseId' in
          readNpcEffectAllocationInTransaction(db, attempt.scope, attempt.candidateNpcUuid, id)
        ),
    );
    if (ids.length === 0) return null;
    if (calendar.currentClock.campaignTimestampOrNull === null)
      throw new NpcOrdinaryPreviewInputError(
        'INCOMPLETE',
        'Подтвердите время кампании для действующего эффекта',
      );
    const basis = effectBasis(attempt, calendar);
    const alcohol: NpcHumanoidRuntimeEffectPreview['alcohol'][number][] = [];
    const formalControls: NonNullable<NpcHumanoidRuntimeEffectPreview['formalControls']>[number][] =
      [];
    const hpModes = basis.hpModes.entries;
    for (const effectInstanceId of ids) {
      const allocation = readNpcEffectAllocationInTransaction(
        db,
        attempt.scope,
        attempt.candidateNpcUuid,
        effectInstanceId,
      );
      if ('sourceKind' in allocation && allocation.sourceKind === 'HP_MODE') continue;
      const prepared = evidence.current.runtimeEffectReservations.find(
        (row) => row.effectInstanceId === effectInstanceId,
      );
      if ('sourceKind' in allocation && allocation.sourceKind === 'FORMAL_CONTROL') {
        if (prepared === undefined) {
          const entry = originalRuntimeEffect(
            effectInstanceId,
            attempt.scope,
            attempt.candidateNpcUuid,
            calendar,
            null,
          );
          if (entry.kind !== 'FORMAL_CONTROL')
            return fail('preview formal control source mismatch');
          formalControls.push({
            kind: 'RETAINED',
            effect: entry.effect,
            history: entry.history,
            originCommitOperationId: entry.originCommitOperationId,
          });
        } else {
          if (prepared.sourceKind !== 'FORMAL_CONTROL')
            return fail('prepared formal control source mismatch');
          const cause = preparedRuntimeCause(prepared, attempt.scope, calendar);
          const input = npcFormalControlPreparationRequestInputValue(prepared.input);
          equal(input.controlKind, prepared.controlKind, 'preview prepared control kind');
          formalControls.push({
            kind: 'PREPARED',
            sourceOperationId: prepared.operationId,
            preparedAt: cause.operation.committedAt,
            effectInstanceId,
            controlKind: prepared.controlKind,
            remainingMinutes: input.remainingMinutes,
            reason: input.reason,
          });
        }
        continue;
      }
      if (prepared === undefined) {
        const entry = originalRuntimeEffect(
          effectInstanceId,
          attempt.scope,
          attempt.candidateNpcUuid,
          calendar,
          null,
        );
        if (entry.kind !== 'ALCOHOL') return fail('preview alcohol source mismatch');
        alcohol.push({
          kind: 'RETAINED',
          effect: entry.effect,
          history: entry.history,
          originCommitOperationId: entry.originCommitOperationId,
        });
        continue;
      }
      const cause = preparedRuntimeCause(prepared, attempt.scope, calendar);
      if (prepared.sourceKind === 'ALCOHOL') {
        const input = npcAlcoholPreparationRequestInputValue(prepared.input);
        alcohol.push({
          kind: 'PREPARED',
          sourceOperationId: prepared.operationId,
          preparedAt: cause.operation.committedAt,
          effectInstanceId,
          reason: input.reason,
        });
      } else return fail('preview alcohol preparation mismatch');
    }
    return {
      npcUuid: attempt.candidateNpcUuid,
      campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
      calendarAnchorOrNull,
      preparationBasis: basis.basis,
      alcohol,
      hpModes,
      ...(formalControls.length === 0 ? {} : { formalControls }),
      hpModeSourceOrNull: hpModes.length === 0 ? null : basis.hpSource,
      provenHealingTimers: [],
    };
  }
  function currentConfirmedInventory(
    evidence: Pick<NpcVersionDerivationEvidence, 'current' | 'initialOrNull' | 'previousOrNull'>,
    current: NpcEditorDraft,
    calendar: NpcCalendarReadContext,
    inheritedSnapshotOrNull: ReturnType<typeof readSnapshot> | null,
  ) {
    const input = projectNpcInventoryRequest(
      editorAt(evidence, evidence.current, calendar, inheritedSnapshotOrNull),
      current.inventory,
    );
    const confirmed =
      evidence.current.inventoryConfirmationOrNull ?? fail('missing current NPC015 confirmation');
    const checkedEditor = editorAt(
      evidence,
      evidence.current,
      calendar,
      inheritedSnapshotOrNull,
      confirmed.attemptRevision,
      confirmed.operationId,
    );
    equal(
      projectNpcInventoryRequest(
        checkedEditor,
        readNpcEditorDraft(checkedEditor, confirmed.values).inventory,
      ),
      input,
      'current confirmed inventory',
    );
    return { input, confirmed };
  }
  function confirmedInventory(
    evidence: Pick<NpcVersionDerivationEvidence, 'current' | 'initialOrNull' | 'previousOrNull'>,
    current: NpcEditorDraft,
    priorSnapshot: NpcCleanHumanoidSnapshot | NpcHumanoidSnapshot | null,
    calendar: NpcCalendarReadContext,
    inheritedSnapshotOrNull: ReturnType<typeof readSnapshot> | null,
  ) {
    const input = projectNpcInventoryRequest(
      editorAt(evidence, evidence.current, calendar, inheritedSnapshotOrNull),
      current.inventory,
    );
    if (input.length === 0) {
      if (priorSnapshot !== null && priorSnapshot.sheet.input.inventory.length !== 0)
        throw new NpcOrdinaryPreviewInputError('NOT_YET_SUPPORTED', 'saved inventory change');
      return {
        input,
        confirmed: null,
        originalRequests: input,
        originalPrefix: evidence.initialOrNull?.prefix ?? evidence.current,
      };
    }
    if (priorSnapshot !== null && priorSnapshot.format !== 'NPC_HUMANOID_V1')
      throw new NpcOrdinaryPreviewInputError(
        'NOT_YET_SUPPORTED',
        'adding inventory to a saved clean version',
      );
    const initial = evidence.initialOrNull;
    const originalPrefix = initial?.prefix ?? evidence.current;
    const confirmed =
      originalPrefix.inventoryConfirmationOrNull ?? fail('missing original NPC015 confirmation');
    const originalEditor = editorAt(
      evidence,
      originalPrefix,
      calendar,
      null,
      confirmed.attemptRevision,
      confirmed.operationId,
    );
    const originalDraft = readNpcEditorDraft(originalEditor, confirmed.values);
    const originalRequests = projectNpcInventoryRequest(originalEditor, originalDraft.inventory);
    if (!s.same(input, originalRequests))
      throw new NpcOrdinaryPreviewInputError(
        'NOT_YET_SUPPORTED',
        'changed original inventory inputs',
      );
    const nowConfirmed =
      evidence.current.inventoryConfirmationOrNull ?? fail('missing current NPC015 confirmation');
    const currentEditor = editorAt(
      evidence,
      evidence.current,
      calendar,
      inheritedSnapshotOrNull,
      nowConfirmed.attemptRevision,
      nowConfirmed.operationId,
    );
    equal(
      projectNpcInventoryRequest(
        currentEditor,
        readNpcEditorDraft(currentEditor, nowConfirmed.values).inventory,
      ),
      input,
      'current confirmed inventory',
    );
    return { input, confirmed, originalRequests, originalPrefix };
  }
  function inventoryProof(
    evidence: NpcVersionDerivationEvidence,
    current: NpcEditorDraft,
    initialInput: NpcInitialInventoryPreparation | undefined,
    candidate: NpcVersion | null,
    calendar: NpcCalendarReadContext,
    priorSnapshot: ReturnType<typeof readSnapshot> | null,
    inheritedSnapshotOrNull: ReturnType<typeof readSnapshot> | null,
    pending: NpcPendingCommitEvidence | null,
    coatingContext: NpcInventoryCoatingContext | null,
  ): NpcInventoryPublicationProof | null {
    // Old published snapshots deliberately retain their exact V1 proof. New N+1 writes
    // bind the actual predecessor and current NPC-015 confirmation, including an empty list.
    const candidateDerivation =
      candidate === null ? null : s.object(candidate.snapshot['derivation']);
    const legacyCandidate =
      candidateDerivation !== null &&
      (!Object.hasOwn(candidateDerivation, 'inventoryProof') ||
        !Object.hasOwn(s.object(candidateDerivation['inventoryProof']), 'previous'));
    if (evidence.target.targetVersion > 1 && !legacyCandidate) {
      const context = inventoryHistoryContext(
        evidence.target.scope,
        evidence.target.npcUuid,
        evidence.target.targetVersion - 1,
        calendar,
      );
      const last = context.history.at(-1) ?? fail('missing actual previous inventory');
      const { input, confirmed } = currentConfirmedInventory(
        evidence,
        current,
        calendar,
        inheritedSnapshotOrNull,
      );
      const plan = planNpcInventoryWeaponVersions(
        sources.inventoryPublication,
        input,
        context,
        coatingContext,
      );
      const expectedAllocations = plan.filter((entry) => entry.kind === 'ALLOCATE');
      const actualCause =
        evidence.committedOrNull === null
          ? null
          : readNpcGmPrimitiveCause(db, evidence.target.scope, {
              operationId: evidence.target.commitOperationId,
              recordSha256:
                calendar.operations.find(
                  (operation) => operation.operationId === evidence.target.commitOperationId,
                )?.operationSha256 ?? fail('missing actual inventory COMMIT cause'),
            });
      const pendingCandidateAllocations = () => {
        if (candidate === null || pending === null || initialInput !== undefined) return [];
        const entries = s.object(candidateDerivation?.['inventoryProof'])['entries'];
        if (!Array.isArray(entries)) return fail('missing pending inventory profile claims');
        // These are new-ID claims only, not a historical source. The enclosing writer checks
        // each against its actual pending COMMIT child allocation before any transaction commits.
        return expectedAllocations.map((expected) => {
          const matches = entries.filter(
            (entry) =>
              s.object(s.object(entry)['request'])['itemInstanceId'] === expected.itemInstanceId,
          );
          if (matches.length !== 1) return fail('pending profile claim coverage');
          return {
            itemInstanceId: expected.itemInstanceId,
            weaponProfileVersionId: s.uuid(s.object(matches[0])['weaponProfileVersionId']),
          };
        });
      };
      const allocations =
        actualCause === null
          ? (initialInput?.profiles ?? pendingCandidateAllocations())
          : actualCause.event.childAllocations
              .filter((child) => child.kind === 'WEAPON_PROFILE_VERSION')
              .map((child) => ({
                itemInstanceId: child.itemInstanceId,
                weaponProfileVersionId: child.id,
              }));
      equal(
        allocations.map((entry) => entry.itemInstanceId),
        expectedAllocations.map((entry) => entry.itemInstanceId),
        'ordered revision weapon allocations',
      );
      const proof: NpcInventoryPublicationProof = {
        ...coatingOrigins(coatingContext, input),
        npcUuid: evidence.target.npcUuid,
        commitOperationId: evidence.target.commitOperationId,
        sourceOperationId: confirmed.operationId,
        actorId: evidence.current.masterProfileId,
        committedAt: evidenceClock(evidence, calendar, pending).committedAt,
        previous: {
          npcUuid: last.npcUuid,
          version: last.version,
          sha256: last.sha256,
          commitOperationId: last.commitOperationId,
        },
        entries: input.map((request, index) => {
          const decision = plan[index] ?? fail('missing revision item plan');
          equal(decision.itemInstanceId, request.itemInstanceId, 'ordered revision item plan');
          return {
            request,
            weaponProfileVersionId:
              decision.kind === 'ABSENT'
                ? null
                : decision.kind === 'RETAIN'
                  ? decision.weaponProfileVersionId
                  : (allocations.find(
                      (allocation) => allocation.itemInstanceId === request.itemInstanceId,
                    )?.weaponProfileVersionId ?? fail('missing new revision profile identity')),
          };
        }),
      };
      if (candidate !== null)
        equal(
          proof,
          candidateDerivation?.['inventoryProof'],
          'actual revision inventory provenance',
        );
      return buildNpcInventoryPublication(
        sources.inventoryPublication,
        proof,
        context,
        coatingContext,
      ).proof;
    }
    const initial = evidence.initialOrNull;
    const { input, confirmed, originalRequests, originalPrefix } = confirmedInventory(
      evidence,
      current,
      priorSnapshot,
      calendar,
      inheritedSnapshotOrNull,
    );
    if (input.length === 0) {
      if (initialInput !== undefined) return fail('unexpected empty inventory allocations');
      return null;
    }
    if (confirmed === null) return fail('missing original NPC015 confirmation');
    let proof: NpcInventoryPublicationProof;
    if (priorSnapshot !== null) {
      if (priorSnapshot.format !== 'NPC_HUMANOID_V1' || initialInput !== undefined)
        return fail('adding inventory to a saved clean version is not yet implemented');
      proof = priorSnapshot.derivation.inventoryProof;
    } else {
      if (evidence.target.targetVersion !== 1)
        return fail('new physical inventory requires lazy COMMIT profile allocations');
      const preview = buildNpcInventoryPreview(
        sources.inventoryPublication,
        input,
        null,
        coatingContext,
      );
      const weapons = preview.items.filter((item) => 'stagedProfile' in item);
      const allocations = initialInput?.profiles ?? [];
      if (allocations.length !== weapons.length) return fail('profile allocation coverage');
      if (weapons.length !== 0 && initialInput === undefined)
        return fail('new weapon inventory requires lazy COMMIT profile allocations');
      equal(
        allocations.map((a) => a.itemInstanceId),
        weapons.map((p) => p.request.itemInstanceId),
        'ordered weapon allocation coverage',
      );
      proof = {
        ...coatingOrigins(coatingContext, input),
        npcUuid: evidence.target.npcUuid,
        commitOperationId: evidence.target.commitOperationId,
        sourceOperationId: confirmed.operationId,
        actorId: originalPrefix.masterProfileId,
        committedAt:
          initialInput?.committedAt ?? evidenceClock(evidence, calendar, pending).committedAt,
        entries: preview.items.map((item) => {
          const request = item.request;
          if (!('stagedProfile' in item)) return { request, weaponProfileVersionId: null };
          const allocation =
            allocations.find((a) => a.itemInstanceId === request.itemInstanceId) ??
            fail('missing profile allocation');
          equal(allocation.itemInstanceId, request.itemInstanceId, 'allocated physical item');
          return { request, weaponProfileVersionId: allocation.weaponProfileVersionId };
        }),
      };
    }
    equal(
      [
        proof.npcUuid,
        proof.commitOperationId,
        proof.sourceOperationId,
        proof.actorId,
        proof.entries.map((e) => e.request),
      ],
      [
        evidence.target.npcUuid,
        initial?.operation.operationId ?? evidence.target.commitOperationId,
        confirmed.operationId,
        originalPrefix.masterProfileId,
        originalRequests,
      ],
      'actual initial inventory provenance',
    );
    const timestamp =
      initial?.operation.committedAt ??
      candidate?.committedAt ??
      initialInput?.committedAt ??
      pending?.committedAt ??
      fail('missing actual commit timestamp');
    equal(proof.committedAt, timestamp, 'original inventory audit timestamp');
    return buildNpcInventoryPublication(sources.inventoryPublication, proof, null, coatingContext)
      .proof;
  }
  function coatingOrigins(
    context: NpcInventoryCoatingContext | null,
    requests: readonly NpcInventoryRequestEntry[],
  ): Pick<NpcInventoryPublicationProof, 'coatingOrigins' | 'archivedCoatingPreparations'> {
    if (context === null) return {};
    const selection = readNpcInventoryCoatingSelection(
      sources.inventoryPublication,
      context,
      requests,
      {
        npcUuid: context.npcUuid,
        commitOperationId:
          context.targetCommitOperationIdOrNull ?? fail('saved coating target required'),
      },
    );
    return {
      coatingOrigins: selection.origins,
      ...(selection.archivedPreparations.length === 0
        ? {}
        : { archivedCoatingPreparations: selection.archivedPreparations }),
    };
  }
  function emptyInventoryProof(
    evidence: NpcVersionDerivationEvidence,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
    coatingContext: NpcInventoryCoatingContext | null = null,
  ): NpcInventoryPublicationProof {
    const initial = evidence.initialOrNull;
    const prefix = initial?.prefix ?? evidence.current;
    const confirmation =
      prefix.inventoryConfirmationOrNull ?? fail('missing original empty inventory confirmation');
    const original = readNpcEditorDraft(
      editorAt(
        evidence,
        prefix,
        calendar,
        null,
        confirmation.attemptRevision,
        confirmation.operationId,
      ),
      confirmation.values,
    );
    empty(original.inventory, 'original empty inventory');
    return buildNpcInventoryPublication(
      sources.inventoryPublication,
      {
        ...coatingOrigins(coatingContext, []),
        npcUuid: evidence.target.npcUuid,
        commitOperationId: initial?.operation.operationId ?? evidence.target.commitOperationId,
        sourceOperationId: confirmation.operationId,
        actorId: prefix.masterProfileId,
        committedAt:
          initial?.operation.committedAt ?? evidenceClock(evidence, calendar, pending).committedAt,
        entries: [],
      },
      null,
      coatingContext,
    ).proof;
  }
  function materializedDiseaseState(context: NpcHumanoidInitialStateContext) {
    const effects = context.origins.map((origin) => {
      const scope = {
        targetActorId: context.npcUuid,
        campaignTimestampOrNull: origin.campaignTimestamp,
        dead: false,
      };
      return origin.diseaseId === 'DIS-PNEUMONIA'
        ? createNpcPneumoniaEffect(
            sources.diseaseEffects,
            { effectInstanceId: origin.effectInstanceId, createdAt: origin.committedAt },
            scope,
          )
        : createNpcUntimedDiseaseEffect(
            sources.nonperiodicDiseases,
            {
              effectInstanceId: origin.effectInstanceId,
              diseaseId: origin.diseaseId,
              createdAt: origin.committedAt,
            },
            scope,
          );
    });
    return {
      context,
      effects,
      proof: {
        commitOperationId: context.commitOperationId,
        assignments: context.origins.map((o) => ({
          effectInstanceId: o.effectInstanceId,
          originOperationId: o.originOperationId,
        })),
      },
    };
  }
  function derive(
    draft: NpcEditorDraft,
    original: NpcEditorDraft,
    evidence: NpcVersionDerivationEvidence,
    publication: NpcInventoryPublicationProof | null,
    disease: ReturnType<typeof materializedDiseaseState> | null = null,
    trauma: ReturnType<typeof traumaState> | null = null,
    ordinary: NpcCompositionAuthoringState | null = null,
    wounds: NpcHumanoidWoundContext | null = null,
    equipment: ReturnType<typeof equipmentForDraft> = null,
    runtime: ReturnType<typeof runtimeState> = null,
    inventoryContext: NpcInventoryPublicationContext | null = null,
    life: ReturnType<typeof lifeState> = null,
    poison: ReturnType<typeof poisonState> = null,
  ): NpcCleanHumanoidSnapshot | NpcHumanoidSnapshot {
    if (ordinary !== null) {
      supported(draft, true);
      sameMechanics(draft, original);
      const complete = deriveNpcCompositionSkills(
        sources,
        ordinary,
        original,
        evidence.current.skillConfirmation.operationId,
        evidence.target.commitOperationId,
      );
      const currentInventoryStats = npcCompositionInventoryStats(
        sources,
        ordinary,
        complete.ordinaryProof,
      );
      const person = identity(draft);
      if (publication === null)
        return fail('ordinary publication needs actual empty inventory provenance');
      const published = buildNpcInventoryPublication(
        sources.inventoryPublication,
        publication,
        inventoryContext,
        poison?.context.coatingContext ?? null,
      );
      return buildNpcHumanoidSnapshot(
        sources.humanoid,
        {
          npcUuid: evidence.target.npcUuid,
          owningControllerId: evidence.target.scope.gmLocalContextId,
          skillProof: complete.skills.proof,
          compositionProof: complete.composition.proof,
          ordinaryProof: currentInventoryStats.ordinaryProof,
          inventoryProof: published.proof,
          input: {
            identity: person,
            baseStats: stats(draft),
            symbionts: complete.symbionts.map(
              ({
                symbiontInstanceId,
                speciesKey,
                targetLevel,
                learnedNodeRefs,
                binding,
                currentOE,
              }) => ({
                symbiontInstanceId,
                speciesKey,
                targetLevel,
                learnedNodeRefs,
                binding,
                currentOE,
              }),
            ),
            skills: complete.skills.ledger,
            lifetimeFacts: complete.composition.lifetimeFacts,
            inventory: published.input,
            initialState: {
              currentHP: entered(draft.initialState.currentHP, 'currentHP'),
              dead: life?.state.dead ?? false,
              currentTraumas: trauma?.facts.map((f) => f.trauma) ?? [],
              currentWounds: wounds?.facts.map((f) => f.wound) ?? [],
              effectInstances: [
                ...(disease?.effects ?? []),
                ...(runtime?.effects ?? []),
                ...(life?.effects ?? []),
                ...(life?.state.deathTimerOrNull == null ? [] : [life.state.deathTimerOrNull]),
              ],
              sourceSpecificStates: [
                ...(life === null ? [] : [life.state]),
                ...(poison?.states ?? []),
              ],
              deathTimerRollFactOrNull: life?.state.anchor.severeWoundOrNull?.rollFact ?? null,
            },
          },
          ...(disease === null ? {} : { initialStateProof: disease.proof }),
          ...(trauma === null ? {} : { initialTraumaProof: trauma.proof }),
          ...(wounds === null
            ? {}
            : {
                initialWoundProof: {
                  assignments: wounds.facts.map((f) => ({
                    woundInstanceId: f.wound.woundInstanceId,
                    originOperationId: f.sourceOperationId,
                  })),
                },
              }),
          ...(equipment === null ? {} : { equipmentProof: equipment.proof }),
          ...(runtime === null ? {} : { initialRuntimeProof: runtime.proof }),
          ...(life === null ? {} : { initialLifeProof: life.proof }),
          ...(poison === null
            ? {}
            : { initialPoisonProof: poison.proof ?? fail('saved poison proof missing') }),
        },
        disease?.context ?? null,
        trauma?.context ?? null,
        equipment?.context ?? null,
        wounds,
        runtime?.context ?? null,
        inventoryContext,
        life?.context ?? null,
        poison?.context ?? null,
      );
    }
    supported(draft);
    // NPC-014 precedes inventory/initial-state entry; only its completed mechanical inputs are proof.
    empty(original.symbionts, 'confirmed symbionts');
    sameMechanics(draft, original);
    const person = identity(draft),
      originalPerson = identity(original);
    if (person.raceCode !== 'PURE' || originalPerson.raceCode !== 'PURE')
      return fail('unsupported race');
    const initialPrefix = evidence.initialOrNull?.prefix ?? evidence.current;
    const initialCommit =
      evidence.initialOrNull?.operation.operationId ?? evidence.target.commitOperationId;
    const selected = entered(original.skills, 'skills').map((selection) => {
      const pool = entered(selection.pool, 'skill pool');
      if (pool !== 'START') return fail('unsupported TRAINING history');
      return {
        skillKey: entered(selection.skillKey, 'skill'),
        targetBonus: entered(selection.targetBonus, 'skill bonus'),
        pool,
      };
    });
    const skills = deriveNpcPureInitialSkills(
      { baseStats: sources.baseStats, skills: sources.skills },
      {
        npcUuid: evidence.target.npcUuid,
        commitOperationId: initialCommit,
        contextFactId: initialPrefix.skillConfirmation.operationId,
        schema: {
          raceCode: originalPerson.raceCode,
          pureClassOrNull: originalPerson.pureClassOrNull,
          anatomyProfileId: originalPerson.anatomyProfileId,
          sex: originalPerson.sex,
          massKg: originalPerson.massKg,
        },
        baseStats: stats(original),
        selections: selected,
      },
    );
    const composition = evaluateNpcCompositionConsequences(
      sources.compositionConsequences,
      {
        identityKey: evidence.target.npcUuid,
        binding: { journalId: initialPrefix.rootOperationId, raceCode: originalPerson.raceCode },
        confirmations: [],
        resolutions: [],
      },
      null,
    );
    const input = {
      npcUuid: evidence.target.npcUuid,
      owningControllerId: evidence.target.scope.gmLocalContextId,
      skillProof: skills.proof,
      compositionProof: composition.proof,
      input: {
        identity: person,
        baseStats: stats(draft),
        symbionts: [],
        skills: skills.ledger,
        lifetimeFacts: composition.lifetimeFacts,
        inventory: [],
        initialState: {
          currentHP: entered(draft.initialState.currentHP, 'currentHP'),
          dead: life?.state.dead ?? false,
          currentTraumas: trauma?.facts.map((f) => f.trauma) ?? [],
          currentWounds: wounds?.facts.map((f) => f.wound) ?? [],
          effectInstances: [
            ...(disease?.effects ?? []),
            ...(runtime?.effects ?? []),
            ...(life?.effects ?? []),
            ...(life?.state.deathTimerOrNull == null ? [] : [life.state.deathTimerOrNull]),
          ],
          sourceSpecificStates: [...(life === null ? [] : [life.state]), ...(poison?.states ?? [])],
          deathTimerRollFactOrNull: life?.state.anchor.severeWoundOrNull?.rollFact ?? null,
        },
      },
    };
    if (publication === null) {
      empty(draft.inventory, 'inventory');
      if (
        disease !== null ||
        trauma !== null ||
        wounds !== null ||
        runtime !== null ||
        life !== null ||
        poison !== null
      )
        return fail('initial state requires exact empty inventory provenance');
      return buildNpcCleanHumanoidSnapshot(sources.cleanHumanoid, input);
    }
    const published = buildNpcInventoryPublication(
      sources.inventoryPublication,
      publication,
      inventoryContext,
      poison?.context.coatingContext ?? null,
    );
    return buildNpcHumanoidSnapshot(
      sources.humanoid,
      {
        ...input,
        input: { ...input.input, inventory: published.input },
        inventoryProof: published.proof,
        ...(disease === null ? {} : { initialStateProof: disease.proof }),
        ...(trauma === null ? {} : { initialTraumaProof: trauma.proof }),
        ...(wounds === null
          ? {}
          : {
              initialWoundProof: {
                assignments: wounds.facts.map((f) => ({
                  woundInstanceId: f.wound.woundInstanceId,
                  originOperationId: f.sourceOperationId,
                })),
              },
            }),
        ...(equipment === null ? {} : { equipmentProof: equipment.proof }),
        ...(runtime === null ? {} : { initialRuntimeProof: runtime.proof }),
        ...(life === null ? {} : { initialLifeProof: life.proof }),
        ...(poison === null
          ? {}
          : { initialPoisonProof: poison.proof ?? fail('saved poison proof missing') }),
      },
      disease?.context ?? null,
      trauma?.context ?? null,
      equipment?.context ?? null,
      wounds,
      runtime?.context ?? null,
      inventoryContext,
      life?.context ?? null,
      poison?.context ?? null,
    );
  }
  function art(
    draft: NpcEditorDraft,
    stored: NpcStoredDerivationVersion | null,
    previous: NpcStoredDerivationVersion | null,
    prefix: NpcDerivationPrefix,
  ): NpcResolvedArt {
    const person = identity(draft);
    const uploaded = person.artAssetKeyOrNull?.startsWith('npc-upload:')
      ? (prefix.artUploads
          .map((entry) => readNpcUploadedArt(entry.file))
          .find((entry) => entry.assetKey === person.artAssetKeyOrNull) ?? null)
      : null;
    if (
      person.artAssetKeyOrNull?.startsWith('npc-upload:') &&
      uploaded === null &&
      previous?.art['assetKey'] !== person.artAssetKeyOrNull
    )
      return fail('uploaded art has no owning preparation or exact inherited version');
    // Historical bytes, including uploads, are checked independently of today's default choice.
    if (stored !== null) {
      const found = readNpcRetainedArt(artCatalog, stored.art);
      if (uploaded !== null) equal(found, uploaded, 'original uploaded bytes');
      if (person.artAssetKeyOrNull !== null) {
        equal(person.artAssetKeyOrNull, found.assetKey, 'entered art key');
        return found;
      }
      const expected = resolveNpcVersionArt(
        artCatalog,
        { kind: 'REPLACE', value: null },
        {
          raceCode: person.raceCode,
          sex: person.sex,
          previousArtOrNull: null,
        },
      );
      equal(found, expected, 'explicit default art');
      return found;
    }
    if (previous !== null && person.artAssetKeyOrNull === previous.art['assetKey'])
      return readNpcRetainedArt(artCatalog, previous.art);
    if (uploaded !== null) return uploaded;
    return resolveNpcVersionArt(
      artCatalog,
      {
        kind: 'REPLACE',
        value:
          person.artAssetKeyOrNull === null
            ? null
            : { kind: 'asset-key', assetKey: person.artAssetKeyOrNull },
      },
      { raceCode: person.raceCode, sex: person.sex, previousArtOrNull: null },
    );
  }
  function resolve(
    attempt: NpcAttempt,
    operationId: string,
    previous: NpcVersion | null,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
    initialInventory?: NpcInitialInventoryPreparation,
    candidate: NpcVersion | null = null,
  ): {
    prepared: NpcOrdinaryPreparedVersion;
    evidence: NpcVersionDerivationEvidence;
    derivedSnapshot: ReturnType<typeof readSnapshot>;
    previousSnapshot: ReturnType<typeof readSnapshot> | null;
  } {
    requireCalendar(calendar, attempt.scope);
    if (attempt.status !== 'OPEN' || attempt.stage !== 'NPC-017')
      return fail('closed/open final attempt required');
    const target: NpcDerivationTarget = {
      scope: attempt.scope,
      npcUuid: attempt.candidateNpcUuid,
      npcDraftId: attempt.npcDraftId,
      openAttemptRevision: attempt.revision,
      commitOperationId: operationId,
      targetVersion: previous === null ? 1 : previous.version + 1,
    };
    const evidence = readNpcVersionDerivationEvidenceInTransaction(db, target);
    equal(evidence.current.openAttempt, attempt, 'actual open attempt');
    equal(evidence.previousOrNull?.record ?? null, previous, 'actual previous version');
    const previousSnapshot = previous === null ? null : readSnapshot(previous.snapshot, calendar);
    // Consumers share this current prefix; historical confirmations keep their own context.
    const currentContext = contextAt(evidence, evidence.current, calendar, previousSnapshot);
    const currentEditor = npcEditorForItemAttempt(editor, sources.inventory, currentContext);
    const current = readNpcEditorDraft(currentEditor, attempt.values);
    const confirmation = evidence.current.skillConfirmation;
    const currentConfirmed = readNpcEditorDraft(
      editorAt(
        evidence,
        evidence.current,
        calendar,
        previousSnapshot,
        confirmation.attemptRevision,
        confirmation.operationId,
      ),
      confirmation.values,
    );
    sameMechanics(current, currentConfirmed);
    const initialPrefix = evidence.initialOrNull?.prefix ?? evidence.current;
    const initialConfirmation = initialPrefix.skillConfirmation;
    const original = readNpcEditorDraft(
      editorAt(
        evidence,
        initialPrefix,
        calendar,
        null,
        initialConfirmation.attemptRevision,
        initialConfirmation.operationId,
      ),
      initialConfirmation.values,
    );
    const hasPriorDiseaseState =
      previousSnapshot?.format === 'NPC_HUMANOID_V1' &&
      previousSnapshot.derivation.initialStateProof !== undefined;
    const disease =
      selectedDiseaseEffects(evidence.current).length !== 0 || hasPriorDiseaseState
        ? materializedDiseaseState(diseaseContext(evidence, calendar, pending))
        : null;
    const hasPriorTrauma =
      previousSnapshot?.format === 'NPC_HUMANOID_V1' &&
      previousSnapshot.derivation.initialTraumaProof !== undefined;
    const trauma =
      selectedTraumas(evidence.current).length !== 0 || hasPriorTrauma
        ? traumaState(evidence, calendar, pending)
        : null;
    if (trauma !== null) {
      const checked = projectNpcInitialTraumaInput(currentEditor, current.initialState);
      equal(
        checked.currentTraumas,
        trauma.facts.map((f) => f.trauma),
        'current source trauma input',
      );
      const confirmation =
        evidence.current.initialStateConfirmationOrNull ??
        fail('missing actual NPC016 confirmation');
      equal(
        s.object(confirmation.values)['initialState'],
        current.initialState,
        'confirmed current initial state',
      );
    }
    const initial = evidence.initialOrNull;
    // Initial V1 and previous V2 are distinct at N+1. Reuse only an exactly equal complete record.
    const inventorySnapshot =
      initial === null
        ? candidate === null
          ? null
          : readSnapshot(candidate.snapshot, calendar, pending)
        : previousSnapshot !== null && s.same(initial.record, previous)
          ? previousSnapshot
          : readSnapshot(initial.record['snapshot'], calendar);
    const poison = poisonState(evidence, calendar, pending);
    let publication = inventoryProof(
      evidence,
      current,
      initialInventory,
      candidate,
      calendar,
      inventorySnapshot,
      previousSnapshot,
      pending,
      poison?.context.coatingContext ?? null,
    );
    const ordinary =
      evidence.current.ordinaryFacts.length !== 0 ||
      (previousSnapshot?.format === 'NPC_HUMANOID_V1' &&
        previousSnapshot.derivation.ordinaryProof !== undefined)
        ? compositionState(attempt, currentContext, calendar)
        : null;
    const wounds = woundState(evidence, pending);
    const equipment = equipmentForDraftWithContext(
      evidence,
      current,
      calendar,
      previousSnapshot,
      currentContext,
    );
    const runtime = runtimeState(evidence, calendar, pending);
    const life = lifeState(evidence, calendar, pending);
    if (sources.initialLifeAuthoringAvailable && evidence.committedOrNull === null && life === null)
      return fail('explicit initial life confirmation required');
    if (runtime !== null || life !== null || poison !== null) {
      const confirmation =
        evidence.current.initialStateConfirmationOrNull ??
        fail('missing actual runtime initial-state confirmation');
      equal(
        s.object(confirmation.values)['initialState'],
        current.initialState,
        'confirmed current runtime selection',
      );
    }
    if (wounds !== null) {
      const confirmation =
        evidence.current.initialStateConfirmationOrNull ??
        fail('missing actual NPC016 wound confirmation');
      equal(
        s.object(confirmation.values)['initialState'],
        current.initialState,
        'confirmed current wound selection',
      );
    }
    if (
      publication === null &&
      (disease !== null ||
        trauma !== null ||
        ordinary !== null ||
        wounds !== null ||
        runtime !== null ||
        life !== null ||
        poison !== null)
    )
      publication = emptyInventoryProof(
        evidence,
        calendar,
        pending,
        poison?.context.coatingContext ?? null,
      );
    const snapshot = derive(
      current,
      ordinary === null ? original : currentConfirmed,
      evidence,
      publication,
      disease,
      trauma,
      ordinary,
      wounds,
      equipment,
      runtime,
      publication?.previous === undefined
        ? null
        : inventoryHistoryContext(
            attempt.scope,
            attempt.candidateNpcUuid,
            publication.previous.version,
            calendar,
          ),
      life,
      poison,
    );
    if (evidence.initialOrNull !== null) {
      const first = evidence.initialOrNull;
      const firstEvidence = readNpcVersionDerivationEvidenceInTransaction(db, {
        scope: evidence.target.scope,
        npcUuid: evidence.target.npcUuid,
        npcDraftId: first.prefix.openAttempt.npcDraftId,
        openAttemptRevision: first.prefix.openAttempt.revision,
        commitOperationId: first.operation.operationId,
        targetVersion: 1,
      });
      const originalCommitted = readNpcEditorDraft(
        editorAt(firstEvidence, first.prefix, calendar, null),
        first.prefix.openAttempt.values,
      );
      const firstDisease =
        selectedDiseaseEffects(first.prefix).length === 0
          ? null
          : materializedDiseaseState(diseaseContext(firstEvidence, calendar, null));
      const firstTrauma =
        selectedTraumas(first.prefix).length === 0
          ? null
          : traumaState(firstEvidence, calendar, null);
      const firstOrdinary =
        first.prefix.ordinaryFacts.length === 0
          ? null
          : compositionState(
              first.prefix.openAttempt,
              contextAt(firstEvidence, first.prefix, calendar, null),
              calendar,
            );
      const firstWounds = woundState(firstEvidence, null);
      const firstEquipment = equipmentForDraft(firstEvidence, originalCommitted, calendar, null);
      const firstRuntime = runtimeState(firstEvidence, calendar, null);
      const firstLife = lifeState(firstEvidence, calendar, null);
      const firstPoison = poisonState(firstEvidence, calendar, null);
      const firstPublication =
        entered(originalCommitted.inventory, 'original inventory').length !== 0
          ? inventorySnapshot?.format === 'NPC_HUMANOID_V1'
            ? inventorySnapshot.derivation.inventoryProof
            : fail('missing independently read initial inventory')
          : firstDisease === null &&
              firstTrauma === null &&
              firstOrdinary === null &&
              firstWounds === null &&
              firstRuntime === null &&
              firstLife === null &&
              firstPoison === null
            ? null
            : emptyInventoryProof(
                firstEvidence,
                calendar,
                null,
                firstPoison?.context.coatingContext ?? null,
              );
      const originalSnapshot = derive(
        originalCommitted,
        original,
        firstEvidence,
        firstPublication,
        firstDisease,
        firstTrauma,
        firstOrdinary,
        firstWounds,
        firstEquipment,
        firstRuntime,
        null,
        firstLife,
        firstPoison,
      );
      equal(first.record['snapshot'], json(originalSnapshot), 'actual original V1 snapshot');
      equal(
        first.record['lifetimeFacts'],
        json(originalSnapshot.sheet.input.lifetimeFacts),
        'actual original lifetime',
      );
      art(originalCommitted, first, null, first.prefix);
    }
    if (previous !== null) {
      const verified = previousSnapshot ?? fail('previous snapshot absent');
      if (ordinary !== null) {
        evaluateNpcCompositionConsequences(
          sources.compositionConsequences,
          snapshot.derivation.compositionProof,
          verified.derivation.compositionProof,
        );
        equal(
          snapshot.derivation.skillProof.contexts.slice(
            0,
            verified.derivation.skillProof.contexts.length,
          ),
          verified.derivation.skillProof.contexts,
          'retained skill history prefix',
        );
        if (
          snapshot.format !== 'NPC_HUMANOID_V1' ||
          snapshot.derivation.ordinaryProof === undefined
        )
          return fail('lost ordinary stat proof');
        if (
          verified.format === 'NPC_HUMANOID_V1' &&
          verified.derivation.ordinaryProof !== undefined
        )
          deriveNpcOrdinaryStatProfile(
            sources.ordinaryHumanoid,
            {
              npcUuid: snapshot.npcUuid,
              compositionProof: snapshot.derivation.compositionProof,
              ordinaryProof: snapshot.derivation.ordinaryProof,
            },
            {
              npcUuid: verified.npcUuid,
              compositionProof: verified.derivation.compositionProof,
              ordinaryProof: verified.derivation.ordinaryProof,
            },
          );
      }
      if (ordinary === null)
        equal(
          [verified.derivation.skillProof, verified.derivation.compositionProof],
          [snapshot.derivation.skillProof, snapshot.derivation.compositionProof],
          'original mechanical derivation',
        );
      if (verified.format === 'NPC_HUMANOID_V1') {
        if (snapshot.format !== 'NPC_HUMANOID_V1') return fail('lost original humanoid provenance');
        if (snapshot.derivation.inventoryProof.previous === undefined)
          equal(
            verified.derivation.inventoryProof,
            snapshot.derivation.inventoryProof,
            'legacy original inventory derivation',
          );
      }
      if (ordinary === null)
        equal(
          verified.sheet.input.lifetimeFacts,
          snapshot.sheet.input.lifetimeFacts,
          'retained lifetime',
        );
    }
    return {
      evidence,
      derivedSnapshot: snapshot,
      previousSnapshot,
      prepared: {
        snapshot: json(snapshot),
        lifetimeFacts: json(snapshot.sheet.input.lifetimeFacts),
        art: art(current, evidence.committedOrNull, evidence.previousOrNull, evidence.current),
        preStartTimeOrNull:
          snapshot.sheet.requiresCampaignTime &&
          evidenceClock(evidence, calendar, pending).clock.phase === 'PRE_START'
            ? evidenceClock(evidence, calendar, pending).clock.campaignTimestampOrNull
            : null,
      },
    };
  }
  function snapshotRequiredPreStartTime(
    snapshot: ReturnType<typeof readSnapshot>,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
  ): number | null {
    if (!snapshot.sheet.requiresCampaignTime) return null;
    if (
      snapshot.format !== 'NPC_HUMANOID_V1' ||
      (snapshot.derivation.initialStateProof === undefined &&
        snapshot.derivation.initialTraumaProof === undefined &&
        snapshot.derivation.initialRuntimeProof === undefined &&
        snapshot.derivation.initialLifeProof === undefined &&
        snapshot.derivation.initialPoisonProof === undefined)
    )
      return fail('timed snapshot has no checked owning COMMIT');
    const operationId =
      snapshot.derivation.initialPoisonProof?.commitOperationId ??
      snapshot.derivation.initialLifeProof?.commitOperationId ??
      snapshot.derivation.initialRuntimeProof?.commitOperationId ??
      snapshot.derivation.initialStateProof?.commitOperationId ??
      snapshot.derivation.initialTraumaProof?.commitOperationId ??
      fail('missing timed snapshot COMMIT');
    const clock =
      pending?.operationId === operationId
        ? calendar.currentClock
        : (calendar.operations.find((o) => o.operationId === operationId)?.clock ??
          fail('missing timed COMMIT clock'));
    if (clock.campaignTimestampOrNull === null)
      return fail('timed snapshot requires confirmed clock');
    return clock.phase === 'PRE_START' ? clock.campaignTimestampOrNull : null;
  }
  function snapshotCustomProfiles(
    snapshot: ReturnType<typeof readSnapshot>,
  ): NonNullable<NpcPublishedChildGraph['customProfiles']> {
    return snapshot.sheet.itemProfiles.flatMap((entry) => {
      const versions = entry.customProfileVersions;
      if (versions === undefined) return [];
      const version = versions[0];
      if (versions.length !== 1 || version === undefined)
        return fail('one current custom profile version required');
      const reference =
        entry.kind === 'CAMPAIGN_CUSTOM_ITEM'
          ? entry.item.itemTypeReference
          : (entry.customModifier?.reference ?? fail('missing custom profile reference'));
      equal(
        [
          version.profileId,
          version.profileVersionId,
          version.version,
          version.reservationOperationId,
          version.itemInstanceId,
          version.ownerId,
        ],
        [
          reference.profileId,
          reference.profileVersionId,
          reference.version,
          reference.reservationOperationId,
          entry.item.itemInstanceId,
          snapshot.npcUuid,
        ],
        'published custom profile identity',
      );
      return [
        {
          itemInstanceId: entry.item.itemInstanceId,
          reference,
          confirmedContentOrNull: { profile: version.afterProfile, reason: version.reason },
        },
      ];
    });
  }
  function pendingInventoryGraph(
    snapshot: ReturnType<typeof readSnapshot>,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
    completed?: CompletedSavedPoisonRead,
  ): NpcPublishedChildGraph['pendingInventory'] {
    if (snapshot.format !== 'NPC_HUMANOID_V1') return undefined;
    const context = snapshotPoisonState(snapshot, calendar, pending, completed)?.context
      .coatingContext;
    if (context == null || context.preparationHistory === undefined) return undefined;
    const proof = snapshot.derivation.inventoryProof;
    const selection = readNpcInventoryCoatingSelection(
      sources.inventoryPublication,
      context,
      proof.entries.map((entry) => entry.request),
      { npcUuid: snapshot.npcUuid, commitOperationId: proof.commitOperationId },
    );
    const prior =
      proof.previous === undefined
        ? []
        : readNpcInventoryHistoryEvidenceInTransaction(
            db,
            calendar.scope,
            snapshot.npcUuid,
            proof.previous.version,
          );
    const published = new Set(proof.entries.map((entry) => entry.request.itemInstanceId));
    for (const version of prior) {
      const rows = s.object(
        s.object(s.object(version.stored.record['snapshot'])['sheet'])['input'],
      )['inventory'];
      if (!Array.isArray(rows)) return fail('actual prior physical inventory missing');
      for (const row of rows) published.add(s.uuid(s.object(row)['itemInstanceId']));
    }
    const requests = selection.pendingRestoreRequests.filter(
      (row) => !published.has(row.itemInstanceId),
    );
    if (requests.length === 0) return undefined;
    const prefixes = context.preparationHistory.flatMap((entry) => {
      if (entry.kind !== 'PREPARE') return [];
      const original = readNpcPoisonPreparationEvidence(context.catalog, entry.preparation);
      return [
        readNpcPoisonPreparationEvidenceInTransaction(
          db,
          calendar.scope,
          snapshot.npcUuid,
          original.preparation.preparationOperationId,
        ).evidence.current,
      ];
    });
    const items = requests.map((request) => {
      const original =
        prefixes
          .flatMap((prefix) => prefix.itemReservations)
          .find((row) => row.itemInstanceId === request.itemInstanceId) ??
        fail('pending carrier has no actual physical reservation before PREPARE');
      return { itemInstanceId: request.itemInstanceId, originOperationId: original.operationId };
    });
    const linkedSets = [
      ...new Set(
        requests.flatMap((row) =>
          row.linkedSetInstanceId === null ? [] : [row.linkedSetInstanceId],
        ),
      ),
    ].map((id) => {
      const original =
        prefixes
          .flatMap((prefix) => prefix.compositeReservations)
          .find((row) => row.binding.linkedSetInstanceId === id)?.binding ??
        fail('pending carrier source pair has no actual reservation');
      if (
        !original.components.every((component) =>
          requests.some(
            (row) =>
              row.itemInstanceId === component.itemInstanceId &&
              row.componentRole === component.componentRole &&
              row.linkedSetInstanceId === id,
          ),
        )
      )
        return fail('pending carrier source pair must remain complete');
      return original;
    });
    const customProfiles = requests.flatMap((request) => {
      const reference =
        request.itemTypeId === null ? request.itemTypeReference : request.customModifier?.reference;
      if (reference === undefined) return [];
      const original = readNpcCustomProfileReservationEvidenceInTransaction(
        db,
        calendar.scope,
        snapshot.npcUuid,
        reference.profileVersionId,
      );
      equal(
        [original.binding.itemInstanceId, original.binding.reference],
        [request.itemInstanceId, reference],
        'pending custom carrier actual reservation',
      );
      return [{ itemInstanceId: request.itemInstanceId, reference, confirmedContentOrNull: null }];
    });
    return { items, linkedSets, customProfiles };
  }
  function snapshotChildGraph(
    snapshot: ReturnType<typeof readSnapshot>,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null = null,
    completed?: CompletedSavedPoisonRead,
  ): NpcPublishedChildGraph {
    const assignments =
      snapshot.format === 'NPC_HUMANOID_V1'
        ? (snapshot.derivation.initialStateProof?.assignments ?? [])
        : [];
    const setIds = [
      ...new Set(
        snapshot.sheet.input.inventory.flatMap((item) =>
          item.linkedSetInstanceId === null ? [] : [item.linkedSetInstanceId],
        ),
      ),
    ];
    const linkedSets = setIds.map((linkedSetInstanceId) => {
      const items = snapshot.sheet.input.inventory.filter(
        (item) => item.linkedSetInstanceId === linkedSetInstanceId,
      );
      const first = items[0] ?? fail('missing published composite component');
      if (items.some((item) => item.itemTypeId !== first.itemTypeId))
        return fail('mixed published composite source');
      return npcLinkedSetBindingValue({
        linkedSetInstanceId,
        itemTypeId: first.itemTypeId,
        components: items.map((item) => ({
          itemInstanceId: item.itemInstanceId,
          componentRole: item.componentRole,
        })),
      });
    });
    const runtimeEffects: NonNullable<NpcPublishedChildGraph['runtimeEffects']> =
      snapshot.sheet.input.initialState.effectInstances.flatMap((effect) => {
        if (effect.effectTypeId === 'EFF-DISEASE-INSTANCE') return [];
        if (snapshot.format !== 'NPC_HUMANOID_V1') return fail('runtime effect lost owning proof');
        const reference =
          effect.effectTypeId === 'EFF-LIFE-DEATH_TIMER'
            ? snapshot.derivation.initialLifeProof
            : 'kind' in effect.payload && effect.payload.kind === 'GM_FORMAL_INITIAL_WEAVER'
              ? snapshot.derivation.initialLifeProof?.temporaryWeaverAssignments?.find(
                  (row) => row.effectInstanceId === effect.effectInstanceId,
                )
              : snapshot.derivation.initialRuntimeProof?.assignments.find(
                  (a) => a.effectInstanceId === effect.effectInstanceId,
                );
        if (reference === undefined) return fail('missing published runtime origin');
        const allocation = readNpcEffectAllocationInTransaction(
          db,
          calendar.scope,
          snapshot.npcUuid,
          effect.effectInstanceId,
        );
        if (!('sourceKind' in allocation))
          return fail('runtime effect has no actual runtime allocation');
        const source = npcRuntimeEffectAllocationSource(allocation);
        if (effect.effectTypeId === 'EFF-LIFE-DEATH_TIMER' && source.sourceKind !== 'LIFE_TIMER')
          return fail('life timer has no actual LIFE_TIMER allocation');
        if (
          'kind' in effect.payload &&
          effect.payload.kind === 'GM_FORMAL_INITIAL_WEAVER' &&
          (source.sourceKind !== 'WEAVER_STATE' ||
            source.branch !== effect.payload.branch ||
            source.sourceInstanceId !== effect.sourceInstanceId)
        )
          return fail('Weaver effect has no actual matching source allocation');
        return [
          {
            ...source,
            effectInstanceId: effect.effectInstanceId,
            originCommitOperationId: reference.originCommitOperationId,
          },
        ];
      });
    const modeEffects: NonNullable<NpcPublishedChildGraph['runtimeEffects']> =
      snapshot.sheet.input.initialState.sourceSpecificStates.flatMap((state) => {
        if (!('kind' in state) || state.kind !== 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE') return [];
        if (snapshot.format !== 'NPC_HUMANOID_V1' || state.origin.kind !== 'COMMITTED')
          return fail('saved mode origin missing');
        const ref =
          snapshot.derivation.initialPoisonProof?.modeAssignments.find(
            (row) => row.modeOperationId === state.anchor.modeOperationId,
          ) ?? fail('saved mode reference missing');
        equal(
          ref.originCommitOperationId,
          state.origin.originCommitOperationId,
          'saved mode original COMMIT',
        );
        return [
          {
            sourceKind: 'POISON_MODE' as const,
            sourceInstanceId: state.sourceInstanceId,
            effectInstanceId: state.effectInstanceId,
            originCommitOperationId: ref.originCommitOperationId,
          },
        ];
      });
    const coatings: NonNullable<NpcPublishedChildGraph['coatings']> =
      snapshot.sheet.itemProfiles.flatMap((entry) =>
        (entry.item.activeCoatings ?? []).map((coating) => {
          if (coating.origin.kind !== 'COMMITTED') return fail('saved coating origin missing');
          return {
            coatingInstanceId: coating.coatingInstanceId,
            itemInstanceId: entry.item.itemInstanceId,
            sourceInstanceId: coating.sourceInstanceId,
            originCommitOperationId: coating.origin.originCommitOperationId,
          };
        }),
      );
    const archivedCoatingPreparations: NonNullable<
      NpcPublishedChildGraph['archivedCoatingPreparations']
    > =
      snapshot.format !== 'NPC_HUMANOID_V1'
        ? []
        : (snapshot.derivation.inventoryProof.archivedCoatingPreparations ?? []).map(
            (reference) => {
              const actual = readNpcCoatingReservationEvidenceInTransaction(
                db,
                calendar.scope,
                snapshot.npcUuid,
                reference.coatingInstanceId,
                pending,
              );
              equal(
                reference.preparationOperationId,
                actual.operationId,
                'saved archived preparation operation',
              );
              const previous = snapshot.derivation.inventoryProof.previous;
              const published = poisonReaders.firstPublishedCoating(
                {
                  scope: calendar.scope,
                  candidateNpcUuid: snapshot.npcUuid,
                  targetOrNull:
                    previous === undefined
                      ? null
                      : { npcUuid: previous.npcUuid, expectedCurrentVersion: previous.version },
                },
                reference.coatingInstanceId,
              );
              return {
                coatingInstanceId: reference.coatingInstanceId,
                itemInstanceId: actual.request.preparation.input.targetItemInstanceId,
                sourceInstanceId: actual.request.preparation.input.sourceInstanceId,
                preparationOperationId: reference.preparationOperationId,
                publishedOriginCommitOperationIdOrNull: published?.operation.operationId ?? null,
              };
            },
          );
    const pendingInventory = pendingInventoryGraph(snapshot, calendar, pending, completed);
    return {
      ...(pendingInventory === undefined ? {} : { pendingInventory }),
      ...(linkedSets.length === 0 ? {} : { linkedSets }),
      ...(snapshotCustomProfiles(snapshot).length === 0
        ? {}
        : { customProfiles: snapshotCustomProfiles(snapshot) }),
      ...(runtimeEffects.length + modeEffects.length === 0
        ? {}
        : { runtimeEffects: [...runtimeEffects, ...modeEffects] }),
      ...(coatings.length === 0 ? {} : { coatings }),
      ...(archivedCoatingPreparations.length === 0 ? {} : { archivedCoatingPreparations }),
      wounds:
        snapshot.format === 'NPC_HUMANOID_V1'
          ? (snapshot.derivation.initialWoundProof?.assignments ?? [])
          : [],
      symbionts: snapshot.sheet.symbionts.map((symbiont) => {
        const evidence = readNpcSymbiontReservationEvidenceInTransaction(
          db,
          calendar.scope,
          snapshot.npcUuid,
          symbiont.symbiontInstanceId,
          pending,
        );
        return {
          symbiontInstanceId: symbiont.symbiontInstanceId,
          speciesKey: symbiont.speciesKey,
          originCommitOperationId: evidence.origin.target.commitOperationId,
        };
      }),
      traumas:
        snapshot.format !== 'NPC_HUMANOID_V1'
          ? []
          : (snapshot.derivation.initialTraumaProof?.facts ?? []).map((f) => ({
              traumaInstanceId: f.trauma.traumaInstanceId,
              originCommitOperationId: f.origin.commitOperationId,
              input: npcTraumaEditorRowFromFact(f),
            })),
      effects: snapshot.sheet.input.initialState.effectInstances
        .filter((effect) => effect.effectTypeId === 'EFF-DISEASE-INSTANCE')
        .map((effect) => ({
          effectInstanceId: effect.effectInstanceId,
          diseaseId: effect.payload.diseaseId,
          originCommitOperationId:
            assignments.find((a) => a.effectInstanceId === effect.effectInstanceId)
              ?.originOperationId ?? fail('missing published disease origin'),
        })),
      items: snapshot.sheet.itemProfiles.map((entry) => ({
        itemInstanceId: entry.item.itemInstanceId,
        profileVersions: entry.profileVersions.map((p) => ({
          weaponProfileVersionId: p.weaponProfileVersionId,
          weaponVariantId: p.attackVariantId,
        })),
      })),
    };
  }
  function readSnapshotWithChildGraph(
    value: unknown,
    calendar: NpcCalendarReadContext,
    pending: NpcPendingCommitEvidence | null,
    detachSnapshot = false,
  ) {
    const raw = s.object(value);
    const savedPoison =
      pending === null &&
      raw['format'] === 'NPC_HUMANOID_V1' &&
      Object.hasOwn(s.object(raw['derivation']), 'initialPoisonProof');
    const guard = savedPoison ? capturePriorLifeReadGuard(calendar) : null;
    const request =
      guard === null ? undefined : priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
    const poisonContext = guard === null ? undefined : priorLifeCallable(poisonReaders, 'context');
    const checked = readSnapshotWithContexts(value, calendar, pending, undefined, savedPoison);
    // Inspection still detaches before graph callbacks; graph-only reads need no extra clone.
    const detachedSnapshot = detachSnapshot ? json(checked.snapshot) : null;
    // This sidecar never leaves this invocation or enters the stored/wire graph. Its entire
    // mutable result is fenced; a frozen outer snapshot cannot authorize mutable poison children.
    const completed: CompletedSavedPoisonRead | undefined =
      guard === null
        ? undefined
        : {
            snapshot: checked.snapshot,
            poison: checked.poison ?? fail('saved poison context missing'),
            calendar,
            guard,
            request,
            poisonContext,
            nodes: [
              ...(checked.poisonNodes ?? fail('saved poison result guard missing')),
              ...captureReadGraph([{ value: checked.snapshot }]),
            ],
          };
    if (completed !== undefined)
      assertCompletedSavedPoisonRead(completed, checked.snapshot, calendar, pending);
    const publishedChildGraph = snapshotChildGraph(checked.snapshot, calendar, pending, completed);
    if (completed !== undefined)
      assertCompletedSavedPoisonRead(completed, checked.snapshot, calendar, pending);
    return { snapshot: checked.snapshot, publishedChildGraph, detachedSnapshot };
  }
  const readers: NpcOrdinaryDomainReaders = {
    inspectStoredSnapshot(value, context) {
      const calendar = requireCalendar(context);
      const { snapshot, publishedChildGraph, detachedSnapshot } = readSnapshotWithChildGraph(
        value,
        calendar,
        null,
        true,
      );
      return {
        snapshot: detachedSnapshot ?? fail('missing detached stored snapshot'),
        publishedChildGraph,
        requiredPreStartTimeOrNull: snapshotRequiredPreStartTime(snapshot, calendar, null),
      };
    },
    requiredPreStartTime(value, context, pending) {
      const calendar = requireCalendar(context);
      return snapshotRequiredPreStartTime(
        readSnapshot(value, calendar, pending),
        calendar,
        pending,
      );
    },
    compositionPreparation,
    itemPreparation,
    compositeItemPreparation,
    customItemPreparation,
    itemRestorePreparation,
    lifePreparation,
    weaverPreparation,
    poisonPreparation,
    validateInventoryCoatingSelection: poisonReaders.validateEditorSelection,
    inventoryPreviewForAttempt(attempt, calendar) {
      requireCalendar(calendar, attempt.scope);
      const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, attempt);
      const previous =
        evidence.previousOrNull === null
          ? null
          : readSnapshot(evidence.previousOrNull.record['snapshot'], calendar);
      const scoped = npcEditorForItemAttempt(
        editor,
        sources.inventory,
        contextAt(evidence, evidence.current, calendar, previous),
      );
      const draft = readNpcEditorDraft(scoped, attempt.values);
      const guard = attempt.targetOrNull === null ? null : capturePriorLifeReadGuard(calendar);
      const request =
        guard === null ? undefined : priorLifeCallable(NPC_GM_REQUEST_READERS, 'request');
      const history =
        attempt.targetOrNull === null
          ? null
          : inventoryHistoryRead(
              attempt.scope,
              attempt.candidateNpcUuid,
              attempt.targetOrNull.expectedCurrentVersion,
              calendar,
            );
      if (history !== null) {
        const last = history.last ?? fail('missing checked inventory preview predecessor');
        if (evidence.previousOrNull === null) return fail('inventory preview predecessor missing');
        equal(last.record, evidence.previousOrNull.record, 'inventory preview predecessor');
      }
      const prefix =
        guard === null || history === null
          ? null
          : createCompletedInventoryPrefix(
              attempt.scope,
              attempt.candidateNpcUuid,
              calendar,
              guard,
              request,
              history,
            );
      const parent = completedInventoryPrefix;
      if (prefix !== null) completedInventoryPrefix = prefix;
      try {
        // Poison reads keep their current evaluation and fresh SQL; only this already
        // checked committed predecessor is shared until the owning preview returns.
        const preview = buildNpcInventoryPreview(
          sources.inventoryPublication,
          projectNpcInventoryRequest(scoped, draft.inventory),
          history?.context ?? null,
          poisonReaders.inventoryContext(attempt, calendar),
        );
        if (prefix !== null) assertCompletedInventoryPrefix(prefix);
        return preview;
      } finally {
        completedInventoryPrefix = parent;
      }
    },
    runtimeEffectPreparation,
    diseasePreparation,
    traumaPreparation,
    woundPreparation,
    equipmentCompatibilityPreparation,
    equipmentForAttempt(attempt, calendar) {
      const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, attempt);
      const previous =
        evidence.previousOrNull === null
          ? null
          : readSnapshot(evidence.previousOrNull.record['snapshot'], calendar);
      const draft = readNpcEditorDraft(
        npcEditorForItemAttempt(
          editor,
          sources.inventory,
          contextAt(evidence, evidence.current, calendar, previous),
        ),
        attempt.values,
      );
      return equipmentForDraft(evidence, draft, calendar, previous);
    },
    validateEquipmentCompatibilityPreparation: equipmentCompatibilityPreparation.validate,
    validateWoundPreparation: woundPreparation.validate,
    symbiontPreparation,
    initialInventoryProfiles(attempt, context, previous, calendar) {
      equal(
        [context.scope, context.npcDraftId, context.candidateNpcUuid, context.revision],
        [attempt.scope, attempt.npcDraftId, attempt.candidateNpcUuid, attempt.revision],
        'initial inventory attempt binding',
      );
      if (
        attempt.status !== 'OPEN' ||
        attempt.stage !== 'NPC-017' ||
        context.pendingItemOrNull !== null ||
        context.pendingEffectOrNull !== null ||
        context.pendingTraumaOrNull !== null
      )
        return fail('initial inventory requires the checked final attempt');
      if (previous !== null) {
        equal(previous.scope, attempt.scope, 'retained inventory owner');
        equal(
          [previous.npcUuid, previous.version],
          [attempt.targetOrNull?.npcUuid, attempt.targetOrNull?.expectedCurrentVersion],
          'retained inventory version',
        );
        if (attempt.mode !== 'APPEND_N_PLUS_ONE') return fail('unexpected previous inventory');
      }
      if (previous === null && (attempt.mode !== 'CREATE_V1' || attempt.targetOrNull !== null))
        return fail('initial inventory requires the first publication');
      const scoped = npcEditorForItemAttempt(editor, sources.inventory, context);
      const draft = readNpcEditorDraft(scoped, attempt.values);
      const history =
        previous === null
          ? null
          : inventoryHistoryContext(
              attempt.scope,
              attempt.candidateNpcUuid,
              previous.version,
              requireCalendar(calendar, attempt.scope),
            );
      const requests = projectNpcInventoryRequest(scoped, draft.inventory);
      const coatingContext = poisonReaders.inventoryContext(
        attempt,
        requireCalendar(calendar, attempt.scope),
      );
      const preview = buildNpcInventoryPreview(
        sources.inventoryPublication,
        requests,
        history,
        coatingContext,
      );
      const plan = planNpcInventoryWeaponVersions(
        sources.inventoryPublication,
        requests,
        history,
        coatingContext,
      );
      return preview.items.flatMap((item) =>
        'stagedProfile' in item &&
        plan.find((entry) => entry.itemInstanceId === item.request.itemInstanceId)?.kind ===
          'ALLOCATE'
          ? [
              {
                itemInstanceId: item.request.itemInstanceId,
                weaponVariantId: item.stagedProfile.weaponVariantId,
              },
            ]
          : [],
      );
    },
    applyArtPreparation,
    validateArtPreparation(previous, input, context) {
      applyArtPreparation(previous, input, context);
    },
    validateItemReservation(previous, input, context) {
      itemPreparation.validate(previous, input, context);
    },
    validateCompositeItemReservation(previous, input, context) {
      compositeItemPreparation.validate(previous, input, context);
    },
    validateCustomItemPreparation(request, context) {
      customItemPreparation.validate(request, context);
    },
    validateItemRestorePreparation(request, context) {
      itemRestorePreparation.validate(request, context);
    },
    validateRuntimeEffectPreparation(request, context) {
      const attempt = context.previousOrNull?.attempt ?? fail('missing runtime attempt');
      runtimeSelection(request, attempt, requireCalendar(context.calendarContext, attempt.scope));
    },
    validateLifeStatePreparation(request, context) {
      if (request.sourceFormId !== 'NPC-016') return fail('life source form required');
      lifePreparation.validate(request, context);
    },
    validateWeaverStatePreparation(request, context) {
      weaverPreparation.validate(request, context);
    },
    validatePoisonPreparation(request, context) {
      poisonPreparation.validate(request, context);
    },
    validateCompositionPreparation(request, context) {
      const previous = context.previousOrNull?.attempt ?? fail('missing composition attempt');
      const state = compositionState(
        previous,
        context.previousReadContextOrNull ?? fail('missing composition read context'),
        requireCalendar(context.calendarContext, previous.scope),
      );
      if (request.preparation.kind === 'COMPOSITION_CONFIRM')
        prepareNpcCompositionConfirmation(sources, editor, state, request, context.checkpoint);
      else if (request.preparation.kind === 'COMPOSITION_RESOLVE')
        validateNpcCompositionContinuation(state, request);
      else return fail('unexpected composition request');
    },
    validateSymbiontReservation(previous, input, context) {
      symbiontPreparation.validate(previous, input, context);
    },
    validateTraumaReservation(previous, context) {
      traumaPreparation.validate(previous, context);
    },
    validateDiseaseReservation(previous, diseaseId, context) {
      diseasePreparation.validate(previous, diseaseId, context);
    },
    validateAttemptOrigin(attempt, operation, base, context) {
      const calendar = requireCalendar(context, attempt.scope);
      if (attempt.revision !== 0 || attempt.status !== 'OPEN' || attempt.stage !== 'NPC-002')
        return fail('invalid attempt origin');
      equal(attempt.scope, operation.scope, 'origin scope');
      if (operation.kind === 'CREATE') {
        if (base !== null || attempt.mode !== 'CREATE_V1' || attempt.targetOrNull !== null)
          return fail('invalid CREATE origin');
        const initial = s.object(s.object(attempt.values)['initialState']);
        equal(
          attempt.values,
          json({
            ...createEmptyNpcEditorDraft(),
            initialState: {
              ...createEmptyNpcEditorDraft().initialState,
              ...(Object.hasOwn(initial, 'weaverEffectInstanceIds')
                ? {
                    weaverEffectInstanceIds:
                      sources.formalWeaver === null
                        ? fail('unrecognized Weaver CREATE source')
                        : { kind: 'ENTERED', value: [] },
                  }
                : {}),
              ...(Object.hasOwn(initial, 'poisonModeFactIds')
                ? {
                    poisonModeFactIds:
                      sources.poisonSource === null
                        ? fail('unrecognized poison CREATE source')
                        : { kind: 'ENTERED', value: [] },
                  }
                : {}),
            },
          }),
          'empty CREATE origin',
        );
      } else if (operation.kind === 'OPEN') {
        if (base === null || attempt.mode !== 'APPEND_N_PLUS_ONE')
          return fail('invalid OPEN origin');
        equal(base.scope, attempt.scope, 'OPEN base scope');
        equal(attempt.candidateNpcUuid, base.npcUuid, 'OPEN base NPC');
        equal(
          attempt.targetOrNull,
          { npcUuid: base.npcUuid, expectedCurrentVersion: base.version },
          'OPEN base version',
        );
        equal(
          attempt.values,
          readers.initializeOpen(
            base,
            calendar,
            !Object.hasOwn(
              s.object(s.object(attempt.values)['initialState']),
              'weaverEffectInstanceIds',
            ),
            !Object.hasOwn(s.object(s.object(attempt.values)['initialState']), 'poisonModeFactIds'),
          ),
          'saved OPEN origin',
        );
      } else return fail('unknown attempt origin');
    },
    initializeNew() {
      const draft = createEmptyNpcEditorDraft();
      return json(
        sources.formalWeaver === null && sources.poisonSource === null
          ? draft
          : {
              ...draft,
              initialState: {
                ...draft.initialState,
                ...(sources.formalWeaver === null
                  ? {}
                  : { weaverEffectInstanceIds: { kind: 'ENTERED', value: [] } }),
                ...(sources.poisonSource === null
                  ? {}
                  : { poisonModeFactIds: { kind: 'ENTERED', value: [] } }),
              },
            },
      );
    },
    initializeOpen(
      version,
      calendar,
      preserveLegacyWeaverAbsence = false,
      preserveLegacyPoisonAbsence = false,
      snapshotRead,
    ) {
      requireCalendar(calendar, version.scope);
      const openBinding = { version, preserveLegacyWeaverAbsence, preserveLegacyPoisonAbsence };
      const completedRead = beginLocalSnapshotRead(
        snapshotRead,
        'OPEN_VERSION',
        openBinding,
        calendar,
      );
      const evidence = readNpcVersionDerivationEvidenceInTransaction(db, {
        scope: version.scope,
        npcUuid: version.npcUuid,
        npcDraftId: version.npcDraftId,
        openAttemptRevision: version.attemptRevision - 1,
        commitOperationId: version.operationId,
        targetVersion: version.version,
      });
      if (evidence.committedOrNull === null) return fail('OPEN requires a committed version');
      equal(evidence.committedOrNull.record, version, 'OPEN version');
      const previous =
        evidence.previousOrNull === null
          ? null
          : npcVersionValue(evidence.previousOrNull.record, readers, calendar);
      const committed = {
        ...evidence.current.openAttempt,
        revision: version.attemptRevision,
        status: 'COMMITTED' as const,
      };
      const validate = (token?: NpcLocalSnapshotRead) => {
        if (token === undefined)
          readers.validateVersion(version, committed, previous, calendar, null, null);
        else readers.validateVersion(version, committed, previous, calendar, null, null, token);
      };
      let previousSnapshot: ReturnType<typeof readSnapshot> | null;
      if (previous === null) {
        validate();
        previousSnapshot = null;
      } else {
        previousSnapshot = snapshotFromLocalCall(
          'PREVIOUS_VERSION',
          { version, committed, previous, pending: null, storedChildGraphOrNull: null },
          previous.snapshot,
          calendar,
          validate,
          () => readSnapshot(previous.snapshot, calendar),
        );
      }
      const draft = readNpcEditorDraft(
        editorAt(evidence, evidence.current, calendar, previousSnapshot),
        evidence.current.openAttempt.values,
      );
      const ownSnapshot = readSnapshot(version.snapshot, calendar);
      if (
        preserveLegacyPoisonAbsence &&
        (draft.initialState.poisonModeFactIds !== undefined ||
          (ownSnapshot.format === 'NPC_HUMANOID_V1' &&
            ownSnapshot.derivation.initialPoisonProof !== undefined))
      )
        return fail('legacy OPEN cannot omit published poison modes');
      if (
        preserveLegacyWeaverAbsence &&
        (draft.initialState.weaverEffectInstanceIds !== undefined ||
          (ownSnapshot.format === 'NPC_HUMANOID_V1' &&
            ownSnapshot.derivation.initialLifeProof?.temporaryWeaverAssignments !== undefined))
      )
        return fail('legacy OPEN cannot omit published Weaver selection');
      const values = json({
        ...draft,
        initialState: {
          ...draft.initialState,
          ...(sources.poisonSource !== null &&
          !preserveLegacyPoisonAbsence &&
          draft.initialState.poisonModeFactIds === undefined
            ? { poisonModeFactIds: { kind: 'ENTERED', value: [] } }
            : {}),
          ...(sources.formalWeaver !== null &&
          !preserveLegacyWeaverAbsence &&
          draft.initialState.weaverEffectInstanceIds === undefined
            ? { weaverEffectInstanceIds: { kind: 'ENTERED', value: [] } }
            : {}),
          ...(draft.initialState.traumaInputs === undefined
            ? {}
            : {
                traumaInputs: {
                  kind: 'ENTERED',
                  value:
                    ownSnapshot.format === 'NPC_HUMANOID_V1'
                      ? (ownSnapshot.derivation.initialTraumaProof?.facts ?? []).map(
                          npcTraumaEditorRowFromFact,
                        )
                      : [],
                },
              }),
        },
        identity: {
          ...draft.identity,
          artAssetKeyOrNull: { kind: 'ENTERED', value: version.art.assetKey },
        },
      });
      completeLocalSnapshotRead(completedRead, openBinding, calendar, ownSnapshot);
      return values;
    },
    attempt(_stage, value, context) {
      return itemPreparation.read(value, context);
    },
    snapshot(value, calendar, pending) {
      return json(readSnapshot(value, calendar, pending));
    },
    publishedChildGraph(value, calendar, pending) {
      return readSnapshotWithChildGraph(value, requireCalendar(calendar), pending)
        .publishedChildGraph;
    },
    lifetimeFacts(value) {
      return json(readNpcOrdinaryLifetimeFacts(value));
    },
    preview(attempt, previous, calendar) {
      requireCalendar(calendar, attempt.scope);
      if (attempt.status !== 'OPEN' || (attempt.stage !== 'NPC-016' && attempt.stage !== 'NPC-017'))
        return fail('open actual initial-state/review attempt required for preview');
      const evidence = readNpcAttemptDerivationEvidenceInTransaction(db, {
        scope: attempt.scope,
        npcUuid: attempt.candidateNpcUuid,
        npcDraftId: attempt.npcDraftId,
        openAttemptRevision: attempt.revision,
        targetVersion: previous === null ? 1 : previous.version + 1,
        stage: attempt.stage,
      });
      equal(evidence.current.openAttempt, attempt, 'actual preview attempt');
      equal(evidence.previousOrNull?.record ?? null, previous, 'actual preview base');
      // Validate recorded mechanics/art with their real COMMIT identities, outside the input-error boundary.
      const previousSnapshot =
        previous === null
          ? null
          : snapshotFromLocalCall(
              'OPEN_VERSION',
              {
                version: previous,
                preserveLegacyWeaverAbsence: false,
                preserveLegacyPoisonAbsence: false,
              },
              previous.snapshot,
              calendar,
              (token) => {
                readers.initializeOpen(previous, calendar, false, false, token);
              },
              () => readSnapshot(previous.snapshot, calendar),
            );
      const currentContext = contextAt(evidence, evidence.current, calendar, previousSnapshot);
      const currentEditor = npcEditorForItemAttempt(editor, sources.inventory, currentContext);
      const current = readNpcEditorDraft(currentEditor, attempt.values);
      const confirmation = evidence.current.skillConfirmation;
      const confirmed = readNpcEditorDraft(
        editorAt(
          evidence,
          evidence.current,
          calendar,
          previousSnapshot,
          confirmation.attemptRevision,
          confirmation.operationId,
        ),
        confirmation.values,
      );
      sameMechanics(current, confirmed);
      const initialPrefix = evidence.initialOrNull?.prefix ?? evidence.current;
      const initialConfirmation = initialPrefix.skillConfirmation;
      const original = readNpcEditorDraft(
        editorAt(
          evidence,
          initialPrefix,
          calendar,
          null,
          initialConfirmation.attemptRevision,
          initialConfirmation.operationId,
        ),
        initialConfirmation.values,
      );
      let preview: NpcHumanoidPreview;
      try {
        const inventory = currentConfirmedInventory(
          evidence,
          current,
          calendar,
          previousSnapshot,
        ).input;
        const inventoryContext =
          previous === null
            ? null
            : inventoryHistoryContext(
                attempt.scope,
                attempt.candidateNpcUuid,
                previous.version,
                calendar,
              );
        const ordinaryState =
          evidence.current.ordinaryFacts.length !== 0 ||
          (previousSnapshot?.format === 'NPC_HUMANOID_V1' &&
            previousSnapshot.derivation.ordinaryProof !== undefined)
            ? compositionState(attempt, currentContext, calendar)
            : null;
        const ordinaryStats =
          ordinaryState === null
            ? null
            : npcCompositionInventoryStats(
                sources,
                ordinaryState,
                npcCompositionConfirmedStats(
                  sources,
                  ordinaryState,
                  confirmed,
                  confirmation.operationId,
                ).ordinaryProof,
              );
        if (ordinaryState === null)
          for (const key of ['schema', 'baseStats', 'symbionts', 'skills'] as const)
            if (!s.same(current[key], original[key]))
              throw new NpcOrdinaryPreviewInputError(
                'NOT_YET_SUPPORTED',
                'changed original ' + key,
              );
        if (ordinaryState === null) previewEmpty(current.symbionts, 'symbionts');
        const diseaseAssignments = previewEntered(
          current.initialState.effectInstanceIds,
          'effects',
        ).flatMap((effectInstanceId) => {
          const binding = currentEditor.effects?.find(
            (effect) => effect.effectInstanceId === effectInstanceId,
          );
          if (binding === undefined)
            return fail('selected preview effect has no actual attempt binding');
          return 'diseaseId' in binding ? [{ effectInstanceId, diseaseId: binding.diseaseId }] : [];
        });
        const traumaInput = projectNpcInitialTraumaInput(currentEditor, current.initialState);
        const selectedTraumaIds = new Set(
          traumaInput.currentTraumas.map((t) => t.traumaInstanceId),
        );
        const retainedFacts =
          previousSnapshot?.format === 'NPC_HUMANOID_V1'
            ? (previousSnapshot.derivation.initialTraumaProof?.facts ?? []).filter((f) =>
                selectedTraumaIds.has(f.trauma.traumaInstanceId),
              )
            : [];
        const originalTraumaContext =
          retainedFacts.length === 0 || previousSnapshot === null
            ? null
            : (snapshotTraumaContext(previousSnapshot, calendar, null) ??
              fail('missing checked retained trauma context'));
        const clock = calendar.currentClock;
        let calendarAnchorOrNull: NpcInitialTraumaCalendarAnchor | null = null;
        if (clock.campaignTimestampOrNull !== null) {
          if (clock.phase === 'PRE_START')
            calendarAnchorOrNull = {
              kind: 'PRE_START_INITIAL',
              campaignTimestamp: clock.campaignTimestampOrNull,
              lobbySnapshotRevision:
                clock.lobbySnapshotRevisionOrNull ?? fail('missing current lobby revision'),
            };
          else {
            const currentSource = readNpcGmSourceInTransaction(db, attempt.scope);
            equal(
              currentSource.queuePrefix,
              calendar.currentQueuePrefixOrNull,
              'preview current GM prefix',
            );
            calendarAnchorOrNull = {
              kind: 'CURRENT_CAMPAIGN',
              campaignTimestamp: clock.campaignTimestampOrNull,
              stateRevision: currentSource.revisions.stateRevision,
            };
          }
        }
        const freshActive = traumaInput.choices.some(
          (c) =>
            !retainedFacts.some((f) => f.trauma.traumaInstanceId === c.traumaInstanceId) &&
            c.consequence.kind === 'HEAD' &&
            c.consequence.stun.status === 'ACTIVE',
        );
        if (freshActive && calendarAnchorOrNull === null)
          throw new NpcOrdinaryPreviewInputError(
            'INCOMPLETE',
            'Подтвердите время кампании для активного отключения',
          );
        const traumaPreview: NpcHumanoidTraumaPreview | null =
          traumaInput.currentTraumas.length === 0
            ? null
            : {
                ...traumaInput,
                calendarAnchorOrNull,
                retained:
                  originalTraumaContext === null
                    ? null
                    : {
                        facts: retainedFacts,
                        context: {
                          ...originalTraumaContext,
                          campaignTimestampOrNull: clock.campaignTimestampOrNull,
                          evidence: originalTraumaContext.evidence.filter((e) =>
                            selectedTraumaIds.has(e.trauma.traumaInstanceId),
                          ),
                        },
                      },
              };
        const wounds = woundState(evidence, null);
        const equipment = equipmentForDraftWithContext(
          evidence,
          current,
          calendar,
          previousSnapshot,
          currentContext,
        );
        const life = preparedLife(attempt, calendar, null);
        const poison = poisonReaders.context(attempt, calendar);
        if (sources.initialLifeAuthoringAvailable && life === null)
          throw new NpcOrdinaryPreviewInputError(
            'INCOMPLETE',
            'Явно подтвердите состояние жизни и его основание на NPC-016.',
          );
        previewEmpty(current.initialState.sourceSpecificStateFactIds, 'source-specific state');
        if (
          previewEntered(current.initialState.deathConsequenceFactIdOrNull, 'death consequence') !==
          null
        )
          throw new NpcOrdinaryPreviewInputError('NOT_YET_SUPPORTED', 'death consequence');
        const person = { ...previewSections(current.identity), ...previewSections(current.schema) };
        if (ordinaryState === null && person['raceCode'] !== 'PURE')
          throw new NpcOrdinaryPreviewInputError('NOT_YET_SUPPORTED', 'race');
        const composition =
          ordinaryStats?.current.composition ??
          evaluateNpcCompositionConsequences(
            sources.compositionConsequences,
            {
              identityKey: attempt.candidateNpcUuid,
              binding: { journalId: initialPrefix.rootOperationId, raceCode: person['raceCode'] },
              confirmations: [],
              resolutions: [],
            },
            null,
          );
        preview = previewNpcHumanoid(
          sources.humanoid,
          {
            npcUuid: attempt.candidateNpcUuid,
            owningControllerId: attempt.scope.gmLocalContextId,
            compositionProof: composition.proof,
            ...(ordinaryStats === null
              ? {}
              : {
                  ordinaryProof: ordinaryStats.ordinaryProof,
                  previousSkillProofOrNull: ordinaryState?.skillProofOrNull ?? null,
                }),
            input: {
              identity: person,
              baseStats: previewSections(current.baseStats),
              symbionts:
                ordinaryStats === null
                  ? []
                  : ordinaryStats.current.symbionts.map(
                      ({
                        symbiontInstanceId,
                        speciesKey,
                        targetLevel,
                        learnedNodeRefs,
                        binding,
                        currentOE,
                      }) => ({
                        symbiontInstanceId,
                        speciesKey,
                        targetLevel,
                        learnedNodeRefs,
                        binding,
                        currentOE,
                      }),
                    ),
              skills: previewEntered(current.skills, 'skills').map((selection) =>
                previewSections(selection),
              ),
              lifetimeFacts: composition.lifetimeFacts,
              inventory,
              initialState: {
                currentHP: previewEntered(current.initialState.currentHP, 'currentHP'),
                dead: life?.state.dead ?? false,
                currentTraumas: traumaInput.currentTraumas,
                currentWounds: wounds?.facts.map((f) => f.wound) ?? [],
                effectInstances: [],
                sourceSpecificStates: [],
                deathTimerRollFactOrNull: null,
              },
            },
          },
          { assignments: diseaseAssignments },
          traumaPreview,
          equipment,
          wounds,
          runtimePreview(attempt, calendar, calendarAnchorOrNull),
          inventoryContext,
          life?.preview ?? null,
          poison?.context ?? null,
        );
      } catch (error) {
        if (error instanceof NpcOrdinarySkillReconfirmationRequiredError)
          throw new NpcOrdinaryPreviewInputError('INCOMPLETE', error.message);
        if (error instanceof NpcPoisonReadInputError)
          throw new NpcOrdinaryPreviewInputError('INCOMPLETE', error.message);
        if (error instanceof NpcStagedInputError)
          throw new NpcOrdinaryPreviewInputError('INCOMPLETE', error.message);
        if (error instanceof NpcCleanHumanoidError || error instanceof NpcInventoryPublicationError)
          throw new NpcOrdinaryPreviewInputError(error.code, error.message);
        if (
          error instanceof NpcBaseStatRuleError ||
          error instanceof SkillStageRuleError ||
          error instanceof NpcInitialTraumaError ||
          error instanceof NpcLifePreparationError ||
          error instanceof NpcFormalLifeError ||
          error instanceof NpcFormalWeaverCurrentUnavailableError ||
          error instanceof NpcEquipmentValidationError
        )
          throw new NpcOrdinaryPreviewInputError('INVALID', error.message);
        throw error;
      }
      return {
        kind: 'UNCOMMITTED',
        binding: {
          scope: { ...attempt.scope },
          npcUuid: attempt.candidateNpcUuid,
          npcDraftId: attempt.npcDraftId,
          attemptRevision: attempt.revision,
          targetVersion: evidence.target.targetVersion,
          stage: attempt.stage,
        },
        sheet: preview.sheet,
        art: art(current, null, evidence.previousOrNull, evidence.current),
        preStartTimeOrNull:
          preview.sheet.requiresCampaignTime && calendar.currentClock.phase === 'PRE_START'
            ? calendar.currentClock.campaignTimestampOrNull
            : null,
      };
    },
    prepare(attempt, operationId, previous, calendar, audit, inventory) {
      requireCalendar(calendar, attempt.scope);
      equal(
        audit.beforeGmSource.queuePrefix,
        calendar.currentQueuePrefixOrNull,
        'current COMMIT prefix',
      );
      if (calendar.operations.some((o) => o.operationId === operationId))
        return fail('prepare requires an uncommitted operation');
      const pending = npcPendingCommitEvidenceValue({
        kind: 'PENDING_NPC_COMMIT',
        scope: attempt.scope,
        operationId,
        npcUuid: attempt.candidateNpcUuid,
        npcDraftId: attempt.npcDraftId,
        version: previous === null ? 1 : previous.version + 1,
        attemptRevision: attempt.revision + 1,
        committedAt: audit.committedAt,
        beforeCheckpointSha256: s.sha(s.canonical(calendar.checkpoint)),
        beforeGmSource: audit.beforeGmSource,
      });
      if (inventory !== undefined)
        equal(inventory.committedAt, pending.committedAt, 'inventory and version audit');
      return resolve(attempt, operationId, previous, calendar, pending, inventory).prepared;
    },
    validateVersion(
      version,
      committed,
      previous,
      context,
      pending,
      storedChildGraphOrNull,
      snapshotRead,
    ) {
      const calendar = requireCalendar(context, version.scope);
      const validationBinding = { version, committed, previous, pending, storedChildGraphOrNull };
      const completedRead = beginLocalSnapshotRead(
        snapshotRead,
        'PREVIOUS_VERSION',
        validationBinding,
        calendar,
      );
      if (committed.status !== 'COMMITTED' || committed.revision < 1)
        return fail('committed attempt required');
      const {
        prepared: expected,
        evidence,
        derivedSnapshot,
        previousSnapshot,
      } = resolve(
        { ...committed, status: 'OPEN', revision: committed.revision - 1 },
        version.operationId,
        previous,
        calendar,
        pending,
        undefined,
        version,
      );
      if (evidence.committedOrNull !== null)
        equal(version, evidence.committedOrNull.record, 'stored version bytes');
      equal(
        [
          version.scope,
          version.npcUuid,
          version.npcDraftId,
          version.attemptRevision,
          version.version,
        ],
        [
          committed.scope,
          committed.candidateNpcUuid,
          committed.npcDraftId,
          committed.revision,
          previous === null ? 1 : previous.version + 1,
        ],
        'version binding',
      );
      equal(version.snapshot, expected.snapshot, 'confirmed snapshot');
      // Resolve already derived this snapshot from the real history; do not decode it again.
      if (storedChildGraphOrNull !== null)
        equal(
          storedChildGraphOrNull,
          snapshotChildGraph(derivedSnapshot, calendar, pending),
          'confirmed stored child graph',
        );
      equal(version.lifetimeFacts, expected.lifetimeFacts, 'confirmed lifetime');
      equal(
        version.art,
        { assetKey: expected.art.assetKey, sha256: expected.art.sha256 },
        'confirmed art',
      );
      if (completedRead !== undefined) {
        if (previousSnapshot === null) return s.fail('SOURCE_CHANGED');
        completeLocalSnapshotRead(completedRead, validationBinding, calendar, previousSnapshot);
      }
    },
  };
  return readers;
}
