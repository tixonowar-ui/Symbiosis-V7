import type { CharacterOperationId } from '@generated/types/character.js';
import type { EffectOperationId } from '@generated/types/effects.js';
import type { ItemOperationId } from '@generated/types/items.js';
import { ACTIVE_RULE_IDS, TOMBSTONE_RULE_IDS } from '@generated/types/rules.js';
import type { RuleId } from '@generated/types/rules.js';

/** Every operation identity exported from the three artifact-owned catalogs. */
export type OperationId = CharacterOperationId | EffectOperationId | ItemOperationId;

/** Input and output stay caller-owned until concrete operation and rule contracts exist. */
export type Handler<Input, Output> = (input: Input) => Output;

export class HandlerRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DuplicateOperationHandlerError extends HandlerRegistryError {
  readonly operationId: OperationId;

  constructor(operationId: OperationId) {
    super(`handler already registered for operation ${JSON.stringify(operationId)}`);
    this.operationId = operationId;
  }
}

export class UnregisteredOperationHandlerError extends HandlerRegistryError {
  readonly operationId: OperationId;

  constructor(operationId: OperationId) {
    super(`no handler registered for operation ${JSON.stringify(operationId)}`);
    this.operationId = operationId;
  }
}

export class DuplicateRuleHandlerError extends HandlerRegistryError {
  readonly ruleId: RuleId;

  constructor(ruleId: RuleId) {
    super(`handler already registered for active rule ${JSON.stringify(ruleId)}`);
    this.ruleId = ruleId;
  }
}

export class UnregisteredRuleHandlerError extends HandlerRegistryError {
  readonly ruleId: RuleId;

  constructor(ruleId: RuleId) {
    super(`no handler registered for active rule ${JSON.stringify(ruleId)}`);
    this.ruleId = ruleId;
  }
}

export class TombstoneRuleError extends HandlerRegistryError {
  readonly action: 'dispatch' | 'register';
  readonly ruleId: RuleId;

  constructor(ruleId: RuleId, action: 'dispatch' | 'register') {
    super(
      action === 'register'
        ? `cannot register a handler for tombstone rule ${JSON.stringify(ruleId)}: the rule exists and is not automated`
        : `cannot dispatch tombstone rule ${JSON.stringify(ruleId)}: the rule exists and is not automated`,
    );
    this.action = action;
    this.ruleId = ruleId;
  }
}

const activeRuleIds = new Set<RuleId>(ACTIVE_RULE_IDS);
const tombstoneRuleIds = new Set<RuleId>(TOMBSTONE_RULE_IDS);

function requireActiveRule(ruleId: RuleId, action: 'dispatch' | 'register'): void {
  // Tombstone wins if generated catalogs ever overlap: refusing is the safe outcome.
  if (tombstoneRuleIds.has(ruleId)) throw new TombstoneRuleError(ruleId, action);
  if (!activeRuleIds.has(ruleId)) {
    throw new HandlerRegistryError(
      `rule ${JSON.stringify(ruleId)} is absent from both generated rule catalogs`,
    );
  }
}

export class OperationHandlerRegistry<Input = unknown, Output = unknown> {
  readonly #handlers = new Map<OperationId, Handler<Input, Output>>();

  register(operationId: OperationId, handler: Handler<Input, Output>): void {
    if (this.#handlers.has(operationId)) {
      throw new DuplicateOperationHandlerError(operationId);
    }
    this.#handlers.set(operationId, handler);
  }

  dispatch(operationId: OperationId, input: Input): Output {
    const handler = this.#handlers.get(operationId);
    if (handler === undefined) throw new UnregisteredOperationHandlerError(operationId);
    return handler(input);
  }
}

export class RuleHandlerRegistry<Input = unknown, Output = unknown> {
  readonly #handlers = new Map<RuleId, Handler<Input, Output>>();

  register(ruleId: RuleId, handler: Handler<Input, Output>): void {
    requireActiveRule(ruleId, 'register');
    if (this.#handlers.has(ruleId)) throw new DuplicateRuleHandlerError(ruleId);
    this.#handlers.set(ruleId, handler);
  }

  dispatch(ruleId: RuleId, input: Input): Output {
    requireActiveRule(ruleId, 'dispatch');
    const handler = this.#handlers.get(ruleId);
    if (handler === undefined) throw new UnregisteredRuleHandlerError(ruleId);
    return handler(input);
  }
}
