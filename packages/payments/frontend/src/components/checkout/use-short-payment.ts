import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 * Either one absent, the checkout client's own wire answers it (FUT-612:
 * the package wires, the host binds), at the routes the host configured —
 * `CheckoutTransport.shortPaymentRoutes`, or `<CheckoutFlow shortPaymentRoutes>`
 * when mounted by hand. A client with neither does not offer the action.
 */
export interface ShortPaymentPorts {
  /** Raise the balance order of a short-paid pedido; answered like `createOrder`. */
  payDifference?: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  /** Cancel and have the short capture returned; answers `/status`'s detail after it. */
  requestShortRefund?: (orderId: string) => Promise<Result<CheckoutStatusDetail>>;
}

/** The facts of one order, once a settled answer for it was read. */
interface KnownStatusFacts {
  orderId: string;
  shortfall?: PaymentShortfall;
  stockGone?: PaymentStockGone;
}

export function useShortPayment(
  ports: ShortPaymentPorts & { createOrder: (input: CreateOrderRequest) => Promise<CreateOrderResult> },
) {
  const [facts, setFacts] = useState<KnownStatusFacts | null>(null);
  const [busy, setBusy] = useState<"refund" | null>(null);
  // Why the last refund was not taken: the server's sentence, or the wire's own when offline.
  const [refundError, setRefundError] = useState<string | null>(null);
  // Set before the request, so a second tap dispatched before the re-render sends nothing.
  const refunding = useRef(false);
  // The difference being paid, in cents, from the press of "Pagar R$ X" on.
  const [payingCents, setPayingCents] = useState<number | null>(null);
  const paying = useRef(false);
  // The order whose difference is being paid, from the press of "Pagar R$ X" on.
  const differenceOf = useRef<string | null>(null);
  const client = useCheckoutClientApi();
  const { createOrder } = ports;
  const payDifference = useMemo(() => ports.payDifference ?? wiredPayDifference(client, differenceOf), [ports.payDifference, client]);
  const requestShortRefund = ports.requestShortRefund ?? client.requestShortRefund;

  const report: StatusFactsReporter = useCallback((orderId, detail) => {
    setFacts({ orderId, ...(detail.shortfall ? { shortfall: detail.shortfall } : {}), ...(detail.stockGone ? { stockGone: detail.stockGone } : {}) });
  }, []);

  // While a difference is being paid, the bar raises the BALANCE order.
  const routedCreateOrder = useCallback(
    (input: CreateOrderRequest) => (paying.current && payDifference ? payDifference(input) : createOrder(input)),
    [createOrder, payDifference],
  );

  const startDifference = useCallback((dueCents: number, orderId: string | null = null) => {
    differenceOf.current = orderId;
    paying.current = true;
    setPayingCents(dueCents);
  }, []);

  const refund = useCallback(
    async (orderId: string) => {
      if (!requestShortRefund || refunding.current) return;
      refunding.current = true;
      setBusy("refund");
      setRefundError(null);
      try {
        const answered = await requestShortRefund(orderId);
        if (answered.ok) report(orderId, answered.data);
        else setRefundError(answered.error);
      } finally {
        refunding.current = false;
        setBusy(null);
      }
    },
    [requestShortRefund, report],
  );

  return {
    facts,
    report,
    busy,
    refundError,
    payingCents,
    routedCreateOrder,
    startDifference,
    refund,
    canPayDifference: payDifference !== undefined,
    canRequestRefund: requestShortRefund !== undefined,
  };
}

/**
 * The client's own balance-order call as a `payDifference` port: the order is
 * the one whose "Pagar R$ X" was pressed, and a refusal keeps the server's
 * sentence and code, as `createOrder`'s does.
 */
function wiredPayDifference(
  client: ReturnType<typeof useCheckoutClientApi>,
  differenceOf: { current: string | null },
): ShortPaymentPorts["payDifference"] {
  const raise = client.payDifference;
  if (!raise) return undefined;
  return async (input: CreateOrderRequest): Promise<CreateOrderResult> => {
    const orderId = differenceOf.current;
    if (orderId === null) return { ok: false, error: { message: "", code: "ORDER_NOT_FOUND", field: null } };
    const answered = await raise({ orderId, method: input.method, ...(input.buyer.taxId ? { taxId: input.buyer.taxId } : {}) });
    if (answered.ok) return answered;
    return { ok: false, error: { message: answered.error, code: answered.code ?? "UNKNOWN", field: null } };
  };
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
