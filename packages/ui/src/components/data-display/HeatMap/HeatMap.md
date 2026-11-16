# HeatMap

A diverging heat map around a target: one row per item of one axis (weekdays),
one column per item of the other (hours), each cell a figure tinted by which
side of the target it sits on. Built for "cost / sales by weekday × hour", and
for any grid of figures judged against one threshold.

## Features

- **A real table**: `<table>` with a visually hidden `<caption>`, `th[scope=col]`
  per column and `th[scope=row]` per row, so every cell is named by its headers —
  a screen reader hears "Ter, 15h, 54% acima da meta", and a script finds a cell
  with `getByRole('cell', { name })` (or `data-testid="<id>-cell-<row>-<column>"`,
  always in the DATA's orientation).
- **Never colour alone**: an attention cell is bold and carries `labels.above`
  (visually hidden in the cell, visible in the legend); a no-figure cell shows
  `labels.emptyValue` ("—") and reads `labels.empty`. A no-figure cell marked
  `reason: 'unmeasured'` (the occurrence happened, its measure was never taken:
  sales in the hour, no cost priced) reads `labels.unmeasured` instead, which
  joins the legend while such a cell is drawn; with no `unmeasured` words it
  reads its dash alone, never `empty`'s, so "no sale" is not said of an hour
  that sold. Both show a dash, so an unmeasured cell also carries a dashed ring
  inside its edge (`data-reason="unmeasured"`), and its legend entry the same
  ring on its swatch: the difference is never words alone for a sighted reader.
- **Roles, not values**: above → `warning` tints (deeper above `strongAbove`), at
  or under → `info` tints (deeper below `strongBelow`), no figure →
  `action.disabledBackground` / `text.disabled`. Never `primary`: a red brand
  would paint every good cell as a fault.
- **Fits its container**: `table-layout: fixed` over the full width, so the
  columns share what there is and the grid never scrolls sideways.
- **Transposes**: `transpose="auto"` (default) swaps the axes below the theme's
  `md` breakpoint (seven weekday columns fit a phone; twenty-four hours do not),
  and wherever the preferred way round cannot be held even at the dense step.
- **Keeps its orientation at a computer width** (FUT-4063): 24 hour columns in
  a ~500px container (a 1280 screen with the menu open) are not turned into 24
  rows. Steps, in order: regular (cell >= 32px, 11px type), compact (>= 28px,
  10px), dense (>= 17px, 9px type, 2px gaps, labels every 2nd column and the
  rest read, not drawn). The grid turns round only when even dense needs more
  than the container has (24 columns: 490px). 17px is the floor because a bold,
  tabular 3-character figure ("902") measures about 16px at 9px in Chromium; a
  figure with its sign ("52%") does not fit, hence `formatValueDense`.
- **No default copy and no number formatting**: `labels` and `formatValue` are
  the host's.

## Props

| Prop          | Type                              | Default  | Description |
| ------------- | --------------------------------- | -------- | ----------- |
| `rows`        | `HeatMapAxisItem[]`               | —        | Row axis, top to bottom: `{ key, label }`. |
| `columns`     | `HeatMapAxisItem[]`               | —        | Column axis, left to right. |
| `cells`       | `HeatMapCell[]`                   | —        | `{ row, column, value, reason? }`; `value: null` = "—"; `reason: 'unmeasured'` = no figure because nothing was measured; an absent cell is blank. |
| `scale`       | `HeatMapScale`                    | —        | `{ target, strongAbove?, strongBelow? }`, in the values' units. |
| `formatValue` | `(value: number) => string`       | —        | A figure as text. |
| `labels`      | `HeatMapLabels`                   | —        | `{ above, below, empty, emptyValue?, unmeasured? }`. |
| `caption`     | `string`                          | —        | The table's accessible name (visually hidden). |
| `formatValueDense` | `(value: number) => string`  | `formatValue` | A shorter figure for the dense step ("54" for "54%"). The cell is still read with `formatValue`'s full text. |
| `transpose`   | `boolean \| 'auto'`                | `'auto'` | Swap the axes; `'auto'` = below `md`. |
| `legend`      | `boolean`                         | `true`   | Draw the legend. |
| `dataTestId`  | `string`                          | `heat-map` | Root test id; cells are `<id>-cell-<row>-<column>`, the legend `<id>-legend`. |

`heatMapTone(value, scale)` and `heatMapGrid(rows, columns, cells, transposed)`
are exported for hosts that need the same decision outside the component.

## Usage

```tsx
import { HeatMap } from '@12-apps/ui/data-display/HeatMap';

<HeatMap
  rows={weekdays}
  columns={hours}
  cells={cells}
  scale={{ target: 0.3, strongAbove: 0.45, strongBelow: 0.18 }}
  formatValue={(value) => `${Math.round(value * 100)}%`}
  labels={{ above: 'acima da meta', below: 'abaixo da meta', empty: 'sem venda na hora' }}
  caption="Custo / vendas por dia da semana e hora"
/>
```
