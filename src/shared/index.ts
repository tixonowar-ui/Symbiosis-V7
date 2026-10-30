/**
 * Public surface of the shared layer: contracts, wire protocol and types used by
 * both the host and the renderer.
 *
 * Contracts are now defined. They are derived from
 * artifacts/atlas and the domain registries; see ../../CLAUDE.md for the
 * source-of-truth order that governs what may be written here.
 */
export {
  decodeClientMessage,
  decodeHostMessage,
  encodeClientMessage,
  encodeHostMessage,
  redactProtocolInputRefusal,
} from './wire-codec.js';
export * from './wire-protocol.js';
export * from './wire-v2-codec.js';
export * from './wire-v2-protocol.js';
export * from './wire-v3-codec.js';
export * from './wire-v3-protocol.js';
export * from './campaign-creation.js';
export * from './device-admission.js';
export * from './network-application.js';
export {
  decodeNetworkGmRequestClientMessageV3,
  decodeNetworkGmRequestHostMessageV3,
  decodeNetworkHostMessageV3,
  encodeNetworkClientMessageV3,
  encodeNetworkGmRequestClientMessageV3,
  encodeNetworkGmRequestHostMessageV3,
  encodeNetworkHostMessageV3,
  isNetworkApplicationProjection,
  networkGmRequestDecisionReceiptValue,
  networkGmRequestDraftValues,
  networkGmRequestProjectionValue,
  networkGmRequestWorkflowPayloadValue,
  networkWorkflowPayloadValue,
} from './network-application-codec.js';
