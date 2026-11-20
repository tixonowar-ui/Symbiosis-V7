import {
  assertAdr0085InitialLife,
  assertAdr0085InitialLifeMarkdown,
} from '../import/initial-life-atlas-contract.js';
import {
  assertAdr0086TemporaryWeaver,
  assertAdr0086TemporaryWeaverMarkdown,
} from '../import/temporary-weaver-atlas-contract.js';
import {
  assertAdr0087InitialPoison,
  assertAdr0087InitialPoisonMarkdown,
} from '../import/initial-poison-atlas-contract.js';
import type { JsonObject } from '../import/lib/json.js';
import { generatedAtlasContractSnapshot } from './atlas-contract-snapshot.js';

/** Checks the actual generated outputs, not just the source that should have produced them. */
export function validateNpcInitialStateContracts(
  source: JsonObject,
  generated: JsonObject,
  markdown: string,
): void {
  assertAdr0085InitialLife(source);
  assertAdr0086TemporaryWeaver(source);
  assertAdr0087InitialPoison(source);

  const emitted = generatedAtlasContractSnapshot(source, generated);
  assertAdr0085InitialLife(emitted);
  assertAdr0086TemporaryWeaver(emitted);
  assertAdr0087InitialPoison(emitted);
  assertAdr0085InitialLifeMarkdown(markdown);
  assertAdr0086TemporaryWeaverMarkdown(markdown);
  assertAdr0087InitialPoisonMarkdown(markdown);
}
