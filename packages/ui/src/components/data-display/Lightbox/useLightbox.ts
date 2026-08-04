import { useCallback, useImperativeHandle, useState } from 'react';
import type React from 'react';

import {
  useAutoplay,
  useLightboxKeyboard,
  useNavigation,
  usePreloader,
  useSwipe,
  useWheelZoom,
  useZoomState,
} from './Lightbox.hooks';
import type { ResolvedLightboxProps } from './Lightbox.helpers';
import type { LightboxRef } from './Lightbox.types';

// Wires the independent concerns together in dependency order: zoom, then
// navigation (which resets zoom), then autoplay (which advances), then the
// input handlers that close.
export const useLightbox = (
  { isOpen, onClose, items, startIndex, showControls, loop, autoplay, zoomable }: ResolvedLightboxProps,
  ref: React.ForwardedRef<LightboxRef>,
) => {
  const [isLoading, setIsLoading] = useState(false);

  const preloadImage = usePreloader();
  const zoom = useZoomState();

  const { currentIndex, goToIndex, next, prev } = useNavigation({
    items,
    loop,
    startIndex,
    resetZoom: zoom.resetZoom,
    preloadImage,
  });

  const currentItem = items[currentIndex];
  const canZoom = Boolean(zoomable && currentItem && currentItem.type !== 'video');

  const handleWheel = useWheelZoom({ enabled: canZoom, setZoomLevel: zoom.setZoomLevel });

  const { isAutoPlaying, setIsAutoPlaying, stopAutoplay } = useAutoplay({
    isOpen,
    autoplay,
    itemCount: items.length,
    currentIndex,
    next,
  });

  const close = useCallback(() => {
    stopAutoplay();
    onClose();
  }, [stopAutoplay, onClose]);

  // open() with no argument starts at the first item.
  const open = useCallback((index = 0) => goToIndex(index), [goToIndex]);

  useImperativeHandle(ref, () => ({ open, close, next, prev, goTo: goToIndex }));

  useLightboxKeyboard({ isOpen, showControls, autoplay, close, prev, next, setIsAutoPlaying });

  const { handleTouchStart, handleTouchEnd } = useSwipe({ prev, next, close });

  return {
    currentIndex,
    currentItem,
    canZoom,
    isLoading,
    setIsLoading,
    isAutoPlaying,
    setIsAutoPlaying,
    zoom,
    handleWheel,
    goToIndex,
    next,
    prev,
    close,
    handleTouchStart,
    handleTouchEnd,
  };
};
