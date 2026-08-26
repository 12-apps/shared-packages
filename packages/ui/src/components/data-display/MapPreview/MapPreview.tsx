import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { alpha, styled, useTheme } from '@mui/material/styles';
import type { FC } from 'react';
import React from 'react';

import { glassStyles, resolveMapPreviewProps } from './MapPreview.helpers';
import type { MapPreviewProps } from './MapPreview.types';
import { MapLayers } from './MapLayers';
import { MapCoordinates, MapMarkers } from './MapMarkers';
import { StaticMapView } from './StaticMapView';
import { useMapPreview } from './useMapPreview';

// Kept module-local: styled() components cannot be exported across a module
// boundary here without tripping TS2742.
const MapContainer = styled(Paper)(({ theme }) => ({
  position: 'relative',
  width: '100%',
  borderRadius: theme.shape.borderRadius * 2,
  overflow: 'hidden',
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.8)} 100%)`,
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
}));

const MapWrapper = styled(Box)<{ height: string }>(({ height }) => ({
  width: '100%',
  height,
  position: 'relative',
}));

const cursorFor = (grabbing: boolean, interactive: boolean): string => {
  if (grabbing) return 'grabbing';
  return interactive ? 'grab' : 'default';
};

export const MapPreview: FC<MapPreviewProps> = (componentProps) => {
  const props = resolveMapPreviewProps(componentProps);
  const theme = useTheme();
  const { containerRef, view, controls, pointer, search, handleMapClick } = useMapPreview(props);

  const height = controls.isFullscreen ? '100vh' : props.height;
  const grabbing = pointer.isDragging || pointer.isPanning;

  return (
    <MapContainer
      ref={containerRef}
      elevation={props.variant === 'glass' ? 0 : 2}
      data-testid="map-preview-container"
      role="img"
      aria-label={`Map preview centered at ${view.markerPosition.lat.toFixed(4)}, ${view.markerPosition.lng.toFixed(4)} with zoom level ${view.zoom}`}
      tabIndex={0}
      aria-live="polite"
      aria-atomic="true"
      sx={glassStyles(props.variant, theme)}
    >
      <MapWrapper
        height={height}
        onClick={handleMapClick}
        onMouseDown={pointer.handleMouseDown}
        onMouseMove={pointer.handleMouseMove}
        onMouseUp={pointer.handleMouseUp}
        onMouseLeave={pointer.handleMouseUp}
        style={{
          cursor: cursorFor(grabbing, props.interactive),
          transition: props.animated ? 'all 0.3s ease' : 'none',
        }}
      >
        <StaticMapView
          height={height}
          zoom={view.zoom}
          mapType={view.mapType}
          // The built-in centre marker steps aside for an explicit marker list.
          marker={props.marker && props.markers.length === 0}
          markerPosition={view.markerPosition}
          panOffset={view.panOffset}
        />

        <MapMarkers markers={props.markers} centre={view.markerPosition} animated={props.animated} />

        <MapLayers
          settings={props}
          zoom={view.zoom}
          mapType={view.mapType}
          search={search}
          controls={controls}
        />

        <MapCoordinates position={view.markerPosition} zoom={view.zoom} />
      </MapWrapper>
    </MapContainer>
  );
};

export default MapPreview;
