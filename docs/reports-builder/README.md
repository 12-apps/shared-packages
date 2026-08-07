# Report builder — the spec set

The design and implementation spec for `packages/report-builder`. It lives here, at a fixed path, so
that every agent session starts from the same source of truth instead of a paraphrase pasted into a
prompt — see `handoff.md` rule 1.

The paths below are the ones the prompts inside `handoff.md` and `porting.md` reference verbatim, so
those prompts can be copy-pasted without editing.

| File | What it is |
|---|---|
| `plan.md` | The commit-by-commit implementation plan. Each entry is one commit, with `Depends on` and `Acceptance`. |
| `notes.md` | Companion analysis: mobile, accessibility, data model. |
| `prototype.html` | The behavioural reference — a standalone vanilla-DOM prototype. Open it in a browser. |
| `porting.md` | How to port the prototype into React + MUI: the fidelity contract, interaction constants, component inventory, design tokens. |
| `handoff.md` | The method: four rules for scoping agent sessions, plus the orientation / implement / review / ticket prompts. |
| `orientation.md` | **Read this before `plan.md`.** The plan mapped onto the real codebase — what already exists, and where the plan is wrong about this repo. |

## Order of reading

1. `orientation.md` — what's actually here today.
2. `plan.md` — what we're building, one commit at a time.
3. `porting.md` — how to translate the prototype, before touching any UI.
4. `prototype.html` — the behaviour, when a detail is ambiguous.

## Precedence

- On **what exists today**, `orientation.md` wins — it cites code, the others were written from
  screenshots.
- On **intended behaviour**, `prototype.html` wins, then `plan.md`.
- On **visual and component choices**, `porting.md` §3 wins: use the design system, not the
  prototype's CSS.

## Where the code is

- Engine, spec, compiler: `packages/report-builder/src/`
- Host-mounted backend surface: `packages/report-builder/src/server/`
- UI: `packages/report-builder/src/react/`
- Design system: `packages/ui/src/components/`

`future-pay`'s `apps/admin/src/pages/reports/index.tsx` is a thin wrapper — it resolves the tenant and
mounts `@12-apps/report-builder/react`. The reports surface is built here, not there.
