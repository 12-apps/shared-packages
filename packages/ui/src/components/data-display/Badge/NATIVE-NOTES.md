# Badge on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- `gradient` paints the 135° run's first stop flat and `glass` keeps its 10% wash and 20% hairline without the `blur(10px) saturate(200%)` backdrop or the inset white highlight — React Native has no gradient fill, no backdrop filter and no inset shadow.
- `shimmer` is a gradient sweeping across a pseudo-element and is not drawn at all; the chip keeps its variant's paint.
- `glow` draws the 15px halo but not the `brightness(1.1)` filter beside it, and `glow` WITH `pulse` breathes only the scale and the opacity — the halo itself cannot be animated, because a box shadow is not an animatable style there.
- Hover has no touch equivalent: the chip's `scale(1.1)` under the pointer and the glow's brighter hover halo are web-only.
- `count` is drawn as a pill (`height / 2`); MUI asks for `border-radius: 50%`, which on a chip wider than it is tall is an ellipse React Native cannot express.
- MUI's `transition: all 0.3s` on the chip has no equivalent: a colour or size change is drawn immediately. The mount, pulse and close animations are `Animated` and do run.
- `onClick` on the badge reaches the DOM through react-native-web and fires there, as it does on the web; a device has no click, so a shared screen that needs a press should put one on its own child.
