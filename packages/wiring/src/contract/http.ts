/**
 * The HTTP capability: framework-neutral route descriptors.
 *
 * This is the shape `@12-apps/report-builder` and `@12-apps/entity-lifecycle`
 * already return from their `createApi*` factories — a method, a `:param`
 * path relative to the host's mount, and a handler from a parsed request to a
 * `{ status, body }` pair. It is restated here (not imported) so that a
 * package can declare routes without depending on any sibling, and so that
 * every package means the same thing by "a route" — the property
 * `McpEndpoint`'s own docstring names as the reason a shared shape exists.
 *
 * The existing descriptors satisfy this interface STRUCTURALLY: `ReportRoute`
 * is a `WireRoute<ReportActor>` with an extra `authoring` flag, which is fine
 * — the contract is a floor, not a ceiling.
 */

export type WireHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The parsed request a route handler receives. The host's adapter builds it —
 * one adapter per framework, never per package.
 */
export interface WireRequest<TActor = unknown> {
  /** Whoever the host resolved — shape is the package's to declare. */
  actor: TActor;
  /** Path params the host's router captured (`id`, `key`). */
  params: Record<string, string | undefined>;
  /** Query string, already parsed. */
  query: Record<string, string | undefined>;
  /** Parsed JSON body, for writes. */
  body?: unknown;
  /**
   * The language this reader is being answered in, as a BCP-47 tag.
   *
   * A package that states its copy as a required config field (the copy port's
   * doctrine) can only follow a reader if something tells it who is reading.
   * This is that something, and it belongs on the REQUEST rather than in the
   * mount config for the reason the whole seam exists: the mount happens once
   * per process and the language changes per caller.
   *
   * Populated by the host's adapter, which is the only layer that can negotiate
   * one — it holds the cookie, the header and whatever preference the reader
   * stored. This package deliberately does no negotiating and owns no tag list:
   * that is `@12-apps/i18n`'s job in the hosts that want it, and a package
   * reading a raw string here stays liftable into a repo that has never heard
   * of it.
   *
   * **Optional, and absent is meaningful.** An adapter that populates nothing
   * is not misconfigured — it is a host with one audience, and a package must
   * answer such a request with the copy it was configured with rather than
   * inventing a language. So a handler forwards this value as it found it,
   * `undefined` included, and lets the host's own resolver decide what no
   * answer means.
   */
  locale?: string;
  /**
   * The raw fetch `Request`, for the handlers the parsed fields cannot
   * serve: a webhook verifying a provider signature over the exact bytes,
   * an SSE stream reading `Last-Event-ID`, an OAuth callback echoing the
   * whole URL. The host's adapter populates it for `webhook` and `stream`
   * routes (and may for the rest); a JSON handler must not come to depend
   * on it, because `params`/`query`/`body` are the halves every adapter is
   * obliged to fill.
   */
  request?: Request;
}

/** What a handler answers; the host maps it onto its own response type. */
export interface WireResponse {
  status: number;
  /** `undefined` means NO body at all (204), which is not the same as `null`. */
  body: unknown;
}

/**
 * An answer the adapter must return UNTOUCHED: a live SSE stream, a redirect
 * whose headers are the payload, a provider-shaped webhook body. `{status,
 * body}` cannot say any of those — a serialized stream is a hung request and
 * a redirect with no `Location` is a dead end — so the raw form exists
 * beside it rather than growing header/stream fields the JSON case would
 * then have to ignore.
 */
export interface WireRawResponse {
  response: Response;
}

/**
 * What `handle` may answer. Discriminate on `status` (the JSON half) or
 * `response` (the raw half) — `wireAnswer` in the consumer's endpoint
 * primitives does exactly that, so an adapter never writes the branch by
 * hand.
 */
export type WireRouteAnswer = WireResponse | WireRawResponse;

/**
 * What kind of caller a route expects — the property the host's gates need
 * before they can guard it.
 *
 * - `authenticated` (the default) — behind the host's session/actor
 *   resolution and its RBAC.
 * - `webhook` — an unauthenticated provider callback, verified by signature
 *   inside the handler; must NOT sit behind tenant guards, must often see
 *   the raw body. A webhook route may not carry `permission` or
 *   `entitlement` — a plan gate on a provider callback drops money events.
 * - `public` — anonymous by design (a storefront read). May carry an
 *   `entitlement` (plan-gated but unauthenticated), never a `permission`.
 */
export type WireRouteKind = "authenticated" | "webhook" | "public";

/**
 * The policy half of a route: what the host's coverage gates today recover
 * by scanning route FILES for guard literals. Declared here, the gates can
 * consume the assembled table instead of the filesystem — which is what lets
 * a host register a package's routes wholesale rather than one thin file per
 * endpoint. Keys are the PACKAGE's vocabulary: `permission` must be one of
 * the package's own declared permission ids; `entitlement`/`quota` are
 * abstract plan-feature keys the host maps onto its billing catalog.
 */
export interface WireRoutePolicy {
  /** Defaults to `authenticated`. */
  kind?: WireRouteKind;
  /** Required permission id from this package's own permissions contribution. */
  permission?: string;
  /** Plan-feature key the host's entitlements must allow. */
  entitlement?: string;
  /** Plan-feature key whose QUOTA this call consumes (a create, typically). */
  quota?: string;
}

/**
 * One framework-neutral endpoint a package serves.
 *
 * `TAnswer` defaults to the JSON half, which is what every route was before
 * the raw form existed — so a package whose handlers only ever answer
 * `{status, body}` keeps the narrow contract (and its tests keep reading
 * `.status` off the promise) without saying anything. A package whose
 * handlers may answer raw declares `WireRoute<Actor, WireRouteAnswer>`; the
 * narrow form stays assignable to the wide one, which is why the AGGREGATE
 * (`MountedRoute`, the route table) is wide — after packages mix, only the
 * union is honest.
 */
export interface WireRoute<
  TActor = unknown,
  TAnswer extends WireRouteAnswer = WireResponse,
> extends WireRoutePolicy {
  method: WireHttpMethod;
  /**
   * Path relative to the host's mount for this package, in `:param` form.
   * The host maps the syntax; the SHAPE is fixed because the package's own
   * client builds these URLs.
   */
  path: string;
  /**
   * `stream` marks a handler whose answer stays OPEN — an SSE stream a
   * buffering adapter would turn into a request that never completes. The
   * default is `json`. An adapter that cannot stream must refuse to mount a
   * `stream` route loudly, never buffer it; a `json` route may still answer
   * the raw form (a redirect, a provider-shaped body), which any adapter
   * can return as-is.
   */
  transport?: "json" | "stream";
  /**
   * The trailing parameter that swallows the REST of the path, named.
   *
   * `path` is fixed in `:param` form and the host maps the syntax — which
   * works for every segment except the last one of a route that serves a
   * whole key space. `@12-apps/storage` serves objects at
   * `/uploads/local/products/<scope>/<uuid>/card-320.webp`: one parameter
   * holding four segments, which `:key` alone cannot express because the
   * adapter has already split the path by the time the handler sees it.
   *
   * Declared here as a NAME rather than as syntax, for the same reason `path`
   * is: `:key{.+}` is Hono's spelling, `*key` is Express's, and a package that
   * wrote either would be a package that had chosen the host's framework. The
   * host's adapter composes its own form from this name.
   *
   * Absent — the normal case — means every segment of `path` is literal or a
   * single-segment `:param`.
   *
   * An adapter that ignores this does not fail loudly: it registers the
   * prefix, and every request carrying a deeper key 404s. So an adapter
   * forwarding routes to a framework MUST read it, and the reference bridge
   * in the consumer harness does.
   */
  wildcardParam?: string;
  handle(request: WireRequest<TActor>): Promise<TAnswer>;
}

/**
 * The producer side of the capability: the package's existing `createApi*`
 * factory, unchanged. Config is the package's own vocabulary — required
 * fields, no defaults, asserted at assembly (the report-builder doctrine).
 */
export interface HttpContribution<TConfig, TActor = unknown> {
  create(config: TConfig): { routes: readonly WireRoute<TActor, WireRouteAnswer>[] };
}

/**
 * One route after adoption: which package it came from, where the host
 * mounted it, and the descriptor itself. What `assemble()` aggregates.
 * Wide by default: packages mix here, so only the full answer union is
 * honest about what `handle` may return.
 */
export interface MountedRoute<TAnswer extends WireRouteAnswer = WireRouteAnswer> {
  /** The owning package's name, for conflict reports and wiring audits. */
  packageName: string;
  /** The host prefix this package's routes hang under (`/api/admin/:tenantSlug`). */
  mountPath: string;
  route: WireRoute<never, TAnswer>;
}
