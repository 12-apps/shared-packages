# InputOTP on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- There is no paste event on React Native: a pasted or SMS-filled code arrives as a change of the first box (its `maxLength` is the code's length plus one), and is spread from there by the same rules the web's paste uses — for `numeric` and `alphanumeric`. A `masked` box shows a bullet, so a paste into it keeps one character: the web spreads it.
- Hover has no touch equivalent, so the web's hover border is not drawn; focus is, in the same colour and 2px width.
- `glass` and `gradient` are accepted and draw the plain box: React Native core has no backdrop blur and no gradient border.
- Arrow keys do not move between boxes (a phone keypad has none); Backspace in an empty box steps back, as on the web.
