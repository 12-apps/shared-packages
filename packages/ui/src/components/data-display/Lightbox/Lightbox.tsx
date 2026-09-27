import Dialog from '@mui/material/Dialog/index.js';
import Fade from '@mui/material/Fade/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { makeTestId } from './Lightbox.constants';
import { resolveLightboxProps } from './Lightbox.helpers';
import { LightboxCopyProvider } from './lightbox-copy-context';
import type { LightboxProps, LightboxRef } from './Lightbox.types';
import { LightboxCurrentMedia } from './LightboxCurrentMedia';
import { LightboxOverlay } from './LightboxOverlay';
import { LightboxStage } from './LightboxStage';
import { LightboxThumbnails } from './LightboxThumbnails';
import { useLightbox } from './useLightbox';
import { scrim } from '../../../tokens/ink';
import { rem, sxRem } from '../../../tokens/relative';

const DIALOG_STATIC_PROPS = {
  maxWidth: false,
  fullScreen: true,
  TransitionComponent: Fade,
  TransitionProps: { timeout: 300 },
  PaperProps: { sx: { background: (theme: Theme) => scrim(theme, 0.9), backdropFilter: (theme: Theme) => `blur(${rem(theme, 2)})` } },
  // `aria-labelledby` is the one accessible name for the modal itself: MUI
  // forwards it (with `aria-modal` and its own `role="dialog"`) onto the
  // Paper, the element that is actually the WAI-ARIA dialog. A plain
  // `aria-label` alongside it would land on the OUTER root instead — a
  // second, non-modal `role="dialog"` this component sets of its own accord
  // — duplicating (and, as a static English literal, contradicting) the name
  // the Paper already carries.
  //
  // For the same reason, `role` is deliberately NOT set here (FUT-2861):
  // `Dialog` destructures `aria-labelledby` and `aria-modal` by name and
  // applies them to the Paper alongside its own hard-coded `role="dialog"`,
  // but `role` itself is not one of the props it destructures — a `role`
  // passed here falls into `...other` and lands a second, unlabelled
  // `role="dialog"` on the outer Modal root instead of the Paper.
  'aria-labelledby': 'lightbox-title',
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
    <LightboxCopyProvider copy={props.copy}>
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
      <Typography id="lightbox-title" variant="h6" sx={{ position: 'absolute', left: sxRem(-10000) }}>
        {props.copy.dialogLabel} - {currentItem?.alt || props.copy.itemPosition(currentIndex + 1, items.length)}
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
    </LightboxCopyProvider>
  );
});

Lightbox.displayName = 'Lightbox';

export default Lightbox;
