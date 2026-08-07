import type { MerchantRef } from '../core/types';
import type { PaymentsHttpHandlers } from './handlers';
import {
  createMount,
  type MountedHandler,
  type MountRow,
  type PaymentsRouteContext,
} from './mount';
import {
  LIBRARY_ROUTES,
  type BuiltInRoute,
  type PaymentsIntentKind,
  type PaymentsRouteIntent,
  type PaymentsRouteMethod,
  type PaymentsRouteParams,
} from './route-table';

export type { PaymentsRouteContext } from './mount';

export type {
  PaymentsIntentKind,
  PaymentsRouteIntent,
  PaymentsRouteMethod,
  PaymentsRouteParams,
} from './route-table';

/**
 * `mountPayments` — one router in place of a hand-written route file per
 * handler (FUT-559).
 *
 * `createPaymentsHttp` gives a host plug-and-play `(Request, ctx) → Response`
 * handlers, but every adopter still wrote the same mounting triple over and
 * over: resolve the merchant → get the handlers → call the one handler this
 * path means. ADOPTING.md documented that as a table the adopter copied — a
 * dozen near-identical route files per host. This module turns the table into
 * data: the canonical layout (`./route-table.ts`) maps `(method, segments)`
 * to a library handler, and `mountPayments` returns catch-all
 * `{ GET, POST, PUT }` handlers that parse a request's segments into a
 * {@link PaymentsRouteIntent} and dispatch it.
 *
 * What stays the host's, by construction:
 *   - AUTH: `requireAuth` receives the PARSED intent and runs before any
 *     handler — return a `Response` to refuse, or throw and let the host's own
 *     error mapping answer. The library never reads a cookie or session.
 *   - MERCHANT ATTRIBUTION: `resolveMerchant` turns the authorized context
 *     into the `MerchantRef` every handler call is scoped to.
 *   - HOST-ONLY FLOWS: `extensions` add host intents (a verification-charge
 *     screen, a CSRF-state mint) to the same parse → auth → dispatch path, so
 *     one dispatcher serves the whole subtree.
 *
 * Provider-agnostic on purpose: the provider is a path capture handed through
 * to the handlers, so PagBank, InfinitePay, Stone and Stripe all route through
 * the same table — adding a vendor changes nothing here.
 */

/** Everything a host extension handler is given. */
export interface PaymentsRouteExtensionArgs<A> {
  request: Request;
  intent: PaymentsRouteIntent;
  /** Whatever `requireAuth` returned. */
  auth: A;
  merchant: MerchantRef;
  http: PaymentsHttpHandlers;
}

/**
 * A host-owned intent served through the same parse → auth → dispatch path as
 * the built-ins. `pattern` is absolute (mount prefix included), one entry per
 * literal segment; `:name` captures a segment into the intent (`:provider`
 * lands on `intent.provider`).
 */
export interface PaymentsRouteExtension<A> {
  kind: string;
  method: PaymentsRouteMethod;
  pattern: readonly string[];
  handler: (args: PaymentsRouteExtensionArgs<A>) => Promise<Response>;
}

export interface MountPaymentsOptions<A> {
  /**
   * The built HTTP surface — the object `createPaymentsHttp` returned, or a
   * lazy getter for hosts that build it once per process.
   */
  gateway:
    | PaymentsHttpHandlers
    | (() => PaymentsHttpHandlers | Promise<PaymentsHttpHandlers>);
  /**
   * Host auth, run BEFORE any handler with the parsed intent. Return a
   * `Response` to refuse the request outright; any other value is the host's
   * authorization context, handed to `resolveMerchant` and to extensions. A
   * throw propagates to the host's own error mapping.
   */
  requireAuth: (
    request: Request,
    intent: PaymentsRouteIntent,
  ) => A | Response | Promise<A | Response>;
  /** Merchant attribution from the authorized context. */
  resolveMerchant: (
    auth: A,
    intent: PaymentsRouteIntent,
  ) => MerchantRef | Promise<MerchantRef>;
  /**
   * Segments the mount point itself already consumed. A catch-all mounted at
   * `.../payments/settings/providers/*` passes `['settings', 'providers']`, so
   * the canonical table matches the request's remainder unchanged.
   */
  prefix?: readonly string[];
  /**
   * Built-in intents this mount must NOT serve. `completeOAuth` is the
   * canonical case: a host whose OAuth callback validates the CSRF state
   * elsewhere must not expose code-spending as a plain authed endpoint.
   */
  exclude?: readonly PaymentsIntentKind[];
  /** Host-owned intents dispatched through the same path. */
  extensions?: readonly PaymentsRouteExtension<A>[];
  /** The name of the catch-all segment param in the host's params. */
  segmentsParam?: string;
  /** Host-shaped 404, when the host has a house body to match. */
  notFound?: () => Response;
  /** Host-shaped 405; `allow` is the `Allow` list the response must carry. */
  methodNotAllowed?: (allow: readonly string[]) => Response;
}

/** What `mountPayments` returns: handlers for a catch-all segment route. */
export interface MountedPaymentsRoutes {
  GET: MountedHandler;
  POST: MountedHandler;
  PUT: MountedHandler;
  /**
   * `OPTIONS`, answered from the table: 204 with the PER-PATH `Allow` list
   * for a resolvable path, the mount's 404 otherwise — so a collapsed subtree
   * keeps advertising exactly the verbs each path actually serves, as the
   * per-file layout did. Never dispatches, never authenticates.
   */
  OPTIONS: MountedHandler;
  /**
   * The shared verb-miss handler, for verbs the table never serves (a host
   * exports it as `DELETE`/`PATCH`/…): per-path 405 + `Allow` when the path
   * exists at another verb, the mount's 404 otherwise. Never dispatches.
   */
  miss: MountedHandler;
  /**
   * Resolve WITHOUT dispatching: the static 404/405 a (method, path) pair
   * would answer, or null when a real handler would run. Lets a host give
   * unresolvable requests their answer before its own middleware (e.g. an
   * impersonation gate) — those answers read nothing and change nothing, so
   * they carry no privilege.
   */
  preflight: (
    method: PaymentsRouteMethod,
    context?: PaymentsRouteContext,
  ) => Promise<Response | null>;
}

/** A spec the dispatcher can serve — a built-in row or a host extension. */
type ServableRoute<A> =
  | { source: 'library'; route: BuiltInRoute }
  | { source: 'extension'; route: PaymentsRouteExtension<A> };

/** One dispatchable row: what `createMount` matches on, plus its spec. */
interface ServableRow<A> extends MountRow<PaymentsRouteMethod> {
  spec: ServableRoute<A>;
}

function intentFor(
  kind: string,
  method: PaymentsRouteMethod,
  segments: readonly string[],
  captures: Readonly<Record<string, string>>,
  params: PaymentsRouteParams,
): PaymentsRouteIntent {
  return {
    kind,
    method,
    segments,
    params,
    ...(captures.provider !== undefined ? { provider: captures.provider } : {}),
    ...(captures.chargeId !== undefined ? { providerChargeId: captures.chargeId } : {}),
  };
}

/**
 * Build the catch-all handlers. See the module doc for the contract; the
 * per-request order is fixed and load-bearing: parse -> `requireAuth` (which
 * may refuse) -> `resolveMerchant` -> the one handler the intent names.
 *
 * The parse/404/405/OPTIONS half is `createMount` (./mount.ts), shared with the
 * buyer-checkout mount so the two cannot answer an unresolvable path
 * differently. What stays here is the only part that is actually about THIS
 * surface: the auth-then-merchant order, and the built-in/extension split.
 */
export function mountPayments<A>(options: MountPaymentsOptions<A>): MountedPaymentsRoutes {
  const excluded = new Set<string>(options.exclude ?? []);
  const specs: ServableRoute<A>[] = [
    ...LIBRARY_ROUTES.filter((route) => !excluded.has(route.kind)).map(
      (route) => ({ source: 'library', route }) as const,
    ),
    ...(options.extensions ?? []).map((route) => ({ source: 'extension', route }) as const),
  ];
  const getHttp = async (): Promise<PaymentsHttpHandlers> =>
    typeof options.gateway === 'function' ? options.gateway() : options.gateway;

  const mount = createMount<PaymentsRouteMethod, ServableRow<A>>({
    // Flattened to the row shape the dispatcher matches on, with the spec
    // carried alongside — the dispatcher must not know what a "built-in" is.
    rows: specs.map((spec) => ({
      kind: spec.route.kind,
      method: spec.route.method,
      pattern: spec.route.pattern,
      spec,
    })),
    verbs: ['GET', 'POST', 'PUT'],
    prefix: options.prefix,
    segmentsParam: options.segmentsParam,
    notFound: options.notFound,
    methodNotAllowed: options.methodNotAllowed,
    dispatch: async ({ row, request, captures, segments, params }) => {
      const intent = intentFor(row.kind, row.method, segments, captures, params);
      // The host refuses BEFORE any handler runs - that is the contract.
      const auth = await options.requireAuth(request, intent);
      if (auth instanceof Response) return auth;
      const merchant = await options.resolveMerchant(auth, intent);
      const http = await getHttp();
      if (row.spec.source === 'extension') {
        return row.spec.route.handler({ request, intent, auth, merchant, http });
      }
      return row.spec.route.dispatch(http, request, { merchant }, intent);
    },
  });

  return {
    GET: mount.handler('GET'),
    POST: mount.handler('POST'),
    PUT: mount.handler('PUT'),
    OPTIONS: mount.OPTIONS,
    miss: mount.miss,
    preflight: mount.preflight,
  };
}
