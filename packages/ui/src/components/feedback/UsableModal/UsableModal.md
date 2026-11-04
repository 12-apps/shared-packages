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
knows (a test, a kiosk). With the default `auto` the surface is chosen when the
modal **opens** and kept until it closes: a phone turned to landscape or a
window narrowed past `sm` mid-task does not swap the surface and lose what was
typed. The next opening asks the viewport again.

## Loaded on demand

Each surface is its own lazily imported chunk (the package builds with
`splitting: true`). A closed modal renders nothing and loads nothing; the first
open loads the one surface the viewport asks for. A phone never downloads
`StackedModal`, a computer never downloads `Sheet`. While the chunk loads the
screen shows nothing — no spinner before the content.

After the first open the surface stays mounted and receives `open`, so it runs
its own close: the slide-out, and the stacked modal leaving its stack.

**A chunk a deploy replaced** (a tab opened before it asks for a file that is
gone) is retried once, then the page reloads once onto the current build; if
that already happened in this tab the modal renders nothing rather than
throwing to the host's error boundary (`recover-chunk.ts`).

## Props

- **open**, **onClose** — `onClose` fires for every way out: the ✕, Esc, the
  backdrop, a swipe down on the sheet.
- **title** — names the dialog (the stacked modal's bar, the sheet's header).
- **children** — the body. It scrolls.
- **footer** — the pinned action bar at the bottom of either surface. On the
  stacked modal it is NOT `StackedModal`'s `actions`, which sit in the header
  from `sm` up: a screen's acts belong under what they act on.
- **closeLabel** — the ✕'s accessible name, `common.close` by default.
- **backLabel** — the back arrow's (required, as on `StackedModal`; it shows when
  the stacked modal opens over another panel).
- **layout**, **size**, **panelWidth**, **dataTestId**.

## The stack

On a computer the panel joins a `ModalStackProvider` the host already keeps
(it is pushed over the host's panel and offers the way back) and leaves it when
it closes. A host with no provider gets a stack of one, so the component works
on its own.

On a phone the sheet opens **above** any open `StackedModal` (a drawer's own
level, 1200, is under the stack's 1300 and up), and it is a named modal dialog
(`role="dialog"`, `aria-modal`, `aria-labelledby` its title), like the stacked
surface.

## Test ids

`dataTestId` marks the surface; `<id>-footer` marks the action bar on both.
The rest are each surface's own, so a host test that must not branch asks by
role instead (`getByRole('dialog', { name: title })`, the ✕ by `closeLabel`):

| | computer (`StackedModal`) | phone (`Sheet`) |
|---|---|---|
| title | `<id>-title` | `<id>-header-title` |
| ✕ | `<id>-close-button` | `<id>-header-close-button` |
| back | `<id>-back-button` | — |
