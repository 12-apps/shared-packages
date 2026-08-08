# Report builder — the spec set

The design and implementation spec for `packages/report-builder`. It lives here, at a fixed path, so
that every agent session starts from the same source of truth instead of a paraphrase pasted into a
prompt — see `handoff.md` rule 1.

The paths below are the ones the prompts inside `handoff.md` and `porting.md` reference verbatim, so
those prompts can be copy-pasted without editing.

| File | What it is |
|---|---|
| `plan.md` | The commit-by-commit implementation plan — **28 entries**, each one commit, with a `Status:` line (ALREADY DONE / ADJUST EXISTING / BUILD NEW / NO LONGER APPLIES), `Depends on` and `Acceptance`. |
| `inventory.md` | The component inventory `porting.md` §3 asks for, filled in against `packages/ui` and `packages/report-builder/src/react`. |
| `decisions/` | Decisions taken out loud, one file each, because a commit should not settle them in passing. |
| `notes.md` | Companion analysis: mobile, accessibility, data model. |
| `prototype.html` | The behavioural reference — a standalone vanilla-DOM prototype. Open it in a browser. |
| `porting.md` | How to port the prototype into React + MUI: the fidelity contract, interaction constants, component inventory, design tokens. |
| `handoff.md` | The method: four rules for scoping agent sessions, plus the orientation / implement / review / ticket prompts. |
| `orientation.md` | The first pass of the plan mapped onto the real codebase. **Stale** — written at `316c22f`, before the FUT-391 redesign landed. Superseded by `plan.md`'s `Status:` lines on what exists; still good on what *not* to do (§2.1–2.7). |

## Order of reading

1. `plan.md` — what we're building and what is already built, one commit at a time. Its
   "Reconciliation status" section is the map of the whole set.
2. `decisions/` — anything already settled, before re-deriving it.
3. `inventory.md` — which component to reach for, before writing UI.
4. `porting.md` — how to translate the prototype.
5. `prototype.html` — the behaviour, when a detail is ambiguous.

## Precedence

- On **what exists today**, `plan.md`'s `Status:` lines win — they were read from the current
  tree. `orientation.md` was the previous holder of this role and predates the FUT-391 redesign;
  where the two disagree, `plan.md` is right and `orientation.md` is the older reading.
- On **a decision already taken**, `decisions/` wins over everything, including `porting.md` and
  `plan.md`. That is what the folder is for.
- On **intended behaviour**, `prototype.html` wins, then `plan.md`.
- On **which component to use**, `inventory.md` wins — it checked every subpath against
  `packages/ui`'s `exports` map. Then `porting.md` §3: use the design system, not the prototype's
  CSS.

## Where the code is

- Engine, spec, compiler: `packages/report-builder/src/`
- Host-mounted backend surface: `packages/report-builder/src/server/`
- UI: `packages/report-builder/src/react/`
- Design system: `packages/ui/src/components/`

`future-pay`'s `apps/admin/src/pages/reports/index.tsx` is a thin wrapper — it resolves the tenant and
mounts `@12-apps/report-builder/react`. The reports surface is built here, not there.
