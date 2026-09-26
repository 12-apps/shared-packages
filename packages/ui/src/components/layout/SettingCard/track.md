# SettingCard family

Four settings-screen building blocks under one subpath,
`@12-apps/ui/layout/SettingCard` (FUT-2823). `SettingCard` summarises a setting
while closed and edits it in place, with an async save that stays open on
failure and a focus round trip. `SettingToggle` is a switch that saves as it
flips. `SettingGroup` is one subject's main switch with dependent rows that dim
(never vanish) while it is off. `SettingGrid` lays them out in 1–3 columns by
container query, with equal-height rows and a full-row span for an open card.
App-agnostic: every word comes in through props (`SettingCardCopy`,
`SettingSwitchCopy`, titles, summaries, hints).

## Props

- **SettingCard** — `copy`, `title`, `onSave` (may be async), `children` (the
  form), `summary`, `status`, `learnMore`, `onCancel`, `open` / `defaultOpen` /
  `onOpenChange`, `disabled`, `saveDisabled`, `formatError`, `headingLevel`,
  `icon`, `dataTestId`, `className`, `sx`.
- **SettingToggle** — `copy`, `title`, `checked`, `onChange` (may be async),
  `summary`, `variant` (`card` | `row`), `disabled`, `formatError`, `icon`,
  `dataTestId`, `className`, `sx`.
- **SettingGroup** — `SettingToggle`'s switch props plus `inactiveHint` and
  `children` (the dependent rows).
- **SettingGrid** — `children`, `minColumnWidth`, `maxColumns`, `gap`,
  `aria-label`, `dataTestId`, `className`, `sx`.

## Lint

- Clean (`pnpm lint:files src/components/layout/SettingCard`), plus the
  complexity and flakiness gates.

## Type Errors

- None (`pnpm typecheck`, `tsc -p tsconfig.stories.json`).

## Testing Scenarios

- Closed/open rendering, in-place open, Escape, controlled mode, no focus steal
  on mount; save pending / resolved / rejected / thrown / double-press /
  `saveDisabled`; cancel discarding uncontrolled drafts; toggle optimistic flip,
  revert, ignored second flip; group inert rows, hint, activation only after
  the save lands; grid container-query CSS, row sizing, open-card span; layout
  measured in Chromium by the test stories.

## Storybook Tests List

- Layout/SettingCard/Tests → 8, Layout/SettingToggle/Tests → 4,
  Layout/SettingGroup/Tests → 3, Layout/SettingGrid/Tests → 3.

## Current

- 2026-09-26 16:40 BRT — v1: all four components, copy packs in both locales,
  docs per component. Remaining TODO: first host adoption in future-pay
  (FUT-1659 is the admin screens that would fold onto it).
