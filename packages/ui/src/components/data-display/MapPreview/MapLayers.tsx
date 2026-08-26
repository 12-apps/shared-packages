import { useTheme } from '@mui/material/styles';
import type { FC } from 'react';
import React from 'react';

import { HEATMAP_VIEWBOX } from './MapPreview.constants';
import type { ResolvedMapPreviewProps } from './MapPreview.helpers';
import type { MapType } from './MapPreview.types';
import { MapControlBar } from './MapControlBar';
import { HeatmapOverlay, RouteOverlay } from './MapOverlays';
import { MapSearchBar } from './MapSearchBar';

export interface MapLayersProps {
  settings: ResolvedMapPreviewProps;
  zoom: number;
  mapType: MapType;
  search: {
    searchValue: string;
    isSearching: boolean;
    setSearchValue: (value: string) => void;
    handleSearch: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  };
  controls: {
    handleZoomIn: () => void;
    handleZoomOut: () => void;
    handleCenter: () => void;
    handleToggleMapType: () => void;
    handleToggleFullscreen: () => void;
  };
}

// Everything drawn over the map surface that is switched on by a prop.
export const MapLayers: FC<MapLayersProps> = ({ settings, zoom, mapType, search, controls }) => {
  const theme = useTheme();

  return (
    <>
      {settings.showHeatmap && settings.heatmapData.length > 0 && (
        <HeatmapOverlay
          points={settings.heatmapData}
          width={HEATMAP_VIEWBOX.width}
          height={HEATMAP_VIEWBOX.height}
        />
      )}

      {settings.showRoute && <RouteOverlay color={settings.routeColor || theme.palette.primary.main} />}

      {settings.showSearch && (
        <MapSearchBar
          label={settings.copy.search}
          value={search.searchValue}
          placeholder={settings.searchPlaceholder}
          isSearching={search.isSearching}
          onChange={search.setSearchValue}
          onSubmit={search.handleSearch}
        />
      )}

      {settings.showControls && (
        <MapControlBar
          copy={settings.copy}
          zoom={zoom}
          mapType={mapType}
          onZoomIn={controls.handleZoomIn}
          onZoomOut={controls.handleZoomOut}
          onCenter={controls.handleCenter}
          onToggleMapType={controls.handleToggleMapType}
          onToggleFullscreen={controls.handleToggleFullscreen}
        />
      )}
    </>
  );
};
