# Avatar on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- Hover has no touch equivalent: the interactive lift (`scale(1.1) translateY(-2px)`, the `0 8px 20px` shadow and the brightness), the `:active` squeeze and the `:focus-visible` ring are all web-only. The avatar still reports itself as a button and takes a tab stop.
- The shimmer that runs across a loading avatar is a moving gradient; React Native core has neither, so the box keeps its accent and only the overlay and its spinner say it is loading. `backdrop-filter: blur(2px)` behind that overlay has no equivalent either — the wash is the flat `alpha(paper, 0.7)`.
- `glow` paints the halo but not the `brightness(1.05)` filter that goes with it; React Native has no filters.
- `pulse` is a ring behind the avatar scaling out to 10px and fading, rather than MUI's growing `box-shadow` on an `::after` — the same colour, cadence and travel, drawn by a sibling.
- The status dot is a bordered circle placed at MUI's `overlap="circular"` inset; MUI's `Badge` additionally draws a `::after` ripple layer over it.
- `AvatarGroup` overlaps and counts exactly as the web does, but the web ALSO gives every child a paper ring through a `& > *` descendant rule. A native renderer cannot restyle children, so an avatar in a group takes `bordered` from its own prop.
- The default and broken-image glyphs are the house `Icon` at 24px, which is what MUI's `SvgIcon` draws them at here; the initials are set in the theme's own font rather than MUI's `Avatar` typography.
