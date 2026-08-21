# CardKit

The furniture an admin list's cards and row menus sit in.

`BaseCard` and `BaseListCard` deliberately say nothing about what goes inside
them: the envelope is the library's and the design is the consumer's. That is
right for a card component and exactly the wrong place for every entity in an
admin app to invent its own kebab, its own two-column body, its own label/value
pair and its own confirm-before-deleting. Those are not per-entity decisions —
they are the same shape repeated — so they live here once.

**The line this kit does not cross** is the entity card itself. A "product card"
or a "discount card" knows a domain, and a domain is the consumer's.

## What is in it

| Export | What it is |
|---|---|
| `CardKebab` | The `⋮` trigger every row and card menu opens from |
| `rowActionsToMenuItems` | One `RowAction[]` → the kebab's items, so a grid and a card cannot drift |
| `CardActionsProvider` / `useCardActions` | The tenant, the refresh and one shared error snackbar |
| `DetailColumns` `Fact` `Ledger` `BodyHeading` `TagList` | The expanded list-card body's repeated shapes |
| `useRowConfirm` | Confirm a grid SELECTION before a destructive write |
| `useRemoveConfirm` | Confirm a single row from a self-contained menu |
| `KindCardProps` / `KindListCardProps` | The `renderCard` / `renderListRow` contracts, named |

## Every sentence is yours

Three props exist only because a default would have been someone else's
language shipped as a finished-looking silence:

- `CardKebab`'s **`menuLabel`** — the trigger's accessible name, announced
  verbatim by a screen reader.
- `CardActionsProvider`'s **`errorTitle`** — the one sentence the provider
  renders on its own. The message beside it comes from whatever failed.
- Both hooks' **`confirmText`** — the verb. `ConfirmOptions` already refuses to
  default one, for the same reason: a confirm button reading "OK" tells the
  operator nothing about what is about to happen.

## Which confirm hook

They differ by the surface they serve, not by what they do.

**`useRowConfirm`** is for a grid whose actions are declared as `RowAction[]`
and act on a **selection**. The popup is described from that selection, because
the per-row kebab entry and the multi-select menu run the same handler —
"Delete the category Drinks?" and "Delete 4 categories?" are one question asked
of a different-sized selection, and an operator who multi-selected by mistake is
exactly who the popup is for. The selection is held while the popup is open, so
the write sees the rows the operator was looking at when they were asked; the
list can refresh underneath an open dialog, and re-reading the live selection at
confirm time is the bug this shape avoids. An empty selection opens nothing.

**`useRemoveConfirm`** is for a self-contained menu already inside a
`CardActionsProvider`. It reads the refresh and the error channel from context
and answers the `{ ok, error }` envelope those actions use.

Both close the three gaps a hand-rolled version keeps re-opening:

1. the write leaves **only** on confirm;
2. a refusal is surfaced **twice** — inside the popup, where the operator is
   still deciding, and in the shared snackbar behind it, which is what remains
   once they dismiss it;
3. a failed attempt leaves the popup **open** to be retried, instead of
   vanishing over a delete that never happened.

## `useCardActions` throws outside its provider

Deliberately, rather than answering a null object. A menu whose `onRefresh`
silently did nothing would leave the operator looking at a stale row after a
delete that worked — which reads as the delete having failed. Failing at mount
says where the provider is missing.

## The context is small on purpose

It is **not** an edit-dialog host. A menu that read its dialogs from here would
stop being portable, because the set of dialogs is per-entity. What it may read
is three facts: the tenant it acts inside, what to do after a write lands, and
where to put a failure.

## See also

- `exportRows` (`@12-apps/ui/utils`) — the producing half of the grid's Export
  control, for the common case where the host already has the rows.
- `useServerDataViews` (`@12-apps/app-shell/react`) — the router half of
  `DataViewServer`. It lives there rather than here because it needs a router,
  and a design system should not.
