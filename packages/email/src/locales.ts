import { EN_US_EMAIL_CHROME } from './chrome.en-US';
import { PT_BR_EMAIL_CHROME } from './chrome.pt-BR';
import type { EmailChromeCopy } from './template';

/**
 * The layout's own words, in every language this package ships.
 *
 * Its own subpath (`@12-apps/email/locales`) for the reason every copy-shipping
 * package here uses one: the packs are the only Portuguese in the tarball, and
 * keeping them off the root entry is what lets the root stay the framework-free
 * mechanism a browser can import.
 *
 * Shaped as `Record<tag, pack>` rather than importing `@12-apps/i18n`'s
 * `LocalePack`: a package must stay liftable into a repo that has never heard
 * of that one, so the type is a local structural mirror. The two agree by tag,
 * and `scripts/locale-coverage-gate.mjs` is what checks that they do.
 *
 * A host with ONE audience passes a pack by name. A host whose readers do not
 * share a language passes `localeCopy(EMAIL_CHROME)` and each message is
 * written in its own recipient's language — which is the whole reason
 * `EmailDocument.chrome` is resolved per message rather than at a mount.
 */
export const EMAIL_CHROME: Readonly<Record<string, EmailChromeCopy>> = {
  'pt-BR': PT_BR_EMAIL_CHROME,
  'en-US': EN_US_EMAIL_CHROME,
};

export { EN_US_EMAIL_CHROME, PT_BR_EMAIL_CHROME };
