# UsableModal

A modal that is a **`StackedModal` on a computer** and a **bottom `Sheet` on a
phone**, behind one API. A screen that opens "the same task" on both — a form, a
wizard, a pedido being written — uses this instead of switching between the two
by hand.

```tsx
import { UsableModal } from '@12-apps/ui/feedback/UsableModal';

<UsableModal
  open={open}
  onClose={close}
  title="Novo pedido"
  closeLabel="Fechar"
  backLabel="Voltar"
  footer={<Actions />}
  dataTestId="new-order"
>
  <Form />
</UsableModal>
```

## The surface

| viewport | surface | from |
|---|---|---|
| below the theme's `sm` | bottom `Sheet` (`size="xl"`: a height ceiling, not a height) | `UsableModal.sheet.tsx` |
| `sm` and up | `StackedModal` (`size`, `panelWidth` pass through) | `UsableModal.modal.tsx` |

`layout="modal"` or `layout="sheet"` fixes one surface for a host that already
knows (a test, a kiosk); the default `auto` reads the viewport once per render.

## Loaded on demand

Each surface is its own lazily imported chunk (the package builds with
`splitting: true`). A closed modal renders nothing and loads nothing; the first
open loads the one surface the viewport asks for. A phone never downloads
`StackedModal`, a computer never downloads `Sheet`. While the chunk loads the
screen shows nothing — no spinner before the content.

## Props

- **open**, **onClose** — `onClose` fires for every way out: the ✕, Esc, the
  backdrop, a swipe down on the sheet.
- **title** — names the dialog (the stacked modal's bar, the sheet's header).
- **children** — the body. It scrolls.
- **footer** — the pinned action bar at the bottom of either surface. On the
  stacked modal it is NOT `StackedModal`'s `actions`, which sit in the header
  from `sm` up: a screen's acts belong under what they act on.
- **closeLabel**, **backLabel** — accessible names (required; the back arrow
  shows when the stacked modal opens over another panel).
- **layout**, **size**, **panelWidth**, **dataTestId**.

## The stack

On a computer the panel joins a `ModalStackProvider` the host already keeps
(it is pushed over the host's panel and offers the way back). A host with no
provider gets a stack of one, so the component works on its own.

## Test ids

`dataTestId` marks the surface; `<id>-footer` marks the action bar on both. The
stacked modal adds its own (`<id>-title`, `<id>-close-button`, `<id>-back-button`).
