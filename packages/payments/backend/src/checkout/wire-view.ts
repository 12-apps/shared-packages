import { createPaymentFlowsBE, type PaymentFlowsBE, type PaymentFlowsBEConfig } from './factory';

/**
 * The COUNTABLE view of the buyer-checkout surface — the sibling of
 * `../http/wire-view`, over the mount whose `layout` is already data and
 * whose per-kind handlers already dispatch without re-matching. The two
 * surfaces stay two views on purpose: every row here runs as the BUYER, and
 * the mount module's own doc argues why the tables must never merge — a new
 * row must never widen an existing mount's privilege.
 */

/** Twin of the wiring contract's parsed request (raw request included). */
export interface CheckoutWireRequest {
  actor: unknown;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  request?: Request;
}

/** Twin of the contract's route descriptor, answering the raw half. */
export interface CheckoutWireRoute {
  method: 'GET' | 'POST';
  path: string;
  handle(request: CheckoutWireRequest): Promise<{ response: Response } | { status: number; body: unknown }>;
}

/** What `create` hands the aggregate: the flows, plus the countable rows. */
export interface WirePaymentFlows extends PaymentFlowsBE {
  routes: readonly CheckoutWireRoute[];
}

/**
 * `createPaymentFlowsBE`, its layout re-shaped for the aggregate. Each
 * descriptor delegates to the flows' own per-kind handler — dispatch by
 * KIND, never by re-derived path, so the view and the mount cannot disagree
 * about which money rule a URL runs.
 */
export function createWirePaymentFlows<Caller, View extends object, Display = unknown>(
  config: PaymentFlowsBEConfig<Caller, View, Display>,
): WirePaymentFlows {
  const flows = createPaymentFlowsBE(config);
  const routes = flows.layout.map((spec): CheckoutWireRoute => {
    return {
      method: spec.method,
      path: `/${spec.pattern.join('/')}`,
      async handle(request) {
        if (request.request === undefined) {
          return { status: 500, body: { error: 'checkout routes need the raw request' } };
        }
        const response = await flows.handlers[spec.kind](request.request, {
          params: request.params,
        });
        return { response };
      },
    };
  });
  return { ...flows, routes };
}
