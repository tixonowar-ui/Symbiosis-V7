import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0071Admission,
  assertAdr0071AdmissionMarkdown,
} from './admission-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const forms = (root: JsonObject): JsonObject[] => root['forms'] as JsonObject[];
const form = (root: JsonObject, id: string): JsonObject =>
  forms(root).find((row) => row['id'] === id)!;
const record = (value: unknown): JsonObject => value as JsonObject;
// Keep the complete real source, but copy only rows that a case mutates. Cloning
// the entire Atlas for each one-field mutation needlessly competes with
// the production host suites running in the other configured Vitest workers.
const cloneFor = (...ids: string[]): JsonObject => ({
  ...source,
  forms: forms(source).map((row) =>
    ids.some((id) => row['id'] === id) ? structuredClone(row) : row,
  ),
});

describe('ADR 0071 approved admission source', () => {
  it('accepts the actual supplied JSON and independent Markdown companion', () => {
    expect(() => assertAdr0071Admission(source)).not.toThrow();
    expect(() => assertAdr0071AdmissionMarkdown(markdown)).not.toThrow();
    const queue = record(form(source, 'NET-017')['actions']);
    const actions = queue['ctaAvailabilityByAction'] as JsonObject[];
    expect(actions.find((row) => row['actionKey'] === 'NET-017::CTA::010')?.['guard']).toContain(
      'IN_REVIEW',
    );
    // Preliminary and import ingress still have distinct source guards.
    expect(actions.find((row) => row['actionKey'] === 'NET-017::CTA::001')?.['guard']).toContain(
      'PROPOSED',
    );
    expect(form(source, 'GM-019')['requiredFields'] as string[]).toContain(
      'weaponReviewInputOrNull',
    );
  });

  it.each([
    'NET-007',
    'NET-018',
    'NET-019',
    'NET-020',
    'NET-021',
    'NET-022',
    'NET-027',
    'GM-019',
    'GM-020',
  ])('rejects missing closed fields or foreign effect fields in %s', (id) => {
    const root = cloneFor(id);
    form(root, id)['requiredFields'] = ['effectInstanceId', 'EffectTypeID'];
    expect(() => assertAdr0071Admission(root)).toThrow(id);
  });

  it.each([
    ['NET-017', 'Closed UI-CMD-ADMISSION-REVIEW-OPEN payload'],
    ['NET-019', 'CustomItem stat bonuses'],
    ['NET-019', 'Closed weaponDecisionRefs'],
    ['NET-020', 'Closed groupAssignment variants'],
    ['NET-021', 'beforeSheet/afterSheet use'],
    ['NET-027', 'Only a pending published proposal'],
    ['GM-019', 'ADMISSION_REVIEW weapon resolve'],
    ['GM-019', 'Closed weaponReviewInput variants'],
  ])('rejects deletion of %s contract %s', (id, prefix) => {
    const root = cloneFor(id),
      f = form(root, id);
    const criteria = f['acceptanceCriteria'] as string[];
    const selected = criteria.findIndex((text) => text.startsWith(prefix));
    expect(selected).toBeGreaterThanOrEqual(0);
    criteria.splice(selected, 1);
    expect(() => assertAdr0071Admission(root)).toThrow(id);
  });

  it('rejects an early player scene route even if all three transition mirrors agree', () => {
    const root = cloneFor('NET-027', 'NET-006', 'PLY-001');
    root['transitions'] = structuredClone(source['transitions']!);
    const transitions = root['transitions'] as JsonObject[];
    const moved = transitions.find((row) => row['from'] === 'NET-027' && row['to'] === 'NET-006')!;
    moved['to'] = 'PLY-001';
    const out = (form(root, 'NET-027')['transitionsOut'] as JsonObject[]).find(
      (row) => row['to'] === 'NET-006',
    )!;
    out['to'] = 'PLY-001';
    const incoming = form(root, 'NET-006')['transitionsIn'] as JsonObject[];
    const index = incoming.findIndex((row) => row['from'] === 'NET-027');
    (form(root, 'PLY-001')['transitionsIn'] as JsonObject[]).push(incoming.splice(index, 1)[0]!);
    expect(() => assertAdr0071Admission(root)).toThrow('transitions');
  });

  it('rejects a grant route that wrongly requires a player validation receipt', () => {
    const root = cloneFor('NET-019');
    const actions = record(form(root, 'NET-019')['actions'])[
      'ctaAvailabilityByAction'
    ] as JsonObject[];
    actions.find((row) => row['actionKey'] === 'NET-019::CTA::005')!['guard'] =
      'OP-REQ-VALIDATE receipt required';
    expect(() => assertAdr0071Admission(root)).toThrow('NET-019');
  });

  it.each(['GM-019', 'NET-019', 'GM-020'])('rejects widened player authority on %s', (id) => {
    const root = cloneFor(id);
    form(root, id)['roles'] = ['gm', 'player'];
    expect(() => assertAdr0071Admission(root)).toThrow(id);
  });

  it('preserves imported review and owner-claim identity without ordinary request IDs', () => {
    const criteria = form(source, 'NET-019')['acceptanceCriteria'] as string[];
    expect(
      criteria.some((text) =>
        text.includes(
          'IMPORTED_REVIEW={kind,admissionBatchId,campaignCharacterId,candidateId,ownerClaimReceiptId,proposalRevision}',
        ),
      ),
    ).toBe(true);
    expect(form(source, 'NET-027')['requiredFields'] as string[]).toContain('requestIdOrNull');
    const root = cloneFor('NET-019');
    const values = form(root, 'NET-019')['acceptanceCriteria'] as string[];
    const index = values.findIndex((text) => text.startsWith('Closed reviewScope variants:'));
    expect(index).toBeGreaterThanOrEqual(0);
    values[index] = 'All PROPOSED copies are read-only; only ordinary submissions may be reviewed.';
    expect(() => assertAdr0071Admission(root)).toThrow('NET-019');
  });

  it.each([
    'CustomItem stat bonuses from AQ2-005',
    'Only a pending published proposal accepts a new player decision.',
    'Closed weaponReviewInput variants:',
    'beforeSheet/afterSheet use the versioned AdmissionMechanicalSheetV1',
  ])('rejects independent Markdown contract drift: %s', (text) => {
    expect(markdown).toContain(text);
    expect(() =>
      assertAdr0071AdmissionMarkdown(markdown.replace(text, 'REMOVED CONTRACT')),
    ).toThrow('ADR 0071');
  });
});
