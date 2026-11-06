import {
  assertAdr0085InitialLife,
  assertAdr0085InitialLifeMarkdown,
} from '../import/initial-life-atlas-contract.js';
import {
  assertAdr0086TemporaryWeaver,
  assertAdr0086TemporaryWeaverMarkdown,
} from '../import/temporary-weaver-atlas-contract.js';
import { asArray, asObject, asString, type JsonObject } from '../import/lib/json.js';
import { fail } from '../import/lib/fail.js';

const WHERE = 'NPC initial-state validation';

/** Checks the actual generated outputs, not just the source that should have produced them. */
export function validateNpcInitialStateContracts(
  source: JsonObject,
  generated: JsonObject,
  markdown: string,
): void {
  assertAdr0085InitialLife(source);
  assertAdr0086TemporaryWeaver(source);

  const seen = new Set<string>();
  const globalContracts = Object.fromEntries(
    asArray(generated['globalContracts'], WHERE, 'global-contracts').map((value) => {
      const row = asObject(value, WHERE, 'global-contracts[]');
      if (Object.keys(row).sort().join(',') !== 'contractId,value')
        fail(WHERE, 'global-contracts row has unknown or missing fields');
      const id = asString(row['contractId'], WHERE, 'global-contracts[].contractId');
      if (seen.has(id)) fail(WHERE, 'duplicate global contract identity');
      seen.add(id);
      return [id, row['value']] as const;
    }),
  );
  // Registry coverage outside workflowCommands is not emitted separately. Its
  // source was sealed above; every emitted contract component replaces source
  // data explicitly, so missing/stale generated files cannot fall back to it.
  const emitted: JsonObject = {
    counts: generated['counts'],
    forms: generated['forms'],
    transitions: generated['transitions'],
    journeys: generated['journeys'],
    coverageRequirements: generated['coverageRequirements'],
    qaScenarios: generated['qaScenarios'],
    registryCoverage: {
      ...asObject(source['registryCoverage'], WHERE, 'source.registryCoverage'),
      workflowCommands: generated['workflowCommands'],
    },
    globalContracts,
  };
  assertAdr0085InitialLife(emitted);
  assertAdr0086TemporaryWeaver(emitted);
  assertAdr0085InitialLifeMarkdown(markdown);
  assertAdr0086TemporaryWeaverMarkdown(markdown);
}
