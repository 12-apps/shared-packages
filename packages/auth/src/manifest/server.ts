import { defineServerManifest } from "@12-apps/wiring/producer";
import type { EmailPort } from "@12-apps/wiring";

import type { EmailCredentialsMailer } from "../email-credentials/types";
import { createAuthMailer } from "../notifications/mailer";
import type { MailPack } from "../server/mail-templates";
import {
  createApiEmailAuth,
  createApiEmailAuthSettings,
} from "../server/create-api-email-auth";
import { authManifest, authPlatformManifest } from "./index";

/**
 * The SERVER runtime manifest — the factories, which only a server holds.
 *
 * ## Why this one is a function where report-builder's is a constant
 *
 * The `email` capability is `createMailer(port) → mailer`, and the port is all
 * the host supplies at bind time. Two of this package's four mails need
 * something the port cannot carry: which words (`pack`) and where the
 * "password changed" notice points (`loginUrl`), the one message with no token
 * of its own. A constant manifest would have to bake a language and a URL,
 * which is exactly the defaulting this package refuses everywhere else.
 *
 * So the mail choices are made where every other choice in this package is
 * made — at the call, by name.
 */
export interface AuthServerManifestOptions {
  /** Which words the four mails use. `PT_BR_MAIL` when omitted. */
  pack?: MailPack;
  /**
   * Where the "your password changed" notice points — the sign-in page.
   *
   * Omitted, the mail still sends and its button has nowhere to go, which is
   * worth avoiding: the whole point of that notice is that somebody who did
   * NOT change their password can act on it immediately.
   */
  loginUrl?: string;
}

export function authServerManifest(options: AuthServerManifestOptions = {}): ReturnType<
  typeof defineServerManifest
> {
  return defineServerManifest(authManifest, {
    name: "@12-apps/auth",
    http: { create: createApiEmailAuth },
    email: {
      /**
       * The host's ONE delivery port becomes this package's four semantic
       * sends. Rendering stays here (this package owns the sentences of its own
       * mails); delivery stays the host's single driver, with whatever retries,
       * logging and PII rules it already enforces for every other message.
       *
       * `EmailPort` is `@12-apps/notifications`' `EmailDriver` shape verbatim,
       * so a host already sending mail has this for free.
       */
      createMailer: (port: EmailPort): EmailCredentialsMailer =>
        createAuthMailer({ driver: port, pack: options.pack, loginUrl: options.loginUrl }),
    },
  });
}

/** The operator console's server half. No mail; it only reads and writes rows. */
export const authPlatformServerManifest = defineServerManifest(authPlatformManifest, {
  name: "@12-apps/auth-platform",
  http: { create: createApiEmailAuthSettings },
});
