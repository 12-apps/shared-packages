# 0001 — Drag implementation: keep `lib/drag-reorder.ts`, do not add `@dnd-kit`

**Status:** accepted
**Scope:** `packages/report-builder` — block reordering and drag-to-resize (`plan.md` entries 16 and 17)
**Supersedes:** `porting.md` §2's prescription of `@dnd-kit/sortable` with `rectSortingStrategy`

---

## Decision

1. **Keep the local `packages/report-builder/src/react/lib/drag-reorder.ts`.** It stays the reorder implementation; entries 16 and 17 extend it rather than replace it.
2. **Add the keyboard sensor and the live-region announcements from `prototype.html`** — the two parts a hand-rolled drag usually omits, and the two the prototype is most worth copying for.
3. **Do not add `@dnd-kit` to the published `@12-apps/ui`.** No `@dnd-kit/*` package becomes a dependency of the design system.

---

## Why this needed deciding

`porting.md` §2 prescribes `@dnd-kit/core` + `@dnd-kit/sortable`, and `plan.md` entry 16 repeated it. Both were written from the prototype, before anyone checked what the repo has.

`inventory.md` §3 is where it stopped being a lookup and became a decision. `@dnd-kit` is **not a dependency of any package in this repo** — `packages/report-builder/package.json` lists `@12-apps/stock-domain`, `@12-apps/ui` and `zod`, and `@12-apps/ui` ships no drag primitive. Meanwhile `lib/drag-reorder.ts` (77 lines, FUT-311) already implements reordering. So the choice was between a dependency with a real blast radius and a local implementation with a real gap, and it had to be made *before* the reorder commit rather than inside it.

## The two options, priced

**Adopt `@dnd-kit`.** Buys the keyboard sensor, the announcements, the sensor abstraction and `rectSortingStrategy`'s grid awareness — all of which fit this canvas, which is a 12-column grid and not a vertical list. The cost is where it lands: `@12-apps/ui` is **published**, so a dependency added there is resolved by every consumer, not by the one app that wanted the drag. Neither the reports surface nor its host gets to opt out.

**Keep the local implementation.** No new dependency and no consumer impact, at the cost of writing the keyboard path and the announcements ourselves — which is the part hand-rolled drag code usually skips, and skipping it is a WCAG 2.1.1 failure.

## What settled it

Three findings, in order of weight.

**The dependency is priced per consumer, the gap is priced once.** Adding `@dnd-kit` to a published design system is a permanent, repo-wide cost taken to solve a problem in one surface. Writing a keyboard sensor for one canvas is a bounded, one-time cost in the package that needs it. If a second surface later needs drag, that is the moment to reconsider — a second caller is the evidence this decision currently lacks.

**The accessibility gap is real, and neither option removes the obligation.** `orientation.md` §2.6 records that keyboard and touch users "already have up/down buttons", quoting `drag-reorder.ts`'s own header, and concludes the WCAG concern is mitigated. **On the editor canvas it is not.** `report-editor-block.tsx` renders four controls — grip, title, ✎, 🗑 — and no move-up/move-down control exists anywhere in `src/react`. Reordering there is drag-only today. So the keyboard path has to be written regardless of which library is underneath; `@dnd-kit` would supply the sensor, not the decision to have one.

**The parts that would have been hardest to hand-roll are already hand-rolled, and well.** `drag-reorder.ts` carries a dedicated `application/x-report-builder-reorder` payload type so foreign drags — text, files — never highlight a row or trigger a reorder even when their text happens to match a block id. It is handle-only, so text inside a row's inputs stays selectable. And `reorderBlock` (`report-model.ts:127`) moves blocks **by id**, never by index arithmetic — which is the exact failure mode `plan.md` entry 16 warns about for a variable-width 12-column grid, already avoided.

## Consequences

**Accepted:**

- Entries 16 and 17 own writing the keyboard sensor (Alt + ↑/↓ to reorder, Shift + ←/→ to resize), the `aria-live` region, the insertion indicator, the drag ghost, the 1.4×-weighted drop target, edge auto-scroll and Escape-to-cancel.
- The live region (`.sr` + `#live`, `inventory.md` §2) is **built once in entry 16** and consumed by entries 24 and 26. It is not drag-specific and should not be scoped as if it were.
- We carry the maintenance of pointer-event code that a library would have maintained for us.

**Avoided:**

- A runtime dependency in a published package, resolved by every consumer including future-pay.
- A second drag idiom in a package that already has one, and the migration of the existing FUT-311 behaviour onto it.

**Revisit when:** a second surface in this repo needs drag-and-drop, or the keyboard/announcement work turns out to exceed roughly the effort of the migration it avoids. Either is a reason to reopen this; neither is true today.

## Follow-through

- `porting.md` §2 still prescribes `@dnd-kit/sortable`. It is superseded by this record — leave the section as written history and read this file first, per `instructions.md`'s precedence.
- `plan.md` entry 16 links here and carries the reconciled scope.
