import {
  createRollSourceSnapshot,
  resolveAutoRoll,
  resolveManualRoll,
  type RollFaceSampler,
  type RollMode,
} from '../domain/entities/roll-request/roll-model.js';
import {
  npcLifeStateRollFactValue,
  type NpcLifeStateRollFact,
} from '../persistence/npc-life-facts.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';

/** The caller owns GM/source/attempt/no-reroll preflight before entering its lazy SQL factory. */
export function prepareNpcLifeRollFact(
  operationId: string,
  mode: RollMode,
  manualFaceOrNull: number | null,
  allocate: () => string,
  sample: RollFaceSampler,
): NpcLifeStateRollFact {
  s.uuid(operationId);
  if (mode === 'AUTO' && manualFaceOrNull !== null) return s.fail('INVALID_INPUT');
  const factId = allocate(),
    receiptId = allocate(),
    rollRequestId = allocate();
  const source = createRollSourceSnapshot({
    dieSides: 6,
    modeSnapshot: mode,
    originatingCommandId: operationId,
    rollRequestId,
  });
  const mechanical =
    mode === 'AUTO'
      ? resolveAutoRoll(
          { request: { ...source, modeSnapshot: 'AUTO' }, submitCommandId: receiptId },
          null,
          sample,
        ).resolution.mechanical
      : (() => {
          const result = resolveManualRoll({ ...source, modeSnapshot: 'MANUAL' }, manualFaceOrNull);
          return result.ok ? result.resolution.mechanical : s.fail('INVALID_INPUT');
        })();
  return npcLifeStateRollFactValue({
    kind: 'FORMAL_LIFE_ROLL',
    fact: { factId, sourceRuleId: 'CORE-153', roll: mechanical },
    source,
    receiptId,
  });
}

/** Re-read the preserved outcome against its actual request/mode without generating a new face. */
export function verifyNpcLifeRollOutcome(
  value: NpcLifeStateRollFact,
  originalMode: RollMode,
  originalManualFaceOrNull: number | null,
): void {
  const fact = npcLifeStateRollFactValue(value);
  if (fact.source.modeSnapshot !== originalMode) return s.fail('INVALID_INPUT');
  if (originalMode === 'AUTO') {
    if (originalManualFaceOrNull !== null) return s.fail('INVALID_INPUT');
    const source = { ...fact.source, modeSnapshot: 'AUTO' as const },
      replay = resolveAutoRoll(
        { request: source, submitCommandId: fact.receiptId },
        { ...source, submitCommandId: fact.receiptId, rawFace: fact.fact.roll.rawFace },
        () => s.fail('INVALID_INPUT'),
      );
    if (replay.kind !== 'REPLAY' || !s.same(replay.resolution.mechanical, fact.fact.roll))
      return s.fail('INVALID_INPUT');
    return;
  }
  const result = resolveManualRoll(
    { ...fact.source, modeSnapshot: 'MANUAL' },
    originalManualFaceOrNull,
  );
  if (!result.ok || !s.same(result.resolution.mechanical, fact.fact.roll))
    return s.fail('INVALID_INPUT');
}
