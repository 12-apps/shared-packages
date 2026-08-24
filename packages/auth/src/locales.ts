import { EN_US_ACCESS } from "./react/access/en-US";
import type { AccessCopy } from "./react/access/copy";
import { PT_BR_ACCESS } from "./react/access/pt-BR";
import { EN_US_AUTH_ERRORS, EN_US_PAGES } from "./react/pages/en-US";
import type { AuthErrorCopy } from "./react/pages/errors";
import type { AuthPagesCopy } from "./react/pages/index";
import { PT_BR_AUTH_ERRORS, PT_BR_PAGES } from "./react/pages/pt-BR";
import type { EmailAuthCopy } from "./react/screens/copy";
import { EN_US } from "./react/screens/en-US";
import { PT_BR } from "./react/screens/pt-BR";
import type { EmailAuthSettingsCopy } from "./react/settings/copy";
import { EN_US_SETTINGS } from "./react/settings/en-US";
import { PT_BR_SETTINGS } from "./react/settings/pt-BR";
import { EN_US_MAIL } from "./server/mail-templates.en-US";
import type { MailPack } from "./server/mail-templates";
import { PT_BR_MAIL } from "./server/mail-templates.pt-BR";
import { EN_US_MESSAGES } from "./server/en-US";
import type { EmailAuthMessages } from "./server/messages";
import { PT_BR_MESSAGES } from "./server/pt-BR";

/**
 * Every one of this package's six surfaces, in both languages, keyed by tag.
 *
 * Six packs rather than one, because they are read at genuinely different
 * moments by genuinely different people: an API caller (`AUTH_MESSAGES`), a
 * person at a form (`AUTH_SCREENS`), a visitor on the page chrome around it
 * (`AUTH_PAGES` / `AUTH_ERRORS`), an operator at a platform switch
 * (`AUTH_SETTINGS`), and a recipient reading their inbox (`AUTH_MAIL`).
 *
 * The MAIL pack is the one where the locale is not the request's. A message is
 * written for whoever RECEIVES it, so a host resolves it from the recipient's
 * stored preference — not from the `Accept-Language` of whoever triggered the
 * send, which on a password-change notice may well be an attacker.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const AUTH_MESSAGES = {
  "pt-BR": PT_BR_MESSAGES,
  "en-US": EN_US_MESSAGES,
} as const satisfies LocalePack<EmailAuthMessages>;

export const AUTH_MAIL = {
  "pt-BR": PT_BR_MAIL,
  "en-US": EN_US_MAIL,
} as const satisfies LocalePack<MailPack>;

export const AUTH_SCREENS = {
  "pt-BR": PT_BR,
  "en-US": EN_US,
} as const satisfies LocalePack<EmailAuthCopy>;

export const AUTH_ACCESS = {
  "pt-BR": PT_BR_ACCESS,
  "en-US": EN_US_ACCESS,
} as const satisfies LocalePack<AccessCopy>;

export const AUTH_SETTINGS = {
  "pt-BR": PT_BR_SETTINGS,
  "en-US": EN_US_SETTINGS,
} as const satisfies LocalePack<EmailAuthSettingsCopy>;

export const AUTH_PAGES = {
  "pt-BR": PT_BR_PAGES,
  "en-US": EN_US_PAGES,
} as const satisfies LocalePack<AuthPagesCopy>;

export const AUTH_ERRORS = {
  "pt-BR": PT_BR_AUTH_ERRORS,
  "en-US": EN_US_AUTH_ERRORS,
} as const satisfies LocalePack<AuthErrorCopy>;
