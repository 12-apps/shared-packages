# Behavioural specs

Gherkin for the report builder. These describe **where things sit, what they do on
hover, and what happens when you click somewhere else** — the layer that `plan.md`
(what to build) and `visual-pass.md` (how it should look) both leave implicit.

| File | Covers |
|---|---|
| `editor-config-panel.feature` | Panel docking, non-modal behaviour, click-outside, Escape, scrolling, responsive sheet |
| `editor-canvas.feature` | Block anatomy, hover reveals, selection, loading/empty/error states, add and remove |
| `editor-direct-manipulation.feature` | Drag reorder and drag resize, with keyboard and touch equivalents |
| `editor-overlays.feature` | Template picker, settings drawer, toasts, stacking order |
| `reports-list-and-view.feature` | List screen, card hover, filters, empty states; viewer and export |

## The load-bearing distinction

`editor-config-panel.feature` exists because of one recurring defect: **the block
configuration surface keeps being built as a modal.**

The original screens used a popover anchored to the block, which covered the thing
being configured. Rebuilding it as a temporary drawer with a backdrop repeats that
mistake with different geometry — every adjustment costs an extra click to reach the
canvas, and the preview cannot be inspected while it is being changed.

The panel is **docked and non-modal**:

- no backdrop, nothing inert, no focus trap, no scroll lock
- the canvas keeps its full width minus the panel — nothing is hidden underneath it
- clicking the middle of the screen works: it hits whatever is there
- clicking another block retargets the panel rather than closing it
- clicking empty canvas deselects and leaves the panel showing its empty state

The settings drawer, by contrast, **is** modal — and `editor-config-panel.feature`
ends with a scenario asserting the difference on purpose, so an implementer reading
either one can't collapse them into the same component.

Tag `@regression` marks the scenarios that catch this class of mistake specifically.

## Using these

They are written to be executable, but they earn their keep as review criteria even
if you never wire up Cucumber. Two ways to run them:

**As a checklist.** Point an agent at one file and one tag:

```
Read docs/reports-builder/specs/editor-config-panel.feature.
For every scenario tagged @desktop, exercise it against our implementation
and report PASS or FAIL with what you observed. Fix nothing yet.
```

**As tests.** Playwright with `playwright-bdd` maps the steps directly; the
positional assertions (`flush with the right edge`, `344 px wide`, `no backdrop`)
are all `boundingBox()` and presence checks.

Either way, the `@regression` tags should end up in CI. The modal/non-modal
confusion has recurred once already; a passing assertion is the only thing that
stops it recurring again.

## Numbers in these files

Pixel values come from `prototype.html` and are intent, not gospel — 344 px of panel
matters because the panel must be wide enough for two side-by-side selects without
truncating their labels, which is the defect it replaces. If your design system lands
on 360, change the number here and say why. What must not change: the docking, the
absence of a backdrop, and the click-through behaviour.
