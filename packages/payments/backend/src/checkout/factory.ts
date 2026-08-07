import type { MerchantRef } from '../core/types';
import { createMount, type MountedHandler, type PaymentsRouteContext } from '../http/mount';
import type { PaymentsRouteParams } from '../http/route-table';

import { chargeInstrument, createCheckout } from './flows-charge';
import { getCheckoutConfig, getStatus, listInstruments, refreshBrowserKey } from './flows-read';
import { CHECKOUT_ROUTES } from './route-table';
import { createRuntime, notConfigured, type PaymentFlowsBEConfig } from './runtime';
import type {
  CheckoutIntentKind,
  CheckoutRouteIntent,
  CheckoutRouteSpec,
  CheckoutPrincipal,
} from './types';

export type { PaymentFlowsBEConfig } from './runtime';

/**
 * `createPaymentFlowsBE` — the buyer-checkout backend, as a mount (FUT-740).
 *
 * The merchant-admin surface has been one line (`mountPayments`) since FUT-559.
 * The BUYER's half was not: every adopter wrote its own create-checkout,
 * charge-card, poll-status and refresh-key routes, and with them its own copy of
 * the money rules underneath — per-attempt idempotency keys, the `--` reference
 * convention, charge-identity fail-closed, PIX re-tap reuse, the REDIRECT
 * commit-on-mint rule, the captured-amount rule, and the ORDER in which a
 * failure is worded. Those are not host decisions. They are the rules that stop
 * a buyer being charged twice, and every host that re-derived them got at least
 * one of them wrong at least once.
 *
 * So they live here, reachable only through this mount, and what stays a host's
 * is exactly what a library cannot know: who the caller is, what a payable IS,
 * what confirming one means in the host's own transaction, where a vault token
 * is kept, which providers can mint a browser key, and what sentence a buyer
 * reads. Each of those is a port; none of them is a money rule.
 */

export interface PaymentFlowsBE {
  /** The one-line mount: `export const { GET, POST } = routes`. */
  GET: MountedHandler;
  POST: MountedHandler;
  OPTIONS: MountedHandler;
  miss: MountedHandler;
  preflight(
    method: 'GET' | 'POST',
    context?: PaymentsRouteContext,
  ): Promise<Response | null>;
  /**
   * One handler per kind, for a host whose router — or whose own static gates —
   * needs a literal file per URL.
   *
   * `export const GET = routes.handlers.getStatus` is still a mount: it carries
   * no logic. It exists because a repo can have a scanner that resolves each
   * advertised tool path to a real route file, and a catch-all makes every one
   * of those paths unresolvable. Collapsing six files to six ONE-LINE files is
   * the honest outcome there; a host without such a gate gets the true
   * one-liner from `GET`/`POST` above.
   */
  handlers: Readonly<Record<CheckoutIntentKind, MountedHandler>>;
  /** The table as data, so a host can assert its own URL map against it. */
  layout: readonly CheckoutRouteSpec[];
}

/** A refusal short-circuit, or the caller the flows run as. */
type Authorized<Caller> = { caller: Caller } | { response: Response };

function intentFor(
  spec: CheckoutRouteSpec,
  segments: readonly string[],
  params: PaymentsRouteParams,
): CheckoutRouteIntent {
  return {
    kind: spec.kind,
    method: spec.method,
    principal: spec.principal,
    segments,
    params,
  };
}

/** Auth + dispatch for one resolved row — the half `mountedRoutes` calls back. */
type FlowRunner = (
  spec: CheckoutRouteSpec,
  request: Request,
  segments: readonly string[],
  params: PaymentsRouteParams,
) => Promise<Response>;

export function createPaymentFlowsBE<Caller, View extends object, Display = unknown>(
  config: PaymentFlowsBEConfig<Caller, View, Display>,
): PaymentFlowsBE {
  const runtime = createRuntime(config);
  const excluded = new Set<string>(config.exclude ?? []);
  const rows = CHECKOUT_ROUTES.filter((row) => !excluded.has(row.kind));

  /**
   * PUBLIC rows never reach `requireAuth`. See `route-table.ts`: the direction
   * of this decision is what keeps a host's branching mistake from making a
   * settling route anonymous.
   */
  const authorize = async (
    principal: CheckoutPrincipal,
    request: Request,
    intent: CheckoutRouteIntent,
  ): Promise<Authorized<Caller>> => {
    if (principal === 'PUBLIC') return { caller: null as Caller };
    const caller = await config.requireAuth(request, intent);
    if (caller instanceof Response) return { response: caller };
    return { caller };
  };

  const merchantFor = async (
    request: Request,
    intent: CheckoutRouteIntent,
    caller: Caller | null,
  ): Promise<Response | { merchant: MerchantRef }> => {
    const merchant = await config.resolveMerchant({ request, intent, caller });
    // FAILS CLOSED. A merchant the host could not attribute is not a merchant
    // whose buyer may be charged into some default account.
    if (!merchant) return notConfigured(runtime);
    return { merchant };
  };

  const run: FlowRunner = async (spec, request, segments, params) => {
    const intent = intentFor(spec, segments, params);
    const authorized = await authorize(spec.principal, request, intent);
    if ('response' in authorized) return authorized.response;
    const { caller } = authorized;

    switch (spec.kind) {
      case 'getCheckoutConfig': {
        const resolved = await merchantFor(request, intent, caller);
        return resolved instanceof Response
          ? resolved
          : getCheckoutConfig(runtime, resolved.merchant);
      }
      case 'listInstruments':
        // A merchant the host could not attribute lists NOTHING rather than
        // failing: an unscoped list would offer instruments no charge here
        // could use, which is the FUT-697 defect one layer up.
        return listInstruments(
          runtime,
          caller,
          await config.resolveMerchant({ request, intent, caller }),
        );
      case 'createCheckout':
        return createCheckout(runtime, request, caller, () =>
          merchantFor(request, intent, caller),
        );
      case 'chargeInstrument':
        return chargeInstrument(runtime, request, caller);
      case 'getStatus':
        return getStatus(runtime, request, caller);
      default:
        return refreshBrowserKey(runtime, request, caller);
    }
  };

  return { ...mountedRoutes(config, rows, run), layout: rows };
}

/**
 * The mount itself, plus the per-kind handlers. Split from the composition
 * above purely so each half stays inside the size gate.
 *
 * The per-kind handlers dispatch by KIND, not by path: a host mounting one of
 * them at its own literal URL has already decided which row this is, and
 * re-deriving it from segments would only let the two disagree.
 */
function mountedRoutes<Caller, View extends object, Display>(
  config: PaymentFlowsBEConfig<Caller, View, Display>,
  rows: readonly CheckoutRouteSpec[],
  run: FlowRunner,
): Omit<PaymentFlowsBE, 'layout'> {
  const served = new Set(rows.map((row) => row.kind));
  const mount = createMount<'GET' | 'POST', CheckoutRouteSpec & { spec: CheckoutRouteSpec }>({
    rows: rows.map((row) => ({ ...row, spec: row })),
    verbs: ['GET', 'POST'],
    prefix: config.prefix,
    segmentsParam: config.segmentsParam,
    notFound: config.notFound,
    methodNotAllowed: config.methodNotAllowed,
    dispatch: ({ row, request, segments, params }) => run(row.spec, request, segments, params),
  });

  const handlers = Object.fromEntries(
    CHECKOUT_ROUTES.map((spec) => [
      spec.kind,
      // An EXCLUDED kind falls through to the catch-all, which answers the 404
      // the row's absence means — a host must not get a working handler for a
      // row it asked this mount not to serve.
      served.has(spec.kind)
        ? async (request: Request, context?: PaymentsRouteContext) =>
            run(spec, request, spec.pattern, (await context?.params) ?? {})
        : mount.handler(spec.method),
    ]),
  ) as Record<CheckoutIntentKind, MountedHandler>;

  return {
    GET: mount.handler('GET'),
    POST: mount.handler('POST'),
    OPTIONS: mount.OPTIONS,
    miss: mount.miss,
    preflight: mount.preflight,
    handlers,
  };
}
