import { chipClasses } from '@mui/material/Chip/index.js';
import { switchClasses } from '@mui/material/Switch/index.js';
import type { Components, CSSObject, Theme } from '@mui/material/styles/index.js';

import { rem, rems } from './relative';

/** The `ownerState` fields `MuiChip`'s two styled slots (root, label) both receive. */
interface ChipOwnerStateForOverrides {
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
}

/**
 * ICONBUTTON / CHIP GEOMETRY, DENSITY-AWARE (FUT-2766).
 *
 * Both are MUI's own components, unwrapped: `@12-apps/ui` has no
 * `components/*` subpath for `IconButton`, and its `Chip` wrapper
 * (`components/data-display/Chip`) hands the drawing to `MuiChip` and adds
 * only hover/selection/transition `sx` — no geometry of its own (unlike
 * `Button`, which already draws every dimension through `rem()`,
 * `components/form/Button/Button.styles.ts`). So both draw MUI's OWN fixed-px
 * padding/height, verified against the installed `@mui/material@6.5.0` source:
 *
 * - `IconButton` (`node_modules/@mui/material/IconButton/IconButton.js`):
 *   `padding: 8` on the root (medium, the default), `padding: 5` at
 *   `size="small"`, `padding: 12` at `size="large"`. The icon's own `fontSize`
 *   is already relative (`pxToRem(18/24/28)`) — only `padding` was the gap.
 * - `Chip` (`node_modules/@mui/material/Chip/Chip.js`): `height: 32` on the
 *   root (medium, the default), `height: 24` at `size="small"`. The label's
 *   own side padding is a SEPARATE slot (`name: 'MuiChip', slot: 'Label'`,
 *   override key `label`/`labelSmall`) at `paddingLeft`/`paddingRight: 12`
 *   default, `8` at `size="small"` — restated in this package's own
 *   `Chip.metrics.ts` (`CHIP_SIZES`), which both renderers already read.
 *
 * Neither dimension moved when `theme.typography.fontSize` changed (they are
 * not written through `pxToRem`), so at `density: 'compact'` an
 * `IconButton`/`Chip` next to a now-smaller `Button` looked unchanged — the
 * visual regression FUT-2764 exists to fix. `rem(theme, px)` is the same
 * helper `Button.styles.ts` already uses, so `padding`/`height` move exactly
 * as far as `theme.typography.fontSize`'s coefficient does, and are
 * geometry-neutral at `density: 'normal'`: `rem(theme, 8)` at the unchanged
 * `fontSize: 14` renders to the same computed px as the literal `8` it
 * replaces.
 *
 * **The OUTLINED chip's own label padding (`11`/`7`, one px tighter than
 * filled's `12`/`8`) is a SEPARATE number this file must not clobber** — a
 * bug an earlier revision of this file had (a `styleOverrides.label`/
 * `labelSmall` of `12`/`8` unconditionally wins for EVERY variant, because
 * `ChipLabel`'s own `overridesResolver` (`Chip.js`) returns
 * `[styles.label, styles[label${size}]]` with no variant check at all, and
 * `@mui/system`'s `createStyled` composes `styleThemeOverrides` AFTER the
 * slot's own base styles/variants — so a theme `styleOverrides.label` always
 * outranks `ChipLabel`'s own baked-in `{ props: { variant: 'outlined' },
 * style: { paddingLeft: 11, ... } }`, at ANY density, not just a scaled one).
 * Fixed by putting the outlined fix on the ROOT slot instead, as a nested
 * `.MuiChip-label` selector inside `styleOverrides.root` itself, keyed on
 * `ownerState.variant`/`.size` — proven correct two ways: (1) a probe render
 * confirmed the naive `components.MuiChip.variants` route CANNOT reach the
 * label slot at all — `createStyled`'s `skipVariantsResolver` defaults to
 * `true` for every slot but `'Root'`, so a theme-level `variants` entry is
 * simply never evaluated for `ChipLabel`, proven by rendering an outlined
 * Chip against a `components.MuiChip.variants` entry set to an absurd
 * `999px` and reading `.MuiChip-label`'s OWN computed style: still `11px`,
 * untouched — while the SAME entry DOES leak onto `.MuiChip-root` (`999px`),
 * confirming theme `variants` is a ROOT-slot-only mechanism for this
 * component; (2) a nested `.MuiChip-label` selector written from the ROOT
 * slot is a HIGHER-specificity rule (two classes, `0,2,0`) than the label's
 * own single-class rule (`0,1,0`), so it wins regardless of source order —
 * the same technique `ChipRoot`'s OWN style already uses for its avatar/
 * icon/delete-icon sub-parts (`& .${chipClasses.avatar}`, etc., in
 * `Chip.js`), and read through the SAME `chipClasses` MUI's own `Chip.js`
 * generates the real DOM class from, not a hand-typed copy of it.
 *
 * **That same higher specificity also outranks a HOST's own theming.** A
 * host writing `theme.components.MuiChip.styleOverrides.label` for its own
 * reasons (`0,1,0`) does not win against the outlined rule here (`0,2,0`) —
 * not a bug specific to this file, `ChipLabel`'s OWN baked-in outlined
 * variant already outranked a plain `styleOverrides.label` the same way,
 * before this file existed. A host that needs to change OUTLINED label
 * padding specifically cannot do it through `styleOverrides.label`/
 * `labelSmall` at all; it reaches it through `sx` (a per-instance override,
 * highest specificity of all) or its OWN `MuiChip.styleOverrides.root`
 * function written out in full — `mergeMuiComponents` replaces `root`
 * WHOLESALE when both sides set it (see `./density.ts`'s own doc comment),
 * so a host adding to it must restate `chipRootHeight`'s own height logic
 * alongside its outlined-label change, not merely add a sibling key.
 *
 * The avatar/icon/delete-icon sub-slots (margins, sizes) and IconButton's
 * `edge="start"`/`"end"` negative margins are DELIBERATELY untouched by this
 * file — real override keys exist, but none is in the ticket's Done-when nor
 * exercised by a call site this initiative is chasing, so they stay MUI's
 * own literals at every density (including `compact`/`comfortable` — they do
 * NOT scale here; a future ticket that needs them scaled adds its own
 * override, the way `field-height.ts`'s siblings each own one slot).
 *
 * A host that adopts `iconButtonDensityOverrides`/`chipDensityOverrides`
 * standalone (the `@12-apps/ui/tokens` export, no density channel involved)
 * sees the SAME scaling from its own `typography.fontSize` alone — `rem()`
 * only ever reads that one theme number, so a theme with a non-default
 * `fontSize` (set directly, with no `density` in the picture at all) moves
 * these numbers exactly as it moves everything else written through `rem()`.
 *
 * Each slot below is a MODULE-LEVEL function, not a closure built fresh inside
 * `iconButtonDensityOverrides`/`chipDensityOverrides` — the same reason
 * `field-height.ts`'s `restingEdge` is one: two themes built from the same
 * options (the `muiThemeOptionsFrom` and `densityThemeOptions` paths, in
 * particular) must compare equal, and a fresh arrow function per call would
 * make them differ on nothing but identity.
 */

const iconButtonRootPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 8) });
const iconButtonSmallPadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 5) });
const iconButtonLargePadding = ({ theme }: { theme: Theme }): CSSObject => ({ padding: rem(theme, 12) });

/** `MuiIconButton`'s own padding, at every size MUI has. */
export function iconButtonDensityOverrides(): Components<Theme> {
  return {
    MuiIconButton: {
      styleOverrides: {
        root: iconButtonRootPadding,
        sizeSmall: iconButtonSmallPadding,
        sizeLarge: iconButtonLargePadding,
      },
    },
  };
}

/** MUI's own outlined-label paddings (`ChipLabel`'s baked-in `variants`, `Chip.js`). */
const CHIP_OUTLINED_LABEL_PADDING = { medium: 11, small: 7 } as const;

const chipRootHeight = ({
  theme,
  ownerState,
}: {
  theme: Theme;
  ownerState?: ChipOwnerStateForOverrides;
}): CSSObject => {
  const style: CSSObject = { height: rem(theme, 32) };
  if (ownerState?.variant === 'outlined') {
    const px = CHIP_OUTLINED_LABEL_PADDING[ownerState.size === 'small' ? 'small' : 'medium'];
    // Higher CSS specificity than `.MuiChip-label`'s own single-class rule
    // (two classes vs one) — wins over `chipLabelPadding`/`chipLabelSmallPadding`
    // below regardless of stylesheet insertion order. See the module doc
    // comment for why this must live here and not on the label slot itself.
    // `chipClasses.label`, not a hand-typed `.MuiChip-label` string — the same
    // module `Chip.js`'s own root style reads for its avatar/icon/delete-icon
    // selectors, so this tracks whatever `Chip.js` itself puts on the label
    // element rather than a separately-maintained copy of it. A host that
    // calls `ClassNameGenerator.configure` before any `MuiChip` module loads
    // renames the real class; a literal string would silently stop matching
    // it, `chipClasses.label` cannot.
    style[`& .${chipClasses.label}`] = { paddingLeft: rem(theme, px), paddingRight: rem(theme, px) };
  }
  return style;
};
const chipSmallHeight = ({ theme }: { theme: Theme }): CSSObject => ({ height: rem(theme, 24) });
const chipLabelPadding = ({ theme }: { theme: Theme }): CSSObject => ({
  paddingLeft: rem(theme, 12),
  paddingRight: rem(theme, 12),
});
const chipLabelSmallPadding = ({ theme }: { theme: Theme }): CSSObject => ({
  paddingLeft: rem(theme, 8),
  paddingRight: rem(theme, 8),
});

/** `MuiChip`'s own height (root) and label side padding (label), at both sizes MUI has. */
export function chipDensityOverrides(): Components<Theme> {
  return {
    MuiChip: {
      styleOverrides: {
        root: chipRootHeight,
        sizeSmall: chipSmallHeight,
        label: chipLabelPadding,
        labelSmall: chipLabelSmallPadding,
      },
    },
  };
}

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
