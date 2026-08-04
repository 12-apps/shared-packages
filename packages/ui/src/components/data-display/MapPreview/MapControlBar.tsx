import FullscreenIcon from '@mui/icons-material/Fullscreen';
import LayersIcon from '@mui/icons-material/Layers';
import CenterIcon from '@mui/icons-material/MyLocation';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { alpha, Box, IconButton, styled, Tooltip } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { MAX_ZOOM, MIN_ZOOM } from './MapPreview.constants';
import type { MapType } from './MapPreview.types';

// Kept module-local: the inferred type of a styled() component cannot be named
// across a module boundary here (TS2742).
const MapControls = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(2),
  right: theme.spacing(2),
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
}));

const ControlButton = styled(IconButton)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.95),
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  boxShadow: theme.shadows[2],
  // Kept clickable while disabled so hover tooltips still work at the limits.
  pointerEvents: 'auto',
  '&:hover': {
    background: theme.palette.background.paper,
    transform: 'scale(1.05)',
  },
  '&:disabled': {
    opacity: 0.5,
    pointerEvents: 'auto',
  },
}));

export interface MapControlBarProps {
  zoom: number;
  mapType: MapType;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onToggleMapType: () => void;
  onToggleFullscreen: () => void;
}

export const MapControlBar: FC<MapControlBarProps> = ({
  zoom,
  mapType,
  onZoomIn,
  onZoomOut,
  onCenter,
  onToggleMapType,
  onToggleFullscreen,
}) => (
  <MapControls data-testid="map-controls">
    <Tooltip title="Zoom in" placement="left">
      <ControlButton
        size="small"
        onClick={onZoomIn}
        aria-label="Zoom in"
        data-testid="zoom-in-button"
        disabled={zoom >= MAX_ZOOM}
      >
        <ZoomInIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title="Zoom out" placement="left">
      <ControlButton
        size="small"
        onClick={onZoomOut}
        aria-label="Zoom out"
        data-testid="zoom-out-button"
        disabled={zoom <= MIN_ZOOM}
      >
        <ZoomOutIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title="Center map" placement="left">
      <ControlButton
        size="small"
        onClick={onCenter}
        aria-label="Center map"
        data-testid="center-button"
      >
        <CenterIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title={`Map type: ${mapType}`} placement="left">
      <ControlButton
        size="small"
        onClick={onToggleMapType}
        aria-label="Change map type"
        data-testid="map-type-button"
      >
        <LayersIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title="Toggle fullscreen" placement="left">
      <ControlButton
        size="small"
        onClick={onToggleFullscreen}
        aria-label="Toggle fullscreen"
        data-testid="fullscreen-button"
      >
        <FullscreenIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
  </MapControls>
);
