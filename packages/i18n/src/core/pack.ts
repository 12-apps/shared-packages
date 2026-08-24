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
import { DEFAULT_LOCALE, matchLocale, type Locale } from './locale';

/** One value per canonical locale. */
export type LocalePack<T> = Readonly<Record<Locale, T>>;

/**
 * What a resolver is told. A bag, so a later axis (currency, tenant) is additive.
 *
 * ## Why `locale` is a loose string, and why it may be absent
 *
 * The caller is a PACKAGE, and a package cannot import this module — that is
 * the portability rule the whole copy port rests on, restated in the file
 * docblock. So the thing that calls a resolver holds a locally-declared
 * structural mirror of {@link CopyResolver}, and what it can honestly put in
 * this bag is whatever its own transport handed it: `@12-apps/wiring` carries
 * `WireRequest.locale`, a raw BCP-47 string off the wire, and nothing narrows
 * it to {@link Locale} on the way.
 *
 * Requiring `Locale` here would make that mirror structurally incompatible
 * under `strictFunctionTypes` — a host's `localeCopy(PACK)` would not be
 * assignable to a package's `copy` field — and the workaround every adopter
 * would reach for is a cast, which is the type system being told to stop
 * checking at exactly the seam this contract exists to police.
 *
 * **Absent means "nobody told me", not "the default is fine".** An adapter
 * that never populates a locale, a package mounted outside a request, a job
 * with no reader — each has no language to report, and saying so is different
 * from asserting pt-BR. {@link localeCopy} is what turns "not told" into
 * {@link DEFAULT_LOCALE}, in one place a reader can find, rather than at each
 * of the dozens of call sites that would otherwise each pick a fallback.
 */
export interface CopyContext {
  readonly locale?: Locale | string | null;
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

/**
 * A pack as the resolver a locale-aware config field takes.
 *
 * The tag is MATCHED rather than trusted, because {@link CopyContext} accepts
 * whatever the package's transport was handed — `?lang=en`, an `Accept-Language`
 * fragment, a stale `es-AR` on a user row. `matchLocale` answers `null` for
 * anything this app does not speak, and that (like an absent tag) lands on
 * {@link DEFAULT_LOCALE}: a language we cannot render is not a reason to render
 * nothing, and it is the same fallback the negotiation path already applies.
 */
export function localeCopy<T>(pack: LocalePack<T>): CopyResolver<T> {
  return ({ locale }) => selectCopy(pack, matchLocale(locale) ?? DEFAULT_LOCALE);
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
