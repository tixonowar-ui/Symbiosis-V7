import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0075CampaignSettings,
  assertAdr0075CampaignSettingsMarkdown,
} from './campaign-settings-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const record = (value: unknown) => value as JsonObject;
const workflow = 'UI-CMD-CAMPAIGN-SETTINGS-SET';
function changed(target: string, id: string) {
  const root = { ...source };
  const container =
    target === 'workflowCommands'
      ? (root['registryCoverage'] = { ...record(source['registryCoverage']) })
      : root;
  const key =
    target === 'workflowCommands'
      ? 'commandId'
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
describe('ADR 0075 approved campaign settings source', () => {
  it('retains the closed lobby QA contract before extending settings and keeps filled Markdown tables intact', () => {
    const { root, row } = changed('qaScenarios', 'QA-FORM-CMP-007');
    const scenario = row['scenario'] as string;
    const start = scenario.indexOf('Closed PRE_START/STARTED_PEACE read-only panels'),
      end = scenario.indexOf(' CMP-008 reuses');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(scenario.slice(start, end)).toContain(
      'Map marker identity/revision/coordinates and unconfigured localLighting are ABSENT, not zero.',
    );
    expect(scenario.slice(start, end)).toContain(
      'No group/map mutation, NPC command or future capability is opened by these variants.',
    );
    row['scenario'] = scenario.slice(0, start) + scenario.slice(end);
    expect(() => assertAdr0075CampaignSettings(root)).toThrow('QA-FORM-CMP-007');
    const formStart = markdown.indexOf('### CMP-008 —'),
      formEnd = markdown.indexOf('\n### ', formStart + 1);
    expect(markdown.slice(formStart, formEnd)).not.toMatch(
      /\|[-: |]+\|\r?\n\r?\n\| (?:CMP-\d|UI-CMD-)/u,
    );
  });

  it('accepts the exact supplied JSON and independent Markdown mirror', () => {
    expect(() => assertAdr0075CampaignSettings(source)).not.toThrow();
    expect(() => assertAdr0075CampaignSettingsMarkdown(markdown)).not.toThrow();
  });
  it.each(['CMP-006', 'CMP-007', 'CMP-008', 'NET-009'])(
    'rejects changed authority or invented mandatory values on %s',
    (id) => {
      for (const key of ['roles', 'requiredFields']) {
        const { root, row } = changed('forms', id);
        row[key] = key === 'roles' ? ['player', 'gm', 'system'] : ['fabricatedHostIdentity'];
        expect(() => assertAdr0075CampaignSettings(root)).toThrow(id);
      }
    },
  );
  it.each(['CMP-008::CTA::008', 'CMP-008::CTA::009'])(
    'seals the real control and its independent guard: %s',
    (key) => {
      const { root, row } = changed('forms', 'CMP-008');
      const cta = (record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[]).find(
        (x) => x['actionKey'] === key,
      )!;
      cta['guard'] = 'true';
      expect(() => assertAdr0075CampaignSettings(root)).toThrow('CMP-008');
    },
  );
  it.each([
    ['CMP-008', 'Owner decision #208'],
    ['CMP-008', 'Closed settings command payload'],
    ['CMP-008', 'Exact commandId/payload replay'],
    ['CMP-008', 'CMP-008 exposes labeled'],
    ['CMP-006', 'The published hostAddress'],
    ['NET-009', 'NET-009 permits an explicit'],
    ['NET-009', 'The new pinnedCampaignPeerReconnectOrNull'],
  ])('rejects removal of %s invariant %s', (id, prefix) => {
    const { root, row } = changed('forms', id);
    const criteria = row['acceptanceCriteria'] as string[],
      index = criteria.findIndex((x) => x.startsWith(prefix));
    expect(index).toBeGreaterThanOrEqual(0);
    criteria.splice(index, 1);
    expect(() => assertAdr0075CampaignSettings(root)).toThrow(id);
  });
  it.each([
    ['journeys', 'J-HOST-PUBLISH-SETTINGS'],
    ['journeys', 'J-CAMPAIGN-LIFECYCLE'],
    ['journeys', 'J-RECONNECT'],
    ['coverageRequirements', 'REQ-008'],
    ['coverageRequirements', 'REQ-055'],
    ['qaScenarios', 'QA-REQ-008'],
    ['qaScenarios', 'QA-REQ-055'],
    ['qaScenarios', 'QA-WORKFLOW-' + workflow],
    ['workflowCommands', workflow],
  ])('rejects drift in the complete %s mirror %s', (target, id) => {
    const { root, row } = changed(target, id);
    row['unexpectedRelaxation'] = true;
    expect(() => assertAdr0075CampaignSettings(root)).toThrow(id);
  });
  it('seals both local transition mirrors and the complete global transition set', () => {
    const root = { ...source, transitions: [...(source['transitions'] as JsonObject[])] };
    const index = root.transitions.findIndex(
      (x) => x['from'] === 'CMP-008' && x['trigger'] === 'Сохранить настройки',
    );
    expect(index).toBeGreaterThanOrEqual(0);
    root.transitions[index] = { ...root.transitions[index], to: 'CMP-006' };
    expect(() => assertAdr0075CampaignSettings(root)).toThrow('transitions');
    for (const field of ['transitionsIn', 'transitionsOut']) {
      const local = changed('forms', 'CMP-008');
      const transition = (local.row[field] as JsonObject[]).find(
        (row) => row['trigger'] === 'Сохранить настройки',
      );
      expect(transition).toBeDefined();
      transition!['guard'] = 'true';
      expect(() => assertAdr0075CampaignSettings(local.root)).toThrow('CMP-008');
    }
  });
  it('shows the accepted semantics explicitly instead of treating network settings as live rebind', () => {
    const { row } = changed('forms', 'CMP-008');
    const criteria = (row['acceptanceCriteria'] as string[]).join('\n');
    expect(criteria).toContain('NEXT campaign listener launch only');
    expect(criteria).toContain('Saving never rebinds the current listener');
    expect(criteria).toContain('no new length limits or defaults');
    const wf = (record(source['registryCoverage'])['workflowCommands'] as JsonObject[]).find(
      (x) => x['commandId'] === workflow,
    )!;
    expect(wf['atomicity']).toContain('Metadata updates the current settings and display');
    expect(wf['atomicity']).toContain('Default roll mode applies only to new requests');
  });
  it.each([
    '### CMP-008 —',
    '### NET-009 —',
    '### J-CAMPAIGN-LIFECYCLE —',
    '| QA-REQ-008 |',
    '| QA-REQ-055 |',
  ])('checks Markdown independently at %s', (anchor) => {
    const offset = markdown.indexOf(anchor);
    expect(offset).toBeGreaterThanOrEqual(0);
    const changed = markdown.slice(0, offset) + markdown.slice(offset).replace(' |', ' changed |');
    expect(() => assertAdr0075CampaignSettingsMarkdown(changed)).toThrow();
  });
});
