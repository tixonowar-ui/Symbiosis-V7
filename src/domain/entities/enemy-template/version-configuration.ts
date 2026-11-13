import type { EnemyAuthoringAttempt, EnemyVersionIdentity } from '@shared/enemy-authoring.js';
import { enemyAuthoringContextValue } from '@shared/enemy-authoring.js';
import {
  enemyVersionOriginValue,
  enemyVersionReplacementPreviewValue,
  enemyVersionDiffValue,
  enemyVersionDiffDataValue,
  type EnemyVersionOrigin,
  type EnemyVersionDiffEntry,
  type EnemyVersionConfigurationInput,
  type EnemyVersionReplacementPreview,
  type EnemyVersionReplacementSummary,
} from '@shared/enemy-version-configuration.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import {
  enemyVersionMandatoryFactsValue,
  enemyVersionFreeFactRequiresRepresentation,
  type EnemyVersionMandatoryFacts,
} from '@shared/enemy-version-facts.js';
import { emptyEnemyCompositionAcquisitions } from '@shared/enemy-composition.js';

const fail = (message: string): never => {
  throw new Error('Enemy version configuration: ' + message);
};

/** The caller must resolve base from its authoritative NAV prefix, not the client candidate. */
export function copyEnemyVersionAttempt(
  origin: EnemyVersionOrigin,
  base: Readonly<{ identity: EnemyVersionIdentity; attempt: EnemyAuthoringAttempt }>,
): EnemyAuthoringAttempt {
  const checked = enemyVersionOriginValue(origin);
  if (
    !admissionJsonEqual(checked.base, base.identity) ||
    base.attempt.campaignId !== checked.base.campaignId ||
    base.attempt.kind !== checked.base.kind
  )
    return fail('base does not match owning template/version');
  // A technical copy changes no plan, charges, losses, acquisition facts or legacy absence.
  const copied = {
    ...structuredClone(base.attempt),
    attemptId: checked.navigationRequestId,
    revision: 0,
  };
  return (
    enemyAuthoringContextValue({ attemptOrNull: copied, selectedVersionOrNull: null })
      .attemptOrNull ?? fail('missing complete source attempt')
  );
}

/** Opening facts do not authorize a legacy plan upgrade or manufacture current own choices. */
export function enemyVersionUnconfiguredAdvisorCard(
  attempt: EnemyAuthoringAttempt,
  facts: EnemyVersionMandatoryFacts,
  inheritedUnconfiguredCardIdOrNull: string | null,
): string | null {
  if (attempt.kind !== 'CUSTOM_MONSTER' || facts.kind !== 'CUSTOM_MONSTER')
    return fail('CUSTOM-only current own-card configuration marker');
  const card = facts.advisorCards[0];
  if (card === undefined || card.initialFillOrNull === null) return null;
  if (inheritedUnconfiguredCardIdOrNull === card.cardId) return card.cardId;
  return attempt.advisorCards.some(
    (row) => row.cardId === card.cardId && row.initialSkillsOrNull !== null,
  )
    ? null
    : card.cardId;
}

export function enemyVersionLegacyEffectRequiresUpgrade(
  attempt: EnemyAuthoringAttempt,
  facts: EnemyVersionMandatoryFacts,
): boolean {
  return (
    attempt.kind === 'SENTIENT' &&
    attempt.schemaVersion !== 2 &&
    facts.kind === 'SENTIENT' &&
    enemyVersionFreeFactRequiresRepresentation(
      facts.freeSlotOrNull,
      attempt.compositionAcquisitions?.freeSlotOrNull,
      attempt.buildOrNull?.raceCode,
    )
  );
}

/** New immutable effects revalidate the body; base payment/loss accounting is never reset here. */
export function mergeEnemyVersionMandatoryFacts(
  attempt: EnemyAuthoringAttempt,
  factsValue: EnemyVersionMandatoryFacts,
): EnemyAuthoringAttempt {
  const facts = enemyVersionMandatoryFactsValue(factsValue);
  if (attempt.kind !== facts.kind) return fail('foreign mandatory fact kind');
  if (attempt.kind === 'SENTIENT' && facts.kind === 'SENTIENT') {
    // Legacy ABSENT stays literal until explicit configuration confirmation. The commit guard
    // refuses a newly retained body effect which that old grammar cannot yet represent.
    if (attempt.schemaVersion !== 2) return structuredClone(attempt);
    if (facts.freeSlotOrNull === null && facts.advisorCards.length === 0)
      return structuredClone(attempt);
    const before = attempt.compositionAcquisitions ?? emptyEnemyCompositionAcquisitions();
    if (
      before.freeSlotOrNull !== null &&
      !admissionJsonEqual(before.freeSlotOrNull, facts.freeSlotOrNull)
    )
      return fail('changed original signed FREE consequence');
    const advisorCards = facts.advisorCards.map((card) => {
      const old = before.advisorCards.find((row) => row.cardId === card.cardId);
      if (
        old !== undefined &&
        (!admissionJsonEqual(old.iwRolls, card.iwRolls) ||
          old.symbiontInstanceId !== card.symbiontInstanceId)
      )
        return fail('changed original Advisor identity/IW');
      return {
        cardId: card.cardId,
        symbiontInstanceId: card.symbiontInstanceId,
        iwRolls: card.iwRolls,
        suppressionRollOrNull: card.suppressionRollOrNull,
        skillsOrNull: old?.skillsOrNull ?? null,
      };
    });
    if (before.advisorCards.some((card) => !advisorCards.some((row) => row.cardId === card.cardId)))
      return fail('original Advisor fact missing from owning prefix');
    const acquisitions = { ...before, freeSlotOrNull: facts.freeSlotOrNull, advisorCards };
    const effectChanged = before.freeSlotOrNull === null && facts.freeSlotOrNull !== null;
    const composition = attempt.compositionOrNull;
    const next = {
      ...attempt,
      compositionAcquisitions: acquisitions,
      ...(effectChanged
        ? { compositionOrNull: null, inventoryOrNull: null, itemTemplateKeys: [] }
        : composition !== null && 'schemaVersion' in composition
          ? { compositionOrNull: { ...composition, acquisitions } }
          : {}),
    };
    return (
      enemyAuthoringContextValue({ attemptOrNull: next, selectedVersionOrNull: null })
        .attemptOrNull ?? fail('missing merged attempt')
    );
  }
  if (attempt.kind !== 'CUSTOM_MONSTER' || facts.kind !== 'CUSTOM_MONSTER')
    return fail('foreign mandatory kind');
  const advisorCards = facts.advisorCards.map((card) => {
    const old = attempt.advisorCards.find((row) => row.cardId === card.cardId);
    if (old !== undefined) {
      if (
        !admissionJsonEqual(old.iwRolls, card.iwRolls) ||
        old.symbiontInstanceId !== card.symbiontInstanceId ||
        (old.initialSkillsOrNull !== null &&
          !admissionJsonEqual(old.initialSkillsOrNull, card.initialFillOrNull?.skills))
      )
        return fail('changed original Advisor identity/IW/initial fill');
      return old;
    }
    return {
      cardId: card.cardId,
      symbiontInstanceId: card.symbiontInstanceId,
      iwRolls: card.iwRolls,
      confirmedChoice: card.acquisitionChoice,
      initialSkillsOrNull: card.initialFillOrNull?.skills ?? null,
      knownSkills: [],
      permanentLosses: [],
    };
  });
  if (attempt.advisorCards.some((card) => !advisorCards.some((row) => row.cardId === card.cardId)))
    return fail('original Advisor fact missing from owning prefix');
  return (
    enemyAuthoringContextValue({
      attemptOrNull: { ...attempt, advisorCards },
      selectedVersionOrNull: null,
    }).attemptOrNull ?? fail('missing merged attempt')
  );
}

export function previewEnemyVersionReplacement(
  origin: EnemyVersionOrigin,
  attempt: EnemyAuthoringAttempt,
  input: EnemyVersionConfigurationInput,
  previewCommandId: string,
  inputSummary: EnemyVersionReplacementSummary,
): EnemyVersionReplacementPreview {
  return enemyVersionReplacementPreviewValue({
    schemaVersion: 1,
    previewCommandId,
    attemptId: attempt.attemptId,
    sourceAttemptRevision: attempt.revision,
    origin,
    input,
    before: attempt,
    inputSummary,
    invalidateComposition: true,
    invalidateInventory: attempt.kind === 'SENTIENT',
  });
}

/** Consent is a separate command: its own prefix contains exactly the saved preview revision. */
export function assertEnemyVersionReplacementConsent(
  previewValue: EnemyVersionReplacementPreview,
  actual: Readonly<{
    origin: EnemyVersionOrigin;
    attempt: EnemyAuthoringAttempt;
    input: EnemyVersionConfigurationInput;
    displayedPreview: EnemyVersionReplacementPreview;
  }>,
): void {
  const preview = enemyVersionReplacementPreviewValue(previewValue);
  if (
    !admissionJsonEqual(preview.origin, actual.origin) ||
    !admissionJsonEqual(preview.input, actual.input) ||
    !admissionJsonEqual(preview, actual.displayedPreview) ||
    actual.attempt.revision !== preview.sourceAttemptRevision + 1 ||
    !admissionJsonEqual(
      { ...actual.attempt, revision: preview.sourceAttemptRevision },
      preview.before,
    )
  )
    return fail('stale/changed input, source or displayed consequences');
}

/** Read-only value diff. Object order is irrelevant; array order and ABSENT/null remain distinct. */
export function diffEnemyVersionValues(
  before: JsonValue,
  after: JsonValue,
): readonly EnemyVersionDiffEntry[] {
  enemyVersionDiffDataValue(before);
  enemyVersionDiffDataValue(after);
  const result: EnemyVersionDiffEntry[] = [];
  const object = (value: JsonValue): value is JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const visit = (a: JsonValue | undefined, b: JsonValue | undefined, path: string): void => {
    if (admissionJsonEqual(a, b)) return;
    if (a !== undefined && b !== undefined && object(a) && object(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys)
        visit(a[key], b[key], path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
      return;
    }
    result.push({
      path,
      before: a === undefined ? { present: false } : { present: true, value: structuredClone(a) },
      after: b === undefined ? { present: false } : { present: true, value: structuredClone(b) },
    });
  };
  visit(before, after, '');
  return enemyVersionDiffValue(result);
}
