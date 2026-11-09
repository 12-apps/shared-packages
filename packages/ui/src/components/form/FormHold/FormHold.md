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

Sibling scopes under one shared provider do not hold each other: a hold in one
holds that scope and the shared provider above it (so anything reading the
shared provider waits), but the sibling scope stays live — holds travel up and
down a branch, never across.

## API

| Export | Signature | What it does |
| --- | --- | --- |
| `useFormHold` | `(key: string, held: boolean) => void` | Holds the nearest scope while `held`; released when it turns false and on unmount. `key` is unique within the form. No-op outside a scope. |
| `useFormBusy` | `() => boolean` | True while any key holds the nearest scope or one around it. `false` outside a scope. |
| `FormHoldProvider` | `({ children }) => ReactElement` | A hold scope of its own. Scopes nest: an inner hold also holds the outer scope, and an outer hold reaches inside. |

## What busy holds

- The `total-form` fields (`Fields.*`), which render `disabled`.
- `Button type="submit"` and `SubmitButton`, which render `disabled`.
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
