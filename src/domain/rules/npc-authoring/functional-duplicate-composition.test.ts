import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import {
  createNpcFunctionalDuplicateCatalog,
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
  type NpcFunctionalDuplicateCatalog,
} from './functional-duplicate-composition.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let source: NpcAuthoringSourceCatalog, catalog: NpcFunctionalDuplicateCatalog;
let rules: unknown, developmentNodes: readonly Record<string, unknown>[];
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  source = await loadNpcAuthoringSourceCatalog(root);
  rules = JSON.parse(await readFile(`${root}/generated/spec/rules/rules.json`, 'utf8')) as unknown;
  developmentNodes = JSON.parse(
    await readFile(`${root}/generated/spec/character/development-nodes.json`, 'utf8'),
  ) as readonly Record<string, unknown>[];
  catalog = createNpcFunctionalDuplicateCatalog({
    compositionConsequences: source.compositionConsequences,
    rules,
    developmentNodes,
  });
});
function composition(
  species: 'CHIMERA' | 'WEAVER' | null,
  level = 2,
): NpcCompositionConsequenceProof {
  if (species === null)
    return {
      identityKey: id(1),
      binding: { journalId: id(2), raceCode: 'UNITED' },
      confirmations: [],
      resolutions: [],
    };
  return {
    identityKey: id(1),
    binding: { journalId: id(2), raceCode: 'UNITED' },
    resolutions: [],
    confirmations: [
      {
        confirmationCommandId: id(3),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(4),
          journalId: id(2),
          ordinal: 1,
          raceCode: 'UNITED',
          removals: [],
          buildChanges: [],
          currentOeChanges: [],
          additions: [
            {
              symbiontInstanceId: id(5),
              speciesKey: species,
              targetLevel: level,
              currentOE: 0,
              binding: { kind: 'NONE' },
              learnedNodeRefs: source.development.nodes
                .filter(
                  (n) =>
                    n.speciesKey === species &&
                    n.level <= level &&
                    (species !== 'WEAVER' || n.branchCodeOrNull !== 'EXTERNAL_REGENERATION'),
                )
                .map((n) => n.nodeRef),
            },
          ],
        },
      },
    ],
  };
}
function input(proof = composition(null)) {
  return {
    npcUuid: id(1),
    campaignTimestamp: 2707,
    compositionProof: proof,
    temporaryEffects: [] as const,
  };
}
describe('source-issued current functional duplicate proof', () => {
  it('binds passive MON-009 to the actual learned MON-008 node, without OE or a new effect', () => {
    const original = composition('CHIMERA'),
      bytes = JSON.stringify(original);
    const proof = deriveNpcFunctionalDuplicateProof(catalog, input(original));
    expect(readNpcFunctionalDuplicateProof(proof)).toEqual({
      npcUuid: id(1),
      campaignTimestamp: 2707,
      sources: [{ symbiontInstanceId: id(5), sourceRuleId: 'MON-009', effectOriginOrNull: null }],
    });
    expect(JSON.stringify(original)).toBe(bytes);
    expect(() => readNpcFunctionalDuplicateProof(structuredClone(proof))).toThrow('issued');
    expect(() => readNpcFunctionalDuplicateProof(readNpcFunctionalDuplicateProof(proof))).toThrow(
      'issued',
    );
  });
  it('proves absence for empty composition, unlearned Chimera and merely learned Weaver', () => {
    for (const actual of [composition(null), composition('CHIMERA', 1), composition('WEAVER', 3)]) {
      expect(
        readNpcFunctionalDuplicateProof(deriveNpcFunctionalDuplicateProof(catalog, input(actual)))
          .sources,
      ).toEqual([]);
    }
  });
  it('keeps an entry proof immutable when a later real removal ends the passive', () => {
    const before = composition('CHIMERA');
    const entry = deriveNpcFunctionalDuplicateProof(catalog, input(before));
    const next: NpcCompositionConsequenceProof = {
      ...before,
      confirmations: [
        ...before.confirmations,
        {
          confirmationCommandId: id(6),
          diceModeSnapshot: 'MANUAL',
          input: {
            kind: 'APPLY_COMPOSITION_EDIT',
            factId: id(7),
            journalId: id(2),
            ordinal: 2,
            raceCode: 'UNITED',
            removals: [id(5)],
            additions: [],
            buildChanges: [],
            currentOeChanges: [],
          },
        },
      ],
    };
    expect(
      readNpcFunctionalDuplicateProof(
        deriveNpcFunctionalDuplicateProof(catalog, { ...input(next), campaignTimestamp: 2708 }),
      ).sources,
    ).toEqual([]);
    expect(readNpcFunctionalDuplicateProof(entry).sources).toHaveLength(1);
    expect(readNpcFunctionalDuplicateProof(entry).campaignTimestamp).toBe(2707);
  });
  it('refuses caller temporary effects, foreign identity, imprecise time and unknown proof fields', () => {
    expect(() =>
      deriveNpcFunctionalDuplicateProof(catalog, {
        ...input(),
        temporaryEffects: [{ sourceRuleId: 'SYM-028' }],
      } as never),
    ).toThrow('independently issued');
    expect(() =>
      deriveNpcFunctionalDuplicateProof(catalog, { ...input(), npcUuid: id(99) }),
    ).toThrow();
    expect(() =>
      deriveNpcFunctionalDuplicateProof(catalog, { ...input(), campaignTimestamp: 2707.5 }),
    ).toThrow('exact virtual minute');
    expect(() =>
      deriveNpcFunctionalDuplicateProof(catalog, {
        ...input(),
        functionalDuplicate: true,
      } as never),
    ).toThrow();
    expect(() => deriveNpcFunctionalDuplicateProof(structuredClone(catalog), input())).toThrow(
      'issued',
    );
  });
  it('refuses changed rule-to-node mapping instead of guessing a learned MON-009 node', () => {
    const changed = developmentNodes.map((n) =>
      n.NodeRef === 'MON-008' ? { ...n, 'Rule IDs': 'MON-008' } : n,
    );
    expect(() =>
      createNpcFunctionalDuplicateCatalog({
        compositionConsequences: source.compositionConsequences,
        rules,
        developmentNodes: changed,
      }),
    ).toThrow();
  });
});
