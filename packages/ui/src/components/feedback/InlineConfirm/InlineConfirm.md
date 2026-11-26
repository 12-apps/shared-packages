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
  message (throw the server's sentence), else `errorText`, announced as an
  alert, and focus moves to the verb so the reader retries with Enter. A
  confirmation the host closes forgets its failure: reopened, it starts clean.
- **The keyboard is safe.** Focus moves to the CANCEL when it opens, so a stray
  Enter cannot complete the act. Escape backs out like the cancel. While the
  write is out neither button is natively disabled — the pressed one keeps
  focus — the verb shows its spinner and both ignore presses (`aria-disabled`).
- **Focus comes back after the host re-renders.** On a cancel or Escape the
  host closes the confirmation (`open={false}`); on THAT commit — never inside
  the click — focus goes to `returnFocusTo()` when given, else to the element
  that held focus when the confirmation opened, if it is still in the page.
  **A host that hides its trigger while the confirmation is open must pass
  `returnFocusTo`**: the trigger it rendered before is gone by then, and only
  the callback can reach the one rendered again. Keep `InlineConfirm` mounted
  and toggle `open`; unmounting it on cancel still hands focus back.
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
  media query) each button takes a whole line of its own.
- Spacing follows the first host's approved frames on the theme's stops: about
  12px from the hairline to the question, 4px from the question to its body and
  the note, 8px before the buttons.
- **The buttons keep the library's size** (40px tall, 16px label), not the
  frames' hand-drawn 36px: the 40px tap target is a repository rule and the
  library's scale is the design system (decided in the review of #1132).
- **Reading order differs from visual order, on purpose.** The verb is drawn
  first, but the cancel ("Manter") comes first in the DOM, so a screen reader
  and the Tab key reach it first: the safe answer is the first one met.
- Red marks the verb's button and a failure, nothing else.
- The verb LEADS, unlike `AlertDialog`'s pair where the primary sits on the
  right: in a row the eye reads from the start edge, and the owner's approved
  frames (FUT-5615) draw it so. The cancel is still first in the tab order.

## Usage

```tsx
import { InlineConfirm } from '@12-apps/ui/feedback/InlineConfirm';

const trigger = useRef<HTMLButtonElement | null>(null);

<li>
  <span>{guest.name}</span>
  {asking ? null : (
    <Button ref={trigger} variant="text" onClick={() => setAsking(true)}>
      {copy.remove}
    </Button>
  )}
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
    // The trigger is hidden while asking: hand focus to the one rendered again.
    returnFocusTo={() => trigger.current}
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
| `returnFocusTo` | `() => HTMLElement \| null` | the element focused when it opened |
| `dataTestId` | `string` | `inline-confirm` (buttons `-confirm`, `-cancel`; the note `-irreversible`; the failure `-error`) |

## Accessibility

- `role="group"` named by the title, so a screen reader announces the question
  when focus lands on the cancel.
- The failure is `role="alert"`.
- Focus: the cancel on open; the verb after a failed write; back to
  `returnFocusTo()` (or the element focused before opening) on the commit
  that closes it after a cancel or Escape.

## When not to use it

An act that is not tied to one row of a visible list, or that steps past a
safeguard and needs a typed word: use `ConfirmAction`.
