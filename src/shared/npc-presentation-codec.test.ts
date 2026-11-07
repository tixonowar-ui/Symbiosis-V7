import { describe, expect, it } from 'vitest';
import {
  npcGmProjectionValue,
  npcLobbyProjectionFieldsValue,
  npcArtReadMessageValue,
  npcArtReadRequestForProjection,
} from './npc-presentation-codec.js';
import {
  NPC_CONTROL_FORM_IDS,
  NPC_FULL_SHEET_FIELDS,
  NPC_VALIDATION_STAGE_IDS,
} from './npc-presentation.js';
import {
  campaignLobbyGmProjectionValue,
  campaignLobbyGmCurrentProjectionValue,
  campaignLobbyGmActions,
} from './campaign-lobby-presentation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  projectionRole: 'gm' as const,
  contextId: id(1),
  campaignId: id(2),
  stateRevision: 3,
  projectionRevision: 4,
  actorVisibilityRevision: 5,
};
const unset = () => ({ kind: 'UNSET' }),
  entered = (value: unknown) => ({ kind: 'ENTERED', value });
const fields = (keys: string) => Object.fromEntries(keys.split(' ').map((k) => [k, unset()]));
const calendar = () => ({
  requiresCampaignTime: false,
  validationStatus: 'NOT_REQUIRED',
  bindingOrNull: null,
  initialTimeLockOrNull: null,
  messages: [],
});
const sections = () =>
  Object.fromEntries(
    Object.entries(NPC_FULL_SHEET_FIELDS).map(([section, keys]) => [
      section,
      keys.map((fieldKey) => ({ fieldKey, label: fieldKey, value: 'shape fixture' })),
    ]),
  );
const preview = () => ({
  name: 'Recorded NPC',
  artOrNull: null,
  sections: sections(),
  pinnedCombatReferences: [],
});
const sheet = () => ({
  ...preview(),
  npcUuid: id(7),
  displayedVersion: 1,
  currentVersion: 1,
  historyRevision: 1,
  returnContext: 'NPC_ADMIN',
  sourceCombatIdOrNull: null,
  dispositionReceiptIdOrNull: null,
  pinnedCombatVersionOrNull: null,
});
function payload(formId: (typeof NPC_CONTROL_FORM_IDS)[number]): Record<string, unknown> {
  const attempt = (NPC_VALIDATION_STAGE_IDS as readonly string[]).includes(formId)
    ? {
        npcDraftId: id(6),
        candidateNpcUuid: id(7),
        attemptRevision: 2,
        draftRevision: 2,
        stage: formId,
        editMode: 'CREATE_V1',
        versionBindingOrNull: null,
      }
    : null;
  const contents: Record<string, unknown> = {
    'NPC-001': { rows: [], selectedNpcUuidOrNull: null },
    'NPC-002': {
      input: fields('name description affiliation campaignRole sex massKg artAssetKeyOrNull'),
      errors: {},
      artOrNull: null,
    },
    'NPC-003': sheet(),
    'NPC-007': {
      npcUuid: id(7),
      currentVersion: 1,
      entries: [
        {
          version: 1,
          authorLabel: 'GM',
          timestampLabel: 'Recorded timestamp',
          changeReasonOrNull: null,
        },
      ],
      selectedVersionOrNull: 1,
      previewOrNull: sheet(),
    },
    'NPC-011': {
      input: fields('raceCode pureClassOrNull anatomyProfileId'),
      errors: {},
      races: [],
      classes: [],
      anatomies: [],
      sexLabel: 'Not entered',
      massLabel: 'Not entered',
      massBoundsOrNull: null,
      registryVersion: 'source',
      validationSummary: [],
    },
    'NPC-012': {
      input: fields('S D M Z I W C'),
      errors: {},
      labels: Object.fromEntries('S D M Z I W C'.split(' ').map((s) => [s, s])),
      perStatMinMax: Object.fromEntries(
        'S D M Z I W C'.split(' ').map((s) => [s, { minimum: 1, maximum: 20 }]),
      ),
      derivedPreview: [],
      noTotalStatCap: true,
    },
    'NPC-013': {
      input: unset(),
      species: [],
      canAdd: false,
      errors: {},
      computedRows: {},
      compositionSummary: ['Preparation unavailable'],
      continuations: [],
    },
    'NPC-014': {
      input: unset(),
      skills: [],
      pools: [],
      errors: [],
      fixedSkills: [],
      poolUsage: [],
      validationSummary: [],
    },
    'NPC-015': {
      input: unset(),
      choices: Object.fromEntries(
        'itemTypes profileKinds equippedSlots bodyZones gripModes linkedSets componentRoles coatings qualityRolls weaponVariants dicePatterns heldSizes armorWeights flammabilities stats'
          .split(' ')
          .map((k) => [k, []]),
      ),
      canAdd: false,
      errors: {},
      previewRows: {},
      validationSummary: [],
    },
    'NPC-016': {
      input: {
        input: fields(
          'currentHP effectInstanceIds traumaInstanceIds woundInstanceIds sourceSpecificStateFactIds deathConsequenceFactIdOrNull',
        ),
        currentOeChanges: [],
      },
      errors: {},
      symbionts: [],
      choices: Object.fromEntries(
        'effectInstanceIds traumaInstanceIds woundInstanceIds sourceSpecificStateFactIds deathConsequenceFactIdOrNull'
          .split(' ')
          .map((k) => [k, []]),
      ),
      derivedRows: [],
      calendar: calendar(),
      traumaPreparationOrNull: null,
      diseasePreparationOrNull: null,
      woundPreparationOrNull: null,
      preparationBlockers: ['No complete evaluator for selected branch'],
      validationSummary: [],
    },
    'NPC-017': {
      binding: {
        editMode: 'CREATE_V1',
        attemptRevision: 2,
        versionBindingOrNull: null,
        resultVersion: 1,
      },
      npcUuidOnCommit: id(7),
      previewOrNull: null,
      stages: Object.fromEntries(
        NPC_VALIDATION_STAGE_IDS.map((s) => [s, { label: s, status: 'INCOMPLETE', messages: [] }]),
      ),
      fullValidationStatus: 'INCOMPLETE',
      validationErrors: ['Incomplete'],
      calendar: calendar(),
      commitStatusLabel: 'Not committed',
      receiptOrNull: null,
    },
  };
  return {
    ...scope,
    formId,
    campaignStatus: 'PAUSED',
    campaignPhase: 'PRE_START',
    libraryRevision: 1,
    attemptOrNull: attempt,
    content: contents[formId],
  };
}
const content = (p: Record<string, unknown>) => p.content as Record<string, unknown>;
const decode = (p: Record<string, unknown>) => npcGmProjectionValue(p.formId as string, p, scope);
describe('closed current NPC GM display contract (shape fixtures, not full-domain validation)', () => {
  it('offers only closed distinct historical restore choices in an N+1 attempt', () => {
    const p = payload('NPC-015');
    expect(decode(p)).toEqual(p);
    const restore = {
      capabilityKey: 'history-current',
      choices: [{ value: id(80), label: 'Прежний предмет' }],
      canSubmit: true,
      errors: [],
      explanation: 'Возвращается сохранённый экземпляр.',
    };
    content(p).restorePreparationOrNull = restore;
    expect(() => decode(p)).toThrow();
    p.attemptOrNull = {
      ...(p.attemptOrNull as object),
      editMode: 'APPEND_N_PLUS_ONE',
      versionBindingOrNull: { npcUuid: id(7), expectedCurrentVersion: 1 },
    };
    expect(decode(p)).toEqual(p);
    for (const invalid of [
      { ...restore, owningProof: {} },
      { ...restore, choices: [...restore.choices, ...restore.choices] },
      { ...restore, choices: [{ value: 'ITM-WPN-001', label: 'Type is not a physical identity' }] },
    ]) {
      content(p).restorePreparationOrNull = invalid;
      expect(() => decode(p)).toThrow();
    }
  });
  it('keeps explicit item metadata visible and distinguishes null quality from absent metadata', () => {
    const p = payload('NPC-015'),
      c = content(p);
    const item = {
      itemInstanceId: id(30),
      input: {
        ...fields(
          'itemTypeId quantity equipped equippedSlots bodyZone gripMode currentAmmo shieldCurrentHP broken sealed linkedSetInstanceId componentRole qualityRoll coatingInstanceIds issueReason',
        ),
        itemTypeId: entered('RES-EQP-001'),
      },
      profile: entered({ kind: 'CATALOG' }),
      qualityTier: entered(null),
      clothingProperties: entered({
        coveredRegionIds: entered(['TORSO']),
        hermetic: entered('UNKNOWN'),
        flammability: unset(),
      }),
    };
    c.input = entered([item]);
    expect(() => decode(p)).toThrow();
    const choices = c.choices as Record<string, unknown>;
    Object.assign(choices, {
      qualityTiers: [
        { value: null, label: 'No tier' },
        { value: 'GOOD', label: 'Good' },
      ],
      clothingRegions: [{ value: 'TORSO', label: 'Torso' }],
      clothingHermetic: [{ value: 'UNKNOWN', label: 'Unknown' }],
      clothingFlammability: [{ value: 'UNKNOWN', label: 'Unknown' }],
    });
    expect(decode(p)).toEqual(p);
    for (const invalid of [
      { ...item, qualityTier: entered('LEGENDARY') },
      {
        ...item,
        clothingProperties: entered({
          coveredRegionIds: entered(['TORSO', 'TORSO']),
          hermetic: unset(),
          flammability: unset(),
        }),
      },
      {
        ...item,
        clothingProperties: entered({
          coveredRegionIds: unset(),
          hermetic: entered(null),
          flammability: unset(),
        }),
      },
      { ...item, input: { ...item.input, itemTypeId: entered('ITM-WPN-001') } },
    ]) {
      c.input = entered([invalid]);
      expect(() => decode(p)).toThrow();
    }
    c.input = entered([item]);
    Reflect.deleteProperty(choices, 'clothingHermetic');
    expect(() => decode(p)).toThrow();
  });
  it('separates a campaign custom profile from a catalogue item and rejects mixed identities', () => {
    const p = payload('NPC-015');
    const custom = {
      itemInstanceId: id(30),
      input: {
        ...fields(
          'itemTypeId quantity equipped equippedSlots bodyZone gripMode currentAmmo shieldCurrentHP broken sealed linkedSetInstanceId componentRole qualityRoll coatingInstanceIds issueReason',
        ),
        itemTypeId: entered(null),
      },
      itemTypeReference: entered({
        kind: 'CAMPAIGN_CUSTOM_PROFILE',
        profileId: id(31),
        profileVersionId: id(32),
        version: 1,
        reservationOperationId: id(33),
      }),
      profile: entered({
        kind: 'STRUCTURED_CUSTOM',
        input: fields(
          'name description massKg heldSizeClass armorWeightClass flammability isIgnitionSource isFood canReceivePoison canReceiveFlammableCoating',
        ),
        customBonusOrNull: unset(),
      }),
      bonusContainerBinding: entered({ kind: 'BACKPACK', backpackItemInstanceId: id(34) }),
      customProfileReason: unset(),
    };
    content(p).input = entered([custom]);
    expect(decode(p)).toEqual(p);
    for (const invalid of [
      { ...custom, input: { ...custom.input, itemTypeId: entered('ITM-WPN-001') } },
      { ...custom, profile: entered({ kind: 'CATALOG' }) },
      { ...custom, customModifier: {} },
      {
        ...custom,
        bonusContainerBinding: entered({ kind: 'BACKPACK', backpackItemInstanceId: 'RES-CON-001' }),
      },
      {
        ...custom,
        bonusContainerBinding: entered({
          kind: 'OUTSIDE_BACKPACK',
          backpackItemInstanceId: id(34),
        }),
      },
      {
        ...custom,
        itemTypeReference: entered({ kind: 'CATALOG_ITEM', itemTypeId: 'ITM-WPN-001' }),
      },
      {
        ...custom,
        itemTypeReference: entered({
          kind: 'CAMPAIGN_CUSTOM_PROFILE',
          profileId: id(31),
          profileVersionId: id(32),
          version: 0,
          reservationOperationId: id(33),
        }),
      },
      { ...custom, gmPrivateProof: 'not a display field' },
    ]) {
      content(p).input = entered([invalid]);
      expect(() => decode(p)).toThrow();
    }
    const missingReason = { ...custom };
    Reflect.deleteProperty(missingReason, 'customProfileReason');
    content(p).input = entered([missingReason]);
    expect(() => decode(p)).toThrow();
  });
  it('keeps a canonical base profile beside its own closed custom modifier and preparation choices', () => {
    const p = payload('NPC-015');
    const modifier = {
      reference: entered({
        kind: 'CATALOG_CUSTOM_MODIFIER',
        profileId: id(31),
        profileVersionId: id(32),
        version: 2,
        reservationOperationId: id(33),
      }),
      profile: entered({
        kind: 'STRUCTURED_CUSTOM',
        input: fields(
          'name description massKg heldSizeClass armorWeightClass flammability isIgnitionSource isFood canReceivePoison canReceiveFlammableCoating',
        ),
        customBonusOrNull: entered(null),
      }),
      bonusContainerBinding: entered({ kind: 'NOT_APPLICABLE' }),
      reason: entered('Explicit modifier'),
    };
    content(p).input = entered([
      {
        itemInstanceId: id(30),
        input: fields(
          'itemTypeId quantity equipped equippedSlots bodyZone gripMode currentAmmo shieldCurrentHP broken sealed linkedSetInstanceId componentRole qualityRoll coatingInstanceIds issueReason',
        ),
        profile: entered({ kind: 'CATALOG' }),
        customModifier: modifier,
      },
    ]);
    const preparation = {
      capabilityKey: 'actual-reservation',
      canAdd: true,
      modifierTargets: [{ itemInstanceId: id(40), label: 'Catalogue item' }],
      versionTargets: [
        { itemInstanceId: id(30), profileId: id(31), profileVersionId: id(32), label: 'Version 2' },
      ],
      backpackChoices: [{ value: id(34), label: 'Actual backpack' }],
      editableProfileVersionIds: [],
      errors: [],
      explanation: 'Confirmed host scope',
    };
    content(p).customPreparationOrNull = preparation;
    expect(decode(p)).toEqual(p);
    content(p).customPreparationOrNull = { ...preparation, ownerSecret: 'private' };
    expect(() => decode(p)).toThrow();
    content(p).customPreparationOrNull = {
      ...preparation,
      versionTargets: [
        {
          itemInstanceId: id(30),
          profileId: id(31),
          profileVersionId: 'missing',
          label: 'Version',
        },
      ],
    };
    expect(() => decode(p)).toThrow();
  });
  it('keeps initial poison mode capabilities closed and bound to actual current sources and offered profiles', () => {
    const p = payload('NPC-016'),
      c = content(p);
    expect(decode(p).content).not.toHaveProperty('poisonModePreparations');
    const input = c.input as Record<string, unknown>;
    input.currentOeChanges = [{ symbiontInstanceId: id(71), currentOE: entered(0) }];
    c.symbionts = [
      {
        symbiontInstanceId: id(71),
        label: 'Taipan',
        currentOE: entered(0),
        maximumOrNull: null,
        errors: [],
      },
    ];
    const mode = {
      capabilityKey: 'new-mode',
      sourceInstanceId: id(71),
      sourceLabel: 'Taipan',
      profileChoices: [{ value: 'POI-TAIPAN-DEADLY', label: 'Deadly' }],
      input: { poisonProfileId: unset(), reason: unset() },
      canSubmit: true,
      errors: {},
      explanation: 'Explicit selection required',
      derivedRows: [],
    };
    c.poisonModePreparations = [mode];
    c.poisonModeStates = [];
    (input.input as Record<string, unknown>).poisonModeFactIds = entered([]);
    expect(decode(p)).toEqual(p);
    for (const patch of [
      { sourceInstanceId: id(72) },
      { profileChoices: [...mode.profileChoices, ...mode.profileChoices] },
      { input: { ...mode.input, poisonProfileId: entered('POI-TAIPAN-PARALYTIC') } },
      { originalR20: 20 },
    ]) {
      c.poisonModePreparations = [{ ...mode, ...patch }];
      expect(() => decode(p)).toThrow();
    }
    c.poisonModePreparations = [mode, mode];
    expect(() => decode(p)).toThrow();
  });
  it('binds readonly poison mode references to exactly the displayed facts and preserves legacy absence', () => {
    const p = payload('NPC-016'),
      c = content(p),
      input = (c.input as Record<string, unknown>).input as Record<string, unknown>;
    expect(decode(p)).toEqual(p);
    const state = {
      sourceInstanceId: id(71),
      modeFactId: id(72),
      sourceLabel: 'Taipan',
      poisonProfileId: 'POI-TAIPAN-DEADLY',
      explanation: 'Saved explicit mode',
      derivedRows: [],
    };
    input.poisonModeFactIds = entered([id(72)]);
    expect(() => decode(p)).toThrow();
    c.poisonModeStates = [state];
    expect(decode(p)).toEqual(p);
    for (const selected of [unset(), entered([]), entered([id(73)]), entered([id(72), id(72)])]) {
      input.poisonModeFactIds = selected;
      expect(() => decode(p)).toThrow();
    }
    Reflect.deleteProperty(input, 'poisonModeFactIds');
    expect(() => decode(p)).toThrow();
    input.poisonModeFactIds = entered([id(72)]);
    c.poisonModeStates = [{ ...state, sourcePrivateHistory: [] }];
    expect(() => decode(p)).toThrow();
  });
  it('does not offer a poison carrier that is absent from the current inventory', () => {
    const p = payload('NPC-015'),
      c = content(p);
    c.poisonCoatingPreparations = [
      {
        capabilityKey: 'carrier',
        sourceInstanceId: id(71),
        sourceLabel: 'Taipan',
        targetItemInstanceId: id(72),
        targetLabel: 'Actual carrier',
        surfaceLabel: 'Edge',
        replacesCoatingIdOrNull: null,
        input: { surfaceConfirmed: unset(), replaceConfirmed: unset(), reason: unset() },
        canSubmit: true,
        errors: {},
        explanation: 'Explicit surface required',
        derivedRows: [],
      },
    ];
    expect(() => decode(p)).toThrow();
    c.poisonCoatingPreparations = [];
    c.poisonCoatings = [
      {
        capabilityKey: 'dose',
        coatingInstanceId: id(73),
        targetItemInstanceId: id(72),
        targetLabel: 'Readback carrier',
        canRemove: false,
        errors: [],
        explanation: 'Immutable original and current source',
        derivedRows: [],
      },
    ];
    expect(decode(p)).toEqual(p);
    c.poisonCoatings = [...(c.poisonCoatings as unknown[]), ...(c.poisonCoatings as unknown[])];
    expect(() => decode(p)).toThrow();
  });
  it('keeps legacy effect capability absence exact and new optional capabilities closed', () => {
    const p = payload('NPC-016');
    expect(decode(p)).toEqual(p);
    expect(decode(p).content).not.toHaveProperty('hpModePreparations');
    content(p).alcoholPreparationOrNull = {
      capabilityKey: 'actual-alcohol',
      input: { reason: unset() },
      errors: {},
      canSubmit: true,
      explanation: 'Current GM assignment',
      derivedRows: [],
    };
    content(p).hpModePreparations = [
      {
        capabilityKey: 'actual-weaver',
        mode: 'REGENERATION',
        sourceLabel: 'Ткач',
        input: { remainingMinutes: unset(), reason: unset() },
        maximumRemainingMinutes: '5',
        errors: {},
        canSubmit: true,
        explanation: 'Current initial state',
        derivedRows: [],
      },
    ];
    expect(decode(p)).toEqual(p);
    const missing = structuredClone(p);
    delete content(missing).calendar;
    expect(() => decode(missing)).toThrow();
    const unknown = structuredClone(p);
    (content(unknown).alcoholPreparationOrNull as Record<string, unknown>).immunityOverride = true;
    expect(() => decode(unknown)).toThrow();
    const duplicate = structuredClone(p);
    const modes = content(duplicate).hpModePreparations as unknown[];
    modes.push(structuredClone(modes[0]));
    expect(() => decode(duplicate)).toThrow();
  });
  it.each(NPC_CONTROL_FORM_IDS)('accepts and detaches the closed %s branch', (form) => {
    const p = payload(form),
      parsed = decode(p);
    expect(parsed).toEqual(p);
    expect(parsed).not.toBe(p);
    expect(Object.isFrozen(parsed.content)).toBe(true);
  });
  it('preserves absent formal controls and closes offered control kinds and capabilities', () => {
    const p = payload('NPC-016');
    expect(decode(p).content).not.toHaveProperty('formalControlPreparations');
    const control = {
      capabilityKey: 'actual-sleep',
      controlKind: 'SLEEP',
      sourceLabel: 'Снотворное',
      input: { remainingMinutes: unset(), reason: unset() },
      maximumRemainingMinutes: '60',
      errors: {},
      canSubmit: true,
      explanation: 'Current state',
      derivedRows: [],
    };
    content(p).formalControlPreparations = [control];
    expect(decode(p)).toEqual(p);
    for (const patch of [{ controlKind: 'STUN' }, { immunityOverride: true }, { actorId: id(9) }]) {
      const changed = structuredClone(p);
      content(changed).formalControlPreparations = [{ ...control, ...patch }];
      expect(() => decode(changed)).toThrow();
    }
    content(p).formalControlPreparations = [control, structuredClone(control)];
    expect(() => decode(p)).toThrow();
  });
  it('preserves absent life preparation and validates closed offered states, D6, retention and host anchor', () => {
    const p = payload('NPC-016');
    expect(decode(p).content).not.toHaveProperty('lifeStatePreparationOrNull');
    const life = {
      capabilityKey: 'actual-life',
      canRoll: true,
      canSubmit: true,
      diceMode: 'AUTO',
      lifeChoices: [
        { value: 'ALIVE', label: 'Жив' },
        { value: 'SEVERELY_WOUNDED', label: 'Тяжёлое ранение' },
        { value: 'DEAD', label: 'Окончательная смерть' },
      ],
      input: { lifeKind: unset(), reason: unset(), remainingMinutes: unset() },
      retainedTimer: false,
      rollOrNull: null,
      maximumRemainingMinutesOrNull: null,
      errors: {},
      explanation: 'Current life',
      derivedRows: [],
    };
    content(p).lifeStatePreparationOrNull = life;
    expect(decode(p)).toEqual(p);
    for (const patch of [
      { diceMode: 'ROLL_AGAIN' },
      { retainedTimer: true },
      { rollOrNull: { rawFace: 7, mode: 'AUTO', receiptId: id(8) } },
      { lifeChoices: [life.lifeChoices[0], life.lifeChoices[0]] },
      { duplicateMultiplier: 4 },
      { input: { ...life.input, lifeKind: entered('UNSET') } },
    ]) {
      const changed = structuredClone(p);
      content(changed).lifeStatePreparationOrNull = { ...life, ...patch };
      expect(() => decode(changed)).toThrow();
    }
    const held = {
      ...life,
      canRoll: false,
      retainedTimer: true,
      rollOrNull: { rawFace: 3, mode: 'AUTO', receiptId: id(8) },
      maximumRemainingMinutesOrNull: '15',
    };
    content(p).lifeStatePreparationOrNull = held;
    expect(decode(p)).toEqual(p);
    const input = (content(p).input as Record<string, unknown>).input as Record<string, unknown>;
    expect(input).not.toHaveProperty('lifeStateConfirmationId');
    input.lifeStateConfirmationId = entered(id(9));
    expect(decode(p)).toEqual(p);
    input.lifeStateConfirmationId = entered('invented');
    expect(() => decode(p)).toThrow();
  });
  it('closes Weaver capabilities, actual source and selected readonly references while preserving legacy absence', () => {
    const p = payload('NPC-016'),
      c = content(p);
    expect(decode(p).content).not.toHaveProperty('temporaryWeaverStates');
    const input = (c.input as Record<string, unknown>).input as Record<string, unknown>;
    input.weaverEffectInstanceIds = entered([]);
    c.temporaryWeaverStates = [];
    c.temporaryWeaverStatePreparations = [];
    expect(decode(p)).toEqual(p);
    c.symbionts = [
      {
        symbiontInstanceId: id(50),
        label: 'Ткач',
        currentOE: entered(0),
        maximumOrNull: 100,
        errors: [],
      },
    ];
    (c.input as Record<string, unknown>).currentOeChanges = [
      { symbiontInstanceId: id(50), currentOE: entered(0) },
    ];
    const preparation = {
      capabilityKey: 'actual-weaver',
      sourceInstanceId: id(50),
      sourceLabel: 'Ткач',
      branchChoices: [
        {
          value: 'REPLACEMENT_RECOVERY',
          label: 'Замена с восстановлением',
          maximumRemainingMinutes: '7',
        },
      ],
      input: { branch: unset(), remainingMinutes: unset(), reason: unset() },
      canSubmit: true,
      errors: {},
      explanation: 'Current state',
      derivedRows: [],
    };
    c.temporaryWeaverStatePreparations = [preparation];
    expect(decode(p)).toEqual(p);
    for (const patch of [
      { sourceInstanceId: id(51) },
      { branchChoices: [...preparation.branchChoices, ...preparation.branchChoices] },
      { originalR20: 20 },
      { input: { ...preparation.input, branch: entered('REPLACEMENT_TEMPORARY') } },
    ]) {
      const changed = structuredClone(p);
      content(changed).temporaryWeaverStatePreparations = [{ ...preparation, ...patch }];
      expect(() => decode(changed)).toThrow();
    }
    const state = {
      capabilityKey: 'remove-weaver',
      effectInstanceId: id(51),
      sourceLabel: 'Ткач',
      branch: 'REPLACEMENT_RECOVERY',
      canRemove: true,
      errors: [],
      explanation: 'Original deadline retained',
      derivedRows: [],
    };
    c.temporaryWeaverStates = [state];
    expect(() => decode(p)).toThrow();
    input.weaverEffectInstanceIds = entered([id(51)]);
    expect(decode(p)).toEqual(p);
    const hidden = structuredClone(p);
    delete content(hidden).temporaryWeaverStates;
    expect(() => decode(hidden)).toThrow();
    c.temporaryWeaverStates = [state, state];
    expect(() => decode(p)).toThrow();
    c.temporaryWeaverStates = [{ ...state, actorId: id(90) }];
    expect(() => decode(p)).toThrow();
  });
  it.each(NPC_CONTROL_FORM_IDS)('rejects unknown root and content fields in %s', (form) => {
    const p = payload(form);
    expect(() => decode({ ...p, authority: 'gm' })).toThrow();
    content(p).dirty = false;
    expect(() => decode(p)).toThrow();
  });
  it.each([
    'contextId',
    'campaignId',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
    'projectionRole',
  ])('binds outer %s', (key) => {
    const p = payload('NPC-001');
    p[key] = key.endsWith('Revision') ? 99 : key === 'projectionRole' ? 'player' : id(91);
    expect(() => decode(p)).toThrow();
  });
  it('rejects a mismatched form, phase and attempt without guessing a branch', () => {
    expect(() => npcGmProjectionValue('NPC-005', payload('NPC-001'), scope)).toThrow();
    const p = payload('NPC-002');
    (p.attemptOrNull as Record<string, unknown>).stage = 'NPC-011';
    expect(() => decode(p)).toThrow();
    p.attemptOrNull = null;
    expect(() => decode(p)).toThrow();
    p.formId = 'NPC-001';
    p.content = content(payload('NPC-001'));
    p.campaignStatus = 'HOSTING';
    expect(() => decode(p)).toThrow();
  });
  it('preserves UNSET independently of explicit empty text, null and zero', () => {
    const p = payload('NPC-002'),
      input = content(p).input as Record<string, unknown>;
    input.name = entered('');
    input.description = entered(null);
    input.massKg = entered(0);
    expect(decode(p)).toEqual(p);
    input.sex = entered('UNKNOWN');
    expect(() => decode(p)).toThrow();
  });
  it('accepts real N+1 binding and rejects wrong reservation/target/result revision', () => {
    const p = payload('NPC-017'),
      a = p.attemptOrNull as Record<string, unknown>,
      c = content(p);
    a.editMode = 'APPEND_N_PLUS_ONE';
    a.versionBindingOrNull = { npcUuid: id(7), expectedCurrentVersion: 4 };
    c.binding = {
      editMode: 'APPEND_N_PLUS_ONE',
      attemptRevision: 2,
      versionBindingOrNull: { expectedCurrentVersion: 4, npcUuid: id(7) },
      resultVersion: 5,
    };
    expect(decode(p)).toEqual(p);
    (c.binding as Record<string, unknown>).resultVersion = 4;
    expect(() => decode(p)).toThrow();
    (c.binding as Record<string, unknown>).resultVersion = 5;
    c.npcUuidOnCommit = id(8);
    expect(() => decode(p)).toThrow();
  });
  it('requires all seven full-sheet sections and their exact named fields', () => {
    for (const section of Object.keys(NPC_FULL_SHEET_FIELDS)) {
      const p = payload('NPC-003'),
        s = content(p).sections as Record<string, unknown>;
      delete s[section];
      expect(() => decode(p)).toThrow();
      const q = payload('NPC-003'),
        t = content(q).sections as Record<string, unknown>;
      t[section] = [{ fieldKey: 'summary', label: 'OK', value: 'OK' }];
      expect(() => decode(q)).toThrow();
    }
  });
  it('does not accept a partial preview as VALID or fabricate a history receipt', () => {
    const p = payload('NPC-017'),
      c = content(p);
    c.fullValidationStatus = 'VALID';
    expect(() => decode(p)).toThrow();
    c.previewOrNull = preview();
    c.validationErrors = [];
    expect(() => decode(p)).toThrow();
    c.stages = Object.fromEntries(
      NPC_VALIDATION_STAGE_IDS.map((s) => [s, { label: s, status: 'VALID', messages: [] }]),
    );
    expect(decode(p)).toEqual(p);
    c.receiptOrNull = { npcUuid: id(8), version: 1, historyEntryLabel: 'wrong' };
    expect(() => decode(p)).toThrow();
  });
  it.each(['NPC-003', 'NPC-007', 'NPC-017'] as const)(
    'requires the distinct equipped-stat display layer in %s',
    (form) => {
      const p = payload(form),
        c = content(p);
      const full =
        form === 'NPC-003'
          ? c
          : form === 'NPC-007'
            ? (c.previewOrNull as Record<string, unknown>)
            : ((c.previewOrNull = preview()) as Record<string, unknown>);
      const all = full.sections as Record<
        string,
        { fieldKey: string; label: string; value: string }[]
      >;
      all.STATS = [
        'baseStats',
        'skillStageStats',
        'permanentStats',
        'equippedStats',
        'effectiveStats',
      ].map((fieldKey, i) => ({ fieldKey, label: fieldKey, value: String(i + 1) }));
      expect(decode(p)).toEqual(p);
      all.STATS = all.STATS.filter((row) => row.fieldKey !== 'equippedStats');
      expect(() => decode(p)).toThrow();
    },
  );
  it('rejects a history current version beyond the library even without a selected preview', () => {
    const p = payload('NPC-007'),
      c = content(p);
    c.currentVersion = 2;
    c.entries = [1, 2].map((version) => ({
      version,
      authorLabel: 'GM',
      timestampLabel: 'Saved',
      changeReasonOrNull: null,
    }));
    c.selectedVersionOrNull = null;
    c.previewOrNull = null;
    expect(() => decode(p)).toThrow();
    p.libraryRevision = 2;
    expect(decode(p)).toEqual(p);
  });
  it('bounds selected history revision by the library without equating global and NPC revisions', () => {
    const p = payload('NPC-007'),
      c = content(p),
      selected = c.previewOrNull as Record<string, unknown>;
    selected.historyRevision = 2;
    expect(() => decode(p)).toThrow();
    p.libraryRevision = 3;
    expect(decode(p)).toEqual(p);
  });
  it.each(['NPC-016', 'NPC-017'] as const)(
    'binds CURRENT time to the actual phase and state revision in %s',
    (form) => {
      const p = payload(form),
        c = content(p);
      const value = {
        ...calendar(),
        requiresCampaignTime: true,
        validationStatus: 'CURRENT',
        bindingOrNull: {
          kind: 'PRE_START_INITIAL',
          campaignTimestamp: 17,
          lobbySnapshotRevision: 'a'.repeat(64),
        } as Record<string, unknown>,
      };
      c.calendar = value;
      expect(decode(p)).toEqual(p);
      p.campaignPhase = 'STARTED';
      expect(() => decode(p)).toThrow();
      value.bindingOrNull = {
        kind: 'CURRENT_CAMPAIGN',
        campaignTimestamp: 17,
        stateRevision: scope.stateRevision,
      };
      expect(decode(p)).toEqual(p);
      value.bindingOrNull.stateRevision = scope.stateRevision + 1;
      expect(() => decode(p)).toThrow();
      value.bindingOrNull.stateRevision = scope.stateRevision;
      p.campaignPhase = 'PRE_START';
      expect(() => decode(p)).toThrow();
    },
  );
  it.each(['NPC-016', 'NPC-017'] as const)(
    'retains STALE historical time anchors across phase and revision changes in %s',
    (form) => {
      const p = payload(form),
        c = content(p);
      const value = {
        ...calendar(),
        requiresCampaignTime: true,
        validationStatus: 'STALE',
        bindingOrNull: {
          kind: 'PRE_START_INITIAL',
          campaignTimestamp: 17,
          lobbySnapshotRevision: 'a'.repeat(64),
        } as Record<string, unknown>,
      };
      c.calendar = value;
      p.campaignPhase = 'STARTED';
      expect(decode(p)).toEqual(p);
      value.bindingOrNull = {
        kind: 'CURRENT_CAMPAIGN',
        campaignTimestamp: 17,
        stateRevision: scope.stateRevision - 1,
      };
      expect(decode(p)).toEqual(p);
      p.campaignPhase = 'PRE_START';
      expect(decode(p)).toEqual(p);
    },
  );
  it('binds selected history to exact NPC and displayed version, retaining absent reason', () => {
    const p = payload('NPC-007'),
      c = content(p);
    expect(decode(p)).toEqual(p);
    c.selectedVersionOrNull = null;
    expect(() => decode(p)).toThrow();
    c.previewOrNull = null;
    expect(decode(p)).toEqual(p);
    c.entries = [];
    expect(() => decode(p)).toThrow();
  });
  it('requires explicit null pre-Start placement and rejects an unsaved selected entity', () => {
    const p = payload('NPC-001'),
      c = content(p);
    c.selectedNpcUuidOrNull = id(7);
    expect(() => decode(p)).toThrow();
    const r = {
      npcUuid: id(7),
      name: 'N',
      currentVersion: 1,
      statusLabel: 'Saved',
      affiliation: '',
      campaignRole: '',
      artOrNull: null,
      ...Object.fromEntries(
        'groupIdOrNull locationIdOrNull subLocationIdOrNull markerRevisionOrNull sceneIdOrNull groupLabelOrNull locationLabelOrNull subLocationLabelOrNull sceneLabelOrNull'
          .split(' ')
          .map((k) => [k, null]),
      ),
    };
    c.rows = [r];
    expect(decode(p)).toEqual(p);
    Object.assign(r, { groupIdOrNull: id(12) });
    expect(() => decode(p)).toThrow();
  });
  it('accepts only a private portrait key and checksum, never a URL', () => {
    const p = payload('NPC-002'),
      c = content(p),
      checksum = 'a'.repeat(64),
      assetKey = 'npc-upload:' + checksum;
    const url = `/npc-art/${scope.contextId}/${scope.campaignId}/${encodeURIComponent(assetKey)}/${checksum}`;
    c.artOrNull = { assetKey, checksum };
    expect(decode(p)).toEqual(p);
    for (const badUrl of [
      'https://foreign.test' + url,
      '//foreign.test' + url,
      url + '?token=x',
      url + '#x',
      url.replace(encodeURIComponent(assetKey), assetKey),
      url.replace(scope.contextId, id(88)),
    ]) {
      c.artOrNull = { assetKey, checksum, url: badUrl };
      expect(() => decode(p)).toThrow();
    }
    c.artOrNull = { assetKey: 'npc-upload:' + 'b'.repeat(64), checksum, url };
    expect(() => decode(p)).toThrow();
  });
  it('validates a pre-Start calendar SHA and does not synthesize time', () => {
    const p = payload('NPC-016'),
      c = content(p);
    c.calendar = {
      requiresCampaignTime: true,
      validationStatus: 'CURRENT',
      bindingOrNull: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 17,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      initialTimeLockOrNull: null,
      messages: [],
    };
    expect(decode(p)).toEqual(p);
    (
      (c.calendar as Record<string, unknown>).bindingOrNull as Record<string, unknown>
    ).lobbySnapshotRevision = 3;
    expect(() => decode(p)).toThrow();
    c.calendar = { ...calendar(), requiresCampaignTime: true };
    expect(() => decode(p)).toThrow();
  });
  it('rejects stale/current OE mismatch without independently recalculating it', () => {
    const p = payload('NPC-016'),
      c = content(p),
      i = c.input as Record<string, unknown>;
    i.currentOeChanges = [{ symbiontInstanceId: id(10), currentOE: entered(0) }];
    c.symbionts = [
      {
        symbiontInstanceId: id(10),
        label: 'O',
        currentOE: entered(0),
        maximumOrNull: null,
        errors: [],
      },
    ];
    expect(decode(p)).toEqual(p);
    (c.symbionts as Record<string, unknown>[])[0]!.currentOE = entered(1);
    expect(() => decode(p)).toThrow();
  });
  it('rejects nested accessors, toJSON, extra array fields, holes and prototypes without invoking them', () => {
    let calls = 0;
    for (const mutate of [
      (p: Record<string, unknown>) =>
        Object.defineProperty(p, 'formId', {
          enumerable: true,
          get() {
            calls++;
            return 'NPC-002';
          },
        }),
      (p: Record<string, unknown>) =>
        Object.defineProperty(content(p), 'input', {
          enumerable: true,
          get() {
            calls++;
            return {};
          },
        }),
      (p: Record<string, unknown>) =>
        Object.assign(content(p), {
          toJSON() {
            calls++;
            return {};
          },
        }),
      (p: Record<string, unknown>) =>
        Object.defineProperty(content(p), 'secret', { value: 'hidden', enumerable: false }),
      (p: Record<string, unknown>) => {
        Object.setPrototypeOf(content(p), { hidden: true });
      },
    ]) {
      const p = payload('NPC-002');
      mutate(p);
      expect(() => npcGmProjectionValue('NPC-002', p, scope)).toThrow();
    }
    for (const rows of [Array(1), Object.assign([], { extra: true })]) {
      const p = payload('NPC-001');
      content(p).rows = rows;
      expect(() => decode(p)).toThrow();
    }
    expect(calls).toBe(0);
  });
});

function legacyLobby() {
  return {
    contextId: scope.contextId,
    campaignId: scope.campaignId,
    stateRevision: 3,
    projectionRevision: 4,
    actorVisibilityRevision: 5,
    panelVariant: 'PRE_START',
    campaignStatus: 'PAUSED',
    title: 'Campaign',
    descriptionOrNull: null,
    groups: [],
    activePeaceSceneOrNull: null,
    campaignArtChecksumOrNull: null,
    lobbySummary: { activePcCount: 0, blockedPcCount: 0, readyDeviceCount: 0 },
    activePlayerCapacity: 5,
    admissionBatches: [],
    activeCampaignCharacters: [],
    controllingDevices: [],
    readyByDevice: [],
    requiredFieldBlockers: [],
    lobbySnapshotRevision: 'a'.repeat(64),
    readinessRevision: 0,
    initialTimeInput: { dayNumber: null, hour: null, minute: null },
    initialCampaignTimeOrNull: { dayNumber: 1, hour: 0, minute: 7, campaignTimestamp: 7 },
    startPreflightStatus: 'ZERO_ACTIVE_PLAYERS',
    conflictingOperationPending: false,
    commandId: null,
  };
}
describe('fresh NPC lobby pair versus immutable historical absence', () => {
  it('reads exact old payload without appending fields and rejects it at the fresh boundary', () => {
    const old = legacyLobby(),
      bytes = JSON.stringify(old);
    expect(JSON.stringify(campaignLobbyGmProjectionValue(old))).toBe(bytes);
    expect(JSON.stringify(old)).toBe(bytes);
    expect(() => campaignLobbyGmCurrentProjectionValue(old)).toThrow();
  });
  it('accepts both explicit null fields and rejects either half or unknown keys', () => {
    const p = {
      ...legacyLobby(),
      initialTimeLockOrNull: null,
      npcInitialTimeReturnContextOrNull: null,
    };
    expect(campaignLobbyGmCurrentProjectionValue(p)).toEqual(p);
    for (const key of ['initialTimeLockOrNull', 'npcInitialTimeReturnContextOrNull']) {
      const q: Record<string, unknown> = { ...p };
      delete q[key];
      expect(() => campaignLobbyGmProjectionValue(q)).toThrow();
    }
    expect(() => campaignLobbyGmProjectionValue({ ...p, unknown: null })).toThrow();
  });
  it('binds child scope/mode and retains safe exit while suppressing Start in the action combinator', () => {
    const child = {
      campaignId: scope.campaignId,
      npcDraftId: id(6),
      attemptRevision: 2,
      editMode: 'CREATE_V1',
      versionBindingOrNull: null,
      returnFormId: 'NPC-016',
    };
    const p = campaignLobbyGmCurrentProjectionValue({
      ...legacyLobby(),
      initialTimeLockOrNull: null,
      npcInitialTimeReturnContextOrNull: child,
    });
    const actions = campaignLobbyGmActions(
      'NET-016',
      { ...p, startPreflightStatus: 'READY_TO_START' },
      ['UI-CMD-CAMPAIGN-START', 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET'],
    );
    expect(actions).toContain('NET-016::CTA::001');
    expect(actions).toContain('NET-016::CTA::005');
    expect(actions).not.toContain('NET-016::CTA::002');
    expect(
      campaignLobbyGmActions('NET-016', { ...p, npcInitialTimeReturnContextOrNull: null }, []),
    ).not.toContain('NET-016::CTA::005');
    expect(() =>
      npcLobbyProjectionFieldsValue(
        {
          initialTimeLockOrNull: null,
          npcInitialTimeReturnContextOrNull: { ...child, campaignId: id(91) },
        },
        scope.campaignId,
        true,
      ),
    ).toThrow();
    expect(() =>
      npcLobbyProjectionFieldsValue(
        { initialTimeLockOrNull: null, npcInitialTimeReturnContextOrNull: child },
        scope.campaignId,
        false,
      ),
    ).toThrow();
  });
  it('requires confirmed pre-Start time for a saved immutable lock', () => {
    const p = {
      ...legacyLobby(),
      initialTimeLockOrNull: { campaignTimestamp: 7, sourceNpcUuid: id(7), sourceVersion: 1 },
      npcInitialTimeReturnContextOrNull: null,
    };
    expect(campaignLobbyGmCurrentProjectionValue(p)).toEqual(p);
    p.initialTimeLockOrNull.campaignTimestamp = 8;
    expect(() => campaignLobbyGmCurrentProjectionValue(p)).toThrow();
  });
});

describe('private NPC art read contract', () => {
  const art = { assetKey: 'npc-upload:' + 'a'.repeat(64), checksum: 'a'.repeat(64) };
  function projected(form: 'NPC-001' | 'NPC-002' | 'NPC-003' | 'NPC-007' | 'NPC-017') {
    const p = payload(form),
      c = content(p);
    if (form === 'NPC-001')
      c.rows = [
        {
          npcUuid: id(7),
          name: 'Saved',
          currentVersion: 1,
          statusLabel: 'Saved',
          affiliation: '',
          campaignRole: '',
          groupLabelOrNull: null,
          locationLabelOrNull: null,
          subLocationLabelOrNull: null,
          sceneLabelOrNull: null,
          groupIdOrNull: null,
          locationIdOrNull: null,
          subLocationIdOrNull: null,
          sceneIdOrNull: null,
          markerRevisionOrNull: null,
          artOrNull: art,
        },
      ];
    else if (form === 'NPC-007') (c.previewOrNull as Record<string, unknown>).artOrNull = art;
    else if (form === 'NPC-017') c.previewOrNull = { ...preview(), artOrNull: art };
    else c.artOrNull = art;
    return decode(p);
  }
  function request(form: 'NPC-001' | 'NPC-002' | 'NPC-003' | 'NPC-007' | 'NPC-017' = 'NPC-002') {
    return {
      messageType: 'network.npc-art.read',
      protocolVersion: 3,
      requestId: id(20),
      contextId: scope.contextId,
      campaignId: scope.campaignId,
      sourceFormId: form,
      expectedRevisions: { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 5 },
      target:
        form === 'NPC-002' || form === 'NPC-017'
          ? { kind: 'ATTEMPT', npcDraftId: id(6), expectedAttemptRevision: 2 }
          : { kind: 'VERSION', npcUuid: id(7), version: 1 },
      ...art,
    };
  }
  it.each(['NPC-001', 'NPC-002', 'NPC-003', 'NPC-007', 'NPC-017'] as const)(
    'reads exact current membership for %s',
    (form) => {
      const r = request(form);
      expect(npcArtReadRequestForProjection(r, projected(form))).toEqual(r);
    },
  );
  it.each([
    'contextId',
    'campaignId',
    'sourceFormId',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
    'npcDraftId',
    'expectedAttemptRevision',
    'assetKey',
    'checksum',
  ] as const)('rejects changed %s before delivery', (field) => {
    const r = request(),
      changed: Record<string, unknown> = { ...r };
    if (
      field === 'stateRevision' ||
      field === 'projectionRevision' ||
      field === 'actorVisibilityRevision'
    )
      changed.expectedRevisions = { ...r.expectedRevisions, [field]: 90 };
    else if (field === 'npcDraftId' || field === 'expectedAttemptRevision')
      changed.target = { ...r.target, [field]: field === 'npcDraftId' ? id(99) : 90 };
    else
      changed[field] =
        field === 'checksum'
          ? 'b'.repeat(64)
          : field === 'assetKey'
            ? 'symbiosis_placeholder_free_female'
            : field === 'sourceFormId'
              ? 'NPC-017'
              : id(99);
    expect(() => npcArtReadRequestForProjection(changed, projected('NPC-002'))).toThrow();
  });
  it('does not allow arbitrary saved versions from the library or unselected history', () => {
    for (const form of ['NPC-001', 'NPC-003', 'NPC-007'] as const) {
      const r = request(form),
        p = projected(form);
      expect(() =>
        npcArtReadRequestForProjection(
          { ...r, target: { kind: 'VERSION', npcUuid: id(8), version: 1 } },
          p,
        ),
      ).toThrow();
      expect(() =>
        npcArtReadRequestForProjection(
          { ...r, target: { kind: 'VERSION', npcUuid: id(7), version: 2 } },
          p,
        ),
      ).toThrow();
    }
  });
  it('keeps source illustrations separate from private asset keys', () => {
    const p = payload('NPC-013'),
      c = content(p),
      checksum = 'a'.repeat(64);
    c.species = [
      {
        value: 'TOAD',
        label: 'Toad',
        levels: [],
        nodes: [],
        bindings: [],
        artOrNull: {
          assetKey: 'symbiont-art:TOAD',
          checksum,
          url: '/generated/media/symbionts/TOAD.png?sha256=' + checksum,
        },
        treeArtOrNull: null,
      },
    ];
    expect(decode(p)).toEqual(p);
    const entry = (c.species as Record<string, unknown>[])[0]!;
    entry.artOrNull = {
      assetKey: 'symbiont-art:TOAD',
      checksum,
      url: 'https://foreign.test/a.png',
    };
    expect(() => decode(p)).toThrow();
    expect(() => npcArtReadMessageValue({ ...request(), assetKey: 'symbiont-art:TOAD' })).toThrow();
  });
  it.each(['image/png', 'image/jpeg'] as const)(
    'accepts canonical %s bytes with existing signature interpretation',
    (mediaType) => {
      const bytesBase64 = mediaType === 'image/png' ? 'iVBORw0KGgo=' : '/9j/';
      const value = { ...request(), messageType: 'network.npc-art.result', mediaType, bytesBase64 };
      expect(npcArtReadMessageValue(value)).toEqual(value);
    },
  );
  it.each([
    '',
    'iVBORw0KGgo',
    'iVBORw0KGgo=\n',
    'iVBORw0KGgp=',
    '/9j/',
    'A'.repeat(4 * Math.ceil((12 * 1024 * 1024) / 3) + 4),
  ])('refuses noncanonical/oversized/wrong PNG bytes #%#', (bytesBase64) => {
    expect(() =>
      npcArtReadMessageValue({
        ...request(),
        messageType: 'network.npc-art.result',
        mediaType: 'image/png',
        bytesBase64,
      }),
    ).toThrow();
  });
  it.each(['requestId', 'target', 'expectedRevisions', 'bytesBase64'] as const)(
    'does not evaluate accessor %s',
    (key) => {
      let calls = 0;
      const value = {
        ...request(),
        messageType: 'network.npc-art.result',
        mediaType: 'image/png',
        bytesBase64: 'iVBORw0KGgo=',
      };
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          calls++;
          throw Error('PRIVATE');
        },
      });
      expect(() => npcArtReadMessageValue(value)).toThrow();
      expect(calls).toBe(0);
    },
  );
  it('refuses raw errors, current heads, URL, durable operation and V1/V2 envelopes', () => {
    for (const messageType of ['network.npc-art.read', 'network.npc-art.refusal']) {
      const value = {
        ...request(),
        messageType,
        ...(messageType.endsWith('refusal') ? { code: 'NOT_AVAILABLE' } : {}),
      };
      expect(npcArtReadMessageValue(value)).toEqual(value);
      for (const key of ['url', 'error', 'currentHead', 'operationId', 'receipt', 'gmIdentity'])
        expect(() => npcArtReadMessageValue({ ...value, [key]: 'PRIVATE' })).toThrow();
      for (const protocolVersion of [1, 2])
        expect(() => npcArtReadMessageValue({ ...value, protocolVersion })).toThrow();
    }
  });
});
