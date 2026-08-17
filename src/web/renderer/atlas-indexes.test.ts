import formsByIdSource from '@generated/spec/atlas/forms-by-id.json?raw';
import requirementsSource from '@generated/spec/atlas/requirements.json?raw';
import transitionsSource from '@generated/spec/atlas/transitions.json?raw';
import { describe, expect, it } from 'vitest';

import { IMPLEMENTED_FORM_IDS } from '../forms/index.js';
import {
  createAtlasFormModel,
  createAtlasFormModelFromIndexes,
  getAtlasFormModel,
} from './atlas-data.js';
import type { AtlasIndexes, AtlasSources } from './atlas-data.js';

const FULL_ATLAS_SOURCES: AtlasSources = {
  formsById: JSON.parse(formsByIdSource) as unknown,
  requirements: JSON.parse(requirementsSource) as unknown,
  transitions: JSON.parse(transitionsSource) as unknown,
};

function indexedFixture(
  primaryActions: readonly string[],
  transition: Record<string, unknown>,
): AtlasIndexes {
  return {
    formsById: {
      'APP-001': {
        id: 'APP-001',
        type: 'screen',
        title: 'Synthetic form',
        route: '/synthetic',
        roles: ['player'],
        domain: 'Synthetic domain',
        contexts: ['synthetic'],
        states: { ready: 'Synthetic ready state' },
        requiredFields: ['syntheticField'],
        qaScenarioIds: ['synthetic-qa'],
        components: ['Synthetic slot'],
      },
    },
    primaryActionsByFormId: { 'APP-001': primaryActions },
    transitionsByFormAndTrigger: { 'APP-001': { Go: transition } },
  };
}

const INDEXED_FROM = 'APP-001';
const INDEXED_TO = 'APP-002';
const INDEXED_KIND = 'synthetic';
const INDEXED_TRIGGER = 'Go';

const INDEXED_TRANSITION = {
  from: INDEXED_FROM,
  to: INDEXED_TO,
  kind: INDEXED_KIND,
  guard: 'synthetic guard',
  trigger: INDEXED_TRIGGER,
};

describe('atlas renderer indexes', () => {
  it('preserves the full-source model for every implemented form', () => {
    for (const formId of IMPLEMENTED_FORM_IDS) {
      expect(getAtlasFormModel(formId)).toEqual(createAtlasFormModel(formId, FULL_ATLAS_SOURCES));
    }
  });

  it('rejects duplicate actions in the indexed production path', () => {
    expect(() =>
      createAtlasFormModelFromIndexes('APP-001', indexedFixture(['Go', 'Go'], INDEXED_TRANSITION)),
    ).toThrow(/declares duplicate primaryActions for APP-001/u);
  });

  it('rejects a transition whose indexed payload has another source form', () => {
    expect(() =>
      createAtlasFormModelFromIndexes(
        'APP-001',
        indexedFixture(['Go'], { ...INDEXED_TRANSITION, from: 'APP-002' }),
      ),
    ).toThrow(/\.from is "APP-002", expected "APP-001"/u);
  });

  it('rejects a transition whose indexed payload has another trigger', () => {
    expect(() =>
      createAtlasFormModelFromIndexes(
        'APP-001',
        indexedFixture(['Go'], { ...INDEXED_TRANSITION, trigger: 'Stay' }),
      ),
    ).toThrow(/\.trigger is "Stay", expected "Go"/u);
  });
});
