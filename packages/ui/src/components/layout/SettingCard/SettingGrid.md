# SettingGrid

## Purpose

Lays setting cards out in **one, two or three columns by the width it is
given**. Part of the `layout/SettingCard` family.

- **Container queries, not media queries.** A settings grid lives beside a
  navigation rail, inside a drawer, in half a split view; the viewport says
  nothing about how wide any of those are. The grid asks its own width.
- **Equal-height rows, without measuring.** Each row is as tall as its tallest
  card and every card in it stretches to match (`grid-auto-rows: auto` with
  `align-items: stretch`). Not `1fr` rows — those make *every* row as tall as the
  tallest one on the page.
- **An open card spans the row.** A [`SettingCard`](./SettingCard.md) mid-edit
  takes the whole row, wherever it sat, so its form has room.

## Usage

```tsx
import { SettingCard, SettingGrid, SettingToggle } from '@12-apps/ui/layout/SettingCard';

<SettingGrid aria-label="Security">
  <SettingCard … />
  <SettingToggle … />
  <SettingGroup … />
</SettingGrid>
```

## Props

| prop | type | default | effect |
|---|---|---|---|
| `children` | `ReactNode` | **required** | The cards. |
| `minColumnWidth` | `number` | `320` | The narrowest a column may get, in design px (scaled through the type scale). A column is added each time the grid's own width fits one more. |
| `maxColumns` | `1 \| 2 \| 3` | `3` | The most columns laid out. |
| `gap` | `number` | `2` | Gap between cards, in theme spacing units. |
| `aria-label` | `string` | — | When set, the grid is a labelled `region`. |
| `dataTestId` | `string` | — | On the container; the inner grid is `<id>-grid`. |
| `className`, `sx` | | | On the container. |

## How the columns are decided

The outer element is an `inline-size` container named `setting-grid`
(`SETTING_GRID_CONTAINER`); the inner element is the grid, because a container
query is answered by an **ancestor**. `n` columns apply from

```
calc(n × minColumnWidth + (n − 1) × gap)
```

so a column is never narrower than `minColumnWidth`. Nested grids each answer
to their own container.

## The open-card span

`SettingCard` sets `grid-column: 1 / -1` on itself while open and carries
`data-setting-card-open`. The grid also gives the whole row to a direct child
that **contains** an open card (`:has()`), so a host that wraps each card in an
element of its own keeps the behaviour.

## Accessibility

Layout only: reading and tab order are the children's source order at every
width — the grid never reorders them.
