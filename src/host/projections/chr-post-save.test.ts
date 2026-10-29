import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertScreenContract } from './app.js';
import { assertPostSaveScreenContracts } from './chr-post-save.js';

const forms = JSON.parse(readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8')) as Record<
  string,
  unknown
>;

describe('CHR-026/039/040 and APP-009/010 source contracts', () => {
  it('matches exact supplied fields, titles, screen types and routes', () => {
    expect(() => assertPostSaveScreenContracts(forms, assertScreenContract)).not.toThrow();
  });

  it.each(['CHR-026', 'CHR-039', 'CHR-040', 'APP-009', 'APP-010'])(
    'rejects a changed or missing %s contract',
    (formId) => {
      for (const patch of [
        { title: 'changed' },
        { route: '/wrong' },
        { type: 'dialog' },
        { requiredFields: [] },
      ]) {
        expect(() =>
          assertPostSaveScreenContracts(
            { ...forms, [formId]: { ...(forms[formId] as object), ...patch } },
            assertScreenContract,
          ),
        ).toThrow();
      }
      const withoutForm = { ...forms };
      delete withoutForm[formId];
      expect(() => assertPostSaveScreenContracts(withoutForm, assertScreenContract)).toThrow();
    },
  );
});
