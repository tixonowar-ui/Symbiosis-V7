import type { ActionKey, FormId } from '@generated/types/atlas.js';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import type { DecodeResult, JsonObject, JsonValue } from '@shared/index.js';
import {
  decodeRaceConsequenceOptions,
  type RaceConsequenceOptionProjection,
} from '../../ws-client.js';
import {
  decodeProjection,
  isJsonObject,
  isNonEmptyString,
  isFace,
  isSpeciesKey,
} from './random-symbionts.js';
import {
  creationValidationPublicText,
  type CreationValidationCommon,
} from './creation-validation.js';

export const CREATION_CORRECTION_FORMS = [
  'CHR-001',
  'CHR-009',
  'CHR-010',
  'CHR-011',
  'CHR-015',
  'CHR-017',
  'CHR-018',
  'CHR-019',
  'CHR-020',
  'CHR-041',
  'CHR-042',
] as const;
export interface CorrectionSkillOption extends JsonObject {
  readonly skillId: string;
  readonly skillLabel: string;
  readonly bonusDomainScope: string;
  readonly requirements: readonly {
    readonly statCode: string;
    readonly statLabel: string;
    readonly minValue: number;
  }[];
  readonly missingSkillPenalty:
    | { readonly kind: 'NO_MISSING_SKILL_PENALTY' }
    | { readonly kind: 'MISSING_SKILL_PENALTY'; readonly value: number };
  readonly levelOptions: readonly { readonly targetBonus: number; readonly slotCost: number }[];
}
export interface CorrectionSpecies extends JsonObject {
  readonly speciesKey: string;
  readonly speciesLabel: string;
  readonly slotCost: number;
  readonly bindingPolicy: string;
  readonly kind: 'ORDINARY' | 'SYMBIOTIC_MONSTER';
}
export interface CreationCorrectionProjection extends CreationValidationCommon {
  readonly correctionContext: JsonObject & {
    readonly originFormId: 'CHR-025';
    readonly returnFormId: 'CHR-025';
    readonly sourceFormId: (typeof CREATION_CORRECTION_FORMS)[number];
    readonly summaryReceiptId: string;
    readonly correctionHeadHash: string;
  };
  readonly identity: JsonObject;
  readonly raceChoice: 'PURE' | 'UNITED' | 'FREE';
  readonly pureClassOrNull: string | null;
  readonly lockedAcquisitionModeOrNull: 'MANUAL' | 'RANDOM' | null;
  readonly creationMode: 'MANUAL' | 'RANDOM' | null;
  readonly raceOptions: readonly { readonly raceCode: string; readonly label: string }[];
  readonly raceConsequenceOptions: readonly RaceConsequenceOptionProjection[];
  readonly classOptions: readonly {
    readonly classCode: string;
    readonly label: string;
    readonly classConsequences: {
      readonly statModifiers: readonly { readonly statCode: string; readonly delta: number }[];
    };
    readonly mandatoryClassSkill: {
      readonly skillId: string;
      readonly skillLabel: string;
      readonly bonus: number;
      readonly slotCost: number;
    };
    readonly contextModifiers: readonly {
      readonly statCode: string;
      readonly delta: number;
      readonly socialTargetRace: 'PURE' | 'UNITED';
    }[];
  }[];
  readonly baseStats: JsonObject;
  readonly skillStageStatsOrNull: JsonObject | null;
  readonly requiredSkillSlots: number;
  readonly grantedSkillSlots: number;
  readonly skillOptions: readonly CorrectionSkillOption[];
  readonly selectedSkills: readonly { readonly skillKey: string; readonly targetBonus: number }[];
  readonly eligibleSymbiontSpecies: readonly CorrectionSpecies[];
  readonly acceptedSpecies: readonly {
    readonly acceptedIndex: number;
    readonly speciesKey: string;
    readonly speciesLabel: string;
  }[];
  readonly selectedBindings: readonly {
    readonly speciesKey: string;
    readonly side: 'LEFT' | 'RIGHT';
  }[];
  readonly slotCapacity: number;
  readonly lockedBindingSpecies: readonly string[];
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly pendingRollRequestIds: readonly string[];
  readonly nextRandomKindOrNull: string | null;
  readonly monsterChoiceRequired: boolean;
  readonly monsterChoiceEditable: boolean;
  readonly monsterOptions: readonly {
    readonly speciesKey: string;
    readonly speciesLabel: string;
  }[];
  readonly physicalRolls: readonly {
    readonly kind: string;
    readonly rollRequestId: string;
    readonly rollReceiptId: string;
    readonly rawFace: number;
    readonly dieSides: 20;
  }[];
  readonly advisorOrNull:
    | (JsonObject & {
        readonly advisorInstanceDraftId: string;
        readonly skillsConfirmed: boolean;
        readonly iwOrNull: JsonObject | null;
        readonly requiredSlotCount: number | null;
        readonly skillOptions: readonly CorrectionSkillOption[];
        readonly selectedSkills: readonly {
          readonly skillKey: string;
          readonly targetBonus: number;
        }[];
      })
    | null;
  readonly compositionHashOrNull: string | null;
  readonly interactionsConfirmed: boolean;
  readonly compositionConsequencesOrNull: JsonObject | null;
  readonly interactions: readonly JsonObject[];
  readonly nextFormId: 'CHR-025';
}
const nonnegative = (v: JsonValue | undefined) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: JsonValue | undefined) => typeof v === 'number' && Number.isFinite(v);
const bool = (v: JsonValue | undefined) => typeof v === 'boolean';
const hash = (v: JsonValue | undefined) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const mode = (v: JsonValue | undefined) => v === null || v === 'MANUAL' || v === 'RANDOM';
const object = (v: JsonValue | undefined, f: Parameters<typeof decodeProjection>[2]) =>
  isJsonObject(v) && decodeProjection(v, '$.field', f).ok;
const array = (v: JsonValue | undefined, f: (row: JsonValue) => boolean) =>
  Array.isArray(v) && v.every(f);
const selected = (v: JsonValue | undefined) =>
  array(v, (row) => object(row, { skillKey: isNonEmptyString, targetBonus: nonnegative }));
const options = (v: JsonValue | undefined) =>
  array(v, (row) =>
    object(row, {
      skillId: isNonEmptyString,
      skillLabel: creationValidationPublicText,
      bonusDomainScope: creationValidationPublicText,
      requirements: (v) =>
        array(v, (r) =>
          object(r, {
            statCode: (c) => ['S', 'D', 'M', 'Z', 'I', 'W', 'C'].includes(c as string),
            statLabel: creationValidationPublicText,
            minValue: finite,
          }),
        ),
      missingSkillPenalty: (v) =>
        object(v, { kind: (k) => k === 'NO_MISSING_SKILL_PENALTY' }) ||
        object(v, { kind: (k) => k === 'MISSING_SKILL_PENALTY', value: finite }),
      levelOptions: (levels) =>
        array(levels, (l) => object(l, { targetBonus: nonnegative, slotCost: nonnegative })),
    }),
  );
const stats = (v: JsonValue | undefined) =>
  object(v, Object.fromEntries(['S', 'D', 'M', 'Z', 'I', 'W', 'C'].map((c) => [c, finite])));
const identityArt = (v: JsonValue | undefined) =>
  v === null ||
  object(v, {
    kind: (k) => k === 'asset-key',
    assetKey: (key) =>
      typeof key === 'string' &&
      (LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS as readonly string[]).includes(key),
  }) ||
  object(v, {
    kind: (k) => k === 'local-file',
    mediaType: (type) => type === 'image/png' || type === 'image/jpeg',
    bytesBase64: isNonEmptyString,
  });
const composition = (v: JsonValue | undefined) =>
  object(v, {
    slotUsage: nonnegative,
    slotCapacity: nonnegative,
    instances: (i) =>
      array(i, (row) =>
        object(row, {
          speciesLabel: creationValidationPublicText,
          status: (s) => ['ACTIVE', 'SUPPRESSED', 'ABSORBED', 'DESTROYED'].includes(s as string),
          slotCost: nonnegative,
          currentOe: finite,
        }),
      ),
  });
function refused<T>(path: string, value: unknown): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: value as JsonValue } };
}
export function decodeCreationCorrectionProjection(
  value: unknown,
  path: string,
  formId: FormId,
): DecodeResult<CreationCorrectionProjection> {
  if (
    !isJsonObject(value) ||
    !CREATION_CORRECTION_FORMS.includes(formId as (typeof CREATION_CORRECTION_FORMS)[number])
  )
    return refused(path, value);
  const decoded = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    wizardCheckpointId: isNonEmptyString,
    draftRevision: nonnegative,
    commandId: isNonEmptyString,
    summaryReceiptIdOrNull: isNonEmptyString,
    correctionHeadHash: hash,
    branchCacheDigest: hash,
    finalSaveStatus: (v) => v === 'NOT_COMMITTED',
    correctionContext: (v) =>
      object(v, {
        originFormId: (x) => x === 'CHR-025',
        returnFormId: (x) => x === 'CHR-025',
        sourceFormId: (x) => x === formId,
        summaryReceiptId: (x) => x === value['summaryReceiptIdOrNull'],
        correctionHeadHash: (x) => x === value['correctionHeadHash'],
      }),
    identity: (v) =>
      object(v, {
        name: isNonEmptyString,
        age: nonnegative,
        sex: (x) => x === 'MALE' || x === 'FEMALE',
        massKg: finite,
        description: (x) => x === null || typeof x === 'string',
        artAssetKeyOrLocalFile: identityArt,
      }),
    raceChoice: (v) => v === 'PURE' || v === 'UNITED' || v === 'FREE',
    pureClassOrNull: (v) => v === null || ['SEEKER', 'STALKER', 'SOLDIER'].includes(v as string),
    lockedAcquisitionModeOrNull: mode,
    creationMode: mode,
    raceOptions: (v) =>
      array(v, (r) =>
        object(r, {
          raceCode: (c) => c === 'PURE' || c === 'UNITED' || c === 'FREE',
          label: creationValidationPublicText,
        }),
      ),
    raceConsequenceOptions: (v) =>
      v !== undefined && decodeRaceConsequenceOptions(v, '$.raceConsequenceOptions').ok,
    classOptions: (v) =>
      array(v, (r) =>
        object(r, {
          classCode: (c) => ['SEEKER', 'STALKER', 'SOLDIER'].includes(c as string),
          label: creationValidationPublicText,
          classConsequences: (v) =>
            object(v, {
              statModifiers: (v) =>
                array(v, (r) =>
                  object(r, {
                    statCode: (v) => ['S', 'D', 'M', 'Z', 'I', 'W', 'C'].includes(v as string),
                    delta: finite,
                  }),
                ),
            }),
          mandatoryClassSkill: (v) =>
            object(v, {
              skillId: isNonEmptyString,
              skillLabel: creationValidationPublicText,
              bonus: nonnegative,
              slotCost: nonnegative,
            }),
          contextModifiers: (v) =>
            array(v, (r) =>
              object(r, {
                statCode: (v) => ['S', 'D', 'M', 'Z', 'I', 'W', 'C'].includes(v as string),
                delta: finite,
                socialTargetRace: (v) => v === 'PURE' || v === 'UNITED',
              }),
            ),
        }),
      ),
    baseStats: stats,
    skillStageStatsOrNull: (v) => v === null || stats(v),
    requiredSkillSlots: nonnegative,
    grantedSkillSlots: nonnegative,
    skillOptions: options,
    selectedSkills: selected,
    eligibleSymbiontSpecies: (v) =>
      array(v, (s) =>
        object(s, {
          speciesKey: isSpeciesKey,
          speciesLabel: creationValidationPublicText,
          slotCost: nonnegative,
          bindingPolicy: (b) =>
            [
              'NONE',
              'OWL_EYE',
              'EEL_ARM',
              'TICK_RIGHT_HAND',
              'SPIDER_BOTH_WRISTS',
              'MANTIS_BOTH_FOREARMS',
            ].includes(b as string),
          kind: (k) => k === 'ORDINARY' || k === 'SYMBIOTIC_MONSTER',
        }),
      ),
    acceptedSpecies: (v) =>
      array(v, (s) =>
        object(s, {
          acceptedIndex: nonnegative,
          speciesKey: isSpeciesKey,
          speciesLabel: creationValidationPublicText,
        }),
      ),
    selectedBindings: (v) =>
      array(v, (s) =>
        object(s, {
          speciesKey: (k) => k === 'OWL' || k === 'EEL',
          side: (k) => k === 'LEFT' || k === 'RIGHT',
        }),
      ),
    slotCapacity: nonnegative,
    lockedBindingSpecies: (v) => array(v, (k) => k === 'OWL' || k === 'EEL'),
    diceInputModeSnapshot: (v) => v === 'AUTO' || v === 'MANUAL',
    pendingRollRequestIds: (v) => array(v, isNonEmptyString),
    nextRandomKindOrNull: (v) =>
      v === null ||
      [
        'SPECIES_ORIGIN',
        'CRITICAL_CONFIRMATION',
        'ADVISOR_I',
        'ADVISOR_W',
        'TROGR_SUPPRESSION_B',
        'BINDING',
        'COMMITTED',
      ].includes(v as string),
    monsterChoiceRequired: bool,
    monsterChoiceEditable: bool,
    monsterOptions: (v) =>
      array(v, (s) =>
        object(s, {
          speciesKey: (k) => ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'].includes(k as string),
          speciesLabel: creationValidationPublicText,
        }),
      ),
    physicalRolls: (v) =>
      array(v, (r) =>
        object(r, {
          kind: (k) =>
            [
              'SPECIES_ORIGIN',
              'CRITICAL_CONFIRMATION',
              'ADVISOR_I',
              'ADVISOR_W',
              'TROGR_SUPPRESSION_B',
            ].includes(k as string),
          rollRequestId: isNonEmptyString,
          rollReceiptId: isNonEmptyString,
          rawFace: isFace,
          dieSides: (d) => d === 20,
        }),
      ),
    advisorOrNull: (v) =>
      v === null ||
      object(v, {
        advisorInstanceDraftId: isNonEmptyString,
        skillsConfirmed: bool,
        iwOrNull: (iw) => iw === null || object(iw, { I: finite, W: finite }),
        requiredSlotCount: (n) => n === null || nonnegative(n),
        skillOptions: options,
        selectedSkills: selected,
      }),
    compositionHashOrNull: (v) => v === null || hash(v),
    interactionsConfirmed: bool,
    compositionConsequencesOrNull: (v) =>
      v === null ||
      object(v, {
        beforeOrNull: (b) => b === null || composition(b),
        after: composition,
        effectiveStatsBeforeOrNull: (s) => s === null || stats(s),
        effectiveStatsAfterOrNull: (s) => s === null || stats(s),
        permanentSkillsAfter: (s) =>
          array(s, (row) =>
            object(row, { skillLabel: creationValidationPublicText, bonus: nonnegative }),
          ),
      }),
    interactions: (v) =>
      array(v, (i) =>
        object(i, {
          kind: (k) =>
            [
              'ABSORPTION',
              'CURRENT_OE_DUEL',
              'SPECIES_SUPPRESSION',
              'ABILITY_SUPPRESSION',
            ].includes(k as string),
        }),
      ),
    nextFormId: (v) => v === 'CHR-025',
  });
  if (!decoded.ok) return decoded;
  const p = value as CreationCorrectionProjection;
  if (
    p.pendingRollRequestIds.length > 2 ||
    new Set(p.pendingRollRequestIds).size !== p.pendingRollRequestIds.length ||
    new Set(p.physicalRolls.map((r) => r.rollReceiptId)).size !== p.physicalRolls.length ||
    p.raceOptions.length !== 3 ||
    p.classOptions.length !== 3 ||
    new Set(p.raceOptions.map((r) => r.raceCode)).size !== 3 ||
    new Set(p.classOptions.map((r) => r.classCode)).size !== 3 ||
    new Set(p.eligibleSymbiontSpecies.map((s) => s.speciesKey)).size !==
      p.eligibleSymbiontSpecies.length ||
    new Set(p.acceptedSpecies.map((s) => s.speciesKey)).size !== p.acceptedSpecies.length ||
    p.acceptedSpecies.some(
      (s, index) =>
        s.acceptedIndex !== index ||
        !p.eligibleSymbiontSpecies.some(
          (eligible) =>
            eligible.speciesKey === s.speciesKey && eligible.speciesLabel === s.speciesLabel,
        ),
    ) ||
    new Set(p.selectedBindings.map((b) => b.speciesKey)).size !== p.selectedBindings.length ||
    p.selectedBindings.some((b) => !p.acceptedSpecies.some((s) => s.speciesKey === b.speciesKey)) ||
    p.lockedBindingSpecies.some((key) => !p.selectedBindings.some((b) => b.speciesKey === key))
  )
    return refused(path, value);
  return { ok: true, value: p };
}
function correctionActionKeys(p: CreationCorrectionProjection): readonly ActionKey[] {
  switch (p.correctionContext.sourceFormId) {
    case 'CHR-001':
      return ['CHR-001::CTA::001'];
    case 'CHR-009':
      return ['CHR-009::CTA::003'];
    case 'CHR-010':
      return ['CHR-010::CTA::001', 'CHR-010::CTA::002'];
    case 'CHR-011':
      return ['CHR-011::CTA::001'];
    case 'CHR-015':
      return ['CHR-015::CTA::001', 'CHR-015::CTA::003'];
    case 'CHR-017':
      return [
        ...(p.creationMode === 'MANUAL'
          ? ['CHR-017::CTA::001' as const, 'CHR-017::CTA::002' as const]
          : p.creationMode === 'RANDOM'
            ? ['CHR-017::CTA::003' as const]
            : []),
        'CHR-017::CTA::006',
      ];
    case 'CHR-018':
      return ['CHR-018::CTA::001', 'CHR-018::CTA::002', 'CHR-018::CTA::003'];
    case 'CHR-019':
      return [
        'CHR-019::CTA::004',
        ...(p.creationMode === 'MANUAL' &&
        !p.interactionsConfirmed &&
        p.compositionHashOrNull !== null
          ? ['CHR-019::CTA::002' as const]
          : []),
      ];
    case 'CHR-020':
      return [
        ...(p.pendingRollRequestIds.length === 1 || p.nextRandomKindOrNull === 'BINDING'
          ? ['CHR-020::CTA::002' as const]
          : []),
        ...(p.nextRandomKindOrNull === 'BINDING' ? ['CHR-020::CTA::003' as const] : []),
        ...(p.monsterChoiceRequired || p.monsterChoiceEditable
          ? ['CHR-020::CTA::004' as const]
          : []),
      ];
    case 'CHR-041':
      return p.pendingRollRequestIds.length === 2
        ? ['CHR-041::CTA::003']
        : p.pendingRollRequestIds.length === 1
          ? ['CHR-041::CTA::004']
          : p.advisorOrNull !== null && p.advisorOrNull.requiredSlotCount !== null
            ? ['CHR-041::CTA::001', 'CHR-041::CTA::002']
            : [];
    case 'CHR-042':
      return ['CHR-042::CTA::001', 'CHR-042::CTA::002'];
  }
}
export function expectedCreationCorrectionActionKeys(
  p: CreationCorrectionProjection,
  capabilities = { checkpoint: true, setDecide: true, rollCommit: true },
): readonly ActionKey[] {
  return correctionActionKeys(p).filter((action) =>
    ['CHR-001::CTA::001', 'CHR-015::CTA::001', 'CHR-018::CTA::001', 'CHR-041::CTA::001'].includes(
      action,
    )
      ? capabilities.checkpoint
      : [
            'CHR-010::CTA::001',
            'CHR-010::CTA::002',
            'CHR-011::CTA::001',
            'CHR-042::CTA::001',
          ].includes(action)
        ? capabilities.setDecide
        : [
              'CHR-020::CTA::002',
              'CHR-020::CTA::004',
              'CHR-041::CTA::003',
              'CHR-041::CTA::004',
            ].includes(action)
          ? capabilities.rollCommit
          : true,
  );
}
export const CORRECTION_COMMANDS = {
  CORRECTION_IDENTITY: ['CHR-001', 'CHR-001::CTA::001', 'UI-CMD-CHAR-WIZARD-CHECKPOINT'],
  CORRECTION_RACE: ['CHR-010', 'CHR-010::CTA::001', 'UI-CMD-CHAR-CREATION-SET-DECIDE'],
  CORRECTION_CLASS: ['CHR-011', 'CHR-011::CTA::001', 'UI-CMD-CHAR-CREATION-SET-DECIDE'],
  CORRECTION_SKILLS: ['CHR-015', 'CHR-015::CTA::001', 'UI-CMD-CHAR-WIZARD-CHECKPOINT'],
  CORRECTION_MANUAL_COMPOSITION: ['CHR-018', 'CHR-018::CTA::001', 'UI-CMD-CHAR-WIZARD-CHECKPOINT'],
  CORRECTION_RANDOM_ROLL: ['CHR-020', 'CHR-020::CTA::002', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT'],
  CORRECTION_RANDOM_BINDINGS: ['CHR-020', 'CHR-020::CTA::002', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT'],
  CORRECTION_MONSTER_CHOICE: ['CHR-020', 'CHR-020::CTA::004', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT'],
  CORRECTION_ADVISOR_IW: ['CHR-041', 'CHR-041::CTA::003', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT'],
  CORRECTION_ADVISOR_B: ['CHR-041', 'CHR-041::CTA::004', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT'],
  CORRECTION_ADVISOR_SKILLS: ['CHR-041', 'CHR-041::CTA::001', 'UI-CMD-CHAR-WIZARD-CHECKPOINT'],
  CORRECTION_INTERACTIONS: ['CHR-042', 'CHR-042::CTA::001', 'UI-CMD-CHAR-CREATION-SET-DECIDE'],
} as const;
export type CreationCorrectionVariant = keyof typeof CORRECTION_COMMANDS;
export function creationCorrectionPayload(
  p: CreationCorrectionProjection,
  variant: CreationCorrectionVariant,
  values: JsonObject,
): JsonObject {
  if (CORRECTION_COMMANDS[variant][0] !== p.correctionContext.sourceFormId)
    throw new Error('correction source form mismatch');
  const face = (v: JsonValue | undefined) =>
    p.diceInputModeSnapshot === 'AUTO' ? v === null : isFace(v);
  const bindings = (v: JsonValue | undefined) =>
    array(v, (row) =>
      object(row, {
        speciesKey: (key) =>
          p.acceptedSpecies.some((s) => s.speciesKey === key) && (key === 'OWL' || key === 'EEL'),
        side: (side) => side === 'LEFT' || side === 'RIGHT',
      }),
    );
  const identity = (v: JsonValue | undefined) =>
    object(v, {
      name: isNonEmptyString,
      age: nonnegative,
      sex: (sex) => sex === p.identity['sex'],
      massKg: finite,
      description: (d) => d === null || typeof d === 'string',
      artAssetKeyOrLocalFile: identityArt,
    });
  const shapes: Record<CreationCorrectionVariant, Parameters<typeof decodeProjection>[2]> = {
    CORRECTION_IDENTITY: { identity },
    CORRECTION_RACE: {
      raceChoice: (v) => p.raceOptions.some((r) => r.raceCode === v),
      acquisitionModeIfFirstOrNull: mode,
    },
    CORRECTION_CLASS: { pureClass: (v) => p.classOptions.some((c) => c.classCode === v) },
    CORRECTION_SKILLS: { selectedSkills: selected },
    CORRECTION_MANUAL_COMPOSITION: {
      acceptedSpecies: (v) =>
        array(v, (row) =>
          object(row, {
            acceptedIndex: nonnegative,
            speciesKey: (key) => p.eligibleSymbiontSpecies.some((s) => s.speciesKey === key),
          }),
        ),
      selectedBindings: (v) =>
        array(v, (row) =>
          object(row, {
            speciesKey: (key) => key === 'OWL' || key === 'EEL',
            side: (side) => side === 'LEFT' || side === 'RIGHT',
          }),
        ),
    },
    CORRECTION_RANDOM_ROLL: {
      pendingRollRequestId: (v) =>
        p.pendingRollRequestIds.length === 1 && v === p.pendingRollRequestIds[0],
      manualFaceOrNull: face,
      selectedMonsterSpeciesKeyOrNull: (v) =>
        p.monsterChoiceRequired ? p.monsterOptions.some((s) => s.speciesKey === v) : v === null,
    },
    CORRECTION_RANDOM_BINDINGS: { selectedBindings: bindings },
    CORRECTION_MONSTER_CHOICE: {
      selectedMonsterSpeciesKey: (v) =>
        p.monsterChoiceEditable && p.monsterOptions.some((s) => s.speciesKey === v),
    },
    CORRECTION_ADVISOR_IW: {
      pendingRollRequestIds: (v) =>
        JSON.stringify(v) === JSON.stringify(p.pendingRollRequestIds) &&
        p.pendingRollRequestIds.length === 2,
      manualFacesOrNull: (v) =>
        p.diceInputModeSnapshot === 'AUTO'
          ? v === null
          : Array.isArray(v) && v.length === 2 && v.every(isFace),
    },
    CORRECTION_ADVISOR_B: {
      pendingRollRequestId: (v) =>
        p.pendingRollRequestIds.length === 1 && v === p.pendingRollRequestIds[0],
      manualFaceOrNull: face,
    },
    CORRECTION_ADVISOR_SKILLS: { selectedSkills: selected },
    CORRECTION_INTERACTIONS: {
      compositionHash: (v) => v === p.compositionHashOrNull && v !== null,
    },
  };
  if (!decodeProjection(values, '$.correction', shapes[variant]).ok)
    throw new Error('correction values do not match the signed input contract');
  return {
    ...values,
    stage: 'FINALIZATION',
    variant,
    sourceFormId: p.correctionContext.sourceFormId,
    characterDraftId: p.characterDraftId,
    wizardCheckpointId: p.wizardCheckpointId,
    draftRevision: p.draftRevision,
    summaryReceiptId: p.correctionContext.summaryReceiptId,
    correctionHeadHash: p.correctionHeadHash,
  };
}
