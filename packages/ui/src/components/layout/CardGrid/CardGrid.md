# CardGrid Component

## Overview

`CardGrid` is a shared grid container for card layouts. It arranges its children into responsive columns using CSS `grid` + `auto-fill`, so the column count adapts to the container width without media queries or JavaScript. It exposes two layout **variants** that differ only in how leftover row space is handled.

Ported from the tabwoah card grid — the `"fixed"` variant is the original behavior verbatim; the one adaptation is that this app has no Tailwind, so the container's `display: grid`, gap, and bottom padding live in `style` instead of utility classes.

## Features

- **Two variants**: `fixed` (steady card width, even gutters) and `fluid` (cards stretch to fill)
- **Responsive by default**: `auto-fill` recomputes the column count as the container resizes — 2-up on a phone, more columns as width grows
- **Single-card friendly**: a lone card stays left-aligned at one track's width, never stretched edge to edge
- **No JS / no media queries**: pure CSS grid
- **Ref + testid passthrough**: `containerRef` (e.g. for row-clipping) and `gridTestId`

## Variants

| Variant   | Layout                        | Wraps?            | Card sizing                                  |
| --------- | ----------------------------------- | ----------------- | -------------------------------------------- |
| `fixed`   | `repeat(auto-fill, {cardWidth}px)` + `space-around` | wraps | Cards stay exactly `cardWidth`; column count changes |
| `fluid`   | `repeat(auto-fill, minmax({cardWidth}px, 1fr))` | wraps | Cards grow to fill the row; `cardWidth` is the minimum |
| `scroll`  | one row, `grid-auto-flow: column` + `overflow-x: auto`, `grid-auto-columns: min({maxCardWidth}px, calc((100% - 60px) / 2))` | no — scrolls sideways | Cards are sized from the container so 2 whole cards + a 28px peek of the third always fit, capped at `maxCardWidth` |

- Use **`fixed`** when you want cards to keep a constant size and the row to breathe with even spacing (the tabwoah default).
- Use **`fluid`** when you want cards to grow and the grid to always use the full width (e.g. a product menu that should fill edge to edge).
- Use **`scroll`** when you want a swipeable rail — a single horizontally-scrolling row of fluid cards (e.g. a "highlights"/destaque strip). Two cards plus a peek of the third show on a phone; more appear as the viewport grows, and the rest are revealed by scrolling.

**The peek is a guarantee, not a side effect.** On a phone the rail must never resolve to exactly two cards flush with the edge — that reads as "these are all the products". The track width is therefore computed _from the container_ (`(100% - 2 gaps - 28px peek) / 2`) rather than clamped to a minimum card width: a minimum is precisely what would swallow the peek on a narrow screen. `maxCardWidth` still caps the track, so wide viewports fit more cards instead of inflating them. When the rail holds two cards or fewer there is nothing to scroll to, so no peek is reserved and the cards divide the row evenly.

## Usage

### Fluid grid (cards grow to fill)

```tsx
import { CardGrid } from '@12-apps/ui/layout/CardGrid';

<CardGrid variant="fluid" cardWidth={165} gridTestId="menu-grid">
  {items.map((item) => (
    <ProductCard key={item.id} item={item} />
  ))}
</CardGrid>;
```

At ~396px of content two 165px columns fit and each stretches to ~190px; on a
wide screen the columns multiply and keep filling the row.

### Fixed grid (steady width, even gutters)

```tsx
<CardGrid variant="fixed" cardWidth={230}>
  {cards}
</CardGrid>
```

Every card is exactly 230px; surplus width becomes even gutters between columns.

### Scroll rail (fluid cards, horizontal scroll)

```tsx
<CardGrid variant="scroll" cardWidth={165} maxCardWidth={264}>
  {cards}
</CardGrid>
```

A single row that scrolls sideways. Each card is as wide as it can be while two
whole cards plus a 28px peek of the third still fit — e.g. ~142px in a 348px
container — capped at 264px on a wide viewport.

### With a container ref (row clipping)

```tsx
const { containerRef, maxHeight } = useMaxRowsHeight(2, items.length);

<CardGrid cardWidth={230} containerRef={containerRef} className="clipped">
  {cards}
</CardGrid>;
```

## Props

| Prop         | Type                    | Default   | Description                                                                                       |
| ------------ | ----------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| cardWidth    | number                  | -         | `fixed`: the exact column width in px. `fluid`: the minimum column width (columns grow from here). `scroll`: only seeds the default `maxCardWidth` — scroll tracks have no minimum. |
| maxCardWidth | number                  | 1.6×cardWidth | `scroll` only: the upper bound of the fluid card width.                                     |
| variant      | 'fixed' \| 'fluid' \| 'scroll' | 'fixed'   | Layout behavior (see [Variants](#variants)).                                                |
| className    | string                  | -         | Extra classes appended to the grid container.                                                     |
| gridTestId   | string                  | -         | `data-testid` for the grid container.                                                             |
| containerRef | Ref\<HTMLDivElement\>   | -         | Ref forwarded to the grid container (e.g. for max-rows height clipping).                           |
| children     | ReactNode               | -         | The cards to lay out.                                                                              |

## Notes

- The children control their own width: give each card `width: 100%` so it fills its grid track in both variants.
- Card **height** equalizes per row automatically when tracks are equal width (equal columns ⇒ equal-height cells).
- In tabwoah the card size is driven by a zoom slider (`useGridLayout`) that feeds a larger `cardWidth`; that control was not ported here — pass `cardWidth` directly (a fixed number or a responsive one) instead.
