# NumberField

A digits-only numeric input over `Input` whose value is `number | null` (`null`
is an empty field). `inputMode="numeric"` on the `<input>`, non-digit keystrokes
refused and pastes reduced to their digits, a `suffix` drawn inside the field,
and ArrowUp / ArrowDown stepping by `step` within `min` / `max`. Built for the
`layout/SettingCard` family's forms (FUT-2823) but independent of it.

## Props

- **value** — the number, or `null` for an empty field.
- **onChange** — every edit as a number, or `null` once cleared.
- **min** — floor for arrows and for the blur clamp.
- **max** — ceiling for arrows and for the blur clamp.
- **step** — how far one arrow press moves (default 1).
- **suffix** — the unit, inside the field border, read as its description.
- Everything else `Input` takes, minus the props this field owns.

## Lint

- Clean (`pnpm lint:files src/components/form/NumberField`), including the
  complexity and flakiness gates.

## Type Errors

- None (`pnpm typecheck`, `tsc -p tsconfig.stories.json`).

## Testing Scenarios

- Digits-only typing and paste; `null` on clear; arrow stepping and clamping;
  blur clamp; suffix geometry; spinbutton ARIA; caller `onKeyDown` precedence.

## Storybook Tests List

- Form/NumberField/Tests → 7 interaction stories.

## Current

- 2026-09-26 16:40 BRT — v1 shipped with `Input` gaining a merged `inputProps`
  pass-through (an attribute `Input` does not recognise otherwise lands on the
  text field's root `<div>`). Remaining TODO: none for v1; a host adoption
  follows in future-pay.
