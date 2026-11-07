import { useCallback, useEffect, useRef, useState } from "react";

import type { BuyerInfo, CheckoutOrder, PaymentMethod } from "../types";

import type { CheckoutPricedAs } from "./price-types";

/**
 * How long the card's "Pagando R$ X no Visa 4242…" bar takes to fill —
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

/** What a charge runs against: the card the buyer chose, or a wallet's sheet. */
export type ListChargeKind = "CARD" | "GOOGLE_PAY" | "APPLE_PAY";

/** The controller's slice this needs. */
interface RaisePorts {
  order: CheckoutOrder | null;
  creating: boolean;
  createError: string | null;
  setMethod: (method: PaymentMethod) => void;
  startPayment: (method: PaymentMethod, override?: BuyerInfo, pricedAs?: CheckoutPricedAs) => Promise<void>;
  /** The amount the buyer is shown now (the cart's, or the balance's). */
  cartTotal: string;
  /** What an online payment asks the provider for now, when the host prices it (`paymentList.totalCents`). */
  dueCents?: number;
  /**
   * The cents a way to pay asks under its OWN price (FUT-4416): the chosen
   * online row's (`prices.online`), and the wallets' (`prices.wallets`). Set,
   * a held order is reused on those cents alone — its total is that price,
   * no longer the cart's.
   */
  priced?: { choice?: number; wallets?: number };
  /**
   * Which price a fresh card order is raised for (`CreateOrderRequest.pricedAs`):
   * the chosen row's, or the wallets'. Absent ⇒ none is named, as before.
   */
  raiseAs?: { choice?: CheckoutPricedAs; wallets?: CheckoutPricedAs };
}

export interface ListCharge {
  phase: ListChargePhase;
  kind: ListChargeKind | null;
  /** The amount named when the button was pressed — the bar shows THIS, never a later one. */
  pressedTotal: string | null;
  /** Start a card charge (with its 5-second bar) or a wallet one (straight away: its sheet is the confirmation). Only from idle. */
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
  /**
   * The fresh CARD order raised for this press asks other cents than the
   * chosen row's price AT THE PRESS (FUT-4416): it is never charged, and the
   * list says the payment did not go through. Judged once, against the cents
   * frozen when `send` ran — a re-price by the host while a charge is out
   * never reaches a charge already under way.
   */
  mismatched: boolean;
}

/** What `send` decided to charge: the held order it reused, or a fresh one replacing `replace`, owed `cents` (frozen at the press). */
type ChargeIntent = { reuse: CheckoutOrder } | { replace: CheckoutOrder | null; cents: number | undefined };

/**
 * A held CARD order still awaiting payment AND priced as the buyer now sees —
 * reusable for the charge. A balance ticked or unticked moves what the charge
 * asks for and not the order's total, so the amount due is compared too. A
 * way to pay with its own price (`own`) is judged by the cents it asks alone.
 */
function reusable(order: CheckoutOrder | null, cartTotal: string, dueCents: number | undefined, own: number | undefined): boolean {
  if (order?.method !== "CARD" || order.status !== "AWAITING_PAYMENT") return false;
  const asked = order.amountDueCents ?? order.totalCents;
  if (own !== undefined) return asked === own;
  if (order.totalLabel !== cartTotal) return false;
  return dueCents === undefined || asked === dueCents;
}

/** The price a press is judged and raised by (FUT-4416): the wallets' for a wallet's sheet, the chosen row's otherwise. */
function pressPrice(ports: RaisePorts, wallet: boolean): { cents: number | undefined; pricedAs: CheckoutPricedAs | undefined } {
  const { priced, raiseAs } = ports;
  return wallet ? { cents: priced?.wallets, pricedAs: raiseAs?.wallets } : { cents: priced?.choice, pricedAs: raiseAs?.choice };
}

/**
 * An awaiting CARD order that asks the provider for nothing: a balance the host
 * holds covers it, and the host should have settled it (see `amountDueLabel`).
 * It is never charged.
 */
function owesNothing(order: CheckoutOrder | null): boolean {
  return order?.method === "CARD" && order.status === "AWAITING_PAYMENT" && order.amountDueCents === 0;
}

/** An awaiting CARD order that asks the provider for something: one a runner may charge. */
function owesCard(order: CheckoutOrder): boolean {
  return order.method === "CARD" && order.status === "AWAITING_PAYMENT" && !owesNothing(order);
}

/**
 * The order `send` meant — the one it reused, or the CARD order raised to
 * replace a stale one — or `mismatch` for a fresh order that does not ask the
 * cents the press was made for. Reads only the order and what `send` froze.
 */
function chargeTarget(order: CheckoutOrder | null, target: ChargeIntent | null): CheckoutOrder | "mismatch" | null {
  if (!order || !target || !owesCard(order)) return null;
  if ("reuse" in target) return target.reuse === order ? order : null;
  if (order === target.replace) return null;
  const asked = order.amountDueCents ?? order.totalCents;
  return target.cents !== undefined && asked !== target.cents ? "mismatch" : order;
}

/**
 * Back to the list when the press left nothing to charge: a raise that failed
 * (the step's error panel says why), or a held order that owes the provider
 * nothing — never charged, rather than waited on forever.
 */
function useSettleWhenNothingToCharge(phase: ListChargePhase, kind: ListChargeKind | null, ports: RaisePorts, settle: () => void): void {
  const { order, creating, createError } = ports;
  useEffect(() => {
    if (phase !== "sending" || creating) return;
    if ((!order && createError) || (kind === "CARD" && owesNothing(order))) settle();
  }, [phase, kind, creating, order, createError, settle]);
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
  // — any CARD order other than the stale one it replaced — and the cents the
  // press was made for, frozen here so no later render's prices can move them.
  const target = useRef<ChargeIntent | null>(null);
  const latest = useRef(ports);
  latest.current = ports;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPhase("idle");
    setKind(null);
    setPressedTotal(null);
  }, []);

  const send = useCallback((wallet: boolean) => {
    timer.current = null;
    // Checked again at the last moment: a hold raised between two renders
    // must not let the bar's own timer charge past it. A wallet's press is not
    // the bar's: its sheet is already open, and the block held it itself.
    if (!wallet && !allowed.current) return cancel();
    setPhase("sending");
    const { order, cartTotal, dueCents } = latest.current;
    const press = pressPrice(latest.current, wallet);
    if (reusable(order, cartTotal, dueCents, press.cents) && order) {
      target.current = { reuse: order };
      return;
    }
    // A wallet's sheet froze its own cents (`WalletSheet.cents`), and its runner judges them.
    target.current = { replace: order, cents: wallet ? undefined : press.cents };
    latest.current.setMethod("CARD");
    void latest.current.startPayment("CARD", undefined, press.pricedAs);
  }, [cancel]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const start = useCallback(
    (next: ListChargeKind, total: string) => {
      if (phaseRef.current !== "idle") return;
      const wallet = next !== "CARD";
      phaseRef.current = wallet ? "sending" : "counting";
      setKind(next);
      setPressedTotal(total);
      if (wallet) return send(true);
      setPhase("counting");
      timer.current = setTimeout(() => send(false), CHARGE_WINDOW_MS);
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

  const { order, creating } = ports;
  useSettleWhenNothingToCharge(phase, kind, ports, settle);

  const sending = phase === "sending" || phase === "waiting";
  const verdict = sending && !creating ? chargeTarget(order, target.current) : null;
  const mismatched = verdict === "mismatch";
  const chargeable = mismatched ? null : verdict;
  return { phase, kind, pressedTotal, start, cancel, setAllowed, accepted, settle, chargeable, mismatched };
}
