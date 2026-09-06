# CardKit on React Native — NOT PORTED, and why

`data-display/CardKit` carries no `react-native` condition and is absent from
`entries.native.json` on purpose. Under Metro the subpath therefore resolves to
the web file and fails at import on `@mui/material`, loudly — which is the
behaviour `NATIVE.md` asks an unported subpath for. This file is here so the
absence is a decision on the record rather than an omission.

It is written down because CardKit was in the same batch as `layout/Card` and
`feedback/Dialog`, and both of those shipped.

## What blocks it

Four of the kit's five value exports are renderer-bound, and each one is bound
to a component that has no native half yet:

| export | needs | state |
|---|---|---|
| `CardKebab` | `navigation/DropdownMenu` (MUI `Menu`; `DropdownMenu.types.ts` imports `MenuProps`) | not ported |
| `CardActionsProvider` / `useCardActions` | `@mui/material/Snackbar` | no ported equivalent (`feedback/Toast`, `feedback/Sonner` are web-only too) |
| `useRowConfirm` / `useRemoveConfirm` | `feedback/ConfirmAction` → `data-display/AlertDialog` | neither ported |
| `BodyHeading`, `DetailColumns`, `Fact`, `Ledger`, `TagList` | `@12-apps/ui/mui/Box` | raw MUI, web-only by design (see NATIVE.md's layout row) |

Only `rowActionsToMenuItems` is already platform-neutral — a pure array
transform that imports no renderer.

The TYPES are entangled the same way: `CardKit.types.ts` builds `KindCardProps`
and `KindListCardProps` on `CardAspectRatio` and `DataViewCardSelection` from
`../DataViews`, whose `data-views-types.ts` imports `DropdownMenuItem` from
`navigation/DropdownMenu`, which imports `MenuProps` from `@mui/material/Menu`.
A native entry would emit that chain into `dist/types-native`, where
`pnpm native:check` refuses any `@mui/*` import — a native consumer has nothing
to resolve one against.

## Why not a partial port

Porting only the five layout parts and leaving the kebab, the provider and the
two confirm hooks out would put a `react-native` condition on the subpath while
four of its names resolved to `undefined` under Metro. That trades a loud
module-level failure naming `@mui/material` for a render-time "Element type is
invalid" that names nothing — the exact swap `NATIVE.md` argues against.

## What porting it actually costs

`navigation/DropdownMenu`, `data-display/AlertDialog`, `feedback/ConfirmAction`
and a native snackbar, ported first — three categories, none of them in this
batch, and none of them claimed by a parallel one. CardKit follows them; it is
not the unit of work.
