# LoadingState on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- The spinner is the platform's `ActivityIndicator`, not MUI's 3.6-unit arc: same diameter and primary colour, the platform's own stroke; on iOS the two built-in sizes stand in for the five (`md` and up draw `large`).
- The skeleton rows are the static tint (`alpha(text.primary, 0.13)`); MUI's `wave` sweep is a gradient pseudo-element React Native cannot draw.
- The message is set in MUI's default `body2`/`body1`/`h6` numbers; a host that re-themes MUI's typography variants moves the web only.
