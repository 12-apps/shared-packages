import type React from 'react';

import type { RevealOptions } from '../../../utils/reveal-block';

/**
 * Where a step stands:
 * - `done`: answered. Drawn as one button (when `onChange` is given) that holds
 *   the caption, the answer and a muted line, and offers `changeLabel`.
 * - `current`: the step being answered. Takes `aria-current="step"` and draws
 *   its `children` (the face) under its heading.
 * - `todo`: not reached yet. A muted, dashed card with the title.
 * - `error`: answered, but the answer is not valid. A `done` card with an error
 *   marker and `error` text, so a visitor can see which step to go back to.
 */
export type StepCardState = 'done' | 'current' | 'todo' | 'error';

/** One step of a {@link StepCardListProps.items} list. Every word on it is the caller's. */
export interface StepCardItem {
  /** Stable key of the step; also names its test ids. */
  id: string;
  /** The step's name, e.g. what a heading reads. Shown on `current` and `todo`. */
  title: string;
  state: StepCardState;
  /**
   * The small secondary line of a done card. Defaults to the step's number and
   * title (`1 · Title`); pass your own to say it differently.
   */
  caption?: string;
  /** The done card's answer, in bold. */
  answer?: React.ReactNode;
  /** The muted line under the answer. */
  detail?: React.ReactNode;
  /**
   * What is wrong with the answer, on a `state: 'error'` card. Rendered in the
   * error colour and linked to the button with `aria-describedby`.
   */
  error?: string;
  /** Reopens the step. Offered on `done` and `error` cards only. */
  onChange?: () => void;
  /** The visible word that reopens the step. There is no default copy. */
  changeLabel?: string;
  /**
   * The button's accessible name when the content alone is not enough, e.g.
   * `Change step 2`. Omit it and the button is named by what it shows.
   */
  changeAriaLabel?: string;
  /** The step's face, drawn on the `current` card only. */
  children?: React.ReactNode;
}

/** Props for {@link StepCardList}. */
export interface StepCardListProps {
  /** The steps in order. A step the caller hides is simply left out: numbers count what is here. */
  items: readonly StepCardItem[];
  /**
   * Scroll just far enough that a step that BECOMES current reads whole, and
   * follow it while its content settles. Pass the sticky bars' insets here;
   * `false` turns the scroll off. Honours `prefers-reduced-motion`.
   */
  reveal?: RevealOptions | false;
  /** Elements whose resize re-runs the reveal (the sticky bars the insets measure). */
  revealWatch?: readonly (Element | null)[];
  /**
   * Also move focus to the first current step's heading on mount. By default
   * focus moves only when the current step CHANGES, so the page's own landing
   * focus stays where it was.
   */
  focusOnMount?: boolean;
  /** Heading level of the current step's title. Default 2. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Accessible name of the list. */
  'aria-label'?: string;
  /** Test id of the `<ol>`. Defaults to `step-card-list`; each item is `<id>-<step id>`. */
  dataTestId?: string;
}
