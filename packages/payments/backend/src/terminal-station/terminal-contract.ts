import type { CaptureTrace, ChangedMethod, ChargeMethod, ChargeState, LinkProvider } from "../terminal-link";

/**
 * The station's surface for its paired terminals over the LAN: what the
 * station's page asks for and what it hears back. The station's process
 * listens for the terminal (`./terminal-link.ts`); the page charges through
 * these calls and hears the answers as {@link TerminalEvent}s.
 */

/** A paired terminal as the page shows it: connected or not. */
interface TerminalView {
  readonly deviceId: string;
  readonly provider: LinkProvider;
  /** The station's `host:port` the pairing recorded; null before one is. */
  readonly lanAddress: string | null;
  readonly status: "connected" | "disconnected";
  /**
   * The charge pushed to this terminal and not yet ended there, or null. A
   * page that reloaded finds it here and can cancel it (`cancel`); the
   * terminal stays BUSY until then.
   */
  readonly pending: TerminalPendingCharge | null;
}

/** A charge waiting on a terminal, as the page needs it to show or cancel it. */
export interface TerminalPendingCharge {
  readonly chargeId: string;
  readonly amountCents: number;
  readonly method: ChargeMethod;
  /** A split's part, both or neither. */
  readonly part?: number;
  readonly parts?: number;
}

/** Where the station's LAN link stands. */
export interface TerminalState {
  /** The `host:port` pairs main listens on — the station's own private addresses; empty when it has none. */
  readonly listening: readonly string[];
  readonly terminals: readonly TerminalView[];
}

/**
 * One card or Pix leg to push to the terminal. `deviceId` only when more than
 * one terminal is linked; the station mints the charge's id.
 */
export interface TerminalChargeRequest {
  readonly deviceId?: string;
  readonly saleRef: string;
  readonly operator: string;
  readonly amountCents: number;
  readonly method: ChargeMethod;
  readonly part?: number;
  readonly parts?: number;
  readonly remainingCents?: number;
}

/** Why a charge was not pushed. */
type TerminalChargeRefusal = "NO_TERMINAL" | "PICK_TERMINAL" | "NOT_CONNECTED" | "BUSY" | "BAD_REQUEST";

export type TerminalChargeAnswer =
  | { readonly ok: true; readonly chargeId: string; readonly deviceId: string }
  | { readonly ok: false; readonly code: TerminalChargeRefusal };

/**
 * What a cancel at the computer did:
 * - `SENT`: the terminal was told; its `cancelled` (or an approval that beat
 *   it) arrives as an event.
 * - `OUTCOME_UNKNOWN`: the terminal is away, so it could not be told. The
 *   charge is released and the terminal free for another, but whether it was
 *   paid is unknown: an approval for it that arrives later comes as an
 *   `orphan-capture` event.
 * - `NO_CHARGE`: no such charge is waiting.
 */
export type TerminalCancelAnswer = "SENT" | "OUTCOME_UNKNOWN" | "NO_CHARGE";

/** Why a waiting charge was released without the terminal ending it. Its outcome is unknown. */
export type TerminalReleaseReason = "unlinked" | "repaired" | "cancelled-away" | "stopped";

/**
 * What the station tells the page about the terminal: the link moved, a
 * charge's status (`approved` carries the capture's trace; `method_changed`
 * the method the cashier moved to, CASH sending the leg back), or captures the
 * terminal took with no link, for the page to book.
 */
export type TerminalEvent =
  | { readonly kind: "state"; readonly state: TerminalState }
  | {
      readonly kind: "status";
      readonly deviceId: string;
      readonly chargeId: string;
      readonly state: ChargeState;
      readonly method?: ChangedMethod;
      readonly capture?: CaptureTrace;
    }
  | { readonly kind: "typed-captures"; readonly deviceId: string; readonly captures: readonly CaptureTrace[] }
  /**
   * A waiting charge let go without the terminal ending it: the device was
   * unlinked or re-paired, the cashier cancelled it while the terminal was
   * away, or the station stopped. Whether it was paid is unknown.
   */
  | { readonly kind: "charge-released"; readonly deviceId: string; readonly chargeId: string; readonly reason: TerminalReleaseReason; readonly outcome: "unknown" }
  /**
   * The same device reported `approved` (with its capture) or
   * `method_changed` for a charge it WAS sent but that was released since
   * (cancelled while away). Money may have moved: the host binds the capture
   * to its sale or flags it for a refund — never drops it.
   */
  | {
      readonly kind: "orphan-capture";
      readonly deviceId: string;
      readonly chargeId: string;
      readonly state: "approved" | "method_changed";
      readonly method?: ChangedMethod;
      readonly capture?: CaptureTrace;
    };
