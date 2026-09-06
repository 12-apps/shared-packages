# Progress on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- `gradient` paints its first stop (`main`) flat: React Native core has no gradient fill, so the 90° run to `dark` is lost. `glass` keeps the 80% wash and the 30% hairline but not the 10px backdrop blur, which React Native has no equivalent of.
- `glow` draws the web's `0 0 10px 2px alpha(main, 0.4)` shadow (and `0 0 6px 1px` on a filled segment) but not the `filter: brightness(1.1)` that goes with it, nor the circular variant's `drop-shadow` — the dial takes a box shadow round its square instead.
- The indeterminate linear bar is ONE band a third of the track wide crossing every 2.1s; MUI runs two bars on two keyframe tracks. The indeterminate dial spins a quarter-circle arc once every 1.4s rather than growing and shrinking it.
- The determinate bar is a clamped WIDTH; MUI translates a full-width bar by `value - 100`%. The two agree between 0 and 100 — outside it the web slides the bar off the track and native stops at the ends.
- MUI's `transition: all 0.3s ease` on the bar and on every segment has no equivalent: a value change is drawn immediately.
- The label is set in MUI's default `caption` ratios at the size's own step; a host that re-themes MUI's typography variants moves the web only.
