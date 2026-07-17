# SearchPalette

A Gmail-style search palette: one card with a search input, a toggleable
filter-chip row, a compact list of rich result rows (leading image/avatar/icon
+ primary/secondary + trailing), and a "see all results" footer.

Fully **app-agnostic** — every label, filter, and row field comes from the host
via accessors, so it drops into any surface (admin command palette, a page-level
search box, a picker). It renders results the host supplies; it does **not**
fetch or filter — wire it to your own data source and debounce.

## When to use

- A global/command search that mixes entity types (products, contacts, orders…)
  and wants rich rows plus quick filter chips.
- Any "type-ahead over server results with common filters" surface.

For a plain text type-ahead with local filtering and multi-select chips, use
[`Autocomplete`](../Autocomplete/autocomplete.md) instead.

## Usage

```tsx
import { SearchPalette } from '@12-apps/ui/form/SearchPalette';

<SearchPalette
  value={query}
  onChange={setQuery}
  items={results}
  getKey={(r) => r.id}
  getPrimary={(r) => r.name}
  getSecondary={(r) => r.email}
  getLead={(r) =>
    r.imageUrl
      ? { kind: 'image', src: r.imageUrl }
      : { kind: 'avatar', fallback: r.name[0] }
  }
  getTrailing={(r) => r.date}
  onSelect={openResult}
  maxItems={5}
  filters={[
    { id: 'last7', label: 'Last 7 days' },
    { id: 'mine', label: 'From me' },
  ]}
  activeFilterIds={activeFilters}
  onToggleFilter={toggleFilter}
  onSubmitAll={(q) => goToSearchPage(q)}
  emptyQueryContent={<PopularList />}
  onClose={close}
/>
```

## Keyboard

| Key        | Action                                              |
| ---------- | --------------------------------------------------- |
| ↑ / ↓      | Move the active row across results and the footer   |
| Enter      | Select the active row (row → select, footer → all)  |
| Tab / →    | Accept the inline ghost completion of the top result|
| Esc        | `onClose`                                            |

## Notes

- `emptyQueryContent` renders before typing — use it for a "Populares"/recents
  block. When the query is non-empty the results (or `noResultsLabel`) show.
- `getLead` picks the row's visual per item: `image` (rounded thumbnail),
  `avatar` (with `fallback` initials), or `icon` (any node).
- The footer appears only with a non-empty query and an `onSubmitAll` handler.
- Colors come from theme tokens (no hardcoded hex), so it themes automatically.
