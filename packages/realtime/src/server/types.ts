/**
 * The server-half contract of `@12-apps/realtime/server` (12-16).
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, the same doctrine as
 * `@12-apps/report-builder/server`: this package must not take a web framework
 * as a dependency, so a route describes itself and an adapter
 * (`@12-apps/realtime/hono`) mounts it. The one twist realtime adds is that a
 * subscribe endpoint answers a long-lived STREAM, which no `{ status, body }`
 * shape can carry — so a handler may answer with a web-standard `Response`
 * instead, and the adapter returns it verbatim.
 */

/** One requested subscription: a known domain plus optional qualifiers. */
export interface EventsTopicSpec {
  domain: string;
  /** Qualifier segments narrowing the domain to one entity, possibly empty. */
  qualifiers: string[];
}

/**
 * A refusal the surface answers as-is — status and message chosen by whoever
 * threw it. Denials are deliberately UNWRAPPED on the wire (`{ error }`, never
 * `{ data }`): the success envelope is for payloads, and a denial has none.
 */
export class EventsDenial extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EventsDenial";
  }
}

/** Narrow an unknown thrown value to a denial this surface can answer. */
export function isEventsDenial(error: unknown): error is EventsDenial {
  return error instanceof EventsDenial;
}

/** What the host's `authorize` seam receives, per connection attempt. */
export interface EventsAuthorizeContext {
  /** Route params in the host adapter's spelling (e.g. `tenantSlug`). */
  params: Record<string, string | undefined>;
  /**
   * The vetted topic specs out of `?topics=` — already parsed, deduplicated,
   * capped and narrowed to the surface's declared domains, so authorization
   * never sees a name the registry does not know. Empty on a surface with
   * `topicsQuery: false`.
   */
  specs: readonly EventsTopicSpec[];
  /**
   * The raw request, when the adapter has one — for hosts whose authorization
   * reads cookies or headers (a seat cookie, a session). May be `undefined`
   * under a test harness that drives descriptors directly.
   */
  request?: Request;
}

/**
 * What authorization answers: who the caller is for accounting purposes, and
 * the FULLY-RESOLVED topic names this connection may hear.
 *
 * The resolved names are built by the host from ids IT resolved (tenant from
 * the path slug, user from the session, seat from the cookie) — never from
 * anything the client sent. That property is the whole security model of the
 * ticket transport: the gateway subscribes to exactly these names and decides
 * nothing (see `../core/ticket.ts`).
 */
export interface EventsAuthorization {
  /**
   * The connection-cap key: the tenant for a store surface, the user for an
   * account surface, the seat for a diner surface. Caps bound the subject that
   * could plausibly run away, so the host picks which id that is.
   */
  subjectId: string;
  /** Fully-qualified topic names, e.g. `tenant:<id>:kitchen:<station>`. */
  topics: readonly string[];
}

/** One subscribe surface: a pair of routes (stream + ticket) under one path. */
export interface EventsSurfaceConfig {
  /** Identifies the surface in logs and in the returned route list. */
  name: string;
  /**
   * The stream route's path relative to the host's mount, in `:param` syntax
   * — e.g. `/admin/:tenantSlug/realtime`. The ticket route is minted beside
   * it at `<path>/ticket`, which is the layout the browser client derives
   * (`ticketUrlFor` in the react half).
   */
  path: string;
  /** Subscribable domain names. Deny-by-default: anything else is a 400. */
  domains: readonly string[];
  /**
   * Which of `domains` may carry QUALIFIER segments (`kitchen:<stationId>`).
   * Deny-by-default and empty by default: a qualifier on any other domain is a
   * 400 before `authorize` runs.
   *
   * This exists because a qualifier is the ONE part of a topic that comes from
   * the client. Everything else about a resolved name is built by the host from
   * ids it resolved itself — the tenant from the path, the user from the session
   * — which is what makes the subscribe surface tenant-safe. A qualifier is
   * different: it is attacker-controlled text that the host is then expected to
   * authorize, and future-pay's kitchen station reach is exactly that check.
   *
   * A domain that has no qualified form must therefore never receive one, and
   * "must never" is worth more as a structural refusal than as a rule in a
   * docstring: an `authorize` seam written for `orders` (store-wide, unqualified)
   * that is one day handed `orders:<someOtherTenantsOrderId>` would be reading a
   * qualifier it never expected. Listing the qualified domains means the surface
   * states which seams have to think about it, and the rest cannot be asked to.
   */
  qualifiedDomains?: readonly string[];
  /**
   * Whether the surface reads `?topics=` at all. `false` is the seat-scoped
   * shape (one caller, one topic, nothing to choose): `authorize` receives no
   * specs and derives everything. Default `true`.
   */
  topicsQuery?: boolean;
  /** Upper bound of `?topics=` entries per connection. Default 8. */
  maxTopicsPerConnection?: number;
  /** The host's authorization — throw {@link EventsDenial} to refuse. */
  authorize(context: EventsAuthorizeContext): Promise<EventsAuthorization>;
  /** The 429 message when the subject is at its connection cap. */
  tooManyMessage?: string;
}

/** What a route handler receives from the adapter. */
export interface EventsRequestContext {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  request?: Request;
}

/** What a route handler answers. */
export type EventsRouteResult =
  /** An ordinary JSON answer; the adapter serializes body at that status. */
  | { status: number; body: unknown }
  /** A live stream; the adapter returns the `Response` untouched. */
  | { response: Response };

/** A framework-neutral route descriptor. */
export interface EventsRoute {
  method: "GET" | "POST";
  /** Path relative to the host's mount, `:param` syntax. */
  path: string;
  /** Which surface this route belongs to. */
  surface: string;
  /**
   * `stream` handlers may answer `{ response }`; `json` handlers never do.
   * Adapters that cannot stream can refuse to mount `stream` routes loudly.
   */
  kind: "stream" | "json";
  handle(context: EventsRequestContext): Promise<EventsRouteResult>;
}

