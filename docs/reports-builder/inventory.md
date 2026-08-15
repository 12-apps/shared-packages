# Component inventory

The artifact `porting.md` §3 asks for, and §7 names as failure cause #3: without it "the agent
invents components that duplicate yours, and the result looks foreign no matter how faithful the
behaviour is."

**Scope of "this codebase":** `12-apps/shared-packages`. The design system is `packages/ui`
(`@12-apps/ui`), and the screens being ported are `packages/report-builder/src/react`. The origin host has
no `packages/ui` — it consumes the published `@12-apps/ui`, so a component invented here would be
invented for every consumer, not just one app.

**Read the third column first.** The single most useful fact in this file is not which design-system
component to reach for — it is that **most of these screens already exist**. `packages/report-builder/src/react`
is 4,516 lines across 31 modules and already renders the list, the viewer, the editor, the block
panel, the template picker, the viz picker and the width picker. Almost every row below is "adjust
what is there", not "build". Rows that say **build new** are the ones that genuinely have no
counterpart.

Imports are subpath-style throughout (`@12-apps/ui/form/Select`), matching what the package already
does. Every subpath named here was checked against `packages/ui/package.json`'s `exports` map — they
all resolve.

---

## 1. The `porting.md` §3 table, filled in

| Prototype | In `@12-apps/ui` | Already built here | Decision |
|---|---|---|---|
| `.btn` / `.btn.primary` / `.btn.sm` | `form/Button` | yes — 12 call sites, the most-used component in the package | **use as-is** |
| `.chip` (Publicado / Rascunho / Arquivado) | `data-display/Chip`, `data-display/Badge` | **no** — `report-card-list.tsx:33` renders status as a bare string via `statusNote()` | **use existing** — swap the string for `Chip`. The prototype is right and we are wrong here |
| `.seg` (period segmented control) | `form/ToggleGroup` | yes — `lib/range-toggle.tsx`, already on `ToggleGroup` | **use as-is** |
| `.switch` (compare toggle) | `form/Switch` + `form/Label` | **no** — compare mode is not built | **use as-is**. Prototype backs it with a checkbox in a `<label>`; `Switch` + `Label` is the same semantics |
| `.card` (report list card) | `layout/Card`, `layout/CardGrid` | partly — `report-card-list.tsx` uses `Card`, lays out by hand | **use as-is** — adopt `CardGrid` for the grid |
| `.pill` (scope filter) | `form/ToggleGroup` (exclusive) | **no** — `report-list-filters.ts` holds the logic, no pill UI | **use as-is**. Prototype's pills are `aria-pressed` and mutually exclusive → exclusive `ToggleGroup`, not `Chip` |
| `.block` (block shell + header + tools) | — | yes — `report-editor-block.tsx` | **extend existing.** Not "build new" as §3 guesses: the frame, grip, title, ✎/🗑 and live-data body exist |
| `.panel` (config side panel / bottom sheet) | `layout/Drawer`, `data-display/Sheet` | yes — `block-editor-panel.tsx`, on `Drawer` + `useMediaQuery` | **extend existing.** Responsive switch is there; the mobile branch should become `Sheet` rather than a narrow Drawer |
| `select` / `input` in the panel | `form/Select`, `form/Input`, `form/Label` | partly — `Select`/`Input` yes, **`Label` nowhere in the package** | **use as-is** — adding `Label` is what fixes the unlabelled-control a11y defect |
| `.viz-grid` (viz type picker) | `form/ToggleGroup` | yes — `viz-picker.tsx`, built from `Button` + local `lib/viz-icons` | **extend existing** — move onto `ToggleGroup`; it is single-select and currently says so only visually |
| `.width-picker` | `form/ToggleGroup` | yes — `block-width-picker.tsx`, also `Button`-based | **extend existing** — same move; options come from `layout.ts` |
| `.tpl` (template card in picker) | `layout/Card` | yes — `block-template-picker.tsx`, `Modal` + `Button` rows | **extend existing** — the prototype's templates are cards, ours are buttons |
| `.modal` (block picker) | `feedback/Modal`, `feedback/StackedModal` | yes — `block-template-picker.tsx` already on `Modal` | **use as-is** — `StackedModal` only if it can open over the settings drawer |
| `.drawer` (settings) | `layout/Drawer` | partly — `Drawer` is used for the block panel, not for settings | **use as-is** |
| `.toast` + undo | `feedback/Toast`, `feedback/Sonner` | **no** — no toast anywhere in the package | **use existing** — prototype's toast carries a "Desfazer" button, so confirm the action-slot + `aria-live` path before relying on it |
| Charts | `@12-apps/ui/charts` → `SpecChart` | yes — `report-render.tsx:15` | **existing lib.** Note the entry point is `@12-apps/ui/charts`, not `data-display/Chart`: `SpecChart` is the semantic wrapper (theme tokens, pt-BR formats) and is the one to use |

---

## 2. Elements §3 omits

§3 lists 16 rows; the prototype defines **91 classes**. These carry decisions of their own.

| Prototype | In `@12-apps/ui` | Already built here | Decision |
|---|---|---|---|
| `.kpi` / `.kpi-value` / `.kpi-delta` | `data-display/StatCard` | yes — `report-render.tsx` | **use as-is** — the compare delta is a StatCard concern |
| `.empty` | `data-display/EmptyState` | yes — 2 call sites | **use as-is** |
| `.skel` | `layout/Skeleton`, `data-display/AsyncStateContainer` | **no** — we show `LoadingState` (5 call sites) | **use existing** — a spinner where the prototype shows layout-shaped skeletons |
| `.sentence` + `.mono` | `typography/Text`, `typography/Code` | yes — the `describe()` surface | **extend** — the mono face on the spec line is deliberate (`porting.md` §4); `typography/Code` may already carry it |
| `.search` | `form/Input` | yes — `report-card-list.tsx` | **use as-is** |
| `.toolbar` / `.topbar` | `layout/ContentToolbar` | **no** — hand-laid `Stack` rows | **use existing** |
| `.card-menu` (`[data-menu]`) | `navigation/DropdownMenu` | yes — 1 call site | **use as-is** |
| `.icon-btn` | `form/Button` icon variant, `form/HeaderButton` | yes — `Button` + local `lib/block-icons` | **use as-is** |
| `.radio` | `form/RadioGroup` | **no** | **use as-is** |
| `.tag` (`R$` / `#` type tags) | `data-display/Chip` (small) or `Badge` | **no** | **use as-is** |
| `.warn` / `.note` / `.hint` | `data-display/Alert`, `data-display/Banner` | yes — `Alert`, 4 call sites | **use as-is** |
| `.tbl-scroll` | `layout/ScrollArea` | **no** | **use existing** — the mobile sticky-column table (`notes.md` §1) |
| `.danger-zone` | `layout/Card` + `feedback/ConfirmAction` | partly — `lib/confirm-dialog.tsx` (45 lines) wraps `data-display/AlertDialog` | **extend** — see §3 below |
| `.legend` | part of `SpecChart` | yes | **existing lib** — legend must carry the category name (`notes.md` §2) |
| `.scrim`, `.sheet-grip` | owned by `feedback/Modal` / `data-display/Sheet` | n/a | **use as-is** — do not rebuild |
| sparkline on list cards | `@12-apps/ui/charts` | **no** | **use as-is**, small variant |
| `.drop-ind`, `.drag-ghost`, `.drag`, `.resize`, `.size-badge` | — | partly — `lib/drag-reorder.ts` (77 lines, hand-rolled pointer handling) | **build new** — see §3 on `@dnd-kit` |
| `.sr` + `#live` | — | **no** | **build new**, tiny — the visually-hidden `aria-live` region every announcement writes to |
| `.unsaved` | — | partly — `lib/use-unsaved-changes.ts` holds the state, nothing renders it | **build new**, tiny — the indicator only |
| `.add-block` / `.add-line` | `layout/Card` (dashed) | yes — via the template picker's entry point | **extend** |

Remaining classes are structural (`.row`, `.wrap`, `.main`, `.screen`, `.grid`, `.body`, `.field`,
`.meta`, `.sub`, `.eyebrow`, `.spacer`, …) or state modifiers (`.on`, `.selected`, `.dragging`,
`.resizing`). They map to `Stack` / `Box` / `sx`, not to components.

---

## 3. What our design system offers that the prototype ignores

The prototype is vanilla DOM, so anything it hand-rolls that we already own is a place to substitute.
Six are worth acting on:

1. **`data-display/DataViews` / `DataGrid` / `Table`.** The prototype has no real table beyond
   `.tbl-scroll`. The "ver como tabela" chart fallback (`notes.md` §2) is an accessibility
   requirement, and it should land on `Table`/`DataViews` — sorting, keyboard traversal and the
   scroll container come free. `report-render.tsx` already imports `data-display/Table`; extend that
   rather than hand-rolling a second one.

2. **`feedback/ConfirmAction`.** `lib/confirm-dialog.tsx` is 45 lines wrapping `AlertDialog` to get a
   confirm. `ConfirmAction` is that pattern already. Worth checking whether the local wrapper is
   redundant before the danger-zone commit adds a second confirm path.

3. **`form/Label`.** Not imported anywhere in the package, while `Select` and `Input` are used seven
   times between them. Every one of those is currently an unlabelled control. This is the cheapest
   real accessibility win in the port.

4. **`layout/Skeleton` / `data-display/AsyncStateContainer`.** We use `LoadingState` (a spinner) in
   five places where the prototype shows layout-shaped skeletons. `AsyncStateContainer` collapses
   the loading/error/empty triad the package currently spells out by hand with
   `LoadingState` + `ErrorState` + `EmptyState` at each call site.

5. **`layout/ContentToolbar` and `layout/CardGrid`.** Both toolbars and the card grid are hand-laid
   `Stack`s today. These are exactly the components that make a screen look native to the app rather
   than adjacent to it.

6. **`data-display/Chip`.** Status is a bare string (`"Arquivado"` / `"Rascunho"`). The prototype is
   more correct than the implementation here.

**One thing the prototype prescribes that we do *not* have:** `@dnd-kit`. `porting.md` §2 says drag
and resize should be `@dnd-kit/sortable` with `rectSortingStrategy`. It is **not a dependency of any
package in this repo**, and `@12-apps/ui` ships no drag primitive. Meanwhile `lib/drag-reorder.ts`
(77 lines) already implements reorder with hand-rolled pointer handlers. So that row is a real
decision with a cost, not a lookup:

- adopting `@dnd-kit` adds a dependency to a *published* package, which every consumer then resolves;
- keeping the local implementation means writing the keyboard sensor and the live-region
  announcements ourselves — the parts `porting.md` §2 flags as load-bearing and the parts hand-rolled
  drag code usually omits.

Worth an explicit decision before the reorder commit starts, rather than during it.

---

## 4. Corrections to `orientation.md` §3

`porting.md` §3 points at `orientation.md` §3 as "filled in against this repo". Four of its rows have
since gone stale, all in the same direction — they under-count what exists:

| Row | `orientation.md` §3 says | Actually |
|---|---|---|
| `.panel` | "replaces `react/block-editor-popover.tsx`" | That file does not exist. `block-editor-panel.tsx` does, already on `Drawer` + `useMediaQuery` |
| `.viz-grid` | **build new**, thin | `viz-picker.tsx` exists (100 lines). The work is moving it onto `ToggleGroup` |
| `.width-picker` | **build new**, thin | `block-width-picker.tsx` exists (98 lines). Same |
| `.block` | **build new** — extend the existing block | `report-editor-block.tsx` exists. "Build new" and "extend the existing" are opposite instructions; it is an extend |

Its `.tpl` row (**extend existing** on `layout/Card`) is right in outcome but for a different reason:
`block-template-picker.tsx` exists and is `Modal` + `Button` rows, so the extension is card-ifying
what is there, not adding cards to a picker that has none.
