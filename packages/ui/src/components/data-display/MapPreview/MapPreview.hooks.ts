import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { geocode } from './mapProjection';
import {
  CITY_ZOOM,
  CLICK_JITTER_DEGREES,
  DRAG_DEGREES_PER_PIXEL,
  MAP_TYPES,
  MAX_ZOOM,
  MIN_ZOOM,
} from './MapPreview.constants';
import type { LatLng, MapType } from './MapPreview.types';

const ORIGIN = { x: 0, y: 0 };

export const useMapView = ({
  coordinates,
  initialZoom,
  initialMapType,
}: {
  coordinates: LatLng;
  initialZoom: number;
  initialMapType: MapType;
}) => {
  const [zoom, setZoom] = useState(initialZoom);
  const [mapType, setMapType] = useState<MapType>(initialMapType);
  const [markerPosition, setMarkerPosition] = useState(coordinates);
  const [panOffset, setPanOffset] = useState(ORIGIN);

  useEffect(() => {
    setMarkerPosition(coordinates);
  }, [coordinates]);

  // Panning is relative to the tile grid, so a zoom change invalidates it.
  const zoomTo = useCallback((next: number) => {
    setZoom(next);
    setPanOffset(ORIGIN);
  }, []);

  return {
    zoom,
    zoomTo,
    mapType,
    setMapType,
    markerPosition,
    setMarkerPosition,
    panOffset,
    setPanOffset,
  };
};

export const useMapControls = ({
  coordinates,
  zoom,
  mapType,
  zoomTo,
  setMapType,
  setMarkerPosition,
  setPanOffset,
  containerRef,
}: {
  coordinates: LatLng;
  zoom: number;
  mapType: MapType;
  zoomTo: (zoom: number) => void;
  setMapType: (type: MapType) => void;
  setMarkerPosition: (position: LatLng) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleZoomIn = useCallback(() => zoomTo(Math.min(zoom + 1, MAX_ZOOM)), [zoom, zoomTo]);
  const handleZoomOut = useCallback(() => zoomTo(Math.max(zoom - 1, MIN_ZOOM)), [zoom, zoomTo]);

  const handleCenter = useCallback(() => {
    setMarkerPosition({ ...coordinates });
    setPanOffset(ORIGIN);
  }, [coordinates, setMarkerPosition, setPanOffset]);

  const handleToggleMapType = useCallback(() => {
    const nextIndex = (MAP_TYPES.indexOf(mapType) + 1) % MAP_TYPES.length;
    setMapType(MAP_TYPES[nextIndex] as MapType);
  }, [mapType, setMapType]);

  const handleToggleFullscreen = useCallback(() => {
    if (!isFullscreen && containerRef.current) {
      containerRef.current.requestFullscreen?.();
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
    setIsFullscreen((prev) => !prev);
  }, [isFullscreen, containerRef]);

  return {
    isFullscreen,
    handleZoomIn,
    handleZoomOut,
    handleCenter,
    handleToggleMapType,
    handleToggleFullscreen,
  };
};

interface DragStart {
  x: number;
  y: number;
  lat: number;
  lng: number;
}

interface PanStart {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
}

const isOnMapSurface = (target: HTMLElement): boolean =>
  target.dataset.testid === 'static-map-view' ||
  Boolean(target.closest('[data-testid="static-map-view"]'));

const panTo = (event: React.MouseEvent, start: PanStart) => ({
  x: start.offsetX + (event.clientX - start.x),
  y: start.offsetY + (event.clientY - start.y),
});

const dragTo = (event: React.MouseEvent, start: DragStart): LatLng => ({
  lat: start.lat + (event.clientY - start.y) * DRAG_DEGREES_PER_PIXEL,
  lng: start.lng + (event.clientX - start.x) * DRAG_DEGREES_PER_PIXEL,
});

// Shift-drag pans the surface; a plain drag moves the marker.
export const useMapPointer = ({
  interactive,
  markerPosition,
  panOffset,
  onMarkerDrag,
  setMarkerPosition,
  setPanOffset,
}: {
  interactive: boolean;
  markerPosition: LatLng;
  panOffset: { x: number; y: number };
  onMarkerDrag?: (coords: LatLng) => void;
  setMarkerPosition: (position: LatLng) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragStartRef = useRef<DragStart | null>(null);
  const panStartRef = useRef<PanStart | null>(null);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const { clientX: x, clientY: y } = event;

      if (isOnMapSurface(event.target as HTMLElement) && event.shiftKey) {
        setIsPanning(true);
        panStartRef.current = { x, y, offsetX: panOffset.x, offsetY: panOffset.y };
        return;
      }

      setIsDragging(true);
      dragStartRef.current = { x, y, lat: markerPosition.lat, lng: markerPosition.lng };
    },
    [interactive, markerPosition, panOffset],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const panStart = panStartRef.current;
      if (isPanning && panStart) {
        setPanOffset(panTo(event, panStart));
        return;
      }

      const dragStart = dragStartRef.current;
      if (!isDragging || !dragStart) return;

      const position = dragTo(event, dragStart);
      setMarkerPosition(position);
      onMarkerDrag?.(position);
    },
    [isDragging, isPanning, onMarkerDrag, setMarkerPosition, setPanOffset],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsPanning(false);
    dragStartRef.current = null;
    panStartRef.current = null;
  }, []);

  return { isDragging, isPanning, handleMouseDown, handleMouseMove, handleMouseUp };
};

export const useMapSearch = ({
  zoomTo,
  setMarkerPosition,
}: {
  zoomTo: (zoom: number) => void;
  setMarkerPosition: (position: LatLng) => void;
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = useCallback(
    async (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter' || !searchValue) return;

      setIsSearching(true);
      try {
        const result = await geocode(searchValue);
        // An unknown place leaves the map where it is; a production build would
        // surface an error here.
        if (!result) return;

        setMarkerPosition({ ...result });
        zoomTo(CITY_ZOOM);
      } finally {
        setIsSearching(false);
      }
    },
    [searchValue, zoomTo, setMarkerPosition],
  );

  return { searchValue, setSearchValue, isSearching, handleSearch };
};

export const useMapClick = ({
  coordinates,
  interactive,
  isPanning,
  onMapClick,
  onMarkerDrag,
  setMarkerPosition,
}: {
  coordinates: LatLng;
  interactive: boolean;
  isPanning: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  onMarkerDrag?: (coords: LatLng) => void;
  setMarkerPosition: (position: LatLng) => void;
}) =>
  useCallback(() => {
    // A pan ends with a click event; that should not also drop a marker.
    if (isPanning) return;

    // Without a real projection there is nothing to convert a click position
    // into, so the mock jitters around the centre instead.
    const coords = {
      lat: coordinates.lat + (Math.random() - 0.5) * CLICK_JITTER_DEGREES,
      lng: coordinates.lng + (Math.random() - 0.5) * CLICK_JITTER_DEGREES,
    };

    onMapClick?.(coords.lat, coords.lng);

    if (interactive && onMarkerDrag) {
      setMarkerPosition(coords);
      onMarkerDrag(coords);
    }
  }, [coordinates, interactive, isPanning, onMapClick, onMarkerDrag, setMarkerPosition]);
