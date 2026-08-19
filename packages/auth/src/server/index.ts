/**
 * `@12-apps/auth/server` — the framework-neutral half of the HTTP surface.
 *
 * Route DESCRIPTORS and the refusal vocabulary, with no framework imported. A
 * host on Hono mounts `@12-apps/auth/hono`; a host on anything else adapts
 * these directly and never resolves Hono at all.
 */
export { emailAuthRoutes } from "./email-routes";
export type {
  EmailAuthRoute,
  EmailAuthRequest,
  EmailAuthResponse,
  EmailAuthRoutesConfig,
} from "./email-routes";

export { EMAIL_AUTH_STATUS, PT_BR_MESSAGES } from "./messages";
export type { EmailAuthMessages } from "./messages";

export { emailAuthSettingsRoutes } from "./settings-routes";
export type {
  EmailAuthSettingsStore,
  EmailAuthSettingsRoutesConfig,
} from "./settings-routes";

export { PT_BR_MAIL, renderAuthMail } from "./mail-templates";
export type { MailCopy, MailPack, RenderedMail } from "./mail-templates";
