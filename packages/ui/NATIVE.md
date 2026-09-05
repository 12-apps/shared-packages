# `@12-apps/ui` on React Native

The same component names, the same import paths, a second renderer.

```ts
import { Button } from '@12-apps/ui/form/Button';   // MUI in a Vite SPA, React Native under Metro
import { UiProvider } from '@12-apps/ui/provider';  // one provider name on both sides
```

Nothing in an app says which platform it is on. The switch is a **`react-native`
export condition**: every ported subpath in `package.json#exports` carries one,
pointing at `dist/native/`, ahead of the `default` that points at the MUI build.
Metro asserts that condition (React Native 0.79+ / Expo SDK 53+ resolve package
exports by default); Vite, Vitest and Next never do, so the three SPAs and every
web consumer keep exactly the build they had. A subpath that is **not** ported
has no condition — under Metro it resolves to the web file and fails at import on
`@mui/material`, loudly, instead of rendering a blank view.

## What "the same component" means

| the contract | where it lives |
|---|---|
| **Name and import path** | `entries.native.json` maps each ported subpath to an `index.native.ts`; `scripts/sync-exports.mjs` writes the condition. |
| **Props** | `X.base.ts` holds `XBaseProps`, the platform-neutral contract, and imports neither MUI nor react-native (it ships in both declaration outputs). `X.types.ts` builds the web `XProps` on it (MUI extras); `X.types.native.ts` builds the native `XProps` on it (the react-native element's own props). Handler names stay the web's (`onClick`); their event types are the renderer's. `sx` is web-only, `style` is native-only. |
| **Numbers** | `X.metrics.ts` beside a component: px, ratios and alphas both renderers read. The web derives its `rem` strings from it (`px()` in `src/tokens/theme.ts`); native uses the numbers. |
| **Theme** | `src/tokens/theme.ts` — `UiTheme`, a plain object. `createUiTheme` derives shades with the SAME arithmetic as MUI's `createPalette` (`src/tokens/color.ts` is a port of MUI's colour manipulator, asserted equal to it in `src/tokens/__tests__`). On the web `useUiTheme()` READS the host's MUI theme (`src/provider/mui-bridge.ts`); on native it reads `UiProvider`. |
| **Icons** | `@12-apps/ui/icons` — `<Icon name="Close" />` on both sides. The path data is generated from the installed `@mui/icons-material` (`pnpm icons:generate`), so the native glyph is the web glyph. |
| **Layout** | `@12-apps/ui/layout/Box` and `layout/Stack`: the neutral layout props (`p`, `gap`, `direction`, `align`, `bg`, `radius`…) on the spacing scale, one resolver (`box-layout.ts`) feeding `sx` on the web and `style` on native. `@12-apps/ui/mui/Box` and `mui/Stack` are raw MUI and stay **web-only**. |

## How a component is ported

1. Move `XBaseProps` into `X.base.ts` (no MUI, no react-native imports); keep the web `XProps` in `X.types.ts`; add `X.types.native.ts`.
2. Move every number the web styles use into `X.metrics.ts` and make the web read it.
3. Write `X.native.tsx` on `react-native` primitives and `useUiTheme()`. Import
   siblings explicitly as `./Y.native` — no `moduleSuffixes` magic, so the
   emitted declarations resolve for a consumer without special tsconfig.
4. Add `index.native.ts` re-exporting from `./X.native`, and the subpath to
   `entries.native.json`. Run `pnpm exports:sync`.
5. Run the SAME stories against it: `pnpm storybook:native` (or `pnpm test:native:ci`).
   A test story that asserts something only a DOM can answer (`toBeDisabled()`
   on a real `<button>`, a computed CSS `transform`) gets `tags: ['native-skip']`
   — it still runs in the web Storybook, and the ledger below counts it.
6. Add `X.native.test.tsx` for what the stories do not cover. `pnpm test:native`.
7. Note any honest rendering gap in `NATIVE-NOTES.md` beside the component
   (one `- ` bullet each). `pnpm native:ledger` regenerates the table below.

The lint rule in `eslint.config.js` and the esbuild plugin in
`tsup.native.config.ts` both refuse `@mui/*`, `@emotion/*` and `react-dom` from a
`*.native.*` file, so a web import cannot reach Metro by accident.

## Testing

| lane | command | what it proves |
|---|---|---|
| web unit tests | `pnpm test` | the default config, unchanged, plus the MUI-parity tests for `color.ts`, `theme.ts` and the bridge |
| native unit tests | `pnpm test:native` | `*.native.test.tsx` through react-native-web in jsdom, with `@testing-library/react`; run by the `Native` CI lane, not by `pnpm test`, so it runs once |
| native Storybook | `pnpm storybook:native` / `pnpm test:native:ci` | the shared `*.stories.tsx` and `*.test.stories.tsx` rendered through react-native-web, `play` functions included |
| real Metro | `harness/native` | the PUBLISHED tarball bundled by Expo for web and android, driven by Playwright |
| type checks | `pnpm check-types` | three programs: the web (`tsconfig.json`, DOM lib), the native renderer (`tsconfig.native.json`, **no** DOM lib — a native file that touches `document` is a type error) and the native tests (`tsconfig.native.test.json`, DOM lib again, because they query a jsdom) |
| ledger | `pnpm native:check` | the table below matches the sources; the generated icon paths match the installed icons |

react-native-web is a faithful renderer for structure, roles, test ids and
style resolution; it is not a device. Yoga layout on a real platform, gestures
and platform fonts are what the harness is for.

## Consumer setup

An Expo (SDK 53+) or React Native (0.79+) app needs nothing: Metro resolves the
condition. On an older Metro, set `resolver.unstable_enablePackageExports = true`
and include `'react-native'` in `resolver.unstable_conditionNames`. TypeScript
picks the native declarations when `compilerOptions.customConditions` includes
`"react-native"` (Expo's base tsconfig does); without it the web declarations
are used and the component still renders — only the renderer-specific extras
(`style` vs `sx`) are mis-typed.

Peer dependencies on native: `react-native` and `react-native-svg` (for
`@12-apps/ui/icons`). Both are declared optional so a web consumer never
installs them.

## Ledger

<!-- native-parity:start -->
Ported: **18 of 140** public subpaths carry a `react-native` condition.

| subpath | shared stories run natively | skipped (`native-skip`) | known gaps |
|---|---|---|---|
| `@12-apps/ui/tokens` | 0 | 0 | — |
| `@12-apps/ui/provider` | 0 | 0 | — |
| `@12-apps/ui/icons` | 8 | 0 | — |
| `@12-apps/ui/data-display/Alert` | 41 | 2 | `glass` paints its 0.85 paper wash and hairline without the 20px backdrop blur and saturation — React Native has no backdrop filter.; `gradient` paints its first stop (`alpha(light, 0.9)`) flat and has no shimmer sweep — React Native core has no gradient fill and no pseudo-elements.; Hover, active and focus-within (the lift, the hue shadow, the icon tilt, the focus ring) have no touch equivalent; the close button's pressed state stands in for its hover.; The hairline the web draws around a `Button` placed inside the message is a descendant selector; native children are rendered as given. Consecutive text children DO flow as one sentence (`src/platform/text-children.tsx`); an element child breaks the run, as a block would on the web.; After dismissal the web keeps a collapsed, hidden node in the DOM; native unmounts once the 300ms collapse has run.; Title, description and children are set in MUI's default `body1`/`body2` numbers; a host that re-themes MUI's typography variants moves the web only. |
| `@12-apps/ui/data-display/Chip` | 25 | 0 | Hover has no touch equivalent, so a press stands in for it: the chip takes MUI's hover wash (`palette[color].dark` filled, `alpha(main, 0.04)` outlined) while pressed, but not this package's own 1px lift or the `0 4px 12px` shadow under it, which are `:hover`-only.; The keyboard contract — Enter and Space activate, Delete and Backspace remove — is shared (`chipKeyAction`) and answered under react-native-web, half by its `Pressable` and half by the chip's own handler. On a DEVICE none of it runs: React Native delivers no key events to a `View`, so a chip there is pressed and removed by touch.; MUI restyles the leading icon ELEMENT through a class — 24px, 18px when small, and `inherit` ink on a coloured chip. A native renderer cannot restyle an arbitrary node, so the slot carries MUI's margins and the glyph keeps the size and colour it was given.; An `avatarSrc` is drawn as a round `Image` at MUI's 24px (18px small) box; MUI's own `Avatar` additionally shows an initials fallback and repaints itself in `primary.dark`/`secondary.dark` for those two colours.; MUI's `transition: background-color, box-shadow` and this package's `all 0.2s cubic-bezier(0.4, 0, 0.2, 1)` have no equivalent: a colour change is drawn immediately. |
| `@12-apps/ui/data-display/EmptyState` | 23 | 0 | The actions are house `Button`s (solid/outline, `sm`) sized to MUI's medium contained and outlined buttons — same padding, 14px type, radius, half-alpha border, elevation-2 shadow, 20px icon and 120px floor; MUI additionally uppercases the label and sets the icon 8px from the label where the house button sets 4.; The help link opens through `Linking.openURL` on a device; `target`/`rel` are web-only and reach the DOM through react-native-web's anchor.; Title, description and link are set in MUI's default `h6`/`body2`/`body1` numbers; a host that re-themes MUI's typography variants moves the web only. |
| `@12-apps/ui/data-display/ErrorState` | 13 | 0 | The retry is the house `Button` (outline, `sm`) sized to MUI's medium outlined button — same 5px/15px padding, 14px type, radius, 20px icon and 120px floor; MUI additionally uppercases the label, draws its border at `alpha(main, 0.5)`, and sets the icon 8px from the label where the house button sets 4.; Title and message are set in MUI's default `h6`/`body2` numbers; a host that re-themes MUI's typography variants moves the web only. |
| `@12-apps/ui/data-display/LoadingState` | 11 | 1 | The spinner is the platform's `ActivityIndicator`, not MUI's 3.6-unit arc: same diameter and primary colour, the platform's own stroke; on iOS the two built-in sizes stand in for the five (`md` and up draw `large`).; The skeleton rows are the static tint (`alpha(text.primary, 0.13)`); MUI's `wave` sweep is a gradient pseudo-element React Native cannot draw.; The message is set in MUI's default `body2`/`body1`/`h6` numbers; a host that re-themes MUI's typography variants moves the web only. |
| `@12-apps/ui/data-display/Progress` | 29 | 0 | `gradient` paints its first stop (`main`) flat: React Native core has no gradient fill, so the 90° run to `dark` is lost. `glass` keeps the 80% wash and the 30% hairline but not the 10px backdrop blur, which React Native has no equivalent of.; `glow` draws the web's `0 0 10px 2px alpha(main, 0.4)` shadow (and `0 0 6px 1px` on a filled segment) but not the `filter: brightness(1.1)` that goes with it, nor the circular variant's `drop-shadow` — the dial takes a box shadow round its square instead.; The indeterminate linear bar is ONE band a third of the track wide crossing every 2.1s; MUI runs two bars on two keyframe tracks. The indeterminate dial spins a quarter-circle arc once every 1.4s rather than growing and shrinking it.; The determinate bar is a clamped WIDTH; MUI translates a full-width bar by `value - 100`%. The two agree between 0 and 100 — outside it the web slides the bar off the track and native stops at the ends.; MUI's `transition: all 0.3s ease` on the bar and on every segment has no equivalent: a value change is drawn immediately.; The label is set in MUI's default `caption` ratios at the size's own step; a host that re-themes MUI's typography variants moves the web only. |
| `@12-apps/ui/form/Button` | 24 | 2 | — |
| `@12-apps/ui/layout/Box` | 7 | 1 | — |
| `@12-apps/ui/layout/Container` | 36 | 0 | `responsive` reads `useWindowDimensions().width < 600` in place of MUI's `sm` media query, and `centered` reads the window height in place of `100vh`; both track the window, as CSS would, but a container inside a narrower parent still measures the window, not the parent. |
| `@12-apps/ui/layout/Skeleton` | 21 | 4 | MUI's `wave` sweep and the `shimmer` overlay are gradient pseudo-elements travelling across the box; React Native core has neither, so both are drawn as the same wash (`action.hover` for the wave, `alpha(#fff, 0.3)` for the shimmer) fading in and out over the whole box on the web's own cadence — 1.6s linear after 0.5s for the wave, 2s for the shimmer.; `glassmorphism` paints the 135° gradient's first stop (`alpha(paper, 0.8)`) flat and keeps the hairline and the `0 8px 32px 0 rgba(0, 0, 0, 0.1)` shadow, but not the 20px backdrop blur — React Native has no backdrop filter.; The `text` variant is drawn at its FINAL height. MUI gives it a `1.2em` line box and squashes the box to 60% with `transform: scale(1, 0.6)`; React Native transforms do not change layout, so the two are multiplied out (11.52px at the theme's 16px body size) and the elliptical `4px/6.7px` radius the squash rounds off is drawn as the plain 4px it lands on.; `width`, `height` and `borderRadius` accept a number or a percentage; any other CSS length (`10rem`, `calc(…)`) has no React Native equivalent and leaves the box to size itself from its content. |
| `@12-apps/ui/layout/Spacer` | 21 | 1 | — |
| `@12-apps/ui/layout/Stack` | 6 | 0 | — |
| `@12-apps/ui/typography/Heading` | 26 | 1 | `gradient` paints the gradient's first stop as a flat colour: React Native has no `background-clip: text` and no gradient fill in core. A host wanting the real thing adds a masked-gradient library. |
| `@12-apps/ui/typography/Paragraph` | 17 | 1 | — |
| `@12-apps/ui/typography/Text` | 26 | 3 | — |
<!-- native-parity:end -->
