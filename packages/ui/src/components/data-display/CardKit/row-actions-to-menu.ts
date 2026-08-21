import type { DropdownMenuItem } from '../../navigation/DropdownMenu';
import type { RowAction } from '../DataViews';

/**
 * Adapt a list of {@link RowAction}s into single-row kebab items.
 *
 * Applies each action's `isVisible` guard, resolves its per-row `rowLabel`
 * override, carries its colour, and fires `onSelect([row])` on click.
 *
 * The point is that ONE definition drives both surfaces. An entity that already
 * declares its per-row actions as `RowAction[]` — because the table's multi-
 * select menu needs them — gets the card's kebab from the same array through
 * `renderRowMenu` / `renderCard`, with no second list to keep in step. Two
 * lists is how a "Duplicar" that appears in the table and not on the card
 * happens, and nothing reports it.
 */
export function rowActionsToMenuItems<T extends Record<string, unknown>>(
  actions: RowAction<T>[],
  row: T,
): DropdownMenuItem[] {
  return actions
    .filter((action) => action.isVisible?.(row) ?? true)
    .map((action) => ({
      id: action.id,
      label: action.rowLabel?.(row) ?? action.label,
      color: action.color,
      onClick: () => void action.onSelect([row]),
    }));
}
