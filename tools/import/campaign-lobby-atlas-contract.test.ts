import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0073LobbyStart,
  assertAdr0073LobbyStartMarkdown,
} from './campaign-lobby-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const record = (value: unknown): JsonObject => value as JsonObject;
function mutatedRow(target: string, id: string): { root: JsonObject; row: JsonObject } {
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
  if (!row) throw new Error('missing real source row: ' + id);
  return { root, row };
}

describe('ADR 0073 approved lobby/Start source', () => {
  it('accepts the supplied JSON and independently checked Markdown', () => {
    expect(() => assertAdr0073LobbyStart(source)).not.toThrow();
    expect(() => assertAdr0073LobbyStartMarkdown(markdown)).not.toThrow();
  });

  it.each(['NET-006', 'NET-016', 'CMP-007', 'GM-001', 'GRP-001', 'PLY-001'])(
    'rejects foreign authority or fabricated mandatory entities on %s',
    (id) => {
      for (const key of ['roles', 'requiredFields']) {
        const { root, row } = mutatedRow('forms', id);
        row[key] =
          key === 'roles'
            ? ['system', 'player', 'gm']
            : ['combatId', 'effectInstanceId', 'markerRevision'];
        expect(() => assertAdr0073LobbyStart(root)).toThrow(id);
      }
    },
  );

  it.each([
    ['NET-006', 'Owner decision #206'],
    ['NET-006', 'lobbySnapshotRevision changes'],
    ['NET-006', 'Closed Ready command payload'],
    ['NET-006', 'Any authenticated own admitted tab'],
    ['NET-016', 'The host validates the complete admitted ACTIVE roster'],
    ['NET-016', 'Closed initialCampaignTime input'],
    ['NET-016', 'Start atomically creates exactly one'],
    ['NET-016', 'Every newly available player/GM capability'],
    ['PLY-001', 'Closed PEACE_SNAPSHOT'],
    ['PLY-001', 'PEACE_SNAPSHOT contains real sceneId'],
    ['PLY-001', 'The global Start receipt'],
    ['GRP-001', 'Location labels belong to individual'],
    ['CMP-007', 'Closed PRE_START/STARTED_PEACE'],
    ['GM-001', 'Existing authenticated admitted bindings'],
  ])('rejects removal of %s invariant %s', (id, prefix) => {
    const { root, row } = mutatedRow('forms', id);
    const criteria = row['acceptanceCriteria'] as string[];
    const index = criteria.findIndex((value) => value.startsWith(prefix));
    expect(index).toBeGreaterThanOrEqual(0);
    criteria.splice(index, 1);
    expect(() => assertAdr0073LobbyStart(root)).toThrow(id);
  });

  it.each([
    ['NET-006', 'NET-006::CTA::003'],
    ['NET-006', 'NET-006::CTA::004'],
    ['NET-016', 'NET-016::CTA::004'],
    ['NET-016', 'NET-016::CTA::002'],
  ])('rejects a missing real control or bypassed guard %s %s', (id, key) => {
    const { root, row } = mutatedRow('forms', id);
    const actions = record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[];
    const action = actions.find((value) => value['actionKey'] === key)!;
    action['guard'] = 'client-supplied ready or system time is sufficient';
    expect(() => assertAdr0073LobbyStart(root)).toThrow(id);
  });

  it.each([
    'UI-CMD-CAMPAIGN-READY-SET',
    'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    'UI-CMD-CAMPAIGN-START',
  ])('rejects workflow and QA drift for %s', (id) => {
    const command = mutatedRow('workflowCommands', id);
    command.row['guards'] = 'any PAUSED campaign including a previously started scene';
    expect(() => assertAdr0073LobbyStart(command.root)).toThrow(id);
    const qa = mutatedRow('qaScenarios', 'QA-WORKFLOW-' + id);
    qa.row['expected'] = 'create a new scene on every replay';
    expect(() => assertAdr0073LobbyStart(qa.root)).toThrow('QA-WORKFLOW-' + id);
  });

  it('rejects an early owner scene route even when the global route looks valid', () => {
    const { root, row } = mutatedRow('forms', 'NET-006');
    const route = (row['transitionsOut'] as JsonObject[]).find(
      (value) => value['to'] === 'PLY-001',
    )!;
    route['guard'] = 'admission ACCEPT alone';
    expect(() => assertAdr0073LobbyStart(root)).toThrow('NET-006');
  });

  it.each([
    ['journeys', 'J-CAMPAIGN-CREATE', 'workflowCommandIds'],
    ['journeys', 'J-JOIN-REVIEW', 'alternatives'],
    ['coverageRequirements', 'REQ-004', 'actionSteps'],
    ['coverageRequirements', 'REQ-055', 'workflowCommandIds'],
  ])('rejects loss of the %s %s mirror', (target, id, key) => {
    const { root, row } = mutatedRow(target, id);
    row[key] = [];
    expect(() => assertAdr0073LobbyStart(root)).toThrow(id);
  });

  it.each([
    'Owner decision #206',
    'Closed initialCampaignTime input:',
    'Closed PEACE_SNAPSHOT is owner-only',
    'Every newly available player/GM capability',
  ])('rejects independent Markdown drift: %s', (text) => {
    expect(markdown).toContain(text);
    expect(() =>
      assertAdr0073LobbyStartMarkdown(markdown.replace(text, 'REMOVED APPROVED CONTRACT')),
    ).toThrow('ADR 0073');
  });
});
