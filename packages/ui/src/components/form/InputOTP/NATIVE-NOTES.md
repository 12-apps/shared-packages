# InputOTP on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- A whole code reaches the slots only through the FIRST one. The web also catches a paste into that slot as a `paste` event; React Native has none, so a paste (or the keyboard's SMS suggestion) arrives as one text change, which the first slot's `maxLength` of `length + 1` lets through whole and the shared rules spread — the same path the web's SMS fill takes. A paste into any other slot is cut to one character by its `maxLength` of 1, on both renderers.
- The one-time-code fill is asked for per platform: `textContentType="oneTimeCode"` on iOS, `autoComplete="sms-otp"` on Android, `autoComplete="one-time-code"` under react-native-web. The web's `pattern="[0-9]*"` has no React Native equivalent; `inputMode="numeric"` alone picks the number pad there.
- A slot is a square of the theme's field height, as on the web, but it may SHRINK: six `md` slots and their gaps are 280dp, and a padded sheet on a 320dp phone has less than that. Shrunk, a slot is narrower than it is tall rather than wrapping the code onto a second line; the web keeps its squares and relies on the row fitting.
- The arrow keys reach `onKeyPress` only under react-native-web: a device's soft keyboard has none, so a slot there is moved to by touch. Backspace does arrive on a device, and steps back from an empty slot as on the web.
- `gradient` focuses in the accent's `main` — the first stop of the web's 135° fill — and draws no gradient: React Native core has no gradient fill. `glass` paints its 0.1 paper wash without the 20px backdrop blur, which React Native has no equivalent of.
- Hover has no touch equivalent, so the web's accent border under the pointer is not drawn; focus is, in the same colour and at the same 2px.
- Each slot carries its own accessible name (`labels.slot`, "Digit 1 of 6" in the English pack) as well as the row's `aria-label`; the web slots are unnamed and take their name from the group alone.
- The digits are set in the theme's own font at the web's px steps and weight; a host that re-themes MUI's typography moves the web only.
