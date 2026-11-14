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
  `labels.emptyValue` ("—") and reads `labels.empty`.
- **Roles, not values**: above → `warning` tints (deeper above `strongAbove`), at
  or under → `info` tints (deeper below `strongBelow`), no figure →
  `action.disabledBackground` / `text.disabled`. Never `primary`: a red brand
  would paint every good cell as a fault.
- **Fits its container**: `table-layout: fixed` over the full width, so the
  columns share what there is and the grid never scrolls sideways.
- **Transposes**: `transpose="auto"` (default) swaps the axes below the theme's
  `md` breakpoint (seven weekday columns fit a phone; twenty-four hours do not).
- **No default copy and no number formatting**: `labels` and `formatValue` are
  the host's.

## Props

| Prop          | Type                              | Default  | Description |
| ------------- | --------------------------------- | -------- | ----------- |
| `rows`        | `HeatMapAxisItem[]`               | —        | Row axis, top to bottom: `{ key, label }`. |
| `columns`     | `HeatMapAxisItem[]`               | —        | Column axis, left to right. |
| `cells`       | `HeatMapCell[]`                   | —        | `{ row, column, value }`; `value: null` = "—"; an absent cell is blank. |
| `scale`       | `HeatMapScale`                    | —        | `{ target, strongAbove?, strongBelow? }`, in the values' units. |
| `formatValue` | `(value: number) => string`       | —        | A figure as text. |
| `labels`      | `HeatMapLabels`                   | —        | `{ above, below, empty, emptyValue? }`. |
| `caption`     | `string`                          | —        | The table's accessible name (visually hidden). |
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
