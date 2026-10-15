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
}

export interface ListCharge {
  phase: ListChargePhase;
  kind: ListChargeKind | null;
  /** Start a card charge (with its 5-second bar) or a Google Pay one (straight away). */
  start: (kind: ListChargeKind) => void;
  /** Cancelar, during the bar: nothing has been sent, and nothing will be. */
  cancel: () => void;
  /** The runner reports the charge was accepted and is now awaited. */
  accepted: () => void;
  /** The runner, or the raise, gave up: back to the list as it was. */
  settle: () => void;
  /** The CARD order the runner charges — set once one is held for this charge. */
  chargeable: CheckoutOrder | null;
}

/**
 * The bar's charge, after the button (FUT-3592): count down for a card, then
 * raise the order — or reuse the CARD order already held, after a refusal the
 * buyer is retrying — and hand it to the runner that charges it.
 *
 * Nothing is sent before `sending`: the timer is the only thing running while
 * the bar fills, so Cancelar has nothing to undo.
 */
export function useListCharge(ports: RaisePorts): ListCharge {
  const [phase, setPhase] = useState<ListChargePhase>("idle");
  const [kind, setKind] = useState<ListChargeKind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(ports);
  latest.current = ports;

  const send = useCallback(() => {
    timer.current = null;
    setPhase("sending");
    const held = latest.current.order;
    if (held?.method === "CARD" && held.status === "AWAITING_PAYMENT") return;
    latest.current.setMethod("CARD");
    void latest.current.startPayment("CARD");
  }, []);

  const start = useCallback(
    (next: ListChargeKind) => {
      setKind(next);
      if (next === "GOOGLE_PAY") return send();
      setPhase("counting");
      timer.current = setTimeout(send, CHARGE_WINDOW_MS);
    },
    [send],
  );

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPhase("idle");
    setKind(null);
  }, []);

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
  const chargeable = sending && order?.method === "CARD" ? order : null;
  return { phase, kind, start, cancel, accepted, settle, chargeable };
}
