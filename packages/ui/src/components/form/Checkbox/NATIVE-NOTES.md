# Checkbox on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- The control is a pressable carrying `role="checkbox"` and `aria-checked` — the state the web's hidden `<input type="checkbox">` announces — rather than a real form element. So it is a tab stop and a screen reader reads it correctly, but the `disabled` ATTRIBUTE a DOM assertion like `toBeDisabled()` looks for is `aria-disabled` here.
- The box itself IS MUI's glyph: `@12-apps/ui/icons` generates `CheckBox`, `CheckBoxOutlineBlank` and `IndeterminateCheckBox` from the same `@mui/icons-material` package MUI's own `Checkbox` imports them from.
- `glow` is a static shadow of MUI's default blue rather than one breathing between a 5px and a 20px blur, and `pulse` — an expanding ring drawn with `box-shadow` spread — is not drawn at all: React Native has neither keyframes on a shadow nor shadow spread.
- Hover has no touch equivalent, so the 0.1 wash the web puts behind a hovered box is not drawn; `ripple` becomes Android's own ripple and is nothing on iOS.
- `rounded` and `toggle` clip and scale the glyph's own box, as the web does — which on a transparent glyph shows only where the box would have clipped it. The web's `borderRadius` on an `<svg>` is the same near-invisible change.
- Both renderers check in `primary.main` whatever `color` says: `Checkbox.tsx` overrides MUI's per-colour rule with primary and wins on source order. Fixing that is a web change.
- The label and the helper text are set in MUI's own numbers (`body2` at 14px, `caption` at 12px, four spacing units of helper inset); a host that re-themes MUI's typography moves the web only.
