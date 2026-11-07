import type { NpcRollFact } from '../domain/rules/npc-authoring/types.js';
import type { RollSourceSnapshot } from '../domain/entities/roll-request/roll-model.js';
import { resolveManualRoll } from '../domain/entities/roll-request/roll-model.js';
import type { NpcAttempt, NpcOperation } from './npc-library-records.js';
import { networkApplicationStorage as s } from './network-local-application.js';

/** A real prepared D6 outcome outside editable values; SET inputs already live in its request. */
export interface NpcLifeStateRollFact {
  readonly kind: 'FORMAL_LIFE_ROLL';
  readonly fact: NpcRollFact<6>;
  readonly source: RollSourceSnapshot;
  readonly receiptId: string;
}

export function npcLifeStateRollFactValue(value: unknown): NpcLifeStateRollFact {
  const row = s.object(value, ['kind', 'fact', 'source', 'receiptId']),
    fact = s.object(row['fact'], ['factId', 'sourceRuleId', 'roll']),
    roll = s.object(fact['roll'], ['dieSides', 'rawFace']),
    source = s.object(row['source'], [
      'dieSides',
      'modeSnapshot',
      'originatingCommandId',
      'rollRequestId',
    ]);
  if (
    row['kind'] !== 'FORMAL_LIFE_ROLL' ||
    fact['sourceRuleId'] !== 'CORE-153' ||
    roll['dieSides'] !== 6 ||
    source['dieSides'] !== 6 ||
    (source['modeSnapshot'] !== 'AUTO' && source['modeSnapshot'] !== 'MANUAL')
  )
    return s.fail('INVALID_INPUT');
  const originatingCommandId = s.uuid(source['originatingCommandId']),
    rollRequestId = s.uuid(source['rollRequestId']),
    factId = s.uuid(fact['factId']),
    receiptId = s.uuid(row['receiptId']);
  if (new Set([originatingCommandId, rollRequestId, factId, receiptId]).size !== 4)
    return s.fail('INVALID_INPUT');
  // The shared closed roll model checks the recorded face. Parsing never asks for randomness.
  const checked = resolveManualRoll(
    { dieSides: 6, modeSnapshot: 'MANUAL', originatingCommandId, rollRequestId },
    roll['rawFace'],
  );
  if (!checked.ok) return s.fail('INVALID_INPUT');
  return {
    kind: 'FORMAL_LIFE_ROLL',
    fact: {
      factId,
      sourceRuleId: 'CORE-153',
      roll: { dieSides: 6, rawFace: checked.resolution.mechanical.rawFace },
    },
    source: {
      dieSides: 6,
      modeSnapshot: source['modeSnapshot'],
      originatingCommandId,
      rollRequestId,
    },
    receiptId,
  };
}

/** Intrinsic event binding only; the owning fold independently proves mode, source and no reroll. */
export function verifyNpcLifeRollFactBinding(
  fact: NpcLifeStateRollFact | null,
  operation: Pick<NpcOperation, 'operationId' | 'receiptId' | 'kind' | 'request'>,
  attempt: Pick<NpcAttempt, 'stage' | 'status'>,
): void {
  const request = operation.request,
    preparation =
      request['messageType'] === 'network.npc-preparation.request'
        ? s.object(request['preparation'])
        : null;
  if (preparation?.['kind'] !== 'LIFE_STATE_ROLL') {
    if (fact !== null) return s.fail('INVALID_INPUT');
    return;
  }
  if (
    fact === null ||
    operation.kind !== 'REPLACE' ||
    request['sourceFormId'] !== 'NPC-016' ||
    attempt.stage !== 'NPC-016' ||
    attempt.status !== 'OPEN' ||
    fact.source.originatingCommandId !== operation.operationId ||
    fact.receiptId !== operation.receiptId
  )
    return s.fail('INVALID_INPUT');
}
