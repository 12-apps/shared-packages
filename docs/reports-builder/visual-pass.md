# Visual pass

`plan.md` measures whether things exist and work. The original screenshots show things that exist and work and still look bad. That's a gap in the plan, not a disagreement with it — none of its 28 entries has an acceptance criterion that a screen could fail on appearance alone.

This file fixes that. Every rule below is **checkable by looking**, so an agent can fail itself. "Make it prettier" is not a task; "no chart may render overlapping text at 1440px" is.

Status here is not reconcilable from source. A file existing tells you nothing about whether its output looks right. These are verified by screenshot, at 1440px and 390px, against `prototype.html`.

---

## Why the current screens read as cheap

Ranked by how much each one costs, from the screenshots as shipped:

1. **Text collides.** The axis title "Data (dia)" renders on top of the tick labels; "Monster Absolut" overlaps "Baly Zero". Nothing signals unfinished software faster, and it's the cheapest to fix.
2. **No hierarchy.** Page title, card titles and body text are within a few px of each other. Everything is equally important, so nothing is.
3. **Default component identity.** Uppercase `CANCELAR`/`REMOVER` next to sentence-case buttons; floating-label outlined fields next to plain placeholder-only inputs. Two design languages in one screen reads as unfinished rather than as a choice.
4. **Charts are unstyled defaults.** Full-saturation bars, square corners, dashed gridlines at the same weight as data, a legend under a single-series chart, duplicated y-ticks (`3, 2, 2, 1, 0`), non-tabular numerals.
5. **Broken rhythm.** Form fields at ~580px, then a button row inline with a period toggle; card padding, grid gaps and section spacing all off different scales.
6. **Dead space.** Two blocks at 1/2 width, then a third at 1/2 leaving an empty half-screen. The eye reads that as a bug.
7. **No depth.** White cards on near-white background with 1px grey borders and dashed outlines everywhere. Nothing separates layers.

---

## The rules

Each is pass/fail by inspection. An agent that can screenshot can self-check every one.

### Type
- Exactly one type scale. Page title / section / card title / body / caption must be **visibly distinct** — no two adjacent levels within 2px.
- One weight per level. No bolding to create emphasis a level should provide.
- All numbers — KPI values, table cells, axis ticks — use **tabular figures**. Columns of digits must align.
- Machine-generated text (spec sentence, axis values) in the mono face; prose in the UI face.

### Colour
- One accent. If a screen has two competing saturated colours, one is wrong.
- Series colours separated by **luminance**, not only hue, and never the sole carrier of meaning — the category name goes in the legend next to the swatch.
- Body text ≥4.5:1 on its background. **Axis labels are text**; the current grey is around 3:1.
- Large fills (bars, areas) never at the accent's full saturation. Bars at full-strength accent dominate the page.

### Charts
- **No axis titles.** The block subtitle already says what the axis is. This is the collision fix.
- No overlapping text at any tested viewport. Skip every *n*th tick, always keep the last, truncate at ~12 chars.
- Integer ticks when the metric is a count. Never `3, 2, 2, 1, 0`.
- No legend on a single-series chart. It's noise.
- No smoothing. A curve through two points draws data that doesn't exist.
- Gridlines lighter than data — one step below the border colour, never dashed at the same weight as a line series.
- Bars: rounded 3px, capped max width (~38px), never touching the frame.

### Layout
- One spacing scale, 4px-based. Card padding, grid gap and section spacing are all multiples.
- No orphan row. If the last row of a grid is half empty, either the block grows or the layout is wrong.
- Controls in a row share a height. A 34px button next to a 40px select reads as broken.
- Sticky chrome ≤2 bars, ≤112px total at 640px viewport height.

### Components
- One button case across the product. Sentence case.
- One field style. Every input has a label — visible or `aria-label`, never neither.
- One border radius family: containers one value, controls one value, and only those two.
- Dashed borders only for a drop target or an add affordance. Nowhere else.

### Depth
- Cards separate from the canvas by background *and* border, not border alone.
- Shadows only on floating layers — menus, sheets, drag ghosts. Never on static cards.

---

## Commits

Small, independent, each screenshot-verified. None of these depends on the functional plan.

### `fix(reports): remove axis titles and fix tick collisions`
The single highest-impact change in this file. Covers rules 1 and 3 under Charts.
**Acceptance:** screenshots at 1440px and 390px of every viz type show zero overlapping text.

### `fix(reports): chart theme`
Bar radius and max width, fill opacity, gridline weight, single-series legend suppression, tabular numerals, label contrast.
**Acceptance:** a bar chart, line chart and donut side by side with the prototype; differences are only design-system substitutions.

### `feat(ui): report type scale and spacing tokens`
One scale each, applied across the report screens. Delete per-component `fontSize`/`padding` overrides as you go — those are the reason the rhythm drifted.
**Acceptance:** no hardcoded px font size or padding remains in `packages/report-builder/src/react`.

### `fix(reports): unify field and button styling`
One field style with a label on every control, one button case, one radius family. Removes the uppercase MUI dialog buttons.
**Acceptance:** no uppercase button label anywhere in the report screens; every input has an accessible name.

### `fix(reports): grid density and orphan rows`
Consistent gap, card padding on the scale, and a last row that fills.
**Acceptance:** no half-empty final row at 1440px with 3, 4 or 5 blocks.

### `chore(reports): visual regression screenshots`
Playwright captures of list, view and editor at 1440px and 390px, committed as baselines.
**Acceptance:** the suite fails when a padding value changes.

Do this last. It locks in the result — and it's what stops the next reconciliation from reporting "already done" about a screen nobody has looked at.

---

## How to check

```
Screenshot the reports list, viewer and editor at 1440px and 390px.
For each rule in visual-pass.md §"The rules", state PASS or FAIL with
the element that fails. Do not fix anything yet — produce the list.
```

Run that before the first commit and after the last. The delta is the deliverable.
