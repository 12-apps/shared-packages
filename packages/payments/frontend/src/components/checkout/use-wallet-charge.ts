import { useEffect, useState } from "react";

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
  pollError: string | null;
  /** The healthy-poll cap elapsed while still AWAITING (FUT-191). */
  pollTimedOut: boolean;
  /** Charge the wallet's key. The button calls this once the sheet resolves. */
  payWithKey(type: CheckoutWalletType, key: string): Promise<void>;
}

/**
 * Healthy-poll cap for the wallet AWAITING wait — the card path's own cap
 * (FUT-191): 36 polls ≈ 90 s at the 2500 ms default interval.
 */
const WALLET_AWAITING_POLL_CAP = 36;

/** The wallet charge state machine. See the module comment. */
export function useWalletCharge(
  order: CheckoutOrder,
  buyer: BuyerInfo,
  onResolved: (status: OrderStatus) => void,
  pollIntervalMs = 2500,
): WalletCharge {
  const [phase, setPhase] = useState<WalletPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const client = useCheckoutClientApi();
  const navigate = useCheckoutNavigate();

  const { status, error: pollError, timedOut: pollTimedOut } = usePaymentPolling(order.orderId, {
    enabled: phase === "polling",
    intervalMs: pollIntervalMs,
    maxHealthyPolls: WALLET_AWAITING_POLL_CAP,
  });

  useEffect(() => {
    if (status && status !== "AWAITING_PAYMENT") onResolved(status);
  }, [status, onResolved]);

  const payWithKey = async (type: CheckoutWalletType, key: string): Promise<void> => {
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
      return;
    }
    // A provider that demands its own page to finish (redirect 3-D Secure,
    // FUT-698): park the order and hand the buyer over, exactly as the card
    // path does. `phase` stays as-is — the tab is navigating away.
    if (charged.data.hostedCheckoutUrl) {
      rememberHostedOrder(order);
      navigate(charged.data.hostedCheckoutUrl);
      return;
    }
    // A business outcome (declined → FAILED) shows the status screen; an
    // accepted charge begins polling for the async confirmation.
    if (charged.data.status !== "AWAITING_PAYMENT") {
      onResolved(charged.data.status);
      return;
    }
    setPhase("polling");
  };

  return {
    phase,
    error,
    errorCode,
    unresolved: errorCode === UNRESOLVED_CODE,
    pollError,
    pollTimedOut,
    payWithKey,
  };
}
