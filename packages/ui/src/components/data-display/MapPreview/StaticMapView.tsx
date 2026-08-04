import { Box, useTheme } from '@mui/material';
import type { FC } from 'react';
import React, { useMemo } from 'react';

import { getTileCoordinates } from './mapProjection';
import { surfaceBackground } from './mapSurface';
import type { LatLng, MapType } from './MapPreview.types';
import {
  MapCentreMarker,
  MapCompass,
  MapDecorativePins,
  MapRoads,
  MapScaleBar,
} from './MapDecorations';
import { MapTiles } from './MapTiles';

export interface StaticMapViewProps {
  height: string;
  zoom: number;
  mapType: MapType;
  marker?: boolean;
  markerPosition?: LatLng;
  panOffset?: { x: number; y: number };
}

// A stand-in map surface: a tile grid at the right coordinates for the current
// position and zoom, with the usual furniture drawn over it.
export const StaticMapView: FC<StaticMapViewProps> = ({
  height,
  zoom,
  mapType,
  marker,
  markerPosition,
  panOffset = { x: 0, y: 0 },
}) => {
  const theme = useTheme();

  const tileOrigin = useMemo(
    () =>
      markerPosition ? getTileCoordinates(markerPosition.lat, markerPosition.lng, zoom) : null,
    [markerPosition, zoom],
  );

  return (
    <Box
      data-testid="static-map-view"
      sx={{
        width: '100%',
        height,
        position: 'relative',
        background: surfaceBackground(mapType, theme),
        overflow: 'hidden',
      }}
    >
      <MapTiles origin={tileOrigin} zoom={zoom} mapType={mapType} panOffset={panOffset} />
      <MapRoads />
      {marker && <MapCentreMarker />}
      <MapDecorativePins />
      <MapScaleBar zoom={zoom} />
      <MapCompass />
    </Box>
  );
};
