# Skeleton on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- MUI's `wave` sweep and the `shimmer` overlay are gradient pseudo-elements travelling across the box; React Native core has neither, so both are drawn as the same wash (`action.hover` for the wave, `alpha(#fff, 0.3)` for the shimmer) fading in and out over the whole box on the web's own cadence — 1.6s linear after 0.5s for the wave, 2s for the shimmer.
- `glassmorphism` paints the 135° gradient's first stop (`alpha(paper, 0.8)`) flat and keeps the hairline and the `0 8px 32px 0 rgba(0, 0, 0, 0.1)` shadow, but not the 20px backdrop blur — React Native has no backdrop filter.
- The `text` variant is drawn at its FINAL height. MUI gives it a `1.2em` line box and squashes the box to 60% with `transform: scale(1, 0.6)`; React Native transforms do not change layout, so the two are multiplied out (11.52px at the theme's 16px body size) and the elliptical `4px/6.7px` radius the squash rounds off is drawn as the plain 4px it lands on.
- `width`, `height` and `borderRadius` accept a number or a percentage; any other CSS length (`10rem`, `calc(…)`) has no React Native equivalent and leaves the box to size itself from its content.
