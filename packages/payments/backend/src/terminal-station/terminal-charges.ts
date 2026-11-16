import type { ChargeBody, ChargeState, Message } from "../terminal-link";

import type { TerminalChargeRequest, TerminalEvent, TerminalPendingCharge, TerminalReleaseReason } from "./terminal-contract";

/**
 * The charges the station pushed to its terminals: which
 * are pending, and which were released without the terminal ending them. The
 * rules are in `./terminal-link.ts`'s header; this is their bookkeeping.
 */

/** A charge pushed to a device and not yet ended there. */
interface PendingCharge extends TerminalPendingCharge {
  readonly deviceId: string;
  /** The link's secret when it was pushed: a re-pair that rotates it releases the charge. */
  readonly secret: string;
}

type StatusMessage = Extract<Message<"terminal">, { type: "status" }>;

/** Whether a status ends the charge at the terminal. */
export const endsCharge = (message: StatusMessage): boolean =>
  message.state === "approved" || message.state === "cancelled" || (message.state === "method_changed" && message.method === "CASH");

/** The protocol's charge body for a page's request (already read by the host). */
export function chargeBody(chargeId: string, request: TerminalChargeRequest): Omit<ChargeBody, "type"> {
  const split =
    request.part === undefined || request.parts === undefined
      ? {}
      : { part: request.part, parts: request.parts, ...(request.remainingCents === undefined ? {} : { remainingCents: request.remainingCents }) };
  return { chargeId, saleRef: request.saleRef, operator: request.operator, amountCents: request.amountCents, method: request.method, ...split };
}

/** How many released charges are remembered, to recognise a late approval for one. */
const MAX_RELEASED = 256;

export class ChargeBook {
  /** chargeId → the charge, until the terminal ends it or it is released. */
  private readonly pending = new Map<string, PendingCharge>();
  /** chargeId → the device, for charges released without the terminal ending them (newest last, capped). */
  private readonly released = new Map<string, string>();

  constructor(private readonly emit: (event: TerminalEvent) => void) {}

  add(charge: PendingCharge): void {
    this.pending.set(charge.chargeId, charge);
  }

  get(chargeId: string): PendingCharge | undefined {
    return this.pending.get(chargeId);
  }

  all(): PendingCharge[] {
    return [...this.pending.values()];
  }

  /** The device's pending charge (one at most: a busy device takes no other). */
  of(deviceId: string): PendingCharge | undefined {
    return this.all().find((charge) => charge.deviceId === deviceId);
  }

  /** The device's pending charge as the page sees it. */
  view(deviceId: string): TerminalPendingCharge | null {
    const charge = this.of(deviceId);
    if (charge === undefined) return null;
    const split = charge.part === undefined || charge.parts === undefined ? {} : { part: charge.part, parts: charge.parts };
    return { chargeId: charge.chargeId, amountCents: charge.amountCents, method: charge.method, ...split };
  }

  /**
   * The terminal ended the charge itself (approved, cancelled, moved to cash).
   * A charge ended WITHOUT an approval is remembered as released (no event:
   * the page heard the terminal's own status), so an approval that loses the
   * race with the cancel or the move to cash — the acquirer answered after the
   * terminal said so — is an `orphan-capture`, never dropped.
   */
  end(chargeId: string, state: ChargeState): void {
    const charge = this.pending.get(chargeId);
    this.pending.delete(chargeId);
    if (charge === undefined || state === "approved") return;
    this.remember(charge.chargeId, charge.deviceId);
  }

  private remember(chargeId: string, deviceId: string): void {
    this.released.delete(chargeId);
    this.released.set(chargeId, deviceId);
    while (this.released.size > MAX_RELEASED) this.released.delete(this.released.keys().next().value!);
  }

  /** Let a pending charge go without the terminal ending it: the page hears it, outcome unknown. */
  release(charge: PendingCharge, reason: TerminalReleaseReason): void {
    this.pending.delete(charge.chargeId);
    this.remember(charge.chargeId, charge.deviceId);
    this.emit({ kind: "charge-released", deviceId: charge.deviceId, chargeId: charge.chargeId, reason, outcome: "unknown" });
  }

  /** Release every pending charge (the station stops), and forget the released ones. */
  releaseAll(reason: TerminalReleaseReason): void {
    for (const charge of this.all()) this.release(charge, reason);
    this.released.clear();
  }

  /**
   * A status for a charge that is not pending: an `orphan-capture` event when
   * it is an `approved` or `method_changed` from the device a released charge
   * was sent to, else null (ignored). An approval ends the charge: a resend of
   * it is the same capture, which the host binds once by its code.
   */
  orphan(deviceId: string, message: StatusMessage): Extract<TerminalEvent, { kind: "orphan-capture" }> | null {
    if (this.released.get(message.chargeId) !== deviceId) return null;
    if (message.state !== "approved" && message.state !== "method_changed") return null;
    if (message.state === "approved") this.released.delete(message.chargeId);
    return {
      kind: "orphan-capture",
      deviceId,
      chargeId: message.chargeId,
      state: message.state,
      ...(message.method === undefined ? {} : { method: message.method }),
      ...(message.capture === undefined ? {} : { capture: message.capture }),
    };
  }
}
