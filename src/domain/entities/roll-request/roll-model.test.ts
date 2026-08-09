import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { JsonObject } from '../../../shared/wire-protocol.js';
import {
  INVALID_RANGE_STATE,
  ROLL_DIE_SIDES,
  createRollSourceSnapshot,
  requireRollDieSides,
  resolveAutoRoll,
  resolveManualRoll,
} from './roll-model.js';
import type { RollMode, RollSourceSnapshot } from './roll-model.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8')) as unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function asStrings(value: unknown, label: string): string[] {
  return asArray(value, label).map((entry, index) => asString(entry, `${label}[${String(index)}]`));
}

const formsById = asRecord(readJson('generated/spec/atlas/forms-by-id.json'), 'atlas forms-by-id');
const requirements = asArray(
  readJson('generated/spec/atlas/requirements.json'),
  'atlas requirements',
).map((entry, index) => asRecord(entry, `atlas requirements[${String(index)}]`));
const lifecycles = asArray(
  readJson('generated/spec/atlas/lifecycles.json'),
  'atlas lifecycles',
).map((entry, index) => asRecord(entry, `atlas lifecycles[${String(index)}]`));

function form(id: string): Record<string, unknown> {
  return asRecord(formsById[id], `form ${id}`);
}

function requirement(id: string): Record<string, unknown> {
  const found = requirements.find((entry) => entry.requirementId === id);
  if (found === undefined) throw new Error(`requirement ${id} not found`);
  return found;
}

function statesOf(entry: Record<string, unknown>, label: string): Record<string, unknown> {
  return asRecord(entry.states, `${label}.states`);
}

function requiredFieldsOf(entry: Record<string, unknown>, label: string): string[] {
  return asStrings(entry.requiredFields, `${label}.requiredFields`);
}

function transitionsOutOf(
  entry: Record<string, unknown>,
  label: string,
): Record<string, unknown>[] {
  return asArray(entry.transitionsOut, `${label}.transitionsOut`).map((transition, index) =>
    asRecord(transition, `${label}.transitionsOut[${String(index)}]`),
  );
}

describe('roll model', () => {
  it('gives the rules boundary the same mechanical result in both modes', () => {
    for (const die of ROLL_DIE_SIDES) {
      const automaticSnapshot = createRollSourceSnapshot({
        dieSides: die,
        modeSnapshot: 'AUTO',
        originatingCommandId: `auto-origin-d${String(die)}`,
        rollRequestId: `auto-request-d${String(die)}`,
      });
      const manualSnapshot = createRollSourceSnapshot({
        dieSides: die,
        modeSnapshot: 'MANUAL',
        originatingCommandId: `manual-origin-d${String(die)}`,
        rollRequestId: `manual-request-d${String(die)}`,
      });

      for (const rawFace of [1, die]) {
        const automatic = resolveAutoRoll(
          {
            request: automaticSnapshot,
            submitCommandId: `auto-submit-d${String(die)}-${String(rawFace)}`,
          },
          null,
          () => rawFace,
        );
        const manual = resolveManualRoll(manualSnapshot, rawFace);
        expect(manual.ok).toBe(true);
        if (!manual.ok) continue;

        expect(automatic.resolution.mechanical).toEqual(manual.resolution.mechanical);
        expect(automatic.resolution.provenance).toEqual({ rollSource: 'AUTO' });
        expect(manual.resolution.provenance).toEqual({ rollSource: 'MANUAL' });
        expect(Object.keys(automatic.resolution.mechanical)).not.toContain('rollSource');
      }
    }
  });

  it('accepts only the four artifact-defined dice', () => {
    expect(ROLL_DIE_SIDES).toEqual([4, 6, 12, 20]);
    for (const sides of ROLL_DIE_SIDES) expect(requireRollDieSides(sides)).toBe(sides);
    for (const invented of [8, 10, 100, '20', null]) {
      expect(() => requireRollDieSides(invented)).toThrow('unrecognized dieSides');
    }
  });

  it('does not coerce or submit a MANUAL value outside the integer face range', () => {
    const snapshot = createRollSourceSnapshot({
      dieSides: 6,
      modeSnapshot: 'MANUAL',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'manual-request-1',
    });

    for (const rawFace of [0, -1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      expect(resolveManualRoll(snapshot, rawFace)).toEqual({
        dieSides: 6,
        ok: false,
        rawFace,
        state: INVALID_RANGE_STATE,
      });
    }
  });

  it('freezes modeSnapshot when the request is created', () => {
    let defaultFutureRollMode: RollMode = 'AUTO';
    const openRequest = createRollSourceSnapshot({
      dieSides: 20,
      modeSnapshot: defaultFutureRollMode,
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    });
    defaultFutureRollMode = 'MANUAL';

    expect(defaultFutureRollMode).toBe('MANUAL');
    expect(openRequest.modeSnapshot).toBe('AUTO');
    expect(Object.isFrozen(openRequest)).toBe(true);
    expectTypeOf(openRequest).toEqualTypeOf<RollSourceSnapshot<'AUTO'>>();

    const compileTimeMutation = (snapshot: RollSourceSnapshot<'AUTO'>): void => {
      // @ts-expect-error A request mode cannot change after MODE_SNAPSHOT.
      snapshot.modeSnapshot = 'MANUAL';
    };
    expect(compileTimeMutation).toBeTypeOf('function');
  });

  it('creates one AUTO receipt and replays the supplied persisted value without rerolling', () => {
    const snapshot = createRollSourceSnapshot({
      dieSides: 20,
      modeSnapshot: 'AUTO',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    });
    const command = { request: snapshot, submitCommandId: 'roll-submit-1' } as const;
    const sampleFace = vi.fn(() => 17);

    const first = resolveAutoRoll(command, null, sampleFace);
    const persistedReceipt = { ...first.randomReceipt };
    const replay = resolveAutoRoll(command, persistedReceipt, sampleFace);
    const jsonReceipt: JsonObject = replay.randomReceipt;

    expect(sampleFace).toHaveBeenCalledTimes(1);
    expect(sampleFace).toHaveBeenCalledWith(20);
    expect(first.kind).toBe('NEW');
    expect(replay.kind).toBe('REPLAY');
    expect(replay.randomReceipt).toEqual(first.randomReceipt);
    expect(jsonReceipt).toEqual(first.randomReceipt);
    expect(replay.resolution).toEqual(first.resolution);
    expect(Object.isFrozen(first.randomReceipt)).toBe(true);
    expect(Object.isFrozen(replay.randomReceipt)).toBe(true);
    persistedReceipt.rawFace = 1;
    expect(replay.randomReceipt.rawFace).toBe(17);
    expect(replay.resolution.mechanical.rawFace).toBe(17);
  });

  it('revalidates a structural snapshot before MANUAL resolution or AUTO sampling', () => {
    const inventedDie = {
      dieSides: 8,
      modeSnapshot: 'MANUAL',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    } as unknown as RollSourceSnapshot<'MANUAL'>;
    expect(() => resolveManualRoll(inventedDie, 4)).toThrow(
      'unrecognized dieSides 8; available: 4, 6, 12, 20',
    );

    const wrongMode = {
      dieSides: 20,
      modeSnapshot: 'MANUAL',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    } as unknown as RollSourceSnapshot<'AUTO'>;
    const sampleFace = vi.fn(() => 17);
    expect(() =>
      resolveAutoRoll({ request: wrongMode, submitCommandId: 'roll-submit-1' }, null, sampleFace),
    ).toThrow('unexpected modeSnapshot "MANUAL"; expected AUTO');
    expect(sampleFace).not.toHaveBeenCalled();
  });

  it('fails closed before RNG when a supplied receipt belongs to another submit command', () => {
    const request = createRollSourceSnapshot({
      dieSides: 6,
      modeSnapshot: 'AUTO',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    });
    const command = { request, submitCommandId: 'roll-submit-1' } as const;
    const sampleFace = vi.fn(() => 4);
    const first = resolveAutoRoll(command, null, sampleFace);

    expect(() =>
      resolveAutoRoll(
        { ...command, submitCommandId: 'roll-submit-2' },
        first.randomReceipt,
        sampleFace,
      ),
    ).toThrow(
      'stored randomReceipt does not match submitCommandId "roll-submit-2", originatingCommandId "origin-command-1", and rollRequestId "roll-request-1"',
    );
    expect(sampleFace).toHaveBeenCalledTimes(1);
  });

  it('fails closed before RNG when a supplied receipt belongs to another originating command', () => {
    const request = createRollSourceSnapshot({
      dieSides: 6,
      modeSnapshot: 'AUTO',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    });
    const command = { request, submitCommandId: 'roll-submit-1' } as const;
    const sampleFace = vi.fn(() => 4);
    const first = resolveAutoRoll(command, null, sampleFace);
    const mismatchedRequest = createRollSourceSnapshot({
      ...request,
      originatingCommandId: 'origin-command-2',
    });

    expect(() =>
      resolveAutoRoll(
        { request: mismatchedRequest, submitCommandId: command.submitCommandId },
        first.randomReceipt,
        sampleFace,
      ),
    ).toThrow(
      'stored randomReceipt does not match submitCommandId "roll-submit-1", originatingCommandId "origin-command-2", and rollRequestId "roll-request-1"',
    );
    expect(sampleFace).toHaveBeenCalledTimes(1);
  });

  it('does not reroll a corrupt stored receipt', () => {
    const snapshot = createRollSourceSnapshot({
      dieSides: 12,
      modeSnapshot: 'AUTO',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    });
    const command = { request: snapshot, submitCommandId: 'roll-submit-1' } as const;
    const sampleFace = vi.fn(() => 7);
    const first = resolveAutoRoll(command, null, sampleFace);
    const corruptReceipt = { ...first.randomReceipt, rawFace: 0 };

    expect(() => resolveAutoRoll(command, corruptReceipt, sampleFace)).toThrow(
      'stored randomReceipt has invalid rawFace 0 for d12',
    );
    expect(sampleFace).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid RNG value without a fallback draw', () => {
    const snapshot = createRollSourceSnapshot({
      dieSides: 4,
      modeSnapshot: 'AUTO',
      originatingCommandId: 'origin-command-1',
      rollRequestId: 'roll-request-1',
    });
    const command = { request: snapshot, submitCommandId: 'roll-submit-1' } as const;
    const sampleFace = vi.fn(() => 5);

    expect(() => resolveAutoRoll(command, null, sampleFace)).toThrow(
      'random source returned invalid rawFace 5 for d4',
    );
    expect(sampleFace).toHaveBeenCalledTimes(1);
  });
});

describe('atlas roll contract', () => {
  const automatic = form('CMB-032');
  const manual = form('CMB-033');
  const automaticFields = requiredFieldsOf(automatic, 'CMB-032');
  const manualFields = requiredFieldsOf(manual, 'CMB-033');

  it('keeps the literal 29/27 envelopes with 26 mode-normalized fields in common', () => {
    const normalizeMode = (field: string): string =>
      field.startsWith('modeSnapshot=') ? 'modeSnapshot' : field;
    const automaticNormalized = automaticFields.map(normalizeMode);
    const manualNormalized = new Set(manualFields.map(normalizeMode));
    const expectedCommon = [
      'rollRequestId',
      'commandId',
      'requestContext=INITIAL_INITIATIVE|REINFORCEMENT|COMBAT_ACTION|PEACE_CHECK|PEACE_ITEM|PEACE_PHARMA|PEACE_ABILITY',
      'originRollKind=ORIGINAL_D20|CRIT_SUCCESS_CONFIRMATION|CRIT_FAILURE_CONFIRMATION|SUBSTITUTION|DAMAGE|PENETRATION|OTHER',
      'rollPurpose',
      'dieSides=4|6|12|20',
      'modeSnapshot',
      'ownerActorId',
      'ownerControllerSeat',
      'seriesIdOrNull',
      'currentEntryIndexOrNull',
      'criticalChainIdOrNull',
      'criticalEligible',
      'symbiontXpEligible',
      'characteristicMarkEligible',
      'originRollIdOrNull',
      'parentOriginRollIdOrNull',
      'returnResolverFormId(server-signed)',
      'sceneContext=PEACE|COMBAT',
      'projectionRole=PLAYER|GM',
      'underlayFormIdOrNull',
      'stateRevision',
      'projectionRevision',
      'status=PENDING|SUBMITTED|CONSUMED',
      'submissionReceiptIdOrNull',
      'commandIdempotencyKey',
    ];

    expect(automaticFields).toHaveLength(29);
    expect(manualFields).toHaveLength(27);
    expect(new Set(automaticFields).size).toBe(29);
    expect(new Set(manualFields).size).toBe(27);
    expect(automaticFields).toContain('modeSnapshot=AUTO');
    expect(automaticFields).not.toContain('modeSnapshot=MANUAL');
    expect(manualFields).toContain('modeSnapshot=MANUAL');
    expect(manualFields).not.toContain('modeSnapshot=AUTO');
    expect(automaticNormalized.filter((field) => manualNormalized.has(field))).toEqual(
      expectedCommon,
    );
    expect(new Set([...automaticNormalized, ...manualFields.map(normalizeMode)]).size).toBe(30);
    expect(automaticNormalized.filter((field) => !manualNormalized.has(field))).toEqual([
      'rawFaceOrNull',
      'shownAtLeastMs=500',
      'randomReceipt',
    ]);
    expect(
      manualFields.map(normalizeMode).filter((field) => !new Set(automaticNormalized).has(field)),
    ).toEqual(['rawFace integer 1..dieSides or null']);
    expect(automaticFields).toContain('dieSides=4|6|12|20');
    expect(manualFields).toContain('dieSides=4|6|12|20');
  });

  it('uses one submit command while preserving the distinct mode states', () => {
    const automaticReferences = asRecord(automatic.references, 'CMB-032.references');
    const manualReferences = asRecord(manual.references, 'CMB-033.references');
    expect(asStrings(automaticReferences.workflowCommandIds, 'CMB-032 commands')).toEqual([
      'UI-CMD-ROLL-SUBMIT',
    ]);
    expect(asStrings(manualReferences.workflowCommandIds, 'CMB-033 commands')).toEqual([
      'UI-CMD-ROLL-SUBMIT',
    ]);

    const automaticStates = statesOf(automatic, 'CMB-032');
    const manualStates = statesOf(manual, 'CMB-033');
    expect(automaticStates.ROLLING).toBe(
      'Один server random receipt создаётся для pending request.',
    );
    expect(automaticStates.RESULT_VISIBLE).toBe('rawFace показан не менее 500 ms.');
    expect(automaticStates.RESOLVED).toBe('Result persisted once; reconnect does not reroll.');
    expect(manualStates.INVALID_RANGE).toBe(
      'Не-целое либо значение вне 1..dieSides не отправляется.',
    );
    expect(manualStates.RESOLVED).toBe('Result persisted once; repeat returns receipt.');
  });

  it('applies REQ-039 reconnect replay to both modes', () => {
    const genericRolls = requirement('REQ-039');
    const formIds = asStrings(genericRolls.formIds, 'REQ-039.formIds');
    expect(formIds).toHaveLength(3);
    expect(formIds.slice(0, 2)).toEqual(['CMB-032', 'CMB-033']);
    expect(asStrings(genericRolls.workflowCommandIds, 'REQ-039.workflowCommandIds')).toEqual([
      'UI-CMD-ROLL-PACKAGE-CREATE',
      'UI-CMD-ROLL-SUBMIT',
    ]);
    expect(
      asStrings(genericRolls.offlineReconnectAssertions, 'REQ-039.offlineReconnectAssertions'),
    ).toContain(
      'Committed command restores by commandId with the same receipt/random result and no duplicate side effect.',
    );

    expect(requirement('REQ-040').requirement).toBe('Critical success/failure chains and effects');
    expect(asStrings(requirement('REQ-066').workflowCommandIds, 'REQ-066 commands')).toEqual([
      'UI-CMD-ROLL-SUBMIT',
    ]);
  });

  it('keeps campaign defaults future-only and locks creation mode after a result', () => {
    const campaign = form('CMP-004');
    expect(requiredFieldsOf(campaign, 'CMP-004')).toEqual([
      'campaignDraftId',
      'defaultFutureRollMode=MANUAL|AUTO',
      'openRollRequestsUnaffected=true',
      'rulesetSelection=absent',
      'draftRevision',
    ]);
    expect(campaign.purpose).toBe(
      'Начальный physical/virtual mode для новых roll requests; правила игры не меняются.',
    );
    expect(statesOf(campaign, 'CMP-004').OPEN_REQUESTS_UNCHANGED).toBe(
      'Существующие request snapshots не меняются.',
    );

    const creation = form('CHR-036');
    expect(requiredFieldsOf(creation, 'CHR-036')).toContain('diceInputMode=AUTO|MANUAL');
    expect(requiredFieldsOf(creation, 'CHR-036')).toContain('appliesToAllCreationRolls=true');
    expect(statesOf(creation, 'CHR-036').LOCKED_AFTER_RESULT).toBe(
      'Back cannot change mode after the first shown result.',
    );
  });

  it('keeps success and failure chains limited to eligible ORIGINAL D20 rolls', () => {
    const success = form('CMB-034');
    const failure = form('CMB-035');
    expect(success.purpose).toBe(
      'Цепочка подтверждения критического успеха запускается только для criticalEligible ORIGINAL D20 с rawFace=20; доменный requestContext сохраняется отдельно, а каждый следующий CRITICAL_CONFIRMATION request имеет собственный MANUAL/AUTO snapshot и parentOriginRollId. D4/D6/D12, confirmation и substitution не создают новую цепочку или XP.',
    );
    expect(failure.purpose).toBe(
      'Цепочка подтверждения критического провала запускается только для criticalEligible ORIGINAL D20 с rawFace=1; доменный requestContext сохраняется отдельно, а каждый следующий CRITICAL_CONFIRMATION request имеет собственный MANUAL/AUTO snapshot и parentOriginRollId. D4/D6/D12, confirmation и substitution не создают новую цепочку или XP.',
    );
    expect(requiredFieldsOf(success, 'CMB-034')).toContain('originalRawFace=20');
    expect(requiredFieldsOf(failure, 'CMB-035')).toContain('originalRawFace=1');
    expect(requiredFieldsOf(success, 'CMB-034')).toContain('chainType=SUCCESS');
    expect(requiredFieldsOf(failure, 'CMB-035')).toContain('chainType=FAILURE');
    expect(requiredFieldsOf(success, 'CMB-034')).toContain('chainStatus=PENDING_ROLL|RESOLVED');
    expect(requiredFieldsOf(failure, 'CMB-035')).toContain('chainStatus=PENDING_ROLL|RESOLVED');
    expect(requiredFieldsOf(success, 'CMB-034')).toContain(
      'pendingConfirmationModeSnapshot=AUTO|MANUAL|null',
    );
    expect(requiredFieldsOf(failure, 'CMB-035')).toContain(
      'pendingConfirmationModeSnapshot=AUTO|MANUAL|null',
    );
    expect(automaticFields).toContain('parentOriginRollIdOrNull');
    expect(manualFields).toContain('parentOriginRollIdOrNull');

    for (const [source, mode] of [
      [automatic, 'AUTO'],
      [manual, 'MANUAL'],
    ] as const) {
      const transitions = transitionsOutOf(source, `CMB roll ${mode}`);
      const successGuard = transitions.find((transition) => transition.to === 'CMB-034')?.guard;
      const failureGuard = transitions.find((transition) => transition.to === 'CMB-035')?.guard;
      expect(asString(successGuard, `${mode} success guard`)).toContain(
        `submitted modeSnapshot=${mode}; request owner plus immutable requestContext/originRollKind confirmed; ((originRollKind=ORIGINAL_D20 and dieSides=20 and criticalEligible=true and rawFace=20 and criticalChainId created once)`,
      );
      expect(asString(failureGuard, `${mode} failure guard`)).toContain(
        `submitted modeSnapshot=${mode}; request owner plus immutable requestContext/originRollKind confirmed; ((originRollKind=ORIGINAL_D20 and dieSides=20 and criticalEligible=true and rawFace=1 and criticalChainId created once)`,
      );
      expect(asString(successGuard, `${mode} success guard`)).toContain(
        'confirmation never creates XP or another chain',
      );
      expect(asString(failureGuard, `${mode} failure guard`)).toContain(
        'confirmation never creates XP or another chain',
      );
    }

    for (const chain of [success, failure]) {
      const transitions = transitionsOutOf(chain, asString(chain.id, 'critical chain id'));
      const automaticConfirmation = transitions.find((transition) => transition.to === 'CMB-032');
      const manualConfirmation = transitions.find((transition) => transition.to === 'CMB-033');
      expect(asString(automaticConfirmation?.guard, 'AUTO confirmation guard')).toContain(
        'pendingConfirmationModeSnapshot=AUTO; same originContext/seriesId/commandId',
      );
      expect(asString(manualConfirmation?.guard, 'MANUAL confirmation guard')).toContain(
        'pendingConfirmationModeSnapshot=MANUAL; same originContext/seriesId/commandId',
      );
    }
  });

  it('keeps MODE_SNAPSHOT and REPLAY_RECEIPT in the rollRequest lifecycle', () => {
    const rollRequest = lifecycles.find((entry) => entry.entity === 'rollRequest');
    if (rollRequest === undefined) throw new Error('rollRequest lifecycle not found');
    expect(asStrings(rollRequest.states, 'rollRequest.states')).toEqual([
      'CREATED',
      'MODE_SNAPSHOT',
      'ROLLED',
      'CONFIRMING_CRIT',
      'RESOLVED',
      'REPLAY_RECEIPT',
    ]);
  });

  it('keeps rollSource required for audit but neutral for the result', () => {
    const fields = asArray(
      readJson('generated/spec/character/xp-runtime/xp-event-fields.json'),
      'xp event fields',
    ).map((entry, index) => asRecord(entry, `xp event fields[${String(index)}]`));
    const rollSource = fields.find((entry) => entry.Field === 'rollSource');
    if (rollSource === undefined) throw new Error('rollSource field not found');

    expect(rollSource).toMatchObject({
      'Data type': 'enum',
      Purpose: 'Источник броска не меняет результат.',
      Required: true,
      'Rule IDs': 'CORE-229; SYM-021; USR-2026-07-30-XP-001',
      'Validation / constraint': 'AUTO|MANUAL.',
    });
  });
});
