import type {
  ImpersonationKind,
  ImpersonationTarget,
  ImpersonationTenant,
  ImpersonationUser,
  PreviewSubject,
} from '../core/types';

import type { ImpersonationActor, ImpersonationSurface } from './context';

/**
 * The seams a host implements: where the data lives, where the trail goes, what
 * the host refuses at mint time, and whether the tenant is entitled at all.
 *
 * Split from `./context` along the obvious line — that file is the wire (the
 * actor, the request, the response, the route descriptor, the copy and the
 * config that assembles them), and this one is everything the host has to write
 * an implementation OF.
 */

/**
 * WHO may be impersonated, and in WHICH tenant — the lookups the start endpoints
 * refuse on. The host owns its own tables; this is the shape they answer in.
 */
export interface ImpersonationDirectory {
  /**
   * The account behind a user id, with no authority question asked.
   *
   * Separate from {@link ImpersonationDirectory.resolveTarget} because the
   * BANNER — which every guarded screen loads — needs only the name to render,
   * and answering "…and are they a platform admin?" there would spend queries on
   * a question already settled, permanently, when the session was started.
   */
  findUser(userId: string): Promise<ImpersonationUser | null>;
  /**
   * The same account, plus whether it holds platform authority ITSELF.
   *
   * A host with more than one representation of platform authority (an env
   * allowlist AND a role grant, say) must consult ALL of them here. Checking one
   * leaves the other as a lateral move between full-privilege accounts — and a
   * lateral move is precisely what defeats attribution, because the resulting
   * trail says "A acted as B" about actions either of them could have taken
   * alone, in a record that cannot be corrected afterwards.
   */
  resolveTarget(userId: string): Promise<ImpersonationTarget | null>;
  /** The tenant a session is bounded to, by id. */
  findTenant(tenantId: string): Promise<ImpersonationTenant | null>;
  /** The same tenant, by the slug the tenant mount carries in its URL. */
  findTenantBySlug(slug: string): Promise<ImpersonationTenant | null>;
  /**
   * Does this user hold an ACTIVE membership in this tenant?
   *
   * Used twice, for two different reasons. A member preview REQUIRES it of the
   * subject, or "preview a member" is a cross-tenant read primitive — any user
   * id in the world, rendered inside a tenant they have nothing to do with,
   * which is the exact capability the cookie's mandatory `tenantId` withholds.
   * And a refusal is only recorded against a tenant when the CALLER has one; see
   * {@link ImpersonationAuditPort}.
   */
  isActiveMember(userId: string, tenantId: string): Promise<boolean>;
}

/** Why a start was refused. A closed set, because these are the rows an operator
 * FILTERS on ("show me every refused attempt that named a platform account"),
 * and prose does not filter. */
export type ImpersonationRefusal =
  /** The caller does not hold the authority this surface requires. */
  | 'not_authorized'
  /** The caller has NO user row — nobody to attribute the session to. */
  | 'actor_not_recorded'
  /** The target holds platform authority itself: a lateral move, refused. */
  | 'target_is_platform_admin'
  /** No account for the requested target. */
  | 'target_not_found'
  /** The named subject is not an active member of this tenant. */
  | 'not_a_member'
  /**
   * The tenant may not use previews.
   *
   * A host that distinguishes its denials — a plan the tenant has not bought
   * versus a switch they turned off themselves — supplies its own code through
   * {@link PreviewEntitlementPort.refusalCode}. The distinction matters twelve
   * months later, because only one of the two is something the tenant can undo.
   */
  | 'not_entitled'
  | (string & {})
  /**
   * A session is ALREADY in force and this request would have replaced it.
   *
   * There is one cookie per browser, so minting a second one silently
   * overwrites the first — and because the end entry is written by the EXIT and
   * not by the overwrite, the replaced session's start row would be left
   * dangling forever in a record nothing can amend.
   */
  | 'already_impersonating';

/** What every audit entry records, whatever its outcome. */
export interface ImpersonationAuditBase {
  /** The tenant the session was (or would have been) bounded to. */
  tenantId: string;
  /** The REAL human, or `null` when the caller has no row — itself a refusal. */
  actorUserId: string | null;
  /** The account being (or proposed to be) rendered as; `null` if unresolvable. */
  targetUserId: string | null;
}

/** A successful start: everything the session was minted with. */
export interface ImpersonationStartEntry extends ImpersonationAuditBase {
  kind: ImpersonationKind;
  /** Set for an operator session; `null` for a preview, which has no app. */
  targetApp: string | null;
  /** The operator's justification; `null` for a preview, which asks for none. */
  reason: string | null;
  /** The previewed subject, for a preview; `null` for an operator session. */
  previewOf: PreviewSubject | null;
  allowWrites: boolean;
  /**
   * Whether this session could change anything, recorded rather than left to be
   * re-derived from the fields above at read time.
   *
   * They are NOT the same answer: a ROLE preview is minted with
   * `allowWrites: false` and may still write, because it substitutes nobody. And
   * the rule connecting them lives in the write gate and may be tightened, so
   * what the record has to preserve is what was TRUE of this session, not what a
   * later rule would say about it.
   */
  readOnly: boolean;
  /** The absolute end of the time box, so the entry states the window it opened. */
  expiresAt: number;
}

/** A session being stopped. */
export interface ImpersonationEndEntry extends ImpersonationAuditBase {
  kind: ImpersonationKind;
  previewRoleName: string | null;
}

/** A refused attempt. */
export interface ImpersonationRefusedEntry extends ImpersonationAuditBase {
  refusal: ImpersonationRefusal;
  /**
   * The e-mail the attempt came from.
   *
   * The one piece of identity this trail records as a STRING rather than an id,
   * and it exists for exactly one row: `actor_not_recorded`, where by definition
   * there is no user id to name instead.
   */
  actorEmail: string | null;
  /** The reason given, when the request got far enough to have parsed one. */
  reason: string | null;
  /** The previewed subject, when the attempt named one. */
  previewOf: PreviewSubject | null;
}

/**
 * The trail: start, end, and every REFUSED attempt.
 *
 * REQUIRED, and not defaulted to a no-op. An impersonation nobody can see is the
 * one outcome this whole mechanism exists to prevent, so a host that has not
 * decided where the trail goes has not finished adopting this package.
 *
 * WHY REFUSALS ARE AUDITED, the same way the successes are: a denied attempt is
 * the more interesting line. A start that succeeded was authorized by
 * definition; "someone who may not impersonate tried to, at 03:12, naming this
 * tenant and this person" is the sentence an incident review is looking for, and
 * it exists nowhere else — the 403 the caller received is a fact about their
 * browser, not about the system.
 *
 * ORDERING, which the routes guarantee and a sink must not undo: a START entry
 * is written BEFORE the cookie is minted, so a failed write means NO session
 * rather than an unrecorded one. `started` and `refused` are therefore NOT
 * fenced — a throw becomes the caller's 500, which is the right trade for a
 * trail. `ended` IS fenced, and it is the one place that trade flips: the thing
 * on the other side is a human's ability to STOP acting as someone else, and a
 * missing end row is recoverable where a stuck session is not.
 */
export interface ImpersonationAuditPort {
  started(entry: ImpersonationStartEntry): Promise<void>;
  ended(entry: ImpersonationEndEntry): Promise<void>;
  refused(entry: ImpersonationRefusedEntry): Promise<void>;
}

/** The context an extra host-side mint refusal is asked about. */
export interface ImpersonationMintContext {
  actor: ImpersonationActor;
  surface: ImpersonationSurface;
  tenantId: string;
}

/**
 * The mint-time policy that is genuinely the host's: which apps a session may
 * land in, how long a justification has to be, and any extra refusal.
 */
export interface ImpersonationMintPolicy {
  /**
   * The values `targetApp` may take on an operator session. REQUIRED, because
   * "which apps does this product have" is not answerable here — and a start
   * naming an app that does not exist lands the operator on a 404 wearing
   * somebody else's account.
   */
  targetApps: readonly string[];
  /**
   * The justification's length rules. The packaged dialog mirrors these so the
   * operator is refused BEFORE they submit; the server checks them again,
   * because client-side validation is a courtesy and never a gate.
   */
  reasonLength: { min: number; max: number };
  /**
   * An extra refusal the host wants at mint time — return its own sentence, or
   * `null` to allow. Optional: the refusals that are properties of the MECHANISM
   * (a machine token, a nested start, a platform-admin target) are enforced here
   * regardless and are not this hook's business.
   */
  refuse?(context: ImpersonationMintContext): Promise<string | null> | string | null;
}

/**
 * The tenant's entitlement to previews at all — plan, and the tenant's own
 * consent switch.
 *
 * OPTIONAL, and the absence means exactly one thing: this host does not gate
 * previews on anything a tenant buys or arms. That is a legitimate
 * configuration, not a hole — a host with no billing has nothing to ask.
 *
 * When present it is asked TWICE, and the second time is the point. Asking only
 * at the mint freezes the decision: a tenant downgraded mid-session, or one that
 * switched the feature off, keeps a live preview rendering their staff's screens
 * for the rest of the time box. The cookie's own window is the only thing that
 * would end it, and a time box is not a revocation.
 */
export interface PreviewEntitlementPort {
  /** Throws when the tenant may not use previews. */
  require(tenantId: string): Promise<void>;
  /**
   * Is this error the entitlement engine's considered "no", as opposed to a
   * database blip?
   *
   * The live re-check FAILS OPEN on anything else, deliberately: a cache failure
   * must not brick an in-flight support session on every route at once, and the
   * session is already bounded by a hard time box, is read-only unless it is a
   * role preview, and was authorized when it started.
   */
  isDenial(error: unknown): boolean;
  /**
   * How a denial reaches the caller AT THE MINT: the host's own status and
   * sentence.
   *
   * The host answers rather than this package flattening every denial into one
   * 403, because a denial has KINDS and they are not interchangeable. Someone
   * whose plan does not include previews needs to be sold something; someone
   * whose plan does include them but who never armed the tenant's own switch
   * needs to be pointed at their own settings. Collapsing the two would tell the
   * person who needs to BUY something to go ask somebody for access.
   *
   * The LIVE re-check ignores this and answers
   * {@link ImpersonationMessages.revoked} instead: a request already inside a
   * session does not need an upsell, it needs to stop.
   */
  denialResponse(error: unknown): { status: number; message: string };
  /**
   * The refusal code this denial is recorded under. Defaults to `not_entitled`.
   *
   * Worth supplying whenever the host's engine distinguishes its denials,
   * because only one of them is something the tenant can undo themselves — and
   * that is the difference an operator filters a year of history on, and the one
   * a route test has to assert SPECIFICALLY: a test that merely checks "not 200"
   * passes on the plan denial and would hide a completely broken tenant switch.
   */
  refusalCode?(error: unknown): string;
}
