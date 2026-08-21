import type { EmailDriver } from "@12-apps/notifications/server";

import type { EmailCredentialsMailer } from "../email-credentials/types";
import type { MailPack } from "../server/mail-templates";
import { createAuthMailer } from "./mailer";
import { createSinkDriver, createUnconfiguredDriver } from "./drivers";

/**
 * `createEnvAuthMailer` — the driver-resolution TREE, which every host was
 * writing identically.
 *
 * ## What this is not
 *
 * It is not a second opinion about where `@12-apps/notifications` draws its
 * line. That package refuses to read `process.env` on purpose, and its reason
 * is right: "it cannot know a host's variable names, and it must not be the
 * thing that decides whether a channel is on". A channel there is configured
 * by DECLARATION, and this changes none of it.
 *
 * What a host still had to write, after that rule, was the same eight-branch
 * decision in every deployment:
 *
 * ```ts
 * function driver(): EmailDriver {
 *   const provider = process.env.NOTIFICATIONS_EMAIL_PROVIDER;
 *   if (provider === "log") return sinkDriver;
 *   const apiKey = process.env.RESEND_API_KEY;
 *   const from = process.env.NOTIFICATIONS_EMAIL_FROM;
 *   if (provider !== "resend" || !apiKey || !from) return unconfiguredDriver;
 *   const resend = EMAIL_DRIVERS.resend;
 *   if (!resend) return unconfiguredDriver;
 *   return resend({ channel: "EMAIL", driver: "resend", apiKey, from });
 * }
 * ```
 *
 * Thirty lines, and not one decision in them belongs to a particular product.
 * "The log provider means the sink", "a vendor with no key refuses rather than
 * pretends", "an unknown vendor name refuses rather than throws at import" —
 * those are properties of the AUTH mail path, and getting any of them wrong is
 * the same failure in every host: reset links written to a log aggregator, or a
 * sign-in flow that 500s at boot because a secret is missing.
 *
 * ## What the host still says, and it is only names
 *
 * The variable NAMES stay the host's, which is what keeps the notifications
 * rule intact — the deployment still decides which vendor is on, by which
 * variables it sets. This package only performs the lookup those names
 * describe. The names are read PER CALL rather than captured, because a
 * preview box is reconfigured under a running process and a driver captured at
 * import would keep sending through whatever was set when the module loaded.
 *
 * ```ts
 * export const authMailer = createEnvAuthMailer({
 *   env: {
 *     provider: "NOTIFICATIONS_EMAIL_PROVIDER",
 *     apiKey: "RESEND_API_KEY",
 *     from: "NOTIFICATIONS_EMAIL_FROM",
 *     sinkFile: "AUTH_EMAIL_LOG_FILE",
 *     origin: ["APP_PUBLIC_URL", "AUTH_URL"],
 *   },
 *   drivers: EMAIL_DRIVERS,
 *   log: createFeatureLogger("auth-email"),
 * });
 * ```
 */

/** One formatted mail, as the sink and the refusal see it. */
interface LoggedMessage {
  subject: string;
  text: string;
  html?: string;
}

/**
 * The two lines this mailer writes, structurally.
 *
 * A twin of `createFeatureLogger`'s shape and of `@12-apps/wiring`'s
 * `LoggerPort`, narrowed to the two levels used here. Typed structurally so a
 * host passes its own logger without this package depending on whose it is —
 * and a `console` satisfies it, which is what makes the refusal testable.
 */
export interface AuthMailerLog {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** A vendor entry in `@12-apps/notifications`' `EMAIL_DRIVERS` table. */
export type EmailDriverFactory = (declaration: {
  channel: "EMAIL";
  driver: string;
  apiKey: string;
  from: string;
}) => EmailDriver;

/**
 * The variable NAMES this deployment uses. Not values — see the per-call note
 * above.
 */
export interface AuthMailerEnvNames {
  /** Which vendor, or `"log"` for the sink. */
  provider: string;
  /** The vendor's secret. */
  apiKey: string;
  /** The From address the vendor sends as. */
  from: string;
  /**
   * Where the sink appends what it "sent", for e2e to read back.
   *
   * Optional because it is a harness concern: unset, the sink still logs and
   * writes nothing, which is what a developer's machine wants.
   */
  sinkFile?: string;
  /**
   * The public origin every link is built against, in preference order.
   *
   * A LIST because the fallback chain is itself a host decision — this repo's
   * origin host reads `APP_PUBLIC_URL` first and falls back to `AUTH_URL`,
   * which under e2e is the API origin rather than the storefront's. Naming
   * both, in order, says that out loud instead of burying it in a `??` chain
   * duplicated across two files.
   */
  origin?: readonly string[];
}

export interface EnvAuthMailerConfig {
  env: AuthMailerEnvNames;
  /**
   * The vendor table — `EMAIL_DRIVERS` from `@12-apps/notifications/server`,
   * or a host's own.
   *
   * Passed rather than imported so this file keeps the optional peer at a type
   * position only: a host delivering through something else never resolves the
   * package at runtime.
   */
  drivers: Record<string, EmailDriverFactory | undefined>;
  log: AuthMailerLog;
  /** Which words. `PT_BR_MAIL` when omitted, as `createAuthMailer` defaults. */
  pack?: MailPack;
  /** The sign-in path the "password changed" notice points at. `/login`. */
  loginPath?: string;
  /** Where links point when no origin variable is set. Dev's own server. */
  defaultOrigin?: string;
  /** How a name is looked up. `process.env` when omitted; a test passes a map. */
  read?: (name: string) => string | undefined;
}

/** The provider value that selects the sink rather than a vendor. */
const SINK_PROVIDER = "log";

/**
 * Build a mailer that resolves its driver from the environment on every send.
 *
 * The refusal is the important branch. A deployment with no provider must fail
 * LOUDLY and send nothing: writing a reset link into a log aggregator is worse
 * than not sending it, because the link still works and now has an audience.
 * So the unconfigured driver is a real driver that accepts the call, records
 * an error naming the address and the subject, and delivers nothing — rather
 * than a throw, which would turn a misconfigured mailbox into a 500 on sign-up
 * and hide which of the three variables was missing.
 */
export function createEnvAuthMailer(config: EnvAuthMailerConfig): EmailCredentialsMailer {
  const {
    env,
    drivers,
    log,
    pack,
    loginPath = "/login",
    defaultOrigin = "http://localhost:3000",
    read = (name) => process.env[name],
  } = config;

  const sink = createSinkDriver({
    filePath: env.sinkFile ? read(env.sinkFile) : undefined,
    onSend: (to, message: LoggedMessage) => {
      log.info("auth email (log driver)", { to, subject: message.subject, body: message.text });
    },
  });

  const refuse = createUnconfiguredDriver({
    onRefused: ({ to, subject }) => {
      log.error("no e-mail provider configured — the auth message was NOT sent", {
        to,
        subject,
        driver: read(env.provider) ?? "(unset)",
      });
    },
  });

  /**
   * Does the environment currently resolve to something that DELIVERS?
   *
   * The sink counts. It is a deliberate local-development and e2e choice
   * ("provider = log"), the mail is written where the developer or the harness
   * can read it, and the link in it works — so a sign-up on such a box must
   * still succeed. What does not count is the refusal, which is reached by
   * saying nothing at all: an unset provider, a missing key or From, or a
   * vendor name that resolves to no factory. Those are misconfiguration, and
   * on those the mail is simply gone.
   *
   * Read fresh, like the driver itself, because a preview box is reconfigured
   * under a running process.
   */
  const canDeliver = (): boolean => {
    const provider = read(env.provider);
    if (provider === SINK_PROVIDER) return true;
    if (!provider) return false;
    if (!read(env.apiKey) || !read(env.from)) return false;
    return drivers[provider] !== undefined;
  };

  /** Which vendor this deployment sends through, read fresh. */
  const driver = (): EmailDriver => {
    const provider = read(env.provider);
    if (provider === SINK_PROVIDER) return sink;
    if (!provider) return refuse;

    const apiKey = read(env.apiKey);
    const from = read(env.from);
    if (!apiKey || !from) return refuse;

    // An unknown name refuses rather than throwing: a typo in a deploy
    // variable must not take the sign-in flow down at import, and the refusal
    // already logs which name it could not resolve.
    const factory = drivers[provider];
    if (!factory) return refuse;
    return factory({ channel: "EMAIL", driver: provider, apiKey, from });
  };

  /** The public origin, first named variable that is actually set. */
  const origin = (): string => {
    for (const name of env.origin ?? []) {
      const value = read(name);
      if (value) return value;
    }
    return defaultOrigin;
  };

  const mailer = (): EmailCredentialsMailer =>
    createAuthMailer({ driver: driver(), loginUrl: `${origin()}${loginPath}`, pack });

  return {
    sendVerification: (message) => mailer().sendVerification(message),
    sendPasswordReset: (message) => mailer().sendPasswordReset(message),
    sendAccountExists: (message) => mailer().sendAccountExists(message),
    // `createAuthMailer` always supplies this one; the fallback satisfies the
    // port, where it is optional.
    sendPasswordChanged: (message) => mailer().sendPasswordChanged?.(message) ?? Promise.resolve(),
    canDeliver,
  };
}

/**
 * The public origin on its own, for the callers that need the ORIGIN rather
 * than a mailer — `createEmailCredentials`' `appUrl`, most of all.
 *
 * Exported because the origin host had this same three-term chain written out
 * twice, in `email-mailer.ts` and in `email-credentials.ts`, and two spellings
 * of one fallback is how a deployment ends up mailing links to one host while
 * the flow builds them against another.
 */
export function resolveAppOrigin(config: {
  names: readonly string[];
  defaultOrigin?: string;
  read?: (name: string) => string | undefined;
}): string {
  const { names, defaultOrigin = "http://localhost:3000", read = (n) => process.env[n] } = config;
  for (const name of names) {
    const value = read(name);
    if (value) return value;
  }
  return defaultOrigin;
}
