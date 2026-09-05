# Box

The layout primitive both renderers share.

`@12-apps/ui/mui/Box` is raw MUI: an `sx` prop and nothing a React Native
renderer could ever answer to. This `Box` is what a screen meant for both
platforms writes instead. Its props are a fixed vocabulary on the spacing
scale, and one resolver (`box-layout.ts`) turns them into the same numbers on
each side — `p={2}` is `theme.spacing(2)`, 16px on the web and 16dp on native.

```tsx
import { Box } from '@12-apps/ui/layout/Box';

<Box direction="row" gap={2} align="center" p={2} bg="paper" radius="lg" bordered>
  …
</Box>
```

## Props

| prop | type | notes |
|---|---|---|
| `p` `px` `py` `pt` `pr` `pb` `pl` | `number` | padding, in spacing units; the specific side wins over the axis, the axis over `p` |
| `m` `mx` `my` `mt` `mr` `mb` `ml` | `number` | margin, same rules |
| `gap` | `number` | between children; makes the box a flex container |
| `direction` | `row` `column` `row-reverse` `column-reverse` | makes the box a flex container (`column` when only `gap`/`align`/`justify` is set) |
| `align` | `start` `center` `end` `stretch` `baseline` | `alignItems` |
| `justify` | `start` `center` `end` `between` `around` `evenly` | `justifyContent` |
| `wrap` | `boolean` | `flexWrap: wrap` |
| `flex` | `number` | |
| `bg` | `default` `paper` `transparent` or a palette slot | a surface, or the slot's `main` |
| `radius` | `sm` `md` `lg` `xl` `full` | the theme's radius scale (2, 4, 8, 16 px by default) |
| `bordered` | `boolean` | a 1px border in the divider colour |
| `width` `height` | `number` `'auto'` `'50%'` | what both renderers accept as a size |
| `testID` / `dataTestId` | `string` | either spelling; rendered as `data-testid` on the web |

On the **web** every other prop of MUI's `Box` is accepted too, `sx` included —
it is applied after the resolved layout, so it still wins. On **native** the
extras are a `View`'s own (`style`, `onLayout`, `accessibilityLabel`…).

## What differs between renderers

A `View` is always a flex column; MUI's `Box` is a `div`, a block, until a
layout prop makes it flex. Children stack the same way in both, so the only
observable difference is `display` on a box with no layout props — which is
why the `BlockByDefault` test story is tagged `native-skip`.
