import { StockDomainConfigError, StockValueError } from './errors';

/**
 * A CLOSED value set, and the single predicate everything about it is built on.
 *
 * A stock ledger is made of closed vocabularies: which way a movement points,
 * how a shrinkage is sub-classified, which unit a quantity is counted in. What
 * the values ARE is a fact about the adopting application — its operation, its
 * regulator, its accountant — and never a fact this package can know. What is
 * generic is everything around them: the frozen set, the derived type, the
 * narrowing at a trust boundary, and the guarantee that the set a write is
 * validated against is the same set a read is narrowed with.
 *
 * That last guarantee is the reason this is an object rather than a pair of
 * loose helpers. {@link Vocabulary.values} is what a host hands to its schema
 * library to build the WRITE validator; {@link Vocabulary.has} is what its READ
 * path narrows a stored column with. Restating the membership test on either
 * side is how the two come to disagree — one side learns a new value, the other
 * does not, and nothing fails to compile because the losing side widened to
 * `string`. Here `has` is derived FROM `values`, both from one frozen copy, so
 * there is no second statement of the set to fall behind.
 */
export interface Vocabulary<Value extends string> {
  /**
   * What this axis is called. Used in error messages only — it is a label for
   * humans, never a key, so two vocabularies may share one.
   */
  readonly name: string;

  /**
   * Every value, in declaration order, frozen.
   *
   * Typed as a NON-EMPTY tuple because that is what schema libraries ask for
   * (`z.enum` and its equivalents refuse an unbounded `string[]`), and because
   * the emptiness this package refuses at assembly should also be a thing an
   * adopter's compiler knows.
   *
   * Order is preserved: a host's enum, its select box and its stored column all
   * read this array, and re-ordering it moves a published schema.
   */
  readonly values: readonly [Value, ...Value[]];

  /**
   * What a value that is not in the set becomes on a lenient READ, and what an
   * inert column carries. Guaranteed to be a member — {@link coerce} would
   * otherwise hand back a value the host's own write validator rejects, which
   * is a narrowing that cannot fail: a cast wearing a guard's clothes.
   */
  readonly fallback: Value;

  /**
   * THE predicate. Narrows an untrusted value to a member.
   *
   * Takes `unknown` rather than `Value`: this is the boundary where a form
   * field, a query parameter or a database column becomes a domain value, and a
   * parameter already typed as the union would make the check vacuous. `unknown`
   * rather than `string` because the untrusted thing is frequently not even
   * known to be a string yet (a JSON snapshot field, a parsed body), and forcing
   * every caller to pre-narrow is how a `String(x)` creeps in and turns `null`
   * into the value `"null"`.
   */
  has(value: unknown): value is Value;

  /** Narrow or throw {@link StockValueError} — the strict boundary. */
  parse(value: unknown): Value;

  /** Narrow or return {@link fallback} — the lenient boundary. */
  coerce(value: unknown): Value;
}

/** What a host declares for one axis. */
export interface VocabularySpec<Value extends string> {
  /** A human label for this axis, used in error messages. */
  readonly name: string;

  /**
   * The values, in the order the host wants them advertised. May not be empty,
   * may not repeat, and may not contain a blank string.
   *
   * This is the ONLY field `Value` is inferred from, which is what makes the
   * compiler refuse a `fallback` outside the set. Left inferrable, a typo there
   * simply widens `Value` to include itself and the compile error disappears —
   * the runtime guard would still catch it, but at boot rather than in the
   * editor, and a check that can only fire at runtime is a check an adopter
   * meets later than they had to.
   */
  readonly values: readonly Value[];

  /** The member a lenient read falls back to. Must be one of {@link values}. */
  readonly fallback: NoInfer<Value>;
}

/**
 * Build a {@link Vocabulary}, refusing at ASSEMBLY anything that would make it
 * unsafe later.
 *
 * Every refusal below is a fail-OPEN this package would otherwise ship:
 *
 * - **An empty set.** The tempting reading is "declare nothing and nothing is
 *   allowed", which is a closed door. It is not what happens. There is no
 *   member for `fallback` to be, so `coerce` — the read path — must return
 *   SOMETHING outside the set, typed as though it were inside; and a host
 *   building its write validator from a zero-length array gets a schema that
 *   either throws at construction or, in the libraries that tolerate it,
 *   matches nothing while the read path keeps minting values. Refusing here is
 *   the only reading that is honest in both directions.
 * - **A blank value.** An empty or whitespace-only member is admitted by every
 *   "is it filled in" check a host has, so an unset form field validates as a
 *   deliberate choice.
 * - **A value with surrounding whitespace.** What a comma-separated setting or
 *   environment variable produces, and the one malformation whose every
 *   consequence is silent: the published enum carries the padded value, so the
 *   write side refuses every stored row, and the read side coerces the whole
 *   column to `fallback`.
 * - **A duplicate.** Two identical members make "the vocabulary widened" and
 *   "the vocabulary did not" produce the same array length, which is what a
 *   host's drift test usually watches.
 * - **A `fallback` outside the set.** See {@link Vocabulary.fallback}.
 *
 * The values are COPIED and frozen. A host that keeps a reference to the array
 * it passed in cannot later push into the set a write validator was already
 * built from while the read predicate follows along — reads and writes drifting
 * apart at runtime, from one line nowhere near either.
 */
export function defineVocabulary<const Value extends string>(
  spec: VocabularySpec<Value>,
): Vocabulary<Value> {
  const name = requireLabel(spec?.name);
  const values = freezeValues(name, spec.values);
  // The membership test, stated ONCE and derived from the frozen copy. `parse`,
  // `coerce`, the `fallback` check below and every taxonomy rule call this.
  const members = new Set<string>(values);
  const has = (value: unknown): value is Value =>
    typeof value === 'string' && members.has(value);

  const fallback = spec.fallback;
  // The whitespace hint again: `values` is already known to be trimmed, so a
  // fallback that only differs by surrounding space would otherwise be reported
  // as "not one of these" beside a list it visibly appears in. Computed BEFORE
  // the guard, because inside it `fallback` has been narrowed to `never`.
  const trimmed = typeof fallback === 'string' ? fallback.trim() : '';
  if (!has(fallback)) {
    throw new StockDomainConfigError(
      `${name}.fallback`,
      has(trimmed)
        ? `has surrounding whitespace — declare it as "${trimmed}".`
        : `must be one of the declared values (${values.join(', ')}).`,
    );
  }

  return Object.freeze({
    name,
    values,
    fallback,
    has,
    parse: (value: unknown): Value => {
      if (has(value)) return value;
      throw new StockValueError(name, value);
    },
    coerce: (value: unknown): Value => (has(value) ? value : fallback),
  });
}

/** The axis label, which error messages are useless without. */
function requireLabel(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new StockDomainConfigError('name', 'must be a non-blank string.');
  }
  return name;
}

/**
 * The declared values as a frozen, non-empty tuple — or a config error.
 *
 * The non-emptiness is established by DESTRUCTURING rather than asserted, so
 * the tuple type handed to the compiler is one the runtime has already proved.
 */
function freezeValues<Value extends string>(
  name: string,
  declared: readonly Value[],
): readonly [Value, ...Value[]] {
  const path = `${name}.values`;
  if (!Array.isArray(declared)) {
    throw new StockDomainConfigError(path, 'must be an array of strings.');
  }
  const [first, ...rest] = declared;
  if (first === undefined) {
    throw new StockDomainConfigError(
      path,
      'must declare at least one value — an empty vocabulary has no member for `fallback` to be, so the read path would mint values the write path refuses.',
    );
  }
  const seen = new Set<string>();
  for (const value of [first, ...rest]) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new StockDomainConfigError(path, 'every value must be a non-blank string.');
    }
    if (value !== value.trim()) {
      // The single commonest malformation on the no-compiler path this package's
      // runtime guards exist for. A settings row or an environment variable
      // holding `A, B` is split on the comma and the second value arrives with a
      // leading space — and every consequence of that is SILENT: the wire enum
      // publishes `" B"`, so the write validator refuses every stored `B`, while
      // the read path coerces the whole column to `fallback`. On the direction
      // axis that is the sign of the movement, quietly re-decided for every row.
      //
      // Refused rather than trimmed, because trimming means `values` is not what
      // the host declared, and `values` is what its schema, its select box and
      // its stored column are compared against. It is also what keeps the
      // duplicate check below honest: `['A', 'A ']` is a near-duplicate no
      // length-based drift test can see, and it never reaches that check.
      throw new StockDomainConfigError(
        path,
        `"${value}" has surrounding whitespace — declare it as "${value.trim()}". A value split out of a comma-separated setting is the usual cause, and every consequence of keeping the space is silent.`,
      );
    }
    if (seen.has(value)) {
      throw new StockDomainConfigError(path, `"${value}" is declared more than once.`);
    }
    seen.add(value);
  }
  return Object.freeze([first, ...rest]) as readonly [Value, ...Value[]];
}

/** The member type of a {@link Vocabulary} — what a host names its own union. */
export type VocabularyValue<V> = V extends Vocabulary<infer Value> ? Value : never;
