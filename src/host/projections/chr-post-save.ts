export const CHR_026_FORM_ID = 'CHR-026' as const;
export const CHR_026_ROUTE = '/player/characters/:localCharacterId/create/chr-026' as const;
export const CHR_026_REQUIRED_FIELDS = [
  'characterDraftId',
  'lastCompleteCheckpointId',
  'lastCompleteCheckpointRevision',
  'resumeFormId(server-signed; allowlisted wizard form)',
  'branchCacheHash',
  'randomReceiptIds[]',
  'corruptTailIgnored',
  'restoreStatus=READY|RESTORED|CORRUPT',
  'draftRevision',
  'commandId',
] as const;

export const CHR_039_FORM_ID = 'CHR-039' as const;
export const CHR_039_ROUTE = '/player/characters/:localCharacterId/create/chr-039' as const;
export const CHR_039_REQUIRED_FIELDS = [
  'characterDraftId',
  'wizardCheckpointId',
  'branchCacheEntries[]=(branchUuid,branchKind,payloadHash,randomReceiptIds[],savedAtRevision)',
  'selectedBranchUuidOrNull',
  'cacheIntegrityStatus',
  'originFormId',
  'returnFormId(server-signed)=CHR-017|CHR-019|CHR-025|CHR-032',
  'draftRevision',
] as const;

export const CHR_040_FORM_ID = 'CHR-040' as const;
export const CHR_040_ROUTE = '/player/characters/:localCharacterId/create/chr-040' as const;
export const CHR_040_REQUIRED_FIELDS = [
  'localCharacterUuid',
  'finalSnapshotVersion',
  'finalSaveReceiptId',
  'mechanicsSnapshot(read-only)',
  'creationRandomReceipts(read-only)',
  'name',
  'description',
  'artAssetKeyOrLocalFile',
  'localMetadataRevision',
  'candidateSnapshotIds[]',
  'campaignCopyIds[]',
  'checksum',
  'provenance',
  'commandId',
] as const;

export const APP_009_FORM_ID = 'APP-009' as const;
export const APP_009_ROUTE = '/local/app-009' as const;
export const APP_009_REQUIRED_FIELDS = [
  'checkpointOwnerId',
  'checkpointEntityKind=CHARACTER_DRAFT|CAMPAIGN|LOCAL_OPERATION',
  'lastCompleteCheckpointId',
  'checkpointRevision',
  'branchCacheHashOrNull',
  'randomReceiptIds[]',
  'resumeFormId(server-signed)',
  'restoreReceiptIdOrNull',
  'corruptTailIgnored',
  'restoreStatus=READY|RESTORED|CORRUPT',
  'commandId',
] as const;

export const APP_010_FORM_ID = 'APP-010' as const;
export const APP_010_ROUTE = '/local/app-010' as const;
export const APP_010_REQUIRED_FIELDS = [
  'sourceSnapshotId',
  'ownerContext=PLAYER_LOCAL|GM_ARCHIVE_EXPORT',
  'sourceKind=LOCAL_FINAL|COMPLETED_CAMPAIGN_COPY',
  'originFormId(server-signed)=APP-004|CHR-040|CMP-012',
  'returnFormId(server-signed)=APP-004|CHR-040|CMP-012',
  'activeLocalOwnerIdOrNull',
  'masterAuthorityRevisionOrNull',
  'sourceUuid',
  'schemaVersion',
  'baselineVersion',
  'checksum',
  'provenance',
  'stateRevision',
  'projectionRevision',
] as const;

/** Literal field annotations are source contracts, not shorthand DTO property names. */
export function assertPostSaveScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    fields: readonly string[],
    route: string,
    type?: 'screen' | 'dialog',
    roles?: readonly ('player' | 'gm')[],
  ) => void,
): void {
  for (const [formId, route, fields, title] of [
    [CHR_026_FORM_ID, CHR_026_ROUTE, CHR_026_REQUIRED_FIELDS, 'Сохранённый черновик персонажа'],
    [CHR_039_FORM_ID, CHR_039_ROUTE, CHR_039_REQUIRED_FIELDS, 'Неизменяемый кэш веток wizard'],
    [
      CHR_040_FORM_ID,
      CHR_040_ROUTE,
      CHR_040_REQUIRED_FIELDS,
      'Финально сохранённый локальный лист',
    ],
    [
      APP_009_FORM_ID,
      APP_009_ROUTE,
      APP_009_REQUIRED_FIELDS,
      'Восстановление локальной работы после сбоя',
    ],
    [
      APP_010_FORM_ID,
      APP_010_ROUTE,
      APP_010_REQUIRED_FIELDS,
      'После сохранения: вариант и экспорт',
    ],
  ] as const) {
    assert(
      forms,
      formId,
      fields,
      route,
      'screen',
      formId.startsWith('APP-') ? ['player', 'gm'] : ['player'],
    );
    if ((forms[formId] as { readonly title?: unknown } | undefined)?.title !== title)
      throw new Error(`${formId} title differs from the post-save contract`);
  }
}
