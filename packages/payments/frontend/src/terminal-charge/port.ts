import type { StationCaptureWire } from '@12-apps/payments-backend/terminal';
import type { CaptureTrace, ChargeMethod, LinkProvider } from '@12-apps/payments-backend/terminal-link';
import type {
  TerminalCancelAnswer,
  TerminalChargeAnswer,
  TerminalChargeRequest,
  TerminalEvent,
  TerminalPendingCharge,
  TerminalState,
} from '@12-apps/payments-backend/terminal-station';

/**
 * The paired payment terminal, as a station's screens reach it: the host's
 * port onto the station's LAN link (`@12-apps/payments-backend/terminal-station`).
 *
 * Only a station that runs that link offers it. A browser with no LAN gives
 * none, and every screen then charges as it did before: card legs are plain
 * tenders and nothing waits. The shapes are the station contract's own (type
 * imports only, so a browser build pulls no server code). Card data never
 * crosses this port: only amounts, methods, ids and the capture's trace.
 */

export type {
  TerminalCancelAnswer,
  TerminalChargeAnswer,
  TerminalChargeRequest,
  TerminalEvent,
  TerminalPendingCharge,
  TerminalState,
};

/** One terminal capture's acquirer trace, as the terminal reports it. */
export type TerminalCaptureTrace = CaptureTrace;

/** What the terminal charges. Cash never goes to it. */
export type TerminalMethod = ChargeMethod;

/** The providers a link can name. */
export type TerminalProvider = LinkProvider;

/** One paired terminal, as a station's screens show it. */
export type TerminalView = TerminalState['terminals'][number];

/** A capture as a sale's leg carries it to the server: the trace, with the terminal that took it. */
export type CaptureWire = StationCaptureWire;

/** The port itself. */
export interface TerminalPort {
  /** The links now; `reread` asks the server for them again (after a re-pair). */
  state(options?: { reread?: boolean }): Promise<TerminalState>;
  charge(request: TerminalChargeRequest): Promise<TerminalChargeAnswer>;
  cancel(chargeId: string): Promise<TerminalCancelAnswer>;
  /** What the station hears; answers how to stop listening. */
  onEvent(listener: (event: TerminalEvent) => void): () => void;
}

/**
 * Where the station's link stands, as a flow needs it.
 *
 * - `known: false`: no answer yet, or the last read failed. A card or Pix leg
 *   then WAITS: it never degrades to a plain leg.
 * - `known: true, terminals: 0`: no terminal linked (or no port at all): card
 *   legs are plain tenders, as before.
 * - `pending`: a charge the station still holds on the terminal after a
 *   reload, which the screen shows and may cancel.
 */
export type ChargeLink =
  | { readonly known: false }
  | { readonly known: true; readonly terminals: number; readonly pending?: TerminalPendingCharge | null };

/** The tenders a terminal can take: the registry ids that ARE terminal methods. */
export function terminalMethodOf(tender: string): TerminalMethod | null {
  return tender === 'CREDIT' || tender === 'DEBIT' || tender === 'PIX' ? tender : null;
}

/** The link a station state means: known, with how many terminals it has. */
export function linkOf(state: TerminalState | null, failed = false): ChargeLink {
  if (state === null || failed) return { known: false };
  const pending = state.terminals.find((terminal) => terminal.pending !== null)?.pending ?? null;
  return { known: true, terminals: state.terminals.length, pending };
}

/** The trace a terminal reported, as the wire a sale's leg carries, with the terminal that took it. */
export function captureWireOf(trace: TerminalCaptureTrace, deviceId: string | null): CaptureWire {
  return {
    transactionCode: trace.transactionCode,
    kind: trace.kind,
    amountCents: trace.amountCents,
    capturedAt: trace.capturedAt,
    transactionId: trace.transactionId,
    authorizationCode: trace.authorizationCode,
    cardBrand: trace.brand,
    installments: trace.installments,
    terminalSerial: trace.serial,
    entryMode: trace.entryMode,
    ...(deviceId === null ? {} : { deviceId }),
  };
}
