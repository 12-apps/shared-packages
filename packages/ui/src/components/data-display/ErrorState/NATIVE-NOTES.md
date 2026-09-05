# ErrorState on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- The retry is the house `Button` (outline, `sm`) sized to MUI's medium outlined button — same 5px/15px padding, 14px type, radius, 20px icon and 120px floor; MUI additionally uppercases the label, draws its border at `alpha(main, 0.5)`, and sets the icon 8px from the label where the house button sets 4.
- Title and message are set in MUI's default `h6`/`body2` numbers; a host that re-themes MUI's typography variants moves the web only.
