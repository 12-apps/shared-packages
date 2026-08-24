/**
 * `@12-apps/i18n` — the locale axis for a family of packages whose words are
 * already the host's.
 *
 * These packages state every sentence they render as required, typed config
 * with no defaults, and ship a named pack per language. That interface IS the
 * translation schema; what was missing was the axis — something to say WHICH
 * language, resolved once per reader, and a shared shape so nineteen packages
 * do not each invent one.
 *
 * This package is deliberately small and deliberately HOST-SIDE. Packages that
 * ship copy do not import it: they export a plain record keyed by tag, which is
 * structurally a {@link LocalePack} without the dependency. See `core/pack.ts`
 * for why that is the design rather than an omission.
 *
 * Framework-free here; `./react` mounts the provider, `./server` reads a locale
 * off a web-standard `Request`, and `./testing` holds the parity assertion each
 * bilingual package's suite calls.
 */
export {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  matchLocale,
  type Locale,
} from './core/locale';

export {
  localeCopy,
  resolveCopy,
  selectCopy,
  type CopyContext,
  type CopyResolver,
  type CopySource,
  type LocalePack,
} from './core/pack';

export {
  negotiateLocale,
  parseAcceptLanguage,
  resolveLocale,
  type LocaleCandidates,
} from './core/negotiate';

export { createFormats, EMPTY, type FormatOptions, type Formats } from './core/formats';
