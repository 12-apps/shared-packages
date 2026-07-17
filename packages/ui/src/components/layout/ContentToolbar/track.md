# ContentToolbar

MUI port of a reference content-page toolbar. A bar shell (`ContentToolbar`)
with a left selection cluster (Select All / Clear All / count / `actions`) and a
right `rightControls` slot, plus the controls that populate that slot:
`ViewSelector`, `SortByDropdown`, `MultiSelectDropdown`, `FilterTrigger`.
Generic/agnostic — no domain coupling; the reference's content-item action
dropdown is deliberately left to the consumer's `actions` slot.

## Props (per component)

- **ContentToolbar** — hasSelection, selectedCount, selectAll, clearSelection,
  rightControls, actions?, selectAllTestId?, clearAllTestId?, edgeAlign?.
- **ViewSelector** — viewMode, onViewModeChange, zoom (number[]), onZoomChange.
- **SortByDropdown** — fields, activeField, activeOrder?, onFieldChange,
  onOrderChange?; generic over the field type; Order/Sort sections.
- **MultiSelectDropdown** — label, options (value/label/count), selected (Set),
  onToggle, onClear, allLabel?, extraOptions?.
- **FilterTrigger** — open, onOpenChange, hasActiveFilters?.

## Lint

- Clean (`pnpm lint:files src/components/layout/ContentToolbar`).

## Type Errors

- None (`pnpm typecheck`).

## Testing Scenarios

- Select All → count + Clear All → reset; Sort By open + field change;
  Content-Type multi-select keeps menu open + Clear; filter funnel toggle + dot.

## Storybook Tests List

- Layout/ContentToolbar/Tests → 4 interaction stories.

## Current

- v1 ported from the reference (tabwoah `ContentPageToolbar` + controls),
  translated to MUI. Next: wire into an admin page as the first consumer.
