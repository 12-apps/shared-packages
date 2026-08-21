import type { ReactNode } from 'react';

import type { CardAspectRatio, DataViewCardSelection } from '../DataViews';

/**
 * THE CARD KIT — what an admin list needs above `BaseCard`, and no more.
 *
 * `BaseCard` and `BaseListCard` deliberately say nothing about what goes inside
 * them: the envelope is the library's and the design is the consumer's. That is
 * the right call for a card component and exactly the wrong place for every
 * entity in an admin app to invent its own kebab, its own two-column body, its
 * own label/value pair and its own confirm-before-deleting. Those shapes are
 * not per-entity decisions — they are the same shape repeated — so they live
 * here once.
 *
 * The line this kit does NOT cross is the entity card itself. A "product card"
 * or a "discount card" knows a domain, and a domain is the consumer's. What is
 * here is the furniture such a card sits in.
 */

/**
 * Props every KIND CARD receives — the grid's `renderCard` contract, named.
 *
 * `row` is `Record<string, unknown>` rather than a generic on purpose: a grid
 * renders rows of one shape and the renderer is registered per kind, so the
 * cast happens once inside each card rather than threading a type parameter
 * through the grid, the layout and the selection.
 */
export interface KindCardProps {
  row: Record<string, unknown>;
  selection: DataViewCardSelection;
  /** Force a ratio (a uniform grid); defaults to the card's own. */
  aspectRatio?: CardAspectRatio;
}

/**
 * Props every kind LIST card receives — the "list" layout's counterpart.
 *
 * The same `(row, selection)` pair `renderListRow` hands over, and nothing
 * more. No density: a row inside a list group takes the group's, so a card
 * accepting one could only contradict its list. No `aspectRatio`: a full-width
 * row has no ratio to force.
 */
export interface KindListCardProps {
  row: Record<string, unknown>;
  selection: DataViewCardSelection;
}

/** One labelled fact inside an expanded body. */
export interface CardFactProps {
  label: string;
  value: ReactNode;
}

/** One line of a money ledger. `info` tints a line that is not a plain cost. */
export interface CardLedgerLine {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'info';
}
