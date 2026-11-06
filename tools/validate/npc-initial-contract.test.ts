import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT, SPEC_DIR } from '../import/lib/paths.js';
import type { JsonObject, JsonValue } from '../import/lib/json.js';
import { validateNpcInitialStateContracts } from './npc-initial-contract.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const spec = <T>(relative: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'atlas', relative), 'utf8')) as T;
const generated: JsonObject = {
  counts: spec<JsonObject>('meta.json')['counts'],
  forms: Object.values(spec<Record<string, JsonObject>>('forms-by-id.json')),
  transitions: spec<JsonValue[]>('transitions.json'),
  journeys: spec<JsonValue[]>('journeys.json'),
  coverageRequirements: spec<JsonValue[]>('requirements.json'),
  qaScenarios: spec<JsonValue[]>('qa-scenarios.json'),
  workflowCommands: spec<JsonValue[]>('workflow-commands.json'),
  globalContracts: spec<JsonValue[]>('global-contracts.json'),
};
function changedRow(
  input: JsonObject,
  collection: string,
  key: string,
  id: string,
  change: (row: JsonObject) => void,
): JsonObject {
  let found = 0;
  const rows = (input[collection] as JsonObject[]).map((row) => {
    if (row[key] !== id) return row;
    found++;
    const altered = structuredClone(row);
    change(altered);
    return altered;
  });
  expect(found).toBe(1);
  return { ...input, [collection]: rows };
}

describe('standalone validation of delivered and generated NPC initial-state contracts', () => {
  it('accepts the real independently emitted contract and Markdown', () => {
    expect(() => validateNpcInitialStateContracts(source, generated, markdown)).not.toThrow();
  });
  it.each(['ADR0085', 'ADR0086'])(
    'rejects generated-only %s state clauses even when generic QA mirrors are unchanged',
    (prefix) => {
      const modified = changedRow(generated, 'forms', 'id', 'NPC-016', (row) => {
        row['acceptanceCriteria'] = (row['acceptanceCriteria'] as string[]).filter(
          (clause) => !clause.startsWith(prefix),
        );
      });
      expect(() => validateNpcInitialStateContracts(source, modified, markdown)).toThrow('NPC-016');
    },
  );
  it.each(['LIFE_STATE_VALID', 'TEMPORARY_WEAVER_VALID'])(
    'rejects generated-only %s readiness drift',
    (state) => {
      const modified = changedRow(generated, 'forms', 'id', 'NPC-016', (row) => {
        (row['states'] as JsonObject)[state] = 'Always ready';
      });
      expect(() => validateNpcInitialStateContracts(source, modified, markdown)).toThrow('NPC-016');
    },
  );
  it.each([
    ['workflowCommands', 'commandId', 'UI-CMD-NPC-NEW-VERSION', 'guards'],
    ['journeys', 'id', 'J-NPC-CREATE', 'title'],
    ['coverageRequirements', 'requirementId', 'REQ-012', 'happyPath'],
    ['qaScenarios', 'qaId', 'QA-FORM-NPC-016', 'expected'],
  ])(
    'rejects stale generated %s independently of exact source bytes',
    (collection, key, id, field) => {
      const modified = changedRow(generated, collection, key, id, (row) => {
        row[field] = 'Changed generated contract';
      });
      expect(() => validateNpcInitialStateContracts(source, modified, markdown)).toThrow();
    },
  );
  it('checks emitted global contracts and refuses duplicate rows or missing output without source fallback', () => {
    const contracts = generated['globalContracts'] as JsonObject[];
    expect(contracts.length).toBeGreaterThan(0);
    const first = contracts[0]!;
    for (const globalContracts of [
      undefined,
      [],
      [...contracts, first],
      [{ ...first, extraField: true }, ...contracts.slice(1)],
      [{ ...first, value: 'Changed generated global contract' }, ...contracts.slice(1)],
    ])
      expect(() =>
        validateNpcInitialStateContracts(source, { ...generated, globalContracts }, markdown),
      ).toThrow();
    expect(() =>
      validateNpcInitialStateContracts(source, { ...generated, forms: undefined }, markdown),
    ).toThrow();
  });
  it('checks source and Markdown separately even if generated output is still exact', () => {
    const alteredSource = changedRow(source, 'forms', 'id', 'NPC-016', (row) => {
      row['acceptanceCriteria'] = [];
    });
    expect(() => validateNpcInitialStateContracts(alteredSource, generated, markdown)).toThrow(
      'NPC-016',
    );
    const changed = markdown.replace('ADR0086 formal duration:', 'Unapproved duration:');
    expect(changed).not.toBe(markdown);
    expect(() => validateNpcInitialStateContracts(source, generated, changed)).toThrow(
      /atlas ADR 008[56]/,
    );
  });
});
