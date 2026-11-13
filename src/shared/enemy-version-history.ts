import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import { enemyVersionIdentityValue, type EnemyVersionIdentity } from './enemy-authoring.js';
import {
  enemyVersionDiffValue,
  enemyVersionDiffDataValue,
  enemyVersionConfigurationInputValue,
  type EnemyVersionDiffEntry,
  type EnemyVersionConfigurationInput,
} from './enemy-version-configuration.js';

export interface EnemyVersionConfigurationSummary {
  readonly commandId: string;
  readonly input: EnemyVersionConfigurationInput;
}
export function enemyVersionConfigurationSummaryValue(
  value: unknown,
): EnemyVersionConfigurationSummary {
  const row = r.exact(value, 'commandId input', '$.versionConfigurationSummary');
  r.uuid(row['commandId'], '$.configuration.commandId');
  enemyVersionConfigurationInputValue(row['input']);
  return w.validated(structuredClone(row));
}

export interface EnemyVersionHistory {
  readonly current: EnemyVersionIdentity;
  readonly selected: EnemyVersionIdentity;
  readonly entries: readonly Readonly<{
    identity: EnemyVersionIdentity;
    timestamp: string;
    reason: string | null;
    changeSet: readonly EnemyVersionDiffEntry[];
    configurationSummaryOrNull: EnemyVersionConfigurationSummary | null;
  }>[];
  /** There is no enemy combat-instance/pin producer in the supplied runtime. */
  readonly activeCombatPins: readonly never[];
}

export function enemyVersionHistoryValue(value: unknown): EnemyVersionHistory {
  enemyVersionDiffDataValue(value); // A historical identity must not execute an accessor during rendering.
  const row = r.exact(value, 'current selected entries activeCombatPins', '$.versionHistory');
  const current = enemyVersionIdentityValue(row['current']);
  const selected = enemyVersionIdentityValue(row['selected']);
  const entries = r.list(row['entries'], '$.versionHistory.entries');
  const versionIds = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    const entry = r.exact(
      raw,
      'identity timestamp reason changeSet configurationSummaryOrNull',
      '$.versionHistory.entry',
    );
    const identity = enemyVersionIdentityValue(entry['identity']);
    if (versionIds.has(identity.versionId))
      r.invalid('$.versionHistory.entries', 'distinct immutable version identities', null);
    versionIds.add(identity.versionId);
    if (
      identity.campaignId !== current.campaignId ||
      identity.templateId !== current.templateId ||
      identity.kind !== current.kind ||
      identity.version !== index + 1
    )
      r.invalid('$.versionHistory.entries', 'ordered complete own-template version chain', null);
    r.text(entry['timestamp'], '$.timestamp');
    const changeSet = enemyVersionDiffValue(entry['changeSet']);
    if (identity.version === 1) {
      w.literal(entry['reason'], null, '$.reason');
      if (changeSet.length !== 0 || entry['configurationSummaryOrNull'] !== null)
        r.invalid(
          '$.versionHistory.entry',
          'original V1 has no N+1 configuration or change set',
          null,
        );
    } else r.text(entry['reason'], '$.reason');
    if (
      entry['configurationSummaryOrNull'] !== null &&
      enemyVersionConfigurationSummaryValue(entry['configurationSummaryOrNull']).input.kind !==
        identity.kind
    )
      r.invalid('$.configurationSummaryOrNull', 'own version kind', null);
  }
  if (
    !admissionJsonEqual(
      entries.at(-1) === undefined ? null : r.record(entries.at(-1), '$.last')['identity'],
      current,
    ) ||
    !entries.some((entry) => admissionJsonEqual(r.record(entry, '$.entry')['identity'], selected))
  )
    r.invalid('$.versionHistory', 'actual current last and selected member identities', null);
  if (r.list(row['activeCombatPins'], '$.activeCombatPins').length !== 0)
    r.invalid('$.activeCombatPins', 'no enemy combat-instance producer is available', null);
  return w.validated(structuredClone(row));
}
