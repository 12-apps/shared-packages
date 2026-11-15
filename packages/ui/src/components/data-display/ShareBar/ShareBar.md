# ShareBar

A stacked share bar: one horizontal 100% bar of parts — how sales split across
payment methods, channels or categories — with each part's percent inside its
segment where it fits, and the same parts listed under it with a swatch, the
name, the percent and, optionally, the figure.

```tsx
import { ShareBar } from '@12-apps/ui/data-display/ShareBar';

<ShareBar
  label="Vendas por forma de pagamento"
  segments={[
    { key: 'pix', label: 'Pix', value: 450000 },
    { key: 'card', label: 'Cartão', value: 350000 },
    { key: 'cash', label: 'Dinheiro', value: 200000 },
  ]}
  formatValue={(centavos) => brl(centavos)}
/>;
```

## When to use it

- The parts of ONE whole, where the reader compares shares: a split, not a trend.
  A trend is a `Chart`; many measures per part are a `Table`.
- Up to about six parts. More than that and the list does the work alone.

## Props

| Prop            | Type                             | Default       | Description                                                                                         |
| --------------- | -------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `segments`      | `ShareBarSegment[]`              | —             | `{ key, label, value, color? }`, in drawing order. A value at or under 0 is listed at 0% with no segment. |
| `label`         | `string`                         | —             | The list's accessible name.                                                                         |
| `formatPercent` | `(percent: number) => string`    | `"45%"`       | How a WHOLE percent reads. The rounded percents add to exactly 100 (largest remainder).             |
| `formatValue`   | `(value: number) => string`      | —             | When given, each row also shows the part's figure, formatted by the host.                           |
| `height`        | `number`                         | `24`          | The bar's height, px at the design scale.                                                            |
| `inlinePercent` | `boolean`                        | `true`        | Whether a segment wide enough shows its percent inside the bar.                                     |
| `dataTestId`    | `string`                         | `'share-bar'` | Root id; `-bar`, `-segment-<key>`, `-list`, `-item-<key>`.                                          |

`shareBarParts(segments)` is the pure arithmetic (shares and whole percents),
exported for a host that needs the same numbers elsewhere.

## Rules it keeps

- **Never clipped.** A percent is drawn inside a segment only when the segment
  is wide enough for it (measured); otherwise it is only in the list. List rows
  wrap rather than cut.
- **Never colour alone.** The bar is `aria-hidden`; the list carries every
  part's name and percent in the bar's order, and the segments are separated by
  a 2px gap so two neighbours of close colour still read as two.
- **Never red by default.** The default fills are roles (`info`, `secondary`,
  `warning`, `success`, then darker steps and grey) and never `primary` or
  `error`: a red brand would paint one part as a fault. Pass `color` per
  segment to choose.
- No default copy: every word comes from the host.

## Test ids

| Element            | Test id                     |
| ------------------ | --------------------------- |
| Root               | `<id>`                      |
| Bar                | `<id>-bar`                  |
| Segment            | `<id>-segment-<key>` (`data-share` holds its 0–1 share) |
| List               | `<id>-list`                 |
| List row           | `<id>-item-<key>`           |
