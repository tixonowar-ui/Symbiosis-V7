import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertScreenContract } from './app.js';
import {
  assertCampaignCreateScreenContracts,
  CAMPAIGN_CREATE_ACTION_CONTRACTS,
  CAMPAIGN_CREATE_SCREEN_CONTRACTS,
} from './cmp-create.js';

const forms = JSON.parse(readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8')) as Record<
  string,
  unknown
>;
type SourceForm = { actions: { ctaAvailabilityByAction: Record<string, unknown>[] } };

function withActions(formId: string, actions: readonly Record<string, unknown>[]) {
  const form = forms[formId] as SourceForm;
  return {
    ...forms,
    [formId]: { ...form, actions: { ...form.actions, ctaAvailabilityByAction: actions } },
  };
}

describe('APP-011 and CMP-001–006 campaign creation source contracts', () => {
  it('matches exact titles, routes, fields, GM roles and source action tuples', () => {
    expect(() => assertCampaignCreateScreenContracts(forms, assertScreenContract)).not.toThrow();
  });

  it.each(CAMPAIGN_CREATE_SCREEN_CONTRACTS.map(({ formId }) => formId))(
    'rejects missing or changed %s fields and role boundary',
    (formId) => {
      for (const patch of [
        { title: 'changed' },
        { route: '/wrong' },
        { type: 'dialog' },
        { roles: ['player', 'gm'] },
        { contexts: [] },
        { requiredFields: [] },
      ]) {
        expect(() =>
          assertCampaignCreateScreenContracts(
            {
              ...forms,
              [formId]: { ...(forms[formId] as object), ...patch },
            },
            assertScreenContract,
          ),
        ).toThrow();
      }
      const missing = { ...forms };
      delete missing[formId];
      expect(() => assertCampaignCreateScreenContracts(missing, assertScreenContract)).toThrow();
    },
  );

  it.each(CAMPAIGN_CREATE_ACTION_CONTRACTS)('rejects drift of %s / %s', (formId, actionKey) => {
    const actions = (forms[formId] as SourceForm).actions.ctaAvailabilityByAction;
    const original = actions.find((action) => action['actionKey'] === actionKey)!;
    for (const patch of [
      { label: 'changed' },
      { targetFormId: 'APP-001' === original['targetFormId'] ? 'CMP-006' : 'APP-001' },
      { kind: 'local-draft' },
      { guard: 'true' },
      {
        authoritativeSource: {
          ...(original['authoritativeSource'] as object),
          workflowCommandIds: ['UI-CMD-CAMPAIGN-START'],
        },
      },
    ]) {
      const changed = actions.map((action) =>
        action === original ? { ...action, ...patch } : action,
      );
      expect(() =>
        assertCampaignCreateScreenContracts(withActions(formId, changed), assertScreenContract),
      ).toThrow(actionKey);
    }
    expect(() =>
      assertCampaignCreateScreenContracts(
        withActions(
          formId,
          actions.filter((action) => action !== original),
        ),
        assertScreenContract,
      ),
    ).toThrow(actionKey);
    expect(() =>
      assertCampaignCreateScreenContracts(
        withActions(formId, [...actions, original]),
        assertScreenContract,
      ),
    ).toThrow(actionKey);
  });

  it('retains normative back before commit and the excluded CMP-007 terminal destination', () => {
    const back = CAMPAIGN_CREATE_ACTION_CONTRACTS.find(([, key]) => key === 'CMP-005::CTA::002')!;
    const terminal = CAMPAIGN_CREATE_ACTION_CONTRACTS.find(
      ([, key]) => key === 'CMP-006::CTA::001',
    )!;
    expect(back.slice(2)).toEqual([
      'Назад до commit',
      'CMP-004',
      'normative',
      'creation not committed',
    ]);
    expect(terminal.slice(2)).toEqual([
      'Открыть панель созданной кампании',
      'CMP-007',
      'normative',
      'creation receipt confirmed; this does not Start the campaign',
    ]);
  });
});
