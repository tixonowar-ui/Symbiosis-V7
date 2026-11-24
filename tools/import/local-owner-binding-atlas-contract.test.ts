import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractWorkflowCommands } from './atlas.js';
import { ARTIFACT, SPEC_DIR } from './lib/paths.js';
import type { JsonObject, JsonValue } from './lib/json.js';
import {
  assertAdr0095LocalOwnerBinding,
  assertAdr0095LocalOwnerMarkdown,
  assertLocalOwnerBindingDeclaration,
} from './local-owner-binding-atlas-contract.js';
import { generatedAtlasContractSnapshot } from '../validate/atlas-contract-snapshot.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const declaration = (source['globalContracts'] as JsonObject)['localOwnerBinding'] as JsonObject;
const registry = source['registryCoverage'] as JsonObject;
const bind = 'UI-CMD-LOCAL-OWNER-BIND-FINALS';

describe('ADR 0095 installation-local owner binding source', () => {
  it('accepts the supplied full graph and its independent Markdown specification', () => {
    expect(() => assertAdr0095LocalOwnerBinding(source)).not.toThrow();
    expect(() => assertAdr0095LocalOwnerMarkdown(markdown)).not.toThrow();
  });

  it.each(['UI-CMD-LOCAL-OWNER-PROFILE-CREATE', bind])(
    'rejects the historical truncated host vocabulary suffix for %s',
    (commandId) => {
      const canonical = 'QA-WORKFLOW-' + commandId;
      const truncated = 'QA-WORKFLOW-' + commandId.slice('UI-CMD-'.length);
      const commands = registry['workflowCommands'] as JsonObject[];
      const qa = source['qaScenarios'] as JsonObject[];
      expect(commands.find((row) => row['commandId'] === commandId)?.['qa']).toBe(canonical);
      expect(qa.find((row) => row['qaId'] === canonical)?.['scope']).toBe(commandId);
      const workflowCommands = commands.map((row) =>
        row['commandId'] === commandId ? { ...row, qa: truncated } : row,
      );
      const malformedQa = qa.map((row) =>
        row['qaId'] === canonical ? { ...row, qaId: truncated } : row,
      );
      expect(() =>
        extractWorkflowCommands({ ...registry, workflowCommands }, malformedQa, 117),
      ).toThrow('qa must be ' + JSON.stringify(canonical));
    },
  );

  it.each([
    ['profile', 'lifetime', 'INSTALLATION_LOCAL_CROSS_CAMPAIGN', 'CAMPAIGN_SESSION'],
    ['profile', 'selection', 'EXPLICIT_EXACT_ID', 'FIRST_MATCHING_LABEL'],
    ['selector', 'localOwnerIdOrNull', null, 'gm'],
    ['selector', 'authority', 'SELECTION_ONLY', 'GM'],
    ['selector', 'visibility', 'UNASSIGNED_IMMUTABLE_FINAL_ONLY', 'ALL_DEVICE_FINALS'],
    ['curtains', 'requirePriorProjectionErased', true, false],
    ['curtains', 'explicitCooperativeAcknowledgement', true, false],
    ['curtains', 'target', 'HOST_LOCAL_CANDIDATE', 'DEVICE_LIBRARY_SELECTOR'],
    ['binding', 'maximum', 3, 4],
    ['binding', 'assignment', 'UNASSIGNED_TO_EXACT_OWNER_ONCE', 'REASSIGN'],
    [
      'binding',
      'selectionFields',
      ['sourceUuid', 'finalSnapshotVersion', 'metadataRevision', 'candidateSnapshotChecksum'],
      ['sourceUuid'],
    ],
    ['boundaries', 'ackCreatesMembership', false, true],
    ['boundaries', 'bindAllocatesSeat', false, true],
    ['boundaries', 'bindCreatesCampaignCopy', false, true],
    [
      'boundaries',
      'ordinaryNullAccessAfterBinding',
      'UNASSIGNED_ONLY; assigned originals require the exact current acknowledged membership across campaign end and restart',
      'ALL_DEVICE_FINALS_AFTER_CAMPAIGN_END',
    ],
    ['continuation', 'requiresCurrentSignedHandoff', true, false],
    [
      'continuation',
      'neutralMetadataFields',
      ['targetProfileLabel', 'targetLocalOwnerId', 'pendingContinuationId'],
      ['targetProfileLabel', 'selectedFinals'],
    ],
    [
      'modeActions',
      'DEVICE_LIBRARY_SELECTOR',
      ['APP-004::CTA::009', 'APP-004::CTA::010'],
      ['APP-004::CTA::001'],
    ],
    [
      'modeActions',
      'TARGET_OWNER_ADMISSION',
      ['APP-003::CTA::009', 'APP-003::CTA::014'],
      ['APP-003::CTA::009'],
    ],
    [
      'modeActions',
      'TARGET_OWNER_ADMISSION',
      ['APP-003::CTA::009', 'APP-003::CTA::014'],
      ['APP-003::CTA::009', 'APP-003::CTA::014', 'APP-003::CTA::010'],
    ],
    ['admission', 'maximumActiveContexts', 1, 2],
    [
      'modeActions',
      'SELECTOR_CURTAIN',
      ['PLY-030::CTA::003', 'PLY-030::CTA::008'],
      ['PLY-030::CTA::003'],
    ],
    [
      'admission',
      'receiptMapping',
      [
        'sourceUuid',
        'targetLocalOwnerId',
        'proposalChecksum',
        'proposalRevision',
        'receiptId',
        'campaignCharacterId',
        'localControllerSeatId',
      ],
      ['targetLocalOwnerId', 'localControllerSeatId'],
    ],
  ] satisfies [string, string, JsonValue, JsonValue][])(
    'requires %s.%s exactly',
    (section, field, expected, weakened) => {
      const original = declaration[section] as JsonObject;
      expect(original[field]).toEqual(expected);
      const changed = { ...declaration, [section]: { ...original, [field]: weakened } };
      expect(() => assertLocalOwnerBindingDeclaration(changed)).toThrow(
        'localOwnerBinding.' + section,
      );
      const missing = { ...original };
      delete missing[field];
      expect(() =>
        assertLocalOwnerBindingDeclaration({ ...declaration, [section]: missing }),
      ).toThrow('localOwnerBinding.' + section);
    },
  );

  it('rejects a consistent rewrite of both binding workflow and QA that permits partial grants', () => {
    const commands = registry['workflowCommands'] as JsonObject[];
    const command = commands.find((row) => row['commandId'] === bind)!;
    const weakened = { ...command, atomicity: 'Commit each selected FINAL separately.' };
    const updatedRegistry = {
      ...registry,
      workflowCommands: commands.map((row) => (row === command ? weakened : row)),
    };
    const reconnect = command['reconnect'];
    if (typeof reconnect !== 'string') throw Error('Missing bind reconnect contract');
    const qa = (source['qaScenarios'] as JsonObject[]).map((row) =>
      row['qaId'] === command['qa']
        ? { ...row, expected: weakened.atomicity + ' ' + reconnect }
        : row,
    );
    expect(() => extractWorkflowCommands(updatedRegistry, qa, 117)).not.toThrow();
    expect(() =>
      assertAdr0095LocalOwnerBinding({
        ...source,
        registryCoverage: updatedRegistry,
        qaScenarios: qa,
      }),
    ).toThrow('BIND-FINALS');
  });

  it('rejects requiring receipts as bind inputs before a first commit can create them', () => {
    const forms = source['forms'] as JsonObject[];
    const form = forms.find((row) => row['id'] === 'APP-003')!;
    const fields = form['requiredFields'] as string[];
    const input = fields.find((field) => field.startsWith('SELECTOR_BIND_CONFIRM input:'));
    if (input === undefined) throw Error('Missing phase-specific bind fields');
    expect(input).toContain('Only on commit: bindingReceiptId, grantId, pendingContinuationId');
    const requiredFields = fields.map((field) =>
      field === input ? field.replace('Only on commit:', 'Required before commit:') : field,
    );
    const changed = forms.map((row) => (row === form ? { ...row, requiredFields } : row));
    expect(() => assertAdr0095LocalOwnerBinding({ ...source, forms: changed })).toThrow('APP-003');
  });

  it('requires the current acknowledged membership on direct open, reselection and submit', () => {
    const admission = declaration['admission'] as JsonObject;
    const guard = admission['currentMembershipCheck'];
    if (typeof guard !== 'string') throw Error('Missing admission membership guard');
    expect(guard).toContain('listing, direct open, NET-003 reselection and NET-004 submit');
    expect(guard).toContain('durable membership for every exact sourceUuid');
    const changed = {
      ...admission,
      currentMembershipCheck: 'An old binding receipt authorizes every UUID.',
    };
    expect(() =>
      assertLocalOwnerBindingDeclaration({ ...declaration, admission: changed }),
    ).toThrow('localOwnerBinding.admission');
  });

  it('requires the signed pre-bind cancel to erase private buffers and return without either ACK', () => {
    const forms = source['forms'] as JsonObject[];
    const curtain = forms.find((row) => row['id'] === 'PLY-030')!;
    const actions = curtain['actions'] as JsonObject;
    const availability = actions['ctaAvailabilityByAction'] as JsonObject[];
    const cancel = availability.find((row) => row['actionKey'] === 'PLY-030::CTA::008')!;
    expect(cancel['guard']).toContain('no committed binding');
    expect(cancel['guard']).toContain('exact signed GM/neutral return without selector/target ACK');
    const ctaAvailabilityByAction = availability.map((row) =>
      row === cancel
        ? { ...row, guard: 'Cancel even after a grant and restore the last active owner.' }
        : row,
    );
    const changed = { ...curtain, actions: { ...actions, ctaAvailabilityByAction } };
    expect(() =>
      assertAdr0095LocalOwnerBinding({
        ...source,
        forms: forms.map((row) => (row === curtain ? changed : row)),
      }),
    ).toThrow('PLY-030');
  });

  it.each(['LIFETIME', 'TARGET', 'PRIVACY', 'ATOMICITY', 'RESUME', 'ADMISSION'])(
    'rejects a missing behavior-specific %s QA case',
    (area) => {
      const id = 'QA-LOCAL-OWNER-' + area;
      const qaScenarios = (source['qaScenarios'] as JsonObject[]).filter(
        (row) => row['qaId'] !== id,
      );
      expect(() => assertAdr0095LocalOwnerBinding({ ...source, qaScenarios })).toThrow(id);
    },
  );

  it('rejects replacing the fresh empty-profile journey with a requirement to bind an existing FINAL', () => {
    const id = 'QA-FORM-APP-004';
    const rows = source['qaScenarios'] as JsonObject[];
    const form = rows.find((row) => row['qaId'] === id)!;
    const scenario = form['scenario'];
    if (typeof scenario !== 'string') throw Error('Missing APP-004 QA scenario');
    const route = 'HOST_LOCAL_CANDIDATE ACK, APP-004 → CHR-001';
    expect(scenario).toContain(route);
    const changed = { ...form, scenario: scenario.replace(route, 'Bind an existing FINAL first') };
    const qaScenarios = rows.map((row) => (row === form ? changed : row));
    expect(() => assertAdr0095LocalOwnerBinding({ ...source, qaScenarios })).toThrow(id);
    const markdownRow = markdown.split('\n').find((line) => line.startsWith('| ' + id + ' |'));
    if (markdownRow === undefined) throw Error('Missing APP-004 Markdown QA row');
    expect(markdownRow).toContain(route);
    const changedMarkdown = markdown.replace(
      markdownRow,
      markdownRow.replace(route, 'Bind an existing FINAL first'),
    );
    expect(() => assertAdr0095LocalOwnerMarkdown(changedMarkdown)).toThrow(id);
  });

  it('rejects a global route around the selector ACK even when both original form contracts survive', () => {
    const transitions = [
      ...(source['transitions'] as JsonObject[]),
      { from: 'CMP-009', to: 'APP-004', trigger: 'Open without handoff' },
    ];
    expect(() => assertAdr0095LocalOwnerBinding({ ...source, transitions })).toThrow(
      'local-owner transitions',
    );
  });

  it.each([
    [
      /^\| modeActions \|.*$/m,
      '"TARGET_OWNER_ADMISSION": ["APP-003::CTA::009", "APP-003::CTA::014"]',
      '"TARGET_OWNER_ADMISSION": ["APP-003::CTA::009"]',
      'B18',
    ],
    [
      /^- TARGET_OWNER_ADMISSION input: .*$/m,
      'accepts 0..3 selected own FINAL, including zero',
      'requires a populated profile',
      'APP-003',
    ],
    [
      /^\| TARGET_OWNER_ADMISSION \| isHostDevice=.*$/m,
      'requires 1..3 distinct permitted own FINAL',
      'requires 0..3 selected FINAL',
      'APP-003',
    ],
  ] as const)(
    'rejects modifying a scoped Markdown owner-mode rule %s',
    (row, original, replacement, scope) => {
      const changed = markdown.replace(row, (current) => current.replace(original, replacement));
      expect(changed).not.toBe(markdown);
      expect(() => assertAdr0095LocalOwnerMarkdown(changed)).toThrow(scope);
    },
  );

  it.each([
    ['"explicitCooperativeAcknowledgement": true', '"explicitCooperativeAcknowledgement": false'],
    ['"requiresCurrentSignedHandoff": true', '"requiresCurrentSignedHandoff": false'],
    ['"bindAllocatesSeat": false', '"bindAllocatesSeat": true'],
    ['"visibility": "UNASSIGNED_IMMUTABLE_FINAL_ONLY"', '"visibility": "ALL_DEVICE_FINALS"'],
    [
      '"sourceUuid", "targetLocalOwnerId", "proposalChecksum"',
      '"targetLocalOwnerId", "proposalChecksum"',
    ],
  ])('rejects Markdown-only drift in %s', (original, weakened) => {
    const changed = markdown.replace(original, weakened);
    expect(changed).not.toBe(markdown);
    expect(() => assertAdr0095LocalOwnerMarkdown(changed)).toThrow('B18');
  });
});

describe('ADR 0095 generated source contracts', () => {
  it('checks the emitted contract, form index, routes, workflows, journey, requirements and QA, including independent drift', () => {
    const read = (file: string): JsonValue =>
      JSON.parse(readFileSync(join(SPEC_DIR, 'atlas', file + '.json'), 'utf8')) as JsonValue;
    const generated: JsonObject = {
      counts: (read('meta') as JsonObject)['counts'],
      forms: Object.values(read('forms-by-id') as Record<string, JsonObject>),
      transitions: read('transitions'),
      journeys: read('journeys'),
      coverageRequirements: read('requirements'),
      qaScenarios: read('qa-scenarios'),
      workflowCommands: read('workflow-commands'),
      globalContracts: read('global-contracts'),
    };
    const check = (emitted: JsonObject) =>
      assertAdr0095LocalOwnerBinding(generatedAtlasContractSnapshot(source, emitted));
    expect(() => check(generated)).not.toThrow();
    const contracts = generated['globalContracts'] as JsonObject[];
    const owner = contracts.find((row) => row['contractId'] === 'localOwnerBinding')!;
    const altered = {
      ...owner,
      value: {
        ...(owner['value'] as JsonObject),
        continuation: { requiresCurrentSignedHandoff: false },
      },
    };
    expect(() =>
      check({
        ...generated,
        globalContracts: contracts.map((row) => (row === owner ? altered : row)),
      }),
    ).toThrow('localOwnerBinding.continuation');
    expect(() =>
      check({ ...generated, globalContracts: contracts.filter((row) => row !== owner) }),
    ).toThrow('localOwnerBinding');
    const workflowCommands = (generated['workflowCommands'] as JsonObject[]).filter(
      (row) => row['commandId'] !== bind,
    );
    expect(() => check({ ...generated, workflowCommands })).toThrow(bind);
  });
});
