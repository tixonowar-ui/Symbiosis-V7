import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadArmorBundleCatalog, type ArmorBundleItemCatalog } from '../armor-bundle-catalog.js';
import { REPO_ROOT } from '../../../tests/fixtures/symbiont-stage.js';
import {
  commitArmorBundleCheckpoint,
  commitArmorBundleEntry,
  commitArmorBundleQualityRoll,
} from '../creation-armor-bundle.js';
import type {
  ArmorBundleEntryRequest,
  ArmorBundleQualityRollRequest,
  ArmorBundleSelectionInput,
} from '../creation-armor-bundle-contract.js';
import { commitCreationWizardCheckpoint } from '../creation-wizard-checkpoint.js';
import { currentCreationWizardRevisions } from '../creation-set-decide.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../../tests/fixtures/manual-symbiont-stage.js';
import {
  assertArmorBundleScreenContracts,
  CHR_021_CONFIRM_ACTION_KEY,
  CHR_021_FORM_ID,
  CHR_021_REQUIRED_FIELDS,
  CHR_021_RETURN_ACTION_KEY,
  CHR_021_ROLL_ACTION_KEY,
  CHR_021_ROUTE,
  projectChr021,
} from './chr-armor-bundle.js';
import { assertScreenContract } from './app.js';

const LEATHER_PREVIEW = {
  armorExpression: 'R6',
  strengthRequirement: '2 за элемент',
  movementPenalty: null,
  acrobaticsPenalty: null,
  runningPenalty: null,
  dodgePenalty: null,
  protections: 'Шлем не закрывает лицо.',
  conditionOrLimitation: null,
  hermetic: false,
  layersAllowed: true,
  physicalArmor: true,
} as const;
const NATE_PREVIEW = {
  armorExpression: '—',
  strengthRequirement: '6',
  movementPenalty: null,
  acrobaticsPenalty: null,
  runningPenalty: null,
  dodgePenalty: null,
  protections:
    'Пока герметичен: +20 к проверкам против заражения симбионтом, болезни, внешней химии и ядовитых испарений; −20 от каждой порции электрического, ментального, химического урона или урона от ядовитых испарений; +20 во встречных проверках против недамажащего электрического/пси-контроля; полностью блокирует вдыхаемые феромоны и заражённые испарения.',
  conditionOrLimitation:
    'При потере ≥1 HP носителем или отдельном режущем/колющем/огненном/разъедающем повреждении костюма теряет все свойства; не защищает от проглоченного/введённого/внутреннего яда и не снимает прежний эффект; ремонт не формализован.',
  hermetic: true,
  layersAllowed: false,
  physicalArmor: false,
} as const;
const ARMOR_CATALOG: Pick<ArmorBundleItemCatalog, 'entries'> = Object.freeze({
  entries: Object.freeze([
    Object.freeze({
      itemId: 'ITM-ARM-001',
      name: 'Кожаный доспех',
      coverageModel: 'ZONE_ELEMENT',
      decisionPreview: LEATHER_PREVIEW,
    }),
    Object.freeze({
      itemId: 'ITM-ARM-005',
      name: 'Нэйт',
      coverageModel: 'FULL_SUIT',
      decisionPreview: NATE_PREVIEW,
    }),
  ]),
});

const SELECTION: readonly ArmorBundleSelectionInput[] = Object.freeze([
  Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }),
  Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'TORSO' }),
]);

const temporaryDirectories: string[] = [];
const setups: ManualWizardSetup[] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) {
    if (setup.database.open) setup.database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

interface ArmorCheckpoints {
  readonly setup: ManualWizardSetup;
  readonly entry: DurableCreationWizardCheckpoint;
  readonly rolled: DurableCreationWizardCheckpoint;
  readonly checkpointed: DurableCreationWizardCheckpoint;
}

function armorCheckpoints(): ArmorCheckpoints {
  const directory = mkdtempSync(join(tmpdir(), 'chr021-projection-'));
  temporaryDirectories.push(directory);
  const setup = createManualWizardSetup(
    'chr021-projection',
    'FREE',
    'MANUAL',
    join(directory, 'host.sqlite'),
  );
  setups.push(setup);
  const composition = commitCreationWizardCheckpoint(
    setup.database,
    manualCompositionRequest(setup, setup.checkpoint, 'chr021-projection-composition', ['EEL']),
    'chr021-projection-composition-receipt',
    setup.catalog,
    () => {
      throw new Error('MANUAL flow must not allocate a random sequence');
    },
    {
      allocateRollRequestId: () => {
        throw new Error('non-Advisor composition must not allocate roll IDs');
      },
      sampleD20: () => {
        throw new Error('non-Advisor composition must not sample');
      },
    },
  );
  const entryRequest: ArmorBundleEntryRequest = {
    commandId: 'chr021-projection-entry-command',
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(composition),
    messageType: 'command.request',
    payload: {
      characterDraftId: setup.characterDraftId,
      draftRevision: composition.receipt.result.draftRevision,
      sourceFormId: 'CHR-019',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_ENTRY',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
  const entry = commitArmorBundleEntry(
    setup.database,
    entryRequest,
    'chr021-projection-entry-receipt',
    {
      catalog: setup.catalog,
      allocateArmorBundleId: () => 'chr021-projection-bundle',
      allocateQualityRollRequestId: () => 'chr021-projection-quality-request',
    },
  );
  const rollRequest: ArmorBundleQualityRollRequest = {
    commandId: 'chr021-projection-roll-command',
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(entry),
    messageType: 'command.request',
    payload: {
      armorBundleId: 'chr021-projection-bundle',
      armorPieces: SELECTION,
      characterDraftId: setup.characterDraftId,
      draftRevision: entry.receipt.result.draftRevision,
      manualFaceOrNull: 16,
      qualityRollRequestId: 'chr021-projection-quality-request',
      sourceFormId: 'CHR-021',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_QUALITY',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
  const rolled = commitArmorBundleQualityRoll(
    setup.database,
    rollRequest,
    'chr021-projection-roll-receipt',
    {
      catalog: setup.catalog,
      armorCatalog: ARMOR_CATALOG,
      sampleD20: () => {
        throw new Error('MANUAL roll must not sample');
      },
    },
  );
  const checkpointed = commitArmorBundleCheckpoint(
    setup.database,
    {
      commandId: 'chr021-projection-checkpoint-command',
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(rolled),
      messageType: 'command.request',
      payload: {
        armorBundleId: 'chr021-projection-bundle',
        characterDraftId: setup.characterDraftId,
        draftRevision: rolled.receipt.result.draftRevision,
        qualityRollReceiptId: 'chr021-projection-roll-receipt',
        sourceFormId: 'CHR-021',
        stage: 'SYMBIONTS',
        variant: 'ARMOR_BUNDLE_CHECKPOINT',
        wizardCheckpointId: setup.wizardCheckpointId,
      },
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    },
    'chr021-projection-checkpoint-receipt',
    { catalog: setup.catalog },
  );
  return { setup, entry, rolled, checkpointed };
}

describe('CHR-021 projection', () => {
  it('matches its source-owned screen contract', () => {
    expect(CHR_021_FORM_ID).toBe('CHR-021');
    expect(CHR_021_ROUTE).toBe('/player/characters/:localCharacterId/create/chr-021');
    expect(CHR_021_REQUIRED_FIELDS).toEqual([
      'characterDraftId',
      'anatomyProfile',
      'armorPieces[1..6]',
      'distinctBodyZones',
      'armorBundleId',
      'qualityRollRequestId',
      'qualityRollReceiptIdOrNull',
      'qualityRecommendation',
      'ownershipState=OWNED_NOT_EQUIPPED',
      'wizardCheckpointId',
      'draftRevision',
      'commandId',
    ]);
    const forms = JSON.parse(
      readFileSync(join(process.cwd(), 'generated', 'spec', 'atlas', 'forms-by-id.json'), 'utf8'),
    ) as Record<string, unknown>;
    assertArmorBundleScreenContracts(forms, assertScreenContract);
  });

  it('projects pre-roll with only the roll action and a sanitized baseline payload', () => {
    const { entry } = armorCheckpoints();
    const projected = projectChr021(entry, ARMOR_CATALOG, true, true);
    expect(projected.formId).toBe('CHR-021');
    expect(projected.formType).toBe('screen');
    expect(projected.routeTemplate).toBe(CHR_021_ROUTE);
    expect(projected.availableActionKeys).toEqual([CHR_021_ROLL_ACTION_KEY]);
    expect(projected.roleFilteredPayload).toMatchObject({
      characterDraftId: entry.localCharacter.localCharacterId,
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId: 'chr021-projection-bundle',
      qualityRollRequestId: 'chr021-projection-quality-request',
      qualityRollReceiptIdOrNull: null,
      armorPieces: [],
      distinctBodyZones: [],
      qualityRecommendation: null,
      ownershipState: 'OWNED_NOT_EQUIPPED',
      diceInputModeSnapshot: 'MANUAL',
      commandId: 'chr021-projection-entry-command',
    });
    expect(projected.roleFilteredPayload['armorCatalog']).toMatchObject({
      entries: [
        { itemId: 'ITM-ARM-001', name: 'Кожаный доспех', coverageModel: 'ZONE_ELEMENT' },
        { itemId: 'ITM-ARM-005', name: 'Нэйт', coverageModel: 'FULL_SUIT' },
      ],
    });
    const json = JSON.stringify(projected.roleFilteredPayload);
    for (const forbidden of ['Источник', 'Rule IDs', 'availabilityTrace', 'randomSequenceId']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('projects post-roll with confirm and safe-return actions and hides the roll', () => {
    const { rolled } = armorCheckpoints();
    const projected = projectChr021(rolled, ARMOR_CATALOG, true, true);
    expect(projected.availableActionKeys).toEqual([
      CHR_021_CONFIRM_ACTION_KEY,
      CHR_021_RETURN_ACTION_KEY,
    ]);
    expect(projected.roleFilteredPayload).toMatchObject({
      qualityRollReceiptIdOrNull: 'chr021-projection-roll-receipt',
      armorPieces: [
        {
          itemId: 'ITM-ARM-001',
          name: 'Кожаный доспех',
          coverageModel: 'ZONE_ELEMENT',
          bodyZone: 'HEAD',
        },
        {
          itemId: 'ITM-ARM-001',
          name: 'Кожаный доспех',
          coverageModel: 'ZONE_ELEMENT',
          bodyZone: 'TORSO',
        },
      ],
      distinctBodyZones: ['HEAD', 'TORSO'],
      qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
      ownershipState: 'OWNED_NOT_EQUIPPED',
      commandId: 'chr021-projection-roll-command',
    });
    expect(projected.roleFilteredPayload['qualityRecommendation']).not.toHaveProperty('modifier');
  });

  it('gates actions by capability and leaves the checkpointed form actionless', () => {
    const { entry, rolled, checkpointed } = armorCheckpoints();
    expect(projectChr021(entry, ARMOR_CATALOG, false, true).availableActionKeys).toEqual([]);
    expect(projectChr021(entry, ARMOR_CATALOG, true, false).availableActionKeys).toEqual([
      CHR_021_ROLL_ACTION_KEY,
    ]);
    expect(projectChr021(rolled, ARMOR_CATALOG, true, false).availableActionKeys).toEqual([
      CHR_021_RETURN_ACTION_KEY,
    ]);
    expect(projectChr021(rolled, ARMOR_CATALOG, false, false).availableActionKeys).toEqual([
      CHR_021_RETURN_ACTION_KEY,
    ]);
    expect(projectChr021(checkpointed, ARMOR_CATALOG, true, true).availableActionKeys).toEqual([]);
  });

  it('refuses to project without an armor stage', () => {
    const { entry } = armorCheckpoints();
    const compositionOnly = {
      ...entry,
      armorBundleStage: null,
    };
    expect(() => projectChr021(compositionOnly, ARMOR_CATALOG, true, true)).toThrow(
      'armor bundle stage is missing',
    );
  });
});

const ITEM_FILES = ['catalogue.json', 'armor-profiles.json', 'dictionaries.json'] as const;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function itemRoot(root: string): string {
  return join(root, 'generated', 'spec', 'items');
}

function createItemRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-armor-catalog-'));
  temporaryRoots.push(root);
  mkdirSync(itemRoot(root), { recursive: true });
  for (const file of ITEM_FILES) {
    cpSync(join(REPO_ROOT, 'generated', 'spec', 'items', file), join(itemRoot(root), file));
  }
  return root;
}

function readItems(root: string, file: string): unknown {
  return JSON.parse(readFileSync(join(itemRoot(root), file), 'utf8')) as unknown;
}

function writeItems(root: string, file: string, value: unknown): void {
  writeFileSync(join(itemRoot(root), file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('CHR-021 armor bundle item catalog', () => {
  it('loads exactly eight canonical template-fixed armor entries from generated items', async () => {
    const catalog = await loadArmorBundleCatalog(REPO_ROOT);
    expect(catalog.entries.map((entry) => [entry.itemId, entry.name, entry.coverageModel])).toEqual(
      [
        ['ITM-ARM-001', 'Кожаный доспех', 'ZONE_ELEMENT'],
        ['ITM-ARM-002', 'Бригантина', 'ZONE_ELEMENT'],
        ['ITM-ARM-003', 'Кольчуга', 'ZONE_ELEMENT'],
        ['ITM-ARM-004', 'Латы', 'ZONE_ELEMENT'],
        ['ITM-ARM-005', 'Нэйт', 'FULL_SUIT'],
        ['ITM-ARM-006', 'Кастелькросс', 'FULL_SUIT'],
        ['ITM-ARM-007', 'Цесмор', 'FULL_SUIT'],
        ['ITM-ARM-008', 'Гленхейм', 'FULL_SUIT'],
      ],
    );
    expect(catalog.bodyZones).toEqual(['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R']);
    expect(catalog.qualityScale.map((entry) => [entry.range, entry.label])).toEqual([
      ['1–4', 'Отсутствует/непригоден'],
      ['5–9', 'Плохое'],
      ['10–14', 'Обычное'],
      ['15–18', 'Хорошее'],
      ['19', 'Исключительное'],
      ['20', 'Редкое'],
    ]);
  });

  it('loads source-backed decision previews for all eight profiles without private fields', async () => {
    const catalog = await loadArmorBundleCatalog(REPO_ROOT);
    expect(
      catalog.entries.map((entry) => [
        entry.itemId,
        entry.decisionPreview.armorExpression,
        entry.decisionPreview.strengthRequirement,
        entry.decisionPreview.movementPenalty,
        entry.decisionPreview.acrobaticsPenalty,
        entry.decisionPreview.runningPenalty,
        entry.decisionPreview.dodgePenalty,
      ]),
    ).toEqual([
      ['ITM-ARM-001', 'R6', '2 за элемент', null, null, null, null],
      ['ITM-ARM-002', 'R12', '3 за элемент', '−3 при >2', '−1 за элемент', '−1 за элемент', null],
      ['ITM-ARM-003', 'R12', '3 за элемент', '−3 при >2', '−1 за элемент', '−1 за элемент', null],
      ['ITM-ARM-004', 'R20', '4 за элемент', '−5 при >2', '−2 за элемент', '−2 за элемент', null],
      ['ITM-ARM-005', '—', '6', null, null, null, null],
      ['ITM-ARM-006', 'R20', '20', '−3', '−6', '−6', null],
      ['ITM-ARM-007', 'R20', '14', null, null, null, null],
      ['ITM-ARM-008', '2×R20+5 (тот же бросок)', '24', '−5', '−12', '−12', '−6'],
    ]);
    expect(catalog.entries[0]?.decisionPreview).toMatchObject({
      hermetic: false,
      layersAllowed: true,
      physicalArmor: true,
      protections: 'Шлем не закрывает лицо.',
      conditionOrLimitation: null,
    });
    expect(catalog.entries[4]?.decisionPreview).toMatchObject({
      hermetic: true,
      layersAllowed: false,
      physicalArmor: false,
    });
    expect(catalog.entries[7]?.decisionPreview.protections).toBe(
      'Иммунитет травмирующим и удушающим приёмам.',
    );
    for (const index of [5, 6, 7]) {
      const condition = catalog.entries[index]?.decisionPreview.conditionOrLimitation;
      expect(condition).toContain('Слои разрешены');
      expect(condition).toContain('физическая совместимость подтверждается мастером');
      expect(condition).not.toContain('CORE-151');
    }
    const json = JSON.stringify(catalog.entries);
    for (const forbidden of ['Rule ID', 'PDF, с.', 'Источник', 'availabilityTrace']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('fails closed when a duplicate armor row appears in catalogue or profiles', async () => {
    const extraCatalogueRoot = createItemRoot();
    const catalogue = readItems(extraCatalogueRoot, 'catalogue.json') as
      Record<string, unknown> | Record<string, unknown>[];
    const allRows = (Array.isArray(catalogue) ? catalogue : Object.values(catalogue)) as Record<
      string,
      unknown
    >[];
    const sourceRow = allRows.find((row) => row['ItemTypeID'] === 'ITM-ARM-001')!;
    if (Array.isArray(catalogue)) catalogue.push({ ...sourceRow });
    else catalogue['64'] = { ...sourceRow };
    writeItems(extraCatalogueRoot, 'catalogue.json', catalogue);
    await expect(loadArmorBundleCatalog(extraCatalogueRoot)).rejects.toThrow(
      'duplicate catalogue armor row ITM-ARM-001',
    );

    const extraProfileRoot = createItemRoot();
    const profiles = readItems(extraProfileRoot, 'armor-profiles.json') as Record<
      string,
      unknown
    >[];
    profiles.push({ ...(profiles[0] as Record<string, unknown>) });
    writeItems(extraProfileRoot, 'armor-profiles.json', profiles);
    await expect(loadArmorBundleCatalog(extraProfileRoot)).rejects.toThrow(
      'duplicate armor profile',
    );
  });

  it('fails closed on drifted dictionaries, inventory flags or armor policy', async () => {
    const qualityRoot = createItemRoot();
    const dictionaries = readItems(qualityRoot, 'dictionaries.json') as Record<string, unknown>[];
    writeItems(
      qualityRoot,
      'dictionaries.json',
      dictionaries.filter(
        (entry) => !(entry['Dictionary'] === 'QUALITY' && entry['Code'] === '19'),
      ),
    );
    await expect(loadArmorBundleCatalog(qualityRoot)).rejects.toThrow('QUALITY 19');

    const zoneRoot = createItemRoot();
    const zoneDictionaries = readItems(zoneRoot, 'dictionaries.json') as Record<string, unknown>[];
    writeItems(
      zoneRoot,
      'dictionaries.json',
      zoneDictionaries.map((entry) =>
        entry['Dictionary'] === 'BODY_ZONE' && entry['Code'] === 'HEAD'
          ? { ...entry, Code: 'SKULL' }
          : entry,
      ),
    );
    await expect(loadArmorBundleCatalog(zoneRoot)).rejects.toThrow('BODY_ZONE HEAD');

    const policyRoot = createItemRoot();
    const catalogue = readItems(policyRoot, 'catalogue.json') as
      Record<string, unknown> | Record<string, unknown>[];
    const allRows = (Array.isArray(catalogue) ? catalogue : Object.values(catalogue)) as Record<
      string,
      unknown
    >[];
    const armorRow = allRows.find((row) => row['ItemTypeID'] === 'ITM-ARM-002')!;
    armorRow['Политика заявки игрока'] = 'OPEN';
    writeItems(policyRoot, 'catalogue.json', catalogue);
    await expect(loadArmorBundleCatalog(policyRoot)).rejects.toThrow('TEMPLATE_FIXED');
  });

  it('rejects a linked project root while preserving containment checks', async () => {
    const root = createItemRoot();
    const linkParent = mkdtempSync(join(tmpdir(), 'symbiosis-armor-catalog-link-'));
    temporaryRoots.push(linkParent);
    const linkedRoot = join(linkParent, 'linked-project');
    mkdirSync(dirname(linkedRoot), { recursive: true });
    await import('node:fs').then(({ symlinkSync }) => symlinkSync(root, linkedRoot, 'junction'));
    const catalog = await loadArmorBundleCatalog(linkedRoot);
    expect(catalog.entries).toHaveLength(8);
  });
});
