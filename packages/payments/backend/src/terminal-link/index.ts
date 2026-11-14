/**
 * `@12-apps/payments-backend/terminal-link` — the LAN protocol between a
 * station (the computer at the counter) and its paired payment terminal: the
 * message vocabulary, its strict reading, and HMAC-SHA256 signing with the
 * per-link secret.
 *
 * React-Native-safe on purpose: plain TypeScript with no Node-only or
 * DOM-only API, no `Buffer`, no `atob`, no `crypto.subtle`, so the station
 * (Node) and the terminal app (React Native) import the same module. The
 * station's server is `@12-apps/payments-backend/terminal-station`. Not on the
 * root barrel.
 */
export { decodeBase64, utf8 } from "./encoding";
export { hmacSha256, sha256, toHex } from "./hmac-sha256";
export {
  CHANGED_METHODS,
  CHARGE_METHODS,
  CHARGE_STATES,
  DEFAULT_LINK_PORT,
  isCaptureTrace,
  LINK_PROTOCOL_VERSION,
  LINK_PROVIDERS,
  MAX_SPLIT_PARTS,
  MAX_TYPED_CAPTURES,
  readMessage,
  type BodyFrom,
  type CancelBody,
  type CaptureTrace,
  type ChangedMethod,
  type ChargeBody,
  type ChargeMethod,
  type ChargeState,
  type Envelope,
  type LinkProvider,
  type LinkRefusal,
  type LinkSide,
  type Message,
  type PingBody,
  type PongBody,
  type ReadResult,
  type StationBody,
  type StationHello,
  type StatusBody,
  type TerminalBody,
  type TerminalHello,
  type TypedAckBody,
  type TypedCapturesBody,
} from "./messages";
export {
  canonicalJson,
  createLinkPeer,
  createNonceMemory,
  DEFAULT_MAX_SKEW_MS,
  macMatches,
  macOf,
  type LinkPeer,
  type MacFunction,
  type OpenResult,
  type Other,
  type PeerOptions,
} from "./peer";
