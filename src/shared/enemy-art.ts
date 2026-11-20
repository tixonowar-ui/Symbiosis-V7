import type { CampaignArtValue } from './campaign-creation.js';
import { LOCAL_IMAGE_MAX_BYTES, localImageMediaType } from './local-image.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { CUSTOM_MONSTER_PLACEHOLDER, CUSTOM_MONSTER_PLACEHOLDER_SHA256 } from './custom-monster.js';
import { wireCodecPrimitives as w } from './wire-codec.js';

export const ENEMY_PLACEHOLDER = 'symbiosis_placeholder_sentient_enemy';
export const ENEMY_PLACEHOLDER_SHA256 =
  '5da7ee70db7c47dabfa92522e5bc8c9855c8a0c7596764d00b8b24cebd570a3f';

type EnemyKind = 'SENTIENT' | 'CUSTOM_MONSTER';
export interface EnemyArtReference {
  readonly assetKey: string;
  readonly sha256: string;
}
export interface EnemyArtOverride extends EnemyArtReference {
  readonly uploadCommandIdOrNull: string | null;
}
export interface EnemyArtProjection {
  readonly mediaType: CampaignArtValue['mediaType'];
  readonly sha256: string;
  readonly bytesBase64: string;
}
export type EnemyArtPatch =
  | { readonly operation: 'UPLOAD'; readonly file: CampaignArtValue }
  | { readonly operation: 'CLEAR' };
export type EnemyStoredArtPatch =
  | {
      readonly operation: 'UPLOAD';
      readonly mediaType: CampaignArtValue['mediaType'];
      readonly sha256: string;
      readonly byteLength: number;
    }
  | { readonly operation: 'CLEAR' };

const DEFAULT_ART = {
  SENTIENT: { assetKey: ENEMY_PLACEHOLDER, sha256: ENEMY_PLACEHOLDER_SHA256 },
  CUSTOM_MONSTER: {
    assetKey: CUSTOM_MONSTER_PLACEHOLDER,
    sha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
  },
} as const;

export function enemyAttemptArt(attempt: {
  readonly kind: EnemyKind;
  readonly artOverride?: EnemyArtOverride;
}): EnemyArtReference {
  if (attempt.artOverride === undefined) return DEFAULT_ART[attempt.kind];
  const { assetKey, sha256 } = attempt.artOverride;
  return { assetKey, sha256 };
}

export function assertEnemyArtReference(kind: EnemyKind, assetKey: unknown, sha256: unknown): void {
  const supplied = DEFAULT_ART[kind];
  if (assetKey === supplied.assetKey) {
    w.literal(sha256, supplied.sha256, '$.artSha256');
  } else if (
    typeof sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(sha256) ||
    assetKey !== 'enemy-upload:' + sha256
  ) {
    r.invalid('$.artAssetKey', 'own supplied mapping or content-addressed enemy upload', null);
  }
}

export function enemyArtOverrideValue(kind: EnemyKind, value: unknown): EnemyArtOverride {
  const row = r.exact(value, 'assetKey sha256 uploadCommandIdOrNull', '$.artOverride');
  assertEnemyArtReference(kind, row['assetKey'], row['sha256']);
  if (row['assetKey'] === DEFAULT_ART[kind].assetKey) {
    w.literal(row['uploadCommandIdOrNull'], null, '$.uploadCommandIdOrNull');
  } else {
    r.uuid(row['uploadCommandIdOrNull'], '$.uploadCommandIdOrNull');
  }
  return w.validated(row);
}

// CORE-193 / AQA-001 uses at most 12 MiB decoded. Avoid a repeated group
// in the base64 grammar: large valid images must also work in the browser.
function checkEncodedImage(value: unknown, expectedType: CampaignArtValue['mediaType']): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4 * Math.ceil(LOCAL_IMAGE_MAX_BYTES / 3) ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value) ||
    (value.endsWith('==') && !/[AQgw]==$/u.test(value)) ||
    (value.endsWith('=') && !value.endsWith('==') && !/[AEIMQUYcgkosw048]=$/u.test(value))
  ) {
    return r.invalid('$.bytesBase64', 'bounded canonical base64 image', null);
  }
  // Twelve base64 characters cover both signatures without decoding a full file for each UI read.
  const prefix = Uint8Array.from(atob(value.slice(0, 12)), (c) => c.charCodeAt(0));
  if (localImageMediaType(prefix) !== expectedType)
    r.invalid('$.mediaType', 'matching image signature', null);
}

export function enemyArtPatchValue(value: unknown): EnemyArtPatch {
  const row = r.record(value, '$.artPatch');
  if (row['operation'] === 'CLEAR') {
    r.exact(row, 'operation', '$.artPatch');
    return { operation: 'CLEAR' };
  }
  r.exact(row, 'operation file', '$.artPatch');
  w.literal(row['operation'], 'UPLOAD', '$.operation');
  const file = r.exact(row['file'], 'kind mediaType bytesBase64', '$.file');
  w.literal(file['kind'], 'local-file', '$.kind');
  const mediaType = r.oneOf(file['mediaType'], ['image/png', 'image/jpeg'] as const, '$.mediaType');
  checkEncodedImage(file['bytesBase64'], mediaType);
  return w.validated(row);
}

/** The event retains a commitment to the exact file stored atomically in SQLite. */
export function enemyStoredArtPatchValue(value: unknown): EnemyStoredArtPatch {
  const row = r.record(value, '$.storedArtPatch');
  if (row['operation'] === 'CLEAR') {
    r.exact(row, 'operation', '$.storedArtPatch');
    return { operation: 'CLEAR' };
  }
  r.exact(row, 'operation mediaType sha256 byteLength', '$.storedArtPatch');
  w.literal(row['operation'], 'UPLOAD', '$.operation');
  r.oneOf(row['mediaType'], ['image/png', 'image/jpeg'], '$.mediaType');
  if (
    !/^[0-9a-f]{64}$/u.test(r.text(row['sha256'], '$.sha256')) ||
    r.integer(row['byteLength'], '$.byteLength', 1) > LOCAL_IMAGE_MAX_BYTES
  ) {
    r.invalid('$.storedArtPatch', 'bounded image size and SHA-256', null);
  }
  return w.validated(row);
}

export function enemyArtProjectionValue(
  value: unknown,
  expected: EnemyArtReference,
): EnemyArtProjection {
  const art = r.exact(value, 'mediaType sha256 bytesBase64', '$.art');
  const mediaType = r.oneOf(
    art['mediaType'],
    ['image/png', 'image/jpeg'] as const,
    '$.art.mediaType',
  );
  if (!expected.assetKey.startsWith('enemy-upload:'))
    w.literal(art['mediaType'], 'image/png', '$.art.mediaType');
  w.literal(art['sha256'], expected.sha256, '$.art.sha256');
  checkEncodedImage(art['bytesBase64'], mediaType);
  return w.validated(art);
}
