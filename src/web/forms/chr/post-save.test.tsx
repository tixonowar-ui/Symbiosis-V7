// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CommandReceipt, JsonObject } from '@shared/index.js';
import type { PostSaveCommandResult, PostSaveRequest } from '@shared/local-character-post-save.js';
import {
  createCreationFinalizationSetup,
  creationFinalSaveRequest,
  creationPropertySummaryRequest,
} from '../../../../tests/fixtures/creation-finalization-stage.js';
import { commitCreationFinalization } from '../../../host/creation-finalization.js';
import { currentCreationWizardRevisions } from '../../../host/creation-set-decide.js';
import {
  deriveLocalFinalExport,
  loadLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from '../../../host/local-character-export.js';
import {
  decodePostSaveProjection,
  decodePostSaveTerminal,
  expectedPostSaveActions,
  postSaveDestinationMatches,
  postSavePayload,
  RESTORE_FORMS,
} from './post-save.js';
import { creationFinalizationSnapshotMatchesReceipt } from './creation-validation.js';

const common = {
  postSaveScopeId: 'scope',
  sourceBindingHash: 'a'.repeat(64),
  sourceEntityId: 'character',
};
const version = { stateRevision: 12, projectionRevision: 15, actorVisibilityRevision: 2 };
const provenance = {
  registryVersion: '1.2',
  catalogVersion: '1.2',
  builtAgainstTuple: 'Rules v1.6',
  sourceUuid: common.sourceEntityId,
  sourceSnapshotId: 'final-receipt',
  metadataRevision: 0,
  sourceChecksum: 'b'.repeat(64),
  finalSaveReceiptId: 'final-receipt',
  finalSnapshotVersion: 20,
};
const owner = {
  ownerContext: 'PLAYER_LOCAL',
  sourceKind: 'LOCAL_FINAL',
  originFormId: 'CHR-040',
  returnFormId: 'CHR-040',
  activeLocalOwnerIdOrNull: 'device',
  masterAuthorityRevisionOrNull: null,
} as const;
const metadata = { name: 'Персонаж', description: null, artAssetKeyOrLocalFile: null } as const;
const restore = {
  ...common,
  checkpointOwnerId: common.sourceEntityId,
  checkpointEntityKind: 'CHARACTER_DRAFT',
  lastCompleteCheckpointId: 'checkpoint',
  checkpointRevision: 4,
  branchCacheHashOrNull: 'c'.repeat(64),
  randomReceiptIds: ['roll'],
  resumeFormId: 'CHR-010',
  restoreReceiptIdOrNull: null,
  corruptTailIgnored: false,
  restoreStatus: 'READY',
  commandId: 'latest',
} as const;
const exporting = {
  ...common,
  ...owner,
  sourceSnapshotId: 'final-receipt',
  sourceUuid: common.sourceEntityId,
  schemaVersion: 1,
  baselineVersion: 'sha256:baseline',
  checksum: 'd'.repeat(64),
  provenance,
  localMetadataRevision: 0,
  metadata,
  stateRevision: version.stateRevision,
  projectionRevision: version.projectionRevision,
} as const;
let baseline: LocalCharacterExportBaseline;
const setups: Awaited<ReturnType<typeof createCreationFinalizationSetup>>[] = [];
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
});
afterEach(() => {
  for (const p of setups.splice(0)) p.setup.database.close();
});

describe('strict post-save projections CHR-026/039/040 and APP-009/010', () => {
  it('keeps the exact source restore dispatch allowlist', async () => {
    const transitions = JSON.parse(
      await readFile('generated/spec/atlas/transitions.json', 'utf8'),
    ) as { from: string; kind: string; to: string }[];
    expect(RESTORE_FORMS).toEqual(
      transitions.filter((r) => r.from === 'APP-009' && r.kind === 'system-event').map((r) => r.to),
    );
  });
  it('requires one complete restore proof, and disables recovery for a damaged checkpoint', () => {
    expect(decodePostSaveProjection(restore, '$', 'APP-009', 'player', version).ok).toBe(true);
    const corrupt = {
      ...restore,
      lastCompleteCheckpointId: null,
      checkpointRevision: null,
      branchCacheHashOrNull: null,
      randomReceiptIds: [],
      resumeFormId: null,
      corruptTailIgnored: false,
      restoreStatus: 'CORRUPT',
      commandId: null,
    };
    const decoded = decodePostSaveProjection(corrupt, '$', 'APP-009', 'player', version);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('corrupt diagnostic refused');
    expect(
      expectedPostSaveActions('APP-009', decoded.value, ['UI-CMD-LOCAL-CHECKPOINT-RESTORE']),
    ).toEqual(['APP-009::CTA::002']);
    for (const patch of [
      { checkpointOwnerId: 'other' },
      { resumeFormId: 'CHR-040' },
      { checkpointRevision: null },
      { sourceRule: 'CORE-159' },
      { randomReceiptIds: ['roll', 'roll'] },
    ])
      expect(
        decodePostSaveProjection({ ...restore, ...patch }, '$', 'APP-009', 'player', version).ok,
      ).toBe(false);
    const saved = {
      ...common,
      characterDraftId: common.sourceEntityId,
      lastCompleteCheckpointId: 'checkpoint',
      lastCompleteCheckpointRevision: 4,
      resumeFormId: 'CHR-010',
      branchCacheHash: 'c'.repeat(64),
      randomReceiptIds: ['roll'],
      corruptTailIgnored: false,
      restoreStatus: 'READY',
      draftRevision: 10,
      commandId: 'latest',
    };
    expect(decodePostSaveProjection(saved, '$', 'CHR-026', 'player', version).ok).toBe(true);
    expect(decodePostSaveProjection(saved, '$', 'CHR-026', 'gm', version).ok).toBe(false);
  });
  it('binds the read-only cache to one selected entry and its exact safe return', () => {
    const cache = {
      ...common,
      characterDraftId: common.sourceEntityId,
      wizardCheckpointId: 'checkpoint',
      branchCacheEntries: [
        {
          branchUuid: 'branch',
          branchKind: 'RACE',
          payloadHash: 'e'.repeat(64),
          randomReceiptIds: ['roll'],
          savedAtRevision: 8,
        },
      ],
      selectedBranchUuidOrNull: 'branch',
      cacheIntegrityStatus: 'VALID',
      originFormId: 'CHR-025',
      returnFormId: 'CHR-025',
      draftRevision: 9,
      branchCacheHash: 'f'.repeat(64),
    };
    const decoded = decodePostSaveProjection(cache, '$', 'CHR-039', 'player', version);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('cache refused');
    expect(expectedPostSaveActions('CHR-039', decoded.value, [])).toEqual(['CHR-039::CTA::004']);
    for (const patch of [
      { selectedBranchUuidOrNull: 'foreign' },
      { returnFormId: 'CHR-017' },
      { branchCacheEntries: [...cache.branchCacheEntries, ...cache.branchCacheEntries] },
      {
        branchCacheEntries: [
          { ...cache.branchCacheEntries[0], privatePayload: { ruleId: 'CORE-151' } },
        ],
      },
    ])
      expect(
        decodePostSaveProjection({ ...cache, ...patch }, '$', 'CHR-039', 'player', version).ok,
      ).toBe(false);
  });
  it('keeps the two export contexts separate and excludes variant creation for GM', () => {
    const player = decodePostSaveProjection(exporting, '$', 'APP-010', 'player', version);
    expect(player.ok).toBe(true);
    const gm = {
      ...exporting,
      ownerContext: 'GM_ARCHIVE_EXPORT',
      sourceKind: 'COMPLETED_CAMPAIGN_COPY',
      originFormId: 'CMP-012',
      returnFormId: 'CMP-012',
      activeLocalOwnerIdOrNull: null,
      masterAuthorityRevisionOrNull: 7,
      sourceSnapshotId: `sha256:${provenance.sourceChecksum}`,
      provenance: { ...provenance, sourceSnapshotId: `sha256:${provenance.sourceChecksum}` },
    };
    const decoded = decodePostSaveProjection(gm, '$', 'APP-010', 'gm', version);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('GM export refused');
    expect(
      expectedPostSaveActions('APP-010', decoded.value, [
        'UI-CMD-CHAR-VARIANT-CREATE',
        'UI-CMD-CHAR-EXPORT',
      ]),
    ).toEqual(['APP-010::CTA::005']);
    expect(() => postSavePayload('APP-010', decoded.value, 'VARIANT_CREATE')).toThrow();
    for (const [payload, role] of [
      [gm, 'player'],
      [exporting, 'gm'],
      [{ ...gm, activeLocalOwnerIdOrNull: 'device' }, 'gm'],
      [{ ...exporting, masterAuthorityRevisionOrNull: 2 }, 'player'],
      [{ ...exporting, stateRevision: 1 }, 'player'],
    ] as const)
      expect(decodePostSaveProjection(payload, '$', 'APP-010', role, version).ok).toBe(false);
  });
  it.each(['FREE', 'PURE'] as const)(
    'decodes the real %s final mechanics and binds final-save receipt to CHR-040',
    async (raceChoice) => {
      const prepared = await createCreationFinalizationSetup({
        prefix: `post-save-${raceChoice}`,
        raceChoice,
        diceInputMode: 'MANUAL',
      });
      setups.push(prepared);
      let current = commitCreationFinalization(
        prepared.setup.database,
        creationPropertySummaryRequest(prepared.current, 'summary'),
        'summary-receipt',
        prepared.dependencies,
      );
      current = commitCreationFinalization(
        prepared.setup.database,
        creationFinalSaveRequest(current, 'save'),
        'save-receipt',
        prepared.dependencies,
      );
      const exported = deriveLocalFinalExport(current, metadata, 0, owner, baseline);
      const payload: JsonObject = {
        ...common,
        ...metadata,
        sourceEntityId: current.localCharacter.localCharacterId,
        localCharacterUuid: current.localCharacter.localCharacterId,
        finalSnapshotVersion: exported.finalSnapshotVersion,
        finalSaveReceiptId: exported.finalSaveReceiptId,
        mechanicsSnapshot: exported.mechanicsSnapshot,
        creationRandomReceipts: exported.creationRandomReceipts,
        localMetadataRevision: 0,
        candidateSnapshotIds: [],
        campaignCopyIds: [],
        checksum: exported.checksum,
        provenance: exported.provenance,
        commandId: current.receipt.commandId,
      };
      const revisions = currentCreationWizardRevisions(current);
      expect(decodePostSaveProjection(payload, '$', 'CHR-040', 'player', revisions)).toMatchObject({
        ok: true,
      });
      const snapshot = { formId: 'CHR-040', projection: payload, revisions, layers: [] };
      expect(creationFinalizationSnapshotMatchesReceipt(snapshot, current.receipt)).toBe(true);
      expect(
        creationFinalizationSnapshotMatchesReceipt(
          { ...snapshot, formId: 'CHR-025' },
          current.receipt,
        ),
      ).toBe(false);
      expect(
        creationFinalizationSnapshotMatchesReceipt(
          { ...snapshot, projection: { ...payload, finalSaveReceiptId: 'foreign' } },
          current.receipt,
        ),
      ).toBe(false);
      for (const patch of [
        { ...exported.mechanicsSnapshot, privateRule: 'CORE-159' },
        {
          ...exported.mechanicsSnapshot,
          runtime: { ...(exported.mechanicsSnapshot['runtime'] as JsonObject), hiddenItems: [] },
        },
        {
          ...exported.mechanicsSnapshot,
          skills: [
            { skillId: 'BAD', label: 'CORE-159', bonus: 1, slotCost: 1, source: 'SELECTED' },
          ],
        },
        {
          ...exported.mechanicsSnapshot,
          symbionts: [
            {
              ...(exported.mechanicsSnapshot['symbionts'] as JsonObject[])[0],
              learnedNodeRefs: ['SYM-026'],
            },
          ],
        },
      ])
        expect(
          decodePostSaveProjection(
            { ...payload, mechanicsSnapshot: patch },
            '$',
            'CHR-040',
            'player',
            revisions,
          ).ok,
        ).toBe(false);
      expect(JSON.stringify(payload)).not.toMatch(
        /CORE-\d|SYM-\d|learnedNodeRefs|sourceRule|masterPredicate/,
      );
    },
  );
});

describe('post-save terminal proof', () => {
  const request = (variant: 'RESTORE' | 'EXPORT'): PostSaveRequest =>
    ({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      commandId: 'command',
      workflowCommandId:
        variant === 'RESTORE' ? 'UI-CMD-LOCAL-CHECKPOINT-RESTORE' : 'UI-CMD-CHAR-EXPORT',
      role: 'player',
      expectedRevisions: version,
      payload: {
        ...common,
        stage: 'LOCAL_CHARACTER_POST_SAVE',
        variant,
        sourceFormId: variant === 'RESTORE' ? 'APP-009' : 'APP-010',
        expectedMetadataRevisionOrNull: variant === 'RESTORE' ? null : 0,
      },
    }) as PostSaveRequest;
  const receipt = (): CommandReceipt<PostSaveCommandResult> => ({
    commandId: 'command',
    receiptId: 'restore-receipt',
    revisions: version,
    result: {
      ...common,
      stage: 'LOCAL_CHARACTER_POST_SAVE',
      variant: 'RESTORE',
      sourceFormId: 'APP-009',
      sourceRevisions: version,
      nextFormId: 'CHR-010',
      targetEntityId: common.sourceEntityId,
      targetRevisions: { stateRevision: 2, projectionRevision: 3, actorVisibilityRevision: 0 },
      localMetadataRevision: null,
      createdVariantUuidOrNull: null,
      downloadOrNull: null,
      restoredCheckpointOrNull: {
        ownerId: common.sourceEntityId,
        ownerDeviceId: 'device',
        corruptTailIgnored: true,
        restoreStatus: 'CORRUPT',
        checkpointId: 'checkpoint',
        checkpointRevision: 4,
        checkpointSha256: 'a'.repeat(64),
        layerFormIds: [],
        resumeFormId: 'CHR-010',
      },
    },
  });
  it('accepts lower target revisions only with the complete correlated restore proof', () => {
    const r = receipt();
    const terminal = {
      messageType: 'command.result',
      protocolVersion: 1,
      lifecycleState: 'COMMITTED',
      receipt: r,
    } as const;
    expect(decodePostSaveTerminal(terminal, request('RESTORE'), restore).ok).toBe(true);
    const target = {
      formId: 'CHR-010',
      projection: { characterDraftId: common.sourceEntityId, wizardCheckpointId: 'checkpoint' },
      revisions: r.result.targetRevisions,
      layers: [],
    };
    expect(postSaveDestinationMatches(target, r)).toBe(true);
    expect(postSaveDestinationMatches({ ...target, revisions: version }, r)).toBe(false);
    expect(
      postSaveDestinationMatches(
        { ...target, projection: { ...target.projection, wizardCheckpointId: 'other' } },
        r,
      ),
    ).toBe(false);
    for (const changed of [
      { ...r, commandId: 'foreign' },
      { ...r, revisions: r.result.targetRevisions },
      { ...r, result: { ...r.result, sourceBindingHash: 'b'.repeat(64) } },
      {
        ...r,
        result: {
          ...r.result,
          restoredCheckpointOrNull: { ...r.result.restoredCheckpointOrNull!, ownerId: 'foreign' },
        },
      },
    ])
      expect(
        decodePostSaveTerminal({ ...terminal, receipt: changed }, request('RESTORE'), restore).ok,
      ).toBe(false);
  });
  it('restores the saved CHR-031 dialog only when its exact layer is signed by the restore receipt', () => {
    const base = receipt();
    const r: CommandReceipt<PostSaveCommandResult> = {
      ...base,
      result: {
        ...base.result,
        nextFormId: 'CHR-023',
        restoredCheckpointOrNull: {
          ...base.result.restoredCheckpointOrNull!,
          resumeFormId: 'CHR-023',
          layerFormIds: ['CHR-031'],
        },
      },
    };
    expect(
      decodePostSaveTerminal(
        {
          messageType: 'command.result',
          protocolVersion: 1,
          lifecycleState: 'COMMITTED',
          receipt: r,
        },
        request('RESTORE'),
        { ...restore, resumeFormId: 'CHR-023' },
      ).ok,
    ).toBe(true);
    const projection = {
      characterDraftId: common.sourceEntityId,
      wizardCheckpointId: 'checkpoint',
      requestId: 'weapon-request',
      draftRevision: 18,
    };
    const target = {
      formId: 'CHR-023',
      projection,
      revisions: r.result.targetRevisions,
      layers: [
        {
          formId: 'CHR-031',
          projection: {
            characterDraftId: common.sourceEntityId,
            requestId: 'weapon-request',
            draftRevision: 18,
          },
        },
      ],
    };
    expect(postSaveDestinationMatches(target, r)).toBe(true);
    expect(postSaveDestinationMatches({ ...target, layers: [] }, r)).toBe(false);
    expect(
      postSaveDestinationMatches(
        { ...target, layers: [{ ...target.layers[0]!, formId: 'CHR-028' }] },
        r,
      ),
    ).toBe(false);
    expect(
      postSaveDestinationMatches(
        {
          ...target,
          layers: [
            {
              ...target.layers[0]!,
              projection: { ...target.layers[0]!.projection, requestId: 'other' },
            },
          ],
        },
        r,
      ),
    ).toBe(false);
  });
});
