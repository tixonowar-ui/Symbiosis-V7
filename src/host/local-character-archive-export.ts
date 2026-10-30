import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { JsonObject, CommandReceipt } from '@shared/wire-protocol.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type {
  PostSaveRequest,
  PostSaveCommandResult,
  PostSaveMetadata,
} from '@shared/local-character-post-save.js';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import {
  readArchivedCampaignCharacterSource,
  loadDeviceId,
  createPostSaveHead,
  commitPostSaveCommand,
  readPostSaveHeadById,
  type PostSaveHead,
  type PostSaveScope,
} from '../persistence/index.js';
import { canonicalizeIdentityDraftValues } from './identity-draft.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';

export interface ArchivedCharacterExportAuthority {
  readonly campaignId: string;
  readonly campaignCharacterId: string;
  readonly masterAuthorityRevision: number;
}
export interface ArchivedCharacterExportDependencies {
  readonly database: Database.Database;
  readonly baseline: LocalCharacterExportBaseline;
  /** Supplied by the host's sole-GM authority service, never by a client request or route. */
  readonly readAuthority: () => ArchivedCharacterExportAuthority | null;
}
const fail = (message: string): never => {
  throw new Error(`archived character export: ${message}`);
};
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const object = (v: unknown): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
type Check = (v: unknown) => boolean;
const exact = (v: unknown, fields: Readonly<Record<string, Check>>): v is JsonObject =>
  object(v) &&
  isDeepStrictEqual(Object.keys(v).sort(), Object.keys(fields).sort()) &&
  Object.entries(fields).every(([k, check]) => check(v[k]));
const rows = (v: unknown, check: Check): v is readonly JsonObject[] =>
  Array.isArray(v) && v.every(check);
const one =
  (...values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const face: Check = (v) => integer(v) && v >= 1 && v <= 20;
const publicText: Check = (v) =>
  text(v) &&
  !/\b(?:CORE|SYM|MON|AQ\d?|AQA|CQA|Q[A-Z0-9]*|USR|OP|REQ|F-WPN|CVD|RG|SKL)-[A-Z0-9-]+\b|Источник|(?:action)?availabilityTrace|masterPredicate/iu.test(
    v,
  );
const statCodes = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const stats: Check = (v) => exact(v, Object.fromEntries(statCodes.map((k) => [k, finite])));
const owned = one('OWNED_NOT_EQUIPPED');
const quality: Check = (v) =>
  exact(v, {
    kind: one(
      'MISSING_OR_UNFIT',
      'POOR',
      'ORDINARY',
      'GOOD',
      'EXCEPTIONAL',
      'RARE',
      'NONE',
      'SMALL',
      'LARGE',
      'RARE_FORTUNE',
    ),
    label: publicText,
    range: publicText,
    rawFace: face,
  });
const binding: Check = (v) =>
  exact(v, {
    kind: one('NONE', 'TICK_RIGHT_HAND', 'SPIDER_BOTH_WRISTS', 'MANTIS_BOTH_FOREARMS'),
  }) || exact(v, { kind: one('OWL_EYE', 'EEL_ARM'), side: one('LEFT', 'RIGHT') });
const empty: Check = (v) => Array.isArray(v) && v.length === 0;
const runtime: Check = (v) =>
  exact(v, {
    maxHp: finite,
    currentHp: finite,
    alive: one(true),
    conscious: one(true),
    ...Object.fromEntries(
      ['stunned', 'bound', 'burning', 'poisoned', 'diseased'].map((k) => [k, one(false)]),
    ),
    ...Object.fromEntries(
      [
        'wounds',
        'injuries',
        'bleeding',
        'temporaryEffects',
        'cooldowns',
        'preparations',
        'combatUsageLimits',
        'equippedItems',
        'generatedObjects',
        'externalEntities',
        'chimeraDevouringHistory',
      ].map((k) => [k, empty]),
    ),
    initiativeOrNull: one(null),
    combatSceneIdOrNull: one(null),
    statProgressionCounters: (s) => exact(s, Object.fromEntries(statCodes.map((k) => [k, one(0)]))),
    symbiontXpProgressPoints: one(0),
    unallocatedSymbiontXp: one(0),
    chimeraExtraSlots: one(0),
    taipanPoisonOrNull: one(null, 'DEADLY'),
    penguinMiMiMiActive: bool,
    ratInsideHost: bool,
    keeperInsideHost: bool,
    mantisBladeStateOrNull: one(null, 'ORDINARY'),
  });
const property: Check = (v) => {
  if (
    !exact(v, {
      armorBundle: (a) =>
        exact(a, {
          armorBundleId: text,
          armorPieces: (pieces) =>
            rows(pieces, (p) =>
              exact(p, {
                itemId: text,
                name: publicText,
                coverageModel: publicText,
                bodyZone: nullable(text),
              }),
            ),
          distinctBodyZones: (z) => rows(z, text),
          qualityRecommendation: quality,
          ownershipState: owned,
        }),
      weapon: (w) =>
        exact(w, {
          weaponTypeId: text,
          weaponVariant: text,
          name: publicText,
          qualityRecommendation: quality,
          profileFacts: (f) =>
            rows(f, (p) =>
              exact(p, { label: publicText, value: (x) => finite(x) || bool(x) || publicText(x) }),
            ),
          profileStatus: one('SUBMITTED', 'ACKNOWLEDGED'),
          ownershipState: owned,
        }),
      moneyRecommendation: (m) =>
        exact(m, { wealthRecommendation: quality, gmFinalizationRequired: one(true) }),
      fivePositions: (p) =>
        Array.isArray(p) &&
        p.length === 5 &&
        p.every((r: unknown) =>
          exact(r, {
            positionId: text,
            qualityRollRequestId: text,
            itemTypeIdOrStoryType: text,
            quantity: (n) => integer(n) && n > 0,
            storyDescriptionOrNull: nullable(text),
            name: publicText,
            kind: one('CATALOGUE', 'STORY'),
            qualityRollReceiptId: text,
            qualityRollFaceOrNull: face,
            qualityRecommendation: quality,
            ownershipState: owned,
          }),
        ),
      propertyRollReceipts: (r) =>
        Array.isArray(r) &&
        r.length === 8 &&
        r.every((x: unknown) =>
          exact(x, {
            block: one('ARMOR_BUNDLE', 'WEAPON', 'MONEY', 'POSITION'),
            positionIdOrNull: nullable(text),
            rollRequestId: text,
            rollReceiptId: text,
            rawFace: face,
          }),
        ),
      exactOperationCount: one(8),
      ownershipStateAll: owned,
    })
  )
    return false;
  const positions = v['fivePositions'] as readonly JsonObject[];
  const refs = v['propertyRollReceipts'] as readonly JsonObject[];
  return (
    new Set(positions.map((p) => p['positionId'])).size === 5 &&
    positions.filter((p) => p['kind'] === 'STORY').length <= 1 &&
    new Set(refs.map((r) => r['rollReceiptId'])).size === 8 &&
    new Set(refs.map((r) => r['rollRequestId'])).size === 8 &&
    refs.every(
      (r, i) =>
        r['block'] === (['ARMOR_BUNDLE', 'WEAPON', 'MONEY'][i] ?? 'POSITION') &&
        (i < 3
          ? r['positionIdOrNull'] === null
          : r['positionIdOrNull'] === positions[i - 3]!['positionId'] &&
            r['rollReceiptId'] === positions[i - 3]!['qualityRollReceiptId'] &&
            r['rollRequestId'] === positions[i - 3]!['qualityRollRequestId'] &&
            r['rawFace'] === positions[i - 3]!['qualityRollFaceOrNull']),
    )
  );
};
const receiptKinds = [
  'STAT_SET',
  'STAT_CRITICAL_CONFIRMATION',
  'SPECIES_ORIGIN',
  'CRITICAL_CONFIRMATION',
  'ADVISOR_I',
  'ADVISOR_W',
  'TROGR_SUPPRESSION_B',
  'ARMOR_BUNDLE_QUALITY',
  'STARTING_WEAPON_QUALITY',
  'STARTING_MONEY',
  'FIVE_STARTING_POSITION_QUALITY',
];
const creationReceipt: Check = (r) =>
  exact(r, {
    kind: one(...receiptKinds),
    rollRequestId: text,
    rollReceiptId: text,
    diceInputMode: one('AUTO', 'MANUAL'),
    dieSides: one(20),
    faces: (f) =>
      Array.isArray(f) &&
      f.length === (object(r) && r['kind'] === 'STAT_SET' ? 7 : 1) &&
      f.every(face),
  });

/** This is an explicit export-fixture schema, never an interpreter for arbitrary campaign JSON. */
export function validateArchivedLocalExportDocument(
  value: unknown,
  currentBaseline: LocalCharacterExportBaseline,
): JsonObject {
  canonicalPostSaveJson(value);
  if (!object(value) || !text(value['baselineVersion'])) return fail('missing baseline version');
  const baseline = resolveStoredLocalCharacterExportBaseline(
    currentBaseline,
    value['baselineVersion'],
  );
  const skill: Check = (s) =>
    exact(s, {
      skillId: text,
      label: publicText,
      bonus: finite,
      slotCost: integer,
      source: one('SELECTED', 'RACE_GRANTED', 'CLASS_MANDATORY', 'SYMBIONT_PERMANENT'),
    }) &&
    baseline.skillCatalog.skillLabels.some(
      (label) => label.skillId === s['skillId'] && label.skillLabel === s['label'],
    );
  const mechanics: Check = (m) =>
    exact(m, {
      identity: (i) =>
        exact(i, { age: integer, sex: one('MALE', 'FEMALE'), massKg: (n) => finite(n) && n > 0 }),
      race: (r) =>
        exact(r, { code: one('FREE', 'PURE', 'UNITED'), label: publicText }) &&
        baseline.catalog.symbionts.races.some(
          (race) => race.raceCode === r['code'] && race.raceLabel === r['label'],
        ),
      classOrNull: (c) =>
        c === null ||
        (exact(c, { code: text, label: publicText }) &&
          baseline.classLabels.get(c['code'] as string) === c['label']),
      creationMode: one(null, 'MANUAL', 'RANDOM'),
      skillStageStats: stats,
      effectiveStats: stats,
      statProof: (proof) =>
        Array.isArray(proof) &&
        proof.length === 7 &&
        proof.every((p: unknown, i: number) =>
          exact(p, {
            statCode: one(statCodes[i]),
            skillStageValue: finite,
            positiveSymbiontDelta: finite,
            negativeSymbiontDelta: finite,
            appliedNegativeDelta: finite,
            beforeLimits: finite,
            minimumOrNull: nullable(finite),
            maximumOrNull: nullable(finite),
            effectiveValue: finite,
          }),
        ),
      skills: (s) => rows(s, skill),
      symbionts: (s) =>
        rows(
          s,
          (item) =>
            exact(item, {
              acceptedIndex: integer,
              speciesKey: text,
              label: publicText,
              status: one('ACTIVE', 'SUPPRESSED', 'ABSORBED', 'DESTROYED'),
              level: integer,
              maxOe: finite,
              currentOe: finite,
              xp: one(0),
              effectsEnabled: bool,
              xpEligible: bool,
              binding,
              learnedNodes: (nodes) =>
                rows(
                  nodes,
                  (node) =>
                    exact(node, { label: publicText, level: integer }) &&
                    baseline.catalog.initialNodes.some(
                      (n) =>
                        object(item) &&
                        n.speciesKey === item['speciesKey'] &&
                        n.label === node['label'] &&
                        n.level === node['level'],
                    ),
                ),
            }) &&
            baseline.catalog.symbionts.species.some(
              (species) =>
                species.speciesKey === item['speciesKey'] && species.speciesLabel === item['label'],
            ),
        ),
      advisorOrNull: (a) =>
        a === null ||
        exact(a, {
          intelligence: finite,
          wisdom: finite,
          suppressionBonusOrNull: nullable(finite),
          skills: (s) => rows(s, skill),
        }),
      permanentGrants: (g) =>
        rows(g, (r) =>
          exact(r, { kind: one('TROGR_GROSS'), bonusBefore: integer, bonusAfter: integer }),
        ),
      trainingSlotLedger: (l) => exact(l, { maxPermanentWisdom: finite, everIssued: integer }),
      property,
      runtime,
      manufacturingReceipts: (r) =>
        rows(
          r,
          (entry) =>
            exact(entry, {
              receiptId: text,
              requestId: text,
              submitCommandId: text,
              variable: publicText,
              dieSides: (n) => integer(n) && n > 0,
              value: (n) => integer(n) && n > 0,
              provenance: one('PLAYER_WITNESS'),
            }) && (entry['value'] as number) <= (entry['dieSides'] as number),
        ),
    });
  if (
    !exact(value, {
      format: one('SYMBIOSIS_CHARACTER_EXPORT'),
      schemaVersion: one(1),
      baselineVersion: one(baseline.baselineVersion),
      sourceUuid: text,
      sourceSnapshotId: text,
      sourceKind: one('LOCAL_FINAL'),
      ownerContext: one('PLAYER_LOCAL'),
      metadataRevision: integer,
      metadata: (m) =>
        exact(m, {
          name: text,
          description: nullable(text),
          artAssetKeyOrLocalFile: (art) =>
            art === null ||
            exact(art, {
              kind: one('asset-key'),
              assetKey: (key) =>
                text(key) &&
                (LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS as readonly string[]).includes(key),
            }) ||
            exact(art, {
              kind: one('local-file'),
              mediaType: one('image/png', 'image/jpeg'),
              bytesBase64: text,
            }),
        }),
      mechanicsSnapshot: mechanics,
      creationRandomReceipts: (r) => rows(r, creationReceipt),
      provenance: (p) =>
        exact(p, {
          registryVersion: one(baseline.registryVersion),
          catalogVersion: one(baseline.catalogVersion),
          builtAgainstTuple: one(baseline.builtAgainstTuple),
          sourceUuid: text,
          sourceSnapshotId: text,
          metadataRevision: integer,
          sourceChecksum: hash,
          finalSaveReceiptId: text,
          finalSnapshotVersion: integer,
        }),
      checksum: hash,
    })
  )
    return fail('unrecognized completed export document schema');
  const { checksum, ...body } = value;
  if (checksum !== postSaveSha256(canonicalPostSaveJson(body)))
    return fail('completed export checksum differs');
  const p = value['provenance'] as JsonObject;
  if (
    p['sourceUuid'] !== value['sourceUuid'] ||
    p['sourceSnapshotId'] !== value['sourceSnapshotId'] ||
    p['finalSaveReceiptId'] !== value['sourceSnapshotId'] ||
    p['metadataRevision'] !== value['metadataRevision']
  )
    return fail('completed export provenance differs');
  const metadata = value['metadata'] as unknown as PostSaveMetadata;
  const canonical = canonicalizeIdentityDraftValues(
    { ...metadata, age: null, sex: null, massKg: null },
    new Set(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS),
  );
  if (
    !canonical.ok ||
    !isDeepStrictEqual(metadata, {
      name: canonical.value.name,
      description: canonical.value.description,
      artAssetKeyOrLocalFile: canonical.value.artAssetKeyOrLocalFile,
    })
  )
    return fail('invalid completed metadata');
  const receipts = value['creationRandomReceipts'] as readonly JsonObject[];
  if (
    new Set(receipts.map((r) => r['rollReceiptId'])).size !== receipts.length ||
    new Set(receipts.map((r) => r['rollRequestId'])).size !== receipts.length
  )
    return fail('duplicate completed physical receipt');
  const refs = ((value['mechanicsSnapshot'] as JsonObject)['property'] as JsonObject)[
    'propertyRollReceipts'
  ] as readonly JsonObject[];
  for (const ref of refs)
    if (
      !receipts.some(
        (r) =>
          r['rollReceiptId'] === ref['rollReceiptId'] &&
          r['rollRequestId'] === ref['rollRequestId'] &&
          (r['faces'] as readonly number[])[0] === ref['rawFace'],
      )
    )
      return fail('completed property receipt differs');
  return structuredClone(value);
}

const revisions = (head: PostSaveHead) => ({
  stateRevision: head.stateRevision,
  projectionRevision: head.projectionRevision,
  actorVisibilityRevision: head.actorVisibilityRevision,
});
const bindingHash = (binding: JsonObject): string => postSaveSha256(JSON.stringify(binding));
const common = (head: PostSaveHead) => ({
  postSaveScopeId: head.scope.scopeId,
  sourceBindingHash: bindingHash(head.scope.sourceBinding),
  sourceEntityId: head.scope.entityId,
});
const scopeUuid = (binding: JsonObject): string => {
  const bytes = createHash('sha256')
    .update(canonicalPostSaveJson(['SYMBIOSIS_ARCHIVE_EXPORT_SCOPE_V1', binding]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 128;
  bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
function source(d: ArchivedCharacterExportDependencies) {
  const authority = d.readAuthority();
  if (
    !exact(authority, {
      campaignId: text,
      campaignCharacterId: text,
      masterAuthorityRevision: integer,
    })
  )
    return fail('no current sole-GM archive authority');
  const trusted = authority as unknown as ArchivedCharacterExportAuthority;
  const stored = readArchivedCampaignCharacterSource(
    d.database,
    trusted.campaignId,
    trusted.campaignCharacterId,
  );
  const marker = JSON.parse(stored.payloadJson) as unknown;
  if (
    !exact(marker, {
      kind: one('COMPLETED_CHARACTER_EXPORT_SNAPSHOT'),
      schemaVersion: one(1),
      exportDocument: object,
    })
  )
    return fail('unrecognized archived copy payload');
  const document = validateArchivedLocalExportDocument(marker['exportDocument'], d.baseline);
  if (document['sourceUuid'] !== stored.sourceUuid)
    return fail('copy source UUID differs from export provenance');
  const snapshotSha256 = postSaveSha256(stored.checkpoint.snapshotJson);
  const ownerDeviceId = loadDeviceId(d.database);
  const metadataRevision = document['metadataRevision'] as number;
  const sourceBinding: JsonObject = {
    kind: 'COMPLETED_CAMPAIGN_COPY',
    ownerDeviceId,
    campaignId: trusted.campaignId,
    campaignCharacterId: trusted.campaignCharacterId,
    masterAuthorityRevision: trusted.masterAuthorityRevision,
    snapshotSha256,
    sourceUuid: stored.sourceUuid,
    copyPayloadSha256: postSaveSha256(stored.payloadJson),
    metadataRevision,
    originFormId: 'CMP-012',
    returnFormId: 'CMP-012',
  };
  const scope: PostSaveScope = {
    scopeId: scopeUuid(sourceBinding),
    entityKind: 'COMPLETED_CAMPAIGN_COPY',
    entityId: trusted.campaignCharacterId,
    ownerContext: 'GM_ARCHIVE_EXPORT',
    ownerDeviceId,
    baseSnapshotSha256: snapshotSha256,
    baseRevisions: {
      stateRevision: stored.checkpoint.stateRevision,
      projectionRevision: stored.checkpoint.projectionRevision,
      actorVisibilityRevision: stored.checkpoint.actorVisibilityRevision,
    },
    sourceBinding,
  };
  const sourceSnapshotId = `sha256:${snapshotSha256}`;
  const provenance: JsonObject = {
    ...(document['provenance'] as JsonObject),
    sourceUuid: trusted.campaignCharacterId,
    sourceSnapshotId,
    sourceChecksum: snapshotSha256,
  };
  const { checksum: _checksum, ...original } = document;
  const rebound = {
    ...original,
    sourceUuid: trusted.campaignCharacterId,
    sourceSnapshotId,
    sourceKind: 'COMPLETED_CAMPAIGN_COPY',
    ownerContext: 'GM_ARCHIVE_EXPORT',
    provenance,
  };
  const checksum = postSaveSha256(canonicalPostSaveJson(rebound));
  const contentText = `${canonicalPostSaveJson({ ...rebound, checksum })}\n`;
  return {
    scope,
    authority: trusted,
    document,
    metadataRevision,
    sourceSnapshotId,
    checksum,
    provenance,
    contentText,
    bytesSha256: postSaveSha256(contentText),
  };
}
function validatedSource(d: ArchivedCharacterExportDependencies, head: PostSaveHead) {
  const current = source(d);
  if (
    !isDeepStrictEqual(current.scope, head.scope) ||
    head.metadataRevision !== current.metadataRevision ||
    !isDeepStrictEqual(head.presentation, { formId: 'APP-010' })
  )
    return fail('archive scope or authority is stale');
  return current;
}
export function createArchivedCharacterExportContext(
  d: ArchivedCharacterExportDependencies,
): PostSaveHead {
  const current = source(d);
  return createPostSaveHead(
    d.database,
    current.scope,
    { formId: 'APP-010' },
    () => {
      if (!isDeepStrictEqual(source(d).scope, current.scope)) fail('archive changed while opening');
    },
    { initialMetadataRevision: current.metadataRevision },
  );
}
export function projectArchivedCharacterExport(
  d: ArchivedCharacterExportDependencies,
  head: PostSaveHead,
): PresentedBaseForm {
  const current = validatedSource(d, head);
  return {
    formId: 'APP-010',
    formType: 'screen',
    routeTemplate: '/local/app-010',
    routeBindings: [],
    availableActionKeys: ['APP-010::CTA::005'],
    roleFilteredPayload: {
      ...common(head),
      ownerContext: 'GM_ARCHIVE_EXPORT',
      sourceKind: 'COMPLETED_CAMPAIGN_COPY',
      originFormId: 'CMP-012',
      returnFormId: 'CMP-012',
      activeLocalOwnerIdOrNull: null,
      masterAuthorityRevisionOrNull: current.authority.masterAuthorityRevision,
      sourceSnapshotId: current.sourceSnapshotId,
      sourceUuid: head.scope.entityId,
      schemaVersion: 1,
      baselineVersion: current.document['baselineVersion']!,
      checksum: current.checksum,
      provenance: current.provenance,
      localMetadataRevision: current.metadataRevision,
      metadata: current.document['metadata']!,
      stateRevision: head.stateRevision,
      projectionRevision: head.projectionRevision,
    },
  };
}
export function commitArchivedCharacterExport(
  d: ArchivedCharacterExportDependencies,
  request: PostSaveRequest,
  receiptId: string,
) {
  if (
    !exact(request, {
      messageType: one('command.request'),
      protocolVersion: one(1),
      commandKind: one('workflow-command'),
      workflowCommandId: one('UI-CMD-CHAR-EXPORT'),
      commandId: text,
      role: one('gm'),
      expectedRevisions: (r) =>
        exact(r, {
          stateRevision: integer,
          projectionRevision: integer,
          actorVisibilityRevision: integer,
        }),
      payload: (p) =>
        exact(p, {
          stage: one('LOCAL_CHARACTER_POST_SAVE'),
          variant: one('EXPORT'),
          sourceFormId: one('APP-010'),
          postSaveScopeId: text,
          sourceBindingHash: hash,
          sourceEntityId: text,
          expectedMetadataRevisionOrNull: integer,
        }),
    })
  )
    return fail('only the addressed GM export command is allowed');
  const p = request.payload;
  const head = readPostSaveHeadById(d.database, p.postSaveScopeId, loadDeviceId(d.database));
  if (
    head === null ||
    p.sourceBindingHash !== common(head).sourceBindingHash ||
    p.sourceEntityId !== head.scope.entityId
  )
    return fail('unknown or foreign archive export scope');
  return commitPostSaveCommand(
    d.database,
    {
      scope: head.scope,
      expectedRevisions: request.expectedRevisions,
      commandId: request.commandId,
      receiptId,
      commandKind: 'UI-CMD-CHAR-EXPORT',
      request,
      impact: { stateChanged: false, projectionChanged: false, actorVisibilityChanged: false },
    },
    () => {
      validatedSource(d, head);
    },
    (_writer, next) => {
      const current = validatedSource(d, head);
      if (p.expectedMetadataRevisionOrNull !== current.metadataRevision)
        return fail('archive metadata revision differs');
      const occupied = new Set([
        head.scope.entityId,
        current.authority.campaignId,
        current.document['sourceUuid'],
        current.document['sourceSnapshotId'],
        ...(current.document['creationRandomReceipts'] as readonly JsonObject[]).flatMap((r) => [
          r['rollRequestId'],
          r['rollReceiptId'],
        ]),
      ]);
      if (occupied.has(request.commandId) || occupied.has(receiptId))
        return fail('export ID belongs to the source');
      const result: PostSaveCommandResult = {
        ...common(head),
        stage: 'LOCAL_CHARACTER_POST_SAVE',
        variant: 'EXPORT',
        sourceFormId: 'APP-010',
        sourceRevisions: { ...request.expectedRevisions },
        nextFormId: 'APP-010',
        targetEntityId: head.scope.entityId,
        targetRevisions: { ...revisions(next) },
        localMetadataRevision: current.metadataRevision,
        createdVariantUuidOrNull: null,
        restoredCheckpointOrNull: null,
        downloadOrNull: {
          fileName: `character-${head.scope.entityId}.json`,
          mediaType: 'application/json',
          contentText: current.contentText,
          bytesSha256: current.bytesSha256,
        },
      };
      const receipt: CommandReceipt<PostSaveCommandResult> = {
        commandId: request.commandId,
        receiptId,
        revisions: revisions(next),
        result,
      };
      return receipt as unknown as JsonObject;
    },
  );
}
