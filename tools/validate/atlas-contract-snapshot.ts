import { asArray, asObject, asString, type JsonObject } from '../import/lib/json.js';
import { fail } from '../import/lib/fail.js';

const WHERE = 'generated Atlas contract snapshot';

export function generatedAtlasContractSnapshot(
  source: JsonObject,
  generated: JsonObject,
): JsonObject {
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
  return {
    atlasVersion: generated['atlasVersion'],
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
}
