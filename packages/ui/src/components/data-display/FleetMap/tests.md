# FleetMap Test Status Tracking

## Test Files Status

- [x] `FleetMap.test.stories.tsx` created
- [x] `__tests__/fleet-map-helpers.test.ts` created — the four pure decisions,
      at their boundaries, where a story is expensive to stage and an
      off-by-one reads identically on screen
- [x] `__tests__/fleet-map-hook.test.ts` created — the two decisions the DOM
      cannot show: `centre`'s IDENTITY across a poll, and who owns the
      selection across a re-render
- [x] `__tests__/fleet-map-guards.test.tsx` created — the behaviours the review
      rounds added guards for, in the suite CI actually runs (`test-storybook`
      is deliberately not wired into this repo's CI)
- [x] `__tests__/fleet-map-theme.test.tsx` created — the row and its first-load
      skeleton under two host themes, because a radius that looks right on the
      default one is not evidence in a package built to be re-themed
- [x] All applicable test categories implemented

## Storybook Tests Status

### Test Results

| Test Name | Status | Pass/Fail | Notes |
| --- | --- | --- | --- |
| Basic Interaction | Running | PASS | rows render, roster ordered freshest first |
| Freshness | Running | PASS | three states, words not colour, caller formats |
| Thresholds are props | Running | PASS | same fleet reads differently on tighter bounds |
| Selection | Running | PASS | click reports, `aria-selected` on one row only |
| Keyboard Navigation | Running | PASS | one tab stop, arrows move and wrap |
| Screen Reader | Running | PASS | region, named listbox, map named not hidden |
| Empty State | Running | PASS | empty state renders, no map canvas |
| Loading State | Running | PASS | busy, skeletons, NOT the empty state, and silent |
| Edge Cases | Running | PASS | one unit, long name, no badge, zero seconds |
| Active Descendant | Running | PASS | points at a row that exists, id is generated |
| Stale Selection | Running | PASS | a selection that left the fleet dangles nothing |
| Loading Announcement | Running | PASS | `role="status"` carries `copy.loading` |
| Loading Keeps Roster | Running | PASS | a poll over a populated roster keeps the listbox |
| Uncontrolled Selection | Running | PASS | works with neither selection prop passed |
| Controlled Without Handler | Running | PASS | arrows left un-prevented for the page |
| Idle Announcement Region | Running | PASS | the live region exists, and is empty, while idle |

Legend: Pending | Running | PASS | FAIL

Not implemented, and why: **Form Interaction** — the component has no form.
**Focus Management** — covered inside Keyboard Navigation, since the listbox's
single tab stop IS its focus contract. **Performance** — the roster is a short
list by construction (a fleet is people, not rows), so a render benchmark would
measure the fixture rather than the component.

## Static Stories Status

- [x] Default story
- [x] Empty state
- [x] Loading state
- [x] One unit
- [x] All stale
- [x] Tight thresholds
- [x] Long names / no accuracy
- [x] Selectable (controlled)
- [x] Compact height

## Lint Status

- [x] No lint errors
- [x] No warnings
- [x] Clean under `eslint.flakiness.config.mjs`

## TypeCheck Status

- [x] No type errors
- [x] All props properly typed, no `any`

## Overall Component Status

- [x] Lint clean
- [x] TypeCheck clean
- [x] Stories working
- [x] Unit tests passing — web 35 (16 helpers + 8 hook + 9 guards + 2 theme),
      native 14 (`FleetMap.native.test.tsx`, run by the `Native` lane rather
      than by `pnpm test`, so each runs once)
- [x] React Native build shipped — `@12-apps/ui/data-display/FleetMap` carries a
      `react-native` export condition; the rendering gaps, the map's absence
      among them, are in `NATIVE-NOTES.md` and counted by `pnpm native:ledger`
