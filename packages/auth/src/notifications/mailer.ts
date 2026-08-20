import type { EmailDriver } from "@12-apps/notifications/server";

import type {
  AuthEmailMessage,
  EmailCredentialsMailer,
} from "../email-credentials/types";
import { PT_BR_MAIL, renderAuthMail, type MailPack } from "../server/mail-templates";

/**
 * `@12-apps/auth/notifications` — the four auth e-mails, delivered through
 * `@12-apps/notifications`.
 *
 * ## Why this adapter exists
 *
 * `EmailCredentialsMailer` is four methods, and until now every host wrote all
 * four: render, then hand the result to a vendor. The rendering half already
 * ships here (`renderAuthMail` + a pack). The DELIVERY half already ships in
 * `@12-apps/notifications` — `EmailDriver` is one `send(to, {subject, text,
 * html})`, with a Resend driver, a log driver for dev and e2e, and the vendor
 * seam for anything else.
 *
 * Two packages already own both halves, so a host writing them again is
 * copying — and the copy is where a deployment ends up with an auth mail that
 * bypasses whatever retry, logging and PII rules the notification transport
 * enforces for every other message it sends.
 *
 * With this, a host writes:
 *
 * ```ts
 * const mailer = createAuthMailer({
 *   driver: EMAIL_DRIVERS.resend({ channel: 'EMAIL', apiKey, from }),
 * });
 * createEmailCredentials({ store, mailer, settings, appUrl });
 * ```
 *
 * ## Why `@12-apps/notifications` is an OPTIONAL peer
 *
 * The same call `hono` gets. A host that delivers through something else — an
 * SMTP relay it already runs, a queue, a vendor SDK — implements
 * `EmailCredentialsMailer` directly and never resolves this subpath, so it
 * never installs a package it does not use. Importing the package root,
 * `/react` or `/email-credentials` does not reach this file.
 *
 * The peer is also why the version is the CONSUMER's: a host on notifications
 * v3 and a host on v4 both work, and neither inherits a copy pinned here.
 */

export interface AuthMailerConfig {
  /**
   * Where a message actually goes, from `@12-apps/notifications`.
   *
   * The DRIVER rather than the whole transport: `emailTransport` also carries
   * `format` and `supports`, and both are wrong here — the formatting is this
   * package's (an auth mail is a link and a deadline, not a title and a body),
   * and there is no recipient row to support, only an address the flow already
   * has.
   */
  driver: EmailDriver;
  /**
   * Which words. `PT_BR_MAIL` when omitted — the only pack bundled today.
   *
   * Defaulted here and NOT in `renderAuthMail`, deliberately: a host reaching
   * for this adapter has already chosen "the standard auth e-mails", where one
   * writing its own mailer is choosing something else and should say what.
   */
  pack?: MailPack;
  /**
   * Where the "your password changed" notice points — the sign-in page.
   *
   * That message is the only one of the four carrying no token of its own, so
   * the flow hands the mailer no link and the host supplies one. Omitted, the
   * mail still sends and its button simply has nowhere to go, which is worth
   * avoiding: the whole point of the notice is that somebody who did NOT change
   * their password can act on it immediately.
   */
  loginUrl?: string;
  /**
   * "Now", for tests. Defaults to `Date.now`.
   *
   * The packs word a lifetime ("1 hora", "2 dias") from the gap between now and
   * the token's expiry, so a test that could not fix the clock could only
   * assert the sentence loosely.
   */
  now?: () => number;
}

/**
 * Build the mailer. One call, one config object — the shape every factory in
 * this package has.
 */
export function createAuthMailer(config: AuthMailerConfig): EmailCredentialsMailer {
  const { driver, pack = PT_BR_MAIL, now = Date.now } = config;

  const deliver = async (
    kind: "verification" | "passwordReset" | "alreadyRegistered" | "passwordChanged",
    message: AuthEmailMessage,
  ): Promise<void> => {
    const mail = renderAuthMail(pack, kind, message, now());
    await driver.send(mail.to, { subject: mail.subject, text: mail.text, html: mail.html });
  };

  return {
    sendVerification: (message) => deliver("verification", message),
    sendPasswordReset: (message) => deliver("passwordReset", message),
    sendAccountExists: (message) => deliver("alreadyRegistered", message),
    /**
     * The courtesy notice, and the one message with no token of its own.
     *
     * `renderAuthMail` still wants an `AuthEmailMessage`, so the link is the
     * sign-in page and the deadline is now — neither reaches the rendered mail,
     * because `passwordChanged`'s copy words no lifetime and its CTA is "sign
     * in". Stated here rather than left to a reader to work out from the pack.
     */
    sendPasswordChanged: (message) =>
      deliver("passwordChanged", {
        ...message,
        link: config.loginUrl ?? "",
        token: "",
        expiresAt: new Date(now()),
      }),
  };
}
