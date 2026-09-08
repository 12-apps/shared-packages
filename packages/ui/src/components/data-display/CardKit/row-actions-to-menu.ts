import type { DropdownMenuItem } from '../../navigation/DropdownMenu';
import type { RowAction } from '../DataViews';

/**
 * Adapt a list of {@link RowAction}s into single-row kebab items.
 *
 * Drops the actions that declare `row: false`, applies each survivor's
 * `isVisible` guard, resolves its per-row `rowLabel` override, carries its
 * colour, and fires `onSelect([row])` on click.
 *
 * The point is that ONE definition drives both surfaces. An entity that already
 * declares its per-row actions as `RowAction[]` — because the table's multi-
 * select menu needs them — gets the card's kebab from the same array through
 * `renderRowMenu` / `renderCard`, with no second list to keep in step. Two
 * lists is how a "Duplicar" that appears in the table and not on the card
 * happens, and nothing reports it.
 *
 * ## Why `row: false` is filtered HERE
 *
 * `row` and `bulk` are the flags that make one list serve two surfaces, so an
 * adapter that ignores one of them defeats the arrangement it exists to
 * support. This one did, and the result was a per-row "⋮" on Produtos offering
 * "Inativar todos", "Destacar todos" and "Remover destaque de todos" beside
 * that row's own "Inativar" and "Remover destaque" — bulk verbs on a menu whose
 * every other entry means "this one", where "todos" reads as the whole
 * catalogue and the click actually writes a single row.
 *
 * The bulk half was already honoured (`renderBulkActions` filters `bulk`), so
 * only the kebab leaked. Filtering here fixes it for every surface that builds
 * a kebab from `RowAction[]` — the table row, the grid card and the list card
 * all arrive through this function.
 */
export function rowActionsToMenuItems<T extends Record<string, unknown>>(
  actions: RowAction<T>[],
  row: T,
): DropdownMenuItem[] {
  return actions
    .filter((action) => action.row !== false)
    .filter((action) => action.isVisible?.(row) ?? true)
    .map((action) => ({
      id: action.id,
      label: action.rowLabel?.(row) ?? action.label,
      color: action.color,
      onClick: () => void action.onSelect([row]),
    }));
}
