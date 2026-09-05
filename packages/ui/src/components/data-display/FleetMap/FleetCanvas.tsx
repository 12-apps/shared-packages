import Box from '@mui/material/Box/index.js';
import React from 'react';

import { MapPreview } from '../MapPreview/MapPreview';

import type { FleetMarker } from './FleetMap.hooks';
import type { LatLng } from './FleetMap.helpers';
import type { FleetMapCopy } from './FleetMap.types';

export interface FleetCanvasProps {
  copy: FleetMapCopy;
  centre: LatLng | null;
  markers: FleetMarker[];
  height: string;
  googleMapsApiKey?: string;
  testId: string;
}

/**
 * The map half — a NAMED region, not an `aria-hidden` one.
 *
 * Its controls are focusable, and `aria-hidden` over a focusable subtree is the
 * `aria-hidden-focus` violation: a keyboard user tabs into something a screen
 * reader insists is not there. Naming it lets a reader skip it in one gesture,
 * and the roster beside it carries every fact a pin does.
 */
export function FleetCanvas({
  copy,
  centre,
  markers,
  height,
  googleMapsApiKey,
  testId,
}: FleetCanvasProps): React.JSX.Element {
  return (
    <Box
      role="group"
      aria-label={copy.mapLabel}
      data-testid={`${testId}-canvas`}
      sx={{ flexGrow: 1, minWidth: 0 }}
    >
      <MapPreview
        copy={copy.map}
        center={centre ?? undefined}
        markers={markers}
        height={height}
        interactive
        showControls
        googleMapsApiKey={googleMapsApiKey}
      />
    </Box>
  );
}
