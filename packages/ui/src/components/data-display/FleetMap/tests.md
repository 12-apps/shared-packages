# FleetMap Test Status Tracking

## Test Files Status

- [x] `FleetMap.test.stories.tsx` created
- [x] `__tests__/fleet-map-helpers.test.ts` created — the four pure decisions,
      at their boundaries, where a story is expensive to stage and an
      off-by-one reads identically on screen
- [x] `__tests__/fleet-map-hook.test.ts` created — the two decisions the DOM
      cannot show: `centre`'s IDENTITY across a poll, and who owns the
      selection across a re-render
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
- [x] Unit tests passing (23: 16 helpers + 7 hook)
