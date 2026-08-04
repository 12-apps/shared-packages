import PrevIcon from '@mui/icons-material/ChevronLeft';
import NextIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayIcon from '@mui/icons-material/PlayArrow';
import ResetZoomIcon from '@mui/icons-material/RestartAlt';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { Box, IconButton } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { navButtonSx, OVERLAY_Z_INDEX, overlayButtonSx } from './Lightbox.constants';

type TestId = (suffix: string) => string;

export const LightboxCloseButton: FC<{ testId: TestId; onClose: () => void }> = ({
  testId,
  onClose,
}) => (
  <IconButton
    onClick={onClose}
    sx={{ ...overlayButtonSx, position: 'absolute', top: 16, right: 16, zIndex: OVERLAY_Z_INDEX }}
    aria-label="Close lightbox"
    data-testid={testId('close')}
  >
    <CloseIcon />
  </IconButton>
);

const arrowSx = (side: 'left' | 'right') =>
  ({
    ...navButtonSx,
    position: 'absolute',
    [side]: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: OVERLAY_Z_INDEX,
  }) as const;

export interface LightboxNavButtonsProps {
  testId: TestId;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export const LightboxNavButtons: FC<LightboxNavButtonsProps> = ({
  testId,
  atStart,
  atEnd,
  onPrev,
  onNext,
}) => (
  <>
    <IconButton
      onClick={onPrev}
      disabled={atStart}
      sx={arrowSx('left')}
      aria-label="Previous item"
      data-testid={testId('prev')}
    >
      <PrevIcon />
    </IconButton>

    <IconButton
      onClick={onNext}
      disabled={atEnd}
      sx={arrowSx('right')}
      aria-label="Next item"
      data-testid={testId('next')}
    >
      <NextIcon />
    </IconButton>
  </>
);

export interface LightboxZoomControlsProps {
  testId: TestId;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export const LightboxZoomControls: FC<LightboxZoomControlsProps> = ({
  testId,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}) => (
  <Box
    sx={{
      position: 'absolute',
      top: 16,
      left: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      zIndex: OVERLAY_Z_INDEX,
    }}
    data-testid={testId('zoom-controls')}
  >
    <IconButton onClick={onZoomIn} sx={overlayButtonSx} aria-label="Zoom in" data-testid={testId('zoom-in')}>
      <ZoomInIcon />
    </IconButton>
    <IconButton
      onClick={onZoomOut}
      sx={overlayButtonSx}
      aria-label="Zoom out"
      data-testid={testId('zoom-out')}
    >
      <ZoomOutIcon />
    </IconButton>
    <IconButton
      onClick={onResetZoom}
      sx={overlayButtonSx}
      aria-label="Reset zoom"
      data-testid={testId('zoom-reset')}
    >
      <ResetZoomIcon />
    </IconButton>
  </Box>
);

export interface LightboxAutoplayButtonProps {
  testId: TestId;
  isAutoPlaying: boolean;
  onToggle: () => void;
}

export const LightboxAutoplayButton: FC<LightboxAutoplayButtonProps> = ({
  testId,
  isAutoPlaying,
  onToggle,
}) => (
  <IconButton
    onClick={onToggle}
    sx={{
      ...overlayButtonSx,
      position: 'absolute',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: OVERLAY_Z_INDEX,
    }}
    aria-label={isAutoPlaying ? 'Pause slideshow' : 'Start slideshow'}
    data-testid={testId('autoplay')}
  >
    {isAutoPlaying ? <PauseIcon /> : <PlayIcon />}
  </IconButton>
);
