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
function resolveAuditCopy<T>(source: AuditCopySource<T>, context: AuditCopyContext): T {
  return typeof source === 'function' ? (source as AuditCopyResolver<T>)(context) : source;
}

/*
 * ---------------------------------------------------------------------------
 * A LABEL is copy, so its validation and its read live here too.
 *
 * They came out of `core/vocabulary.ts` when the label started taking a
 * resolver: that module's subject is the CLOSED SETS — which actions exist,
 * which fields a diff may carry — and three helpers about resolving words were
 * the only thing in it that was not. Moving them also kept that file under the
 * complexity gate's line ceiling, which is the gate noticing the same thing.
 * ---------------------------------------------------------------------------
 */
import { AuditConfigError } from './errors';

/** A label a human can read, or a config error. */
export function requireLabel(path: string, label: unknown): AuditCopySource<string> {
  // A RESOLVER is probed once, here, with no locale — the same move
  // `createApiAudit` makes for `messages`, and for the same reason: a host
  // whose label lookup missed should fail to BOOT, not render an empty cell to
  // the one operator who happens to read in the language that was wrong. The
  // probe is what keeps assembly's refusals honest now that the value can be
  // computed; without it, widening the type would have quietly turned every
  // check below into "unless you pass a function".
  if (typeof label === 'function') {
    const probed: unknown = (label as AuditCopyResolverProbe)({});
    assertLabelText(`${path}()`, probed);
    return label as AuditCopySource<string>;
  }
  assertLabelText(path, label);
  return label as string;
}

/** The probe shape — a resolver called with the empty context, nothing more. */
type AuditCopyResolverProbe = (context: AuditCopyContext) => unknown;

function assertLabelText(path: string, label: unknown): void {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new AuditConfigError(
      path,
      'must be a non-blank string — the viewer renders it where an operator ' +
        'expects the name of what happened.',
    );
  }
}

/**
 * One label, for one reader.
 *
 * Falls back to the raw id twice over: for an id this vocabulary never declared
 * (an entry written before a rename — the behaviour that predates the locale
 * axis), and for a resolver that answered with nothing usable for THIS reader.
 * The second is deliberately not a throw: assembly already probed every
 * resolver, so reaching here means one language of a pack is short a line, and
 * a raw dotted id in one cell is a better answer to that than a viewer that
 * renders no rows at all.
 */
export function readLabel(
  source: AuditCopySource<string> | undefined,
  id: string,
  context: AuditCopyContext,
): string {
  if (source === undefined) return id;
  const label = resolveAuditCopy(source, context);
  return typeof label === 'string' && label.trim() !== '' ? label : id;
}
