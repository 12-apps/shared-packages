/**
 * A locale pack, and the two ways a host hands one to a package.
 *
 * ## The shape a package ships
 *
 * Every package that renders words already states them as a typed interface
 * with no defaults (the copy-portability doctrine). A second language is a
 * second value satisfying that same interface, and a pack is just the two of
 * them keyed by tag:
 *
 * ```ts
 * export const DISCOUNTS_WEB_COPY = {
 *   'pt-BR': PT_BR_DISCOUNTS_WEB_COPY,
 *   'en-US': EN_US_DISCOUNTS_WEB_COPY,
 * } as const satisfies LocalePack<DiscountsWebCopy>;
 * ```
 *
 * A package does NOT import this type to write that line — it declares a local
 * structural mirror instead, and the reason is the whole point of these
 * packages: `@12-apps/payments-*` is forbidden from importing a sibling
 * workspace package at all (`payments/no-host-imports`), and every other
 * package is meant to be liftable into a repo that has never heard of
 * `@12-apps/i18n`. A shared TYPE that forces a shared DEPENDENCY would trade
 * the portability the copy port bought for a little convenience. The two
 * declarations agree structurally, and `scripts/locale-coverage-gate.mjs`
 * checks that they agree by tag.
 *
 * ## Why there is no `T | LocalePack<T>` union
 *
 * Sniffing at runtime for "is this a pack or is it the copy itself" needs a
 * guess about whether an object having a `pt-BR` key means it IS a pack — and
 * the day some copy interface grows a field with that name, the guess is
 * wrong in the silent direction. So the two forms are separate: a value, or a
 * resolver. {@link localeCopy} turns a pack into the resolver, which is the
 * one line a host writes at a mount.
 */
import { DEFAULT_LOCALE, type Locale } from './locale';

/** One value per canonical locale. */
export type LocalePack<T> = Readonly<Record<Locale, T>>;

/** What a resolver is told. A bag, so a later axis (currency, tenant) is additive. */
export interface CopyContext {
  readonly locale: Locale;
}

/** Copy chosen per call, rather than bound once at mount. */
export type CopyResolver<T> = (context: CopyContext) => T;

/**
 * What a package's config accepts for a copy field once it is locale-aware.
 *
 * The plain value stays legal on purpose: a host with one audience passes
 * `copy: PT_BR_X` and nothing about its adoption changes. The resolver is what
 * a host reaches for when the language is a property of the REQUEST rather
 * than of the deployment — and a package that reads the field through
 * {@link resolveCopy} at the moment it needs a sentence supports both with no
 * branch of its own.
 */
export type CopySource<T> = T | CopyResolver<T>;

/** The copy for one locale, falling back to {@link DEFAULT_LOCALE}. */
export function selectCopy<T>(pack: LocalePack<T>, locale: Locale = DEFAULT_LOCALE): T {
  return pack[locale] ?? pack[DEFAULT_LOCALE];
}

/** A pack as the resolver a locale-aware config field takes. */
export function localeCopy<T>(pack: LocalePack<T>): CopyResolver<T> {
  return ({ locale }) => selectCopy(pack, locale);
}

/**
 * The copy a config field is currently offering, at the moment it is needed.
 *
 * Call this where the sentence is USED, never where the surface is built. A
 * package that resolves at build time and stores the result has re-frozen the
 * language into its mount, which is the exact thing the resolver exists to
 * undo — and it does so invisibly, because a single-locale host cannot tell
 * the difference.
 */
export function resolveCopy<T>(source: CopySource<T>, context: CopyContext): T {
  return typeof source === 'function' ? (source as CopyResolver<T>)(context) : source;
}
