/**
 * `@12-apps/auth/notifications` — the four auth e-mails, delivered through
 * `@12-apps/notifications`.
 *
 * Two factories, at two altitudes:
 *
 * - {@link createAuthMailer} takes a RESOLVED driver. Reach for it when the
 *   host already has one — a queue, an SMTP relay it runs, a vendor SDK.
 * - {@link createEnvAuthMailer} resolves the driver from the environment on
 *   every send, which is the shape every deployment in this fleet actually
 *   wants: a sink in dev and e2e, a vendor in production, and a loud refusal
 *   when neither is configured.
 *
 * ## Why `@12-apps/notifications` is an OPTIONAL peer
 *
 * The same call `hono` gets. A host that delivers through something else
 * implements `EmailCredentialsMailer` directly and never resolves this
 * subpath, so it never installs a package it does not use. Importing the
 * package root, `/react` or `/email-credentials` does not reach this file.
 *
 * The peer is also why the version is the CONSUMER's: a host on notifications
 * v3 and a host on v4 both work, and neither inherits a copy pinned here.
 */

export { createAuthMailer, type AuthMailerConfig } from "./mailer";

export {
  createEnvAuthMailer,
  resolveAppOrigin,
  type AuthMailerEnvNames,
  type AuthMailerLog,
  type EmailDriverFactory,
  type EnvAuthMailerConfig,
} from "./env-mailer";

export {
  createSinkDriver,
  createUnconfiguredDriver,
  type SinkDriverConfig,
  type UnconfiguredDriverConfig,
} from "./drivers";
