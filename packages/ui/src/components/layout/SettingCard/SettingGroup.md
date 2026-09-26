# SettingGroup

## Purpose

**One subject**: a main switch, plus the settings that only mean something
while it is on, indented beneath it. "Notifications" on or off, and — while on —
which notifications and when.

When the main switch is off the dependent rows **stay where they are**: dimmed,
disabled, and explained by a short hint. They are not removed. A reader
deciding whether to turn a feature on is helped by seeing what it would let
them configure, and a layout that jumps when a switch flips moves the thing
they were about to press.

Part of the `layout/SettingCard` family.

## One group per subject — not a container for a page

A `SettingGroup` is for several settings of **the same subject**, where the
main switch decides whether the others apply at all. It is not a way to put
several unrelated settings in one box.

| these are… | use |
|---|---|
| Notifications (main switch) + digest, mentions, quiet hours | **one** `SettingGroup` — the rows mean nothing with notifications off |
| Session timeout, two-step sign-in, language | **three** cards — a `SettingCard`, a `SettingToggle`, a `SettingCard` — laid out by a `SettingGrid` |
| Backups (main switch) + frequency, retention | **one** `SettingGroup` |
| Backups and notifications | **two** groups, never one |

The test: if turning the main switch off would **not** make a row meaningless,
that row is a different subject and belongs in its own card. Squeezing two
subjects into one group gives one of them a main switch it does not have, and a
hint ("inactive until X is on") that is false for it.

## Usage

```tsx
import { SettingGroup, SettingToggle } from '@12-apps/ui/layout/SettingCard';

<SettingGroup
  copy={switchCopy}
  title="Notifications"
  summary="What we tell you about, and when."
  inactiveHint="Turn notifications on to choose which ones you get."
  checked={settings.notifications}
  onChange={(next) => api.setNotifications(next)}
>
  <SettingToggle variant="row" copy={switchCopy} title="Weekly digest" checked={settings.digest} onChange={api.setDigest} />
  <SettingToggle variant="row" copy={switchCopy} title="Mentions" checked={settings.mentions} onChange={api.setMentions} />
  <NumberField label="Quiet hours from" value={quietFrom} onChange={setQuietFrom} min={0} max={23} suffix="h" />
</SettingGroup>
```

## Props

| prop | type | default | effect |
|---|---|---|---|
| `copy` | `SettingSwitchCopy` | **required** | The main switch's "saving" announcement and fallback error. |
| `title` | `string` | **required** | The subject. Names the main switch and the dependent rows' group. |
| `checked` | `boolean` | **required** | The main switch's persisted value. |
| `onChange` | `(checked: boolean) => void \| Promise<unknown>` | **required** | Persist the main switch — same async contract as [`SettingToggle`](./SettingToggle.md). |
| `inactiveHint` | `string` | **required** | Why the rows are inactive. Shown only while they are. |
| `children` | `ReactNode` | **required** | The dependent rows — `SettingToggle variant="row"`, fields, anything. |
| `summary` | `ReactNode` | — | Explanation under the title. |
| `disabled` | `boolean` | `false` | Disables the main switch; the rows are then inactive too. |
| `formatError`, `icon`, `dataTestId`, `className`, `sx` | | | As on `SettingToggle`. Parts add `-dependents` and `-hint`. |

## When the rows are active

Only while the main switch is on **and saved**: turning it on lights the rows
once the save lands (so nobody edits rows a failed save then disables), and
turning it off dims them at once.

## Accessibility

- The dependent rows are a `role="group"` named by the subject.
- Inactive, the group is `inert` — nothing in it is focusable or clickable,
  whatever the host put there — and `aria-disabled`, described by the hint.
- The family's own rows (`SettingToggle`) also render `disabled`, so they read
  as disabled rather than merely unreachable.
- Opacity alone never carries "inactive"; the hint says it in words.
