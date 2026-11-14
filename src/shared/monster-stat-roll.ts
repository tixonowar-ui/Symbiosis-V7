import type { EnemyStats } from './enemy-authoring.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';

/** CORE-201: independent natural R20, in this exact order, with no critical chain. */
export const MONSTER_STAT_ROLL_ORDER = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
export type MonsterStatKey = (typeof MONSTER_STAT_ROLL_ORDER)[number];
export interface MonsterStatRollBinding {
  readonly kind: 'CUSTOM_MONSTER';
  readonly attemptId: string;
  readonly campaignId: string;
  readonly originFormId: 'ENM-012' | 'ENM-017';
  readonly versionBindingOrNull: Readonly<{
    templateId: string;
    expectedCurrentVersion: number;
  }> | null;
}
/** Null is an explicitly unentered field, never a guessed mechanical default. */
export interface MonsterStatsDraft {
  readonly baseStats: Readonly<Record<MonsterStatKey, number | null>>;
  readonly massKg: number | null;
  readonly ageYears: number | null;
  readonly baseMaxHP: number | null;
}
export type MonsterAcceptedStats = Readonly<{
  baseStats: EnemyStats;
  massKg: number;
  ageYears: number;
  baseMaxHP: number;
}>;
/** A no-edit018 round trip may cache accepted inputs without creating a new body change. */
export function monsterStatDraftRequiresAcceptance(
  draft: MonsterStatsDraft | null,
  accepted: MonsterAcceptedStats | null,
): boolean {
  return (
    draft !== null &&
    (accepted === null ||
      !admissionJsonEqual(draft, {
        baseStats: accepted.baseStats,
        massKg: accepted.massKg,
        ageYears: accepted.ageYears,
        baseMaxHP: accepted.baseMaxHP,
      }))
  );
}
export interface MonsterStatRollOperation {
  readonly operationId: string;
  /** Same UUID as the existing owning ENEMY_AUTHORING cause.receiptId. */
  readonly randomReceiptId: string;
  readonly attemptRevision: number;
  readonly authorMasterProfileId: string;
  readonly timestamp: string;
  readonly sourceBaselineVersion: string;
  readonly artSha256: string;
}
export interface MonsterStatRollReceipt extends MonsterStatRollOperation {
  readonly schemaVersion: 1;
  readonly operation: 'RANDOMIZE_CUSTOM_MONSTER_STATS';
  readonly binding: MonsterStatRollBinding;
  readonly creationAttemptId: string;
  readonly monsterDraftId: string;
  /** Host audit/group nonce, not a client seed or a deterministic PRNG promise. */
  readonly generationSeed: string;
  readonly rolls: readonly Readonly<{
    stat: MonsterStatKey;
    rollGroupId: string;
    dieSides: 20;
    rawFace: number;
  }>[];
  readonly dieFaces: readonly number[];
  readonly originalGeneratedStats: EnemyStats;
  readonly beforeDraftOrNull: MonsterStatsDraft | null;
}
/** Technical attempt state only: accepted body/knowledge and stored old versions are separate. */
export interface MonsterStatRollState {
  readonly binding: MonsterStatRollBinding;
  readonly generationSeed: string;
  readonly rollOnceStatus: 'NOT_ROLLED' | 'COMMITTED';
  readonly randomReceiptOrNull: MonsterStatRollReceipt | null;
  readonly draftOrNull: MonsterStatsDraft | null;
}

export const MONSTER_STAT_DRAFT_ACTIONS = {
  'ENM-012::CTA::001': ['ENM-012', 'ENM-018', 'NOT_ROLLED'],
  'ENM-012::CTA::005': ['ENM-012', 'ENM-018', 'NOT_ROLLED'],
  'ENM-012::CTA::002': ['ENM-012', 'ENM-019', 'COMMITTED'],
  'ENM-017::CTA::006': ['ENM-017', 'ENM-018', 'NOT_ROLLED'],
  'ENM-017::CTA::007': ['ENM-017', 'ENM-019', 'COMMITTED'],
} as const;
export interface MonsterStatDraftPatch {
  readonly sourceActionKey: keyof typeof MONSTER_STAT_DRAFT_ACTIONS;
  readonly draftOrNull: MonsterStatsDraft | null;
}
export interface MonsterStatRollCommandPayload {
  readonly campaignId: string;
  readonly creationAttemptId: string;
  readonly expectedAttemptRevision: number;
  readonly attemptId: string;
  readonly monsterDraftId: string;
  readonly originFormId: 'ENM-012' | 'ENM-017';
  readonly returnFormId: 'ENM-012' | 'ENM-017';
  readonly versionBindingOrNull: MonsterStatRollBinding['versionBindingOrNull'];
}
export function monsterStatDraftPatchValue(value: unknown): MonsterStatDraftPatch {
  const row = r.exact(value, 'sourceActionKey draftOrNull', '$.monsterStatDraftPatch');
  r.oneOf(row['sourceActionKey'], Object.keys(MONSTER_STAT_DRAFT_ACTIONS), '$.sourceActionKey');
  if (row['draftOrNull'] !== null) monsterStatsDraftValue(row['draftOrNull']);
  return w.validated(structuredClone(row));
}
/** Opening generation without local edits copies actual accepted inputs, never empty defaults. */
export function monsterStatOpeningDraft(
  patch: MonsterStatDraftPatch,
  accepted: MonsterAcceptedStats | null,
): MonsterStatsDraft | null {
  if (patch.draftOrNull !== null) return patch.draftOrNull;
  if (MONSTER_STAT_DRAFT_ACTIONS[patch.sourceActionKey][1] !== 'ENM-018' || accepted === null)
    return null;
  return monsterStatsDraftValue({
    baseStats: accepted.baseStats,
    massKg: accepted.massKg,
    ageYears: accepted.ageYears,
    baseMaxHP: accepted.baseMaxHP,
  });
}
export function monsterStatRollCommandPayloadValue(value: unknown): MonsterStatRollCommandPayload {
  const row = r.exact(
    value,
    'campaignId creationAttemptId expectedAttemptRevision attemptId monsterDraftId originFormId returnFormId versionBindingOrNull',
    '$.monsterStatRollPayload',
  );
  const binding = monsterStatRollBindingValue({
    kind: 'CUSTOM_MONSTER',
    campaignId: row['campaignId'],
    attemptId: row['creationAttemptId'],
    originFormId: row['originFormId'],
    versionBindingOrNull: row['versionBindingOrNull'],
  });
  for (const key of ['attemptId', 'monsterDraftId'])
    w.literal(row[key], binding.attemptId, '$.' + key);
  w.literal(row['returnFormId'], binding.originFormId, '$.returnFormId');
  r.integer(row['expectedAttemptRevision'], '$.expectedAttemptRevision', 0);
  return w.validated(structuredClone(row));
}

export function monsterStatRollBindingValue(value: unknown): MonsterStatRollBinding {
  const row = r.exact(
    value,
    'kind attemptId campaignId originFormId versionBindingOrNull',
    '$.monsterStatBinding',
  );
  w.literal(row['kind'], 'CUSTOM_MONSTER', '$.monsterStatBinding.kind');
  r.uuid(row['attemptId'], '$.monsterStatBinding.attemptId');
  r.uuid(row['campaignId'], '$.monsterStatBinding.campaignId');
  const origin = r.oneOf(row['originFormId'], ['ENM-012', 'ENM-017'], '$.originFormId');
  if (origin === 'ENM-012') w.literal(row['versionBindingOrNull'], null, '$.versionBinding');
  else {
    const version = r.exact(
      row['versionBindingOrNull'],
      'templateId expectedCurrentVersion',
      '$.versionBinding',
    );
    r.uuid(version['templateId'], '$.versionBinding.templateId');
    r.integer(version['expectedCurrentVersion'], '$.versionBinding.expectedCurrentVersion', 1);
  }
  return w.validated(structuredClone(row));
}

export function monsterStatGenerationSeedValue(value: unknown): string {
  const seed = r.text(value, '$.generationSeed');
  if (!/^[a-f0-9]{64}$/.test(seed))
    r.invalid('$.generationSeed', 'host 256-bit opaque audit nonce', value);
  return seed;
}

export function monsterStatsDraftValue(value: unknown): MonsterStatsDraft {
  const row = r.exact(value, 'baseStats massKg ageYears baseMaxHP', '$.monsterStatsDraft');
  const stats = r.exact(row['baseStats'], MONSTER_STAT_ROLL_ORDER.join(' '), '$.baseStats');
  for (const key of MONSTER_STAT_ROLL_ORDER)
    if (stats[key] !== null && r.integer(stats[key], '$.baseStats.' + key, 1) > 35)
      r.invalid('$.baseStats.' + key, 'CORE-200 integer 1..35 or unentered null', stats[key]);
  if (row['massKg'] !== null) {
    const mass = r.finite(row['massKg'], '$.massKg', 5);
    if (mass > 10_000 || Math.round(mass * 10) / 10 !== mass)
      r.invalid('$.massKg', 'ADR0077 5..10000kg at exact 0.1kg step', mass);
  }
  for (const key of ['ageYears', 'baseMaxHP'])
    if (row[key] !== null) r.integer(row[key], '$.' + key, 1);
  return w.validated(structuredClone(row));
}

export function monsterStatRollStatsValue(value: unknown): EnemyStats {
  const row = r.exact(value, MONSTER_STAT_ROLL_ORDER.join(' '), '$.generatedStats');
  for (const key of MONSTER_STAT_ROLL_ORDER)
    if (r.integer(row[key], '$.generatedStats.' + key, 1) > 20)
      r.invalid('$.generatedStats.' + key, 'CORE-201 natural R20 1..20', row[key]);
  return w.validated(structuredClone(row));
}

export function monsterStatRollOperationValue(value: unknown): MonsterStatRollOperation {
  const row = r.exact(
    value,
    'operationId randomReceiptId attemptRevision authorMasterProfileId timestamp sourceBaselineVersion artSha256',
    '$.monsterStatOperation',
  );
  r.uuid(row['operationId'], '$.operationId');
  r.uuid(row['randomReceiptId'], '$.randomReceiptId');
  r.integer(row['attemptRevision'], '$.attemptRevision', 0);
  r.uuid(row['authorMasterProfileId'], '$.authorMasterProfileId');
  r.text(row['sourceBaselineVersion'], '$.sourceBaselineVersion');
  const time = r.text(row['timestamp'], '$.timestamp');
  if (!Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time)
    r.invalid('$.timestamp', 'canonical owning UTC timestamp', time);
  const art = r.text(row['artSha256'], '$.artSha256');
  if (!/^[a-f0-9]{64}$/.test(art)) r.invalid('$.artSha256', 'actual art SHA-256', art);
  return w.validated(structuredClone(row));
}

export function monsterStatRollReceiptValue(value: unknown): MonsterStatRollReceipt {
  const row = r.exact(
    value,
    'schemaVersion operation binding creationAttemptId monsterDraftId generationSeed operationId randomReceiptId attemptRevision authorMasterProfileId timestamp sourceBaselineVersion artSha256 rolls dieFaces originalGeneratedStats beforeDraftOrNull',
    '$.monsterStatReceipt',
  );
  w.literal(row['schemaVersion'], 1, '$.schemaVersion');
  w.literal(row['operation'], 'RANDOMIZE_CUSTOM_MONSTER_STATS', '$.operation');
  const binding = monsterStatRollBindingValue(row['binding']);
  for (const key of ['creationAttemptId', 'monsterDraftId'])
    w.literal(row[key], binding.attemptId, '$.' + key);
  const seed = monsterStatGenerationSeedValue(row['generationSeed']);
  monsterStatRollOperationValue({
    operationId: row['operationId'],
    randomReceiptId: row['randomReceiptId'],
    attemptRevision: row['attemptRevision'],
    authorMasterProfileId: row['authorMasterProfileId'],
    timestamp: row['timestamp'],
    sourceBaselineVersion: row['sourceBaselineVersion'],
    artSha256: row['artSha256'],
  });
  const rolls = r.list(row['rolls'], '$.rolls');
  const faces = r.list(row['dieFaces'], '$.dieFaces');
  if (rolls.length !== 7 || faces.length !== 7)
    r.invalid('$.rolls', 'CORE-201 exactly seven independent natural R20', value);
  const stats = monsterStatRollStatsValue(row['originalGeneratedStats']);
  MONSTER_STAT_ROLL_ORDER.forEach((stat, index) => {
    const roll = r.exact(rolls[index], 'stat rollGroupId dieSides rawFace', '$.rolls[]');
    w.literal(roll['stat'], stat, '$.rolls[].stat');
    w.literal(roll['rollGroupId'], seed + '/' + stat, '$.rolls[].rollGroupId');
    w.literal(roll['dieSides'], 20, '$.rolls[].dieSides');
    const face = r.integer(roll['rawFace'], '$.rolls[].rawFace', 1);
    if (face > 20) r.invalid('$.rolls[].rawFace', 'natural R20 1..20', face);
    w.literal(faces[index], face, '$.dieFaces[]');
    w.literal(stats[stat], face, '$.originalGeneratedStats.' + stat);
  });
  if (row['beforeDraftOrNull'] !== null) monsterStatsDraftValue(row['beforeDraftOrNull']);
  return w.validated(structuredClone(row));
}

export function monsterStatRollStateValue(value: unknown): MonsterStatRollState {
  const row = r.exact(
    value,
    'binding generationSeed rollOnceStatus randomReceiptOrNull draftOrNull',
    '$.monsterStatRollState',
  );
  const binding = monsterStatRollBindingValue(row['binding']);
  const seed = monsterStatGenerationSeedValue(row['generationSeed']);
  const status = r.oneOf(row['rollOnceStatus'], ['NOT_ROLLED', 'COMMITTED'], '$.rollOnceStatus');
  if (status === 'NOT_ROLLED') w.literal(row['randomReceiptOrNull'], null, '$.randomReceipt');
  else {
    const receipt = monsterStatRollReceiptValue(row['randomReceiptOrNull']);
    if (!admissionJsonEqual(receipt.binding, binding) || receipt.generationSeed !== seed)
      r.invalid('$.randomReceiptOrNull', 'same owning attempt and generation nonce', null);
  }
  if (row['draftOrNull'] !== null) monsterStatsDraftValue(row['draftOrNull']);
  return w.validated(structuredClone(row));
}
