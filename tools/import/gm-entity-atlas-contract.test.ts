import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0077GmSources,
  assertAdr0077GmSourcesMarkdown,
} from './gm-entity-atlas-contract.js';
import { assertAdr0071Admission } from './admission-atlas-contract.js';
import { assertAdr0049MissingChannels } from './atlas.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const record = (value: unknown) => value as JsonObject;
function changed(target: string, id: string) {
  const root = { ...source };
  const nested = ['workflowCommands', 'qna'].includes(target);
  const container = nested
    ? (root['registryCoverage'] = { ...record(source['registryCoverage']) })
    : root;
  const key =
    target === 'workflowCommands'
      ? 'commandId'
      : target === 'qna'
        ? 'qnaId'
        : target === 'qaScenarios'
          ? 'qaId'
          : target === 'coverageRequirements'
            ? 'requirementId'
            : 'id';
  const rows = (container[target] as JsonObject[]).map((row) =>
    row[key] === id ? structuredClone(row) : row,
  );
  container[target] = rows;
  const row = rows.find((row) => row[key] === id);
  if (!row) throw new Error('Missing approved source ' + id);
  return { root, row };
}
const formIds = [
  'NPC-002',
  'NPC-003',
  'NPC-007',
  'NPC-016',
  'NPC-017',
  'ENM-012',
  'ENM-017',
  'ENM-018',
  'ENM-019',
];

describe('ADR 0077 complete GM source closure', () => {
  it('accepts the supplied source and keeps previous CHR/admission guards effective', () => {
    expect(() => assertAdr0077GmSources(source)).not.toThrow();
    expect(() => assertAdr0077GmSourcesMarkdown(markdown)).not.toThrow();
    expect(() => assertAdr0049MissingChannels(source)).not.toThrow();
    expect(() => assertAdr0071Admission(source)).not.toThrow();
  });
  it.each(formIds)(
    'seals full binding/authority/fields on %s without duplicate required fields',
    (id) => {
      const { root, row } = changed('forms', id);
      const fields = row['requiredFields'] as string[];
      expect(new Set(fields).size).toBe(fields.length);
      fields.push('clientSelectedAuthority');
      expect(() => assertAdr0077GmSources(root)).toThrow(id);
    },
  );
  it.each([
    ['NPC-003', 'NPC-003::CTA::008'],
    ['NPC-007', 'NPC-007::CTA::002'],
    ['NPC-016', 'NPC-016::CTA::001'],
    ['NPC-017', 'NPC-017::CTA::002'],
    ['ENM-017', 'ENM-017::CTA::006'],
    ['ENM-017', 'ENM-017::CTA::007'],
    ['ENM-018', 'ENM-018::CTA::005'],
    ['ENM-019', 'ENM-019::CTA::002'],
  ])('rejects an unguarded phase/origin route %s %s', (id, key) => {
    const { root, row } = changed('forms', id);
    const action = (record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[]).find(
      (x) => x['actionKey'] === key,
    )!;
    expect(action).toBeDefined();
    action['guard'] = 'true';
    expect(() => assertAdr0077GmSources(root)).toThrow(id);
  });
  it('keeps the monster channel nullable for SENTIENT and the same attempt aliases for receipts', () => {
    const { root, row } = changed('forms', 'ENM-017');
    expect(
      (row['requiredFields'] as string[]).some((x) => x.startsWith('monsterRollContextOrNull=')),
    ).toBe(true);
    const criteria = row['acceptanceCriteria'] as string[];
    expect(criteria.join(' ')).toContain(
      'Positive SENTIENT N+1 keeps monsterRollContextOrNull=null',
    );
    expect(criteria.join(' ')).toContain('monsterDraftId/creationAttemptId are exact aliases');
    row['acceptanceCriteria'] = criteria.filter((x) => !x.startsWith('Positive SENTIENT N+1'));
    expect(() => assertAdr0077GmSources(root)).toThrow('ENM-017');
  });
  it.each([
    'UI-CMD-NPC-NEW-VERSION',
    'UI-CMD-NPC-COMMIT-V1',
    'UI-CMD-MONSTER-STATS-ROLL-ONCE',
    'UI-CMD-ENEMY-NEW-VERSION',
  ])('rejects lost replay/atomicity on %s', (id) => {
    const { root, row } = changed('workflowCommands', id);
    row['reconnect'] = 'repeat mutation';
    expect(() => assertAdr0077GmSources(root)).toThrow('registryCoverage');
  });
  it.each(['REQ-011', 'REQ-012', 'REQ-013', 'REQ-015', 'REQ-065'])(
    'seals the complete actions and outcomes of %s',
    (id) => {
      const { root, row } = changed('coverageRequirements', id);
      const steps = row['actionSteps'] as JsonObject[];
      for (const step of steps)
        expect((step['primaryActions'] as string[]).length).toBeGreaterThan(0);
      row['actionSteps'] = [];
      expect(() => assertAdr0077GmSources(root)).toThrow(id);
    },
  );
  it('preserves the original Q-CHAR-010 answer and CHR/NET scope separately from the later GM override', () => {
    const { root, row } = changed('qna', 'Q-CHAR-010');
    expect(row['answer']).toContain('не вводит выдуманных автоматических минимумов/максимумов');
    expect(row['laterAuthorOverride']).toContain(
      'The CHR-only sex checkpoint rule is not extended to NPC.',
    );
    expect(row['laterAuthorOverride']).toContain('NET-019 and NET-021;');
    row['answer'] = 'NPC ranges apply to every PC';
    expect(() => assertAdr0077GmSources(root)).toThrow('registryCoverage');
    const admission = changed('forms', 'NET-019');
    admission.row['requiredFields'] = ['massKg(NPC race ranges)'];
    expect(() => assertAdr0071Admission(admission.root)).toThrow('NET-019');
  });
  it('seals the global edge and both local mirrors for the used-receipt return', () => {
    const root = { ...source, transitions: [...(source['transitions'] as JsonObject[])] };
    const at = root.transitions.findIndex((x) => x['from'] === 'ENM-019' && x['to'] === 'ENM-017');
    expect(at).toBeGreaterThanOrEqual(0);
    root.transitions[at] = { ...root.transitions[at], to: 'ENM-012' };
    expect(() => assertAdr0077GmSources(root)).toThrow('transitions');
    for (const [id, field] of [
      ['ENM-019', 'transitionsOut'],
      ['ENM-017', 'transitionsIn'],
    ]) {
      const local = changed('forms', id!);
      const edge = (local.row[field!] as JsonObject[]).find(
        (x) => x['trigger'] === 'Вернуться к новой версии с прежней квитанцией',
      );
      expect(edge).toBeDefined();
      edge!['guard'] = 'true';
      expect(() => assertAdr0077GmSources(local.root)).toThrow(id);
    }
  });
  it.each(formIds)(
    'keeps populated tables and separate empty operation tables intact on %s',
    (id) => {
      const start = markdown.indexOf('### ' + id + ' —'),
        end = markdown.indexOf('\n### ', start + 1);
      const section = markdown.slice(start, end);
      expect(section).not.toMatch(/\|[-: |]+\|\r?\n\r?\n\| (?:[A-Z]{3}-\d{3}|UI-CMD-)/u);
      expect(section).toContain('| Executable OperationID | Guard перед commit |');
      expect(section).toMatch(/\| --- \| --- \|\r?\n\r?\n\| Executable workflow command \|/u);
    },
  );
  it.each([
    '### NPC-017 —',
    '### ENM-017 —',
    '### J-TEMPLATE-LIFECYCLE —',
    '| REQ-012 |',
    '| QA-REQ-065 |',
    '| 306 | Q-CHAR-010 |',
    '| enemyTemplate |',
  ])('checks the independent Markdown mirror %s', (anchor) => {
    const offset = markdown.indexOf(anchor);
    expect(offset).toBeGreaterThanOrEqual(0);
    const altered = markdown.slice(0, offset) + markdown.slice(offset).replace(' |', ' changed |');
    expect(() => assertAdr0077GmSourcesMarkdown(altered)).toThrow();
  });
});
