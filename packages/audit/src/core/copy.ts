/**
 * What a copy field takes once its words can follow a reader.
 *
 * These three declarations used to live in `server/config.ts`, beside the one
 * field that needed them. The vocabulary needs them too — an action's LABEL is
 * as much a sentence an operator reads as a refusal is — and `core/` cannot
 * import from `server/`, so they moved down to the layer both halves already
 * depend on. `server/config.ts` re-exports them under their original names, so
 * nothing an adopter imports has moved.
 *
 * Declared here rather than imported from `@12-apps/i18n`: this package must
 * stay liftable into a repo that has never heard of it, so the two agree
 * STRUCTURALLY and nothing forces the dependency. The context is deliberately
 * loose — a raw tag off the wire, unnarrowed — because matching it is the host
 * resolver's job, not this package's.
 */

/**
 * What a resolver is told.
 *
 * **Absent means "nobody said", not "pt-BR is fine".** A vocabulary read
 * outside a request, a mount-time validation probe, a job with no reader —
 * each has no language to report, and saying so is different from asserting
 * one. Turning "not told" into a default is the HOST resolver's job, in the one
 * place it wrote it; this package never invents a tag of its own.
 */
export interface AuditCopyContext {
  readonly locale?: string | null;
}

export type AuditCopyResolver<T> = (context: AuditCopyContext) => T;
export type AuditCopySource<T> = T | AuditCopyResolver<T>;

/**
 * The words a source is offering, at the moment they are needed.
 *
 * Call this where the sentence is USED, never where the surface is built. A
 * caller that resolves at construction and stores the result has re-frozen the
 * language into its mount — which is the exact thing the resolver exists to
 * undo, and it does so invisibly, because a single-locale host cannot tell the
 * difference.
 */
export function resolveAuditCopy<T>(source: AuditCopySource<T>, context: AuditCopyContext): T {
  return typeof source === 'function' ? (source as AuditCopyResolver<T>)(context) : source;
}
