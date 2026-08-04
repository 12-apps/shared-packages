import type { FC } from 'react';
import React from 'react';

import type { LightboxProps } from './Lightbox.types';
import {
  LightboxAutoplayButton,
  LightboxCloseButton,
  LightboxNavButtons,
  LightboxZoomControls,
} from './LightboxControls';

export interface LightboxOverlayProps {
  testId: (suffix: string) => string;
  itemCount: number;
  currentIndex: number;
  showControls: boolean;
  loop: boolean;
  autoplay: LightboxProps['autoplay'];
  canZoom: boolean;
  isAutoPlaying: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onToggleAutoplay: () => void;
}

// Everything that floats above the media: dismiss, step, zoom and slideshow.
export const LightboxOverlay: FC<LightboxOverlayProps> = ({
  testId,
  itemCount,
  currentIndex,
  showControls,
  loop,
  autoplay,
  canZoom,
  isAutoPlaying,
  onClose,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleAutoplay,
}) => {
  const hasMultiple = itemCount > 1;

  return (
    <>
      <LightboxCloseButton testId={testId} onClose={onClose} />

      {showControls && hasMultiple && (
        <LightboxNavButtons
          testId={testId}
          // A non-looping gallery runs out of moves at either end.
          atStart={!loop && currentIndex === 0}
          atEnd={!loop && currentIndex === itemCount - 1}
          onPrev={onPrev}
          onNext={onNext}
        />
      )}

      {canZoom && (
        <LightboxZoomControls
          testId={testId}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onResetZoom={onResetZoom}
        />
      )}

      {autoplay && hasMultiple && (
        <LightboxAutoplayButton
          testId={testId}
          isAutoPlaying={isAutoPlaying}
          onToggle={onToggleAutoplay}
        />
      )}
    </>
  );
};
