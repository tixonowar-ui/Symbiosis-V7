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
} from './wire-codec.js';
export * from './wire-protocol.js';
export * from './wire-v2-codec.js';
export * from './wire-v2-protocol.js';
