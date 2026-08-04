import { useMemo, useRef } from 'react';

import {
  useMapClick,
  useMapControls,
  useMapPointer,
  useMapSearch,
  useMapView,
} from './MapPreview.hooks';
import type { ResolvedMapPreviewProps } from './MapPreview.helpers';

// Wires the map's independent concerns together: the view state first, then the
// controls, pointer handling and search that all write to it.
export const useMapPreview = (props: ResolvedMapPreviewProps) => {
  const { center, coordinates: legacyCoordinates, interactive, onMarkerDrag, onMapClick } = props;

  // `center` supersedes the older `coordinates` prop; either may be omitted.
  const coordinates = useMemo(
    () => center || legacyCoordinates || { lat: 0, lng: 0 },
    [center, legacyCoordinates],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const view = useMapView({
    coordinates,
    initialZoom: props.zoom,
    initialMapType: props.mapType,
  });

  const controls = useMapControls({
    coordinates,
    zoom: view.zoom,
    mapType: view.mapType,
    zoomTo: view.zoomTo,
    setMapType: view.setMapType,
    setMarkerPosition: view.setMarkerPosition,
    setPanOffset: view.setPanOffset,
    containerRef,
  });

  const pointer = useMapPointer({
    interactive,
    markerPosition: view.markerPosition,
    panOffset: view.panOffset,
    onMarkerDrag,
    setMarkerPosition: view.setMarkerPosition,
    setPanOffset: view.setPanOffset,
  });

  const search = useMapSearch({ zoomTo: view.zoomTo, setMarkerPosition: view.setMarkerPosition });

  const handleMapClick = useMapClick({
    coordinates,
    interactive,
    isPanning: pointer.isPanning,
    onMapClick,
    onMarkerDrag,
    setMarkerPosition: view.setMarkerPosition,
  });

  return { containerRef, view, controls, pointer, search, handleMapClick };
};
