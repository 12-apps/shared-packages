# TableFilter

MUI port of the reference `TableFilter` compound panel. Provider + `Layout` /
`Main` / `Panel` (slide-in aside) + field parts (`Keyword`, `Section`,
`CheckboxField`, `RangeField`). Generic/agnostic — consumer owns filter state and
row filtering. Pairs with `ContentToolbar`'s `FilterTrigger`.

## Parts / props

- **TableFilter** — open, onOpenChange, hasActiveFilters?.
- **Layout / Main / Panel** — Panel: onClearAll, ariaLabel?, clearTestId?.
- **Keyword** — value, onChange (blur/Enter), placeholder?, label?.
- **Section** — title.
- **CheckboxField** — label, options (value/label/count), selected (Set), onToggle.
- **RangeField** — label, value {min,max}, onChange, unit?, step?.

## Lint

- Clean (`pnpm lint:files src/components/layout/TableFilter`).

## Type Errors

- None (`pnpm typecheck`).

## Testing Scenarios

- Funnel toggles panel; category checkbox; min-price range; Clear All resets.

## Storybook Tests List

- Layout/TableFilter/Tests → OpenPanelAndFilter.

## Current

- v1 ported. Next: replace the admin `FilterBar` on Products/Inventory/Suppliers
  with `ContentToolbar` + this panel (Phase 2/3).
