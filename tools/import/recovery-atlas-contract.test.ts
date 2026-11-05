import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertAdr0080Recovery, assertAdr0080RecoveryMarkdown } from './recovery-atlas-contract.js';
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

describe('ADR 0080 approved frozen master recovery source', () => {
  it('accepts the exact JSON and independently supplied Markdown', () => {
    expect(() => assertAdr0080Recovery(source)).not.toThrow();
    expect(() => assertAdr0080RecoveryMarkdown(markdown)).not.toThrow();
  });
  it.each(['checkpointCompleteness=', 'historyCompatibility=', 'authorityFenceStatus='])(
    'refuses omission of the frozen recovery evidence field %s',
    (prefix) => {
      const { root, row } = changed('forms', 'NET-026');
      const fields = row['requiredFields'] as string[];
      expect(fields.filter((value) => value.startsWith(prefix))).toHaveLength(1);
      row['requiredFields'] = fields.filter((value) => !value.startsWith(prefix));
      expect(() => assertAdr0080Recovery(root)).toThrow('NET-026');
    },
  );
  it('refuses password knowledge as an authority grant on recovery entry', () => {
    const { root, row } = changed('forms', 'NET-026');
    expect(Array.isArray(row['entryConditions'])).toBe(true);
    row['entryConditions'] = [
      'Knowing the current GM password immediately grants gameplay authority.',
    ];
    expect(() => assertAdr0080Recovery(root)).toThrow('NET-026');
  });
  it('refuses automatic checkpoint selection when history or fencing is insufficient', () => {
    const { root, row } = changed('forms', 'NET-026');
    expect(typeof record(row['states'])['PROOF_BLOCKED']).toBe('string');
    record(row['states'])['PROOF_BLOCKED'] =
      'Pick the newest local checkpoint and unfreeze automatically.';
    expect(() => assertAdr0080Recovery(root)).toThrow('NET-026');
  });
  it.each([
    [
      'UI-CMD-MASTER-TRANSFER-UNLOCK',
      'guards',
      'Password alone permits recovery; ignore missing receipts and unresolved fencing.',
    ],
    [
      'UI-CMD-MASTER-TRANSFER-COMMIT',
      'guards',
      'A successor can grant itself authority before fencing or checkpoint acknowledgement.',
    ],
    [
      'UI-CMD-MASTER-TRANSFER-COMMIT',
      'atomicity',
      'Discard checkpointed unfinished operations and manufacture a new gameplay receipt.',
    ],
    [
      'UI-CMD-MASTER-TRANSFER-CANCEL',
      'atomicity',
      'Cancellation unfreezes FROZEN_RECOVERY and restores gameplay without a common commit.',
    ],
  ])('refuses recovery authority or history drift of %s / %s', (id, field, replacement) => {
    const { root, row } = changed('workflowCommands', id);
    expect(typeof row[field]).toBe('string');
    row[field] = replacement;
    expect(() => assertAdr0080Recovery(root)).toThrow('registryCoverage');
  });
  it('refuses expanding scoped checkpoint evidence into GM-private gameplay data', () => {
    const { root, row } = changed('forms', 'CMP-010');
    expect(typeof record(row['projection'])['controller']).toBe('string');
    record(row['projection'])['controller'] =
      'FROZEN_RECOVERY_READ_ONLY includes GM private sheets, password verifier and gameplay commands.';
    expect(() => assertAdr0080Recovery(root)).toThrow('CMP-010');
  });
  it('refuses reusing the recovery exception for ordinary GM pending-operation access', () => {
    const { root, row } = changed('forms', 'CMP-010');
    expect(Array.isArray(row['guardStates'])).toBe(true);
    row['guardStates'] = [
      'Every ordinary GM view may ignore pending operations and conflicting writes.',
    ];
    expect(() => assertAdr0080Recovery(root)).toThrow('CMP-010');
  });
  it('refuses granting a frozen initiator GM access from its terminal receipt', () => {
    const { root, row } = changed('forms', 'NET-025');
    const actions = record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[];
    const matches = actions.filter((action) => action['actionKey'] === 'NET-025::CTA::008');
    expect(matches).toHaveLength(1);
    matches[0]!['targetFormId'] = 'GM-001';
    matches[0]!['guard'] = 'DECLINE or CANCEL grants the recovery initiator GM authority.';
    expect(() => assertAdr0080Recovery(root)).toThrow('NET-025');
  });
  it('refuses forgetting frozen recovery mode on a safe exit', () => {
    const { root, row } = changed('forms', 'NET-024');
    const actions = record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[];
    const matches = actions.filter((action) => action['actionKey'] === 'NET-024::CTA::005');
    expect(matches).toHaveLength(1);
    matches[0]!['guard'] = 'Navigation unfreezes the campaign without a confirmed common commit.';
    expect(() => assertAdr0080Recovery(root)).toThrow('NET-024');
  });
  it.each([
    [
      '### NET-026 —',
      'Password knowledge alone never grants authority',
      'Password knowledge grants authority immediately',
    ],
    ['### NET-024 —', 'No conflicting in-flight write', 'Ignore any conflicting in-flight write'],
    ['### CMP-010 —', 'FROZEN_RECOVERY_READ_ONLY', 'UNRESTRICTED_GAMEPLAY_GM'],
  ])('refuses independent Markdown recovery drift in %s', (heading, before, after) => {
    const start = markdown.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = markdown.indexOf('\n### ', start + heading.length);
    expect(next).toBeGreaterThan(start);
    const section = markdown.slice(start, next);
    expect(section).toContain(before);
    const mutated =
      markdown.slice(0, start) + section.replace(before, after) + markdown.slice(next);
    expect(mutated).not.toBe(markdown);
    expect(() => assertAdr0080RecoveryMarkdown(mutated)).toThrow(heading);
  });
});
