import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadNpcAuthoringSourceCatalog, type NpcAuthoringSourceCatalog } from '../npc-catalog.js';
import { npcPureInitialSkillFixture } from '../../../tests/fixtures/npc-clean-humanoid.js';
import {
  npcKensiRequest,
  npcPublishedInventoryFixture,
} from '../../../tests/fixtures/npc-published-inventory.js';
import {
  buildNpcHumanoidSnapshot,
  previewNpcHumanoid,
} from '../../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import { buildNpcCleanHumanoidSnapshot } from '../../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import {
  npcInventoryMetadataChoices,
  type NpcInventoryRequestEntry,
} from '../../domain/rules/npc-authoring/inventory.js';
import {
  npcFullSheetSections,
  npcPreviewSheetSections,
  npcEditorPresentation,
  projectNpcGm,
  type NpcProjectionRead,
} from './npc.js';
import { createEmptyNpcEditorDraft } from '../../domain/rules/npc-authoring/staged-input.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { NpcSymbiontInput } from '../../domain/rules/npc-authoring/types.js';
import type { NpcOrdinaryCompositionFact } from '../../domain/rules/npc-authoring/ordinary-composition-types.js';
import type { NpcCompositionConsequenceProof } from '../../domain/rules/npc-authoring/composition-consequence-types.js';
import {
  applyNpcOrdinaryCompositionFact,
  createNpcOrdinaryComposition,
  readNpcOrdinaryComposition,
} from '../../domain/rules/npc-authoring/ordinary-composition.js';
import { deriveNpcOrdinaryStatProfile } from '../../domain/rules/npc-authoring/npc-ordinary-humanoid-sheet.js';
import {
  evaluateNpcSkills,
  type NpcSkillProof,
} from '../../domain/rules/npc-authoring/skill-evaluation.js';
import {
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
} from '../../domain/rules/npc-authoring/functional-duplicate-composition.js';
import {
  createNpcFormalLifeState,
  deriveNpcRetainedFormalLifeState,
  type NpcFormalLifeHistoryAnchor,
} from '../../domain/rules/npc-authoring/formal-life-state.js';
import {
  deriveNpcFormalWeaverEffectContribution,
  readNpcFormalWeaverEffectContribution,
} from '../../domain/rules/npc-authoring/formal-weaver-effects.js';

let source: NpcAuthoringSourceCatalog;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../', import.meta.url)),
  );
});

describe('NPC017 source action identity', () => {
  it('keeps the delivered atomic-save action separate from the post-receipt route', () => {
    const forms = JSON.parse(
      readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8'),
    ) as Record<string, { actions: { ctaAvailabilityByAction: Record<string, unknown>[] } }>;
    const actions = forms['NPC-017']!.actions.ctaAvailabilityByAction;
    const save = actions.find((a) => a['actionKey'] === 'NPC-017::CTA::002');
    expect(save).toMatchObject({
      kind: 'workflow-command',
      label: 'Сохранить NPC атомарно',
      targetFormId: 'NPC-003',
    });
    expect(save?.['guard']).toContain('CREATE_V1 выполняет UI-CMD-NPC-COMMIT-V1');
    expect(save?.['guard']).toContain(
      'APPEND_N_PLUS_ONE выполняет UI-CMD-NPC-NEW-VERSION phase=COMMIT',
    );
    expect(actions.find((a) => a['actionKey'] === 'NPC-017::CTA::004')).toMatchObject({
      kind: 'normative',
      label: 'Открыть сохранённый лист после receipt',
      targetFormId: 'NPC-003',
      guard: 'commitStatus=COMMITTED',
    });
  });

  it.each(['CREATE_V1', 'APPEND_N_PLUS_ONE'] as const)(
    'projects only source CTA002 for a checked OPEN %s preview',
    (mode) => {
      // Pure projection boundary fixture, not a persistence/authority or full-NPC creation proof.
      const draft = createEmptyNpcEditorDraft();
      const scope = { ownerDeviceId: id(20), gmLocalContextId: id(2), campaignId: id(21) };
      const attempt = {
        scope,
        npcDraftId: id(22),
        candidateNpcUuid: id(1),
        revision: 7,
        mode,
        targetOrNull: mode === 'CREATE_V1' ? null : { npcUuid: id(1), expectedCurrentVersion: 2 },
        stage: 'NPC-017' as const,
        status: 'OPEN' as const,
        values: JSON.parse(JSON.stringify(draft)) as JsonObject,
      };
      const read: NpcProjectionRead = {
        view: {
          ...scope,
          schemaVersion: 1,
          formId: 'NPC-017',
          stateRevision: 10,
          projectionRevision: 11,
          actorVisibilityRevision: 0,
          requestQueueRevision: 0,
          values: { selectedRequestIdOrNull: null, decisionReason: '' },
          returnContext: {
            originFormId: 'CMP-006',
            campaignId: scope.campaignId,
            creationReceiptId: id(23),
          },
          snapshotSha256: 'a'.repeat(64),
          npc: {
            selectedNpcOrNull: null,
            attemptOrNull: {
              npcDraftId: attempt.npcDraftId,
              candidateNpcUuid: attempt.candidateNpcUuid,
              revision: attempt.revision,
              mode,
              targetOrNull: attempt.targetOrNull,
              stage: attempt.stage,
            },
            initialTimeReturnContextOrNull: null,
          },
        },
        closure: {
          campaignId: scope.campaignId,
          calendarContext: null,
          attempts: [],
          reservations: [],
          children: [],
          versions: [],
          blocks: [],
          art: [],
          operations: [],
          anchorOrNull: null,
        },
        campaignStatus: 'PAUSED',
        campaignPhase: 'PRE_START',
        attemptOrNull: attempt,
        draftOrNull: draft,
        attemptArtOrNull: null,
        versions: [],
        calendar: {
          requiresCampaignTime: false,
          validationStatus: 'NOT_REQUIRED',
          bindingOrNull: null,
          initialTimeLockOrNull: null,
          messages: [],
        },
      };
      const editor = npcEditorPresentation({
        read,
        catalog: source,
        canReserveItem: false,
        inventoryOrNull: null,
        preview: {
          kind: 'VALID',
          name: 'Проверка кнопки',
          sections: npcPreviewSheetSections(fixture().preview.sheet, source),
          art: { assetKey: 'npc-upload:' + 'a'.repeat(64), checksum: 'a'.repeat(64) },
        },
      });
      const project = (supported: readonly string[], editorOrNull = editor) =>
        projectNpcGm({
          read,
          catalog: source,
          editorOrNull,
          supported,
        }).base.availableActionKeys;
      expect(project(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])).toEqual([
        'NPC-017::CTA::002',
        'NPC-017::CTA::003',
      ]);
      expect(
        project([mode === 'CREATE_V1' ? 'UI-CMD-NPC-NEW-VERSION' : 'UI-CMD-NPC-COMMIT-V1']),
      ).toEqual(['NPC-017::CTA::003']);
      const incomplete = npcEditorPresentation({
        read,
        catalog: source,
        canReserveItem: false,
        inventoryOrNull: null,
        preview: { kind: 'INCOMPLETE', detail: 'Не заполнено' },
      });
      expect(project(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'], incomplete)).toEqual([
        'NPC-017::CTA::003',
      ]);
    },
  );
});
function fixture(
  request: NpcInventoryRequestEntry = npcKensiRequest(id(4)),
  weaponProfileVersionId: string | null = id(5),
) {
  const clean = npcPureInitialSkillFixture(
    source,
    {
      npcUuid: id(1),
      owningControllerId: id(2),
      contextFactId: 'actual-npc014-confirm',
      compositionJournalId: id(6),
      commitOperationId: id(3),
    },
    {
      pureClassOrNull: 'SOLDIER',
      baseStats: { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W: 4 },
      selections: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
    },
  );
  const input = npcPublishedInventoryFixture(source.inventoryPublication, clean, {
    npcUuid: id(1),
    commitOperationId: id(3),
    sourceOperationId: 'actual-npc015-confirm',
    actorId: id(2),
    committedAt: '2026-11-06T04:00:00.000Z',
    entries: [{ request, weaponProfileVersionId }],
  });
  const preview = previewNpcHumanoid(source.humanoid, {
    npcUuid: input.npcUuid,
    owningControllerId: input.owningControllerId,
    compositionProof: input.compositionProof,
    input: {
      ...input.input,
      skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
      inventory: [request],
    },
  });
  return { input, preview, saved: buildNpcHumanoidSnapshot(source.humanoid, input) };
}

describe('NPC checked inventory presentation', () => {
  it('shows explicit quality and clothing metadata in both actual preview and saved sheet without filling historical absence', () => {
    const legacy = fixture();
    expect(
      npcFullSheetSections(legacy.saved, source).INVENTORY.find((row) => row.label === 'Предметы')
        ?.value,
    ).not.toContain('Качество:');
    const explicitNone = fixture({ ...npcKensiRequest(id(4)), qualityTier: null });
    expect(
      npcFullSheetSections(explicitNone.saved, source).INVENTORY.find(
        (row) => row.label === 'Предметы',
      )?.value,
    ).toContain('Качество: не назначено');
    const value = fixture(
      {
        ...npcKensiRequest(id(4)),
        itemTypeId: 'RES-EQP-001',
        currentAmmo: null,
        qualityTier: 'GOOD',
        clothingProperties: {
          coveredRegionIds: ['TORSO', 'ARM_L'],
          hermetic: 'UNKNOWN',
          flammability: 'NONCOMBUSTIBLE',
        },
      },
      null,
    );
    const before = JSON.stringify(value);
    const staged = npcPreviewSheetSections(value.preview.sheet, source).INVENTORY;
    expect(npcFullSheetSections(value.saved, source).INVENTORY).toEqual(staged);
    const displayed = staged.find((row) => row.label === 'Предметы')?.value ?? '';
    const label = npcInventoryMetadataChoices(source.inventory)?.qualityTiers.find(
      (row) => row.value === 'GOOD',
    )?.label;
    expect(label).toBeTypeOf('string');
    expect(displayed).toContain('Качество: ' + label);
    expect(displayed).toContain('Одежда: покрытие — Корпус, Левая рука');
    expect(displayed).toContain('Герметичность: неизвестна');
    expect(displayed).toContain('Горючесть одежды: негорючая');
    expect(displayed).not.toContain('Герметичность: нет');
    expect(JSON.stringify(value)).toBe(before);
  });
  it('renders actual staged and saved weapon mechanics equally without inventing preview version IDs', () => {
    const { preview, saved } = fixture(),
      before = JSON.stringify({ preview, saved });
    const staged = npcPreviewSheetSections(preview.sheet, source),
      published = npcFullSheetSections(saved, source);
    expect(staged.INVENTORY).toEqual(published.INVENTORY);
    const prepared = preview.sheet.itemProfiles[0]!;
    if (!('stagedProfile' in prepared)) throw Error('Expected weapon fixture');
    const profile = prepared.stagedProfile;
    const display = staged.INVENTORY.find((r) => r.label === 'Профили')!.value;
    expect(display).toContain(profile.name);
    expect(display).toContain('Урон: ' + profile.damageDefinition.sourceNotation);
    expect(display).toContain(profile.damageDefinition.effectiveTemplateExpression);
    expect(display).toContain('Пробитие: ' + profile.penetrationDefinition.sourceNotation);
    for (const [stat, value] of Object.entries(profile.statRequirements))
      expect(display).toContain(`${stat}: ${String(value)}`);
    expect(display).not.toContain(id(5));
    expect(display).not.toContain('undefined');
    expect(staged.INVENTORY.find((r) => r.label === 'Экипировка')!.value).toBe('Нет');
    expect(Object.keys(staged)).toHaveLength(7);
    expect(JSON.stringify({ preview, saved })).toBe(before);
  });
  it('shows explicit GM formulas, requirements, range and accuracy from the checked profile', () => {
    const { preview, saved } = fixture({
      ...npcKensiRequest(id(4)),
      profile: {
        kind: 'MASTER_WEAPON',
        reason: 'Индивидуальный готовый профиль',
        inputs: [
          {
            weaponVariantId: 'DEFAULT',
            damageDefinition: { kind: 'MASTER_DICE', pattern: 'R20*2+X', constantOrNull: 250.5 },
            penetrationDefinition: { kind: 'MASTER_DICE', pattern: 'R4', constantOrNull: null },
            statRequirements: { S: 55, D: 2 },
            instanceDamageOrNull: null,
            rangeMetersOrNull: 1000,
            accuracyBonusOrNull: 7,
          },
        ],
      },
    });
    const result = npcPreviewSheetSections(preview.sheet, source).INVENTORY;
    expect(result).toEqual(npcFullSheetSections(saved, source).INVENTORY);
    const display = result.find((r) => r.label === 'Профили')!.value;
    expect(display).toContain('250.5');
    expect(display).toContain('S: 55');
    expect(display).toContain('D: 2');
    expect(display).toContain('Дальность, м: 1000');
    expect(display).toContain('Бонус точности: 7');
    expect(display).not.toContain('Урон экземпляра: 0');
  });
  it('uses the supplied checked equipped layer rather than recomputing or substituting permanent stats', () => {
    const { preview } = fixture();
    // A formatter seam sentinel, not a claim that this current unequipped domain branch derives 19.
    const sheet = {
      ...preview.sheet,
      stats: {
        ...preview.sheet.stats,
        equippedStats: { ...preview.sheet.stats.equippedStats, S: 19 },
      },
    };
    const result = npcPreviewSheetSections(sheet, source);
    const label = source.symbionts.stats.find((s) => s.statCode === 'S')!.statLabel;
    expect(result.STATS.find((r) => r.label === 'С учётом экипировки')!.value).toContain(
      `${label}: 19`,
    );
    expect(result.STATS.find((r) => r.label === 'Постоянные характеристики')!.value).not.toContain(
      `${label}: 19`,
    );
  });
  it('keeps the exact clean historical format and explicit absent inventory', () => {
    const { input } = fixture(),
      clean = buildNpcCleanHumanoidSnapshot(source.cleanHumanoid, {
        npcUuid: input.npcUuid,
        owningControllerId: input.owningControllerId,
        input: { ...input.input, inventory: [] },
        skillProof: input.skillProof,
        compositionProof: input.compositionProof,
      });
    const bytes = JSON.stringify(clean),
      sections = npcFullSheetSections(clean, source);
    expect(sections.INVENTORY.map((r) => r.value)).toEqual(['Нет', 'Нет', 'Нет']);
    expect(JSON.stringify(clean)).toBe(bytes);
    expect(Object.hasOwn(clean.sheet.stats, 'equippedStats')).toBe(false);
  });
  it('refuses a missing or foreign prepared profile instead of displaying empty or unrelated mechanics', () => {
    const { preview } = fixture(),
      profile = preview.sheet.itemProfiles[0]!;
    if (!('stagedProfile' in profile)) throw Error('Expected weapon fixture');
    expect(() => npcPreviewSheetSections({ ...preview.sheet, itemProfiles: [] }, source)).toThrow(
      'incomplete preview',
    );
    expect(() =>
      npcPreviewSheetSections(
        {
          ...preview.sheet,
          itemProfiles: [{ ...profile, request: { ...profile.request, itemInstanceId: id(99) } }],
        },
        source,
      ),
    ).toThrow('owner mismatch');
  });
  it('refuses a saved reference that does not name its actual active profile', () => {
    const { saved } = fixture(),
      item = saved.sheet.input.inventory[0]!;
    if (item.itemTypeId === null) throw Error('Expected catalogue weapon fixture');
    expect(() =>
      npcFullSheetSections(
        {
          ...saved,
          sheet: {
            ...saved.sheet,
            input: {
              ...saved.sheet.input,
              inventory: [{ ...item, profile: { kind: 'CATALOG', profileVersion: id(99) } }],
            },
          },
        },
        source,
      ),
    ).toThrow('active profile missing');
    const published = saved.sheet.itemProfiles[0]!;
    if (published.kind !== 'WEAPON') throw Error('Expected weapon fixture');
    expect(() =>
      npcFullSheetSections(
        {
          ...saved,
          sheet: {
            ...saved.sheet,
            itemProfiles: [{ ...published, item: { ...published.item, itemInstanceId: id(99) } }],
          },
        },
        source,
      ),
    ).toThrow('owner mismatch');
  });
});

function ordinaryMember(
  speciesKey: string,
  identity: number,
  targetLevel = 1,
  currentOE = 0,
): NpcSymbiontInput {
  const species = source.symbionts.species.find((entry) => entry.speciesKey === speciesKey);
  if (species === undefined) throw new Error(`Unknown source species ${speciesKey}`);
  const kind = species.bindingPolicy;
  return {
    symbiontInstanceId: id(identity),
    speciesKey: species.speciesKey,
    targetLevel,
    currentOE,
    learnedNodeRefs: source.development.nodes
      .filter(
        (node) =>
          node.speciesKey === speciesKey &&
          node.level <= targetLevel &&
          (speciesKey !== 'WEAVER' || node.branchCodeOrNull !== 'EXTERNAL_REGENERATION'),
      )
      .map((node) => node.nodeRef),
    binding: kind === 'OWL_EYE' || kind === 'EEL_ARM' ? { kind, side: 'LEFT' } : { kind },
  };
}
function ordinaryFact(
  additions: readonly NpcSymbiontInput[],
  ordinal = 1,
): NpcOrdinaryCompositionFact {
  return {
    kind: 'APPLY_COMPOSITION_EDIT',
    factId: id(700 + ordinal),
    journalId: id(6),
    ordinal,
    raceCode: 'UNITED',
    additions,
    removals: [],
    buildChanges: [],
    currentOeChanges: [],
  };
}
function ordinaryProof(additions: readonly NpcSymbiontInput[]): NpcCompositionConsequenceProof {
  return {
    identityKey: id(1),
    binding: { journalId: id(6), raceCode: 'UNITED' },
    resolutions: [],
    confirmations: [
      {
        confirmationCommandId: id(702),
        diceModeSnapshot: 'MANUAL',
        input: ordinaryFact(additions),
      },
    ],
  };
}
function ordinaryFixture() {
  const initial = fixture().input;
  const stealth = source.skills.skills.find((skill) => skill.skillKey === 'STEALTH');
  if (stealth === undefined) throw new Error('Source STEALTH skill required');
  const members = [ordinaryMember('CHAMELEON', 710, 3), ordinaryMember('OWL', 711)];
  const compositionProof = ordinaryProof(members);
  const schema = {
    raceCode: 'UNITED',
    pureClassOrNull: null,
    anatomyProfileId: 'STANDARD_HUMANOID',
    sex: 'MALE',
    massKg: 75,
  } as const;
  const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 5, W: 2, C: 20 };
  const statProof = {
    currentStatContextFactId: id(714),
    statContexts: [713, 714].map((n) => ({
      contextFactId: id(n),
      schema,
      baseStats,
      compositionOrdinal: 1,
      resolutionOrdinal: 0,
    })),
  };
  const profile = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
    npcUuid: id(1),
    compositionProof,
    ordinaryProof: statProof,
  });
  const skillProof: NpcSkillProof = {
    identityKey: id(1),
    contexts: [713, 714].map((n, index) => ({
      contextFactId: id(n),
      ordinal: index + 1,
      stage: index === 0 ? 'START_SELECTION' : 'CONFIRMED',
      raceCode: 'UNITED',
      classCode: null,
      skillStageStats: profile.current.stats.skillStageStats,
      permanentStats: profile.current.stats.permanentStats,
      effectiveStats: profile.current.stats.effectiveStats,
      grossGrantSourceOrNull: null,
      sym166SourceOrNull: null,
      facts:
        index === 0
          ? [
              {
                kind: 'PAID_ACQUISITION',
                factId: `NPC_INITIAL_SKILL/${id(3)}/1`,
                ordinal: 1,
                contextFactId: id(713),
                skillKey: stealth.skillKey,
                bonusBefore: 0,
                bonusAfter: 1,
                chargedSlotCost: 1,
                pool: 'START',
              },
            ]
          : [],
    })),
  };
  const skills = evaluateNpcSkills(source.skills, {
    identityKey: id(1),
    mode: 'CREATE_V1',
    previousConfirmedProofOrNull: null,
    proof: skillProof,
  });
  const value = {
    ...initial,
    compositionProof,
    ordinaryProof: statProof,
    skillProof,
    input: {
      ...initial.input,
      identity: { ...initial.input.identity, ...schema },
      baseStats,
      symbionts: members,
      skills: skills.ledger,
      lifetimeFacts: profile.current.composition.lifetimeFacts,
    },
  };
  return {
    saved: buildNpcHumanoidSnapshot(source.humanoid, value),
    preview: previewNpcHumanoid(source.humanoid, {
      npcUuid: value.npcUuid,
      owningControllerId: value.owningControllerId,
      compositionProof,
      ordinaryProof: statProof,
      input: {
        ...value.input,
        skills: [{ skillKey: stealth.skillKey, targetBonus: 1, pool: 'START' }],
        inventory: value.inventoryProof.entries.map((entry) => entry.request),
      },
    }),
  };
}
describe('NPC confirmed composition and durable source presentation', () => {
  it('renders an actual ordinary humanoid preview and committed sheet with confirmed Owl suppression', () => {
    const value = ordinaryFixture(),
      before = JSON.stringify(value);
    expect(value.saved.sheet.interactions).toContainEqual({
      compositionFactId: id(701),
      consequenceIndex: 0,
      consequence: {
        kind: 'ABILITY_SUPPRESSION',
        symbiontInstanceId: id(710),
        ability: 'DOUBLE_FOCUS',
        suppressed: true,
      },
    });
    const saved = npcFullSheetSections(value.saved, source).SYMBIONTS;
    const preview = npcPreviewSheetSections(value.preview.sheet, source).SYMBIONTS;
    expect(saved).toEqual(preview);
    expect(saved[1]!.value).toContain('Подтверждённое взаимодействие ' + id(701) + ' / 0');
    expect(saved[1]!.value).toContain('двойной фокус — подавление применено');
    expect(saved[1]!.value).not.toContain('будет');
    expect(JSON.stringify(value)).toBe(before);
  });
  it('renders every real kernel consequence including exact Trogr recipient and missing historical species', () => {
    const base = fixture(),
      start = () =>
        createNpcOrdinaryComposition(source.ordinaryComposition, {
          journalId: id(6),
          raceCode: 'UNITED',
        });
    const receipts = [
      applyNpcOrdinaryCompositionFact(
        start(),
        ordinaryFact([ordinaryMember('TROGR', 720, 1, 7), ordinaryMember('DOLPHIN', 721, 1, 7)]),
      ).receipt,
      applyNpcOrdinaryCompositionFact(
        start(),
        ordinaryFact([ordinaryMember('TROGR', 722, 1, 7), ordinaryMember('KEEPER', 723, 1, 10)]),
      ).receipt,
      applyNpcOrdinaryCompositionFact(
        start(),
        ordinaryFact([ordinaryMember('TOAD', 724), ordinaryMember('TAIPAN', 725)]),
      ).receipt,
      applyNpcOrdinaryCompositionFact(
        start(),
        ordinaryFact([ordinaryMember('CHAMELEON', 726, 3), ordinaryMember('OWL', 727)]),
      ).receipt,
    ];
    const high = ordinaryMember('OWL', 728, 3);
    const first = applyNpcOrdinaryCompositionFact(start(), ordinaryFact([high]));
    const maximum = readNpcOrdinaryComposition(first.state).instances[0]!.nativeMaxOE;
    const charged = applyNpcOrdinaryCompositionFact(first.state, {
      ...ordinaryFact([], 2),
      currentOeChanges: [{ symbiontInstanceId: high.symbiontInstanceId, currentOE: maximum }],
    });
    const low = ordinaryMember('OWL', 728);
    receipts.push(
      applyNpcOrdinaryCompositionFact(charged.state, {
        ...ordinaryFact([], 3),
        buildChanges: [
          {
            symbiontInstanceId: low.symbiontInstanceId,
            targetLevel: low.targetLevel,
            learnedNodeRefs: low.learnedNodeRefs,
            binding: low.binding,
          },
        ],
      }).receipt,
    );
    const interactions = receipts.flatMap((receipt) =>
      receipt.consequences.map((consequence, consequenceIndex) => ({
        compositionFactId: receipt.factId,
        consequenceIndex,
        consequence,
      })),
    );
    expect(new Set(interactions.map((entry) => entry.consequence.kind))).toEqual(
      new Set([
        'ABSORPTION',
        'DOLPHIN_LEARNED_GRANT',
        'CURRENT_OE_DUEL',
        'SPECIES_SUPPRESSION',
        'ABILITY_SUPPRESSION',
        'NATIVE_OE_CLAMP',
      ]),
    );
    // Boundary-only projection fixture: real kernel receipts, not a claim of one combined valid NPC.
    const preview = { ...base.preview.sheet, interactions },
      saved = { ...base.saved, sheet: { ...base.saved.sheet, interactions } };
    const before = JSON.stringify({ preview, saved });
    const text = npcPreviewSheetSections(preview, source).SYMBIONTS[1]!.value;
    expect(npcFullSheetSections(saved, source).SYMBIONTS[1]!.value).toBe(text);
    expect(text).toContain('Трогр (' + id(720) + '): после поглощения Дельфина уровень 1 → 5');
    const grant = interactions
      .map((entry) => entry.consequence)
      .find((entry) => entry.kind === 'DOLPHIN_LEARNED_GRANT')!;
    for (const ref of grant.addedNodeRefs)
      expect(text).toContain(
        source.development.nodes.find((node) => node.nodeRef === ref)!.label + ' (' + ref + ')',
      );
    expect(text).toContain('ОЭ победителя после сравнения: 3');
    expect(text).toContain(
      'Исторический экземпляр ' + id(725) + ' (вид в текущем листе отсутствует)',
    );
    expect(text).toContain('свойства действуют → свойства подавлены');
    const clamp = interactions
      .map((entry) => entry.consequence)
      .find((entry) => entry.kind === 'NATIVE_OE_CLAMP')!;
    expect(clamp.before).toBeGreaterThan(clamp.after);
    expect(text).toContain(
      'текущий ОЭ ограничен собственным максимумом, ' + clamp.before + ' → ' + clamp.after,
    );
    expect(JSON.stringify({ preview, saved })).toBe(before);
    expect(npcPreviewSheetSections(base.preview.sheet, source).SYMBIONTS[1]!.value).toBe('Нет');
    const unknown = {
      ...preview,
      interactions: [
        {
          compositionFactId: id(799),
          consequenceIndex: 0,
          consequence: { kind: 'FUTURE_CONSEQUENCE' },
        },
      ],
    };
    expect(() => npcPreviewSheetSections(unknown as unknown as typeof preview, source)).toThrow(
      'unknown composition consequence',
    );
    expect(() =>
      npcFullSheetSections(
        {
          ...saved,
          sheet: { ...saved.sheet, interactions: unknown.interactions },
        } as unknown as typeof saved,
        source,
      ),
    ).toThrow('unknown composition consequence');
  });
  it('distinguishes absent Trogr evidence from its explicit reached, included and signed legacy facts', () => {
    const base = fixture();
    const raw = { S: 18, D: -18, M: 18, C: -18, I: 18, Z: -18, W: 18 };
    const signed = { S: 7, D: -4, M: 9, C: -6, I: 3, Z: -2, W: 1 };
    const lifetimeFacts = {
      ...base.preview.sheet.input.lifetimeFacts,
      trogrStrengthAndLegacyOrNull: {
        sourceRuleId: 'SYM-076' as const,
        reachedLevel: 3,
        reachedRawDelta: raw,
        includedLevel: 0,
        includedRawDelta: { S: 0, D: 0, M: 0, C: 0, I: 0, Z: 0, W: 0 },
        legacyOrNull: {
          removalFactId: id(780),
          statContextFactId: id(781),
          nonTrogrBasis: base.preview.sheet.input.baseStats,
          signedSnapshot: signed,
        },
      },
    };
    // Deliberate presentation data: this test verifies exact readback, not ledger derivation.
    const preview = {
      ...base.preview.sheet,
      input: { ...base.preview.sheet.input, lifetimeFacts },
    };
    const saved = {
      ...base.saved,
      sheet: { ...base.saved.sheet, input: { ...base.saved.sheet.input, lifetimeFacts } },
    };
    const text = npcPreviewSheetSections(preview, source).SYMBIONTS[0]!.value;
    expect(npcFullSheetSections(saved, source).SYMBIONTS[0]!.value).toBe(text);
    expect(text).toContain('достигнутый уровень 3');
    expect(text).toContain('включённый уровень 0');
    expect(text).toContain(id(780));
    expect(text).toContain(id(781));
    for (const stat of source.symbionts.stats)
      expect(text).toContain(
        stat.statLabel + ': ' + (signed[stat.statCode] > 0 ? '+' : '') + signed[stat.statCode],
      );
    const absent = {
      ...preview,
      input: {
        ...preview.input,
        lifetimeFacts: { ...lifetimeFacts, trogrStrengthAndLegacyOrNull: null },
      },
    };
    expect(npcPreviewSheetSections(absent, source).SYMBIONTS[0]!.value).toContain(
      'не зафиксированы',
    );
    const { trogrStrengthAndLegacyOrNull: _ledger, ...oldFacts } = lifetimeFacts;
    expect(
      npcPreviewSheetSections(
        { ...preview, input: { ...preview.input, lifetimeFacts: oldFacts } },
        source,
      ).SYMBIONTS[0]!.value,
    ).toContain('отсутствуют в этом снимке');
  });
});

describe('NPC current life and immutable item sources', () => {
  it('shows actual retained life origin, original remainder, current deadline and current restrictions separately', () => {
    const base = fixture();
    const duplicate = (campaignTimestamp: number) =>
      deriveNpcFunctionalDuplicateProof(source.functionalDuplicate, {
        npcUuid: id(1),
        campaignTimestamp,
        compositionProof: base.input.compositionProof,
        temporaryEffects: [],
      });
    const entry = duplicate(2707);
    const history: NpcFormalLifeHistoryAnchor = {
      kind: 'GM_FORMAL_INITIAL_LIFE',
      campaignId: id(800),
      npcUuid: id(1),
      lifeKind: 'SEVERELY_WOUNDED',
      initialStateConfirmationId: id(801),
      reason: 'Фактическое ранение',
      createdAt: '2026-11-06T04:00:00.000Z',
      severeWoundOrNull: {
        effectInstanceId: id(802),
        calendarAnchor: {
          kind: 'PRE_START_INITIAL',
          campaignTimestamp: 2707,
          lobbySnapshotRevision: 'a'.repeat(64),
        },
        rollFact: { factId: id(803), sourceRuleId: 'CORE-153', roll: { dieSides: 6, rawFace: 3 } },
        remainingMinutes: '12.5',
        duplicateAtEntry: readNpcFunctionalDuplicateProof(entry),
      },
    };
    const original = createNpcFormalLifeState(
      source.formalLife,
      history,
      { campaignId: id(800), npcUuid: id(1), currentHP: 0, campaignTimestampOrNull: 2707 },
      entry,
    );
    const state = deriveNpcRetainedFormalLifeState(
      source.formalLife,
      history,
      { campaignId: id(800), npcUuid: id(1), currentHP: 0, campaignTimestampOrNull: 2710 },
      entry,
      duplicate(2710),
    );
    expect(state.lifeKind).toBe('SEVERELY_WOUNDED');
    if (state.lifeKind !== 'SEVERELY_WOUNDED') throw new Error('severe source fixture required');
    expect(state.deathTimerOrNull.remainingExact).toBe('9.5');
    expect(original.deathTimerOrNull!.remainingExact).toBe('12.5');
    const initialState = {
      ...base.input.input.initialState,
      currentHP: 0,
      sourceSpecificStates: [state],
      effectInstances: [state.deathTimerOrNull],
      deathTimerRollFactOrNull: history.severeWoundOrNull!.rollFact,
    };
    // Genuine domain state, projected at the typed boundary; no claim of a new full-NPC commit.
    const preview = { ...base.preview.sheet, input: { ...base.preview.sheet.input, initialState } };
    const saved = {
      ...base.saved,
      sheet: { ...base.saved.sheet, input: { ...base.saved.sheet.input, initialState } },
    };
    const before = JSON.stringify({ state, original, preview, saved });
    const sections = npcPreviewSheetSections(preview, source).INITIAL_STATE;
    expect(npcFullSheetSections(saved, source).INITIAL_STATE).toEqual(sections);
    const text = sections.map((row) => row.value).join('; ');
    for (const value of [
      'исходное подтверждение: ' + id(801),
      'абстрактная жизненно важная система повреждена: Да',
      'исходный остаток: 12.5 мин',
      'текущий остаток: 9.5 мин',
      'срок смерти: минута 2719.5',
      'исходный множитель таймера: ×1',
      'D6: 3',
      'физические действия — по умолчанию нет',
      'без повторного броска и перезапуска',
    ])
      expect(text).toContain(value);
    expect(text).not.toContain('исходный COMMIT');
    expect(JSON.stringify({ state, original, preview, saved })).toBe(before);
  });
  it.each([
    'REPLACEMENT_TEMPORARY',
    'REPLACEMENT_RECOVERY',
    'DUPLICATED_ORGANS_PROTECTION',
  ] as const)(
    'shows the actual %s source, current deadline and exact expiry/protection meaning',
    (branch) => {
      const base = fixture();
      const proof = ordinaryProof([ordinaryMember('WEAVER', 810, 3)]);
      const contribution = deriveNpcFormalWeaverEffectContribution(
        source.formalWeaver!,
        {
          kind: 'GM_FORMAL_INITIAL_WEAVER',
          campaignId: id(811),
          npcUuid: id(1),
          effectInstanceId: id(812),
          sourceInstanceId: id(810),
          sourceOperationId: id(813),
          branch,
          reason: 'Исходное состояние Ткача',
          createdAt: '2026-11-06T04:00:00.000Z',
          calendarAnchor: {
            kind: 'PRE_START_INITIAL',
            campaignTimestamp: 37,
            lobbySnapshotRevision: 'a'.repeat(64),
          },
          remainingMinutes: '2.5',
          revision: 1,
        },
        {
          campaignId: id(811),
          npcUuid: id(1),
          campaignTimestamp: 38,
          origin: { kind: 'COMMITTED', originCommitOperationId: id(814) },
          originalCompositionProof: proof,
          currentCompositionProof: proof,
        },
      );
      const effect = readNpcFormalWeaverEffectContribution(contribution).effect;
      const initialState = { ...base.preview.sheet.input.initialState, effectInstances: [effect] };
      const preview = {
        ...base.preview.sheet,
        input: { ...base.preview.sheet.input, initialState },
      };
      const saved = {
        ...base.saved,
        sheet: { ...base.saved.sheet, input: { ...base.saved.sheet.input, initialState } },
      };
      const before = JSON.stringify({ preview, saved });
      const sections = npcPreviewSheetSections(preview, source).INITIAL_STATE;
      expect(npcFullSheetSections(saved, source).INITIAL_STATE).toEqual(sections);
      const text = sections.map((row) => row.value).join('; ');
      expect(text).toContain('Ткач (' + id(810) + '), уровень 3');
      expect(text).toContain('операция исходного состояния: ' + id(813));
      expect(text).toContain('экземпляр эффекта: ' + id(812));
      expect(text).toContain('завершение: минута 39.5');
      expect(text).toContain('осталось: 1.5 мин');
      expect(text).toContain(
        branch === 'REPLACEMENT_RECOVERY'
          ? 'восстановление по CORE-156 при завершении только при доказанном отсутствии новой потери HP'
          : 'восстановления при завершении нет',
      );
      expect(text).toContain(
        branch === 'DUPLICATED_ORGANS_PROTECTION'
          ? 'защита CORE-182 не израсходована'
          : 'защита CORE-182 отсутствует',
      );
      expect(text).not.toContain(id(814)); // This sheet carries preparation identity, not its external COMMIT context.
      expect(JSON.stringify({ preview, saved })).toBe(before);
    },
  );
  it.each(['CAMPAIGN_CUSTOM_PROFILE', 'CATALOG_CUSTOM_MODIFIER'] as const)(
    'shows the actual reserved and saved %s reference without replacing the canonical base',
    (kind) => {
      const reference = {
        kind,
        profileId: id(820),
        profileVersionId: id(821),
        version: 1,
        reservationOperationId: id(822),
      };
      const profile = {
        kind: 'STRUCTURED_CUSTOM' as const,
        name: 'Именная вещь',
        description: 'Точное описание',
        customBonusOrNull: null,
        massKg: null,
        heldSizeClass: 'UNKNOWN' as const,
        armorWeightClass: 'UNKNOWN' as const,
        flammability: 'UNKNOWN' as const,
        isIgnitionSource: false,
        isFood: false,
        canReceivePoison: false,
        canReceiveFlammableCoating: false,
      };
      const request: NpcInventoryRequestEntry =
        kind === 'CAMPAIGN_CUSTOM_PROFILE'
          ? {
              ...npcKensiRequest(id(823)),
              itemTypeId: null,
              itemTypeReference: { ...reference, kind },
              profile,
              currentAmmo: null,
              bonusContainerBinding: { kind: 'NOT_APPLICABLE' },
              customProfileReason: 'Явная причина',
            }
          : {
              ...npcKensiRequest(id(823)),
              customModifier: {
                reference: { ...reference, kind },
                profile,
                bonusContainerBinding: { kind: 'NOT_APPLICABLE' },
                reason: 'Явная причина',
              },
            };
      const value = fixture(request, kind === 'CAMPAIGN_CUSTOM_PROFILE' ? null : id(824));
      const before = JSON.stringify(value);
      const preview = npcPreviewSheetSections(value.preview.sheet, source)
        .INVENTORY.map((row) => row.value)
        .join('; ');
      const saved = npcFullSheetSections(value.saved, source)
        .INVENTORY.map((row) => row.value)
        .join('; ');
      expect(preview).toContain('Подготовленный профиль: ' + id(820));
      expect(saved).toContain('Сохранённый профиль: ' + id(820));
      for (const text of [preview, saved]) {
        expect(text).toContain('версия 1 (' + id(821) + ')');
        expect(text).toContain('операция резервирования: ' + id(822));
        expect(text).toContain('Причина: Явная причина');
        expect(text).toContain('Бонус отсутствует');
        if (kind === 'CATALOG_CUSTOM_MODIFIER') expect(text).toContain('Изменения мастера:');
      }
      expect(JSON.stringify(value)).toBe(before);
    },
  );
});
