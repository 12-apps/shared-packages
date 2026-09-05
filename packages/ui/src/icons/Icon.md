# Icon

One glyph name, both renderers.

```tsx
import { Icon } from '@12-apps/ui/icons';

<Icon name="Close" size="sm" color="neutral" label="Fechar" />
```

The web `Icon` is MUI's `SvgIcon` drawing a path; the native `Icon` is
`react-native-svg` drawing the same path in the same 24-unit box. The path data
is **generated** from the installed `@mui/icons-material` by
`scripts/generate-icon-paths.mjs` into `src/icons/paths.generated.ts`, from the
list in `src/icons/glyphs.json`. Adding a glyph is one line there and
`pnpm icons:generate`; `pnpm icons:check` fails CI when the two drift.

| prop | type | notes |
|---|---|---|
| `name` | `IconName` | one of `glyphs.json` |
| `size` | `xs` `sm` `md` `lg` `xl` or a px number | 16, 20, 24 (MUI's default), 32, 40 |
| `color` | a house colour, `inherit`, or any CSS colour | `inherit` is the surrounding text on the web and the theme's primary text on native, which has no `currentColor` |
| `label` | `string` | the accessible name; omit for a decorative glyph, which is then `aria-hidden` on both sides |
| `testID` / `dataTestId` | `string` | defaults to `icon-<name>` |

Inside the package, a ported component draws its own glyphs through this
component rather than importing `@mui/icons-material` directly, so its native
twin can draw the same one.
