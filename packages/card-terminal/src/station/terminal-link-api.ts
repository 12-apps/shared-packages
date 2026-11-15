import type { NetworkInterfaces } from "./terminal-bind";
import type { TerminalCancelAnswer, TerminalChargeAnswer, TerminalChargeRequest, TerminalEvent, TerminalState } from "./terminal-contract";
import type { SecretSealer, StoredTerminalLink, TerminalLinkSource } from "./terminal-link-cache";

/**
 * The station LAN server's surface: what it closes a connection with, what it
 * is built from, and what it answers. The server is `./terminal-link.ts`.
 */

/** A WebSocket close code the station sends, and why. */
export const CLOSE = {
  malformed: 4400,
  refused: 4401,
  unknownDevice: 4403,
  helloTimeout: 4408,
  replaced: 4409,
  unlinked: 4410,
  /** No station id yet (the host has not assigned one). */
  noStation: 4412,
  /** Too many connections waiting on their hello. */
  busy: 4429,
  goingAway: 1001,
} as const;

/** Where the sealed links are kept between launches (the host's settings file). */
export interface LinkCacheStore {
  read(): readonly StoredTerminalLink[];
  write(links: readonly StoredTerminalLink[]): Promise<void>;
}

/**
 * One connection from a terminal, as the host's WebSocket server hands it
 * over. The host's adapter decodes each frame to text and caps its size.
 */
export interface StationConnection {
  /** Whether the socket is open: a frame on a closing socket is not read. */
  isOpen(): boolean;
  send(raw: string): void;
  close(code: number, reason: string): void;
  /** Drop it without a close handshake. */
  terminate(): void;
  /** Each frame: its text (empty for a binary frame), and whether it was binary. */
  onMessage(handler: (text: string, isBinary: boolean) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
}

/**
 * The host's WebSocket servers, one per address the station listens on.
 * `sync` follows the addresses the machine has now: it listens on a new one
 * and closes the server of one that vanished; a listen that failed is tried
 * again on the next `sync`.
 */
export interface StationListeners {
  /** Whether nothing listens and nothing is about to. */
  readonly idle: boolean;
  /** The hosts listened on now. */
  hosts(): string[];
  /** The `host:port` pairs actually listening. */
  addresses(): string[];
  /** Listen on every wanted host not yet listened on; close the vanished. Answers whether one was added. */
  sync(wanted: readonly string[], port: number): Promise<boolean>;
  stop(): Promise<void>;
}

/** Build the host's listeners: every accepted connection goes to `onConnection`. */
export type ListenPort = (onConnection: (connection: StationConnection) => void, log: (message: string) => void) => StationListeners;

export interface TerminalLinkDeps {
  /** The host's WebSocket servers. */
  readonly listen: ListenPort;
  /** This computer's station id, sent in its hello. */
  readonly stationId: () => string | null;
  readonly source: TerminalLinkSource;
  readonly cache: LinkCacheStore;
  readonly sealer: SecretSealer;
  /** The machine's interfaces (`os.networkInterfaces`). */
  readonly interfaces: () => NetworkInterfaces;
  /** Listen on exactly these instead (tests: `127.0.0.1`). */
  readonly hosts?: readonly string[];
  /** Which of the interfaces' addresses to listen on; `./terminal-bind.ts`'s private addresses unless a test needs loopback. */
  readonly pickHosts?: (interfaces: NetworkInterfaces) => readonly string[];
  /** `0` asks the system for a free port (tests). */
  readonly port?: number;
  readonly pingIntervalMs?: number;
  readonly maxMissedPongs?: number;
  readonly helloTimeoutMs?: number;
  /** Connections waiting on their hello at once; more are closed. */
  readonly maxPendingHandshakes?: number;
  readonly now?: () => number;
  readonly onEvent?: (event: TerminalEvent) => void;
  readonly log?: (message: string) => void;
}

export interface TerminalLinkServer {
  /** Open the kept links, listen, and ask the source in the background. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Ask the source again (after a re-pair). `false` when it could not answer:
   * the kept links stand — only a real answer replaces them. Calls run one
   * after another, so an older answer never lands over a newer one.
   */
  refreshLinks(): Promise<boolean>;
  state(): TerminalState;
  charge(request: TerminalChargeRequest): TerminalChargeAnswer;
  /** Tell the terminal to drop a charge; see {@link TerminalCancelAnswer}. */
  cancel(chargeId: string): TerminalCancelAnswer;
  /** Tell the terminal the page booked these typed captures (`typed_ack`); `false` when it could not be told. */
  ackTyped(deviceId: string, transactionCodes: readonly string[]): boolean;
  /** The `host:port` pairs actually listening (the system's port when `port` is 0). */
  addresses(): readonly string[];
}
