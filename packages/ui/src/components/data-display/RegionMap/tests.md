# RegionMap Test Status Tracking

## Test Files Status

- [x] `RegionMap.test.stories.tsx` created
- [x] `__tests__/region-map-helpers.test.ts` — the geometry: even-odd with a
      hole, distance, which area a tap means (hole, smallest, sliver within the
      tolerance even from inside a big neighbour, nothing beyond it), the view,
      label placement, `extent` on 200k values, the projection and the decoder;
      the view with a reach (none is today's view, a radius past the circle
      grows it centred, a smaller one never shrinks it, a box off to one side
      by its farthest edge, areas and reach together with no circle, a
      non-positive radius ignored) and `boundsOfRings`
- [x] `__tests__/region-map.test.tsx` — what is drawn (areas, hatch + name for
      excluded only, several highlights, nothing with no centre and no areas),
      what a tap reports, read-only, and the list (collapsed by default with its
      count, `aria-expanded`, `aria-pressed`, state in words, outside areas off
      the list and out of the count, `listed`, sort by name, detail, `none`),
      and the reach and overlay (viewBox unchanged without a reach, widened as
      `regionMapView` says with one, the overlay inside the SVG in a
      `pointer-events: none` group with the map's view and projection, a tap
      still reaching the area beneath, no group without an overlay)

## Storybook Tests Status

| Test Name | Status | Pass/Fail | Notes |
| --- | --- | --- | --- |
| A tap on an area reports its id | Written | — | `test-storybook` is not in this repo's CI; jsdom twin in `region-map.test.tsx` |
| Excluded areas are hatched and named | Written | — | same |
| The collapsed list opens and toggles from the keyboard | Written | — | same |
