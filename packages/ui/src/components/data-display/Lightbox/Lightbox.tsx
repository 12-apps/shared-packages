import { Dialog, Fade, Typography } from '@mui/material';
import React from 'react';

import { makeTestId } from './Lightbox.constants';
import { resolveLightboxProps } from './Lightbox.helpers';
import type { LightboxProps, LightboxRef } from './Lightbox.types';
import { LightboxCurrentMedia } from './LightboxCurrentMedia';
import { LightboxOverlay } from './LightboxOverlay';
import { LightboxStage } from './LightboxStage';
import { LightboxThumbnails } from './LightboxThumbnails';
import { useLightbox } from './useLightbox';

const DIALOG_STATIC_PROPS = {
  maxWidth: false,
  fullScreen: true,
  TransitionComponent: Fade,
  TransitionProps: { timeout: 300 },
  PaperProps: { sx: { background: 'rgba(0, 0, 0, 0.9)', backdropFilter: 'blur(2px)' } },
  'aria-label': 'Lightbox',
  'aria-labelledby': 'lightbox-title',
  role: 'dialog',
  'aria-modal': 'true',
} as const;

export const Lightbox = React.forwardRef<LightboxRef, LightboxProps>((componentProps, ref) => {
  const props = resolveLightboxProps(componentProps);
  const { isOpen, items, loop, autoplay, showControls, showCaptions, thumbnails, zoomable } = props;
  const { className, style, dataTestId } = props;

  const testId = makeTestId(dataTestId);
  const lightbox = useLightbox(props, ref);
  const { currentIndex, currentItem, zoom } = lightbox;

  return (
    <Dialog
      open={isOpen}
      onClose={lightbox.close}
      {...DIALOG_STATIC_PROPS}
      className={className}
      style={style}
      onTouchStart={lightbox.handleTouchStart}
      onTouchEnd={lightbox.handleTouchEnd}
      data-testid={dataTestId || 'lightbox'}
    >
      {/* Visually hidden title for screen readers */}
      <Typography id="lightbox-title" variant="h6" sx={{ position: 'absolute', left: -10000 }}>
        Lightbox - {currentItem?.alt || `Item ${currentIndex + 1} of ${items.length}`}
      </Typography>

      <LightboxOverlay
        testId={testId}
        itemCount={items.length}
        currentIndex={currentIndex}
        showControls={showControls}
        loop={loop}
        autoplay={autoplay}
        canZoom={lightbox.canZoom}
        isAutoPlaying={lightbox.isAutoPlaying}
        onClose={lightbox.close}
        onPrev={lightbox.prev}
        onNext={lightbox.next}
        onZoomIn={zoom.zoomIn}
        onZoomOut={zoom.zoomOut}
        onResetZoom={zoom.resetZoom}
        onToggleAutoplay={() => lightbox.setIsAutoPlaying((playing) => !playing)}
      />

      <LightboxStage
        items={items}
        currentItem={currentItem}
        currentIndex={currentIndex}
        isLoading={lightbox.isLoading}
        showCaptions={showCaptions}
        thumbnails={thumbnails}
        testId={testId}
        media={
          <LightboxCurrentMedia
            item={currentItem}
            index={currentIndex}
            total={items.length}
            zoomable={zoomable}
            zoom={zoom}
            testId={testId}
            onLoadingChange={lightbox.setIsLoading}
            onWheel={lightbox.handleWheel}
          />
        }
        thumbnailStrip={
          thumbnails &&
          items.length > 1 && (
            <LightboxThumbnails
              items={items}
              currentIndex={currentIndex}
              testId={testId}
              onSelect={lightbox.goToIndex}
            />
          )
        }
      />
    </Dialog>
  );
});

Lightbox.displayName = 'Lightbox';

export default Lightbox;
