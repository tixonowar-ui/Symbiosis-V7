import {
  NPC_CONTROL_FORM_IDS,
  NPC_VALIDATION_STAGE_IDS,
  NPC_SHEET_SECTIONS,
  NPC_FULL_SHEET_FIELDS,
  type NpcGmProjection,
  type NpcProjectionScope,
  type NpcLobbyProjectionFields,
  type NpcArtReadMessage,
  type NpcArtReadBinding,
  type NpcArtReadRequest,
  type NpcArtReadResult,
} from './npc-presentation.js';
import { NPC_TAIPAN_POISON_PROFILE_IDS } from './npc-command.js';

/** Wire shape only. The host must validate catalog membership, authority and full derivation. */
type Check = (value: unknown, path: string) => void;
type Row = Record<string, unknown>;
export class NpcProjectionDecodeError extends Error {
  constructor(readonly path: string) {
    super('Invalid NPC projection');
    this.name = new.target.name;
  }
}
function bad(path: string): never {
  throw new NpcProjectionDecodeError(path);
}
/** No JSON.stringify, getter, toJSON or then assimilation occurs before schema validation. */
function detached(value: unknown, path: string, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : bad(path);
  if (typeof value !== 'object' || ancestors.has(value)) return bad(path);
  const isArray = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype))
    return bad(path);
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (isArray) {
      const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        keys.length !== length + 1
      )
        return bad(path);
      return Object.freeze(
        Array.from({ length }, (_, index) => {
          const d = Object.getOwnPropertyDescriptor(value, String(index));
          if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return bad(path);
          return detached(d.value as unknown, path, ancestors);
        }),
      );
    }
    const result: Row = {};
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype'
      )
        return bad(path);
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return bad(path);
      Object.defineProperty(result, key, {
        enumerable: true,
        value: detached(d.value as unknown, path, ancestors),
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}
function row(v: unknown, p: string): Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : bad(p);
}
const text: Check = (v, p) => {
  if (typeof v !== 'string') bad(p);
};
const ref: Check = (v, p) => {
  text(v, p);
  if (v === '' || (v as string).trim() !== v) bad(p);
};
const bool: Check = (v, p) => {
  if (typeof v !== 'boolean') bad(p);
};
const finite: Check = (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(p);
};
const integer: Check = (v, p) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) bad(p);
};
const revision: Check = (v, p) => {
  integer(v, p);
  if ((v as number) < 0) bad(p);
};
const positive: Check = (v, p) => {
  revision(v, p);
  if (v === 0) bad(p);
};
const uuid: Check = (v, p) => {
  if (
    typeof v !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v)
  )
    bad(p);
};
const sha: Check = (v, p) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/u.test(v)) bad(p);
};
const literal =
  (...values: readonly unknown[]): Check =>
  (v, p) => {
    if (!values.includes(v)) bad(p);
  };
const nullable =
  (read: Check): Check =>
  (v, p) => {
    if (v !== null) read(v, p);
  };
const list =
  (read: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) bad(p);
    (v as unknown[]).forEach((x) => read(x, p + '[]'));
  };
const object =
  (shape: Readonly<Record<string, Check>>, partial = false): Check =>
  (v, p) => {
    const r = row(v, p),
      keys = Object.keys(r);
    if (
      keys.some((k) => !Object.hasOwn(shape, k)) ||
      (!partial && keys.length !== Object.keys(shape).length)
    )
      bad(p);
    for (const [k, read] of Object.entries(shape))
      if (!partial || Object.hasOwn(r, k)) read(r[k], p + '.' + k);
  };
const dictionary =
  (key: Check, read: Check): Check =>
  (v, p) => {
    for (const [k, x] of Object.entries(row(v, p))) {
      key(k, p);
      read(x, p + '[]');
    }
  };
/** Preserve the exact legacy variant while keeping every existing required field mandatory. */
const objectWithOptional =
  (required: Readonly<Record<string, Check>>, optional: Readonly<Record<string, Check>>): Check =>
  (v, p) => {
    const current = row(v, p);
    const present = Object.fromEntries(
      Object.entries(optional).filter(([key]) => Object.hasOwn(current, key)),
    );
    object({ ...required, ...present })(v, p);
  };
const branch =
  (key: string, readers: Readonly<Record<string, Check>>): Check =>
  (v, p) => {
    const k = row(v, p)[key];
    if (typeof k !== 'string' || !Object.hasOwn(readers, k)) bad(p);
    readers[k]?.(v, p);
  };
const entered = (read: Check): Check =>
  branch('kind', {
    UNSET: object({ kind: literal('UNSET') }),
    ENTERED: object({ kind: literal('ENTERED'), value: read }),
  });
const enteredFields = (shape: Readonly<Record<string, Check>>) =>
  object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, entered(v)])));
const strings = list(text),
  refs = list(ref),
  ids = list(uuid);
const stats = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const races = ['FREE', 'PURE', 'UNITED'] as const,
  classes = ['SEEKER', 'SOLDIER', 'STALKER'] as const;
const zones = ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] as const;
const species = [
  'WEAVER',
  'TAIPAN',
  'OWL',
  'TEACHER',
  'ARMADILLO',
  'DRAGON',
  'TROGR',
  'KEEPER',
  'ADVISER',
  'TICK',
  'CRICKET',
  'SPIDER',
  'CHAMELEON',
  'PENGUIN',
  'EEL',
  'TOAD',
  'RAT',
  'DOLPHIN',
  'MANTIS',
  'SKUNK',
  'CHIMERA',
  'PUPPETEER',
  'PLAGUE_DOCTOR',
] as const;
const disease = literal(
  'DIS-FEVER',
  'DIS-FLATULENCE',
  'DIS-ITCHY_SKIN_GROWTHS',
  'DIS-MIGRAINE',
  'DIS-PNEUMONIA',
  'DIS-POISONING',
  'DIS-RHINITIS',
  'DIS-SCABIES',
  'DIS-SKIN_GROWTHS',
);
const weaponVariants = literal('DEFAULT', 'ONE_HAND', 'TWO_HAND', 'SWORD', 'SHIELD', 'RAPIER');
const patterns = literal('R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X');
const choice = (value: Check) => object({ value, label: ref });
const choices = (value: Check) => list(choice(value));
const errors = (keys: readonly string[]) =>
  object(Object.fromEntries(keys.map((k) => [k, strings])), true);
const displayRows = list(object({ label: ref, value: text }));
const range: Check = (v, p) => {
  object({ minimum: finite, maximum: finite })(v, p);
  const x = row(v, p);
  if ((x.minimum as number) > (x.maximum as number)) bad(p);
};
const art = object({ assetKey: ref, checksum: sha });
const sourceIllustration = object({ assetKey: ref, checksum: sha, url: ref });
const target = object({ npcUuid: uuid, expectedCurrentVersion: positive });
const lock = object({ campaignTimestamp: revision, sourceNpcUuid: uuid, sourceVersion: positive });
const timeBinding = branch('kind', {
  PRE_START_INITIAL: object({
    kind: literal('PRE_START_INITIAL'),
    campaignTimestamp: revision,
    lobbySnapshotRevision: sha,
  }),
  CURRENT_CAMPAIGN: object({
    kind: literal('CURRENT_CAMPAIGN'),
    campaignTimestamp: revision,
    stateRevision: revision,
  }),
});
const calendar: Check = (v, p) => {
  object({
    requiresCampaignTime: bool,
    validationStatus: literal('NOT_REQUIRED', 'MISSING', 'CURRENT', 'STALE'),
    bindingOrNull: nullable(timeBinding),
    initialTimeLockOrNull: nullable(lock),
    messages: strings,
  })(v, p);
  const x = row(v, p);
  if (x.requiresCampaignTime === false) {
    if (x.validationStatus !== 'NOT_REQUIRED' || x.bindingOrNull !== null) bad(p);
  } else if (
    x.validationStatus === 'NOT_REQUIRED' ||
    (x.validationStatus === 'MISSING' ? x.bindingOrNull !== null : x.bindingOrNull === null)
  )
    bad(p);
  if (
    x.validationStatus === 'CURRENT' &&
    x.initialTimeLockOrNull !== null &&
    row(x.bindingOrNull, p).kind === 'PRE_START_INITIAL' &&
    row(x.bindingOrNull, p).campaignTimestamp !== row(x.initialTimeLockOrNull, p).campaignTimestamp
  )
    bad(p);
};
const identityInputs = {
  name: text,
  description: nullable(text),
  affiliation: text,
  campaignRole: text,
  sex: literal('MALE', 'FEMALE'),
  massKg: finite,
  artAssetKeyOrNull: nullable(ref),
};
const schemaInputs = {
  raceCode: literal(...races),
  pureClassOrNull: nullable(literal(...classes)),
  anatomyProfileId: literal('STANDARD_HUMANOID'),
};
const traumaRow = object({
  traumaInstanceId: uuid,
  input: enteredFields({
    regionId: literal('HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'),
    traumaValue: finite,
    reason: text,
  }),
  head: entered(
    object({
      penalty: entered(literal('PENDING', 'CONSUMED')),
      stun: entered(
        branch('status', {
          ABSENT: object({ status: literal('ABSENT') }),
          ACTIVE: object({ status: literal('ACTIVE'), remainingMinutes: entered(text) }),
        }),
      ),
    }),
  ),
});
const initialInputFields: Check = (v, p) => {
  const hasTrauma = Object.hasOwn(row(v, p), 'traumaInputs');
  const hasLife = Object.hasOwn(row(v, p), 'lifeStateConfirmationId');
  const hasWeaver = Object.hasOwn(row(v, p), 'weaverEffectInstanceIds');
  const hasPoisonModes = Object.hasOwn(row(v, p), 'poisonModeFactIds');
  enteredFields({
    ...initialInputs,
    ...(hasTrauma ? { traumaInputs: list(traumaRow) } : {}),
    ...(hasLife ? { lifeStateConfirmationId: uuid } : {}),
    ...(hasWeaver ? { weaverEffectInstanceIds: ids } : {}),
    ...(hasPoisonModes ? { poisonModeFactIds: ids } : {}),
  })(v, p);
  const selected = row(row(v, p).traumaInstanceIds, p);
  if (selected.kind === 'ENTERED' && Array.isArray(selected.value) && selected.value.length !== 0) {
    const rows = hasTrauma ? row(row(v, p).traumaInputs, p) : null;
    if (rows === null || rows.kind !== 'ENTERED' || !Array.isArray(rows.value)) return bad(p);
    const entries: unknown[] = rows.value;
    if (selected.value.some((id) => !entries.some((r) => row(r, p).traumaInstanceId === id)))
      bad(p);
  }
};
const initialInputs = {
  currentHP: finite,
  effectInstanceIds: ids,
  traumaInstanceIds: ids,
  woundInstanceIds: ids,
  sourceSpecificStateFactIds: ids,
  deathConsequenceFactIdOrNull: nullable(uuid),
};
const binding = branch('kind', {
  ...Object.fromEntries(
    ['NONE', 'TICK_RIGHT_HAND', 'SPIDER_BOTH_WRISTS', 'MANTIS_BOTH_FOREARMS'].map((k) => [
      k,
      object({ kind: literal(k) }),
    ]),
  ),
  OWL_EYE: object({ kind: literal('OWL_EYE'), side: literal('LEFT', 'RIGHT') }),
  EEL_ARM: object({ kind: literal('EEL_ARM'), side: literal('LEFT', 'RIGHT') }),
});
const symbiontInputs = {
  speciesKey: literal(...species),
  targetLevel: integer,
  learnedNodeRefs: refs,
  binding,
  currentOE: finite,
};
const skillInputs = {
  skillKey: ref,
  targetBonus: integer,
  pool: literal('START', 'TRAINING', 'SYM-166'),
};
const inventoryInputs = {
  itemTypeId: ref,
  quantity: finite,
  equipped: bool,
  equippedSlots: refs,
  bodyZone: nullable(literal(...zones)),
  gripMode: nullable(literal('ONE_HAND', 'TWO_HAND')),
  currentAmmo: nullable(finite),
  shieldCurrentHP: nullable(finite),
  broken: bool,
  sealed: nullable(bool),
  linkedSetInstanceId: nullable(uuid),
  componentRole: nullable(literal('SWORD', 'RAPIER', 'SHIELD')),
  qualityRoll: nullable(finite),
  coatingInstanceIds: ids,
  issueReason: text,
};
const customInputs = {
  name: text,
  description: text,
  massKg: nullable(finite),
  heldSizeClass: literal('FITS_IN_FIST', 'LARGE', 'UNKNOWN'),
  armorWeightClass: literal('LIGHT', 'OTHER', 'UNKNOWN'),
  flammability: literal('COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'),
  isIgnitionSource: bool,
  isFood: bool,
  canReceivePoison: bool,
  canReceiveFlammableCoating: bool,
};
const dice = branch('kind', {
  RETAIN: object({ kind: literal('RETAIN') }),
  MASTER_DICE: object({
    kind: literal('MASTER_DICE'),
    pattern: entered(patterns),
    constantOrNull: entered(nullable(finite)),
  }),
});
const masterWeapon = object({
  input: enteredFields({
    weaponVariantId: weaponVariants,
    instanceDamageOrNull: nullable(finite),
    rangeMetersOrNull: nullable(finite),
    accuracyBonusOrNull: nullable(finite),
  }),
  damageDefinition: entered(dice),
  penetrationDefinition: entered(dice),
  statRequirements: enteredFields(Object.fromEntries(stats.map((s) => [s, nullable(finite)]))),
});
const structuredCustomProfile = object({
  kind: literal('STRUCTURED_CUSTOM'),
  input: enteredFields(customInputs),
  customBonusOrNull: entered(
    nullable(enteredFields({ customBonusStat: literal(...stats), customBonusValue: finite })),
  ),
});
const itemProfile = branch('kind', {
  CATALOG: object({ kind: literal('CATALOG') }),
  MASTER_WEAPON: object({
    kind: literal('MASTER_WEAPON'),
    reason: entered(text),
    inputs: list(masterWeapon),
  }),
  STRUCTURED_CUSTOM: structuredCustomProfile,
});
const customProfileReference = (kind: 'CAMPAIGN_CUSTOM_PROFILE' | 'CATALOG_CUSTOM_MODIFIER') =>
  object({
    kind: literal(kind),
    profileId: uuid,
    profileVersionId: uuid,
    version: positive,
    reservationOperationId: uuid,
  });
const bonusContainerBinding = branch('kind', {
  NOT_APPLICABLE: object({ kind: literal('NOT_APPLICABLE') }),
  OUTSIDE_BACKPACK: object({ kind: literal('OUTSIDE_BACKPACK') }),
  BACKPACK: object({ kind: literal('BACKPACK'), backpackItemInstanceId: uuid }),
});
const qualityTier = nullable(
  literal('MISSING_OR_UNFIT', 'POOR', 'ORDINARY', 'GOOD', 'EXCEPTIONAL', 'RARE'),
);
const clothingInputs = {
  coveredRegionIds: list(literal(...zones)),
  hermetic: literal(true, false, 'UNKNOWN'),
  flammability: literal('COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'),
};
const inventoryRow: Check = (v, p) => {
  if (Object.hasOwn(row(v, p), 'itemTypeReference')) {
    objectWithOptional(
      {
        itemInstanceId: uuid,
        input: enteredFields({ ...inventoryInputs, itemTypeId: literal(null) }),
        itemTypeReference: entered(customProfileReference('CAMPAIGN_CUSTOM_PROFILE')),
        profile: entered(structuredCustomProfile),
        bonusContainerBinding: entered(bonusContainerBinding),
        customProfileReason: entered(text),
      },
      { qualityTier: entered(qualityTier) },
    )(v, p);
    return;
  }
  objectWithOptional(
    {
      itemInstanceId: uuid,
      input: enteredFields(inventoryInputs),
      profile: entered(itemProfile),
    },
    {
      qualityTier: entered(qualityTier),
      clothingProperties: entered(enteredFields(clothingInputs)),
      customModifier: object({
        reference: entered(customProfileReference('CATALOG_CUSTOM_MODIFIER')),
        profile: entered(structuredCustomProfile),
        bonusContainerBinding: entered(bonusContainerBinding),
        reason: entered(text),
      }),
    },
  )(v, p);
};
const pinned = list(object({ label: ref, version: positive }));
const sections: Check = (v, p) => {
  object(
    Object.fromEntries(
      NPC_SHEET_SECTIONS.map((s) => [
        s,
        list(object({ fieldKey: literal(...NPC_FULL_SHEET_FIELDS[s]), label: ref, value: text })),
      ]),
    ),
  )(v, p);
  for (const s of NPC_SHEET_SECTIONS) {
    const rows = row(v, p)[s] as Row[],
      keys = rows.map((r) => r.fieldKey);
    if (keys.length !== NPC_FULL_SHEET_FIELDS[s].length || new Set(keys).size !== keys.length)
      bad(p + '.' + s);
  }
};
const previewFields = {
  name: ref,
  artOrNull: nullable(art),
  sections,
  pinnedCombatReferences: pinned,
};
const sheet: Check = (v, p) => {
  object({
    ...previewFields,
    npcUuid: uuid,
    displayedVersion: positive,
    currentVersion: positive,
    historyRevision: positive,
    returnContext: literal('NPC_ADMIN'),
    sourceCombatIdOrNull: literal(null),
    dispositionReceiptIdOrNull: literal(null),
    pinnedCombatVersionOrNull: literal(null),
  })(v, p);
  const x = row(v, p);
  if (
    (x.displayedVersion as number) > (x.currentVersion as number) ||
    (x.historyRevision as number) < (x.currentVersion as number)
  )
    bad(p);
  // Combat-disposition presentation is not implemented by this administration contract.
  if ((x.pinnedCombatReferences as unknown[]).length !== 0) bad(p + '.pinnedCombatReferences');
};
const libraryRow = object({
  npcUuid: uuid,
  name: ref,
  currentVersion: positive,
  statusLabel: ref,
  affiliation: text,
  campaignRole: text,
  groupLabelOrNull: nullable(text),
  locationLabelOrNull: nullable(text),
  subLocationLabelOrNull: nullable(text),
  sceneLabelOrNull: nullable(text),
  artOrNull: nullable(art),
  groupIdOrNull: nullable(uuid),
  locationIdOrNull: nullable(uuid),
  subLocationIdOrNull: nullable(uuid),
  markerRevisionOrNull: nullable(revision),
  sceneIdOrNull: nullable(uuid),
});
const continuationFields = {
  capabilityKey: ref,
  label: ref,
  explanation: ref,
  diceMode: literal('NO_ROLL', 'AUTO', 'MANUAL'),
  rolls: list(
    object({
      key: ref,
      label: ref,
      dieSides: literal(6, 20),
      input: entered(integer),
      errors: strings,
    }),
  ),
};
const continuation = branch('kind', {
  ...Object.fromEntries(
    [
      'CONFIRM_COMPOSITION',
      'FREE_SLOT_ROLL',
      'ADVISER_IW_ROLLS',
      'ADVISER_SUPPRESSION_ROLL',
      'GROSS_SKILL_GRANT',
      'TROGR_STAT_CLOSURE',
    ].map((kind) => [kind, object({ ...continuationFields, kind: literal(kind) })]),
  ),
  ADVISER_SKILLS: object({
    ...continuationFields,
    kind: literal('ADVISER_SKILLS'),
    skills: object({
      choices: list(object({ value: ref, label: ref, requirementLabel: text, maxBonus: positive })),
      selected: list(object({ skillKey: ref, targetBonus: positive })),
      errors: strings,
    }),
  }),
});
const speciesChoice = object({
  value: literal(...species),
  label: ref,
  levels: choices(positive),
  nodes: list(object({ value: ref, label: ref, requirementLabel: text, manualOnly: bool })),
  bindings: list(object({ key: ref, label: ref, value: binding })),
  artOrNull: nullable(sourceIllustration),
  treeArtOrNull: nullable(sourceIllustration),
});
const inventoryChoices = objectWithOptional(
  {
    itemTypes: choices(ref),
    profileKinds: choices(literal('CATALOG', 'MASTER_WEAPON', 'STRUCTURED_CUSTOM')),
    equippedSlots: choices(ref),
    bodyZones: choices(nullable(literal(...zones))),
    gripModes: choices(nullable(literal('ONE_HAND', 'TWO_HAND'))),
    linkedSets: choices(nullable(uuid)),
    componentRoles: choices(nullable(literal('SWORD', 'RAPIER', 'SHIELD'))),
    coatings: choices(uuid),
    qualityRolls: choices(nullable(finite)),
    weaponVariants: choices(weaponVariants),
    dicePatterns: choices(patterns),
    heldSizes: choices(customInputs.heldSizeClass),
    armorWeights: choices(customInputs.armorWeightClass),
    flammabilities: choices(customInputs.flammability),
    stats: choices(literal(...stats)),
  },
  {
    qualityTiers: choices(qualityTier),
    clothingRegions: choices(literal(...zones)),
    clothingHermetic: choices(clothingInputs.hermetic),
    clothingFlammability: choices(clothingInputs.flammability),
  },
);
const diseasePrep = object({
  capabilityKey: ref,
  input: entered(disease),
  choices: choices(disease),
  errors: strings,
  canSubmit: bool,
  explanation: ref,
});
const woundPrepInputs = {
  woundType: literal('GENERIC', 'BLEEDING'),
  regionId: literal(...zones),
  damagePerTick: finite,
};
const woundPrep = object({
  capabilityKey: ref,
  input: enteredFields(woundPrepInputs),
  typeChoices: choices(woundPrepInputs.woundType),
  regionChoices: choices(woundPrepInputs.regionId),
  errors: errors(Object.keys(woundPrepInputs)),
  canSubmit: bool,
  explanation: ref,
});
const finalBinding = branch('editMode', {
  CREATE_V1: object({
    editMode: literal('CREATE_V1'),
    attemptRevision: revision,
    versionBindingOrNull: literal(null),
    resultVersion: literal(1),
  }),
  APPEND_N_PLUS_ONE: object({
    editMode: literal('APPEND_N_PLUS_ONE'),
    attemptRevision: revision,
    versionBindingOrNull: target,
    resultVersion: positive,
  }),
});
const content: Readonly<Record<(typeof NPC_CONTROL_FORM_IDS)[number], Check>> = {
  'NPC-001': object({ rows: list(libraryRow), selectedNpcUuidOrNull: nullable(uuid) }),
  'NPC-002': object({
    input: enteredFields(identityInputs),
    errors: errors(Object.keys(identityInputs)),
    artOrNull: nullable(art),
  }),
  'NPC-003': sheet,
  'NPC-007': object({
    npcUuid: uuid,
    currentVersion: positive,
    entries: list(
      object({
        version: positive,
        authorLabel: ref,
        timestampLabel: ref,
        changeReasonOrNull: nullable(text),
      }),
    ),
    selectedVersionOrNull: nullable(positive),
    previewOrNull: nullable(sheet),
  }),
  'NPC-011': object({
    input: enteredFields(schemaInputs),
    errors: errors(Object.keys(schemaInputs)),
    races: choices(literal(...races)),
    classes: choices(nullable(literal(...classes))),
    anatomies: choices(ref),
    sexLabel: text,
    massLabel: text,
    massBoundsOrNull: nullable(range),
    registryVersion: ref,
    validationSummary: strings,
  }),
  'NPC-012': object({
    input: enteredFields(Object.fromEntries(stats.map((s) => [s, integer]))),
    errors: errors(stats),
    labels: object(Object.fromEntries(stats.map((s) => [s, ref]))),
    perStatMinMax: object(Object.fromEntries(stats.map((s) => [s, range]))),
    derivedPreview: displayRows,
    noTotalStatCap: literal(true),
  }),
  'NPC-013': object({
    input: entered(
      list(object({ symbiontInstanceId: uuid, input: enteredFields(symbiontInputs) })),
    ),
    species: list(speciesChoice),
    canAdd: bool,
    errors: dictionary(uuid, errors(Object.keys(symbiontInputs))),
    computedRows: dictionary(uuid, displayRows),
    compositionSummary: strings,
    continuations: list(continuation),
  }),
  'NPC-014': object({
    input: entered(list(enteredFields(skillInputs))),
    skills: list(object({ value: ref, label: ref, requirementLabel: text })),
    pools: choices(skillInputs.pool),
    errors: list(errors(Object.keys(skillInputs))),
    fixedSkills: displayRows,
    poolUsage: displayRows,
    validationSummary: strings,
  }),
  'NPC-015': objectWithOptional(
    {
      input: entered(list(inventoryRow)),
      choices: inventoryChoices,
      canAdd: bool,
      errors: dictionary(uuid, dictionary(ref, strings)),
      previewRows: dictionary(uuid, displayRows),
      validationSummary: strings,
    },
    {
      compatibilityPreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          orderedItems: list(object({ itemInstanceId: uuid, label: ref })),
          input: object({ reason: entered(text) }),
          errors: strings,
          canSubmit: bool,
          explanation: ref,
        }),
      ),
      poisonCoatingPreparations: list(
        object({
          capabilityKey: ref,
          sourceInstanceId: uuid,
          sourceLabel: ref,
          targetItemInstanceId: uuid,
          targetLabel: ref,
          surfaceLabel: ref,
          replacesCoatingIdOrNull: nullable(uuid),
          input: enteredFields({ surfaceConfirmed: bool, replaceConfirmed: bool, reason: text }),
          canSubmit: bool,
          errors: object(
            { surfaceConfirmed: strings, replaceConfirmed: strings, reason: strings },
            true,
          ),
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      poisonCoatings: list(
        object({
          capabilityKey: ref,
          coatingInstanceId: uuid,
          targetItemInstanceId: uuid,
          targetLabel: ref,
          canRemove: bool,
          errors: strings,
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      compositePreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          choices: choices(literal('ITM-WPN-026', 'ITM-WPN-027')),
          errors: strings,
          canSubmit: bool,
          explanation: ref,
        }),
      ),
      restorePreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          choices: choices(uuid),
          canSubmit: bool,
          errors: strings,
          explanation: ref,
        }),
      ),
      customPreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          canAdd: bool,
          modifierTargets: list(object({ itemInstanceId: uuid, label: ref })),
          versionTargets: list(
            object({
              itemInstanceId: uuid,
              profileId: uuid,
              profileVersionId: uuid,
              label: ref,
            }),
          ),
          backpackChoices: choices(uuid),
          editableProfileVersionIds: ids,
          errors: strings,
          explanation: ref,
        }),
      ),
    },
  ),
  'NPC-016': objectWithOptional(
    {
      input: object({
        input: initialInputFields,
        currentOeChanges: list(object({ symbiontInstanceId: uuid, currentOE: entered(finite) })),
      }),
      errors: errors([
        ...Object.keys(initialInputs),
        'traumaInputs',
        'lifeStateConfirmationId',
        'weaverEffectInstanceIds',
      ]),
      symbionts: list(
        object({
          symbiontInstanceId: uuid,
          label: ref,
          currentOE: entered(finite),
          maximumOrNull: nullable(finite),
          errors: strings,
        }),
      ),
      choices: object({
        effectInstanceIds: choices(uuid),
        traumaInstanceIds: choices(uuid),
        woundInstanceIds: choices(uuid),
        sourceSpecificStateFactIds: choices(uuid),
        deathConsequenceFactIdOrNull: choices(nullable(uuid)),
      }),
      derivedRows: displayRows,
      calendar,
      diseasePreparationOrNull: nullable(diseasePrep),
      traumaPreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          canSubmit: bool,
          explanation: text,
          regions: choices(literal('HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R')),
          retainedIds: list(uuid),
          errors: dictionary(uuid, dictionary(ref, strings)),
        }),
      ),
      woundPreparationOrNull: nullable(woundPrep),
      preparationBlockers: strings,
      validationSummary: strings,
    },
    {
      alcoholPreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          input: enteredFields({ reason: text }),
          errors: object({ reason: strings }, true),
          canSubmit: bool,
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      hpModePreparations: list(
        object({
          capabilityKey: ref,
          mode: literal('HUNGER', 'REGENERATION'),
          sourceLabel: ref,
          input: enteredFields({ remainingMinutes: text, reason: text }),
          maximumRemainingMinutes: ref,
          errors: object({ remainingMinutes: strings, reason: strings }, true),
          canSubmit: bool,
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      formalControlPreparations: list(
        object({
          capabilityKey: ref,
          controlKind: literal('SLEEP', 'PARALYSIS'),
          sourceLabel: ref,
          input: enteredFields({ remainingMinutes: text, reason: text }),
          maximumRemainingMinutes: ref,
          errors: object({ remainingMinutes: strings, reason: strings }, true),
          canSubmit: bool,
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      temporaryWeaverStatePreparations: list(
        object({
          capabilityKey: ref,
          sourceInstanceId: uuid,
          sourceLabel: ref,
          branchChoices: list(
            object({
              value: literal(
                'REPLACEMENT_TEMPORARY',
                'REPLACEMENT_RECOVERY',
                'DUPLICATED_ORGANS_PROTECTION',
              ),
              label: ref,
              maximumRemainingMinutes: ref,
            }),
          ),
          input: enteredFields({
            branch: literal(
              'REPLACEMENT_TEMPORARY',
              'REPLACEMENT_RECOVERY',
              'DUPLICATED_ORGANS_PROTECTION',
            ),
            remainingMinutes: text,
            reason: text,
          }),
          canSubmit: bool,
          errors: object({ branch: strings, remainingMinutes: strings, reason: strings }, true),
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      poisonModePreparations: list(
        object({
          capabilityKey: ref,
          sourceInstanceId: uuid,
          sourceLabel: ref,
          profileChoices: choices(literal(...NPC_TAIPAN_POISON_PROFILE_IDS)),
          input: enteredFields({
            poisonProfileId: literal(...NPC_TAIPAN_POISON_PROFILE_IDS),
            reason: text,
          }),
          canSubmit: bool,
          errors: object({ poisonProfileId: strings, reason: strings }, true),
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      poisonModeStates: list(
        object({
          sourceInstanceId: uuid,
          modeFactId: uuid,
          sourceLabel: ref,
          poisonProfileId: literal(...NPC_TAIPAN_POISON_PROFILE_IDS),
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      temporaryWeaverStates: list(
        object({
          capabilityKey: ref,
          effectInstanceId: uuid,
          sourceLabel: ref,
          branch: literal(
            'REPLACEMENT_TEMPORARY',
            'REPLACEMENT_RECOVERY',
            'DUPLICATED_ORGANS_PROTECTION',
          ),
          canRemove: bool,
          errors: strings,
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
      lifeStatePreparationOrNull: nullable(
        object({
          capabilityKey: ref,
          canRoll: bool,
          canSubmit: bool,
          diceMode: literal('AUTO', 'MANUAL'),
          lifeChoices: choices(literal('ALIVE', 'SEVERELY_WOUNDED', 'DEAD')),
          input: enteredFields({
            lifeKind: literal('ALIVE', 'SEVERELY_WOUNDED', 'DEAD'),
            reason: text,
            remainingMinutes: text,
          }),
          retainedTimer: bool,
          rollOrNull: nullable(
            object({
              rawFace: (v, p) => {
                if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > 6) bad(p);
              },
              mode: literal('AUTO', 'MANUAL'),
              receiptId: ref,
            }),
          ),
          maximumRemainingMinutesOrNull: nullable(ref),
          errors: object(
            { lifeKind: strings, reason: strings, remainingMinutes: strings, manualFace: strings },
            true,
          ),
          explanation: text,
          derivedRows: displayRows,
        }),
      ),
    },
  ),
  'NPC-017': object({
    binding: finalBinding,
    npcUuidOnCommit: uuid,
    previewOrNull: nullable(object(previewFields)),
    stages: object(
      Object.fromEntries(
        NPC_VALIDATION_STAGE_IDS.map((s) => [
          s,
          object({
            label: ref,
            status: literal('INCOMPLETE', 'INVALID', 'VALID'),
            messages: strings,
          }),
        ]),
      ),
    ),
    fullValidationStatus: literal('INCOMPLETE', 'INVALID', 'VALID'),
    validationErrors: strings,
    calendar,
    commitStatusLabel: ref,
    receiptOrNull: nullable(object({ npcUuid: uuid, version: positive, historyEntryLabel: ref })),
  }),
};
const scopeFields = {
  projectionRole: literal('gm'),
  contextId: uuid,
  campaignId: uuid,
  stateRevision: revision,
  projectionRevision: revision,
  actorVisibilityRevision: revision,
};
const attempt = object({
  npcDraftId: uuid,
  candidateNpcUuid: uuid,
  attemptRevision: revision,
  draftRevision: revision,
  stage: literal(...NPC_VALIDATION_STAGE_IDS),
  editMode: literal('CREATE_V1', 'APPEND_N_PLUS_ONE'),
  versionBindingOrNull: nullable(target),
});
function unique(values: readonly unknown[], p: string) {
  if (new Set(values).size !== values.length) bad(p);
}
function sameTarget(
  a: { readonly npcUuid: string; readonly expectedCurrentVersion: number } | null,
  b: { readonly npcUuid: string; readonly expectedCurrentVersion: number } | null,
) {
  return a === null
    ? b === null
    : b !== null &&
        a.npcUuid === b.npcUuid &&
        a.expectedCurrentVersion === b.expectedCurrentVersion;
}
function portrait(v: unknown): void {
  if (v === null) return;
  const a = row(v, '$.art'),
    key = a.assetKey as string,
    hash = a.checksum as string;
  if (
    !/^symbiosis_placeholder_(?:free|pure|unified)_(?:female|male)$/u.test(key) &&
    key !== 'npc-upload:' + hash
  )
    bad('$.art.assetKey');
}
function sourceArt(v: unknown, key: string, tree: boolean): void {
  if (v === null) return;
  const a = row(v, '$.species.art');
  if (
    a.assetKey !== (tree ? 'symbiont-tree:' : 'symbiont-art:') + key ||
    a.url !==
      `/generated/media/${tree ? 'development-trees' : 'symbionts'}/${key}.png?sha256=${a.checksum as string}`
  )
    bad('$.species.art');
}
function verifyLinks(p: NpcGmProjection): void {
  const a = p.attemptOrNull;
  if (p.campaignPhase === 'PRE_START' && p.campaignStatus !== 'PAUSED') bad('$.campaignStatus');
  if (p.formId === 'NPC-016' || p.formId === 'NPC-017') {
    const calendar = p.content.calendar;
    if (calendar.validationStatus === 'CURRENT') {
      const binding = calendar.bindingOrNull;
      if (
        p.campaignPhase === 'PRE_START'
          ? binding?.kind !== 'PRE_START_INITIAL'
          : binding?.kind !== 'CURRENT_CAMPAIGN' || binding.stateRevision !== p.stateRevision
      )
        bad('$.calendar.bindingOrNull');
    }
  }
  if (
    a !== null &&
    (a.npcDraftId === a.candidateNpcUuid ||
      a.draftRevision !== a.attemptRevision ||
      (a.editMode === 'CREATE_V1'
        ? a.versionBindingOrNull !== null
        : a.versionBindingOrNull?.npcUuid !== a.candidateNpcUuid))
  )
    bad('$.attemptOrNull');
  if (
    (NPC_VALIDATION_STAGE_IDS as readonly string[]).includes(p.formId) &&
    (a === null || a.stage !== p.formId)
  )
    bad('$.attemptOrNull.stage');
  switch (p.formId) {
    case 'NPC-001': {
      const c = p.content;
      unique(
        c.rows.map((x) => x.npcUuid),
        '$.rows',
      );
      if (
        c.selectedNpcUuidOrNull !== null &&
        !c.rows.some((x) => x.npcUuid === c.selectedNpcUuidOrNull)
      )
        bad('$.selectedNpcUuidOrNull');
      for (const r of c.rows) {
        portrait(r.artOrNull);
        if (r.currentVersion > p.libraryRevision) bad('$.rows.currentVersion');
        if (
          p.campaignPhase === 'PRE_START' &&
          [
            r.groupIdOrNull,
            r.locationIdOrNull,
            r.subLocationIdOrNull,
            r.markerRevisionOrNull,
            r.sceneIdOrNull,
            r.groupLabelOrNull,
            r.locationLabelOrNull,
            r.subLocationLabelOrNull,
            r.sceneLabelOrNull,
          ].some((x) => x !== null)
        )
          bad('$.rows.assignment');
      }
      break;
    }
    case 'NPC-002':
      portrait(p.content.artOrNull);
      break;
    case 'NPC-003':
      portrait(p.content.artOrNull);
      if (p.content.historyRevision > p.libraryRevision) bad('$.historyRevision');
      break;
    case 'NPC-007': {
      const c = p.content;
      if (c.currentVersion > p.libraryRevision) bad('$.currentVersion');
      if (c.entries.length !== c.currentVersion || c.entries.some((e, i) => e.version !== i + 1))
        bad('$.entries');
      if (
        c.selectedVersionOrNull === null
          ? c.previewOrNull !== null
          : c.previewOrNull === null ||
            c.previewOrNull.npcUuid !== c.npcUuid ||
            c.previewOrNull.currentVersion !== c.currentVersion ||
            c.previewOrNull.displayedVersion !== c.selectedVersionOrNull
      )
        bad('$.previewOrNull');
      if (c.previewOrNull) {
        portrait(c.previewOrNull.artOrNull);
        if (c.previewOrNull.historyRevision > p.libraryRevision)
          bad('$.previewOrNull.historyRevision');
      }
      break;
    }
    case 'NPC-013': {
      unique(
        p.content.species.map((x) => x.value),
        '$.species',
      );
      for (const s of p.content.species) {
        sourceArt(s.artOrNull, s.value, false);
        sourceArt(s.treeArtOrNull, s.value, true);
      }
      if (p.content.input.kind === 'ENTERED')
        unique(
          p.content.input.value.map((x) => x.symbiontInstanceId),
          '$.input',
        );
      unique(
        p.content.continuations.map((x) => x.capabilityKey),
        '$.continuations',
      );
      for (const c of p.content.continuations) {
        unique(
          c.rolls.map((x) => x.key),
          '$.continuations.rolls',
        );
        if (c.diceMode === 'NO_ROLL' && c.rolls.length !== 0) bad('$.continuations.rolls');
        if (c.kind === 'ADVISER_SKILLS') {
          if (c.diceMode !== 'NO_ROLL') bad('$.continuations.diceMode');
          unique(
            c.skills.choices.map((x) => x.value),
            '$.continuations.skills.choices',
          );
          unique(
            c.skills.selected.map((x) => x.skillKey),
            '$.continuations.skills.selected',
          );
          for (const selected of c.skills.selected)
            if (
              !c.skills.choices.some(
                (choice) =>
                  choice.value === selected.skillKey && selected.targetBonus <= choice.maxBonus,
              )
            )
              bad('$.continuations.skills.selected');
        }

        for (const r of c.rolls)
          if (r.input.kind === 'ENTERED' && (r.input.value < 1 || r.input.value > r.dieSides))
            bad('$.continuations.rolls.input');
      }
      break;
    }
    case 'NPC-015': {
      const coatingPreparations = p.content.poisonCoatingPreparations;
      if (coatingPreparations !== undefined) {
        unique(
          coatingPreparations.map((entry) => entry.capabilityKey),
          '$.poisonCoatingPreparations',
        );
        for (const entry of coatingPreparations)
          if (
            p.content.input.kind !== 'ENTERED' ||
            !p.content.input.value.some(
              (item) => item.itemInstanceId === entry.targetItemInstanceId,
            )
          )
            bad('$.poisonCoatingPreparations.targetItemInstanceId');
      }
      if (p.content.poisonCoatings !== undefined) {
        unique(
          p.content.poisonCoatings.map((entry) => entry.capabilityKey),
          '$.poisonCoatings',
        );
        unique(
          p.content.poisonCoatings.map((entry) => entry.coatingInstanceId),
          '$.poisonCoatings.coatingInstanceId',
        );
      }
      const metadataChoices = p.content.choices;
      const clothingChoices = [
        metadataChoices.clothingRegions,
        metadataChoices.clothingHermetic,
        metadataChoices.clothingFlammability,
      ];
      if (
        clothingChoices.some((value) => value !== undefined) &&
        clothingChoices.some((value) => value === undefined)
      )
        bad('$.choices.clothingProperties');
      for (const selected of p.content.input.kind === 'ENTERED' ? p.content.input.value : []) {
        if (selected.qualityTier !== undefined && metadataChoices.qualityTiers === undefined)
          bad('$.input.qualityTier.choices');
        if (selected.clothingProperties !== undefined) {
          if (
            'itemTypeReference' in selected ||
            selected.input.itemTypeId.kind !== 'ENTERED' ||
            selected.input.itemTypeId.value !== 'RES-EQP-001' ||
            clothingChoices.some((value) => value === undefined)
          )
            bad('$.input.clothingProperties');
          if (
            selected.clothingProperties.kind === 'ENTERED' &&
            selected.clothingProperties.value.coveredRegionIds.kind === 'ENTERED'
          )
            unique(
              selected.clothingProperties.value.coveredRegionIds.value,
              '$.input.clothingProperties.coveredRegionIds',
            );
        }
      }
      if (p.content.input.kind === 'ENTERED')
        unique(
          p.content.input.value.map((x) => x.itemInstanceId),
          '$.input',
        );
      const restore = p.content.restorePreparationOrNull;
      if (restore != null) {
        if (p.attemptOrNull?.editMode !== 'APPEND_N_PLUS_ONE')
          bad('$.restorePreparationOrNull.editMode');
        unique(
          restore.choices.map((entry) => entry.value),
          '$.restorePreparationOrNull.choices',
        );
        const current = p.content.input;
        if (
          current.kind === 'ENTERED' &&
          restore.choices.some((choice) =>
            current.value.some((item) => item.itemInstanceId === choice.value),
          )
        )
          bad('$.restorePreparationOrNull.currentItem');
      }
      break;
    }
    case 'NPC-016': {
      const c = p.content;
      if (c.poisonModePreparations !== undefined) {
        unique(
          c.poisonModePreparations.map((entry) => entry.capabilityKey),
          '$.poisonModePreparations',
        );
        unique(
          c.poisonModePreparations.map((entry) => entry.sourceInstanceId),
          '$.poisonModePreparations.sourceInstanceId',
        );
        for (const entry of c.poisonModePreparations) {
          unique(
            entry.profileChoices.map((choice) => choice.value),
            '$.poisonModePreparations.profileChoices',
          );
          const selected = entry.input.poisonProfileId;
          if (
            selected.kind === 'ENTERED' &&
            !entry.profileChoices.some((choice) => choice.value === selected.value)
          )
            bad('$.poisonModePreparations.input.poisonProfileId');
          if (!c.symbionts.some((source) => source.symbiontInstanceId === entry.sourceInstanceId))
            bad('$.poisonModePreparations.sourceInstanceId');
        }
      }
      if (c.poisonModeStates !== undefined) {
        unique(
          c.poisonModeStates.map((entry) => entry.modeFactId),
          '$.poisonModeStates.modeFactId',
        );
        unique(
          c.poisonModeStates.map((entry) => entry.sourceInstanceId),
          '$.poisonModeStates.sourceInstanceId',
        );
        const selected = c.input.input.poisonModeFactIds;
        if (
          selected?.kind !== 'ENTERED' ||
          selected.value.length !== c.poisonModeStates.length ||
          c.poisonModeStates.some((state) => !selected.value.includes(state.modeFactId))
        )
          bad('$.poisonModeStates.selected');
      }
      if (Object.hasOwn(c.input.input, 'poisonModeFactIds') && c.poisonModeStates === undefined)
        bad('$.poisonModeStates.missing');
      if (
        Object.hasOwn(c.input.input, 'weaverEffectInstanceIds') &&
        c.temporaryWeaverStates === undefined
      )
        bad('$.temporaryWeaverStates.missing');
      if (c.temporaryWeaverStatePreparations !== undefined) {
        unique(
          c.temporaryWeaverStatePreparations.map((entry) => entry.capabilityKey),
          '$.temporaryWeaverStatePreparations',
        );
        unique(
          c.temporaryWeaverStatePreparations.map((entry) => entry.sourceInstanceId),
          '$.temporaryWeaverStatePreparations.sourceInstanceId',
        );
        for (const entry of c.temporaryWeaverStatePreparations) {
          unique(
            entry.branchChoices.map((choice) => choice.value),
            '$.temporaryWeaverStatePreparations.branchChoices',
          );
          if (
            entry.input.branch.kind === 'ENTERED' &&
            !entry.branchChoices.some(
              (choice) =>
                entry.input.branch.kind === 'ENTERED' && choice.value === entry.input.branch.value,
            )
          )
            bad('$.temporaryWeaverStatePreparations.input.branch');
          if (!c.symbionts.some((source) => source.symbiontInstanceId === entry.sourceInstanceId))
            bad('$.temporaryWeaverStatePreparations.sourceInstanceId');
        }
      }
      if (c.temporaryWeaverStates !== undefined) {
        unique(
          c.temporaryWeaverStates.map((entry) => entry.capabilityKey),
          '$.temporaryWeaverStates',
        );
        unique(
          c.temporaryWeaverStates.map((entry) => entry.effectInstanceId),
          '$.temporaryWeaverStates.effectInstanceId',
        );
        const selected = c.input.input.weaverEffectInstanceIds;
        if (
          selected?.kind !== 'ENTERED' ||
          selected.value.length !== c.temporaryWeaverStates.length ||
          c.temporaryWeaverStates.some((state) => !selected.value.includes(state.effectInstanceId))
        )
          bad('$.temporaryWeaverStates.selected');
      }
      const life = c.lifeStatePreparationOrNull;
      if (life != null) {
        unique(
          life.lifeChoices.map((entry) => entry.value),
          '$.lifeStatePreparation.lifeChoices',
        );
        if (life.retainedTimer && (life.rollOrNull === null || life.canRoll))
          bad('$.lifeStatePreparation.retainedTimer');
        if (life.rollOrNull !== null && life.canRoll) bad('$.lifeStatePreparation.canRoll');
        const selected = life.input.lifeKind;
        if (
          selected.kind === 'ENTERED' &&
          !life.lifeChoices.some((entry) => entry.value === selected.value)
        )
          bad('$.lifeStatePreparation.input.lifeKind');
      }
      if (c.formalControlPreparations !== undefined)
        unique(
          c.formalControlPreparations.map((entry) => entry.capabilityKey),
          '$.formalControlPreparations',
        );
      if (c.hpModePreparations !== undefined)
        unique(
          c.hpModePreparations.map((entry) => entry.capabilityKey),
          '$.hpModePreparations',
        );
      unique(
        c.symbionts.map((s) => s.symbiontInstanceId),
        '$.symbionts',
      );
      unique(
        c.input.currentOeChanges.map((s) => s.symbiontInstanceId),
        '$.input.currentOeChanges',
      );
      if (
        c.input.currentOeChanges.length !== c.symbionts.length ||
        c.input.currentOeChanges.some(
          (x) =>
            !c.symbionts.some(
              (s) =>
                s.symbiontInstanceId === x.symbiontInstanceId &&
                (s.currentOE.kind === 'UNSET'
                  ? x.currentOE.kind === 'UNSET'
                  : x.currentOE.kind === 'ENTERED' && s.currentOE.value === x.currentOE.value),
            ),
        )
      )
        bad('$.input.currentOeChanges');
      break;
    }
    case 'NPC-017': {
      const c = p.content,
        b = c.binding;
      if (
        a === null ||
        c.npcUuidOnCommit !== a.candidateNpcUuid ||
        b.attemptRevision !== a.attemptRevision ||
        b.editMode !== a.editMode ||
        !sameTarget(b.versionBindingOrNull, a.versionBindingOrNull)
      )
        bad('$.binding');
      if (
        b.editMode === 'APPEND_N_PLUS_ONE' &&
        b.resultVersion !== b.versionBindingOrNull.expectedCurrentVersion + 1
      )
        bad('$.binding.resultVersion');
      if (
        c.fullValidationStatus === 'VALID' &&
        (c.previewOrNull === null ||
          c.validationErrors.length !== 0 ||
          NPC_VALIDATION_STAGE_IDS.some((s) => c.stages[s].status !== 'VALID') ||
          !['CURRENT', 'NOT_REQUIRED'].includes(c.calendar.validationStatus))
      )
        bad('$.fullValidationStatus');
      if (c.previewOrNull) {
        portrait(c.previewOrNull.artOrNull);
        if (c.previewOrNull.pinnedCombatReferences.length !== 0)
          bad('$.previewOrNull.pinnedCombatReferences');
      }
      if (
        c.receiptOrNull !== null &&
        (c.receiptOrNull.npcUuid !== c.npcUuidOnCommit ||
          c.receiptOrNull.version !== b.resultVersion)
      )
        bad('$.receiptOrNull');
      break;
    }
    default:
      break;
  }
}
/** expected is checked too; no wire object can select player authority or a foreign current scope. */
export function npcGmProjectionValue(
  formId: string,
  value: unknown,
  expected: NpcProjectionScope,
): NpcGmProjection {
  if (!(NPC_CONTROL_FORM_IDS as readonly string[]).includes(formId)) bad('$.formId');
  const scope = detached(expected, '$.scope');
  object(scopeFields)(scope, '$.scope');
  const v = detached(value, '$.npc'),
    form = formId as keyof typeof content;
  object({
    ...scopeFields,
    formId: literal(formId),
    campaignStatus: literal('PAUSED', 'HOSTING'),
    campaignPhase: literal('PRE_START', 'STARTED'),
    libraryRevision: revision,
    attemptOrNull: nullable(attempt),
    content: content[form],
  })(v, '$.npc');
  for (const k of Object.keys(scopeFields))
    if (row(v, '$.npc')[k] !== row(scope, '$.scope')[k]) bad('$.scope.' + k);
  const result = v as NpcGmProjection;
  verifyLinks(result);
  return result;
}

/** Structural detachment is not a domain validator or a valid-projection assertion. */
export function npcProjectionDataValue(value: unknown): unknown {
  return detached(value, '$.npc');
}

export function npcLobbyProjectionFieldsValue(
  value: unknown,
  campaignId: string,
  preStart: boolean,
): NpcLobbyProjectionFields {
  uuid(campaignId, '$.campaignId');
  const v = detached(value, '$.npcLobby');
  object({
    initialTimeLockOrNull: nullable(lock),
    npcInitialTimeReturnContextOrNull: nullable(
      object({
        campaignId: uuid,
        npcDraftId: uuid,
        attemptRevision: revision,
        editMode: literal('CREATE_V1', 'APPEND_N_PLUS_ONE'),
        versionBindingOrNull: nullable(target),
        returnFormId: literal('NPC-016'),
      }),
    ),
  })(v, '$.npcLobby');
  const result = v as NpcLobbyProjectionFields,
    c = result.npcInitialTimeReturnContextOrNull;
  if (
    c !== null &&
    (!preStart ||
      c.campaignId !== campaignId ||
      (c.editMode === 'CREATE_V1'
        ? c.versionBindingOrNull !== null
        : c.versionBindingOrNull === null))
  )
    bad('$.npcInitialTimeReturnContextOrNull');
  return result;
}

const artReadBinding = {
  protocolVersion: literal(3),
  requestId: uuid,
  contextId: uuid,
  campaignId: uuid,
  sourceFormId: literal('NPC-001', 'NPC-002', 'NPC-003', 'NPC-007', 'NPC-017'),
  expectedRevisions: object({
    stateRevision: revision,
    projectionRevision: revision,
    actorVisibilityRevision: revision,
  }),
  target: branch('kind', {
    ATTEMPT: object({
      kind: literal('ATTEMPT'),
      npcDraftId: uuid,
      expectedAttemptRevision: revision,
    }),
    VERSION: object({ kind: literal('VERSION'), npcUuid: uuid, version: positive }),
  }),
  assetKey: ref,
  checksum: sha,
};
/** Shape only; the host additionally proves the requesting connection is the current GM. */
export function npcArtReadMessageValue(value: unknown): NpcArtReadMessage {
  const safe = detached(value, '$');
  branch('messageType', {
    'network.npc-art.read': object({
      ...artReadBinding,
      messageType: literal('network.npc-art.read'),
    }),
    'network.npc-art.result': object({
      ...artReadBinding,
      messageType: literal('network.npc-art.result'),
      mediaType: literal('image/png', 'image/jpeg'),
      bytesBase64: text,
    }),
    'network.npc-art.refusal': object({
      ...artReadBinding,
      messageType: literal('network.npc-art.refusal'),
      code: literal('NOT_AVAILABLE', 'STALE_REQUEST', 'INVALID_REQUEST'),
    }),
  })(safe, '$');
  const result = safe as NpcArtReadMessage;
  portrait({ assetKey: result.assetKey, checksum: result.checksum });
  if (
    (result.sourceFormId === 'NPC-002' || result.sourceFormId === 'NPC-017') !==
    (result.target.kind === 'ATTEMPT')
  )
    bad('$.target');
  if (result.messageType === 'network.npc-art.result') npcArtResultBytes(result);
  return result;
}
/** Canonical bytes/signature only. The authoritative host computes SHA; this is not browser SHA verification. */
export function npcArtResultBytes(
  result: Pick<NpcArtReadResult, 'mediaType' | 'bytesBase64'>,
): Uint8Array<ArrayBuffer> {
  // ADR0077 preserves the existing campaignArtChecksum PNG/JPEG and 12 MiB interpretation.
  const encoded = result.bytesBase64,
    maximum = 12 * 1024 * 1024;
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    encoded.length > 4 * Math.ceil(maximum / 3)
  )
    bad('$.bytesBase64');
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return bad('$.bytesBase64');
  }
  if (binary.length > maximum || btoa(binary) !== encoded) bad('$.bytesBase64');
  const signature =
    result.mediaType === 'image/png'
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : result.mediaType === 'image/jpeg'
        ? [0xff, 0xd8, 0xff]
        : null;
  if (signature === null || !signature.every((byte, index) => binary.charCodeAt(index) === byte))
    bad('$.bytesBase64');
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
/** Stable comparison excludes response payload. All values have first passed the closed decoder. */
export function npcArtReadBindingKey(b: NpcArtReadBinding): string {
  return JSON.stringify([
    b.protocolVersion,
    b.requestId,
    b.contextId,
    b.campaignId,
    b.sourceFormId,
    b.expectedRevisions.stateRevision,
    b.expectedRevisions.projectionRevision,
    b.expectedRevisions.actorVisibilityRevision,
    b.target.kind,
    b.target.kind === 'ATTEMPT' ? b.target.npcDraftId : b.target.npcUuid,
    b.target.kind === 'ATTEMPT' ? b.target.expectedAttemptRevision : b.target.version,
    b.assetKey,
    b.checksum,
  ]);
}
/** Current projection membership is necessary, never a substitute for connection-derived GM authority. */
export function npcArtReadRequestForProjection(
  value: unknown,
  p: NpcGmProjection,
): NpcArtReadRequest {
  const r = npcArtReadMessageValue(value);
  if (
    r.messageType !== 'network.npc-art.read' ||
    r.contextId !== p.contextId ||
    r.campaignId !== p.campaignId ||
    r.sourceFormId !== p.formId ||
    r.expectedRevisions.stateRevision !== p.stateRevision ||
    r.expectedRevisions.projectionRevision !== p.projectionRevision ||
    r.expectedRevisions.actorVisibilityRevision !== p.actorVisibilityRevision
  )
    bad('$.art.scope');
  let candidate: { readonly assetKey: string; readonly checksum: string } | null = null;
  const t = r.target;
  if (t.kind === 'ATTEMPT') {
    if (
      p.attemptOrNull?.npcDraftId !== t.npcDraftId ||
      p.attemptOrNull.attemptRevision !== t.expectedAttemptRevision
    )
      bad('$.art.target');
    if (p.formId === 'NPC-002') candidate = p.content.artOrNull;
    if (p.formId === 'NPC-017') candidate = p.content.previewOrNull?.artOrNull ?? null;
  } else {
    if (p.formId === 'NPC-001')
      candidate =
        p.content.rows.find((x) => x.npcUuid === t.npcUuid && x.currentVersion === t.version)
          ?.artOrNull ?? null;
    if (
      p.formId === 'NPC-003' &&
      p.content.npcUuid === t.npcUuid &&
      p.content.displayedVersion === t.version
    )
      candidate = p.content.artOrNull;
    if (
      p.formId === 'NPC-007' &&
      p.content.npcUuid === t.npcUuid &&
      p.content.selectedVersionOrNull === t.version
    )
      candidate = p.content.previewOrNull?.artOrNull ?? null;
  }
  if (candidate === null || candidate.assetKey !== r.assetKey || candidate.checksum !== r.checksum)
    bad('$.art.membership');
  return r;
}
