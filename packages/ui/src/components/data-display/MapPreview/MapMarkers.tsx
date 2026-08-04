import LocationIcon from '@mui/icons-material/LocationOn';
import { alpha, Box, styled, Tooltip, Typography, useTheme } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { MARKER_PIXELS_PER_DEGREE } from './MapPreview.constants';
import type { LatLng, MapMarker } from './MapPreview.types';
import { BOUNCE_KEYFRAMES } from './mapSurface';

// Kept module-local: styled() components cannot be exported across a module
// boundary here without tripping TS2742.
const CoordinatesDisplay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: theme.spacing(2),
  left: theme.spacing(2),
  padding: theme.spacing(1, 1.5),
  background: alpha(theme.palette.background.paper, 0.95),
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  borderRadius: theme.shape.borderRadius,
  zIndex: 1,
}));

export interface MapMarkersProps {
  markers: MapMarker[];
  centre: LatLng;
  animated: boolean;
}

// Markers are placed relative to the current centre, so panning moves them with
// the surface.
export const MapMarkers: FC<MapMarkersProps> = ({ markers, centre, animated }) => {
  const theme = useTheme();

  return (
    <>
      {markers.map((markerItem, index) => (
        <Box
          key={`${markerItem.position.lat}-${markerItem.position.lng}-${index}`}
          data-testid={`map-marker-${index}`}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(
              ${(markerItem.position.lng - centre.lng) * MARKER_PIXELS_PER_DEGREE}px,
              ${-(markerItem.position.lat - centre.lat) * MARKER_PIXELS_PER_DEGREE}px
            )`,
            zIndex: 3,
            cursor: markerItem.onClick ? 'pointer' : 'default',
          }}
          onClick={markerItem.onClick}
          title={markerItem.title}
        >
          <Tooltip title={markerItem.description || markerItem.title || ''}>
            <LocationIcon
              sx={{
                fontSize: 32,
                color: theme.palette.error.main,
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                animation: animated ? 'bounce 2s infinite' : 'none',
                '@keyframes bounce': BOUNCE_KEYFRAMES,
              }}
            />
          </Tooltip>
        </Box>
      ))}
    </>
  );
};

export const MapCoordinates: FC<{ position: LatLng; zoom: number }> = ({ position, zoom }) => (
  <CoordinatesDisplay data-testid="coordinates-display">
    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
      Lat: {position.lat.toFixed(6)}, Lng: {position.lng.toFixed(6)}
    </Typography>
    {zoom > 0 && (
      <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>
        Zoom: {zoom}
      </Typography>
    )}
  </CoordinatesDisplay>
);
