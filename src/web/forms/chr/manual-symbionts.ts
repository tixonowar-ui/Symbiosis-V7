import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  DecodeResult,
  HostToClientMessage,
  JsonObject,
  JsonValue,
  WorkflowCommandRequestMessage,
} from '@shared/index.js';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import {
  decodeArray,
  decodeChr019Projection,
  decodeChr041Projection,
  decodeInteractionContainer,
  decodeProjection,
  decodeSymbiontBinding,
  decodeSymbiontSpecies,
  decodeStatModifierEffect,
  isAdvisorSkillSlots,
  isFace,
  isJsonObject,
  isNonEmptyString,
  isSafeIntegerAtLeast,
  isSpeciesKey,
  sameJson,
} from './random-symbionts.js';
import type {
  AdvisorSkillSelectionDraft,
  Chr017Projection,
  Chr019Projection,
  Chr041ManualProjection,
  Chr041Projection,
  ManualChr019Projection,
  StatModifierEffectProjection,
  SymbiontBindingProjection,
  SymbiontInstanceProjection,
  SymbiontInteractionProjection,
  SymbiontSide,
  SymbiontSpeciesKey,
} from './random-symbionts.js';

const CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const;
const ROLL_COMMIT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const;
const EMPTY_BRANCH_CACHE_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const MONSTERS = new Set(['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR']);
const INSTANCE_STATUSES = new Set(['ACTIVE', 'SUPPRESSED', 'ABSORBED', 'DESTROYED']);
const IRREVERSIBLE_OPERATIONS = new Set([
  'ABSORPTION',
  'ABILITY_SUPPRESSION',
  'CURRENT_OE_DUEL',
  'SPECIES_SUPPRESSION',
]);

export const CHR_017_MANUAL_SUMMARY_ACTION_KEY = 'CHR-017::CTA::002' as const;
export const CHR_017_MANUAL_CARD_ACTION_KEY = 'CHR-017::CTA::001' as const;
export const CHR_018_MANUAL_ADD_ACTION_KEY = 'CHR-018::CTA::001' as const;
export const CHR_018_MANUAL_RETURN_ACTION_KEY = 'CHR-018::CTA::002' as const;
export const CHR_018_MANUAL_BINDING_ACTION_KEY = 'CHR-018::CTA::003' as const;
export const CHR_019_MANUAL_PREVIEW_ACTION_KEY = 'CHR-019::CTA::002' as const;
export const CHR_019_MANUAL_RETURN_ACTION_KEY = 'CHR-019::CTA::004' as const;
export const CHR_041_MANUAL_IW_ACTION_KEY = 'CHR-041::CTA::003' as const;
export const CHR_042_MANUAL_RETURN_ACTION_KEY = 'CHR-042::CTA::002' as const;

export interface ManualChr017Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly eligibleSymbiontSpecies: Chr017Projection['eligibleSymbiontSpecies'];
  readonly manualCompositionDraft: readonly SymbiontBindingProjection[];
  readonly pureNoSymbiontRoute: false;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly selectedSpeciesOrNull: SymbiontSpeciesKey | null;
  readonly slotCapacity: number;
  readonly symbiontAcquisitionModeOrNull: 'MANUAL';
  readonly wizardCheckpointId: string;
}
export interface Chr018Projection extends JsonObject {
  readonly artAndTreePreview: { readonly artPath: string; readonly developmentTreePath: string };
  readonly bindingChoiceOrReadOnly:
    | {
        readonly kind: 'CHOICE';
        readonly options: readonly ['LEFT', 'RIGHT'];
        readonly defaultSide: 'RIGHT';
      }
    | { readonly kind: 'READ_ONLY'; readonly binding: { readonly kind: string } };
  readonly bindingKind: 'OWL_EYE' | 'EEL_ARM' | 'FIXED' | 'NONE';
  readonly characterDraftId: string;
  readonly compatibility: {
    readonly kind: 'COMPATIBLE' | 'DUPLICATE' | 'MONSTER_EXCLUSIVE' | 'OVER_CAPACITY';
  };
  readonly compositionDraftRevision: number;
  readonly slotCost: number;
  readonly speciesKey: SymbiontSpeciesKey;
}
export interface ManualCompositionProjection extends JsonObject {
  readonly bindings: readonly SymbiontBindingProjection[];
  readonly slotUsageAndCapacity: { readonly used: number; readonly capacity: number };
  readonly speciesKeys: readonly SymbiontSpeciesKey[];
  readonly symbiontInstancesDraft: readonly SymbiontInstanceProjection[];
}
export interface Chr042Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly commandId: string;
  readonly compositionAfter: ManualCompositionProjection;
  readonly compositionBefore: ManualCompositionProjection;
  readonly confirmationStatus: 'PREVIEW';
  readonly draftRevision: number;
  readonly interactionGraph:
    | { readonly kind: 'NO_INTERACTIONS' }
    | { readonly kind: 'INTERACTIONS'; readonly entries: readonly SymbiontInteractionProjection[] };
  readonly irreversibleOperationIds: readonly string[];
  readonly slotStatOeDiff: {
    readonly entries: readonly {
      readonly after: null | {
        readonly currentOe: number;
        readonly slotCost: number;
        readonly status: string;
      };
      readonly before: null | {
        readonly currentOe: number;
        readonly slotCost: number;
        readonly status: string;
      };
      readonly speciesKey: SymbiontSpeciesKey;
    }[];
    readonly modifierBreakdownAfter: StatModifierEffectProjection;
    readonly modifierBreakdownBefore: StatModifierEffectProjection;
    readonly slotUsageAfter: number;
    readonly slotUsageBefore: number;
  };
  readonly suppressionDestructionAbsorption:
    | { readonly kind: 'NONE' }
    | { readonly kind: 'CONSEQUENCES'; readonly entries: readonly SymbiontInteractionProjection[] };
  readonly wizardCheckpointId: string;
}
export type { ManualChr019Projection };

export interface ManualCompositionEntry extends JsonObject {
  readonly sideOrNull: SymbiontSide | null;
  readonly speciesKey: SymbiontSpeciesKey;
}
export interface ManualCompositionDraft {
  readonly characterDraftId: string;
  readonly compositionDraftRevision: number;
  readonly currentSpeciesKeyOrNull: SymbiontSpeciesKey | null;
  readonly draftRevision: number;
  readonly entries: readonly ManualCompositionEntry[];
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly sideBySpecies: Readonly<Partial<Record<'OWL' | 'EEL', SymbiontSide>>>;
  readonly wizardCheckpointId: string;
}
export interface ManualCompositionPayload extends JsonObject {
  readonly acceptedSpecies: readonly {
    readonly acceptedIndex: number;
    readonly speciesKey: SymbiontSpeciesKey;
  }[];
  readonly characterDraftId: string;
  readonly compositionDraftRevision: number;
  readonly draftRevision: number;
  readonly selectedBindings: readonly {
    readonly side: SymbiontSide;
    readonly speciesKey: 'OWL' | 'EEL';
  }[];
  readonly sourceFormId: 'CHR-018';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'MANUAL_COMPOSITION';
  readonly wizardCheckpointId: string;
}
export type ManualCompositionRequest = WorkflowCommandRequestMessage<
  typeof CHECKPOINT_WORKFLOW_COMMAND_ID,
  ManualCompositionPayload
>;
export interface ManualAdvisorIwPayload extends JsonObject {
  readonly advisorInstanceDraftId: string;
  readonly characterDraftId: string;
  readonly compositionDraftRevision: number;
  readonly draftRevision: number;
  readonly manualFacesOrNull: readonly [number, number] | null;
  readonly pendingRollRequestIds: readonly [string, string];
  readonly sourceFormId: 'CHR-041';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'ADVISOR_IW';
  readonly wizardCheckpointId: string;
}
export type ManualAdvisorIwRequest = WorkflowCommandRequestMessage<
  typeof ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  ManualAdvisorIwPayload
>;
export interface ManualAdvisorSkillPayload extends JsonObject {
  readonly advisorInstanceDraftId: string;
  readonly characterDraftId: string;
  readonly compositionDraftRevision: number;
  readonly draftRevision: number;
  readonly selectedSkills: readonly { readonly skillId: string; readonly targetBonus: number }[];
  readonly sourceFormId: 'CHR-041';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'MANUAL_ADVISOR_SKILLS';
  readonly wizardCheckpointId: string;
}
export type ManualAdvisorSkillRequest = WorkflowCommandRequestMessage<
  typeof CHECKPOINT_WORKFLOW_COMMAND_ID,
  ManualAdvisorSkillPayload
>;

interface ManualResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly compositionDraftRevision: number;
  readonly draftRevision: number;
  readonly stage: 'SYMBIONTS';
}
export interface ManualCompositionResult extends ManualResultCommon {
  readonly acceptedSpecies: ManualCompositionPayload['acceptedSpecies'];
  readonly advisorBranch: boolean;
  readonly bindings: readonly SymbiontBindingProjection[];
  readonly nextFormId: 'CHR-019' | 'CHR-041';
  readonly sourceFormId: 'CHR-018';
  readonly variant: 'MANUAL_COMPOSITION';
}
export interface ManualPhysicalRoll extends JsonObject {
  readonly kind: 'ADVISOR_I' | 'ADVISOR_W';
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
  readonly rollReceiptId: string;
  readonly rollRequestId: string;
}
export interface ManualAdvisorIwResult extends ManualResultCommon {
  readonly advisorInstanceDraftId: string;
  readonly advisorIw: {
    readonly I: { readonly rawFace: number; readonly value: number };
    readonly W: { readonly rawFace: number; readonly value: number };
  };
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly nextFormId: 'CHR-041';
  readonly physicalRolls: readonly [ManualPhysicalRoll, ManualPhysicalRoll];
  readonly sourceFormId: 'CHR-041';
  readonly variant: 'ADVISOR_IW';
}
export interface ManualAdvisorSkillResult extends ManualResultCommon {
  readonly advisorInstanceDraftId: string;
  readonly effectsActive: boolean;
  readonly learnedSkills: readonly {
    readonly bonus: number;
    readonly skillKey: string;
    readonly slotCost: number;
  }[];
  readonly nextFormId: 'CHR-019';
  readonly requiredSlotCount: number;
  readonly selectedSkills: ManualAdvisorSkillPayload['selectedSkills'];
  readonly sourceFormId: 'CHR-041';
  readonly usedSlotCount: number;
  readonly variant: 'MANUAL_ADVISOR_SKILLS';
}

type Terminal = Extract<
  HostToClientMessage,
  { readonly messageType: 'command.replay' | 'command.result' }
>;
function refused<T>(path: string, value: JsonValue): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value } };
}

export function decodeChr017ManualProjection(
  value: JsonObject,
  path: string,
): DecodeResult<ManualChr017Projection> {
  const eligible = decodeArray(
    value['eligibleSymbiontSpecies'],
    `${path}.eligibleSymbiontSpecies`,
    decodeSymbiontSpecies,
  );
  if (!eligible.ok) return eligible;
  const draft = decodeArray(
    value['manualCompositionDraft'],
    `${path}.manualCompositionDraft`,
    decodeSymbiontBinding,
  );
  if (!draft.ok) return draft;
  const result = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eligibleSymbiontSpecies: (field) => field === value['eligibleSymbiontSpecies'],
    manualCompositionDraft: (field) => field === value['manualCompositionDraft'],
    pureNoSymbiontRoute: (field) => field === false,
    raceChoice: (field) => field === 'FREE' || field === 'UNITED',
    selectedSpeciesOrNull: (field) => field === null || isSpeciesKey(field),
    slotCapacity: (field) => isSafeIntegerAtLeast(field, 1) && field <= 4,
    symbiontAcquisitionModeOrNull: (field) => field === 'MANUAL',
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      ...(value as unknown as ManualChr017Projection),
      eligibleSymbiontSpecies: eligible.value,
      manualCompositionDraft: draft.value,
    },
  };
}

export function expectedChr017ManualActionKeys(
  projection: ManualChr017Projection,
): readonly ActionKey[] {
  return [
    CHR_017_MANUAL_CARD_ACTION_KEY,
    ...(projection.manualCompositionDraft.length > 0 ? [CHR_017_MANUAL_SUMMARY_ACTION_KEY] : []),
  ];
}

export function decodeChr018Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr018Projection> {
  const speciesKey = value['speciesKey'];
  if (!isSpeciesKey(speciesKey)) return refused(`${path}.speciesKey`, speciesKey ?? null);
  const media = value['artAndTreePreview'];
  if (!isJsonObject(media)) return refused(`${path}.artAndTreePreview`, media ?? null);
  const expectedArt = `/generated/media/symbionts/${speciesKey}.png`;
  const expectedTree = `/generated/media/development-trees/${speciesKey}.png`;
  const mediaResult = decodeProjection(media, `${path}.artAndTreePreview`, {
    artPath: (field) => field === expectedArt,
    developmentTreePath: (field) => field === expectedTree,
  });
  if (!mediaResult.ok) return mediaResult;
  const binding = value['bindingChoiceOrReadOnly'];
  if (!isJsonObject(binding)) return refused(`${path}.bindingChoiceOrReadOnly`, binding ?? null);
  const choice = speciesKey === 'OWL' || speciesKey === 'EEL';
  const expectedBinding =
    speciesKey === 'OWL'
      ? 'OWL_EYE'
      : speciesKey === 'EEL'
        ? 'EEL_ARM'
        : speciesKey === 'TICK'
          ? 'TICK_RIGHT_HAND'
          : speciesKey === 'SPIDER'
            ? 'SPIDER_BOTH_WRISTS'
            : speciesKey === 'MANTIS'
              ? 'MANTIS_BOTH_FOREARMS'
              : 'NONE';
  const bindingResult = choice
    ? decodeProjection(binding, `${path}.bindingChoiceOrReadOnly`, {
        defaultSide: (field) => field === 'RIGHT',
        kind: (field) => field === 'CHOICE',
        options: (field) => sameJson(field, ['LEFT', 'RIGHT']),
      })
    : decodeProjection(binding, `${path}.bindingChoiceOrReadOnly`, {
        binding: (field) =>
          isJsonObject(field) &&
          decodeProjection(field, `${path}.bindingChoiceOrReadOnly.binding`, {
            kind: (kind) => kind === expectedBinding,
          }).ok,
        kind: (field) => field === 'READ_ONLY',
      });
  if (!bindingResult.ok) return bindingResult;
  const compatibility = value['compatibility'];
  if (!isJsonObject(compatibility)) return refused(`${path}.compatibility`, compatibility ?? null);
  const compatibilityResult = decodeProjection(compatibility, `${path}.compatibility`, {
    kind: (field) =>
      field === 'COMPATIBLE' ||
      field === 'DUPLICATE' ||
      field === 'MONSTER_EXCLUSIVE' ||
      field === 'OVER_CAPACITY',
  });
  if (!compatibilityResult.ok) return compatibilityResult;
  const result = decodeProjection(value, path, {
    artAndTreePreview: (field) => field === media,
    bindingChoiceOrReadOnly: (field) => field === binding,
    bindingKind: (field) =>
      field === (choice ? expectedBinding : expectedBinding === 'NONE' ? 'NONE' : 'FIXED'),
    characterDraftId: isNonEmptyString,
    compatibility: (field) => field === compatibility,
    compositionDraftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    slotCost: (field) =>
      isSafeIntegerAtLeast(field, 0) && field === (MONSTERS.has(speciesKey) ? 4 : 1),
    speciesKey: (field) => field === speciesKey,
  });
  return result.ok ? { ok: true, value: value as Chr018Projection } : result;
}

export function expectedChr018ActionKeys(
  projection: Chr018Projection,
  checkpointCapable: boolean,
): readonly ActionKey[] {
  const choice = projection.bindingChoiceOrReadOnly.kind === 'CHOICE';
  return [
    ...(checkpointCapable && projection.compatibility.kind === 'COMPATIBLE'
      ? [CHR_018_MANUAL_ADD_ACTION_KEY]
      : []),
    CHR_018_MANUAL_RETURN_ACTION_KEY,
    ...(choice ? [CHR_018_MANUAL_BINDING_ACTION_KEY] : []),
  ];
}

export function isManualChr017Projection(
  projection: Chr017Projection | ManualChr017Projection,
): projection is ManualChr017Projection {
  return projection.symbiontAcquisitionModeOrNull === 'MANUAL' && projection.raceChoice !== 'PURE';
}

export function isManualChr019Projection(
  projection: Chr019Projection | ManualChr019Projection,
): projection is ManualChr019Projection {
  return projection.duplicatePolicy.kind === 'FORBIDDEN';
}

export function isManualChr041Projection(
  projection: Chr041Projection,
): projection is Chr041ManualProjection {
  return 'compositionDraftRevision' in projection;
}

export function decodeChr019ManualProjection(
  value: JsonObject,
  path: string,
): DecodeResult<ManualChr019Projection> {
  const result = decodeChr019Projection(value, path, 'MANUAL');
  if (!result.ok) return result;
  const projection = result.value;
  if (!isManualChr019Projection(projection)) {
    return refused(`${path}.duplicatePolicy.kind`, projection.duplicatePolicy.kind);
  }
  return { ok: true, value: projection };
}

export function expectedChr019ManualActionKeys(
  available: readonly ActionKey[],
): readonly ActionKey[] {
  return [
    ...(available.includes(CHR_019_MANUAL_PREVIEW_ACTION_KEY)
      ? [CHR_019_MANUAL_PREVIEW_ACTION_KEY]
      : []),
    CHR_019_MANUAL_RETURN_ACTION_KEY,
    ...(available.includes('CHR-019::CTA::001') ? (['CHR-019::CTA::001'] as const) : []),
  ];
}

export function decodeChr041ManualProjection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr041ManualProjection> {
  const result = decodeChr041Projection(value, path);
  if (!result.ok) return result;
  const projection = result.value;
  if (!isManualChr041Projection(projection)) {
    return refused(`${path}.randomSequenceId`, projection.randomSequenceId);
  }
  return { ok: true, value: projection };
}

function decodeComposition(
  value: unknown,
  path: string,
): DecodeResult<ManualCompositionProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const bindings = decodeArray(value['bindings'], `${path}.bindings`, decodeSymbiontBinding);
  if (!bindings.ok) return bindings;
  const instances = decodeArray<SymbiontInstanceProjection>(
    value['symbiontInstancesDraft'],
    `${path}.symbiontInstancesDraft`,
    (entry, entryPath) => {
      if (!isJsonObject(entry)) return refused(entryPath, entry);
      const absorbed = decodeArray<SymbiontSpeciesKey>(
        entry['absorbedSpeciesKeys'],
        `${entryPath}.absorbedSpeciesKeys`,
        (key, keyPath) => (isSpeciesKey(key) ? { ok: true, value: key } : refused(keyPath, key)),
      );
      if (!absorbed.ok) return absorbed;
      const result = decodeProjection(entry, entryPath, {
        absorbedSpeciesKeys: (field) => field === entry['absorbedSpeciesKeys'],
        acceptedIndex: (field) => isSafeIntegerAtLeast(field, 0),
        currentOe: (field) => isSafeIntegerAtLeast(field, 0),
        slotCost: (field) => isSafeIntegerAtLeast(field, 0),
        speciesKey: isSpeciesKey,
        speciesLabel: isNonEmptyString,
        status: (field) => INSTANCE_STATUSES.has(field as string),
      });
      return result.ok
        ? {
            ok: true,
            value: {
              ...(entry as SymbiontInstanceProjection),
              absorbedSpeciesKeys: absorbed.value,
            },
          }
        : result;
    },
  );
  if (!instances.ok) return instances;
  const slots = value['slotUsageAndCapacity'];
  if (!isJsonObject(slots)) return refused(`${path}.slotUsageAndCapacity`, slots ?? null);
  const slotResult = decodeProjection(slots, `${path}.slotUsageAndCapacity`, {
    capacity: (field) => isSafeIntegerAtLeast(field, 0),
    used: (field) => isSafeIntegerAtLeast(field, 0) && field <= (slots['capacity'] as number),
  });
  if (!slotResult.ok) return slotResult;
  const result = decodeProjection(value, path, {
    bindings: (field) => field === value['bindings'],
    slotUsageAndCapacity: (field) => field === slots,
    speciesKeys: (field) =>
      Array.isArray(field) && field.every(isSpeciesKey) && new Set(field).size === field.length,
    symbiontInstancesDraft: (field) => field === value['symbiontInstancesDraft'],
  });
  if (!result.ok) return result;
  const keys = value['speciesKeys'] as readonly SymbiontSpeciesKey[];
  if (
    keys.length !== instances.value.length ||
    keys.length !== bindings.value.length ||
    instances.value.some(
      (entry, index) => entry.acceptedIndex !== index || entry.speciesKey !== keys[index],
    ) ||
    bindings.value.some(
      (entry, index) => entry.acceptedIndex !== index || entry.speciesKey !== keys[index],
    )
  ) {
    return refused(path, value);
  }
  return {
    ok: true,
    value: {
      ...(value as ManualCompositionProjection),
      bindings: bindings.value,
      symbiontInstancesDraft: instances.value,
    },
  };
}

function decodeSlotDiffSide(value: unknown, path: string): DecodeResult<JsonObject | null> {
  if (value === null) return { ok: true, value: null };
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const result = decodeProjection(value, path, {
    currentOe: (field) => isSafeIntegerAtLeast(field, 0),
    slotCost: (field) => isSafeIntegerAtLeast(field, 0),
    status: (field) => INSTANCE_STATUSES.has(field as string),
  });
  return result.ok ? { ok: true, value } : result;
}

export function decodeChr042Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr042Projection> {
  const before = decodeComposition(value['compositionBefore'], `${path}.compositionBefore`);
  if (!before.ok) return before;
  const after = decodeComposition(value['compositionAfter'], `${path}.compositionAfter`);
  if (!after.ok) return after;
  const graph = decodeInteractionContainer(
    value['interactionGraph'],
    `${path}.interactionGraph`,
    'INTERACTIONS',
    'NO_INTERACTIONS',
  );
  if (!graph.ok) return graph;
  const consequences = decodeInteractionContainer(
    value['suppressionDestructionAbsorption'],
    `${path}.suppressionDestructionAbsorption`,
    'CONSEQUENCES',
    'NONE',
  );
  if (!consequences.ok) return consequences;
  const diff = value['slotStatOeDiff'];
  if (!isJsonObject(diff)) return refused(`${path}.slotStatOeDiff`, diff ?? null);
  const entries = decodeArray(
    diff['entries'],
    `${path}.slotStatOeDiff.entries`,
    (entry, entryPath) => {
      if (!isJsonObject(entry)) return refused(entryPath, entry);
      const beforeSide = decodeSlotDiffSide(entry['before'], `${entryPath}.before`);
      if (!beforeSide.ok) return beforeSide;
      const afterSide = decodeSlotDiffSide(entry['after'], `${entryPath}.after`);
      if (!afterSide.ok) return afterSide;
      const result = decodeProjection(entry, entryPath, {
        after: (field) => field === entry['after'],
        before: (field) => field === entry['before'],
        speciesKey: isSpeciesKey,
      });
      return result.ok
        ? {
            ok: true,
            value: {
              after: afterSide.value,
              before: beforeSide.value,
              speciesKey: entry['speciesKey'] as SymbiontSpeciesKey,
            },
          }
        : result;
    },
  );
  if (!entries.ok) return entries;
  const modifierBefore = decodeStatModifierEffect(
    diff['modifierBreakdownBefore'],
    `${path}.slotStatOeDiff.modifierBreakdownBefore`,
  );
  if (!modifierBefore.ok) return modifierBefore;
  const modifierAfter = decodeStatModifierEffect(
    diff['modifierBreakdownAfter'],
    `${path}.slotStatOeDiff.modifierBreakdownAfter`,
  );
  if (!modifierAfter.ok) return modifierAfter;
  const diffResult = decodeProjection(diff, `${path}.slotStatOeDiff`, {
    entries: (field) => field === diff['entries'],
    modifierBreakdownAfter: (field) => field === diff['modifierBreakdownAfter'],
    modifierBreakdownBefore: (field) => field === diff['modifierBreakdownBefore'],
    slotUsageAfter: (field) => field === after.value.slotUsageAndCapacity.used,
    slotUsageBefore: (field) => field === before.value.slotUsageAndCapacity.used,
  });
  if (!diffResult.ok) return diffResult;
  const result = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    commandId: isNonEmptyString,
    compositionAfter: (field) => field === value['compositionAfter'],
    compositionBefore: (field) => field === value['compositionBefore'],
    confirmationStatus: (field) => field === 'PREVIEW',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    interactionGraph: (field) => field === value['interactionGraph'],
    irreversibleOperationIds: (field) =>
      Array.isArray(field) &&
      field.length > 0 &&
      field.every((entry) => typeof entry === 'string' && IRREVERSIBLE_OPERATIONS.has(entry)) &&
      new Set(field).size === field.length,
    slotStatOeDiff: (field) => field === diff,
    suppressionDestructionAbsorption: (field) =>
      field === value['suppressionDestructionAbsorption'],
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      ...(value as Chr042Projection),
      compositionAfter: after.value,
      compositionBefore: before.value,
      interactionGraph: graph.value as Chr042Projection['interactionGraph'],
      slotStatOeDiff: {
        entries: entries.value as Chr042Projection['slotStatOeDiff']['entries'],
        modifierBreakdownAfter: modifierAfter.value,
        modifierBreakdownBefore: modifierBefore.value,
        slotUsageAfter: diff['slotUsageAfter'] as number,
        slotUsageBefore: diff['slotUsageBefore'] as number,
      },
      suppressionDestructionAbsorption:
        consequences.value as Chr042Projection['suppressionDestructionAbsorption'],
    },
  };
}

export const CHR_042_MANUAL_CONFIRM_ACTION_KEY = 'CHR-042::CTA::001' as const;

export interface ManualInteractionConfirmationPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly interactionDiff: JsonObject;
  readonly sourceFormId: 'CHR-042';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'MANUAL_INTERACTION_CONFIRMATION';
  readonly wizardCheckpointId: string;
}

export type ManualInteractionConfirmationRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  ManualInteractionConfirmationPayload
>;

export interface ManualInteractionConfirmationResult extends JsonObject {
  readonly anatomyProfile: 'STANDARD_HUMANOID';
  readonly armorBundleId: string;
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly interactionDiff: JsonObject;
  readonly nextFormId: 'CHR-021';
  readonly qualityRollRequestId: string;
  readonly sourceFormId: 'CHR-042';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'MANUAL_INTERACTION_CONFIRMATION';
}

export function manualInteractionConfirmationPayload(
  snapshot: ConfirmedProjectionSnapshot,
): ManualInteractionConfirmationPayload {
  if (snapshot.formId !== 'CHR-042') {
    throw new Error(`CHR-042 confirmation requires CHR-042, got ${snapshot.formId}`);
  }
  const projection = snapshot.projection;
  return {
    characterDraftId: projection.characterDraftId,
    draftRevision: projection.draftRevision,
    interactionDiff: {
      compositionBefore: projection.compositionBefore,
      compositionAfter: projection.compositionAfter,
      interactionGraph: projection.interactionGraph,
      suppressionDestructionAbsorption: projection.suppressionDestructionAbsorption,
      slotStatOeDiff: projection.slotStatOeDiff,
      irreversibleOperationIds: projection.irreversibleOperationIds,
    },
    sourceFormId: 'CHR-042',
    stage: 'SYMBIONTS',
    variant: 'MANUAL_INTERACTION_CONFIRMATION',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

export function decodeManualInteractionConfirmationTerminal(
  message: Terminal,
  request: ManualInteractionConfirmationRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<ManualInteractionConfirmationResult>> {
  const receipt = message.receipt;
  const payload = request.payload;
  if (
    source.formId !== 'CHR-042' ||
    receipt.commandId !== request.commandId ||
    !validReceipt(receipt, request)
  ) {
    return refused('$.receipt.commandId', receipt.commandId);
  }
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    anatomyProfile: (field) => field === 'STANDARD_HUMANOID',
    armorBundleId: isNonEmptyString,
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field) => field === payload.draftRevision + 1,
    interactionDiff: (field) => sameJson(field, payload.interactionDiff),
    nextFormId: (field) => field === 'CHR-021',
    qualityRollRequestId: isNonEmptyString,
    sourceFormId: (field) => field === 'CHR-042',
    stage: (field) => field === 'SYMBIONTS',
    variant: (field) => field === 'MANUAL_INTERACTION_CONFIRMATION',
  });
  if (!result.ok) return result;
  return { ok: true, value: receipt as CommandReceipt<ManualInteractionConfirmationResult> };
}

function baselineEntries(projection: JsonObject): readonly ManualCompositionEntry[] {
  const bindings = projection['bindings'] ?? projection['manualCompositionDraft'];
  if (!Array.isArray(bindings)) {
    if (isSpeciesKey(projection['speciesKey']) && isJsonObject(projection['artAndTreePreview'])) {
      return [];
    }
    throw new Error('manual composition requires a host binding snapshot');
  }
  return bindings.map((entry) => {
    if (!isJsonObject(entry) || !isSpeciesKey(entry['speciesKey']))
      throw new Error('manual composition has an invalid host binding');
    const binding = entry['binding'];
    const side =
      isJsonObject(binding) && (binding['side'] === 'LEFT' || binding['side'] === 'RIGHT')
        ? binding['side']
        : null;
    return { sideOrNull: side, speciesKey: entry['speciesKey'] };
  });
}

export function manualCompositionDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
  previous: ManualCompositionDraft | null,
  committedCompositionRevision?: number,
): ManualCompositionDraft | null {
  const card = snapshot.formId === 'CHR-018';
  const advisor = snapshot.formId === 'CHR-041';
  if (snapshot.formId === 'CHR-042') return previous;
  if (snapshot.formId !== 'CHR-017' && !card && snapshot.formId !== 'CHR-019' && !advisor) {
    return null;
  }
  if (snapshot.formId === 'CHR-019' && snapshot.projection.duplicatePolicy.kind !== 'FORBIDDEN') {
    return null;
  }
  if (snapshot.formId === 'CHR-017' && !isManualChr017Projection(snapshot.projection)) return null;
  if (advisor && !isManualChr041Projection(snapshot.projection)) return null;
  const projection = snapshot.projection as
    ManualChr017Projection | Chr018Projection | ManualChr019Projection | Chr041ManualProjection;
  const characterDraftId = projection.characterDraftId;
  const wizardCheckpointId = card ? previous?.wizardCheckpointId : projection.wizardCheckpointId;
  const raceChoice = card || advisor ? previous?.raceChoice : projection.raceChoice;
  if (!isNonEmptyString(wizardCheckpointId) || (raceChoice !== 'FREE' && raceChoice !== 'UNITED')) {
    return null;
  }
  const previousScope =
    previous !== null &&
    previous.characterDraftId === characterDraftId &&
    previous.wizardCheckpointId === wizardCheckpointId &&
    previous.raceChoice === raceChoice;
  if ((card && previous === null) || (advisor && !previousScope)) return null;
  const compositionDraftRevisionValue: unknown = card
    ? projection.compositionDraftRevision
    : (committedCompositionRevision ??
      (advisor
        ? projection.compositionDraftRevision
        : previousScope
          ? previous.compositionDraftRevision
          : projection.draftRevision));
  if (
    typeof compositionDraftRevisionValue !== 'number' ||
    !Number.isSafeInteger(compositionDraftRevisionValue) ||
    compositionDraftRevisionValue < 0 ||
    (advisor && compositionDraftRevisionValue !== projection.compositionDraftRevision)
  ) {
    return null;
  }
  const compositionDraftRevision = compositionDraftRevisionValue;
  const draftRevisionValue: unknown = card ? previous?.draftRevision : projection.draftRevision;
  if (
    typeof draftRevisionValue !== 'number' ||
    !Number.isSafeInteger(draftRevisionValue) ||
    draftRevisionValue < 0
  ) {
    return null;
  }
  const draftRevision = draftRevisionValue;
  const currentSpeciesKeyOrNull: SymbiontSpeciesKey | null =
    card && isSpeciesKey(projection.speciesKey) ? projection.speciesKey : null;
  if (card && currentSpeciesKeyOrNull === null) return null;
  const sameScope =
    previousScope &&
    (committedCompositionRevision !== undefined || previous.draftRevision === draftRevision);
  if (advisor && !sameScope) return null;
  const entries = sameScope ? previous.entries : baselineEntries(projection);
  const sideBySpecies: Partial<Record<'OWL' | 'EEL', SymbiontSide>> = {};
  for (const entry of entries) {
    if ((entry.speciesKey === 'OWL' || entry.speciesKey === 'EEL') && entry.sideOrNull !== null) {
      sideBySpecies[entry.speciesKey] = entry.sideOrNull;
    }
  }
  if (
    card &&
    (currentSpeciesKeyOrNull === 'OWL' || currentSpeciesKeyOrNull === 'EEL') &&
    sideBySpecies[currentSpeciesKeyOrNull] === undefined
  ) {
    sideBySpecies[currentSpeciesKeyOrNull] = 'RIGHT';
  }
  return {
    characterDraftId,
    compositionDraftRevision,
    currentSpeciesKeyOrNull,
    draftRevision,
    entries: [...entries],
    raceChoice,
    sideBySpecies,
    wizardCheckpointId,
  };
}

function assertDraftScope(
  snapshot: ConfirmedProjectionSnapshot,
  draft: ManualCompositionDraft | null,
): asserts draft is ManualCompositionDraft {
  if (
    draft === null ||
    (snapshot.formId !== 'CHR-018' &&
      snapshot.formId !== 'CHR-019' &&
      snapshot.formId !== 'CHR-017')
  )
    throw new Error('manual composition requires a confirmed CHR-017/018/019 scope');
  if (snapshot.formId === 'CHR-019' && snapshot.projection.duplicatePolicy.kind !== 'FORBIDDEN')
    throw new Error('RANDOM summary is not a manual composition');
  const wizardMatches =
    snapshot.formId === 'CHR-018' ||
    snapshot.projection.wizardCheckpointId === draft.wizardCheckpointId;
  const revisionMatches =
    snapshot.formId === 'CHR-018'
      ? snapshot.projection.compositionDraftRevision === draft.compositionDraftRevision
      : snapshot.projection.draftRevision === draft.draftRevision;
  if (
    snapshot.projection.characterDraftId !== draft.characterDraftId ||
    !wizardMatches ||
    !revisionMatches
  )
    throw new Error('manual composition draft revision or identity changed');
}

export function toggleManualCompositionSpecies(
  snapshot: ConfirmedProjectionSnapshot,
  draft: ManualCompositionDraft | null,
  speciesKey: SymbiontSpeciesKey,
  included: boolean,
): ManualCompositionDraft {
  assertDraftScope(snapshot, draft);
  if (
    included &&
    (snapshot.formId !== 'CHR-018' ||
      snapshot.projection.speciesKey !== speciesKey ||
      snapshot.projection.compatibility.kind !== 'COMPATIBLE')
  )
    throw new Error('manual inclusion requires the current compatible CHR-018 species');
  if (!included && !draft.entries.some((entry) => entry.speciesKey === speciesKey))
    throw new Error('manual removal requires an accepted draft species');
  if (included && draft.entries.some((entry) => entry.speciesKey === speciesKey))
    throw new Error('manual duplicate species are forbidden');
  const entries = included
    ? [
        ...draft.entries,
        {
          sideOrNull:
            speciesKey === 'OWL' || speciesKey === 'EEL'
              ? (draft.sideBySpecies[speciesKey] ?? 'RIGHT')
              : null,
          speciesKey,
        },
      ]
    : draft.entries.filter((entry) => entry.speciesKey !== speciesKey);
  return { ...draft, entries };
}

export function replaceManualBindingSide(
  snapshot: ConfirmedProjectionSnapshot,
  draft: ManualCompositionDraft | null,
  side: SymbiontSide,
): ManualCompositionDraft {
  assertDraftScope(snapshot, draft);
  if (
    snapshot.formId !== 'CHR-018' ||
    snapshot.projection.bindingChoiceOrReadOnly.kind !== 'CHOICE'
  )
    throw new Error('CHR-018 binding requires a host-signed choice');
  const speciesKey = snapshot.projection.speciesKey;
  if (speciesKey !== 'OWL' && speciesKey !== 'EEL')
    throw new Error('CHR-018 binding species is inconsistent');
  return {
    ...draft,
    sideBySpecies: { ...draft.sideBySpecies, [speciesKey]: side },
    entries: draft.entries.map((entry) =>
      entry.speciesKey === speciesKey ? { ...entry, sideOrNull: side } : entry,
    ),
  };
}

export function manualCompositionPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: ManualCompositionDraft | null,
): ManualCompositionPayload {
  assertDraftScope(snapshot, draft);
  if (
    snapshot.formId !== 'CHR-018' ||
    !snapshot.availableActionKeys.includes(CHR_018_MANUAL_ADD_ACTION_KEY) ||
    !snapshot.executableWorkflowCommandIds.includes(CHECKPOINT_WORKFLOW_COMMAND_ID)
  )
    throw new Error('CHR-018 composition checkpoint is unavailable');
  const projection = snapshot.projection;
  if (!draft.entries.some((entry) => entry.speciesKey === projection.speciesKey))
    throw new Error('CHR-018 requires the current species in the full replacement');
  if (new Set(draft.entries.map((entry) => entry.speciesKey)).size !== draft.entries.length)
    throw new Error('manual duplicate species are forbidden');
  const monsterCount = draft.entries.filter((entry) => MONSTERS.has(entry.speciesKey)).length;
  const validCardinality =
    draft.raceChoice === 'FREE'
      ? monsterCount === 0 && draft.entries.length === 1
      : monsterCount === 0
        ? draft.entries.length === 4
        : monsterCount === 1 && draft.entries.length === 1;
  if (projection.compositionDraftRevision !== draft.compositionDraftRevision || !validCardinality)
    throw new Error('manual composition has an invalid revision or cardinality');
  const selectedBindings = draft.entries.flatMap((entry) => {
    if (entry.speciesKey !== 'OWL' && entry.speciesKey !== 'EEL') return [];
    const side = draft.sideBySpecies[entry.speciesKey];
    if (side === undefined) throw new Error('manual Owl/Eel binding is missing');
    return [{ side, speciesKey: entry.speciesKey }];
  });
  return {
    acceptedSpecies: draft.entries.map((entry, acceptedIndex) => ({
      acceptedIndex,
      speciesKey: entry.speciesKey,
    })),
    characterDraftId: draft.characterDraftId,
    compositionDraftRevision: draft.compositionDraftRevision,
    draftRevision: draft.draftRevision,
    selectedBindings,
    sourceFormId: 'CHR-018',
    stage: 'SYMBIONTS',
    variant: 'MANUAL_COMPOSITION',
    wizardCheckpointId: draft.wizardCheckpointId,
  };
}

export function manualAdvisorIwPayload(
  snapshot: ConfirmedProjectionSnapshot,
  faces: readonly [number, number] | null,
): ManualAdvisorIwPayload {
  if (
    snapshot.formId !== 'CHR-041' ||
    !isManualChr041Projection(snapshot.projection) ||
    snapshot.projection.advisorSlotsAndSkills.kind !== 'IW_ROLLS_REQUIRED' ||
    !snapshot.availableActionKeys.includes(CHR_041_MANUAL_IW_ACTION_KEY)
  )
    throw new Error('CHR-041 requires pending manual Advisor I/W');
  const projection = snapshot.projection;
  if (faces !== null && (!Array.isArray(faces) || faces.length !== 2 || !faces.every(isFace)))
    throw new Error('CHR-041 requires two complete MANUAL faces');
  if (projection.diceInputModeSnapshot === 'AUTO' ? faces !== null : faces === null)
    throw new Error('CHR-041 requires two complete MANUAL faces or an AUTO request');
  if (!snapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID))
    throw new Error('CHR-041 ROLL-COMMIT is unavailable');
  const pendingRollRequestIds = projection.iwRollRequestIds;
  const firstRequestId = pendingRollRequestIds[0];
  const secondRequestId = pendingRollRequestIds[1];
  if (!isNonEmptyString(firstRequestId) || !isNonEmptyString(secondRequestId)) {
    throw new Error('CHR-041 requires two addressed pending IDs');
  }
  const addressed: readonly [string, string] = [firstRequestId, secondRequestId];
  return {
    advisorInstanceDraftId: projection.advisorInstanceDraftId,
    characterDraftId: projection.characterDraftId,
    compositionDraftRevision: projection.compositionDraftRevision,
    draftRevision: projection.draftRevision,
    manualFacesOrNull: faces,
    pendingRollRequestIds: addressed,
    sourceFormId: 'CHR-041',
    stage: 'SYMBIONTS',
    variant: 'ADVISOR_IW',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

export function manualAdvisorSkillPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: AdvisorSkillSelectionDraft | null,
): ManualAdvisorSkillPayload {
  if (
    snapshot.formId !== 'CHR-041' ||
    !isManualChr041Projection(snapshot.projection) ||
    snapshot.projection.acknowledged ||
    draft === null ||
    draft.selectionValidation.kind !== 'EXACT'
  )
    throw new Error('CHR-041 requires exact manual Advisor skills');
  const projection = snapshot.projection;
  const slots = projection.advisorSlotsAndSkills;
  if (
    !isAdvisorSkillSlots(slots) ||
    (projection.trogrSuppressionState.kind === 'SUPPRESSED' &&
      projection.trogrSuppressionState.rollReceiptIdOrNull === null)
  )
    throw new Error('CHR-041 requires I/W and any mandatory B before skills');
  const selectedSkills = draft.selectedSkills.map(({ skillId, targetBonus }) => {
    const option = slots.skillOptions.find((candidate) => candidate.skillId === skillId);
    const level = option?.levelOptions.find((candidate) => candidate.targetBonus === targetBonus);
    if (option === undefined || level === undefined)
      throw new Error('CHR-041 selected skill is absent from signed options');
    return { skillId, targetBonus };
  });
  if (
    selectedSkills.reduce(
      (sum, selected) =>
        sum +
        slots.skillOptions
          .find((option) => option.skillId === selected.skillId)!
          .levelOptions.find((level) => level.targetBonus === selected.targetBonus)!.slotCost,
      0,
    ) !== slots.requiredSlotCount
  )
    throw new Error('CHR-041 skill slots do not match host capacity');
  return {
    advisorInstanceDraftId: projection.advisorInstanceDraftId,
    characterDraftId: projection.characterDraftId,
    compositionDraftRevision: projection.compositionDraftRevision,
    draftRevision: projection.draftRevision,
    selectedSkills,
    sourceFormId: 'CHR-041',
    stage: 'SYMBIONTS',
    variant: 'MANUAL_ADVISOR_SKILLS',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

function receiptCommonFields(
  payload: ManualCompositionPayload | ManualAdvisorIwPayload | ManualAdvisorSkillPayload,
): Record<string, (value: JsonValue | undefined) => boolean> {
  return {
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
    compositionDraftRevision: (field) =>
      field ===
      (payload.variant === 'MANUAL_COMPOSITION'
        ? payload.draftRevision + 1
        : payload.compositionDraftRevision),
    draftRevision: (field) => field === payload.draftRevision + 1,
    stage: (field) => field === 'SYMBIONTS',
  };
}
function validReceipt(
  receipt: CommandReceipt<JsonObject>,
  request: {
    readonly commandId: string;
    readonly expectedRevisions: ConfirmedProjectionSnapshot['revisions'];
  },
): boolean {
  return (
    isNonEmptyString(receipt.receiptId) &&
    receipt.revisions.actorVisibilityRevision ===
      request.expectedRevisions.actorVisibilityRevision &&
    receipt.revisions.stateRevision === request.expectedRevisions.stateRevision + 1 &&
    receipt.revisions.projectionRevision === request.expectedRevisions.projectionRevision + 1
  );
}

export function decodeManualCompositionTerminal(
  message: Terminal,
  request: ManualCompositionRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<ManualCompositionResult>> {
  const receipt = message.receipt;
  const payload = request.payload;
  if (
    source.formId !== 'CHR-018' ||
    receipt.commandId !== request.commandId ||
    !validReceipt(receipt, request)
  )
    return refused('$.receipt.commandId', receipt.commandId);
  const bindings = decodeArray(
    receipt.result['bindings'],
    '$.receipt.result.bindings',
    decodeSymbiontBinding,
  );
  if (!bindings.ok) return bindings;
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    ...receiptCommonFields(payload),
    acceptedSpecies: (field) => sameJson(field, payload.acceptedSpecies),
    advisorBranch: (field) =>
      field === payload.acceptedSpecies.some((entry) => entry.speciesKey === 'ADVISER'),
    bindings: (field) => field === receipt.result['bindings'],
    nextFormId: (field) =>
      field === 'CHR-019' ||
      (field === 'CHR-041' &&
        payload.acceptedSpecies.some((entry) => entry.speciesKey === 'ADVISER')),
    sourceFormId: (field) => field === 'CHR-018',
    variant: (field) => field === 'MANUAL_COMPOSITION',
  });
  if (!result.ok) return result;
  if (
    bindings.value.length !== payload.acceptedSpecies.length ||
    bindings.value.some(
      (binding, index) =>
        binding.acceptedIndex !== index ||
        binding.speciesKey !== payload.acceptedSpecies[index]?.speciesKey,
    )
  )
    return refused('$.receipt.result.bindings', receipt.result['bindings'] ?? null);
  for (const binding of bindings.value) {
    const selected = payload.selectedBindings.find(
      (entry) => entry.speciesKey === binding.speciesKey,
    );
    if (
      binding.speciesKey === 'OWL' || binding.speciesKey === 'EEL'
        ? selected === undefined ||
          !('side' in binding.binding) ||
          binding.binding.side !== selected.side
        : selected !== undefined
    )
      return refused('$.receipt.result.bindings', bindings.value);
  }
  return { ok: true, value: receipt as CommandReceipt<ManualCompositionResult> };
}

function decodeManualPhysicalRoll(
  value: unknown,
  path: string,
  kind: 'ADVISOR_I' | 'ADVISOR_W',
): DecodeResult<ManualPhysicalRoll> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const mechanical = value['mechanical'];
  if (!isJsonObject(mechanical)) return refused(`${path}.mechanical`, mechanical ?? null);
  const mechanicalResult = decodeProjection(mechanical, `${path}.mechanical`, {
    dieSides: (field) => field === 20,
    rawFace: isFace,
  });
  if (!mechanicalResult.ok) return mechanicalResult;
  const result = decodeProjection(value, path, {
    kind: (field) => field === kind,
    mechanical: (field) => field === mechanical,
    rollReceiptId: isNonEmptyString,
    rollRequestId: isNonEmptyString,
  });
  return result.ok ? { ok: true, value: value as ManualPhysicalRoll } : result;
}

export function decodeManualAdvisorIwTerminal(
  message: Terminal,
  request: ManualAdvisorIwRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<ManualAdvisorIwResult>> {
  if (source.formId !== 'CHR-041' || !isManualChr041Projection(source.projection))
    return refused('$.presentation.base.formId', source.formId);
  const payload = request.payload;
  const receipt = message.receipt;
  if (receipt.commandId !== request.commandId || !validReceipt(receipt, request))
    return refused('$.receipt.commandId', receipt.commandId);
  const rawRolls = receipt.result['physicalRolls'];
  if (!Array.isArray(rawRolls) || rawRolls.length !== 2)
    return refused('$.receipt.result.physicalRolls', rawRolls ?? null);
  const i = decodeManualPhysicalRoll(rawRolls[0], '$.receipt.result.physicalRolls[0]', 'ADVISOR_I');
  if (!i.ok) return i;
  const w = decodeManualPhysicalRoll(rawRolls[1], '$.receipt.result.physicalRolls[1]', 'ADVISOR_W');
  if (!w.ok) return w;
  const iw = receipt.result['advisorIw'];
  if (!isJsonObject(iw)) return refused('$.receipt.result.advisorIw', iw ?? null);
  for (const [stat, roll] of [
    ['I', i.value],
    ['W', w.value],
  ] as const) {
    const entry = iw[stat];
    if (
      !isJsonObject(entry) ||
      !decodeProjection(entry, `$.receipt.result.advisorIw.${stat}`, {
        rawFace: (field) => field === roll.mechanical.rawFace,
        value: (field) => field === roll.mechanical.rawFace + 8,
      }).ok
    )
      return refused(`$.receipt.result.advisorIw.${stat}`, entry ?? null);
  }
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    ...receiptCommonFields(payload),
    advisorInstanceDraftId: (field) => field === payload.advisorInstanceDraftId,
    advisorIw: (field) => field === iw,
    diceInputModeSnapshot: (field) => field === source.projection.diceInputModeSnapshot,
    nextFormId: (field) => field === 'CHR-041',
    physicalRolls: (field) => field === rawRolls,
    sourceFormId: (field) => field === 'CHR-041',
    variant: (field) => field === 'ADVISOR_IW',
  });
  if (!result.ok) return result;
  const ids = [
    receipt.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    payload.characterDraftId,
    payload.wizardCheckpointId,
    payload.advisorInstanceDraftId,
    ...payload.pendingRollRequestIds,
    i.value.rollReceiptId,
  ].filter((entry): entry is string => typeof entry === 'string');
  if (
    i.value.rollRequestId !== payload.pendingRollRequestIds[0] ||
    w.value.rollRequestId !== payload.pendingRollRequestIds[1]
  ) {
    return refused('$.receipt.result.physicalRolls.rollRequestId', [
      i.value.rollRequestId,
      w.value.rollRequestId,
    ]);
  }
  if (
    i.value.rollReceiptId === w.value.rollReceiptId ||
    w.value.rollReceiptId !== receipt.receiptId
  ) {
    return refused('$.receipt.receiptId', receipt.receiptId);
  }
  if (new Set(ids).size !== ids.length) {
    return refused('$.receipt.result.branchUuid', receipt.result['branchUuid'] ?? null);
  }
  if (
    payload.manualFacesOrNull === null
      ? source.projection.diceInputModeSnapshot !== 'AUTO'
      : !sameJson(payload.manualFacesOrNull, [
          i.value.mechanical.rawFace,
          w.value.mechanical.rawFace,
        ])
  ) {
    return refused('$.receipt.result.physicalRolls.mechanical', [
      i.value.mechanical,
      w.value.mechanical,
    ]);
  }
  return { ok: true, value: receipt as CommandReceipt<ManualAdvisorIwResult> };
}

export function decodeManualAdvisorSkillTerminal(
  message: Terminal,
  request: ManualAdvisorSkillRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<ManualAdvisorSkillResult>> {
  if (source.formId !== 'CHR-041' || !isManualChr041Projection(source.projection))
    return refused('$.presentation.base.formId', source.formId);
  const slots = source.projection.advisorSlotsAndSkills;
  if (!isAdvisorSkillSlots(slots))
    return refused(
      '$.presentation.base.roleFilteredPayload.advisorSlotsAndSkills.kind',
      slots.kind,
    );
  const payload = request.payload;
  const receipt = message.receipt;
  if (receipt.commandId !== request.commandId || !validReceipt(receipt, request))
    return refused('$.receipt.commandId', receipt.commandId);
  const expectedLearned: { bonus: number; skillKey: string; slotCost: number }[] = [];
  for (const selected of payload.selectedSkills) {
    const option = slots.skillOptions.find((candidate) => candidate.skillId === selected.skillId);
    const level = option?.levelOptions.find(
      (candidate) => candidate.targetBonus === selected.targetBonus,
    );
    if (level === undefined) {
      return refused('$.request.payload.selectedSkills', payload.selectedSkills);
    }
    expectedLearned.push({
      bonus: selected.targetBonus,
      skillKey: selected.skillId,
      slotCost: level.slotCost,
    });
  }
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    ...receiptCommonFields(payload),
    advisorInstanceDraftId: (field) => field === payload.advisorInstanceDraftId,
    effectsActive: (field) => field === source.projection.advisorCard.effectsActive,
    learnedSkills: (field) => sameJson(field, expectedLearned),
    nextFormId: (field) => field === 'CHR-019',
    requiredSlotCount: (field) => field === slots.requiredSlotCount,
    selectedSkills: (field) => sameJson(field, payload.selectedSkills),
    sourceFormId: (field) => field === 'CHR-041',
    usedSlotCount: (field) => field === slots.requiredSlotCount,
    variant: (field) => field === 'MANUAL_ADVISOR_SKILLS',
  });
  if (!result.ok) return result;
  const ids = [
    receipt.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    payload.characterDraftId,
    payload.wizardCheckpointId,
    payload.advisorInstanceDraftId,
    ...source.projection.iwRollRequestIds,
    ...source.projection.iwRollReceiptIds,
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) return refused('$.receipt.receiptId', receipt.receiptId);
  return { ok: true, value: receipt as CommandReceipt<ManualAdvisorSkillResult> };
}

function snapshotCommon(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<ManualResultCommon>,
): boolean {
  const projection = snapshot.projection;
  return (
    snapshot.revisions.actorVisibilityRevision === receipt.revisions.actorVisibilityRevision &&
    snapshot.revisions.stateRevision === receipt.revisions.stateRevision &&
    snapshot.revisions.projectionRevision === receipt.revisions.projectionRevision &&
    projection['characterDraftId'] === receipt.result.characterDraftId &&
    projection['wizardCheckpointId'] === receipt.result.checkpointId &&
    projection['draftRevision'] === receipt.result.draftRevision &&
    projection['commandId'] === receipt.commandId &&
    (snapshot.formId === 'CHR-019'
      ? snapshot.projection.duplicatePolicy.kind === 'FORBIDDEN'
      : snapshot.formId === 'CHR-041' &&
        'compositionDraftRevision' in snapshot.projection &&
        snapshot.projection.compositionDraftRevision === receipt.result.compositionDraftRevision)
  );
}

export function manualCompositionSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<ManualCompositionResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (snapshot.formId !== receipt.result.nextFormId || !snapshotCommon(snapshot, receipt))
    return refused('$.presentation.base.formId', snapshot.formId);
  if (
    snapshot.formId === 'CHR-019' &&
    (!sameJson(snapshot.projection.bindings, receipt.result.bindings) ||
      !sameJson(
        snapshot.projection.speciesKeys,
        receipt.result.acceptedSpecies.map((entry) => entry.speciesKey),
      ))
  )
    return refused(
      '$.presentation.base.roleFilteredPayload.bindings',
      snapshot.projection.bindings,
    );
  return { ok: true, value: snapshot };
}

export function manualAdvisorIwSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<ManualAdvisorIwResult>,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (
    snapshot.formId !== 'CHR-041' ||
    !isManualChr041Projection(snapshot.projection) ||
    source.formId !== 'CHR-041' ||
    !snapshotCommon(snapshot, receipt)
  )
    return refused('$.presentation.base.formId', snapshot.formId);
  const projection = snapshot.projection;
  const slots = projection.advisorSlotsAndSkills;
  if (
    !isAdvisorSkillSlots(slots) ||
    projection.advisorInstanceDraftId !== receipt.result.advisorInstanceDraftId ||
    projection.iwRollReceiptIds.some(
      (id, index) => id !== receipt.result.physicalRolls[index]?.rollReceiptId,
    ) ||
    projection.iwRollRequestIds.some(
      (id, index) => id !== receipt.result.physicalRolls[index]?.rollRequestId,
    ) ||
    projection.advisorIPlus8OrNull !== receipt.result.advisorIw.I.value ||
    projection.advisorWPlus8OrNull !== receipt.result.advisorIw.W.value ||
    projection.advisorCard.advisorIPlus8 !== receipt.result.advisorIw.I.value ||
    projection.advisorCard.advisorWPlus8 !== receipt.result.advisorIw.W.value
  )
    return refused('$.presentation.base.roleFilteredPayload', projection);
  return { ok: true, value: snapshot };
}

export function manualAdvisorSkillSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<ManualAdvisorSkillResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  return snapshot.formId === 'CHR-019' && snapshotCommon(snapshot, receipt)
    ? { ok: true, value: snapshot }
    : refused('$.presentation.base.formId', snapshot.formId);
}
