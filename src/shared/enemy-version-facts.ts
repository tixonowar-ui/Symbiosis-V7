import {
  enemyCompositionAcquisitionsValue,
  enemyCompositionRollValue,
  type EnemyCompositionAcquisitions,
  type EnemyCompositionRoll,
  enemySymbiontChoiceValue,
  type EnemySymbiontChoice,
} from './enemy-composition.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';

/** A retained zero loss has no body effect outside FREE; FREE still needs its acquired slot. */
export function enemyVersionFreeFactRequiresRepresentation(
  fact: EnemyCompositionAcquisitions['freeSlotOrNull'],
  represented: EnemyCompositionAcquisitions['freeSlotOrNull'] | undefined,
  raceCode: string | undefined,
): boolean {
  return (
    fact !== null &&
    !admissionJsonEqual(represented, fact) &&
    (raceCode === 'FREE' ||
      (['S', 'M', 'Z'] as const).some((stat) => fact.permanentStatConsequence[stat] !== 0))
  );
}

export interface EnemyVersionInitialFillFact {
  readonly commandId: string;
  readonly skills: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
}
interface EnemyVersionAdvisorFact {
  readonly cardId: string;
  readonly symbiontInstanceId: string;
  readonly iwRolls: readonly [EnemyCompositionRoll, EnemyCompositionRoll];
  readonly initialFillOrNull: EnemyVersionInitialFillFact | null;
}
/** Only immutable acquisitions/first fill; no abandoned plan, known skills, losses or GROSS. */
export type EnemyVersionMandatoryFacts =
  | Readonly<{
      schemaVersion: 1;
      kind: 'SENTIENT';
      freeSlotOrNull: EnemyCompositionAcquisitions['freeSlotOrNull'];
      advisorCards: readonly (EnemyVersionAdvisorFact &
        Readonly<{
          suppressionRollOrNull: EnemyCompositionRoll | null;
        }>)[];
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'CUSTOM_MONSTER';
      advisorCards: readonly (EnemyVersionAdvisorFact &
        Readonly<{ acquisitionChoice: EnemySymbiontChoice }>)[];
    }>;

export function enemyVersionMandatoryFactsValue(value: unknown): EnemyVersionMandatoryFacts {
  const raw = r.record(value, '$.mandatoryFacts');
  const kind = r.oneOf(raw['kind'], ['SENTIENT', 'CUSTOM_MONSTER'], '$.mandatoryFacts.kind');
  const row = r.exact(
    value,
    'schemaVersion kind advisorCards' + (kind === 'SENTIENT' ? ' freeSlotOrNull' : ''),
    '$.mandatoryFacts',
  );
  w.literal(row['schemaVersion'], 1, '$.mandatoryFacts.schemaVersion');
  if (kind === 'SENTIENT')
    enemyCompositionAcquisitionsValue({
      schemaVersion: 1,
      freeSlotOrNull: row['freeSlotOrNull'],
      advisorCards: [],
      activeAdvisorCardIdOrNull: null,
      grossGrantOrNull: null,
    });
  const cards = r.list(row['advisorCards'], '$.mandatoryFacts.advisorCards');
  // ADR0094 does not grant a replacement-card right. Both existing kind paths reuse the acquired card.
  if (cards.length > 1)
    r.invalid('$.mandatoryFacts.advisorCards', 'one actual acquired Advisor card', null);
  for (const raw of cards) {
    const card = r.exact(
      raw,
      'cardId symbiontInstanceId iwRolls initialFillOrNull' +
        (kind === 'SENTIENT' ? ' suppressionRollOrNull' : ' acquisitionChoice'),
      '$.mandatoryCard',
    );
    for (const key of ['cardId', 'symbiontInstanceId']) r.uuid(card[key], '$.' + key);
    if (kind === 'CUSTOM_MONSTER')
      w.literal(
        enemySymbiontChoiceValue(card['acquisitionChoice']).speciesKey,
        'ADVISER',
        '$.acquisitionChoice.speciesKey',
      );
    const rolls = r.list(card['iwRolls'], '$.iwRolls');
    if (rolls.length !== 2) r.invalid('$.iwRolls', 'original I then W', null);
    for (const roll of rolls)
      w.literal(enemyCompositionRollValue(roll).mechanical.dieSides, 20, '$.iwRoll.dieSides');
    if (kind === 'SENTIENT' && card['suppressionRollOrNull'] !== null)
      w.literal(
        enemyCompositionRollValue(card['suppressionRollOrNull']).mechanical.dieSides,
        20,
        '$.suppression.dieSides',
      );
    if (card['initialFillOrNull'] !== null) {
      const fill = r.exact(card['initialFillOrNull'], 'commandId skills', '$.initialFill');
      r.uuid(fill['commandId'], '$.initialFill.commandId');
      const skills = r.list(fill['skills'], '$.initialFill.skills');
      const seen = new Set<string>();
      for (const raw of skills) {
        const skill = r.exact(raw, 'skillKey targetBonus', '$.initialFill.skill');
        const key = r.text(skill['skillKey'], '$.skillKey');
        if (seen.has(key)) r.invalid('$.initialFill.skills', 'distinct initial choices', null);
        seen.add(key);
        r.integer(skill['targetBonus'], '$.targetBonus', 1);
      }
    }
  }
  return w.validated(structuredClone(row));
}
