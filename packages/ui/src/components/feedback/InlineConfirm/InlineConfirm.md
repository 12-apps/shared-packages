# InlineConfirm

The confirmation of an irreversible act, drawn **in place** — inside the list
row it acts on, under a hairline — instead of a popup over the page.

It exists for the list the reader must keep in view while deciding: a waiting
queue, a set of rows where the question is "this one, here". `ConfirmAction`'s
popup covers that list; `InlineConfirm` asks in the row and leaves the rest of
the screen where it was.

## What it guarantees

The same contract as `ConfirmAction`, without the dialog:

- **Nothing runs until the reader confirms.** Opening it has no side effect;
  `onConfirm` is called from the verb's button and nowhere else.
- **One write per confirmation.** A returned promise holds it pending — both
  buttons inert, Escape ignored — and a second press in that window is dropped.
- **A failure stays visible.** A rejection keeps it open with the rejection's
  message (throw the server's sentence), else `errorText`, and the reader can
  press the verb again.
- **The keyboard is safe.** Focus moves to the CANCEL when it opens, so a stray
  Enter cannot complete the act. Escape backs out like the cancel, and both
  hand focus back to the element that had it before opening (the row's trigger).
- **In the tree, never a portal.** It renders where it is placed, so it scrolls
  with its row and nothing covers the list.

## Its content: the explaining confirmation

Every word is the host's; the component writes none.

| prop | says | example |
|---|---|---|
| `title` | the act as a question | `Remover Joaquim da fila?` |
| `description` | what will happen, in the reader's words | `Sai do 2º lugar e quem está atrás sobe.` |
| `irreversibleNote` | what cannot be taken back, set APART from the body | `Não dá para desfazer.` |
| `confirmText` | the act's own verb, on the one red button — never "OK" | `Remover da fila` |
| `cancelText` | the way out | `Manter` |
| `errorText` | the fallback when a rejection has no message | `Não foi possível remover.` |

## Layout

- A hairline, then the question, the body, the note and the buttons, stacked.
- The **verb leads at the start edge** and the cancel follows. The DOM keeps the
  cancel first, so it is first in the tab order; `row-reverse` draws the order.
- Whole buttons wrap, never a label inside one. A pair that does not fit stacks
  with the **verb on top** and the cancel at the bottom
  (`components-guidelines.md`, "Stacked buttons"); in a narrow row (a container
  under 288px, written through the theme and read by a container query, never a
  media query) each spans the line.
- Red appears only on the verb's button.

## Usage

```tsx
import { InlineConfirm } from '@12-apps/ui/feedback/InlineConfirm';

<li>
  <span>{guest.name}</span>
  {asking ? null : <Button variant="text" onClick={() => setAsking(true)}>{copy.remove}</Button>}
  <InlineConfirm
    open={asking}
    title={copy.removeAsk(firstName)}
    description={copy.removeWaitingBody(place)}
    irreversibleNote={copy.removeUndo}
    confirmText={copy.remove}
    cancelText={copy.removeKeep}
    errorText={copy.removeFailed}
    onConfirm={async () => {
      const result = await remove(guest.id);
      if (!result.ok) throw new Error(result.error);
      setAsking(false);
    }}
    onCancel={() => setAsking(false)}
    dataTestId={`remove-ask-${guest.id}`}
  />
</li>;
```

## Props

| prop | type | default |
|---|---|---|
| `open` | `boolean` | — |
| `title` | `ReactNode` | — |
| `description` | `ReactNode` | none |
| `irreversibleNote` | `ReactNode` | none |
| `confirmText` | `string` | — |
| `cancelText` | `string` | — |
| `onConfirm` | `() => void \| Promise<unknown>` | — |
| `onCancel` | `() => void` | — |
| `errorText` | `string` | none |
| `dataTestId` | `string` | `inline-confirm` (buttons `-confirm`, `-cancel`; the note `-irreversible`; the failure `-error`) |

## Accessibility

- `role="group"` named by the title, so a screen reader announces the question
  when focus lands on the cancel.
- The failure is `role="alert"`.
- Focus: the cancel on open; back to the trigger on cancel or Escape.

## When not to use it

An act that is not tied to one row of a visible list, or that steps past a
safeguard and needs a typed word: use `ConfirmAction`.
