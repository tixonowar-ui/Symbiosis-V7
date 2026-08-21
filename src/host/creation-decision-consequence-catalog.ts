import { join, resolve } from 'node:path';

import type { StatCode } from '@generated/types/character.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import {
  CREATION_STAT_METHODS,
  CREATION_STAT_SET_DECISION_RULES,
  deriveCreationStatAbandonment,
  type CreationStatMethod,
  type SkillStageCatalog,
} from '../domain/index.js';
import {
  RACE_CHOICES,
  SYMBIONT_ACQUISITION_MODES,
  type RaceChoice,
  type SymbiontAcquisitionMode,
} from './creation-set-decide.js';
import type { CreationSkillCatalog } from './creation-skill-catalog.js';
import { readJsonFile } from './json-source.js';

export type SymbiontXpPolicy = 'STANDARD_XP_AWARD' | 'XP_AWARD_X2';

export interface DecisionStatDelta extends JsonObject {
  readonly delta: number;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type DecisionStatModifierEffect =
  | Readonly<{ readonly kind: 'NO_STAT_MODIFIERS' }>
  | Readonly<{
      readonly entries: readonly DecisionStatDelta[];
      readonly kind: 'ADDITIVE_STAT_MODIFIERS';
    }>;

export interface ModeConsequences extends JsonObject {
  readonly baseSymbiontSlots: number;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly raceLabel: string;
  readonly statModifiers: DecisionStatModifierEffect;
}

export interface ModeConsequenceOption extends JsonObject {
  readonly modeConsequences: ModeConsequences;
  readonly symbiontAcquisitionMode: SymbiontAcquisitionMode;
}

export type ConditionalRaceStatModifiers =
  | Readonly<{ readonly kind: 'NOT_APPLICABLE' }>
  | Readonly<{
      readonly alternatives: readonly ModeConsequenceOption[];
      readonly kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE';
    }>;

export interface GrantedSkillPreview extends JsonObject {
  readonly skillId: CreationSkillCatalog['skillLabels'][number]['skillId'];
  readonly skillLabel: string;
}

export type GrantedSkillsPreview =
  | Readonly<{ readonly kind: 'NO_GRANTED_SKILLS' }>
  | Readonly<{
      readonly entries: readonly GrantedSkillPreview[];
      readonly kind: 'GRANTED_SKILLS';
    }>;

export interface RaceConsequencesPreview extends JsonObject {
  readonly allocationXpMultiplier: number;
  readonly baseSymbiontSlots: number;
  readonly classPolicy: 'NO_CLASS' | 'REQUIRED_PURE_CLASS';
  readonly directXpMultiplier: number;
  readonly grantedSkills: GrantedSkillsPreview;
  readonly raceLabel: string;
  readonly raceStatModifiersByAcquisitionMode: ConditionalRaceStatModifiers;
  readonly symbiontXpPolicy: SymbiontXpPolicy;
  readonly symbioticMonsterAllowed: boolean;
}

export interface RaceConsequenceOption extends JsonObject {
  readonly raceChoice: RaceChoice;
  readonly raceConsequencesPreview: RaceConsequencesPreview;
}

export interface RejectedSetConsequences extends JsonObject {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly irreversible: true;
  readonly setValuesDiscarded: true;
}

export type MethodTerminalRule =
  | Readonly<{
      readonly afterAttempt: number;
      readonly exactTotal: number;
      readonly kind: 'POINT_BUY_AFTER_REJECTION';
    }>
  | Readonly<{
      readonly attemptIndex: number;
      readonly kind: 'MANDATORY_ACCEPT';
    }>;

export interface MethodConsequences extends JsonObject {
  readonly maximumAttempts: number;
  readonly rejectedSet: RejectedSetConsequences;
  readonly terminalRule: MethodTerminalRule;
}

export interface MethodConsequenceOption extends JsonObject {
  readonly methodConsequences: MethodConsequences;
  readonly statMethod: CreationStatMethod;
}

export interface CreationDecisionConsequenceCatalog {
  readonly methodConsequenceOptions: readonly MethodConsequenceOption[];
  readonly modeConsequenceOptionsByRace: Readonly<
    Record<'FREE' | 'UNITED', readonly ModeConsequenceOption[]>
  >;
  readonly raceConsequenceOptions: readonly RaceConsequenceOption[];
}

export interface CreationDecisionConsequenceSources {
  readonly races: unknown;
  readonly stats: unknown;
}

type Row = Record<string, unknown>;

export class CreationDecisionConsequenceCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function fail(path: string, detail: string): never {
  throw new CreationDecisionConsequenceCatalogError(`${path}: ${detail}`);
}

function rows(value: unknown, path: string, expected: number): Row[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length !== expected) {
    fail(path, `expected ${String(expected)} rows, got ${String(value.length)}`);
  }
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${path}[${String(index)}]`, 'expected an object');
    }
    return entry as Row;
  });
}

function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path}.${key}`, 'expected a non-empty string');
  }
  return value;
}

function integer(row: Row, key: string, path: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(`${path}.${key}`, 'expected a safe integer');
  }
  return value;
}

function nonNegativeInteger(row: Row, key: string, path: string): number {
  const value = integer(row, key, path);
  if (value < 0) fail(`${path}.${key}`, 'expected a non-negative safe integer');
  return value;
}

function positiveInteger(row: Row, key: string, path: string): number {
  const value = integer(row, key, path);
  if (value <= 0) fail(`${path}.${key}`, 'expected a positive safe integer');
  return value;
}

function boolean(row: Row, key: string, path: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') fail(`${path}.${key}`, 'expected a boolean');
  return value;
}

function literal<T extends string>(row: Row, key: string, allowed: readonly T[], path: string): T {
  const value = text(row, key, path);
  if (!(allowed as readonly string[]).includes(value)) {
    fail(
      `${path}.${key}`,
      `unrecognized ${JSON.stringify(value)}; expected: ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

function uniqueBy<T>(values: readonly T[], path: string, key: (value: T) => string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const current = key(value);
    if (seen.has(current)) fail(path, `duplicate ${JSON.stringify(current)}`);
    seen.add(current);
  }
}

function optionalTextReferences(row: Row, key: string, path: string): readonly string[] {
  if (!Object.hasOwn(row, key)) return Object.freeze([]);
  const references = text(row, key, path)
    .split(';')
    .map((value) => value.trim());
  if (references.some((value) => value.length === 0)) {
    fail(`${path}.${key}`, 'expected non-empty semicolon-delimited references');
  }
  uniqueBy(references, `${path}.${key}`, (value) => value);
  return Object.freeze(references);
}

function freezeModifierEffect(entries: readonly DecisionStatDelta[]): DecisionStatModifierEffect {
  return entries.length === 0
    ? Object.freeze({ kind: 'NO_STAT_MODIFIERS' })
    : Object.freeze({
        entries: Object.freeze(entries),
        kind: 'ADDITIVE_STAT_MODIFIERS',
      });
}

/**
 * Builds the issue #127 preview plus the exact issue #131 GrantedSkillRefs
 * extension. Validated catalogs remain authoritative for joins and intentional
 * empty rows; other race facts stay outside the player allowlist.
 */
export function createCreationDecisionConsequenceCatalog(
  sources: CreationDecisionConsequenceSources,
  skillStageCatalog: SkillStageCatalog,
  creationSkillCatalog: CreationSkillCatalog,
): CreationDecisionConsequenceCatalog {
  // Source-owned cardinalities: stats.json has seven rows and races.json has three.
  const statRows = rows(sources.stats, 'decision consequences stats', 7);
  const raceRows = rows(sources.races, 'decision consequences races', 3);

  const stats = statRows
    .map((row, index) => {
      const path = `decision consequences stats[${String(index)}]`;
      return Object.freeze({
        order: positiveInteger(row, 'Порядок', path),
        statCode: text(row, 'StatCode', path) as StatCode,
        statLabel: text(row, 'Название', path),
      });
    })
    .sort((left, right) => left.order - right.order);
  uniqueBy(stats, 'decision consequences stats.StatCode', ({ statCode }) => statCode);
  const catalogStatCodes = skillStageCatalog.stats.map(({ statCode }) => statCode);
  const sourceStatCodes = stats.map(({ statCode }) => statCode);
  if (JSON.stringify(sourceStatCodes) !== JSON.stringify(catalogStatCodes)) {
    fail(
      'decision consequences stats.StatCode',
      `expected validated catalog order ${catalogStatCodes.join(', ')}, got ${sourceStatCodes.join(', ')}`,
    );
  }
  stats.forEach(({ order }, index) => {
    if (order !== index + 1) {
      fail(
        `decision consequences stats[${String(index)}].Порядок`,
        `expected ${String(index + 1)}, got ${String(order)}`,
      );
    }
  });
  const statByCode = new Map(stats.map((stat) => [stat.statCode, stat]));
  const statOrder = new Map(stats.map((stat, index) => [stat.statCode, index]));

  if (creationSkillCatalog.skillLabels.length !== skillStageCatalog.skills.length) {
    fail('decision consequences skill labels', 'row count disagrees with validated catalog');
  }
  const skillLabelById = new Map(
    creationSkillCatalog.skillLabels.map((skill, index) => {
      const validated = skillStageCatalog.skills[index];
      if (
        validated === undefined ||
        skill.skillId !== validated.skillKey ||
        typeof skill.skillLabel !== 'string' ||
        skill.skillLabel.trim().length === 0
      ) {
        fail(
          `decision consequences skill labels[${String(index)}]`,
          'identity/order/label disagrees with validated catalog',
        );
      }
      return [skill.skillId, skill.skillLabel] as const;
    }),
  );
  if (skillLabelById.size !== creationSkillCatalog.skillLabels.length) {
    fail('decision consequences skill labels.SkillKey', 'contains duplicates');
  }

  const races = raceRows.map((row, index) => {
    const path = `decision consequences races[${String(index)}]`;
    const raceCode = literal(row, 'RaceCode', RACE_CHOICES, path);
    const validated = skillStageCatalog.races.find((race) => race.raceCode === raceCode);
    if (validated === undefined) fail(`${path}.RaceCode`, 'missing from validated catalog');
    const baseSymbiontSlots = nonNegativeInteger(row, 'BaseSymbiontSlots', path);
    const classPolicy = literal(
      row,
      'ClassPolicy',
      ['REQUIRED_PURE_CLASS', 'NO_CLASS'] as const,
      path,
    );
    if (
      validated.baseSymbiontSlots !== baseSymbiontSlots ||
      validated.classPolicy !== classPolicy
    ) {
      fail(path, 'race facts disagree with the validated skill-stage catalog');
    }
    const sourceGrantedSkillRefs = optionalTextReferences(row, 'GrantedSkillRefs', path);
    const validatedGrantedSkillRefs = validated.grantedSkillRefs.map((skillKey) => skillKey);
    if (JSON.stringify(sourceGrantedSkillRefs) !== JSON.stringify(validatedGrantedSkillRefs)) {
      fail(
        `${path}.GrantedSkillRefs`,
        'references/order disagree with the validated skill-stage catalog',
      );
    }
    const grantedSkillEntries = sourceGrantedSkillRefs.map((skillId): GrantedSkillPreview => {
      const skill = skillStageCatalog.skills.find((candidate) => candidate.skillKey === skillId);
      if (
        skill === undefined ||
        skill.category !== 'FIXED_RACE_PASSIVE' ||
        skill.slotCostMode !== 'FIXED_0' ||
        typeof skill.maxBonus !== 'number'
      ) {
        fail(`${path}.GrantedSkillRefs`, `invalid race-granted skill ${JSON.stringify(skillId)}`);
      }
      const skillLabel = skillLabelById.get(skill.skillKey);
      if (skillLabel === undefined) {
        fail(`${path}.GrantedSkillRefs`, `missing player label for ${JSON.stringify(skillId)}`);
      }
      return Object.freeze({ skillId: skill.skillKey, skillLabel });
    });
    const grantedSkills: GrantedSkillsPreview =
      grantedSkillEntries.length === 0
        ? Object.freeze({ kind: 'NO_GRANTED_SKILLS' })
        : Object.freeze({
            entries: Object.freeze(grantedSkillEntries),
            kind: 'GRANTED_SKILLS',
          });
    return Object.freeze({
      allocationXpMultiplier: positiveInteger(row, 'AllocationXPMultiplier', path),
      baseSymbiontSlots,
      classPolicy,
      directXpMultiplier: positiveInteger(row, 'DirectXPMultiplier', path),
      grantedSkills,
      raceChoice: raceCode,
      raceLabel: text(row, 'Название', path),
      symbiontXpPolicy: literal(
        row,
        'SymbiontXPPolicy',
        ['STANDARD_XP_AWARD', 'XP_AWARD_X2'] as const,
        path,
      ),
      symbioticMonsterAllowed: boolean(row, 'SymbioticMonsterAllowed', path),
    });
  });
  uniqueBy(races, 'decision consequences races.RaceCode', ({ raceChoice }) => raceChoice);
  for (const raceChoice of RACE_CHOICES) {
    if (!races.some((race) => race.raceChoice === raceChoice)) {
      fail('decision consequences races.RaceCode', `missing ${raceChoice}`);
    }
  }

  const raceByCode = new Map(races.map((race) => [race.raceChoice, race]));
  const modeOptions = (raceChoice: 'FREE' | 'UNITED'): readonly ModeConsequenceOption[] => {
    const race = raceByCode.get(raceChoice);
    if (race === undefined) fail('decision consequences races', `missing ${raceChoice}`);
    return Object.freeze(
      SYMBIONT_ACQUISITION_MODES.map((symbiontAcquisitionMode) => {
        const contextPredicate = `creationMode=${symbiontAcquisitionMode}`;
        const modifiers = skillStageCatalog.modifiers
          .filter(
            (modifier) =>
              modifier.sourceType === 'RACE' &&
              modifier.sourceId === raceChoice &&
              modifier.applicationStage === 'SKILL_STAGE' &&
              modifier.contextPredicate === contextPredicate,
          )
          .sort(
            (left, right) =>
              (statOrder.get(left.targetCode) ?? Number.MAX_SAFE_INTEGER) -
              (statOrder.get(right.targetCode) ?? Number.MAX_SAFE_INTEGER),
          )
          .map((modifier): DecisionStatDelta => {
            const stat = statByCode.get(modifier.targetCode);
            if (stat === undefined) {
              fail('decision consequences modifiers.TargetCode', `unknown ${modifier.targetCode}`);
            }
            return Object.freeze({
              delta: modifier.value,
              statCode: modifier.targetCode,
              statLabel: stat.statLabel,
            });
          });
        uniqueBy(
          modifiers,
          `decision consequences ${raceChoice}/${symbiontAcquisitionMode} StatCode`,
          ({ statCode }) => statCode,
        );
        return Object.freeze({
          modeConsequences: Object.freeze({
            baseSymbiontSlots: race.baseSymbiontSlots,
            raceChoice,
            raceLabel: race.raceLabel,
            statModifiers: freezeModifierEffect(modifiers),
          }),
          symbiontAcquisitionMode,
        });
      }),
    );
  };

  const modeConsequenceOptionsByRace = Object.freeze({
    FREE: modeOptions('FREE'),
    UNITED: modeOptions('UNITED'),
  });
  const raceConsequenceOptions = Object.freeze(
    RACE_CHOICES.map((raceChoice): RaceConsequenceOption => {
      const race = raceByCode.get(raceChoice);
      if (race === undefined) fail('decision consequences races', `missing ${raceChoice}`);
      const raceStatModifiersByAcquisitionMode: ConditionalRaceStatModifiers =
        raceChoice === 'PURE'
          ? Object.freeze({ kind: 'NOT_APPLICABLE' })
          : Object.freeze({
              alternatives: modeConsequenceOptionsByRace[raceChoice],
              kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
            });
      return Object.freeze({
        raceChoice,
        raceConsequencesPreview: Object.freeze({
          allocationXpMultiplier: race.allocationXpMultiplier,
          baseSymbiontSlots: race.baseSymbiontSlots,
          classPolicy: race.classPolicy,
          directXpMultiplier: race.directXpMultiplier,
          grantedSkills: race.grantedSkills,
          raceLabel: race.raceLabel,
          raceStatModifiersByAcquisitionMode,
          symbiontXpPolicy: race.symbiontXpPolicy,
          symbioticMonsterAllowed: race.symbioticMonsterAllowed,
        }),
      });
    }),
  );

  const methodConsequenceOptions = Object.freeze(
    CREATION_STAT_METHODS.map((statMethod): MethodConsequenceOption => {
      const rules = CREATION_STAT_SET_DECISION_RULES.filter(
        (rule) => rule.statMethod === statMethod,
      ).sort((left, right) => left.attemptIndex - right.attemptIndex);
      if (rules.length === 0) fail(`decision consequences ${statMethod}`, 'missing rules');
      const maximumAttempts = rules[0]!.maximumAttempts;
      if (
        rules.length !== maximumAttempts ||
        rules.some(
          (rule, index) =>
            rule.maximumAttempts !== maximumAttempts || rule.attemptIndex !== index + 1,
        )
      ) {
        fail(`decision consequences ${statMethod}`, 'attempt rows are not complete and contiguous');
      }
      for (const rule of rules) {
        if (rule.fifthAttemptMandatoryAccept) continue;
        const abandonment = deriveCreationStatAbandonment(statMethod, rule.attemptIndex);
        if (
          !abandonment.consequences.setValuesDiscarded ||
          !abandonment.consequences.creationCriticalConsequencesDiscarded
        ) {
          fail(
            `decision consequences ${statMethod}/${String(rule.attemptIndex)}`,
            'rejected-set discard facts disagree with the domain derivation',
          );
        }
      }
      const finalRule = rules.at(-1)!;
      const terminalRule: MethodTerminalRule = finalRule.fifthAttemptMandatoryAccept
        ? Object.freeze({
            attemptIndex: finalRule.attemptIndex,
            kind: 'MANDATORY_ACCEPT',
          })
        : (() => {
            const abandonment = deriveCreationStatAbandonment(statMethod, finalRule.attemptIndex);
            const exactTotal = abandonment.consequences.exactPointBuyTotalOrNull;
            if (exactTotal === null) {
              fail(
                `decision consequences ${statMethod}/${String(finalRule.attemptIndex)}`,
                'terminal rejection must derive point-buy',
              );
            }
            return Object.freeze({
              afterAttempt: finalRule.attemptIndex,
              exactTotal,
              kind: 'POINT_BUY_AFTER_REJECTION',
            });
          })();
      return Object.freeze({
        methodConsequences: Object.freeze({
          maximumAttempts,
          rejectedSet: Object.freeze({
            creationCriticalConsequencesDiscarded: true,
            irreversible: true,
            setValuesDiscarded: true,
          }),
          terminalRule,
        }),
        statMethod,
      });
    }),
  );

  return Object.freeze({
    methodConsequenceOptions,
    modeConsequenceOptionsByRace,
    raceConsequenceOptions,
  });
}

/** Loads only the two extra source tables needed by the sanitized player preview. */
export async function loadCreationDecisionConsequenceCatalog(
  projectRoot: string,
  skillStageCatalog: SkillStageCatalog,
  creationSkillCatalog: CreationSkillCatalog,
): Promise<CreationDecisionConsequenceCatalog> {
  const root = join(resolve(projectRoot), 'generated', 'spec', 'character');
  const [races, stats] = await Promise.all([
    readJsonFile(join(root, 'races.json'), 'creation decision consequence catalog'),
    readJsonFile(join(root, 'stats.json'), 'creation decision consequence catalog'),
  ]);
  return createCreationDecisionConsequenceCatalog(
    { races, stats },
    skillStageCatalog,
    creationSkillCatalog,
  );
}
