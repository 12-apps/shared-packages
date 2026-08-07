# Report builder — implementation plan

A commit-by-commit changelog of everything in `report-builder-v2.html`, written so another agent can implement it in the real codebase without re-deriving the reasoning.

**How to use this:** each entry is one commit. `Depends on` gives the ordering. `Acceptance` is the check that it's done. The prototype is the behavioural reference — when this doc and the prototype disagree, the prototype wins.

Conventions: conventional commits, one behavioural change per commit, no drive-by refactors.

---

## Phase 0 — Foundations (backend + shared types)

Nothing in the UI phases is worth doing before these three land. Most UI defects are symptoms of their absence.

### `feat(reports): add server-owned field catalog`
**Depends on:** —

The UI currently guesses what a field is, which is why the measure picker offers `Soma de Status` and filters take a hand-typed `PAID`.

Add a catalog, served from one endpoint and consumed by both the query builder and the UI:

```ts
type FieldMeta = {
  id: FieldId;
  source: SourceId;
  label: string;                                   // "Forma de pagamento"
  role: 'dimension' | 'measure';
  type: 'money' | 'count' | 'number' | 'date' | 'enum' | 'text';
  aggs?: Agg[];                                    // legal aggregations
  grains?: Grain[];                                // date only
  values?: { value: string; label: string }[];     // enum: PAID -> "Pago"
  ops: Op[];                                       // legal filter operators
  format?: { currency?: 'BRL'; decimals?: number; unit?: string };
  requires?: Permission;                           // 'reports:cost:read'
};
```

- `GET /reports/catalog` returns only fields the caller may see. **Filter server-side** — a client-side filter leaks `margem`/`custo` through the API, and separately through PDF/CSV export.
- Same catalog instance validates incoming specs. One source of truth or it drifts.

**Acceptance:** a user without `reports:cost:read` gets a catalog with no cost fields, and a hand-crafted spec referencing `margem` is rejected with 403 on both run and export.

### `feat(reports): ReportSpec v2 with stable block ids`
**Depends on:** field catalog

```ts
type ReportSpec = {
  version: 2;
  blocks: Block[];
  defaults: { period: PeriodRef; compare: 'previous_period' | 'previous_year' | null };
};

type Block = {
  id: string;                                      // ULID, not array index
  title: string | null;                            // null = derive from spec
  source: SourceId;
  groupBy: { field: FieldId; grain?: Grain } | null;
  splitBy: FieldId | null;
  measures: { id: string; field: FieldId; agg: Agg }[];
  filters: Filter[];
  sort: { ref: string; dir: 'asc' | 'desc' } | null;
  limit: number | null;                            // top N + "Outros"
  viz: VizType;
  layout: { w: 4 | 6 | 8 | 12; order: number };
};
```

New vs today: `id`, `splitBy`, `sort`, `limit`, `title: null` semantics, `layout.order`.

- Read-time migration `v1 → v2`; assign ULIDs to existing blocks; never mutate stored specs silently.
- `title: null` means "keep following the spec" — change the measure and the title follows. A string means the user overrode it. Today every block is named after its collection, so a report shows "Pedidos" three times.

**Acceptance:** existing saved reports load unchanged; round-tripping a v1 report through save produces a valid v2 with stable ids.

### `feat(reports): describe(block) spec sentence`
**Depends on:** ReportSpec v2

A pure function producing the Portuguese sentence:

> *soma de receita em pedidos por data (dia), onde status é Pago.*

Used in three places — block subtitle, config panel header, PDF caption. One function, three surfaces, so they can't drift. Also provides `autoTitle(block)` for `title: null`.

This is the highest-leverage single addition: it's the only way a non-technical owner verifies a block without reading six dropdowns.

**Acceptance:** unit tests covering no-groupBy, date grain, splitBy, limit, and multi-filter cases.

### `feat(reports): batch run endpoint with per-block isolation`
**Depends on:** ReportSpec v2

`POST /reports/:id/run` with `{ period, compare }` → `{ [blockId]: result | error }`.

- One bad block renders an error card; the other nine still render.
- `compare` returns the previous-period aggregate in the same response — no second round trip for deltas.
- Cache key includes `tenant + blockSpecHash + period + timezone + permissionScope`. **Permission scope must be in the key** or a manager's cached result gets served to a waiter.
- Row cap + statement timeout, returning a typed `RESULT_TOO_LARGE` so the UI can say "use um filtro ou top N" instead of hanging.

**Acceptance:** a block with a deliberately invalid field returns an error for that block only, HTTP 200 overall.

### `fix(reports): bucket dates in store timezone with configurable day start`
**Depends on:** batch run endpoint

Three related bugs, all currently silent:

1. Group-by-day must use the store's timezone. A 22:40 `America/Sao_Paulo` order is the next day in UTC — revenue moves between days.
2. Add `dayStartsAt` to tenant config (e.g. `05:00`). A bar closing at 02:00 wants Tuesday to include Wednesday 00:00–02:00.
3. Mark or exclude the incomplete trailing bucket. "Últimos 30 dias" ends mid-day, so the last point always dips — the drop on the final point of the current chart is probably this, not a real decline.

Also: money as integer cents throughout, formatted only at the edge.

**Acceptance:** a fixture order at 23:30 local appears in that local day's bucket; with `dayStartsAt=05:00`, a 01:00 order belongs to the previous day.

---

## Phase 1 — Editor shell

### `refactor(reports): split view mode from edit mode`
**Depends on:** —

Today they're one screen, which is why `Salvar`/`Cancelar` sit inline with the period tabs. Two routes: `/reports/:id` (read) and `/reports/:id/edit`.

View mode: title, status chip, period + compare, Exportar, Editar. Edit mode: inline-editable name, unsaved indicator, Ajustes, Descartar, Salvar.

**Acceptance:** no save/cancel controls exist in view mode.

### `feat(reports): move report metadata into a settings drawer`
**Depends on:** view/edit split

Nome, Descrição, Status, Quem pode ver, período padrão, envio automático, arquivar. Currently ~400px of form above the canvas before you reach the actual work.

Name stays inline-editable in the editor header (that's the field people actually change). Everything else goes in the drawer.

**Acceptance:** the canvas is the first thing below the toolbar in edit mode.

### `feat(reports): unsaved-changes state and ⌘S`
**Depends on:** view/edit split

Dirty flag, header indicator, ⌘S/Ctrl+S, and a navigation guard. A no-op change (drag that lands where it started, resize to the same width) must **not** mark dirty.

**Acceptance:** dragging a block and dropping it in place leaves the report clean.

---

## Phase 2 — Config panel

### `feat(reports): replace block config popover with a side panel`
**Depends on:** Phase 0

The popover truncates labels to `St…` / `igu…` and covers the block being configured. Replace with a right panel (desktop, ~344px) / bottom sheet (<760px), full height, preview live-updating beside it.

**Acceptance:** no truncated control labels at any viewport ≥360px.

### `feat(reports): drive measure and aggregation pickers from the catalog`
**Depends on:** field catalog, side panel

- Measures list = `role === 'measure'` only. Today it lists dimensions.
- Aggregation options = `field.aggs`. Changing the field re-validates the aggregation and falls back to the first legal one.
- Show type tags (`R$`, `#`) in the option label.

**Acceptance:** `Soma de Status` is not expressible through the UI.

### `feat(reports): typed filter values and full operator set`
**Depends on:** field catalog, side panel

- Enum fields → value picker with `values[].label` ("Pago"), never raw `PAID`.
- Operators from `field.ops`; add `in`, `between`, `contains` — currently unexpressible.
- Changing the filter field resets the value to the first legal one.

**Acceptance:** filtering by status never requires typing.

### `feat(reports): label groupBy, grain and splitBy separately`
**Depends on:** side panel

The three unlabelled selects become: **Agrupar por** (`eixo X`) + granularity (date only), and **Separar em séries** as its own section. `splitBy` changes the *shape* of the result — one series per value — so it doesn't belong in the same row as the grouping.

**Acceptance:** no unlabelled select in the panel.

### `feat(reports): top-N limit with "Outros" bucket`
**Depends on:** ReportSpec v2, side panel

The current produtos chart draws ~10 overlapping labels. `limit` in the spec, computed server-side, remainder aggregated as "Outros".

**Acceptance:** setting top 5 on a 12-value dimension returns 6 rows.

### `feat(reports): visual viz picker with reasons for disabled types`
**Depends on:** side panel

Icon grid. Each type validated against the current spec, disabled with an explanation:

| Type | Blocked when | Message |
|---|---|---|
| KPI | `groupBy != null` | "Um número único não usa agrupamento. Tire o 'agrupar por' para escolher." |
| Pizza/Rosca | no `groupBy`, or >8 categories | "Fatias demais para ler. Use barras ou limite o top N." |
| Linha | grouped by a non-date field | "Linha só faz sentido em campos de tempo. Use barras." |

Changing `groupBy` auto-corrects an now-illegal viz rather than rendering nothing.

**Acceptance:** every disabled option has a visible reason, not just a grey state.

### `feat(reports): visual width picker replacing 12ths notation`
**Depends on:** side panel

`6/12 · 1/2` leaks the grid implementation. Four segments: 1/3, 1/2, 2/3, cheia, drawn to scale.

---

## Phase 3 — Canvas interactions

### `feat(reports): drag-and-drop block reordering`
**Depends on:** ReportSpec v2 (stable ids)

Use `@dnd-kit/core` + `@dnd-kit/sortable` with `rectSortingStrategy` (grid-aware). Sensors: pointer + keyboard + touch.

Interaction contract, as prototyped:

- **Handle only** (⠿ in the block header), never the whole card — dragging from the body fights with block selection and with chart tooltips.
- Drag ghost follows the cursor; the source block stays in place at ~32% opacity as a position reference.
- **3px insertion indicator**: vertical when dropping beside a block in the same row, horizontal when between rows.
- Drop target = nearest block centre, with **y weighted 1.4×** so side-by-side blocks don't steal a drop aimed above or below.
- Edge auto-scroll within ~110px of the viewport top/bottom.
- **Escape cancels** mid-drag.
- Reorder operates on an **id array** (`order.splice(pos, 0, id)`), never index arithmetic on the block array — with variable-width blocks in a 12-column grid, index math goes wrong fast. Persist as `layout.order`.
- Suppress the synthetic `click` that follows `pointerup`, or every drop re-triggers selection.
- Keyboard equivalent: **Alt + ↑/↓**, with an `aria-live` announcement ("… movido para a posição 2 de 5"). Drag-only reordering is a WCAG 2.1.1 failure.

**Acceptance:** a block can be moved from last to first with the keyboard alone, announced by a screen reader.

### `feat(reports): drag-to-resize block width`
**Depends on:** drag-and-drop reordering

Right-edge handle, visible on hover/selection.

- Column width computed from the live grid rect: `colW = (gridWidth - gap * 11) / 12`, with `gap` read from `getComputedStyle(grid).columnGap` (it differs between breakpoints — don't hardcode).
- Target span = `round((pointerX - blockLeft + gap) / (colW + gap))`, clamped 1–12, then **snapped to [4, 6, 8, 12]**. Arbitrary spans produce ragged rows and unreadable narrow charts.
- Apply the span live via CSS while dragging; **re-render the chart only on drop** — chart height is width-dependent and re-rendering per pointermove is wasteful.
- Floating badge at the cursor showing `1/2 · 6/12`.
- Keyboard equivalent: **Shift + ←/→** steps through the allowed widths, announced.
- Below 760px the handle is hidden: width is a desktop hint and every block is full width. Say so in the panel so it doesn't read as a bug.

**Acceptance:** resizing to the same width does not mark the report dirty; the chart re-renders at most once per gesture.

### `feat(reports): template picker for adding blocks`
**Depends on:** side panel

"Adicionar bloco" currently creates an empty block that must then be decoded through a popover. Replace with a modal of templates grouped by area (Vendas / Movimento / Pagamentos e perdas) plus "bloco em branco". Selecting one appends a fully-configured block, selects it, and scrolls it into view.

---

## Phase 4 — Charts

### `fix(reports): chart axis rendering`
**Depends on:** —

Four defects visible in the current screenshots:

1. The axis title ("Data (dia)") renders **on top of** the tick labels. Remove axis titles entirely — the spec sentence already says what the axis is.
2. Category labels overlap ("Monster Absolut" over "Baly Zero"). Skip every *n*th tick, always keep the last, truncate at ~12 chars with an ellipsis.
3. Count metrics get fractional ticks rounded to duplicates (`3, 2, 2, 1, 0`). Force integer steps when `type === 'count'`.
4. Two-point series drawn as smooth curves invent data that doesn't exist. Straight segments always; bars below ~5 points.

**Acceptance:** no overlapping text at 360px, 768px and 1440px on every viz type.

### `feat(reports): per-block loading, empty and error states`
**Depends on:** batch run endpoint

Skeleton while the query runs; "Sem dados nesse período" with a widen-range action; typed error card with the reason and a retry. Currently a slow or failed block is indistinguishable from an empty one.

---

## Phase 5 — Reports list

### `feat(reports): replace report select with a card list`
**Depends on:** —

The `<select>` gives no description, owner, block count or last-edited date, and the name is then repeated as the page heading. Cards + search + scope pills (Todos / Meus / Arquivados). "Mostrar arquivados" becomes a scope, not a floating checkbox.

Empty state is an invitation, not a blank grid.

### `feat(reports): new report goes straight to the editor with the picker open`
**Depends on:** template picker, card list

Creates a **draft** named "Relatório sem título" and opens the block picker immediately. Drafts don't appear in other people's lists — which is the actual fix for `fvgcfgf` reaching production.

Three entry points: toolbar button, dashed card at the end of the grid, empty-state button.

---

## Phase 6 — Accessibility and mobile

### `feat(reports): make charts accessible`
**Depends on:** chart rendering fixes

- `role="img"` + `aria-label` containing the full series as text.
- `<title>` inside each bar/point/slice — native tooltip for mouse users and per-element info for AT, in one change.
- "Ver como tabela" toggle per block in view mode: the same query rendered as a `<table>`. This is the real fallback.
- Never encode a series by colour alone; the legend always carries the category name next to the swatch.
- Axis label contrast ≥4.5:1 — the current grey is around 3:1. Chart text is text.

### `feat(reports): focus management and live regions`
**Depends on:** side panel, template picker

Store the trigger on open, restore on close, Escape closes. `aria-live="polite"` mirrors every toast, including undo. Undo also reachable via ⌘Z — a 6-second toast is not a reachable target for switch access.

### `feat(reports): responsive editor down to 360px`
**Depends on:** side panel

- Config panel → bottom sheet (~78vh) with a grip.
- All blocks full width below 760px; the `w` setting persists for desktop.
- Hover-only affordances become permanently visible; touch targets ≥40px.
- Tables scroll horizontally with a sticky first column.
- Two sticky bars eat 112px of a 640px viewport — collapse the toolbar into the header on scroll, or make period a single button opening a sheet.
- Tap-to-pin chart tooltips with a visible dismiss (hover doesn't exist), or print values as labels when ≤6 points.

### `feat(reports): replace destructive dialog with undo toast`
**Depends on:** —

Removing a block is cheap and reversible. Remove immediately, offer Desfazer for ~6s, restore at the original index. Drops a modal, a focus trap and two uppercase MUI buttons that match nothing else in the product.

---

## Phase 7 — Sharing

### `feat(reports): period in the URL and shareable links`
**Depends on:** batch run endpoint

`?period=last_30d&compare=previous_period`. `defaults.period` is only the starting point — a shared link must reproduce exactly what the sender saw.

### `feat(reports): scheduled email delivery`
**Depends on:** export, permissions

Weekly/monthly PDF of the previous period to everyone with view access. Rendered under **each recipient's** permission scope, not the author's.

---

## Suggested order

Phase 0 → 2 → 4 → 1 → 3 → 5 → 6 → 7.

Phase 0 unblocks everything and is pure backend, so it can run in parallel with nothing else. Phase 2 and 4 deliver the most visible improvement per unit of work. Phase 3 is the most enjoyable and the least urgent — the panel's width picker already covers the need that drag-resize makes nicer.
