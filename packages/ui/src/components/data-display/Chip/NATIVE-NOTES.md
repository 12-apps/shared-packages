# Chip on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- Hover has no touch equivalent, so a press stands in for it: the chip takes MUI's hover wash (`palette[color].dark` filled, `alpha(main, 0.04)` outlined) while pressed, but not this package's own 1px lift or the `0 4px 12px` shadow under it, which are `:hover`-only.
- The keyboard contract — Enter and Space activate, Delete and Backspace remove — is shared (`chipKeyAction`) and answered under react-native-web, half by its `Pressable` and half by the chip's own handler. On a DEVICE none of it runs: React Native delivers no key events to a `View`, so a chip there is pressed and removed by touch.
- MUI restyles the leading icon ELEMENT through a class — 24px, 18px when small, and `inherit` ink on a coloured chip. A native renderer cannot restyle an arbitrary node, so the slot carries MUI's margins and the glyph keeps the size and colour it was given.
- An `avatarSrc` is drawn as a round `Image` at MUI's 24px (18px small) box; MUI's own `Avatar` additionally shows an initials fallback and repaints itself in `primary.dark`/`secondary.dark` for those two colours.
- MUI's `transition: background-color, box-shadow` and this package's `all 0.2s cubic-bezier(0.4, 0, 0.2, 1)` have no equivalent: a colour change is drawn immediately.
- A keyboard activation (Space on a selectable chip, Delete on a deletable one) fires `onClick` and `onDelete` but not `onPress`: it only exists under react-native-web, where the chip synthesizes the activation `Pressable` will not, and so has no `GestureResponderEvent` to pass. A press on a device fires both.
