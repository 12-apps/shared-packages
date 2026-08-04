import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_AUTOPLAY_INTERVAL_MS,
  MAX_ZOOM,
  MIN_SWIPE_DISTANCE,
  MIN_ZOOM,
  WHEEL_ZOOM_FACTOR,
  ZOOM_STEP,
} from './Lightbox.constants';
import type { LightboxItem, LightboxProps } from './Lightbox.types';

const clampZoom = (zoom: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

// Items with no explicit type are images.
const isImageItem = (item?: LightboxItem): item is LightboxItem =>
  Boolean(item && (item.type === 'image' || !item.type));

// Images are fetched once and remembered, so stepping back to one is instant.
export const usePreloader = () => {
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());

  return useCallback(
    (src: string) => {
      if (preloadedImages.has(src)) return;

      const img = new window.Image();
      img.onload = () => setPreloadedImages((prev) => new Set([...prev, src]));
      img.src = src;
    },
    [preloadedImages],
  );
};

export interface ZoomState {
  zoomLevel: number;
  panOffset: { x: number; y: number };
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export const useZoomState = (): ZoomState => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => setZoomLevel((prev) => Math.min(MAX_ZOOM, prev * ZOOM_STEP)), []);
  const zoomOut = useCallback(
    () => setZoomLevel((prev) => Math.max(MIN_ZOOM, prev / ZOOM_STEP)),
    [],
  );

  return { zoomLevel, panOffset, setZoomLevel, resetZoom, zoomIn, zoomOut };
};

export const useWheelZoom = ({
  enabled,
  setZoomLevel,
}: {
  enabled: boolean;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
}) =>
  useCallback(
    (event: React.WheelEvent) => {
      if (!enabled) return;

      event.preventDefault();
      // Scrolling up (negative deltaY) zooms in.
      setZoomLevel((prev) => clampZoom(prev + event.deltaY * -WHEEL_ZOOM_FACTOR));
    },
    [enabled, setZoomLevel],
  );

export const useNavigation = ({
  items,
  loop,
  startIndex,
  resetZoom,
  preloadImage,
}: {
  items: LightboxItem[];
  loop: boolean;
  startIndex: number;
  resetZoom: () => void;
  preloadImage: (src: string) => void;
}) => {
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(0, Math.min(startIndex, items.length - 1)),
  );

  const goToIndex = useCallback(
    (index: number) => {
      if (items.length === 0) return;

      // Looping wraps both ways; otherwise the index sticks at the ends.
      const newIndex = loop
        ? ((index % items.length) + items.length) % items.length
        : Math.max(0, Math.min(index, items.length - 1));

      setCurrentIndex(newIndex);
      resetZoom();

      // Fetch the neighbours so a step in either direction shows immediately.
      [items[newIndex - 1], items[newIndex + 1]]
        .filter(isImageItem)
        .forEach((item) => preloadImage(item.src));
    },
    [items, loop, resetZoom, preloadImage],
  );

  const next = useCallback(() => {
    if (currentIndex < items.length - 1 || loop) goToIndex(currentIndex + 1);
  }, [currentIndex, items.length, loop, goToIndex]);

  const prev = useCallback(() => {
    if (currentIndex > 0 || loop) goToIndex(currentIndex - 1);
  }, [currentIndex, loop, goToIndex]);

  return { currentIndex, goToIndex, next, prev };
};

export const useAutoplay = ({
  isOpen,
  autoplay,
  itemCount,
  currentIndex,
  next,
}: {
  isOpen: boolean;
  autoplay: LightboxProps['autoplay'];
  itemCount: number;
  currentIndex: number;
  next: () => void;
}) => {
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isAutoPlaying || !autoplay || itemCount <= 1) return;

    const interval =
      typeof autoplay === 'object'
        ? autoplay.interval || DEFAULT_AUTOPLAY_INTERVAL_MS
        : DEFAULT_AUTOPLAY_INTERVAL_MS;

    timerRef.current = window.setTimeout(next, interval);

    return () => window.clearTimeout(timerRef.current);
  }, [isAutoPlaying, autoplay, currentIndex, next, itemCount]);

  // Opening a gallery with more than one item starts the slideshow.
  useEffect(() => {
    setIsAutoPlaying(Boolean(isOpen && autoplay && itemCount > 1));
  }, [isOpen, autoplay, itemCount]);

  const stopAutoplay = useCallback(() => {
    setIsAutoPlaying(false);
    window.clearTimeout(timerRef.current);
  }, []);

  return { isAutoPlaying, setIsAutoPlaying, stopAutoplay };
};

export const useLightboxKeyboard = ({
  isOpen,
  showControls,
  autoplay,
  close,
  prev,
  next,
  setIsAutoPlaying,
}: {
  isOpen: boolean;
  showControls: boolean;
  autoplay: LightboxProps['autoplay'];
  close: () => void;
  prev: () => void;
  next: () => void;
  setIsAutoPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const arrows: Record<string, () => void> = { ArrowLeft: prev, ArrowRight: next };

    const handleKeyDown = (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'Escape') {
        close();
        return;
      }

      const arrow = arrows[event.key];
      if (arrow && showControls) {
        event.preventDefault();
        arrow();
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        if (autoplay) setIsAutoPlaying((playing) => !playing);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showControls, close, prev, next, autoplay, setIsAutoPlaying]);
};

// Horizontal swipes step through the gallery; a downward swipe dismisses it.
export const useSwipe = ({
  prev,
  next,
  close,
}: {
  prev: () => void;
  next: () => void;
  close: () => void;
}) => {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      touchStartRef.current = null;
      if (!start || !touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;

      // Whichever axis moved further decides what the gesture meant.
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) > MIN_SWIPE_DISTANCE) {
          if (deltaX > 0) prev();
          else next();
        }
        return;
      }

      if (deltaY > MIN_SWIPE_DISTANCE) close();
    },
    [prev, next, close],
  );

  return { handleTouchStart, handleTouchEnd };
};
