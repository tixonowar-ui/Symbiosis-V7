import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertNetConnectScreenContracts,
  NET_CONNECT_ACTION_CONTRACTS,
  NET_CONNECT_FORM_CONTRACTS,
} from './net-connect.js';

const forms = JSON.parse(readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8')) as Record<
  string,
  unknown
>;
type SourceForm = {
  requiredFields: string[];
  actions: { ctaAvailabilityByAction: Record<string, unknown>[] };
};
function withActions(formId: string, actions: readonly Record<string, unknown>[]) {
  const form = forms[formId] as SourceForm;
  return {
    ...forms,
    [formId]: { ...form, actions: { ...form.actions, ctaAvailabilityByAction: actions } },
  };
}

describe('NET connection and CHR-027 literal source contracts', () => {
  it('matches the supplied titles, routes, fields, roles and all source action tuples', () => {
    expect(() => assertNetConnectScreenContracts(forms)).not.toThrow();
  });

  it.each(NET_CONNECT_FORM_CONTRACTS.map(({ formId }) => formId))(
    'rejects missing %s and drift of its complete form identity',
    (formId) => {
      const source = forms[formId] as SourceForm;
      for (const patch of [
        { id: ['NET', '999'].join('-') },
        { title: 'changed' },
        { route: '/wrong' },
        { type: 'dialog' },
        { roles: [] },
        { contexts: [] },
        { requiredFields: source.requiredFields.slice(1) },
        { requiredFields: [...source.requiredFields, 'inventedField'] },
        { requiredFields: [...source.requiredFields].reverse() },
      ])
        expect(() =>
          assertNetConnectScreenContracts({ ...forms, [formId]: { ...source, ...patch } }),
        ).toThrow(formId);
      const missing = { ...forms };
      delete missing[formId];
      expect(() => assertNetConnectScreenContracts(missing)).toThrow(formId);
    },
  );

  it.each(NET_CONNECT_ACTION_CONTRACTS)('rejects drift of %s / %s', (formId, key) => {
    const actions = (forms[formId] as SourceForm).actions.ctaAvailabilityByAction;
    const original = actions.find((action) => action['actionKey'] === key)!;
    for (const patch of [
      { label: 'changed' },
      { targetFormId: 'NET-017' },
      { kind: 'invented-kind' },
      { guard: 'true' },
      {
        authoritativeSource: {
          ...(original['authoritativeSource'] as object),
          workflowCommandIds: ['UI-CMD-ADMISSION-GM-ACCEPT'],
        },
      },
    ]) {
      const changed = actions.map((action) =>
        action === original ? { ...action, ...patch } : action,
      );
      expect(() => assertNetConnectScreenContracts(withActions(formId, changed))).toThrow(key);
    }
    expect(() =>
      assertNetConnectScreenContracts(
        withActions(
          formId,
          actions.filter((action) => action !== original),
        ),
      ),
    ).toThrow();
    expect(() =>
      assertNetConnectScreenContracts(withActions(formId, [...actions, original])),
    ).toThrow();
  });

  it.each(NET_CONNECT_FORM_CONTRACTS.map(({ formId }) => formId))(
    'rejects an unreviewed added CTA on %s instead of silently extending runtime scope',
    (formId) => {
      const actions = (forms[formId] as SourceForm).actions.ctaAvailabilityByAction;
      expect(() =>
        assertNetConnectScreenContracts(
          withActions(formId, [...actions, { ...actions[0], actionKey: `${formId}::CTA::999` }]),
        ),
      ).toThrow(formId);
    },
  );

  it('keeps technical connection, candidate selection and submission separate', () => {
    const lookup = (key: string) =>
      NET_CONNECT_ACTION_CONTRACTS.find(([, action]) => action === key)!;
    expect(lookup('APP-002::CTA::003').slice(2)).toEqual([
      'Подключиться',
      'NET-001',
      'normative',
      'player launch-mode',
      [],
    ]);
    expect(lookup('NET-002::CTA::003').slice(3)).toEqual([
      'NET-003',
      'workflow-command',
      'UI-CMD-CONNECTION-OPEN guards',
      ['UI-CMD-CONNECTION-OPEN'],
    ]);
    expect(lookup('CHR-027::CTA::001').slice(3)).toEqual([
      'NET-004',
      'normative',
      'selected eligible campaign/seat and immutable candidate snapshot enter the ordinary 1–3 device request draft; submit still requires NET-004 command',
      [],
    ]);
    expect(lookup('NET-004::CTA::002').slice(3)).toEqual([
      'NET-005',
      'workflow-command',
      'UI-CMD-DEVICE-REQUEST-SUBMIT guards',
      ['UI-CMD-DEVICE-REQUEST-SUBMIT'],
    ]);
    expect(lookup('NET-005::CTA::001').slice(3)).toEqual([
      'NET-003',
      'workflow-command',
      'UI-CMD-DEVICE-REQUEST-CANCEL guards',
      ['UI-CMD-DEVICE-REQUEST-CANCEL'],
    ]);
  });

  it('retains source annotations and unsupported recovery fields without invented substitutes', () => {
    const lookup = (formId: string) =>
      NET_CONNECT_FORM_CONTRACTS.find((form) => form.formId === formId)!;
    expect(lookup('NET-005').requiredFields).toContain('requestStatus=PENDING|REJECTED|PROPOSED');
    expect(lookup('NET-010').requiredFields).toContain('resumeContext=PEACE|COMBAT|LOCAL_HANDOFF');
    expect(lookup('NET-012')).toMatchObject({ type: 'banner', route: '@banner/net-012' });
    expect(lookup('NET-012').requiredFields).toEqual([
      'contextId',
      'stateRevision',
      'projectionRevision',
      'effectInstanceId/EffectTypeID',
      'source',
      'duration/stackPolicy',
      'deviceId',
      'controllerSeat',
      'connectionState',
      'originatingCommandId/requestId',
    ]);
    const waiting = forms['NET-005'] as SourceForm;
    expect(() =>
      assertNetConnectScreenContracts({
        ...forms,
        'NET-005': {
          ...waiting,
          requiredFields: waiting.requiredFields.map((field) =>
            field === 'requestStatus=PENDING|REJECTED|PROPOSED'
              ? 'requestStatus=PENDING|IN_REVIEW|REJECTED|PROPOSED'
              : field,
          ),
        },
      }),
    ).toThrow('NET-005');
  });

  it('retains separate fresh-connect and interrupted-session retry guards and the GM-only diagnostic target', () => {
    const lookup = (key: string) =>
      NET_CONNECT_ACTION_CONTRACTS.find(([, action]) => action === key)!;
    expect(lookup('NET-011::CTA::002')[3]).toBe('NET-009');
    expect(lookup('NET-011::CTA::002')[5]).toContain(
      'interrupted session/device binding and resumeContext exist',
    );
    expect(lookup('NET-011::CTA::003')[3]).toBe('NET-003');
    expect(lookup('NET-011::CTA::003')[5]).toContain(
      'no interrupted session/device binding/resumeContext',
    );
    expect(lookup('NET-010::CTA::001')[3]).toBe('CMP-010');
    expect(lookup('NET-010::CTA::001')[5]).toContain(
      'projectionRole=GM; activeRole=GM; confirmed sole master authority',
    );
  });
});
