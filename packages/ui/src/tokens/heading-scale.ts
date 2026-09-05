
/**
 * THE THIRD VOCABULARY: the type scale.
 *
 * `scales.ts` opens by saying the package had both halves of every argument at
 * once until the size and colour vocabularies were declared in one place and
 * every component derived from them. The type scale was the one that never got
 * that treatment — it lived as a private `LEVELS` table inside
 * `Heading.styles.ts`, which is exactly the shape that file exists to refuse.
 *
 * Two things follow from it being private, and the second is the expensive one.
 *
 * **It could not be re-themed.** `Heading` read `theme.typography.h1.fontFamily`
 * from the theme and then ignored the theme for every other metric, so a host
 * calling `createTheme({ typography: { h1: { fontSize: '2rem' } } })` changed
 * `<Typography variant="h1">` and left `<Heading level="h1">` at 48px. A design
 * system whose type scale cannot be set by the design is not a system.
 *
 * **And the numbers were a landing page's.** `h1` at 3rem and `h2` at 2.5rem are
 * hero metrics. Dropped into an operations console they put a 48px title
 * directly above 14px body copy — a 3.4x jump with nothing in between — so
 * product teams stopped reaching for the component. Measured in one consuming
 * repo: `<Heading>` appeared four times in the entire codebase while raw
 * `fontSize` appeared in dozens of files. The component was not disliked, it was
 * unusable at app scale, and every host paid for that in hand-rolled CSS.
 *
 * So the defaults below are an APP scale, and `display` keeps the hero size for
 * the screens that actually want one. A marketing page asks for `display`; a
 * console asks for `h1` and gets something it can put on a page.
 */

/**
 * A step on the scale.
 *
 * `display` is a SIZE, not a rank — see `Heading`, which renders it as `h1` so
 * the document still gets exactly one level-one heading.
 */
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'display';

/**
 * The runtime list, declared beside the union for the reason `SIZE_VALUES`
 * gives: a story's `argTypes.options` spelled by hand drifts from the type, and
 * the direction it drifts is "documents less than the component accepts".
 */
export const HEADING_LEVELS = [
  'display',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
] as const satisfies readonly HeadingLevel[];

/** Everything one step of the scale decides. */
export interface HeadingMetrics {
  fontSize: string;
  lineHeight: number;
  letterSpacing?: string;
  /**
   * The weight this step carries when the caller asks for `normal`. A heading's
   * "normal" is not body text's 400 — it is the weight the step is meant to
   * carry, which gets heavier as the step gets larger.
   */
  normalWeight: number;
}

/**
 * The house default, in CODE rather than in a component.
 *
 * ~1.15x per step from a 1rem `h6`, which keeps six distinguishable ranks inside
 * the range an application actually uses. The old table ran 1.125rem → 4rem and
 * spent its top three steps above anything a product screen wants.
 */
export const HEADING_SCALE: Record<HeadingLevel, HeadingMetrics> = {
  // The hero size the old `h1` was really offering, under the name that says so.
  display: { fontSize: '3rem', lineHeight: 1.05, letterSpacing: '-0.03em', normalWeight: 800 },
  h1: { fontSize: '2rem', lineHeight: 1.2, letterSpacing: '-0.02em', normalWeight: 700 },
  h2: { fontSize: '1.75rem', lineHeight: 1.25, letterSpacing: '-0.015em', normalWeight: 700 },
  h3: { fontSize: '1.5rem', lineHeight: 1.3, letterSpacing: '-0.01em', normalWeight: 600 },
  h4: { fontSize: '1.25rem', lineHeight: 1.35, letterSpacing: '-0.005em', normalWeight: 600 },
  h5: { fontSize: '1.125rem', lineHeight: 1.4, normalWeight: 600 },
  h6: { fontSize: '1rem', lineHeight: 1.5, normalWeight: 600 },
};

/** A host's overrides: any subset of the steps, any subset of each step's metrics. */
export type HeadingScaleOverrides = Partial<Record<HeadingLevel, Partial<HeadingMetrics>>>;
