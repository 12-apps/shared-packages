# Container on React Native — known gaps

- `variant="padded"` adds no vertical padding on either renderer: the web declares its 64px above and below BEFORE the `padding` shorthand, which overrides them, and native paints the same insets so the two agree. The fix is a web change (`Container.tsx` order) plus `containerPaddingUnits`, made together.
- `padding="none"` paints the `md` inset on either renderer: the web reads its map with `||`, so `none`'s 0 falls through to the default. Same one-place fix.
- `responsive` reads `useWindowDimensions().width < 600` in place of MUI's `sm` media query, and `centered` reads the window height in place of `100vh`; both track the window, as CSS would, but a container inside a narrower parent still measures the window, not the parent.
