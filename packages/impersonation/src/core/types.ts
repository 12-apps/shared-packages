/**
 * The shapes both halves of this package agree on — the cookie's payload, the
 * collapsed state every guard reads, and the wire object the banner renders.
 *
 * They live in `core/` because BOTH halves need them and neither owns them: the
 * server mints a session and answers a banner state, the browser reads that same
 * state back. A type that lived on one side would be re-declared on the other,
 * and the two copies would drift the first time a field was added.
 */

/**
 * Which mechanism minted the session.
 *
 * `operator` — someone with platform authority is acting AS a tenant user, with
 * that user's own rights. `preview` — a tenant admin is looking at their OWN
 * store through a narrower lens (a role, or one of their members).
 *
 * The two are deliberately one cookie with a discriminator rather than two
 * cookies: there is exactly one "am I wearing somebody else's account right
 * now?" per browser, and two cookies would make that question answerable two
 * ways.
 */
export type ImpersonationKind = 'operator' | 'preview';

/**
 * WHO a preview is of, as a discriminated union rather than two optional fields,
 * so "exactly one of role / member" is a shape the payload cannot violate.
 *
 * The distinction is load-bearing downstream: a member preview resolves that
 * member's real instance assignments, a role preview has no subject id at all
 * and resolves from the role's permission set.
 */
export type PreviewSubject =
  | { as: 'role'; roleName: string }
  | { as: 'member'; memberUserId: string };

/** The absolute window a session lives in, decided by the server at mint time. */
export interface ImpersonationTimeBox {
  issuedAt: number;
  expiresAt: number;
}

/** An operator session: acting as a real person, with their rights. */
export interface OperatorSession extends ImpersonationTimeBox {
  kind: 'operator';
  realUserId: string;
  targetUserId: string;
  /** Which of the host's apps the impersonated tab is driving. */
  targetApp: string;
  tenantId: string;
  reason: string;
  allowWrites: boolean;
}

/** A preview session: the actor's own account, narrowed. */
export interface PreviewSession extends ImpersonationTimeBox {
  kind: 'preview';
  realUserId: string;
  tenantId: string;
  previewOf: PreviewSubject;
}

/** The decoded cookie payload. */
export type ImpersonationSession = OperatorSession | PreviewSession;

/**
 * The impersonation in force for a request, reduced to what a guard needs.
 *
 * Deliberately NOT the decoded cookie: no consumer should ever have to re-ask
 * "is this a member preview or a role preview?". The union is collapsed once,
 * into a subject id plus (optionally) a role name, and every guard downstream
 * reads the same fields.
 */
export interface ImpersonationState {
  kind: ImpersonationKind;
  /** The one tenant this session is bounded to; a second store is a second start. */
  tenantId: string;
  /**
   * The user id every authorization question is asked about — the whole feature
   * in one field. For a ROLE preview there is no such person, so it stays the
   * actor and {@link ImpersonationState.previewRoleName} does the narrowing.
   */
  subjectUserId: string;
  /** The real human whose credentials authorized the request (audit, always). */
  realUserId: string;
  /**
   * Whether writes were explicitly opted into. FALSE for every preview by
   * construction, and false by default for an operator session.
   */
  allowWrites: boolean;
  /** The previewed role, for a ROLE preview; `null` for every other kind. */
  previewRoleName: string | null;
  /** The absolute end of the time box, so a caller can state the window. */
  expiresAt: number;
}

/** A cookie instruction for the host to apply to its response. */
export interface ImpersonationCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    maxAge: number;
  };
}

/** An account, as the refusal rules and the banner both need to name it. */
export interface ImpersonationUser {
  id: string;
  email: string;
  name: string | null;
}

/** A resolvable target: an existing account, plus its platform authority. */
export interface ImpersonationTarget extends ImpersonationUser {
  /**
   * True when this account holds platform authority itself. Such a target is
   * refused: the resulting trail would say "operator A acted as operator B"
   * about actions either of them could have taken alone.
   */
  isPlatformAdmin: boolean;
}

/** The tenant a session is bounded to, as the banner needs to name it. */
export interface ImpersonationTenant {
  id: string;
  slug: string;
  name: string;
}

/**
 * What the banner renders from — the ONE payload every surface answers with, so
 * a host mounting three apps mounts one component against one endpoint.
 *
 * `{ active: false }` is the ordinary answer, and it is not an error: the
 * storefront mounts the banner for anonymous shoppers too.
 */
export interface ImpersonationBannerState {
  active: boolean;
  kind?: ImpersonationKind;
  /** True when the session may not change anything — the banner's headline. */
  readOnly?: boolean;
  /** Absolute end of the time box, ISO-8601, for the countdown. */
  expiresAt?: string;
  previewRoleName?: string | null;
  subject?: ImpersonationUser | null;
  tenant?: ImpersonationTenant | null;
}
