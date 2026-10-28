# RegionMap Test Status Tracking

## Test Files Status

- [x] `RegionMap.test.stories.tsx` created
- [x] `__tests__/region-map-helpers.test.ts` — the geometry: even-odd with a
      hole, distance, which area a tap means (hole, smallest, sliver within the
      tolerance, nothing beyond it), the view, label placement, the projection
      and the polyline decoder
- [x] `__tests__/region-map.test.tsx` — what is drawn (areas, hatch + name for
      excluded only, highlight, nothing with no centre and no areas), what a tap
      reports, read-only, and the list (collapsed by default with its count,
      `aria-expanded`, `aria-pressed`, a press reports, detail, `none`)

## Storybook Tests Status

| Test Name | Status | Pass/Fail | Notes |
| --- | --- | --- | --- |
| A tap on an area reports its id | Written | — | `test-storybook` is not in this repo's CI; jsdom twin in `region-map.test.tsx` |
| Excluded areas are hatched and named | Written | — | same |
| The collapsed list opens and toggles from the keyboard | Written | — | same |
