import { useCallback, useEffect, useRef, useState } from "react";

import type { PaymentShortfall, PaymentStockGone } from "@12-apps/payments-backend";

import type { Result } from "../../result";

import { useCheckoutClientApi } from "./client-context";
import type { StatusFactsReporter } from "./status-facts-context";
import type { CheckoutStatusDetail } from "./status-detail";
import type { CreateOrderRequest, CreateOrderResult, OrderStatus } from "./types";

/**
 * Option C inside `<CheckoutFlow>` (FUT-612): what a settled `/status` said
 * about the money, and the buyer's two acts on a short capture.
 *
 * The flow owns the whole of it, so a host only BINDS two routes:
 *
 *  - `payDifference` raises the balance order — the same pedido, its amount the
 *    difference — exactly as `createOrder` raises a first one. "Pagar R$ X"
 *    takes the buyer back to the flow's own Pagamento step, with the
 *    difference on its bar, and the next press of the bar raises through
 *    `payDifference` instead of `createOrder`: Pix or card, the same panes, the
 *    same waits (decision 1).
 *  - `requestShortRefund` asks for the capture back and answers the status
 *    detail after it, which the screen then shows (refunded, or on its way).
 *
 * Either one absent, its action is not offered.
 */
export interface ShortPaymentPorts {
  /** Raise the balance order of a short-paid pedido; answered like `createOrder`. */
  payDifference?: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  /** Cancel and have the short capture returned; answers `/status`'s detail after it. */
  requestShortRefund?: (orderId: string) => Promise<Result<CheckoutStatusDetail>>;
}

/** The facts of one order, once a settled answer for it was read. */
export interface KnownStatusFacts {
  orderId: string;
  shortfall?: PaymentShortfall;
  stockGone?: PaymentStockGone;
}

export function useShortPayment(
  ports: ShortPaymentPorts & { createOrder: (input: CreateOrderRequest) => Promise<CreateOrderResult> },
) {
  const [facts, setFacts] = useState<KnownStatusFacts | null>(null);
  const [busy, setBusy] = useState<"refund" | null>(null);
  // The difference being paid, in cents, from the press of "Pagar R$ X" on.
  const [payingCents, setPayingCents] = useState<number | null>(null);
  const paying = useRef(false);
  const { createOrder, payDifference, requestShortRefund } = ports;

  const report: StatusFactsReporter = useCallback((orderId, detail) => {
    setFacts({ orderId, ...(detail.shortfall ? { shortfall: detail.shortfall } : {}), ...(detail.stockGone ? { stockGone: detail.stockGone } : {}) });
  }, []);

  // While a difference is being paid, the bar raises the BALANCE order.
  const routedCreateOrder = useCallback(
    (input: CreateOrderRequest) => (paying.current && payDifference ? payDifference(input) : createOrder(input)),
    [createOrder, payDifference],
  );

  const startDifference = useCallback((dueCents: number) => {
    paying.current = true;
    setPayingCents(dueCents);
  }, []);

  const refund = useCallback(
    async (orderId: string) => {
      if (!requestShortRefund) return;
      setBusy("refund");
      const answered = await requestShortRefund(orderId);
      setBusy(null);
      if (answered.ok) report(orderId, answered.data);
    },
    [requestShortRefund, report],
  );

  return { facts, report, busy, payingCents, routedCreateOrder, startDifference, refund };
}

export type ShortPayment = ReturnType<typeof useShortPayment>;

/**
 * Ask `/status` ONCE for the facts of a settled order the flow has no facts
 * for — a card refused or captured short in the charge's own answer, which no
 * poll read. A Pix's own poll already reported them from its last answer, so
 * this costs nothing there; a decline costs one read, once per screen.
 */
export function useFactsOnSettle(input: {
  orderId: string | null;
  status: OrderStatus | null;
  onStatusStep: boolean;
  short: ShortPayment;
}): void {
  const { orderId, status, onStatusStep, short } = input;
  const client = useCheckoutClientApi();
  const known = short.facts?.orderId === orderId;
  const settledShort = status === "FAILED" || status === "EXPIRED";
  const { report } = short;
  useEffect(() => {
    if (!onStatusStep || !orderId || !settledShort || known || !client.getStatusDetail) return undefined;
    let live = true;
    void client.getStatusDetail(orderId).then((answered) => {
      if (live && answered.ok) report(orderId, answered.data);
    });
    return () => {
      live = false;
    };
  }, [onStatusStep, orderId, settledShort, known, client, report]);
}
