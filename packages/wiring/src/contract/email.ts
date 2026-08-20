/**
 * The EMAIL capability, and the port it rides on.
 *
 * Two email seams exist today at different altitudes and compose only through
 * a hand-written bridge: `@12-apps/notifications`' `EmailDriver` (deliver one
 * already-formatted mail) and `@12-apps/auth`'s `EmailCredentialsMailer`
 * (four semantic sends, rendered by the auth package, delivered through — an
 * `EmailDriver` the host threads across by hand via `createAuthMailer`).
 *
 * `EmailPort` is the `EmailDriver` shape, verbatim, given a home a package
 * can depend on for the cost of zero dependencies — today the type lives
 * inside `@12-apps/notifications/server`, so naming it drags the whole
 * server half's type graph into any package that only wants an envelope.
 *
 * The capability generalizes `createAuthMailer`: a package that sends mail
 * declares a factory from the port to its own semantic mailer. Rendering
 * stays the package's (it owns the sentences of its own mails); delivery
 * stays the host's single driver — retries, logging and PII rules included,
 * which is the property the auth bridge's docstring argues for.
 */

/** Twin of `@12-apps/notifications`' `EmailMessage`: one formatted mail. */
export interface WireEmailMessage {
  subject: string;
  text: string;
  html: string;
}

/**
 * Twin of `@12-apps/notifications`' `EmailDriver` — the vendor seam. Deliver
 * one already-formatted email; throws on failure (the caller owns retry).
 */
export interface EmailPort {
  send(to: string, message: WireEmailMessage): Promise<void>;
}

/**
 * The producer side of the capability: from the host's one delivery port to
 * the package's own semantic mailer (`sendVerification`, `sendReceipt`, …).
 * `TMailer` is the package's vocabulary; the contract only fixes where the
 * envelope comes from.
 */
export interface EmailContribution<TMailer> {
  createMailer(port: EmailPort): TMailer;
}
