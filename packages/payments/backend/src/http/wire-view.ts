import { LIBRARY_ROUTES } from './route-table';
import { mountPayments, type MountedPaymentsRoutes, type MountPaymentsOptions } from './router';

/**
 * The COUNTABLE view of the merchant-admin surface — the wiring contract's
 * `http` capability, restated structurally (this package imports nothing
 * from the contract; the compliance suite in the wiring package pins the
 * twins).
 *
 * `mountPayments` stays exactly what it is: the dispatcher, the 405/OPTIONS
 * contract, the parse → requireAuth → resolveMerchant → handler order. What
 * this view adds is the part a consumer could never COUNT off a catch-all:
 * one descriptor per served row, so `assemble()` can aggregate the surface
 * and `unclaimedRoutes()` can name the endpoint a host forgot — the exact
 * silent-404 class the contract exists to end. Each descriptor's handler
 * synthesizes the catch-all context from its own pattern and hands the RAW
 * request through: these handlers verify webhook signatures over the exact
 * bytes and answer provider-shaped bodies and redirects, so the raw halves
 * of the wire shapes are load-bearing, not convenience.
 */

/** Twin of the wiring contract's parsed request (raw request included). */
export interface PaymentsWireRequest {
  actor: unknown;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  request?: Request;
}

/** Twin of the contract's route descriptor, answering the raw half. */
export interface PaymentsWireRoute {
  method: 'GET' | 'POST' | 'PUT';
  /** Relative to the host's mount, `:param` form. */
  path: string;
  /** `webhook` on the provider callback; everything else is authenticated. */
  kind?: 'webhook';
  handle(request: PaymentsWireRequest): Promise<{ response: Response } | { status: number; body: unknown }>;
}

/** What `create` hands the aggregate: the mount, plus the countable rows. */
export interface WireMountedPayments extends MountedPaymentsRoutes {
  routes: readonly PaymentsWireRoute[];
}

interface CountableRow {
  kind: string;
  method: 'GET' | 'POST' | 'PUT';
  pattern: readonly string[];
}

function fillPattern(
  pattern: readonly string[],
  params: Record<string, string | undefined>,
): string[] {
  return pattern.map((segment) =>
    segment.startsWith(':') ? String(params[segment.slice(1)] ?? '') : segment,
  );
}

function asWireRoute<A>(
  row: CountableRow,
  options: MountPaymentsOptions<A>,
  mounted: MountedPaymentsRoutes,
): PaymentsWireRoute {
  const prefixLength = (options.prefix ?? []).length;
  const segmentsParam = options.segmentsParam ?? 'segments';
  return {
    method: row.method,
    path: `/${row.pattern.join('/')}`,
    ...(row.kind === 'handleWebhook' ? { kind: 'webhook' as const } : {}),
    async handle(request) {
      if (request.request === undefined) {
        // These handlers read bodies as bytes and answer raw Responses; an
        // adapter that dropped the request cannot be served a guess.
        return { status: 500, body: { error: 'payments routes need the raw request' } };
      }
      // The catch-all context, synthesized from THIS row's pattern: the
      // mount re-prepends its own prefix, so hand it the remainder.
      const segments = fillPattern(row.pattern, request.params).slice(prefixLength);
      const response = await mounted[row.method](request.request, {
        params: { ...request.params, [segmentsParam]: segments },
      });
      return { response };
    },
  };
}

/**
 * `mountPayments`, its served table re-shaped for the aggregate: the
 * built-ins minus the host's `exclude` list, plus the host's own
 * `extensions` — the same set the dispatcher serves, derived from the same
 * inputs, so the count and the mount cannot disagree.
 */
export function createWireMountPayments<A>(
  options: MountPaymentsOptions<A>,
): WireMountedPayments {
  const mounted = mountPayments(options);
  const excluded = new Set<string>(options.exclude ?? []);
  const rows: CountableRow[] = [
    ...LIBRARY_ROUTES.filter((route) => !excluded.has(route.kind)),
    ...(options.extensions ?? []),
  ];
  return { ...mounted, routes: rows.map((row) => asWireRoute(row, options, mounted)) };
}
