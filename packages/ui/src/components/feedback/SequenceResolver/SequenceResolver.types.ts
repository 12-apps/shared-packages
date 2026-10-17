import type * as React from 'react';

/**
 * One entry of the queue a {@link SequenceResolverProps} walks through.
 *
 * Extend it with whatever the host's step needs (`item.payload`, an id, the
 * row it came from): the component only reads `key` and `kindLabel`, and hands
 * the WHOLE item back to `renderStep` and `onBack`.
 */
export interface SequenceItem {
  /** Stable identity across re-renders and refetches — what the run tracks. */
  key: string;
  /** The kind word the header shows next to the position ("Purchase"). */
  kindLabel: string;
}

/** Where the run stands, handed to the end screen, `onClose` and `labels.step`. */
export interface SequenceSummary {
  /** Steps answered with `resolve`. */
  resolved: number;
  /** Steps passed over with `skip`. */
  skipped: number;
  /** Every step of the run so far: answered + skipped + still ahead. */
  total: number;
  /**
   * Problems the host reported as resolved TOGETHER with an answered step
   * (`api.resolve(result, { alsoResolved })` — "apply to every sibling"),
   * which never became steps. `resolved + alsoResolved` is what a close toast
   * counts; the end screen's "N of M" counts steps.
   */
  alsoResolved: number;
}

/** What an answer can say besides its result. */
export interface SequenceResolveOptions {
  /** How many OTHER problems this answer resolved too (siblings that never became steps). */
  alsoResolved?: number;
}

/** A button a step puts in the resolver's footer. */
export interface SequenceAction {
  label: string;
  onClick: () => void;
  /** Disabled on top of the resolver's own `busy`. */
  disabled?: boolean;
}

/** What `renderStep` gets: the run's verbs and its state. */
export interface SequenceStepApi<R> {
  /**
   * Answer this step and move to the next one. Pass the result itself, or the
   * PROMISE of it (the host's server write): the step stays on screen and
   * `busy` until it settles; a rejection keeps it and shows the rejection's
   * message. The result is what `onBack` receives if the reader returns.
   */
  resolve: (result: R | PromiseLike<R>, options?: SequenceResolveOptions) => void;
  /** Leave this step unanswered and move on. */
  skip: () => void;
  /** Return to the previous step (the header's back button does the same). */
  back: () => void;
  /** True while a `resolve` promise or an `onBack` is pending — disable the step's own answers. */
  busy: boolean;
  /**
   * Spread on the step's TITLE — the item's name, first and large. It names
   * the dialog (`aria-labelledby`) and takes focus on every advance.
   */
  titleProps: {
    id: string;
    tabIndex: -1;
    ref: React.RefCallback<HTMLElement>;
  };
}

/** What a step renders: its body and, at most, two footer actions plus one tertiary. */
export interface SequenceStep {
  /** The body: item name (spread `titleProps` on it), question, facts, inputs. */
  content: React.ReactNode;
  /** The step's verb ("Save limits"). Omit for a step answered from its body (a list of reasons). */
  primary?: SequenceAction;
  /**
   * The secondary action. Omitted, it is SKIP with `labels.skip`; pass one to
   * reword it ("Not bought yet") or to replace it (a split mode's "One reason
   * only"); `false` removes it.
   */
  secondary?: SequenceAction | false;
  /** One text button above the footer ("It was a stock count, not a loss"). */
  tertiary?: SequenceAction;
  /**
   * How the footer lays its actions out on a pointer: `'end'` (default) —
   * auto-width, right-aligned, over a hairline; `'split'` — two equal
   * full-width columns, no hairline (a form step: limits, a purchase). On a
   * phone the actions always share the row, with no hairline.
   */
  footer?: 'end' | 'split';
}

/** One kind on the intro screen. */
export interface SequenceCategory {
  label: string;
  description?: string;
  /** How many problems of this kind there are. A kind at zero should not be listed. */
  count: number;
  /** Resolve only this kind: set the queue to it and drop `intro`. */
  onPick: () => void;
}

/** The screen before the run: the kinds with their counts, and "resolve them all". */
export interface SequenceIntro {
  title: string;
  description?: string;
  categories: SequenceCategory[];
  startAllLabel: string;
  /** Resolve every kind: set the queue to all of them and drop `intro`. */
  onStartAll: () => void;
}

/** The end screen's words. */
export interface SequenceDone {
  title: string;
  description?: string;
  /** The one button there; it closes the resolver. */
  confirmLabel: string;
}

/** The chrome's words. The package ships none: every one is the host's. */
export interface SequenceResolverLabels {
  /** The back button's visible word ("Back"); a chevron icon precedes it. */
  back: string;
  /** The back button's accessible name, when it says more ("Back to the previous problem"). Must contain `back`. */
  backAccessible?: string;
  /** The close button's accessible name. */
  close: string;
  /** The default secondary action: leave the step unanswered. */
  skip: string;
  /** The header label on a step: `"Problem 3 of 13 · Purchase"`. `position` is 1-based. */
  step: (position: number, total: number, item: SequenceItem) => string;
  /** The header label on the intro screen. */
  introStep: string;
  /** The header label on the end screen. */
  doneStep: string;
  /** The progress bar's accessible name. */
  progress: string;
  /** Shown when `onBack` / a `resolve` promise rejects with no message of its own. */
  failed: string;
}

export interface SequenceResolverProps<I extends SequenceItem = SequenceItem, R = unknown> {
  open: boolean;
  /**
   * The close button, Esc, and the end screen's button. Gets where the run
   * stood, for the host's "N resolved · Undo" toast.
   */
  onClose: (summary: SequenceSummary) => void;
  /**
   * While given, the intro screen shows instead of the run. The host drops it
   * (and sets `queue`) in the same update as a category's `onPick` / `onStartAll`.
   */
  intro?: SequenceIntro;
  /**
   * The problems to walk, in order. The host's live data: it may shrink while
   * the run goes (an answer that resolves siblings too) or grow; the run keeps
   * pointing at the next unresolved key and never runs past the end.
   */
  queue: readonly I[];
  /** The body and actions of the current step. */
  renderStep: (item: I, api: SequenceStepApi<R>) => SequenceStep;
  /**
   * Undo the previous answer before showing its step again — the host's server
   * inverse. Called only when the step being returned to was RESOLVED (a skipped
   * one has nothing to undo). A rejection keeps the current step and shows its message.
   */
  onBack?: (item: I, result: R) => Promise<void> | void;
  /** Offer the back button at all (default `true`). It shows only once a previous step exists. */
  canGoBack?: boolean;
  /** The end screen's words, from the run's summary. */
  done: SequenceDone | ((summary: SequenceSummary) => SequenceDone);
  labels: SequenceResolverLabels;
  /**
   * Base test id (default `sequence-resolver`). Parts get `${id}-back`,
   * `${id}-close`, `${id}-step-label`, `${id}-progress`, `${id}-category-${index}`,
   * `${id}-start-all`, `${id}-primary`, `${id}-secondary`, `${id}-tertiary`,
   * `${id}-error`, `${id}-done`, `${id}-done-confirm`.
   */
  dataTestId?: string;
}
