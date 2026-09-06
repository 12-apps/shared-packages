# Card on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- `glass` paints its 0.1 paper wash and primary hairline without the 20px backdrop blur — React Native has no backdrop filter.
- `gradient` paints the gradient's first stop flat (`primary.main`, `primary.dark` under a press) — React Native core has no gradient fill.
- Hover has no touch equivalent: what a variant changes on `:hover` (border colour, wash, shadow) is applied while PRESSED, and the 2px lift is not — the web itself returns an interactive card to `translateY(0)` under the pointer, which is where a finger leaves it.
- The pulse ring is an expanding hollow border rather than a `box-shadow` spread behind the paper: React Native cannot paint a child behind its parent's own background, so the ring grows outward from the card's edge instead of from under it, and its corner radius stays the card's rather than widening with the ring.
- A `glow`ing card stops clipping its children to its corners: a view's own shadow is clipped by its own overflow on a device, so the halo the caller asked for would not paint. The web keeps `overflow: hidden` there and shows both.
- `elevated` restates MUI's `shadows[1]`, the elevation every card inherits from `Paper` on the web, because React Native has no Paper to inherit it from; the variant's own `elevation: 4`/`8` are not CSS properties and paint nothing on either renderer.
- The loading spinner is the platform's `ActivityIndicator` at MUI's 40px `CircularProgress` diameter, not MUI's arc; on iOS the built-in `large` stands in for the exact size.
- `CardMedia` draws its image with `resizeMode="cover"` inside the sized box. MUI's `component` and the DOM `title` attribute are web-only — a device names the image through `accessibilityLabel`.
- `CardActions` spaces its children with `gap` where MUI uses `& > :not(style) ~ :not(style) { margin-left: 8px }`: the same 8px, applied by the container rather than by a sibling selector.
- A `gradient` card's `primary.contrastText` reaches its own text children and the house slots (`CardHeader`'s title, `CardContent`, `CardActions`) through a context; the web puts one `color` on the card and lets CSS inherit it into everything below. So a consumer's own `Text` nested inside a gradient card keeps the body ink unless it reads that colour itself. The header's SUBTITLE stays `text.secondary` on both, because MUI's `CardHeader` pins the subheader to `textSecondary` rather than inheriting.
- Title, subtitle and raw text children are set in MUI's default `h5`/`body1`/`body2` numbers; a host that re-themes MUI's typography variants moves the web only.
