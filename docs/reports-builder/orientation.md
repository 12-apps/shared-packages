# Orientation — the plan mapped onto this repo

Output of **Prompt 1** (`handoff-method.md`) and the **inventory prompt** (`porting.md` §5), run against
`packages/report-builder` at `316c22f`. No files were changed to produce this.

`plan.md` and `notes.md` were written from screenshots of the running app, not from the source. This
document is the correction layer. **Where this file and `plan.md` disagree about what exists today,
this file wins** — it cites code. Where they disagree about what *should* exist, `plan.md` and the
prototype still win.

The headline: **most of Phase 0 is already built.** The catalog, per-block error isolation, timezone
bucketing, `sort`, `limit`, stable block ids and the disabled-viz reason matrix all exist. What is
genuinely missing is narrower and different from what the plan describes.

---

## 1. Phase 0, commit by commit

| Plan commit | Already exists? | Where | What's actually left |
|---|---|---|---|
| `feat(reports): add server-owned field catalog` | **Partially** | `src/types.ts:104-165` (`FieldDef`/`EntityDef`/`FieldCatalog`), `src/server/catalog.ts` (363 loc), `defineCatalog` in `src/catalog.ts`, exported as `reportCatalog` from `src/server/index.ts:10` | Add `values[]` (enum→pt-BR labels), `ops[]` (legal operators per field), `requires` (permission). No `enum` FieldType exists — see §2.1 |
| `feat(reports): ReportSpec v2 with stable block ids` | **Mostly** | `src/spec.ts:143-176` (`dashboardBlockSchema`: `id` regex-validated + uniqueness via `superRefine`), `sort`/`limit` at `:114-118`, `dimensions` max 2 at `:111` | Only `layout.order` and `title: null` semantics are new. Ids, sort, limit and splitBy already exist — see §2.2 |
| `feat(reports): describe(block) spec sentence` | **No — genuinely missing** | — (`describeSpecIssues` at `src/spec.ts:215` is a Zod error formatter, unrelated despite the name) | All of it. Highest-leverage item in the plan and the claim survives contact with the source |
| `feat(reports): batch run endpoint with per-block isolation` | **Yes** | `runDashboard`, `src/run.ts:107-125` — one bad block returns `status:'error'` so the others render; infra failures still reject the whole run | `compare` (previous period), `permissionScope` in the cache key, typed `RESULT_TOO_LARGE` |
| `fix(reports): bucket dates in store timezone` | **Timezone yes, rest no** | `ReportSpec.timeZone` `src/spec.ts:110`, `CompiledQuery.timeZone` `src/types.ts:223-229`, `src/time.ts`, tests `__tests__/timezone.test.ts` + `server/__tests__/local-time.test.ts` | `dayStartsAt`, partial trailing bucket. Timezone bucketing landed with FUT-454 |

**Net:** of five Phase 0 commits, one (`describe()`) is untouched, one (batch run) is done bar three
additions, and three are amendments to existing code rather than new subsystems.

---

## 2. Where the plan is wrong about this codebase

### 2.1 The catalog exists, and its `format` is better than the plan's

`FieldDef` (`src/types.ts:104-151`) already carries `label`, `type`, `role`, `aggregations`,
`format`, `description`. The plan proposes `format?: { currency?: 'BRL'; decimals?; unit? }`.
This repo has `ReportValueFormat = 'brl' | 'integer' | 'decimal' | 'text' | 'duration' | 'percent'`
(`src/types.ts:72`), already threaded through compile, render, KPI tiles and CSV export.
**Keep the existing union; don't introduce the plan's shape.**

Three fields are genuinely absent: `values[]`, `ops[]`, `requires`.

The blocker for `values[]` is that **there is no `enum` field type.** `FieldType` is
`'string' | 'number' | 'money' | 'date' | 'boolean'` (`src/types.ts:13`). Status lives as a `string`,
which is exactly why filters take a hand-typed `PAID`. Adding `values[]` means either adding an
`enum` type or letting any `string` field carry an optional value list — the second is less
disruptive and probably right.

`FieldDef` also carries `minGroupSample` / `identityMinSample` (`:130`, `:150`) — the FUT-454
privacy floors, with a long rationale in the source. The plan does not mention them. **Any catalog
change must preserve them**, and `requires` is adjacent to but not a replacement for them.

### 2.2 Stable block ids, `sort`, `limit` and `splitBy` all already exist

The plan lists all four as new. They aren't:

- **Block ids** — `dashboardBlockSchema.id` (`src/spec.ts:143-150`), regex-constrained, with
  duplicate detection in a `superRefine` (`:165-176`). The plan's "ULID, not array index" is already
  the design.
- **`sort`** — `src/spec.ts:114-117`, up to 3 keys.
- **`limit`** — `src/spec.ts:118`, 1..10 000, and `CompiledQuery.limit` is required (`types.ts:223`).
  What's missing is only the **"Outros" remainder bucket**, not the limit itself.
- **`splitBy`** — exists as the second entry of `dimensions` (`max(2)`, `src/spec.ts:111`). The plan
  treats it as a missing model field; it's a missing **label**. That reframes the Phase 2 commit from
  a schema change to a UI change, which is much cheaper.

Two shapes, not one: `reportSpecSchema` (a single report) and `dashboardSpecSchema`
(`{kind:'dashboard', blocks[]}`), discriminated on `kind` and stored in the same `SavedReport.spec`
column. The plan's `ReportSpec { blocks[] }` collapses these. **Don't** — the single-report path is
what presets, MCP authoring and the built-in viewer all use.

### 2.3 `layout.w: 4 | 6 | 8 | 12` would be a regression

The plan wants widths restricted to four values, snapped. The schema accepts the full 1..12 range,
and `src/spec.ts:136-142` says why, deliberately:

> readability floors are a per-presentation authoring rule (`minSpanForPresentation`), enforced where
> the author picks the width — not a storage constraint that would make a legitimate narrow KPI strip
> unsavable.

Snapping to `[4,6,8,12]` in the **resize gesture** (prototype §2) is fine and is a UI concern. Baking
it into the **stored schema** would break saved KPI strips. Keep the storage range; snap in the
handle.

### 2.4 `in` and `between` are not missing

Plan: "add `in`, `between`, `contains` — currently unexpressible." Spec-level operators are
`['eq','neq','in','gte','lte','between']` (`src/spec.ts:32`), with arity validation at `:39-46`, and
the compiled IR matches (`src/types.ts:167`). **Only `contains` is missing.** The real gap is that the
*UI* doesn't expose the operators the model already accepts.

### 2.5 The disabled-viz reason matrix already exists — and disagrees with the plan

`src/compatibility.ts` already implements the plan's Phase 2 viz-picker commit at the data layer:
`presentationCompatibility(shape)` returns every option with a pt-BR `disabledReason | null`, and
`defaultPresentation(shape)` is the auto-correct the plan asks for. That commit is **UI-only work over
a tested matrix.**

But the plan's rule table proposes rules that aren't implemented and would need compiler changes:

| Plan rule | Status today |
|---|---|
| KPI blocked when `groupBy != null` | **Implemented** (`compatibility.ts`, `dimensionCount !== 0`) |
| Pizza/Rosca blocked at >8 categories | **Not implemented** — only `measureCount !== 1` is checked |
| Linha blocked on a non-date field | **Not implemented** — line/area on a categorical dimension is currently legal |

The file header states a test proves this matrix and the compiler's `assertChartShape` agree, and that
changing one forces the other. So adding those two rules is a **compiler + matrix + test** change, not
a picker tweak. Worth deciding deliberately: blocking "Linha" on categorical data removes a chart
people may be using.

### 2.6 Drag-to-reorder already exists, and `@dnd-kit` is a new dependency

`src/react/lib/drag-reorder.ts` (FUT-311) implements handle-only HTML5 drag reordering with a typed
payload so foreign drags can't trigger it. Its header noted keyboard and touch users **already have
up/down buttons** — so the plan's "drag-only reordering is a WCAG 2.1.1 failure" was read as already
mitigated, and Phase 3's urgency was lowered accordingly.

> **That was wrong, and this paragraph is why the gap survived (FUT-755).** There were no up/down
> buttons anywhere in `src/react` — `report-editor-block.tsx` rendered grip, title, ✎ and 🗑, and
> nothing else. The claim came from the source file's own header, which this section quoted rather
> than checked, so a live WCAG 2.1.1 failure read as mitigated in the one document written to map the
> plan onto the real code. The header is corrected, and Alt+↑/↓ with a live region now exists
> (`useKeyboardReorder`), so the mitigation is real rather than asserted. Kept here as written history:
> a quoted claim is not a verified one, which is precisely what `instructions.md`'s precedence rule 5
> is about.

`porting.md` §2 prescribes `@dnd-kit/sortable`. It is **not** a dependency today — the package ships
with `@12-apps/stock-domain`, `@12-apps/ui` and `zod` only. Adding it puts a new runtime dependency
into a published npm package that future-pay consumes. That's a decision to take explicitly, not a
detail to absorb inside a feature commit.

### 2.7 The flagship example commit is largely already done

`plan.md`'s worked example is *"drive measure and aggregation pickers from the catalog"*, acceptance
*"`Soma de Status` is not expressible through the UI."* In `src/react/builder-measures.ts`:

- `aggregationOptions(field)` (`:56-61`) returns the catalog's `field.aggregations`, and for a
  `role === 'dimension'` field returns **only** `["count", "count_distinct"]`. `sum` over Status is
  already unofferable.
- `changeMeasureAggregation` (`:102-107`) already re-validates on field change and falls back to the
  first legal aggregation — the plan's second bullet, implemented.

**The acceptance criterion probably already passes.** Per Rule 4, the right move is to write the test
first and watch it pass, then close the commit as already-satisfied — not to write code.

The plan's remaining bullet, *"Measures list = `role === 'measure'` only. Today it lists dimensions"*,
would be a **regression**: offering `count`/`count_distinct` over a dimension is how you express
"quantidade de pedidos por status", a legitimate and common report. The defect in the screenshot was
`Soma de Status`, and that specific defect is already fixed.

---

## 3. Component inventory (`porting.md` §3)

Against `packages/ui`. Imports are subpath-style, as the report-builder already does
(`@12-apps/ui/form/Select`).

| Prototype | Existing component | Decision |
|---|---|---|
| `.btn` / `.btn.primary` / `.btn.sm` | `form/Button` | **use as-is** |
| `.chip` (Publicado / Rascunho / Arquivado) | `data-display/Chip`, or `data-display/Badge` | **use as-is** |
| `.seg` (period segmented control) | `form/ToggleGroup` (`navigation/Tabs` if it should be routed) | **use as-is** |
| `.switch` (compare toggle) | `form/Switch` | **use as-is** |
| `.card` (report list card) | `layout/Card` + `layout/CardGrid` | **use as-is** |
| `.pill` (scope filter) | `form/ToggleGroup` | **use as-is** |
| `.block` (block shell + header + tools) | — (`react/report-editor-block.tsx` is today's) | **build new** — extend the existing block, don't start over |
| `.panel` (config side panel / bottom sheet) | `layout/Drawer` (desktop) + `data-display/Sheet` (mobile) | **use existing** — replaces `react/block-editor-popover.tsx` |
| `select` / `input` in the panel | `form/Select`, `form/Input`, `form/Label` | **use as-is** — `Label` fixes the unlabelled-select a11y defect |
| `.viz-grid` (viz type picker) | `form/ToggleGroup` as the substrate | **build new**, thin — data comes from `compatibility.ts` |
| `.width-picker` | `form/ToggleGroup` as the substrate | **build new**, thin — options from `layout.ts` `spanOptionsFor` |
| `.tpl` (template card in picker) | `layout/Card` | **extend existing** |
| `.modal` (block picker) | `feedback/Modal` (`feedback/StackedModal` if it opens over the drawer) | **use as-is** |
| `.drawer` (settings) | `layout/Drawer` | **use as-is** |
| `.toast` + undo | `feedback/Toast` / `feedback/Sonner` | **use existing** — confirm the action-button + `aria-live` path before relying on it |
| Charts | `data-display/Chart` + `SpecChart` (already consumed via ChartSpec) | **existing lib** |

All sixteen rows were confirmed against the prototype's own stylesheet — every one is a real element,
none is a leftover.

### 3.1 Elements the §3 table omits

`porting.md` §3 lists sixteen rows; the prototype defines ~90 classes. These carry real decisions and
need inventory rows of their own before the ports start:

| Prototype | Existing component | Decision |
|---|---|---|
| `.kpi` / `.kpi-value` / `.kpi-delta` | `data-display/StatCard` | **use as-is** — the compare delta is already a StatCard concern |
| `.empty` | `data-display/EmptyState` | **use as-is** |
| `.skel` | `layout/Skeleton` (or `AsyncStateContainer`) | **use as-is** — this is most of Phase 4's states commit |
| `.sentence` + `.mono` | `typography/Text` + a mono token | **extend** — the `describe()` output surface; the mono face is deliberate (`porting.md` §4) |
| `.search` | `form/Input` | **use as-is** |
| `.toolbar` / `.topbar` | `layout/ContentToolbar` | **use as-is** |
| `.card-menu` (`[data-menu]`) | `navigation/DropdownMenu` | **use as-is** |
| `.icon-btn` | `form/Button` icon variant / `form/HeaderButton` | **use as-is** |
| `.radio` | `form/RadioGroup` | **use as-is** |
| `.tag` (the `R$` / `#` type tags) | `data-display/Chip` small, or `Badge` | **use as-is** — Phase 2 wants these in measure option labels |
| `.warn` / `.note` / `.hint` | `data-display/Alert` / `Banner` | **use as-is** |
| `.tbl-scroll` | `layout/ScrollArea` | **use as-is** — the mobile sticky-column table (`notes.md` §1) |
| `.danger-zone` | `layout/Card` + `feedback/ConfirmAction` | **extend** |
| `.legend` | part of `data-display/Chart` | **existing lib** — legend must carry the category name (`notes.md` §2) |
| `.scrim`, `.sheet-grip` | owned by `feedback/Modal` / `data-display/Sheet` | **use as-is** — don't rebuild |
| sparkline on list cards | `data-display/Chart` | **use as-is**, small variant |
| `.drop-ind`, `.drag-ghost`, `.resize`, `.size-badge`, `.drag` | — | **build new** — the drag/resize affordances of `porting.md` §2 |
| `.sr` + `#live` | — | **build new**, tiny — the visually-hidden `aria-live` region every announcement writes to |
| `.unsaved` | — | **build new**, tiny — the dirty indicator |
| `.add-block` / `.add-line` | `layout/Card` dashed variant | **extend** |

**Correction to an earlier draft of this file:** `EmptyState`, `Skeleton` and `StatCard` were listed
as "in our design system, unused by the prototype." That was wrong — `.empty`, `.skel` and `.kpi` are
all in the prototype. They are omissions from `porting.md`'s table, not additions we'd be making.

Genuinely in our design system and unused by the prototype: `data-display/DataViews` / `DataGrid` /
`Table`, which is where the "ver como tabela" a11y fallback (`notes.md` §2) should land rather than a
hand-rolled `<table>`.

> Verified by rendering `prototype.html` in headless Chromium at 1440px and 390px. The list screen
> renders from static markup; the view and editor screens are built by `renderEdit()`/`renderView()`
> at runtime, so screenshotting them needs a real driver (Playwright), not a one-shot renderer. The
> table above is derived from the prototype's stylesheet and markup, which is the stronger source
> for a component mapping anyway.

---

## 4. Dependency-order flags

- **`describe()` should move to the front.** `plan.md` orders it third in Phase 0 and the suggested
  order runs Phase 0 → 2 → 4. Since the catalog, run isolation and timezone work are largely done,
  `describe()` is the only Phase 0 item with real content — and Phase 2's panel header and Phase 4's
  PDF caption both consume it. It is the true critical path.
- **Name it something other than `describe`.** `describeSpecIssues` already exists in `src/spec.ts`
  and means something entirely different. `specSentence(block, catalog)` or `describeBlock` avoids a
  confusing pair.
- **"visual viz picker" does not depend on "side panel".** Its data layer is already shipped
  (`compatibility.ts`); it can land against today's popover.
- **"width picker" conflicts with a deliberate decision.** `react/block-editor-popover.tsx:1-10`
  states the popover "deliberately does not own the block's title or width: those are inline on the
  canvas, where their effect is visible." The plan moves width into the panel. Both are defensible —
  but it's a reversal, so decide it out loud rather than letting a commit silently overturn it.
- **Phase 3 is a replacement, not a greenfield.** See §2.6. With keyboard reordering already present,
  Phase 3's accessibility justification is weaker than the plan assumes, which supports the plan's own
  instinct that it's "the least urgent."

---

## 5. Suggested revision to the order

Phase 0 is nearly done, so the plan's "Phase 0 unblocks everything" framing no longer holds. What's
left, in dependency order:

1. **`specSentence()`** — the only untouched Phase 0 item, and the one three later surfaces consume.
2. **Catalog `values[]` + `ops[]`** — unblocks typed filters, which is the largest *real* UI defect
   left (`PAID` typed by hand).
3. **Config popover → side panel / bottom sheet** — the biggest visible win, and the a11y fix for the
   unlabelled `St…` / `igu…` selects.
4. **Viz picker + width picker over the panel** — the matrix already exists.
5. **Chart axis pass** (Phase 4) — independent of all the above.
6. **Reports list as cards** (Phase 5) — independent.
7. **`dayStartsAt` + partial buckets** — the remainder of the time work.
8. **Catalog `requires` / field permissions** — needs a decision on how it composes with the existing
   FUT-454 sample floors.
9. **Phase 3 drag/resize** — last, and gated on the `@dnd-kit` dependency decision.
