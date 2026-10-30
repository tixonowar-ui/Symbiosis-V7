import { Buffer } from 'node:buffer';
import type { RevisionVector } from '../shared/wire-protocol.js';
import {
  validateCampaignPeerPublicIdentity,
  validateCampaignPeerTranscript,
  verifyCampaignPeerTranscript,
  type CampaignPeerPublicIdentity,
  type CampaignPeerTranscript,
} from './campaign-peer-identity.js';
import { validateCampaignMetadata } from './campaign-draft-validation.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';

/** Technical control-frame bound; candidate evidence uses a separate bounded transfer. */
export const CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES = 128 * 1024;
export interface PeerCampaignHeader {
  readonly campaignId: string;
  readonly title: string;
  readonly status: 'PAUSED';
  readonly activePlayerCapacity: 1 | 2 | 3 | 4 | 5;
  readonly activePcCount: number;
  readonly checkpointSha256: string;
  readonly baselineVersion: string;
  readonly revisions: RevisionVector;
}
export interface PeerSignedTranscript {
  readonly transcript: CampaignPeerTranscript;
  readonly signatureBase64: string;
}
export interface CampaignPeerHello {
  readonly protocolVersion: 3;
  readonly messageType: 'network.peer.hello';
  readonly targetCampaignId: string;
  readonly deviceIdentity: CampaignPeerPublicIdentity;
  readonly deviceNonceBase64: string;
}
export interface CampaignPeerChallenge {
  readonly protocolVersion: 3;
  readonly messageType: 'network.peer.challenge';
  readonly hostIdentity: CampaignPeerPublicIdentity;
  readonly campaign: PeerCampaignHeader;
  readonly signed: PeerSignedTranscript;
}
export interface CampaignPeerProof {
  readonly protocolVersion: 3;
  readonly messageType: 'network.peer.proof';
  readonly signed: PeerSignedTranscript;
}
export type CampaignPeerHandshakeMessage =
  CampaignPeerHello | CampaignPeerChallenge | CampaignPeerProof;

export class CampaignPeerHandshakeError extends Error {
  readonly code = 'INVALID_PEER_HANDSHAKE';
  constructor() {
    // Neither parser diagnostics nor a supplied key, title or transcript enters the error.
    super('campaign peer handshake: INVALID_PEER_HANDSHAKE');
  }
}
const fail = (): never => {
  throw new CampaignPeerHandshakeError();
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        descriptors[key] === undefined ||
        !Object.hasOwn(descriptors[key], 'value') ||
        !descriptors[key].enumerable,
    )
  )
    return fail();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value as unknown]));
}
function canonicalBase64(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(bytes / 3)) return fail();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== bytes || decoded.toString('base64') !== value) return fail();
  return value;
}
function identifier(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : fail();
}
function digest(value: unknown): string {
  return typeof value === 'string' && SHA.test(value) ? value : fail();
}
function revision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function campaignHeader(value: unknown): PeerCampaignHeader {
  const row = record(value, [
    'campaignId',
    'title',
    'status',
    'activePlayerCapacity',
    'activePcCount',
    'checkpointSha256',
    'baselineVersion',
    'revisions',
  ]);
  const metadata = validateCampaignMetadata({ title: row['title'], description: null, art: null });
  const capacity = row['activePlayerCapacity'];
  const count = revision(row['activePcCount']);
  const vector = record(row['revisions'], [
    'stateRevision',
    'actorVisibilityRevision',
    'projectionRevision',
  ]);
  if (
    metadata.title === null ||
    row['status'] !== 'PAUSED' ||
    typeof capacity !== 'number' ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 5 ||
    count > capacity ||
    typeof row['baselineVersion'] !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(row['baselineVersion'])
  )
    return fail();
  return Object.freeze({
    campaignId: identifier(row['campaignId']),
    title: metadata.title,
    status: 'PAUSED',
    activePlayerCapacity: capacity as 1 | 2 | 3 | 4 | 5,
    activePcCount: count,
    checkpointSha256: digest(row['checkpointSha256']),
    baselineVersion: row['baselineVersion'],
    revisions: Object.freeze({
      stateRevision: revision(vector['stateRevision']),
      actorVisibilityRevision: revision(vector['actorVisibilityRevision']),
      projectionRevision: revision(vector['projectionRevision']),
    }),
  });
}

export function validatePeerCampaignHeader(value: unknown): PeerCampaignHeader {
  try {
    return campaignHeader(value);
  } catch {
    return fail();
  }
}
function signed(value: unknown, purpose: 'HOST_CHALLENGE' | 'DEVICE_PROOF'): PeerSignedTranscript {
  const row = record(value, ['transcript', 'signatureBase64']);
  const transcript = validateCampaignPeerTranscript(row['transcript']);
  if (transcript.purpose !== purpose || transcript.sequenceNumber !== 0) return fail();
  return Object.freeze({
    transcript,
    signatureBase64: canonicalBase64(row['signatureBase64'], 64),
  });
}

/** Exact public challenge facts; the signature and transport bytes do not hash themselves. */
export function campaignPeerChallengeBodySha256(
  hostIdentityValue: CampaignPeerPublicIdentity,
  campaignValue: PeerCampaignHeader,
): string {
  try {
    const hostIdentity = validateCampaignPeerPublicIdentity(hostIdentityValue);
    const campaign = campaignHeader(campaignValue);
    return postSaveSha256(
      canonicalPostSaveJson({
        protocolVersion: 3,
        messageType: 'network.peer.challenge',
        hostIdentity,
        campaign,
      }),
    );
  } catch {
    return fail();
  }
}

function message(value: unknown): CampaignPeerHandshakeMessage {
  // Inspect the discriminant as a data property before ever reading a caller object.
  if (value === null || typeof value !== 'object') return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, 'messageType');
  const type: unknown =
    descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  if (type === 'network.peer.hello') {
    const row = record(value, [
      'protocolVersion',
      'messageType',
      'targetCampaignId',
      'deviceIdentity',
      'deviceNonceBase64',
    ]);
    if (row['protocolVersion'] !== 3) return fail();
    return Object.freeze({
      protocolVersion: 3,
      messageType: type,
      targetCampaignId: identifier(row['targetCampaignId']),
      deviceIdentity: validateCampaignPeerPublicIdentity(row['deviceIdentity']),
      deviceNonceBase64: canonicalBase64(row['deviceNonceBase64'], 32),
    });
  }
  if (type === 'network.peer.challenge') {
    const row = record(value, [
      'protocolVersion',
      'messageType',
      'hostIdentity',
      'campaign',
      'signed',
    ]);
    if (row['protocolVersion'] !== 3) return fail();
    const hostIdentity = validateCampaignPeerPublicIdentity(row['hostIdentity']);
    const campaign = campaignHeader(row['campaign']);
    const proof = signed(row['signed'], 'HOST_CHALLENGE');
    if (
      proof.transcript.hostDeviceId !== hostIdentity.ownerDeviceId ||
      proof.transcript.hostKeyFingerprintSha256 !== hostIdentity.keyFingerprintSha256 ||
      proof.transcript.campaignId !== campaign.campaignId ||
      proof.transcript.bodySha256 !== campaignPeerChallengeBodySha256(hostIdentity, campaign)
    )
      return fail();
    return Object.freeze({
      protocolVersion: 3,
      messageType: type,
      hostIdentity,
      campaign,
      signed: proof,
    });
  }
  if (type === 'network.peer.proof') {
    const row = record(value, ['protocolVersion', 'messageType', 'signed']);
    if (row['protocolVersion'] !== 3) return fail();
    return Object.freeze({
      protocolVersion: 3,
      messageType: type,
      signed: signed(row['signed'], 'DEVICE_PROOF'),
    });
  }
  return fail();
}

export function encodeCampaignPeerHandshakeMessage(value: CampaignPeerHandshakeMessage): string {
  try {
    const text = canonicalPostSaveJson(message(value));
    if (Buffer.byteLength(text, 'utf8') > CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES) return fail();
    return text;
  } catch {
    return fail();
  }
}

/** Node-to-Node control frames are canonical JSON, rejecting duplicate members and alias encodings. */
export function decodeCampaignPeerHandshakeMessage(source: unknown): CampaignPeerHandshakeMessage {
  try {
    if (
      typeof source !== 'string' ||
      Buffer.byteLength(source, 'utf8') > CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES
    )
      return fail();
    const parsed: unknown = JSON.parse(source);
    const result = message(parsed);
    if (canonicalPostSaveJson(result) !== source) return fail();
    return result;
  } catch {
    return fail();
  }
}

/** The caller obtains this pin from its own durable binding or explicit first CONNECT policy. */
export function authenticateCampaignPeerChallenge(
  helloValue: CampaignPeerHello,
  challengeValue: CampaignPeerChallenge,
  expectedHostIdentityValue: CampaignPeerPublicIdentity,
): CampaignPeerChallenge {
  try {
    const hello = message(helloValue);
    const challenge = message(challengeValue);
    const expected = validateCampaignPeerPublicIdentity(expectedHostIdentityValue);
    if (
      hello.messageType !== 'network.peer.hello' ||
      challenge.messageType !== 'network.peer.challenge'
    )
      return fail();
    const transcript = challenge.signed.transcript;
    if (
      challenge.campaign.campaignId !== hello.targetCampaignId ||
      challenge.hostIdentity.ownerDeviceId !== expected.ownerDeviceId ||
      challenge.hostIdentity.keyFingerprintSha256 !== expected.keyFingerprintSha256 ||
      challenge.hostIdentity.publicKeySpkiBase64 !== expected.publicKeySpkiBase64 ||
      transcript.deviceId !== hello.deviceIdentity.ownerDeviceId ||
      transcript.deviceKeyFingerprintSha256 !== hello.deviceIdentity.keyFingerprintSha256 ||
      transcript.deviceNonceBase64 !== hello.deviceNonceBase64 ||
      !verifyCampaignPeerTranscript(
        challenge.hostIdentity,
        transcript,
        challenge.signed.signatureBase64,
      )
    )
      return fail();
    return challenge;
  } catch {
    return fail();
  }
}
