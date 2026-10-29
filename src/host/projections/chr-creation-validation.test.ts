import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertScreenContract } from './app.js';
import { assertCreationValidationScreenContracts } from './chr-creation-validation.js';

describe('CHR-032 and CHR-025 source screen contracts', () => {
  it('matches the supplied title, screen type, route and required fields', () => {
    const forms = JSON.parse(
      readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8'),
    ) as Record<string, unknown>;
    expect(() =>
      assertCreationValidationScreenContracts(forms, assertScreenContract),
    ).not.toThrow();
    for (const formId of ['CHR-032', 'CHR-025'])
      for (const patch of [
        { title: 'changed' },
        { route: '/wrong' },
        { type: 'dialog' },
        { requiredFields: [] },
      ])
        expect(() =>
          assertCreationValidationScreenContracts(
            { ...forms, [formId]: { ...(forms[formId] as object), ...patch } },
            assertScreenContract,
          ),
        ).toThrow();
  });
});
