# Container on React Native — known gaps

- `responsive` reads `useWindowDimensions().width < 600` in place of MUI's `sm` media query, and `centered` reads the window height in place of `100vh`; both track the window, as CSS would, but a container inside a narrower parent still measures the window, not the parent.
