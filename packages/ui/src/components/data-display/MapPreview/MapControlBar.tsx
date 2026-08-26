import FullscreenIcon from '@mui/icons-material/Fullscreen';
import LayersIcon from '@mui/icons-material/Layers';
import CenterIcon from '@mui/icons-material/MyLocation';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import Box from '@mui/material/Box/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';

import { MAX_ZOOM, MIN_ZOOM } from './MapPreview.constants';
import type { MapType } from './MapPreview.types';
import type { MapPreviewCopy } from '../../../copy';

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
  /**
   * The six controls' names. Every one is a glyph with a `title` AND an
   * `aria-label`, so this object is both the tooltip and what a screen reader
   * reads — REQUIRED, because a default is one language for every adopter.
   */
  copy: MapPreviewCopy;
  zoom: number;
  mapType: MapType;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onToggleMapType: () => void;
  onToggleFullscreen: () => void;
}

export const MapControlBar: FC<MapControlBarProps> = ({
  copy,
  zoom,
  mapType,
  onZoomIn,
  onZoomOut,
  onCenter,
  onToggleMapType,
  onToggleFullscreen,
}) => (
  <MapControls data-testid="map-controls">
    <Tooltip title={copy.zoomIn} placement="left">
      <ControlButton
        size="small"
        onClick={onZoomIn}
        aria-label={copy.zoomIn}
        data-testid="zoom-in-button"
        disabled={zoom >= MAX_ZOOM}
      >
        <ZoomInIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title={copy.zoomOut} placement="left">
      <ControlButton
        size="small"
        onClick={onZoomOut}
        aria-label={copy.zoomOut}
        data-testid="zoom-out-button"
        disabled={zoom <= MIN_ZOOM}
      >
        <ZoomOutIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title={copy.center} placement="left">
      <ControlButton
        size="small"
        onClick={onCenter}
        aria-label={copy.center}
        data-testid="center-button"
      >
        <CenterIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title={`Map type: ${mapType}`} placement="left">
      <ControlButton
        size="small"
        onClick={onToggleMapType}
        aria-label={copy.mapType}
        data-testid="map-type-button"
      >
        <LayersIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
    <Tooltip title={copy.fullscreen} placement="left">
      <ControlButton
        size="small"
        onClick={onToggleFullscreen}
        aria-label={copy.fullscreen}
        data-testid="fullscreen-button"
      >
        <FullscreenIcon fontSize="small" />
      </ControlButton>
    </Tooltip>
  </MapControls>
);
