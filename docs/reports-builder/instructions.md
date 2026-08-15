# Reports builder — instructions

Everything for the report builder redesign. **Read this file first; then read only
what the current task needs.** Reading all of it at once spends context you'll want
for the code.

This file replaces the earlier `README.md` — there is one routing document, not two.

---

## The files

| File | What it is | Read it when |
|---|---|---|
| `instructions.md` | This file — routing and working rules | First, always |
| `plan.md` | The work as ~28 conventional commits, each with `Depends on` and acceptance criteria | Picking up a ticket. Read your entry and its dependencies only |
| `prototype.html` | A working single-file prototype of the target UX | Implementing anything with UI. It is a **specification**, not source — see `porting.md` |
| `specs/*.feature` | Gherkin: positions, hover, panel docking, click-outside, drag, overlays | Before and after any UI commit. These are the acceptance criteria `plan.md` states in prose |
| `visual-pass.md` | Measurable rules for why the screens look unfinished, and six commits to fix it | Any commit that changes appearance. Independent of `plan.md` |
| `porting.md` | Fidelity contract, component inventory template, design tokens | Before writing any component |
| `notes.md` | Rationale for mobile, accessibility and data-model decisions | When a decision looks arbitrary, or an entry says "see notes" |
| `handoff-method.md` | How to drive an agent through this: prompts, scoping, failure modes | **For the human, not the agent** |

### Files this bundle expects to exist in the repo

| File | Where it comes from |
|---|---|
| `inventory.md` | Produced by the inventory prompt in `porting.md` §5, then committed. Every UI commit depends on it |
| `decisions/*.md` | ADRs. `0001-drag-implementation.md` settles `@dnd-kit` vs the local implementation |
| `orientation.md` | Output of Prompt 1 (`handoff-method.md`), run at `316c22f` — before the FUT-391 redesign landed. **Stale**: four of its Phase 0 verdicts have since flipped, so `plan.md`'s status lines supersede it on what exists. Still good on what *not* to do (§2.1–2.7), and cited from the plan entries for exactly that |

---

## Precedence

When two documents disagree, later in this list wins:

1. `plan.md` prose
2. `notes.md`
3. `porting.md`
4. `specs/*.feature`
5. **The source.** Every document here was written from screenshots and is provably
   stale in places — a reconciliation pass found six entries already implemented and
   one that would have caused a regression. Verify before building.

Status lines inside `plan.md` are a snapshot at a given commit and rot the same way.
Prefer a passing test over a status line.

### By subject

The list above settles document-versus-document. These settle it by what you are
actually asking, and they are the rules the ADR in `decisions/` relies on:

- On **what exists today**, `plan.md`'s `Status:` lines win — they were read from the
  current tree. `orientation.md` held this role before the FUT-391 redesign; where the
  two disagree, `plan.md` is right and `orientation.md` is the older reading. Above
  both, the source.
- On **a decision already taken**, `decisions/` wins over everything, including
  `porting.md` and `plan.md`. That is what the folder is for.
- On **intended behaviour**, `specs/*.feature` win wherever they cover it — they are the
  acceptance criteria — then `prototype.html`, then `plan.md`.
- On **which component to use**, `inventory.md` wins; it checked every subpath against
  `packages/ui`'s `exports` map. Then `porting.md` §3: use the design system, not the
  prototype's CSS.
- On **how it should look**, `visual-pass.md` wins. Nothing else in the set has an
  acceptance criterion a screen can fail on appearance alone.

## Where the code is

- Engine, spec, compiler: `packages/report-builder/src/`
- Host-mounted backend surface: `packages/report-builder/src/server/`
- UI: `packages/report-builder/src/react/`
- Design system: `packages/ui/src/components/`

The origin host's `apps/admin/src/pages/reports/index.tsx` is a thin wrapper — it resolves
the tenant and mounts `@12-apps/report-builder/react`. The reports surface is built here,
not there.

---

## Working rules

1. **One commit per session.** Entries in `plan.md` are sized for this. Never "implement Phase 2".
2. **Plan before code.** Report which files you'll touch and what test you'll write for the acceptance criterion. Wait for approval.
3. **The prototype is behaviour, not code.** Don't port its JS or CSS. Match interaction, information architecture and copy exactly; use the app's design system for visuals.
4. **Acceptance criteria are tests.** Each commit lands with a test that fails without the change.
5. **Scope is explicit.** Notice an unrelated bug, report it — don't fix it here.
6. **Verify before building.** If the plan says build something that already exists, say so and adjust the scope rather than building a second one.

---

## The one thing that keeps being got wrong

**The block configuration panel is docked and non-modal.** Not a popover, not a
dialog, not a temporary drawer.

The screens this replaces used a popover anchored to the block, which covered the
thing being configured. A modal drawer repeats that mistake with different geometry:
a backdrop means every adjustment costs an extra click and the preview can't be
inspected while it changes.

Required behaviour — `specs/editor-config-panel.feature`, tagged `@regression`:

- no backdrop, nothing inert, no focus trap, no scroll lock
- opening it **narrows the canvas**; no block sits underneath it
- clicking the middle of the screen hits whatever is there
- clicking another block retargets the panel instead of closing it
- clicking empty canvas deselects, and the panel stays visible in its empty state

The settings drawer **is** modal, deliberately. The last scenario in that file
asserts the difference so the two don't collapse into one component.

---

## Suggested order

1. Run the inventory prompt (`porting.md` §5) → commit `inventory.md`.
2. Reconcile `plan.md` against the source; mark each entry ALREADY DONE / ADJUST / BUILD NEW / NO LONGER APPLIES.
3. Convert the ALREADY DONE entries into passing tests. A green test is a status that can't go stale.
4. Run the visual audit (`visual-pass.md` §"How to check"). The PASS/FAIL list is the real backlog.
5. Fix the live accessibility defect: canvas reordering is drag-only, so there is no keyboard path. `specs/editor-direct-manipulation.feature` has the scenarios; the ADR has the approach.
6. Then the visual commits, then the remaining functional ones.

Steps 1–4 produce no product change and are the highest-value work in the list,
because everything after them is otherwise guesswork.
