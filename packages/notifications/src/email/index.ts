/**
 * `@12-apps/notifications/email` — ONE transactional-mail layout.
 *
 * ## Why it lives in this package
 *
 * This package already owned the delivery half: the `EmailDriver` port, the
 * vendor table (`EMAIL_DRIVERS`) and, in `server/transports/email.ts`, a
 * `formatEmail` that built a mail out of three `<p>` tags. That formatter is
 * one of the three ad-hoc renderers this layout replaces — so shipping the
 * layout anywhere else would have left the replacement in a package this one
 * does not depend on, and the estate's own lesson is that adoption without
 * deletion is the worst of both: two ways to render a mail, both maintained.
 *
 * Here, `formatEmail` renders THROUGH the layout the moment a host supplies a
 * brand and a copy pack, and the ad-hoc path is what remains when it does not.
 *
 * Framework-free and dependency-free: safe in a browser, in a job, in a
 * webhook — which is why it is its own subpath rather than part of `.`, whose
 * consumers are the inbox and the preference matrix.
 *
 * The preview catalogue and its routes are `./email/previews`; the operator
 * screen is `./email/previews/react`; the layout's own copy packs are
 * `./email/locales`.
 */
export {
  renderEmail,
  renderEmailHtml,
  safeHref,
  type EmailAction,
  type EmailChromeCopy,
  type EmailDocument,
  type EmailFact,
  type RenderedEmail,
} from './template';

export { renderEmailText } from './text';

export {
  EMAIL_CONTENT_WIDTH,
  EMAIL_FONT_STACK,
  NEUTRAL_EMAIL_THEME,
  type EmailTheme,
} from './theme';
