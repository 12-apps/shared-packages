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
 * screen reader's landmark rotor, so it can be jumped PAST in one gesture;
 * `role="group"` is not a landmark and would not.
 *
 * ## Skipping it does not silence it, and that is not ours to fix here
 *
 * `MapPreview` puts `aria-live="polite"` on its own root, with an English
 * `aria-label` naming the centre coordinates and zoom. So re-centring the map —
 * which every selection change does — announces something like "Map preview
 * centered at -23.5505, -46.6333 with zoom level 15", in English, however
 * thoroughly a reader has skipped the landmark. Two things follow, and neither
 * is solved by anything this file can do:
 *
 *   * a live region announces from wherever the reader is, so the landmark's
 *     skippability does not suppress it;
 *   * that string is the one piece of user-facing text in this component that
 *     does NOT come through `copy`.
 *
 * Fixing it means changing `MapPreview`, which every other consumer shares, so
 * it is stated here rather than quietly claimed away.
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
