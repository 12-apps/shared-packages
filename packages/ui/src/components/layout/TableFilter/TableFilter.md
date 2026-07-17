# TableFilter

Compound **filter-panel** system — MUI port of the reference `TableFilter`. A
`Panel` slides in from the right beside `Main` (no overlap); the funnel
[`FilterTrigger`](../ContentToolbar/ContentToolbar.md) drives the same open state.

## Parts

| Part | Purpose |
| --- | --- |
| `TableFilter` | Provider — owns `open` / `onOpenChange` / `hasActiveFilters` via context. |
| `TableFilter.Layout` | Flex row holding `Main` + `Panel`; collapses the gap when closed. |
| `TableFilter.Main` | The scrollable content (table/grid) that shrinks as the panel opens. |
| `TableFilter.Panel` | The animated `aside` (280px ↔ 0) with a "Clear All Filters" link. |
| `TableFilter.Keyword` | Search-by-keyword input; commits on blur/Enter, with a clear button. |
| `TableFilter.Section` | Titled group of fields, preceded by a separator. |
| `TableFilter.CheckboxField` | Labelled multi-select checkbox group (with optional counts). |
| `TableFilter.RangeField` | Labelled numeric min/max pair (optional unit + step). |

## Usage

```tsx
import { TableFilter } from '@repo/ui/layout/TableFilter';
import { FilterTrigger } from '@repo/ui/layout/ContentToolbar';

const [open, setOpen] = useState(false);

<FilterTrigger open={open} onOpenChange={setOpen} hasActiveFilters={hasFilters} />

<TableFilter open={open} onOpenChange={setOpen} hasActiveFilters={hasFilters}>
  <TableFilter.Layout>
    <TableFilter.Main>{table}</TableFilter.Main>
    <TableFilter.Panel onClearAll={clearAll}>
      <TableFilter.Keyword value={q} onChange={setQ} />
      <TableFilter.Section title="Attributes">
        <TableFilter.CheckboxField label="Category" options={cats} selected={sel} onToggle={toggle} />
        <TableFilter.RangeField label="Price" unit="R$" step={0.01} value={price} onChange={setPrice} />
      </TableFilter.Section>
    </TableFilter.Panel>
  </TableFilter.Layout>
</TableFilter>;
```

## Notes

- **State-agnostic** — the panel renders fields and reports changes; the consumer
  owns the filter state and the actual row filtering.
- `Keyword` keeps a local draft and only calls `onChange` on blur/Enter so typing
  doesn't refilter on every keystroke.
- Pair with `ContentToolbar` for the full reference layout (toolbar + panel).

## Accessibility

The panel is a labelled `<aside>` with `aria-hidden` when collapsed; collapsed
content is `visibility:hidden` so inputs leave the tab order and a11y tree.
