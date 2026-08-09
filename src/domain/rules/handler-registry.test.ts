import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { CharacterOperationId } from '@generated/types/character.js';
import type { EffectOperationId } from '@generated/types/effects.js';
import type { ItemOperationId } from '@generated/types/items.js';
import { ACTIVE_RULE_IDS, TOMBSTONE_RULE_IDS } from '@generated/types/rules.js';
import type { RuleId } from '@generated/types/rules.js';
import {
  DuplicateOperationHandlerError,
  DuplicateRuleHandlerError,
  OperationHandlerRegistry,
  RuleHandlerRegistry,
  TombstoneRuleError,
  UnregisteredOperationHandlerError,
  UnregisteredRuleHandlerError,
} from './handler-registry.js';
import type { OperationId } from './handler-registry.js';

function first<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (value === undefined) throw new Error(`${label} must not be empty`);
  return value;
}

const activeRuleId = first(ACTIVE_RULE_IDS, 'ACTIVE_RULE_IDS');
const tombstoneRuleId = first(TOMBSTONE_RULE_IDS, 'TOMBSTONE_RULE_IDS');

describe('operation handler registry', () => {
  it('dispatches handlers for all three generated operation ID families', () => {
    const registry = new OperationHandlerRegistry<number, string>();
    registry.register('OP-CHAR-CREATE', (value) => `character:${String(value)}`);
    registry.register('OP-EQUIP', (value) => `item:${String(value)}`);
    registry.register('APPLY_EFFECT', (value) => `effect:${String(value)}`);

    expect(registry.dispatch('OP-CHAR-CREATE', 1)).toBe('character:1');
    expect(registry.dispatch('OP-EQUIP', 2)).toBe('item:2');
    expect(registry.dispatch('APPLY_EFFECT', 3)).toBe('effect:3');
    expectTypeOf<OperationId>().toEqualTypeOf<
      CharacterOperationId | EffectOperationId | ItemOperationId
    >();
  });

  it('rejects an unregistered operation with its exact ID', () => {
    const registry = new OperationHandlerRegistry<number, number>();

    expect(() => registry.dispatch('APPLY_EFFECT', 1)).toThrowError(
      UnregisteredOperationHandlerError,
    );
    expect(() => registry.dispatch('APPLY_EFFECT', 1)).toThrow(
      'no handler registered for operation "APPLY_EFFECT"',
    );
  });

  it('rejects duplicate registration without replacing the first handler', () => {
    const registry = new OperationHandlerRegistry<number, number>();
    const firstHandler = vi.fn((value: number) => value + 1);
    const replacement = vi.fn((value: number) => value + 2);
    registry.register('OP-CHAR-CREATE', firstHandler);

    expect(() => registry.register('OP-CHAR-CREATE', replacement)).toThrowError(
      DuplicateOperationHandlerError,
    );
    expect(registry.dispatch('OP-CHAR-CREATE', 4)).toBe(5);
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });
});

describe('rule handler registry', () => {
  it('dispatches a registered active rule handler', () => {
    const registry = new RuleHandlerRegistry<number, number>();
    const handler = vi.fn((value: number) => value + 1);
    registry.register(activeRuleId, handler);

    expect(registry.dispatch(activeRuleId, 4)).toBe(5);
    expect(handler).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('rejects duplicate registration without replacing the first handler', () => {
    const registry = new RuleHandlerRegistry<number, number>();
    const firstHandler = vi.fn((value: number) => value + 1);
    const replacement = vi.fn((value: number) => value + 2);
    registry.register(activeRuleId, firstHandler);

    expect(() => registry.register(activeRuleId, replacement)).toThrowError(
      DuplicateRuleHandlerError,
    );
    expect(registry.dispatch(activeRuleId, 4)).toBe(5);
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it('distinguishes an unregistered active rule from a tombstone', () => {
    const registry = new RuleHandlerRegistry<number, number>();

    expect(() => registry.dispatch(activeRuleId, 1)).toThrowError(UnregisteredRuleHandlerError);
    expect(() => registry.dispatch(activeRuleId, 1)).toThrow(
      `no handler registered for active rule ${JSON.stringify(activeRuleId)}`,
    );
    expect(() => registry.dispatch(tombstoneRuleId, 1)).toThrowError(TombstoneRuleError);
    expect(() => registry.dispatch(tombstoneRuleId, 1)).toThrow(
      `cannot dispatch tombstone rule ${JSON.stringify(tombstoneRuleId)}: the rule exists and is not automated`,
    );
  });

  it('rejects registration for a tombstone rule', () => {
    const registry = new RuleHandlerRegistry<number, number>();

    expect(() => registry.register(tombstoneRuleId, (value) => value)).toThrowError(
      TombstoneRuleError,
    );
    expect(() => registry.register(tombstoneRuleId, (value) => value)).toThrow(
      `cannot register a handler for tombstone rule ${JSON.stringify(tombstoneRuleId)}: the rule exists and is not automated`,
    );
  });

  it('fails closed if an erased value is absent from both generated rule catalogs', () => {
    const registry = new RuleHandlerRegistry<number, number>();
    const erasedValue = 'not-in-generated-catalog' as RuleId;

    expect(() => registry.dispatch(erasedValue, 1)).toThrow(
      'rule "not-in-generated-catalog" is absent from both generated rule catalogs',
    );
  });
});

describe('handler registry types', () => {
  it('rejects identifiers outside generated catalogs at compile time', () => {
    const operationRegistry = new OperationHandlerRegistry<number, number>();
    const ruleRegistry = new RuleHandlerRegistry<number, number>();
    const compileTimeOnly = (): void => {
      // @ts-expect-error Operation registration accepts only generated operation IDs.
      operationRegistry.register('not-in-generated-catalog', (value) => value);
      // @ts-expect-error Rule registration accepts only generated RuleId values.
      ruleRegistry.register('not-in-generated-catalog', (value) => value);
    };

    expect(compileTimeOnly).toBeTypeOf('function');
  });
});
