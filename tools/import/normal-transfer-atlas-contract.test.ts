import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0079NormalTransfer,
  assertAdr0079NormalTransferMarkdown,
} from './normal-transfer-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const record = (value: unknown) => value as JsonObject;
function changed(target: 'forms' | 'workflowCommands', id: string) {
  const root = { ...source };
  const container =
    target === 'workflowCommands'
      ? (root['registryCoverage'] = { ...record(source['registryCoverage']) })
      : root;
  const key = target === 'forms' ? 'id' : 'commandId';
  const rows = (container[target] as JsonObject[]).map((row) =>
    row[key] === id ? structuredClone(row) : row,
  );
  container[target] = rows;
  const row = rows.find((row) => row[key] === id);
  if (row === undefined) throw new Error('Missing accepted source ' + id);
  return { root, row };
}

describe('ADR 0079 approved normal master transfer source', () => {
  it('accepts the exact JSON and independently supplied Markdown', () => {
    expect(() => assertAdr0079NormalTransfer(source)).not.toThrow();
    expect(() => assertAdr0079NormalTransferMarkdown(markdown)).not.toThrow();
  });
  it('refuses a client-selected terminal role instead of the confirmed COMMIT binding', () => {
    const { root, row } = changed('forms', 'NET-025');
    const fields = row['requiredFields'] as string[];
    expect(fields.filter((value) => value.startsWith('participantReturnContext='))).toHaveLength(1);
    row['requiredFields'] = fields.map((value) =>
      value.startsWith('participantReturnContext=')
        ? 'participantReturnContext=client-selected GM_PANEL before ACK or COMMIT'
        : value,
    );
    expect(() => assertAdr0079NormalTransfer(root)).toThrow('NET-025');
  });
  it('refuses an admitted PC prerequisite for a paired successor without a character', () => {
    const { root, row } = changed('forms', 'NET-024');
    (row['requiredFields'] as string[]).push('successorCampaignCharacterId=REQUIRED_ACTIVE_PC');
    expect(() => assertAdr0079NormalTransfer(root)).toThrow('NET-024');
  });
  it.each(['newGmPasswordInputAndConfirmation=', 'newGmCredentialStatus='])(
    'refuses removal of successor-local credential field %s',
    (prefix) => {
      const { root, row } = changed('forms', 'NET-025');
      const fields = row['requiredFields'] as string[];
      expect(fields.filter((value) => value.startsWith(prefix))).toHaveLength(1);
      row['requiredFields'] = fields.filter((value) => !value.startsWith(prefix));
      expect(() => assertAdr0079NormalTransfer(root)).toThrow('NET-025');
    },
  );
  it.each([
    [
      'UI-CMD-MASTER-TRANSFER-ACK',
      'atomicity',
      'Publish the new password and verifier to all peers and grant GM on ACCEPT.',
    ],
    [
      'UI-CMD-MASTER-TRANSFER-COMMIT',
      'atomicity',
      'Copy the old host private key and retain both GM authorities.',
    ],
    [
      'UI-CMD-MASTER-TRANSFER-CANCEL',
      'atomicity',
      'Revoke a completed transfer and grant authority to its initiator.',
    ],
    [
      'UI-CMD-MASTER-TRANSFER-RECONNECT',
      'guards',
      'Trust any endpoint with the same address; no identity proof or explicit action is required.',
    ],
  ])('refuses privacy/authority/trust drift of %s', (id, field, replacement) => {
    const { root, row } = changed('workflowCommands', id);
    expect(typeof row[field]).toBe('string');
    row[field] = replacement;
    expect(() => assertAdr0079NormalTransfer(root)).toThrow('registryCoverage');
  });
  it.each([
    'UI-CMD-MASTER-TRANSFER-UNLOCK',
    'UI-CMD-MASTER-TRANSFER-ACK',
    'UI-CMD-MASTER-TRANSFER-COMMIT',
    'UI-CMD-MASTER-TRANSFER-CANCEL',
    'UI-CMD-MASTER-TRANSFER-RECONNECT',
  ])('refuses fresh effects instead of exact receipt replay for %s', (id) => {
    const { root, row } = changed('workflowCommands', id);
    row['reconnect'] = 'Replay creates a new receipt and repeats the transfer effects.';
    expect(() => assertAdr0079NormalTransfer(root)).toThrow('registryCoverage');
  });
  it('refuses boot exit that discards the authenticated player or GM session', () => {
    const { root, row } = changed('forms', 'NET-025');
    const actions = record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[];
    const matches = actions.filter((action) => action['targetFormId'] === 'APP-001');
    expect(matches).toHaveLength(1);
    matches[0]!['guard'] = 'Always clear the current gameplay session and enter APP-001.';
    expect(() => assertAdr0079NormalTransfer(root)).toThrow('NET-025');
  });
  it.each([
    [
      '### NET-025 —',
      'server-bound context of the authenticated participant',
      'client-selected terminal context',
    ],
    ['### NET-025 —', 'verifier successor-local only', 'verifier public to every device'],
    [
      '### NET-009 —',
      'Ordinary reconnect still requires the previous pinned identity.',
      'An address change silently replaces pinned identity.',
    ],
  ])('refuses independent Markdown privacy/terminal drift in %s', (heading, before, after) => {
    const start = markdown.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = markdown.indexOf('\n### ', start + heading.length);
    expect(next).toBeGreaterThan(start);
    const section = markdown.slice(start, next);
    expect(section).toContain(before);
    const mutated =
      markdown.slice(0, start) + section.replace(before, after) + markdown.slice(next);
    expect(mutated).not.toBe(markdown);
    expect(() => assertAdr0079NormalTransferMarkdown(mutated)).toThrow(heading);
  });
});
