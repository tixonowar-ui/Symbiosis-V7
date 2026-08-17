import { describe, expect, it } from 'vitest';
import {
  validateDetailedFormIndexKeys,
  validateRendererFormCatalogue,
  validateRendererFormGraph,
} from './atlas.js';

const FORM_ID = /^[A-Z]{2,3}-\d{3}$/;

describe('renderer form catalogue validation', () => {
  it('rejects a key that does not equal its embedded form id', () => {
    const result = validateRendererFormCatalogue({ 'APP-001': { id: 'APP-002' } }, FORM_ID, 1);

    expect(result.problems).toContainEqual({
      file: 'atlas/renderer/forms-by-id.json',
      id: 'APP-001',
      message: 'key does not match embedded id "APP-002"',
    });
  });

  it('rejects a catalogue whose cardinality differs from meta counts.forms', () => {
    const result = validateRendererFormCatalogue({ 'APP-001': { id: 'APP-001' } }, FORM_ID, 2);

    expect(result.problems).toContainEqual({
      file: 'atlas/renderer/forms-by-id.json',
      id: '-',
      message: 'expected 2 form entries from atlas/meta.json counts.forms, got 1',
    });
  });
});

describe('detailed form index validation', () => {
  it('rejects a key missing from the detailed index', () => {
    const problems = validateDetailedFormIndexKeys(
      { 'APP-001': {} },
      new Set(['APP-001', 'APP-002']),
    );

    expect(problems).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-002',
      message: 'key is missing for id declared in atlas/renderer/forms-by-id.json',
    });
  });

  it('rejects a detailed-index key absent from the renderer catalogue', () => {
    const problems = validateDetailedFormIndexKeys(
      { 'APP-001': {}, 'APP-002': {} },
      new Set(['APP-001']),
    );

    expect(problems).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-002',
      message: 'key is not declared in atlas/renderer/forms-by-id.json',
    });
  });
});

describe('renderer form graph validation', () => {
  it('rejects a transition endpoint absent from the renderer catalogue', () => {
    const problems = validateRendererFormGraph(new Set(['APP-001']), [
      { from: 'APP-001', to: 'APP-002' },
    ]);

    expect(problems).toContainEqual({
      file: 'atlas/transitions.json',
      id: 'row 0',
      message: 'to "APP-002" is not in the renderer form catalogue',
    });
  });

  it('preserves orphan reporting for an indexed form outside the graph', () => {
    const problems = validateRendererFormGraph(new Set(['APP-001', 'APP-002', 'APP-003']), [
      { from: 'APP-001', to: 'APP-002' },
    ]);

    expect(problems).toContainEqual({
      file: 'atlas/renderer/forms-by-id.json',
      id: 'APP-003',
      message: 'form is defined but never referenced',
    });
  });
});
