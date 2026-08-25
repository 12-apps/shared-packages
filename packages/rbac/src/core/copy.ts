/**
 * What a copy field takes once its words can follow a reader.
 *
 * ## Why this type is declared here and not imported
 *
 * `@12-apps/i18n` owns the locale axis and exports exactly this shape as
 * `CopySource<T>`. This package does not import it, for the reason the copy
 * port rests on: it must stay liftable into a repo that has never heard of
 * `@12-apps/i18n`, so a shared TYPE that forced a shared DEPENDENCY would trade
 * that portability for a little convenience. The two declarations agree
 * STRUCTURALLY, which is all `localeCopy(PACK)` needs to be assignable here.
 *
 * The context is deliberately loose — a raw language tag as some transport
 * handed it over, unnarrowed. Requiring a canonical `Locale` would make a
 * host's `localeCopy(PACK)` unassignable to this mirror under
 * `strictFunctionTypes`, and the workaround every adopter would reach for is a
 * cast: the type system told to stop checking at exactly the seam this contract
 * exists to police.
 *
 * ## Why it moved out of `../server/context`
 *
 * The refusal messages took a resolver first and declared the mirror beside
 * themselves. The LABEL vocabulary is the same kind of field and is read by the
 * screens, so the two halves of this package now need one declaration between
 * them — `../server/context` re-exports these names unchanged, which is what
 * keeps the import path every adopter already writes working.
 *
 * ## Absent means "nobody said"
 *
 * A missing tag is not a request for Portuguese; it is a request with no reader
 * attached. The DEFAULT belongs in the host's resolver, applied in one place a
 * reader can find, rather than at each call site here picking a fallback of its
 * own. So nothing in this package invents a language.
 */

/** Copy chosen per call, rather than bound once at a mount. */
export type RbacCopyResolver<T> = (context: { readonly locale?: string | null }) => T;

/**
 * A pack, or a resolver that picks one per reader.
 *
 * The plain value stays legal on purpose: a host with one audience passes its
 * table and nothing about its adoption changes.
 */
export type RbacCopySource<T> = T | RbacCopyResolver<T>;

/**
 * The copy a field is currently offering, at the moment it is needed.
 *
 * Call this where the sentence is USED, never where the surface is built.
 */
export function resolveRbacCopy<T>(source: RbacCopySource<T>, locale?: string | null): T {
  return typeof source === 'function' ? (source as RbacCopyResolver<T>)({ locale }) : source;
}
