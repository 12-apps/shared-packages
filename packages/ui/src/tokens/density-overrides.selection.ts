import { switchClasses } from '@mui/material/Switch/index.js';
import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { rem, rems } from './relative';

/**
 * CHECKBOX / RADIO / SWITCH GEOMETRY, DENSITY-AWARE (FUT-2767).
 *
 * `Checkbox`/`Radio`/`Switch` are MUI's own components, unwrapped — but
 * **only two of the three `@12-apps/ui` wrappers actually forward their
 * geometry to MUI**, corrected here after an earlier revision of this doc
 * comment claimed all three did.
 *
 * - `Checkbox.tsx`'s `StyledCheckbox` and `RadioGroup.variants.tsx`'s
 *   `DefaultRadios` (the ONLY variant rendering a raw `<Radio>` — `cards`/
 *   `buttons`/`segments` draw custom controls, outside this ticket) set NO
 *   `padding` of their own, so `checkboxRadioDensityOverrides()` reaches
 *   both directly — confirmed by a real render, same computed padding as
 *   raw `MuiCheckbox`/`MuiRadio` at both densities
 *   (`density-overrides.test.stories.tsx`'s `ui-checkbox`/`ui-radio-group`).
 * - `Switch.styles.ts`'s `switchSx` is DIFFERENT: it draws root/switchBase/
 *   thumb geometry itself, per instance, from its own `SWITCH_SIZES` table
 *   (`Switch.metrics.ts`), every number already through `rem(theme, px)`.
 *   `Switch.parts.tsx`'s `StyledSwitch = styled(MuiSwitch, {...})(...)`
 *   composes these as an OUTER wrapper class whose nested `& .MuiSwitch-
 *   switchBase`/`& .MuiSwitch-thumb` selectors are a TWO-class compound —
 *   higher specificity than this file's `MuiSwitch.styleOverrides.
 *   switchBase`/`thumb`, which compose onto a single-class generated class.
 *   `switchDensityOverrides()` therefore has **NO effect on `@12-apps/ui`'s
 *   own `<Switch>`** — it only reaches a raw `@mui/material/Switch` consumer
 *   (a host's own `Table.tsx` density-toggle column, say). Not a gap:
 *   `switchSx` already reacts to `theme.typography.fontSize` on its own —
 *   including the CHECKED thumb's own travel distance, computed as
 *   `rem(theme, width - thumbSize - padding * 2)` from the SAME per-instance
 *   geometry, so it moves consistently with no help from this file.
 *   Confirmed by measurement, both sizes, both states, both densities
 *   (`ui-switch-*` cases); documented at `Switch.md`'s "Density" section.
 *
 * **The ticket's open question — does a `MuiSwitchBase` theme override reach
 * `Checkbox`/`Radio` at all? — is NO, verified two ways.** `Checkbox`/`Radio`
 * both render through `internal/SwitchBase.js`'s `SwitchBaseRoot`, which is
 * `styled(ButtonBase, { name: 'MuiSwitchBase' })({ padding: 9, ... })` — with
 * NO `slot` key. `@mui/system`'s `createStyled.js` computes
 * `overridesResolver = defaultOverridesResolver(lowercaseFirstLetter(slot))`,
 * and `defaultOverridesResolver` (`if (!slot) return null`) returns `null`
 * for an absent slot; the styled call itself then only pushes its
 * `styleThemeOverrides` expression `if (componentName && overridesResolver)`
 * — `null` is falsy, so for THIS styled call `theme.components.MuiSwitchBase
 * .styleOverrides` is never read at all. (`variants` is a SEPARATE check,
 * gated on `skipVariantsResolver` rather than `overridesResolver`, which is
 * why the ticket's own two-part specificity proof for Chip's label — probing
 * with `variants` — does not transfer here; `styleOverrides` is what dies.)
 * A render-level probe confirms it: a theme with `components.MuiSwitchBase
 * .styleOverrides.root = { padding: '999px' }`, rendering `<Switch />`,
 * `<Checkbox />` and `<Radio />` through it, leaves EVERY ONE of `.MuiSwitch-
 * switchBase`, `.MuiCheckbox-root` and `.MuiRadio-root` at their unthemed
 * padding (`9px`/`4px` — see below), never `999px`. The Decision's own
 * suggested `MuiSwitchBase` route is therefore the ticket's documented
 * fallback in disguise: this file skips straight to duplicating the override
 * under `MuiCheckbox` and `MuiRadio`, each independently confirmed LIVE by
 * the same probe (`components.MuiCheckbox.styleOverrides.root.padding` DOES
 * reach `.MuiCheckbox-root`, and the same for `MuiRadio`).
 *
 * - `Checkbox`/`Radio` (`internal/SwitchBase.js`, `Checkbox.js`, `Radio.js`):
 *   `padding: 9` — constant across `size="small"`/`"medium"` today (neither
 *   `CheckboxRoot` nor `RadioRoot` carries a size-conditional padding rule),
 *   so ONE `root` override, no `sizeSmall`/`sizeMedium` split, covers both
 *   sizes without disturbing the glyph-driven size difference FUT-2585 left
 *   alone.
 * - `Switch` (`Switch.js`): root (the track) `width: 34+12*2`, `height:
 *   14+12*2`, `padding: 12` (medium); `switchBase` (the thumb's absolutely-
 *   positioned wrapper) — its OWN literal is NOT the `12` the ticket's
 *   Decision sketch names (that `12` is `SwitchRoot`'s own padding, a
 *   DIFFERENT slot); `switchBase` inherits `internal/SwitchBase.js`'s generic
 *   `padding: 9` unmodified at medium (`SwitchSwitchBase`'s own styles never
 *   set `padding`), confirmed by the same render probe with NO theme
 *   override at all (`.MuiSwitch-switchBase` computed padding: `9px`). This
 *   file overrides `MuiSwitch.styleOverrides.switchBase` (a LIVE key —
 *   `SwitchSwitchBase = styled(SwitchBase, { name: 'MuiSwitch', slot:
 *   'SwitchBase', ... })` DOES pass a `slot`) with `rem(theme, 9)`, the
 *   MEASURED default, not the ticket's `12` — using `12` here would move
 *   today's real 9px to 12px at `density: 'normal'`, failing the Done-when's
 *   own pixel-identical requirement, so the number is corrected against the
 *   probe rather than the sketch. `thumb`: `20×20`, unconditional.
 * - `Switch` `size="small"` (`:82-100`, a `variants` entry on `SwitchRoot`
 *   itself): root `width: 40`, `height: 24`, `padding: 7`; a NESTED `&
 *   .${switchClasses.switchBase}` selector sets `padding: 4` (not 9); a
 *   NESTED `& .${switchClasses.thumb}` selector sets `20×20` down to
 *   `16×16`. Both nested rules are baked into `SwitchRoot`'s OWN generated
 *   class at TWO-class specificity (the size-small instance's unique class,
 *   plus `.MuiSwitch-switchBase`/`.MuiSwitch-thumb`) — exactly the Chip
 *   outlined-label shape this file already has above, and the SAME failure
 *   mode Lesson 1 warns about: a FLAT `styleOverrides.switchBase`/`thumb`
 *   (one class) cannot out-specificity it, so at `size="small"` it would
 *   silently keep rendering MUI's unthemed `4px`/`16×16` at every density,
 *   the click target and thumb staying full-size while the track around them
 *   shrank. Fixed the same way: `sizeSmall`'s OWN nested `& .${switchClasses
 *   .switchBase}` / `& .${switchClasses.thumb}` rules, read through
 *   `switchClasses` (not a hand-typed selector string) for the same
 *   `ClassNameGenerator.configure` reason `chipClasses` is above, inserted
 *   as part of the SAME `sizeSmall` override object so they land AFTER
 *   `SwitchRoot`'s own baked-in small variant in the generated class's CSS
 *   text (later wins at matching two-class specificity) rather than trying
 *   to out-specificity it from a different slot.
 *
 * **The checked thumb's own travel distance is a FOURTH literal, found only
 * on adversarial review of the PR this doc comment first shipped in.**
 * `SwitchSwitchBase`'s base style bakes in `&.Mui-checked { transform:
 * translateX(20px) }` (medium), and `SwitchRoot`'s `size: 'small'` variant
 * nests the same at `16px` — both bare, never run through `pxToRem`, so at
 * `density: 'compact'` the checked thumb kept travelling the FULL, unscaled
 * distance while the track around it shrank ×0.9 — a visible overshoot.
 * `switchSwitchBasePadding`/`switchSizeSmall` each now carry their own
 * `&.${switchClasses.checked}` rule (`translateX(rem(theme, 20))`/`rem(theme,
 * 16)`), composed onto the SAME generated class, in the SAME position
 * `padding` already occupies — so it wins by the identical mechanism, not a
 * new one. Proven at the pixel level, both sizes/densities: `switch-md-
 * checked`/`switch-sm-checked` measure the thumb's final position against
 * the track's own edge, not just the transform string.
 *
 * At `density: 'normal'` every number above computes back to the literal it
 * replaces (`rem(theme, 9)` is `0.5625rem`, `9px` at the 16px root — no
 * visible change), the same geometry-neutral guarantee `iconButtonDensity
 * Overrides`/`chipDensityOverrides` give above. The same non-default-
 * `fontSize` caveat those two give applies here unchanged: `rem()` only ever
 * reads `theme.typography.fontSize`, so a host adopting
 * `checkboxRadioDensityOverrides`/`switchDensityOverrides` standalone moves
 * every number here by that one coefficient, same as everything else `rem()`
 * touches.
 */

const checkboxRadioRootPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 9) });

/**
 * `MuiCheckbox`/`MuiRadio`'s own padding — duplicated under both component
 * keys, the ticket's own documented fallback, since `MuiSwitchBase` cannot
 * reach either (see the module doc comment above). One module-level function
 * shared by both keys, and by `checkboxRadioDensityOverrides()`'s own two
 * calls across the two theme-build paths, for the same identity reason the
 * rest of this file's slots are module-level.
 */
export function checkboxRadioDensityOverrides(): Components<Theme> {
  return {
    MuiCheckbox: { styleOverrides: { root: checkboxRadioRootPadding } },
    MuiRadio: { styleOverrides: { root: checkboxRadioRootPadding } },
  };
}

const switchRootGeometry = ({ theme }: { theme: Theme }): CSSObject => ({
  width: rems(theme, 34 + 12 * 2),
  height: rems(theme, 14 + 12 * 2),
  padding: rem(theme, 12),
});
const switchSwitchBasePadding = ({ theme }: { theme: Theme }): CSSObject => ({
  padding: rem(theme, 9),
  // FUT-2767 (adversarial-review fix) — `SwitchSwitchBase`'s OWN base style
  // (`Switch.js`, medium) bakes in `&.Mui-checked { transform:
  // translateX(20px) }`, a bare literal never run through `pxToRem` — at
  // `density: 'compact'` the track/padding/thumb above all shrink ×0.9 but
  // this offset stayed at a full 20px, so the checked thumb overshot the now-
  // smaller track. Composed onto the SAME generated class as that base style,
  // AFTER it (`createStyled` composes `styleThemeOverrides` after a slot's
  // own base/variants — see the module doc comment), so this nested rule
  // wins at the SAME (two-class, `.<hash>.Mui-checked`) specificity, the same
  // mechanism this function's own `padding` line already relies on.
  [`&.${switchClasses.checked}`]: { transform: `translateX(${rem(theme, 20)})` },
});
const switchThumbSize = ({ theme }: { theme: Theme }): CSSObject => ({
  width: rem(theme, 20),
  height: rem(theme, 20),
});
const switchSizeSmall = ({ theme }: { theme: Theme }): CSSObject => ({
  width: rem(theme, 40),
  height: rem(theme, 24),
  padding: rem(theme, 7),
  // Higher (two-class) specificity than the flat `switchBase`/`thumb`
  // overrides above, inserted as part of THIS SAME generated class — see the
  // module doc comment for why a flat override cannot reach these at
  // `size="small"` on its own.
  [`& .${switchClasses.switchBase}`]: {
    padding: rem(theme, 4),
    // Same overshoot as medium's, at `size="small"`'s OWN literal
    // (`SwitchRoot`'s baked-in `size: 'small'` variant, `Switch.js`:
    // `translateX(16px)`). Nested one level deeper so the compiled selector
    // is `.<root-hash> .MuiSwitch-switchBase.Mui-checked` — the same THREE-
    // class descendant compound MUI's own baked-in small variant uses for
    // this rule, composed after it in the same generated class, so it wins
    // at matching specificity the same way the sibling `padding: rem(theme,
    // 4)` line above already does.
    [`&.${switchClasses.checked}`]: { transform: `translateX(${rem(theme, 16)})` },
  },
  [`& .${switchClasses.thumb}`]: { width: rem(theme, 16), height: rem(theme, 16) },
});

/**
 * `MuiSwitch`'s own track (root), thumb wrapper (switchBase) and thumb
 * (thumb) geometry, at both sizes MUI has.
 */
export function switchDensityOverrides(): Components<Theme> {
  return {
    MuiSwitch: {
      styleOverrides: {
        root: switchRootGeometry,
        switchBase: switchSwitchBasePadding,
        thumb: switchThumbSize,
        sizeSmall: switchSizeSmall,
      },
    },
  };
}
