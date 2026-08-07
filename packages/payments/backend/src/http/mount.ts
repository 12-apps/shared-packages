import { matchPattern, type PaymentsRouteParams } from './route-table';

/**
 * The DISPATCHER, with no table of its own (FUT-740).
 *
 * `mountPayments` grew this machinery for the merchant-admin surface: normalize
 * the catch-all segments, resolve `(method, segments)` against a pattern table,
 * answer an unresolvable path with a 404 or a per-path 405 + `Allow`, and hand
 * the matched row its request. `createPaymentFlowsBE` needs exactly the same
 * machinery over a DIFFERENT table.
 *
 * A second copy would have been the cheap move and the wrong one: the 405
 * `Allow` list, the `OPTIONS` shape and the preflight contract are behaviours
 * hosts observe, and two implementations of them drift silently — the second
 * table's mount would answer a wrong verb differently from the first for no
 * reason a reader could find. So the generic half lives here, once, and both
 * mounts instantiate it.
 *
 * WHY THE TABLES STAY SEPARATE is the other half of the decision, and it is a
 * privilege argument rather than a taste one: every row of `LIBRARY_ROUTES` is
 * merchant-admin, machine (webhook) or merchant-scoped, while every checkout
 * row is the BUYER. Merging them would mean an unprefixed `mountPayments` in
 * any host silently starts serving buyer checkout under the ADMIN's
 * `requireAuth` after a version bump, with `exclude` — an opt-OUT — as the only
 * remedy. A new row must never widen an existing mount's surface. They also
 * collide outright: `config` already means `getClientConfig` on the admin
 * table and means the buyer's whole-chain checkout config on the other.
 */

/** The host mount context: route params, promised (Next-style) or plain. */
export interface PaymentsRouteContext {
  params?: PaymentsRouteParams | PromiseLike<PaymentsRouteParams>;
}

export type MountedHandler = (
  request: Request,
  context?: PaymentsRouteContext,
) => Promise<Response>;

/** The least a dispatchable row must declare. */
export interface MountRow<M extends string> {
  kind: string;
  method: M;
  /** One entry per literal segment; `:name` captures one non-empty segment. */
  pattern: readonly string[];
}

interface MountConfig<M extends string, Row extends MountRow<M>> {
  rows: readonly Row[];
  /**
   * The verbs this mount serves, in the order an `Allow` header lists them.
   * `HEAD` is appended when `GET` is served and `OPTIONS` always, matching what
   * a per-file route layout produced.
   */
  verbs: readonly M[];
  /** Segments the mount point itself already consumed. */
  prefix?: readonly string[];
  /** The name of the catch-all segment param in the host's params. */
  segmentsParam?: string;
  notFound?: () => Response;
  methodNotAllowed?: (allow: readonly string[]) => Response;
  /** Run the matched row. Everything host-shaped happens in here. */
  dispatch: (args: {
    row: Row;
    request: Request;
    captures: Readonly<Record<string, string>>;
    segments: readonly string[];
    params: PaymentsRouteParams;
  }) => Promise<Response>;
}

interface MountedRoutes<M extends string> {
  /** The catch-all handler for one verb. */
  handler(method: M): MountedHandler;
  /**
   * `OPTIONS`, answered from the table: 204 with the PER-PATH `Allow` list for
   * a resolvable path, the mount's 404 otherwise — so a collapsed subtree keeps
   * advertising exactly the verbs each path actually serves, as the per-file
   * layout did. Never dispatches, never authenticates.
   */
  OPTIONS: MountedHandler;
  /**
   * The shared verb-miss handler, for verbs the table never serves (a host
   * exports it as `DELETE`/`PATCH`/…): per-path 405 + `Allow` when the path
   * exists at another verb, the mount's 404 otherwise. Never dispatches.
   */
  miss: MountedHandler;
  /**
   * Resolve WITHOUT dispatching: the static 404/405 a (method, path) pair would
   * answer, or null when a real handler would run. Lets a host give
   * unresolvable requests their answer before its own middleware (e.g. an
   * impersonation gate) — those answers read nothing and change nothing, so
   * they carry no privilege.
   */
  preflight(method: M, context?: PaymentsRouteContext): Promise<Response | null>;
}

/** The segments below the mount, however the host's router delivered them. */
function normalizeSegments(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') return value.split('/');
  return [...value];
}

function defaultNotFound(): Response {
  return new Response(
    JSON.stringify({ error: 'NotFound', message: 'No payments route matches this path' }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  );
}

function defaultMethodNotAllowed(allow: readonly string[]): Response {
  return new Response(
    JSON.stringify({ error: 'MethodNotAllowed', message: 'Wrong method for this path' }),
    { status: 405, headers: { 'content-type': 'application/json', allow: allow.join(', ') } },
  );
}

async function paramsOf(context: PaymentsRouteContext | undefined): Promise<PaymentsRouteParams> {
  if (!context?.params) return {};
  return await context.params;
}

/** Find the row serving (method, segments), or the verbs that DO serve it. */
function resolveRow<M extends string, Row extends MountRow<M>>(
  rows: readonly Row[],
  method: M,
  segments: readonly string[],
): { matched?: { row: Row; captures: Readonly<Record<string, string>> }; allowed: Set<M> } {
  const allowed = new Set<M>();
  let matched: { row: Row; captures: Readonly<Record<string, string>> } | undefined;
  for (const row of rows) {
    const captures = matchPattern(row.pattern, segments);
    if (!captures) continue;
    allowed.add(row.method);
    if (row.method === method && !matched) matched = { row, captures };
  }
  return { matched, allowed };
}

/** Build the catch-all handlers over one table. */
export function createMount<M extends string, Row extends MountRow<M>>(
  config: MountConfig<M, Row>,
): MountedRoutes<M> {
  const prefix = config.prefix ?? [];
  const segmentsParam = config.segmentsParam ?? 'segments';

  const allowListFor = (methods: ReadonlySet<M>): string[] => {
    const allow: string[] = config.verbs.filter((verb) => methods.has(verb));
    if (methods.has('GET' as M)) allow.push('HEAD');
    allow.push('OPTIONS');
    return allow;
  };

  const segmentsOf = async (context: PaymentsRouteContext | undefined): Promise<string[]> => {
    const params = await paramsOf(context);
    return [...prefix, ...normalizeSegments(params[segmentsParam])];
  };

  /** The 405 (path exists at another verb) or 404 a miss answers. */
  const staticAnswer = (allowed: ReadonlySet<M>): Response =>
    allowed.size > 0
      ? (config.methodNotAllowed ?? defaultMethodNotAllowed)(allowListFor(allowed))
      : (config.notFound ?? defaultNotFound)();

  // `resolveRow`'s `allowed` set is method-independent; the first verb only
  // names a lane for the (ignored) `matched` half.
  const allowedFor = async (context: PaymentsRouteContext | undefined): Promise<Set<M>> =>
    resolveRow(config.rows, config.verbs[0] as M, await segmentsOf(context)).allowed;

  return {
    handler: (method) => async (request, context) => {
      const params = await paramsOf(context);
      const segments = [...prefix, ...normalizeSegments(params[segmentsParam])];
      const { matched, allowed } = resolveRow(config.rows, method, segments);
      if (!matched) return staticAnswer(allowed);
      return config.dispatch({ ...matched, request, segments, params });
    },
    OPTIONS: async (_request, context) => {
      const allowed = await allowedFor(context);
      if (allowed.size === 0) return (config.notFound ?? defaultNotFound)();
      // The shape Next synthesised and the per-file layout answered with: an
      // empty 204 whose `Allow` names what THIS path serves.
      return new Response(null, {
        status: 204,
        headers: { allow: allowListFor(allowed).join(', ') },
      });
    },
    miss: async (_request, context) => staticAnswer(await allowedFor(context)),
    preflight: async (method, context) => {
      const { matched, allowed } = resolveRow(config.rows, method, await segmentsOf(context));
      return matched ? null : staticAnswer(allowed);
    },
  };
}
