# ContentToolbar

The shared **content-page toolbar** — the bar that sits under a page's title on
list/content pages (Favorites, Personal Space, Recents, Collections…). Ported to
MUI from a reference design so the same bar is reusable and consistent across
pages and projects.

## Anatomy

```
[Select All] [Clear All] | N selected  <selectionExtra> <actions>   (o)══  ▦▾   Sort By: … ▾   ⨏
└─────────────────── left cluster (selection chrome) ──────────────┘   └───── rightControls slot ─────┘
```

- **Left cluster** — always shows **Select All**. Once `hasSelection` is true it
  adds **Clear All**, an "N items selected" count, and two optional slots:
  `selectionExtra` then `actions`.
- **`selectionExtra` vs `actions`** — `actions` is what HAPPENS to the selection
  (delete, export, send). `selectionExtra` is what the selection IS: the
  "select all N matching the filter" widening a paginated list needs once its
  whole page is ticked. They are separate slots because an operator reasonably
  expects every entry in an actions menu to write something, and a widening
  writes nothing.
- **Right cluster** — a free `rightControls` node. Compose it from the shipped
  controls below (or anything else).

## Components

| Component | Purpose |
| --- | --- |
| `ContentToolbar` | The bar shell (selection chrome + `rightControls` slot). |
| `ViewSelector` | Grid/List dropdown + a card-size zoom `Slider` (grid mode only). |
| `SortByDropdown` | "Sort By:" trigger with **Order** + **Sort** menu sections; generic over the field type. |
| `MultiSelectDropdown` | Checkbox multi-select with counts, an optional "Options" section, and a Clear action (e.g. "Content Type"). |
| `FilterTrigger` | Funnel toggle button with an active-filters indicator dot. |

## Usage

```tsx
import {
  ContentToolbar,
  ViewSelector,
  SortByDropdown,
  MultiSelectDropdown,
  FilterTrigger,
} from '@12-apps/ui/layout/ContentToolbar';

<ContentToolbar
  hasSelection={selected.size > 0}
  selectedCount={selected.size}
  selectAll={selectAll}
  clearSelection={clear}
  actions={<DeleteButton />}
  rightControls={
    <>
      <ViewSelector viewMode={view} onViewModeChange={setView} zoom={zoom} onZoomChange={setZoom} />
      <SortByDropdown fields={FIELDS} activeField={field} activeOrder={order} onFieldChange={setField} onOrderChange={setOrder} />
      <MultiSelectDropdown label="Content Type" options={types} selected={typeSet} onToggle={toggle} onClear={clearTypes} />
      <FilterTrigger open={panelOpen} onOpenChange={setPanelOpen} hasActiveFilters={hasFilters} />
    </>
  }
/>;
```

## Notes

- **Generic & agnostic** — the toolbar knows nothing about your domain. The
  reference's built-in "content-item actions" dropdown is intentionally *not*
  ported; pass whatever you need through the `actions` slot instead.
- **`SortByDropdown`** hides its Order section when the active field defines no
  `orderOptions`. `triggerLabelStyle: 'range'` renders "Size (large–small)" and
  drops the direction arrow; the default `'single'` shows e.g. "Name (a–z) ↓".
- **`MultiSelectDropdown`** keeps its menu open while toggling; empty *or* full
  selection both display `allLabel` (default "All").
- **`edgeAlign`** trims the leading/trailing button padding so the bar aligns
  flush inside a padded (`px-N`) wrapper.

## Accessibility

Triggers expose `aria-haspopup`/`aria-expanded`; the filter funnel toggles
`aria-expanded` and has an open/close `aria-label`. Menus are keyboard-navigable
and focus-trapped by MUI.
