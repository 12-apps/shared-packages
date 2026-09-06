# Switch on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- The control is drawn here rather than handed to React Native's own `Switch`, which is the platform control at the platform's size: no size scale, no track geometry, no thumb radius per look, no room for an icon or a word inside the track. What that costs is the platform's own switch on a device — this one is a pressable carrying `role="checkbox"` and `aria-checked`, which is what the web's hidden `<input type="checkbox">` announces, but a `role="switch"` would announce better where nothing needs `getByRole('checkbox')` to find it.
- Hover has no touch equivalent, so the thumb does not lift or take its halo, and `ripple` — a wash that expands from the thumb under the pointer on the web — is not drawn at all.
- `glow` paints its halo and inner wash as a static shadow rather than breathing every two seconds, and `gradient` paints the gradient's first stop flat (`light` checked, `alpha(light, 0.3)` at rest): React Native core has no gradient fill, no keyframes on a shadow and no shimmer sweep.
- `glass` washes the track and the thumb at MUI's alphas without the 20px and 10px backdrop blurs — React Native has no backdrop filter.
- `loading` turns the platform's `ActivityIndicator` inside the thumb at MUI's 0.6 of the thumb's size, where the web draws its own 2px ring with one transparent quarter.
- An `onIcon` or `offIcon` is rendered as given, centred in its box. The web sets `color` and `fontSize` on the wrapper and an MUI glyph inherits both; React Native has no inheritance, so pass an `<Icon size color>` that is already the size and colour you want.
- The keyboard reaches the control only through react-native-web: `Enter` presses it (react-native-web's `Pressable` answers it), the space bar toggles it through a DOM key handler, and neither exists on a device.
- `checked`, the label, the description and the helper text are set in MUI's own numbers (`body2` at 14px, `caption` at 12px, the 300ms `cubic-bezier(0.4, 0, 0.2, 1)`); a host that re-themes MUI's typography or its elevations moves the web only.
