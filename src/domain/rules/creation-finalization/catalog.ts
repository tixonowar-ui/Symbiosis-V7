import type { SymbiontCatalog, SymbiontSpeciesKey } from '../symbiont-stage/catalog.js';
import type { CreationDevelopmentNode, CreationFinalizationCatalog } from './types.js';

export class CreationFinalizationError extends Error {
  constructor(detail: string) {
    super(`creation finalization: ${detail}`);
    this.name = new.target.name;
  }
}

// Character development-nodes: every species has one L1 root; AQA-008 additionally
// grants the four mandatory linear Trogr nodes after absorption of Dolphin.
const ROOTS: Readonly<Record<SymbiontSpeciesKey, string>> = Object.freeze({
  WEAVER: 'SYM-027',
  TAIPAN: 'SYM-039',
  OWL: 'SYM-047',
  TEACHER: 'SYM-054',
  ARMADILLO: 'SYM-061',
  DRAGON: 'SYM-068',
  TROGR: 'SYM-076',
  KEEPER: 'SYM-084',
  ADVISER: 'SYM-096',
  TICK: 'SYM-103',
  CRICKET: 'SYM-110',
  SPIDER: 'SYM-117',
  CHAMELEON: 'SYM-124',
  PENGUIN: 'SYM-131#MI_MI_MI',
  EEL: 'SYM-137',
  TOAD: 'SYM-144',
  RAT: 'SYM-152',
  DOLPHIN: 'SYM-162',
  MANTIS: 'SYM-168',
  SKUNK: 'SYM-175',
  CHIMERA: 'MON-004',
  PUPPETEER: 'MON-027',
  PLAGUE_DOCTOR: 'MON-042',
});

export function createCreationFinalizationCatalog(
  symbionts: SymbiontCatalog,
  developmentNodes: unknown,
): CreationFinalizationCatalog {
  if (!Array.isArray(developmentNodes))
    throw new CreationFinalizationError('development nodes must be an array');
  const rows = developmentNodes.map((row: unknown) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new CreationFinalizationError('development node must be an object');
    return row as Record<string, unknown>;
  });
  const expected = [
    ...Object.entries(ROOTS).map(([speciesKey, nodeRef]) => ({ speciesKey, nodeRef, level: 1 })),
    ...['SYM-077', 'SYM-078', 'SYM-079', 'SYM-080'].map((nodeRef, index) => ({
      speciesKey: 'TROGR',
      nodeRef,
      level: index + 2,
    })),
  ];
  const initialRows = rows.filter(
    (row) => row.L === 1 || (row.SpeciesKey === 'TROGR' && typeof row.L === 'number' && row.L <= 5),
  );
  if (initialRows.length !== expected.length)
    throw new CreationFinalizationError(
      'initial development node count differs from source contract',
    );
  const initialNodes = expected.map(({ speciesKey, nodeRef, level }): CreationDevelopmentNode => {
    const matches = initialRows.filter((row) => row.NodeRef === nodeRef);
    const row = matches[0];
    if (
      matches.length !== 1 ||
      row === undefined ||
      row.SpeciesKey !== speciesKey ||
      row.L !== level ||
      row.AutomationStatus !== 'AUTOMATED_ACCEPTED' ||
      row.NodeKind !== 'AUTOMATED_ABILITY_NODE' ||
      row.ParentMode !== 'ALL' ||
      typeof row['Название'] !== 'string' ||
      row['Название'].trim().length === 0 ||
      row.SelectionConstraint !==
        (level === 1 ? 'ROOT' : `ALL(SYM-${String(74 + level).padStart(3, '0')})`)
    ) {
      throw new CreationFinalizationError(`initial node ${nodeRef} differs from source contract`);
    }
    if (!symbionts.species.some((species) => species.speciesKey === speciesKey))
      throw new CreationFinalizationError(`initial node species ${speciesKey} is missing`);
    return Object.freeze({
      speciesKey: speciesKey as SymbiontSpeciesKey,
      nodeRef,
      level,
      label: row['Название'],
    });
  });
  return Object.freeze({ symbionts, initialNodes: Object.freeze(initialNodes) });
}
