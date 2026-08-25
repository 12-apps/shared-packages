/**
 * The resolver shape every copy field in this package accepts.
 *
 * It lived in `http/types.ts` until the connector context needed it too — and
 * that file already imports FROM `connectors/`, so the shared home had to be a
 * third module rather than either of the two. `http/types.ts` re-exports the
 * trio, so no existing import path changed.
 *
 * Declared here rather than imported from `@12-apps/i18n`: this package must
 * stay liftable into a repo that has never heard of it, so the two agree
 * STRUCTURALLY and nothing forces the dependency. The context is deliberately
 * loose — a raw tag off the wire, unnarrowed — because matching it is the host
 * resolver's job, not this package's.
 */
export type ResearchCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
export type ResearchCopySource<T> = T | ResearchCopyResolver<T>;

/**
 * The copy a field is offering, at the moment it is needed.
 *
 * Call this where the sentence is USED, never where the surface or the
 * connector context is built: both are assembled once for a whole process or a
 * whole run, so a value resolved there answers every reader in the language it
 * started with — and a single-locale host cannot tell the difference.
 */
export function resolveResearchCopy<T>(
  source: ResearchCopySource<T>,
  locale: string | undefined,
): T {
  return typeof source === 'function'
    ? (source as ResearchCopyResolver<T>)({ locale })
    : source;
}
