# Report builder — implementation plan

A commit-by-commit changelog of everything in `report-builder-v2.html`, written so another agent can implement it in the real codebase without re-deriving the reasoning.

**How to use this:** each entry is one commit. `Status` says whether it still needs doing. `Depends on` gives the ordering. `Acceptance` is the check that it's done. The prototype is the behavioural reference — when this doc and the prototype disagree about *intended behaviour*, the prototype wins.

Conventions: conventional commits, one behavioural change per commit, no drive-by refactors.

---

## Reconciliation status — read this first

This plan was written from **screenshots of the running app** and assumes a greenfield build. It is not one. `packages/report-builder/src` is ~18,200 lines across 120 modules with 41 test files, and PR #31 (`feat(reports): report builder redesign — Phases 0, 2, 3, 4, 5, 6 (partial)`, FUT-391) implemented a large part of this document directly.

Every entry below now carries a **`Status:`** line, added by reading the source at `a47785c`. Paths are relative to `packages/report-builder/` unless stated otherwise.

| Mark | Means |
|---|---|
| **ALREADY DONE** | Shipped. The entry's scope and `Acceptance` are both satisfied. Write the test, watch it pass, close the commit — do not write code. |
| **ADJUST EXISTING** | A real implementation exists; the commit is a delta on it. **The scope line has been rewritten** to the work that actually remains. |
| **BUILD NEW** | Nothing implements it. The original scope stands unchanged. |
| **NO LONGER APPLIES** | The premise is false here, or following the entry as written would be a regression. |

**Tally: 6 already done · 17 adjust · 4 build new · 1 no longer applies.**

Three things to know before using this document:

1. **This plan has 28 entries, not 25.** Any count of "the 25 commits" predates or miscounts it — Phase 2 has seven entries and Phase 6 has four. The 28 are numbered below.
2. **`orientation.md` is now stale.** It was written against `316c22f`, and PR #31 landed *after* it. Four of its Phase 0 verdicts have since flipped — most importantly `describe()`, which it calls "genuinely missing" and which now exists with full test coverage (`src/describe.ts`). Where `orientation.md` and these `Status:` lines disagree about what exists today, **these lines win**; they were read from the current tree. `orientation.md` §2.1–2.7's reasoning about *what not to do* is still good and is cited from the entries below.
3. **`inventory.md` is current on components, and is the source for the component decisions cited here.** Its §2 rows for `.unsaved` and `.sentence` are the exception: both now render (`src/react/report-editor.tsx:150-160`, `src/react/report-view.tsx:40-50`).

The **suggested order at the foot of this document has been rewritten** to match.

---

## Phase 0 — Foundations (backend + shared types)

Nothing in the UI phases is worth doing before these three land. Most UI defects are symptoms of their absence.

> Phase 0 is now the *most* complete phase, not the blocking one. Four of five entries are shipped or nearly so.

### 1. `feat(reports): add server-owned field catalog`
**Status:** ADJUST EXISTING — `src/types.ts:104-165`, `src/server/catalog.ts`, `src/server/catalog-values.ts`, `src/catalog.ts`
**Depends on:** —

The catalog exists and is server-owned. `FieldDef` carries `label`, `type`, `role`, `aggregations`, `format` and `description`; `values[]` (`types.ts:134`) and `ops[]` (`types.ts:141`) both landed with FUT-391, backed by `server/catalog-values.ts`, which mirrors the DB CHECK constraints so `PAID → "Pago"` is a lookup rather than a typed string.

**Scope (reconciled).** One field is genuinely absent: **`requires`** — a per-FIELD permission. What exists today is per-ENTITY: `REPORT_ENTITY_PERMISSION` in `src/server/policy.ts` maps `orders → reports:sales:read`, `stock_movements → stock:read`, kitchen entities to their own tier. That is coarser than the plan's `margem`/`custo` case, which needs field granularity inside an entity the caller may otherwise read.

- Add `requires?: Permission` to `FieldDef`, filtered **server-side** in the catalog listing and re-checked at compile time, so a hand-crafted spec is rejected on run and export both.
- It must compose with — not replace — `minGroupSample` / `identityMinSample` (`types.ts:130,150`), the FUT-454 privacy floors. They answer a different question ("is this aggregate too small to be anonymous?") and the source carries the rationale.

**Do not** introduce the plan's `format?: { currency?: 'BRL'; decimals?; unit? }`. This repo has `ReportValueFormat = 'brl' | 'integer' | 'decimal' | 'text' | 'duration' | 'percent'` (`types.ts:72`), already threaded through compile, render, KPI tiles and CSV export (`orientation.md` §2.1). Keep the union.

**Acceptance:** a user without `reports:cost:read` gets a catalog with no cost fields, and a hand-crafted spec referencing `margem` is rejected with 403 on both run and export.

### 2. `feat(reports): ReportSpec v2 with stable block ids`
**Status:** NO LONGER APPLIES — `src/spec.ts:110-176`
**Depends on:** field catalog

**Why.** Every element this commit proposes either already exists or would be a regression:

- **Stable block ids** — `dashboardBlockSchema.id` (`spec.ts:144-146`), regex-constrained, with duplicate detection in a `superRefine` (`spec.ts:166-175`). "ULID, not array index" is already the design.
- **`sort`** — `spec.ts:114-117`, up to 3 keys. **`limit`** — `spec.ts:118`, 1..10 000.
- **`splitBy`** — exists as the second entry of `dimensions` (`max(2)`, `spec.ts:111`). It is a missing *label*, not a missing model field; that work is entry 12.
- **`title: null`** — implemented as `title` optional (`spec.ts:147`), with `autoTitle()` (`src/describe.ts:163`) deriving the name when it is absent. Absent and `null` mean the same thing here.
- **`layout.order`** — not a field, and does not need to be: order is array position, and `reorderBlock` (`src/react/report-model.ts:127`) moves elements by **id**, never by index arithmetic. The plan's own warning is already honoured.
- **`layout.w: 4 | 6 | 8 | 12`** — would be an outright regression. `spec.ts:136-142` accepts 1..12 *deliberately*, so a legitimate narrow KPI strip stays savable; readability floors are an authoring rule (`minSpanForPresentation`), not a storage constraint. Snapping belongs in the resize gesture (entry 17), never in the schema.

Also: the plan's single `ReportSpec { blocks[] }` collapses two shapes that exist on purpose — `reportSpecSchema` (one report) and `dashboardSpecSchema` (`{kind:'dashboard', blocks[]}`), discriminated on `kind` in the same `SavedReport.spec` column. The single-report path is what presets, MCP authoring and the built-in viewer all use (`orientation.md` §2.2). Collapsing them breaks all three.

There is no v2 to introduce. Close this entry.

### 3. `feat(reports): describe(block) spec sentence`
**Status:** ALREADY DONE — `src/describe.ts`
**Depends on:** ReportSpec v2

A pure function producing the Portuguese sentence:

> *soma de receita em pedidos por data (dia), onde status é Pago.*

**Shipped as `specSentence(spec, catalog)`** (`describe.ts:133`) plus `autoTitle(spec, catalog)` (`describe.ts:163`) — named to avoid colliding with the unrelated `describeSpecIssues` in `src/spec.ts`, exactly as `orientation.md` §4 asked. It is computed **server-side** in `src/run.ts:140` and shipped on each block result as `sentence`, so the viewer, the editor and an export cannot drift. It is a display function: a spec naming a field the catalog no longer carries still produces a sentence rather than throwing, which is when a reader most needs it.

`src/__tests__/describe.test.ts` covers every case the acceptance names — no-groupBy, date grain, splitBy, limit, multi-filter — plus clause ordering, ratio divisors, `in` operands and unknown-field fallback.

Two of the three surfaces render it: the block subtitle (`src/react/report-view.tsx:40-50`, where an unnamed block is *titled* by the sentence) and the PDF caption (via the print region). **Residual:** the config panel header still reads a static "Bloco" (`src/react/block-editor-panel.tsx:99`). One line, and it belongs to whoever next opens that file.

**Acceptance:** unit tests covering no-groupBy, date grain, splitBy, limit, and multi-filter cases. — *passes today.*

### 4. `feat(reports): batch run endpoint with per-block isolation`
**Status:** ADJUST EXISTING — `src/run.ts:107-125`, `src/server/routes-run.ts`
**Depends on:** ReportSpec v2

`runDashboard` already isolates per block: one bad block returns `status:'error'` and the other nine render, HTTP 200 overall. Infra failures still reject the whole run, which is the right split.

**Scope (reconciled).** Three additions, none of which exists:

- **`compare`** — the previous-period aggregate in the same response, so deltas need no second round trip. Nothing in the package computes a comparison period today; `StatCard` already treats a delta as its own concern (`inventory.md` §2), so the UI half is cheap once the data arrives.
- **Typed `RESULT_TOO_LARGE`.** `src/errors.ts` carries `unknown_entity`, `unknown_field` and `invalid_spec` only. A row cap does exist (`run.ts:58`, sized to allow the "Outros" bucket its extra row) but it **silently truncates** rather than reporting, so the UI cannot say "use um filtro ou top N". Add the code, and a statement timeout alongside it.
- **Cache key.** There is no result cache in the package at all, so this is a design note rather than a fix: *if* one is added, `tenant + blockSpecHash + period + timezone + permissionScope` — with permission scope in the key, or a manager's cached result gets served to a waiter.

**Acceptance:** a block with a deliberately invalid field returns an error for that block only, HTTP 200 overall. — *passes today; the new acceptance is that a capped result reports `RESULT_TOO_LARGE` instead of returning short.*

### 5. `fix(reports): bucket dates in store timezone with configurable day start`
**Status:** ADJUST EXISTING — `src/time.ts`, `src/server/range.ts`, `src/spec.ts:110`
**Depends on:** batch run endpoint

Timezone bucketing landed with FUT-454: `ReportSpec.timeZone` (`spec.ts:110`), `CompiledQuery.timeZone` (`types.ts:223-229`), the helpers in `src/time.ts`, tests in `src/__tests__/timezone.test.ts` and `src/server/__tests__/local-time.test.ts`. A 22:40 `America/Sao_Paulo` order buckets into its local day.

**Scope (reconciled).** Two of the three bugs remain:

- **`dayStartsAt` in tenant config.** No occurrence anywhere in the package. A bar closing at 02:00 wants Tuesday to include Wednesday 00:00–02:00; today the civil day is the only day.
- **The incomplete trailing bucket is neither marked nor excluded.** `server/range.ts:218-220` documents the opposite decision — rolling presets end at the *next* midnight so the current partial day is always fully inside the window ("7d" is today plus six, never six-and-a-bit). That is right for the window and still leaves the last point of a by-day chart covering a partial day, which is the dip the plan spotted. Mark it in the render model; do not change the window.

The plan's third item, money as integer cents formatted only at the edge, is how `ReportValueFormat`/`formatReportCell` already work.

**Acceptance:** a fixture order at 23:30 local appears in that local day's bucket *(passes today)*; with `dayStartsAt=05:00`, a 01:00 order belongs to the previous day *(new)*.

---

## Phase 1 — Editor shell

### 6. `refactor(reports): split view mode from edit mode`
**Status:** ALREADY DONE — `src/react/create-report-builder.tsx:69-77`
**Depends on:** —

Two routes exist: `/:reportId` (read) and `/:reportId/edit` (`create-report-builder.tsx:76-77`), plus `/new`. Route order is load-bearing and commented as such — `new` and the `system/*` paths carry static segments that `:reportId` would otherwise swallow.

View mode is `src/react/report-view.tsx` + `reports-page.tsx`: title, status, period (`RangeToggle`, `reports-page.tsx:75`), export, and an ⋮ menu whose first item is Editar. Edit mode is `src/react/report-editor.tsx`: inline name, dirty indicator, Descartar, Salvar.

One deviation worth knowing: `/:reportId` renders the **list with the selected report below it**, not a standalone viewer page. The split from edit mode is real; the list is not a separate screen from the viewer.

**Acceptance:** no save/cancel controls exist in view mode. — *passes today.*

### 7. `feat(reports): move report metadata into a settings drawer`
**Status:** ADJUST EXISTING — `src/react/report-editor.tsx:95-125`, `src/react/lib/publish-section.tsx`
**Depends on:** view/edit split

The form the plan complains about is `EditorMeta` (`report-editor.tsx:95`): Nome, Descrição and `PublishSection` (status, visibility, roles) stacked at `maxWidth: 560` **above the canvas**, exactly as described. The drawer does not exist.

**Scope (reconciled).** This is a move, not a build. Every part exists:

- `Drawer` is already a dependency of this package's UI and already used, in `src/react/block-editor-panel.tsx` — reuse that import, and the responsive panel/sheet switch with it.
- Move `EditorMeta`'s Descrição + `PublishSection` into it, triggered from an "Ajustes" button in the editor header.
- **Keep Nome inline** — it is the field people actually change, and it is already the one control with an obvious home in the header.
- `defaultPublishDraft()` / `publishGuardError()` (`builder-model.ts`) move with the section unchanged; the save path reads them from the same state either way (`report-editor.tsx:70-77`).

Período padrão, envio automático and arquivar are *not* in scope here — the first two do not exist as settings (see entries 27 and 28), and arquivar already lives in the viewer's ⋮ menu (`report-view.tsx:145-152`), which is the right place for it.

**Acceptance:** the canvas is the first thing below the toolbar in edit mode.

### 8. `feat(reports): unsaved-changes state and ⌘S`
**Status:** ADJUST EXISTING — `src/react/lib/use-unsaved-changes.ts`, `src/dirty-state.ts`
**Depends on:** view/edit split

Almost all of this shipped, and the hard part is the part that shipped. The dirty flag is **derived** by structural comparison against the last-saved baseline (`src/dirty-state.ts`), not raised by an edit callback — which is precisely what makes the acceptance hold. The module's header names that acceptance as its whole design, and the comparison walks the union of both key sets so `{title: undefined}` and `{}` compare equal. `useUnsavedChanges` adds ⌘S/Ctrl+S (`use-unsaved-changes.ts:37-48`, preventing default only once it knows it is handling the event) and a `beforeunload` guard. The indicator renders at `report-editor.tsx:150-160`, announced with `role="status"`. The baseline moves only on a *successful* save.

**Scope (reconciled).** One gap: the **in-app navigation guard**. `beforeunload` covers closing the tab; it does not fire for a react-router navigation, so Cancelar (`report-editor.tsx:288-290`) and the ← Relatórios link both discard unsaved work silently. Add a router-level block (`useBlocker`) reading the same `dirty` value — one source of truth, no second definition of "dirty".

**Acceptance:** dragging a block and dropping it in place leaves the report clean *(passes today)*; navigating away in-app with unsaved changes prompts *(new)*.

---

## Phase 2 — Config panel

### 9. `feat(reports): replace block config popover with a side panel`
**Status:** ALREADY DONE — `src/react/block-editor-panel.tsx`
**Depends on:** Phase 0

Shipped with FUT-391, and the file's header gives the plan's two reasons back verbatim: the popover covered the block it configured, and it truncated its own labels to `St…` / `igu…`. It is a 344px right-hand panel on desktop and a bottom sheet below 760px (`SHEET_BELOW_PX`, `SHEET_HEIGHT = "78vh"`), full height, with the preview re-running live on every keystroke beside it. Focus returns to the opening control on close (`restoreFocusTo`, `:62,78`). The popover's test ids were kept deliberately, because future-pay's reports e2e drives them.

**Residual, from `inventory.md` §1:** the mobile branch is `Drawer anchor="bottom"` rather than `data-display/Sheet`. It behaves as a sheet; adopting the component would bring the grip for free (entry 25). Cosmetic, not a defect.

**Acceptance:** no truncated control labels at any viewport ≥360px. — *did NOT pass; fixed and now pinned by a test.*

> **This status line was wrong, and this file's own header with it.** Rendered
> in Chromium, the filter row drew its field as `S…`, its operator as `i…` and
> its value as `P…`, with "Remover" clipped past the panel edge — at 1440px and
> at 390px alike. The popover's exact failure, still shipping in the panel that
> replaced it, because the claim that "a fixed 344px give every control its
> label" was never measured. One row cannot hold three selects plus a button:
> each MUI select spends ~32px on its own chrome, so the three need ~200px
> before drawing a character, against ~312px of usable width. The field now
> takes a line of its own and the operator, value and remove control share the
> next; "Remover" became the cross glyph `prototype.html` draws. Pinned by
> `src/react/__tests__/block-editor-panel.test.tsx`, which asserts no elided
> label in either layout branch — jsdom has no layout engine, so pixel overflow
> stays a browser check.

### 10. `feat(reports): drive measure and aggregation pickers from the catalog`
**Status:** ADJUST EXISTING — `src/react/builder-measures.ts:56-61,102-107`, `src/react/builder-sections.tsx:110-145`
**Depends on:** field catalog, side panel

Two of the three bullets shipped. `aggregationOptions(field)` returns the catalog's `field.aggregations`, and for a `role === 'dimension'` field returns **only** `["count", "count_distinct"]` — so `Soma de Status` is already unofferable. `changeMeasureAggregation` re-validates on field change and falls back to the first legal aggregation.

**Scope (reconciled).** What remains is the third bullet only: **show the type tag (`R$`, `#`) in the measure option label.** Options are built from `field.label` alone (`builder-sections.tsx:36-40`), so a money measure and a count measure look identical in the list. `inventory.md` §2 maps `.tag` to `data-display/Chip` (small) — but a `<Select>` option cannot hold a component, so this is either a text prefix in the option label or a move to a richer picker. Decide which; do not silently drop the bullet.

**Do not implement the first bullet as written.** *"Measures list = `role === 'measure'` only"* would be a regression: `count`/`count_distinct` over a dimension is how you express "quantidade de pedidos por status", a legitimate and common report. The screenshot defect was `Soma de Status` specifically, and it is fixed (`orientation.md` §2.7).

**Acceptance:** `Soma de Status` is not expressible through the UI *(passes today)*; a money measure and a count measure are distinguishable in the option list *(new)*.

### 11. `feat(reports): typed filter values and full operator set`
**Status:** ADJUST EXISTING — `src/react/builder-filters.ts`
**Depends on:** field catalog, side panel

The typed half shipped. `valueOptionsFor` turns a field's closed `values[]` into a picker showing `"Pago"`, never raw `PAID`; `operatorOptionsFor` reads the server's `ops[]` per field; `editFilterRow` resets both operator and value when the field changes, because "leaving the previous field's value behind" produces `status eq 1500`, which is valid JSON, compiles, and matches nothing.

**Scope (reconciled).** The operator set is the remaining half, and it is narrower than the plan thinks:

- `in` and `between` are **not missing from the model** — spec-level operators are `['eq','neq','in','gte','lte','between']` with arity validation (`spec.ts:32-46`), and the compiled IR matches (`orientation.md` §2.4). They are missing from the **draft**: `SINGLE_VALUE_OPERATORS` (`builder-filters.ts:18`) narrows the offer to what `specFromDraft` can serialize, since `FilterDraft` holds one `value`. Widening the offer means widening `FilterDraft` first — a multi-value row for `in`, a from/to pair for `between` — or the UI trades a typo for a 400.
- **Only `contains` is genuinely absent**, at the spec level as well as the UI. It needs the operator, its arity rule, and compiler support.

**Acceptance:** filtering by status never requires typing *(passes today)*; `in` and `between` are expressible without hand-editing a spec *(new)*.

### 12. `feat(reports): label groupBy, grain and splitBy separately`
**Status:** ALREADY DONE — `src/react/builder-sections.tsx:45-95`
**Depends on:** side panel

The three unlabelled selects are now three labelled sections: **"Agrupar por"** with the field select labelled `Eixo X` (`:49-54`) and the grain select labelled `Por` and shown for date fields only (`:63`), and **"Separar em séries"** as its own section with `Uma série por` (`:87-91`). Filter and measure rows carry `aria-label`s naming their index and role (`Filtro 1 — condição`, `Medida 2`), so nothing in the panel is an unlabelled control.

**Acceptance:** no unlabelled select in the panel. — *held for the labelled sections only; the five `aria-label`-only controls were unlabelled in the accessibility tree until fixed. Now pinned by a test.*

> **The `aria-label`s were in the source and absent from the DOM.**
> `@12-apps/ui`'s `Select` dropped them: `role="combobox"` sits on MUI's display
> div, not on the hidden native input the prop spread reaches, so the label
> never reached the element carrying the role, and MUI's `aria-labelledby` then
> fell back to that div's OWN id. The accessible name resolved to the control's
> current VALUE — "Receita", "Soma", "Status", "igual a" — which tells a
> screen-reader user what the control holds and nothing about what it is. Fixed
> in the design system, so every consumer passing `aria-label` benefits, and
> pinned by the panel's test asserting the ROLE names. Verified in Chromium at
> both viewports against the browser's own name computation.

### 13. `feat(reports): top-N limit with "Outros" bucket`
**Status:** ALREADY DONE — `src/memory.ts:131-179`, `src/compile.ts:381`, `src/run.ts:55-59`
**Depends on:** ReportSpec v2, side panel

Shipped as FUT-391. `spec.limit` compiles to `query.topN` (`compile.ts:381`), and `foldOthers` (`memory.ts:145`) folds every group past the top N into one row labelled `OTHERS_BUCKET_LABEL = 'Outros'`. The row cap in `run.ts:58` is sized `topN + 1` precisely so the fold's extra row is not chopped off — capping at `limit` would remove the row that keeps the totals balancing.

This runs on the **production path, not just in tests**: the Prisma-backed adapter (`src/server/adapter.ts:329-337`) fetches rows and delegates grouping, sorting and folding to `executeCompiledQuery` in `memory.ts`. One implementation, both adapters.

`src/__tests__/top-n.test.ts` asserts the acceptance directly, including the guard that a caller asking for the maximum row count does not get an "Outros" bucket nobody asked for.

**Acceptance:** setting top 5 on a 12-value dimension returns 6 rows. — *passes today.*

### 14. `feat(reports): visual viz picker with reasons for disabled types`
**Status:** ADJUST EXISTING — `src/react/viz-picker.tsx`, `src/compatibility.ts`
**Depends on:** side panel

The picker shipped: an icon grid where **every blocked option carries its reason as visible text**, not a tooltip — because a tooltip is unreachable on touch, and this is the one place the product has to explain a rule rather than merely enforce it. The reasons come from `presentationCompatibility(shape)` in `src/compatibility.ts`, which returns a pt-BR `disabledReason | null` per option; `defaultPresentation(shape)` is the auto-correct that keeps a now-illegal viz from rendering nothing.

**Scope (reconciled).** The UI is done. What remains is **two rules from the plan's own table that the matrix does not implement** — and both are compiler changes, not picker tweaks:

| Plan rule | Status |
|---|---|
| KPI blocked when `groupBy != null` | **Implemented** (`compatibility.ts`, `dimensionCount !== 0`) |
| Pizza/Rosca blocked at >8 categories | **Not implemented** — only `measureCount !== 1` is checked |
| Linha blocked on a non-date field | **Not implemented** — line/area on a categorical dimension is legal today |

`compatibility.ts`'s header states that a test proves the matrix and the compiler's `assertChartShape` agree, so changing one forces the other: this is a **compiler + matrix + test** change. And the category count is a property of the *result*, not the spec, so an >8-slice rule has to be decided somewhere that knows the row count.

Take the second rule deliberately: blocking "Linha" on categorical data removes a chart people may currently be using (`orientation.md` §2.5). Consider a warning over a block.

**Acceptance:** every disabled option has a visible reason, not just a grey state. — *passes today.*

### 15. `feat(reports): visual width picker replacing 12ths notation`
**Status:** ALREADY DONE — `src/react/block-width-picker.tsx`
**Depends on:** side panel

Shipped, and for the reason the plan gives: `6/12 · 1/2` leaks the twelve-column grid at an author who has no view about twelfths. Four segments — `1/3`, `1/2`, `2/3`, `Inteira` — each drawn to the width it sets.

It also gets the subtlety right that entry 2 warns about: offering four canonical widths does **not** restrict what a block may store. A block saved at span 5 by a preset, over MCP, or by a future drag-resize shows as its own selected segment instead of being silently rewritten the moment its panel is opened.

**Residual, from `inventory.md` §1:** it is `Button`-based; moving it onto `form/ToggleGroup` would make its single-select nature structural rather than merely visual. Same note applies to entry 14's grid.

> **Decide out loud before touching this.** The retired popover's header stated it "deliberately does not own the block's title or width: those are inline on the canvas, where their effect is visible." Width now lives in the panel. That reversal has already happened — it is recorded here so nobody re-litigates it by accident (`orientation.md` §4).

---

## Phase 3 — Canvas interactions

### 16. `feat(reports): drag-and-drop block reordering`
**Status:** ADJUST EXISTING — `src/react/lib/drag-reorder.ts`, `src/react/report-editor-canvas.tsx:96-98`, `src/react/report-model.ts:127`
**Depends on:** ReportSpec v2 (stable ids)

> **The dependency question is settled: see [`decisions/0001-drag-implementation.md`](./decisions/0001-drag-implementation.md). Keep `lib/drag-reorder.ts`; do not add `@dnd-kit` to the published `@12-apps/ui`.** The scope below is what that decision costs.

Reordering exists (FUT-311): a handle-only HTML5 drag carrying a dedicated payload type, so foreign drags — text, files — never highlight a row or trigger a reorder even when their text happens to match a block id. It already satisfies two of the plan's bullets: it is **handle only** (`report-editor-block.tsx:74`, `aria-label="Arraste para posicionar"`), and it operates on **ids**, never index arithmetic — `reorderBlock(draft, sourceId, targetId)` (`report-model.ts:127`), tested for the no-op cases.

**Scope (reconciled).** The affordances and the keyboard path, all absent:

- **Keyboard reordering — this is the urgent one.** `orientation.md` §2.6 says keyboard and touch users "already have up/down buttons", quoting `drag-reorder.ts`'s header. **That is not true of this canvas.** `report-editor-block.tsx` renders exactly four controls — grip, title, ✎, 🗑 — and there is no move-up/move-down anywhere in `src/react`. Reordering on the editor canvas is **drag-only today**, so the plan's WCAG 2.1.1 concern is live, not mitigated. Add **Alt + ↑/↓** on the focused block.
- **A live region.** `.sr` + `#live` per `inventory.md` §2: one visually-hidden `aria-live="polite"` region that every announcement writes to, starting with "… movido para a posição 2 de 5". Nothing like it exists (the only `role="status"` is the dirty indicator), and entries 24 and 26 both need it — build it here, once.
- **The drop affordances:** 3px insertion indicator (vertical within a row, horizontal between rows), drag ghost following the cursor with the source at ~32% opacity, drop target = nearest block centre with **y weighted 1.4×** so side-by-side blocks don't steal a drop aimed above or below, edge auto-scroll within ~110px, and **Escape cancels** mid-drag.
- **Suppress the synthetic `click` after `pointerup`,** or every drop re-triggers selection.

Note the canvas's own framing, which is better than the plan's and should survive: dropping A on B puts A in **B's slot on the grid**, so this is placement, not a list reorder in disguise.

**Acceptance:** a block can be moved from last to first with the keyboard alone, announced by a screen reader.

### 17. `feat(reports): drag-to-resize block width`
**Status:** BUILD NEW
**Depends on:** drag-and-drop reordering

Nothing implements it — `block-width-picker.tsx:11` refers to it as "a future drag-resize". Right-edge handle, visible on hover/selection.

- Column width computed from the live grid rect: `colW = (gridWidth - gap * 11) / 12`, with `gap` read from `getComputedStyle(grid).columnGap` (it differs between breakpoints — don't hardcode).
- Target span = `round((pointerX - blockLeft + gap) / (colW + gap))`, clamped 1–12, then **snapped to [4, 6, 8, 12]**. Arbitrary spans produce ragged rows and unreadable narrow charts. Snap in the **gesture only** — the schema accepts 1..12 deliberately (entry 2), and `block-width-picker.tsx` already shows a non-canonical stored span as its own segment rather than rewriting it.
- Apply the span live via CSS while dragging; **re-render the chart only on drop** — chart height is width-dependent and re-rendering per pointermove is wasteful.
- Floating badge at the cursor showing `1/2 · 6/12`.
- Keyboard equivalent: **Shift + ←/→** steps through the allowed widths, announced through the live region from entry 16.
- Below 760px the handle is hidden: width is a desktop hint and blocks widen per tier anyway (`layout.ts:80-92`). Say so in the panel so it doesn't read as a bug.

**Acceptance:** resizing to the same width does not mark the report dirty (the derived dirty flag of entry 8 gives this for free); the chart re-renders at most once per gesture.

### 18. `feat(reports): template picker for adding blocks`
**Status:** ADJUST EXISTING — `src/react/block-template-picker.tsx`, `src/server/block-templates.ts`, `src/react/report-editor-canvas.tsx:121-141`
**Depends on:** side panel

Shipped, and better sourced than the plan asks: the groups come from the **server** (`server/block-templates.ts`), where every template's spec is compile-validated against the live catalog, so a template that stopped compiling fails the package's own suite before it reaches the modal. Selection returns the whole template rather than an id, so the caller cannot re-look-up a different one. "Bloco em branco" is still in the picker for people who know exactly what they want. The add affordance is a full-row dashed strip closing the canvas (`AddBlockRow`) — a whole row, never a block-sized cell, because it is the seam where the next block lands.

**Scope (reconciled).** Two small pieces of the plan's sentence are unimplemented. Selecting a template appends the block (`addBlock`, `report-editor-canvas.tsx:139`) but does **not** then **select it and scroll it into view** — on a canvas already a screen tall, the new block lands below the fold with no indication anything happened. Add both, and move focus to the new block so the keyboard path matches.

`inventory.md` §1 also has the picker's rows as `Button`s where the prototype uses cards; card-ifying them is the "extend existing" it describes.

---

## Phase 4 — Charts

### 19. `fix(reports): chart axis rendering`
**Status:** ADJUST EXISTING — `src/render.ts:104-134` (fixed); `packages/ui/src/components/data-display/Chart/chart-renderers.tsx` (remaining)
**Depends on:** —

Two of the four defects are fixed, in `src/render.ts`, with the plan's own reasoning quoted in the source:

1. **Axis title over the tick labels — fixed.** `toChartSpec` emits `xAxis: { key }` with no label at all (`render.ts:117-120`): *"NO axis title (FUT-391). It rendered ON TOP of the tick labels, and the block's spec sentence already says what the axis is."* This is why `ReportRenderModel` carries `tableColumns` separately (`render.ts:33-38`) — with no axis title, a derivation would fall back to the raw alias and a column would read `createdAt_day`.
4. **Smooth curves inventing data — fixed.** `curved: false`, always (`render.ts:131`): *"A smoothed line between two points draws a curve through values nobody measured."*

**Scope (reconciled).** The two that remain are both in **`@12-apps/ui`, not this package** — which changes who is affected:

- **Overlapping category labels** (2). `chart-renderers.tsx` sets no `interval` and no tick formatter on the X axis, so Recharts draws every category. Skip every *n*th tick, always keep the last, truncate at ~12 chars with an ellipsis.
- **Fractional ticks rounded to duplicates** (3) — `3, 2, 2, 1, 0`. There is no `allowDecimals` anywhere in the Chart component, and an integer *formatter* over fractional ticks is exactly what produces the duplicates. Force integer steps when the series format is `integer`/count; the format already reaches the spec (`numberFormat`), so the information is there.

`packages/ui` is a **published design system**: this is a cross-package change that lands in every consumer's charts, not just reports. It wants its own commit against `packages/ui`, with the report-builder side unchanged.

**Acceptance:** no overlapping text at 360px, 768px and 1440px on every viz type.

### 20. `feat(reports): per-block loading, empty and error states`
**Status:** ADJUST EXISTING — `src/react/report-render.tsx:155-165`, `src/react/report-editor-block.tsx`, `src/react/lib/widen-range.ts`
**Depends on:** batch run endpoint

All three states exist per block, and the empty state is the best of them: "Sem dados no período" with a **widen-range action** (`lib/widen-range.ts`), because an empty block is ambiguous — "nothing happened" versus "you are looking at too small a window" — and the common cause is a store checking "Hoje" before lunch. At the widest range it offers nothing, since an offer that cannot be taken is worse than no offer. A KPI over an empty period renders the tile with "—" rather than an EmptyState, so the metric's absence still says which metric.

**Scope (reconciled).** Two refinements:

- **Skeletons instead of a spinner.** `LoadingState` (a spinner) is used in five places where the prototype shows layout-shaped skeletons. `inventory.md` §3.4 points at `layout/Skeleton` and `data-display/AsyncStateContainer`, the latter collapsing the loading/error/empty triad this package currently spells out by hand at each call site.
- **A typed error card with the reason and a retry.** Errors currently render as a bare `Alert` (`report-editor-block.tsx:14`) with no retry affordance, so a failed block is a dead end. Pair this with entry 4's typed `RESULT_TOO_LARGE`, which is the error most worth wording well — "use um filtro ou top N" is actionable where "erro" is not.

---

## Phase 5 — Reports list

### 21. `feat(reports): replace report select with a card list`
**Status:** ADJUST EXISTING — `src/react/report-card-list.tsx`, `src/react/report-list-filters.ts`
**Depends on:** —

Shipped. Cards with description, last-edited date and a shape note ("Painel · 3 coleções" — what the name alone never said), accent- and case-insensitive search because the names are Portuguese, and "Mostrar arquivados" promoted from a floating checkbox to a scope. The empty state is an invitation with a "Criar relatório" action rather than a blank grid.

**Scope (reconciled).** Three deltas:

- **The `Meus` scope is missing** and cannot be added here. `report-list-filters.ts:10-12` says why: `SavedReportSummary` carries no owner, so a "mine" scope would have to guess. **This is a server change first** — add an owner to the wire type, then the third pill. Scopes today are `Todos` / `Arquivados`.
- **Status renders as a bare string** — `statusNote()` returns `"Arquivado"` / `"Rascunho"` as text (`report-card-list.tsx:33-37`). `inventory.md` §1 is blunt about this one: the prototype is right and we are wrong. Swap for `data-display/Chip`.
- **The grid is hand-laid `Stack`s.** Adopt `layout/CardGrid`, and `layout/ContentToolbar` for the search + pills row — `inventory.md` §3.5 calls these "exactly the components that make a screen look native to the app rather than adjacent to it".

### 22. `feat(reports): new report goes straight to the editor with the picker open`
**Status:** ADJUST EXISTING — `src/react/reports-page.tsx:163`, `src/react/report-card-list.tsx:143`, `src/react/report-editor-canvas.tsx:95`
**Depends on:** template picker, card list

Creating goes straight to the editor: `onCreate` navigates to `/:tenantSlug/reports/new` from **two** entry points — the "Novo relatório" toolbar button (`report-card-list.tsx:143`) and the empty-state action (`reports-page.tsx:186`).

**Scope (reconciled).** The headline behaviour is the missing part, and one premise should be dropped:

- **The picker does not auto-open.** `picking` starts `false` (`report-editor-canvas.tsx:95`), so a new report opens on an empty canvas showing the dashed add-strip, and the author must click it. Open the picker automatically when the canvas mounts with zero blocks — that is the whole point of the entry.
- **Do not create a draft named "Relatório sem título".** Nothing is persisted until save: the editor holds a local draft, and the save path refuses a blank name ("Dê um nome ao relatório antes de salvar", `report-editor.tsx:60-61`). That solves the `fvgcfgf`-reaching-production problem *more* completely than a pre-created draft, and pre-creating one would put a junk row in the database for every abandoned click. Drafts are additionally invisible to others through `status`/`visibility` (`src/server/visibility.ts`).
- **The third entry point** — a dashed card at the end of the report grid — does not exist. Add it or drop it deliberately; the dashed-card pattern is already established on the editor canvas (`AddBlockRow`).

---

## Phase 6 — Accessibility and mobile

### 23. `feat(reports): make charts accessible`
**Status:** ADJUST EXISTING — `src/react/chart-as-table.ts`, `src/react/report-render.tsx:98-131`; remainder in `packages/ui`
**Depends on:** chart rendering fixes

**The real fallback shipped.** "Ver como tabela" is a per-block toggle in both view and edit mode (`report-render.tsx:100-109`, `aria-pressed`), rendering the same query as a `Table`. The columns come from `chart-as-table.ts`, which all three consumers share — the toggle, the CSV export, and the accessible fallback — so a column can never appear on screen that is missing from the download. Its header makes the plan's own argument: an `aria-label` summarising a twelve-point series is a sentence nobody can hold in their head, while the same numbers as a table are navigable cell by cell. `compact` axis formatting deliberately becomes a decimal column, because a table exists to be read precisely.

**Scope (reconciled).** Everything else is in `@12-apps/ui` and, like entry 19, is a cross-package change:

- `role="img"` + `aria-label` carrying the series as text — `SpecChart.tsx` sets neither.
- `<title>` inside each bar/point/slice: native tooltip for mouse users and per-element info for AT, in one change.
- The legend must carry the category name next to the swatch, never colour alone (`ChartLegendContent`, `chart-renderers.tsx:70`).
- Axis label contrast ≥4.5:1 — the current grey is around 3:1. Chart text is text.

### 24. `feat(reports): focus management and live regions`
**Status:** ADJUST EXISTING — `src/react/block-editor-panel.tsx:57-79`, `src/react/block-template-picker.tsx`
**Depends on:** side panel, template picker

Focus management shipped for both surfaces the entry names. The panel takes `restoreFocusTo` and focuses it on close, with the reason recorded — without it, focus falls to the document and a keyboard user closing the panel restarts from the top of the page. The template picker manages focus on open via its own ref/effect, and both close on Escape through `Modal`/`Drawer`.

**Scope (reconciled).** The live-region half is what is missing, and it is shared with entries 16 and 26:

- **One `aria-live="polite"` region** (`.sr` + `#live`), which every announcement writes to. The only `role="status"` today is the dirty indicator. Build it in entry 16 and consume it here.
- **Mirror every toast into it, including undo** — which means this entry now depends on entry 26, since no toast exists yet.
- **⌘Z for undo.** A 6-second toast is not a reachable target for switch access. The keydown plumbing from `use-unsaved-changes.ts` is the pattern to copy.

### 25. `feat(reports): responsive editor down to 360px`
**Status:** ADJUST EXISTING — `src/react/block-editor-panel.tsx:31-42`, `src/react/report-grid.tsx:70-73`, `src/layout.ts:80-92`
**Depends on:** side panel

Two of the six items shipped. The config panel becomes a **78vh bottom sheet** below 760px, deliberately leaving the canvas peeking above it so the edit keeps context. Block widths already **widen per tier** (`report-grid.tsx:70-73` → `responsiveSpan`), and the stored `w` persists for desktop.

**Scope (reconciled).** Note one deviation before you "fix" it: `responsiveSpan` does **not** make every block full width on a phone — a span ≤3 becomes 6 (half) and only 4+ becomes 12 (`layout.ts:83-87`). That keeps a KPI strip reading as a strip rather than as four stacked full-width tiles, which is better than the plan's blanket rule. Keep it.

What remains:

- The sheet has no **grip** — adopting `data-display/Sheet` (entry 9's residual) brings one.
- **Hover-only affordances must become permanently visible,** and touch targets ≥40px. The grip, ✎ and 🗑 in `report-editor-block.tsx` are the ones that matter.
- **Tables scroll horizontally with a sticky first column** — `inventory.md` §2 maps this to `layout/ScrollArea`; it now applies to the "Ver como tabela" output too (entry 23), not just to table blocks.
- **Two sticky bars eat 112px of a 640px viewport.** Collapse the toolbar into the header on scroll, or make period a single button opening a sheet.
- **Tap-to-pin chart tooltips** with a visible dismiss (hover doesn't exist on touch), or print values as labels when ≤6 points.

### 26. `feat(reports): replace destructive dialog with undo toast`
**Status:** BUILD NEW — the dialog is `src/react/lib/confirm-dialog.tsx`
**Depends on:** —

Nothing here has shifted: removing a block still opens `ConfirmDialog` (`report-editor-block.tsx:153,194-205`), and there is **no toast anywhere in the package** — `inventory.md` §1 confirms it.

Removing a block is cheap and reversible. Remove immediately, offer Desfazer for ~6s, restore at the original index. Drops a modal, a focus trap and two uppercase MUI buttons that match nothing else in the product.

Three notes the plan could not have had:

- `removeBlock` (`report-model.ts`) drops the block; **restoring at its original index needs a model helper**, since re-appending puts it in the wrong grid slot. Add it alongside, and test it the way `reorderBlock` is tested.
- Reach for `feedback/Toast` / `feedback/Sonner`, but **confirm the action-slot + `aria-live` path first** (`inventory.md` §1) — the toast has to carry a "Desfazer" button, and entry 24 needs it mirrored into the live region.
- `ConfirmDialog` stays for **archiving** (`report-view.tsx:166-174`), which is a different act: archiving is already reversible by design and its dialog explains where the report went. Only the block-removal path becomes a toast. While there, check whether the 45-line local wrapper can become `feedback/ConfirmAction` (`inventory.md` §3.2) rather than gaining a second confirm path.

---

## Phase 7 — Sharing

### 27. `feat(reports): period in the URL and shareable links`
**Status:** BUILD NEW
**Depends on:** batch run endpoint

The period is component state — `useState<ReportRange>("30d")` in both `reports-page.tsx:129` and `report-editor.tsx:207` — and `useSearchParams` appears nowhere in the package. A link therefore reproduces the report but not the period the sender was looking at.

`?period=last_30d&compare=previous_period`. `defaults.period` is only the starting point — a shared link must reproduce exactly what the sender saw.

Two constraints to design around:

- **`compare` does not exist yet** (entry 4). Either land that first or ship `period` alone.
- **Standalone mounting uses a `MemoryRouter`** (`create-report-builder.tsx:115`), which has no address bar. Hosts that mount the surface under their own router — future-pay does — get real URLs; the standalone path will not. Make the period read/write go through the router so both paths stay correct, and accept that standalone loses the sharing half.

### 28. `feat(reports): scheduled email delivery`
**Status:** BUILD NEW
**Depends on:** export, permissions

Weekly/monthly PDF of the previous period to everyone with view access. Rendered under **each recipient's** permission scope, not the author's.

**Read `src/react/lib/print-export.tsx` before scoping this.** Export today is `window.print()` over a scoped print region — a recorded spike verdict (FUT-310), not an oversight: server-side chart rasterization would need either a headless browser in the *production* runtime (Chromium ships for tests only) or a second, canvas-based chart implementation kept in sync with `SpecChart`. Both were judged out of proportion for v1.

A **scheduled** PDF has no browser to print from, so it re-opens exactly the question that spike closed. This entry's real cost is that decision, not the scheduling. Price it before committing to the feature; per-recipient rendering multiplies it by the recipient count.

The visibility model it needs already exists (`src/server/visibility.ts`: `tenant` / `roles` / `private`, with the lifecycle states beside it).

---

## Suggested order

The plan's original order — Phase 0 → 2 → 4 → 1 → 3 → 5 → 6 → 7 — assumed Phase 0 was the blocker. It is now the most complete phase, so the order below is what is actually left, in dependency order.

1. **Catalog `requires` (entry 1)** — the only Phase 0 item with real risk attached, and it needs a decision on how per-field permissions compose with the FUT-454 sample floors.
2. **The live region (entry 16's first half)** — one small component that entries 16, 24 and 26 all need. Build it once, first.
3. **Keyboard reordering (entry 16)** — with no up/down buttons on the canvas, reordering is drag-only and this is a live WCAG 2.1.1 failure. It is the highest-priority item in the document and the plan ranked its phase last.
4. **Undo toast (entry 26)** — unblocks entry 24's live-region mirroring and removes the most out-of-place UI in the surface.
5. **Chart axis + chart a11y in `packages/ui` (entries 19, 23)** — one cross-package commit each, independent of everything above, and they improve every consumer.
6. **Settings drawer (entry 7)** and **auto-open picker (entry 22)** — small, visible, self-contained.
7. **`in`/`between` in the filter draft (entry 11)** and **measure type tags (entry 10)** — the remaining Phase 2 deltas.
8. **Per-block skeletons + typed error card (entry 20)**, paired with **`RESULT_TOO_LARGE` (entry 4)** so the error has something worth saying.
9. **Card-list polish (entry 21)** — the `Meus` scope needs a wire change first; the `Chip`/`CardGrid` swaps do not.
10. **`compare` (entry 4)**, then **period in the URL (entry 27)**, which is more useful once there is something to compare.
11. **`dayStartsAt` + partial-bucket marking (entry 5)**.
12. **Drag-to-resize (entry 17)** — genuinely last. The width picker already covers the need; this makes it nicer.
13. **Scheduled email (entry 28)** — gated on re-opening the FUT-310 rasterization verdict.

Entry 2 is closed and entries 3, 6, 9, 12, 13 and 15 need only a test written against them.
