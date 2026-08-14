/**
 * WHERE THE HOST'S SURFACES ARE — the four path tables the write gate consults,
 * and the one inversion that makes them safe.
 *
 * Everything here is a pure function of (pathname, method) with no request, no
 * session and no database in it, so it is exhaustively testable on its own
 * terms. That matters more for this half than for any other, because every entry
 * is a claim about a route that somebody has to be able to check by reading the
 * host's own route tree.
 *
 * THE TABLES THEMSELVES ARE THE HOST'S, and are required config. This package
 * has no idea where a given product's money moves; a default here would be one
 * application's URL layout silently adopted by another, and the failure mode is
 * a charge produced under an impersonation.
 */

/**
 * WHY `request.method` AND NOT A PER-ROUTE FLAG — the decision this module
 * exists to make.
 *
 * The alternative is a declarative `write: true` on each route's config. It
 * fails OPEN: every mutating handler would need the flag, every new route would
 * need someone to remember it, and a route that forgot it would silently be
 * writable under an impersonation — a hole that is invisible in review because
 * the missing thing is not there to see. The method is already carried by every
 * request, so the default covers every route at once and a new one inherits the
 * protection by existing. When it errs it errs by refusing something safe, which
 * is a bug report, not a breach.
 *
 * HEAD and OPTIONS ride along with GET: neither can carry a body. Anything NOT
 * in this set — including a verb the host does not serve — is treated as a
 * write. Deny is the default branch.
 *
 * ⚠ THIS SET IS NOT A FAST PATH AND MUST NOT BECOME ONE. It is consulted AFTER
 * {@link ImpersonationPathRules.money}, for the reason spelled out on
 * {@link createPathRules}.
 */
export const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The four tables, as ONE object with four required keys.
 *
 * One object rather than four parallel arguments on purpose: as four they could
 * disagree, and a host that supplied three of them would have a configuration
 * that type-checks and enforces the wrong policy. The type forces all four to be
 * stated, `[]` included — an empty list is a decision a reader can see.
 */
export interface ImpersonationPathRules {
  /**
   * The subtrees where money moves or a payment instrument changes hands.
   * Refused for EVERY kind, `allowWrites` included — "nobody may transact as
   * somebody else" is not a permission question, so no opt-in reaches it.
   *
   * Each entry should be the SUBTREE, never the individual money verb, so the
   * next refund/void/manual-settle route added beside one is covered on the day
   * it is written rather than the day someone remembers this list.
   *
   * Provider webhooks belong OUT of this list: a provider callback carries no
   * browser cookie, so there is no impersonation for it to inherit.
   */
  money: readonly RegExp[];
  /**
   * The GETs on a money path that are PROVEN pure, and may therefore be read
   * under an impersonation. Without these the feature loses its point: whoever
   * was called about a store's payments has to be able to LOOK at them.
   *
   * Anchor each entry to the WHOLE pathname (`$`, not `(\/|$)`) so it allowlists
   * ONE route and never its children. That is the entire safety of the inversion
   * described on {@link createPathRules}.
   */
  moneyReads: readonly RegExp[];
  /**
   * The prefixes holding a PERSON's own account. WRITES are refused for every
   * kind; reads are not.
   *
   * A separate table from {@link ImpersonationPathRules.money} because it is a
   * separate claim. That list means one precise thing — "money moves here" — and
   * it earns a second mechanism (the enumerated pure GETs) because on those
   * paths THE VERB LIES. Account paths are not redirect targets, so no GET under
   * them is forced to settle state; folding them into the money list would make
   * that list mean "money, and also some other things we dislike", and would
   * import the inversion's cost for no safety at all.
   *
   * WHY WRITES ARE REFUSED WHOLESALE. A write opt-in exists so support can fix a
   * tenant's DATA. It was never a licence to write to a PERSON. Account writes
   * are identity-shaped — a push subscription is a handle on a specific BROWSER,
   * a notification preference decides what a human is told and where, a profile
   * holds their tax id — and every one of those artifacts OUTLIVES the time box.
   * An artifact that survives the box contradicts the rule the whole feature is
   * built on.
   */
  account: readonly RegExp[];
  /**
   * Where the host MOUNTED this package's own session routes.
   *
   * These are the URLs an impersonated session may always reach, on the verbs
   * that manage the session ITSELF. Without them the guard refuses the way out —
   * and read-only is the default for an operator session and UNCONDITIONAL for a
   * member preview, so the feature could start a session it cannot stop.
   *
   * Anchor each pattern at both ends so no child path inherits the exemption.
   */
  session: readonly RegExp[];
}

/**
 * The verbs that manage the session itself: start it, stop it, or ASK ABOUT IT.
 *
 * `GET` belongs here and its absence is a lockout. The banner reads the session
 * endpoint to learn what to display, and the live revocation check runs ahead of
 * the read-method shortcut — so a preview whose entitlement had just been
 * revoked would have its banner read refused along with everything else. That is
 * the worst possible shape for a safety control: every screen refused, and the
 * one request that would have told the user they must leave — and rendered the
 * control that lets them — refused too, leaving the browser stuck until the time
 * box expired.
 *
 * `POST` is admitted for a subtler reason, and it is NOT that nesting is
 * allowed. It is refused; the question is BY WHOM. The gate runs before the
 * handler body, so refusing a nested start here would refuse it before any
 * handler could write the row — and this trail's contract is "start, end, and
 * every REFUSED attempt". The one attempt most worth recording, an operator
 * trying to swap accounts mid-session, would be the one attempt that left no
 * trace. Handing the refusal to the code that can WRITE IT DOWN is strictly
 * better than winning the same refusal silently, and it is safe because these
 * handlers' complete side effects are a cookie and an audit entry.
 */
const SESSION_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'DELETE']);

/** The three request-free predicates the write gate and the routes both read. */
export interface PathRules {
  /**
   * Is this request one that MANAGES an impersonation, rather than acting under
   * one?
   */
  managesSession(pathname: string, method: string): boolean;
  /** Does money move here, or a payment instrument change hands? */
  transacts(pathname: string, method: string): boolean;
  /** Is this request a WRITE to somebody's account? */
  mutatesAccount(pathname: string, method: string): boolean;
}

function matches(patterns: readonly RegExp[], pathname: string): boolean {
  return patterns.some((pattern) => pattern.test(pathname));
}

/**
 * Bind the four tables into the predicates the gate reads.
 *
 * ORDERING — THE TRANSACTION CHECK RUNS BEFORE THE METHOD SHORTCUT. Read this
 * before adding a `READ_METHODS` fast path above it.
 *
 * The obvious shape is "reads pass; then consult the money list". It does not
 * merely lose precision — it is WRONG, because it takes the verb as PROOF that a
 * request is a read, and in a real application that is false. Payment surfaces
 * routinely settle state on a GET: a status poll that confirms an order paid and
 * expires a lapsed window, a verification landing that ACTIVATES a provider, an
 * OAuth callback that STORES a merchant's credentials. None of those is a
 * mistake — each is a browser LANDING, where the provider and not the
 * application chose when the buyer came back, so the settlement has nowhere else
 * it could be applied. They will not stop existing, and the next one will be
 * written by someone who has never opened this file.
 *
 * So on a money path the method decides nothing. A read is let through only when
 * it appears in {@link ImpersonationPathRules.moneyReads} — an enumerated
 * allowlist of GETs, each proven pure by reading it. That inverts the default
 * exactly where the method is a lie: a new route under a money subtree is
 * refused until a human reads it and adds it, which costs a bug report, where
 * the other order costs a charge.
 *
 * `mutatesAccount` trusts `READ_METHODS` as a read signal, which it is NOT on a
 * money path. The difference is the one argued on
 * {@link ImpersonationPathRules.account}: no route under an account prefix is a
 * redirect target, so no GET under it has anywhere it is forced to settle state.
 * That is a claim about the host's own tree a reader can check in a minute, and
 * it is the claim to re-check before adding a GET there that writes.
 */
export function createPathRules(rules: ImpersonationPathRules): PathRules {
  return {
    managesSession(pathname, method) {
      return SESSION_METHODS.has(method) && matches(rules.session, pathname);
    },
    transacts(pathname, method) {
      if (!matches(rules.money, pathname)) return false;
      if (!READ_METHODS.has(method)) return true;
      return !matches(rules.moneyReads, pathname);
    },
    mutatesAccount(pathname, method) {
      return !READ_METHODS.has(method) && matches(rules.account, pathname);
    },
  };
}
