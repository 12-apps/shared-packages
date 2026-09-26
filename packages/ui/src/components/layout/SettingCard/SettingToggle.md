# SettingToggle

## Purpose

A setting that is **one switch and nothing else**. There is no edit state:
flipping the switch is the edit, and it saves at once. Part of the
`layout/SettingCard` family.

## Usage

```tsx
import { SettingToggle } from '@12-apps/ui/layout/SettingCard';

<SettingToggle
  copy={copy}                       // SettingSwitchCopy — saving + saveFailed
  title="Two-step sign-in"
  summary="Ask for a code on a new device."
  checked={settings.twoStep}
  onChange={(next) => api.setTwoStep(next)}   // may return a promise
/>
```

## Props

| prop | type | default | effect |
|---|---|---|---|
| `copy` | `SettingSwitchCopy` | **required** | The "saving" announcement and the fallback error. No shipped default. |
| `title` | `string` | **required** | The switch's `<label>` — its accessible name, and a tap target far larger than the track. |
| `checked` | `boolean` | **required** | The persisted value. |
| `onChange` | `(checked: boolean) => void \| Promise<unknown>` | **required** | Persist a flip. See below. |
| `summary` | `ReactNode` | — | Explanation under the title; the switch is `aria-describedby` it. |
| `variant` | `'card' \| 'row'` | `'card'` | `row` drops the surface — for a dependent row inside a [`SettingGroup`](./SettingGroup.md). |
| `disabled` | `boolean` | `false` | Disables the switch. Also disabled inside a `SettingGroup` whose main switch is off. |
| `formatError` | `(error: unknown) => string \| undefined` | — | The sentence for a rejected save; `undefined` falls back to `copy.saveFailed`. |
| `icon`, `dataTestId`, `className`, `sx` | | | As on `SettingCard`. Parts: `-switch`, `-title`, `-summary`, `-saving`, `-error`. |

## Saving

- The switch shows the new value **at once** and holds it while the promise is
  pending, with a spinner beside it, `aria-busy` on the input, and
  `copy.saving` in a polite live region.
- **Resolved:** the switch hands back to `checked`, which the host has updated.
- **Rejected:** the switch returns to `checked` (the value actually saved) and
  the error appears under it in a `role="alert"` line the switch is described
  by.
- A flip while a save is pending is **ignored**, not queued: two racing writes
  of a boolean have no right answer.
- The switch is never `disabled` while saving, so keyboard focus stays on it.

## Accessibility

- `role="switch"` on the input, named by the title, described by the summary
  (and the error, when there is one).
- The whole title is a `<label for>` the switch — clicking the words flips it.

## Best practices

- Use it only when the setting is **exactly** one boolean. Anything with a
  value to type or pick is a [`SettingCard`](./SettingCard.md).
- Several switches about one subject belong in a
  [`SettingGroup`](./SettingGroup.md) with `variant="row"`.
