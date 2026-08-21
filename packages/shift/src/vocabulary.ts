import { ShiftConfigError } from './errors';

/**
 * The set of shift kinds a HOST works in, and the guard over it.
 *
 * `kind` is the one field on a shift whose values are a statement about a
 * product rather than about work periods. This package used to answer that
 * statement itself, with a two-entry list taken from the staff structure of the
 * application it was extracted from — exported as a runtime value, as a type
 * union AND as a database CHECK constraint. Every adopter inherited it.
 *
 * That shape is worse than a leaked copy string, which is cosmetic and visible
 * the moment somebody reads a screen. A union propagates: it reaches an
 * adopter's OpenAPI, its generated clients and its own column, where nothing
 * short of a migration can dislodge it.
 *
 * So the vocabulary arrives as an argument. A host states its kinds once, and
 * this module turns them into the guard that both {@link createShiftService}
 * and the host's own read path can share — one declaration, so a value the
 * service accepts and a value the host narrows to can never drift apart.
 */

/**
 * A host's kinds, as written: at least one, and inferred as literals when the
 * call site passes an `as const` tuple.
 *
 * Non-empty in the TYPE because a service with no admissible kind can open no
 * shift at all — a wiring mistake worth catching where it is written rather
 * than at the first open. {@link defineShiftVocabulary} repeats the check at
 * runtime for callers whose types this package never sees.
 */
export type ShiftKindTuple = readonly [string, ...string[]];

export interface ShiftVocabulary<Kind extends string = string> {
  /** The declared kinds, in the order the host wrote them. */
  readonly kinds: readonly Kind[];
  /**
   * Whether `kind` is one of them — a type guard, so a host reading a `string`
   * column back out of its database narrows to its own union through the same
   * declaration the service validates against.
   */
  has(kind: string): kind is Kind;
}

function assertUsableKinds(kinds: readonly string[]): void {
  if (kinds.length === 0) {
    throw new ShiftConfigError('A shift vocabulary must declare at least one kind.');
  }
  const blank = kinds.find((kind) => typeof kind !== 'string' || kind.trim().length === 0);
  if (blank !== undefined) {
    throw new ShiftConfigError('A shift kind must be a non-empty string.');
  }
  const duplicate = kinds.find((kind, index) => kinds.indexOf(kind) !== index);
  if (duplicate !== undefined) {
    throw new ShiftConfigError(`Duplicate shift kind: ${duplicate}.`);
  }
}

/**
 * Validate a host's kinds and return the guard over them.
 *
 * Assembly-time, deliberately: a duplicate or an empty entry is a wiring
 * defect, and the useful moment to hear about it is the one where the host is
 * being wired — not the request where a worker cannot clock in.
 */
export function defineShiftVocabulary<const Kinds extends ShiftKindTuple>(
  kinds: Kinds,
): ShiftVocabulary<Kinds[number]> {
  assertUsableKinds(kinds);
  const declared = [...kinds] as readonly Kinds[number][];
  const admitted = new Set<string>(declared);
  return {
    kinds: declared,
    has: (kind: string): kind is Kinds[number] => admitted.has(kind),
  };
}
