import {
  restoreNpcOrdinaryComposition,
  previewNpcOrdinaryCompositionEdit,
} from '../domain/rules/npc-authoring/ordinary-composition.js';
import {
  evaluateNpcSkills,
  type NpcSkillProof,
  type NpcSkillContext,
} from '../domain/rules/npc-authoring/skill-evaluation.js';
import { calculateSkillSlotCost } from '../domain/rules/skill-stage/skills.js';
import type { NpcSkillAccountingFact } from '../domain/rules/npc-authoring/skill-accounting.js';
import {
  createRollSourceSnapshot,
  resolveAutoRoll,
  resolveManualRoll,
  type RollFaceSampler,
  type RollMode,
} from '../domain/entities/roll-request/roll-model.js';
import { deriveNpcBaseStatLayers } from '../domain/rules/npc-authoring/base-stats.js';
import { evaluateNpcCompositionConsequences } from '../domain/rules/npc-authoring/composition-consequences.js';
import type {
  NpcCompositionConfirmation,
  NpcCompositionConsequenceProof,
  NpcCompositionConsequenceResult,
  NpcCompositionResolution,
  NpcRecordedCompositionRoll,
} from '../domain/rules/npc-authoring/composition-consequence-types.js';
import type { NpcOrdinaryCompositionFact } from '../domain/rules/npc-authoring/ordinary-composition-types.js';
import { deriveNpcOrdinaryStatProfile } from '../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import {
  npcOrdinaryInventoryIsStatNeutral,
  type NpcOrdinaryHumanoidProof,
  type NpcOrdinaryStatFact,
} from '../domain/rules/npc-authoring/ordinary-humanoid-proof.js';
import {
  readNpcEditorDraft,
  projectNpcSymbiontInputs,
  projectNpcInventoryRequest,
  type NpcEditorCatalog,
  type NpcEditorDraft,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcDraftSection, NpcSymbiontInput } from '../domain/rules/npc-authoring/types.js';
import type { NpcPreparationRequest } from '@shared/npc-command.js';
import { npcTechnicalRequestValue } from '@shared/npc-command.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { NpcAttemptReadContext } from '../persistence/npc-child-identities.js';
import type { readNpcCompositionDerivationEvidenceInTransaction } from '../persistence/npc-gm-source.js';
import {
  campaignParts,
  type NpcOrdinaryAuthoringFact,
} from '../persistence/npc-library-records.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import type { CampaignCheckpoint } from '../persistence/store.js';
import type { NpcAuthoringSourceCatalog } from './npc-catalog.js';
import { npcEditorForItemAttempt } from './npc-item-preparation.js';

type Sources = Pick<
  NpcAuthoringSourceCatalog,
  | 'baseStats'
  | 'compositionConsequences'
  | 'ordinaryHumanoid'
  | 'ordinaryComposition'
  | 'inventory'
  | 'inventoryPublication'
  | 'skills'
>;
export type NpcCompositionAuthoringEvidence = ReturnType<
  typeof readNpcCompositionDerivationEvidenceInTransaction
>;
export interface NpcCompositionAuthoringBase {
  readonly compositionProof: NpcCompositionConsequenceProof;
  readonly ordinaryProof: NpcOrdinaryHumanoidProof | null;
  readonly skillProofOrNull: NpcSkillProof | null;
}
export interface NpcCompositionAuthoringState extends NpcCompositionAuthoringBase {
  readonly result: NpcCompositionConsequenceResult;
  readonly evidence: NpcCompositionAuthoringEvidence;
  readonly context: NpcAttemptReadContext;
  readonly draft: NpcEditorDraft;
  /** Ephemeral source catalog scoped to this checked attempt, never serialized. */
  readonly inventoryEditor: NpcEditorCatalog;
}
const equal = (a: unknown, b: unknown): void => {
  if (!s.same(a, b)) s.fail('INVALID_INPUT');
};
const json = (value: unknown): JsonObject =>
  s.object(JSON.parse(s.canonical(value)) as unknown) as JsonObject;
function entered<T>(value: NpcDraftSection<T>): T {
  return value.kind === 'ENTERED' ? value.value : s.fail('INVALID_INPUT');
}
function sourceInput(sources: Sources, draft: NpcEditorDraft) {
  return deriveNpcBaseStatLayers(sources.baseStats, {
    schema: {
      raceCode: entered(draft.schema.raceCode),
      pureClassOrNull: entered(draft.schema.pureClassOrNull),
      anatomyProfileId: entered(draft.schema.anatomyProfileId),
      sex: entered(draft.identity.sex),
      massKg: entered(draft.identity.massKg),
    },
    baseStats: {
      S: entered(draft.baseStats.S),
      D: entered(draft.baseStats.D),
      M: entered(draft.baseStats.M),
      Z: entered(draft.baseStats.Z),
      I: entered(draft.baseStats.I),
      W: entered(draft.baseStats.W),
      C: entered(draft.baseStats.C),
    },
  });
}
export function npcCompositionDiceMode(checkpoint: CampaignCheckpoint): RollMode {
  const mode = campaignParts(checkpoint).payload['defaultFutureRollMode'];
  if (mode !== 'AUTO' && mode !== 'MANUAL') return s.fail('INVALID_INPUT');
  return mode;
}
function currentRows(result: NpcCompositionConsequenceResult): readonly NpcSymbiontInput[] {
  return result.composition.instances
    .filter((i) => i.status === 'ACTIVE' || i.status === 'SUPPRESSED')
    .map((i) => ({
      symbiontInstanceId: i.symbiontInstanceId,
      speciesKey: i.speciesKey,
      targetLevel: i.targetLevel,
      learnedNodeRefs: i.learnedNodeRefs,
      binding: i.binding,
      currentOE: i.currentOE,
    }));
}
function editorRows(rows: readonly NpcSymbiontInput[]) {
  return {
    kind: 'ENTERED' as const,
    value: rows.map(({ symbiontInstanceId, ...input }) => ({
      symbiontInstanceId,
      input: {
        speciesKey: { kind: 'ENTERED' as const, value: input.speciesKey },
        targetLevel: { kind: 'ENTERED' as const, value: input.targetLevel },
        learnedNodeRefs: { kind: 'ENTERED' as const, value: input.learnedNodeRefs },
        binding: { kind: 'ENTERED' as const, value: input.binding },
        currentOE: { kind: 'ENTERED' as const, value: input.currentOE },
      },
    })),
  };
}
function compositionEdit(
  result: NpcCompositionConsequenceResult,
  selected: readonly NpcSymbiontInput[],
  raceCode: NpcOrdinaryCompositionFact['raceCode'],
) {
  const current = currentRows(result),
    old = result.composition.instances;
  for (const row of selected) {
    const prior = old.find((i) => i.symbiontInstanceId === row.symbiontInstanceId);
    if (
      prior !== undefined &&
      (prior.speciesKey !== row.speciesKey ||
        (prior.status !== 'ACTIVE' && prior.status !== 'SUPPRESSED'))
    )
      return s.fail('INVALID_INPUT');
  }
  return {
    raceCode,
    removals: current
      .filter((i) => !selected.some((n) => n.symbiontInstanceId === i.symbiontInstanceId))
      .map((i) => i.symbiontInstanceId),
    additions: selected.filter(
      (i) => !old.some((o) => o.symbiontInstanceId === i.symbiontInstanceId),
    ),
    buildChanges: selected.flatMap((i) => {
      const prior = current.find((o) => o.symbiontInstanceId === i.symbiontInstanceId);
      return prior !== undefined &&
        !s.same(
          [prior.targetLevel, prior.learnedNodeRefs, prior.binding],
          [i.targetLevel, i.learnedNodeRefs, i.binding],
        )
        ? [
            {
              symbiontInstanceId: i.symbiontInstanceId,
              targetLevel: i.targetLevel,
              learnedNodeRefs: i.learnedNodeRefs,
              binding: i.binding,
            },
          ]
        : [];
    }),
    currentOeChanges: selected.flatMap((i) => {
      const prior = current.find((o) => o.symbiontInstanceId === i.symbiontInstanceId);
      return prior !== undefined && prior.currentOE !== i.currentOE
        ? [{ symbiontInstanceId: i.symbiontInstanceId, currentOE: i.currentOE }]
        : [];
    }),
  };
}
function statFact(
  id: string,
  draft: NpcEditorDraft,
  sources: Sources,
  proof: NpcCompositionConsequenceProof,
  editor: NpcEditorCatalog,
  includeEquipmentEvidence = true,
): NpcOrdinaryStatFact {
  const input = sourceInput(sources, draft);
  return {
    contextFactId: id,
    schema: input.schema,
    baseStats: input.baseStats,
    compositionOrdinal: proof.confirmations.length,
    resolutionOrdinal: proof.resolutions.length,
    ...(includeEquipmentEvidence && draft.inventory.kind === 'ENTERED'
      ? { equippedInventory: projectNpcInventoryRequest(editor, draft.inventory) }
      : {}),
  };
}
function pushFact(
  base: NpcCompositionAuthoringBase,
  fact: NpcOrdinaryAuthoringFact,
): NpcCompositionAuthoringBase {
  const compositionProof = {
    ...base.compositionProof,
    confirmations:
      fact.kind === 'CONFIRMATION'
        ? [...base.compositionProof.confirmations, fact.confirmation]
        : base.compositionProof.confirmations,
    resolutions:
      fact.kind === 'RESOLUTION'
        ? [...base.compositionProof.resolutions, fact.resolution]
        : base.compositionProof.resolutions,
  };
  return {
    compositionProof,
    skillProofOrNull:
      fact.kind === 'RESOLUTION' &&
      fact.resolution.kind === 'GROSS_SKILL_GRANT' &&
      'skillProof' in fact.resolution
        ? fact.resolution.skillProof
        : base.skillProofOrNull,
    ordinaryProof: {
      currentStatContextFactId: fact.statContext.contextFactId,
      statContexts: [
        ...(base.ordinaryProof?.statContexts ?? []),
        ...(fact.kind === 'CONFIRMATION' ? [fact.beforeStatContext] : []),
        fact.statContext,
      ],
    },
  };
}
function profile(sources: Sources, base: NpcCompositionAuthoringBase) {
  if (base.ordinaryProof === null) return s.fail('INVALID_INPUT');
  return deriveNpcOrdinaryStatProfile(sources.ordinaryHumanoid, {
    npcUuid: base.compositionProof.identityKey,
    compositionProof: base.compositionProof,
    ordinaryProof: base.ordinaryProof,
  });
}
function confirmation(
  sources: Sources,
  editor: NpcEditorCatalog,
  base: NpcCompositionAuthoringBase,
  draft: NpcEditorDraft,
  operationId: string,
  mode: RollMode,
  includeEquipmentEvidence = true,
): NpcOrdinaryAuthoringFact {
  const result = evaluateNpcCompositionConsequences(
    sources.compositionConsequences,
    base.compositionProof,
    null,
  );
  if (result.obligationStatus !== 'RESOLVED') return s.fail('UNAVAILABLE');
  const input = sourceInput(sources, draft);
  const selected = projectNpcSymbiontInputs(editor, draft.symbionts);
  const edit = compositionEdit(result, selected, input.schema.raceCode);
  if (
    edit.raceCode === result.composition.raceCode &&
    edit.removals.length === 0 &&
    edit.additions.length === 0 &&
    edit.buildChanges.length === 0 &&
    edit.currentOeChanges.length === 0
  )
    return {
      kind: 'STAT_CONTEXT',
      statContext: statFact(
        operationId,
        draft,
        sources,
        base.compositionProof,
        editor,
        includeEquipmentEvidence,
      ),
    };
  const confirmed: NpcCompositionConfirmation = {
    input: {
      kind: 'APPLY_COMPOSITION_EDIT',
      factId: operationId,
      journalId: base.compositionProof.binding.journalId,
      ordinal: base.compositionProof.confirmations.length + 1,
      ...compositionEdit(result, selected, input.schema.raceCode),
    },
    confirmationCommandId: operationId,
    diceModeSnapshot: mode,
  };
  const nextProof = {
    ...base.compositionProof,
    confirmations: [...base.compositionProof.confirmations, confirmed],
  };
  const previousSchema = base.ordinaryProof?.statContexts.at(-1)?.schema ?? input.schema;
  const beforeStatContext = {
    ...statFact(
      'NPC_STAT_CONTEXT/' + operationId + '/BEFORE',
      draft,
      sources,
      base.compositionProof,
      editor,
      includeEquipmentEvidence,
    ),
    schema: previousSchema,
  };
  if (previousSchema.raceCode !== result.composition.raceCode) return s.fail();
  return {
    kind: 'CONFIRMATION',
    confirmation: confirmed,
    beforeStatContext,
    statContext: statFact(operationId, draft, sources, nextProof, editor, includeEquipmentEvidence),
  };
}
function boundEditor(
  base: NpcEditorCatalog,
  sources: Sources,
  context: NpcAttemptReadContext,
  result: NpcCompositionConsequenceResult,
): NpcEditorCatalog {
  const scoped = npcEditorForItemAttempt(base, sources.inventory, context);
  return {
    ...scoped,
    composition: (scoped.composition ?? []).map((b) => {
      const old = result.composition.instances.find(
        (i) => i.symbiontInstanceId === b.symbiontInstanceId,
      );
      return old === undefined
        ? b
        : {
            ...b,
            speciesKeyOrNull: old.speciesKey,
            retired: old.status !== 'ACTIVE' && old.status !== 'SUPPRESSED',
          };
    }),
  };
}
function inventoryContextAt(
  context: NpcAttemptReadContext,
  evidence: NpcCompositionAuthoringEvidence,
  revision: number,
): NpcAttemptReadContext {
  return {
    ...context,
    revision,
    pendingItemOrNull: null,
    itemBindings: context.itemBindings.filter((binding) => {
      if (binding.originDraftId !== context.npcDraftId) return true;
      const reservation = evidence.current.itemReservations.find(
        (r) =>
          r.itemInstanceId === binding.itemInstanceId &&
          r.operationId === binding.originOperationId &&
          r.eventSha256 === binding.originEventSha256,
      );
      return reservation !== undefined && reservation.attemptRevision <= revision;
    }),
  };
}
function baseConfirmed(
  draft: NpcEditorDraft,
  confirmationValues: JsonObject | null,
  editor: NpcEditorCatalog,
): void {
  if (confirmationValues === null) return s.fail('UNAVAILABLE');
  const confirmed = readNpcEditorDraft(editor, confirmationValues);
  equal(
    [draft.identity.sex, draft.identity.massKg, draft.schema, draft.baseStats],
    [confirmed.identity.sex, confirmed.identity.massKg, confirmed.schema, confirmed.baseStats],
  );
}
function selectedCapability(state: NpcCompositionAuthoringState, key: string) {
  const capabilities = npcCompositionContinuations(state);
  const matches = capabilities.filter((c) => c.capabilityKey === key);
  if (matches.length !== 1 || matches[0] === undefined) return s.fail('STALE_REVISION');
  return matches[0];
}
export function npcCompositionContinuations(state: NpcCompositionAuthoringState) {
  return state.result.unresolvedRequirements.map((requirement) => {
    let kind:
      | 'FREE_SLOT_ROLL'
      | 'ADVISER_IW_ROLLS'
      | 'ADVISER_SKILLS'
      | 'ADVISER_SUPPRESSION_ROLL'
      | 'GROSS_SKILL_GRANT'
      | 'TROGR_STAT_CLOSURE';
    if (requirement.kind === 'FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE') kind = 'FREE_SLOT_ROLL';
    else if (requirement.kind === 'ADVISER_CARD_AND_SKILLS')
      kind = state.result.advisorContinuations.some(
        (c) => c.symbiontInstanceId === requirement.symbiontInstanceId,
      )
        ? 'ADVISER_SKILLS'
        : 'ADVISER_IW_ROLLS';
    else if (requirement.kind === 'TROGR_PERMANENT_STAT_CLOSURE') kind = 'TROGR_STAT_CLOSURE';
    else kind = requirement.kind;
    const confirmation =
      state.compositionProof.confirmations.find(
        (c) => c.input.factId === requirement.causedByFactId,
      ) ?? s.fail();
    return {
      kind,
      requirement,
      confirmation,
      capabilityKey: [
        state.evidence.current.openAttempt.npcDraftId,
        state.evidence.current.openAttempt.revision,
        kind,
        requirement.causedByFactId,
        'symbiontInstanceId' in requirement ? requirement.symbiontInstanceId : '',
      ].join(':'),
    };
  });
}
export function validateNpcCompositionContinuation(
  state: NpcCompositionAuthoringState,
  request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>,
) {
  if (request.preparation.kind !== 'COMPOSITION_RESOLVE') return s.fail('INVALID_INPUT');
  const capability = selectedCapability(state, request.preparation.capabilityKey),
    input = request.preparation.input;
  if (capability.kind !== input.kind) return s.fail('INVALID_INPUT');
  if ('manualFaces' in input) {
    const count = input.kind === 'ADVISER_IW_ROLLS' ? 2 : 1,
      sides = input.kind === 'FREE_SLOT_ROLL' ? 6 : 20;
    if (capability.confirmation.diceModeSnapshot === 'AUTO') {
      if (input.manualFaces !== null) return s.fail('INVALID_INPUT');
    } else if (
      input.manualFaces === null ||
      input.manualFaces.length !== count ||
      input.manualFaces.some((v) => !Number.isSafeInteger(v) || v < 1 || v > sides)
    )
      return s.fail('INVALID_INPUT');
  }
  return capability;
}
/** Replays only host-issued facts from the already checked immutable SQL prefix. */
export function readNpcCompositionAuthoring(
  sources: Sources,
  editor: NpcEditorCatalog,
  evidence: NpcCompositionAuthoringEvidence,
  context: NpcAttemptReadContext,
  baseline: NpcCompositionAuthoringBase | null,
): NpcCompositionAuthoringState {
  equal(
    [context.scope, context.npcDraftId, context.revision],
    [
      evidence.current.openAttempt.scope,
      evidence.current.openAttempt.npcDraftId,
      evidence.current.openAttempt.revision,
    ],
  );
  const initialEditor = npcEditorForItemAttempt(editor, sources.inventory, context),
    draft = readNpcEditorDraft(initialEditor, evidence.current.openAttempt.values);
  let base: NpcCompositionAuthoringBase = baseline ?? {
    compositionProof: {
      identityKey: evidence.target.npcUuid,
      binding: {
        journalId:
          evidence.initialOrNull?.prefix.rootOperationId ?? evidence.current.rootOperationId,
        raceCode: sourceInput(sources, draft).schema.raceCode,
      },
      confirmations: [],
      resolutions: [],
    },
    ordinaryProof: null,
    skillProofOrNull: null,
  };
  for (const entry of evidence.current.ordinaryFacts) {
    const result = evaluateNpcCompositionConsequences(
      sources.compositionConsequences,
      base.compositionProof,
      null,
    );
    const scoped = boundEditor(
        editor,
        sources,
        inventoryContextAt(context, evidence, entry.previous.revision),
        result,
      ),
      before = readNpcEditorDraft(scoped, entry.previous.values);
    const request = npcTechnicalRequestValue(entry.operation.request);
    if (
      request.messageType !== 'network.npc-preparation.request' ||
      request.sourceFormId !== 'NPC-013'
    )
      return s.fail();
    if (entry.fact.kind === 'CONFIRMATION' || entry.fact.kind === 'STAT_CONTEXT') {
      if (request.preparation.kind !== 'COMPOSITION_CONFIRM') return s.fail();
      equal(request.preparation.values, before.symbionts);
      baseConfirmed(before, entry.baseStatsConfirmation?.values ?? null, scoped);
      // A future reservation must not authenticate an earlier purported acquisition.
      for (const added of entry.fact.kind === 'CONFIRMATION'
        ? entry.fact.confirmation.input.additions
        : []) {
        const own = evidence.current.symbiontReservations.find(
          (r) => r.symbiontInstanceId === added.symbiontInstanceId,
        );
        if (own === undefined || own.attemptRevision >= entry.event.attempt.revision)
          return s.fail();
      }
      equal(
        entry.fact,
        confirmation(
          sources,
          scoped,
          base,
          before,
          entry.operation.operationId,
          npcCompositionDiceMode(entry.operation.beforeCheckpoint),
          Object.hasOwn(entry.fact.statContext, 'equippedInventory'),
        ),
      );
    } else {
      // The exact request and recorded roll provenance are checked by the owning continuation below.
      if (request.preparation.kind !== 'COMPOSITION_RESOLVE') return s.fail();
      const state = {
        ...base,
        result,
        evidence: { ...evidence, current: { ...evidence.current, openAttempt: entry.previous } },
        context,
        draft: before,
        inventoryEditor: scoped,
      };
      const capability = validateNpcCompositionContinuation(state, request);
      validateRecordedResolution(sources, state, request, entry.fact.resolution, capability);
      const next = {
        ...base.compositionProof,
        resolutions: [...base.compositionProof.resolutions, entry.fact.resolution],
      };
      equal(
        entry.fact.statContext,
        statFact(
          entry.operation.operationId,
          before,
          sources,
          next,
          scoped,
          Object.hasOwn(entry.fact.statContext, 'equippedInventory'),
        ),
      );
    }
    base = pushFact(base, entry.fact);
    const derived = profile(sources, base);
    equal(entry.event.attempt.values, {
      ...before,
      symbionts: editorRows(currentRows(derived.current.composition)),
    });
  }
  const result = evaluateNpcCompositionConsequences(
    sources.compositionConsequences,
    base.compositionProof,
    null,
  );
  return { ...base, result, evidence, context, draft, inventoryEditor: initialEditor };
}
export function prepareNpcCompositionConfirmation(
  sources: Sources,
  editor: NpcEditorCatalog,
  state: NpcCompositionAuthoringState,
  request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>,
  checkpoint: CampaignCheckpoint,
) {
  if (request.preparation.kind !== 'COMPOSITION_CONFIRM') return s.fail('INVALID_INPUT');
  const scoped = boundEditor(editor, sources, state.context, state.result);
  equal(request.preparation.values, state.draft.symbionts);
  baseConfirmed(
    state.draft,
    state.evidence.current.baseStatsConfirmationOrNull?.values ?? null,
    scoped,
  );
  const ordinaryFact = confirmation(
    sources,
    scoped,
    state,
    state.draft,
    request.operationId,
    npcCompositionDiceMode(checkpoint),
  );
  const next = pushFact(state, ordinaryFact),
    derived = profile(sources, next);
  return {
    ordinaryFact,
    values: json({
      ...state.draft,
      symbionts: editorRows(currentRows(derived.current.composition)),
    }),
  };
}
function validateRecordedResolution(
  sources: Sources,
  state: NpcCompositionAuthoringState,
  request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>,
  resolution: NpcCompositionResolution,
  capability: ReturnType<typeof selectedCapability>,
): void {
  if (request.preparation.kind !== 'COMPOSITION_RESOLVE') return s.fail();
  const expectedCommon = {
    factId: request.operationId,
    ordinal: state.compositionProof.resolutions.length + 1,
    compositionOrdinal: state.compositionProof.confirmations.length,
    causedByFactId: capability.requirement.causedByFactId,
  };
  equal(
    [
      resolution.factId,
      resolution.ordinal,
      resolution.compositionOrdinal,
      resolution.causedByFactId,
    ],
    Object.values(expectedCommon),
  );
  const input = request.preparation.input;
  const actualRolls =
    resolution.kind === 'FREE_SLOT_ROLL' || resolution.kind === 'ADVISER_SUPPRESSION_ROLL'
      ? [resolution.roll]
      : resolution.kind === 'ADVISER_IW_ROLLS'
        ? resolution.rolls
        : [];
  actualRolls.forEach((roll, index) => {
    equal(
      [
        roll.factId,
        roll.rollRequestId,
        roll.rollReceiptId,
        roll.originatingCommandId,
        roll.modeSnapshot,
      ],
      [
        'NPC_COMPOSITION_ROLL/' + request.operationId + '/' + (index + 1) + '/FACT',
        'NPC_COMPOSITION_ROLL/' + request.operationId + '/' + (index + 1) + '/REQUEST',
        'NPC_COMPOSITION_ROLL/' + request.operationId + '/' + (index + 1) + '/RECEIPT',
        capability.confirmation.confirmationCommandId,
        capability.confirmation.diceModeSnapshot,
      ],
    );
    if ('manualFaces' in input && input.manualFaces !== null)
      equal(roll.mechanical.rawFace, input.manualFaces[index]);
  });
  const current = profile(sources, state).current,
    ref = state.ordinaryProof?.currentStatContextFactId ?? s.fail();
  if (resolution.kind === 'FREE_SLOT_ROLL')
    equal(
      [resolution.statContextFactId, resolution.permanentStatsBefore],
      [ref, current.stats.permanentStats],
    );
  if (resolution.kind === 'ADVISER_SKILLS') {
    if (request.preparation.input.kind !== 'ADVISER_SKILLS') return s.fail();
    equal(resolution.selectedSkills, request.preparation.input.selectedSkills);
    equal(
      [resolution.bodyContextFactId, resolution.bodyStats],
      [
        ref,
        {
          S: current.stats.permanentStats.S,
          D: current.stats.permanentStats.D,
          M: current.stats.permanentStats.M,
          Z: current.stats.permanentStats.Z,
          C: current.stats.permanentStats.C,
        },
      ],
    );
  }
  if ('symbiontInstanceId' in resolution)
    equal(
      resolution.symbiontInstanceId,
      'symbiontInstanceId' in capability.requirement
        ? capability.requirement.symbiontInstanceId
        : null,
    );
  if (resolution.kind === 'ADVISER_IW_ROLLS')
    equal(resolution.cardId, 'NPC_ADVISER_CARD/' + request.operationId);
  const expectedKind =
    request.preparation.input.kind === 'TROGR_STAT_CLOSURE'
      ? 'TROGR_PERMANENT_STAT_CLOSURE'
      : request.preparation.input.kind;
  equal(resolution.kind, expectedKind);
  if (resolution.kind === 'GROSS_SKILL_GRANT')
    equal(
      resolution,
      grossResolution(
        sources,
        state,
        request.operationId,
        expectedCommon,
        resolution.symbiontInstanceId,
      ),
    );
}
export function prepareNpcCompositionResolution(
  sources: Sources,
  state: NpcCompositionAuthoringState,
  request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>,
  sample: RollFaceSampler,
) {
  const capability = validateNpcCompositionContinuation(state, request);
  if (request.preparation.kind !== 'COMPOSITION_RESOLVE') return s.fail();
  const input = request.preparation.input,
    current = profile(sources, state),
    ref = state.ordinaryProof?.currentStatContextFactId ?? s.fail();
  const common = {
    factId: request.operationId,
    ordinal: state.compositionProof.resolutions.length + 1,
    compositionOrdinal: state.compositionProof.confirmations.length,
    causedByFactId: capability.requirement.causedByFactId,
  };
  const symbiontInstanceId =
    'symbiontInstanceId' in capability.requirement
      ? capability.requirement.symbiontInstanceId
      : null;
  const roll = (sides: 6 | 20, index: number): NpcRecordedCompositionRoll => {
    const root = 'NPC_COMPOSITION_ROLL/' + request.operationId + '/' + (index + 1),
      mode = capability.confirmation.diceModeSnapshot;
    const source = {
      dieSides: sides,
      originatingCommandId: capability.confirmation.confirmationCommandId,
      rollRequestId: root + '/REQUEST',
    };
    const mechanical =
      mode === 'AUTO'
        ? resolveAutoRoll(
            {
              request: createRollSourceSnapshot({ ...source, modeSnapshot: 'AUTO' }),
              submitCommandId: root + '/RECEIPT',
            },
            null,
            sample,
          ).resolution.mechanical
        : (() => {
            const result = resolveManualRoll(
              createRollSourceSnapshot({ ...source, modeSnapshot: 'MANUAL' }),
              'manualFaces' in input ? input.manualFaces?.[index] : undefined,
            );
            return result.ok ? result.resolution.mechanical : s.fail('INVALID_INPUT');
          })();
    return {
      factId: root + '/FACT',
      rollRequestId: root + '/REQUEST',
      rollReceiptId: root + '/RECEIPT',
      originatingCommandId: source.originatingCommandId,
      modeSnapshot: mode,
      mechanical,
    };
  };
  let resolution: NpcCompositionResolution;
  if (input.kind === 'FREE_SLOT_ROLL')
    resolution = {
      ...common,
      kind: input.kind,
      statContextFactId: ref,
      permanentStatsBefore: current.current.stats.permanentStats,
      roll: roll(6, 0),
    };
  else if (input.kind === 'ADVISER_IW_ROLLS')
    resolution = {
      ...common,
      kind: input.kind,
      symbiontInstanceId: symbiontInstanceId ?? s.fail(),
      cardId: 'NPC_ADVISER_CARD/' + request.operationId,
      rolls: [roll(20, 0), roll(20, 1)],
    };
  else if (input.kind === 'ADVISER_SUPPRESSION_ROLL')
    resolution = {
      ...common,
      kind: input.kind,
      symbiontInstanceId: symbiontInstanceId ?? s.fail(),
      roll: roll(20, 0),
    };
  else if (input.kind === 'ADVISER_SKILLS')
    resolution = {
      ...common,
      kind: input.kind,
      symbiontInstanceId: symbiontInstanceId ?? s.fail(),
      bodyContextFactId: ref,
      bodyStats: {
        S: current.current.stats.permanentStats.S,
        D: current.current.stats.permanentStats.D,
        M: current.current.stats.permanentStats.M,
        Z: current.current.stats.permanentStats.Z,
        C: current.current.stats.permanentStats.C,
      },
      selectedSkills: input.selectedSkills,
    };
  else if (input.kind === 'GROSS_SKILL_GRANT')
    resolution = grossResolution(
      sources,
      state,
      request.operationId,
      common,
      symbiontInstanceId ?? s.fail(),
    );
  else if (input.kind === 'TROGR_STAT_CLOSURE') {
    const instance =
      state.result.composition.instances.find((i) => i.symbiontInstanceId === symbiontInstanceId) ??
      s.fail();
    const before = current.contexts
      .filter((c) => c.fact.compositionOrdinal < common.compositionOrdinal)
      .at(-1);
    const cause = state.compositionProof.confirmations.find(
      (c) => c.input.factId === common.causedByFactId,
    );
    const destroyedOnAcquisition =
      instance.status === 'DESTROYED' &&
      cause?.input.kind === 'APPLY_COMPOSITION_EDIT' &&
      cause.input.additions.some(
        (added) => added.symbiontInstanceId === instance.symbiontInstanceId,
      ) &&
      !state.compositionProof.confirmations
        .filter((c) => c.input.ordinal < common.compositionOrdinal)
        .some(
          (c) =>
            c.input.kind === 'APPLY_COMPOSITION_EDIT' &&
            c.input.additions.some(
              (added) => added.symbiontInstanceId === instance.symbiontInstanceId,
            ),
        );
    resolution = {
      ...common,
      kind: 'TROGR_PERMANENT_STAT_CLOSURE',
      symbiontInstanceId: instance.symbiontInstanceId,
      beforeRemovalOrNull:
        instance.status === 'ACTIVE' || instance.status === 'SUPPRESSED' || destroyedOnAcquisition
          ? null
          : before === undefined
            ? s.fail('UNAVAILABLE')
            : {
                statContextFactId: before.fact.contextFactId,
                nonTrogrBasis: before.profile.nonTrogrBasis,
                permanentStats: before.profile.stats.permanentStats,
              },
    };
  } else return s.fail('UNAVAILABLE');
  validateRecordedResolution(sources, state, request, resolution, capability);
  const proof = {
    ...state.compositionProof,
    resolutions: [...state.compositionProof.resolutions, resolution],
  };
  const ordinaryFact: NpcOrdinaryAuthoringFact = {
    kind: 'RESOLUTION',
    resolution,
    statContext: statFact(request.operationId, state.draft, sources, proof, state.inventoryEditor),
  };
  const next = pushFact(state, ordinaryFact),
    derived = profile(sources, next);
  return {
    ordinaryFact,
    values: json({
      ...state.draft,
      symbionts: editorRows(currentRows(derived.current.composition)),
    }),
  };
}

function skillContext(
  derived: ReturnType<typeof profile>,
  ref: string,
  ordinal: number,
  stage: NpcSkillContext['stage'],
  facts: readonly NpcSkillAccountingFact[],
  grossGrantSourceOrNull: NpcSkillContext['grossGrantSourceOrNull'] = null,
): NpcSkillContext {
  const source =
      derived.contexts.find((c) => c.fact.contextFactId === ref) ?? s.fail('INVALID_INPUT'),
    current = source.profile;
  if (current.invalidPermanentStats.length !== 0) return s.fail('INVALID_INPUT');
  const dolphin = current.composition.composition.instances.find(
    (i) =>
      i.speciesKey === 'DOLPHIN' &&
      i.status === 'ACTIVE' &&
      i.effectsEnabled &&
      i.learnedNodeRefs.includes('SYM-166'),
  );
  return {
    contextFactId: ref,
    ordinal,
    stage,
    raceCode: source.fact.schema.raceCode,
    classCode: source.fact.schema.pureClassOrNull,
    skillStageStats: current.stats.skillStageStats,
    permanentStats: current.stats.permanentStats,
    effectiveStats: current.stats.effectiveStats,
    grossGrantSourceOrNull,
    sym166SourceOrNull:
      dolphin === undefined
        ? null
        : { symbiontInstanceId: dolphin.symbiontInstanceId, nodeRef: 'SYM-166' },
    facts,
  };
}
/** Paid leaves belong to the actual COMMIT; the stat context belongs to the saved NPC014 confirmation. */
export function deriveNpcCompositionSkills(
  sources: Sources,
  state: NpcCompositionAuthoringState,
  confirmed: NpcEditorDraft,
  confirmationId: string,
  commitOperationId: string,
) {
  const derived = npcCompositionConfirmedStats(sources, state, confirmed, confirmationId);
  const contexts: NpcSkillContext[] = [...(state.skillProofOrNull?.contexts ?? [])];
  if (contexts.length === 0)
    for (const resolution of state.compositionProof.resolutions) {
      if (resolution.kind !== 'GROSS_SKILL_GRANT' || !('initialGrant' in resolution)) continue;
      const grant = resolution.initialGrant;
      contexts.push(
        skillContext(
          derived,
          grant.contextFactId,
          contexts.length + 1,
          'COMPOSITION_BEFORE_START',
          [grant],
          {
            sourceRuleId: 'SYM-079',
            symbiontInstanceId: resolution.symbiontInstanceId,
            sourceAcquisitionFactId: resolution.causedByFactId,
          },
        ),
      );
    }
  const before =
    state.skillProofOrNull === null
      ? null
      : evaluateNpcSkills(sources.skills, {
          mode: 'CREATE_V1',
          identityKey: state.compositionProof.identityKey,
          previousConfirmedProofOrNull: null,
          proof: state.skillProofOrNull,
        });
  const active = new Map(
    (before?.ledger.learnedSkills ?? []).map((skill) => [skill.skillKey, skill.bonus]),
  );
  if (before === null)
    for (const context of contexts)
      for (const grant of context.facts)
        if (grant.kind === 'TROGR_GROSS_GRANT')
          active.set(
            sources.skills.skills.find((s) => s.skillKey === 'GROSS')?.skillKey ??
              s.fail('INVALID_INPUT'),
            grant.bonusAfter,
          );
  let leafOrdinal = 0;
  const leaf = () => 'NPC_ORDINARY_SKILL/' + commitOperationId + '/' + ++leafOrdinal;
  if (state.skillProofOrNull !== null) {
    const last = contexts.at(-1)?.contextFactId ?? s.fail();
    const start = derived.contexts.findIndex((c) => c.fact.contextFactId === last);
    if (start < 0) return s.fail('INVALID_INPUT');
    for (const source of derived.contexts.slice(start + 1)) {
      if (source.fact.contextFactId === confirmationId) break;
      if (source.fact.inventoryConfirmationOperationId !== undefined) continue;
      if (source.profile.invalidPermanentStats.length !== 0) continue;
      const losses: NpcSkillAccountingFact[] = [];
      for (const [skillKey] of active)
        if (
          sources.skills.requirements.some(
            (r) =>
              r.skillKey === skillKey &&
              source.profile.stats.permanentStats[r.statCode] < r.minValue,
          )
        ) {
          losses.push({
            kind: 'PERMANENT_REQUIREMENT_LOSS',
            factId: leaf(),
            ordinal: contexts.flatMap((c) => c.facts).length + losses.length + 1,
            contextFactId: source.fact.contextFactId,
            sourceRuleId: 'CORE-166',
            skillKey,
          });
          active.delete(skillKey);
        }
      contexts.push(
        skillContext(derived, source.fact.contextFactId, contexts.length + 1, 'CONFIRMED', losses),
      );
    }
  }
  const facts: NpcSkillAccountingFact[] = [],
    nextOrdinal = () => contexts.flatMap((c) => c.facts).length + facts.length + 1;
  const current = derived.current.stats.permanentStats;
  for (const [skillKey] of active)
    if (
      sources.skills.requirements.some(
        (r) => r.skillKey === skillKey && current[r.statCode] < r.minValue,
      )
    ) {
      facts.push({
        kind: 'PERMANENT_REQUIREMENT_LOSS',
        factId: leaf(),
        ordinal: nextOrdinal(),
        contextFactId: confirmationId,
        sourceRuleId: 'CORE-166',
        skillKey,
      });
      active.delete(skillKey);
    }
  const selected = entered(confirmed.skills).map((row) => ({
    skillKey: entered(row.skillKey),
    targetBonus: entered(row.targetBonus),
    pool: entered(row.pool),
  }));
  if (state.skillProofOrNull === null)
    selected.sort((a, b) => (a.pool === 'START' ? 0 : 1) - (b.pool === 'START' ? 0 : 1));
  if (new Set(selected.map((s) => s.skillKey)).size !== selected.length)
    return s.fail('INVALID_INPUT');
  for (const [skillKey, bonus] of active) {
    // Automatic GROSS is not a paid selection, but an existing paid skill cannot be silently forgotten.
    const paid =
      before?.ledger.learnedSkills.find((s) => s.skillKey === skillKey)?.charges.length ?? 0;
    const selection = selected.find((s) => s.skillKey === skillKey);
    if (
      (paid !== 0 && selection === undefined) ||
      (selection !== undefined && selection.targetBonus < bonus)
    )
      return s.fail('INVALID_INPUT');
  }
  const dolphin = skillContext(
    derived,
    confirmationId,
    contexts.length + 1,
    'CONFIRMED',
    [],
  ).sym166SourceOrNull;
  for (const selection of selected) {
    const bonusBefore = active.get(selection.skillKey) ?? 0;
    if (selection.targetBonus === bonusBefore) continue;
    if (selection.targetBonus < bonusBefore) return s.fail('INVALID_INPUT');
    const common = {
      kind: 'PAID_ACQUISITION' as const,
      factId: leaf(),
      ordinal: nextOrdinal(),
      contextFactId:
        state.skillProofOrNull === null && selection.pool !== 'START'
          ? derived.ordinaryProof.currentStatContextFactId
          : confirmationId,
      skillKey: selection.skillKey,
      bonusBefore,
      bonusAfter: selection.targetBonus,
      chargedSlotCost:
        calculateSkillSlotCost(selection.targetBonus) -
        (bonusBefore === 0 ? 0 : calculateSkillSlotCost(bonusBefore)),
    };
    facts.push(
      selection.pool === 'SYM-166'
        ? {
            ...common,
            pool: 'SYM-166',
            symbiontInstanceId: dolphin?.symbiontInstanceId ?? s.fail('UNAVAILABLE'),
            nodeRef: 'SYM-166',
          }
        : { ...common, pool: selection.pool },
    );
    active.set(selection.skillKey, selection.targetBonus);
  }
  if (state.skillProofOrNull === null) {
    contexts.push(
      skillContext(
        derived,
        confirmationId,
        contexts.length + 1,
        'START_SELECTION',
        facts.filter((f) => f.contextFactId === confirmationId),
      ),
    );
    contexts.push(
      skillContext(
        derived,
        derived.ordinaryProof.currentStatContextFactId,
        contexts.length + 1,
        'CONFIRMED',
        facts.filter((f) => f.contextFactId !== confirmationId),
      ),
    );
  } else
    contexts.push(skillContext(derived, confirmationId, contexts.length + 1, 'CONFIRMED', facts));
  const proof = { identityKey: state.compositionProof.identityKey, contexts };
  const skills = evaluateNpcSkills(sources.skills, {
    mode: state.skillProofOrNull === null ? 'CREATE_V1' : 'APPEND_N_PLUS_ONE',
    identityKey: proof.identityKey,
    previousConfirmedProofOrNull: state.skillProofOrNull,
    proof,
  });
  return {
    ordinaryProof: derived.ordinaryProof,
    composition: derived.current.composition,
    symbionts: derived.current.symbionts,
    skills,
  };
}

/** Current draft equipment affects the NPC014 preview, but issues no confirmation or paid fact. */
export function npcCompositionCurrentSkillInventory(
  sources: Sources,
  state: NpcCompositionAuthoringState,
) {
  equal(state.context.operationId, state.evidence.current.openOperationId);
  if (state.draft.inventory.kind === 'UNSET') return {};
  const scoped = npcEditorForItemAttempt(state.inventoryEditor, sources.inventory, state.context);
  const requests = projectNpcInventoryRequest(scoped, state.draft.inventory);
  const last = state.ordinaryProof?.statContexts.at(-1);
  // Immediately after a real composition confirmation, that same operation already
  // proves this loadout. Reusing it avoids inventing a second context with its ID.
  if (
    last !== undefined &&
    last.inventoryConfirmationOperationId === undefined &&
    last.contextFactId === state.evidence.current.openOperationId &&
    s.same(last.equippedInventory, requests)
  )
    return {};
  return {
    currentInventory: {
      sourceOperationId: state.evidence.current.openOperationId,
      requests,
    },
  };
}

export function npcCompositionConfirmedStats(
  sources: Sources,
  state: NpcCompositionAuthoringState,
  confirmed: NpcEditorDraft,
  confirmationId: string,
) {
  if (state.ordinaryProof === null || state.result.obligationStatus !== 'RESOLVED')
    return s.fail('UNAVAILABLE');
  const savedConfirmation = state.evidence.current.skillConfirmation;
  const confirmationRevision =
    savedConfirmation !== null && savedConfirmation.operationId === confirmationId
      ? savedConfirmation.attemptRevision
      : state.context.revision;
  const scoped = npcEditorForItemAttempt(
    state.inventoryEditor,
    sources.inventory,
    inventoryContextAt(state.context, state.evidence, confirmationRevision),
  );
  const fact = statFact(confirmationId, confirmed, sources, state.compositionProof, scoped);
  const first = state.skillProofOrNull === null;
  const afterStart = 'NPC_SKILL_CONTEXT/' + confirmationId + '/AFTER_START';
  const ordinaryProof = {
    currentStatContextFactId: first ? afterStart : confirmationId,
    statContexts: [
      ...state.ordinaryProof.statContexts,
      ...(state.ordinaryProof.statContexts.some((c) => c.contextFactId === confirmationId)
        ? []
        : [fact]),
      ...(first ? [{ ...fact, contextFactId: afterStart }] : []),
    ],
  };
  const complete = { ...state, ordinaryProof },
    derived = profile(sources, complete);
  equal(derived.current.schema, sourceInput(sources, confirmed).schema);
  equal(derived.current.stats.baseStats, sourceInput(sources, confirmed).baseStats);
  equal(
    entered(confirmed.symbionts).map((row) => ({
      symbiontInstanceId: row.symbiontInstanceId,
      speciesKey: entered(row.input.speciesKey),
      targetLevel: entered(row.input.targetLevel),
      learnedNodeRefs: entered(row.input.learnedNodeRefs),
      binding: entered(row.input.binding),
      currentOE: entered(row.input.currentOE),
    })),
    currentRows(derived.current.composition),
  );
  return derived;
}

/** NPC015 proves only the current loadout. It cannot rewrite the paid NPC014 history. */
export function npcCompositionInventoryStats(
  sources: Sources,
  state: NpcCompositionAuthoringState,
  confirmedOrdinaryProof: NpcOrdinaryHumanoidProof,
) {
  const confirmation = state.evidence.current.inventoryConfirmationOrNull ?? s.fail('UNAVAILABLE');
  const scoped = npcEditorForItemAttempt(
    state.inventoryEditor,
    sources.inventory,
    inventoryContextAt(state.context, state.evidence, confirmation.attemptRevision),
  );
  const confirmed = readNpcEditorDraft(scoped, confirmation.values);
  const input = projectNpcInventoryRequest(scoped, confirmed.inventory);
  const currentEditor = npcEditorForItemAttempt(
    state.inventoryEditor,
    sources.inventory,
    state.context,
  );
  equal(input, projectNpcInventoryRequest(currentEditor, state.draft.inventory));
  const last = confirmedOrdinaryProof.statContexts.at(-1) ?? s.fail('INVALID_INPUT');
  const before = { ...state, ordinaryProof: confirmedOrdinaryProof };
  if (s.same(last.equippedInventory ?? [], input)) return profile(sources, before);
  if (
    npcOrdinaryInventoryIsStatNeutral(sources.inventoryPublication, last.equippedInventory ?? []) &&
    npcOrdinaryInventoryIsStatNeutral(sources.inventoryPublication, input)
  )
    return profile(sources, before);
  const contextFactId = 'NPC_CURRENT_INVENTORY/' + confirmation.operationId;
  const fact = {
    ...statFact(contextFactId, state.draft, sources, state.compositionProof, currentEditor),
    inventoryConfirmationOperationId: confirmation.operationId,
  };
  if (confirmedOrdinaryProof.statContexts.some((c) => c.contextFactId === contextFactId))
    return s.fail('INVALID_INPUT');
  return profile(sources, {
    ...state,
    ordinaryProof: {
      currentStatContextFactId: contextFactId,
      statContexts: [...confirmedOrdinaryProof.statContexts, fact],
    },
  });
}

/** Exact candidate display, with no future confirmation identity or fictional roll. */
export function previewNpcCompositionCandidate(
  sources: Sources,
  editor: NpcEditorCatalog,
  state: NpcCompositionAuthoringState,
) {
  const scoped = boundEditor(editor, sources, state.context, state.result);
  baseConfirmed(
    state.draft,
    state.evidence.current.baseStatsConfirmationOrNull?.values ?? null,
    scoped,
  );
  const input = sourceInput(sources, state.draft),
    selected = projectNpcSymbiontInputs(scoped, state.draft.symbionts);
  const restored = restoreNpcOrdinaryComposition(
    sources.ordinaryComposition,
    state.compositionProof.binding,
    state.compositionProof.confirmations.map((c) => c.input),
  );
  return previewNpcOrdinaryCompositionEdit(
    restored,
    compositionEdit(state.result, selected, input.schema.raceCode),
  );
}

export function assertNpcCompositionConfirmed(
  sources: Sources,
  editor: NpcEditorCatalog,
  state: NpcCompositionAuthoringState,
): void {
  if (state.result.obligationStatus !== 'RESOLVED') return s.fail('UNAVAILABLE');
  const current = sourceInput(sources, state.draft),
    selected = projectNpcSymbiontInputs(
      boundEditor(editor, sources, state.context, state.result),
      state.draft.symbionts,
    );
  equal(selected, currentRows(state.result));
  equal(current.schema.raceCode, state.result.composition.raceCode);
  if (state.ordinaryProof === null) {
    if (current.schema.raceCode !== 'PURE' || selected.length !== 0) return s.fail('UNAVAILABLE');
    return;
  }
  const checked = profile(sources, state);
  equal(
    [checked.current.schema, checked.current.stats.baseStats],
    [current.schema, current.baseStats],
  );
}

function grossResolution(
  sources: Sources,
  state: NpcCompositionAuthoringState,
  operationId: string,
  common: Pick<
    NpcCompositionResolution,
    'factId' | 'ordinal' | 'compositionOrdinal' | 'causedByFactId'
  >,
  symbiontInstanceId: string,
): Extract<NpcCompositionResolution, { kind: 'GROSS_SKILL_GRANT' }> {
  const derived = profile(sources, state),
    ref = derived.ordinaryProof.currentStatContextFactId,
    previous = state.skillProofOrNull;
  const old =
    previous === null
      ? null
      : evaluateNpcSkills(sources.skills, {
          mode: 'CREATE_V1',
          identityKey: state.compositionProof.identityKey,
          previousConfirmedProofOrNull: null,
          proof: previous,
        });
  const contexts: NpcSkillContext[] = [...(previous?.contexts ?? [])],
    active = new Map((old?.ledger.learnedSkills ?? []).map((s) => [s.skillKey, s.bonus]));
  const pending: NpcSkillAccountingFact[] = [];
  if (previous !== null) {
    const index = derived.contexts.findIndex(
      (c) => c.fact.contextFactId === previous.contexts.at(-1)?.contextFactId,
    );
    if (index < 0 || index === derived.contexts.length - 1) return s.fail('INVALID_INPUT');
    let lossOrdinal = 0;
    for (const source of derived.contexts.slice(index + 1)) {
      if (source.profile.invalidPermanentStats.length !== 0) continue;
      const losses: NpcSkillAccountingFact[] = [];
      for (const [skillKey] of active)
        if (
          sources.skills.requirements.some(
            (r) =>
              r.skillKey === skillKey &&
              source.profile.stats.permanentStats[r.statCode] < r.minValue,
          )
        ) {
          losses.push({
            kind: 'PERMANENT_REQUIREMENT_LOSS',
            factId: 'NPC_COMPOSITION_SKILL/' + operationId + '/LOSS/' + ++lossOrdinal,
            ordinal: contexts.flatMap((c) => c.facts).length + losses.length + 1,
            contextFactId: source.fact.contextFactId,
            sourceRuleId: 'CORE-166',
            skillKey,
          });
          active.delete(skillKey);
        }
      if (source.fact.contextFactId === ref) pending.push(...losses);
      else
        contexts.push(
          skillContext(
            derived,
            source.fact.contextFactId,
            contexts.length + 1,
            'CONFIRMED',
            losses,
          ),
        );
    }
  }
  const grossKey =
    sources.skills.skills.find((s) => s.skillKey === 'GROSS')?.skillKey ?? s.fail('INVALID_INPUT');
  const bonusBefore = active.get(grossKey) ?? 0;
  const initialGrant: Extract<NpcSkillAccountingFact, { kind: 'TROGR_GROSS_GRANT' }> = {
    kind: 'TROGR_GROSS_GRANT',
    factId: 'NPC_COMPOSITION_SKILL/' + operationId + '/GRANT',
    ordinal: contexts.flatMap((c) => c.facts).length + pending.length + 1,
    contextFactId: ref,
    sourceRuleId: 'SYM-079',
    symbiontAcquisitionFactId: common.causedByFactId,
    bonusBefore,
    bonusAfter:
      bonusBefore === 0 ? 3 : bonusBefore >= 5 ? bonusBefore : Math.min(5, bonusBefore + 3),
  };
  if (previous === null)
    return { ...common, kind: 'GROSS_SKILL_GRANT', symbiontInstanceId, initialGrant };
  contexts.push(
    skillContext(derived, ref, contexts.length + 1, 'CONFIRMED', [...pending, initialGrant], {
      sourceRuleId: 'SYM-079',
      symbiontInstanceId,
      sourceAcquisitionFactId: common.causedByFactId,
    }),
  );
  const skillProof = { identityKey: previous.identityKey, contexts };
  evaluateNpcSkills(sources.skills, {
    mode: 'APPEND_N_PLUS_ONE',
    identityKey: previous.identityKey,
    previousConfirmedProofOrNull: previous,
    proof: skillProof,
  });
  return { ...common, kind: 'GROSS_SKILL_GRANT', symbiontInstanceId, skillProof };
}
