import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { useRegionMap } from './RegionMap.hooks';
import type { RegionMapProps } from './RegionMap.types';
import { RegionMapDrawing } from './RegionMapDrawing';
import { RegionMapLegend } from './RegionMapLegend';
import { RegionMapList } from './RegionMapList';

/** One empty list, so the default does not change identity per render. */
const NO_IDS: readonly string[] = [];

/**
 * A hand-drawn map of named areas around a centre; a tap toggles an area.
 *
 * Drawn as inline SVG over a plain background — no tile server, no API key,
 * nothing fetched — because the question it answers is "which of THESE areas",
 * not "what is the street called". Four choices shape it:
 *
 * - **The list is the accessible way in.** The drawing is one `role="img"`
 *   with a name; its areas are not tab stops (dozens of them, many too small to
 *   tap on a phone). Every area is also a toggle button in the list beneath,
 *   with `aria-pressed`, which is what a keyboard and a screen reader use —
 *   and what reaches a sliver no finger can.
 * - **Excluded is hatched AND named, never only coloured,** and never in the
 *   error colour: leaving an area out is a choice, not a failure.
 * - **The hit test is ours, not only the browser's.** A mouse click on a path
 *   is that path. A finger's tap takes the SMALLEST area within a few pixels'
 *   worth of metres (`hitRegion`), so a sliver beside a big area can be hit
 *   from the map; one too thin even for that is still on the list.
 * - **The host can draw inside it.** `reach` widens the view past the largest
 *   circle and `overlay` draws a layer in the SVG at the map's own projection,
 *   tap-transparent; `regionMapView` gives the same view to HTML laid over it.
 * - **A toggle is cheap.** Geometry is projected once per `rings` identity,
 *   and the base layer is memoised, so a tap re-renders the hatch and labels.
 */
export function RegionMap({
  regions,
  center,
  circles,
  reach,
  overlay,
  onToggle,
  highlightedIds = NO_IDS,
  copy,
  listMode = 'collapsed',
  listSort = 'given',
  maxHeight,
  className,
  dataTestId = 'region-map',
}: RegionMapProps): React.JSX.Element | null {
  const theme = useTheme();
  const model = useRegionMap({ regions, center, circles, reach, onToggle });
  const { view } = model;
  if (view === null && regions.length === 0) return null;
  return (
    <Box className={className} data-testid={dataTestId}>
      {view && (
        <>
          <RegionMapDrawing
            model={{ ...model, view }}
            overlay={overlay}
            showCenter={center !== null}
            highlightedIds={highlightedIds}
            maxHeight={maxHeight}
            label={copy.mapLabel}
            tappable={onToggle !== undefined}
            testId={dataTestId}
            theme={theme}
          />
          <RegionMapLegend
            copy={copy}
            outermostMetres={model.outermostMetres}
            showCenter={center !== null}
            theme={theme}
            testId={dataTestId}
          />
        </>
      )}
      {listMode !== 'none' && (
        <RegionMapList
          regions={regions}
          copy={copy}
          mode={listMode}
          sort={listSort}
          onToggle={onToggle}
          testId={dataTestId}
          theme={theme}
        />
      )}
    </Box>
  );
}
