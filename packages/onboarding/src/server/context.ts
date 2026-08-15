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

/** Every user-facing string, pt-BR by default and overridable per host. */
export interface OnboardingMessages {
  /** `reset` refused because the deployment is not a development one. */
  resetUnavailable: string;
  /** The body is not one of the three operations. */
  invalidOperation: string;
  /** A feature key the host did not declare. */
  unknownFeature: string;
}

const DEFAULT_MESSAGES: OnboardingMessages = {
  // pt-BR, verbatim from the origin host's route (product copy never gets
  // "translated" while tidying code).
  resetUnavailable: "Reset de onboarding indisponível em produção.",
  invalidOperation: "Operação de onboarding inválida.",
  unknownFeature: "Recurso de onboarding desconhecido.",
};

export function messagesOf(config: OnboardingServerConfig): OnboardingMessages {
  return { ...DEFAULT_MESSAGES, ...config.messages };
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
  /** Override any user-facing string (pt-BR defaults). */
  messages?: Partial<OnboardingMessages>;
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
