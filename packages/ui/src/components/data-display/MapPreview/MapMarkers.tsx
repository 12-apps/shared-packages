import LocationIcon from '@mui/icons-material/LocationOn';
import Box from '@mui/material/Box/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, styled, useTheme } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';

import { MARKER_PIXELS_PER_DEGREE } from './MapPreview.constants';
import type { LatLng, MapMarker } from './MapPreview.types';
import { bounceKeyframes } from './mapSurface';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

// Kept module-local: styled() components cannot be exported across a module
// boundary here without tripping TS2742.
const CoordinatesDisplay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: theme.spacing(2),
  left: theme.spacing(2),
  padding: theme.spacing(1, 1.5),
  background: alpha(theme.palette.background.paper, 0.95),
  backdropFilter: `blur(${rem(theme, 10)})`,
  WebkitBackdropFilter: `blur(${rem(theme, 10)})`,
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
              ${rem(theme, (markerItem.position.lng - centre.lng) * MARKER_PIXELS_PER_DEGREE)},
              ${rem(theme, -(markerItem.position.lat - centre.lat) * MARKER_PIXELS_PER_DEGREE)}
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
                fontSize: rem(theme, 32),
                color: theme.palette.error.main,
                filter: `drop-shadow(${rems(theme, 0, 2, 4)} ${shadowInk(theme, 0.3)})`,
                animation: animated ? 'bounce 2s infinite' : 'none',
                '@keyframes bounce': bounceKeyframes(theme),
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
