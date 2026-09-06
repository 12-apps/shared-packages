# Input on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- The label sits ABOVE the field at its shrunk size (12px, aligned with the value's own left inset) instead of floating into a notch in the border: React Native can neither cut a notch in a border nor animate a label into one, so `floating` has nothing left to move.
- `filled` keeps MUI's lopsided `25px 12px 8px` inset, which on the web is where the floating label sits inside the box — so a native filled field reads low in its box, with the label above it.
- `glass` paints its 0.1 paper wash and hairline without the 20px backdrop blur (React Native has no backdrop filter), and draws ONE border where the web draws two — its own on the field root, plus the outlined fieldset's underneath.
- `gradient` paints the first stop of its 135° fill flat and gives the 2px ring the gradient's first hue: React Native core has no gradient fill and no masked pseudo-element border.
- Hover has no touch equivalent, so the web's hover border, its brighter glass wash and its deeper filled wash are not drawn; focus is, and it carries the same colours.
- `pulse` grows by scaling the bar rather than spreading a box-shadow, which React Native does not have; `glow` is a shadow on iOS and an elevation on Android, so its halo is not symmetrical there.
- `onClick` fires from the DOM click under react-native-web and from `onPressIn` on a device — react-native-web forwards only the first and React Native only the second, so exactly one runs and never both.
- Enter keeps focus (`blurOnSubmit={false}`), as it does in a web `<input>`; React Native's own default for a single-line field is to dismiss the keyboard, and a caller wanting that passes its own.
- An HTML `type` React Native has no keyboard for (`date`, `time`, `file`, `color`) renders a plain text field; `text`, `search`, `email`, `tel`, `url` and `number` pick the keyboard and `password` sets secure entry.
- The value, label and helper text are set in MUI's own numbers (`body1` at 16px on a 23px line, the 0.75 shrunk label, `caption` at 12px); a host that re-themes MUI's typography variants moves the web only.
