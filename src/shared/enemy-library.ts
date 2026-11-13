import type { ActionKey } from '@generated/types/atlas.js';
import {
  enemyVersionIdentityValue,
  type EnemyVersionIdentity,
  type EnemyUserEntry,
} from './enemy-authoring.js';
import { admissionJsonEqual, admissionCodecReaders as r } from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import type { JsonValue, RevisionVector } from './wire-protocol.js';

export const ENEMY_LIBRARY_FORMS = ['ENM-001', 'ENM-003'] as const;
export const isEnemyLibraryForm = (value: string): value is EnemyLibraryProjection['formId'] =>
  (ENEMY_LIBRARY_FORMS as readonly string[]).includes(value);
export const ENEMY_LIBRARY_NAV_TARGETS = {
  'GM-001::CTA::005': 'ENM-001',
  'ENM-001::CTA::002': 'ENM-003',
  'ENM-001::CTA::004': 'ENM-003',
  'ENM-001::CTA::007': 'ENM-020',
  'ENM-001::CTA::008': 'ENM-017',
  'ENM-001::CTA::013': 'GM-001',
  'ENM-003::CTA::001': 'ENM-001',
} as const;
export const ENEMY_LIBRARY_TABS = ['SENTIENT_ENEMIES', 'MONSTERS'] as const;
export type EnemyLibraryTab = (typeof ENEMY_LIBRARY_TABS)[number];
export interface EnemyLibraryContext {
  readonly userSelectionOrNull?: EnemyVersionIdentity | null;
  readonly activeTab: EnemyLibraryTab;
  readonly selectedOrNull: EnemyLibrarySelection | null;
}
export type EnemyCatalogOrigin = 'SYSTEM_DEFAULT_SENTIENT' | 'CANONICAL_BESTIARY';
export interface EnemyLibrarySelection {
  readonly origin: EnemyCatalogOrigin;
  readonly templateId: string;
  readonly catalogVersion: string;
  readonly artAssetKey: string;
}
export interface EnemyCatalogEntry extends EnemyLibrarySelection {
  readonly displayName: string;
  readonly summary: string;
  readonly speciesIdOrNull: string | null;
}
export interface EnemyLibraryCard {
  readonly template: EnemyCatalogEntry;
  readonly payloadSha256: string;
  readonly art: {
    readonly mediaType: 'image/png';
    readonly sha256: string;
    readonly bytesBase64: string;
  };
  readonly fields: readonly { readonly label: string; readonly value: JsonValue }[];
}
/** Technical library cursor only: never an enemy actor, draft, version or placement. */
export interface EnemyLibraryProjection extends RevisionVector {
  readonly userSelectionOrNull?: EnemyVersionIdentity | null;
  readonly systemTemplateArtAssetKey?: string;
  readonly activeTab: EnemyLibraryTab;
  readonly kind: 'SYSTEM_LIBRARY';
  readonly formId: (typeof ENEMY_LIBRARY_FORMS)[number];
  readonly contextId: string;
  readonly campaignId: string;
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly defaultSentientCatalogVersion: string;
  readonly catalogBaselineVersion: string;
  readonly systemTemplates: readonly EnemyCatalogEntry[];
  readonly canonicalTemplates: readonly EnemyCatalogEntry[];
  readonly currentUserTemplates: readonly EnemyUserEntry[];
  readonly selectedOrNull: EnemyLibrarySelection | null;
  readonly cardOrNull: EnemyLibraryCard | null;
}
export interface EnemyLibrarySelectionRequest {
  readonly userSelectionOrNull?: EnemyVersionIdentity | null;
  readonly messageType: 'network.enemy-selection.replace';
  readonly protocolVersion: 3;
  readonly operationId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly sourceFormId: 'ENM-001' | 'ENM-020';
  readonly activeTab: EnemyLibraryTab;
  readonly expectedRevisions: RevisionVector;
  readonly selectionOrNull: EnemyLibrarySelection | null;
}
export type EnemyLibrarySelectionResponse = {
  readonly messageType: 'network.enemy-selection.result' | 'network.enemy-selection.refusal';
  readonly protocolVersion: 3;
  readonly operationId: string;
};
function text(value: unknown, path: string): string {
  const result = r.text(value, path);
  return result.length > 0 ? result : r.invalid(path, 'nonempty string', null);
}
export function enemyLibrarySelectionValue(value: unknown): EnemyLibrarySelection {
  const row = r.exact(value, 'origin templateId catalogVersion artAssetKey', '$.selection');
  r.oneOf(row['origin'], ['SYSTEM_DEFAULT_SENTIENT', 'CANONICAL_BESTIARY'], '$.origin');
  for (const key of ['templateId', 'catalogVersion', 'artAssetKey']) text(row[key], '$.' + key);
  return w.validated(row);
}
export function enemyLibrarySelectionRequestValue(value: unknown): EnemyLibrarySelectionRequest {
  const raw = w.record(value, '$');
  const row = r.exact(
    value,
    'messageType protocolVersion operationId contextId campaignId sourceFormId expectedRevisions selectionOrNull activeTab' +
      (Object.hasOwn(raw, 'userSelectionOrNull') ? ' userSelectionOrNull' : ''),
    '$',
  );
  w.literal(row['messageType'], 'network.enemy-selection.replace', '$.messageType');
  w.literal(row['protocolVersion'], 3, '$.protocolVersion');
  r.oneOf(row['sourceFormId'], ['ENM-001', 'ENM-020'], '$.sourceFormId');
  r.oneOf(row['activeTab'], ENEMY_LIBRARY_TABS, '$.activeTab');
  for (const key of ['operationId', 'contextId', 'campaignId']) r.uuid(row[key], '$.' + key);
  const revisions = r.exact(
    row['expectedRevisions'],
    'stateRevision projectionRevision actorVisibilityRevision',
    '$.expectedRevisions',
  );
  for (const key of Object.keys(revisions))
    r.integer(revisions[key], '$.expectedRevisions.' + key, 0);
  if (row['selectionOrNull'] !== null) enemyLibrarySelectionValue(row['selectionOrNull']);
  if (row['userSelectionOrNull'] != null) {
    const user = enemyVersionIdentityValue(row['userSelectionOrNull']);
    if (
      user.campaignId !== row['campaignId'] ||
      (row['activeTab'] === 'SENTIENT_ENEMIES') !== (user.kind === 'SENTIENT') ||
      row['selectionOrNull'] !== null
    )
      r.invalid('$.userSelectionOrNull', 'own campaign and kind/tab selection', null);
  }
  if (
    row['sourceFormId'] === 'ENM-020' &&
    (row['selectionOrNull'] !== null || row['userSelectionOrNull'] == null)
  )
    r.invalid('$.historySelection', 'one actual saved own-template version', null);
  return w.validated(row);
}
export function enemyLibrarySelectionResponseValue(value: unknown): EnemyLibrarySelectionResponse {
  const row = r.exact(value, 'messageType protocolVersion operationId', '$');
  r.oneOf(
    row['messageType'],
    ['network.enemy-selection.result', 'network.enemy-selection.refusal'],
    '$.messageType',
  );
  w.literal(row['protocolVersion'], 3, '$.protocolVersion');
  r.uuid(row['operationId'], '$.operationId');
  return w.validated(row);
}
export function enemyLibraryProjectionValue(value: unknown): EnemyLibraryProjection {
  const raw = w.record(value, '$.enemyLibrary');
  const row = r.exact(
    value,
    (raw['formId'] === 'ENM-003' ? 'systemTemplateArtAssetKey ' : '') +
      'activeTab kind formId contextId campaignId campaignStatus stateRevision projectionRevision actorVisibilityRevision defaultSentientCatalogVersion catalogBaselineVersion systemTemplates canonicalTemplates currentUserTemplates selectedOrNull cardOrNull' +
      (Object.hasOwn(raw, 'userSelectionOrNull') ? ' userSelectionOrNull' : ''),
    '$.enemyLibrary',
  );
  w.literal(row['kind'], 'SYSTEM_LIBRARY', '$.kind');
  r.oneOf(row['activeTab'], ENEMY_LIBRARY_TABS, '$.activeTab');
  r.oneOf(row['formId'], ENEMY_LIBRARY_FORMS, '$.formId');
  r.oneOf(row['campaignStatus'], ['PAUSED', 'HOSTING'], '$.campaignStatus');
  for (const key of ['contextId', 'campaignId']) r.uuid(row[key], '$.' + key);
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])
    r.integer(row[key], '$.' + key, 0);
  for (const key of ['defaultSentientCatalogVersion', 'catalogBaselineVersion'])
    text(row[key], '$.' + key);
  const entry = (value: unknown): EnemyCatalogEntry => {
    const x = r.exact(
      value,
      'origin templateId catalogVersion artAssetKey displayName speciesIdOrNull summary',
      '$.entry',
    );
    enemyLibrarySelectionValue(
      Object.fromEntries(
        ['origin', 'templateId', 'catalogVersion', 'artAssetKey'].map((k) => [k, x[k]]),
      ),
    );
    text(x['displayName'], '$.displayName');
    text(x['summary'], '$.summary');
    if (x['speciesIdOrNull'] !== null) text(x['speciesIdOrNull'], '$.speciesIdOrNull');
    return w.validated(x);
  };
  for (const [key, origin] of [
    ['systemTemplates', 'SYSTEM_DEFAULT_SENTIENT'],
    ['canonicalTemplates', 'CANONICAL_BESTIARY'],
  ] as const) {
    const entries = r.list(row[key], '$.' + key).map(entry);
    if (
      origin === 'SYSTEM_DEFAULT_SENTIENT' &&
      entries.some((x) => x.catalogVersion !== row['defaultSentientCatalogVersion'])
    )
      r.invalid('$.systemTemplates', 'owning campaign pinned catalog version', null);
    if (
      entries.some((x) => x.origin !== origin) ||
      new Set(entries.map((x) => x.templateId)).size !== entries.length
    )
      r.invalid('$.' + key, 'distinct source-bound entries', null);
  }
  const users = r.list(row['currentUserTemplates'], '$.currentUserTemplates').map((value) => {
    const entry = r.exact(
      value,
      'campaignId templateId versionId version kind artAssetKey artSha256 displayName',
      '$.userEntry',
    );
    const { displayName, ...identity } = entry;
    r.text(displayName, '$.displayName');
    const version = enemyVersionIdentityValue(identity);
    if (version.campaignId !== row['campaignId']) r.invalid('$.userEntry', 'own campaign', null);
    return { ...version, displayName };
  });
  if (new Set(users.map((user) => user.templateId)).size !== users.length)
    r.invalid('$.currentUserTemplates', 'distinct templates', null);
  if (
    users.some((user) => (user.kind === 'SENTIENT') !== (row['activeTab'] === 'SENTIENT_ENEMIES'))
  )
    r.invalid('$.currentUserTemplates', 'actual kind belongs to active tab', null);
  const context = enemyLibraryContextValue({
    activeTab: row['activeTab'],
    selectedOrNull: row['selectedOrNull'],
    ...(Object.hasOwn(row, 'userSelectionOrNull')
      ? { userSelectionOrNull: row['userSelectionOrNull'] }
      : {}),
  });
  if (
    context.userSelectionOrNull != null &&
    !users.some(({ displayName: _label, ...identity }) =>
      admissionJsonEqual(identity, context.userSelectionOrNull),
    )
  )
    r.invalid('$.userSelectionOrNull', 'actual own current template version/art', null);
  if (context.selectedOrNull !== null) {
    const list = r
      .list(
        row[context.activeTab === 'SENTIENT_ENEMIES' ? 'systemTemplates' : 'canonicalTemplates'],
        '$.templates',
      )
      .map(entry);
    if (
      !list.some(
        (x) =>
          x.origin === context.selectedOrNull!.origin &&
          x.templateId === context.selectedOrNull!.templateId &&
          x.catalogVersion === context.selectedOrNull!.catalogVersion &&
          x.artAssetKey === context.selectedOrNull!.artAssetKey,
      )
    )
      r.invalid('$.selectedOrNull', 'actual selected source entry', null);
  }
  if (row['cardOrNull'] !== null) {
    const card = r.exact(row['cardOrNull'], 'template payloadSha256 art fields', '$.card');
    const template = entry(card['template']);
    const actual = r
      .list(row['systemTemplates'], '$.systemTemplates')
      .map(entry)
      .find((x) => x.templateId === template.templateId);
    if (!admissionJsonEqual(template, actual))
      r.invalid('$.card.template', 'actual selected source metadata', null);
    if (
      context.activeTab !== 'SENTIENT_ENEMIES' ||
      template.origin !== 'SYSTEM_DEFAULT_SENTIENT' ||
      template.templateId !== context.selectedOrNull?.templateId ||
      template.catalogVersion !== context.selectedOrNull.catalogVersion ||
      template.artAssetKey !== context.selectedOrNull.artAssetKey ||
      row['systemTemplateArtAssetKey'] !== template.artAssetKey
    )
      r.invalid('$.card', 'exact selected Runtime Pack template/art', null);
    if (!/^[a-f0-9]{64}$/u.test(text(card['payloadSha256'], '$.payloadSha256')))
      r.invalid('$.payloadSha256', 'SHA-256', null);
    const art = r.exact(card['art'], 'mediaType sha256 bytesBase64', '$.art');
    w.literal(art['mediaType'], 'image/png', '$.mediaType');
    if (!/^[a-f0-9]{64}$/u.test(text(art['sha256'], '$.sha256')))
      r.invalid('$.art.sha256', 'SHA-256', null);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        text(art['bytesBase64'], '$.bytesBase64'),
      )
    )
      r.invalid('$.art.bytesBase64', 'canonical base64', null);
    for (const value of r.list(card['fields'], '$.fields')) {
      const field = r.exact(value, 'label value', '$.field');
      const label = r.oneOf(
        field['label'],
        [
          'displayName',
          'race',
          'pureClass',
          'factionGroup',
          'combatRole',
          'threatTier',
          'massKg',
          'baseStats',
          'skillStageStats',
          'effectiveStats',
          'equippedStats',
          'maxHP',
          'skills',
          'symbionts',
          'symbioticMonster',
          'items',
          'progressionPolicy',
        ],
        '$.field.label',
      );
      const content = w.json(field['value'], '$.field.value');
      if (['baseStats', 'skillStageStats', 'effectiveStats', 'equippedStats'].includes(label)) {
        const stats = r.exact(content, 'S D M Z I W C', '$.field.stats');
        if (Object.values(stats).some((x) => typeof x !== 'number' || !Number.isFinite(x)))
          r.invalid('$.field.stats', 'seven numeric source values', null);
      } else if (['skills', 'symbionts', 'items'].includes(label)) {
        const required =
          label === 'skills'
            ? ['skillName', 'bonus', 'slotCost', 'note']
            : label === 'symbionts'
              ? ['speciesName', 'targetLevel', 'effectiveLevel', 'maxOE']
              : ['itemName', 'equipSlot'];
        const optional = label === 'items' ? ['bodyZone', 'quantity', 'currentAmmo'] : [];
        for (const item of r.list(content, '$.field.items')) {
          const row = w.record(item, '$.field.item');
          r.exact(
            row,
            [...required, ...optional.filter((key) => Object.hasOwn(row, key))].join(' '),
            '$.field.item',
          );
          for (const [key, value] of Object.entries(row)) {
            if (
              [
                'bonus',
                'slotCost',
                'targetLevel',
                'effectiveLevel',
                'maxOE',
                'quantity',
                'currentAmmo',
              ].includes(key)
            ) {
              if (
                !(['bonus', 'currentAmmo'].includes(key) && value === null) &&
                (typeof value !== 'number' || !Number.isFinite(value))
              )
                r.invalid('$.field.item.' + key, 'numeric source fact', null);
            } else if (key === 'equipSlot')
              r.oneOf(
                value,
                [
                  'HAND_L',
                  'HAND_R',
                  'BOTH_HANDS',
                  'HEAD',
                  'TORSO',
                  'ARM_L',
                  'ARM_R',
                  'LEG_L',
                  'LEG_R',
                  'INVENTORY',
                  'FULL_SUIT',
                  'STOWED_BACK',
                ],
                '$.field.item.equipSlot',
              );
            else if (key === 'bodyZone')
              r.oneOf(
                value,
                ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R', 'ALL_SIX'],
                '$.field.item.bodyZone',
              );
            else if (key === 'note') r.raw(value, '$.field.item.note');
            else r.text(value, '$.field.item.' + key);
          }
        }
      } else if (label === 'symbioticMonster') {
        if (content !== null) {
          const monster = r.exact(
            content,
            'targetLevel maxOE maxHPBonus permanentStatDelta',
            '$.field.monster',
          );
          for (const key of ['targetLevel', 'maxOE', 'maxHPBonus'])
            if (typeof monster[key] !== 'number' || !Number.isFinite(monster[key]))
              r.invalid('$.field.monster.' + key, 'numeric source fact', null);
          const stats = r.exact(
            monster['permanentStatDelta'],
            'S D M Z I W C',
            '$.field.monster.stats',
          );
          if (Object.values(stats).some((x) => typeof x !== 'number' || !Number.isFinite(x)))
            r.invalid('$.field.monster.stats', 'seven numeric source values', null);
        }
      } else if (['massKg', 'maxHP'].includes(label)) {
        if (typeof content !== 'number' || !Number.isFinite(content))
          r.invalid('$.field.value', 'numeric source value', null);
      } else if (label === 'race') r.oneOf(content, ['PURE', 'FREE', 'UNITED'], '$.field.race');
      else if (label === 'pureClass' && content === null) {
        /* Explicit class absence belongs to the supplied template. */
      } else if (label === 'pureClass')
        r.oneOf(content, ['STALKER', 'SOLDIER', 'SEEKER'], '$.field.pureClass');
      else if (label === 'threatTier')
        r.oneOf(content, ['TRAINED', 'VETERAN', 'ELITE', 'BOSS'], '$.field.threatTier');
      else if (label === 'progressionPolicy')
        w.literal(content, 'NO_XP_PROGRESSION', '$.field.progressionPolicy');
      else r.text(content, '$.field.value');
    }
  }
  if ((row['formId'] === 'ENM-003') !== (row['cardOrNull'] !== null))
    r.invalid('$.cardOrNull', 'card only on ENM-003', null);
  return w.validated(row);
}

export function enemyLibraryContextValue(value: unknown): EnemyLibraryContext {
  const raw = w.record(value, '$.enemyLibraryContext');
  const row = r.exact(
    value,
    'activeTab selectedOrNull' +
      (Object.hasOwn(raw, 'userSelectionOrNull') ? ' userSelectionOrNull' : ''),
    '$.enemyLibraryContext',
  );
  r.oneOf(row['activeTab'], ENEMY_LIBRARY_TABS, '$.activeTab');
  if (row['userSelectionOrNull'] != null) {
    const identity = enemyVersionIdentityValue(row['userSelectionOrNull']);
    if (
      (row['activeTab'] === 'SENTIENT_ENEMIES') !== (identity.kind === 'SENTIENT') ||
      row['selectedOrNull'] !== null
    )
      r.invalid('$.userSelectionOrNull', 'exclusive own-kind user selection', null);
  }
  if (row['selectedOrNull'] !== null) {
    const selected = enemyLibrarySelectionValue(row['selectedOrNull']);
    if (
      (selected.origin === 'SYSTEM_DEFAULT_SENTIENT') !==
      (row['activeTab'] === 'SENTIENT_ENEMIES')
    )
      r.invalid('$.selectedOrNull', 'entry belongs to the selected tab', null);
  }
  return w.validated(row);
}

export function enemyLibraryActions(p: EnemyLibraryProjection): readonly ActionKey[] {
  if (p.formId === 'ENM-003') return ['ENM-003::CTA::001'];
  return [
    ...(p.activeTab === 'SENTIENT_ENEMIES' && p.selectedOrNull?.origin === 'SYSTEM_DEFAULT_SENTIENT'
      ? ['ENM-001::CTA::002' as const, 'ENM-001::CTA::004' as const]
      : []),
    'ENM-001::CTA::013',
    ...(p.activeTab === 'SENTIENT_ENEMIES' ? ['ENM-001::CTA::003' as const] : []),
    ...(p.activeTab === 'MONSTERS' ? ['ENM-001::CTA::011' as const] : []),
    ...(p.userSelectionOrNull != null
      ? ['ENM-001::CTA::007' as const, 'ENM-001::CTA::008' as const]
      : []),
  ];
}
