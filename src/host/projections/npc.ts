import {
  npcCompositionContinuations,
  npcCompositionCurrentSkillInventory,
  type NpcCompositionAuthoringState,
  type previewNpcCompositionCandidate,
} from '../npc-composition-preparation.js';
import type { NpcAvailableContinuation } from '@shared/npc-presentation.js';
import type { NpcEquipmentCompatibilityPreparation } from '@shared/npc-presentation.js';
import type { NpcCompositeItemPreparation } from '@shared/npc-presentation.js';
import type { NpcAlcoholPreparation, NpcHpModePreparation } from '@shared/npc-presentation.js';
import {
  calculateSkillSlotCost,
  calculateStartSkillSlots,
} from '../../domain/rules/skill-stage/skills.js';
import type {
  NpcArmorProfile,
  NpcCatalogueItemProfile,
  NpcNonattackingShieldProfile,
  NpcStructuredCustomProfile,
  NpcCustomBonusContainerBinding,
  NpcInventoryMetadata,
  NpcCustomProfileVersionReference,
} from '../../domain/rules/npc-authoring/inventory.js';
import type { NpcCompositionConsequence } from '../../domain/rules/npc-authoring/ordinary-composition-types.js';
import type { NpcFormalLifeState } from '../../domain/rules/npc-authoring/formal-life-state.js';
import { npcInventoryMetadataChoices } from '../../domain/rules/npc-authoring/inventory.js';
import { npcTaipanPoisonProfileLabel } from '../../domain/rules/npc-authoring/formal-poison-source.js';
import type { NpcFormalPoisonCoatingInstance } from '../../domain/rules/npc-authoring/formal-poison-coating.js';
import {
  evaluateNpcSkills,
  NpcSkillEvaluationError,
  type NpcOrdinarySkillPreview,
} from '../../domain/rules/npc-authoring/skill-evaluation.js';
import { previewNpcOrdinarySkills } from '../../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import {
  completeNpcTraumaEditorRow,
  NpcStagedInputError,
} from '../../domain/rules/npc-authoring/staged-input.js';
import {
  NpcInitialTraumaError,
  readNpcInitialStunRemaining,
} from '../../domain/rules/npc-authoring/initial-trauma.js';
import type { ActionKey } from '@generated/types/atlas.js';
import type { StatCode } from '@generated/types/character.js';
import type { JsonObject, PresentedBaseForm, RevisionVector } from '@shared/index.js';
import {
  NPC_CONTROL_ACTION_KEYS,
  NPC_CONTROL_FORM_IDS,
  NPC_FULL_SHEET_FIELDS,
  NPC_VALIDATION_STAGE_IDS,
  type NpcArtPresentation,
  type NpcPreparedDiseaseId,
  type NpcCalendarPresentation,
  type NpcGmProjection,
  type NpcProjectionContentByForm,
  type NpcWireSections,
  type NpcWireSheet,
  type NpcCustomInventoryPreparation,
  type NpcItemRestorePreparation,
  type NpcFormalControlPreparation,
  type NpcLifeStatePreparation,
  type NpcWeaverStatePreparation,
  type NpcWeaverCurrentState,
  type NpcPoisonModePreparation,
  type NpcPoisonModeState,
  type NpcPoisonCoatingPreparation,
  type NpcPoisonCoatingState,
} from '@shared/npc-presentation.js';
import { npcGmProjectionValue } from '@shared/npc-presentation-codec.js';
import type { NpcAuthoringSourceCatalog } from '../npc-catalog.js';
import type { GmRequestReviewView } from '../../persistence/campaign-creation.js';
import type { NpcAttempt, NpcVersion } from '../../persistence/npc-library-records.js';
import type { NpcRecoveryClosure } from '../../persistence/npc-library-store.js';
import type { NpcAttemptReadContext } from '../../persistence/npc-child-identities.js';
import type { NpcEditorDraft } from '../../domain/rules/npc-authoring/staged-input.js';
import type { NpcCleanHumanoidSnapshot } from '../../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import type {
  NpcHumanoidSnapshot,
  NpcHumanoidPreview,
} from '../../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import {
  deriveNpcBaseStatLayers,
  npcMassBounds,
  NpcBaseStatRuleError,
} from '../../domain/rules/npc-authoring/base-stats.js';
import { validateSkillSelectionDraft } from '../../domain/rules/skill-stage/skills.js';
import { SkillStageRuleError } from '../../domain/rules/skill-stage/catalog.js';
import { ARMOR_BODY_ZONES } from '../../domain/rules/item-stage/armor-bundle.js';
import { STARTING_WEAPON_VARIANTS } from '../../domain/rules/item-stage/starting-weapon.js';
import type { NpcDraftSection, NpcLifetimeFacts } from '../../domain/rules/npc-authoring/types.js';

import type { StagedWeaponProfile } from '../../domain/rules/item-stage/master-weapon-profile.js';

type Snapshot = NpcCleanHumanoidSnapshot | NpcHumanoidSnapshot;
type Form = NpcGmProjection['formId'];
type Sheet = Snapshot['sheet'];
type Row = Readonly<{ fieldKey: string; label: string; value: string }>;

/** All records are from one owning checked read; this interface conveys no authority. */
export interface NpcProjectionRead {
  readonly view: GmRequestReviewView;
  readonly closure: NpcRecoveryClosure;
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly campaignPhase: 'PRE_START' | 'STARTED';
  readonly attemptOrNull: NpcAttempt | null;
  readonly draftOrNull: NpcEditorDraft | null;
  readonly attemptArtOrNull: NpcArtPresentation | null;
  readonly versions: readonly Readonly<{ record: NpcVersion; snapshot: Snapshot }>[];
  readonly calendar: NpcCalendarPresentation;
}

/** Domain validation/preparation is separate from formatting and never allocates on a read. */
export interface NpcEditorPresentationData {
  readonly schema: NpcProjectionContentByForm['NPC-011'];
  readonly stats: NpcProjectionContentByForm['NPC-012'];
  readonly symbionts: NpcProjectionContentByForm['NPC-013'];
  readonly skills: NpcProjectionContentByForm['NPC-014'];
  readonly inventory: NpcProjectionContentByForm['NPC-015'];
  readonly initialState: NpcProjectionContentByForm['NPC-016'];
  readonly finalReview: NpcProjectionContentByForm['NPC-017'];
  readonly forwardStages: readonly NpcAttempt['stage'][];
}

/** Only the domain preview adapter constructs VALID; draft completeness alone cannot do so. */
export type NpcCheckedPreviewDisplay =
  | Readonly<{ kind: 'VALID'; name: string; sections: NpcWireSections; art: NpcArtPresentation }>
  | Readonly<{ kind: 'INCOMPLETE' | 'INVALID' | 'NOT_YET_SUPPORTED'; detail: string }>;

function entered<T>(value: NpcDraftSection<T>): T {
  if (value.kind !== 'ENTERED') throw new Error('Поле ещё не заполнено');
  return value.value;
}
function declared(section: unknown): boolean {
  if (section === null || typeof section !== 'object') return true;
  if (Object.hasOwn(section, 'kind')) {
    const kind: unknown = (section as { kind: unknown }).kind;
    if (kind === 'UNSET') return false;
  }
  return Object.values(section).every(declared);
}

/** Known source choices do not advertise unfinished preparation/commit capabilities. */
export function npcEditorPresentation(input: {
  readonly read: NpcProjectionRead;
  readonly catalog: NpcAuthoringSourceCatalog;
  readonly preview: NpcCheckedPreviewDisplay;
  readonly canReserveItem: boolean;
  readonly compositionOrNull?: Readonly<{
    state: NpcCompositionAuthoringState;
    candidateOrNull: ReturnType<typeof previewNpcCompositionCandidate> | null;
    errorOrNull: string | null;
  }> | null;
  readonly inventoryOrNull: NpcProjectionContentByForm['NPC-015'] | null;
  readonly equipmentCompatibilityPreparationOrNull?: NpcEquipmentCompatibilityPreparation | null;
  readonly compositePreparationOrNull?: NpcCompositeItemPreparation | null;
  readonly customPreparationOrNull?: NpcCustomInventoryPreparation | null;
  readonly restorePreparationOrNull?: NpcItemRestorePreparation | null;
  readonly compositeSets?: NpcAttemptReadContext['linkedSets'];
  readonly runtimePreparationOrNull?: Readonly<{
    alcohol: NpcAlcoholPreparation;
    hpModes: readonly NpcHpModePreparation[];
    formalControls?: readonly NpcFormalControlPreparation[];
  }> | null;
  readonly runtimeEffectBindings?: NpcAttemptReadContext['runtimeEffectBindings'];
  readonly lifeStatePreparationOrNull?: NpcLifeStatePreparation | null;
  readonly weaverPreparationOrNull?: Readonly<{
    preparations: readonly NpcWeaverStatePreparation[];
    states: readonly NpcWeaverCurrentState[];
  }> | null;
  readonly poisonPreparationOrNull?: Readonly<{
    modePreparations: readonly NpcPoisonModePreparation[];
    modeStates: readonly NpcPoisonModeState[];
    coatingPreparations: readonly NpcPoisonCoatingPreparation[];
    coatingStates: readonly NpcPoisonCoatingState[];
  }> | null;
  readonly traumaPreparationOrNull?: Readonly<{
    traumaBindings: NpcAttemptReadContext['traumaBindings'];
    retainedIds: readonly string[];
  }> | null;
  readonly woundPreparationOrNull?: Readonly<{
    woundBindings: NpcAttemptReadContext['woundBindings'];
  }> | null;
  readonly diseasePreparationOrNull?: Readonly<{
    choices: readonly Readonly<{ diseaseId: NpcPreparedDiseaseId; nameRu: string }>[];
    effectBindings: NpcAttemptReadContext['effectBindings'];
  }> | null;
}): NpcEditorPresentationData {
  const { read, catalog, preview } = input;
  const draft = read.draftOrNull ?? fail('editor draft missing');
  const attempt = read.attemptOrNull ?? fail('editor attempt missing');
  const metadataChoices = npcInventoryMetadataChoices(catalog.inventory);
  const disease = input.diseasePreparationOrNull ?? null;
  const trauma = input.traumaPreparationOrNull ?? null;
  const wounds = input.woundPreparationOrNull ?? null;
  if (
    disease === null &&
    draft.initialState.effectInstanceIds.kind === 'ENTERED' &&
    draft.initialState.effectInstanceIds.value.length !== 0
  )
    fail('selected disease has no scoped preparation presentation');
  const traumaErrors: Record<string, Record<string, string[]>> = {};
  for (const row of draft.initialState.traumaInputs?.kind === 'ENTERED'
    ? draft.initialState.traumaInputs.value
    : []) {
    const errors: Record<string, string[]> = {};
    for (const key of ['regionId', 'traumaValue', 'reason'] as const)
      if (row.input[key].kind === 'UNSET') errors[key] = ['Введите значение явно.'];
    if (row.input.regionId.kind === 'ENTERED' && row.input.regionId.value === 'HEAD') {
      if (row.head.kind === 'UNSET' || row.head.value.penalty.kind === 'UNSET')
        errors['penalty'] = ['Выберите состояние одноразового штрафа.'];
      if (row.head.kind === 'UNSET' || row.head.value.stun.kind === 'UNSET')
        errors['stun'] = ['Выберите наличие оглушения.'];
      else if (
        row.head.value.stun.value.status === 'ACTIVE' &&
        row.head.value.stun.value.remainingMinutes.kind === 'UNSET'
      )
        errors['remainingMinutes'] = ['Введите точный остаток от 0 до 5 минут, не включая 0.'];
    }
    if (row.input.reason.kind === 'ENTERED' && row.input.reason.value.trim() === '')
      errors['reason'] = ['Укажите причину исходного состояния.'];
    if (
      row.head.kind === 'ENTERED' &&
      row.head.value.stun.kind === 'ENTERED' &&
      row.head.value.stun.value.status === 'ACTIVE' &&
      row.head.value.stun.value.remainingMinutes.kind === 'ENTERED'
    ) {
      try {
        readNpcInitialStunRemaining(row.head.value.stun.value.remainingMinutes.value);
      } catch (error) {
        if (!(error instanceof NpcInitialTraumaError)) throw error;
        errors['remainingMinutes'] = [error.message];
      }
    }
    if (Object.keys(errors).length === 0) {
      try {
        completeNpcTraumaEditorRow(catalog.initialTrauma, row);
      } catch (error) {
        if (!(error instanceof NpcInitialTraumaError) && !(error instanceof NpcStagedInputError))
          throw error;
        errors['traumaValue'] = [error.message];
      }
    }
    traumaErrors[row.traumaInstanceId] = errors;
  }
  const calendarReady =
    !read.calendar.requiresCampaignTime || read.calendar.validationStatus === 'CURRENT';
  const timeErrors = calendarReady ? [] : read.calendar.messages;
  if (!calendarReady && timeErrors.length === 0) fail('missing calendar blocker');
  const fullErrors = preview.kind === 'VALID' ? timeErrors : [preview.detail, ...timeErrors];
  const race = draft.schema.raceCode,
    sex = draft.identity.sex;
  const schema = {
    input: draft.schema,
    errors: {},
    races: catalog.symbionts.races.map((r) => ({ value: r.raceCode, label: r.raceLabel })),
    classes: [
      ...(race.kind === 'ENTERED' && race.value === 'PURE'
        ? catalog.skills.classes
            .filter((c) => c.raceCode === race.value)
            .map((c) => ({
              value: c.classCode,
              label: catalog.classLabels[c.classCode] ?? fail('missing class label'),
            }))
        : [{ value: null, label: 'Без класса' }]),
    ],
    anatomies: [{ value: 'STANDARD_HUMANOID', label: 'Стандартная гуманоидная анатомия' }],
    sexLabel:
      sex.kind === 'UNSET' ? 'Пол ещё не выбран' : sex.value === 'MALE' ? 'Мужской' : 'Женский',
    massLabel:
      draft.identity.massKg.kind === 'UNSET'
        ? 'Масса ещё не задана'
        : `${String(draft.identity.massKg.value)} кг`,
    massBoundsOrNull:
      race.kind === 'ENTERED' && sex.kind === 'ENTERED'
        ? npcMassBounds(catalog.baseStats, race.value, sex.value)
        : null,
    registryVersion: 'ADR-0077 / CORE-008 / AQA-010',
    validationSummary: [],
  };
  let layers: ReturnType<typeof deriveNpcBaseStatLayers> | null = null;
  const calculationMessages: string[] = [];
  if (
    declared(draft.schema) &&
    declared(draft.identity.sex) &&
    declared(draft.identity.massKg) &&
    declared(draft.baseStats)
  ) {
    try {
      layers = deriveNpcBaseStatLayers(catalog.baseStats, {
        schema: {
          raceCode: entered(race),
          pureClassOrNull: entered(draft.schema.pureClassOrNull),
          anatomyProfileId: entered(draft.schema.anatomyProfileId),
          sex: entered(sex),
          massKg: entered(draft.identity.massKg),
        },
        baseStats: Object.fromEntries(
          catalog.skills.stats.map((s) => [s.statCode, entered(draft.baseStats[s.statCode])]),
        ),
      });
    } catch (error) {
      // Only known domain input validation may become an editor message. Catalog/programming faults propagate.
      if (!(error instanceof NpcBaseStatRuleError)) throw error;
      calculationMessages.push(error.message);
    }
  }
  const ordinary = input.compositionOrNull ?? null;
  const hasOrdinaryProof = ordinary?.state.ordinaryProof != null;
  let selection: ReturnType<typeof validateSkillSelectionDraft> | NpcOrdinarySkillPreview | null =
    null;
  let skillConsequences: NpcOrdinarySkillPreview | null = null;
  const skillMessages = [...calculationMessages];
  const trainingSelected =
    draft.skills.kind === 'ENTERED' &&
    draft.skills.value.some((r) => r.pool.kind === 'ENTERED' && r.pool.value !== 'START');
  if (trainingSelected && !hasOrdinaryProof)
    skillMessages.push(
      'Обучение требует сохранённой подтверждённой истории; подготовка этой ветви ещё не подключена.',
    );
  if (
    ordinary !== null &&
    ordinary.state.ordinaryProof !== null &&
    ordinary.state.result.obligationStatus === 'RESOLVED' &&
    declared(draft.skills)
  ) {
    try {
      const basis = {
        ...npcCompositionCurrentSkillInventory(catalog, ordinary.state),
        npcUuid: attempt.candidateNpcUuid,
        compositionProof: ordinary.state.compositionProof,
        ordinaryProof: ordinary.state.ordinaryProof,
        previousSkillProofOrNull: ordinary.state.skillProofOrNull,
      };
      try {
        const ordinarySelection = previewNpcOrdinarySkills(catalog.ordinaryHumanoid, {
          ...basis,
          selections: entered(draft.skills).map((r) => ({
            skillKey: entered(r.skillKey),
            targetBonus: entered(r.targetBonus),
            pool: entered(r.pool),
          })),
        });
        selection = ordinarySelection;
        skillConsequences = ordinarySelection;
      } catch (error) {
        if (!(error instanceof NpcSkillEvaluationError) && !(error instanceof SkillStageRuleError))
          throw error;
        // Empty candidate selections preserve paid skills while displaying source losses.
        // This diagnostic never changes the draft or replaces strict forward validation.
        if (ordinary.state.skillProofOrNull !== null)
          skillConsequences = previewNpcOrdinarySkills(catalog.ordinaryHumanoid, {
            ...basis,
            selections: [],
          });
        throw error;
      }
    } catch (error) {
      if (
        !(error instanceof NpcSkillEvaluationError) &&
        !(error instanceof SkillStageRuleError) &&
        !(error instanceof NpcStagedInputError)
      )
        throw error;
      skillMessages.push(error.message);
    }
  } else if (layers !== null && declared(draft.skills) && !trainingSelected && !hasOrdinaryProof) {
    try {
      selection = validateSkillSelectionDraft(catalog.skills, {
        raceCode: layers.schema.raceCode,
        classCode: layers.schema.pureClassOrNull,
        skillStageStats: layers.skillStageStats,
        selectedSkills: entered(draft.skills).map((r) => {
          return { skillKey: entered(r.skillKey), targetBonus: entered(r.targetBonus) };
        }),
      });
    } catch (error) {
      if (!(error instanceof SkillStageRuleError)) throw error;
      skillMessages.push(error.message);
    }
  }
  const skillDisplay = selection ?? skillConsequences;
  if (skillConsequences !== null)
    for (const loss of skillConsequences.permanentLosses)
      skillMessages.push(
        `${loss.skillKey}: при подтверждении будет утрачен по CORE-166; его прежние расходы слотов освобождаются.`,
      );
  if (selection === null && skillConsequences !== null)
    skillMessages.push(
      'Слоты показаны после последствий для ранее изученных навыков. Изменения выбранных навыков ещё не прошли проверку.',
    );
  const stageInputs = {
    'NPC-002': draft.identity,
    'NPC-011': draft.schema,
    'NPC-012': draft.baseStats,
    'NPC-013': draft.symbionts,
    'NPC-014': draft.skills,
    'NPC-015': draft.inventory,
    'NPC-016': draft.initialState,
    'NPC-017': {},
  };
  const stageStatus = (
    form: (typeof NPC_VALIDATION_STAGE_IDS)[number],
  ): NpcProjectionContentByForm['NPC-017']['stages']['NPC-002'] => ({
    label: form,
    status:
      preview.kind === 'VALID' && (calendarReady || (form !== 'NPC-016' && form !== 'NPC-017'))
        ? 'VALID'
        : 'INCOMPLETE',
    messages:
      preview.kind === 'VALID'
        ? form === 'NPC-016' || form === 'NPC-017'
          ? timeErrors
          : []
        : [declared(stageInputs[form]) ? preview.detail : 'Не все обязательные поля заполнены'],
  });
  const stages: NpcProjectionContentByForm['NPC-017']['stages'] = {
    'NPC-002': stageStatus('NPC-002'),
    'NPC-011': stageStatus('NPC-011'),
    'NPC-012': stageStatus('NPC-012'),
    'NPC-013': stageStatus('NPC-013'),
    'NPC-014': stageStatus('NPC-014'),
    'NPC-015': stageStatus('NPC-015'),
    'NPC-016': stageStatus('NPC-016'),
    'NPC-017': stageStatus('NPC-017'),
  };
  const finalReview: NpcProjectionContentByForm['NPC-017'] = {
    npcUuidOnCommit: attempt.candidateNpcUuid,
    binding:
      attempt.mode === 'CREATE_V1'
        ? {
            editMode: 'CREATE_V1',
            attemptRevision: attempt.revision,
            versionBindingOrNull: null,
            resultVersion: 1,
          }
        : {
            editMode: 'APPEND_N_PLUS_ONE',
            attemptRevision: attempt.revision,
            versionBindingOrNull: attempt.targetOrNull ?? fail('N+1 target missing'),
            resultVersion:
              (attempt.targetOrNull ?? fail('N+1 target missing')).expectedCurrentVersion + 1,
          },
    previewOrNull:
      preview.kind === 'VALID'
        ? {
            name: preview.name,
            artOrNull: preview.art,
            sections: preview.sections,
            pinnedCombatReferences: [],
          }
        : null,
    stages,
    fullValidationStatus:
      preview.kind === 'VALID'
        ? calendarReady
          ? 'VALID'
          : 'INCOMPLETE'
        : preview.kind === 'INCOMPLETE'
          ? 'INCOMPLETE'
          : 'INVALID',
    validationErrors: fullErrors,
    calendar: read.calendar,
    commitStatusLabel: 'Версия ещё не сохранена',
    receiptOrNull: null,
  };
  const symbionts = draft.symbionts.kind === 'ENTERED' ? draft.symbionts.value : [];
  const continuationLabels = {
    FREE_SLOT_ROLL: 'Разрешить дополнительный слот Свободного',
    ADVISER_IW_ROLLS: 'Определить I и W Советчика',
    ADVISER_SKILLS: 'Подтвердить навыки Советчика',
    ADVISER_SUPPRESSION_ROLL: 'Определить подавление Советчика',
    GROSS_SKILL_GRANT: 'Подтвердить выдачу навыка от Трогра',
    TROGR_STAT_CLOSURE: 'Подтвердить характеристики и наследие Трогра',
  } as const;
  const continuations: NpcAvailableContinuation[] =
    ordinary === null
      ? []
      : npcCompositionContinuations(ordinary.state).map((capability) => {
          const rolling =
            capability.kind === 'FREE_SLOT_ROLL' ||
            capability.kind === 'ADVISER_IW_ROLLS' ||
            capability.kind === 'ADVISER_SUPPRESSION_ROLL';
          const common = {
            capabilityKey: capability.capabilityKey,
            label: continuationLabels[capability.kind],
            explanation:
              'Последствие подтверждённого состава: ' +
              capability.requirement.sourceRuleIds.join(', '),
            diceMode: rolling ? capability.confirmation.diceModeSnapshot : ('NO_ROLL' as const),
            rolls: rolling
              ? Array.from(
                  { length: capability.kind === 'ADVISER_IW_ROLLS' ? 2 : 1 },
                  (_, index) => ({
                    key: String(index + 1),
                    label:
                      capability.kind === 'ADVISER_IW_ROLLS'
                        ? index === 0
                          ? 'I'
                          : 'W'
                        : 'Результат броска',
                    dieSides: capability.kind === 'FREE_SLOT_ROLL' ? (6 as const) : (20 as const),
                    input: { kind: 'UNSET' as const },
                    errors: [],
                  }),
                )
              : [],
          };
          if (capability.kind === 'ADVISER_SKILLS') {
            const pending = ordinary.state.result.advisorContinuations.find(
              (card) =>
                'symbiontInstanceId' in capability.requirement &&
                card.symbiontInstanceId === capability.requirement.symbiontInstanceId,
            );
            if (pending === undefined) return fail('missing actual adviser continuation card');
            if (layers === null) return fail('missing actual Adviser body stats');
            const capacity = calculateStartSkillSlots({
              ...layers.skillStageStats,
              I: pending.iw.I.value,
              W: pending.iw.W.value,
            });
            let maximum = 0;
            while (calculateSkillSlotCost(maximum + 1) <= capacity) maximum++;
            return {
              ...common,
              kind: 'ADVISER_SKILLS',
              skills: {
                choices: catalog.skills.skills
                  .filter((s) => s.category === 'SELECTABLE_GENERAL')
                  .map((s) => ({
                    value: s.skillKey,
                    label: s.skillKey,
                    requirementLabel: catalog.skills.requirements
                      .filter((r) => r.skillKey === s.skillKey)
                      .map((r) => r.statCode + ' ≥ ' + r.minValue)
                      .join(', '),
                    maxBonus:
                      typeof s.maxBonus === 'number' ? Math.min(s.maxBonus, maximum) : maximum,
                  })),
                selected: [],
                errors: [],
              },
            };
          }
          return { ...common, kind: capability.kind };
        });
  if (
    ordinary !== null &&
    ordinary.candidateOrNull !== null &&
    ordinary.state.result.obligationStatus === 'RESOLVED'
  )
    continuations.unshift({
      kind: 'CONFIRM_COMPOSITION',
      capabilityKey: [
        attempt.scope.campaignId,
        attempt.scope.gmLocalContextId,
        attempt.npcDraftId,
        attempt.revision,
        'CONFIRM',
      ].join(':'),
      label: 'Подтвердить состав и последствия',
      explanation: 'Применить показанные последствия одним подтверждением состава.',
      diceMode: 'NO_ROLL',
      rolls: [],
    });
  const oldSkills =
    ordinary?.state.skillProofOrNull == null
      ? null
      : evaluateNpcSkills(catalog.skills, {
          mode: 'CREATE_V1',
          identityKey: attempt.candidateNpcUuid,
          previousConfirmedProofOrNull: null,
          proof: ordinary.state.skillProofOrNull,
        });
  const sym166Source = ordinary?.state.result.composition.instances.find(
    (i) =>
      i.speciesKey === 'DOLPHIN' &&
      i.status === 'ACTIVE' &&
      i.effectsEnabled &&
      i.learnedNodeRefs.includes('SYM-166'),
  );
  const sym166Used = oldSkills?.ledger.sym166Pool?.used ?? 0;
  let sym166CandidateUsed = sym166Used;
  if (draft.skills.kind === 'ENTERED')
    for (const row of draft.skills.value)
      if (
        row.pool.kind === 'ENTERED' &&
        row.pool.value === 'SYM-166' &&
        row.skillKey.kind === 'ENTERED' &&
        row.targetBonus.kind === 'ENTERED'
      ) {
        const key = row.skillKey.value,
          old = oldSkills?.ledger.learnedSkills.find((s) => s.skillKey === key)?.bonus ?? 0;
        if (row.targetBonus.value > old)
          sym166CandidateUsed +=
            calculateSkillSlotCost(row.targetBonus.value) -
            (old === 0 ? 0 : calculateSkillSlotCost(old));
      }
  const sym166Capacity = sym166Source === undefined ? 0 : 5;
  const showSym166 =
    sym166Source !== undefined ||
    oldSkills?.ledger.sym166Pool !== undefined ||
    (draft.skills.kind === 'ENTERED' &&
      draft.skills.value.some((s) => s.pool.kind === 'ENTERED' && s.pool.value === 'SYM-166'));

  return {
    schema,
    stats: {
      input: draft.baseStats,
      errors: {},
      noTotalStatCap: true,
      labels: Object.fromEntries(
        catalog.symbionts.stats.map((s) => [s.statCode, s.statLabel]),
      ) as Record<StatCode, string>,
      perStatMinMax: catalog.baseStats.perStatMinMax,
      derivedPreview:
        layers === null
          ? calculationMessages.map((message) => ({ label: 'Проверка', value: message }))
          : [{ label: 'До симбионтов', value: stats(layers.skillStageStats, catalog) }],
    },
    symbionts: {
      input: draft.symbionts,
      species: catalog.symbionts.species.map((species) => ({
        value: species.speciesKey,
        label: species.speciesLabel,
        levels: catalog.development.levels
          .filter((l) => l.speciesKey === species.speciesKey)
          .map((l) => ({ value: l.level, label: `L${String(l.level)}` })),
        nodes: catalog.development.nodes
          .filter((n) => n.speciesKey === species.speciesKey)
          .map((n) => ({
            value: n.nodeRef,
            label: n.label,
            requirementLabel: n.selectionConstraint,
            manualOnly: n.automationStatus === 'NODE_ONLY_MANUAL',
          })),
        bindings:
          species.bindingPolicy === 'OWL_EYE' || species.bindingPolicy === 'EEL_ARM'
            ? (['LEFT', 'RIGHT'] as const).map((side) => ({
                key: side,
                label:
                  (species.bindingPolicy === 'OWL_EYE' ? 'Глаз: ' : 'Рука: ') +
                  (side === 'LEFT' ? 'слева' : 'справа'),
                value: { kind: species.bindingPolicy, side },
              }))
            : [
                {
                  key: species.bindingPolicy,
                  label:
                    species.bindingPolicy === 'NONE'
                      ? 'Без привязки'
                      : species.bindingPolicy === 'TICK_RIGHT_HAND'
                        ? 'Правая кисть'
                        : species.bindingPolicy === 'SPIDER_BOTH_WRISTS'
                          ? 'Оба запястья'
                          : 'Оба предплечья',
                  value: { kind: species.bindingPolicy },
                },
              ],
        artOrNull: null,
        treeArtOrNull: null,
      })),
      canAdd: ordinary !== null && ordinary.state.result.obligationStatus === 'RESOLVED',
      errors: Object.fromEntries(
        symbionts.map((row) => [
          row.symbiontInstanceId,
          Object.fromEntries(
            Object.entries(row.input)
              .filter(([, value]) => value.kind === 'UNSET')
              .map(([key]) => [key, ['Выберите значение явно.']]),
          ),
        ]),
      ),
      computedRows: Object.fromEntries(
        (
          ordinary?.candidateOrNull?.instances ??
          ordinary?.state.result.composition.instances ??
          []
        ).map((i) => [
          i.symbiontInstanceId,
          [
            { label: 'Состояние', value: i.status },
            { label: 'Занято слотов', value: String(i.slotCost) },
            {
              label: 'Текущий / максимум ОЭ',
              value: String(i.currentOE) + ' / ' + String(i.nativeMaxOE),
            },
            { label: 'Действие свойств', value: i.effectsEnabled ? 'Действуют' : 'Подавлены' },
          ],
        ]),
      ),
      continuations,
      compositionSummary:
        ordinary === null
          ? ['Сначала подтвердите схему и характеристики.']
          : [
              ...(ordinary.errorOrNull === null ? [] : [ordinary.errorOrNull]),
              'Подтверждённый состав: ' +
                ordinary.state.result.composition.occupiedSlots +
                ' / ' +
                ordinary.state.result.confirmedSlotCapacity +
                ' слотов.',
              ...trogrLedger(ordinary.state.result.lifetimeFacts, catalog),
              ...(ordinary.candidateOrNull === null
                ? []
                : [
                    'После подтверждения: ' +
                      ordinary.candidateOrNull.occupiedSlots +
                      ' / ' +
                      ordinary.candidateOrNull.sourceSlotCapacity +
                      ' слотов.',
                    ...ordinary.candidateOrNull.consequences.map((consequence) =>
                      compositionConsequenceLabel(consequence, catalog),
                    ),
                  ]),
              ...(ordinary.state.result.obligationStatus === 'RESOLVED'
                ? []
                : ['Завершите обязательные последствия состава перед следующим изменением.']),
            ],
    },
    skills: {
      input: draft.skills,
      skills: catalog.skills.skills
        .filter((s) => s.category === 'SELECTABLE_GENERAL')
        .map((s) => ({
          value: s.skillKey,
          label: s.skillKey,
          requirementLabel: list(
            catalog.skills.requirements
              .filter((r) => r.skillKey === s.skillKey)
              .map((r) => `${r.statCode} ≥ ${String(r.minValue)} (${r.ruleId})`),
          ),
        })),
      pools: [
        { value: 'START', label: 'Начальные слоты' },
        { value: 'TRAINING', label: 'Обучение — требует подтверждённой истории' },
        ...(showSym166
          ? [{ value: 'SYM-166' as const, label: 'Дополнительные слоты Дельфина' }]
          : []),
      ],
      errors: [],
      fixedSkills:
        skillDisplay === null
          ? []
          : skillDisplay.learnedSkills
              .filter((s) => s.source !== 'SELECTED')
              .map((s) => ({
                label: s.skillKey,
                value: `+${String(s.bonus)}; слотов: ${String(s.slotCost)}`,
              })),
      poolUsage: [
        ...(skillConsequences !== null
          ? Object.entries(skillConsequences.pools).map(([pool, metric]) => ({
              label: pool,
              value:
                'Занято ' +
                String(metric.used) +
                ' / ' +
                String(metric.capacity) +
                '; доступно ' +
                String(metric.available) +
                '; переполнение ' +
                String(metric.overfill),
            }))
          : []),
        ...(skillDisplay === null
          ? []
          : [
              { label: 'Доступно', value: String(skillDisplay.capacity) },
              { label: 'Использовано', value: String(skillDisplay.used) },
              { label: 'Осталось', value: String(skillDisplay.remaining) },
            ]),
        ...(showSym166
          ? [
              { label: 'Дельфин: ёмкость', value: String(sym166Capacity) },
              { label: 'Дельфин: занято', value: String(sym166CandidateUsed) },
              {
                label: 'Дельфин: осталось',
                value: String(Math.max(0, sym166Capacity - sym166CandidateUsed)),
              },
              {
                label: 'Дельфин: переполнение',
                value: String(Math.max(0, sym166CandidateUsed - sym166Capacity)),
              },
            ]
          : []),
      ],
      validationSummary: skillMessages,
    },
    inventory: input.inventoryOrNull ?? {
      input: draft.inventory,
      canAdd: input.canReserveItem,
      choices: {
        itemTypes: catalog.inventory.definitions.map((d) => ({
          value: d.itemTypeId,
          label: d.name,
        })),
        profileKinds: [
          { value: 'CATALOG', label: 'Каталог' },
          { value: 'MASTER_WEAPON', label: 'Оружие мастера' },
          { value: 'STRUCTURED_CUSTOM', label: 'Структурированный предмет' },
        ],
        // CORE-177 uses two holding hands; ARM_L/R remain armor body zones.
        equippedSlots: [
          { value: 'HAND_L', label: 'Левая хватательная рука' },
          { value: 'HAND_R', label: 'Правая хватательная рука' },
          ...ARMOR_BODY_ZONES.map((value) => ({ value, label: bodyRegionLabel(value) })),
        ],
        bodyZones: [
          { value: null, label: 'Нет' },
          ...ARMOR_BODY_ZONES.map((value) => ({ value, label: value })),
        ],
        gripModes: [
          { value: null, label: 'Нет' },
          { value: 'ONE_HAND', label: 'Одна рука' },
          { value: 'TWO_HAND', label: 'Две руки' },
        ],
        linkedSets: [
          { value: null, label: 'Нет' },
          ...(input.compositeSets ?? []).map((set) => ({
            value: set.linkedSetInstanceId,
            label:
              catalog.inventory.definitions.find((item) => item.itemTypeId === set.itemTypeId)
                ?.name ?? fail('missing composite source label'),
          })),
        ],
        componentRoles: [
          { value: null, label: 'Нет' },
          ...((input.compositeSets ?? []).length === 0
            ? []
            : [
                { value: 'SWORD' as const, label: 'Меч' },
                { value: 'RAPIER' as const, label: 'Рапира' },
                { value: 'SHIELD' as const, label: 'Щит' },
              ]),
        ],
        coatings: [],
        qualityRolls: [{ value: null, label: 'Нет подтверждённого броска' }],
        ...(metadataChoices === null
          ? {}
          : {
              qualityTiers: [
                { value: null, label: 'Не назначено' },
                ...metadataChoices.qualityTiers,
              ],
              clothingRegions: metadataChoices.clothingRegions.map((value) => ({
                value,
                label: bodyRegionLabel(value),
              })),
              clothingHermetic: metadataChoices.clothingHermetic.map((value) => ({
                value,
                label: value === 'UNKNOWN' ? 'Неизвестно' : value ? 'Герметична' : 'Не герметична',
              })),
              clothingFlammability: metadataChoices.clothingFlammability.map((value) => ({
                value,
                label:
                  value === 'UNKNOWN'
                    ? 'Неизвестно'
                    : value === 'COMBUSTIBLE'
                      ? 'Горючая'
                      : 'Негорючая',
              })),
            }),
        weaponVariants: STARTING_WEAPON_VARIANTS.map((value) => ({ value, label: value })),
        dicePatterns: [],
        heldSizes: [
          { value: 'FITS_IN_FIST', label: 'Умещается в кулаке' },
          { value: 'LARGE', label: 'Крупный' },
          { value: 'UNKNOWN', label: 'Неизвестно' },
        ],
        armorWeights: [
          { value: 'LIGHT', label: 'Лёгкая' },
          { value: 'OTHER', label: 'Другая' },
          { value: 'UNKNOWN', label: 'Неизвестно' },
        ],
        flammabilities: [
          { value: 'COMBUSTIBLE', label: 'Горючий' },
          { value: 'NONCOMBUSTIBLE', label: 'Негорючий' },
          { value: 'UNKNOWN', label: 'Неизвестно' },
        ],
        stats: catalog.symbionts.stats.map((s) => ({ value: s.statCode, label: s.statLabel })),
      },
      errors: {},
      previewRows:
        draft.inventory.kind !== 'ENTERED'
          ? {}
          : Object.fromEntries(
              draft.inventory.value.flatMap((row) => {
                const properties = row.clothingProperties;
                const value: NpcInventoryMetadata = {
                  ...(row.qualityTier?.kind === 'ENTERED'
                    ? { qualityTier: row.qualityTier.value }
                    : {}),
                  ...(properties?.kind === 'ENTERED' &&
                  properties.value.coveredRegionIds.kind === 'ENTERED' &&
                  properties.value.hermetic.kind === 'ENTERED' &&
                  properties.value.flammability.kind === 'ENTERED'
                    ? {
                        clothingProperties: {
                          coveredRegionIds: properties.value.coveredRegionIds.value,
                          hermetic: properties.value.hermetic.value,
                          flammability: properties.value.flammability.value,
                        },
                      }
                    : {}),
                };
                const lines = inventoryMetadata(value, catalog);
                return lines.length === 0
                  ? []
                  : [
                      [
                        row.itemInstanceId,
                        [{ label: 'Свойства экземпляра', value: lines.join('; ') }],
                      ],
                    ];
              }),
            ),
      validationSummary: [
        'Экипировка, покрытия, качество и связанные наборы требуют собственных подтверждённых данных; пустые списки выбора не создают такие факты.',
      ],
      ...(input.equipmentCompatibilityPreparationOrNull === undefined
        ? {}
        : { compatibilityPreparationOrNull: input.equipmentCompatibilityPreparationOrNull }),
      ...(input.compositePreparationOrNull === undefined
        ? {}
        : { compositePreparationOrNull: input.compositePreparationOrNull }),
      ...(input.customPreparationOrNull === undefined
        ? {}
        : { customPreparationOrNull: input.customPreparationOrNull }),
      ...(input.restorePreparationOrNull === undefined
        ? {}
        : { restorePreparationOrNull: input.restorePreparationOrNull }),
      ...(input.poisonPreparationOrNull == null
        ? {}
        : {
            poisonCoatingPreparations: input.poisonPreparationOrNull.coatingPreparations,
            poisonCoatings: input.poisonPreparationOrNull.coatingStates,
          }),
    },
    initialState: {
      ...(input.poisonPreparationOrNull == null
        ? {}
        : {
            poisonModePreparations: input.poisonPreparationOrNull.modePreparations,
            poisonModeStates: input.poisonPreparationOrNull.modeStates,
          }),
      ...(input.weaverPreparationOrNull == null
        ? {}
        : {
            temporaryWeaverStatePreparations: input.weaverPreparationOrNull.preparations,
            temporaryWeaverStates: input.weaverPreparationOrNull.states,
          }),
      ...(input.lifeStatePreparationOrNull === undefined
        ? {}
        : { lifeStatePreparationOrNull: input.lifeStatePreparationOrNull }),
      ...(input.runtimePreparationOrNull == null
        ? {}
        : {
            alcoholPreparationOrNull: input.runtimePreparationOrNull.alcohol,
            hpModePreparations: input.runtimePreparationOrNull.hpModes,
            ...(input.runtimePreparationOrNull.formalControls === undefined
              ? {}
              : {
                  formalControlPreparations: input.runtimePreparationOrNull.formalControls,
                }),
          }),
      input: {
        input: draft.initialState,
        currentOeChanges: symbionts.map((s) => ({
          symbiontInstanceId: s.symbiontInstanceId,
          currentOE: s.input.currentOE,
        })),
      },
      errors: {},
      symbionts: symbionts.map((s) => ({
        symbiontInstanceId: s.symbiontInstanceId,
        label:
          s.input.speciesKey.kind === 'ENTERED' ? s.input.speciesKey.value : 'Вид ещё не выбран',
        currentOE: s.input.currentOE,
        maximumOrNull: null,
        errors: [],
      })),
      choices: {
        effectInstanceIds: [
          ...(disease?.effectBindings ?? []).map((effect) => ({
            value: effect.effectInstanceId,
            label:
              diseaseDefinition(catalog, effect.diseaseId).nameRu +
              ' (' +
              effect.effectInstanceId.slice(0, 8) +
              ')',
          })),
          ...(input.runtimeEffectBindings ?? [])
            .filter(
              (effect) =>
                effect.sourceKind !== 'LIFE_TIMER' &&
                effect.sourceKind !== 'WEAVER_STATE' &&
                effect.sourceKind !== 'POISON_MODE',
            )
            .map((effect) => ({
              value: effect.effectInstanceId,
              label:
                (effect.sourceKind === 'ALCOHOL'
                  ? 'Алкогольное отравление'
                  : effect.sourceKind === 'FORMAL_CONTROL'
                    ? effect.controlKind === 'SLEEP'
                      ? 'Сон'
                      : 'Паралич'
                    : effect.mode === 'REGENERATION'
                      ? 'Регенерация'
                      : 'Ведомый голодом') +
                ' (' +
                effect.effectInstanceId.slice(0, 8) +
                ')',
            })),
        ],
        traumaInstanceIds: (trauma?.traumaBindings ?? []).map((b, index) => ({
          value: b.traumaInstanceId,
          label: 'Травма ' + String(index + 1),
        })),
        woundInstanceIds: (wounds?.woundBindings ?? []).map((b, index) => ({
          value: b.woundInstanceId,
          label: 'Рана ' + String(index + 1),
        })),
        sourceSpecificStateFactIds: [],
        deathConsequenceFactIdOrNull: [{ value: null, label: 'Нет' }],
      },
      derivedRows:
        preview.kind === 'VALID'
          ? preview.sections.INITIAL_STATE.map(({ label, value }) => ({ label, value }))
          : [],
      calendar: read.calendar,
      traumaPreparationOrNull:
        trauma === null
          ? null
          : {
              capabilityKey: [
                attempt.scope.gmLocalContextId,
                attempt.scope.campaignId,
                attempt.npcDraftId,
                attempt.revision,
                read.view.stateRevision,
                read.view.projectionRevision,
                read.view.actorVisibilityRevision,
                'TRAUMA_RESERVE',
              ].join(':'),
              canSubmit: attempt.stage === 'NPC-016',
              explanation:
                'Новая отдельная исходная травма. Значения и последствия вводятся явно; сыгранный урон и броски не создаются.',
              regions: ARMOR_BODY_ZONES.map((value) => ({
                value,
                label:
                  value === 'HEAD'
                    ? 'Голова'
                    : value === 'TORSO'
                      ? 'Корпус'
                      : value === 'ARM_L'
                        ? 'Левая рука'
                        : value === 'ARM_R'
                          ? 'Правая рука'
                          : value === 'LEG_L'
                            ? 'Левая нога'
                            : 'Правая нога',
              })),
              retainedIds: trauma.retainedIds,
              errors: traumaErrors,
            },
      diseasePreparationOrNull:
        disease === null
          ? null
          : {
              capabilityKey: [
                attempt.scope.gmLocalContextId,
                attempt.scope.campaignId,
                attempt.npcDraftId,
                attempt.revision,
                read.view.stateRevision,
                read.view.projectionRevision,
                read.view.actorVisibilityRevision,
                'DISEASE_RESERVE',
              ].join(':'),
              input: { kind: 'UNSET' },
              choices: disease.choices.map((choice) => ({
                value: choice.diseaseId,
                label: choice.nameRu,
              })),
              errors: [],
              canSubmit: attempt.stage === 'NPC-016',
              explanation:
                'Подготовка добавляет вариант для выбора. Время начала и состояние болезни будут записаны при сохранении версии НПС.',
            },
      woundPreparationOrNull:
        wounds === null
          ? null
          : {
              capabilityKey: [
                attempt.scope.gmLocalContextId,
                attempt.scope.campaignId,
                attempt.npcDraftId,
                attempt.revision,
                read.view.stateRevision,
                read.view.projectionRevision,
                read.view.actorVisibilityRevision,
                'WOUND_PREPARE',
              ].join(':'),
              input: {
                woundType: { kind: 'UNSET' },
                regionId: { kind: 'UNSET' },
                damagePerTick: { kind: 'UNSET' },
              },
              typeChoices: [
                { value: 'GENERIC', label: 'Рана без периодического урона' },
                { value: 'BLEEDING', label: 'Кровотечение' },
              ],
              regionChoices: ARMOR_BODY_ZONES.map((value) => ({
                value,
                label: bodyRegionLabel(value),
              })),
              errors: {},
              canSubmit: attempt.stage === 'NPC-016',
              explanation:
                'Явное назначение исходной раны мастером. HP не уменьшаются; кровотечение не создаёт боевой ход или календарный таймер.',
            },
      preparationBlockers: ['Отсутствующие факты других последствий нельзя выбрать как готовые.'],
      validationSummary: fullErrors,
    },
    finalReview,
    forwardStages: preview.kind === 'VALID' ? NPC_VALIDATION_STAGE_IDS : [],
  };
}

function fail(message: string): never {
  throw new Error(`NPC GM projection: ${message}`);
}
function bodyRegionLabel(region: string): string {
  const checked = ARMOR_BODY_ZONES.find((value) => value === region) ?? fail('unknown body region');
  return {
    HEAD: 'Голова',
    TORSO: 'Корпус',
    ARM_L: 'Левая рука',
    ARM_R: 'Правая рука',
    LEG_L: 'Левая нога',
    LEG_R: 'Правая нога',
  }[checked];
}
function text(value: string | number | boolean | null): string {
  return value === null
    ? 'Отсутствует'
    : typeof value === 'boolean'
      ? value
        ? 'Да'
        : 'Нет'
      : String(value);
}
function list(values: readonly string[]): string {
  return values.length === 0 ? 'Нет' : values.join('; ');
}
function diseaseDefinition(catalog: NpcAuthoringSourceCatalog, diseaseId: string) {
  return (
    catalog.diseaseEffects.nonperiodic.initialEffects.diseases.find(
      (d) => d.diseaseId === diseaseId && d.status === 'ACTIVE',
    ) ?? fail('unknown modeled disease')
  );
}
function diseaseMechanics(catalog: NpcAuthoringSourceCatalog, diseaseId: string): string {
  const source = diseaseDefinition(catalog, diseaseId);
  const modifiers = source.modifiers.map(
    (m) => m.targetCode + ' ' + (m.value >= 0 ? '+' : '') + String(m.value),
  );
  return source.nameRu + (modifiers.length === 0 ? '' : ' (' + modifiers.join(', ') + ')');
}
function stats(
  value: Readonly<Record<StatCode, number>>,
  catalog: NpcAuthoringSourceCatalog,
): string {
  return catalog.symbionts.stats
    .map((stat) => `${stat.statLabel}: ${String(value[stat.statCode])}`)
    .join('; ');
}
function rows(
  fields: readonly string[],
  values: readonly Readonly<[string, string]>[],
): readonly Row[] {
  if (fields.length !== values.length) return fail('incomplete full-sheet section');
  return fields.map((fieldKey, index) => {
    const entry = values[index] ?? fail('missing section row');
    return { fieldKey, label: entry[0], value: entry[1] };
  });
}

/** Both preview and saved profiles expose source mechanics; only saved profiles have durable IDs. */
function weaponProfile(profile: StagedWeaponProfile): string {
  const definition = (value: StagedWeaponProfile['damageDefinition']): string =>
    value.sourceNotation === value.effectiveTemplateExpression
      ? value.sourceNotation
      : value.sourceNotation + ' → ' + value.effectiveTemplateExpression;
  const parts = [
    profile.name + ' (' + profile.variantLabel + ')',
    'Урон: ' + definition(profile.damageDefinition),
    'Пробитие: ' + definition(profile.penetrationDefinition),
    'Требования: ' +
      list(
        Object.entries(profile.statRequirements).map(([key, value]) => key + ': ' + String(value)),
      ),
  ];
  if (profile.instanceDamage !== undefined)
    parts.push('Урон экземпляра: ' + String(profile.instanceDamage));
  if (profile.rangeMeters !== undefined) parts.push('Дальность, м: ' + String(profile.rangeMeters));
  if (profile.accuracyBonus !== undefined)
    parts.push('Бонус точности: ' + String(profile.accuracyBonus));
  if (Object.keys(profile.properties).length > 0)
    parts.push(
      'Свойства: ' +
        Object.entries(profile.properties)
          .map(([key, value]) => key + ': ' + text(value))
          .join(', '),
    );
  return parts.join('; ');
}

function armorProfile(profile: NpcArmorProfile): string {
  const physical = profile.physicalArmorOrNull;
  return [
    profile.itemTypeId,
    'Защита: ' +
      (physical === null
        ? 'Нет'
        : String(physical.multiplier) +
          '×R' +
          String(physical.dieSides) +
          (physical.constant === 0 ? '' : '+' + String(physical.constant))),
    'Требование S: ' + String(profile.requiredStrength),
    'Бег: ' + String(profile.runningModifier),
    'Акробатика: ' + String(profile.acrobaticsModifier),
    'Уклонение: ' + String(profile.dodgeModifier),
    ...(profile.protectionSourceOrNull === null ? [] : [profile.protectionSourceOrNull]),
    ...(profile.conditionSourceOrNull === null ? [] : [profile.conditionSourceOrNull]),
  ].join('; ');
}
function catalogueProfile(profile: NpcCatalogueItemProfile): string {
  return [
    profile.name,
    profile.category,
    profile.completeness === 'PARTIAL'
      ? 'Источник содержит неполные сведения о механике'
      : 'Полный каталоговый профиль',
    ...Object.entries(profile.catalogueSource).map(([key, value]) => key + ': ' + text(value)),
    ...(profile.mechanicsSourceOrNull === null
      ? []
      : Object.entries(profile.mechanicsSourceOrNull).map(
          ([key, value]) => key + ': ' + text(value),
        )),
  ].join('; ');
}
function shieldProfile(profile: NpcNonattackingShieldProfile): string {
  return [
    'Щит составного комплекта',
    'Максимум HP щита: ' + String(profile.shieldMaxHP),
    ...Object.entries(profile.statRequirements).map(
      ([stat, value]) => 'Требование ' + stat + ': ' + String(value),
    ),
    'Атакующий профиль отсутствует',
  ].join('; ');
}
function customProfile(
  profile: NpcStructuredCustomProfile,
  container: NpcCustomBonusContainerBinding,
  reason: string,
  reference: NpcCustomProfileVersionReference & {
    readonly kind: 'CAMPAIGN_CUSTOM_PROFILE' | 'CATALOG_CUSTOM_MODIFIER';
  },
  phase: 'PREVIEW' | 'SAVED',
): string {
  const bonus = profile.customBonusOrNull;
  return [
    profile.name,
    profile.description,
    (phase === 'PREVIEW' ? 'Подготовленный профиль' : 'Сохранённый профиль') +
      ': ' +
      reference.profileId +
      '; версия ' +
      String(reference.version) +
      ' (' +
      reference.profileVersionId +
      '); операция резервирования: ' +
      reference.reservationOperationId,
    'Источник: ' +
      (reference.kind === 'CAMPAIGN_CUSTOM_PROFILE'
        ? 'профиль кампании'
        : reference.kind === 'CATALOG_CUSTOM_MODIFIER'
          ? 'модификатор каталожного предмета'
          : fail('unknown custom profile source')),
    'Масса, кг: ' + (profile.massKg === null ? 'Неизвестна' : String(profile.massKg)),
    'Размер: ' +
      ({ FITS_IN_FIST: 'Умещается в кулаке', LARGE: 'Крупный', UNKNOWN: 'Неизвестен' } as const)[
        profile.heldSizeClass
      ],
    'Весовой класс брони: ' +
      ({ LIGHT: 'Лёгкий', OTHER: 'Другой', UNKNOWN: 'Неизвестен' } as const)[
        profile.armorWeightClass
      ],
    'Горючесть: ' +
      ({ COMBUSTIBLE: 'Горючий', NONCOMBUSTIBLE: 'Негорючий', UNKNOWN: 'Неизвестна' } as const)[
        profile.flammability
      ],
    'Источник огня: ' + (profile.isIgnitionSource ? 'Да' : 'Нет'),
    'Пища: ' + (profile.isFood ? 'Да' : 'Нет'),
    'Можно нанести яд: ' + (profile.canReceivePoison ? 'Да' : 'Нет'),
    'Можно нанести горючее: ' + (profile.canReceiveFlammableCoating ? 'Да' : 'Нет'),
    bonus === null
      ? 'Бонус отсутствует'
      : `Бонус ${bonus.customBonusStat}: +${String(bonus.customBonusValue)}; ` +
        (container.kind === 'BACKPACK'
          ? 'активен в рюкзаке ' + container.backpackItemInstanceId
          : 'неактивен вне рюкзака'),
    'Причина: ' + reason,
  ].join('; ');
}
function inventoryMetadata(
  item: NpcInventoryMetadata,
  catalog: NpcAuthoringSourceCatalog,
): readonly string[] {
  if (!Object.hasOwn(item, 'qualityTier') && !Object.hasOwn(item, 'clothingProperties')) return [];
  const choices =
    npcInventoryMetadataChoices(catalog.inventory) ?? fail('metadata source choices missing');
  const result: string[] = [];
  if (Object.hasOwn(item, 'qualityTier'))
    result.push(
      'Качество: ' +
        (item.qualityTier === null
          ? 'не назначено'
          : (choices.qualityTiers.find((choice) => choice.value === item.qualityTier)?.label ??
            fail('unknown source quality tier'))),
    );
  if (Object.hasOwn(item, 'clothingProperties')) {
    const properties = item.clothingProperties ?? fail('explicit clothing metadata missing');
    if (
      !properties.coveredRegionIds.every((region) => choices.clothingRegions.includes(region)) ||
      !choices.clothingHermetic.includes(properties.hermetic) ||
      !choices.clothingFlammability.includes(properties.flammability)
    )
      return fail('unknown source clothing property');
    result.push(
      'Одежда: покрытие — ' +
        (properties.coveredRegionIds.length === 0
          ? 'нет'
          : properties.coveredRegionIds.map(bodyRegionLabel).join(', ')),
      'Герметичность: ' +
        (properties.hermetic === 'UNKNOWN' ? 'неизвестна' : properties.hermetic ? 'да' : 'нет'),
      'Горючесть одежды: ' +
        (properties.flammability === 'UNKNOWN'
          ? 'неизвестна'
          : properties.flammability === 'COMBUSTIBLE'
            ? 'горючая'
            : 'негорючая'),
    );
  }
  return result;
}
function inventoryCoatings(
  coatings: readonly NpcFormalPoisonCoatingInstance[],
  catalog: NpcAuthoringSourceCatalog,
): readonly string[] {
  if (coatings.length === 0) return [];
  const source = catalog.poisonSource ?? fail('prepared poison source missing');
  const delivery: Readonly<
    Record<NpcFormalPoisonCoatingInstance['payload']['futureDeliveryRule'], string>
  > = {
    FULL_PROFILE: 'полный профиль при проглатывании',
    HALF_PERIODIC_DAMAGE: 'половина периодического урона',
    HALF_STAT_DEBUFF_K: 'половина K снижения характеристик',
    HALF_DURATION: 'половина длительности',
  };
  return coatings.map((coating) => {
    const current = coating.currentSourceContext;
    const reason = current.resolution.unavailableReasonOrNull;
    const unavailable =
      reason === null
        ? ''
        : reason === 'OWNER_DEAD'
          ? 'владелец мёртв'
          : reason === 'SOURCE_REMOVED'
            ? 'источник удалён'
            : 'источник уничтожен';
    return [
      'Подготовленная доза: ' +
        npcTaipanPoisonProfileLabel(source, coating.payload.poisonProfileId),
      'Носитель: ' + coating.carrier.label,
      'Источник: ' + coating.sourceInstanceId + ' / ' + coating.sourceAbilityId,
      'L при подготовке: ' + String(coating.originalSourceSnapshot.targetLevel),
      'L для доставки: ' + String(current.effectiveSourceSnapshot.targetLevel),
      current.resolution.kind === 'CURRENT'
        ? 'Текущий доказанный источник'
        : 'Последний доказанный источник: ' + unavailable,
      'Формула источника: ' + coating.payload.sourceFormula,
      'При будущей доставке: ' + delivery[coating.payload.futureDeliveryRule],
      'Начальная минута: ' + String(coating.appliedAt.campaignTimestamp),
      coating.consumeCondition === 'INGESTION'
        ? 'Расход при проглатывании'
        : 'Расход при первом успешном попадании',
      coating.origin.kind === 'PREPARED'
        ? 'Подготовлено, ещё не сохранено'
        : 'Сохранённая исходная доза',
      'Причина: ' + coating.reason,
    ].join('; ');
  });
}
function savedInventory(sheet: Sheet, catalog: NpcAuthoringSourceCatalog): readonly Row[] {
  if (sheet.itemProfiles.length !== sheet.input.inventory.length)
    return fail('incomplete saved inventory profile graph');
  return rows(NPC_FULL_SHEET_FIELDS.INVENTORY, [
    [
      'Предметы',
      list(
        sheet.input.inventory.map(
          (item) =>
            (item.itemTypeId ??
              (item.profile.kind === 'STRUCTURED_CUSTOM'
                ? item.profile.name
                : fail('missing item name'))) +
            ': ' +
            String(item.quantity) +
            '; ' +
            item.issueReason +
            inventoryMetadata(item, catalog)
              .map((value) => '; ' + value)
              .join('') +
            inventoryCoatings(
              sheet.itemProfiles
                .filter((profile) => profile.item.itemInstanceId === item.itemInstanceId)
                .flatMap((profile) => profile.item.activeCoatings),
              catalog,
            )
              .map((value) => '; ' + value)
              .join(''),
        ),
      ),
    ],
    [
      'Профили',
      list(
        sheet.input.inventory.map((item) => {
          const matches = sheet.itemProfiles.filter(
            (p) => p.item.itemInstanceId === item.itemInstanceId,
          );
          const published = matches[0];
          if (
            matches.length !== 1 ||
            published === undefined ||
            published.item.itemTypeId !== item.itemTypeId
          )
            return fail('saved inventory profile owner mismatch');
          if (item.itemTypeId === null) {
            if (
              published.kind !== 'CAMPAIGN_CUSTOM_ITEM' ||
              item.profile.kind !== 'STRUCTURED_CUSTOM'
            )
              return fail('saved custom profile kind mismatch');
            const version = published.customProfileVersions[0];
            if (
              published.customProfileVersions.length !== 1 ||
              version === undefined ||
              version.profileVersionId !== item.itemTypeReference.profileVersionId ||
              version.itemInstanceId !== item.itemInstanceId ||
              JSON.stringify(version.afterProfile) !== JSON.stringify(item.profile)
            )
              return fail('saved custom current profile missing');
            return customProfile(
              item.profile,
              item.bonusContainerBinding,
              item.customProfileReason,
              item.itemTypeReference,
              'SAVED',
            );
          }
          const modifier =
            item.customModifier === undefined
              ? ''
              : '; Изменения мастера: ' +
                customProfile(
                  item.customModifier.profile,
                  item.customModifier.bonusContainerBinding,
                  item.customModifier.reason,
                  item.customModifier.reference,
                  'SAVED',
                );
          if (item.profile.kind === 'ARMOR_CATALOG') {
            if (
              published.kind !== 'ARMOR' ||
              published.profileVersions.length !== 0 ||
              JSON.stringify(published.sourceProfile) !== JSON.stringify(item.profile.sourceProfile)
            )
              return fail('saved armor source profile mismatch');
            return armorProfile(published.sourceProfile) + modifier;
          }
          if (item.profile.kind === 'ITEM_CATALOG') {
            if (
              published.kind !== 'CATALOG_ITEM' ||
              published.profileVersions.length !== 0 ||
              JSON.stringify(published.sourceProfile) !== JSON.stringify(item.profile.sourceProfile)
            )
              return fail('saved catalogue source profile mismatch');
            return catalogueProfile(published.sourceProfile) + modifier;
          }
          if (item.profile.kind === 'SHIELD_COMPONENT') {
            if (
              published.kind !== 'SHIELD_COMPONENT' ||
              published.profileVersions.length !== 0 ||
              JSON.stringify(published.sourceProfile) !== JSON.stringify(item.profile.sourceProfile)
            )
              return fail('saved shield source profile mismatch');
            return shieldProfile(published.sourceProfile) + modifier;
          }
          if (
            published.kind !== 'WEAPON' ||
            (item.profile.kind !== 'CATALOG' && item.profile.kind !== 'MASTER_WEAPON')
          )
            return fail('saved inventory profile kind mismatch');
          const profileVersion = item.profile.profileVersion;
          const versions = published.profileVersions.filter(
            (p) => p.weaponProfileVersionId === profileVersion,
          );
          const version = versions[0];
          if (
            versions.length !== 1 ||
            version === undefined ||
            !version.active ||
            version.itemInstanceId !== item.itemInstanceId ||
            published.item.activeWeaponProfileVersionIdByVariant[version.attackVariantId] !==
              profileVersion
          )
            return fail('saved inventory active profile missing');
          return weaponProfile(version.effectiveProfile) + modifier;
        }),
      ),
    ],
    [
      'Экипировка',
      list(
        sheet.input.inventory
          .filter((item) => item.equipment.equipped)
          .map((item) => item.itemTypeId + ': ' + item.equipment.equippedSlots.join(', ')),
      ),
    ],
  ]);
}

function previewInventory(
  sheet: NpcHumanoidPreview['sheet'],
  catalog: NpcAuthoringSourceCatalog,
): readonly Row[] {
  if (sheet.itemProfiles.length !== sheet.input.inventory.length)
    return fail('incomplete preview inventory profiles');
  return rows(NPC_FULL_SHEET_FIELDS.INVENTORY, [
    [
      'Предметы',
      list(
        sheet.input.inventory.map(
          (item) =>
            (item.itemTypeId ??
              (item.profile.kind === 'STRUCTURED_CUSTOM'
                ? item.profile.name
                : fail('missing item name'))) +
            ': ' +
            String(item.quantity) +
            '; ' +
            item.issueReason +
            inventoryMetadata(item, catalog)
              .map((value) => '; ' + value)
              .join('') +
            inventoryCoatings(
              sheet.itemProfiles
                .filter((profile) => profile.request.itemInstanceId === item.itemInstanceId)
                .flatMap((profile) => profile.activeCoatings ?? []),
              catalog,
            )
              .map((value) => '; ' + value)
              .join(''),
        ),
      ),
    ],
    [
      'Профили',
      list(
        sheet.input.inventory.map((item) => {
          const matches = sheet.itemProfiles.filter(
            (p) => p.request.itemInstanceId === item.itemInstanceId,
          );
          const prepared = matches[0];
          if (
            matches.length !== 1 ||
            prepared === undefined ||
            prepared.request.itemTypeId !== item.itemTypeId
          )
            return fail('preview inventory profile owner mismatch');
          if ('customProfile' in prepared)
            return customProfile(
              prepared.customProfile,
              prepared.request.bonusContainerBinding,
              prepared.request.customProfileReason,
              prepared.request.itemTypeReference,
              'PREVIEW',
            );
          const modifier =
            prepared.request.customModifier === undefined
              ? ''
              : '; Изменения мастера: ' +
                customProfile(
                  prepared.request.customModifier.profile,
                  prepared.request.customModifier.bonusContainerBinding,
                  prepared.request.customModifier.reason,
                  prepared.request.customModifier.reference,
                  'PREVIEW',
                );
          return (
            ('stagedProfile' in prepared
              ? weaponProfile(prepared.stagedProfile)
              : 'armorProfile' in prepared
                ? armorProfile(prepared.armorProfile)
                : 'catalogProfile' in prepared
                  ? catalogueProfile(prepared.catalogProfile)
                  : shieldProfile(prepared.shieldProfile)) + modifier
          );
        }),
      ),
    ],
    [
      'Экипировка',
      list(
        sheet.input.inventory
          .filter((item) => item.equipped)
          .map((item) => item.itemTypeId + ': ' + item.equippedSlots.join(', ')),
      ),
    ],
  ]);
}

/** Only a fully validated saved snapshot supplies this renderer; no draft-to-snapshot coercion. */
export function npcFullSheetSections(
  snapshot: Snapshot,
  catalog: NpcAuthoringSourceCatalog,
): NpcWireSections {
  const sheet = snapshot.sheet;
  return npcSheetSections(
    sheet,
    snapshot.format === 'NPC_HUMANOID_V1'
      ? snapshot.sheet.stats.equippedStats
      : sheet.stats.permanentStats,
    catalog,
    savedInventory(sheet, catalog),
  );
}

/** Read-only mechanics are shown without inventing a saved ledger, future receipt or acquisition fact. */
export function npcPreviewSheetSections(
  sheet: NpcHumanoidPreview['sheet'],
  catalog: NpcAuthoringSourceCatalog,
): NpcWireSections {
  return npcSheetSections(
    sheet,
    sheet.stats.equippedStats,
    catalog,
    previewInventory(sheet, catalog),
  );
}

/** The clean historical format proves absent equipment; its stored bytes are not extended. */
function npcSheetSections(
  sheet: Sheet | NpcHumanoidPreview['sheet'],
  equippedStats: Readonly<Record<StatCode, number>>,
  catalog: NpcAuthoringSourceCatalog,
  inventory: readonly Row[],
): NpcWireSections {
  const input = sheet.input,
    person = input.identity,
    initial = input.initialState;
  const speciesName = (key: string) =>
    catalog.symbionts.species.find((s) => s.speciesKey === key)?.speciesLabel ??
    fail('unknown saved species');
  const raceName =
    catalog.symbionts.races.find((race) => race.raceCode === person.raceCode)?.raceLabel ??
    fail('unknown saved race');
  const prepared = 'preparedDiseaseState' in sheet ? sheet.preparedDiseaseState : undefined;
  const currentSkills =
    ('currentSkills' in sheet ? sheet.currentSkills : undefined) ??
    prepared?.currentSkills ??
    ('diseaseState' in sheet ? sheet.diseaseState?.currentSkills : undefined);
  const equipmentRequirements =
    'equipmentRequirements' in sheet ? sheet.equipmentRequirements : undefined;
  const equipmentRequirementText =
    equipmentRequirements === undefined
      ? ''
      : [
          equipmentRequirements.armor.penalty === 0
            ? ''
            : 'Броня: штраф −' +
              String(equipmentRequirements.armor.penalty) +
              ' к физическим действиям, перемещению и активной защите (не хватает силы ' +
              String(equipmentRequirements.armor.deficit) +
              ')',
          ...equipmentRequirements.weapons
            .filter((w) => w.penalty !== 0)
            .map((w) => {
              const item =
                input.inventory.find((i) => i.itemInstanceId === w.itemInstanceId) ??
                fail('missing equipped weapon');
              const name =
                catalog.inventory.definitions.find((d) => d.itemTypeId === item.itemTypeId)?.name ??
                fail('unknown equipped weapon type');
              return name + ': штраф −' + String(w.penalty) + ' за нехватку требований';
            }),
        ]
          .filter(Boolean)
          .join('; ');
  const learned = input.skills.learnedSkills.map(
    (skill) =>
      skill.skillKey +
      ': +' +
      String(skill.bonus) +
      (currentSkills?.disabledSkillKeys.includes(skill.skillKey) ? ' (временно недоступен)' : ''),
  );
  const diseaseRows = [
    ...(prepared === undefined
      ? initial.effectInstances
          .filter((effect) => effect.effectTypeId === 'EFF-DISEASE-INSTANCE')
          .map(
            (effect) =>
              diseaseMechanics(catalog, effect.payload.diseaseId) +
              '; начало: минута ' +
              String(effect.startsAt.campaignTimestamp),
          )
      : prepared.assignments.map(
          (assignment) =>
            diseaseMechanics(catalog, assignment.diseaseId) +
            ' — подготовленный выбор; состояние ещё не сохранено',
        )),
    ...initial.effectInstances.flatMap((effect) => {
      if (effect.effectTypeId === 'EFF-DISEASE-INSTANCE') return [];
      if (effect.effectTypeId === 'EFF-POISON-INSTANCE')
        return [
          'Алкогольное отравление; начало: минута ' +
            String(effect.startsAt.campaignTimestamp) +
            '; первый тик: ' +
            String(effect.tickSchedule.nextTickAt.campaignTimestamp) +
            '; срок: ' +
            effect.remainingExact +
            ' ч',
        ];
      if (
        effect.effectTypeId === 'EFF-CONSCIOUS-SLEEP' ||
        effect.effectTypeId === 'EFF-CONTROL-PARALYSIS'
      )
        return [
          (effect.payload.controlKind === 'SLEEP' ? 'Сон' : 'Паралич') +
            '; начало: минута ' +
            effect.startsAt.campaignTimestampExact +
            '; осталось: ' +
            effect.remainingExact +
            ' мин; исходное формальное состояние',
        ];
      if (effect.effectTypeId === 'EFF-LIFE-DEATH_TIMER')
        return [
          'Таймер тяжёлого ранения; начало: минута ' +
            effect.startsAt.campaignTimestampExact +
            '; срок смерти: минута ' +
            effect.expiresAt.campaignTimestampExact +
            '; осталось: ' +
            effect.remainingExact +
            ' мин; экземпляр эффекта: ' +
            effect.effectInstanceId +
            '; D6: ' +
            String(effect.payload.rollFact.roll.rawFace),
        ];
      if (
        effect.effectTypeId === 'EFF-CAPABILITY-SEVERE_WOUND' ||
        effect.effectTypeId === 'EFF-PROTECTION-SEVERE_WOUND'
      )
        return [
          (effect.payload.branch === 'DUPLICATED_ORGANS_PROTECTION'
            ? 'Дублирование органов'
            : effect.payload.branch === 'REPLACEMENT_RECOVERY'
              ? 'Замена органов до восстановления'
              : 'Временная замена органов') +
            '; начало: минута ' +
            effect.startsAt.campaignTimestampExact +
            '; осталось: ' +
            effect.remainingExact +
            ' мин; завершение: минута ' +
            effect.expiresAt.campaignTimestampExact +
            '; источник: ' +
            speciesName(effect.sourceSnapshot.speciesKey) +
            ' (' +
            effect.sourceInstanceId +
            '), уровень ' +
            String(effect.sourceSnapshot.targetLevel) +
            '; операция исходного состояния: ' +
            effect.payload.sourceOperationId +
            '; экземпляр эффекта: ' +
            effect.effectInstanceId +
            '; создан: ' +
            effect.createdAt +
            '; исходное формальное состояние, без R20; срок сохраняется без повторного запуска; ' +
            (effect.payload.recoveryOnExpiry === 'CORE_156_ONLY_WITH_PROVEN_NO_NEW_HP_LOSS'
              ? 'восстановление по CORE-156 при завершении только при доказанном отсутствии новой потери HP'
              : effect.payload.recoveryOnExpiry === 'NONE'
                ? 'восстановления при завершении нет'
                : fail('unknown Weaver expiry semantics')) +
            '; ' +
            (effect.payload.protection === 'UNCONSUMED_CORE_182'
              ? 'защита CORE-182 не израсходована'
              : effect.payload.protection === 'NONE'
                ? 'защита CORE-182 отсутствует'
                : fail('unknown Weaver protection semantics')),
        ];
      if (effect.effectTypeId !== 'EFF-FORM-STANCE')
        return fail('unknown current effect presentation');
      return [
        (effect.payload.mode === 'REGENERATION' ? 'Регенерация' : 'Ведомый голодом') +
          '; начало: минута ' +
          effect.startsAt.campaignTimestampExact +
          '; осталось: ' +
          effect.remainingExact +
          ' мин',
      ];
    }),
  ];
  const traumaState = 'traumaState' in sheet ? sheet.traumaState : undefined;
  const traumaRows = initial.currentTraumas.map((t) => {
    if (traumaState === undefined) return fail('missing derived trauma contribution');
    const label =
      t.regionId === 'HEAD'
        ? 'Голова'
        : t.regionId === 'TORSO'
          ? 'Корпус'
          : t.regionId === 'ARM_L'
            ? 'Левая рука'
            : t.regionId === 'ARM_R'
              ? 'Правая рука'
              : t.regionId === 'LEG_L'
                ? 'Левая нога'
                : 'Правая нога';
    const timer = traumaState.headStuns.find((h) => h.traumaInstanceId === t.traumaInstanceId);
    const penalty = traumaState.pendingHeadPenalties.find(
      (h) => h.traumaInstanceId === t.traumaInstanceId,
    );
    const limb = traumaState.limbs.find((l) => l.regionId === t.regionId);
    return (
      label +
      ': ' +
      String(t.traumaValue) +
      (t.regionId === 'TORSO' ? '; текущие HP уже итоговые' : '') +
      (t.regionId === 'HEAD'
        ? penalty === undefined
          ? '; одноразовый штраф израсходован'
          : '; ожидает штраф ' + String(penalty.checkPenalty)
        : '') +
      (timer === undefined
        ? ''
        : '; отключение: ' +
          (timer.activeNow ? 'активно' : 'истекло') +
          ', осталось ' +
          timer.remainingMinutes +
          ' мин., срок ' +
          timer.deadlineMinutes) +
      (limb === undefined
        ? ''
        : '; локальный штраф ' +
          String(limb.localCheckPenalty) +
          (limb.disabled ? ', конечность отключена' : ''))
    );
  });
  if (traumaState !== undefined && initial.currentTraumas.length !== 0)
    traumaRows.push(
      'Общий штраф: ' +
        String(traumaState.globalCheckPenalty) +
        '; движение и уклонение: ' +
        String(traumaState.movementAndDodgeLocalPenalty),
    );
  const currentPools =
    currentSkills === undefined
      ? ''
      : '; Текущие слоты: ' +
        (['START', 'TRAINING', 'SYM-166'] as const)
          .filter((pool) => currentSkills.pools[pool] !== undefined)
          .map((pool) => {
            const state = currentSkills.pools[pool] ?? fail('missing declared skill pool');
            return (
              pool +
              ': ' +
              String(state.used) +
              ' / ' +
              String(state.capacity) +
              ', доступно ' +
              String(state.available) +
              ', переполнение ' +
              String(state.overfill)
            );
          })
          .join('; ');
  const fixed =
    'fixedSkills' in input.skills
      ? input.skills.fixedSkills.map(
          (skill) => `${skill.skillKey}: +${String(skill.bonus)} (${skill.source})`,
        )
      : [];
  const slotUsage =
    'fixedSkills' in input.skills
      ? list(
          input.skills.learnedSkills.flatMap((s) =>
            s.charges.map(
              (charge) =>
                `${s.skillKey}: ${charge.pool} ${String(charge.chargedSlotCost)} (+${String(charge.paidBonus)})`,
            ),
          ),
        )
      : `Предварительный расчёт: ${String(input.skills.used)} из ${String(input.skills.capacity)}; остаток ${String(input.skills.remaining)}. Списания ещё не сохранены.`;
  const initialActions = [
    `Физические действия: ${text(sheet.capabilities.canPhysicalAct)}`,
    `Ментальные действия: ${
      sheet.capabilities.canMentalAct === 'CONDITIONAL_NO_SPEECH_MOVEMENT_BODY'
        ? 'Только действия без речи, движения и управления телом'
        : text(sheet.capabilities.canMentalAct)
    }`,
    `Реакция: ${text(sheet.capabilities.canReact)}`,
    `Активная защита: ${text(sheet.capabilities.canActiveDefend)}`,
    ...('sourceControlState' in sheet &&
    sheet.sourceControlState?.automaticAdviserOrNull !== null &&
    sheet.sourceControlState?.automaticAdviserOrNull !== undefined
      ? ['Управление автоматически передано действующему Советнику по правилу симбионта']
      : []),
  ].join('; ');
  return {
    IDENTITY: rows(NPC_FULL_SHEET_FIELDS.IDENTITY, [
      ['Имя', person.name],
      ['Описание', text(person.description)],
      ['Пол', person.sex === 'MALE' ? 'Мужской' : 'Женский'],
      ['Масса, кг', text(person.massKg)],
      ['Принадлежность', person.affiliation],
      ['Роль в кампании', person.campaignRole],
    ]),
    SCHEMA: rows(NPC_FULL_SHEET_FIELDS.SCHEMA, [
      ['Раса', raceName],
      [
        'Класс',
        person.pureClassOrNull === null
          ? 'Без класса'
          : (catalog.classLabels[person.pureClassOrNull] ?? fail('missing class label')),
      ],
      ['Анатомия', 'Стандартная гуманоидная анатомия'],
    ]),
    STATS: rows(NPC_FULL_SHEET_FIELDS.STATS, [
      ['Базовые характеристики', stats(sheet.stats.baseStats, catalog)],
      ['До симбионтов', stats(sheet.stats.skillStageStats, catalog)],
      ['Постоянные характеристики', stats(sheet.stats.permanentStats, catalog)],
      [
        'С учётом экипировки',
        stats(equippedStats, catalog) +
          (equipmentRequirementText === '' ? '' : '; ' + equipmentRequirementText),
      ],
      ['Итоговые характеристики', stats(sheet.stats.effectiveStats, catalog)],
    ]),
    SYMBIONTS: rows(NPC_FULL_SHEET_FIELDS.SYMBIONTS, [
      [
        'Симбионты и наследие Трогра',
        list([
          ...sheet.symbionts.map(
            (s) => `${speciesName(s.speciesKey)}, L${String(s.targetLevel)} (${s.status})`,
          ),
          ...trogrLedger(input.lifetimeFacts, catalog),
        ]),
      ],
      [
        'Взаимодействия',
        sheet.interactions.length === 0
          ? 'Нет'
          : list(
              sheet.interactions.map(
                (interaction) =>
                  'Подтверждённое взаимодействие ' +
                  interaction.compositionFactId +
                  ' / ' +
                  String(interaction.consequenceIndex) +
                  ': ' +
                  confirmedCompositionConsequence(interaction.consequence, sheet, catalog),
              ),
            ),
      ],
      [
        'Текущее ОЕ',
        list(sheet.symbionts.map((s) => `${speciesName(s.speciesKey)}: ${String(s.currentOE)}`)),
      ],
      [
        'Максимум ОЕ',
        list(
          sheet.symbionts.map((s) => `${speciesName(s.speciesKey)}: ${String(s.computedMaxOE)}`),
        ),
      ],
    ]),
    SKILLS: rows(NPC_FULL_SHEET_FIELDS.SKILLS, [
      ['Навыки', list([...fixed, ...learned])],
      ['Списания слотов', slotUsage + currentPools],
    ]),
    INVENTORY: inventory,
    INITIAL_STATE: rows(NPC_FULL_SHEET_FIELDS.INITIAL_STATE, [
      ['Текущие HP', text(initial.currentHP)],
      ['Максимальные HP', text(sheet.maxHP)],
      [
        'Состояние жизни',
        initial.dead
          ? 'Мёртв'
          : initial.sourceSpecificStates.some(
                (state) => 'lifeKind' in state && state.lifeKind === 'SEVERELY_WOUNDED',
              )
            ? 'Тяжело ранен'
            : 'Жив',
      ],
      ['Начальные действия', initialActions],
      ['Эффекты', list(diseaseRows)],
      ['Травмы', list(traumaRows)],
      [
        'Раны',
        initial.currentWounds.length === 0
          ? 'Нет'
          : initial.currentWounds
              .map(
                (w) =>
                  bodyRegionLabel(w.regionId) +
                  ': ' +
                  (w.woundType === 'BLEEDING'
                    ? 'кровотечение; урон ' + String(w.damagePerTick) + ' в конце хода цели'
                    : 'рана без периодического урона'),
              )
              .join('; '),
      ],
      [
        'Особые состояния',
        initial.sourceSpecificStates.length === 0
          ? 'Нет'
          : initial.sourceSpecificStates
              .map((state) => {
                if ('kind' in state && state.kind === 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE')
                  return (
                    'Режим Тайпана: ' +
                    npcTaipanPoisonProfileLabel(
                      catalog.poisonSource ?? fail('poison source unavailable'),
                      state.activePoisonType,
                    ) +
                    '; источник: ' +
                    state.sourceInstanceId +
                    '; ' +
                    (state.effectsEnabled ? 'эффекты включены' : 'эффекты не действуют') +
                    '; статус: ' +
                    state.currentSourceStatus +
                    '; основание: ' +
                    state.anchor.reason +
                    '; смена режима не выполняется'
                  );
                if (!('lifeKind' in state) || state.anchor.kind !== 'GM_FORMAL_INITIAL_LIFE')
                  return fail('unknown source-specific initial state');
                return formalLifeLabel(state);
              })
              .join('; '),
      ],
    ]),
  };
}

function fullVersion(
  read: NpcProjectionRead,
  npcUuid: string,
  version: number,
  catalog: NpcAuthoringSourceCatalog,
): NpcWireSheet {
  const found =
    read.versions.find((v) => v.record.npcUuid === npcUuid && v.record.version === version) ??
    fail('selected version absent');
  const current =
    read.versions.filter((v) => v.record.npcUuid === npcUuid).at(-1) ??
    fail('current version absent');
  if (found.snapshot.npcUuid !== npcUuid || found.record.scope.campaignId !== read.view.campaignId)
    return fail('foreign saved sheet');
  return {
    npcUuid,
    name: found.snapshot.sheet.input.identity.name,
    displayedVersion: version,
    currentVersion: current.record.version,
    historyRevision: current.record.libraryRevision,
    artOrNull: { assetKey: found.record.art.assetKey, checksum: found.record.art.sha256 },
    sections: npcFullSheetSections(found.snapshot, catalog),
    pinnedCombatReferences: [],
    returnContext: 'NPC_ADMIN',
    sourceCombatIdOrNull: null,
    dispositionReceiptIdOrNull: null,
    pinnedCombatVersionOrNull: null,
  };
}

/** Formatting is pure. Current authority, historical closure and capabilities are host-owned inputs. */
export function projectNpcGm(input: {
  readonly read: NpcProjectionRead;
  readonly catalog: NpcAuthoringSourceCatalog;
  readonly editorOrNull: NpcEditorPresentationData | null;
  readonly supported: readonly string[];
}): { readonly base: PresentedBaseForm; readonly revisions: RevisionVector } {
  const { read, catalog, editorOrNull: editor } = input;
  const view = read.view,
    context = view.npc ?? fail('missing owning queue context');
  if (!NPC_CONTROL_FORM_IDS.some((form) => form === view.formId)) return fail('not an NPC form');
  const formId = view.formId as Form;
  if (read.closure.campaignId !== view.campaignId) return fail('foreign closure');
  const selected = context.selectedNpcOrNull;
  const attempt = read.attemptOrNull;
  if (
    attempt !== null &&
    (attempt.scope.campaignId !== view.campaignId ||
      attempt.scope.gmLocalContextId !== view.gmLocalContextId)
  )
    return fail('foreign attempt');
  const libraryRevision = read.closure.anchorOrNull?.libraryRevision ?? 0;
  const vector = {
    stateRevision: view.stateRevision,
    projectionRevision: view.projectionRevision,
    actorVisibilityRevision: view.actorVisibilityRevision,
  };
  let content: NpcProjectionContentByForm[Form];
  switch (formId) {
    case 'NPC-001': {
      const heads = new Map<string, NpcProjectionRead['versions'][number]>();
      for (const version of read.versions) heads.set(version.record.npcUuid, version);
      content = {
        selectedNpcUuidOrNull: selected?.npcUuid ?? null,
        rows: [...heads.values()].map(({ record, snapshot }) => ({
          npcUuid: record.npcUuid,
          name: snapshot.sheet.input.identity.name,
          currentVersion: record.version,
          statusLabel: 'Сохранён',
          affiliation: snapshot.sheet.input.identity.affiliation,
          campaignRole: snapshot.sheet.input.identity.campaignRole,
          groupLabelOrNull: null,
          locationLabelOrNull: null,
          subLocationLabelOrNull: null,
          sceneLabelOrNull: null,
          groupIdOrNull: null,
          locationIdOrNull: null,
          subLocationIdOrNull: null,
          sceneIdOrNull: null,
          markerRevisionOrNull: null,
          artOrNull: { assetKey: record.art.assetKey, checksum: record.art.sha256 },
        })),
      };
      break;
    }
    case 'NPC-003':
      if (selected === null) return fail('sheet without selection');
      content = fullVersion(read, selected.npcUuid, selected.displayedVersion, catalog);
      break;
    case 'NPC-007':
      if (selected === null) return fail('history without selection');
      content = {
        npcUuid: selected.npcUuid,
        currentVersion: selected.currentVersion,
        entries: read.versions
          .filter((v) => v.record.npcUuid === selected.npcUuid)
          .map(({ record }) => ({
            version: record.version,
            authorLabel: 'Мастер кампании',
            timestampLabel: record.committedAt,
            changeReasonOrNull: null,
          })),
        selectedVersionOrNull: selected.displayedVersion,
        previewOrNull: fullVersion(read, selected.npcUuid, selected.displayedVersion, catalog),
      };
      break;
    case 'NPC-002':
      content = {
        input: (read.draftOrNull ?? fail('identity draft absent')).identity,
        errors: {},
        artOrNull: read.attemptArtOrNull,
      };
      break;
    case 'NPC-011':
      content = (editor ?? fail('editor unavailable')).schema;
      break;
    case 'NPC-012':
      content = (editor ?? fail('editor unavailable')).stats;
      break;
    case 'NPC-013':
      content = (editor ?? fail('editor unavailable')).symbionts;
      break;
    case 'NPC-014':
      content = (editor ?? fail('editor unavailable')).skills;
      break;
    case 'NPC-015':
      content = (editor ?? fail('editor unavailable')).inventory;
      break;
    case 'NPC-016':
      content = (editor ?? fail('editor unavailable')).initialState;
      break;
    case 'NPC-017':
      content = (editor ?? fail('editor unavailable')).finalReview;
      break;
  }
  const payload = npcGmProjectionValue(
    formId,
    {
      projectionRole: 'gm',
      contextId: view.gmLocalContextId,
      campaignId: view.campaignId,
      ...vector,
      formId,
      campaignStatus: read.campaignStatus,
      campaignPhase: read.campaignPhase,
      libraryRevision,
      attemptOrNull:
        attempt === null
          ? null
          : {
              npcDraftId: attempt.npcDraftId,
              candidateNpcUuid: attempt.candidateNpcUuid,
              attemptRevision: attempt.revision,
              draftRevision: attempt.revision,
              stage: attempt.stage,
              editMode: attempt.mode,
              versionBindingOrNull: attempt.targetOrNull,
            },
      content,
    },
    {
      projectionRole: 'gm',
      contextId: view.gmLocalContextId,
      campaignId: view.campaignId,
      ...vector,
    },
  );
  const actions = (NPC_CONTROL_ACTION_KEYS[formId] as readonly string[]).filter((key) => {
    if (key === 'NPC-001::CTA::001')
      return context.attemptOrNull === null && context.initialTimeReturnContextOrNull === null;
    if (key === 'NPC-001::CTA::002') return selected !== null;
    if (key === 'NPC-003::CTA::008' || key === 'NPC-007::CTA::002')
      return context.attemptOrNull === null && input.supported.includes('UI-CMD-NPC-NEW-VERSION');
    // Atlas NPC-017: 002 saves either bound mode; 004 is only a post-receipt route.
    // Successful COMMIT already publishes NPC-003, so an OPEN preview never exposes 004.
    if (key === 'NPC-017::CTA::004') return false;
    if (key === 'NPC-017::CTA::002') {
      if (editor?.finalReview.fullValidationStatus !== 'VALID' || attempt === null) return false;
      return input.supported.includes(
        attempt.mode === 'CREATE_V1' ? 'UI-CMD-NPC-COMMIT-V1' : 'UI-CMD-NPC-NEW-VERSION',
      );
    }
    if (key === 'NPC-016::CTA::001' || key === 'NPC-016::CTA::003')
      return editor?.finalReview.fullValidationStatus === 'VALID';
    if (key === 'NPC-015::CTA::001' || key === 'NPC-015::CTA::003')
      return editor?.inventory.compatibilityPreparationOrNull == null;
    if (key === 'NPC-016::CTA::004') return read.campaignPhase === 'PRE_START';
    return true;
  });
  return {
    revisions: vector,
    base: {
      formId,
      formType: 'screen',
      routeTemplate: `/master/campaigns/:campaignId/npc/${formId.toLowerCase()}`,
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: view.campaignId }],
      availableActionKeys: actions as readonly ActionKey[],
      roleFilteredPayload: payload as unknown as JsonObject,
    },
  };
}

function compositionConsequenceLabel(
  c: NpcCompositionConsequence,
  catalog: NpcAuthoringSourceCatalog,
): string {
  switch (c.kind) {
    case 'ABSORPTION':
      return (
        'Трогр поглотит ' + (c.absorbedSpeciesKey === 'TEACHER' ? 'Учителя' : 'Дельфина') + '.'
      );
    case 'DOLPHIN_LEARNED_GRANT':
      return (
        speciesLabel(catalog, 'TROGR') +
        ' (' +
        c.symbiontInstanceId +
        ') получит уровень ' +
        c.beforeLevel +
        ' → ' +
        c.afterLevel +
        ' и новые изученные узлы: ' +
        list(c.addedNodeRefs.map((ref) => nodeLabel(catalog, ref))) +
        '.'
      );
    case 'CURRENT_OE_DUEL':
      return (
        'Сравнение текущего ОЭ Трогра и Хранителя: ' +
        c.trogrCurrentOeBefore +
        ' / ' +
        c.keeperCurrentOeBefore +
        '. ' +
        (c.outcome === 'TIE'
          ? 'Равенство.'
          : c.outcome === 'TROGR_DESTROYED'
            ? 'Трогр погибнет.'
            : 'Хранитель погибнет.')
      );
    case 'SPECIES_SUPPRESSION':
      return c.after === 'SUPPRESSED'
        ? 'Свойства экземпляра будут подавлены.'
        : 'Свойства экземпляра будут действовать.';
    case 'ABILITY_SUPPRESSION':
      return c.suppressed
        ? 'Двойной фокус будет подавлен.'
        : 'Подавление двойного фокуса будет снято.';
    case 'NATIVE_OE_CLAMP':
      return 'Текущий ОЭ ограничится собственным максимумом: ' + c.before + ' → ' + c.after + '.';
    default:
      return fail('unknown composition consequence');
  }
}

function speciesLabel(catalog: NpcAuthoringSourceCatalog, speciesKey: string): string {
  return (
    catalog.symbionts.species.find((species) => species.speciesKey === speciesKey)?.speciesLabel ??
    fail('unknown consequence species ' + speciesKey)
  );
}
function nodeLabel(catalog: NpcAuthoringSourceCatalog, nodeRef: string): string {
  const node =
    catalog.development.nodes.find((entry) => entry.nodeRef === nodeRef) ??
    fail('unknown consequence node ' + nodeRef);
  return node.label + ' (' + node.nodeRef + ')';
}
function confirmedCompositionConsequence(
  consequence: NpcCompositionConsequence,
  sheet: Sheet | NpcHumanoidPreview['sheet'],
  catalog: NpcAuthoringSourceCatalog,
): string {
  const known = (speciesKey: string, instanceId: string) =>
    speciesLabel(catalog, speciesKey) + ' (' + instanceId + ')';
  const instance = (instanceId: string) => {
    const current = sheet.symbionts.find((entry) => entry.symbiontInstanceId === instanceId);
    // Removed instances are not necessarily present in the current derived sheet.
    return current === undefined
      ? 'Исторический экземпляр ' + instanceId + ' (вид в текущем листе отсутствует)'
      : known(current.speciesKey, instanceId);
  };
  const status = (value: 'ACTIVE' | 'SUPPRESSED') => {
    switch (value) {
      case 'ACTIVE':
        return 'свойства действуют';
      case 'SUPPRESSED':
        return 'свойства подавлены';
      default:
        return fail('unknown consequence suppression status');
    }
  };
  switch (consequence.kind) {
    case 'ABSORPTION':
      return (
        known('TROGR', consequence.absorberInstanceId) +
        ' поглотил ' +
        known(consequence.absorbedSpeciesKey, consequence.absorbedInstanceId) +
        '.'
      );
    case 'DOLPHIN_LEARNED_GRANT':
      return (
        known('TROGR', consequence.symbiontInstanceId) +
        ': после поглощения Дельфина уровень ' +
        consequence.beforeLevel +
        ' → ' +
        consequence.afterLevel +
        '; добавленные изученные узлы: ' +
        list(consequence.addedNodeRefs.map((ref) => nodeLabel(catalog, ref))) +
        '.'
      );
    case 'CURRENT_OE_DUEL': {
      const trogr = known('TROGR', consequence.trogrInstanceId),
        keeper = known('KEEPER', consequence.keeperInstanceId);
      let outcome: string;
      switch (consequence.outcome) {
        case 'TIE':
          outcome = 'равенство, победитель отсутствует';
          break;
        case 'TROGR_DESTROYED':
          outcome = trogr + ' погиб';
          break;
        case 'KEEPER_DESTROYED':
          outcome = keeper + ' погиб';
          break;
        default:
          return fail('unknown consequence duel outcome');
      }
      return (
        'Сравнение текущего ОЭ: ' +
        trogr +
        ' — ' +
        consequence.trogrCurrentOeBefore +
        ', ' +
        keeper +
        ' — ' +
        consequence.keeperCurrentOeBefore +
        '; ' +
        outcome +
        '; ОЭ победителя после сравнения: ' +
        (consequence.winnerCurrentOeAfterOrNull === null
          ? 'Нет'
          : String(consequence.winnerCurrentOeAfterOrNull)) +
        '.'
      );
    }
    case 'SPECIES_SUPPRESSION':
      return (
        instance(consequence.symbiontInstanceId) +
        ': ' +
        status(consequence.before) +
        ' → ' +
        status(consequence.after) +
        '.'
      );
    case 'ABILITY_SUPPRESSION':
      if (consequence.ability !== 'DOUBLE_FOCUS') return fail('unknown suppressed ability');
      return (
        instance(consequence.symbiontInstanceId) +
        ': двойной фокус — ' +
        (consequence.suppressed ? 'подавление применено' : 'подавление снято') +
        '.'
      );
    case 'NATIVE_OE_CLAMP':
      return (
        instance(consequence.symbiontInstanceId) +
        ': текущий ОЭ ограничен собственным максимумом, ' +
        consequence.before +
        ' → ' +
        consequence.after +
        '.'
      );
    default:
      return fail('unknown composition consequence');
  }
}
function trogrLedger(
  facts: NpcLifetimeFacts,
  catalog: NpcAuthoringSourceCatalog,
): readonly string[] {
  const ledger = facts.trogrStrengthAndLegacyOrNull;
  if (ledger === undefined) return ['Сведения о силе и наследии Трогра отсутствуют в этом снимке.'];
  if (ledger === null) return ['Достигнутая сила и наследие Трогра не зафиксированы.'];
  const signed = (value: Readonly<Record<StatCode, number>>) =>
    catalog.symbionts.stats
      .map(
        (stat) =>
          stat.statLabel +
          ': ' +
          (value[stat.statCode] > 0 ? '+' : '') +
          String(value[stat.statCode]),
      )
      .join('; ');
  return [
    'Подтверждённая сила Трогра (' +
      ledger.sourceRuleId +
      '): достигнутый уровень ' +
      ledger.reachedLevel +
      '; достигнутый исходный вклад: ' +
      signed(ledger.reachedRawDelta) +
      '; включённый уровень ' +
      ledger.includedLevel +
      '; включённый исходный вклад: ' +
      signed(ledger.includedRawDelta),
    ledger.legacyOrNull === null
      ? 'Сохранённое наследие Трогра отсутствует.'
      : 'Сохранённое наследие Трогра: факт удаления ' +
        ledger.legacyOrNull.removalFactId +
        '; контекст характеристик ' +
        ledger.legacyOrNull.statContextFactId +
        '; база без Трогра: ' +
        stats(ledger.legacyOrNull.nonTrogrBasis, catalog) +
        '; фактический вклад со знаком: ' +
        signed(ledger.legacyOrNull.signedSnapshot),
  ];
}
function formalLifeLabel(state: NpcFormalLifeState): string {
  const origin =
    '; исходное подтверждение: ' +
    state.anchor.initialStateConfirmationId +
    '; зафиксировано: ' +
    state.anchor.createdAt +
    '; основание: ' +
    state.anchor.reason;
  const permission = (value: 'YES' | 'NO' | 'NO_BY_DEFAULT' | 'N/A') => {
    switch (value) {
      case 'YES':
        return 'да';
      case 'NO':
        return 'нет';
      case 'NO_BY_DEFAULT':
        return 'по умолчанию нет';
      case 'N/A':
        return 'не применимо';
      default:
        return fail('unknown life restriction');
    }
  };
  const restriction = state.restrictionOrNull;
  const current =
    restriction === null
      ? ''
      : '; текущая дееспособность: физические действия — ' +
        permission(restriction.physicalActions) +
        ', ментальные действия — ' +
        permission(restriction.mentalActions) +
        ', перемещение — ' +
        permission(restriction.movement) +
        ', реакции — ' +
        permission(restriction.reactions) +
        ', активная защита — ' +
        permission(restriction.activeDefense) +
        ', броня — ' +
        permission(restriction.armor);
  switch (state.lifeKind) {
    case 'ALIVE':
      return 'Жив' + origin;
    case 'DEAD':
      return 'Мёртв' + origin + current;
    case 'SEVERELY_WOUNDED': {
      const original = state.anchor.severeWoundOrNull ?? fail('missing severe wound origin');
      return (
        'Тяжело ранен' +
        origin +
        '; абстрактная жизненно важная система повреждена: ' +
        (state.abstractVitalSystemDamaged ? 'Да' : 'Нет') +
        '; исходный остаток: ' +
        original.remainingMinutes +
        ' мин; текущий остаток: ' +
        state.deathTimerOrNull.remainingExact +
        ' мин; срок смерти: минута ' +
        state.deathTimerOrNull.expiresAt.campaignTimestampExact +
        '; исходный множитель таймера: ×' +
        state.deathTimerOrNull.payload.duplicateMultiplierAtEntry +
        '; источники дубля при входе: ' +
        list(
          original.duplicateAtEntry.sources.map((source) => {
            const effect = source.effectOriginOrNull;
            return (
              source.symbiontInstanceId +
              ' (' +
              source.sourceRuleId +
              ')' +
              (effect === null
                ? ''
                : '; эффект ' +
                  effect.effectInstanceId +
                  (effect.kind === 'PREPARED'
                    ? '; подготовка ' + effect.preparationOperationId
                    : '; исходный COMMIT ' +
                      effect.originCommitOperationId +
                      '; операция ' +
                      effect.sourceOperationId) +
                  '; срок: минута ' +
                  effect.deadlineExact)
            );
          }),
        ) +
        current +
        '; таймер сохранён без повторного броска и перезапуска'
      );
    }
    default:
      return fail('unknown formal life kind');
  }
}
