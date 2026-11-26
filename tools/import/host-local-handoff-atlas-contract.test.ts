import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT, SPEC_DIR } from './lib/paths.js';
import type { JsonObject, JsonValue } from './lib/json.js';
import {
  assertAdr0096HostLocalHandoff,
  assertHostLocalHandoffDeclaration,
  assertHostLocalHandoffRenderer,
} from './host-local-handoff-atlas-contract.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const contract = (source['globalContracts'] as JsonObject)['hostLocalHandoff'] as JsonObject;
const dispatch = contract['dispatch'] as JsonObject;
const address = contract['address'] as JsonObject;
const forms = source['forms'] as JsonObject[];
const transitions = source['transitions'] as JsonObject[];
const renderer = (name: string): JsonObject =>
  JSON.parse(
    readFileSync(join(SPEC_DIR, 'atlas', 'renderer', name + '.json'), 'utf8'),
  ) as JsonObject;

describe('ADR 0096 host-local handoff source', () => {
  it('keeps the actual submitted applicant, admitted lobby and blocked post-Start routes distinct', () => {
    expect(() => assertAdr0096HostLocalHandoff(source)).not.toThrow();
    expect(Object.keys(dispatch)).toHaveLength(13);
    for (const [name, formId, role] of [
      ['PRE_SUBMIT_RETURN', 'CMP-009', 'gm'],
      ['REQUEST_PENDING', 'NET-005', 'player'],
      ['REQUEST_IN_REVIEW', 'NET-005', 'player'],
      ['PRELIMINARY_REJECTED', 'NET-005', 'player'],
      ['GM_PROPOSAL', 'NET-027', 'player'],
      ['GM_REJECTED', 'NET-007', 'player'],
      ['PLAYER_DECLINED', 'NET-007', 'player'],
      ['CANCELLED_RETURN', 'NET-017', 'gm'],
      ['REQUEST_OWNER_RETURN', 'NET-017', 'gm'],
      ['PRE_START_GM', 'NET-016', 'gm'],
      ['PRE_START_PLAYER', 'NET-006', 'player'],
      ['POST_START_BLOCKED_GM', 'GM-001', 'gm'],
      ['POST_START_BLOCKED_PLAYER', 'NET-006', 'player'],
    ] as const)
      expect(dispatch[name]).toMatchObject({ formId, role });
  });

  it.each([
    ['GM_PROPOSAL', 'formId', 'NET-018'],
    ['PRELIMINARY_REJECTED', 'formId', 'NET-007'],
    ['REQUEST_IN_REVIEW', 'guard', 'Owner can cancel the submitted request after review started.'],
    ['PRE_START_GM', 'formId', 'GM-001'],
    ['POST_START_BLOCKED_PLAYER', 'formId', 'PLY-001'],
    ['REQUEST_OWNER_RETURN', 'role', 'player'],
  ])('rejects a changed destination, role or decision guard on %s', (name, field, invalid) => {
    const entry = dispatch[name] as JsonObject;
    expect(entry[field]).not.toBe(invalid);
    expect(() =>
      assertHostLocalHandoffDeclaration({
        ...contract,
        dispatch: { ...dispatch, [name]: { ...entry, [field]: invalid } },
      }),
    ).toThrow('hostLocalHandoff.dispatch');
  });

  it.each([
    ['request', 'submitReceiptId'],
    ['request', 'technicalSessionId'],
    ['profile', 'targetHandoffReceiptId'],
    ['proposal', 'proposalChecksum'],
    ['seat', 'controllerBindingOrNull.localControllerSeatId'],
    ['common', 'pendingCommandOwner'],
  ])('rejects removal of %s proof %s even with correct role and form IDs', (key, field) => {
    const fields = address[key] as JsonValue[];
    expect(fields).toContain(field);
    expect(() =>
      assertHostLocalHandoffDeclaration({
        ...contract,
        address: { ...address, [key]: fields.filter((item) => item !== field) },
      }),
    ).toThrow('hostLocalHandoff.address');
  });

  it.each(['safety', 'replay'])(
    'rejects globally revoking other devices or reactivating historical ACKs in %s',
    (field) => {
      expect(() =>
        assertHostLocalHandoffDeclaration({
          ...contract,
          [field]: 'Revoke every remote device and activate a historical ACK.',
        }),
      ).toThrow('hostLocalHandoff.' + field);
    },
  );

  it('rejects an admitted-owner control entering the GM lobby without a neutral curtain', () => {
    const from = 'NET-006',
      key = 'NET-006::CTA::005';
    const form = forms.find((row) => row['id'] === from)!;
    const actions = form['actions'] as JsonObject;
    const controls = actions['ctaAvailabilityByAction'] as JsonObject[];
    const changed = {
      ...form,
      actions: {
        ...actions,
        ctaAvailabilityByAction: controls.map((row) =>
          row['actionKey'] === key ? { ...row, targetFormId: 'NET-016' } : row,
        ),
      },
    };
    expect(() =>
      assertAdr0096HostLocalHandoff({
        ...source,
        forms: forms.map((row) => (row === form ? changed : row)),
      }),
    ).toThrow(key);
  });

  it('rejects a terminal applicant action present in the graph but absent from its owning requirement', () => {
    const requirements = source['coverageRequirements'] as JsonObject[];
    const changed = requirements.map((row) =>
      row['requirementId'] === 'REQ-010'
        ? {
            ...row,
            actionSteps: (row['actionSteps'] as JsonObject[]).filter(
              (step) => step['formId'] !== 'NET-007',
            ),
          }
        : row,
    );
    expect(() =>
      assertAdr0096HostLocalHandoff({ ...source, coverageRequirements: changed }),
    ).toThrow('NET-007::CTA::005');
  });

  it('rejects a neutral handoff control claiming a Ready command', () => {
    const form = forms.find((row) => row['id'] === 'NET-006')!;
    const actions = form['actions'] as JsonObject;
    const controls = actions['ctaAvailabilityByAction'] as JsonObject[];
    const key = 'NET-006::CTA::005';
    const changed = {
      ...form,
      actions: {
        ...actions,
        ctaAvailabilityByAction: controls.map((row) =>
          row['actionKey'] === key
            ? {
                ...row,
                authoritativeSource: {
                  ...(row['authoritativeSource'] as JsonObject),
                  workflowCommandIds: ['UI-CMD-CAMPAIGN-READY-SET'],
                },
              }
            : row,
        ),
      },
    };
    expect(() =>
      assertAdr0096HostLocalHandoff({
        ...source,
        forms: forms.map((row) => (row === form ? changed : row)),
      }),
    ).toThrow(key);
  });

  it('keeps returning a fresh empty or populated profile distinct from admitting one to three FINALs', () => {
    const form = forms.find((row) => row['id'] === 'APP-003')!;
    const state = (form['states'] as JsonObject)['TARGET_OWNER_ADMISSION'];
    expect(state).toContain('1..3 distinct permitted own FINAL');
    expect(state).toContain(
      'Before SUBMIT, APP-003::CTA::014 accepts 0..3 own FINAL only for the fresh signed bootstrap return or for an acknowledged EXISTING_OWNER_LIBRARY',
    );
    expect(state).toContain(
      'Neither the DEVICE_LIBRARY_SELECTOR nor the primary BIND/continuation admission obtains this return',
    );
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    expect(actions.find((a) => a['actionKey'] === 'APP-003::CTA::009')?.['guard']).toContain(
      'subset, 1..3, current revisions',
    );
    expect(actions.find((a) => a['actionKey'] === 'APP-003::CTA::014')?.['guard']).toContain(
      'zero to three (0..3) currently selected own FINAL, including the empty library',
    );
  });

  it.each([
    ['PLY-029', 'IMPORTED_OWNER_CLAIM'],
    ['PLY-029', 'CONTROL_LEASE'],
    ['PLY-030', 'CONTROL_LEASE'],
    ['PLY-030', 'DEVICE_LIBRARY_SELECTOR'],
  ])('preserves the complete handoffType enum in %s when %s is removed', (id, removed) => {
    const form = forms.find((row) => row['id'] === id)!;
    const requiredFields = (form['requiredFields'] as string[]).map((field) =>
      field.replace('|' + removed, ''),
    );
    expect(requiredFields).not.toEqual(form['requiredFields']);
    expect(() =>
      assertAdr0096HostLocalHandoff({
        ...source,
        forms: forms.map((row) => (row === form ? { ...form, requiredFields } : row)),
      }),
    ).toThrow(id + '.requiredFields changed the handoffType enum');
    expect(
      transitions.filter(
        (row) =>
          row['from'] === 'PLY-029' &&
          row['to'] === 'NET-028' &&
          row['trigger'] === 'Dispatch committed local imported-owner claimant',
      ),
    ).toHaveLength(1);
  });

  it.each(['new owner return', 'previous Ready action'])(
    'rejects a missing %s in the admitted-player QA visible vocabulary',
    (missing) => {
      const id = 'NET-006';
      const form = forms.find((row) => row['id'] === id)!;
      const visible = (form['actions'] as JsonObject)['visible'] as string[];
      const remove = missing === 'new owner return' ? 'Передать устройство мастеру' : 'Готов';
      expect(visible).toContain(remove);
      const qaId = 'QA-FORM-' + id;
      const qaScenarios = source['qaScenarios'] as JsonObject[];
      const original = qaScenarios.find((row) => row['qaId'] === qaId)!;
      const text = original['scenario'];
      if (typeof text !== 'string') throw Error('missing form QA scenario');
      const scenario = text.replace(
        'CTA: ' + visible.join(', ') + '.',
        'CTA: ' + visible.filter((action) => action !== remove).join(', ') + '.',
      );
      expect(scenario).not.toBe(original['scenario']);
      const altered = qaScenarios.map((row) => (row === original ? { ...row, scenario } : row));
      expect(() => assertAdr0096HostLocalHandoff({ ...source, qaScenarios: altered })).toThrow(
        qaId + ' must list the complete visible CTA',
      );
    },
  );

  it.each(['global', 'outgoing', 'incoming'])(
    'rejects a lost committed-ACK projection in the %s route mirror',
    (mirror) => {
      const from = 'PLY-029',
        to = 'NET-027',
        trigger = 'Dispatch acknowledged host-local handoff to NET-027';
      const remove = (rows: JsonObject[]) => rows.filter((row) => row['trigger'] !== trigger);
      const field = mirror === 'outgoing' ? 'transitionsOut' : 'transitionsIn';
      const result =
        mirror === 'global'
          ? { ...source, transitions: remove(transitions) }
          : {
              ...source,
              forms: forms.map((row) =>
                row['id'] === (mirror === 'outgoing' ? from : to)
                  ? { ...row, [field]: remove(row[field] as JsonObject[]) }
                  : row,
              ),
            };
      expect(() => assertAdr0096HostLocalHandoff(result)).toThrow(trigger);
    },
  );

  it('rejects a stale renderer CTA index even if the detailed graph is intact', () => {
    const catalogue = renderer('forms-by-id'),
      primary = renderer('primary-actions-by-form-id'),
      routes = renderer('transitions-by-form-and-trigger');
    expect(() => assertHostLocalHandoffRenderer(source, catalogue, primary, routes)).not.toThrow();
    expect(() =>
      assertHostLocalHandoffRenderer(source, catalogue, { ...primary, 'NET-017': [] }, routes),
    ).toThrow('NET-017::CTA::011');
    const targetRoutes = routes['NET-006'] as JsonObject;
    const label = 'Передать устройство мастеру';
    expect(targetRoutes[label]).toBeDefined();
    expect(() =>
      assertHostLocalHandoffRenderer(source, catalogue, primary, {
        ...routes,
        'NET-006': {
          ...targetRoutes,
          [label]: { ...(targetRoutes[label] as JsonObject), to: 'GM-001' },
        },
      }),
    ).toThrow('NET-006::CTA::005');
  });
});
