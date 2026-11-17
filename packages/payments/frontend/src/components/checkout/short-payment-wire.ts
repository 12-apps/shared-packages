/**
 * The wire of option C's two acts (FUT-612): pay only the difference of a
 * short-paid order, or cancel it and have the capture returned.
 *
 * The package WIRES them; a host only says where its routes are, the same way
 * it already says where `/status` and `/charge` are (`baseUrl`). Without a
 * word from the host, both live under the checkout's own prefix.
 */

import { ok, type Result } from "../../result";

import { statusDetailOf, type CheckoutStatusDetail } from "./status-detail";
import type { CheckoutTransport, Envelope } from "./transport";
import type { CheckoutOrder, OrderStatus, PaymentMethod } from "./types";

/** The placeholder a route template names the order ref with. */
const SHORT_PAYMENT_REF = ":ref";

/**
 * Where a short-paid order's two acts go: whole paths (never prefixed with
 * `baseUrl`), each holding {@link SHORT_PAYMENT_REF} where the order ref goes.
 */
export interface ShortPaymentRoutes {
  /** `POST { method, taxId? }`, answered `{ data: <the balance order> }`. Default `<baseUrl>/orders/:ref/pay-difference`. */
  payDifference?: string;
  /** `POST`, answered like `/status` (`{ data: <status>, ...facts }`). Default `<baseUrl>/orders/:ref/short-refund`. */
  refund?: string;
}

/** What the balance order is raised with: the order, the method, and the buyer's document when one was asked. */
export interface PayDifferenceInput {
  orderId: string;
  method: PaymentMethod;
  taxId?: string;
}

/** The transport's routes, each defaulted under its `baseUrl`. */
function shortPaymentRoutesOf(transport: Pick<CheckoutTransport, "baseUrl" | "shortPaymentRoutes">): Required<ShortPaymentRoutes> {
  const base = `${transport.baseUrl ?? "/api/checkout"}/orders/${SHORT_PAYMENT_REF}`;
  return {
    payDifference: transport.shortPaymentRoutes?.payDifference ?? `${base}/pay-difference`,
    refund: transport.shortPaymentRoutes?.refund ?? `${base}/short-refund`,
  };
}

/** A route template with the order ref in place. */
function routeFor(template: string, ref: string): string {
  return template.split(SHORT_PAYMENT_REF).join(encodeURIComponent(ref));
}

type RequestAt = <T>(transport: CheckoutTransport, url: string, init?: RequestInit) => Promise<Result<Envelope<T>>>;

/** The two calls, bound to one transport. */
export function shortPaymentCalls(
  transport: CheckoutTransport,
  requestAt: RequestAt,
): {
  payDifference(input: PayDifferenceInput): Promise<Result<CheckoutOrder>>;
  requestShortRefund(ref: string): Promise<Result<CheckoutStatusDetail>>;
} {
  return {
    payDifference: async (input) => {
      const body = JSON.stringify({ method: input.method, ...(input.taxId ? { taxId: input.taxId } : {}) });
      const url = routeFor(shortPaymentRoutesOf(transport).payDifference, input.orderId);
      const answered = await requestAt<CheckoutOrder>(transport, url, { method: "POST", body });
      return answered.ok ? ok(answered.data.data) : answered;
    },
    requestShortRefund: async (ref) => {
      const url = routeFor(shortPaymentRoutesOf(transport).refund, ref);
      const answered = await requestAt<OrderStatus>(transport, url, { method: "POST" });
      return answered.ok ? ok(statusDetailOf(answered.data.data, answered.data)) : answered;
    },
  };
}
