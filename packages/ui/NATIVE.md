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
Ported: **7 of 140** public subpaths carry a `react-native` condition.

| subpath | shared stories run natively | skipped (`native-skip`) | known gaps |
|---|---|---|---|
| `@12-apps/ui/tokens` | 0 | 0 | — |
| `@12-apps/ui/provider` | 0 | 0 | — |
| `@12-apps/ui/icons` | 8 | 0 | — |
| `@12-apps/ui/layout/Box` | 7 | 1 | — |
| `@12-apps/ui/layout/Stack` | 6 | 0 | — |
| `@12-apps/ui/typography/Text` | 26 | 3 | — |
| `@12-apps/ui/form/Button` | 24 | 2 | — |
<!-- native-parity:end -->
