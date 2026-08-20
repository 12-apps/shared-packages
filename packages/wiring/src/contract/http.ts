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

/** One framework-neutral endpoint a package serves. */
export interface WireRoute<TActor = unknown> {
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
