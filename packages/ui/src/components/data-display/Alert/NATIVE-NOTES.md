# Alert on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- `glass` paints its 0.85 paper wash and hairline without the 20px backdrop blur and saturation — React Native has no backdrop filter.
- `gradient` paints its first stop (`alpha(light, 0.9)`) flat and has no shimmer sweep — React Native core has no gradient fill and no pseudo-elements.
- Hover, active and focus-within (a brightness step each, and the focus ring) have no touch equivalent; the close button's pressed state stands in for its hover.
- The hairline the web draws around a `Button` placed inside the message is a descendant selector; native children are rendered as given. Consecutive text children DO flow as one sentence (`src/platform/text-children.tsx`); an element child breaks the run, as a block would on the web.
- After dismissal the web keeps a collapsed, hidden node in the DOM; native unmounts once the 300ms collapse has run.
- Title, description and children are set in MUI's default `body1`/`body2` numbers; a host that re-themes MUI's typography variants moves the web only.
