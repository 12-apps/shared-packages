# HeaderActions

The page header's actions as ONE control, sized to how many there are.

```tsx
import { HeaderActions } from '@12-apps/ui/form/HeaderActions';

<HeaderActions
  moreLabel={copy.moreActions}
  actions={[
    { id: 'new-product', text: 'Novo produto', icon: <AddIcon fontSize="small" />, onClick: onCreate },
    { id: 'order-highlights', text: 'Ordenar destaques', icon: <ListIcon fontSize="small" />, onClick: onOrder },
    { id: 'export-sheet', text: 'Exportar planilha', icon: <DownloadIcon fontSize="small" />, onClick: onExport },
    canImport && { id: 'import-sheet', text: 'Importar planilha', icon: <UploadIcon fontSize="small" />, onClick: onImport },
  ]}
/>
```

| actions | renders |
| --- | --- |
| 0 | nothing at all — not an empty box, and not a menu with no items |
| 1 | that action, as an ordinary `HeaderButton` |
| n | the FIRST as a button; the other n−1 inside one dropdown |

## The array is in priority order

Index 0 is the action that keeps its button, so the order you declare is the
ranking you get. Put the thing the page is FOR first — "Novo produto" on a
catalog — and everything the merchant reaches for monthly after it.

## Falsy entries are dropped

`[edit, canDelete && del]` is a legal array, and so is
`{ …, visible: false }`. Both mean the same thing and both keep the gate at the
call site, where a reader can see WHY an action is missing, instead of in an
array built somewhere above.

## Test ids survive the overflow

An action that moves into the menu keeps its `dataTestId` (falling back to its
`id`) on the `MenuItem`. Adding a fifth action to a header must not silently
break the suite of the action it pushed out.

The overflow trigger and its menu take their ids from `testIdPrefix`
(`header-actions` by default): `…-more-trigger` and `…-more-menu`.

## It brings its own spacing

The component renders one `inline-flex` box, not a fragment. A fragment inherits
whatever gap its parent sets, and the two mounts set different ones — a
`Dashboard.Header` spaces its children, a `Dashboard.Action` slot does not.

## Copy

`moreLabel` is REQUIRED and has no default. This package ships no words of its
own, in any language — the label is also the trigger's accessible name, so a
default would be read out to a screen-reader user in the wrong language.

## Inside a Dashboard

`<Dashboard.Actions>` is the same component wired to the Dashboard's own
`testIdPrefix`; prefer it when the header is a `<Dashboard.Header>`.

```tsx
<Dashboard.Header title="Produtos">
  <Dashboard.Spacer />
  <Dashboard.Actions moreLabel={copy.moreActions} actions={actions} />
</Dashboard.Header>
```

`<Dashboard.Action>` (singular) stays for the one header control that is not an
action at all — a link, a toggle, a status pill.
