import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACTIVE_RULE_IDS, TOMBSTONE_RULE_IDS } from '@generated/types/rules.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const CHARACTER_ACTORS = [
  'GM',
  'PLAYER',
  'PLAYER_OR_GM',
  'PLAYER_OR_SYSTEM',
  'SYSTEM',
  'SYSTEM_WITH_GM_CONFIRMATION',
] as const;

const ITEM_ACTORS = [
  'Игрок',
  'Игрок/НПС',
  'Игрок/мастер',
  'Игрок/мастер НПС',
  'Мастер',
  'Система',
  'Система/мастер',
] as const;

const NON_RULE_SOURCE_TOKENS = [
  'CQA-009\nCORE-204',
  'Manifest v1.2',
  'Q-APP-001',
  'Q-APP-002',
  'Q-CORE-024',
  'Q-CORE-051',
  'Q-CORE-061',
  'Q-ENEMY-B14',
  'Q-GM-XP-001',
  'USR-2026-07-30-WEB-001',
  'USR-2026-07-30-XP-001',
] as const;

const CHARACTER_ERROR_CODES = [
  'ERR_ACTION_COST',
  'ERR_ACTOR_TYPE',
  'ERR_AWARD_ID_CONFLICT',
  'ERR_BRANCH_LOCK',
  'ERR_CONTEXT_FORBIDDEN',
  'ERR_DUPLICATE_ORIGIN_ROLL',
  'ERR_DUPLICATE_SPECIES',
  'ERR_ENTITY_KIND',
  'ERR_FOREIGN_KEY',
  'ERR_FORWARD_COMPATIBILITY',
  'ERR_GENERATOR_RANGE',
  'ERR_GM_CONFIRMATION',
  'ERR_GROUP_SNAPSHOT',
  'ERR_INCOMPATIBILITY',
  'ERR_NODE_REF',
  'ERR_NONE',
  'ERR_NOT_CHIMERA',
  'ERR_OPERATION_CONFLICT',
  'ERR_OPERATION_IMMUTABLE',
  'ERR_PRECONDITION',
  'ERR_PREREQUISITE',
  'ERR_RACE',
  'ERR_RACE_CLASS',
  'ERR_REASON_REQUIRED',
  'ERR_RESOURCE',
  'ERR_REST_COOLDOWN',
  'ERR_REST_INCOMPLETE',
  'ERR_RUNTIME_PACK_SHA',
  'ERR_RUNTIME_PACK_VERSION',
  'ERR_SEED_EXHAUSTED',
  'ERR_SKILL_CAPACITY',
  'ERR_SKILL_KEY',
  'ERR_SKILL_REQ',
  'ERR_SKILL_SLOTS',
  'ERR_SLOT_CAPACITY',
  'ERR_SLOT_LIMIT',
  'ERR_STATS',
  'ERR_STAT_CAP',
  'ERR_SYMBIONT_NOT_OWNED',
  'ERR_SYMBIONT_SET',
  'ERR_TARGET',
  'ERR_TARGET_CONSENT',
  'ERR_TARGET_TOTAL',
  'ERR_TEMPLATE_INVARIANT',
  'ERR_UNCONFIRMED_DEVOURING',
  'ERR_XP',
  'ERR_XP_AMOUNT',
  'ERR_XP_EVENT_INVALID',
  'ERR_XP_INELIGIBLE',
  'ERR_XP_NOT_AVAILABLE',
  'ERR_XP_POLICY',
] as const;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8')) as unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => asRecord(entry, `${label}[${String(index)}]`));
}

function asStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return value;
}

function stringField(row: Record<string, unknown>, name: string, label: string): string {
  const value = row[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label}.${name} must be a non-empty string`);
  }
  return value;
}

function semicolonTokens(value: string, label: string): string[] {
  const tokens = value.split(';').map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) {
    throw new Error(`${label} contains an empty semicolon token`);
  }
  return tokens;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

const characterOperations = asRecords(
  readJson('generated/spec/character/operations.json'),
  'character operations',
);
const itemOperations = asRecords(
  readJson('generated/spec/items/operations.json'),
  'item operations',
);
const effectOperations = asRecords(
  readJson('generated/spec/effects/operations.json'),
  'effect operations',
);
const formsById = asRecord(readJson('generated/spec/atlas/forms-by-id.json'), 'atlas forms-by-id');

describe('handler registry artifact contract', () => {
  it('keeps all 70 generated operation identities addressable without merging descriptors', () => {
    const operationIds = [...characterOperations, ...itemOperations, ...effectOperations].map(
      (row, index) => stringField(row, 'OperationID', `operation ${String(index)}`),
    );
    const formOperationIds = new Set(
      Object.entries(formsById).flatMap(([formId, value]) => {
        const references = asRecord(asRecord(value, formId).references, `${formId}.references`);
        return asStrings(references.operationIds, `${formId}.references.operationIds`);
      }),
    );

    expect(characterOperations).toHaveLength(16);
    expect(itemOperations).toHaveLength(29);
    expect(effectOperations).toHaveLength(25);
    expect(new Set(operationIds)).toHaveProperty('size', 70);
    expect(sorted(formOperationIds)).toEqual(sorted(operationIds));
  });

  it('keeps the two actor vocabularies literal and separate', () => {
    const characterActors = new Set(
      characterOperations.map((row, index) =>
        stringField(row, 'Actor', `character operation ${String(index)}`),
      ),
    );
    const itemActors = new Set(
      itemOperations.map((row, index) =>
        stringField(row, 'Actor', `item operation ${String(index)}`),
      ),
    );

    expect(sorted(characterActors)).toEqual(sorted(CHARACTER_ACTORS));
    expect(sorted(itemActors)).toEqual(sorted(ITEM_ACTORS));
    expect(new Set([...characterActors, ...itemActors])).toHaveProperty('size', 13);
  });

  it('keeps the exact source-token exceptions and fails on a twelfth', () => {
    const activeRuleIds = new Set<string>(ACTIVE_RULE_IDS);
    const tombstoneRuleIds = new Set<string>(TOMBSTONE_RULE_IDS);
    const sourceTokens = new Set(
      [...characterOperations, ...itemOperations].flatMap((row, index) =>
        semicolonTokens(
          stringField(row, 'Rule IDs / source', `prefixed operation ${String(index)}`),
          `prefixed operation ${String(index)}.Rule IDs / source`,
        ),
      ),
    );
    const exceptions = [...sourceTokens].filter((token) => !activeRuleIds.has(token));

    expect(sourceTokens).toHaveProperty('size', 82);
    expect(sorted(exceptions)).toEqual(sorted(NON_RULE_SOURCE_TOKENS));
    expect(exceptions.some((token) => tombstoneRuleIds.has(token))).toBe(false);
  });

  it('keeps the 51 Character error codes artifact-owned', () => {
    const errorCodes = new Set(
      characterOperations.flatMap((row, index) =>
        semicolonTokens(
          stringField(row, 'Error codes', `character operation ${String(index)}`),
          `character operation ${String(index)}.Error codes`,
        ),
      ),
    );

    expect(sorted(errorCodes)).toEqual(sorted(CHARACTER_ERROR_CODES));
  });

  it('keeps rules separate from form entry points', () => {
    const formRuleIds = new Set(
      Object.entries(formsById).flatMap(([formId, value]) => {
        const references = asRecord(asRecord(value, formId).references, `${formId}.references`);
        return asStrings(references.ruleIds, `${formId}.references.ruleIds`);
      }),
    );
    const mentionedActiveRuleIds = ACTIVE_RULE_IDS.filter((ruleId) => formRuleIds.has(ruleId));

    expect(ACTIVE_RULE_IDS).toHaveLength(699);
    expect(TOMBSTONE_RULE_IDS).toHaveLength(40);
    expect(mentionedActiveRuleIds).toHaveLength(198);
    expect(ACTIVE_RULE_IDS.length - mentionedActiveRuleIds.length).toBe(501);
    expect(sorted(formRuleIds)).toEqual(sorted(mentionedActiveRuleIds));
  });
});
