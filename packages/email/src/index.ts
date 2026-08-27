/**
 * `@12-apps/email` — one transactional-mail layout, and the vocabulary its two
 * halves share.
 *
 * Framework-free and dependency-free: safe in a browser, in a job, in a
 * webhook. The preview catalogue and its routes are `./server`; the operator
 * screen is `./react`; the shipped copy packs are `./locales`.
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
