import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0078QueueSources,
  assertAdr0078QueueSourcesMarkdown,
} from './queue-source-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const record = (value: unknown) => value as JsonObject;
function changed(target: 'forms' | 'workflowCommands', id: string) {
  const root = { ...source };
  const container =
    target === 'workflowCommands'
      ? (root['registryCoverage'] = { ...record(source['registryCoverage']) })
      : root;
  const key = target === 'forms' ? 'id' : 'commandId';
  const rows = (container[target] as JsonObject[]).map((row) =>
    row[key] === id ? structuredClone(row) : row,
  );
  container[target] = rows;
  const row = rows.find((row) => row[key] === id);
  if (row === undefined) throw new Error('Missing accepted source ' + id);
  return { root, row };
}

describe('ADR 0078 approved source closure', () => {
  it('accepts the supplied JSON and independent Markdown companion', () => {
    expect(() => assertAdr0078QueueSources(source)).not.toThrow();
    expect(() => assertAdr0078QueueSourcesMarkdown(markdown)).not.toThrow();
  });
  it.each([
    ['NET-016', 'initialTimeLockOrNull'],
    ['NPC-016', 'calendarTimeBindingOrNull'],
    ['NPC-017', 'initialTimeValidationStatus'],
    ['GM-002', 'selectedCharacterOrNull'],
  ])('rejects removal of the meaningful absence/time field %s %s', (id, field) => {
    const { root, row } = changed('forms', id);
    const fields = row['requiredFields'] as string[];
    const selected = fields.filter((value) => value.startsWith(field));
    expect(selected).toHaveLength(1);
    row['requiredFields'] = fields.filter((value) => !value.startsWith(field));
    expect(() => assertAdr0078QueueSources(root)).toThrow(id);
  });
  it('rejects restoring selected-character prerequisites to the empty import panel', () => {
    const { root, row } = changed('forms', 'GM-002');
    (row['requiredFields'] as string[]).push('HP', 'groupId', 'mapMarkerId', 'controllerSeat');
    expect(() => assertAdr0078QueueSources(root)).toThrow('GM-002');
  });
  it.each([
    'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    'UI-CMD-NPC-COMMIT-V1',
    'UI-CMD-NPC-NEW-VERSION',
    'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
  ])('rejects repeat mutation instead of the approved receipt on %s', (id) => {
    const { root, row } = changed('workflowCommands', id);
    row['reconnect'] = 'repeat mutation with new identities';
    expect(() => assertAdr0078QueueSources(root)).toThrow('registryCoverage');
  });
  it.each(['NET-016', 'NPC-016', 'NPC-017', 'GM-002'])(
    'rejects an unguarded route/authority grant on %s',
    (id) => {
      const { root, row } = changed('forms', id);
      const actions = record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[];
      expect(actions.length).toBeGreaterThan(0);
      actions[0]!['guard'] = 'true; client supplies GM authority';
      expect(() => assertAdr0078QueueSources(root)).toThrow(id);
    },
  );
  it.each(['### NET-016 —', '### NPC-017 —', '### GM-002 —', '### PLY-030 —'])(
    'rejects an independent Markdown field/control drift at %s',
    (prefix) => {
      const offset = markdown.indexOf(prefix);
      expect(offset).toBeGreaterThanOrEqual(0);
      const altered =
        markdown.slice(0, offset) + markdown.slice(offset).replace(' |', ' changed |');
      expect(() => assertAdr0078QueueSourcesMarkdown(altered)).toThrow();
    },
  );
});
