import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  commitCreationCriticalConfirmation,
  createCreationCriticalChain,
  createRollSourceSnapshot,
  CREATION_STAT_METHODS,
  CREATION_STAT_RETURN_DECISION_FORM_IDS,
  CREATION_STAT_ROLL_FORM_IDS,
  CREATION_STAT_ROLL_RULE_IDS,
  CREATION_STAT_SET_ENTRY_INDICES,
  CreationStatRollRuleError,
  CREATION_STAT_SET_DECISION_RULES,
  deriveCreationStatAbandonment,
  deriveCreationStatSetDecisionRule,
  deriveCreationReturnDecisionFormId,
  resolveAutoRoll,
  resolveCreationStatSet,
  resolveManualRoll,
} from '../index.js';
import type {
  CreationStatCriticalChainState,
  CreationStatCriticalQueueItem,
  MechanicalRoll,
} from '../index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}/${path}`, 'utf8')) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => record(entry, `${label}[${String(index)}]`));
}

const RULES = records(readJson('generated/spec/rules/rules.json'), 'rules');
const FORMS = record(readJson('generated/spec/atlas/forms-by-id.json'), 'forms-by-id');

function rule(ruleId: (typeof CREATION_STAT_ROLL_RULE_IDS)[number]): Record<string, unknown> {
  const found = RULES.find((entry) => entry['Rule ID'] === ruleId);
  if (found === undefined) throw new Error(`rule ${ruleId} not found`);
  return found;
}

function d20(rawFace: number): MechanicalRoll {
  return { dieSides: 20, rawFace };
}

function item(
  setEntryIndex: CreationStatCriticalQueueItem['setEntryIndex'],
  originFace: CreationStatCriticalQueueItem['originFace'],
): CreationStatCriticalQueueItem {
  return { originFace, setEntryIndex };
}

function autoD20(rawFace: number, identity: string): MechanicalRoll {
  const request = createRollSourceSnapshot({
    dieSides: 20,
    modeSnapshot: 'AUTO',
    originatingCommandId: `origin-${identity}`,
    rollRequestId: `request-${identity}`,
  });
  return resolveAutoRoll({ request, submitCommandId: `submit-${identity}` }, null, () => rawFace)
    .resolution.mechanical;
}

function manualD20(rawFace: number, identity: string): MechanicalRoll {
  const request = createRollSourceSnapshot({
    dieSides: 20,
    modeSnapshot: 'MANUAL',
    originatingCommandId: `origin-${identity}`,
    rollRequestId: `request-${identity}`,
  });
  const result = resolveManualRoll(request, rawFace);
  if (!result.ok) throw new Error(`test face ${String(rawFace)} is not a valid manual d20`);
  return result.resolution.mechanical;
}

function commitFaces(
  queueItem: CreationStatCriticalQueueItem,
  faces: readonly number[],
): CreationStatCriticalChainState {
  return faces.reduce<CreationStatCriticalChainState>(
    (state, face) => commitCreationCriticalConfirmation(state, d20(face)),
    createCreationCriticalChain(queueItem),
  );
}

describe('CHR-003 creation stat set', () => {
  it('anchors CORE-160/161/162/163 and the two scoped Atlas forms', () => {
    expect(CREATION_STAT_ROLL_FORM_IDS).toEqual(['CHR-003', 'CHR-004']);
    expect(CREATION_STAT_ROLL_RULE_IDS).toEqual(['CORE-160', 'CORE-161', 'CORE-162', 'CORE-163']);
    for (const ruleId of CREATION_STAT_ROLL_RULE_IDS) {
      expect(rule(ruleId)).toMatchObject({
        'Rule ID': ruleId,
        'Режим реализации': 'Реализовать в игровом ядре',
        Статус: 'Активно',
      });
    }

    expect(record(FORMS['CHR-003'], 'CHR-003').requiredFields).toEqual([
      'characterDraftId',
      'statMethod',
      'attemptIndex',
      'diceInputModeSnapshot=AUTO|MANUAL',
      'setRollRequestId',
      'faces[7]OrManualInputs[7]',
      'setRollReceiptIdOrNull',
      'naturalCriticalQueue[]',
      'shownResultLocked',
      'branchUuid',
      'wizardCheckpointId',
      'draftRevision',
      'commandId',
    ]);
    expect(record(FORMS['CHR-004'], 'CHR-004').requiredFields).toContain(
      'returnDecisionFormId(server-signed)=CHR-005|CHR-006|CHR-007|CHR-008',
    );
  });

  it('anchors the exact set counts and formulas before using them', () => {
    expect(rule('CORE-160')['Броски / формулы']).toBe(
      '7 независимых D20 и критические цепочки для 1/20.',
    );
    expect(rule('CORE-161')['Броски / формулы']).toBe('до двух наборов по 7 D20.');
    expect(rule('CORE-162')['Броски / формулы']).toBe('до 5 наборов по 7 D20.');
    expect(rule('CORE-163')['Входы / параметры']).toBe(
      'цепочка подтверждения 15–20 для 20 или 1–5 для 1; grade 1..5.',
    );
  });

  it('validates exactly seven independent d20 results and freezes its copy', () => {
    const input = [d20(2), d20(3), d20(4), d20(5), d20(6), d20(7), d20(8)];
    const result = resolveCreationStatSet(input);

    expect(result.faces.map(({ rawFace }) => rawFace)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result.naturalCriticalQueue).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.faces)).toBe(true);
    expect(result.faces.every(Object.isFrozen)).toBe(true);
    input[0] = d20(19);
    expect(result.faces[0].rawFace).toBe(2);
  });

  it('queues every natural face in ascending set-entry order without collapsing duplicates', () => {
    const result = resolveCreationStatSet([
      d20(20),
      d20(1),
      d20(20),
      d20(9),
      d20(1),
      d20(8),
      d20(20),
    ]);

    expect(result.naturalCriticalQueue).toEqual([
      { originFace: 20, setEntryIndex: 0 },
      { originFace: 1, setEntryIndex: 1 },
      { originFace: 20, setEntryIndex: 2 },
      { originFace: 1, setEntryIndex: 4 },
      { originFace: 20, setEntryIndex: 6 },
    ]);
    expect(Object.isFrozen(result.naturalCriticalQueue)).toBe(true);
    expect(result.naturalCriticalQueue.every(Object.isFrozen)).toBe(true);
    expect(CREATION_STAT_SET_ENTRY_INDICES).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('has the same set mechanics for ADR 0021 AUTO and MANUAL results', () => {
    const rawFaces = [1, 7, 20, 3, 3, 19, 1] as const;
    const automatic = resolveCreationStatSet(
      rawFaces.map((face, index) => autoD20(face, `auto-${String(index)}`)),
    );
    const manual = resolveCreationStatSet(
      rawFaces.map((face, index) => manualD20(face, `manual-${String(index)}`)),
    );

    expect(automatic).toEqual(manual);
  });

  it.each([
    [[], 0],
    [[d20(1)], 1],
    [[d20(1), d20(2), d20(3), d20(4), d20(5), d20(6)], 6],
    [[d20(1), d20(2), d20(3), d20(4), d20(5), d20(6), d20(7), d20(8)], 8],
  ] as const)('rejects set length %i instead of padding or truncating it', (faces, length) => {
    expect(() => resolveCreationStatSet(faces)).toThrow(
      `faces must contain exactly 7 d20 rolls; got ${String(length)}`,
    );
  });

  it('rejects a non-array set explicitly', () => {
    expect(() => resolveCreationStatSet(null)).toThrow(
      'faces must be an array of exactly 7 d20 rolls; received null',
    );
  });

  it.each([
    [0, 'faces[3].rawFace must be a safe integer in 1..20; received 0'],
    [21, 'faces[3].rawFace must be a safe integer in 1..20; received 21'],
    [1.5, 'faces[3].rawFace must be a safe integer in 1..20; received 1.5'],
    [
      Number.MAX_SAFE_INTEGER + 1,
      `faces[3].rawFace must be a safe integer in 1..20; received ${String(Number.MAX_SAFE_INTEGER + 1)}`,
    ],
  ])('rejects invalid face %s at its exact set entry', (rawFace, message) => {
    expect(() =>
      resolveCreationStatSet([d20(1), d20(2), d20(3), d20(rawFace), d20(5), d20(6), d20(7)]),
    ).toThrow(message);
  });

  it('rejects non-d20 and nonexact MechanicalRoll objects', () => {
    expect(() =>
      resolveCreationStatSet([
        d20(1),
        d20(2),
        d20(3),
        { dieSides: 12, rawFace: 4 },
        d20(5),
        d20(6),
        d20(7),
      ]),
    ).toThrow('faces[3].dieSides must be 20; received 12');
    expect(() =>
      resolveCreationStatSet([
        d20(1),
        d20(2),
        d20(3),
        { dieSides: 20, provenance: 'AUTO', rawFace: 4 },
        d20(5),
        d20(6),
        d20(7),
      ]),
    ).toThrow('faces[3] keys must be exact; missing: none; unexpected: provenance');
  });

  it('rejects sparse sets at the missing index', () => {
    const faces = new Array<MechanicalRoll>(7);
    for (const index of [0, 1, 2, 3, 5, 6]) faces[index] = d20(index + 1);
    expect(() => resolveCreationStatSet(faces)).toThrow(
      'faces[4] must be an object; received undefined',
    );
  });
});

describe('CHR-004 return decision derivation', () => {
  it('implements the complete method/attempt table from ADR 0042', () => {
    expect(CREATION_STAT_METHODS).toEqual(['CLASSIC', 'ADVENTUROUS', 'ALL_OR_NOTHING']);
    expect(CREATION_STAT_RETURN_DECISION_FORM_IDS).toEqual([
      'CHR-005',
      'CHR-006',
      'CHR-007',
      'CHR-008',
    ]);
    expect(deriveCreationReturnDecisionFormId('CLASSIC', 1)).toBe('CHR-005');
    expect(deriveCreationReturnDecisionFormId('ADVENTUROUS', 1)).toBe('CHR-006');
    expect(deriveCreationReturnDecisionFormId('ADVENTUROUS', 2)).toBe('CHR-007');
    for (const attempt of [1, 2, 3, 4, 5]) {
      expect(deriveCreationReturnDecisionFormId('ALL_OR_NOTHING', attempt)).toBe('CHR-008');
    }
  });

  it.each([
    ['CLASSIC', 2, 'expected: 1'],
    ['ADVENTUROUS', 0, 'expected: 1, 2'],
    ['ADVENTUROUS', 3, 'expected: 1, 2'],
    ['ALL_OR_NOTHING', 6, 'expected: 1, 2, 3, 4, 5'],
  ] as const)('rejects attempt %i for %s with its closed domain', (method, attempt, expected) => {
    expect(() => deriveCreationReturnDecisionFormId(method, attempt)).toThrow(expected);
  });

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'rejects unsafe attemptIndex %s',
    (attempt) => {
      expect(() => deriveCreationReturnDecisionFormId('CLASSIC', attempt)).toThrow(
        'attemptIndex must be a safe integer',
      );
    },
  );

  it.each(['classic', 'RANDOM', null])('rejects unknown stat method %s fail-closed', (method) => {
    expect(() => deriveCreationReturnDecisionFormId(method, 1)).toThrow(
      'statMethod must be one of CLASSIC, ADVENTUROUS, ALL_OR_NOTHING',
    );
  });
});

describe('CHR-005..008 decision and abandonment table', () => {
  it('owns every method/attempt row including receipt-key and mandatory-fifth differences', () => {
    expect(CREATION_STAT_SET_DECISION_RULES).toHaveLength(8);
    expect(deriveCreationStatSetDecisionRule('CLASSIC', 1)).toEqual({
      alternateDecision: 'USE_POINT_BUY_90',
      attemptIndex: 1,
      decisionFormId: 'CHR-005',
      fifthAttemptMandatoryAccept: false,
      maximumAttempts: 1,
      setReceiptField: 'acceptedSetReceiptId',
      statMethod: 'CLASSIC',
      transitionKind: 'CLASSIC_TO_90',
    });
    expect(deriveCreationStatSetDecisionRule('ADVENTUROUS', 1)).toMatchObject({
      alternateDecision: 'GO_ATTEMPT_2',
      decisionFormId: 'CHR-006',
      maximumAttempts: 2,
      setReceiptField: 'setReceiptId',
    });
    expect(deriveCreationStatSetDecisionRule('ADVENTUROUS', 2)).toMatchObject({
      alternateDecision: 'USE_POINT_BUY_85',
      decisionFormId: 'CHR-007',
    });
    expect(deriveCreationStatSetDecisionRule('ALL_OR_NOTHING', 5)).toMatchObject({
      alternateDecision: 'GO_NEXT_ATTEMPT',
      decisionFormId: 'CHR-008',
      fifthAttemptMandatoryAccept: true,
      maximumAttempts: 5,
    });
  });

  it('derives only the four closed consequence pairings and rejects attempt six/fifth abandonment', () => {
    expect(deriveCreationStatAbandonment('CLASSIC', 1)).toMatchObject({
      consequences: { exactPointBuyTotalOrNull: 90, nextAttemptIndexOrNull: null },
      nextFormId: 'CHR-009',
      statAssignmentModeOrNull: 'POINT_BUY_90',
    });
    expect(deriveCreationStatAbandonment('ADVENTUROUS', 1)).toMatchObject({
      consequences: { exactPointBuyTotalOrNull: null, nextAttemptIndexOrNull: 2 },
      nextFormId: 'CHR-003',
      statAssignmentModeOrNull: null,
    });
    expect(deriveCreationStatAbandonment('ADVENTUROUS', 2)).toMatchObject({
      consequences: { exactPointBuyTotalOrNull: 85, nextAttemptIndexOrNull: null },
      nextFormId: 'CHR-009',
      statAssignmentModeOrNull: 'POINT_BUY_85',
    });
    expect(deriveCreationStatAbandonment('ALL_OR_NOTHING', 4)).toMatchObject({
      consequences: { exactPointBuyTotalOrNull: null, nextAttemptIndexOrNull: 5 },
      nextFormId: 'CHR-003',
    });
    expect(() => deriveCreationStatAbandonment('ALL_OR_NOTHING', 5)).toThrow(
      'attemptIndex 5 is mandatory acceptance',
    );
    expect(() => deriveCreationStatSetDecisionRule('ALL_OR_NOTHING', 6)).toThrow(
      'expected: 1, 2, 3, 4, 5',
    );
  });
});

describe('CHR-004 creation critical queue reducer', () => {
  it('starts a frozen pending chain without inventing a result', () => {
    const chain = createCreationCriticalChain(item(3, 20));

    expect(chain).toEqual({
      confirmationRolls: [],
      outcome: null,
      queueItem: { originFace: 20, setEntryIndex: 3 },
      status: 'PENDING_CONFIRMATION',
    });
    expect(Object.isFrozen(chain)).toBe(true);
    expect(Object.isFrozen(chain.confirmationRolls)).toBe(true);
    expect(Object.isFrozen(chain.queueItem)).toBe(true);
  });

  it('keeps requesting confirmations only while natural 20 succeeds below grade five', () => {
    let chain = createCreationCriticalChain(item(2, 20));
    for (const [index, face] of [15, 16, 17, 18].entries()) {
      chain = commitCreationCriticalConfirmation(chain, d20(face));
      expect(chain.status).toBe('PENDING_CONFIRMATION');
      expect(chain.outcome).toBeNull();
      expect(chain.confirmationRolls).toHaveLength(index + 1);
    }

    chain = commitCreationCriticalConfirmation(chain, d20(14));
    expect(chain).toEqual({
      confirmationRolls: [d20(15), d20(16), d20(17), d20(18), d20(14)],
      outcome: {
        creationCriticalPenaltyOrNull: null,
        criticalGrade: 4,
        criticalPolarity: 'SUCCESS',
        setEntryIndex: 2,
        value: 24,
      },
      queueItem: { originFace: 20, setEntryIndex: 2 },
      status: 'TERMINAL',
    });
  });

  it('closes a natural 20 at grade five without asking for a sixth roll', () => {
    const chain = commitFaces(item(6, 20), [20, 19, 18, 17, 16]);

    expect(chain.status).toBe('TERMINAL');
    expect(chain.outcome).toEqual({
      creationCriticalPenaltyOrNull: null,
      criticalGrade: 5,
      criticalPolarity: 'SUCCESS',
      setEntryIndex: 6,
      value: 25,
    });
    expect(chain.confirmationRolls).toHaveLength(5);
  });

  it('closes a natural 1 at grade five with an indexed permanent penalty', () => {
    const chain = commitFaces(item(4, 1), [1, 2, 3, 4, 5]);

    expect(chain.status).toBe('TERMINAL');
    expect(chain.outcome).toEqual({
      creationCriticalPenaltyOrNull: -5,
      criticalGrade: 5,
      criticalPolarity: 'FAILURE',
      setEntryIndex: 4,
      value: 1,
    });
  });

  it.each([
    [20, 14],
    [1, 6],
  ] as const)('closes unconfirmed origin %i on its first miss %i', (originFace, miss) => {
    const chain = commitFaces(item(0, originFace), [miss]);

    expect(chain.status).toBe('TERMINAL');
    expect(chain.outcome).toEqual({
      creationCriticalPenaltyOrNull: null,
      criticalGrade: 0,
      criticalPolarity: 'NONE',
      setEntryIndex: 0,
      value: originFace,
    });
  });

  it('preserves distinct set-entry identity for duplicate natural faces', () => {
    const first = commitFaces(item(1, 1), [5, 6]);
    const second = commitFaces(item(5, 1), [5, 6]);

    expect(first.outcome).toMatchObject({ setEntryIndex: 1 });
    expect(second.outcome).toMatchObject({ setEntryIndex: 5 });
    expect(first.outcome).not.toEqual(second.outcome);
  });

  it('does not recursively queue a natural confirmation face', () => {
    const afterNaturalConfirmation = commitCreationCriticalConfirmation(
      createCreationCriticalChain(item(0, 20)),
      d20(20),
    );

    expect(afterNaturalConfirmation.status).toBe('PENDING_CONFIRMATION');
    expect(afterNaturalConfirmation).not.toHaveProperty('naturalCriticalQueue');
    expect(afterNaturalConfirmation.confirmationRolls).toEqual([d20(20)]);
  });

  it('is source-neutral for AUTO and MANUAL confirmation rolls', () => {
    const automatic = [20, 16, 14].reduce<CreationStatCriticalChainState>(
      (state, face, index) =>
        commitCreationCriticalConfirmation(state, autoD20(face, `confirmation-${String(index)}`)),
      createCreationCriticalChain(item(3, 20)),
    );
    const manual = [20, 16, 14].reduce<CreationStatCriticalChainState>(
      (state, face, index) =>
        commitCreationCriticalConfirmation(state, manualD20(face, `confirmation-${String(index)}`)),
      createCreationCriticalChain(item(3, 20)),
    );

    expect(automatic).toEqual(manual);
  });

  it('rejects any appended confirmation after the first miss', () => {
    const terminal = commitFaces(item(1, 20), [18, 14]);

    expect(() => commitCreationCriticalConfirmation(terminal, d20(20))).toThrow(
      'cannot append a confirmation roll after the critical chain is terminal',
    );
  });

  it('rejects any appended confirmation after the grade-five cap', () => {
    const terminal = commitFaces(item(1, 1), [1, 2, 3, 4, 5]);

    expect(() => commitCreationCriticalConfirmation(terminal, d20(1))).toThrow(
      'cannot append a confirmation roll after the critical chain is terminal',
    );
  });

  it('rejects a persisted tail after a miss as corruption', () => {
    const corrupt = {
      confirmationRolls: [d20(15), d20(14), d20(20)],
      outcome: {
        creationCriticalPenaltyOrNull: null,
        criticalGrade: 1,
        criticalPolarity: 'SUCCESS',
        setEntryIndex: 2,
        value: 21,
      },
      queueItem: item(2, 20),
      status: 'TERMINAL',
    } as CreationStatCriticalChainState;

    expect(() => commitCreationCriticalConfirmation(corrupt, d20(3))).toThrow(
      'terminal state contains a confirmation tail after miss at confirmationRolls[1]',
    );
  });

  it('rejects pending state after a miss or after five confirmations', () => {
    const afterMiss = {
      confirmationRolls: [d20(14)],
      outcome: null,
      queueItem: item(0, 20),
      status: 'PENDING_CONFIRMATION',
    } as const;
    const afterCap = {
      confirmationRolls: [d20(15), d20(16), d20(17), d20(18), d20(19)],
      outcome: null,
      queueItem: item(0, 20),
      status: 'PENDING_CONFIRMATION',
    } as const;

    expect(() => commitCreationCriticalConfirmation(afterMiss, d20(20))).toThrow(
      'pending state contains a terminal miss at confirmationRolls[0]',
    );
    expect(() => commitCreationCriticalConfirmation(afterCap, d20(20))).toThrow(
      'pending state cannot contain grade 5 confirmation',
    );
  });

  it('rejects terminal state with an outcome not derived from its stored rolls', () => {
    const terminal = commitFaces(item(2, 20), [15, 14]);
    if (terminal.status !== 'TERMINAL') throw new Error('test requires a terminal chain');
    const corrupt = {
      ...terminal,
      outcome: { ...terminal.outcome, setEntryIndex: 3 },
    } as CreationStatCriticalChainState;

    expect(() => commitCreationCriticalConfirmation(corrupt, d20(20))).toThrow(
      'state.outcome must match the stored origin and confirmation rolls',
    );
  });

  it.each([-1, 7, 1.5])('rejects queue setEntryIndex %s outside 0..6', (setEntryIndex) => {
    expect(() =>
      createCreationCriticalChain({
        originFace: 20,
        setEntryIndex,
      } as unknown as CreationStatCriticalQueueItem),
    ).toThrow(`queueItem.setEntryIndex must be one of 0, 1, 2, 3, 4, 5, 6`);
  });

  it.each([0, 2, 19, 21])('rejects non-natural queue origin %i', (originFace) => {
    expect(() =>
      createCreationCriticalChain({
        originFace,
        setEntryIndex: 0,
      } as unknown as CreationStatCriticalQueueItem),
    ).toThrow(`queueItem.originFace must be 1 or 20; received ${String(originFace)}`);
  });

  it('rejects malformed chain shapes and confirmation rolls fail-closed', () => {
    const pending = createCreationCriticalChain(item(0, 20));
    expect(() =>
      commitCreationCriticalConfirmation(
        { ...pending, extra: true } as unknown as CreationStatCriticalChainState,
        d20(15),
      ),
    ).toThrow('state keys must be exact; missing: none; unexpected: extra');
    expect(() =>
      commitCreationCriticalConfirmation(pending, { dieSides: 12, rawFace: 12 }),
    ).toThrow('confirmationRoll.dieSides must be 20; received 12');
  });

  it('returns only the source-backed indexed mechanical outcome', () => {
    const terminal = commitFaces(item(4, 1), [3, 6]);
    if (terminal.status !== 'TERMINAL') throw new Error('test requires a terminal chain');

    expect(Object.keys(terminal.outcome).sort()).toEqual([
      'creationCriticalPenaltyOrNull',
      'criticalGrade',
      'criticalPolarity',
      'setEntryIndex',
      'value',
    ]);
    expect(terminal.outcome).not.toHaveProperty('xp');
    expect(terminal.outcome).not.toHaveProperty('eventPoints');
    expect(terminal.outcome).not.toHaveProperty('statCode');
    expect(Object.isFrozen(terminal.outcome)).toBe(true);
  });

  it('uses the domain-specific error type for invalid reducer input', () => {
    expect(() =>
      createCreationCriticalChain({
        originFace: 2,
        setEntryIndex: 0,
      } as unknown as CreationStatCriticalQueueItem),
    ).toThrowError(CreationStatRollRuleError);
  });
});
