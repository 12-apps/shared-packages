import Box from '@mui/material/Box/index.js';
import React from 'react';

import { MapPreview } from '../MapPreview/MapPreview';

import type { FleetMarker } from './FleetMap.hooks';
import type { LatLng } from './FleetMap.helpers';
import type { FleetMapCopy } from './FleetMap.types';

export interface FleetCanvasProps {
  copy: FleetMapCopy;
  /** Where to point. `null` renders NOTHING — see the component's note. */
  centre: LatLng | null;
  markers: FleetMarker[];
  height: string;
  testId: string;
}

/**
 * The map half — a NAMED LANDMARK, not an `aria-hidden` one.
 *
 * Its controls are focusable, and `aria-hidden` over a focusable subtree is the
 * `aria-hidden-focus` violation: a keyboard user tabs into something a screen
 * reader insists is not there. `role="region"` with a name is what puts it in a
 * screen reader's landmark rotor, which is the "skip it in one gesture" the
 * roster's note promises; `role="group"` is not a landmark and would not.
 *
 * ## No centre, no map
 *
 * `mapCentre` answers `null` rather than a coordinate for an empty fleet, and
 * that refusal has to survive the whole way down. `MapPreview` has no default
 * centre — it resolves `center || coordinates || { lat: 0, lng: 0 }` — so
 * forwarding `undefined` sails the map to the Gulf of Guinea and prints
 * `Lat: 0.000000` under a default pin. That is exactly the render the helper
 * exists to prevent, and it is reachable: a board that is `loading` with
 * nothing yet reported skips the empty state by design and lands here.
 */
export function FleetCanvas({
  copy,
  centre,
  markers,
  height,
  testId,
}: FleetCanvasProps): React.JSX.Element | null {
  if (!centre) return null;
  return (
    <Box
      role="region"
      aria-label={copy.mapLabel}
      data-testid={`${testId}-canvas`}
      sx={{ flexGrow: 1, minWidth: 0 }}
    >
      <MapPreview
        copy={copy.map}
        center={centre}
        markers={markers}
        height={height}
        interactive
        showControls
      />
    </Box>
  );
}
