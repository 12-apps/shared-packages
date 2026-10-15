import { useCallback, useEffect, useRef, useState } from "react";

import type { CheckoutOrder, PaymentMethod } from "../types";

/**
 * How long the card's "Pagando R$ X no Visa final 4242…" bar takes to fill —
 * the window in which "Cancelar" still sends nothing (FUT-3592, M10). The
 * owner's own number: the bar replaces the confirmation dialog, so it is the
 * buyer's whole chance to change their mind.
 */
export const CHARGE_WINDOW_MS = 5_000;

/**
 * Where a charge the bar's button started stands.
 *
 *  - `idle` — the list, with the button.
 *  - `counting` — the card's 5-second bar; Cancelar still sends nothing.
 *  - `sending` — the order is being raised, then the instrument charged.
 *  - `waiting` — the charge was accepted and its confirmation is awaited.
 */
export type ListChargePhase = "idle" | "counting" | "sending" | "waiting";

/** What a charge runs against: the card the buyer chose, or Google Pay's sheet. */
export type ListChargeKind = "CARD" | "GOOGLE_PAY";

/** The controller's slice this needs. */
interface RaisePorts {
  order: CheckoutOrder | null;
  creating: boolean;
  createError: string | null;
  setMethod: (method: PaymentMethod) => void;
  startPayment: (method: PaymentMethod) => Promise<void>;
  /** The amount the buyer is shown now (the cart's, or the balance's). */
  cartTotal: string;
  /** What an online payment asks the provider for now, when the host prices it (`paymentList.totalCents`). */
  dueCents?: number;
}

export interface ListCharge {
  phase: ListChargePhase;
  kind: ListChargeKind | null;
  /** The amount named when the button was pressed — the bar shows THIS, never a later one. */
  pressedTotal: string | null;
  /** Start a card charge (with its 5-second bar) or a Google Pay one (straight away). Only from idle. */
  start: (kind: ListChargeKind, total: string) => void;
  /** Cancelar, during the bar: nothing has been sent, and nothing will be. */
  cancel: () => void;
  /**
   * Whether the charge may still go out — set by the list on every render. A
   * hold the host raised, a reason the button would show, or a total that
   * moved since the press stops the bar, and `send` checks it again.
   */
  setAllowed: (allowed: boolean) => void;
  /** The runner reports the charge was accepted and is now awaited. */
  accepted: () => void;
  /** The runner, or the raise, gave up: back to the list as it was. */
  settle: () => void;
  /** The CARD order the runner charges — set once one is held for this charge. */
  chargeable: CheckoutOrder | null;
}

/**
 * A held CARD order still awaiting payment AND priced as the buyer now sees —
 * reusable for the charge. A balance ticked or unticked moves what the charge
 * asks for and not the order's total, so the amount due is compared too.
 */
function reusable(order: CheckoutOrder | null, cartTotal: string, dueCents: number | undefined): boolean {
  if (order?.method !== "CARD" || order.status !== "AWAITING_PAYMENT" || order.totalLabel !== cartTotal) return false;
  return dueCents === undefined || (order.amountDueCents ?? order.totalCents) === dueCents;
}

/** The order `send` meant: the one it reused, or the CARD order raised to replace a stale one. */
function chargeTarget(
  order: CheckoutOrder | null,
  target: { reuse: CheckoutOrder } | { replace: CheckoutOrder | null } | null,
): CheckoutOrder | null {
  if (!order || !target || order.method !== "CARD" || order.status !== "AWAITING_PAYMENT") return null;
  if ("reuse" in target) return target.reuse === order ? order : null;
  return order !== target.replace ? order : null;
}

/**
 * The bar's charge, after the button (FUT-3592): count down for a card, then
 * raise the order — or reuse the CARD order already held, after a refusal the
 * buyer is retrying, but only while it is priced as the cart now is (a credit
 * toggled, an address changed: re-raise, never charge the old amount) — and
 * hand it to the runner that charges it.
 *
 * Nothing is sent before `sending`: the timer is the only thing running while
 * the bar fills, so Cancelar has nothing to undo.
 */
export function useListCharge(ports: RaisePorts): ListCharge {
  const [phase, setPhase] = useState<ListChargePhase>("idle");
  const [kind, setKind] = useState<ListChargeKind | null>(null);
  const [pressedTotal, setPressedTotal] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowed = useRef(true);
  // What `send` decided to charge: the held order it reused, or "a fresh one"
  // — any CARD order other than the stale one it replaced.
  const target = useRef<{ reuse: CheckoutOrder } | { replace: CheckoutOrder | null } | null>(null);
  const latest = useRef(ports);
  latest.current = ports;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPhase("idle");
    setKind(null);
    setPressedTotal(null);
  }, []);

  const send = useCallback(() => {
    timer.current = null;
    // Checked again at the last moment: a hold raised between two renders
    // must not let the bar's own timer charge past it.
    if (!allowed.current) return cancel();
    setPhase("sending");
    const { order, cartTotal, dueCents } = latest.current;
    if (reusable(order, cartTotal, dueCents) && order) {
      target.current = { reuse: order };
      return;
    }
    target.current = { replace: order };
    latest.current.setMethod("CARD");
    void latest.current.startPayment("CARD");
  }, [cancel]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const start = useCallback(
    (next: ListChargeKind, total: string) => {
      if (phaseRef.current !== "idle") return;
      phaseRef.current = next === "GOOGLE_PAY" ? "sending" : "counting";
      setKind(next);
      setPressedTotal(total);
      if (next === "GOOGLE_PAY") return send();
      setPhase("counting");
      timer.current = setTimeout(send, CHARGE_WINDOW_MS);
    },
    [send],
  );

  const setAllowed = useCallback(
    (next: boolean) => {
      allowed.current = next;
      if (!next && phaseRef.current === "counting") cancel();
    },
    [cancel],
  );

  const settle = cancel;
  const accepted = useCallback(() => setPhase("waiting"), []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // A raise that failed leaves nothing to charge: back to the list, where the
  // step's error panel says why.
  const { order, creating, createError } = ports;
  useEffect(() => {
    if (phase === "sending" && !creating && !order && createError) settle();
  }, [phase, creating, order, createError, settle]);

  const sending = phase === "sending" || phase === "waiting";
  const chargeable = sending && !creating ? chargeTarget(order, target.current) : null;
  return { phase, kind, pressedTotal, start, cancel, setAllowed, accepted, settle, chargeable };
}
