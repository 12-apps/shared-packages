/**
 * What a copy field takes once its words can follow a reader.
 *
 * ## Why this type is declared here and not imported
 *
 * `@12-apps/i18n` owns the locale axis and exports exactly this shape as
 * `CopySource<T>`. This package does not import it, for the reason the copy
 * port rests on: every one of these packages must stay liftable into a repo
 * that has never heard of `@12-apps/i18n`, so a shared TYPE that forced a
 * shared DEPENDENCY would trade that portability for a little convenience. The
 * two declarations agree STRUCTURALLY, which is all `localeCopy(PACK)` needs to
 * be assignable here.
 *
 * The context is deliberately loose — a raw language tag as some transport
 * handed it over, unnarrowed. Requiring a canonical `Locale` would make a host's
 * `localeCopy(PACK)` unassignable to this mirror under `strictFunctionTypes`,
 * and the workaround every adopter would reach for is a cast: the type system
 * told to stop checking at exactly the seam this contract exists to police.
 *
 * ## Absent means "nobody said"
 *
 * A missing tag is not a request for Portuguese; it is a request with no reader
 * attached — an adapter that never negotiated one, a surface mounted outside a
 * request, a job. The DEFAULT belongs in the host's resolver, applied in one
 * place a reader can find, rather than at each call site here picking a
 * fallback of its own. So nothing in this package invents a language: a config
 * holding a plain pack answers with that pack, and a config holding a resolver
 * forwards whatever it was told, `undefined` included.
 *
 * ## Both halves of this package share it
 *
 * `./server`'s `AppShellServerMessages` and `./react`'s `AppShellMessages` are
 * different sentences read by different people, but they are the same KIND of
 * field, and one mirror is what keeps them from drifting into two spellings of
 * the same idea. The core is framework-free, so importing it costs the browser
 * bundle two pure functions and costs the backend nothing.
 */

/** Copy chosen per call, rather than bound once at a mount. */
export type AppShellCopyResolver<T> = (context: { readonly locale?: string | null }) => T;

/**
 * A pack, or a resolver that picks one per reader.
 *
 * The plain value stays legal on purpose: a host with one audience passes its
 * table and nothing about its adoption changes.
 */
export type AppShellCopySource<T> = T | AppShellCopyResolver<T>;

/**
 * The copy a field is currently offering, at the moment it is needed.
 *
 * Call this where the sentence is USED, never where the surface is built. A
 * factory that resolves once and stores the result has re-frozen the language
 * into its mount — and it does so invisibly, because a single-locale host
 * cannot tell the difference.
 */
export function resolveAppShellCopy<T>(
  source: AppShellCopySource<T>,
  locale?: string | null,
): T {
  return typeof source === 'function'
    ? (source as AppShellCopyResolver<T>)({ locale })
    : source;
}
