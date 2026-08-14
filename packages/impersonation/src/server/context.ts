import type { ImpersonationPathRules } from '../core/paths';
import type { ImpersonationCodec, ImpersonationTimeBoxConfig } from '../core/session';
import type { ImpersonationCookie } from '../core/types';

import type {
  ImpersonationAuditPort,
  ImpersonationDirectory,
  ImpersonationMintPolicy,
  PreviewEntitlementPort,
} from './ports';

/**
 * What a host resolves before a request reaches these handlers, what it lends
 * this surface, and the copy it puts in this surface's mouth.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a router: `@12-apps/impersonation/hono`
 * adapts them in forty lines, and a host on anything else writes its own.
 */

/* ────────────────────────────── the caller ────────────────────────────── */

/**
 * WHO is calling, resolved by the host on every request.
 *
 * Everything on it is the host's business and none of it is guessable here: how
 * a user id is established, what "platform authority" means in this product, and
 * which permission ids the caller holds in the tenant the URL names.
 */
export interface ImpersonationActor {
  /**
   * The caller's user id, or `null` for an authenticated identity with no row of
   * its own (an env allowlist, a directory-only admin). `null` is a refusal at
   * mint time, not a crash: a session started by such an actor would be
   * attributable to nobody.
   */
  userId: string | null;
  /** The caller's e-mail, when the host has one. Used only by the audit trail. */
  email: string | null;
  /**
   * Platform authority — re-derived by the host on EVERY request, never read
   * from a claim stamped at sign-in.
   *
   * It short-circuits the preview permission gate the same way it short-circuits
   * every other gate in a typical host. It is also exactly what a host must
   * force FALSE while an impersonation is in force, so an operator wearing a
   * tenant user's account does not keep their own authority.
   */
  isPlatformAdmin: boolean;
  /** The permission ids the caller holds in the tenant this request names. */
  permissions: readonly string[];
  /**
   * True when this request authenticated with a machine/agent token rather than
   * a browser session. Such a caller may neither inherit nor MINT a session —
   * see {@link ImpersonationMessages.machineTokenRefused}.
   */
  isMachineToken?: boolean;
}

/* ────────────────────────────── the request ───────────────────────────── */

/** One request, already authenticated and routed by the host. */
export interface ImpersonationRequest {
  actor: ImpersonationActor;
  params: Record<string, string | undefined>;
  body?: unknown;
  /** The raw value of the session cookie on this request, or undefined. */
  cookieValue?: string;
}

/** What a handler answers with; the host maps this onto its response type. */
export interface ImpersonationResponse {
  status: number;
  body: unknown;
  /**
   * A cookie the host MUST apply to the response it sends.
   *
   * Part of the descriptor rather than something the handler does itself,
   * because a framework-neutral handler has no response object to set it on —
   * and leaving it to the host to remember would make "the session started but
   * the cookie never left" a per-adapter bug.
   */
  cookie?: ImpersonationCookie;
}

/**
 * Which mount a descriptor belongs to.
 *
 * `platform` — the shared session surface: it starts operator sessions, stops a
 * session of EITHER kind, and answers the banner. All three apps read it, so it
 * has to sit somewhere that is not tenant-scoped.
 *
 * `tenant` — the preview mount, under whatever tenant-scoped base the host uses.
 * Its `:tenantSlug` parameter names the tenant.
 */
export type ImpersonationSurface = 'platform' | 'tenant';

export interface ImpersonationRoute {
  method: 'GET' | 'POST' | 'DELETE';
  surface: ImpersonationSurface;
  /**
   * Path relative to that surface's mount, in `:param` form. `''` means the
   * mount itself — this surface is three verbs on ONE resource, because that is
   * what it is: a session either exists or does not, and there is exactly one of
   * it per browser.
   */
  path: string;
  handle(request: ImpersonationRequest): Promise<ImpersonationResponse>;
}

/* ────────────────────────────── the copy ─────────────────────────────── */

/**
 * Every user-facing sentence this surface can emit.
 *
 * REQUIRED, all of them, with NO defaults. Product copy is by definition
 * application-specific — its language included — so a package that shipped a
 * default would hand a second host another product's voice, silently. A required
 * field makes a new host state its own, loudly, at compile time.
 */
export interface ImpersonationMessages {
  /** A machine token tried to start a session. */
  machineTokenRefused: string;
  /** The caller does not hold the authority this surface requires. */
  notAuthorized: string;
  /** The caller has no user row, so nothing could be attributed to them. */
  actorNotRecorded: string;
  /** The target holds platform authority itself. */
  targetIsPlatformAdmin: string;
  /** No account for the requested target. */
  targetNotFound: string;
  /** The named subject is not an active member of this tenant. */
  notAMember: string;
  /** A session is already in force. */
  alreadyImpersonating: string;
  /** No such tenant. */
  tenantNotFound: string;
  /** The request body did not parse. */
  invalidBody: string;
  /** A write refused because the session is read-only. */
  readOnly: string;
  /** A request refused because it is on a money path. */
  transactionBlocked: string;
  /** A write refused because it targets a person's own account. */
  accountBlocked: string;
  /** Every request refused because the preview's entitlement was revoked. */
  revoked: string;
}

/* ────────────────────────────── the config ───────────────────────────── */

export interface ImpersonationServerConfig {
  /** The cookie's name. The host's own naming convention decides it. */
  cookieName: string;
  /** HTTPS-only. The host knows whether it is serving over TLS. */
  secure: boolean;
  /** An authenticated codec for the cookie payload. */
  codec: ImpersonationCodec;
  /** The hard time box per kind, in milliseconds. */
  timeBox: ImpersonationTimeBoxConfig;
  /** The four path tables — money, its pure reads, accounts, and this mount. */
  paths: ImpersonationPathRules;
  /** Who may be impersonated, and in which tenant. */
  directory: ImpersonationDirectory;
  /** Where start, end and every refusal are written down. */
  audit: ImpersonationAuditPort;
  /** Which apps, how long a reason, and any extra host refusal. */
  mintPolicy: ImpersonationMintPolicy;
  /**
   * The permission id that gates STARTING a preview in a tenant.
   *
   * Required rather than defaulted to this package's own recommendation: a
   * default is adopted silently by a host whose catalog spells things
   * differently, and the failure is open — the gate passes for nobody, or worse,
   * an id the host happens to grant broadly.
   * {@link IMPERSONATION_PERMISSIONS.preview} is the wording to pass when the
   * host has no opinion.
   */
  previewPermission: string;
  /** The tenant's plan/consent gate, when the host has one. */
  previewEntitlement?: PreviewEntitlementPort;
  /** Every user-facing sentence, in the host's own voice. */
  messages: ImpersonationMessages;
  /**
   * Report an internal failure that was deliberately swallowed — a failed END
   * audit write, or an entitlement re-check that errored. Optional; without it
   * such failures are silent, which is the same behaviour with less to read.
   */
  onError?(message: string, error: unknown): void;
}

/* ────────────────────────────── plumbing ─────────────────────────────── */

/** A user-safe API error carrying the HTTP status the wire promises. */
export class ImpersonationApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ImpersonationApiError';
    this.status = status;
    // Restores the prototype chain across the ES5 `extends Error` downlevel, so
    // `instanceof` in a host's error mapping holds.
    Object.setPrototypeOf(this, ImpersonationApiError.prototype);
  }
}

export const ok = (data: unknown, cookie?: ImpersonationCookie): ImpersonationResponse => ({
  status: 200,
  body: { data },
  cookie,
});

export const fail = (status: number, error: string): ImpersonationResponse => ({
  status,
  body: { error },
});

/** Fold an {@link ImpersonationApiError} into a response; rethrow the rest. */
export function foldApiError(error: unknown): ImpersonationResponse {
  if (error instanceof ImpersonationApiError) return fail(error.status, error.message);
  throw error;
}
