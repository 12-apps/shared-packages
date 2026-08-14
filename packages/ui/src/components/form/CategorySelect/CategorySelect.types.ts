import type { SizeValue } from '../../../tokens/scales';

/**
 * One category as the caller already stores it: a FLAT row carrying its parent.
 *
 * Flat-with-`parentId` rather than a nested `children` array because that is the
 * shape the API and the consuming admin lists already hold; nesting it at every
 * call site would be work the component can do once, memoised, itself.
 */
export interface CategorySelectOption {
  /** Stable identifier — what {@link CategorySelectProps.value} refers to. */
  id: string;
  /** The category's own name. Never pre-indented: the ROW draws the nesting. */
  name: string;
  /** Parent category id, or `null`/absent for a top-level category. */
  parentId?: string | null;
  /**
   * Item count for this category, shown as a muted trailing number when
   * {@link CategorySelectBaseProps.showCounts} is on.
   */
  count?: number;
}

/** A top-level category together with the subcategories nested under it. */
export interface CategoryGroup {
  category: CategorySelectOption;
  subcategories: CategorySelectOption[];
}

/** One entry in the "selected" summary: a whole category, or a single leaf. */
export interface CategorySelectionChip {
  /** The id to remove when the chip's × is pressed. */
  id: string;
  /** Display label — the category name, or the subcategory name. */
  label: string;
  /** Set when the chip stands for EVERY subcategory of a category. */
  whole: boolean;
}

/** Props shared by both selection modes. */
export interface CategorySelectBaseProps {
  /** The categories to choose from, flat, in display order. */
  options: CategorySelectOption[];
  /** Field label rendered above the trigger. */
  label?: string;
  /** Text on the trigger while nothing is selected. */
  placeholder?: string;
  /** Validation message; also flags the trigger as errored. */
  error?: string;
  /** Disables the trigger. */
  disabled?: boolean;
  /** Draws skeleton rows in place of the list (catalogue still loading). */
  loading?: boolean;
  /** Stretch to the container width (default: `false` — the trigger hugs). */
  fullWidth?: boolean;
  /** Control height, matching {@link Input}'s scale (default: `md`). */
  size?: SizeValue;
  /** Show each category's `count` as a trailing muted number (default: `false`). */
  showCounts?: boolean;
  /**
   * Lets a top-level category be chosen in its own right. Off by default: the
   * prototype's leaf-only default makes the category a HEADING and the
   * subcategory the thing you pick, which is what removes the "did I select the
   * parent or the group?" ambiguity.
   */
  allowParentSelection?: boolean;
  /** Empty-catalogue call to action (e.g. navigate to category creation). */
  onCreateCategory?: () => void;
  /** Base test id; the trigger is `<dataTestId>-trigger`, the panel `-panel`. */
  dataTestId?: string;
}

/**
 * Multi-select mode: the filter. Edits accumulate in a DRAFT and only reach
 * `onChange` when Apply is pressed, so the filtered list behind the panel does
 * not reload on every tick.
 */
export interface CategoryMultiSelectProps extends CategorySelectBaseProps {
  mode?: 'multi';
  /** The APPLIED selection — subcategory ids. */
  value: string[];
  /** Fired with the new applied selection when Apply is pressed. */
  onChange: (next: string[]) => void;
}

/** Single-select mode: the "move to…" picker. Choosing a row commits at once. */
export interface CategorySingleSelectProps extends CategorySelectBaseProps {
  mode: 'single';
  /** The chosen category or subcategory id, or `null`. */
  value: string | null;
  /** Fired with the chosen id, or `null` when cleared. */
  onChange: (next: string | null) => void;
}

export type CategorySelectProps = CategoryMultiSelectProps | CategorySingleSelectProps;
