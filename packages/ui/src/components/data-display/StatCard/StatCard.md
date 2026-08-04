# StatCard

A KPI tile: one labelled figure, an optional period-over-period delta, an
optional leading icon, an optional hint line, and a loading state. It is the
single shared tile for dashboard KPI rows and summary bands, so surfaces stop
hand-rolling the label/value pattern.

## Features

- **Pre-formatted values**: the tile never formats money, percentages or
  locale — `value` and `delta.value` arrive as strings the caller already
  shaped, so currency/locale rules stay with the data owner.
- **Direction separate from meaning**: `delta.direction` picks the arrow;
  `delta.tone` picks the colour. A rising cost can render an up arrow and still
  read as negative.
- **Semantic colour only**: `success.main` / `error.main` / `text.secondary`
  from the MUI palette — no hardcoded hex, so themes and dark mode work.
- **Accessible**: the tile is a `role="group"` labelled by its own label; the
  arrow is `aria-hidden` and the delta carries a direction-aware sentence that
  callers can localize.
- **Loading state**: skeletons replace value and delta while the label stays put,
  so a KPI grid does not reflow when data lands.

## Props

| Prop          | Type                    | Default | Description                                                     |
| ------------- | ----------------------- | ------- | --------------------------------------------------------------- |
| `label`       | `string`                | —       | What the figure measures, e.g. `"Receita"`.                      |
| `value`       | `ReactNode`             | —       | The figure, already formatted.                                   |
| `delta`       | `StatCardDelta`         | —       | Optional period-over-period change (see below).                  |
| `icon`        | `ReactNode`             | —       | Optional leading icon beside the label (decorative).             |
| `hint`        | `string`                | —       | Optional clarifying line under the value, e.g. the range.        |
| `loading`     | `boolean`               | `false` | Swaps value/delta for skeletons and marks the tile `aria-busy`.  |
| `className`   | `string`                | —       | Custom class on the tile root.                                   |
| `dataTestId`  | `string`                | `'stat-card'` | Root test id; child ids derive from it.                    |

### `StatCardDelta`

| Field       | Type                              | Default            | Description                                                       |
| ----------- | --------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `value`     | `string`                          | —                  | The pre-formatted change, e.g. `"+12,5%"`.                        |
| `direction` | `'up' \| 'down' \| 'neutral'`     | —                  | Which way the metric moved (picks the arrow).                     |
| `tone`      | `'positive' \| 'negative' \| 'neutral'` | derived from `direction` | How the movement should read (picks the colour).       |
| `label`     | `string`                          | —                  | Comparison context, e.g. `"vs. período anterior"`.                |
| `ariaLabel` | `string`                          | generated (English) | Overrides the screen-reader sentence — pass a localized string.  |

## Usage

### Basic

```tsx
import { StatCard } from '@12-apps/ui/data-display/StatCard';

<StatCard label="Receita" value="R$ 12.480,00" />;
```

### With a period-over-period delta

```tsx
<StatCard
  label="Receita"
  value="R$ 12.480,00"
  delta={{ value: '+12,5%', direction: 'up', label: 'vs. período anterior' }}
/>
```

### "Lower is better" metrics

Cost going up is not good news. Keep the honest arrow and override the tone:

```tsx
<StatCard
  label="Custo (CMV)"
  value="R$ 4.900,00"
  delta={{ value: '+9,4%', direction: 'up', tone: 'negative' }}
/>
```

### Loading

```tsx
<StatCard label="Receita" value={revenueLabel} delta={revenueDelta} loading={isPending} />
```

### A KPI row

```tsx
<Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(4, 1fr)' }}>
  <StatCard label="Receita" value={revenue} dataTestId="kpi-revenue" />
  <StatCard label="Custo (CMV)" value={cogs} dataTestId="kpi-cogs" />
  <StatCard label="Lucro bruto" value={profit} dataTestId="kpi-profit" />
  <StatCard label="Pedidos" value={orders} dataTestId="kpi-orders" />
</Box>
```

## Accessibility

- The root is a `role="group"` with `aria-labelledby` pointing at the label, so
  assistive tech announces the tile as "Receita, group" rather than reading two
  unrelated strings.
- The direction arrow is `aria-hidden` — it duplicates information the delta's
  `aria-label` already carries, and would otherwise be announced twice.
- The delta's generated sentence ("Increase of +12,5% vs. período anterior") is
  English. Non-English apps pass `delta.ariaLabel` to localize it.
- While `loading`, the tile sets `aria-busy="true"` and keeps its label, so the
  metric is still identifiable before the number lands.

## Best Practices

- Format on the way in. If two tiles disagree about decimal places, that belongs
  to the caller's formatter, not to the tile.
- Set `tone` explicitly for any metric where lower is better (cost, refunds,
  churn) — the default reading assumes higher is better.
- Give each tile in a grid its own `dataTestId` so tests target a specific KPI
  instead of an index.
- Use `hint` for the measured window ("Últimos 30 dias"), not for the delta's
  comparison text — that belongs in `delta.label`.
