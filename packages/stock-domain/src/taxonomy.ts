import { StockDomainConfigError } from './errors';
import { defineVocabulary, type Vocabulary, type VocabularySpec } from './vocabulary';

/**
 * A stock-movement reason taxonomy: two axes and the rule that ties them.
 *
 * The SHAPE is generic and is what this package owns. A reason sits on a
 * direction axis — whether it explains stock leaving or stock arriving — which
 * is what decides a movement's sign, and therefore what any report totalling
 * outflow must filter on. A second axis sub-classifies reasons, but only on
 * SOME directions: the sub-classification of an inbound reason is meaningless,
 * so the column exists on every row and carries an inert value on those.
 *
 * The VALUES are not generic and are not here. Which directions an operation
 * recognises, and how it sub-classifies them, is a fact about that operation.
 *
 * Two things this shape makes explicit that a pair of loose arrays cannot:
 *
 * - **Which directions take a sub-classification.** Without it, "the value is
 *   inert on the other axis" lives in a comment, and every read site re-decides
 *   it by naming one of the host's own direction values inline — which is the
 *   same value vocabulary leaking, one `if` at a time.
 * - **That the two axes may OVERLAP.** A value can legitimately name both a
 *   direction and a sub-classification, which is exactly why a caller reading
 *   the sub-classification learns nothing about the direction. Nothing here
 *   requires the sets to be disjoint, and nothing requires them to overlap.
 */
export interface StockReasonTaxonomy<Kind extends string, Category extends string> {
  /** The direction axis: which way the movement a reason explains points. */
  readonly kinds: Vocabulary<Kind>;

  /** The sub-classification axis, meaningful on {@link categoryAppliesTo}. */
  readonly categories: Vocabulary<Category>;

  /** The kinds a category carries meaning on, frozen and non-empty. */
  readonly categoryAppliesTo: readonly [Kind, ...Kind[]];

  /**
   * Does a category mean anything for this kind?
   *
   * Answers `false` for a kind that is not in the vocabulary at all, so an
   * untrusted value cannot buy its way into the applicable branch.
   */
  categoryApplies(kind: unknown): boolean;

  /**
   * The category to STORE for a kind — the strict, write-side rule.
   *
   * THREE cases, and they are deliberately not two:
   *
   * 1. **The kind is not a kind at all.** Throws {@link StockValueError}. The
   *    parameter is `unknown` because the caller usually holds a raw wire value,
   *    and folding an unknown kind into the inert branch would return a
   *    clean-looking category for a write that should never have been attempted
   *    — the user's chosen sub-classification discarded with nothing failing.
   *    That is the same harm an empty `categoryAppliesTo` is refused for, per
   *    row instead of per vocabulary.
   * 2. **The kind takes no category.** The supplied value is ignored entirely
   *    and the inert {@link Vocabulary.fallback} is returned: an inert column is
   *    not worth refusing a write over, and validating it would make the host
   *    invent a value for a field that means nothing on that row.
   * 3. **The kind takes one.** The value is parsed — a bad category throws
   *    rather than quietly becoming the fallback, because on the write side a
   *    silent substitution stores a classification the user did not choose.
   */
  categoryFor(kind: unknown, value: unknown): Category;

  /**
   * A stored row narrowed to domain values — the lenient, read-side rule.
   *
   * Reads are lenient on purpose and writes are not: one malformed legacy row
   * should not take down the screen listing it, while a write that would create
   * such a row has a user in front of it who can be told. Both sides run the
   * same {@link Vocabulary.has} underneath, so "lenient" only ever changes what
   * happens to a REJECTED value, never which values are rejected.
   */
  coerceReason(row: { kind: unknown; category: unknown }): { kind: Kind; category: Category };
}

/** What a host declares to build a taxonomy. */
export interface StockReasonTaxonomySpec<Kind extends string, Category extends string> {
  /** The direction axis. */
  readonly kinds: VocabularySpec<Kind>;

  /** The sub-classification axis. */
  readonly categories: VocabularySpec<Category>;

  /**
   * Which kinds a category is meaningful on. Must be non-empty, must not
   * repeat, and every entry must be one of `kinds.values`.
   *
   * Non-inferring, for the same reason `fallback` is: were `Kind` allowed to
   * widen from here, a typo would name a direction into existence and the
   * compiler would agree with it.
   */
  readonly categoryAppliesTo: readonly NoInfer<Kind>[];
}

/**
 * Build a {@link StockReasonTaxonomy}, refusing at ASSEMBLY.
 *
 * Both axes go through {@link defineVocabulary}, so every refusal it makes
 * applies here — this is the documented adoption path, and a guard reachable
 * only from some other factory is a guard the adopter never meets.
 *
 * `categoryAppliesTo` gets two refusals of its own, and both are fail-OPEN
 * rather than fail-closed:
 *
 * - **Empty.** Every kind then takes no category, so `categoryFor` returns the
 *   inert fallback for every row and the sub-classification a user picked is
 *   discarded on the way to the database — silently, for the whole vocabulary,
 *   with no failed write anywhere to notice it by. Declaring an axis and
 *   declaring nowhere for it to apply is a wiring bug, not a way to switch the
 *   axis off; a host that wants no sub-classification declares a one-value
 *   vocabulary and points it at any kind.
 * - **An unknown kind.** A typo names a direction that does not exist, so the
 *   real one silently stops taking categories — the same discard, narrowed to
 *   one axis value, which is harder to notice rather than easier.
 */
export function defineStockReasonTaxonomy<
  const Kind extends string,
  const Category extends string,
>(spec: StockReasonTaxonomySpec<Kind, Category>): StockReasonTaxonomy<Kind, Category> {
  const kinds = defineVocabulary(requireAxis('kinds', spec?.kinds));
  const categories = defineVocabulary(requireAxis('categories', spec?.categories));
  const categoryAppliesTo = freezeApplicableKinds(kinds, spec.categoryAppliesTo);

  // Derived from the frozen tuple, and the ONLY statement of "does this kind
  // take a category". `categoryFor` and `coerceReason` both route through it,
  // so the write side and the read side cannot come to disagree about which
  // rows carry a meaningful sub-classification.
  const applicable = new Set<string>(categoryAppliesTo);
  const categoryApplies = (kind: unknown): boolean =>
    kinds.has(kind) && applicable.has(kind);

  return Object.freeze({
    kinds,
    categories,
    categoryAppliesTo,
    categoryApplies,
    // `kinds.parse` FIRST, so an unknown kind is a refusal rather than a quiet
    // trip down the inert branch — see the three cases on `categoryFor`. It
    // runs the same `kinds.has` `categoryApplies` does, so the write side and
    // the read side still share one statement of membership.
    categoryFor: (kind: unknown, value: unknown): Category =>
      categoryApplies(kinds.parse(kind)) ? categories.parse(value) : categories.fallback,
    coerceReason: (row: { kind: unknown; category: unknown }) => {
      const kind = kinds.coerce(row.kind);
      return {
        kind,
        category: categoryApplies(kind) ? categories.coerce(row.category) : categories.fallback,
      };
    },
  });
}

/**
 * An axis sub-spec, or a config error that NAMES the axis.
 *
 * Without this, a spec missing its `kinds` block reaches `defineVocabulary` as
 * `undefined` and fails on the label — `name: must be a non-blank string.` —
 * which is true, unhelpful, and identical for both axes.
 */
function requireAxis<Value extends string>(
  path: 'kinds' | 'categories',
  axis: VocabularySpec<Value> | undefined,
): VocabularySpec<Value> {
  if (typeof axis !== 'object' || axis === null) {
    throw new StockDomainConfigError(path, 'must be a spec with `name`, `values` and `fallback`.');
  }
  return axis;
}

/** The applicable kinds as a frozen, non-empty tuple — or a config error. */
function freezeApplicableKinds<Kind extends string>(
  kinds: Vocabulary<Kind>,
  declared: readonly Kind[],
): readonly [Kind, ...Kind[]] {
  const path = 'categoryAppliesTo';
  if (!Array.isArray(declared)) {
    throw new StockDomainConfigError(path, `must be an array of ${kinds.name} values.`);
  }
  const [first, ...rest] = declared;
  if (first === undefined) {
    throw new StockDomainConfigError(
      path,
      'must name at least one kind — with none, every category a caller supplies is replaced by the inert fallback on its way to storage.',
    );
  }
  const seen = new Set<string>();
  for (const kind of [first, ...rest]) {
    if (!kinds.has(kind)) {
      throw new StockDomainConfigError(
        path,
        `"${String(kind)}" is not one of ${kinds.name}'s values (${kinds.values.join(', ')}).`,
      );
    }
    if (seen.has(kind)) {
      throw new StockDomainConfigError(path, `"${kind}" is named more than once.`);
    }
    seen.add(kind);
  }
  return Object.freeze([first, ...rest]) as readonly [Kind, ...Kind[]];
}
