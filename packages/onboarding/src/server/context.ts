import type { OnboardingPrisma } from "../repository";

/**
 * What every route in the onboarding surface shares (12-23): the actor, the
 * request, the response envelope and the config seam. Mirrors the
 * report-builder / rbac shape — framework-neutral descriptors a small adapter
 * mounts (`@12-apps/onboarding/hono`).
 */

/**
 * What a host resolves before a request reaches these handlers: WHO is asking
 * and WHICH tenant the progress belongs to. Both are host vocabulary (session,
 * tenant slug, RBAC), and both are part of the row's identity — the composite
 * key is `(userId, clientId, featureKey)`, so the actor IS the isolation.
 */
export interface OnboardingActor {
  /** The host's DB user id (the origin host resolves it by email — the OAuth `sub` is not it). */
  userId: string;
  /** The tenant row id this progress is scoped to. */
  clientId: string;
}

/** One request, already authenticated and routed by the host. */
export interface OnboardingRequest {
  actor: OnboardingActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  /**
   * The language to answer this caller in, as a BCP-47 tag — the same field
   * `@12-apps/wiring`'s `WireRequest` carries, mirrored here because this
   * surface builds its own request shape.
   *
   * Populated by the host's adapter, which is the only layer that can negotiate
   * one. Absent is meaningful and not an error: a host with one audience never
   * sets it, and this package must then answer with the words it was configured
   * with rather than invent a language.
   */
  locale?: string;
}

/** What a handler answers with; the adapter maps this onto its response type. */
export interface OnboardingResponse {
  status: number;
  /** `undefined` means NO body at all (204) — not the same as `null`. */
  body: unknown;
}

export interface OnboardingRoute {
  method: "GET" | "PATCH";
  /** Path relative to the host's mount, in `:param` form. */
  path: string;
  handle(request: OnboardingRequest): Promise<OnboardingResponse>;
}

/** A typed refusal a handler throws; folded into a status + message body. */
export class OnboardingApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OnboardingApiError";
    this.status = status;
  }
}

/** Every user-facing string — REQUIRED host config; pt-BR ships as `./pt-BR`. */
export interface OnboardingMessages {
  /** `reset` refused because the deployment is not a development one. */
  resetUnavailable: string;
  /** The body is not one of the three operations. */
  invalidOperation: string;
  /** A feature key the host did not declare. */
  unknownFeature: string;
}

/**
 * What a copy field takes once its words can follow a reader.
 *
 * Declared here rather than imported from `@12-apps/i18n`: this package must
 * stay liftable into a repo that has never heard of it, so the two agree
 * STRUCTURALLY and nothing forces the dependency. The context is deliberately
 * loose — a raw tag off the wire, unnarrowed — because matching it is the host
 * resolver's job, not this package's.
 */
export type OnboardingCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
export type OnboardingCopySource<T> = T | OnboardingCopyResolver<T>;

/**
 * The messages in force, for the caller being answered right now.
 *
 * Call this where the sentence is USED, never once when the surface is built:
 * a factory that resolves and stores the result has re-frozen the language into
 * its mount, and a single-locale host cannot tell the difference. Every call
 * site here already had this shape, which is why adopting a resolver costs the
 * package one argument rather than a refactor.
 */
export function messagesOf(
  config: OnboardingServerConfig,
  locale?: string,
): OnboardingMessages {
  const source = config.messages;
  return typeof source === "function"
    ? (source as OnboardingCopyResolver<OnboardingMessages>)({ locale })
    : source;
}

export interface OnboardingServerConfig {
  /**
   * Lazily-resolved DB seam. A Prisma client satisfies the structural
   * {@link OnboardingPrisma} directly (one cast); a non-Prisma host implements
   * its four CLOSED delegate shapes (documented in `src/repository.ts`).
   */
  db: () => Promise<OnboardingPrisma>;
  /**
   * The guided features this host serves, e.g. `['ai_integration',
   * 'payments']`. Any other `featureKey` is a 404 — a typo'd key would
   * otherwise mint its own row and look like progress nobody can see. Omit to
   * accept ANY key (the origin host's original behaviour).
   */
  featureKeys?: readonly string[];
  /**
   * Whether the DEV-only `reset` operation is allowed. Default:
   * `process.env.NODE_ENV !== 'production'` — the same refusal the origin host's
   * route makes, kept as config so a host decides what "development" means.
   */
  resetEnabled?: () => boolean;
  /**
   * The refusal sentences this surface answers with — REQUIRED, the host's
   * words. A pt-BR host passes `PT_BR_ONBOARDING_MESSAGES` from `./pt-BR`,
   * which is verbatim what the origin host's route said; requiring it turns
   * that choice into a line in the host's diff instead of a silence.
   *
   * A host serving more than one language passes a RESOLVER instead — the
   * shape `@12-apps/i18n`'s `localeCopy(PACK)` returns — and the words are
   * then chosen per request from {@link OnboardingRequest.locale}. Passing a
   * plain value is unchanged in every respect, which is what keeps a
   * single-audience host from paying for a choice it never makes.
   */
  messages: OnboardingCopySource<OnboardingMessages>;
}

/** The `{ data }` success envelope (the report-builder / rbac house shape). */
export function ok(body: unknown): OnboardingResponse {
  return { status: 200, body: { data: body } };
}

/**
 * Map a thrown error onto a response. An {@link OnboardingApiError} carries its
 * own status; anything else is a bug and must keep propagating (the adapter
 * turns it into the host's 500), because swallowing it here would report a
 * broken write as a clean refusal.
 */
export function foldApiError(error: unknown): OnboardingResponse {
  if (error instanceof OnboardingApiError) {
    return { status: error.status, body: { error: error.message } };
  }
  throw error;
}
