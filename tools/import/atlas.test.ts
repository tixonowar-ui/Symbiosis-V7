/**
 * These tests read the real artifact rather than a fixture: the point of the
 * pipeline is that it agrees with the delivered atlas, and a fixture would only
 * prove the importer agrees with itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRendererQueryIndexes } from './atlas.js';
import { SPEC_DIR, TYPES_DIR } from './lib/paths.js';

const spec = (name: string): unknown =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'atlas', name), 'utf8'));

type JsonObject = Record<string, unknown>;

const RENDERER_FORM_FIELDS = [
  'id',
  'type',
  'title',
  'route',
  'roles',
  'domain',
  'contexts',
  'states',
  'requiredFields',
  'qaScenarioIds',
  'components',
] as const;

const SYNTHETIC_FORM_IDS: ReadonlySet<string> = new Set(['APP-001', 'APP-002', 'APP-011']);

const rendererRequirement = (primaryActions: string[], formId = 'APP-001') => ({
  actionSteps: [{ formId, primaryActions }],
});

const rendererTransition = (to: string) => ({
  from: 'APP-001',
  to,
  kind: 'synthetic',
  guard: 'synthetic guard',
  trigger: 'Go',
});

describe('generated atlas spec', () => {
  it('carries every form the atlas declares', () => {
    expect(spec('forms.json')).toHaveLength(376);
  });

  it('indexes every form by id without changing its contents', () => {
    const forms = spec('forms.json') as { id: string }[];
    const formsById = spec('forms-by-id.json') as Record<string, unknown>;
    expect(Object.keys(formsById)).toHaveLength(376);
    expect(formsById).toEqual(Object.fromEntries(forms.map((form) => [form.id, form])));
  });

  it('projects every renderer query without losing any field it reads', () => {
    const formsById = spec('forms-by-id.json') as Record<string, JsonObject>;
    const rendererForms = spec('renderer/forms-by-id.json');
    const expectedForms = Object.fromEntries(
      Object.entries(formsById).map(([id, form]) => [
        id,
        Object.fromEntries(RENDERER_FORM_FIELDS.map((field) => [field, form[field]])),
      ]),
    );
    expect(Object.keys(expectedForms)).toHaveLength(376);
    expect(rendererForms).toEqual(expectedForms);

    const requirements = spec('requirements.json') as {
      actionSteps: { formId: string; primaryActions: string[] }[];
    }[];
    const expectedActions = new Map<string, string[]>();
    for (const requirement of requirements) {
      for (const step of requirement.actionSteps) {
        const previous = expectedActions.get(step.formId);
        if (previous === undefined) {
          expectedActions.set(step.formId, step.primaryActions);
        } else {
          expect(step.primaryActions).toEqual(previous);
        }
      }
    }
    const expectedActionsObject = Object.fromEntries(expectedActions);
    expect(spec('renderer/primary-actions-by-form-id.json')).toEqual(expectedActionsObject);

    type Transition = {
      from: string;
      to: string;
      kind: string;
      guard: string;
      trigger: string;
    };
    const transitions = spec('transitions.json') as Transition[];
    const expectedTransitions = new Map<string, Record<string, Transition>>();
    for (const [formId, actions] of expectedActions) {
      const byTrigger: Record<string, Transition> = {};
      for (const action of actions) {
        const matches = transitions.filter(
          (transition) => transition.from === formId && transition.trigger === action,
        );
        expect(matches.length).toBeLessThanOrEqual(1);
        const match = matches[0];
        if (match !== undefined) byTrigger[action] = match;
      }
      if (Object.keys(byTrigger).length > 0) expectedTransitions.set(formId, byTrigger);
    }
    const expectedTransitionsObject = Object.fromEntries(expectedTransitions);
    expect(spec('renderer/transitions-by-form-and-trigger.json')).toEqual(
      expectedTransitionsObject,
    );
  });

  it('matches the counts the audit states about the atlas', () => {
    expect(spec('transitions.json')).toHaveLength(1672);
    expect(spec('journeys.json')).toHaveLength(66);
    expect(spec('requirements.json')).toHaveLength(91);
    expect(spec('qa-scenarios.json')).toHaveLength(2440);
    expect(spec('lifecycles.json')).toHaveLength(19);
    expect(spec('diagrams.json')).toHaveLength(11);
  });

  it('pins the atlas digests, so a swapped artifact is visible in the diff', () => {
    const meta = spec('meta.json') as { graphDigest: string; contentDigest: string };
    expect(meta.graphDigest).toBe(
      '693910e40ffca85b30d9eafd05c2bb7d59934da966c10afdafa5afe6e51fe7df',
    );
    expect(meta.contentDigest).toBe(
      'ceace6ea95167e81b8cbbd86670930270b0b177e81db07e8e0fa437d21747a5c',
    );
  });

  it('closes the transition graph over the form catalogue', () => {
    const ids = new Set((spec('forms.json') as { id: string }[]).map((f) => f.id));
    const dangling = (spec('transitions.json') as { from: string; to: string }[]).filter(
      (t) => !ids.has(t.from) || !ids.has(t.to),
    );
    expect(dangling).toEqual([]);
  });

  it('distributes forms across the 16 domains exactly as the atlas counts them', () => {
    const byDomain = new Map<string, number>();
    for (const form of spec('forms.json') as { domain: string }[]) {
      byDomain.set(form.domain, (byDomain.get(form.domain) ?? 0) + 1);
    }
    expect(byDomain.size).toBe(16);
    expect(byDomain.get('Боевая ситуация')).toBe(73);
    expect(byDomain.get('Создание локального персонажа')).toBe(44);
    expect(byDomain.get('Настройки')).toBe(6);
    expect([...byDomain.values()].reduce((a, b) => a + b, 0)).toBe(376);
  });
});

describe('generated atlas types', () => {
  const source = readFileSync(join(TYPES_DIR, 'atlas.ts'), 'utf8');

  it('is marked as generated so nobody edits it by hand', () => {
    expect(source.startsWith('// Generated by tools/import.')).toBe(true);
  });

  it('uses LF endings regardless of the platform it was generated on', () => {
    expect(source).not.toContain('\r\n');
  });

  it('emits one FormId literal per form', () => {
    // The final member carries the closing semicolon, so it must be optional
    // here — matching only `"` would silently drop the last literal.
    const union = /export type FormId =\n((?: {2}\| "[^"]+";?\n)+)/.exec(source);
    expect(union).not.toBeNull();
    expect(union![1]!.trimEnd().split('\n')).toHaveLength(376);
  });

  it('maps every domain to the src/web/forms folder that owns it', () => {
    expect(source).toContain('"Боевая ситуация": "CMB"');
    expect(source).toContain('"Приложение и локальные данные": "APP"');
  });
});

describe('renderer atlas index guards', () => {
  it('preserves declared empty actions separately from an absent form key', () => {
    const indexes = buildRendererQueryIndexes(SYNTHETIC_FORM_IDS, [rendererRequirement([])], []);

    expect(indexes.primaryActionsByForm).toEqual({ 'APP-001': [] });
    expect(indexes.primaryActionsByForm).not.toHaveProperty('APP-002');
    expect(indexes.transitionsByForm).toEqual({});
  });

  it('rejects an action step for an unknown form', () => {
    expect(() =>
      buildRendererQueryIndexes(SYNTHETIC_FORM_IDS, [rendererRequirement([], 'APP-999')], []),
    ).toThrow(/formId points at unknown form "APP-999"/u);
  });

  it('rejects duplicate actions instead of collapsing them', () => {
    expect(() =>
      buildRendererQueryIndexes(SYNTHETIC_FORM_IDS, [rendererRequirement(['Go', 'Go'])], []),
    ).toThrow(/primaryActions contains duplicate actions for APP-001/u);
  });

  it('rejects conflicting repeated action definitions', () => {
    expect(() =>
      buildRendererQueryIndexes(
        SYNTHETIC_FORM_IDS,
        [rendererRequirement(['Go']), rendererRequirement(['Stay'])],
        [],
      ),
    ).toThrow(/primaryActions conflicts with another definition for APP-001/u);
  });

  it('rejects an ambiguous transition in the renderer query domain', () => {
    expect(() =>
      buildRendererQueryIndexes(
        SYNTHETIC_FORM_IDS,
        [rendererRequirement(['Go'])],
        [rendererTransition('APP-002'), rendererTransition('APP-011')],
      ),
    ).toThrow(/ambiguous renderer transition for form APP-001 and trigger "Go"/u);
  });
});
