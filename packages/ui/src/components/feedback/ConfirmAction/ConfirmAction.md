# ConfirmAction

The confirmation popup for destructive actions — one implementation, so every
delete in the product behaves the same way.

It exists because the admin's destructive actions used to fire on a single
click: picking "Excluir" in a card's 3-dots menu called the endpoint
immediately, and a mis-tap on a phone destroyed the row. The few screens that
did confirm had each hand-rolled their own dialog, so the wording, the focus
order and the double-click behaviour all differed.

## What it guarantees

Whichever of the three entry points you use, you get the same contract:

- **Nothing runs until the operator confirms.** Opening the popup has no side
  effect; the guarded handler is called from the confirm button and nowhere else.
- **One write per confirmation.** A returned promise holds the popup in its
  pending state, and a second confirm during that window is dropped — a
  double-click cannot send two DELETEs.
- **A failure stays visible.** If the action rejects, the popup stays open
  carrying the error instead of closing over a write that never landed, and the
  operator can retry from there. A rejection with a message shows that message
  — throw the server's sentence (`throw new Error(result.error)`) and the
  operator reads what actually blocked the write; `errorText` is the fallback.
- **The keyboard is safe.** Destructive popups open with focus on *Cancel*, so a
  stray Enter still on the trigger cannot complete the action. Escape and the
  backdrop cancel; both are inert while a write is in flight.
- **The popup names the thing.** `entityName` is echoed into the body, so it
  reads "Bebidas", not "este item".

## Three entry points

### `withConfirmation(Component, defaults?)` — the HOC

The path of least resistance for an existing button: the wrapped component's own
`onClick` becomes the guarded action, so the call site keeps its shape.

```tsx
import { withConfirmation } from '@12-apps/ui/feedback/ConfirmAction';
import { Button } from '@12-apps/ui/form/Button';

const DeleteButton = withConfirmation(Button, {
  confirmText: 'Excluir',
  description: 'Vai para a lixeira e pode ser restaurado de lá.',
});

<DeleteButton
  color="danger"
  onClick={() => deleteCategoryAction({ tenantSlug, id: row.id })}
  confirm={{ title: 'Excluir a categoria?', entityName: row.name }}
>
  Excluir
</DeleteButton>;
```

Defaults baked into the wrapper are merged with each instance's `confirm` prop,
instance wins. `confirm={false}` falls through to the plain component — the
escape hatch for the same button in a context where the action is harmless.

Refs are not forwarded (the HOC renders trigger + popup as a fragment, so there
is no single node to hand back). Use `<ConfirmAction>` where a ref is needed.

### `createConfirmButton` — the HOC, pre-applied

`withConfirmation(Button)` with the shared wording already in place. Use it when
you just want a guarded button and have no reason to build your own wrapper.

A FACTORY rather than a ready-made component, because the wording it bakes in is
the caller's: it takes the host's `ConfirmActionCopy` and its error sentence, and
returns the button. Build it once at module scope and use it like any other.

```tsx
import { createConfirmButton } from '@12-apps/ui/feedback/ConfirmAction';

const ConfirmButton = createConfirmButton(PT_BR_CONFIRM_ACTION_COPY, 'Algo deu errado.');

<ConfirmButton
  color="danger"
  onClick={remove}
  confirm={{ title: 'Remover o domínio?', entityName: domain.host, confirmText: 'Remover' }}
>
  Remover
</ConfirmButton>;
```

### `<ConfirmAction>` — the render prop

For triggers that are not buttons: a dropdown item, a table row action, an icon.

```tsx
<ConfirmAction
  title="Excluir a mesa?"
  entityName={row.label}
  confirmText="Excluir"
  onConfirm={() => deleteTableAction({ tenantSlug, id: row.id })}
>
  {(request) => <MenuItem onClick={request}>Excluir</MenuItem>}
</ConfirmAction>
```

### `useConfirmAction(handler, errorText?)` — headless

The state machine on its own (`open`, `pending`, `error`, `request`, `cancel`,
`confirm`), for a popup that has to look like something else entirely. Pair it
with `<ConfirmActionDialog state={…} />` or your own surface.

## Writing the wording

- `title` is the question — "Excluir a categoria?".
- `confirmText` is the **verb**, never "OK". It is required for that reason: a
  button reading "Confirmar" tells the operator nothing about what is about to
  happen.
- `description` should say whether the action can be undone. A soft delete goes
  to the recycle bin and comes back; a purge does not. Say which. Without one,
  the popup falls back to naming the affected row.
- `typeToConfirm` requires the operator to type an exact string before the
  confirm enables. Reserve it for actions with **no** recovery path — a
  permanent purge, suspending a live store. Everywhere else it is friction that
  buys nothing.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | `string` | — | Required. The question. |
| `confirmText` | `string` | — | Required. The verb on the confirm button. |
| `description` | `ReactNode` | derived from `entityName` | The consequence. |
| `entityName` | `string` | — | The row being acted on, echoed into the body. |
| `cancelText` | `string` | `Cancelar` | |
| `typeToConfirm` | `string` | — | Gates the confirm until typed exactly. |
| `typeToConfirmLabel` | `string` | derived | Label above the field. |
| `tone` | `'destructive' \| 'default'` | `destructive` | Colour + default focus. |
| `initialFocus` | `'confirm' \| 'cancel'` | `cancel` when destructive | |
| `errorText` | `string` | generic pt-BR sentence | Shown when the action rejects. |
| `dataTestId` | `string` | `confirm-action` | The popup's parts derive theirs from it. |

## Test ids

`dataTestId` (default `confirm-action`) is the root; the parts follow
`AlertDialog`'s convention:

- `confirm-action-confirm-button`
- `confirm-action-cancel-button`
- `confirm-action-error`
- `confirm-action-type-to-confirm` (on the input itself)
