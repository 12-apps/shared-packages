/**
 * `@12-apps/payments-backend/terminal-station` — the station's side of the
 * LAN link to its paired payment terminals: the server that admits a signed
 * terminal, pushes charges and hears their answers, the links it keeps sealed
 * on disk, where it listens, and the book of captures it heard for an offline
 * journal.
 *
 * Node-only (it uses `node:crypto` and `node:path`), and free of any server
 * library: the WebSocket servers ({@link ListenPort}), the link source, the
 * key store ({@link SecretSealer}), the settings file and the durable files
 * ({@link CaptureBookFiles}) are the host's, behind ports. Not on the root
 * barrel.
 */
export { privateBindAddresses, isPrivateIpv4, type InterfaceAddress, type NetworkInterfaces } from "./terminal-bind";
export { ChargeBook, chargeBody, endsCharge } from "./terminal-charges";
export type {
  TerminalCancelAnswer,
  TerminalChargeAnswer,
  TerminalChargeRequest,
  TerminalEvent,
  TerminalPendingCharge,
  TerminalReleaseReason,
  TerminalState,
} from "./terminal-contract";
export { readHello } from "./terminal-handshake";
export {
  CLOSE,
  type LinkCacheStore,
  type ListenPort,
  type StationConnection,
  type StationListeners,
  type TerminalLinkDeps,
  type TerminalLinkServer,
} from "./terminal-link-api";
export {
  openStoredLinks,
  parseStoredTerminalLinks,
  readTerminalLinks,
  sealLinks,
  type SecretSealer,
  type StoredTerminalLink,
  type TerminalLink,
  type TerminalLinkSource,
} from "./terminal-link-cache";
export { createTerminalLinkServer } from "./terminal-link";
export {
  MAX_KEPT,
  captureWireOf,
  createLanCaptureBook,
  type BookDeps,
  type CaptureBookFiles,
  type Claim,
  type LanCaptureBook,
} from "./offline-captures";
