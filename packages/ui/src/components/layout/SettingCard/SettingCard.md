# SettingCard

## Purpose

One setting, summarised while closed and edited **in place**. A settings screen
built from these reads as a list of answers ("Sign out after 30 minutes") with
one Edit each, instead of a wall of open forms.

- **Closed:** title, a status pill, a one-line summary, and Edit.
- **Open:** Edit opens the card where it is — no dialog, no route change —
  around the host's form (`children`), a collapsible "learn more" disclosure and
  Cancel / Save.

The card knows nothing about what it edits. The form, the draft and the save
are the host's; the card owns the open/closed state, the save's pending and
failed states, and focus.

Part of the `layout/SettingCard` family, with
[`SettingToggle`](./SettingToggle.md), [`SettingGroup`](./SettingGroup.md) and
[`SettingGrid`](./SettingGrid.md).

## Usage

```tsx
import { SettingCard } from '@12-apps/ui/layout/SettingCard';
import { NumberField } from '@12-apps/ui/form/NumberField';
import { useLocaleCopy } from '@12-apps/i18n/react';
import { SETTING_CARD_COPY } from '@12-apps/ui/locales';

const copy = useLocaleCopy(SETTING_CARD_COPY);
const [draft, setDraft] = useState<number | null>(saved);

<SettingCard
  copy={copy}
  title="Session timeout"
  summary={`Sign out after ${saved} minutes`}
  status={{ label: 'On', color: 'success' }}
  learnMore="A shorter timeout protects shared devices."
  onCancel={() => setDraft(saved)}
  onSave={() => api.saveTimeout(draft)}   // may return a promise
>
  <NumberField label="Minutes" value={draft} onChange={setDraft} min={5} max={240} suffix="min" />
</SettingCard>
```

## Props

| prop | type | default | effect |
|---|---|---|---|
| `copy` | `SettingCardCopy` | **required** | Edit / Cancel / Save / Saving / Learn more / the fallback error. No shipped default — pass `EN_US_SETTING_CARD_COPY`, `PT_BR_SETTING_CARD_COPY`, or `SETTING_CARD_COPY` through `useLocaleCopy`. |
| `title` | `string` | **required** | The setting's name. A heading, and the accessible name of the card's region. |
| `onSave` | `() => void \| Promise<unknown>` | **required** | Persist the draft. See *Saving* below. |
| `children` | `ReactNode` | **required** | The form. Rendered only while open. |
| `summary` | `ReactNode` | — | The one line a closed card shows. Ends in an ellipsis rather than wrapping. |
| `status` | `{ label: string; color?: ColorValue }` | — | The pill beside the title. `label` is always shown, so colour never carries the meaning alone. |
| `learnMore` | `ReactNode` | — | Longer explanation behind a disclosure in the open card. Omit for no disclosure. |
| `onCancel` | `() => void` | — | The card closed without saving. Reset the host's draft here. |
| `open` / `defaultOpen` / `onOpenChange` | | uncontrolled, closed | Controlled or uncontrolled open state. `onOpenChange` hears Edit, Cancel, Escape and a successful save. |
| `disabled` | `boolean` | `false` | Disables Edit. |
| `saveDisabled` | `boolean` | `false` | Disables Save — for a draft the host knows is invalid. |
| `formatError` | `(error: unknown) => string \| undefined` | — | The sentence to show for a rejected save. `undefined` falls back to `copy.saveFailed`. |
| `headingLevel` | `'h2' … 'h6'` | `'h3'` | Where the title sits in the page outline. |
| `icon` | `ReactNode` | — | A decorative glyph before the title. |
| `dataTestId` | `string` | — | Root test id; parts derive `-edit`, `-save`, `-cancel`, `-summary`, `-status`, `-error`, `-saving`, `-body`, `-learn-more`, `-title`. |
| `className`, `sx` | | | Styling hooks on the root `<section>`. |

## Saving

- **Pending.** While the promise `onSave` returned is pending, Save shows a
  spinner and `copy.saving`, the card is `aria-busy`, Cancel is disabled and
  further presses of Save are ignored — `onSave` runs once.
- **Resolved.** The card closes and focus returns to Edit. Update `summary` from
  the saved value in the same handler.
- **Rejected** (or `onSave` throws). The card **stays open**, the draft is
  untouched, and the error appears in a `role="alert"` line that Save is
  described by. The card never prints `error.message` by itself — that string
  is written for a developer; map it with `formatError`.

Save is `aria-disabled`, not `disabled`, while pending: a disabled button drops
the focus it holds, and a keyboard user whose save then failed would be sent
back to the top of the page.

## Cancelling

Cancel (or Escape inside the open card) closes the card and calls `onCancel`.
`children` unmount on close, so any **uncontrolled** state inside the form is
discarded by construction; a controlled draft is the host's to reset in
`onCancel`, as in the example above.

## In a grid

An open card sets `grid-column: 1 / -1` on itself and carries
`data-setting-card-open`, so inside a [`SettingGrid`](./SettingGrid.md) — or any
CSS grid — its form gets the whole row. `height: 100%` lets it match the other
cards in its row while closed.

## Accessibility

- The root is a `<section>` labelled by the title; the title is a real heading
  (`headingLevel`).
- Edit's accessible name is `copy.edit` **plus the title** ("Edit Session
  timeout"), so a grid of cards is not a list of identical buttons.
- **Focus round trip.** Opening moves focus to the first tabbable element in the
  form — the rule `Dialog` uses (`focusFirstTabbable`, FUT-2696), so a field's
  own `autoFocus` still wins. Closing, by any path, returns focus to Edit. A
  card mounted open does not take focus.
- **No focus trap.** The card is inline and the page around it stays usable; a
  trap would strand a keyboard user who wants to leave mid-edit. Escape
  cancels.
- The "learn more" trigger owns `aria-expanded` / `aria-controls`; the region is
  kept mounted so `aria-controls` always resolves.
- The save failure is `role="alert"`, announced without moving focus.

## Best practices

- Keep `summary` to the current **value** in words, not a description of the
  setting — the title already says what it is.
- Use `status` for a state that changes how the summary reads ("Off",
  "Managed by your organisation"); skip it when the summary says it all.
- A setting that is a single on/off is a [`SettingToggle`](./SettingToggle.md),
  not a card with a switch inside.
