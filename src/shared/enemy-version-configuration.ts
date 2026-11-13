import type { EnemyAuthoringAttempt, EnemyVersionIdentity } from './enemy-authoring.js';
import { enemyAuthoringContextValue, enemyVersionIdentityValue } from './enemy-authoring.js';
import { enemyInitialSkillInputValue, type EnemyInitialSkillInput } from './enemy-skill-plan.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import type { JsonValue, RevisionVector } from './wire-protocol.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';
import {
  enemyVersionMandatoryFactsValue,
  type EnemyVersionMandatoryFacts,
} from './enemy-version-facts.js';

/** Issued by the owning ENM-001 NAV, never inferred from a candidate's own fields. */
export interface EnemyVersionOrigin {
  readonly schemaVersion: 1;
  readonly navigationRequestId: string;
  readonly base: EnemyVersionIdentity;
  readonly expectedRevisions: RevisionVector;
}
export interface EnemyVersionOwnSkillChoice {
  readonly skillKey: string;
  readonly targetBonus: number;
}
/** ADR0094: CUSTOM has an own personality, but no host START/race/class/skill input. */
export type EnemyVersionConfigurationInput =
  | Readonly<{
      kind: 'SENTIENT';
      initialInput: EnemyInitialSkillInput;
      advisorSkills: readonly EnemyVersionOwnSkillChoice[];
    }>
  | Readonly<{
      kind: 'CUSTOM_MONSTER';
      advisorSkills: readonly EnemyVersionOwnSkillChoice[];
    }>;
export type EnemyVersionReplacementSummary = Readonly<{
  advisorOwnChoices: readonly Readonly<{
    skillKey: string;
    name: string;
    targetBonus: number;
    slotCost: number;
  }>[];
}> &
  (
    | Readonly<{ kind: 'CUSTOM_MONSTER' }>
    | Readonly<{
        kind: 'SENTIENT';
        statsBeforeComposition: Readonly<Record<'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C', number>>;
        startCapacity: number;
        initialSkills: readonly Readonly<{
          skillKey: string;
          name: string;
          bonus: number;
          slotCost: number;
          source: string;
        }>[];
      }>
  );
export function enemyVersionReplacementSummaryValue(
  value: unknown,
  input: EnemyVersionConfigurationInput,
): EnemyVersionReplacementSummary {
  const summary = r.exact(
    value,
    'kind advisorOwnChoices' +
      (input.kind === 'SENTIENT' ? ' statsBeforeComposition startCapacity initialSkills' : ''),
    '$.replacementSummary',
  );
  w.literal(summary['kind'], input.kind, '$.replacementSummary.kind');
  const choices = r.list(summary['advisorOwnChoices'], '$.advisorOwnChoices');
  if (choices.length !== input.advisorSkills.length)
    r.invalid('$.advisorOwnChoices', 'exact requested own choices', null);
  for (const [index, value] of choices.entries()) {
    const choice = r.exact(value, 'skillKey name targetBonus slotCost', '$.advisorOwnChoice');
    const requested = input.advisorSkills[index];
    if (
      requested === undefined ||
      choice['skillKey'] !== requested.skillKey ||
      choice['targetBonus'] !== requested.targetBonus
    )
      r.invalid('$.advisorOwnChoice', 'exact requested choice', null);
    r.text(choice['name'], '$.name');
    r.integer(choice['slotCost'], '$.slotCost', 1);
  }
  if (input.kind === 'SENTIENT') {
    const stats = r.exact(
      summary['statsBeforeComposition'],
      'S D M Z I W C',
      '$.statsBeforeComposition',
    );
    for (const key of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
      r.integer(stats[key], '$.statsBeforeComposition.' + key, Number.MIN_SAFE_INTEGER);
    r.integer(summary['startCapacity'], '$.startCapacity', 0);
    const seen = new Set<string>();
    for (const value of r.list(summary['initialSkills'], '$.initialSkills')) {
      const skill = r.exact(value, 'skillKey name bonus slotCost source', '$.initialSkill');
      const key = r.text(skill['skillKey'], '$.skillKey');
      if (seen.has(key)) r.invalid('$.initialSkills', 'distinct initial skills', null);
      seen.add(key);
      r.text(skill['name'], '$.name');
      r.integer(skill['bonus'], '$.bonus', 0);
      r.integer(skill['slotCost'], '$.slotCost', 0);
      r.oneOf(skill['source'], ['SELECTED', 'RACE_GRANTED', 'CLASS_MANDATORY'], '$.source');
    }
  }
  return w.validated(structuredClone(summary));
}

/** A JSON pointer plus actual before/after values; missing is distinct from explicit null. */
export interface EnemyVersionDiffEntry {
  readonly path: string;
  readonly before: Readonly<{ present: false }> | Readonly<{ present: true; value: JsonValue }>;
  readonly after: Readonly<{ present: false }> | Readonly<{ present: true; value: JsonValue }>;
}
export interface EnemyVersionReplacementPreview {
  readonly schemaVersion: 1;
  readonly previewCommandId: string;
  readonly attemptId: string;
  readonly sourceAttemptRevision: number;
  readonly origin: EnemyVersionOrigin;
  readonly input: EnemyVersionConfigurationInput;
  readonly inputSummary: EnemyVersionReplacementSummary;
  /** Includes the actual paid skills/losses and own-card choices shown before consent. */
  readonly before: EnemyAuthoringAttempt;
  readonly invalidateComposition: true;
  readonly invalidateInventory: boolean;
}
/** Technical editing metadata; absent from delivered V1 contexts and immutable old attempts. */
export interface EnemyVersionAttemptContext {
  readonly schemaVersion: 1;
  readonly origin: EnemyVersionOrigin;
  readonly reason: string;
  readonly retainedMandatoryFacts: EnemyVersionMandatoryFacts;
  readonly unconfiguredAdvisorCardIdOrNull?: string | null;
  readonly replacementPreviewOrNull: EnemyVersionReplacementPreview | null;
  readonly configurationConfirmation?: Readonly<{
    commandId: string;
    input: EnemyVersionConfigurationInput;
  }>;
  readonly ownChoicesPending?: true;
}
export type EnemyVersionConfigurationPatch =
  | Readonly<{ operation: 'SET_REASON'; reason: string }>
  | Readonly<{ operation: 'PREVIEW_REPLACEMENT'; input: EnemyVersionConfigurationInput }>
  | Readonly<{ operation: 'DISCARD_REPLACEMENT'; previewCommandId: string }>
  | Readonly<{
      operation: 'CONFIRM_REPLACEMENT';
      previewCommandId: string;
      input: EnemyVersionConfigurationInput;
      displayedPreview: EnemyVersionReplacementPreview;
      consent: true;
    }>;
export interface PreparedEnemyVersionConfiguration {
  readonly attempt: EnemyAuthoringAttempt;
  readonly state: EnemyVersionAttemptContext;
}

export function enemyVersionConfigurationPatchValue(
  value: unknown,
): EnemyVersionConfigurationPatch {
  const raw = r.record(value, '$.versionPatch');
  const operation = r.oneOf(
    raw['operation'],
    ['SET_REASON', 'PREVIEW_REPLACEMENT', 'DISCARD_REPLACEMENT', 'CONFIRM_REPLACEMENT'],
    '$.versionPatch.operation',
  );
  const fields = {
    SET_REASON: 'operation reason',
    PREVIEW_REPLACEMENT: 'operation input',
    DISCARD_REPLACEMENT: 'operation previewCommandId',
    CONFIRM_REPLACEMENT: 'operation previewCommandId input displayedPreview consent',
  }[operation];
  const row = r.exact(value, fields, '$.versionPatch');
  if (operation === 'SET_REASON') r.raw(row['reason'], '$.versionPatch.reason');
  if (operation === 'PREVIEW_REPLACEMENT' || operation === 'CONFIRM_REPLACEMENT')
    enemyVersionConfigurationInputValue(row['input']);
  if (operation === 'DISCARD_REPLACEMENT' || operation === 'CONFIRM_REPLACEMENT')
    r.uuid(row['previewCommandId'], '$.versionPatch.previewCommandId');
  if (operation === 'CONFIRM_REPLACEMENT') {
    const preview = enemyVersionReplacementPreviewValue(row['displayedPreview']);
    if (
      preview.previewCommandId !== row['previewCommandId'] ||
      !admissionJsonEqual(preview.input, row['input'])
    )
      r.invalid('$.versionPatch', 'exact displayed preview and input', null);
    w.literal(row['consent'], true, '$.consent');
  }
  return w.validated(structuredClone(row));
}

export function preparedEnemyVersionConfigurationValue(
  value: unknown,
): PreparedEnemyVersionConfiguration {
  const row = r.exact(value, 'attempt state', '$.preparedVersionConfiguration');
  enemyAuthoringContextValue({
    attemptOrNull: row['attempt'],
    selectedVersionOrNull: null,
    versionAttempt: row['state'],
  });
  return w.validated(structuredClone(row));
}

export function enemyVersionAttemptContextValue(value: unknown): EnemyVersionAttemptContext {
  const raw = r.record(value, '$.versionAttempt');
  const facts = enemyVersionMandatoryFactsValue(raw['retainedMandatoryFacts']);
  const row = r.exact(
    value,
    'schemaVersion origin reason retainedMandatoryFacts replacementPreviewOrNull' +
      (facts.kind === 'CUSTOM_MONSTER' ? ' unconfiguredAdvisorCardIdOrNull' : '') +
      (Object.hasOwn(raw, 'configurationConfirmation') ? ' configurationConfirmation' : '') +
      (Object.hasOwn(raw, 'ownChoicesPending') ? ' ownChoicesPending' : ''),
    '$.versionAttempt',
  );
  w.literal(row['schemaVersion'], 1, '$.versionAttempt.schemaVersion');
  const origin = enemyVersionOriginValue(row['origin']);
  if (facts.kind !== origin.base.kind)
    r.invalid('$.retainedMandatoryFacts', 'own template kind', null);
  if (facts.kind === 'CUSTOM_MONSTER' && row['unconfiguredAdvisorCardIdOrNull'] !== null) {
    const id = r.uuid(row['unconfiguredAdvisorCardIdOrNull'], '$.unconfiguredAdvisorCardIdOrNull');
    // A card acquired after NAV can first occur in the current attempt, not its opening snapshot.
    if (facts.advisorCards.length !== 0 && !facts.advisorCards.some((card) => card.cardId === id))
      r.invalid('$.unconfiguredAdvisorCardIdOrNull', 'own historical or newly acquired card', null);
  }
  r.raw(row['reason'], '$.versionAttempt.reason');
  if (row['replacementPreviewOrNull'] !== null) {
    const preview = enemyVersionReplacementPreviewValue(row['replacementPreviewOrNull']);
    if (!admissionJsonEqual(preview.origin, origin))
      r.invalid('$.replacementPreview', 'own original version NAV', null);
  }
  if (Object.hasOwn(row, 'configurationConfirmation')) {
    const confirmation = r.exact(
      row['configurationConfirmation'],
      'commandId input',
      '$.configurationConfirmation',
    );
    r.uuid(confirmation['commandId'], '$.configurationConfirmation.commandId');
    if (enemyVersionConfigurationInputValue(confirmation['input']).kind !== origin.base.kind)
      r.invalid('$.configurationConfirmation', 'own kind input', null);
  }
  if (Object.hasOwn(row, 'ownChoicesPending')) {
    w.literal(row['ownChoicesPending'], true, '$.ownChoicesPending');
    if (!Object.hasOwn(row, 'configurationConfirmation'))
      r.invalid('$.ownChoicesPending', 'actual explicit configuration confirmation', null);
  }
  return w.validated(structuredClone(row));
}

export function enemyVersionOriginValue(value: unknown): EnemyVersionOrigin {
  const row = r.exact(
    value,
    'schemaVersion navigationRequestId base expectedRevisions',
    '$.origin',
  );
  w.literal(row['schemaVersion'], 1, '$.origin.schemaVersion');
  r.uuid(row['navigationRequestId'], '$.origin.navigationRequestId');
  enemyVersionIdentityValue(row['base']);
  const revisions = r.exact(
    row['expectedRevisions'],
    'stateRevision projectionRevision actorVisibilityRevision',
    '$.origin.expectedRevisions',
  );
  for (const key of Object.keys(revisions)) r.integer(revisions[key], '$.origin.' + key, 0);
  return w.validated(structuredClone(row));
}

export function enemyVersionConfigurationInputValue(
  value: unknown,
): EnemyVersionConfigurationInput {
  const raw = r.record(value, '$.configurationInput');
  const kind = r.oneOf(raw['kind'], ['SENTIENT', 'CUSTOM_MONSTER'], '$.configurationInput.kind');
  const row = r.exact(
    value,
    'kind advisorSkills' + (kind === 'SENTIENT' ? ' initialInput' : ''),
    '$.configurationInput',
  );
  if (kind === 'SENTIENT') enemyInitialSkillInputValue(row['initialInput']);
  const choices = r.list(row['advisorSkills'], '$.configurationInput.advisorSkills');
  const keys = new Set<string>();
  for (const raw of choices) {
    const skill = r.exact(raw, 'skillKey targetBonus', '$.ownSkill');
    const key = r.text(skill['skillKey'], '$.ownSkill.skillKey');
    if (keys.has(key)) r.invalid('$.advisorSkills', 'distinct own-card choices', null);
    keys.add(key);
    r.integer(skill['targetBonus'], '$.ownSkill.targetBonus', 1);
  }
  return w.validated(structuredClone(row));
}

export function enemyVersionReplacementPreviewValue(
  value: unknown,
): EnemyVersionReplacementPreview {
  const row = r.exact(
    value,
    'schemaVersion previewCommandId attemptId sourceAttemptRevision origin input inputSummary before invalidateComposition invalidateInventory',
    '$.replacementPreview',
  );
  w.literal(row['schemaVersion'], 1, '$.replacementPreview.schemaVersion');
  for (const key of ['previewCommandId', 'attemptId']) r.uuid(row[key], '$.' + key);
  r.integer(row['sourceAttemptRevision'], '$.sourceAttemptRevision', 0);
  const origin = enemyVersionOriginValue(row['origin']);
  const input = enemyVersionConfigurationInputValue(row['input']);
  enemyVersionReplacementSummaryValue(row['inputSummary'], input);
  const before = enemyAuthoringContextValue({
    attemptOrNull: row['before'],
    selectedVersionOrNull: null,
  }).attemptOrNull;
  if (
    before === null ||
    before.attemptId !== row['attemptId'] ||
    before.revision !== row['sourceAttemptRevision'] ||
    before.campaignId !== origin.base.campaignId ||
    before.kind !== origin.base.kind ||
    input.kind !== before.kind
  )
    r.invalid('$.replacementPreview', 'same owning attempt, kind, campaign and revision', null);
  w.literal(row['invalidateComposition'], true, '$.invalidateComposition');
  w.literal(row['invalidateInventory'], input.kind === 'SENTIENT', '$.invalidateInventory');
  return w.validated(structuredClone(row));
}

export function enemyVersionDiffValue(value: unknown): readonly EnemyVersionDiffEntry[] {
  const entries = r.list(value, '$.diff');
  const paths = new Set<string>();
  for (const raw of entries) {
    const row = r.exact(raw, 'path before after', '$.diffEntry');
    const path = r.raw(row['path'], '$.diffEntry.path');
    if (!/^(?:\/(?:[^~]|~[01])*)*$/u.test(path) || paths.has(path))
      r.invalid('$.diffEntry.path', 'unique JSON pointer', null);
    paths.add(path);
    for (const key of ['before', 'after']) {
      const rawSide = r.record(row[key], '$.diffEntry.' + key);
      if (rawSide['present'] === false) r.exact(rawSide, 'present', '$.diffSide');
      else {
        const side = r.exact(rawSide, 'present value', '$.diffSide');
        w.literal(side['present'], true, '$.diffSide.present');
        enemyVersionDiffDataValue(side['value']);
      }
    }
    if (admissionJsonEqual(row['before'], row['after']))
      r.invalid('$.diffEntry', 'actual value/presence change', null);
  }
  return w.validated(structuredClone(entries));
}

/** Data-only values: a diff must never invoke a getter while preparing irreversible consent. */
export function enemyVersionDiffDataValue(value: unknown): JsonValue {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object') {
      w.json(current, '$.diffValue');
      return;
    }
    if (seen.has(current)) r.invalid('$.diffValue', 'acyclic JSON data', null);
    seen.add(current);
    const values = Array.isArray(current)
      ? r.list(current, '$.diffValue')
      : Object.values(r.record(current, '$.diffValue'));
    values.forEach(visit);
    seen.delete(current);
  };
  visit(value);
  return w.json(value, '$.diffValue');
}
