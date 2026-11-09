# FormHold

## Purpose

Hold a form while something it depends on is still running — a photo
uploading, typically — so it cannot be saved or edited half-way, while
navigation stays live.

## Usage

```tsx
import { useFormHold, useFormBusy } from '@12-apps/ui/form/FormHold';

function PhotoField() {
  const upload = useUpload(config);
  useFormHold('photo', upload.uploading); // holds the nearest form
  // …
}

function ReplaceButton() {
  const busy = useFormBusy(); // a host control opting in
  return <Button disabled={busy}>Replace</Button>;
}
```

`FormContainer` (`total-form`) and an open `SettingCard` each provide a hold
scope. A host form that is neither wraps itself in `<FormHoldProvider>`.

Scopes nest, and by default a hold anywhere in a branch holds all of it: a
hold in an inner scope holds every scope around it, and an outer scope's hold
reaches every scope inside it. That is what makes one form one hold — inside a
`FormContainer`, the main photo or a variation photo in a portalled drawer's
own scope holds the whole form. Two default scopes under one shared provider
therefore hold each other through it.

`isolate` makes a scope an island: its holds do not travel up, and nothing
above or beside it reaches in. Independent forms on one page — settings cards
that each save on their own — are isolated. An open `SettingCard` always is:
while one card's logo uploads, another card's Save still works.

## API

| Export | Signature | What it does |
| --- | --- | --- |
| `useFormHold` | `(key: string, held: boolean) => void` | Holds the nearest scope while `held`; released when it turns false and on unmount. `key` is unique within the form. No-op outside a scope. |
| `useFormBusy` | `() => boolean` | True while any key holds the nearest scope or one around it. `false` outside a scope. |
| `FormHoldProvider` | `({ children, isolate? }) => ReactElement` | A hold scope of its own. Scopes nest: an inner hold also holds the outer scope, and an outer hold reaches inside. `isolate` makes it an island (see below). |

## What busy holds

- The `total-form` fields (`Fields.*`), which render `disabled`.
- `Button type="submit"` and `SubmitButton`, which turn `aria-disabled` — still
  focusable, so Tab reaches them and a screen reader hears they are held — with
  the theme's disabled look and a keyboard focus ring; a click or Enter does
  nothing. A host's own `disabled` / `loading` still disable natively.
- `FormContainer`'s submit handler, which returns without calling `onSubmit`,
  so `requestSubmit()` and keyboard shortcuts cannot pass it.
- An open `SettingCard`'s Save (`aria-disabled`, no spinner; Cancel stays live).
- Any host control that reads `useFormBusy()`.

A plain `Button` is **not** held, so close, back, tabs and a drawer's close stay
live. A `Button` with `progress` is never `disabled` either: it stays focusable
and its label says why it will not act.

## Why a context, not `<fieldset disabled>`

A drawer or sheet a form opens renders through a portal, outside the `<form>`'s
DOM. A fieldset does not reach it; React context does.
