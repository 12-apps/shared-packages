import { useEffect, useState } from "react";

import { parkedBasket } from "./basket";
import type { ChallengeScope } from "./card-outcome";
import { useCheckoutClientApi } from "./client-context";
import { UNRESOLVED_CODE } from "./failure-codes";
import { rememberHostedOrder } from "./hosted-return";
import { useCheckoutNavigate } from "./navigate-context";
import type { BuyerInfo, CheckoutOrder, CheckoutWalletType, OrderStatus } from "./types";
import { usePaymentPolling } from "./use-payment-polling";

/**
 * The submit half of a WALLET payment (FUT-471/472) — `useCardSubmit`'s
 * sibling, minus everything a wallet does not have: no form to validate, no
 * instrument to mint per provider (the wallet key is chain-head-bound, see the
 * backend's `core/card-instrument.ts`), no vault opt-in. What remains is the
 * same money path: charge → classify the outcome → poll for the async
 * confirmation → bubble the terminal status up.
 *
 * One hook for BOTH wallets, because the wire is one shape — the buttons only
 * differ in how they acquire the key.
 */

/**
 * Where the wallet payment stands. `idle` renders the buttons and the card
 * form; anything else replaces them — a live "pay" control under a charge that
 * may already be holding the buyer's money is the double-payment invitation
 * the card view already refuses to render.
 */
export type WalletPhase = "idle" | "charging" | "polling";

/** Everything a wallet pane renders — state plus the one submit entry point. */
export interface WalletCharge {
  phase: WalletPhase;
  /** The refusal to show above the form, when the charge came back refused. */
  error: string | null;
  /** The refusal's machine code — an UNRESOLVED charge is not a decline. */
  errorCode: string | null;
  /** The charge is unresolved: no pay control may render (FUT-563). */
  unresolved: boolean;
  /**
   * The last status poll failed. TRANSIENT (FUT-1144): the wait carries on at a
   * backed-off cadence and this clears on the next success, so the pane shows
   * it as "still trying" beside {@link pollCheckAgain} rather than as an end.
   */
  pollError: string | null;
  /** The bounded AWAITING wait elapsed (FUT-191, now wall-clock — FUT-1144). */
  pollTimedOut: boolean;
  /** Ask now and restart the wait — the buyer's "verificar de novo". */
  pollCheckAgain: () => void;
  /**
   * Charge the wallet's key. The button calls this once the sheet resolves.
   * Resolves `true` when the charge was ACCEPTED — paid, confirming, or
   * handed to the provider's page — and `false` on a refusal or decline, so a
   * sheet that must be completed with a status (Apple's) can be honest.
   */
  payWithKey(type: CheckoutWalletType, key: string): Promise<boolean>;
}

/**
 * The wallet AWAITING wait — the card path's own bound (FUT-191): 90 s, in WALL
 * TIME rather than healthy polls (FUT-1144, and see `CARD_AWAITING_WAIT_MS` for
 * why a count of the polls that SUCCEEDED cannot bound a wait that is failing).
 */
const WALLET_AWAITING_WAIT_MS = 90_000;

/**
 * Park the order before the tab leaves, WITH the store and the basket
 * (FUT-1240).
 *
 * Both absences are read as "no opinion" by the resume — `belongsHere` passes
 * a slug-less entry at any store and the basket rule passes a basket-less one
 * against any basket — so a wallet's 3-D Secure hand-off that named neither
 * resumed over whatever checkout mounted next. The card path has carried these
 * since FUT-1213; this call site is the one that did not.
 */
function parkForHandover(order: CheckoutOrder, scope: ChallengeScope): void {
  const basket = parkedBasket(scope.basket);
  rememberHostedOrder(order, {
    ...(scope.tenantSlug === undefined ? {} : { tenantSlug: scope.tenantSlug }),
    ...(basket === undefined ? {} : { basket }),
    handoff: true,
  });
}

/** The wallet charge state machine. See the module comment. */
export function useWalletCharge(
  order: CheckoutOrder,
  buyer: BuyerInfo,
  onResolved: (status: OrderStatus) => void,
  pollIntervalMs = 2500,
  /** WHOSE store and WHICH basket — see {@link parkForHandover} (FUT-1240). */
  scope: ChallengeScope = {},
): WalletCharge {
  const [phase, setPhase] = useState<WalletPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const client = useCheckoutClientApi();
  const navigate = useCheckoutNavigate();

  const {
    status,
    error: pollError,
    timedOut: pollTimedOut,
    checkAgain: pollCheckAgain,
  } = usePaymentPolling(order.orderId, {
    enabled: phase === "polling",
    intervalMs: pollIntervalMs,
    maxWaitMs: WALLET_AWAITING_WAIT_MS,
  });

  useEffect(() => {
    if (status && status !== "AWAITING_PAYMENT") onResolved(status);
  }, [status, onResolved]);

  const payWithKey = async (type: CheckoutWalletType, key: string): Promise<boolean> => {
    setError(null);
    setErrorCode(null);
    setPhase("charging");

    const charged = await client.chargeWallet({
      orderId: order.orderId,
      wallet: { type, key },
      // The CPF the Dados step collected — the provider's required-field gate
      // reads it from the charge, the payable row has nowhere to keep it.
      taxId: buyer.taxId,
    });
    if (!charged.ok) {
      setError(charged.error);
      setErrorCode(charged.code ?? null);
      // Back to idle — but an UNRESOLVED code sets `unresolved`, and the pane
      // reads that as "render NO pay control" (FUT-563): some provider may be
      // holding the money, and a live button under "não pague de novo" is what
      // the buyer's thumb reaches for.
      setPhase("idle");
      return false;
    }
    // A provider that demands its own page to finish (redirect 3-D Secure,
    // FUT-698): park the order and hand the buyer over, exactly as the card
    // path does. `phase` stays as-is — the tab is navigating away.
    if (charged.data.hostedCheckoutUrl) {
      parkForHandover(order, scope);
      navigate(charged.data.hostedCheckoutUrl);
      return true;
    }
    // A business outcome (declined → FAILED) shows the status screen; an
    // accepted charge begins polling for the async confirmation.
    if (charged.data.status !== "AWAITING_PAYMENT") {
      onResolved(charged.data.status);
      return charged.data.status === "PAID";
    }
    setPhase("polling");
    return true;
  };

  return {
    phase,
    error,
    errorCode,
    unresolved: errorCode === UNRESOLVED_CODE,
    pollError,
    pollTimedOut,
    pollCheckAgain,
    payWithKey,
  };
}
