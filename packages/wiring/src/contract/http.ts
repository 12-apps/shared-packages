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
}

/** What a handler answers; the host maps it onto its own response type. */
export interface WireResponse {
  status: number;
  /** `undefined` means NO body at all (204), which is not the same as `null`. */
  body: unknown;
}

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

/** One framework-neutral endpoint a package serves. */
export interface WireRoute<TActor = unknown> extends WireRoutePolicy {
  method: WireHttpMethod;
  /**
   * Path relative to the host's mount for this package, in `:param` form.
   * The host maps the syntax; the SHAPE is fixed because the package's own
   * client builds these URLs.
   */
  path: string;
  handle(request: WireRequest<TActor>): Promise<WireResponse>;
}

/**
 * The producer side of the capability: the package's existing `createApi*`
 * factory, unchanged. Config is the package's own vocabulary — required
 * fields, no defaults, asserted at assembly (the report-builder doctrine).
 */
export interface HttpContribution<TConfig, TActor = unknown> {
  create(config: TConfig): { routes: readonly WireRoute<TActor>[] };
}

/**
 * One route after adoption: which package it came from, where the host
 * mounted it, and the descriptor itself. What `assemble()` aggregates.
 */
export interface MountedRoute {
  /** The owning package's name, for conflict reports and wiring audits. */
  packageName: string;
  /** The host prefix this package's routes hang under (`/api/admin/:tenantSlug`). */
  mountPath: string;
  route: WireRoute<never>;
}
