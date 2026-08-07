# Report builder — mobile, accessibility, data model

Companion to `report-builder-v2.html`. Everything below is either implemented in the prototype or flagged as a backend/spec change.

---

## 1. Mobile

The current screens assume a mouse and ~1400px. On a 390px phone the builder is unusable: the config popover is wider than the viewport, the 12-column grid produces 1/3-width charts, and hover-only affordances (drag handle, tools) never appear.

### What breaks and what to do

| Problem | Fix |
|---|---|
| Config popover anchored to a block | Bottom sheet, ~78vh, with grip. Block stays visible above it. |
| `grid-column: span 4` on a 390px screen | Width is a *desktop hint*. Below 760px every block is full width; the setting persists. Say so in the UI ("No celular todo bloco ocupa a largura inteira") so the user doesn't think it's broken. |
| Hover-revealed tools | Always visible below 760px, 40×40 targets. |
| Drag-to-reorder | Unusable one-handed with sticky headers. Provide explicit "Mover para cima/baixo" in the block menu on touch; keep drag as an enhancement. |
| Metadata form (Nome/Descrição/Status/Visibilidade) | Full-screen sheet, not inline — it pushes the canvas off-screen otherwise. |
| Tables | Horizontal scroll container with the dimension column sticky. Never shrink font below 12.5px. |
| Chart tooltips | Hover doesn't exist. Tap-to-pin with a visible dismiss, or drop tooltips and show values as labels when ≤6 points. |
| Two sticky bars (header + toolbar) | ~112px of a 640px viewport. Collapse the toolbar into the header on scroll, or make period a single button that opens a sheet. |
| Period + compare + export in one row | Horizontal scroll strip (no wrapping — wrapping doubles the sticky height). |
| PDF export | Long-running on mobile networks. Generate server-side, notify when ready, don't block the UI. |

The prototype is responsive down to 380px — resize the window to check the sheet behaviour.

---

## 2. Accessibility

Current state has several blockers, most inherited from charting defaults rather than deliberate choices.

**Charts are invisible to assistive tech.** An `<svg>` of `<rect>`s reads as nothing. Fixes, all in the prototype:
- `role="img"` + `aria-label` containing the full series as text ("Receita por dia. 07/07: R$ 312,00, 10/07: R$ 268,00 …").
- `<title>` inside each bar/point/slice — gives sighted mouse users a native tooltip *and* AT users per-element info, free.
- A "ver como tabela" toggle per block in view mode. This is the real fallback: the same query rendered as a `<table>` is fully navigable.

**Color as the only channel.** Series are distinguished by hue alone; ~8% of men can't separate the default palette reliably. Use the four-hue palette (`--s1..--s4`) picked for luminance separation, and always print the category name in the legend next to the swatch, never a bare color key.

**Contrast.** Axis labels in the current build are light grey on white — around 3:1, below the 4.5:1 minimum for text under 18px. The prototype's `--muted` is `#6f7691` (≈4.6:1). Chart ink is not decorative; it's text.

**Keyboard.**
- Blocks are `tabindex="0"` with `role="button"`; Enter/Space selects, Delete removes.
- Reorder without a mouse: **Alt + ↑/↓**, with an `aria-live` announcement ("Receita por dia movido para a posição 2 de 5"). Drag-and-drop alone is a WCAG 2.1 failure (2.1.1) — this is the single most commonly missed item in builder UIs.
- ⌘S saves. Escape closes overlays and returns focus to the trigger.

**Focus management.** The current MUI dialog is fine by default, but the custom popover isn't: opening it doesn't move focus, closing it drops focus to `<body>`. Store the trigger, restore on close (`lastFocus` in the prototype).

**Live regions.** Toasts and undo must be announced. `aria-live="polite"` on a visually hidden div — the toast text is mirrored there. The undo action also needs a keyboard path (⌘Z), since a 6-second toast is not a reachable target for someone using switch access.

**Disabled controls need reasons.** `KPI (número único)` greyed out with no explanation is a dead end. Every disabled viz in the prototype carries a `title` and surfaces the reason as inline text: *"Um número único não usa agrupamento. Tire o 'agrupar por' para escolher."*

**Labels.** Every select in the panel has a visible label or an `aria-label`. The truncated `St…` / `igu…` selects in the current build have neither — a screen reader announces "combo box" with no name.

---

## 3. Data model

This is where most of the UI problems actually originate. The UI is showing raw model internals (`PAID`, `6/12`, collection names as titles) because the model doesn't carry enough metadata.

### 3.1 A field catalog is the missing piece

One registry, server-owned, that the UI reads and the query builder validates against:

```ts
type FieldMeta = {
  id: FieldId;
  source: SourceId;
  label: string;                      // "Forma de pagamento" — never derived from column name
  role: 'dimension' | 'measure';
  type: 'money' | 'count' | 'number' | 'date' | 'enum' | 'text';
  aggs?: Agg[];                       // legal aggregations for this field
  grains?: Grain[];                   // only for date
  values?: { value: string; label: string }[];  // enum: PAID -> "Pago"
  ops: Op[];                          // legal filter operators
  format?: { currency?: 'BRL'; decimals?: number; unit?: string };
  requires?: Permission;              // e.g. 'reports:cost:read' for margem/custo
};
```

This one object fixes, at the source:
- **"Soma de Status"** — measures list is `role === 'measure'`, aggregations come from `field.aggs`.
- **Raw enums in filters** — `values[]` drives a proper picker with Portuguese labels.
- **Missing operators** — `ops` per type; `between` and `in` are currently impossible to express.
- **Formatting** — money as `R$ 1.234,56`, counts as integers, minutes as `14,2 min`. Right now the chart guesses.
- **Field-level permissions** — `requires` filters the catalog *server-side*. Otherwise a waiter opens a shared report with a `margem` block and sees cost data. This must not be a client-side filter, and it must also apply on PDF/CSV export.

### 3.2 ReportSpec

```ts
type ReportSpec = {
  version: 2;                      // migrate on read, never in place
  blocks: Block[];
  defaults: {
    period: PeriodRef;             // { preset: 'last_30d' } | { from, to }
    compare: 'previous_period' | 'previous_year' | null;
  };
};

type Block = {
  id: string;                      // ULID. Not the array index.
  title: string | null;            // null = derive from spec (see §3.3)
  source: SourceId;
  groupBy: { field: FieldId; grain?: Grain } | null;
  splitBy: FieldId | null;         // series breakdown — missing today
  measures: { id: string; field: FieldId; agg: Agg }[];
  filters: Filter[];
  sort: { ref: string; dir: 'asc' | 'desc' } | null;   // missing today
  limit: number | null;            // top N + "Outros" — missing today
  viz: VizType;
  layout: { w: 4 | 6 | 8 | 12; order: number };
};

type Filter =
  | { field: FieldId; op: 'eq' | 'neq' | 'contains'; value: string }
  | { field: FieldId; op: 'in' | 'nin'; values: string[] }
  | { field: FieldId; op: 'between'; from: string; to: string }
  | { field: FieldId; op: 'gte' | 'lte'; value: string | number };
```

Notes on the deltas from what the screenshots imply:

- **Stable block ids.** Reordering, undo, per-block error mapping and per-block caching all need identity. Array position isn't identity.
- **`title: null` is meaningful.** A null title means "keep following the spec" — change the measure and the title follows. A string means the user overrode it. Today every block is named after its collection ("Pedidos" ×3), which is the worst of both.
- **`limit` + `sort`.** The "Vendas por produto" chart in the first screenshot shows ~10 unlabelled bars. Top-N with an "Outros" bucket is a spec concern, not a rendering hack.
- **`splitBy`.** The third, unlabelled select in "Agrupar por" appears to be this. It needs a name and its own section, because it changes the shape of the result (one series per value) not the grouping.
- **`version` + migrations.** Saved specs outlive the code. Read-time migration with a version stamp; never mutate a stored spec silently.
- **Server-side validation.** Validate the spec against the catalog on save *and* on run, returning errors keyed by `blockId` + field path so the UI can highlight the offending control instead of showing a blank chart.

### 3.3 Derived titles and the spec sentence

`describe(block, catalog)` produces the human sentence used in three places: the block subtitle, the config panel header, and the PDF export caption. One function, three surfaces — that's what keeps them from drifting.

> *soma de receita em pedidos por data (dia), onde status é Pago.*

This is the highest-leverage single addition. It's the only way a non-technical owner can verify a block does what they think without reading six dropdowns.

### 3.4 Time is the thing that will bite you

- **Timezone.** Group-by-day must use the store's timezone, not UTC and not the browser's. A 22:40 order in `America/Sao_Paulo` is UTC+3h the next day — the daily revenue chart will silently move money between days.
- **Business day boundary.** A bar closing at 02:00 wants "Tuesday" to include Wednesday 00:00–02:00. Add `dayStartsAt` to tenant config and apply it to date bucketing. Without it, every late-night venue's daily chart is wrong in a way they will notice and you won't.
- **Partial buckets.** "Últimos 30 dias" ends mid-day today, so the last point always dips. Either exclude the incomplete bucket or mark it (dashed segment + "parcial" in the tooltip). The screenshot's dropping final point is probably this artifact, not a real decline.
- **Money as integer cents**, formatted at the edge. Never float.

### 3.5 Execution

- **One batch endpoint** `POST /reports/:id/run` with `{ period, compare }` returning `{ blockId → result | error }`. Per-block error isolation: one bad block shows an error card, the other nine still render.
- **Compare** returns the previous-period aggregate alongside, so deltas don't need a second round trip.
- **Cache key** = `tenant + blockSpecHash + period + timezone + permissionScope`. Permission scope belongs in the key or you'll serve a manager's cached result to a waiter.
- **Cost guard.** Blocks are user-authored SQL in disguise. Enforce a row cap and a statement timeout, and return a typed "resultado grande demais, use um filtro ou top N" error rather than timing out.
- **Period lives in the URL** (`?period=last_30d`), so a shared link reproduces exactly what the sender saw. `defaults.period` is only the starting point.

---

## 4. Suggested order

1. Field catalog + `describe()` — unblocks most UI fixes and is pure backend.
2. Config popover → side panel / bottom sheet, with live preview.
3. `limit`, `sort`, `splitBy`, real operators.
4. Timezone + `dayStartsAt` + partial-bucket handling.
5. Chart rendering pass (integer ticks, no axis titles, tick skipping, empty/loading states).
6. Reports list as cards; block picker with templates.
7. Accessibility pass (keyboard reorder, live regions, table fallback).
